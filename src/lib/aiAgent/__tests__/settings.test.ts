/// Settings serialisation + roundtrip tests.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  mergeSettings,
  saveSettings,
} from "@/lib/aiAgent/settings";

beforeEach(() => {
  // localStorage is jsdom-backed; clear between tests.
  localStorage.clear();
});

describe("loadSettings", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("merges defaults with stored partial", () => {
    localStorage.setItem(
      "libre.aiAgent.settings",
      JSON.stringify({ autoApprove: true }),
    );
    const s = loadSettings();
    expect(s.autoApprove).toBe(true);
    expect(s.maxTurns).toBe(DEFAULT_SETTINGS.maxTurns);
  });
  it("falls back to defaults if storage contains garbage", () => {
    localStorage.setItem("libre.aiAgent.settings", "not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("roundtrips a settings object", () => {
    saveSettings({ ...DEFAULT_SETTINGS, autoApprove: true, maxTurns: 35 });
    const loaded = loadSettings();
    expect(loaded.autoApprove).toBe(true);
    expect(loaded.maxTurns).toBe(35);
  });
});

describe("mergeSettings", () => {
  it("clamps maxTurns into bounds", () => {
    expect(mergeSettings({ maxTurns: 0 }).maxTurns).toBe(1);
    expect(mergeSettings({ maxTurns: 500 }).maxTurns).toBe(50);
  });
  it("clamps toolConcurrency", () => {
    expect(mergeSettings({ toolConcurrency: 0 }).toolConcurrency).toBe(1);
    expect(mergeSettings({ toolConcurrency: 99 }).toolConcurrency).toBe(4);
  });
  it("preserves valid booleans", () => {
    expect(
      mergeSettings({ autoApprove: true, pauseOnLowConfidence: false })
        .autoApprove,
    ).toBe(true);
    expect(
      mergeSettings({ autoApprove: true, pauseOnLowConfidence: false })
        .pauseOnLowConfidence,
    ).toBe(false);
  });
});
