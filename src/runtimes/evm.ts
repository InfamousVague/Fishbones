import type { WorkbenchFile } from "@/data/types";
import type { RunResult, LogLine, TestResult } from "./types";

/// EVM runtime — compiles Solidity/Vyper source, then *executes* the
/// resulting bytecode in an in-process @ethereumjs/vm so course
/// exercises can deploy a contract and call its functions for real
/// (rather than just inspecting the ABI).
///
/// The exposed `chain` global is shaped after Anvil so the
/// API a learner uses here mirrors what they'd write against a real
/// dev chain. Plus a viem-compatible `chain.transport` lets tests
/// drop in `createPublicClient({ transport: chain.transport })` /
/// `createWalletClient({ ... })` for the same JSON-RPC surface
/// they'd hit on a live node — `eth_*` and standard
/// `evm_*` extensions (`evm_snapshot`, `evm_revert`, `evm_mine`,
/// `evm_increaseTime`).
///
/// Anatomy:
///   - solc compiles via the cached loader from `solidity.ts`
///   - `@ethereumjs/vm` runs the bytecode with full state isolation
///   - `viem` does the ABI encode/decode
///   - `chain.snapshot()` / `chain.revert(id)` use the VM's stateRoot
///     so tests can run with cheap rollback between assertions
///   - `chain.mine()` / `chain.warp()` advance block.number /
///     block.timestamp by mutating the BlockBuilder's parent header
///     between txs
///
/// Not included today (would be the next iteration):
///   - true block production via runBlock — we synthesize per-tx
///     receipts inline because course exercises don't ask about
///     receipts.transactionIndex / blockHash beyond fixture-grade
///     accuracy
///   - precompile-based EIPs that require post-Cancun forks
///   - websocket transport (WS isn't useful in a single-page test)

import { type Abi } from "viem";

import { loadSolc, buildSolcInput } from "./solidity";
import { stringify } from "@/runtimes/evm/helpers";
import { expect } from "@/runtimes/evm/expect";
import { makeTestRequire } from "@/runtimes/evm/testRequire";
import { buildChain } from "@/runtimes/evm/buildChain";
import type {
  Hex,
  CompiledContract,
  CompiledOutput,
  ChainHarness,
  ChainAttachHooks,
  PersistentChainExtras,
} from "@/runtimes/evm/types";

// Re-export the AccountSnapshot/ContractSnapshot/TxSnapshot/
// ChainAttachHooks types under stable names so evm/chainService can
// import them without re-declaring. These are the SAME interfaces
// declared in ./evm/types; this block just re-exports them as values.
export type {
  AccountSnapshot as EvmAccountSnapshot,
  ContractSnapshot as EvmContractSnapshot,
  TxSnapshot as EvmTxSnapshot,
} from "@/runtimes/evm/types";

/// Singleton-friendly factory used by `evm/chainService.ts`. Builds a
/// chain with empty compiled artifacts (so it can be attached before
/// any lesson has compiled) and wires the supplied hooks. The caller
/// loads compiled artifacts via `chain.setCompiled(c)` on every run.
export async function _buildChainPersistent(
  hooks: ChainAttachHooks,
): Promise<{
  chain: ChainHarness & PersistentChainExtras;
  rebuildSnapshot: () => Promise<void>;
}> {
  const chain = await buildChain({ contracts: {} }, hooks);
  return {
    chain,
    rebuildSnapshot: () => chain.loadInitialSnapshot(),
  };
}

