/// "Review what you learned last time" — scope builder for the
/// welcome-back nudge.
///
/// The generic nudge reviewed the WHOLE deck (every course, every
/// language) which reads as noise, not care. This module narrows the
/// review to the one or two CHAPTERS the learner touched most
/// recently, so the launch prompt can say "let's pick up Ownership &
/// Borrowing" instead of "here are 10 random cards".
///
/// Pure: derives everything from the live course tree + completion
/// history. The host memoises over [courses, completed, history].

import type { Course } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";
import { harvestPracticeItems } from "./practiceHarvest";

export interface RecentReviewChapter {
  courseId: string;
  courseTitle: string;
  chapterId: string;
  chapterTitle: string;
}

export interface RecentReviewScope {
  /// The 1-2 most recently studied chapters, most recent first.
  chapters: RecentReviewChapter[];
  /// `${courseId}:${lessonId}` keys of the COMPLETED lessons inside
  /// those chapters — the harvest gate for the scoped session.
  lessonKeys: Set<string>;
  /// How many practiceable atoms the scope yields.
  itemCount: number;
}

/// Fewer scoped atoms than this and the tailored review isn't worth
/// interrupting a launch for — the host should fall back to the
/// generic nudge (or nothing).
export const SCOPE_MIN_ITEMS = 3;

/// Max chapters in the scope — "a chapter or two", most recent first.
const SCOPE_MAX_CHAPTERS = 2;

export function buildRecentReviewScope(
  courses: readonly Course[],
  completed: ReadonlySet<string>,
  history: readonly Completion[],
): RecentReviewScope | null {
  if (history.length === 0 || courses.length === 0) return null;

  // lesson → owning chapter index, walked once.
  const lessonChapter = new Map<
    string,
    { course: Course; chapterId: string; chapterTitle: string }
  >();
  for (const course of courses) {
    for (const ch of course.chapters) {
      for (const l of ch.lessons) {
        lessonChapter.set(`${course.id}:${l.id}`, {
          course,
          chapterId: ch.id,
          chapterTitle: ch.title,
        });
      }
    }
  }

  // Most recent completions first; collect the first N distinct
  // chapters that still exist in the live course tree.
  const chapters: RecentReviewChapter[] = [];
  const seen = new Set<string>();
  const sorted = [...history].sort((a, b) => b.completed_at - a.completed_at);
  for (const c of sorted) {
    const hit = lessonChapter.get(`${c.course_id}:${c.lesson_id}`);
    if (!hit) continue; // course uninstalled / lesson renamed
    const key = `${hit.course.id}:${hit.chapterId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chapters.push({
      courseId: hit.course.id,
      courseTitle: hit.course.title,
      chapterId: hit.chapterId,
      chapterTitle: hit.chapterTitle,
    });
    if (chapters.length >= SCOPE_MAX_CHAPTERS) break;
  }
  if (chapters.length === 0) return null;

  // Completed lessons inside the scoped chapters. Reusing the
  // harvester with THIS set as its completion gate yields exactly the
  // scope's atoms (the harvest is strictly lesson-gated).
  const chapterKeys = new Set(chapters.map((c) => `${c.courseId}:${c.chapterId}`));
  const lessonKeys = new Set<string>();
  for (const key of completed) {
    const hit = lessonChapter.get(key);
    if (hit && chapterKeys.has(`${hit.course.id}:${hit.chapterId}`)) {
      lessonKeys.add(key);
    }
  }
  if (lessonKeys.size === 0) return null;

  const itemCount = harvestPracticeItems(courses, lessonKeys).length;
  if (itemCount < SCOPE_MIN_ITEMS) return null;

  return { chapters, lessonKeys, itemCount };
}
