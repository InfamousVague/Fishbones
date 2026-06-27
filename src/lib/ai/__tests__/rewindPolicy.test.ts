/// Rewind fire-policy tests — the conservative timing gate. One
/// rewind per build, never in build-for-me, suppressed past mastery.

import { describe, expect, it } from "vitest";
import {
  REWIND_MASTERY_THRESHOLD,
  shouldOfferRewind,
} from "../rewindPolicy";

const base = {
  pairMode: "build-with-me" as const,
  buildComplete: true,
  alreadyOfferedThisBuild: false,
  conceptMastery: 0,
};

describe("shouldOfferRewind", () => {
  it("fires for a fresh, complete build in a teaching mode", () => {
    expect(shouldOfferRewind(base)).toBe(true);
    expect(shouldOfferRewind({ ...base, pairMode: "socratic" })).toBe(true);
  });

  it("never fires in build-for-me (hands-off)", () => {
    expect(shouldOfferRewind({ ...base, pairMode: "build-for-me" })).toBe(false);
  });

  it("does not fire on an unfinished / broken build", () => {
    expect(shouldOfferRewind({ ...base, buildComplete: false })).toBe(false);
  });

  it("caps at one rewind per build", () => {
    expect(shouldOfferRewind({ ...base, alreadyOfferedThisBuild: true })).toBe(false);
  });

  it("suppresses once the concept is mastered", () => {
    expect(
      shouldOfferRewind({ ...base, conceptMastery: REWIND_MASTERY_THRESHOLD }),
    ).toBe(false);
    expect(
      shouldOfferRewind({ ...base, conceptMastery: REWIND_MASTERY_THRESHOLD - 1 }),
    ).toBe(true);
  });
});
