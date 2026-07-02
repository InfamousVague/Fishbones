/// UI-contract coverage for the two newest session formats:
///
///   - PracticeCloze ("Fill the Gap") — tap an option, grade against
///     `answer`, reveal fills the blank + explains the token class.
///   - PracticeRebuild ("Memory Rebuild") — peek phase → build phase,
///     tap-to-append pool chips, strict order + zero-decoys grading,
///     deterministic one-time pool shuffle.
///
/// Mirrors the koanCard test convention: mock `useT` to echo keys so
/// assertions don't couple to English copy.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/i18n", () => ({
  useT: () => (k: string) => k,
}));

import PracticeCloze from "@/components/templates/Practice/PracticeCloze";
import PracticeRebuild, {
  gradeRebuildStack,
  rebuildPoolOrder,
} from "@/components/templates/Practice/PracticeRebuild";

const CLOZE_LINE = "  return a >= b;";
const CLOZE = {
  lines: ["function f(a, b) {", CLOZE_LINE, "}"],
  blankLine: 1,
  blankStart: CLOZE_LINE.indexOf(">="),
  blankLen: 2,
  answer: ">=",
  options: ["<=", ">=", "==", "!="],
  category: "comparison operator",
};

describe("PracticeCloze", () => {
  it("grades true when the correct option is tapped", () => {
    const onResult = vi.fn();
    render(
      <PracticeCloze cloze={CLOZE} committed={false} onResult={onResult} />,
    );
    fireEvent.click(screen.getByText(">="));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it("grades false when a distractor is tapped", () => {
    const onResult = vi.fn();
    render(
      <PracticeCloze cloze={CLOZE} committed={false} onResult={onResult} />,
    );
    fireEvent.click(screen.getByText("<="));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it("hides the token while open, fills + reveals once committed, and locks taps", () => {
    const onResult = vi.fn();
    const { rerender } = render(
      <PracticeCloze cloze={CLOZE} committed={false} onResult={onResult} />,
    );
    // Pre-commit: the answer only exists as an option, never in the code.
    expect(screen.getAllByText(">=")).toHaveLength(1);
    expect(screen.queryByText("practice.clozeReveal")).toBeNull();

    rerender(
      <PracticeCloze cloze={CLOZE} committed={true} onResult={onResult} />,
    );
    // Committed: reveal line + the blank chip now carries the answer.
    expect(screen.getByText("practice.clozeReveal")).toBeTruthy();
    expect(screen.getAllByText(">=").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText("<="));
    expect(onResult).not.toHaveBeenCalled();
  });
});

const REBUILD = {
  lines: ["a();", "b();", "c();"],
  decoys: ["a(x);"],
  peekMs: 60000, // long — tests always skip via the button
};

function renderRebuild(onResult: (correct: boolean) => void) {
  return render(
    <PracticeRebuild
      rebuild={REBUILD}
      itemId="course:lesson:rebuild:rebuild"
      committed={false}
      onResult={onResult}
    />,
  );
}

describe("PracticeRebuild", () => {
  it("opens on the peek phase and skips to build on tap", () => {
    renderRebuild(vi.fn());
    expect(screen.getByText("practice.rebuildPeek")).toBeTruthy();
    expect(screen.queryByText("practice.rebuildCheck")).toBeNull();
    fireEvent.click(screen.getByText("practice.rebuildGo"));
    expect(screen.queryByText("practice.rebuildPeek")).toBeNull();
    expect(screen.getByText("practice.rebuildDecoyWarn")).toBeTruthy();
    expect(screen.getByText("practice.rebuildCheck")).toBeTruthy();
  });

  it("grades true for the exact order with no decoys", () => {
    const onResult = vi.fn();
    renderRebuild(onResult);
    fireEvent.click(screen.getByText("practice.rebuildGo"));
    for (const line of REBUILD.lines) {
      fireEvent.click(screen.getByText(line));
    }
    fireEvent.click(screen.getByText("practice.rebuildCheck"));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it("grades false when a decoy is stacked, and Start over resets", () => {
    const onResult = vi.fn();
    renderRebuild(onResult);
    fireEvent.click(screen.getByText("practice.rebuildGo"));
    fireEvent.click(screen.getByText("a(x);")); // decoy
    for (const line of REBUILD.lines) {
      fireEvent.click(screen.getByText(line));
    }
    fireEvent.click(screen.getByText("practice.rebuildCheck"));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(false);

    // Clear returns everything to the pool (4 chips tappable again).
    onResult.mockClear();
    fireEvent.click(screen.getByText("practice.rebuildClear"));
    for (const line of REBUILD.lines) {
      fireEvent.click(screen.getByText(line));
    }
    fireEvent.click(screen.getByText("practice.rebuildCheck"));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it("grades false for the right lines in the wrong order", () => {
    const onResult = vi.fn();
    renderRebuild(onResult);
    fireEvent.click(screen.getByText("practice.rebuildGo"));
    for (const line of ["b();", "a();", "c();"]) {
      fireEvent.click(screen.getByText(line));
    }
    fireEvent.click(screen.getByText("practice.rebuildCheck"));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(false);
  });
});

describe("rebuildPoolOrder / gradeRebuildStack", () => {
  it("shuffles deterministically per item id and keeps every entry", () => {
    const a = rebuildPoolOrder(REBUILD.lines, REBUILD.decoys, "item-1");
    const b = rebuildPoolOrder(REBUILD.lines, REBUILD.decoys, "item-1");
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(a.map((e) => e.text).sort()).toEqual(
      [...REBUILD.lines, ...REBUILD.decoys].sort(),
    );
    expect(a.filter((e) => e.decoy).map((e) => e.text)).toEqual(["a(x);"]);
  });

  it("accepts interchangeable duplicate lines in either order", () => {
    const lines = ["x += 1;", "x += 1;"];
    const [p1, p2] = rebuildPoolOrder(lines, [], "dup").filter((e) => !e.decoy);
    expect(gradeRebuildStack([p2, p1], lines)).toBe(true);
  });

  it("rejects short, long, and decoy-bearing stacks", () => {
    const pool = rebuildPoolOrder(REBUILD.lines, REBUILD.decoys, "item-1");
    const real = REBUILD.lines.map(
      (text) => pool.find((e) => e.text === text)!,
    );
    const decoy = pool.find((e) => e.decoy)!;
    expect(gradeRebuildStack(real, REBUILD.lines)).toBe(true);
    expect(gradeRebuildStack(real.slice(0, 2), REBUILD.lines)).toBe(false);
    expect(gradeRebuildStack([...real, decoy], REBUILD.lines)).toBe(false);
    expect(
      gradeRebuildStack([decoy, ...real.slice(1)], REBUILD.lines),
    ).toBe(false);
  });
});
