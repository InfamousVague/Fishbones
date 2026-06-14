/// Pure projection: turn the live Course[] tree into a flat list
/// of `PracticeItem`s the rest of the Practice feature can iterate.
///
/// Two harvesting principles:
///
///   1. **Pre-filter to "touched" courses.** A learner who has
///      never opened a course shouldn't get its content thrown
///      into their review queue — that defeats the "review what
///      you've learned" framing and dilutes the deck. We treat
///      "the learner has completed at least one lesson in the
///      course" as the inclusion threshold.
///
///   2. **No deep-equality dependency on the Course tree.** Caller
///      `useMemo`s over `[courses, completed]`; we trust those
///      identities. The harvester walks them once, allocates
///      O(items) entries, and returns a fresh array. Cheap enough
///      to re-run on every relevant change.
///
/// The id format is the join key against `PracticeRecord` (see
/// `types.ts`). Keep it stable across author-side reorderings:
///   - quiz items use the question's array index, BUT scoped by
///     the lesson id, so adding a new question above an old one
///     would drift records. The drift is acceptable: the orphan
///     is GC-able by the store, and on net "the new question
///     gets a fresh record" is the right semantics. Fancy
///     content-hash-based ids would buy stability at the cost of
///     two re-attempts on innocent author edits.
///   - blocks items always use the literal `"blocks"` slug —
///     there's exactly one blocks puzzle per exercise lesson.

import type { Course, Lesson } from "../../data/types";
import type { PracticeItem } from "./types";
import { isMobile } from "../../lib/platform";

/// Build the practice deck from courses the learner has touched.
///
/// `completed` is the standard `${courseId}:${lessonId}` set the
/// rest of the app uses. We use it to:
///   - decide which courses qualify (any completion → include)
///   - tag each item with whether the learner has completed the
///     lesson it lives in (caller can dim "not yet completed"
///     items; we don't filter them here so the harvest is reused
///     between "review only completed" and "preview everything"
///     UI surfaces).
///
/// Returns one `PracticeItem` per atom (one quiz question or one
/// blocks puzzle). A 10-question quiz contributes 10 items.
export function harvestPracticeItems(
  courses: readonly Course[],
  completed: ReadonlySet<string>,
): PracticeItem[] {
  const out: PracticeItem[] = [];
  for (const course of courses) {
    if (!hasAnyCompletion(course, completed)) continue;
    for (const chapter of course.chapters) {
      for (const lesson of chapter.lessons) {
        appendItemsForLesson(out, course, lesson);
      }
    }
  }
  return out;
}

/// Subset variant: harvest items only from lessons the learner
/// has completed. Used by the "Mistake deck" and other surfaces
/// that want a stricter "you've actually finished this" filter.
export function harvestCompletedItems(
  courses: readonly Course[],
  completed: ReadonlySet<string>,
): PracticeItem[] {
  const out: PracticeItem[] = [];
  for (const course of courses) {
    for (const chapter of course.chapters) {
      for (const lesson of chapter.lessons) {
        if (!completed.has(`${course.id}:${lesson.id}`)) continue;
        appendItemsForLesson(out, course, lesson);
      }
    }
  }
  return out;
}

function hasAnyCompletion(
  course: Course,
  completed: ReadonlySet<string>,
): boolean {
  for (const chapter of course.chapters) {
    for (const lesson of chapter.lessons) {
      if (completed.has(`${course.id}:${lesson.id}`)) return true;
    }
  }
  return false;
}

/// A "summary" lesson is the stripped placeholder the web build seeds
/// the library with before a course's full body loads (see `summarise`
/// in `lib/storage.ts`): `body` is blanked to "" and the practiceable
/// payloads — `questions` for quizzes, `blocks` for exercises — are
/// dropped, leaving only id/title/kind plus light metadata. Such a
/// lesson has nothing to harvest yet, so the harvester skips it.
function isLessonSummaryStub(lesson: Lesson): boolean {
  const l = lesson as {
    body?: string;
    questions?: unknown;
    blocks?: unknown;
  };
  return (
    l.body === "" && l.questions === undefined && l.blocks === undefined
  );
}

