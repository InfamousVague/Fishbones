/// SVM runtime — executes Solana program lessons against a real SVM
/// in-process via the `litesvm` napi module. Mirrors the role
/// `runtimes/evm.ts` plays for the Ethereum course: students write
/// Solana code (Rust programs and/or @solana/kit clients), the harness
/// compiles + deploys + invokes, tests assert on resulting account
/// state.
///
/// ### Architecture
///
/// ```
///   Lesson (course.json)        ← student source + tests in TS
///         │
///         ▼
///   harness:"svm" dispatch  →   runSvm(files, testCode)
///         │
///         ▼
///   buildSvm()           — wraps litesvm + @solana/kit into a
///                          friendly `svm.*` API
///         │
///         ▼
///   AsyncFunction(testCode, { svm, expect, test, ... })
/// ```
///
/// ### Browser support — none (deliberate)
///
/// litesvm is a Rust napi module; it doesn't run in the browser.
/// fishbones.academy/learn shows a "desktop only" prompt for SVM
/// lessons. The Tauri build talks to a Node sidecar that imports this
/// module — see `desktopComingSoon.ts` for the pattern other native
/// runtimes already use.
///
/// ### Compilation strategy
///
/// Custom Solana programs ship as pre-built `.so` files alongside the
/// lesson. Tomorrow we'll add a `cargo build-sbf` step (requires the
/// `solana` CLI on the user's PATH); for now the lesson author
/// compiles offline, drops the `.so` into a `programs/` resources
/// folder, and the harness loads it from there.

