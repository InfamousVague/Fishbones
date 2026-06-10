import { useMemo } from "react";
import type { Course } from "../data/types";
import type { Completion } from "./useProgress";

/// XP award per lesson kind. Readings are cheap; quizzes take more effort;
/// exercises (passing tests) are the biggest win. These numbers are V1 —
/// tune based on pacing feedback.
const XP_PER_KIND: Record<string, number> = {
  reading: 5,
  quiz: 10,
  exercise: 20,
  mixed: 20,
};

export interface StreakAndXp {
  /// Total XP earned across all courses.
  xp: number;
  /// Current streak in consecutive calendar days. A streak is "alive"
  /// today if there's a completion today OR yesterday (grace period —
  /// we don't want to punish the learner for one sleepy evening); if the
  /// most recent completion is >= 2 days ago, streak is 0.
  streakDays: number;
  /// Longest historical streak, for a future "best" badge.
  longestStreakDays: number;
  /// Total lessons completed across all courses.
  lessonsCompleted: number;
  /// Current level. Uses a gentle curve — level N requires N*(N+1)/2 * 10 XP
  /// total (10, 30, 60, 100, 150, 210, ...) so leveling feels earned at
  /// the top end without punishing beginners.
  level: number;
  /// XP into the current level.
  xpIntoLevel: number;
  /// XP required to complete the current level.
  xpForLevel: number;
}

/// Compute streak + XP purely from the completions list and the loaded
/// courses. No extra DB tables needed — lesson kinds are looked up from
/// the in-memory course data.
///
/// `frozenDays` (optional) is a set of `YYYY-MM-DD` keys the learner
/// has spent a streak shield on. Each entry counts as a phantom
/// completion in the streak calculation (NOT XP — frozen days don't
/// award lesson XP, they just keep the run alive). Defaults to an
/// empty set so existing call sites that don't know about freezes
/// keep their original behavior.
export function useStreakAndXp(
  history: Completion[],
  courses: Course[],
  frozenDays?: ReadonlySet<string>,
): StreakAndXp {
  return useMemo(
    () => computeStreakAndXp(history, courses, frozenDays),
    [history, courses, frozenDays],
  );
}

function computeStreakAndXp(
  history: Completion[],
  courses: Course[],
  frozenDays?: ReadonlySet<string>,
): StreakAndXp {
  // Build a quick lookup: `${courseId}:${lessonId}` -> kind
  const kindByKey = new Map<string, string>();
  for (const course of courses) {
    for (const ch of course.chapters) {
      for (const l of ch.lessons) {
        kindByKey.set(`${course.id}:${l.id}`, l.kind);
      }
    }
  }

  let xp = 0;
  for (const c of history) {
    const kind = kindByKey.get(`${c.course_id}:${c.lesson_id}`) ?? "reading";
    xp += XP_PER_KIND[kind] ?? XP_PER_KIND.reading;
  }

  const { current: streakDays, longest: longestStreakDays } = computeStreaks(
    history,
    frozenDays,
  );

  const { level, xpIntoLevel, xpForLevel } = levelFor(xp);

  return {
    xp,
    streakDays,
    longestStreakDays,
    lessonsCompleted: history.length,
    level,
    xpIntoLevel,
    xpForLevel,
  };
}

/// Walk the set of distinct calendar days (in local time) where a completion
/// happened — UNION'd with any frozen days the learner has spent shields on
/// — and find (a) the current streak ending today-or-yesterday and (b) the
/// longest consecutive run ever. Calendar day is the YYYY-MM-DD of
/// the completion timestamp in the user's local timezone — we don't bother
/// with UTC because streak UX is about "did I practice today".
function computeStreaks(
  history: Completion[],
  frozenDays?: ReadonlySet<string>,
): { current: number; longest: number } {
  if (history.length === 0 && (!frozenDays || frozenDays.size === 0)) {
    return { current: 0, longest: 0 };
  }

  const days = new Set<string>();
  for (const c of history) days.add(localDayKey(c.completed_at));
  // Treat each frozen day as a phantom completion. Doing this before
  // the streak walk means the longest-run + current-run computation
  // both naturally honor freezes — no special-casing in either path.
  if (frozenDays) for (const d of frozenDays) days.add(d);
  const sorted = Array.from(days).sort();

  // Longest run by walking the sorted unique days.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (isNextDay(sorted[i - 1], sorted[i])) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak: count back from the most recent day as long as the run
  // is contiguous. "Alive" = most recent day is today or yesterday.
  const today = localDayKey(Math.floor(Date.now() / 1000));
  const yesterday = localDayKey(Math.floor(Date.now() / 1000) - 86400);
  const latest = sorted[sorted.length - 1];
  let current = 0;
  if (latest === today || latest === yesterday) {
    current = 1;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (isNextDay(sorted[i], sorted[i + 1])) current += 1;
      else break;
    }
  }

  return { current, longest };
}

function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  // YYYY-MM-DD in local time. Month/day are zero-padded.
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function isNextDay(prev: string, curr: string): boolean {
  const p = new Date(prev + "T00:00:00");
  const c = new Date(curr + "T00:00:00");
  const diff = c.getTime() - p.getTime();
  return diff === 86400 * 1000;
}

/// Level curve: N requires N*(N+1)/2 * 10 XP total.
///   Level 1: 10
///   Level 2: 30
///   Level 3: 60
///   Level 4: 100
///   Level 5: 150
///   Level 6: 210
///   Level 7: 280
///   Level 8: 360
///   Level 9: 450
///   Level 10: 550
function levelFor(xp: number): { level: number; xpIntoLevel: number; xpForLevel: number } {
  let level = 0;
  let prevThreshold = 0;
  let threshold = 10;
  while (xp >= threshold) {
    level += 1;
    prevThreshold = threshold;
    threshold = ((level + 1) * (level + 2) * 10) / 2;
  }
  return {
    level,
    xpIntoLevel: xp - prevThreshold,
    xpForLevel: threshold - prevThreshold,
  };
}
