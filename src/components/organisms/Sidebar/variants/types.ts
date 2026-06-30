/// Shared props every sidebar variant accepts. Matches the existing
/// `Sidebar` component's `Props` interface 1:1 so any variant is a
/// drop-in replacement — `App.tsx` looks up the active variant from
/// the registry and renders it without caring about variant-internal
/// details.
///
/// Variants are free to ignore optional callbacks they don't surface
/// (e.g. variants B-E currently skip context menus and ignore
/// `onExportCourse` / `onDeleteCourse` / `onResetLesson` / etc.).
/// The framework treats those as v1-deferred features rather than
/// part of the variant comparison.

import type { Course } from "@/data/types";

export interface SidebarVariantProps {
  courses: Course[];
  activeCourseId?: string;
  activeLessonId?: string;
  completed: Set<string>;
  recents?: Record<string, number>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  onSelectCourse?: (courseId: string) => void;
  onLibrary: () => void;
  onExportCourse?: (courseId: string, courseTitle: string) => void;
  onDeleteCourse?: (courseId: string, courseTitle: string) => void;
  onCourseSettings?: (courseId: string) => void;
  onResetLesson?: (courseId: string, lessonId: string) => void;
  onResetChapter?: (courseId: string, lessonIds: string[]) => void;
  onResetCourse?: (courseId: string) => void;
}

/// Completion key format the App computes — variants read it via
/// `completed.has(key(courseId, lessonId))`. Helper here so variants
/// don't reinvent the join character.
export function completionKey(courseId: string, lessonId: string): string {
  return `${courseId}:${lessonId}`;
}

/// Lesson status as variants render it. Derived from `completed` +
/// `activeLessonId` — all variants compute it the same way and
/// branch their visual treatment per state.
export type LessonStatus = "done" | "current" | "pending";

export function lessonStatus(
  courseId: string,
  lessonId: string,
  completed: Set<string>,
  activeLessonId?: string,
): LessonStatus {
  if (lessonId === activeLessonId) return "current";
  if (completed.has(completionKey(courseId, lessonId))) return "done";
  return "pending";
}

/// Chapter-level progress aggregate. Variants use this for ring
/// indicators, progress bars, and "12/30" labels. Always returns
/// `{ done, total, pct }` so the caller can pick its presentation.
export function chapterProgress(
  courseId: string,
  lessonIds: ReadonlyArray<string>,
  completed: Set<string>,
): { done: number; total: number; pct: number } {
  const total = lessonIds.length;
  if (total === 0) return { done: 0, total: 0, pct: 0 };
  let done = 0;
  for (const id of lessonIds) {
    if (completed.has(completionKey(courseId, id))) done += 1;
  }
  return { done, total, pct: Math.round((done / total) * 100) };
}

/// Course-level progress aggregate. Same shape as chapterProgress
/// but folds over every lesson in every chapter. Used by the home/
/// library view in each variant.
export function courseProgress(
  course: Course,
  completed: Set<string>,
): { done: number; total: number; pct: number } {
  let total = 0;
  let done = 0;
  for (const chapter of course.chapters) {
    for (const lesson of chapter.lessons) {
      total += 1;
      if (completed.has(completionKey(course.id, lesson.id))) done += 1;
    }
  }
  return {
    done,
    total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