import { LiteSVM } from "litesvm";
import {
  generateKeyPairSigner,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  // Brand-creator: turns a plain bigint into the `Lamports` nominal
  // type the kit signature requires. Cheap (no runtime check beyond
  // a bigint cast).
  lamports,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

/// One lamport = 1e-9 SOL. Re-exported so course tests can write
/// `1n * SOL` instead of repeating the literal.
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/// Per-account snapshot the harness exposes via `svm.account(pubkey)`.
/// Mirrors the litesvm `Account` shape but with bigint lamports +
/// hex-string keys for ergonomics.
export interface AccountSnapshot {
  address: Address;
  lamports: bigint;
  owner: Address;
  /// Raw account data as a Uint8Array. Empty for fresh non-PDA
  /// accounts; populated for accounts owned by user programs.
  data: Uint8Array;
  executable: boolean;
}

/// What the harness hands to lesson test code as the global `svm`.
/// Designed to feel close to the EVM harness's `chain` so the two
/// course experiences read as siblings.
export interface SvmHarness {
  /// Default fee-payer + signer. Pre-funded with 100 SOL so tests
  /// don't have to airdrop manually.
  payer: KeyPairSigner;

  /// 9 additional pre-funded signers for multi-party tests
  /// (matches the EVM `chain.accounts[1..]` convention).
  signers: KeyPairSigner[];

  /// Mint a fresh keypair signer with `lamports` deposited. Use when
  /// the test needs a new account beyond the 10 pre-funded ones.
  newSigner(lamports?: bigint): Promise<KeyPairSigner>;

  /// Read the current lamport balance. Returns 0n for accounts that
  /// don't exist (litesvm itself returns null in that case; we
  /// normalize so test math doesn't have to do null-checks).
  balance(address: Address): bigint;

  /// Full account snapshot. Returns null if the account doesn't
  /// exist on-chain yet.
  account(address: Address): AccountSnapshot | null;

  /// Send a list of instructions signed by the supplied signers.
  /// `feePayer` defaults to `svm.payer`. Returns the transaction's
  /// metadata (fees paid, logs, return data) on success; throws on
  /// failure with the SVM's error message attached.
  send(
    instructions: Instruction[],
    signers?: KeyPairSigner[],
    feePayer?: KeyPairSigner,
  ): Promise<TxResult>;

  /// Convenience for the canonical "move SOL from A to B" tx —
  /// students still build the instruction by hand in lessons that
  /// teach SystemProgram, but other lessons just want funded state.
  transfer(
    from: KeyPairSigner,
    to: Address,
    lamports: bigint,
  ): Promise<TxResult>;

  /// Load a custom program from a pre-built `.so` file. Two ways to
  /// resolve the binary:
  ///   1. **By name** (`"counter"`) — looks up
  ///      `tests/svm-runtime/programs/<name>/target/deploy/fishbones_<name>.so`
  ///      relative to the project root. The standard place compiled
  ///      programs land, so most lessons just pass a name.
  ///   2. **By path** (`"/abs/or/relative.so"`) — used directly.
  /// Returns the program id the runtime ended up assigning so lesson
  /// tests can invoke it.
  deployProgram(programId: Address, nameOrPath: string): void;

  /// Move the runtime clock forward by `slots` (~400ms each) without
  /// requiring real waiting. Mirrors `chain.mine()` for EVM lessons.
  warpSlot(slots: bigint): void;

  /// Bump the unix timestamp on the runtime clock by `seconds`.
  /// Useful for time-locked-account tests.
  warpTime(seconds: bigint): void;

  /// Run `body` and assert it throws. Optionally match the failure
  /// message against a string or RegExp. Mirrors `chain.expectRevert`
  /// from the EVM harness.
  expectFail(
    body: Promise<unknown> | (() => Promise<unknown>),
    matcher?: string | RegExp,
  ): Promise<void>;

  /// Raw access to the underlying litesvm instance for advanced
  /// lessons that need a mode the friendly API doesn't expose.
  raw: LiteSVM;
}

export interface TxResult {
  /// All log lines emitted by programs invoked during the tx, in
  /// emission order. Useful for asserting on `msg!()` output from
  /// student programs.
  logs: string[];
  /// Lamports debited from the fee payer for processing this tx
  /// (NOT the value transferred — fees only).
  feeLamports: bigint;
  /// `returnData` from the last program invocation, if any. Most
  /// instructions don't set this; SPL Token's `getTokenAccountBalance`
  /// is one that does.
  returnData: Uint8Array | null;
}

/// Build a fresh SVM harness with 10 pre-funded signers. The default
/// fee payer (`payer`) and `signers[0]` are the same account so
/// single-party tests stay simple.
export async function buildSvm(): Promise<SvmHarness> {
  const svm = new LiteSVM();

  // Pre-fund 10 signers with 100 SOL each. Generous on purpose —
  // cheap tests, and the EVM harness's accounts get 10K ETH equivalent.
  const PREFUND = 100n * LAMPORTS_PER_SOL;
  const signers: KeyPairSigner[] = [];
  for (let i = 0; i < 10; i++) {
    const s = await generateKeyPairSigner();
    svm.airdrop(s.address, lamports(PREFUND));
    signers.push(s);
  }

  const payer = signers[0];

  const send = async (
    instructions: Instruction[],
    extraSigners: KeyPairSigner[] = [],
    feePayer: KeyPairSigner = payer,
  ): Promise<TxResult> => {
    const blockhash = svm.latestBlockhash();
    // Use FeePayerSigner (not FeePayer) so signTransactionMessageWithSigners
    // knows which keypair to sign with for the fee. Otherwise hand-built
    // instructions that don't carry IInstructionWithSigners metadata
    // would result in "missing signatures" — kit only signs for signers
    // it can find attached to the message.
    const txMsg = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash, lastValidBlockHeight: 100n },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    // signTransactionMessageWithSigners auto-includes signers from
    // any IInstructionWithSigners on the instruction list, plus the
    // fee payer. `extraSigners` is for accounts that aren't tied to
    // a specific instruction (rare — usually instruction-builders
    // already attach the right signers).
    void extraSigners;
    const signed = await signTransactionMessageWithSigners(txMsg);
    // Solana's legacy tx fee is fixed at 5000 lamports per signature
    // (no priority fee in the in-process runtime). Count the
    // signatures the kit attached so the receipt carries the *real*
    // fee, not a delta-from-balance which would conflate value
    // transferred with fees paid.
    const numSignatures = Object.keys(
      (signed as unknown as { signatures: Record<string, unknown> }).signatures,
    ).length;
    const result = svm.sendTransaction(signed);
    const cls = result.constructor.name;
    if (cls === "FailedTransactionMetadata") {
      // litesvm returns `FailedTransactionMetadata` rather than
      // throwing. Surface the underlying error + logs so tests can
      // assert on them via `expectFail`.
      const f = result as unknown as { err(): unknown; meta(): unknown };
      const err = f.err();
      const meta = f.meta() as { logs: () => string[] } | null;
      const logs = meta?.logs() ?? [];
      throw Object.assign(
        new Error(`SVM tx failed: ${stringifyErr(err)}\n${logs.join("\n")}`),
        { svmError: err, logs },
      );
    }
    const meta = result as unknown as {
      logs: () => string[];
      returnData: () => { data: () => Uint8Array } | null;
    };
    // Expire the blockhash so the *next* send picks up a fresh one.
    // Two identical instruction lists with the same fee payer would
    // produce an identical signature against the same blockhash —
    // Solana rejects the duplicate as `AlreadyProcessed`. Real chains
    // see this resolve naturally as the cluster's blockhash rotates;
    // in litesvm's deterministic single-slot world we have to do it
    // ourselves.
    svm.expireBlockhash();

    return {
      logs: meta.logs(),
      feeLamports: 5000n * BigInt(numSignatures),
      returnData: meta.returnData()?.data() ?? null,
    };
  };

  const transfer = (
    from: KeyPairSigner,
    to: Address,
    lamports: bigint,
  ): Promise<TxResult> =>
    send(
      [
        getTransferSolInstruction({
          source: from,
          destination: to,
          amount: lamports,
        }),
      ],
      [],
      from,
    );

  // Param shadows the `lamports()` brand helper imported at the top —
  // use a different name internally to keep both reachable.
  const newSigner = async (initial = PREFUND): Promise<KeyPairSigner> => {
    const s = await generateKeyPairSigner();
    if (initial > 0n) svm.airdrop(s.address, lamports(initial));
    return s;
  };

  const balance = (address: Address): bigint =>
    svm.getBalance(address) ?? 0n;

  const account = (address: Address): AccountSnapshot | null => {
    // litesvm.getAccount returns a plain object with these fields:
    //   { exists, address, lamports, programAddress, space, data, executable }
    // We rename `programAddress` → `owner` to match Solana's standard
    // terminology and the field name learners will see in every other
    // SDK / docs page.
    const acc = svm.getAccount(address) as unknown as {
      exists: boolean;
      lamports: bigint;
      programAddress: string;
      data: Uint8Array;
      executable: boolean;
    } | null;
    if (!acc || !acc.exists) return null;
    return {
      address,
      lamports: acc.lamports,
      owner: acc.programAddress as Address,
      data: acc.data,
      executable: acc.executable,
    };
  };

  const deployProgram = (programId: Address, nameOrPath: string): void => {
    const resolved = resolveProgramPath(nameOrPath);
    svm.addProgramFromFile(programId, resolved);
  };

  const warpSlot = (slots: bigint): void => {
    const clock = svm.getClock();
    clock.slot = clock.slot + slots;
    svm.setClock(clock);
  };

  const warpTime = (seconds: bigint): void => {
    const clock = svm.getClock();
    clock.unixTimestamp = clock.unixTimestamp + seconds;
    svm.setClock(clock);
  };

  const expectFail = async (
    body: Promise<unknown> | (() => Promise<unknown>),
    matcher?: string | RegExp,
  ): Promise<void> => {
    let threw = false;
    let msg = "";
    try {
      await (typeof body === "function" ? body() : body);
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : String(e);
    }
    if (!threw) throw new Error("Expected SVM tx to fail, but it succeeded");
    if (matcher === undefined) return;
    const ok = typeof matcher === "string"
      ? msg.includes(matcher)
      : matcher.test(msg);
    if (!ok) {
      throw new Error(
        `Expected failure message to match ${matcher}, got: ${msg}`,
      );
    }
  };

  return {
    payer,
    signers,
    newSigner,
    balance,
    account,
    send,
    transfer,
    deployProgram,
    warpSlot,
    warpTime,
    expectFail,
    raw: svm,
  };
}

