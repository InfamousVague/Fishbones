/// Chapter-id repair for courses whose JSON shipped with broken ids.
///
/// The Chapter type declares `id: string`, but 14 of the 96 starter
/// courses (the koans/*lings importers, select-star-sql, and a few
/// book ingests) were generated without chapter ids, and one more
/// (introduction-to-computer-organization-arm) ships two chapters
/// sharing the same id. Broken ids hurt more than React keys:
/// ChapterGrid keys its open/closed Set by `chapter.id` (so one
/// toggle collapses every same-id chapter at once), the cert-stamp
/// icon/rotation are hashed from the id (so every stamp renders
/// identically), and recentReview dedupes by `courseId:chapterId`.
///
/// Rather than regenerating the bundled JSON (which would force a
/// SEED_VERSION bump so returning web visitors' IndexedDB caches
/// re-fetch), the storage layer runs every course through
/// `ensureChapterIds` on load and save. Derivation is deterministic —
/// slug of the English chapter title, position-suffixed on collision —
/// so the same course JSON yields the same ids on every device and
/// every load. Nothing persists chapter ids across sessions (progress
/// is keyed by LESSON ids), so a repair-on-read rename is safe.

import type { Course, Chapter } from "./types";

function hasId(ch: Chapter): boolean {
  return typeof ch.id === "string" && ch.id.length > 0;
}

/// Mirrors `slugify` in lessonHelpers.ts, minus its "course" fallback —
/// callers here need to detect the empty result and fall back to a
/// positional id instead.
function titleSlug(title: unknown): string {
  if (typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/// Return `course` with every chapter guaranteed a non-empty, unique
/// string id. Valid ids keep their first occurrence untouched; later
/// duplicates and missing ids get deterministic replacements. A course
/// with nothing to fix is returned as-is (same reference) so hot paths
/// pay nothing.
export function ensureChapterIds(course: Course): Course {
  const chapters = course?.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) return course;

  const seen = new Set<string>();
  let broken = false;
  for (const ch of chapters) {
    if (!hasId(ch) || seen.has(ch.id)) {
      broken = true;
      break;
    }
    seen.add(ch.id);
  }
  if (!broken) return course;

  // Pre-seed with every valid existing id so a derived slug never
  // steals the id of a chapter that legitimately owns it later in
  // the list — the derived one takes the suffix, not the owner.
  const used = new Set<string>(chapters.filter(hasId).map((ch) => ch.id));
  const kept = new Set<string>();

  return {
    ...course,
    chapters: chapters.map((ch, i) => {
      // First occurrence of a valid id wins and stays untouched.
      if (hasId(ch) && !kept.has(ch.id)) {
        kept.add(ch.id);
        return ch;
      }
      const base = hasId(ch)
        ? ch.id // later duplicate of a valid id
        : titleSlug(ch.title) || `chapter-${i + 1}`;
      let id = base;
      // The loop (rather than a single `-2`) handles pathological
      // inputs like a literal "koans-2" title next to two "koans".
      for (let n = 2; used.has(id) || kept.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      kept.add(id);
      return { ...ch, id };
    }),
  };
}
