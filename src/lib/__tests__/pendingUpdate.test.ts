import { describe, it, expect, beforeEach } from "vitest";
import {
  markUpdateStaged,
  consumeStagedUpdate,
  versionSatisfies,
} from "../pendingUpdate";

describe("versionSatisfies", () => {
  it("is true when current == target (swap applied exactly)", () => {
    expect(versionSatisfies("2.11.1", "2.11.1")).toBe(true);
  });
  it("is true when current > target (already newer)", () => {
    expect(versionSatisfies("2.12.0", "2.11.1")).toBe(true);
    expect(versionSatisfies("2.11.2", "2.11.1")).toBe(true);
    expect(versionSatisfies("3.0.0", "2.99.99")).toBe(true);
  });
  it("is FALSE when current < target (swap did not take → must re-download)", () => {
    expect(versionSatisfies("2.11.0", "2.11.1")).toBe(false);
    expect(versionSatisfies("2.10.9", "2.11.0")).toBe(false);
    expect(versionSatisfies("1.9.9", "2.0.0")).toBe(false);
  });
  it("tolerates a leading v on either side", () => {
    expect(versionSatisfies("v2.11.1", "2.11.1")).toBe(true);
    expect(versionSatisfies("2.11.1", "v2.11.1")).toBe(true);
    expect(versionSatisfies("v2.11.0", "v2.11.1")).toBe(false);
  });
  it("handles differing segment counts", () => {
    expect(versionSatisfies("2.11", "2.11.0")).toBe(true);
    expect(versionSatisfies("2.11.0", "2.11")).toBe(true);
    expect(versionSatisfies("2.11.0.1", "2.11.0")).toBe(true);
    expect(versionSatisfies("2.11.0", "2.11.0.1")).toBe(false);
  });
});

describe("markUpdateStaged / consumeStagedUpdate", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a version and strips the v prefix", () => {
    markUpdateStaged("v2.11.1");
    expect(consumeStagedUpdate()).toBe("2.11.1");
  });
  it("is single-use — a second consume returns null", () => {
    markUpdateStaged("2.11.1");
    expect(consumeStagedUpdate()).toBe("2.11.1");
    expect(consumeStagedUpdate()).toBeNull();
  });
  it("returns null when nothing was staged", () => {
    expect(consumeStagedUpdate()).toBeNull();
  });
});
