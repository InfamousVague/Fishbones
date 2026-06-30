/// Publish the iOS widget + watchOS snapshot whenever the source
/// data changes.
///
/// The snapshot is a single JSON blob in the shared App Group
/// container at `widget-snapshot.v1.json`. WidgetKit's
/// TimelineProvider + the watch app both read it; we are the
/// only writer.
///
/// What lives in the snapshot:
///
///   - `streak`     — current + longest streak, today's completion
///                    state, level + XP. Drives the Streak widget.
///   - `continueLesson` — the lesson the learner should resume:
///                    most-recently-touched not-yet-complete lesson,
///                    with course / chapter / lesson titles + a
///                    deep link path. Drives the Continue widget.
///   - `quickChallenge` — first item out of the smart-mix practice
///                    queue: short prompt + course + lesson +
///                    deep link. Drives the Quick Challenge widget.
///
/// Cross-platform safety: the underlying Tauri command is a no-op
/// on non-iOS platforms (the App Group container only exists on
/// iOS), so this hook fires harmlessly on desktop + web — the
/// `invoke` returns success without doing anything.
///
/// Debounced via `useEffect`'s natural batching plus a 250ms
/// `setTimeout` so a burst of state changes (e.g. mid-lesson
/// progress updates) collapses into one write per quiet period.

import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Course, Lesson } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";
import type { StreakAndXp } from "@/hooks/useStreakAndXp";
import { harvestPracticeItems } from "@/components/templates/Practice/practiceHarvest";
import { buildQueue } from "@/components/templates/Practice/practiceQueue";
import { loadAllRecords } from "@/components/templates/Practice/practiceStore";
import { isMobile } from "@/lib/platform";

interface SnapshotInput {
  courses: readonly Course[];
  completed: ReadonlySet<string>;
  history: readonly Completion[];
  stats: StreakAndXp;
}

interface ContinueLesson {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  chapterTitle: string;
  /// 0..1 fraction of lessons in the parent course that are done.
  /// Drives the small progress bar in the Continue widget.
  courseProgressPct: number;
  /// Minutes' read estimate (rough — body length / 200wpm). Optional.
  estimatedReadMinutes: number | null;
  /// Deep link the widget triggers via `widgetURL(...)`. The main
  /// app's Tauri deep-link handler routes
  /// `libre://lesson/<courseId>/<lessonId>` to the lesson view.
  deepLinkPath: string;
}

interface QuickChallenge {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  /// "blocks" | "mcq" | "short" — drives the icon + framing copy.
  kind: string;
  /// One-line summary of what the learner is being asked, suitable
  /// for the widget's body line. Truncated server-side here so the
  /// Swift view can lay it out without re-truncating.
  promptShort: string;
  deepLinkPath: string;
}

interface Snapshot {
  version: 1;
  writtenAt: string;
  streak: {
    current: number;
    longest: number;
    completedToday: boolean;
    completedTodayCount: number;
    level: number;
    xp: number;
    xpIntoLevel: number;
    xpForLevel: number;
    /// What target the current streak is reaching for — drives the
    /// ring fill on the watch + small Streak widget. Mirrors the
    /// ladder used by Profile's RingGauge.
    nextTarget: number;
  };
  continueLesson: ContinueLesson | null;
  quickChallenge: QuickChallenge | null;
}

/// Streak ring ladder — keeps the visual ring "always reaching for
/// the next milestone" rather than fixed at e.g. 7. Same shape as
/// `ringStreakTarget()` in ProfileView.tsx; duplicated here so the
/// widget snapshot doesn't pull in the entire profile module.
function nextStreakTarget(streak: number): number {
  for (const t of [3, 7, 14, 30, 60, 100, 365]) {
    if (streak < t) return t;
  }
  return Math.max(streak + 30, 365);
}

/// Compute the lesson the learner should "Continue" — the most
/// recently completed lesson's NEXT sibling (or the same lesson if
/// it's still in-progress). Returns null when there's nothing in
/// progress (no completions, or every started course is finished).
function pickContinueLesson(
  courses: readonly Course[],
  completed: ReadonlySet<string>,
  history: readonly Completion[],
): ContinueLesson | null {
  // Find the most recent completion. The course it belongs to is
  // our pick; the lesson is whichever in that course comes next
  // (by chapter/lesson order) and isn't yet completed.
  const sorted = history
    .slice()
    .sort((a, b) => b.completed_at - a.completed_at);
  for (const h of sorted) {
    const course = courses.find((c) => c.id === h.course_id);
    if (!course) continue;
    // Walk the chapter/lesson DAG from this point forward looking
    // for the first uncompleted lesson.
    let foundCurrent = false;
    for (
      let chIdx = 0;
      chIdx < course.chapters.length;
      chIdx++
    ) {
      const ch = course.chapters[chIdx];
      for (let lsIdx = 0; lsIdx < ch.lessons.length; lsIdx++) {
        const lesson = ch.lessons[lsIdx];
        const key = `${course.id}:${lesson.id}`;
        if (!foundCurrent && lesson.id === h.lesson_id) {
          foundCurrent = true;
          continue; // skip the just-completed lesson, take the next uncompleted
        }
        if (foundCurrent && !completed.has(key)) {
          return formatContinue(course, ch.title, lesson, completed);
        }
      }
    }
    // Walked off the end of this course — it's complete. Try the
    // next-most-recent completion's course.
  }
  // No history yet — pick the first lesson of the first course
  // that has any.
  for (const course of courses) {
    for (const ch of course.chapters) {
      const lesson = ch.lessons[0];
      if (lesson) return formatContinue(course, ch.title, lesson, completed);
    }
  }
  return null;
}

