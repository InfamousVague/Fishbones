/// Sound-effect library — recorded pack + synthesized fallback.
///
/// As of the 2026-06 sound redesign, the PRIMARY soundscape is a
/// recorded pack (ElevenLabs sound-generation, hand-picked per cue
/// from a 10-pack audition — see .sfx-work/ for the prompt book,
/// workbench and provenance manifest). MP3s ship in public/sfx/ and
/// decode through the same AudioContext + master gain below, so the
/// mute / volume settings and per-cue throttle apply unchanged.
///
/// The original Web-Audio SYNTH cues remain as the instant fallback
/// (pack still fetching on a cold boot, fetch failed, decode error)
/// — oscillators feeding into a gain node shaped by an ADSR envelope,
/// something Duolingo-shaped produced on demand.
///
/// Why synthesise instead of bundle audio:
///   - Bundle bytes: ~0 KB on the wire vs. ~30-80 KB per cue × 12 cues.
///   - Latency: single-frame schedule on the audio context vs. fetch
///     + decode + buffer-load (~200ms cold start the first time).
///   - Tweak loop: change a frequency / envelope and reload — no
///     re-encoding audio in a DAW. Useful for design iteration.
///   - Theme-able: the same generator can play "warmer" or "colder"
///     timbre by tweaking the oscillator type without re-recording.
///
/// Trade-off: synthesised cues sound more abstract/electronic than
/// recorded foley would. Acceptable here because the brand voice is
/// already that direction (libre.academy is digital, not pastoral).
///
/// Settings:
///   - `localStorage["libre:sfx:enabled"]`: "1" / "0" — global mute.
///   - `localStorage["libre:sfx:volume"]`: float 0..1 — master gain.
///   Both are read once at module load and re-read on a custom
///   `fb:sfx:settings-changed` event. The settings pane fires the
///   event after writing so we don't depend on the cross-tab
///   `storage` event (which doesn't fire same-tab).
///
/// API:
///   - `playSound(name, opts?)` — fire-and-forget; never throws.
///   - `getSfxSettings()`, `setSfxSettings(...)` — settings pane uses
///     these; the change broadcast keeps the in-module cache in sync.
///   - `unlockAudioContext()` — call from the first user gesture
///     handler if you want the context warmed before the first cue
///     fires (avoids the iOS Safari "first sound is silent" beat).

export type SfxName =
  | "ping"
  | "chime"
  | "success"
  | "fanfare"
  | "arpeggio"
  | "streak-tick"
  | "streak-flame"
  | "xp-pop"
  | "level-up"
  | "complete-section"
  | "complete-book"
  | "freeze"
  | "nope"
  // Recorded-pack-era cues (2026-06): no bespoke synth generator —
  // they fall back to a neighbouring synth cue via SYNTH_FALLBACK
  // when the recorded asset isn't available.
  | "ui-open"
  | "notify"
  | "page-turn"
  | "stamp"
  | "coin"
  | "boot-up"
  | "flame-out";

export interface PlayOptions {
  /// Per-call volume scale, 0..1. Multiplies into the master volume.
  /// Default 1 (use the master volume directly).
  volume?: number;
  /// Override the global mute for this single call. Used by the
  /// settings pane's "Test sound" buttons so the user can hear a
  /// preview even when mute is on. Also bypasses the per-cue
  /// throttle so rapid preview taps always play.
  ignoreMute?: boolean;
  /// Minimum gap (ms) before the SAME cue may fire again. Repeats
  /// inside the window are dropped. Defaults to DEFAULT_COOLDOWN_MS.
  cooldownMs?: number;
}

const ENABLED_KEY = "libre:sfx:enabled";
const VOLUME_KEY = "libre:sfx:volume";
const SETTINGS_EVENT = "libre:sfx:settings-changed";

/// Module-private context. Lazily created on first sound; iOS
/// Safari requires a user-gesture-driven creation, so building the
/// context only when needed is the safer pattern.
let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

/// Per-cue cooldown clock. Several cues now fire from rapid learning
/// events (per-question quiz answers, the verifier auto-answering a
/// whole quiz, fast run-retries). Without a throttle those would
/// machine-gun. We collapse repeats of the SAME cue within a short
/// window — mirrors the haptic engine's per-intent cooldown. Keyed
/// by cue name, so different cues never throttle each other.
const lastFiredAt = new Map<SfxName, number>();
const DEFAULT_COOLDOWN_MS = 100;

