/// Solana runtime — runs JS / TS test code against the Rust-side
/// LiteSVM via Tauri commands exposed by `chains/svm.rs`.
///
/// Architecture under Phase 5+: chain state lives entirely in Rust.
/// This module's job is to:
///
///   1. Bootstrap the Rust chain (idempotent — chainService memoises).
///   2. Build an `svm` object that the test sandbox sees as a global.
///      Methods on this object proxy to the chain service's
///      Tauri-invoke wrappers.
///   3. Tail snapshot updates back into the dock via the chainService
///      event listener (set up at first `ensureInitialised()`).
///
/// What the test code sees as globals:
///   - `svm` — the test-friendly client object below. Ergonomic
///     wrappers around the Rust commands.
///   - `kit` — the `@solana/kit` namespace re-exported wholesale so
///     tests can build instructions / addresses without imports.
///   - `splSystem` — the `@solana-program/system` namespace.
///     Exposes `getTransferSolInstruction`, `getCreateAccountInstruction`,
///     etc. — for lessons about hand-building System Program calls.
///   - `LAMPORTS_PER_SOL` — convenience constant.
///   - `expect` / `test` — same matcher API the EVM/BTC harness
///     surfaces.
///   - `console` — buffered into the run's log panel.
///
/// **Desktop-only.** The dispatcher in `runtimes/index.ts` short-
/// circuits with `desktopOnlyResult` for `harness === "solana"` in
/// the web build, so this file is never reached there.

import * as kit from "@solana/kit";
import * as splSystem from "@solana-program/system";
import type { Address, KeyPairSigner } from "@solana/kit";

import type { WorkbenchFile } from "@/data/types";
import type { LogLine, RunResult, TestResult } from "./types";
import { stringify } from "@/runtimes/evm/helpers";
import { expect } from "@/runtimes/evm/expect";
import {
  ensureInitialised,
  getSnapshot,
  svmAirdrop,
  svmBalance,
  svmBalanceFresh,
  svmBuildBpf,
  svmDeployProgram,
  svmSendTx,
  svmToolchainStatus,
  svmTransfer,
  svmWarpSlot,
  svmWarpTime,
  type SvmBuildResult,
  type SvmChainSnapshot,
  type SvmInstructionWire,
  type SvmSendTxResult,
  type SvmToolchainStatus,
  type TxSnapshot,
} from "@/lib/svm/chainService";

const LAMPORTS_PER_SOL = 1_000_000_000n;

// ── The `svm` client the test sandbox sees ───────────────────────

/// SignerProxy: a thin stand-in for the previous `KeyPairSigner`
/// the test code referenced via `svm.signers[i]`. The actual
/// keypair lives in Rust; the JS side only needs the address to
/// pass back over invoke. Lessons that previously did
/// `svm.transfer(svm.signers[0], svm.signers[1].address, ...)`
/// still work — `addressOf()` accepts either a SignerProxy or a
/// raw address string.
export interface SignerProxy {
  address: Address;
}

