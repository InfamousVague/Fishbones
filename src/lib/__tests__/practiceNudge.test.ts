/// Gap-gate tests for the "welcome back" practice nudge.
///
/// `previousActiveTs` is captured at module load (before the heartbeat
/// overwrites it), so each scenario seeds localStorage and then imports
/// the module FRESH via vi.resetModules() + dynamic import.

import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "libre:last-active-ts";
const LATCH = "libre:practice-nudged";

async function loadFresh() {
  vi.resetModules();
  return await import("../practiceNudge");
}

describe("practiceNudge gap gate", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("never nudges on the very first launch (no previous sitting)", async () => {
    const mod = await loadFresh();
    expect(mod.shouldShowPracticeNudge()).toBe(false);
  });

  it("nudges after more than NUDGE_GAP_HOURS away", async () => {
    localStorage.setItem(KEY, String(Date.now() - 6 * 3_600_000));
    const mod = await loadFresh();
    expect(mod.shouldShowPracticeNudge()).toBe(true);
  });

  it("does not nudge after a short break", async () => {
    localStorage.setItem(KEY, String(Date.now() - 1 * 3_600_000));
    const mod = await loadFresh();
    expect(mod.shouldShowPracticeNudge()).toBe(false);
  });

  it("nudges at most once per sitting", async () => {
    localStorage.setItem(KEY, String(Date.now() - 8 * 3_600_000));
    const mod = await loadFresh();
    expect(mod.shouldShowPracticeNudge()).toBe(true);
    mod.markPracticeNudged();
    expect(mod.shouldShowPracticeNudge()).toBe(false);
    expect(sessionStorage.getItem(LATCH)).toBe("1");
  });

  it("heartbeat writes the last-active timestamp", async () => {
    localStorage.setItem(KEY, String(Date.now() - 9 * 3_600_000));
    const mod = await loadFresh();
    const stop = mod.startActivityHeartbeat();
    const ts = Number(localStorage.getItem(KEY));
    expect(Date.now() - ts).toBeLessThan(5_000);
    // the capture happened BEFORE the beat — the gate still sees the gap
    expect(mod.shouldShowPracticeNudge()).toBe(true);
    stop();
  });
});
