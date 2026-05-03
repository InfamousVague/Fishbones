/// "Verify course" — automated walk-through of every lesson in a
/// course (or every loaded course). Two flavours:
///
///   1. **Watch mode** (`verifyCourse`): drives the UI via the
///      verifier bus so the editor visibly flips to the solution,
///      the run button visibly fires, the next button visibly
///      advances, and quiz options visibly turn green. The user
///      ends with 100% completion and a recording-quality demo of
///      the whole course playing itself.
///
///   2. **Headless mode** (`verifyCourseHeadless`): bypasses the UI
///      entirely and calls `runFiles` directly with each lesson's
///      solution. Faster, useful for "just tell me which lessons
///      pass" without the visual.
///
/// Why both: cmd+K wants the watch experience; future CI / "verify
/// before publish" workflows want the headless one. They share the
/// `collectVerifyTargets` walker so the unit of work stays
/// consistent.
///
/// Watch-mode flow per lesson:
///
///   selectLesson(course.id, lesson.id)            ← caller's job
///   await lessonReady event                        ← LessonView mounted
///   delay(lessonViewMs)                            ← user reads prose
///
///   exercise/mixed:
///     dispatch revealSolution                      ← editor swaps
///     delay(solutionRevealMs)                      ← user sees it
///     dispatch run                                 ← Run fires
///     await runResult event                        ← tests finished
///     delay(postRunMs)                             ← admire greens
///   quiz:
///     dispatch answerQuiz                          ← chips turn green
///     await lessonComplete event                   ← all correct
///     delay(postQuizMs)
///   reading:
///     (nothing — Next click below marks it complete)
///
///   markComplete(course.id, lesson.id)             ← belt-and-braces
///   dispatch next                                  ← Next button click
///   loop

import { runFiles, isPassing, type RunResult } from "../runtimes";
import { deriveSolutionFiles } from "./workbenchFiles";
import {
  isExerciseKind,
  isQuiz,
  type Course,
  type Lesson,
} from "../data/types";
import {
  dispatchCommand,
  waitForEvent,
  type VerifierEvent,
} from "./verifierBus";

export type VerifyTargetKind = "exercise" | "reading" | "quiz" | "other";

export interface VerifyTarget {
  courseId: string;
  chapterId: string;
  lesson: Lesson;
  kind: VerifyTargetKind;
}

export interface LessonVerifyResult {
  target: VerifyTarget;
  /// True for exercises that ran clean, quizzes that completed,
  /// reading sections we visited.
  passed: boolean;
  /// Tracked separately so the overlay can render skipped rows
  /// distinctly from failures (e.g. desktop-only on web build).
  skipped: boolean;
  skipReason?: string;
  /// Only populated for exercise/mixed kinds — quiz/reading have
  /// nothing meaningful to report here.
  result?: RunResult | null;
  durationMs: number;
}

export interface VerifyProgress {
  index: number;
  total: number;
  current: VerifyTarget | null;
}

export interface WatchVerifyOptions {
  /// Required: tell the verifier how to navigate the UI to a
  /// lesson. Wired by App.tsx to its existing `selectLesson`.
  selectLesson: (courseId: string, lessonId: string) => void;
  /// Required: belt-and-braces completion mark. Even though every
  /// "happy path" already fires `markCompletedAndCelebrate` via
  /// LessonView / QuizView callbacks, we mark again on success so
  /// edge cases (last reading lesson where Next is disabled,
  /// quiz race during teardown) can't leave a course stuck at
  /// 99%.
  markComplete: (courseId: string, lessonId: string) => void;
  onProgress?: (p: VerifyProgress) => void;
  onResult?: (r: LessonVerifyResult) => void;
  signal?: AbortSignal;
  /// Wait this long for `lessonReady` after `selectLesson`. If the
  /// view doesn't mount in time we record a failure and move on
  /// rather than stalling the whole run.
  lessonReadyTimeoutMs?: number;
  /// Wait this long for `runResult` after dispatching `run`. The
  /// runtime's own internal timeouts can be shorter; this is a
  /// hard ceiling.
  runTimeoutMs?: number;
  /// Wait this long for `lessonComplete` after dispatching
  /// `answerQuiz`.
  quizTimeoutMs?: number;
  /// Visual pacing knobs (ms). Defaults are tuned for "watchable
  /// but not glacial".
  lessonViewMs?: number; // pause after navigation, before action
  solutionRevealMs?: number; // pause after editor flips to solution
  postRunMs?: number; // pause to admire green test rows
  postQuizMs?: number; // pause after quiz completes
  postReadingMs?: number; // pause for plain reading lessons
}

const DEFAULTS = {
  lessonReadyTimeoutMs: 5_000,
  runTimeoutMs: 30_000,
  quizTimeoutMs: 10_000,
  lessonViewMs: 800,
  solutionRevealMs: 600,
  postRunMs: 1_000,
  postQuizMs: 700,
  postReadingMs: 1_200,
};

