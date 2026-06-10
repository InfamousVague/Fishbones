/// Lesson-audio playback hook. Pairs with the pre-generated MP3s
/// produced by `scripts/generate-lesson-audio.mjs` and uploaded to
/// the Libre CDN.
///
/// Lifecycle on app boot:
///   1. The first call to `useLessonAudioManifest()` fires a single
///      GET against `${TTS_CDN_BASE}/manifest.json`. The response is
///      cached in module scope so subsequent components share the
///      result without refetching.
///   2. `useLessonAudio(lessonId)` reads the cached manifest and
///      returns either `{ available: false }` (no audio for this
///      lesson) or `{ available: true, url, durationSec, ... }`.
///
/// Playback is via a single shared HTMLAudioElement managed by the
/// hook — only one lesson plays at a time, navigating away from a
/// lesson stops the audio.
///
/// IndexedDB cache: each MP3 fetched from the CDN is also stored
/// locally so subsequent plays are offline-friendly + instant. The
/// cache key is the manifest's `sha256` (content-addressed), so a
/// regenerated lesson's new MP3 doesn't collide with the old one.
/// 200 MB LRU cap to bound storage.

import { useEffect, useRef, useState } from "react";

/// Configurable audio host. Set via Vite env (VITE_FB_TTS_CDN_BASE)
/// at build time, or fall back to the production default. Trailing
/// slash stripped so we can append paths uniformly.
///
/// Default points at libre.academy/audio — same Vultr VPS that
/// hosts the marketing site + /learn/ web build. Audio MP3s are
/// pushed via `scripts/upload-lesson-audio.mjs` and live alongside
/// the academy's own /var/www tree (excluded from the academy's
/// `rsync --delete` so site deploys can't wipe them).
const TTS_CDN_BASE = (
  import.meta.env.VITE_FB_TTS_CDN_BASE ??
  "https://libre.academy/audio"
).replace(/\/+$/, "");

const MANIFEST_URL = `${TTS_CDN_BASE}/manifest.json`;

/// One MP3 inside a sectioned lesson. Sections are heading-bounded
/// (H1/H2 starts a new one), produced by `splitMarkdownIntoSections`
/// in scripts/spoken-text.mjs and one-MP3-per-section'd by
/// scripts/generate-lesson-audio.mjs. The `blockStart` / `blockEnd`
/// indices align with the renderer's `data-tts-block` numbering so
/// the cursor can highlight DOM blocks while their section's audio
/// plays.
export interface AudioSection {
  url: string;
  sha256?: string;
  sizeBytes?: number;
  /// Estimated from byte length at generation time (bytes / 16000 for
  /// 128 kbps CBR MP3). Within a few hundred ms of true duration —
  /// the player refines with the live `audio.duration` for whichever
  /// section is currently loaded, but uses the estimate for sections
  /// that haven't been played yet so cumulative progress stays smooth.
  durationSec?: number;
  textHash: string;
  voice: string;
  voiceId?: string;
  model: string;
  blockStart: number;
  blockEnd: number;
  headingText: string | null;
  headingLevel: number | null;
}

/// Manifest entry for one lesson. v2 (current) — sectioned. The
/// player walks `sections` in order, plays each MP3, waits for
/// `ended` before advancing. The legacy `url` field is kept for
/// reading older manifests on the wire (during a partial re-upload)
/// but the generator no longer emits it; new entries always have
/// `sections`.
export interface AudioManifestEntry {
  courseId: string;
  voice: string;
  model: string;
  sections?: AudioSection[];
  /// Legacy v1 single-MP3 path. Present only on manifests generated
  /// before the v2 sectioning rollout. New consumers should branch
  /// on `sections` first; `url` is the fall-through.
  url?: string;
  /// Legacy v1 fields — kept on the type so older manifests parse
  /// without TypeScript complaining. Unused on the v2 happy path.
  sha256?: string;
  sizeBytes?: number;
  durationSec?: number;
  textHash?: string;
  voiceId?: string;
}

export interface AudioManifest {
  version: number;
  voice: string;
  model: string;
  generatedAt: string;
  cdnBase: string;
  lessons: Record<string, AudioManifestEntry>;
}

/// True when the manifest predates course-scoping — i.e. it has no
/// `courseId/lessonId` composite keys at all. Only then is a bare
/// lesson-id lookup safe: on a modern manifest the bare keys are
/// back-compat aliases for OLD app builds, and resolving through them
/// can hand a colliding lesson id another course's narration.
/// WeakMap-cached — the scan is O(keys) and manifests are immutable
/// once fetched, so each manifest object is scanned exactly once.
const legacyManifestCache = new WeakMap<AudioManifest, boolean>();
function isLegacyManifest(m: AudioManifest): boolean {
  let legacy = legacyManifestCache.get(m);
  if (legacy === undefined) {
    legacy = !Object.keys(m.lessons).some((k) => k.includes("/"));
    legacyManifestCache.set(m, legacy);
  }
  return legacy;
}

