/// Tour-narration playback hook. Singleton HTMLAudioElement, one
/// MP3 per tour step, looked up by step id. Simpler than
/// `useLessonAudio` because:
///   - tours never section-split (each step's narration is short
///     enough that a single MP3 is fine);
///   - the manifest is tiny + bundled with the app under
///     `public/tour-audio/manifest.json`, so it loads from the
///     same origin without a network round-trip on first launch;
///   - there's no cumulative-progress maths — each step has its
///     own progress 0..1, surfaced for the tooltip's audio bar.
///
/// Auto-advance: when a step's audio finishes, `done` flips to
/// true. The Tour component watches `done` and calls its `next()`
/// — that's how the narration drives the through-line of the tour
/// without the user having to click Next.
///
/// Mute / pause behaviour: pausing leaves `done` false and the
/// audio element paused at its current position. Re-playing
/// resumes from where it left off. If the user advances manually
/// (click Next), the previous step's audio is canceled — the
/// `stepId` change unloads it.

import { useEffect, useRef, useState } from "react";

interface TourManifestEntry {
  url: string;
  durationSec?: number;
  textHash: string;
}

interface TourManifest {
  tour_id: string;
  voice: string;
  model: string;
  generatedAt: string;
  steps: Record<string, TourManifestEntry>;
}

/// Where the bundled tour manifest lives. Vite copies `public/`
/// straight into the output, so the file ends up at
/// `<base>/tour-audio/manifest.json`. We compose the URL from
/// Vite's `import.meta.env.BASE_URL` (which is `/` for the
/// desktop / Tauri build and `/learn/` for the libre.academy
/// embed) so the same code works under every base path.
/// Hardcoding the root-absolute `/tour-audio/manifest.json`
/// previously made the embed surface fall through to the
/// marketing site's SPA fallback (`try_files /index.html`),
/// which returns the academy homepage's HTML — the hook then
/// sees `Content-Type: text/html`,
/// the JSON parse guard rejects, and tour audio silently fails.
///
/// `BASE_URL` always ends with a `/`, so concatenating without a
/// leading slash on the suffix yields a clean path.
const MANIFEST_URL = `${import.meta.env.BASE_URL}tour-audio/manifest.json`;

/// Per-step MP3 URLs in the manifest are root-absolute (`/tour-
/// audio/<id>.<sha7>.mp3`) — same trap as the manifest path. We
/// rewrite them to be base-relative as the manifest lands so every
/// downstream `<audio>.src = entry.url` Just Works under any base
/// path. Idempotent — a URL that already starts with `<base>` is
/// left alone, as is anything off-origin (http(s)://...).
function rewriteEntryUrl(url: string): string {
  if (!url) return url;
  // Off-origin (CDN) URLs pass through. The manifest hasn't
  // historically used these, but the rewrite stays defensive so
  // a future "host audio on a separate CDN" migration doesn't
  // need to revisit this code.
  if (/^[a-z]+:\/\//i.test(url)) return url;
  const base = import.meta.env.BASE_URL ?? "/";
  if (url.startsWith(base)) return url;
  // Strip any leading slash so the join is clean (BASE_URL always
  // ends with a slash).
  return base + url.replace(/^\//, "");
}

let manifest: TourManifest | null = null;
let manifestPromise: Promise<TourManifest | null> | null = null;

async function fetchManifest(): Promise<TourManifest | null> {
  if (manifest) return manifest;
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const r = await fetch(MANIFEST_URL, { cache: "no-cache" });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.toLowerCase().includes("json")) return null;
      const json = (await r.json()) as TourManifest;
      // Rewrite per-step URLs so they resolve under the current
      // base path (see `rewriteEntryUrl` for the full rationale).
      // Done once at manifest-load time so the rest of the hook
      // can treat URLs as opaque.
      if (json.steps) {
        for (const step of Object.values(json.steps)) {
          if (step && typeof step.url === "string") {
            step.url = rewriteEntryUrl(step.url);
          }
        }
      }
      manifest = json;
      return json;
    } catch {
      return null;
    }
  })();
  const result = await manifestPromise;
  if (!result) manifestPromise = null;
  return result;
}

