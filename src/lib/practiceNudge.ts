/// "Welcome back — review something?" nudge gate.
///
/// Spaced repetition works best right when a learner RETURNS after time
/// away — that's when recall is about to decay. This module tracks when
/// the app was last actively used and, on the next launch/return after a
/// gap of a few hours, tells the host to offer a practice session in the
/// alert banner (App gates it further on `practiceDue > 0` so we never
/// nudge someone with nothing to review).
///
/// Shown at most once per return (a session latch), and never within the
/// same sitting (the gap check compares against the PREVIOUS sitting's
/// last heartbeat, captured once at module load before the heartbeat
/// starts overwriting it).

const LAST_ACTIVE_KEY = "libre:last-active-ts";
const NUDGED_KEY = "libre:practice-nudged"; // sessionStorage — once per return
/// "Past a few hours" — the away gap that makes a review worthwhile.
export const NUDGE_GAP_HOURS = 4;
/// Heartbeat cadence while the app is open.
const HEARTBEAT_MS = 5 * 60 * 1000;

/// The previous sitting's last heartbeat, captured at module load —
/// BEFORE this sitting's heartbeat starts overwriting the key.
const previousActiveTs: number | null = (() => {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
})();

function beat(): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
}

/// Start the last-active heartbeat. Call once at app mount; returns a
/// cleanup. Beats immediately, on an interval, and on hide/unload so the
/// stored timestamp is always ~the end of the sitting.
export function startActivityHeartbeat(): () => void {
  beat();
  const id = window.setInterval(beat, HEARTBEAT_MS);
  const onHide = () => {
    if (document.visibilityState === "hidden") beat();
  };
  window.addEventListener("beforeunload", beat);
  document.addEventListener("visibilitychange", onHide);
  return () => {
    window.clearInterval(id);
    window.removeEventListener("beforeunload", beat);
    document.removeEventListener("visibilitychange", onHide);
  };
}

/// True when this sitting began after a long-enough gap AND the nudge
/// hasn't been shown this sitting yet. The caller additionally gates on
/// having due practice items.
export function shouldShowPracticeNudge(): boolean {
  if (previousActiveTs === null) return false; // first launch ever — nothing to "come back" to
  try {
    if (sessionStorage.getItem(NUDGED_KEY) === "1") return false;
  } catch {
    /* fall through */
  }
  const gapHours = (Date.now() - previousActiveTs) / 3_600_000;
  return gapHours >= NUDGE_GAP_HOURS;
}

/// Latch "nudged this sitting" — set when the banner is shown (accepting
/// OR dismissing both count; we never re-nag within a sitting).
export function markPracticeNudged(): void {
  try {
    sessionStorage.setItem(NUDGED_KEY, "1");
  } catch {
    /* ignore */
  }
}