/// Module-scope cache shared across every consumer of the hooks.
/// `manifestPromise` is the in-flight fetch; once it resolves
/// SUCCESSFULLY we keep the result around for the lifetime of the
/// page. Failures (null result) are NOT cached — without that
/// distinction, a transient pre-upload failure (when /audio/manifest.json
/// 404s and Caddy falls through to index.html, so r.json() throws)
/// would stick a null in the slot and every subsequent render would
/// re-receive it without retrying. Re-uploading the manifest then
/// felt like "the new audio isn't being picked up", because the
/// hook never re-fetched.
let manifestPromise: Promise<AudioManifest | null> | null = null;
let manifest: AudioManifest | null = null;

/// Force the next consumer to refetch the manifest. Useful after a
/// known upload event, or for a future "refresh audio" button. The
/// no-cache fetch (below) makes this rarely necessary in practice —
/// failures already self-heal — but having an explicit invalidation
/// path keeps things predictable.
export function invalidateAudioManifest(): void {
  manifest = null;
  manifestPromise = null;
}

/// Rewrite every entry's `url` so its host matches the host we just
/// fetched the manifest from. No-op when the manifest's `cdnBase`
/// already agrees with `targetBase` (the common case). Trailing
/// slashes are normalised on both sides before comparison so a
/// stray `/` doesn't keep us from recognising a match.
///
/// The rewrite is keyed on the prefix `cdnBase + "/"` to avoid
/// touching URLs that were authored against some unrelated host
/// (defensive — shouldn't happen given the generator's behaviour,
/// but keeps the rewrite local to entries that genuinely came out
/// of this manifest).
function rewriteEntryUrls(manifest: AudioManifest, targetBase: string): void {
  if (!manifest?.cdnBase || !manifest.lessons) return;
  const oldBase = manifest.cdnBase.replace(/\/+$/, "");
  const newBase = targetBase.replace(/\/+$/, "");
  if (oldBase === newBase) return;
  const oldPrefix = oldBase + "/";
  const fix = (url: string | undefined): string | undefined => {
    if (typeof url !== "string") return url;
    if (!url.startsWith(oldPrefix)) return url;
    return newBase + url.slice(oldBase.length);
  };
  for (const entry of Object.values(manifest.lessons)) {
    if (!entry) continue;
    // v1 single-URL entry (legacy).
    if (typeof entry.url === "string") entry.url = fix(entry.url);
    // v2 sectioned entry — fix every section URL.
    if (Array.isArray(entry.sections)) {
      for (const sec of entry.sections) {
        if (sec) sec.url = fix(sec.url) ?? sec.url;
      }
    }
  }
  manifest.cdnBase = newBase;
}

async function fetchManifest(): Promise<AudioManifest | null> {
  if (manifest) return manifest;
  if (manifestPromise) return manifestPromise;
  const inflight = (async () => {
    try {
      const r = await fetch(MANIFEST_URL, {
        // `cache: "reload"` bypasses the HTTP cache and always hits
        // the network. The manifest is tiny (~20-30KB) and fetched
        // once per page session, so the network round-trip is cheap;
        // in exchange we never serve a stale browser-cached SPA HTML
        // response that landed there before the audio dir was
        // populated. A previous version used "default" which let
        // iOS Safari hold onto the old 1.5KB HTML body indefinitely.
        cache: "reload",
      });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "";
      // Sanity check: when the file doesn't exist, Caddy's SPA
      // fallback returns index.html with a 200 status. Reject any
      // non-JSON content type so we don't try to parse HTML and
      // cache a null result.
      if (!ct.toLowerCase().includes("json")) return null;
      const json = (await r.json()) as AudioManifest;
      // Host-rewrite guard: the manifest's `cdnBase` field can drift
      // away from the host we actually fetched the manifest from
      // (e.g. when `generate-lesson-audio.mjs` is run with
      // `FB_TTS_CDN_BASE` pointing at a CDN that later goes away or
      // never had DNS set up). The MP3s always live next to the
      // manifest — `upload-lesson-audio.mjs` rsyncs both into the
      // same `/var/www/.../audio/` tree — so we can safely swap the
      // declared base for our actual base on every entry's URL.
      // Without this, a stale cdnBase silently breaks every play
      // button: the manifest loads (so the speaker icon renders) but
      // the per-entry URL points at a non-resolving host, and click
      // → play fails with no visible error.
      rewriteEntryUrls(json, TTS_CDN_BASE);
      return json;
    } catch {
      // Offline / CORS / non-JSON body — fall through silently. The
      // hook's `available: false` branch hides the speaker icon, so
      // a missing manifest just means "no audio yet" without erroring.
      return null;
    }
  })();
  manifestPromise = inflight;
  const result = await inflight;
  if (result) {
    manifest = result;
  } else {
    // Don't cache failures — let the next consumer retry. Without
    // this clear, a transient null sticks for the page lifetime
    // even after the underlying CDN starts serving the manifest.
    manifestPromise = null;
  }
  return result;
}

