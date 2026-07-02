/// Coverage for the daily mini-challenge logic: deterministic day
/// picking, event folding for each of the five challenge shapes,
/// completion latching, and the localStorage persistence guards.

import { beforeEach, describe, expect, it } from "vitest";
import {
  ALL_CHALLENGE_IDS,
  CHALLENGE_DEFS,
  DAILY_CHALLENGE_COUNT,
  SPEEDRUN_WINDOW_MS,
  challengeDayKey,
  challengeProgress,
  emptyDayState,
  foldGrade,
  loadChallengeState,
  pickDailyChallenges,
  saveChallengeState,
  type ChallengeDayState,
  type ChallengeGrade,
} from "@/components/templates/Practice/practiceChallengeLogic";

/// Local-noon anchor so day-key math never straddles midnight.
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();
const DAY = challengeDayKey(NOON);

function grade(overrides: Partial<ChallengeGrade> = {}): ChallengeGrade {
  return { correct: true, kind: "mcq", at: NOON, ...overrides };
}

function fold(
  grades: ChallengeGrade[],
  start: ChallengeDayState = emptyDayState(DAY),
): ChallengeDayState {
  return grades.reduce(foldGrade, start);
}

describe("pickDailyChallenges", () => {
  it("picks three distinct known challenges, deterministically", () => {
    const a = pickDailyChallenges(DAY);
    const b = pickDailyChallenges(DAY);
    expect(a).toEqual(b);
    expect(a).toHaveLength(DAILY_CHALLENGE_COUNT);
    expect(new Set(a).size).toBe(DAILY_CHALLENGE_COUNT);
    for (const id of a) expect(ALL_CHALLENGE_IDS).toContain(id);
  });

  it("rotates across days", () => {
    const picks = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      picks.add(pickDailyChallenges(`2026-06-${String(d).padStart(2, "0")}`).join(","));
    }
    // 30 days must produce more than one distinct trio — a constant
    // pick would mean the hash isn't feeding the shuffle.
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("foldGrade — perfect5", () => {
  it("latches after five consecutive corrects", () => {
    const s = fold(Array.from({ length: 5 }, (_, i) => grade({ at: NOON + i * 1000 })));
    expect(challengeProgress(s, "perfect5")).toEqual({
      current: 5,
      target: 5,
      done: true,
    });
  });

  it("a miss resets the run but keeps the best run", () => {
    const s = fold([
      grade(),
      grade(),
      grade(),
      grade(),
      grade({ correct: false }),
      grade(),
    ]);
    expect(s.run).toBe(1);
    expect(s.bestRun).toBe(4);
    expect(challengeProgress(s, "perfect5").done).toBe(false);
    expect(challengeProgress(s, "perfect5").current).toBe(4);
  });

  it("never unlatches once done", () => {
    let s = fold(Array.from({ length: 5 }, () => grade()));
    s = foldGrade(s, grade({ correct: false }));
    expect(challengeProgress(s, "perfect5").done).toBe(true);
    expect(challengeProgress(s, "perfect5").current).toBe(5);
  });
});

describe("foldGrade — speedrun", () => {
  it("completes when five grades land inside one 90s window", () => {
    const s = fold(
      Array.from({ length: 5 }, (_, i) => grade({ at: NOON + i * 20_000 })),
    );
    // 5 grades spanning 80s — inside the window.
    expect(challengeProgress(s, "speedrun").done).toBe(true);
  });

  it("counts wrong answers too (graded, not correct)", () => {
    const s = fold(
      Array.from({ length: 5 }, (_, i) =>
        grade({ correct: i % 2 === 0, at: NOON + i * 10_000 }),
      ),
    );
    expect(challengeProgress(s, "speedrun").done).toBe(true);
  });

  it("stays incomplete when grades are spread out", () => {
    const s = fold(
      Array.from({ length: 6 }, (_, i) =>
        grade({ at: NOON + i * (SPEEDRUN_WINDOW_MS + 1000) }),
      ),
    );
    expect(s.bestBurst).toBe(1);
    expect(challengeProgress(s, "speedrun").done).toBe(false);
  });
});

describe("foldGrade — bugHunter", () => {
  it("counts only CORRECT spotbug cards", () => {
    const s = fold([
      grade({ kind: "spotbug" }),
      grade({ kind: "spotbug", correct: false }),
      grade({ kind: "mcq" }),
      grade({ kind: "spotbug" }),
    ]);
    expect(s.bugs).toBe(2);
    expect(challengeProgress(s, "bugHunter")).toEqual({
      current: 2,
      target: 3,
      done: false,
    });
    const done = foldGrade(s, grade({ kind: "spotbug" }));
    expect(challengeProgress(done, "bugHunter").done).toBe(true);
  });
});

describe("foldGrade — polyglot", () => {
  it("needs corrects in two DISTINCT languages", () => {
    const one = fold([
      grade({ language: "python" }),
      grade({ language: "python" }),
    ]);
    expect(challengeProgress(one, "polyglot").current).toBe(1);
    expect(challengeProgress(one, "polyglot").done).toBe(false);

    const two = foldGrade(one, grade({ language: "javascript" }));
    expect(challengeProgress(two, "polyglot").done).toBe(true);
  });

  it("ignores wrong answers and unknown languages", () => {
    const s = fold([
      grade({ language: "python", correct: false }),
      grade({ language: undefined }),
    ]);
    expect(s.langs).toEqual([]);
  });
});

describe("foldGrade — comeback", () => {
  it("counts corrects on weak-set items only", () => {
    const s = fold([
      grade({ isWeak: true }),
      grade({ isWeak: true, correct: false }),
      grade({ isWeak: false }),
      grade({ isWeak: true }),
      grade({ isWeak: true }),
    ]);
    expect(s.weakHits).toBe(3);
    expect(challengeProgress(s, "comeback").done).toBe(true);
  });
});

describe("foldGrade — day rollover", () => {
  it("restarts counters when a grade lands on a new local day", () => {
    const s = fold([grade(), grade(), grade()]);
    const nextDay = NOON + 24 * 60 * 60 * 1000;
    const rolled = foldGrade(s, grade({ at: nextDay }));
    expect(rolled.dayKey).toBe(challengeDayKey(nextDay));
    expect(rolled.run).toBe(1);
    expect(rolled.bestRun).toBe(1);
    expect(rolled.done).toEqual({});
  });

  it("does not mutate the previous state", () => {
    const s = emptyDayState(DAY);
    const snapshot = JSON.parse(JSON.stringify(s));
    foldGrade(s, grade());
    expect(s).toEqual(snapshot);
  });
});

describe("persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    const s = fold([grade(), grade()]);
    saveChallengeState(s);
    expect(loadChallengeState(NOON)).toEqual(s);
  });

  it("resets when the stored day is stale", () => {
    const s = fold([grade(), grade()]);
    saveChallengeState(s);
    const tomorrow = NOON + 24 * 60 * 60 * 1000;
    expect(loadChallengeState(tomorrow)).toEqual(
      emptyDayState(challengeDayKey(tomorrow)),
    );
  });

  it("survives a corrupt payload", () => {
    localStorage.setItem("libre:practice:challenges:v1", "{nope");
    expect(loadChallengeState(NOON)).toEqual(emptyDayState(DAY));
    localStorage.setItem("libre:practice:challenges:v1", '{"dayKey":3}');
    expect(loadChallengeState(NOON)).toEqual(emptyDayState(DAY));
  });
});

describe("challengeProgress", () => {
  it("caps current at the target", () => {
    const s = fold(Array.from({ length: 9 }, (_, i) => grade({ at: NOON + i })));
    for (const id of ALL_CHALLENGE_IDS) {
      const p = challengeProgress(s, id);
      expect(p.current).toBeLessThanOrEqual(CHALLENGE_DEFS[id].target);
    }
  });
});
