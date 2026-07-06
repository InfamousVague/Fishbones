/// XP derivation weights + level curve + streak math. These lock the
/// documented per-kind awards (Reading 5 / Quiz 10 / Exercise 20 /
/// Mixed 20 — the values the public docs advertise) so a table tweak
/// can't silently ship without a docs update, and they pin the
/// fallback behavior: a completion whose lesson can't be resolved in
/// the loaded course data still counts as a reading (5 XP), never 0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeStreakAndXp,
  xpForLessonKind,
} from "@/hooks/useStreakAndXp";
import type { Course } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";

/// Minimal course shape — computeStreakAndXp only reads
/// `id` + `chapters[].lessons[].{id, kind}`.
function course(
  id: string,
  lessons: Array<{ id: string; kind: string }>,
): Course {
  return {
    id,
    title: id,
    language: "javascript",
    chapters: [{ title: "ch1", lessons }],
  } as unknown as Course;
}

function done(
  courseId: string,
  lessonId: string,
  completedAt: number,
): Completion {
  return { course_id: courseId, lesson_id: lessonId, completed_at: completedAt };
}

// Fixed clock — noon, well away from midnight/DST edges, so the
// "today / yesterday" streak walk is deterministic.
const NOW = new Date("2026-07-06T12:00:00");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const DAY = 86400;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("xpForLessonKind", () => {
  it("awards the documented value per lesson kind", () => {
    expect(xpForLessonKind("reading")).toBe(5);
    expect(xpForLessonKind("quiz")).toBe(10);
    expect(xpForLessonKind("exercise")).toBe(20);
    expect(xpForLessonKind("mixed")).toBe(20);
  });

  it("keeps backward-compat values for retired lesson kinds", () => {
    expect(xpForLessonKind("cloze")).toBe(10);
    expect(xpForLessonKind("micropuzzle")).toBe(10);
    expect(xpForLessonKind("puzzle")).toBe(15);
  });

  it("falls back to the reading award for unknown / missing kinds", () => {
    expect(xpForLessonKind(undefined)).toBe(5);
    expect(xpForLessonKind("holodeck")).toBe(5);
  });
});

describe("computeStreakAndXp — XP derivation", () => {
  const c = course("js", [
    { id: "l-read", kind: "reading" },
    { id: "l-quiz", kind: "quiz" },
    { id: "l-ex", kind: "exercise" },
    { id: "l-mixed", kind: "mixed" },
  ]);

  it("weights each completion by its lesson kind", () => {
    const history = [
      done("js", "l-read", NOW_SEC),
      done("js", "l-quiz", NOW_SEC),
      done("js", "l-ex", NOW_SEC),
      done("js", "l-mixed", NOW_SEC),
    ];
    const out = computeStreakAndXp(history, [c]);
    // 5 + 10 + 20 + 20
    expect(out.xp).toBe(55);
    expect(out.lessonsCompleted).toBe(4);
  });

  it("counts a completion whose course/lesson is not loaded as a reading (5), never 0", () => {
    // e.g. a course completed on another device that isn't installed
    // here, or a lesson removed by a course update. XP is derived
    // from history on every recompute, so these must keep counting.
    const history = [done("gone-course", "gone-lesson", NOW_SEC)];
    const out = computeStreakAndXp(history, [c]);
    expect(out.xp).toBe(5);
  });

  it("derives retroactively from the full history (no per-grant state)", () => {
    // Same history, recomputed against richer course data → the total
    // reflects the true kinds. This is the property that makes past
    // reading/exercise completions count the moment kinds resolve.
    const history = [done("js", "l-ex", NOW_SEC - DAY), done("js", "l-quiz", NOW_SEC)];
    expect(computeStreakAndXp(history, []).xp).toBe(10); // both unresolved → 5 + 5
    expect(computeStreakAndXp(history, [c]).xp).toBe(30); // resolved → 20 + 10
  });

  it("frozen (shielded) days keep the streak alive but award no XP", () => {
    const history = [done("js", "l-ex", NOW_SEC - 2 * DAY)];
    const frozen = new Set([
      localDayKey(NOW_SEC - DAY),
      localDayKey(NOW_SEC),
    ]);
    const out = computeStreakAndXp(history, [c], frozen);
    expect(out.xp).toBe(20); // only the real completion pays out
    expect(out.streakDays).toBe(3);
  });
});

describe("computeStreakAndXp — level curve", () => {
  const c = course("js", [
    { id: "q1", kind: "quiz" },
    { id: "q2", kind: "quiz" },
    { id: "q3", kind: "quiz" },
  ]);

  it("starts at level 0 needing 10 XP", () => {
    const out = computeStreakAndXp([], [c]);
    expect(out.level).toBe(0);
    expect(out.xpIntoLevel).toBe(0);
    expect(out.xpForLevel).toBe(10);
  });

  it("crosses thresholds on the N*(N+1)/2*10 curve", () => {
    // One quiz (10 XP) → level 1; three quizzes (30 XP) → level 2.
    const one = computeStreakAndXp([done("js", "q1", NOW_SEC)], [c]);
    expect(one.level).toBe(1);
    const three = computeStreakAndXp(
      [done("js", "q1", NOW_SEC), done("js", "q2", NOW_SEC), done("js", "q3", NOW_SEC)],
      [c],
    );
    expect(three.level).toBe(2);
    expect(three.xpIntoLevel).toBe(0);
    expect(three.xpForLevel).toBe(30); // 60 - 30
  });
});

describe("computeStreakAndXp — streaks", () => {
  const c = course("js", [{ id: "r", kind: "reading" }]);

  it("counts consecutive days ending today", () => {
    const history = [
      done("js", "a", NOW_SEC - 2 * DAY),
      done("js", "b", NOW_SEC - DAY),
      done("js", "c", NOW_SEC),
    ];
    const out = computeStreakAndXp(history, [c]);
    expect(out.streakDays).toBe(3);
    expect(out.longestStreakDays).toBe(3);
  });

  it("is 0 when the last completion is 2+ days old (but longest survives)", () => {
    const history = [
      done("js", "a", NOW_SEC - 3 * DAY),
      done("js", "b", NOW_SEC - 2 * DAY),
    ];
    const out = computeStreakAndXp(history, [c]);
    expect(out.streakDays).toBe(0);
    expect(out.longestStreakDays).toBe(2);
  });
});

/// Local-time YYYY-MM-DD — mirrors the hook's private localDayKey so
/// the frozen-day test builds keys the same way the app does.
function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
