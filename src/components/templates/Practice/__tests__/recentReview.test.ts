/// The welcome-back review scope: most-recent 1-2 chapters only,
/// harvestable-material gated. See recentReview.ts.

import { describe, expect, it } from "vitest";
import {
  buildRecentReviewScope,
  SCOPE_MIN_ITEMS,
} from "@/components/templates/Practice/recentReview";
import type { Completion } from "@/hooks/useProgress";
import type { Course, Lesson } from "@/data/types";

const SOLUTION = [
  "function clamp(n) {",
  "  if (n >= 10) {",
  "    return 10 - 1;",
  "  }",
  "  return n && n > 0 ? n : 0;",
  "}",
].join("\n");

function exercise(id: string): Lesson {
  return {
    id,
    title: `Exercise ${id}`,
    kind: "exercise",
    body: "Do it.",
    starter: "",
    solution: SOLUTION,
  } as unknown as Lesson;
}

function course(id: string, chapters: Array<[string, string[]]>): Course {
  return {
    id,
    title: `Course ${id}`,
    language: "javascript",
    chapters: chapters.map(([chId, lessonIds]) => ({
      id: chId,
      title: `Chapter ${chId}`,
      lessons: lessonIds.map(exercise),
    })),
  } as unknown as Course;
}

function done(courseId: string, lessonId: string, at: number): Completion {
  return { course_id: courseId, lesson_id: lessonId, completed_at: at };
}

const COURSES = [
  course("c1", [
    ["ch1", ["a", "b"]],
    ["ch2", ["c", "d"]],
  ]),
  course("c2", [["ch1", ["e", "f"]]]),
];

describe("buildRecentReviewScope", () => {
  it("scopes to the most recently studied chapters, newest first, capped at 2", () => {
    const completed = new Set(["c1:a", "c1:b", "c1:c", "c2:e"]);
    const history = [
      done("c1", "a", 100), // oldest — c1/ch1
      done("c2", "e", 200), // c2/ch1
      done("c1", "c", 300), // newest — c1/ch2
    ];
    const scope = buildRecentReviewScope(COURSES, completed, history);
    expect(scope).not.toBeNull();
    expect(scope!.chapters.map((c) => `${c.courseId}:${c.chapterId}`)).toEqual([
      "c1:ch2",
      "c2:ch1",
    ]);
    // Lesson keys: completed lessons inside those two chapters ONLY —
    // c1/ch1's a+b are excluded despite being completed.
    expect([...scope!.lessonKeys].sort()).toEqual(["c1:c", "c2:e"]);
    expect(scope!.itemCount).toBeGreaterThanOrEqual(SCOPE_MIN_ITEMS);
  });

  it("returns null with no history", () => {
    expect(buildRecentReviewScope(COURSES, new Set(["c1:a"]), [])).toBeNull();
  });

  it("ignores completions whose course is gone and nulls out when nothing maps", () => {
    const history = [done("ghost", "x", 500)];
    expect(
      buildRecentReviewScope(COURSES, new Set(["ghost:x"]), history),
    ).toBeNull();
  });

  it("returns null when the scope yields too little material", () => {
    // A reading-only chapter harvests nothing.
    const thin = [
      course("c3", [
        [
          "ch1",
          [], // no lessons at all beyond the reading stub below
        ],
      ]),
    ];
    (thin[0].chapters[0].lessons as unknown as Lesson[]).push({
      id: "r1",
      title: "Reading",
      kind: "reading",
      body: "words",
    } as unknown as Lesson);
    const history = [done("c3", "r1", 100)];
    expect(
      buildRecentReviewScope(thin, new Set(["c3:r1"]), history),
    ).toBeNull();
  });
});