function formatContinue(
  course: Course,
  chapterTitle: string,
  lesson: Lesson,
  completed: ReadonlySet<string>,
): ContinueLesson {
  let total = 0;
  let done = 0;
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      total += 1;
      if (completed.has(`${course.id}:${l.id}`)) done += 1;
    }
  }
  const pct = total > 0 ? done / total : 0;
  const minutes = estimateReadMinutes(lesson);
  return {
    courseId: course.id,
    courseTitle: course.title,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    chapterTitle,
    courseProgressPct: Number(pct.toFixed(3)),
    estimatedReadMinutes: minutes,
    deepLinkPath: `libre://lesson/${course.id}/${lesson.id}`,
  };
}

function estimateReadMinutes(lesson: Lesson): number | null {
  const body = ("body" in lesson ? lesson.body : "") || "";
  if (!body) return null;
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words === 0) return null;
  // 200 wpm reading speed — same anchor estimateReadingMinutes uses.
  return Math.max(1, Math.round(words / 200));
}

/// Pull the next-best practice item from the smart-mix queue and
/// format it for the Quick Challenge widget. Returns null when the
/// deck is empty (no quizzes / blocks puzzles in any touched course).
function pickQuickChallenge(
  courses: readonly Course[],
  completed: ReadonlySet<string>,
): QuickChallenge | null {
  try {
    const items = harvestPracticeItems(courses, completed);
    if (items.length === 0) return null;
    const records = loadAllRecords();
    const queue = buildQueue("smart", items, records, {
      limit: 1,
      seed: Date.now(),
      now: Date.now(),
    });
    const top = queue[0];
    if (!top) return null;
    const promptShort = (() => {
      if (top.kind === "blocks" && top.blocks) {
        return (
          top.blocks.prompt?.slice(0, 80) ??
          "Place the blocks in the right slots"
        );
      }
      if (top.question?.kind === "mcq" || top.question?.kind === "short") {
        return top.question.prompt.slice(0, 80);
      }
      return top.lessonTitle;
    })();
    return {
      courseId: top.courseId,
      courseTitle: top.courseTitle,
      lessonId: top.lessonId,
      lessonTitle: top.lessonTitle,
      kind: top.kind,
      promptShort,
      deepLinkPath: "libre://practice",
    };
  } catch {
    return null;
  }
}

function buildSnapshot(input: SnapshotInput): Snapshot {
  const completedToday = new Date();
  completedToday.setHours(0, 0, 0, 0);
  const dayStartSec = Math.floor(completedToday.getTime() / 1000);
  const todays = input.history.filter((h) => h.completed_at >= dayStartSec);

  return {
    version: 1,
    writtenAt: new Date().toISOString(),
    streak: {
      current: input.stats.streakDays,
      longest: input.stats.longestStreakDays,
      completedToday: todays.length > 0,
      completedTodayCount: todays.length,
      level: input.stats.level,
      xp: input.stats.xp,
      xpIntoLevel: input.stats.xpIntoLevel,
      xpForLevel: input.stats.xpForLevel,
      nextTarget: nextStreakTarget(input.stats.streakDays),
    },
    continueLesson: pickContinueLesson(
      input.courses,
      input.completed,
      input.history,
    ),
    quickChallenge: pickQuickChallenge(input.courses, input.completed),
  };
}

/// Run on mobile only — desktop has no widgets and the underlying
/// Tauri command is a no-op there anyway, but skipping the entire
/// hook on desktop also avoids the snapshot-build cost (the
/// practice harvester walks every course on every change).
export function useWidgetSnapshot(input: SnapshotInput): void {
  // Memo the snapshot so we don't churn the publish-debounce timer
  // on every render. Only re-publish when one of the underlying
  // arrays/sets actually changes.
  const snapshot = useMemo(() => {
    if (!isMobile) return null;
    return buildSnapshot(input);
  }, [input]);

  // Track the last-published JSON string so we skip writes that
  // would replace the file with byte-identical content. Cheap
  // `JSON.stringify` + string compare; saves a Tauri IPC + a
  // disk write whenever a re-render produces the same data.
  const lastPublishedRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (snapshot === null) return;
    const json = JSON.stringify(snapshot);
    if (json === lastPublishedRef.current) return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      lastPublishedRef.current = json;
      void invoke("publish_widget_snapshot", { json }).catch((err) => {
        // Failure is non-fatal — widgets stay at their last value.
        // We log so a missing entitlement / wrong group id surfaces
        // in dev mode, but production users never see it.
        console.warn("[widget-snapshot] publish failed:", err);
        // Reset the cache so the next change retries.
        lastPublishedRef.current = null;
      });
    }, 250);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [snapshot]);
}
