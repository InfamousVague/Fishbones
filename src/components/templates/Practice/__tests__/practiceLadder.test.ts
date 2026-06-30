import { describe, it, expect } from "vitest";
import {
  pickWarmupItems,
  comboMultiplier,
  comboTierLabel,
  xpForCorrect,
  warmupAnswerText,
  presentationFor,
  BASE_XP,
} from "@/components/templates/Practice/practiceLadder";
import type { PracticeItem, PracticeRecord } from "@/components/templates/Practice/types";

function mcq(id: string, correctIndex = 0): PracticeItem {
  return {
    id,
    kind: "mcq",
    courseId: "c",
    courseTitle: "C",
    lessonId: "l",
    lessonTitle: "L",
    question: {
      kind: "mcq",
      prompt: `prompt ${id}`,
      options: ["alpha", "beta", "gamma"],
      correctIndex,
    },
  } as PracticeItem;
}

function short(id: string, accept: string[]): PracticeItem {
  return {
    id,
    kind: "short",
    courseId: "c",
    courseTitle: "C",
    lessonId: "l",
    lessonTitle: "L",
    question: { kind: "short", prompt: `p ${id}`, accept },
  } as PracticeItem;
}

function blocks(id: string): PracticeItem {
  return {
    id,
    kind: "blocks",
    courseId: "c",
    courseTitle: "C",
    lessonId: "l",
    lessonTitle: "L",
    blocks: { lines: [], solution: [] },
  } as unknown as PracticeItem;
}

function rec(id: string, lastSeen: number, over: Partial<PracticeRecord> = {}): PracticeRecord {
  return {
    id,
    lastSeen,
    streak: 0,
    attempts: 1,
    correct: 1,
    ease: 2.5,
    intervalMs: 0,
    dueAt: lastSeen,
    ...over,
  };
}

describe("pickWarmupItems", () => {
  it("returns recently-seen mcq/short items, newest first, capped at n", () => {
    const items = [mcq("a"), short("b", ["x"]), mcq("c"), blocks("d")];
    const records = new Map<string, PracticeRecord>([
      ["a", rec("a", 100)],
      ["b", rec("b", 300)],
      ["c", rec("c", 200)],
      ["d", rec("d", 999)], // blocks — must be excluded
    ]);
    const out = pickWarmupItems(items, records, 2);
    expect(out.map((i) => i.id)).toEqual(["b", "c"]); // newest two, no blocks
  });

  it("skips never-seen items (no record)", () => {
    const items = [mcq("a"), mcq("b")];
    const records = new Map<string, PracticeRecord>([["a", rec("a", 100)]]);
    expect(pickWarmupItems(items, records, 5).map((i) => i.id)).toEqual(["a"]);
  });

  it("returns empty for a fresh deck", () => {
    expect(pickWarmupItems([mcq("a")], new Map(), 4)).toEqual([]);
  });
});

describe("comboMultiplier", () => {
  it("steps up at the right thresholds", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(2)).toBe(1);
    expect(comboMultiplier(3)).toBe(1.25);
    expect(comboMultiplier(5)).toBe(1.5);
    expect(comboMultiplier(8)).toBe(2);
    expect(comboMultiplier(12)).toBe(3);
  });
  it("labels only above 1x", () => {
    expect(comboTierLabel(2)).toBe("");
    expect(comboTierLabel(5)).toBe("1.5×");
  });
});

describe("xpForCorrect", () => {
  it("scales base XP by the combo multiplier", () => {
    expect(xpForCorrect(1)).toBe(BASE_XP); // 1x
    expect(xpForCorrect(5)).toBe(Math.round(BASE_XP * 1.5));
    expect(xpForCorrect(12)).toBe(BASE_XP * 3);
  });
  it("leans higher for harder atoms", () => {
    expect(xpForCorrect(1, "hard")).toBeGreaterThan(xpForCorrect(1, "easy"));
  });
});

describe("warmupAnswerText", () => {
  it("returns the correct mcq option", () => {
    expect(warmupAnswerText(mcq("a", 1))).toBe("beta");
  });
  it("returns the first accepted short answer", () => {
    expect(warmupAnswerText(short("b", ["forty-two", "42"]))).toBe("forty-two");
  });
});

describe("presentationFor", () => {
  it("demotes struggled quiz atoms to recognition", () => {
    expect(presentationFor(mcq("a"), rec("a", 0, { ease: 1.5 }))).toBe("recognize");
  });
  it("keeps well-eased quiz atoms at recall", () => {
    expect(presentationFor(mcq("a"), rec("a", 0, { ease: 2.5 }))).toBe("recall");
  });
  it("always reconstructs blocks", () => {
    expect(presentationFor(blocks("d"), rec("d", 0, { ease: 1.3 }))).toBe("reconstruct");
  });
});
