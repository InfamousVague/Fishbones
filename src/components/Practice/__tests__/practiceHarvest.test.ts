/// Regression coverage for the harvest's tolerance of "summary"
/// lessons — the stripped placeholders the WEB build stores before a
/// course's full body loads.
///
/// The bug: `webStorage` (src/lib/storage.ts) saves courses through
/// `summarise()`, which blanks every lesson `body` to "" and drops the
/// heavy payloads — crucially `questions` (quizzes) and `blocks`
/// (exercises). `harvestPracticeItems` includes EVERY lesson of any
/// course with at least one completion, so a learner who finished a
/// lesson in a quiz-containing course (e.g. cleared a whole book) made
/// the harvester walk a summary quiz lesson and call
/// `lesson.questions.forEach(...)` on `undefined` — throwing
/// "Cannot read properties of undefined (reading 'forEach')". That
/// throw happens inside the `practiceDue` useMemo in App.tsx, so it
/// takes down the entire <App> and the ErrorBoundary shows
/// "Something went wrong" on boot.

import { describe, expect, it } from "vitest";
import {
  harvestCompletedItems,
  harvestPracticeItems,
} from "../practiceHarvest";
import type { Course, Lesson, QuizLesson } from "../../../data/types";

/// Faithful reproduction of the per-lesson stripping the web build
/// applies before persisting a course — see `summarise()` in
/// `src/lib/storage.ts`. Keeps id/title/kind + light metadata, blanks
/// `body`, and drops `questions` / `blocks`. This is the exact shape
/// that used to crash the harvest.
function summariseLesson(lesson: Lesson): Lesson {
  const src = lesson as unknown as Record<string, unknown>;
  const stripped: Record<string, unknown> = {
    id: src.id,
    title: src.title,
    kind: src.kind,
    body: "",
  };
  if ("language" in src) stripped.language = src.language;
  if ("difficulty" in src) stripped.difficulty = src.difficulty;
  if ("topic" in src) stripped.topic = src.topic;
  return stripped as unknown as Lesson;
}

function courseWith(lessons: Lesson[]): Course {
  return {
    id: "course-1",
    title: "Test Course",
    language: "javascript",
    chapters: [{ id: "ch-1", title: "Chapter 1", lessons }],
  };
}

function completed(...keys: string[]): ReadonlySet<string> {
  return new Set(keys);
}

const fullQuiz: QuizLesson = {
  id: "quiz-1",
  title: "Checkpoint",
  kind: "quiz",
  body: "Answer these.",
  questions: [
    { kind: "mcq", prompt: "2 + 2?", options: ["3", "4"], correctIndex: 1 },
    { kind: "short", prompt: "Declaration keyword?", accept: ["let"] },
  ],
};

const summaryQuiz = summariseLesson(fullQuiz);

describe("harvestPracticeItems — summary (web) lessons", () => {
  it("does not crash when a completed quiz lesson is a summary stub (no questions)", () => {
    const courses = [courseWith([summaryQuiz])];
    // The learner completed the quiz lesson, but the in-memory course is
    // still seeded as summaries (full body not yet loaded). This is the
    // exact boot-time crash repro — it must NOT throw.
    expect(() =>
      harvestPracticeItems(courses, completed("course-1:quiz-1")),
    ).not.toThrow();
    expect(harvestPracticeItems(courses, completed("course-1:quiz-1"))).toEqual(
      [],
    );
  });

  it("skips a summary quiz even when a *different* lesson in the course is completed", () => {
    // `hasAnyCompletion` qualifies the whole course off any single
    // completion, so a finished reading lesson still drags the summary
    // quiz through `appendItemsForLesson`.
    const reading: Lesson = {
      id: "read-1",
      title: "Intro",
      kind: "reading",
      body: "Some prose.",
    };
    const courses = [
      courseWith([summariseLesson(reading), summaryQuiz]),
    ];
    expect(() =>
      harvestPracticeItems(courses, completed("course-1:read-1")),
    ).not.toThrow();
    expect(harvestPracticeItems(courses, completed("course-1:read-1"))).toEqual(
      [],
    );
  });

  it("still harvests one item per question once the full quiz body is present", () => {
    // Positive control: the happy path must keep working after the guard.
    const courses = [courseWith([fullQuiz])];
    const items = harvestPracticeItems(courses, completed("course-1:quiz-1"));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual([
      "course-1:quiz-1:mcq:q0",
      "course-1:quiz-1:short:q1",
    ]);
    expect(items.map((i) => i.kind)).toEqual(["mcq", "short"]);
  });

  it("harvests nothing from an untouched course (no completions)", () => {
    const courses = [courseWith([fullQuiz])];
    expect(harvestPracticeItems(courses, completed())).toEqual([]);
  });
});