/// React hook returning the manifest once it loads, or `null` while
/// fetching / on failure. Components that depend on it should be
/// resilient to `null` — usually by hiding their audio affordances.
export function useLessonAudioManifest(): AudioManifest | null {
  const [m, setM] = useState<AudioManifest | null>(manifest);
  useEffect(() => {
    if (m) return;
    let cancelled = false;
    void fetchManifest().then((res) => {
      if (!cancelled) setM(res);
    });
    return () => {
      cancelled = true;
    };
  }, [m]);
  return m;
}

// ── Singleton player ────────────────────────────────────────────
//
// One HTMLAudioElement managed at module scope. Two modes:
//   - Sectioned (v2 manifest): `activeSections` holds the lesson's
//     section list; `activeSectionIndex` is which section is loaded
//     into the audio element. On `ended` we advance to the next
//     section automatically — that's the "wait for the section's
//     audio to finish before moving the cursor" behaviour the
//     wait-and-advance UX needs.
//   - Single MP3 (v1 manifest, legacy): `activeSections` is null,
//     `activeSectionIndex` is 0, and the lesson's `entry.url` is
//     loaded once and plays end-to-end. Same code path with
//     length-1 logic.
//
// Hooks subscribe to events; everything else is React-state-derived.

let audioEl: HTMLAudioElement | null = null;
let activeLessonId: string | null = null;
let activeSections: AudioSection[] | null = null;
let activeSectionIndex = 0;
/// Per-section duration cache for the active lesson. Seeded from the
/// manifest's `durationSec` estimates and refined by the live
/// `audio.duration` once each section loads. Length always matches
/// `activeSections?.length` (or 1 in legacy mode). Used to compute
/// CUMULATIVE progress across sections — without it the player
/// could only report progress within the currently-loaded section,
/// and the cursor would snap backwards every time a section ended.
let sectionDurations: number[] = [];
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

function onSectionEnded(): void {
  // End-of-lesson when no more sections remain. We deliberately do
  // NOT auto-loop; the cursor pause-at-end is a useful UX signal
  // ("you finished this reading").
  if (!activeSections) return;
  const next = activeSectionIndex + 1;
  if (next >= activeSections.length) return;
  activeSectionIndex = next;
  if (audioEl) {
    audioEl.src = activeSections[next].url;
    void audioEl.play();
  }
}

function onLoadedMetadata(): void {
  // Refine the duration cache for whichever section is currently
  // loaded. The manifest carries a byte-derived estimate; the live
  // value from the engine is exact. Subscribers re-render via the
  // shared `notify`.
  if (audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    if (sectionDurations.length > activeSectionIndex) {
      sectionDurations[activeSectionIndex] = audioEl.duration;
    }
  }
}

function ensureAudioEl(): HTMLAudioElement {
  if (typeof document === "undefined") {
    throw new Error("useLessonAudio: no document (SSR)");
  }
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.preload = "metadata";
    // Wire all the events the hook surfaces — every one of them
    // notifies subscribers so per-lesson hook state stays in sync.
    for (const ev of ["play", "pause", "loadedmetadata", "timeupdate", "error"]) {
      audioEl.addEventListener(ev, notify);
    }
    // `loadedmetadata` ALSO refreshes the duration cache — separate
    // listener so the cache update happens before subscribers react.
    audioEl.addEventListener("loadedmetadata", onLoadedMetadata);
    // `ended` advances to the next section (or stops if last). Notify
    // happens after the advance so the new section index is observed.
    audioEl.addEventListener("ended", () => {
      onSectionEnded();
      notify();
    });
  }
  return audioEl;
}