interface SvmClient {
  /// Default fee-payer (alias for `signers[0]`).
  payer: SignerProxy;
  /// 10 pre-funded signers — see chains/svm.rs.
  signers: SignerProxy[];
  /// Read the current full chain snapshot. Synchronous (local mirror).
  /// Useful for tests that want to inspect `txs[0]` after a tx, or
  /// count programs / accounts.
  snapshot(): SvmChainSnapshot;
  /// Convenience: current slot from the snapshot.
  slot(): bigint;
  /// Convenience: current unix timestamp (seconds, from the SVM's
  /// synthetic clock, NOT the host wall clock).
  unixTimestamp(): bigint;
  /// Convenience: most-recent transaction the chain processed
  /// (whatever was last pushed into Recent transactions). Returns
  /// `undefined` on a fresh chain.
  lastTx(): TxSnapshot | undefined;
  /// Synchronous balance read from the local snapshot mirror. Use
  /// `balanceFresh` for an explicit round-trip when reading an
  /// address that might not be in the dock's tracked set.
  balance(address: Address | SignerProxy): bigint;
  balanceFresh(address: Address | SignerProxy): Promise<bigint>;
  /// Move `lamports` from `from` to `to`. Returns the receipt with
  /// signature + actual fee charged. Throws on chain rejection
  /// (insufficient funds, missing signature, etc.).
  transfer(
    from: SignerProxy | Address,
    to: SignerProxy | Address,
    lamports: bigint,
  ): Promise<{ signature: string; feeLamports: bigint }>;
  /// Credit lamports without going through a real tx (no fee, no
  /// signature). Mirrors LiteSVM's `airdrop` — the same call the
  /// dock's faucet button makes.
  airdrop(address: Address | SignerProxy, lamports: bigint): Promise<void>;
  /// Move the in-memory clock forward by `slots`. Lessons that gate
  /// on slot height (vesting schedules, time-locked accounts) use
  /// this to skip past unlock conditions without real waiting.
  warpSlot(slots: bigint): Promise<void>;
  /// Bump the unix timestamp by `seconds`. Same shape as warpSlot,
  /// for the time axis.
  warpTime(seconds: bigint): Promise<void>;
  /// Send an arbitrary list of instructions. Use kit's instruction
  /// builders (e.g. `getTransferSolInstruction`) to construct each
  /// `Instruction`, pass them through here.
  sendTx(
    instructions: SvmInstructionWire[],
    feePayer?: SignerProxy | Address,
  ): Promise<SvmSendTxResult>;
  /// Deploy a BPF program from raw .so bytes. The lesson supplies
  /// the program ID (typically a fresh keypair's address) + the
  /// .so contents.
  deployProgram(
    programId: SignerProxy | Address,
    programName: string,
    soBytes: Uint8Array,
  ): Promise<void>;
  /// Status of the bundled Solana CLI (`cargo-build-sbf`). Returns
  /// `installed: true` when the toolchain is on disk and ready for
  /// `buildBpf` calls.
  toolchainStatus(): Promise<SvmToolchainStatus>;
  /// Compile a Rust BPF project. Shells out to the bundled
  /// `cargo-build-sbf`. Returns paths to .so files for subsequent
  /// `deployProgram` calls.
  buildBpf(projectPath: string): Promise<SvmBuildResult>;
  /// Run `body` and assert it throws. Optionally match the failure
  /// message against a string or RegExp.
  expectFail(
    body: Promise<unknown> | (() => Promise<unknown>),
    matcher?: string | RegExp,
  ): Promise<void>;
}

function addressOf(x: SignerProxy | Address | KeyPairSigner): Address {
  if (typeof x === "string") return x;
  // SignerProxy and KeyPairSigner both expose `.address`. We accept
  // either so legacy lesson code keeps compiling.
  return (x as SignerProxy).address;
}

function buildSvmClient(): SvmClient {
  const snap = getSnapshot();
  const signers: SignerProxy[] = snap.accounts.map((a) => ({
    address: a.address,
  }));
  // If we're called before the chain has bootstrapped (no accounts in
  // the snapshot yet), the signers array is empty. Test code that
  // touches `svm.signers[0]` would hit `undefined.address` — surface
  // a clearer error.
  if (signers.length === 0) {
    throw new Error(
      "SVM has no signers — chain hasn't bootstrapped yet. " +
        "(This usually means the desktop app's Rust backend failed to " +
        "init litesvm — check the diagnostics panel.)",
    );
  }
  return {
    payer: signers[0],
    signers,
    snapshot() {
      return getSnapshot();
    },
    slot() {
      return getSnapshot().slot;
    },
    unixTimestamp() {
      return getSnapshot().unixTimestamp;
    },
    lastTx() {
      return getSnapshot().txs[0];
    },
    balance(address) {
      return svmBalance(addressOf(address));
    },
    balanceFresh(address) {
      return svmBalanceFresh(addressOf(address));
    },
    async transfer(from, to, lamports) {
      return await svmTransfer(addressOf(from), addressOf(to), lamports);
    },
    async airdrop(address, lamports) {
      return await svmAirdrop(addressOf(address), lamports);
    },
    async warpSlot(slots) {
      return await svmWarpSlot(slots);
    },
    async warpTime(seconds) {
      return await svmWarpTime(seconds);
    },
    async sendTx(instructions, feePayer) {
      const fp = feePayer ? addressOf(feePayer) : signers[0].address;
      return await svmSendTx(instructions, fp);
    },
    async deployProgram(programId, programName, soBytes) {
      return await svmDeployProgram(addressOf(programId), programName, soBytes);
    },
    async toolchainStatus() {
      return await svmToolchainStatus();
    },
    async buildBpf(projectPath) {
      return await svmBuildBpf(projectPath);
    },
    async expectFail(body, matcher) {
      let threw = false;
      let msg = "";
      try {
        await (typeof body === "function" ? body() : body);
      } catch (e) {
        threw = true;
        msg = e instanceof Error ? e.message : String(e);
      }
      if (!threw) {
        throw new Error("Expected SVM tx to fail, but it succeeded");
      }
      if (matcher === undefined) return;
      const ok =
        typeof matcher === "string"
          ? msg.includes(matcher)
          : matcher.test(msg);
      if (!ok) {
        throw new Error(
          `Expected failure message to match ${matcher}, got: ${msg}`,
        );
      }
    },
  };
}

