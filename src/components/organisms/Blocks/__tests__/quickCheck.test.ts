/// Derivation invariants for the quick-check exercise modes (cloze /
/// bug hunt). These modes are structurally graded off the authored
/// answer key, so the derivations must be airtight: the correct
/// answer must always be present exactly once, distractors must
/// never duplicate it, and everything must be deterministic (same
/// lesson → same puzzle across sessions and devices).

import { describe, expect, it } from "vitest";
import type { BlocksData, ExerciseLesson } from "@/data/types";
import {
  deriveBug,
  deriveCloze,
  hashString,
  pickExerciseMode,
} from "../QuickCheckView";

const DATA: BlocksData = {
  template: [
    "fn main() {",
    "    let x = __SLOT_a__;",
    "    let y = __SLOT_b__;",
    "    println!(\"{}\", __SLOT_c__);",
    "}",
  ].join("\n"),
  slots: [
    { id: "a", expectedBlockId: "b1" },
    { id: "b", expectedBlockId: "b2" },
    { id: "c", expectedBlockId: "b3" },
  ],
  pool: [
    { id: "b1", code: "1" },
    { id: "b2", code: "2" },
    { id: "b3", code: "x + y" },
    { id: "d1", code: "x - y", decoy: true },
    { id: "d2", code: "0", decoy: true },
  ],
};

function lessonWith(blocks: BlocksData | undefined, id = "lesson-1"): ExerciseLesson {
  return {
    id,
    title: "t",
    kind: "exercise",
    body: "",
    starter: "",
    solution: "",
    tests: "",
    blocks,
  } as unknown as ExerciseLesson;
}

describe("hashString", () => {
  it("is deterministic and spreads ids", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});

describe("pickExerciseMode", () => {
  it("falls back to blocks without authored data", () => {
    expect(pickExerciseMode(lessonWith(undefined))).toBe("blocks");
    expect(
      pickExerciseMode(lessonWith({ ...DATA, slots: [], pool: [] })),
    ).toBe("blocks");
  });

  it("is deterministic per lesson id", () => {
    const l = lessonWith(DATA, "stable-id");
    expect(pickExerciseMode(l)).toBe(pickExerciseMode(l));
  });

  it("never picks bug for data without decoys", () => {
    const noDecoys: BlocksData = {
      ...DATA,
      pool: DATA.pool.filter((b) => !b.decoy),
    };
    for (let i = 0; i < 40; i++) {
      const mode = pickExerciseMode(lessonWith(noDecoys, `lesson-${i}`));
      expect(mode).not.toBe("bug");
    }
  });

  it("rotates across modes over many lessons", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(pickExerciseMode(lessonWith(DATA, `lesson-${i}`)));
    }
    expect(seen).toContain("blocks");
    expect(seen).toContain("cloze");
    expect(seen).toContain("bug");
  });
});

describe("deriveCloze", () => {
  it("includes the expected block exactly once and fills every other slot", () => {
    for (let seed = 0; seed < 25; seed++) {
      const p = deriveCloze(DATA, seed);
      const expectedHits = p.choices.filter((c) => c.id === p.expectedId);
      expect(expectedHits).toHaveLength(1);
      // Non-target slots are all pre-filled with their canonical code.
      const otherSlots = DATA.slots.filter((s) => s.id !== p.targetSlotId);
      for (const slot of otherSlots) {
        const canonical = DATA.pool.find((b) => b.id === slot.expectedBlockId)!;
        expect(p.fills[slot.id]).toBe(canonical.code);
      }
      // The target slot is NOT pre-filled.
      expect(p.fills[p.targetSlotId]).toBeUndefined();
      // Choice row stays phone-sized.
      expect(p.choices.length).toBeLessThanOrEqual(4);
      expect(p.choices.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("is deterministic for a given seed", () => {
    expect(deriveCloze(DATA, 7)).toEqual(deriveCloze(DATA, 7));
  });
});

describe("deriveBug", () => {
  it("returns null without decoys", () => {
    expect(
      deriveBug({ ...DATA, pool: DATA.pool.filter((b) => !b.decoy) }, 3),
    ).toBeNull();
  });

  it("plants exactly one decoy and keeps the fix canonical", () => {
    for (let seed = 0; seed < 25; seed++) {
      const p = deriveBug(DATA, seed)!;
      expect(p).not.toBeNull();
      const target = DATA.slots.find((s) => s.id === p.targetSlotId)!;
      const canonical = DATA.pool.find((b) => b.id === target.expectedBlockId)!;
      // Target slot holds a DECOY's code, not the canonical fill…
      const decoyCodes = DATA.pool.filter((b) => b.decoy).map((b) => b.code);
      expect(decoyCodes).toContain(p.fills[p.targetSlotId]);
      // …and the fix restores the canonical code.
      expect(p.fixCode).toBe(canonical.code);
      // Every other slot is correctly filled.
      for (const slot of DATA.slots) {
        if (slot.id === p.targetSlotId) continue;
        const c = DATA.pool.find((b) => b.id === slot.expectedBlockId)!;
        expect(p.fills[slot.id]).toBe(c.code);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    expect(deriveBug(DATA, 11)).toEqual(deriveBug(DATA, 11));
  });
});
