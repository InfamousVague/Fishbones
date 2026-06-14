/// Type definitions for the Practice feature.
///
/// Practice is the "review" half of the app's learn → review loop.
/// Lessons themselves are linear and one-shot — once a learner
/// finishes a quiz or blocks puzzle inside a lesson, the regular
/// flow doesn't bring it back. Practice mode harvests every quiz
/// question and blocks puzzle from the courses the learner has
/// touched, scores each one independently, and resurfaces them on
/// a spaced-repetition cadence so retention sticks.
///
/// Two collaborating data shapes:
///
///   - `PracticeItem` — a denormalised, run-time-only projection
///     of one practiceable atom (one quiz question OR one blocks
///     puzzle). Built fresh from the live `Course[]` whenever the
///     view mounts; never persisted.
///
///   - `PracticeRecord` — the per-item learning state (last
///     attempt, ease factor, next due date). Persisted across
///     sessions in localStorage; keyed by `PracticeItem.id`.
///
/// The split lets the harvester remain a pure function over the
/// live course data (so author edits and new books take effect on
/// the next reload without a migration) while still tracking the
/// learner's history across sessions.

import type { BlocksData, Difficulty, LanguageId, QuizQuestion } from "../../data/types";

/// Discriminator for the three kinds of practiceable atoms we
/// surface today. `mcq` and `short` are the two QuizQuestion shapes
/// (kept distinct so the session renderer can pick the right input
/// affordance without re-narrowing); `blocks` is one full blocks
/// puzzle from an exercise/mixed lesson.
export type PracticeItemKind =
  | "mcq"
  | "short"
  | "blocks"
  | "parsons"
  | "spotbug";

/// One practiceable atom, denormalised for the session runner.
/// Built from `harvestPracticeItems(courses, completed)` — see
/// `practiceHarvest.ts`. Not persisted; rebuilt every mount.
export interface PracticeItem {
  /// Stable id keyed off course / lesson / atom-kind / atom-index.
  /// Format: `${courseId}:${lessonId}:${kind}:${slug}`. The slug
  /// is the question index for quizzes ("q3") or the literal
  /// "blocks" for blocks puzzles. Stability matters because this
  /// id is the join key against `PracticeRecord` — if it changed
  /// when an author re-ordered questions, every record would orphan.
  id: string;
  kind: PracticeItemKind;
  courseId: string;
  courseTitle: string;
  /// `language` from the parent course. Drives both the language
  /// chip shown on each card AND the syntax highlighter for blocks
  /// puzzles, so the practice card paints with the same Shiki
  /// `github-dark` theme the lesson reader and BlocksView use.
  /// Optional because some courses may not declare one (legacy /
  /// docs-only); the highlighter falls back to plain text in that
  /// case.
  language?: LanguageId;
  lessonId: string;
  lessonTitle: string;
  /// Difficulty pulled off the lesson when present. Used for the
  /// difficulty-dot badge AND the SM-2 scheduler's "harder items
  /// have shorter intervals" weight (a `hard` puzzle drops back
  /// into rotation faster than an `easy` one when missed).
  difficulty?: Difficulty;
  /// Optional topic tag from the lesson. Populated for challenge
  /// packs; sparse for narrative books. Used for filter chips.
  topic?: string;
  /// Inline payload — exactly one of these is set per item kind.
  question?: QuizQuestion;
  blocks?: BlocksData;
  /// Parsons payload: the reference solution's non-blank lines in
  /// their correct order. The runner shuffles them for display; the
  /// learner reorders; grading compares against this sequence.
  parsons?: { lines: string[] };
  /// Spot-the-Bug payload: the solution with ONE line mutated into a
  /// subtle bug. `bugLine` is the index the learner must tap; `original`
  /// is the correct line shown on reveal; `category` labels the bug.
  spotbug?: {
    lines: string[];
    bugLine: number;
    original: string;
    category: string;
  };
}

/// Per-item learning state. Persisted to localStorage under
/// `STORAGE_KEY` as a JSON map of `id → PracticeRecord`.
///
/// Records are append-only at the API surface (we always merge
/// onto an existing record on grade) but the store WILL drop
/// records whose item id no longer maps to a live atom — that
/// happens when the author rewrites a quiz or removes a puzzle,
/// and the orphan would otherwise leak forever.
export interface PracticeRecord {
  /// Matches `PracticeItem.id`.
  id: string;
  /// Epoch ms of the most recent attempt (correct or wrong).
  lastSeen: number;
  /// Streak of consecutive correct attempts. Resets to 0 on miss.
  /// Drives the "Mastery" badge once it crosses 5.
  streak: number;
  /// Total attempts (correct + incorrect). Useful for the weak-
  /// spots filter (`correct / attempts < 0.6`) and for surfacing
  /// "Practiced 12 times" in the card hover tooltip.
  attempts: number;
  /// Total correct attempts. Together with `attempts` gives the
  /// learner's accuracy on this atom.
  correct: number;
  /// SM-2 ease factor. Bounded to [1.3, 2.8]. Default 2.5.
  /// Multiplies the previous interval on every correct grade.
  ease: number;
  /// Last interval in ms. Stored so we can multiply by `ease` on
  /// the next correct grade. Initial first-correct: 1 day.
  intervalMs: number;
  /// Epoch ms when this record becomes due for review again.
  /// Always >= lastSeen. Items where `dueAt <= now()` show up in
  /// the "Due now" filter and bias the smart-mix weighting.
  dueAt: number;
}

/// Public shape returned by the store's `getStats()`. Used by the
/// header strip to surface today's progress at a glance.
export interface PracticeStats {
  /// Total items the learner has ever attempted. The "library"
  /// number — total atoms in the practice deck.
  totalSeen: number;
  /// Items whose `dueAt <= now`.
  dueCount: number;
  /// Items where `correct/attempts < 0.6` and `attempts >= 2`.
  /// "weak" implies enough data to know it's actually weak, not
  /// just one unlucky attempt.
  weakCount: number;
  /// Attempts logged in the current local-day. Drives the daily-
  /// target progress ring. Bumps both correct and wrong attempts.
  attemptsToday: number;
  /// Correct attempts logged in the current local-day. Lets the
  /// header surface "8/10 correct today" — accuracy, not just count.
  correctToday: number;
}