/// Resolve a program name (`"counter"`) or path to an absolute .so
/// file the litesvm binary loader can read. Names map by convention
/// to `tests/svm-runtime/programs/<name>/target/deploy/fishbones_<name>.so`
/// — the layout cargo-build-sbf produces from
/// `tests/svm-runtime/programs/<name>/Cargo.toml`.
///
/// Throws a helpful error pointing at `npm run build:svm-programs`
/// if the .so is missing — most often happens the first time
/// someone clones the repo and runs `npm run test:svm` before the
/// build step.
function resolveProgramPath(nameOrPath: string): string {
  // Path-like input: looks like a file (has a slash or ends with .so)
  // → use as-is. Names: bare identifiers, mapped to the build dir.
  const isPath = nameOrPath.includes("/") || nameOrPath.endsWith(".so");
  if (isPath) {
    return nameOrPath;
  }
  // Use Node's filesystem APIs at runtime; the `import` is dynamic so
  // this module remains importable in browser contexts (where it'd
  // never reach this code path — browser path always uses an absolute
  // URL or a base64 blob the lesson content ships).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  // Walk up from cwd until we find a `tests/svm-runtime/programs`
  // directory — works whether the test is invoked from the repo root
  // or from a sub-package.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(
      dir,
      "tests/svm-runtime/programs",
      nameOrPath,
      `target/deploy/fishbones_${nameOrPath}.so`,
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Solana program "${nameOrPath}" not built. Run:\n` +
      `  npm run build:svm-programs\n` +
      `(needs the Solana CLI on PATH or at ~/.local/share/solana/...)`,
  );
}

function stringifyErr(err: unknown): string {
  if (err === null || err === undefined) return "(no error)";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