/// In-module cache of settings. Refreshed on the custom event the
/// settings pane fires after writing, AND on the cross-tab storage
/// event for the (rare) case of two open windows. Both update the
/// same source of truth (localStorage), so the cache is just a
/// hot-path read avoidance.
let settingsCache: SfxSettings = readFromStorage();

export interface SfxSettings {
  enabled: boolean;
  /// 0..1
  volume: number;
}

function readFromStorage(): SfxSettings {
  if (typeof localStorage === "undefined") {
    return { enabled: true, volume: 0.6 };
  }
  const enabledRaw = localStorage.getItem(ENABLED_KEY);
  const enabled = enabledRaw === null ? true : enabledRaw === "1";
  const volumeRaw = localStorage.getItem(VOLUME_KEY);
  let volume = 0.6;
  if (volumeRaw !== null) {
    const n = Number.parseFloat(volumeRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) volume = n;
  }
  return { enabled, volume };
}

if (typeof window !== "undefined") {
  // Two refresh paths: (a) same-tab settings UI dispatching the
  // custom event after write, (b) cross-tab `storage` events for
  // the unusual two-windows-open case. Both rebuild the cache from
  // localStorage rather than trusting event payloads — keeps the
  // event surface tiny and immune to schema drift.
  window.addEventListener(SETTINGS_EVENT, () => {
    settingsCache = readFromStorage();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === ENABLED_KEY || e.key === VOLUME_KEY) {
      settingsCache = readFromStorage();
    }
  });
}

export function getSfxSettings(): SfxSettings {
  return settingsCache;
}

export function setSfxSettings(next: Partial<SfxSettings>): void {
  if (typeof localStorage === "undefined") return;
  if (next.enabled !== undefined) {
    localStorage.setItem(ENABLED_KEY, next.enabled ? "1" : "0");
  }
  if (next.volume !== undefined) {
    const clamped = Math.max(0, Math.min(1, next.volume));
    localStorage.setItem(VOLUME_KEY, String(clamped));
  }
  settingsCache = readFromStorage();
  if (masterGain && ctx) {
    masterGain.gain.setValueAtTime(settingsCache.volume, ctx.currentTime);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  }
}

/// Create the AudioContext on demand. Must be called from a
/// user-gesture handler at least once (browser policy). After the
/// first successful resume the context stays alive for the page
/// session.
function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  // AudioContext is the standard name; webkitAudioContext is the
  // safari-prefixed legacy. Both implement the same interface.
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(settingsCache.volume, ctx.currentTime);
    masterGain.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/// Attempt to resume the context. Browsers freeze the audio context
