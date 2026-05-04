import type { Course, Lesson } from "./data/types";

export interface Neighbors {
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

/// Flatten all chapters into a linear lesson list and return the siblings of
/// the given lessonId. Returning null at the ends lets the nav disable the
/// Prev/Next buttons without additional branching in the view.
export function findNeighbors(course: Course, lessonId: string): Neighbors {
  const flat: Array<{ id: string; title: string }> = [];
  for (const ch of course.chapters) {
    for (const l of ch.lessons) flat.push({ id: l.id, title: l.title });
  }
  const idx = flat.findIndex((x) => x.id === lessonId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "course";
}

export function findLesson(course: Course | null, lessonId: string | undefined): Lesson | null {
  if (!course || !lessonId) return null;
  for (const ch of course.chapters) {
    const found = ch.lessons.find((l) => l.id === lessonId);
    if (found) return found;
  }
  return null;
}

/// Show the ChainDock when the lesson actively interacts with the
/// EVM (`harness: "evm"`) OR when the lesson is a Solidity / Vyper
/// exercise that compiles to bytecode. Other lessons in EVM courses
/// (the chapter introduction reading, JS-only encoding drills) skip
/// the dock — it'd just be noise above non-chain content.
export function shouldShowEvmDock(lesson: Lesson, _course: Course): boolean {
  if ("harness" in lesson && lesson.harness === "evm") return true;
  // Solidity/Vyper lessons typically compile to EVM bytecode even
  // without the explicit harness flag (legacy compile-only path).
  if ("language" in lesson) {
    const lang = (lesson as { language?: string }).language;
    if (lang === "solidity" || lang === "vyper") return true;
  }
  return false;
}

/// Show the BitcoinChainDock when the lesson opts into the Bitcoin
/// harness. Unlike the EVM dock, we don't auto-show on a "language"
/// match — every Bitcoin lesson today is JavaScript, and JS lessons
/// in unrelated courses (e.g. JavaScript Challenges) shouldn't get a
/// chain dock above them.
export function shouldShowBitcoinDock(lesson: Lesson, _course: Course): boolean {
  if ("harness" in lesson && lesson.harness === "bitcoin") return true;
  return false;
}