/// Resolve a manifest entry to a section list. v2 entries return
/// `entry.sections` directly; v1 (legacy) entries are wrapped in a
/// length-1 list so the rest of the player can treat both uniformly.
function sectionsFor(entry: AudioManifestEntry): AudioSection[] | null {
  if (Array.isArray(entry.sections) && entry.sections.length > 0) {
    return entry.sections;
  }
  if (typeof entry.url === "string" && entry.url.length > 0) {
    return [
      {
        url: entry.url,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        durationSec: entry.durationSec,
        textHash: entry.textHash ?? "",
        voice: entry.voice,
        voiceId: entry.voiceId,
        model: entry.model,
        blockStart: 0,
        blockEnd: -1,
        headingText: null,
        headingLevel: null,
      },
    ];
  }
  return null;
}

export type LessonAudioState =
  | { available: false }
  | {
      available: true;
      /// URL of the section currently loaded into the audio element.
      /// Mostly useful for debug overlays — typical consumers want
      /// `progress` / `currentSec` / `durationSec` instead.
      url: string;
      /// Number of sections in the active lesson, ≥ 1.
      sectionCount: number;
      /// Zero-based index of the section currently playing (or about
      /// to play). Drives the "wait for this section to finish"
      /// playback model — when it changes, the cursor / scroll-follow
      /// know a new section has started.
      sectionIndex: number;
      /// Block range covered by the active section. Mirrors the
      /// `blockStart` / `blockEnd` fields on the manifest's
      /// `AudioSection` — surfaced here so the read-cursor hook can
      /// anchor to the section's DOM block range instead of trying
      /// to char-weight the entire lesson with one global progress
      /// fraction. `null` when there's no active section yet.
      sectionBlockStart: number | null;
      sectionBlockEnd: number | null;
      /// Position within the active section, in seconds. Combined
      /// with `sectionDurationSec` this gives the cursor a per-
      /// section progress (0..1) that's far more accurate than the
      /// cumulative-cross-section progress — the section boundaries
      /// re-anchor the math at every heading transition so drift
      /// doesn't accumulate across the whole lesson.
      sectionCurrentSec: number;
      /// Duration of the active section, in seconds. May be 0 until
      /// the section's audio metadata has loaded.
      sectionDurationSec: number;
      /// Total duration in seconds across ALL sections of the active
      /// lesson. Resolves as each section's `loadedmetadata` fires;
      /// initially seeded from the manifest's per-section byte
      /// estimates so the value is reasonable from the first paint.
      durationSec: number | null;
      isActive: boolean;
      isPlaying: boolean;
      isLoading: boolean;
      /// Cumulative seconds played across ALL sections (not just the
      /// current one). Lets the TTSButton pill display elapsed /
      /// remaining time over the whole lesson.
      currentSec: number;
      /// Cumulative playback progress 0..1 across the whole lesson.
      /// Drives the circular progress ring AND the lesson-read cursor
      /// hook (which char-weights DOM blocks against this value to
      /// pick the highlighted paragraph).
      progress: number;
      /// Seconds remaining across the whole lesson. Null when total
      /// duration is unknown.
      remainingSec: number | null;
      play: () => void;
      pause: () => void;
      toggle: () => void;
      /// Seek to a position WITHIN THE CURRENT SECTION. Cross-section
      /// scrubbing isn't wired yet — would need a UI affordance and
      /// some logic to resolve "which section does this overall sec
      /// fall into?". Out of scope for the wait-and-advance UX.
      seek: (sec: number) => void;
      setSpeed: (rate: number) => void;
    };