/// in suspended state on page load until the first user gesture; the
/// `resume()` returns a promise we can ignore — failure means the
/// next play call will retry.
export async function unlockAudioContext(): Promise<void> {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* swallow — next play call will retry */
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Synth primitives. Each generator returns the time (in ctx time)
// at which the cue finishes — useful for chaining. All envelopes
// peak at -12 dBFS (max gain ≤ 0.25) so layering on top of speech
// or music doesn't clip.
// ─────────────────────────────────────────────────────────────────

interface ToneSpec {
  freq: number;
  /// Start offset relative to the play time (seconds).
  start: number;
  /// Total tone duration (seconds). Includes attack + hold + release.
  duration: number;
  /// Peak gain (0..1). Multiplied into the per-call volume + master.
  peak: number;
  /// Attack time (s). Default 0.005.
  attack?: number;
  /// Release time (s). Default 0.06.
  release?: number;
  /// Oscillator type. Default "sine".
  type?: OscillatorType;
  /// Glide-end frequency. When set, the oscillator slides from
  /// `freq` to `glideTo` over the tone's duration (linearly).
  glideTo?: number;
}

function scheduleTone(
  c: AudioContext,
  destination: AudioNode,
  spec: ToneSpec,
  perCallScale: number,
): number {
  const startAt = c.currentTime + spec.start;
  const endAt = startAt + spec.duration;
  const osc = c.createOscillator();
  osc.type = spec.type ?? "sine";
  osc.frequency.setValueAtTime(spec.freq, startAt);
  if (spec.glideTo !== undefined) {
    osc.frequency.linearRampToValueAtTime(spec.glideTo, endAt);
  }
  const gain = c.createGain();
  const peak = spec.peak * perCallScale;
  const attack = spec.attack ?? 0.005;
  const release = spec.release ?? 0.06;
  // ADSR — attack ramp up, hold near-flat, release ramp down. We
  // skip a true sustain phase because most cues are short enough
  // that attack + decay-to-floor is plenty.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.setValueAtTime(peak, Math.max(startAt + attack, endAt - release));
  gain.gain.linearRampToValueAtTime(0, endAt);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(startAt);
  osc.stop(endAt + 0.01);
  return endAt;
}

// Note: the previous pass had a `scheduleNoise` + `NoiseSpec` helper
// for filtered-noise crackle (used by streak-flame). The redesigned
// streak-flame is pentatonic tones now — no noise component — so
// both helpers are removed. Re-add them if a future cue needs noise.

// ─────────────────────────────────────────────────────────────────
// Cue catalog. Each function takes the context + a destination gain
// node + per-call scale; the master gain is wired upstream.
// ─────────────────────────────────────────────────────────────────

type CuePlayer = (
  c: AudioContext,
  dest: AudioNode,
  perCallScale: number,
) => void;

/// Design notes — second pass on the cue catalog.
///
/// The first version leaned on bright sine glissandos and a square-
/// wave streak tick that read as "notification klaxon." The user
/// asked for "a bit more childish and a bit more subtle and
/// professional" — so this pass:
///
/// 1. Lowers every peak gain to ≤ 0.13 (was 0.15–0.20). Combined with
///    the same master-volume slider, cues now sit at roughly half the
///    perceived loudness of the first pass.
/// 2. Uses pentatonic intervals (C–D–E–G–A) wherever the cue is more
///    than one note. Pentatonic note pairs have no minor 2nds or
///    tritones, so any two-note combination sounds "right" — that's
///    why glockenspiel / xylophone / music-box toys default to it.
///    Friendly, never clashy.
/// 3. Layers a soft octave overtone on every melodic cue (at ~40 % of
///    the fundamental's peak). The overtone gives a glockenspiel /
///    music-box brightness without needing brass or square-wave
///    timbres. Childish-but-tasteful.
/// 4. Slow attacks (8–15 ms instead of 1–6 ms) so no cue starts with
///    a transient "click." Releases extend 1.5–2× so notes ring out
///    longer than they ramp in, which reads as "warm" rather than
///    "blippy."
/// 5. Drops square + sawtooth + filtered-noise entirely. Sine +
///    triangle only — both natural-sounding waveforms with very low
///    harmonic content above the fundamental, so layered cues don't
///    fight each other in the high frequencies.
///
/// Every cue stays within the same SfxName union so the call sites
/// don't change.

/// Shared helper — adds a soft octave partial above a melodic
/// fundamental. Centralises the glockenspiel sparkle so each cue can
/// just call `glockTone(...)` instead of duplicating two scheduleTone
/// calls. The partial gain is 40% of the fundamental's peak — bright
/// enough to register, quiet enough not to compete.
function glockTone(
  c: AudioContext,
  dest: AudioNode,
  spec: ToneSpec,
  perCallScale: number,
): number {
  const end = scheduleTone(c, dest, spec, perCallScale);
  scheduleTone(
    c,
    dest,
    {
      ...spec,
      freq: spec.freq * 2,
      glideTo: spec.glideTo !== undefined ? spec.glideTo * 2 : undefined,
      peak: spec.peak * 0.4,
      type: spec.type ?? "sine",
    },
    perCallScale,
  );
  return end;
}

/// Partial since the recorded-pack-era cues (ui-open, page-turn, …)
/// have no bespoke synth generator — SYNTH_FALLBACK below maps them
/// onto a neighbouring cue for the no-asset edge case.
const CUES: Partial<Record<SfxName, CuePlayer>> = {
  /// UI tap — a single soft sine bell with an octave overtone. No
  /// glide; the cue is a "blip" not a "swoop" so the user reads it
  /// as a stable status indicator (clicked / dismissed / saved).
  ping(c, dest, s) {
    glockTone(c, dest, {
      freq: 1175, // D6 — sits clear above any background ambience
      start: 0,
      duration: 0.16,
      peak: 0.10,
      attack: 0.010,
      release: 0.12,
      type: "sine",
    }, s);
  },

  /// Bronze unlock — a two-note pentatonic descent (E6 → C6, a
  /// minor third in pentatonic terms). The fall reads as "a thing
  /// happened" without the "you did something incredible" intensity
  /// of the higher tiers.
  chime(c, dest, s) {
    glockTone(c, dest, {
      freq: 1319, // E6
      start: 0,
      duration: 0.28,
      peak: 0.11,
      attack: 0.012,
      release: 0.20,
      type: "sine",
    }, s);
    glockTone(c, dest, {
      freq: 1047, // C6
      start: 0.12,
      duration: 0.36,
      peak: 0.10,
      attack: 0.012,
      release: 0.26,
      type: "sine",
    }, s);
  },

  /// Silver unlock — a three-note pentatonic ascent (C5 → D5 → G5).
  /// Skips the major 3rd that would push it into "bright triumphant"
  /// territory; the C-D-G shape is the same one music-box toys play.
  success(c, dest, s) {
    const notes: Array<[number, number]> = [
      [523, 0.00], // C5
      [587, 0.12], // D5
      [784, 0.24], // G5
    ];
    notes.forEach(([f, t]) => {
      glockTone(c, dest, {
        freq: f,
        start: t,
        duration: 0.32,
        peak: 0.11,
        attack: 0.010,
        release: 0.22,
        type: "sine",
      }, s);
    });
  },

  /// Gold unlock — five-note pentatonic arpeggio (C–D–E–G–A) with a
  /// gentle low-octave drone underneath for warmth. Triangle on the
  /// arpeggio gives it a flute-ish edge without straying into brass.
  fanfare(c, dest, s) {
    const notes: Array<[number, number]> = [
      [523, 0.00], // C5
      [587, 0.12], // D5
      [659, 0.24], // E5
      [784, 0.36], // G5
      [880, 0.50], // A5
    ];
    notes.forEach(([f, t]) => {
      glockTone(c, dest, {
        freq: f,
        start: t,
        duration: 0.30,
        peak: 0.10,
        attack: 0.012,
        release: 0.22,
        type: "triangle",
      }, s);
    });
    // Pad — C3 + G3 perfect fifth. Sustained, very soft, fades in
    // gently so the arpeggio enters on top of an already-warm bed
    // rather than being chased by a drone.
    scheduleTone(c, dest, {
      freq: 131, // C3
      start: 0,
      duration: 1.20,
      peak: 0.06,
      attack: 0.18,
      release: 0.40,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 196, // G3
      start: 0.05,
      duration: 1.15,
      peak: 0.05,
      attack: 0.20,
      release: 0.40,
      type: "sine",
    }, s);
  },

  /// Platinum unlock — extended pentatonic run (C–D–E–G–A–C–D, two
  /// octaves) with a sparkle pad on the tonic+octave at the back
  /// half. Reads as "you did the rare thing" without resorting to
  /// fanfare-brass loudness.
  arpeggio(c, dest, s) {
    const notes = [523, 587, 659, 784, 880, 1047, 1175];
    notes.forEach((f, i) => {
      glockTone(c, dest, {
        freq: f,
        start: i * 0.09,
        duration: 0.28,
        peak: 0.10,
        attack: 0.010,
        release: 0.24,
        type: "sine",
      }, s);
    });
    // Tonic + octave sparkle, rings out as the arpeggio finishes.
    scheduleTone(c, dest, {
      freq: 523,
      start: 0.65,
      duration: 1.10,
      peak: 0.07,
      attack: 0.20,
      release: 0.50,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 1047,
      start: 0.65,
      duration: 1.10,
      peak: 0.05,
      attack: 0.20,
      release: 0.50,
      type: "sine",
    }, s);
  },

  /// Streak day flip — a soft single-tap "tock." Was a square wave
  /// in the previous pass, which read as a notification click on a
  /// cheap phone. Sine + octave partial keeps the tap character
  /// (very short duration) but warms the timbre.
  "streak-tick"(c, dest, s) {
    glockTone(c, dest, {
      freq: 988, // B5
      start: 0,
      duration: 0.10,
      peak: 0.09,
      attack: 0.005,
      release: 0.06,
      type: "sine",
    }, s);
  },

  /// Streak milestone — was a filtered-noise crackle + sawtooth
  /// pulse "fire" metaphor that the user flagged as too loud. The
  /// new shape: a two-note pentatonic chime (G5 → C6) underneath a
  /// gentle low pad (C3+G3). Friendlier than the noise crackle, but
  /// still distinct from a normal achievement chime — three layers
  /// of warmth give it weight without volume.
  "streak-flame"(c, dest, s) {
    glockTone(c, dest, {
      freq: 784, // G5
      start: 0,
      duration: 0.32,
      peak: 0.11,
      attack: 0.012,
      release: 0.24,
      type: "sine",
    }, s);
    glockTone(c, dest, {
      freq: 1047, // C6
      start: 0.14,
      duration: 0.42,
      peak: 0.10,
      attack: 0.012,
      release: 0.30,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 131, // C3 pad
      start: 0,
      duration: 0.80,
      peak: 0.06,
      attack: 0.15,
      release: 0.30,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 196, // G3 pad
      start: 0.05,
      duration: 0.75,
      peak: 0.04,
      attack: 0.15,
      release: 0.30,
      type: "sine",
    }, s);
  },

  /// XP per-lesson micro-cue — the most-fired sound in the app, so
  /// kept deliberately tiny: one short bell tap. No glide (a glide
  /// reads as motion / drama; a flat tap reads as confirmation).
  "xp-pop"(c, dest, s) {
    glockTone(c, dest, {
      freq: 1175, // D6
      start: 0,
      duration: 0.12,
      peak: 0.08,
      attack: 0.006,
      release: 0.08,
      type: "sine",
    }, s);
  },

  /// Level up — three-note pentatonic rise (C–G–C, fifth + octave)
  /// over a slow swelling pad. The interval choice avoids the
  /// brassy "trumpet flourish" of the previous fanfare-style
  /// version; reads as "ascending" without being loud.
  "level-up"(c, dest, s) {
    const notes: Array<[number, number]> = [
      [523, 0.00], // C5
      [784, 0.16], // G5
      [1047, 0.32], // C6
    ];
    notes.forEach(([f, t]) => {
      glockTone(c, dest, {
        freq: f,
        start: t,
        duration: 0.40,
        peak: 0.11,
        attack: 0.012,
        release: 0.28,
        type: "sine",
      }, s);
    });
    // Slow pad swell — C3 + G3 + C4 — fades in over the first 400ms
    // so the trio lands on top of a warm bed instead of cold air.
    scheduleTone(c, dest, {
      freq: 131,
      start: 0,
      duration: 1.10,
      peak: 0.06,
      attack: 0.30,
      release: 0.40,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 196,
      start: 0.05,
      duration: 1.05,
      peak: 0.05,
      attack: 0.30,
      release: 0.40,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 262,
      start: 0.10,
      duration: 1.00,
      peak: 0.04,
      attack: 0.30,
      release: 0.40,
      type: "sine",
    }, s);
  },

  /// Chapter end — three-note pentatonic DESCENT (G5 → E5 → C5).
  /// Descending shape = "settling / resolving" so the cue reads as
  /// "section closed" rather than "next thing started."
  "complete-section"(c, dest, s) {
    const notes: Array<[number, number]> = [
      [784, 0.00], // G5
      [659, 0.16], // E5
      [523, 0.32], // C5
    ];
    notes.forEach(([f, t]) => {
      glockTone(c, dest, {
        freq: f,
        start: t,
        duration: 0.40,
        peak: 0.10,
        attack: 0.012,
        release: 0.28,
        type: "sine",
      }, s);
    });
  },

  /// Book end — full pentatonic motif (C–D–E–G–A) into a sustained
  /// C-major-9 pad (C–E–G–D) for the celebration tail. Subdued
  /// loudness, but two extra phases of layered warmth so the moment
  /// still feels like a wrap.
  "complete-book"(c, dest, s) {
    // Phase 1: rising pentatonic line.
    const notes: Array<[number, number]> = [
      [523, 0.00], // C5
      [587, 0.12], // D5
      [659, 0.24], // E5
      [784, 0.36], // G5
      [880, 0.50], // A5
    ];
    notes.forEach(([f, t]) => {
      glockTone(c, dest, {
        freq: f,
        start: t,
        duration: 0.32,
        peak: 0.10,
        attack: 0.012,
        release: 0.22,
        type: "sine",
      }, s);
    });
    // Phase 2: sustained Cmaj9 pad (C3 + E3 + G3 + D4) — fades in
    // softly during the arpeggio, rings out after.
    [
      [131, 0.07], // C3
      [165, 0.07], // E3
      [196, 0.06], // G3
      [294, 0.05], // D4
    ].forEach(([f, peak]) => {
      scheduleTone(c, dest, {
        freq: f,
        start: 0.20,
        duration: 1.80,
        peak,
        attack: 0.40,
        release: 0.60,
        type: "sine",
      }, s);
    });
    // Phase 3: final tonic + octave sparkle.
    glockTone(c, dest, {
      freq: 1047,
      start: 1.40,
      duration: 0.60,
      peak: 0.08,
      attack: 0.020,
      release: 0.40,
      type: "sine",
    }, s);
  },

  /// Streak freeze — a soft crystalline shimmer. Two high octave
  /// partials over a slow upward glide; reads as "ice / shield"
  /// without the previous version's brittle high partial peak.
  freeze(c, dest, s) {
    scheduleTone(c, dest, {
      freq: 880, // A5
      glideTo: 1760, // A6
      start: 0,
      duration: 0.70,
      peak: 0.09,
      attack: 0.040,
      release: 0.30,
      type: "sine",
    }, s);
    scheduleTone(c, dest, {
      freq: 1760, // A6
      glideTo: 2349, // D7
      start: 0.10,
      duration: 0.50,
      peak: 0.05,
      attack: 0.030,
      release: 0.30,
      type: "sine",
    }, s);
  },

  /// Wrong answer / run failed — a soft, low descending two-note.
  /// Deliberately NOT a glockTone (no octave sparkle, which reads as
  /// "good thing"): a muted triangle with a small downward inflection
  /// + a quiet low partial for weight. Quietest cue in the set
  /// (peak ≤ 0.08) — it should say "not quite, try again," never
  /// scold. The house "childish but subtle" voice, on the minor side.
  nope(c, dest, s) {
    scheduleTone(c, dest, {
      freq: 392, // G4
      glideTo: 349, // F4 — gentle downward bend
      start: 0,
      duration: 0.20,
      peak: 0.08,
      attack: 0.008,
      release: 0.14,
      type: "triangle",
    }, s);
    scheduleTone(c, dest, {
      freq: 294, // D4 — soft low body
      start: 0.05,
      duration: 0.22,
      peak: 0.05,
      attack: 0.010,
      release: 0.16,
      type: "sine",
    }, s);
  },
};

/// Synth stand-ins for cues that only exist in the recorded pack.
/// Only heard in the rare no-asset window (cold boot before the
/// pack decodes, or a failed fetch).
const SYNTH_FALLBACK: Partial<Record<SfxName, SfxName>> = {
  "ui-open": "ping",
  notify: "chime",
  "page-turn": "ping",
  stamp: "xp-pop",
  coin: "xp-pop",
  "boot-up": "streak-tick",
  "flame-out": "nope",
};

// ── Recorded pack loading ────────────────────────────────────────
// MP3s live at <BASE_URL>sfx/<cue>.mp3 (public/sfx in the repo).
// BASE_URL makes the same path work on desktop ("/sfx/…") and the
// /learn/-prefixed web deploy. Decoding happens against the shared
// (possibly still-suspended) AudioContext — allowed by the Web
// Audio spec, so the pack can warm fully before any user gesture.

/// Recorded renditions are full-scale where the synth peaks were
/// kept ≤0.13 — this trim keeps the pack polite at the same master
/// volume users already have set.
const ASSET_GAIN = 0.8;

/// null = fetch/decode failed (synth fallback permanently this
/// session); absent = not requested yet.
const assetBuffers = new Map<SfxName, AudioBuffer | null>();
const assetLoading = new Set<SfxName>();

function assetUrl(name: SfxName): string {
  const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
  return `${base}/sfx/${name}.mp3`;
}

function loadAsset(name: SfxName): void {
  if (assetBuffers.has(name) || assetLoading.has(name)) return;
  const c = ensureContext();
  if (!c) return;
  assetLoading.add(name);
  fetch(assetUrl(name))
    .then((r) =>
      r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)),
    )
    .then((raw) => c.decodeAudioData(raw))
    .then((decoded) => {
      assetBuffers.set(name, decoded);
    })
    .catch(() => {
      assetBuffers.set(name, null);
    })
    .finally(() => {
      assetLoading.delete(name);
    });
}

