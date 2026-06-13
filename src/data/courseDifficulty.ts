/// Editorial difficulty levels for catalog content. Hand-curated, like
/// `data/paths.ts` — a static map the UI reads. Drives the ordering of
/// book-based learning paths (beginner material first), the difficulty
/// badges on path steps / cards, and the level dividers in the path
/// detail view.
///
/// Coverage is intentionally partial: content without an entry simply
/// renders no badge. The Rust shelf is fully covered (every book, drill
/// pack, and track); extend other languages as their paths get built.

export type CourseDifficulty = "beginner" | "intermediate" | "advanced";

export const DIFFICULTY_ORDER: readonly CourseDifficulty[] = [
  "beginner",
  "intermediate",
  "advanced",
];

export const DIFFICULTY_LABEL: Record<CourseDifficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/// Badge tint per level — green → amber → red, mixed against the
/// theme via color-mix in CSS (these are the accent anchors).
export const DIFFICULTY_COLOR: Record<CourseDifficulty, string> = {
  beginner: "#4d9e6a",
  intermediate: "#c2913a",
  advanced: "#c25d4a",
};

export const COURSE_DIFFICULTY: Record<string, CourseDifficulty> = {
  // ── Rust (full coverage) ─────────────────────────────────────────
  "the-rust-programming-language": "beginner",
  rustlings: "beginner",
  "rust-by-example": "beginner",
  "exercism-rust": "intermediate",
  "testing-rust": "intermediate",
  "challenges-rust-handwritten": "intermediate",
  "rust-async-book": "advanced",
  rustonomicon: "advanced",
  "solana-programs": "advanced",
};

export function courseDifficulty(
  courseId: string,
): CourseDifficulty | undefined {
  return COURSE_DIFFICULTY[courseId];
}

/// Difficulty span across a set of course ids — used for a path card's
/// "Beginner → Advanced" range chip. Returns undefined when none of the
/// ids carry a level.
export function difficultyRange(
  courseIds: readonly string[],
): { min: CourseDifficulty; max: CourseDifficulty } | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of courseIds) {
    const d = COURSE_DIFFICULTY[id];
    if (!d) continue;
    const i = DIFFICULTY_ORDER.indexOf(d);
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  if (hi < 0) return undefined;
  return { min: DIFFICULTY_ORDER[lo], max: DIFFICULTY_ORDER[hi] };
}
