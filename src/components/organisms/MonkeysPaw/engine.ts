/// Monkey's Paw duel engine — pure orchestration, no UI.
///
/// One `summon()` = one wish granted. The Paw walks its cheat ladder
/// laziest-first and presents the FIRST implementation that survives
/// (passes) the learner's current test suite. When no cheat survives,
/// the suite is judged against the hidden reference:
///
///   - reference passes  → VICTORY (the dual oracle is satisfied: the
///     suite kills the whole battery AND accepts the true artifact),
///   - reference fails   → UNFAIR CONTRACT (the learner wrote a test
///     the real solution can't pass — the failing clause is surfaced
///     so they fix their own test),
///   - reference errors  → BROKEN CONTRACT (the suite itself doesn't
///     compile / crashes the harness).
///
/// The runner is injected (`(code, tests) => Promise<RunResult>`) so
/// the engine stays runtime-agnostic: the view wires `runRust` (local
/// rustc on desktop, Rust Playground fallback on web) and unit tests
/// inject a scripted fake.
///
/// `startAt` skips cheats already slain in previous rounds — each
/// summon costs one runner call per ladder rung, so re-litigating dead
/// cheats would double round latency for nothing. The one place that
/// could lie is a learner WEAKENING their suite after a kill, so the
/// victory path re-validates the ENTIRE ladder from rung 0: a victory
/// is only declared when the full battery dies against the final
/// suite. A resurrected cheat is reported (and `slain` rolls back to
/// its index) instead of a false win.

import type { RunResult } from "@/runtimes/types";
import { isPassing } from "@/runtimes/types";
import type { PawDuel } from "./duels";

export type PawRunner = (code: string, testCode: string) => Promise<RunResult>;

export type SummonOutcome =
  /// A cheat survived the suite — it is now "the grant" on screen.
  /// `slain` = how many ladder rungs the suite kills (the surviving
  /// cheat's index), which the UI renders as curled fingers.
  | { kind: "cheat"; cheatIndex: number; slain: number; result: RunResult }
  /// Every cheat died and the reference passed — the duel is won.
  | { kind: "victory"; slain: number; result: RunResult }
  /// Every cheat died but the reference FAILS the suite — some test
  /// demands non-contract behavior. `failures` names the offending
  /// tests so the learner can repair their own contract.
  | { kind: "unfair"; slain: number; failures: string[]; result: RunResult }
  /// The suite itself is broken (doesn't compile / harness error).
  | { kind: "broken"; error: string; result: RunResult };

export interface SummonOptions {
  /// Index of the first cheat NOT yet slain (persisted across rounds).
  startAt?: number;
  /// Progress callback — lets the UI narrate which rung is being
  /// tested while the (multi-second) runs happen.
  onProgress?: (step: { phase: "cheat" | "reference"; index: number; total: number }) => void;
}

export async function summon(
  duel: PawDuel,
  suite: string,
  run: PawRunner,
  opts: SummonOptions = {},
): Promise<SummonOutcome> {
  const startAt = Math.max(0, Math.min(opts.startAt ?? 0, duel.cheats.length));
  const total = duel.cheats.length;

  // Walk the not-yet-slain rungs, laziest first.
  for (let i = startAt; i < total; i++) {
    opts.onProgress?.({ phase: "cheat", index: i, total });
    const result = await run(duel.cheats[i].code, suite);
    if (isPassing(result)) {
      return { kind: "cheat", cheatIndex: i, slain: i, result };
    }
  }

  // Whole remaining ladder is dead — judge against the reference.
  opts.onProgress?.({ phase: "reference", index: total, total });
  const refResult = await run(duel.reference, suite);

  if (isPassing(refResult)) {
    // Victory candidate. If earlier rungs were skipped, re-validate
    // them against the FINAL suite so a weakened contract can't
    // sneak a win past cheats it no longer kills.
    for (let i = 0; i < startAt; i++) {
      opts.onProgress?.({ phase: "cheat", index: i, total });
      const result = await run(duel.cheats[i].code, suite);
      if (isPassing(result)) {
        return { kind: "cheat", cheatIndex: i, slain: i, result };
      }
    }
    return { kind: "victory", slain: total, result: refResult };
  }

  // Reference rejected the suite. Distinguish "contract demands the
  // impossible" (named failing tests) from "contract doesn't even
  // compile" (harness error, no test rows).
  const failures = (refResult.tests ?? [])
    .filter((t) => !t.passed)
    .map((t) => t.name);
  if (failures.length === 0 && refResult.error) {
    return { kind: "broken", error: refResult.error, result: refResult };
  }
  return { kind: "unfair", slain: total, failures, result: refResult };
}

/// Per-duel persisted progress. Stored as JSON in localStorage under
/// `paw:<duelId>` — small, device-local, and safe to lose (worst case
/// the learner replays a fun duel).
export interface PawProgress {
  /// The learner's current contract (test file contents).
  suite: string;
  /// Cheats permanently slain (ladder index of the next survivor).
  slain: number;
  /// Total summons spent on this duel.
  rounds: number;
  won: boolean;
}

const STORAGE_PREFIX = "paw:";

export function loadProgress(duelId: string): PawProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + duelId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PawProgress>;
    if (typeof parsed.suite !== "string") return null;
    return {
      suite: parsed.suite,
      slain: typeof parsed.slain === "number" ? parsed.slain : 0,
      rounds: typeof parsed.rounds === "number" ? parsed.rounds : 0,
      won: parsed.won === true,
    };
  } catch {
    return null;
  }
}

export function saveProgress(duelId: string, progress: PawProgress): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + duelId, JSON.stringify(progress));
  } catch {
    // Quota/private-mode failures are non-fatal — the duel just
    // won't resume.
  }
}
