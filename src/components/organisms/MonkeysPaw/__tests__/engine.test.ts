/// Engine-level tests for the Monkey's Paw summon loop, with a
/// scripted fake runner — no rustc involved (content-level rustc
/// verification lives in duels.verify.test.ts behind PAW_VERIFY).
import { describe, it, expect } from "vitest";
import type { RunResult } from "@/runtimes/types";
import { summon } from "@/components/organisms/MonkeysPaw/engine";
import type { PawDuel } from "@/components/organisms/MonkeysPaw/duels";

const duel: PawDuel = {
  id: "paw-test",
  title: "Test Duel",
  wish: "wish",
  clauses: [],
  signature: "fn f()",
  conceptTags: [],
  difficulty: "apprentice",
  starterTests: "starter",
  cheats: [
    { id: "c0", title: "C0", monologue: "", lesson: "", code: "cheat0" },
    { id: "c1", title: "C1", monologue: "", lesson: "", code: "cheat1" },
    { id: "c2", title: "C2", monologue: "", lesson: "", code: "cheat2" },
  ],
  reference: "reference",
  killerTests: "killer",
};

const pass: RunResult = {
  logs: [],
  durationMs: 1,
  testsExpected: true,
  tests: [{ name: "t", passed: true }],
};
const fail: RunResult = {
  logs: [],
  durationMs: 1,
  testsExpected: true,
  tests: [{ name: "t", passed: false, error: "assertion failed" }],
};
const compileError: RunResult = {
  logs: [],
  durationMs: 1,
  testsExpected: true,
  error: "error[E0425]: cannot find value",
};

/// Runner scripted by implementation code: maps code → verdict for
/// the current suite.
function runnerFor(verdicts: Record<string, RunResult>) {
  const calls: string[] = [];
  const run = async (code: string, _tests: string): Promise<RunResult> => {
    calls.push(code);
    const v = verdicts[code];
    if (!v) throw new Error(`unscripted code: ${code}`);
    return v;
  };
  return { run, calls };
}

describe("summon", () => {
  it("grants the laziest cheat that survives the suite", async () => {
    const { run, calls } = runnerFor({ cheat0: pass });
    const outcome = await summon(duel, "suite", run);
    expect(outcome.kind).toBe("cheat");
    if (outcome.kind === "cheat") {
      expect(outcome.cheatIndex).toBe(0);
      expect(outcome.slain).toBe(0);
    }
    // Short-circuits: never ran the higher rungs or the reference.
    expect(calls).toEqual(["cheat0"]);
  });

  it("skips slain rungs via startAt", async () => {
    const { run, calls } = runnerFor({ cheat1: fail, cheat2: pass });
    const outcome = await summon(duel, "suite", run, { startAt: 1 });
    expect(outcome.kind).toBe("cheat");
    if (outcome.kind === "cheat") expect(outcome.cheatIndex).toBe(2);
    expect(calls).toEqual(["cheat1", "cheat2"]);
  });

  it("declares victory only after the FULL ladder dies and the reference passes", async () => {
    const { run, calls } = runnerFor({
      cheat0: fail,
      cheat1: fail,
      cheat2: fail,
      reference: pass,
    });
    const outcome = await summon(duel, "suite", run);
    expect(outcome.kind).toBe("victory");
    if (outcome.kind === "victory") expect(outcome.slain).toBe(3);
    expect(calls).toEqual(["cheat0", "cheat1", "cheat2", "reference"]);
  });

  it("re-validates skipped rungs on the victory path — a weakened suite resurrects the cheat", async () => {
    // startAt=2 (two cheats "already slain"), remaining cheat dies,
    // reference passes — but the final suite no longer kills cheat0.
    const { run, calls } = runnerFor({
      cheat0: pass,
      cheat2: fail,
      reference: pass,
    });
    const outcome = await summon(duel, "suite", run, { startAt: 2 });
    expect(outcome.kind).toBe("cheat");
    if (outcome.kind === "cheat") {
      expect(outcome.cheatIndex).toBe(0);
      expect(outcome.slain).toBe(0); // rolls back
    }
    expect(calls).toEqual(["cheat2", "reference", "cheat0"]);
  });

  it("flags an unfair contract with the failing test names", async () => {
    const refFail: RunResult = {
      logs: [],
      durationMs: 1,
      testsExpected: true,
      tests: [
        { name: "fair_test", passed: true },
        { name: "impossible_demand", passed: false, error: "boom" },
      ],
    };
    const { run } = runnerFor({
      cheat0: fail,
      cheat1: fail,
      cheat2: fail,
      reference: refFail,
    });
    const outcome = await summon(duel, "suite", run);
    expect(outcome.kind).toBe("unfair");
    if (outcome.kind === "unfair") {
      expect(outcome.failures).toEqual(["impossible_demand"]);
    }
  });

  it("flags a broken contract when the reference run errors with no test rows", async () => {
    const { run } = runnerFor({
      cheat0: compileError,
      cheat1: compileError,
      cheat2: compileError,
      reference: compileError,
    });
    const outcome = await summon(duel, "suite", run);
    expect(outcome.kind).toBe("broken");
    if (outcome.kind === "broken") {
      expect(outcome.error).toContain("E0425");
    }
  });
});
