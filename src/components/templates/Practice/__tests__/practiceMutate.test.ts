import { describe, it, expect } from "vitest";
import { makeBugPuzzle, seedFromId } from "@/components/templates/Practice/practiceMutate";

describe("makeBugPuzzle", () => {
  it("flips a comparison operator and reports the broken line", () => {
    const lines = [
      "function f(a, b) {",
      "  return a === b;",
      "}",
    ];
    const p = makeBugPuzzle(lines, 0);
    expect(p).toBeTruthy();
    // exactly one line differs
    const diffs = p!.lines.filter((l, i) => l !== lines[i]);
    expect(diffs).toHaveLength(1);
    expect(p!.lines[p!.bugLine]).toContain("!==");
    expect(p!.original).toBe("  return a === b;");
    expect(p!.category).toBe("comparison operator");
  });

  it("inverts a boolean keyword", () => {
    const p = makeBugPuzzle(["let ok = true;", "noop();", "more();"], 0);
    expect(p).toBeTruthy();
    expect(p!.lines[p!.bugLine]).toContain("false");
    expect(p!.category).toBe("boolean value");
  });

  it("is deterministic for a given seed", () => {
    const lines = ["if (a < b && c) {", "  x = a == b;", "  y = d || e;", "}"];
    const a = makeBugPuzzle(lines, 12345);
    const b = makeBugPuzzle(lines, 12345);
    expect(a).toEqual(b);
  });

  it("varies the chosen line across seeds when multiple are mutatable", () => {
    const lines = ["a === b;", "c && d;", "e || f;", "g == h;"];
    const picks = new Set<number>();
    for (let s = 0; s < 30; s++) picks.add(makeBugPuzzle(lines, s)!.bugLine);
    expect(picks.size).toBeGreaterThan(1);
  });

  it("returns null when no line carries a mutatable token", () => {
    expect(makeBugPuzzle(["let x = 1;", "foo(x);", "bar(x);"], 0)).toBeNull();
  });

  it("skips comment lines", () => {
    // The only `===` is inside a comment → no mutation.
    expect(makeBugPuzzle(["// a === b", "doThing();"], 0)).toBeNull();
  });

  it("seedFromId is stable and numeric", () => {
    expect(seedFromId("x:y:spotbug")).toBe(seedFromId("x:y:spotbug"));
    expect(typeof seedFromId("z")).toBe("number");
  });
});
