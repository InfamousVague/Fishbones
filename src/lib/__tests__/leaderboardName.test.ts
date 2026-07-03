import { describe, it, expect } from "vitest";
import { validateLeaderboardName } from "../leaderboardName";

describe("validateLeaderboardName", () => {
  it("accepts reasonable names", () => {
    expect(validateLeaderboardName("CosmicOtter42")).toBeNull();
    expect(validateLeaderboardName("Rusty Learner_42")).toBeNull();
    expect(validateLeaderboardName("abc")).toBeNull();
    // Substring false-positive check: no bare "ass"/"grass" ban.
    expect(validateLeaderboardName("Grass Snake")).toBeNull();
  });

  it("rejects bad lengths and padding", () => {
    expect(validateLeaderboardName("ab")).toBe("invalid_length");
    expect(validateLeaderboardName("x".repeat(25))).toBe("invalid_length");
    expect(validateLeaderboardName(" padded")).toBe("invalid_length");
    expect(validateLeaderboardName("padded ")).toBe("invalid_length");
  });

  it("rejects out-of-charset names", () => {
    expect(validateLeaderboardName("emoji😀name")).toBe("invalid_chars");
    expect(validateLeaderboardName("semi;colon")).toBe("invalid_chars");
    // `$` fails the charset gate before the profanity check — same
    // behavior as the relay.
    expect(validateLeaderboardName("a$$hole99")).toBe("invalid_chars");
  });

  it("rejects plain and leet-disguised profanity", () => {
    expect(validateLeaderboardName("fuckface")).toBe("profanity");
    expect(validateLeaderboardName("F u c k")).toBe("profanity");
    expect(validateLeaderboardName("sh1t_lord")).toBe("profanity");
    expect(validateLeaderboardName("a55hole99")).toBe("profanity");
  });
});