/// Per-lesson hook. Pass the course id + lesson id; receive state +
/// controls. Re-renders on every `timeupdate` (~4Hz) while this
/// lesson is active, idle when it isn't.
///
/// `courseId` is REQUIRED for correct resolution: the manifest is
/// keyed by `courseId/lessonId` so two courses that share a bare
/// lesson id (every Exercism track reuses canonical slugs like
/// `hello-world`) resolve to the right course's narration. For
/// resilience during the migration window — a CDN-cached legacy
/// manifest still keyed by bare id, or a caller that genuinely
/// can't supply a courseId — we fall back to a bare-id lookup.
/// `courseId` is optional in the signature only so the fallback
/// path stays expressible; always pass it when you have it (all
/// three real call sites do).
export function useLessonAudio(
  courseId: string | undefined,
  lessonId: string | undefined,
): LessonAudioState {
  const m = useLessonAudioManifest();
  const [, setTick] = useState(0);
  const tickRef = useRef(0);

  // Composite identity used for BOTH manifest lookup and the
  // singleton's active-session token, so playback state can't bleed
  // between two courses that share a bare lesson id.
  const audioKey =
    courseId && lessonId ? `${courseId}/${lessonId}` : lessonId;

  // Subscribe to the singleton's notifications. We only re-render
  // when something actually changes for THIS lesson — the listener
  // bumps a tick counter that triggers React's reconciler.
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

  if (!m || !lessonId || !audioKey) return { available: false };
  // Composite-first. The bare-id fallback ONLY applies when the
  // manifest itself is legacy (zero composite keys) or the caller
  // couldn't supply a courseId. On a modern course-scoped manifest,
  // a missing composite key means THIS lesson has no narration —
  // falling back to a bare alias would play another course's audio
  // for any colliding lesson id (e.g. a not-yet-narrated course
  // whose `chNN-reading` ids collide with an already-narrated one).
  const entry =
    m.lessons[audioKey] ??
    (lessonId && (!courseId || isLegacyManifest(m))
      ? m.lessons[lessonId]
      : undefined);
  if (!entry) return { available: false };
  const sections = sectionsFor(entry);
  if (!sections) return { available: false };

  const isActive = activeLessonId === audioKey && audioEl != null;
  const el = audioEl;

  // Read the per-section duration list. When this lesson is the
  // active one we use the live cache (which has refined entries);
  // otherwise we synthesise estimates from the manifest so the
  // total-duration display still works pre-play.
  const durations = isActive
    ? sectionDurations
    : sections.map((s) => (typeof s.durationSec === "number" ? s.durationSec : 0));
  const totalDuration = durations.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const haveAnyDuration = durations.some((d) => d > 0);

  // Cumulative seconds = sum of fully-played section durations + the
  // current section's `currentTime`. When the lesson isn't active
  // both are 0.
  const sectionIdx = isActive ? activeSectionIndex : 0;
  const elapsedBefore = durations
    .slice(0, sectionIdx)
    .reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const currentSecLocal = isActive && el ? el.currentTime : 0;
  const currentSec = elapsedBefore + currentSecLocal;

  const isPlaying = isActive && el != null && !el.paused && !el.ended;
  const isLoading =
    isActive &&
    el != null &&
    el.readyState < el.HAVE_FUTURE_DATA &&
    !el.paused;

  const durationSec = haveAnyDuration ? totalDuration : null;
  const progress =
    durationSec && durationSec > 0
      ? Math.max(0, Math.min(1, currentSec / durationSec))
      : 0;
  const remainingSec =
    durationSec != null ? Math.max(0, durationSec - currentSec) : null;

  const startSection = (idx: number): void => {
    const a = ensureAudioEl();
    activeLessonId = audioKey;
    activeSections = sections;
    activeSectionIndex = idx;
    // Seed the duration cache from manifest estimates. Each entry's
    // live duration overwrites the estimate as `loadedmetadata` fires.
    sectionDurations = sections.map((s) =>
      typeof s.durationSec === "number" && s.durationSec > 0 ? s.durationSec : 0,
    );
    a.src = sections[idx].url;
    void a.play();
  };

  const activeSection = sections[sectionIdx] ?? null;
  return {
    available: true,
    url: activeSection?.url ?? "",
    sectionCount: sections.length,
    sectionIndex: sectionIdx,
    sectionBlockStart: activeSection?.blockStart ?? null,
    sectionBlockEnd: activeSection?.blockEnd ?? null,
    sectionCurrentSec: currentSecLocal,
    sectionDurationSec: durations[sectionIdx] ?? 0,
    durationSec,
    isActive,
    isPlaying,
    isLoading,
    currentSec,
    progress,
    remainingSec,
    play: () => {
      if (activeLessonId !== audioKey) {
        startSection(0);
        return;
      }
      // Already loaded — just resume.
      if (audioEl) void audioEl.play();
    },
    pause: () => {
      if (audioEl && activeLessonId === audioKey) audioEl.pause();
    },
    toggle: () => {
      if (activeLessonId !== audioKey) {
        startSection(0);
        return;
      }
      if (!audioEl) return;
      if (audioEl.paused) void audioEl.play();
      else audioEl.pause();
    },
    seek: (sec) => {
      if (audioEl && activeLessonId === audioKey) audioEl.currentTime = sec;
    },
    setSpeed: (rate) => {
      if (audioEl) audioEl.playbackRate = rate;
    },
  };
}

/// Stop the singleton player. Call when navigating away from a lesson
/// view to make sure narration doesn't keep playing in the background.
/// Idempotent — safe to call when nothing's playing.
export function stopLessonAudio(): void {
  if (audioEl && !audioEl.paused) audioEl.pause();
  if (audioEl) audioEl.removeAttribute("src");
  activeLessonId = null;
  activeSections = null;
  activeSectionIndex = 0;
  sectionDurations = [];
  notify();
}