/// Public entry point. Same shape as runSolidity so the dispatcher
/// swap is one line. When `harness === "evm"` is set on the lesson,
/// route here instead of `runSolidity`.
export async function runEvm(
  files: WorkbenchFile[],
  testCode?: string,
): Promise<RunResult> {
  const started = Date.now();
  const logs: LogLine[] = [];
  const tests: TestResult[] = [];

  let compile;
  try {
    compile = await loadSolc();
  } catch (e) {
    return {
      logs: [
        {
          level: "error",
          text: `Couldn't load Solidity compiler: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
      ],
      error: "Compiler load failed",
      durationMs: Date.now() - started,
    };
  }

  const compiledRaw = compile(buildSolcInput(files));
  let compiled: CompiledOutput;
  try {
    const parsed = JSON.parse(compiledRaw);
    const out: CompiledOutput["contracts"] = {};
    for (const [file, perFile] of Object.entries(parsed.contracts ?? {})) {
      out[file] = {};
      for (const [name, info] of Object.entries(
        perFile as Record<
          string,
          {
            abi?: Abi;
            evm?: {
              bytecode?: { object?: string };
              deployedBytecode?: { object?: string };
            };
          }
        >,
      )) {
        out[file][name] = {
          abi: info.abi ?? [],
          bytecode: `0x${info.evm?.bytecode?.object ?? ""}` as Hex,
          deployedBytecode: `0x${info.evm?.deployedBytecode?.object ?? ""}` as Hex,
        };
      }
    }
    compiled = { errors: parsed.errors, contracts: out };
  } catch (e) {
    return {
      logs: [
        {
          level: "error",
          text: `Compiler output unparseable: ${(e as Error).message}`,
        },
      ],
      error: "Compiler output unparseable",
      durationMs: Date.now() - started,
    };
  }

  const fatals = (compiled.errors ?? []).filter((e) => e.severity === "error");
  for (const e of compiled.errors ?? []) {
    logs.push({
      level:
        e.severity === "error"
          ? "error"
          : e.severity === "warning"
            ? "warn"
            : "info",
      text: (e.formattedMessage ?? e.message ?? "").trim(),
    });
  }
  if (fatals.length > 0) {
    return {
      logs,
      error: "Compilation failed",
      tests: testCode ? [] : undefined,
      testsExpected: !!testCode,
      durationMs: Date.now() - started,
    };
  }

  if (!testCode) {
    logs.push({
      level: "log",
      text: "✓ Compiled. Add a test file to deploy & call.",
    });
    return { logs, durationMs: Date.now() - started };
  }

  // Pick a chain. Prefer the long-lived singleton from
  // `evm/chainService` so the ChainDock UI can show balances /
  // recent contracts / recent txs across runs. The singleton is
  // browser-only (it imports our own runtime back), so we guard the
  // dynamic import — Node-side callers (smoke tests, the verifier)
  // still get a fresh ephemeral chain via the catch fallback.
  let chain: ChainHarness & PersistentChainExtras;
  try {
    const svc = await import("@/lib/evm/chainService");
    const { chain: persistent } = await svc.getOrCreateChain();
    const c = persistent as ChainHarness & PersistentChainExtras;
    c.setCompiled(compiled);
    await c.loadInitialSnapshot();
    chain = c;
  } catch (e) {
    // No service available (likely Node) — fall back to ephemeral.
    // In the browser this catch path means the ChainDock won't see
    // any deploys/txs; surface the reason to the run log so it isn't
    // a silent regression.
    if (typeof window !== "undefined") {
      logs.push({
        level: "warn",
        text: `Chain singleton unavailable, using ephemeral chain (dock will not update): ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }
    chain = await buildChain(compiled);
  }

  // Console proxy for the test harness — buffered into the Run
  // panel just like the JS runtime. lets `console.log(receipt)`
  // surface in the lesson's output.
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

  const testFn = (name: string, body: () => void | Promise<void>) => {
    return Promise.resolve()
      .then(() => body())
      .then(() => tests.push({ name, passed: true }))
      .catch((e) =>
        tests.push({
          name,
          passed: false,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
  };

  // Minimal `require()` shim for EVM tests that imported lessons
  // were generated against. Supports the small surface the course
  // tests actually use — full Node `crypto` / `ethers` would pull
  // megabytes into the worker without value here. Implementation
  // lives in `./evm/testRequire.ts` so the headless CLI verifier
  // can share the same shim (see `scripts/verify-evm-course.mjs`).
  const testRequire = makeTestRequire();

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    const fn = new AsyncFunction(
      "compiled",
      "chain",
      "expect",
      "test",
      "console",
      "require",
      testCode,
    );
    // Tests must run sequentially: each `chain.deploy()` mutates the
    // shared nonce cache + VM state, and parallel bodies race on
    // both, producing `account has nonce of: 0 tx has nonce of: N`
    // failures. Chain test bodies through a single promise so the
    // next body only starts after the previous one resolves.
    //
    // We also snapshot/revert around each test body so per-test state
    // changes (`chain.mine(100)`, `chain.warp(...)`, balance edits)
    // don't leak into the next test. Lessons that hardcode block
    // numbers (Commit-Reveal Auction's COMMIT_END=99) depend on each
    // test starting from a clean block counter.
    let prev: Promise<unknown> = Promise.resolve();
    const wrappedBody = (body: () => void | Promise<void>) => async () => {
      const snapId = await chain.snapshot();
      try {
        await body();
      } finally {
        try {
          await chain.revert(snapId);
        } catch {
          /* swallow — revert failure shouldn't mask the test outcome */
        }
      }
    };
    const wrappedTest = (
      name: string,
      body: () => void | Promise<void>,
    ) => {
      const wrapped = wrappedBody(body);
      prev = prev.then(
        () => testFn(name, wrapped),
        () => testFn(name, wrapped),
      );
    };
    // Build the `compiled` view tests see. We layer (1) the raw
    // file→contract map (so `compiled.contracts['Foo.sol']['Bar']` still
    // works), (2) a flat contract-name shortcut so generated tests can
    // do `compiled.contracts['Bar']` without knowing the source file,
    // and (3) the same viem helpers we expose on `chain` so test code
    // doesn't have to import viem.
    const flatContracts: Record<string, CompiledContract> = {};
    for (const file of Object.keys(compiled.contracts ?? {})) {
      for (const [name, info] of Object.entries(compiled.contracts[file])) {
        flatContracts[name] = info;
      }
    }
    const compiledView = {
      ...compiled,
      contracts: new Proxy(compiled.contracts ?? {}, {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          if (prop in flatContracts) return flatContracts[prop];
          return undefined;
        },
        has(target, prop: string) {
          return prop in target || prop in flatContracts;
        },
      }) as unknown as typeof compiled.contracts,
      keccak256: chain.keccak256,
      encodeAbiParameters: chain.encodeAbiParameters,
      decodeAbiParameters: chain.decodeAbiParameters,
      encodeFunctionData: chain.encodeFunctionData,
      decodeFunctionResult: chain.decodeFunctionResult,
    };
    await fn(compiledView, chain, expect, wrappedTest, consoleProxy, testRequire);
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
