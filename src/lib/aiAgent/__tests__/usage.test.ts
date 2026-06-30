/// Token-usage aggregator + formatter tests.

import { describe, expect, it } from "vitest";
import {
  accumulateUsage,
  EMPTY_RUN_USAGE,
  formatDuration,
  formatTokens,
} from "@/lib/aiAgent/usage";

describe("accumulateUsage", () => {
  it("starts from EMPTY_RUN_USAGE", () => {
    expect(EMPTY_RUN_USAGE).toEqual({
      turns: 0,
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
    });
  });
  it("folds one turn", () => {
    const r = accumulateUsage(EMPTY_RUN_USAGE, {
      promptTokens: 120,
      completionTokens: 80,
      durationMs: 1500,
    });
    expect(r).toEqual({
      turns: 1,
      promptTokens: 120,
      completionTokens: 80,
      durationMs: 1500,
    });
  });
  it("treats missing fields as zero", () => {
    const r = accumulateUsage(EMPTY_RUN_USAGE, {
      promptTokens: null,
      completionTokens: null,
      durationMs: null,
    });
    expect(r).toEqual({
      turns: 1,
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
    });
  });
  it("accumulates across many turns", () => {
    let r = EMPTY_RUN_USAGE;
    for (let i = 0; i < 5; i++) {
      r = accumulateUsage(r, {
        promptTokens: 100,
        completionTokens: 50,
        durationMs: 200,
      });
    }
    expect(r.turns).toBe(5);
    expect(r.promptTokens).toBe(500);
    expect(r.completionTokens).toBe(250);
    expect(r.durationMs).toBe(1000);
  });
});

describe("formatTokens", () => {
  it("formats <1000 as a bare integer", () => {
    expect(formatTokens(847)).toBe("847");
  });
  it("formats kilos with one decimal place under 10k", () => {
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(9999)).toBe("10.0k");
  });
  it("formats >=10k as rounded kilos", () => {
    expect(formatTokens(12_400)).toBe("12k");
    expect(formatTokens(50_500)).toBe("51k");
  });
});

describe("formatDuration", () => {
  it("formats ms under a second", () => {
    expect(formatDuration(123)).toBe("123ms");
  });
  it("formats seconds with a decimal", () => {
    expect(formatDuration(2_400)).toBe("2.4s");
  });
  it("formats >1m as minutes + seconds", () => {
    expect(formatDuration(123_000)).toBe("2m 03s");
  });
});