/// Fire a sound-effect cue. Plays the recorded rendition when its
/// buffer is ready, else the synth fallback (and warms the asset for
/// next time). Resumes the AudioContext if suspended.
/// Never throws — sound is decorative and a failure here should
/// never break the page.
export function playSound(name: SfxName, opts: PlayOptions = {}): void {
  const settings = settingsCache;
  if (!settings.enabled && !opts.ignoreMute) return;
  if (settings.volume <= 0 && !opts.ignoreMute) return;
  // Per-cue throttle — collapse rapid repeats of the same cue. The
  // settings "test" buttons pass ignoreMute and bypass this so
  // repeated previews always play.
  if (!opts.ignoreMute) {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = lastFiredAt.get(name) ?? Number.NEGATIVE_INFINITY;
    if (now - last < (opts.cooldownMs ?? DEFAULT_COOLDOWN_MS)) return;
    lastFiredAt.set(name, now);
  }
  const c = ensureContext();
  if (!c || !masterGain) return;
  // Browsers suspend the context when there's been no user
  // interaction. Resume non-blocking; the cue itself fires regardless
  // since `start(future)` queues onto the timeline either way.
  if (c.state === "suspended") {
    void c.resume().catch(() => undefined);
  }
  const scale = opts.volume === undefined ? 1 : Math.max(0, Math.min(1, opts.volume));
  // Recorded rendition first.
  const buf = assetBuffers.get(name);
  if (buf) {
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.setValueAtTime(ASSET_GAIN * scale, c.currentTime);
      src.connect(g);
      g.connect(masterGain);
      src.start();
      return;
    } catch {
      // Fall through to the synth path below.
    }
  }
  // Not loaded yet (or never requested) — warm it so the NEXT play
  // is recorded, and cover this one with the synth.
  if (buf === undefined) loadAsset(name);
  const cue = CUES[name] ?? CUES[SYNTH_FALLBACK[name] ?? "ping"];
  if (!cue) return;
  try {
    cue(c, masterGain, scale);
  } catch {
    // Audio context can occasionally throw under unusual conditions
    // (e.g. running out of voices). Silently swallow — sound is
    // optional decoration.
  }
}

