/// "Earn the Diff" fire policy — the small, conservative gate that
/// decides WHEN a rewind challenge may appear. Kept separate from
/// `rewind.ts` (which decides WHAT line) and pure so it's trivially
/// testable.
///
/// The cardinal rule (straight from the design's cut-list): cap at
/// ONE rewind per build, and never fire in the hands-off mode.
/// Repeated mid-build interception on a 7B model that already stalls
/// reads as the agent breaking, not teaching. A rewind is a reward
/// for a finished build, offered once, only when the learner opted
/// into co-working.

import type { PairMode } from "../aiAgent/pairMode";

/// Once a learner has earned the diff for a concept this many times,
/// stop offering rewinds for it — they've shown they've got it.
/// Mirrors the struggle counter in learner memory.
export const REWIND_MASTERY_THRESHOLD = 3;

export interface RewindGateInput {
  /// The co-working mode. Rewinds only fire in the two teaching
  /// modes — never "build-for-me".
  pairMode: PairMode;
  /// The build reached a green run. We only reward a WORKING build —
  /// rewinding a broken one piles a quiz on top of a failure.
  buildComplete: boolean;
  /// A rewind was already offered in this build run. Hard cap: one.
  alreadyOfferedThisBuild: boolean;
  /// The learner's mastery count for the candidate concept (from
  /// `memory.mastery`). At/above the threshold → suppress.
  conceptMastery?: number;
}

/// Whether a rewind challenge may be offered right now. Pure; the
/// actual line still has to clear `selectRewindStep`'s own filters
/// (this only governs the timing/cadence).
export function shouldOfferRewind(input: RewindGateInput): boolean {
  if (input.pairMode === "build-for-me") return false;
  if (!input.buildComplete) return false;
  if (input.alreadyOfferedThisBuild) return false;
  if ((input.conceptMastery ?? 0) >= REWIND_MASTERY_THRESHOLD) return false;
  return true;
}
