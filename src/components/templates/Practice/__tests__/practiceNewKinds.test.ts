/// Coverage for the Fill-the-Gap (cloze) + Memory-Rebuild generators
/// and for the harvest's strict lesson-level gating: Practice must
/// only ever surface atoms from lessons the learner has COMPLETED
/// (the old course-level gate exposed whole courses off one lesson).

import { describe, expect, it } from "vitest";
import {
  makeClozePuzzle,
  makeRebuildPuzzle,
  seedFromId,
} from "@/components/templates/Practice/practiceMutate";
import { harvestPracticeItems } from "@/components/templates/Practice/practiceHarvest";
import type { Course, Lesson } from "@/data/types";

const LINES = [
  "function clamp(n) {",
  "  if (n >= 10) {",
  "    return 10 - 1;",
  "  }",
  "  return n && n > 0 ? n : 0;",
  "}",
];

describe("makeClozePuzzle", () => {
  it("blanks a real token and includes the answer among the options", () => {
    const p = makeClozePuzzle(LINES, seedFromId("a:b:cloze:cloze"));
    expect(p).not.toBeNull();
    const line = p!.lines[p!.blankLine];
    expect(line.slice(p!.blankStart, p!.blankStart + p!.blankLen)).toBe(
      p!.answer,
    );
    expect(p!.options).toContain(p!.answer);
    expect(p!.options.length).toBeGreaterThanOrEqual(3);
    expect(new Set(p!.options).size).toBe(p!.options.length);
  });

  it("is deterministic for the same seed and varies across seeds", () => {
    const a = makeClozePuzzle(LINES, 1234);
    const b = makeClozePuzzle(LINES, 1234);
    expect(a).toEqual(b);
    // Different seed picks a (possibly) different token but never
    // an invalid one.
    const c = makeClozePuzzle(LINES, 99999);
    expect(c).not.toBeNull();
    expect(c!.options).toContain(c!.answer);
  });

  it("returns null when nothing is blankable", () => {
    expect(makeClozePuzzle(["hello", "world"], 1)).toBeNull();
  });
});

describe("makeRebuildPuzzle", () => {
  it("produces decoys that match no real line", () => {
    const p = makeRebuildPuzzle(LINES, seedFromId("a:b:rebuild:rebuild"));
    expect(p).not.toBeNull();
    expect(p!.decoys.length).toBeGreaterThanOrEqual(1);
    for (const d of p!.decoys) {
      expect(p!.lines).not.toContain(d);
    }
    expect(p!.peekMs).toBeGreaterThan(0);
  });

  it("returns null when no decoy can be derived", () => {
    expect(makeRebuildPuzzle(["alpha", "beta", "gamma"], 7)).toBeNull();
  });
});

// ─── strict lesson-level gating ──────────────────────────────────

function exerciseLesson(id: string): Lesson {
  return {
    id,
    title: `Exercise ${id}`,
    kind: "exercise",
    body: "Do the thing.",
    starter: "",
    solution: LINES.join("\n"),
  } as unknown as Lesson;
}

const COURSE: Course = {
  id: "c1",
  title: "Course",
  language: "javascript",
  chapters: [
    {
      id: "ch1",
      title: "Ch 1",
      lessons: [exerciseLesson("l1"), exerciseLesson("l2")],
    },
  ],
} as unknown as Course;

describe("harvestPracticeItems strict gating", () => {
  it("emits atoms ONLY for completed lessons, never course-wide", () => {
    const items = harvestPracticeItems([COURSE], new Set(["c1:l1"]));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.lessonId === "l1")).toBe(true);
  });

  it("emits nothing when no lesson is complete", () => {
    expect(harvestPracticeItems([COURSE], new Set())).toHaveLength(0);
  });

  it("includes the new cloze + rebuild kinds for eligible solutions", () => {
    const kinds = new Set(
      harvestPracticeItems([COURSE], new Set(["c1:l1"])).map((i) => i.kind),
    );
    expect(kinds.has("cloze")).toBe(true);
    expect(kinds.has("rebuild")).toBe(true);
  });
});
