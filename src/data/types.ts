/// Canonical course format. A course is a collection of chapters; each chapter
/// has one or more lessons. A lesson is either reading-only or contains an
/// exercise with a starter file, hidden solution, and hidden test file.
///
/// On disk this is a mix of JSON (structure) and Markdown (prose). At runtime
/// we load everything into these types.

export type LanguageId = "javascript" | "typescript" | "python" | "rust" | "swift";

export interface Course {
  id: string;
  title: string;
  author?: string;
  description?: string;
  language: LanguageId;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  lessons: Lesson[];
}

export type Lesson = ReadingLesson | ExerciseLesson | MixedLesson;

interface LessonBase {
  id: string;
  title: string;
  /** Markdown body shown in the reading pane. Code fences are highlighted via Shiki. */
  body: string;
}

export interface ReadingLesson extends LessonBase {
  kind: "reading";
}

export interface ExerciseLesson extends LessonBase {
  kind: "exercise";
  language: LanguageId;
  /** Code the user sees in the editor on first open. */
  starter: string;
  /** Hidden reference solution. Not shown to the user. */
  solution: string;
  /** Hidden test file the evaluator runs against the user's code. */
  tests: string;
}

/**
 * A mixed lesson has reading prose AND a runnable exercise. Used when a book
 * section is mostly narrative but caps with a "try it" task.
 */
export interface MixedLesson extends LessonBase {
  kind: "mixed";
  language: LanguageId;
  starter: string;
  solution: string;
  tests: string;
}

export function isExerciseKind(lesson: Lesson): lesson is ExerciseLesson | MixedLesson {
  return lesson.kind === "exercise" || lesson.kind === "mixed";
}
