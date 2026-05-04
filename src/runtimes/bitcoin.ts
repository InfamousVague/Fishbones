/// Bitcoin runtime — runs JavaScript test code against an
/// in-process UTXO chain shell so course exercises can broadcast
/// real transactions, mine blocks, and assert against the resulting
/// state. Mirrors `runtimes/evm.ts`'s shape so the dispatcher in
/// `runtimes/index.ts` can swap one in for the other based on the
/// lesson's `harness` field.
///
/// What the test code sees as globals:
///   - `chain` — `BitcoinChainHarness` with `accounts`, `send`,
///     `broadcast`, `mine`, `balance`, `utxos`, `script.run`, and
///     `snapshot`/`revert` for test isolation
///   - `btc` — re-export of `@scure/btc-signer` so tests can use
///     `new btc.Transaction()`, `btc.NETWORK`, `btc.p2pkh(...)`,
///     etc. without an import statement
///   - `expect` / `test` — same matcher API the EVM harness exposes
///   - `console` — buffered into the run's log panel
///
/// Each test body is wrapped in `chain.snapshot()` / `chain.revert()`
/// so per-test mutations (extra mines, faucet pokes, etc.) don't
/// leak into the next test. Tests run sequentially because the
/// chain is mutable shared state.

import * as btc from "@scure/btc-signer";

import type { WorkbenchFile } from "../data/types";
import type { LogLine, RunResult, TestResult } from "./types";
import { buildBitcoinChain } from "./bitcoin/buildChain";
import type { BitcoinChainHarness } from "./bitcoin/types";
import { stringify } from "./evm/helpers";
import { expect } from "./evm/expect";

/// Resolve a chain to use for this run. Prefers the long-lived
/// singleton (so the dock UI shows balances + recent txs across
/// runs); falls back to a fresh ephemeral chain when the singleton
/// can't be loaded (likely a Node-side smoke test).
async function resolveChain(
  logs: LogLine[],
): Promise<BitcoinChainHarness> {
  try {
    const svc = await import("../lib/bitcoin/chainService");
    const { chain } = await svc.getOrCreateBitcoinChain();
    return chain;
  } catch (e) {
    if (typeof window !== "undefined") {
      logs.push({
        level: "warn",
        text:
          `Bitcoin chain singleton unavailable, using ephemeral chain ` +
          `(dock will not update): ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return buildBitcoinChain();
  }
}

/// Public entry point. Same shape as runEvm so the dispatcher swap
/// in `runtimes/index.ts` is one line.
export async function runBitcoin(
  files: WorkbenchFile[],
  testCode?: string,
): Promise<RunResult> {
  const started = Date.now();
  const logs: LogLine[] = [];
  const tests: TestResult[] = [];

  // For Bitcoin lessons the "files" argument carries the learner's
  // JS source — they're writing tx-construction code, not Solidity.
  // We let the test code re-import their helpers from the file set
  // by exposing it as `lessonFiles` on the harness globals; for now
  // the runner just concatenates each file's contents into a single
  // CommonJS-ish module-eval scope before the tests run, so a
  // function declared in the lesson source is reachable from the
  // tests.
  const lessonSource = files
    .filter((f) => /\.(js|ts|mjs)$/i.test(f.name) || !f.name.includes("."))
    .map((f) => f.content ?? "")
    .join("\n");

  if (!testCode) {
    logs.push({
      level: "log",
      text:
        "✓ Bitcoin runtime loaded. Add a test file to broadcast & mine.",
    });
    return { logs, durationMs: Date.now() - started };
  }

  const chain = await resolveChain(logs);

  const consoleProxy = {
    log: (...args: unknown[]) => {
      logs.push({ level: "log", text: args.map(stringify).join(" ") });
    },
    warn: (...args: unknown[]) => {
      logs.push({ level: "warn", text: args.map(stringify).join(" ") });
    },
    error: (...args: unknown[]) => {
      logs.push({ level: "error", text: args.map(stringify).join(" ") });
    },
  };

  const testFn = (
    name: string,
    body: () => void | Promise<void>,
  ): Promise<void> =>
    Promise.resolve()
      .then(() => body())
      .then(() => {
        tests.push({ name, passed: true });
      })
      .catch((e) => {
        tests.push({
          name,
          passed: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });

  // Tests run sequentially with snapshot/revert around each body.
  // Same pattern as evm.ts — per-test isolation means a test that
  // mines 100 blocks doesn't push the next test's "current height"
  // off the expected value.
  let prev: Promise<unknown> = Promise.resolve();
  const wrappedBody =
    (body: () => void | Promise<void>) => async (): Promise<void> => {
      const snapId = chain.snapshot();
      try {
        await body();
      } finally {
        try {
          chain.revert(snapId);
        } catch {
          /* swallow — revert failure shouldn't mask the outcome */
        }
      }
    };
  const wrappedTest = (
    name: string,
    body: () => void | Promise<void>,
  ): void => {
    const wrapped = wrappedBody(body);
    prev = prev.then(
      () => testFn(name, wrapped),
      () => testFn(name, wrapped),
    );
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    // The lesson source is exposed as a leading IIFE so any helpers
    // the learner declares are in scope when the tests run.
    const wrappedSource = `
${lessonSource}

${testCode}
`;
    const fn = new AsyncFunction(
      "chain",
      "btc",
      "expect",
      "test",
      "console",
      wrappedSource,
    );
    await fn(chain, btc, expect, wrappedTest, consoleProxy);
    await prev;
  } catch (e) {
    logs.push({
      level: "error",
      text: `Test harness error: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return {
    logs,
    tests,
    testsExpected: true,
    durationMs: Date.now() - started,
  };
}
