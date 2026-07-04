/// "Has the learner started a course yet?" latch.
///
/// Drives the first-run activation nudge — a pulsing dot on the Discover +
/// Paths rail items — that persists until the user opens their FIRST lesson.
/// The gap between "downloaded / installed a course" and "actually started
/// one" is the activation metric we're closing, so this is deliberately about
/// *opening a lesson*, not installing.
///
/// Callers also treat any existing progress as "started" (so this never nags a
/// returning learner) — see `App` where the CTA is `!(latch || completed.size)`.

const STARTED_KEY = "libre:started-learning-v1";
/// Fired when the latch flips, so the CTA clears live without a reload.
export const STARTED_LEARNING_EVENT = "libre:started-learning";

export function hasStartedLearningLatch(): boolean {
  try {
    return localStorage.getItem(STARTED_KEY) === "1";
  } catch {
    return false;
  }
}

/// Latch "started" (idempotent) and notify listeners. Called the first time a
/// lesson is opened.
export function markStartedLearning(): void {
  try {
    if (localStorage.getItem(STARTED_KEY) === "1") return;
    localStorage.setItem(STARTED_KEY, "1");
  } catch {
    /* storage unavailable — still fire the event for this session */
  }
  try {
    window.dispatchEvent(new CustomEvent(STARTED_LEARNING_EVENT));
  } catch {
    /* non-DOM env */
  }
}