/// All cues, in display order. Used by the settings pane's "Test
/// each sound" row.
export const ALL_SFX: SfxName[] = [
  "ping",
  "chime",
  "success",
  "fanfare",
  "arpeggio",
  "level-up",
  "xp-pop",
  "streak-tick",
  "streak-flame",
  "complete-section",
  "complete-book",
  "freeze",
  "nope",
  "ui-open",
  "notify",
  "page-turn",
  "stamp",
  "coin",
  "boot-up",
  "flame-out",
];

/// Friendly labels for the settings pane.
export const SFX_LABELS: Record<SfxName, string> = {
  ping: "Ping (UI tap)",
  chime: "Chime (bronze unlock)",
  success: "Success (silver unlock)",
  fanfare: "Fanfare (gold unlock)",
  arpeggio: "Arpeggio (platinum unlock)",
  "level-up": "Level up",
  "xp-pop": "XP pop (lesson complete)",
  "streak-tick": "Streak tick (day flip)",
  "streak-flame": "Streak milestone",
  "complete-section": "Section complete",
  "complete-book": "Book complete",
  freeze: "Streak freeze used",
  nope: "Nope (wrong answer)",
  "ui-open": "Panel / modal open",
  notify: "Notification",
  "page-turn": "Lesson page turn",
  stamp: "Certificate stamped",
  coin: "Coins gained",
  "boot-up": "Run started",
  "flame-out": "Streak lost",
};

// ── Pack warm-up ─────────────────────────────────────────────────
// Kick the whole pack's fetch+decode shortly after boot (staggered,
// off the critical path) so the first real cue of the session plays
// the recorded rendition rather than the synth stand-in. ~560 KB
// total; decoding works on a suspended context, so no user gesture
// is needed before warming.
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    ALL_SFX.forEach((name, i) => {
      window.setTimeout(() => loadAsset(name), i * 120);
    });
  }, 3500);
}