/// Walk a course in document order and tag every lesson with the
/// kind of verification it'll get. Reading / exercise / mixed /
/// quiz are first-class; everything else (puzzle, cloze,
/// micropuzzle — already filtered out by `filterCourseForDesktop`
/// before they reach us, but defended against here) becomes
/// `kind: "other"` and gets skipped.
export function collectVerifyTargets(course: Course): VerifyTarget[] {
  const out: VerifyTarget[] = [];
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      let kind: VerifyTargetKind;
      if (isExerciseKind(l)) kind = "exercise";
      else if (isQuiz(l)) kind = "quiz";
      else if (l.kind === "reading") kind = "reading";
      else kind = "other";
      out.push({ courseId: course.id, chapterId: ch.id, lesson: l, kind });
    }
  }
  return out;
}

export async function verifyCourse(
  course: Course,
  opts: WatchVerifyOptions,
): Promise<LessonVerifyResult[]> {
  const targets = collectVerifyTargets(course);
  const results: LessonVerifyResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    if (opts.signal?.aborted) break;
    const target = targets[i];
    opts.onProgress?.({ index: i, total: targets.length, current: target });

    // Navigate. The "next" click at the END of the previous
    // iteration usually already moved us here; this re-call is
    // idempotent and keeps the verifier authoritative.
    opts.selectLesson(course.id, target.lesson.id);

    let result: LessonVerifyResult;
    try {
      result = await processOne(target, opts);
    } catch (e) {
      result = {
        target,
        passed: false,
        skipped: false,
        skipReason: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      };
    }

    // Belt-and-braces: mark complete on success regardless of
    // which UI path normally would. See note on
    // `WatchVerifyOptions.markComplete`.
    if (result.passed) {
      opts.markComplete(course.id, target.lesson.id);
    }

    results.push(result);
    opts.onResult?.(result);

    // Click "Next" — visible affordance + advances the lesson.
    // Skipped on the last iteration because there's no next
    // neighbor for handleNext to navigate to.
    if (i < targets.length - 1) {
      // Brief pause so the user can see the result settle before
      // the next click fires.
      await delay(120);
      dispatchCommand({ type: "next", lessonId: target.lesson.id });
    }
  }

  opts.onProgress?.({ index: targets.length, total: targets.length, current: null });
  return results;
}

