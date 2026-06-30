/// Confidence tag parsing — checks every variant the model can
/// emit, the percentage normalisation, and the bucket
/// classification.

import { describe, expect, it } from "vitest";
import {
  classifyConfidence,
  deriveConfidenceFromTool,
  isLowConfidence,
  parseConfidence,
} from "@/lib/aiAgent/confidence";

describe("parseConfidence", () => {
  it("returns null when no tag is present", () => {
    const r = parseConfidence("here is a plain answer.");
    expect(r.confidence).toBeNull();
    expect(r.cleaned).toBe("here is a plain answer.");
    expect(r.reason).toBeNull();
  });
  it("parses a fractional confidence tag", () => {
    const r = parseConfidence("hello.\n<confidence>0.85</confidence>");
    expect(r.confidence).toBeCloseTo(0.85, 5);
    expect(r.cleaned).toBe("hello.");
  });
  it("normalises percentages to fractions", () => {
    const r = parseConfidence("hi <confidence>85</confidence>");
    expect(r.confidence).toBeCloseTo(0.85, 5);
  });
  it("clamps absurdly high values", () => {
    const r = parseConfidence("<confidence>500</confidence>");
    expect(r.confidence).toBe(1);
  });
  it("clamps negative values", () => {
    const r = parseConfidence("<confidence>-0.2</confidence>");
    expect(r.confidence).toBe(0);
  });
  it("extracts the reason attribute", () => {
    const r = parseConfidence(
      'looks good. <confidence reason="not sure about the API">0.4</confidence>',
    );
    expect(r.confidence).toBeCloseTo(0.4, 5);
    expect(r.reason).toBe("not sure about the API");
    expect(r.cleaned).toBe("looks good.");
  });
  it("strips repeated tags (model double-emits)", () => {
    const r = parseConfidence(
      "x <confidence>0.7</confidence> y <confidence>0.7</confidence>",
    );
    expect(r.cleaned).toBe("x  y");
  });
  it("handles tag with no decimal point", () => {
    const r = parseConfidence("<confidence>1</confidence>");
    expect(r.confidence).toBe(1);
  });
  it("strips a malformed tag but reports null confidence", () => {
    const r = parseConfidence("hi <confidence>nope</confidence>");
    expect(r.confidence).toBeNull();
    expect(r.cleaned).not.toContain("nope");
  });
});

describe("classifyConfidence", () => {
  it("classifies unrated", () => {
    expect(classifyConfidence(null)).toBe("unrated");
  });
  it("classifies low", () => {
    expect(classifyConfidence(0.3)).toBe("low");
    expect(classifyConfidence(0.49)).toBe("low");
  });
  it("classifies medium", () => {
    expect(classifyConfidence(0.5)).toBe("medium");
    expect(classifyConfidence(0.79)).toBe("medium");
  });
  it("classifies high", () => {
    expect(classifyConfidence(0.8)).toBe("high");
    expect(classifyConfidence(1)).toBe("high");
  });
});

describe("isLowConfidence", () => {
  it("treats unrated as not-low (no signal, no elevation)", () => {
    expect(isLowConfidence(null)).toBe(false);
  });
  it("triggers below 0.5", () => {
    expect(isLowConfidence(0.49)).toBe(true);
    expect(isLowConfidence(0.5)).toBe(false);
  });
});

describe("deriveConfidenceFromTool (heuristic)", () => {
  it("snaps to 0.85 on first successful tool", () => {
    expect(deriveConfidenceFromTool(null, true)).toBe(0.85);
  });
  it("snaps to 0.30 on first failed tool", () => {
    expect(deriveConfidenceFromTool(null, false)).toBe(0.3);
  });
  it("nudges up on success from a prior value", () => {
    const next = deriveConfidenceFromTool(0.5, true);
    expect(next).toBeGreaterThan(0.5);
    expect(next).toBeLessThan(0.85);
  });
  it("nudges down on failure from a prior value", () => {
    const next = deriveConfidenceFromTool(0.7, false);
    expect(next).toBeLessThan(0.7);
    expect(next).toBeGreaterThan(0.3);
  });
  it("converges toward 0.85 after several successes", () => {
    let v: number | null = null;
    for (let i = 0; i < 8; i++) {
      v = deriveConfidenceFromTool(v, true);
    }
    expect(v).toBeGreaterThan(0.8);
  });
  it("converges toward 0.3 after several failures", () => {
    let v: number | null = null;
    for (let i = 0; i < 8; i++) {
      v = deriveConfidenceFromTool(v, false);
    }
    expect(v).toBeLessThan(0.4);
  });
  it("recovers from low when a success lands", () => {
    let v: number | null = deriveConfidenceFromTool(null, false); // 0.3
    v = deriveConfidenceFromTool(v, true);
    expect(v).toBeGreaterThan(0.3);
  });
  it("stays in [0, 1] under any sequence", () => {
    let v: number | null = null;
    const seq = [true, false, true, true, false, false, true];
    for (const ok of seq) {
      v = deriveConfidenceFromTool(v, ok);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
