/// Co-working spectrum tests — the prompt shaping must keep the
/// build loop's invariants while adding the teaching behaviour, and
/// the settings layer must migrate cleanly from blobs saved before
/// pairMode existed.

import { describe, expect, it } from "vitest";
import {
  clampPairMode,
  DEFAULT_PAIR_MODE,
  PAIR_MODES,
  pairModeSection,
  type PairMode,
} from "../pairMode";
import { mergeSettings, DEFAULT_SETTINGS } from "../settings";

describe("clampPairMode", () => {
  it("accepts the three real modes", () => {
    expect(clampPairMode("build-for-me")).toBe("build-for-me");
    expect(clampPairMode("build-with-me")).toBe("build-with-me");
    expect(clampPairMode("socratic")).toBe("socratic");
  });
  it("falls back to the default for junk / missing", () => {
    expect(clampPairMode(undefined)).toBe(DEFAULT_PAIR_MODE);
    expect(clampPairMode(null)).toBe(DEFAULT_PAIR_MODE);
    expect(clampPairMode("guru")).toBe(DEFAULT_PAIR_MODE);
    expect(clampPairMode(42)).toBe(DEFAULT_PAIR_MODE);
  });
  it("default is a teaching mode — this is a learn-to-code app", () => {
    expect(DEFAULT_PAIR_MODE).toBe("build-with-me");
  });
});

describe("PAIR_MODES metadata", () => {
  it("lists exactly the three modes, hands-off → hands-on", () => {
    expect(PAIR_MODES.map((m) => m.value)).toEqual([
      "build-for-me",
      "build-with-me",
      "socratic",
    ]);
  });
  it("every mode has a label + blurb + icon", () => {
    for (const m of PAIR_MODES) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
      expect(m.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("pairModeSection", () => {
  it("build-for-me adds NO override — base prompt already builds autonomously", () => {
    expect(pairModeSection("build-for-me")).toBeNull();
  });

  it("build-with-me narrates but keeps the build invariants", () => {
    const s = pairModeSection("build-with-me")!;
    expect(s).toContain("BUILD WITH ME");
    // It must explicitly preserve the load-bearing build rules so a
    // chatty 7B model doesn't drop them.
    expect(s).toMatch(/run_sandbox_project/);
    expect(s.toLowerCase()).toContain("tool channel");
    expect(s.toLowerCase()).toContain("split");
    // And it must keep narration tight (one sentence per step).
    expect(s.toLowerCase()).toContain("one");
  });

  it("socratic asks via request_user_input but still finishes the build", () => {
    const s = pairModeSection("socratic")!;
    expect(s).toContain("SOCRATIC");
    expect(s).toContain("request_user_input");
    // Caps the questions so it doesn't quiz the learner to death.
    expect(s.toLowerCase()).toMatch(/once or twice|at most/);
    // Still verifies.
    expect(s).toMatch(/run_sandbox_project/);
  });

  it("every non-default mode names itself so the override is unambiguous", () => {
    const modes: PairMode[] = ["build-with-me", "socratic"];
    for (const m of modes) {
      const s = pairModeSection(m)!;
      expect(s.startsWith("# Co-working mode")).toBe(true);
    }
  });
});

describe("settings migration for pairMode", () => {
  it("defaults pairMode when an older blob omits it", () => {
    // A settings blob saved before pairMode existed.
    const legacy = {
      autoApprove: true,
      effort: "thorough" as const,
      model: "qwen2.5-coder:7b",
    };
    const merged = mergeSettings(legacy);
    expect(merged.pairMode).toBe(DEFAULT_PAIR_MODE);
    // Doesn't clobber the fields the blob DID set.
    expect(merged.autoApprove).toBe(true);
    expect(merged.effort).toBe("thorough");
  });
  it("preserves a valid saved pairMode and clamps an invalid one", () => {
    expect(mergeSettings({ pairMode: "socratic" }).pairMode).toBe("socratic");
    expect(
      mergeSettings({ pairMode: "nonsense" as unknown as PairMode }).pairMode,
    ).toBe(DEFAULT_PAIR_MODE);
  });
  it("DEFAULT_SETTINGS carries the default mode", () => {
    expect(DEFAULT_SETTINGS.pairMode).toBe(DEFAULT_PAIR_MODE);
  });
});