function appendItemsForLesson(
  out: PracticeItem[],
  course: Course,
  lesson: Lesson,
): void {
  // Web seeds the library with stripped summary lessons (see
  // `isLessonSummaryStub`) that carry no harvestable atoms until the
  // full course body loads. Skip them before the per-kind logic: a
  // completed-but-not-yet-opened course must not emit phantom items —
  // and, historically, this is what stops the harvest from crashing the
  // whole <App> (via the `practiceDue` useMemo in App.tsx) by
  // dereferencing a `questions` array the summary doesn't carry. Both
  // harvest entry points funnel through here, so both are covered.
  if (isLessonSummaryStub(lesson)) return;
  if (lesson.kind === "quiz") {
    // Second line of defence: a genuinely malformed *full* quiz lesson
    // (kind "quiz", real body, but the author forgot `questions`) isn't
    // a summary stub — coalesce to an empty list so it contributes
    // nothing instead of throwing.
    (lesson.questions ?? []).forEach((q, i) => {
      out.push({
        id: `${course.id}:${lesson.id}:${q.kind}:q${i}`,
        kind: q.kind,
        courseId: course.id,
        courseTitle: course.title,
        language: course.language,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        question: q,
      });
    });
    return;
  }
  // Blocks puzzles are MOBILE-ONLY (typing is the friction blocks solve;
  // desktop reviews exercises in the editor). Skipping the harvest on
  // desktop keeps blocks items out of the desktop Practice queue, counts,
  // and sessions entirely; mobile still surfaces them for review.
  if (
    isMobile &&
    (lesson.kind === "exercise" || lesson.kind === "mixed") &&
    lesson.blocks
  ) {
    out.push({
      id: `${course.id}:${lesson.id}:blocks:blocks`,
      kind: "blocks",
      courseId: course.id,
      courseTitle: course.title,
      language: course.language,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      difficulty: lesson.difficulty,
      topic: lesson.topic,
      blocks: lesson.blocks,
    });
  }
  // Parsons (order-the-lines): a gentler review of a code exercise than
  // retyping it — reorder the solution's lines. Works on desktop + mobile
  // (drag/tap, no typing). Only short, well-shaped single-file solutions
  // make good puzzles, so we gate on a 3-10 non-blank-line range.
  const solution = (lesson as { solution?: string }).solution;
  if (
    (lesson.kind === "exercise" || lesson.kind === "mixed") &&
    typeof solution === "string"
  ) {
    const lines = parsonsLines(solution);
    if (lines.length >= 3 && lines.length <= 10) {
      out.push({
        id: `${course.id}:${lesson.id}:parsons:parsons`,
        kind: "parsons",
        courseId: course.id,
        courseTitle: course.title,
        language: course.language,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        difficulty: lesson.difficulty,
        topic: lesson.topic,
        parsons: { lines },
      });
    }
  }
}

/// Split a reference solution into the non-blank lines a Parsons
/// puzzle reorders. Normalises newlines, trims trailing whitespace,
/// drops blank lines (leading indentation is kept — a visual cue, not
/// graded). Duplicate lines are fine: grading compares the reassembled
/// string sequence, so interchangeable lines (e.g. two closing braces)
/// still validate in any order.
function parsonsLines(solution: string): string[] {
  return solution
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
}

/// Group an item array by `courseId`. Returns insertion-ordered
/// pairs so the caller can render filter chips in a stable
/// course-encounter order. Used by `<PracticeView>` for the
/// course-filter strip.
export function groupItemsByCourse(
  items: readonly PracticeItem[],
): Array<{ courseId: string; courseTitle: string; count: number }> {
  const seen = new Map<
    string,
    { courseId: string; courseTitle: string; count: number }
  >();
  for (const it of items) {
    const cur = seen.get(it.courseId);
    if (cur) cur.count += 1;
    else
      seen.set(it.courseId, {
        courseId: it.courseId,
        courseTitle: it.courseTitle,
        count: 1,
      });
  }
  return Array.from(seen.values());
}
