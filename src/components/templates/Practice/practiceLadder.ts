/// The difficulty-ladder + reward foundation for Practice.
///
/// Two complaints drove this: practice felt "too hard" (every atom
/// hit at full difficulty, with a blank-screen failure mode) and
/// "not gamified enough" (the XP/combo machinery the rest of the app
/// uses never reached the review loop). This module is the spine the
/// fixes hang on:
///
///   - `pickWarmupItems` — the gentle on-ramp. Before the graded
///     queue, the session opens with a few zero-stakes RECOGNITION
///     cards drawn from what the learner most recently saw: the
///     answer is shown, a single tap acknowledges it, nothing can be
///     lost. It primes the concepts that are about to resurface so
///     the first real card feels familiar — turning the dreaded
///     first 60 seconds into a guaranteed win.
///
///   - `comboMultiplier` / `xpForCorrect` — the in-session reward
///     curve. Consecutive correct answers build a multiplier that
///     scales the XP burst; a miss only resets the multiplier, it
///     never costs XP or breaks the SRS streak. Pure upside.
///
///   - `presentationFor` — maps an atom + its SRS state to how hard
///     it should be presented (recognize < recall < reconstruct).
///     The warm-up always presents at `recognize`; the graded queue
///     uses the learner's mastery so a struggled atom can drop a
///     notch instead of throwing the same wall again.
///
/// All pure functions — no IO, no React. The session runner and the
/// deck view import what they need.

import type { PracticeItem, PracticeRecord } from "./types";
import type { Difficulty } from "@/data/types";

/// How many warm-up cards open a session. Small enough to stay a
/// quick win, big enough to prime the concepts about to resurface.
export const WARMUP_SIZE = 4;

/// Base XP for a single correct card before the combo multiplier.
export const BASE_XP = 10;

/// How an atom is presented, easiest-first. `recognize` = the answer
/// is in front of you (tap to confirm / pick from options); `recall`
/// = produce the answer (type / full MCQ); `reconstruct` = assemble
/// it (blocks, ordering). The warm-up forces `recognize`.
export type Presentation = "recognize" | "recall" | "reconstruct";

/// Pick the warm-up lap: the learner's most-recently-seen quiz atoms,
/// newest first, capped at `n`. Only `mcq`/`short` qualify — they
/// read cleanly as "here's the question, here's the answer" recognition
/// cards. Items the learner has never seen are skipped (nothing to
/// prime). Returns fewer than `n` (or none) when the deck is too fresh;
/// the caller simply skips the lap in that case.
export function pickWarmupItems(
  items: readonly PracticeItem[],
  records: ReadonlyMap<string, PracticeRecord>,
  n: number = WARMUP_SIZE,
  now: number = Date.now(),
): PracticeItem[] {
  void now;
  const seen: Array<{ item: PracticeItem; lastSeen: number }> = [];
  for (const item of items) {
    if (item.kind !== "mcq" && item.kind !== "short") continue;
    const rec = records.get(item.id);
    if (!rec) continue;
    seen.push({ item, lastSeen: rec.lastSeen });
  }
  seen.sort((a, b) => b.lastSeen - a.lastSeen);
  return seen.slice(0, Math.max(0, n)).map((s) => s.item);
}

/// The combo multiplier for a given run of consecutive correct
/// answers. Steps (not linear) so the jumps feel like an event:
///   0-2 → 1×, 3-4 → 1.25×, 5-7 → 1.5×, 8-11 → 2×, 12+ → 3×.
export function comboMultiplier(combo: number): number {
  if (combo >= 12) return 3;
  if (combo >= 8) return 2;
  if (combo >= 5) return 1.5;
  if (combo >= 3) return 1.25;
  return 1;
}

/// A short label for the current multiplier tier, for the combo
/// pill. Empty at 1× (we hide the pill until a combo is building).
export function comboTierLabel(combo: number): string {
  const m = comboMultiplier(combo);
  return m > 1 ? `${m}×` : "";
}

/// XP awarded for one correct card: base × combo multiplier, with a
/// small lean toward harder atoms (a `hard` atom is worth a touch
/// more than an `easy` one). Always a positive integer.
export function xpForCorrect(combo: number, difficulty?: Difficulty): number {
  const diffWeight =
    difficulty === "hard" ? 1.4 : difficulty === "medium" ? 1.2 : 1;
  return Math.max(1, Math.round(BASE_XP * comboMultiplier(combo) * diffWeight));
}

/// How hard to present this atom, from its SRS state. Unseen or
/// low-ease (struggled) atoms drop toward recognition; well-mastered
/// atoms stay at their native difficulty. The session uses this to
/// keep a beginner in flow instead of throwing the hardest framing
/// every time. (Wired progressively — today the warm-up forces
/// `recognize` and the graded queue reads this for the demotion
/// ladder.)
export function presentationFor(
  item: PracticeItem,
  record: PracticeRecord | undefined,
): Presentation {
  // Blocks are inherently reconstruction; never demote below recall
  // here (scaffolding handles their easing separately).
  const native: Presentation = item.kind === "blocks" ? "reconstruct" : "recall";
  if (!record) return item.kind === "blocks" ? "reconstruct" : "recognize";
  const struggling =
    record.ease <= 1.8 ||
    (record.attempts >= 2 && record.correct / record.attempts < 0.6);
  if (struggling) return item.kind === "blocks" ? "reconstruct" : "recognize";
  return native;
}

/// The visible "answer" text for a warm-up recognition card. For an
/// `mcq` it's the correct option; for a `short` it's the first
/// accepted answer. Empty when the payload is missing.
export function warmupAnswerText(item: PracticeItem): string {
  const q = item.question;
  if (!q) return "";
  if (q.kind === "mcq") return q.options[q.correctIndex] ?? "";
  if (q.kind === "short") return q.accept[0] ?? "";
  return "";
}
