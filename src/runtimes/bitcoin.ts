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

import type { WorkbenchFile } from "@/data/types";
import type { LogLine, RunResult, TestResult } from "./types";
import { buildBitcoinChain } from "@/runtimes/bitcoin/buildChain";
import type { BitcoinChainHarness } from "@/runtimes/bitcoin/types";
import { stringify } from "@/runtimes/evm/helpers";
import { expect } from "@/runtimes/evm/expect";

/// Resolve a chain to use for this run. Prefers the long-lived
/// singleton (so the dock UI shows balances + recent txs across
/// runs); falls back to a fresh ephemeral chain when the singleton
/// can't be loaded (likely a Node-side smoke test).
async function resolveChain(
  logs: LogLine[],
): Promise<BitcoinChainHarness> {
  try {
    const svc = await import("@/lib/bitcoin/chainService");
    const { chain } = await svc.getOrCreateBitcoinChain();
    // Reset the chain to its pristine first-build state at the top
    // of every Run so test assertions like "account[0] has 50 BTC"
    // stay deterministic across Runs. The chain service's pristine
    // snapshot is captured at chain-creation time and survives Runs
    // — only the historical `recentTxs` / `recentBlocks` accumulators
    // (visible in the dock) carry over, NOT the live state.
    svc.revertToPristine();
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

  // Tests run sequentially with revert-BEFORE-each-test isolation.
  // We delegate the reset to `revertToPristine` from the chain
  // service rather than holding a snapshot id locally — the harness
  // DELETES a snapshot id from its ring after `revert(id)`
  // consumes it, so a locally-held `initialSnap` would only work
  // once; tests 2..N would no-op and run against accumulated state.
  // `revertToPristine` re-snapshots the pristine point on every
  // call so it's safe to invoke repeatedly.
  //
  // We don't revert AFTER the last test, so the chain is left in
  // whatever state the test produced. The dock's mempool / accounts
  // / UTXOs panels then reflect what actually happened. Historical
  // recentTxs / recentBlocks accumulate across tests / Runs.
  const svc = await import("@/lib/bitcoin/chainService");
  let prev: Promise<unknown> = Promise.resolve();
  const wrappedBody =
    (body: () => void | Promise<void>) => async (): Promise<void> => {
      svc.revertToPristine();
      // No finally: we INTENTIONALLY leave the chain dirty after the
      // body so the next test (or, after the final test, the dock)
      // sees the mutations. The next test's revertToPristine handles
      // cleanup; an exception here propagates to fail the test.
      await body();
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