describe("harvestPracticeItems — malformed full lesson (defence in depth)", () => {
  it("tolerates a non-summary quiz lesson missing its questions array", () => {
    // Non-empty body ⇒ NOT a summary stub, so this exercises the
    // per-branch `?? []` guard rather than the up-front skip: a genuinely
    // malformed authored quiz must not take down the harvest either.
    const malformed = {
      id: "quiz-1",
      title: "Bad quiz",
      kind: "quiz",
      body: "real body, but the author forgot the questions",
    } as unknown as Lesson;
    const courses = [courseWith([malformed])];
    expect(() =>
      harvestPracticeItems(courses, completed("course-1:quiz-1")),
    ).not.toThrow();
    expect(harvestPracticeItems(courses, completed("course-1:quiz-1"))).toEqual(
      [],
    );
  });
});

describe("harvestPracticeItems — Parsons (order-the-lines)", () => {
  const exercise = {
    id: "ex-1",
    title: "Sum a slice",
    kind: "exercise",
    body: "Implement it.",
    starter: "fn sum() {}",
    solution:
      "fn sum(xs: &[i32]) -> i32 {\n    let mut t = 0;\n    for x in xs {\n        t += x;\n    }\n    t\n}",
    tests: "...",
  } as unknown as Lesson;

  it("produces a parsons atom from a short exercise solution", () => {
    const items = harvestPracticeItems(
      [courseWith([exercise])],
      completed("course-1:ex-1"),
    );
    const parsons = items.find((i) => i.kind === "parsons");
    expect(parsons).toBeTruthy();
    expect(parsons!.id).toBe("course-1:ex-1:parsons:parsons");
    expect(parsons!.parsons!.lines).toEqual([
      "fn sum(xs: &[i32]) -> i32 {",
      "    let mut t = 0;",
      "    for x in xs {",
      "        t += x;",
      "    }",
      "    t",
      "}",
    ]);
  });

  it("skips solutions too short or too long for a good puzzle", () => {
    const tooShort = {
      id: "s",
      title: "s",
      kind: "exercise",
      body: "b",
      starter: "",
      solution: "let x = 1;\nlet y = 2;",
      tests: "",
    } as unknown as Lesson;
    expect(
      harvestPracticeItems(
        [courseWith([tooShort])],
        completed("course-1:s"),
      ).find((i) => i.kind === "parsons"),
    ).toBeUndefined();

    const tooLong = {
      id: "l",
      title: "l",
      kind: "exercise",
      body: "b",
      starter: "",
      solution: Array.from({ length: 12 }, (_, i) => `line${i};`).join("\n"),
      tests: "",
    } as unknown as Lesson;
    expect(
      harvestPracticeItems(
        [courseWith([tooLong])],
        completed("course-1:l"),
      ).find((i) => i.kind === "parsons"),
    ).toBeUndefined();
  });
});

describe("harvestCompletedItems — summary lessons", () => {
  it("does not crash on a completed summary quiz lesson", () => {
    // The stricter "only completed lessons" harvester funnels through the
    // same `appendItemsForLesson`, so it inherits the same protection.
    const courses = [courseWith([summaryQuiz])];
    expect(() =>
      harvestCompletedItems(courses, completed("course-1:quiz-1")),
    ).not.toThrow();
    expect(
      harvestCompletedItems(courses, completed("course-1:quiz-1")),
    ).toEqual([]);
  });
});
