import { runCode, isPassing } from "../../runtimes";
import type { ExerciseLesson, Lesson, ReadingLesson } from "../../data/types";
import type { IngestEvent, PipelineOptions, PipelineStats } from "./types";
import { cacheWrite } from "./cache";
import { parseJson, slug, pad } from "./helpers";

const MAX_RETRIES = 3;

export async function validateExerciseWithRetry(
  lesson: ExerciseLesson,
  ctx: {
    bookId: string;
    chapterIndex: number;
    stubId: string;
    onProgress: PipelineOptions["onProgress"];
    emit: (e: Omit<IngestEvent, "timestamp">) => void;
    checkAbort: () => void;
    stats: PipelineStats;
    pushStats: () => void;
    callLlm: (
      cmd: string,
      args: Record<string, unknown>,
      label: string,
      ectx: { stage: IngestEvent["stage"]; chapter?: number; lesson?: string },
    ) => Promise<string>;
  },
): Promise<Lesson> {
  let current = lesson;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    ctx.checkAbort();
    ctx.stats.validationAttempts += 1;
    ctx.pushStats();
    ctx.onProgress(
      `Validating exercise (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
      current.title,
    );

    const failure = await validateOnce(current);
    if (!failure) {
      ctx.emit({
        level: "info",
        stage: "validate",
        chapter: ctx.chapterIndex + 1,
        lesson: ctx.stubId,
        message: `done: validated "${current.title}"`,
      });
      return current;
    }

    ctx.stats.validationFailures += 1;
    ctx.pushStats();
    ctx.emit({
      level: "warn",
      stage: "validate",
      chapter: ctx.chapterIndex + 1,
      lesson: ctx.stubId,
      message: `fail attempt ${attempt + 1}: ${failure}`,
    });

    if (attempt === MAX_RETRIES) {
      ctx.onProgress(
        `warn: exercise couldn't be validated, demoting to reading`,
        current.title,
      );
      ctx.stats.demotedExercises += 1;
      ctx.pushStats();
      ctx.emit({
        level: "error",
        stage: "validate",
        chapter: ctx.chapterIndex + 1,
        lesson: ctx.stubId,
        message: `demoted to reading after ${MAX_RETRIES} failures`,
      });
      return demoteToReading(current, failure);
    }

    // Ask the LLM to fix it. Parse BEFORE caching so a truncated or malformed
    // retry doesn't become a permanent bad cache entry.
    const retryKey = `lessons/chapter-${pad(ctx.chapterIndex + 1)}/${slug(
      ctx.stubId,
    )}.retry-${attempt + 1}.json`;
    const rawFixed = await ctx.callLlm(
      "retry_exercise",
      {
        originalLesson: JSON.stringify(current),
        failureReason: failure,
      },
      `retry_exercise attempt ${attempt + 1}`,
      { stage: "retry", chapter: ctx.chapterIndex + 1, lesson: ctx.stubId },
    );
    current = parseJson<ExerciseLesson>(rawFixed, `${current.id} retry ${attempt + 1}`);
    await cacheWrite(ctx.bookId, retryKey, rawFixed);
  }

  return current;
}

/// Returns null if the exercise passes BOTH gates (solution passes every test,
/// starter fails at least one). Otherwise returns a human-readable reason.
export async function validateOnce(lesson: ExerciseLesson): Promise<string | null> {
  // Non-JS/TS/Python exercises can't run in-browser for full validation yet.
  // Trust the LLM on those for now; Rust uses the Playground and Swift is
  // run-only. Validation is still a huge quality lift for the languages we
  // *can* run.
  const runnable =
    lesson.language === "javascript" ||
    lesson.language === "typescript" ||
    lesson.language === "python";
  if (!runnable) return null;

  // Gate 1: solution must pass every test.
  const solRes = await runCode(lesson.language, lesson.solution, lesson.tests);
  if (!isPassing(solRes)) {
    const failingTests = solRes.tests?.filter((t) => !t.passed) ?? [];
    const first = failingTests[0];
    const errText = solRes.error ? ` [runtime error] ${solRes.error}` : "";
    const testText = first
      ? ` [first failing test] "${first.name}": ${first.error ?? "(no message)"}`
      : "";
    return `Reference solution failed validation.${errText}${testText}`;
  }

  // Gate 2: starter must fail at least one test (otherwise the task is trivial).
  const startRes = await runCode(lesson.language, lesson.starter, lesson.tests);
  if (isPassing(startRes)) {
    return "Starter code already passes every test — there's nothing for the user to solve. Add TODOs to the starter.";
  }

  return null;
}

export function demoteToReading(lesson: ExerciseLesson, reason: string): ReadingLesson {
  return {
    id: lesson.id,
    kind: "reading",
    title: lesson.title + " (demoted)",
    body:
      lesson.body +
      `\n\n---\n\n*(This exercise was demoted to a reading lesson after ${MAX_RETRIES} validation failures: ${reason})*` +
      "\n\n## Reference solution\n\n```" +
      lesson.language +
      "\n" +
      lesson.solution +
      "\n```",
  };
}