async function processOne(
  target: VerifyTarget,
  opts: WatchVerifyOptions,
): Promise<LessonVerifyResult> {
  const started = Date.now();
  const lessonId = target.lesson.id;

  // Wait for the LessonView to mount + announce ready. Without
  // this guard the verifier would race with React's reconciliation
  // and dispatch commands the previous LessonView still owns.
  try {
    await waitForEvent(
      (e) => e.type === "lessonReady" && e.lessonId === lessonId,
      {
        timeoutMs: opts.lessonReadyTimeoutMs ?? DEFAULTS.lessonReadyTimeoutMs,
        signal: opts.signal,
      },
    );
  } catch (e) {
    return {
      target,
      passed: false,
      skipped: false,
      skipReason: `lesson did not mount: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - started,
    };
  }

  await delay(opts.lessonViewMs ?? DEFAULTS.lessonViewMs);

  if (target.kind === "exercise") {
    const lesson = target.lesson;
    const hasSolution =
      ("solutionFiles" in lesson && lesson.solutionFiles && lesson.solutionFiles.length > 0) ||
      ("solution" in lesson && typeof lesson.solution === "string" && lesson.solution.trim().length > 0);
    if (!hasSolution) {
      return {
        target,
        passed: false,
        skipped: true,
        skipReason: "no solution defined",
        durationMs: Date.now() - started,
      };
    }

    dispatchCommand({ type: "revealSolution", lessonId });
    await delay(opts.solutionRevealMs ?? DEFAULTS.solutionRevealMs);

    dispatchCommand({ type: "run", lessonId });

    let evt: VerifierEvent;
    try {
      evt = await waitForEvent(
        (e) => e.type === "runResult" && e.lessonId === lessonId,
        {
          timeoutMs: opts.runTimeoutMs ?? DEFAULTS.runTimeoutMs,
          signal: opts.signal,
        },
      );
    } catch (e) {
      return {
        target,
        passed: false,
        skipped: false,
        skipReason: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      };
    }

    const runEvt = evt as Extract<VerifierEvent, { type: "runResult" }>;
    // Desktop-only runtimes return a `desktopOnly` shape from
    // runFiles — surface that as a skip rather than a failure.
    if (runEvt.result?.desktopOnly) {
      return {
        target,
        passed: false,
        skipped: true,
        skipReason: `desktop-only (${runEvt.result.desktopOnly.language})`,
        result: runEvt.result,
        durationMs: Date.now() - started,
      };
    }

    await delay(opts.postRunMs ?? DEFAULTS.postRunMs);

    return {
      target,
      passed: runEvt.passed,
      skipped: false,
      result: runEvt.result,
      durationMs: Date.now() - started,
    };
  }

  if (target.kind === "quiz") {
    dispatchCommand({ type: "answerQuiz", lessonId });
    try {
      await waitForEvent(
        (e) =>
          e.type === "lessonComplete" &&
          e.courseId === target.courseId &&
          e.lessonId === lessonId,
        {
          timeoutMs: opts.quizTimeoutMs ?? DEFAULTS.quizTimeoutMs,
          signal: opts.signal,
        },
      );
    } catch (e) {
      return {
        target,
        passed: false,
        skipped: false,
        skipReason: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      };
    }
    await delay(opts.postQuizMs ?? DEFAULTS.postQuizMs);
    return {
      target,
      passed: true,
      skipped: false,
      durationMs: Date.now() - started,
    };
  }

  if (target.kind === "reading") {
    await delay(opts.postReadingMs ?? DEFAULTS.postReadingMs);
    return {
      target,
      passed: true,
      skipped: false,
      durationMs: Date.now() - started,
    };
  }

  return {
    target,
    passed: false,
    skipped: true,
    skipReason: `unsupported kind: ${target.lesson.kind}`,
    durationMs: Date.now() - started,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface MultiCourseProgress {
  courseIndex: number;
  totalCourses: number;
  currentCourse: Course | null;
  perCourse: VerifyProgress;
}

export interface MultiCourseOptions extends Omit<WatchVerifyOptions, "onProgress"> {
  onProgress?: (p: MultiCourseProgress) => void;
  onCourseComplete?: (course: Course, results: LessonVerifyResult[]) => void;
}

export async function verifyAllCourses(
  courses: Course[],
  opts: MultiCourseOptions,
): Promise<Array<{ course: Course; results: LessonVerifyResult[] }>> {
  const out: Array<{ course: Course; results: LessonVerifyResult[] }> = [];
  for (let i = 0; i < courses.length; i++) {
    if (opts.signal?.aborted) break;
    const course = courses[i];
    const results = await verifyCourse(course, {
      ...opts,
      onProgress: (perCourse) =>
        opts.onProgress?.({
          courseIndex: i,
          totalCourses: courses.length,
          currentCourse: course,
          perCourse,
        }),
    });
    out.push({ course, results });
    opts.onCourseComplete?.(course, results);
  }
  return out;
}

export function tally(
  results: LessonVerifyResult[],
): { passed: number; failed: number; skipped: number } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.skipped) skipped++;
    else if (r.passed) passed++;
    else failed++;
  }
  return { passed, failed, skipped };
}

// ───────────────────────────────────────────────────────────────────
// Headless mode — kept around for tests / CI / future "verify
// before publish" tooling. Skips the UI and calls runFiles
// directly with each exercise's solution.
// ───────────────────────────────────────────────────────────────────

export interface HeadlessOptions {
  signal?: AbortSignal;
  onResult?: (r: LessonVerifyResult) => void;
  onProgress?: (p: VerifyProgress) => void;
  perLessonTimeoutMs?: number;
}

export async function verifyCourseHeadless(
  course: Course,
  opts: HeadlessOptions = {},
): Promise<LessonVerifyResult[]> {
  const targets = collectVerifyTargets(course).filter(
    (t) => t.kind === "exercise",
  );
  const results: LessonVerifyResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    if (opts.signal?.aborted) break;
    const target = targets[i];
    opts.onProgress?.({ index: i, total: targets.length, current: target });
    const r = await runOneHeadless(target, opts);
    results.push(r);
    opts.onResult?.(r);
  }
  opts.onProgress?.({ index: targets.length, total: targets.length, current: null });
  return results;
}

async function runOneHeadless(
  target: VerifyTarget,
  opts: HeadlessOptions,
): Promise<LessonVerifyResult> {
  const started = Date.now();
  const lesson = target.lesson;
  const hasSolution =
    ("solutionFiles" in lesson && lesson.solutionFiles && lesson.solutionFiles.length > 0) ||
    ("solution" in lesson && typeof lesson.solution === "string" && lesson.solution.trim().length > 0);
  if (!hasSolution) {
    return {
      target,
      passed: false,
      skipped: true,
      skipReason: "no solution",
      durationMs: Date.now() - started,
    };
  }
  if (!isExerciseKind(lesson)) {
    return {
      target,
      passed: false,
      skipped: true,
      skipReason: "not an exercise",
      durationMs: Date.now() - started,
    };
  }
  const files = deriveSolutionFiles(lesson);
  const harness = lesson.harness;
  const timeoutMs = opts.perLessonTimeoutMs ?? 30_000;
  let result: RunResult | null = null;
  try {
    result = await Promise.race([
      runFiles(lesson.language, files, lesson.tests, undefined, undefined, harness),
      new Promise<RunResult>((resolve) =>
        setTimeout(
          () =>
            resolve({
              logs: [{ level: "error", text: `Headless verify timed out after ${timeoutMs}ms` }],
              error: "timeout",
              durationMs: timeoutMs,
            }),
          timeoutMs,
        ),
      ),
    ]);
  } catch (e) {
    return {
      target,
      passed: false,
      skipped: false,
      skipReason: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  }
  if (result?.desktopOnly) {
    return {
      target,
      passed: false,
      skipped: true,
      skipReason: `desktop-only (${result.desktopOnly.language})`,
      result,
      durationMs: Date.now() - started,
    };
  }
  return {
    target,
    passed: !!result && isPassing(result),
    skipped: false,
    result,
    durationMs: Date.now() - started,
  };
}