/// Singleton. Same pattern as `useLessonAudio`'s singleton, kept
/// separate so playing tour audio doesn't interrupt lesson audio
/// state machine and vice versa. (We DO pause the lesson
/// player when the tour starts — that happens in App.tsx where
/// both hooks are accessible.)
let audioEl: HTMLAudioElement | null = null;
let activeStepId: string | null = null;
let stepDone = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* swallow */
    }
  }
}

function ensureAudioEl(): HTMLAudioElement {
  if (audioEl) return audioEl;
  audioEl = document.createElement("audio");
  audioEl.preload = "auto";
  for (const ev of ["play", "pause", "loadedmetadata", "timeupdate", "error"]) {
    audioEl.addEventListener(ev, notify);
  }
  audioEl.addEventListener("ended", () => {
    stepDone = true;
    notify();
  });
  return audioEl;
}

/// Stop the singleton and forget the active step. Idempotent;
/// safe to call when nothing is playing. Used by the Tour
/// component when the tour deactivates (skip / finish).
export function stopTourAudio(): void {
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
  activeStepId = null;
  stepDone = false;
  notify();
}

interface UseTourAudioOpts {
  /// Step id whose MP3 to load + (optionally) play. Pass `null` to
  /// idle the singleton without unloading it — useful between tour
  /// activations.
  stepId: string | null;
  /// Whether the loaded step should auto-play on mount / change.
  /// The Tour component flips this off when the user mutes.
  autoPlay: boolean;
}

interface UseTourAudioResult {
  /// True iff the manifest loaded AND has an entry for the current
  /// step id. False forces the Tour to behave as if there's no
  /// audio (no auto-advance, no progress bar) — same fallback as
  /// when the manifest fails to fetch.
  available: boolean;
  isPlaying: boolean;
  /// 0..1 progress through the current step's MP3. Drives the thin
  /// audio-progress bar layered on top of the step-progress bar.
  progress: number;
  /// One-shot flag flipped true on `ended`. Resets to false when
  /// the step id changes.
  done: boolean;
  play: () => void;
  pause: () => void;
}

export function useTourAudio(opts: UseTourAudioOpts): UseTourAudioResult {
  const { stepId, autoPlay } = opts;
  const [, setTick] = useState(0);
  const tickRef = useRef(0);
  const [m, setM] = useState<TourManifest | null>(manifest);

  useEffect(() => {
    if (!m) {
      let cancelled = false;
      void fetchManifest().then((res) => {
        if (!cancelled) setM(res);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [m]);

  useEffect(() => {
    const cb = () => {
      tickRef.current += 1;
      setTick(tickRef.current);
    };
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  // Step transition. Loading the new MP3 happens in this effect
  // (not in `play`) so the audio element starts fetching the
  // moment the step appears, even if the user has muted — that
  // way unmuting later resumes from a buffered state instead of
  // staring at a loading spinner.
  useEffect(() => {
    if (!stepId || !m) return;
    const entry = m.steps[stepId];
    if (!entry) return;
    const a = ensureAudioEl();
    if (activeStepId !== stepId) {
      a.src = entry.url;
      activeStepId = stepId;
      stepDone = false;
      // `notify` so subscribers re-render on the stepId change
      // even if no audio event has fired yet.
      notify();
    }
    if (autoPlay) {
      // play() returns a promise that rejects if autoplay is
      // blocked (Safari, low-volume contexts). Catch + ignore —
      // the user can still click the play button to start it
      // manually.
      void a.play().catch(() => undefined);
    } else {
      a.pause();
    }
  }, [stepId, autoPlay, m]);

  const entry = m && stepId ? m.steps[stepId] : null;
  const available = !!entry;
  const el = audioEl;
  const isPlaying = !!el && activeStepId === stepId && !el.paused && !el.ended;
  const liveDuration =
    el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
  const duration = liveDuration ?? entry?.durationSec ?? null;
  const currentSec =
    el && activeStepId === stepId ? el.currentTime : 0;
  const progress =
    duration && duration > 0
      ? Math.max(0, Math.min(1, currentSec / duration))
      : 0;

  return {
    available,
    isPlaying,
    progress,
    done: stepDone && activeStepId === stepId,
    play: () => {
      if (!entry) return;
      const a = ensureAudioEl();
      if (activeStepId !== stepId) {
        a.src = entry.url;
        activeStepId = stepId;
        stepDone = false;
      }
      void a.play().catch(() => undefined);
    },
    pause: () => {
      if (audioEl && activeStepId === stepId) audioEl.pause();
    },
  };
}
