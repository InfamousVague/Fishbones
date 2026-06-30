/// SuperMemo-2-lite scheduler for Practice items.
///
/// Why "lite":
///   - Real SM-2 has 6-grade quality buckets; we only have two
///     (correct / wrong). Mapping is straightforward (correct ≈
///     quality 4, wrong ≈ quality 2) and the math collapses
///     accordingly.
///   - We clamp ease into a tighter band [1.3, 2.8] than canonical
///     SM-2's [1.3, ∞]. Without a "perfect recall" grade we'd let
///     ease creep upward forever; the clamp keeps intervals
///     reasonable for a casual review surface.
///
/// The scheduler is a pure function over `PracticeRecord` →
/// `PracticeRecord`. Persistence is the store's job; this file
/// just computes the next state.
///
/// Shape of an attempt:
///
///   ┌── correct? ─── yes ──→ interval *= ease   (cap 60d)
///   │                        ease *= 1.0
///   │                        streak += 1
///   └── correct? ─── no  ──→ interval = 6h      (always reset)
///                            ease   -= 0.20    (clamp)
///                            streak  = 0
///
/// The first attempt (no prior record) skips the multiply step
/// and seeds `intervalMs = 24h` on correct or `6h` on wrong.

import type { PracticeRecord } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const MIN_INTERVAL_MS = 6 * HOUR_MS;
const MAX_INTERVAL_MS = 60 * DAY_MS;

const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const DEFAULT_EASE = 2.5;
const EASE_PENALTY = 0.2;

/// Build a fresh record for an item the learner has never seen.
/// Caller hands us `id` and `now`; we seed the rest.
export function freshRecord(id: string, now: number): PracticeRecord {
  return {
    id,
    lastSeen: now,
    streak: 0,
    attempts: 0,
    correct: 0,
    ease: DEFAULT_EASE,
    intervalMs: 0, // set on first grade
    dueAt: now,
  };
}

/// Apply a graded attempt to a record and return the next state.
/// `correct` is true on right answer; `now` is current epoch ms;
/// `prior` may be null for an item the learner has never attempted.
/// `difficultyBoost` (0..1) optionally shortens the next interval
/// for harder items — a "hard" puzzle that the learner just got
/// right still re-surfaces sooner than an "easy" one. Caller
/// passes 0 for easy, 0.15 for medium, 0.30 for hard.
export function gradeAttempt(
  prior: PracticeRecord | null,
  id: string,
  correct: boolean,
  now: number,
  difficultyBoost = 0,
): PracticeRecord {
  const base = prior ?? freshRecord(id, now);
  const attempts = base.attempts + 1;
  const correctCount = base.correct + (correct ? 1 : 0);
  const streak = correct ? base.streak + 1 : 0;

  let ease = correct ? base.ease : base.ease - EASE_PENALTY;
  ease = clamp(ease, MIN_EASE, MAX_EASE);

  let intervalMs: number;
  if (!correct) {
    intervalMs = MIN_INTERVAL_MS;
  } else if (base.attempts === 0 || base.intervalMs === 0) {
    // First-correct seed.
    intervalMs = DAY_MS;
  } else {
    intervalMs = base.intervalMs * ease;
  }
  // Difficulty boost shortens the next interval. We multiply by
  // (1 - boost) so a hard item with boost=0.3 re-surfaces ~30%
  // sooner. Bounded by MIN_INTERVAL_MS so we never undershoot
  // the floor and start spamming a single hard atom.
  intervalMs = clamp(
    intervalMs * (1 - difficultyBoost),
    MIN_INTERVAL_MS,
    MAX_INTERVAL_MS,
  );

  return {
    id,
    lastSeen: now,
    streak,
    attempts,
    correct: correctCount,
    ease,
    intervalMs,
    dueAt: now + intervalMs,
  };
}

/// Map a `Difficulty` to the boost the scheduler expects. Defaults
/// to 0 when the lesson didn't author a difficulty.
export function difficultyBoost(
  d: "easy" | "medium" | "hard" | undefined,
): number {
  switch (d) {
    case "hard":
      return 0.3;
    case "medium":
      return 0.15;
    default:
      return 0;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/// Format a duration in ms as a short human label like "in 2 days"
/// or "in 4 hours". Used by the session's post-grade card and the
/// course-shelf "Next due" line.
export function formatDueIn(ms: number): string {
  if (ms <= 0) return "now";
  if (ms < HOUR_MS) {
    const m = Math.max(1, Math.round(ms / (60 * 1000)));
    return `in ${m} min`;
  }
  if (ms < DAY_MS) {
    const h = Math.max(1, Math.round(ms / HOUR_MS));
    return `in ${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.max(1, Math.round(ms / DAY_MS));
  return `in ${d} day${d === 1 ? "" : "s"}`;
}