// ── Public entry point ───────────────────────────────────────────

/// Public entry point. Same shape as `runBitcoin` so the dispatcher
/// swap in `runtimes/index.ts` is one line.
export async function runSolana(
  files: WorkbenchFile[],
  testCode?: string,
): Promise<RunResult> {
  const started = Date.now();
  const logs: LogLine[] = [];
  const tests: TestResult[] = [];

  // Concatenate the lesson's source files into a leading IIFE-ish
  // module-eval scope so any helpers the learner declares are in
  // scope when the tests run. Same pattern Bitcoin uses; mirrors
  // EVM's harness layout for cross-runtime consistency.
  const lessonSource = files
    .filter((f) => /\.(js|ts|mjs)$/i.test(f.name) || !f.name.includes("."))
    .map((f) => f.content ?? "")
    .join("\n");

  if (!testCode) {
    logs.push({
      level: "log",
      text:
        "✓ Solana runtime loaded. Add a test file to send instructions " +
        "against the local SVM.",
    });
    return { logs, durationMs: Date.now() - started };
  }

  // Bootstrap the Rust chain (idempotent — chainService memoises).
  // If this fails (Tauri not ready, litesvm init crashed), surface
  // the error to the test panel rather than letting the harness
  // explode with "Cannot read properties of undefined".
  try {
    await ensureInitialised();
  } catch (e) {
    logs.push({
      level: "error",
      text:
        `SVM chain failed to initialise — desktop backend may not be ` +
        `ready: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { logs, durationMs: Date.now() - started };
  }

  // Wait for the snapshot mirror to actually populate. `ensureInitialised`
  // resolves once the listener is registered + initial snapshot fetched
  // — but the listener might race with the test's first `getSnapshot()`
  // read. If the snapshot still has zero accounts, the next snapshot
  // event WILL bring them in; we poll briefly before giving up.
  // Without this, a fast first-Run hits "svm has no signers" and the
  // unhandled throw can take down the lesson view.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (getSnapshot().accounts.length > 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }

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

  // Tests run sequentially — the SVM is mutable shared state and
  // ordering matters. Chaining via the `prev` accumulator preserves
  // strict order and lets later tests build on earlier ones.
  let prev: Promise<unknown> = Promise.resolve();
  const wrappedTest = (
    name: string,
    body: () => void | Promise<void>,
  ): void => {
    prev = prev.then(
      () => testFn(name, body),
      () => testFn(name, body),
    );
  };

  // Build the svm client AFTER ensureInitialised resolves so the
  // snapshot's accounts list is populated. Wrapped in try/catch so
  // a missing-snapshot first-Run surfaces in the test panel rather
  // than throwing through to the lesson view (which would trigger
  // React's error boundary and bounce the user back to the library).
  let svm: SvmClient;
  try {
    svm = buildSvmClient();
  } catch (e) {
    logs.push({
      level: "error",
      text:
        `Failed to build SVM client: ${e instanceof Error ? e.message : String(e)}\n` +
        `(This usually means the Rust backend hadn't fully booted by the time ` +
        `you clicked Run. Try clicking Run again.)`,
    });
    return { logs, durationMs: Date.now() - started };
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    const wrappedSource = `
${lessonSource}

${testCode}
`;
    const fn = new AsyncFunction(
      "svm",
      "kit",
      "splSystem",
      "LAMPORTS_PER_SOL",
      "expect",
      "test",
      "console",
      wrappedSource,
    );
    await fn(
      svm,
      kit,
      splSystem,
      LAMPORTS_PER_SOL,
      expect,
      wrappedTest,
      consoleProxy,
    );
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
