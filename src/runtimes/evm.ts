import type { WorkbenchFile } from "../data/types";
import type { RunResult, LogLine, TestResult } from "./types";

/// EVM runtime — compiles Solidity/Vyper source, then *executes* the
/// resulting bytecode in an in-process @ethereumjs/vm so course
/// exercises can deploy a contract and call its functions for real
/// (rather than just inspecting the ABI).
///
/// The exposed `chain` global is shaped after Ganache + Anvil so the
/// API a learner uses here mirrors what they'd write against a real
/// dev chain. Plus a viem-compatible `chain.transport` lets tests
/// drop in `createPublicClient({ transport: chain.transport })` /
/// `createWalletClient({ ... })` for the same JSON-RPC surface
/// they'd hit on a live node — `eth_*` and the Ganache-flavoured
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

import { VM } from "@ethereumjs/vm";
import { Common, Chain, Hardfork } from "@ethereumjs/common";
import { LegacyTransaction } from "@ethereumjs/tx";
import {
  Address,
  Account,
  hexToBytes,
  bytesToHex,
  privateToAddress,
} from "@ethereumjs/util";
import {
  encodeDeployData,
  encodeFunctionData,
  decodeFunctionResult,
  decodeErrorResult,
  parseEventLogs,
  type Abi,
  type AbiEvent,
  type EIP1193RequestFn,
} from "viem";

import { loadSolc, buildSolcInput } from "./solidity";

type Hex = `0x${string}`;

interface CompiledContract {
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
}

interface CompiledOutput {
  errors?: Array<{
    severity: "error" | "warning" | "info";
    formattedMessage?: string;
    message?: string;
  }>;
  contracts: Record<string, Record<string, CompiledContract>>;
}

interface AccountHandle {
  address: Hex;
  privateKey: Hex;
}

interface DeployOpts {
  value?: bigint;
  from?: AccountHandle;
}

interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
}

interface CallReceipt {
  status: "success" | "reverted";
  logs: RawLog[];
  /// Convenience parser keyed off the calling contract's ABI — pulls
  /// out matching events in viem's parsed shape (`{ eventName, args
  /// }`). Returns the same flat array `getLogs` would for the same
  /// filter, just pre-decoded.
  events: Array<{ eventName: string; args: Record<string, unknown> }>;
  gasUsed: bigint;
  blockNumber: bigint;
}

interface ContractInstance {
  address: Hex;
  abi: Abi;
  read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  write: Record<string, (...args: unknown[]) => Promise<CallReceipt>>;
  /// Re-bind the same contract to a different sender for the next call.
  connect(account: AccountHandle): ContractInstance;
}

interface LogFilter {
  address?: Hex;
  fromBlock?: bigint;
  toBlock?: bigint;
  /// Optional viem-style topic filter: `[topic0, topic1, ...]` where
  /// each entry can be `null` (any), a single `Hex`, or an array of
  /// `Hex` (any-of).
  topics?: Array<Hex | Hex[] | null>;
}

interface ChainHarness {
  /// Default sender for every transaction unless `from:` is supplied.
  /// Mirrors anvil's account 0; balance 1,000,000 ETH.
  account: AccountHandle;
  /// 10 pre-funded EOAs total — anvil / ganache convention. The
  /// first entry is the same object as `account`. Convenient for
  /// multi-actor tests without having to call `newAccount()`.
  accounts: AccountHandle[];
  newAccount(opts?: { balance?: bigint }): Promise<AccountHandle>;

  deploy(
    name: string,
    args?: unknown[],
    opts?: DeployOpts,
  ): Promise<ContractInstance>;
  getContract(name: string, address: Hex): ContractInstance;

  /// Asserts a Promise rejects. With a `signatureOrReason` argument
  /// (e.g. `"NotOwner"` or `"NotOwner()"`), checks the revert
  /// payload's decoded name/message contains that substring.
  expectRevert(p: Promise<unknown>, signatureOrReason?: string): Promise<void>;

  balanceOf(address: Hex): Promise<bigint>;
  /// Set an account's balance directly (anvil/ganache convention).
  /// Useful for funding test characters that don't need a real EOA.
  setBalance(address: Hex, balance: bigint): Promise<void>;

  /// Snapshot/revert chain state. `revert(id)` returns to the exact
  /// state at the time of `snapshot()` AND invalidates all snapshots
  /// taken AFTER the reverted-to point — same semantics as Hardhat /
  /// Ganache. Returns false if the id is unknown / already consumed.
  snapshot(): Promise<string>;
  revert(id: string): Promise<boolean>;

  /// Advance the block number. Each mined block increments
  /// `block.number` by 1 and `block.timestamp` by 12 seconds (the
  /// post-merge slot interval).
  mine(blocks?: number): Promise<void>;
  /// Bump `block.timestamp` by `seconds` on the next mined block.
  /// Idempotent across calls until the next mine() — multiple warps
  /// without a mine accumulate.
  warp(seconds: number | bigint): Promise<void>;
  /// Read the current block number / timestamp without mining.
  blockNumber(): bigint;
  blockTimestamp(): bigint;

  /// Filter against the in-memory log buffer (every log emitted by a
  /// successful tx). When `event` is supplied, results are decoded
  /// via viem's `parseEventLogs`; without it you get raw `topics +
  /// data` entries.
  getLogs(filter?: LogFilter & { abi?: Abi; eventName?: string }): Promise<
    | RawLog[]
    | Array<{ eventName: string; args: Record<string, unknown> } & RawLog>
  >;

  /// EIP-1193-shaped JSON-RPC transport for use with viem:
  ///   const client = createPublicClient({ transport: custom(chain.transport) });
  /// Implements the `eth_*` subset most exercises need plus the
  /// Ganache `evm_*` extensions. See `request()` below for the
  /// supported method list.
  transport: { request: EIP1193RequestFn };
}

const DEFAULT_PRIVKEYS: Hex[] = [
  // Same set anvil prints at startup. Lets a learner who's
  // followed an anvil tutorial drop those addresses straight into
  // their test code without surprises.
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dfd1c6311b",
];
const DEFAULT_BALANCE = 10n ** 24n; // 1,000,000 ETH — generous for tests
const SLOT_DURATION = 12n; // post-merge: a block every 12 seconds

/// Optional hooks the long-lived chain singleton (in
/// `evmChainService`) wires up so the in-app GanacheDock UI re-renders
/// when state changes. The ephemeral test path (default) passes
/// `undefined` and the chain runs without any side-effects.
export interface ChainAttachHooks {
  onAccountsChanged?(accounts: AccountSnapshot[]): void;
  onBlockChanged?(blockNumber: bigint, blockTimestamp: bigint): void;
  onContractDeployed?(c: ContractSnapshot): void;
  onTx?(tx: TxSnapshot): void;
}

interface AccountSnapshot {
  address: Hex;
  privateKey: Hex;
  balanceWei: bigint;
  nonce: bigint;
  label: string;
}

interface ContractSnapshot {
  address: Hex;
  name: string;
  deployedAtBlock: bigint;
}

interface TxSnapshot {
  hash: Hex;
  kind: "deploy" | "call" | "value-transfer" | "faucet";
  from: Hex;
  to?: Hex;
  fn?: string;
  valueWei: bigint;
  status: "success" | "reverted";
  blockNumber: bigint;
  timestamp: number;
}

/// Mutator added on top of `ChainHarness` for the persistent path.
/// `setCompiled` swaps the compiled-artifacts table so a single
/// long-lived chain can serve sequential lessons without rebuilding
/// the VM. `loadInitialSnapshot` flushes the current state through
/// the hooks so the UI sees something immediately on first mount.
interface PersistentChainExtras {
  setCompiled(c: CompiledOutput): void;
  loadInitialSnapshot(): Promise<void>;
}

async function buildChain(
  initialCompiled: CompiledOutput,
  hooks: ChainAttachHooks = {},
): Promise<ChainHarness & PersistentChainExtras> {
  // Common across the whole run. Mainnet + Cancun is the closest
  // match to what a learner targets when developing today —
  // post-merge, post-shanghai, has push0, has tload/tstore, has
  // EIP-4844 blobs (which we don't expose but which means basefee
  // semantics line up with a current node).
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun });
  const vm = await VM.create({ common });

  // Mutable so the persistent path can swap in fresh artifacts each
  // lesson run without rebuilding the VM. `findArtifact` reads from
  // this ref, not the closure-captured `initialCompiled`.
  let compiled = initialCompiled;

  // Mutable virtual block context. mine() bumps the number;
  // warp() bumps the timestamp delta which folds in on the next mine.
  // Initial values pinned to round numbers so test output is stable.
  let currentBlockNumber = 1n;
  let currentBlockTimestamp = 1_700_000_000n; // late-2023, post-merge era
  let pendingTimestampDelta = 0n;

  // Per-call log buffer. Each log carries its block + a monotonically
  // increasing index so getLogs can sort + filter deterministically.
  const logBuffer: RawLog[] = [];
  let logCounter = 0;

  // Snapshot stack. Each snapshot records the state root + the block
  // counters + the high-water mark into logBuffer + the nonce cache.
  // revert(id) restores all of those AND drops every snapshot taken
  // after the reverted-to point — matches Ganache/Hardhat semantics.
  interface Snapshot {
    id: string;
    stateRoot: Uint8Array;
    blockNumber: bigint;
    blockTimestamp: bigint;
    pendingTimestampDelta: bigint;
    logCount: number;
    nonces: Map<Hex, bigint>;
  }
  const snapshots: Snapshot[] = [];
  let snapshotIdSeq = 1;

  const findArtifact = (name: string): CompiledContract => {
    for (const file of Object.keys(compiled.contracts)) {
      const hit = compiled.contracts[file][name];
      if (hit) return hit;
    }
    throw new Error(
      `Contract "${name}" not in compiled output. Available: ${Object.values(
        compiled.contracts,
      )
        .flatMap((m) => Object.keys(m))
        .join(", ")}`,
    );
  };

  // Pre-fund an EOA: derive its address, write a fresh Account into
  // the state manager with the given balance, return a handle.
  const seedAccount = async (
    privKeyHex: Hex,
    balance: bigint,
  ): Promise<AccountHandle> => {
    const privBytes = hexToBytes(privKeyHex);
    const addrBytes = privateToAddress(privBytes);
    const addrHex = bytesToHex(addrBytes) as Hex;
    const existing = await vm.stateManager.getAccount(new Address(addrBytes));
    const acc = new Account(existing?.nonce ?? 0n, balance);
    await vm.stateManager.putAccount(new Address(addrBytes), acc);
    return { address: addrHex, privateKey: privKeyHex };
  };

  // Pre-fund the standard 10 anvil/ganache accounts.
  const accounts: AccountHandle[] = [];
  for (const pk of DEFAULT_PRIVKEYS) {
    accounts.push(await seedAccount(pk, DEFAULT_BALANCE));
  }
  const defaultAccount = accounts[0];

  // Nonce cache. We could read from VM state on every tx, but the
  // VM increments the on-account nonce post-tx anyway, so we track
  // the next-to-use nonce here for fast access. Snapshot/revert
  // checkpoints this map.
  const nonceCache = new Map<Hex, bigint>();
  for (const a of accounts) nonceCache.set(a.address, 0n);

  const nextNonce = (addr: Hex): bigint => {
    const n = nonceCache.get(addr) ?? 0n;
    nonceCache.set(addr, n + 1n);
    return n;
  };

  // Build, sign, and run a tx. Returns receipt + decoded events.
  const runTx = async (params: {
    from: AccountHandle;
    to?: Hex;
    data: Hex;
    value?: bigint;
    abi?: Abi;
  }) => {
    // Apply any pending timestamp delta on this tx's block.
    if (pendingTimestampDelta !== 0n) {
      currentBlockTimestamp += pendingTimestampDelta;
      pendingTimestampDelta = 0n;
    }

    // Cancun enforces EIP-1559: every block has a baseFeePerGas the
    // tx must clear or the VM rejects with "gasPrice (X) is less
    // than the block's baseFeePerGas (Y)". @ethereumjs/vm starts at
    // baseFee = 7 wei and ratchets up with every full block, so a
    // long-running session needs a comfortable margin. 100 gwei is
    // anvil's default — well above anything the in-process VM will
    // ever charge — and lets us treat gas as a non-event for tests.
    const tx = LegacyTransaction.fromTxData(
      {
        nonce: nextNonce(params.from.address),
        gasPrice: 100n * 10n ** 9n, // 100 gwei
        gasLimit: 30_000_000n,
        to: params.to,
        value: params.value ?? 0n,
        data: hexToBytes(params.data),
      },
      { common },
    ).sign(hexToBytes(params.from.privateKey));

    const result = await vm.runTx({ tx, skipBalance: false });
    const reverted = !!result.execResult.exceptionError;
    const returnValue = bytesToHex(result.execResult.returnValue) as Hex;

    // Capture logs for getLogs()/event helpers — only on success
    // (reverted txs are rolled back and Ganache doesn't keep their
    // logs either).
    const txLogs: RawLog[] = [];
    if (!reverted) {
      for (const [addrBytes, topics, data] of result.execResult.logs ?? []) {
        const addr = bytesToHex(addrBytes) as Hex;
        const log: RawLog = {
          address: addr,
          topics: topics.map((t: Uint8Array) => bytesToHex(t) as Hex),
          data: bytesToHex(data) as Hex,
          blockNumber: currentBlockNumber,
          logIndex: logCounter++,
        };
        txLogs.push(log);
        logBuffer.push(log);
      }
    }

    // Pre-decode events when an ABI is supplied (per-call helper for
    // CallReceipt.events). ABI-less callers fall back to raw logs.
    let events: Array<{ eventName: string; args: Record<string, unknown> }> = [];
    if (params.abi && txLogs.length > 0) {
      try {
        const parsed = parseEventLogs({
          abi: params.abi,
          // Cast through `unknown` because viem's `parseEventLogs`
          // requires the strict `Log` discriminated union (with
          // optional vs always-present numeric fields). Our raw
          // logs always have block / index numbers populated, but
          // the type inference picks the strict-RpcLog overload
          // and complains about the `removed: false` literal.
          logs: txLogs.map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: l.blockNumber,
            logIndex: l.logIndex,
            transactionIndex: 0,
            blockHash: ("0x" + "0".repeat(64)) as Hex,
            transactionHash: ("0x" + "0".repeat(64)) as Hex,
            removed: false,
          })) as unknown as Parameters<typeof parseEventLogs>[0]["logs"],
        });
        events = parsed.map((p) => ({
          eventName: p.eventName,
          args: (p.args ?? {}) as Record<string, unknown>,
        }));
      } catch {
        // Event not in this contract's ABI — leave events empty;
        // the raw logs are still in CallReceipt.logs.
      }
    }

    // Bump block on every tx so receipts have monotonic numbers.
    // (We don't pretend to do real block production — just give
    // tests a moving block.number to assert against.)
    const thisBlock = currentBlockNumber;
    currentBlockNumber += 1n;
    currentBlockTimestamp += SLOT_DURATION;

    // Notify any attached UI listener. Best-effort — a hook throwing
    // mid-tx must NOT break the tx itself; the dock would just miss
    // a frame.
    try {
      hooks.onBlockChanged?.(currentBlockNumber, currentBlockTimestamp);
      hooks.onTx?.({
        hash: ("0x" + thisBlock.toString(16).padStart(8, "0") +
          params.from.address.slice(2).padStart(56, "0")) as Hex,
        kind: result.createdAddress ? "deploy" : (params.value ?? 0n) > 0n ? "value-transfer" : "call",
        from: params.from.address,
        to: params.to,
        valueWei: params.value ?? 0n,
        status: reverted ? "reverted" : "success",
        blockNumber: thisBlock,
        timestamp: Date.now(),
      });
    } catch {
      /* swallow */
    }

    return {
      reverted,
      returnValue,
      createdAddress: result.createdAddress
        ? (bytesToHex(result.createdAddress.bytes) as Hex)
        : undefined,
      logs: txLogs,
      events,
      gasUsed: result.totalGasSpent,
      blockNumber: thisBlock,
      revertReason: reverted ? returnValue : undefined,
    };
  };

  const decodeRevert = (abi: Abi, data: Hex): Error => {
    if (data === "0x" || data.length < 10) {
      return new Error("execution reverted (no reason)");
    }
    try {
      const decoded = decodeErrorResult({ abi, data });
      const args = (decoded.args ?? [])
        .map((a) => (typeof a === "bigint" ? a.toString() : String(a)))
        .join(", ");
      return new Error(
        `execution reverted: ${decoded.errorName}(${args})`,
      );
    } catch {
      return new Error(`execution reverted (raw=${data})`);
    }
  };

  // Wrap an address+ABI pair as a viem-shaped read/write proxy.
  // `connect(other)` rebinds the proxy to another sender (cheap —
  // doesn't reload the ABI).
  const wrap = (
    name: string,
    address: Hex,
    abi: Abi,
    sender: AccountHandle,
  ): ContractInstance => {
    const inst: ContractInstance = {
      address,
      abi,
      read: {},
      write: {},
      connect(account) {
        return wrap(name, address, abi, account);
      },
    };
    for (const item of abi) {
      if (item.type !== "function") continue;
      const fnName = item.name;
      const isView =
        item.stateMutability === "view" || item.stateMutability === "pure";
      if (isView) {
        inst.read[fnName] = async (...args: unknown[]) => {
          const data = encodeFunctionData({
            abi,
            functionName: fnName,
            args,
          });
          const { reverted, returnValue, revertReason } = await runTx({
            from: sender,
            to: address,
            data,
          });
          if (reverted) {
            throw decodeRevert(abi, revertReason ?? "0x");
          }
          if (item.outputs && item.outputs.length === 0) return undefined;
          const decoded = decodeFunctionResult({
            abi,
            functionName: fnName,
            data: returnValue,
          });
          return decoded;
        };
      } else {
        inst.write[fnName] = async (
          ...callArgs: unknown[]
        ): Promise<CallReceipt> => {
          // Final argument may be `{ value: bigint }` viem-style — strip
          // it off the args list before encoding so calldata stays clean.
          let value: bigint | undefined;
          let args = callArgs;
          if (
            callArgs.length > 0 &&
            typeof callArgs[callArgs.length - 1] === "object" &&
            callArgs[callArgs.length - 1] !== null &&
            "value" in (callArgs[callArgs.length - 1] as Record<string, unknown>)
          ) {
            const last = callArgs[callArgs.length - 1] as { value?: bigint };
            value = last.value;
            args = callArgs.slice(0, -1);
          }
          const data = encodeFunctionData({
            abi,
            functionName: fnName,
            args,
          });
          const { reverted, logs, events, gasUsed, blockNumber, revertReason } =
            await runTx({
              from: sender,
              to: address,
              data,
              value,
              abi,
            });
          if (reverted) {
            throw decodeRevert(abi, revertReason ?? "0x");
          }
          return {
            status: "success",
            logs,
            events,
            gasUsed,
            blockNumber,
          };
        };
      }
    }
    return inst;
  };

  // ---- JSON-RPC transport (Ganache/Anvil shape) -------------------
  //
  // Implements the methods the average viem/ethers test exercises:
  // chain id, block info, balance/code/nonce reads, eth_call,
  // eth_sendRawTransaction, eth_getLogs/getTransactionReceipt, plus
  // the `evm_*` extensions Ganache pioneered for snapshot + time
  // control. Anything we don't implement throws a "method not
  // supported" error so callers see the gap immediately rather than
  // getting a silent `null`.

  // The viem `EIP1193RequestFn` type is generic over a per-call
  // schema lookup, which doesn't compose with our switch-on-method
  // implementation (TS can't infer that `method === "eth_chainId"`
  // narrows to the right schema branch). Hand-rolled signature
  // returning `unknown` then cast at the boundary — viem's
  // `custom(transport)` accepts any `request` function and does its
  // own per-method narrowing on the consumer side.
  const request = async ({
    method,
    params,
  }: {
    method: string;
    params?: unknown[];
  }): Promise<unknown> => {
    const p = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return ("0x" + Number(common.chainId()).toString(16)) as Hex;
      case "eth_blockNumber":
        return ("0x" + currentBlockNumber.toString(16)) as Hex;
      case "eth_accounts":
        return accounts.map((a) => a.address);
      case "eth_getBalance": {
        const [addr] = p as [Hex];
        const acc = await vm.stateManager.getAccount(
          new Address(hexToBytes(addr)),
        );
        return ("0x" + (acc?.balance ?? 0n).toString(16)) as Hex;
      }
      case "eth_getTransactionCount": {
        const [addr] = p as [Hex];
        return ("0x" + (nonceCache.get(addr) ?? 0n).toString(16)) as Hex;
      }
      case "eth_getCode": {
        const [addr] = p as [Hex];
        const code = await vm.stateManager.getContractCode(
          new Address(hexToBytes(addr)),
        );
        return bytesToHex(code) as Hex;
      }
      case "eth_call": {
        const [tx] = p as [{ to?: Hex; data?: Hex; from?: Hex; value?: Hex }];
        // Use a static-call shape: don't bump the nonce, don't apply
        // state. ethereumjs's runCall hits the right path.
        const result = await vm.evm.runCall({
          to: tx.to ? new Address(hexToBytes(tx.to)) : undefined,
          caller: tx.from
            ? new Address(hexToBytes(tx.from))
            : new Address(hexToBytes(defaultAccount.address)),
          data: tx.data ? hexToBytes(tx.data) : new Uint8Array(),
          value: tx.value ? BigInt(tx.value) : 0n,
        });
        if (result.execResult.exceptionError) {
          // viem expects an error throw with the revert data carried
          // in `data` — easiest: throw a `RpcError`-shaped Error.
          const data = bytesToHex(result.execResult.returnValue);
          const err = new Error(`execution reverted`) as Error & {
            data?: string;
          };
          err.data = data;
          throw err;
        }
        return bytesToHex(result.execResult.returnValue) as Hex;
      }
      case "eth_sendTransaction": {
        const [tx] = p as [
          { from?: Hex; to?: Hex; data?: Hex; value?: Hex; gas?: Hex },
        ];
        const sender = tx.from
          ? accounts.find((a) => a.address.toLowerCase() === tx.from!.toLowerCase())
          : defaultAccount;
        if (!sender) {
          throw new Error(`unknown sender ${tx.from}`);
        }
        const result = await runTx({
          from: sender,
          to: tx.to,
          data: (tx.data ?? "0x") as Hex,
          value: tx.value ? BigInt(tx.value) : undefined,
        });
        // Ganache returns the tx hash; we synthesize a stable one
        // from blockNumber + nonce so tests can use it as a key.
        return synthHash(result.blockNumber, sender.address);
      }
      case "evm_snapshot":
        return chain.snapshot();
      case "evm_revert": {
        const [id] = p as [string];
        return chain.revert(id);
      }
      case "evm_mine": {
        await chain.mine(1);
        return "0x0" as Hex;
      }
      case "evm_increaseTime": {
        const [secs] = p as [number | string];
        const n = typeof secs === "string" ? BigInt(secs) : BigInt(secs);
        await chain.warp(n);
        return ("0x" + currentBlockTimestamp.toString(16)) as Hex;
      }
      case "evm_setNextBlockTimestamp": {
        const [ts] = p as [number | string];
        const n = typeof ts === "string" ? BigInt(ts) : BigInt(ts);
        const delta = n - currentBlockTimestamp;
        if (delta < 0n) {
          throw new Error(
            `setNextBlockTimestamp: ${n} is in the past (current ${currentBlockTimestamp})`,
          );
        }
        pendingTimestampDelta += delta;
        return null;
      }
      case "anvil_setBalance":
      case "hardhat_setBalance": {
        const [addr, balanceHex] = p as [Hex, Hex];
        await chain.setBalance(addr, BigInt(balanceHex));
        return null;
      }
      case "eth_getLogs": {
        const [filter] = p as [LogFilter];
        const result = await chain.getLogs(filter);
        return result;
      }
      case "net_version":
        return common.chainId().toString();
      case "web3_clientVersion":
        return "fishbones-evm/1.0.0";
      default:
        throw new Error(
          `JSON-RPC method "${method}" is not implemented by the in-process Fishbones EVM. Use chain.* directly or open an issue if you need this method.`,
        );
    }
  };

  const synthHash = (blockNumber: bigint, sender: Hex): Hex => {
    const seed =
      blockNumber.toString(16).padStart(8, "0") +
      sender.slice(2).padStart(40, "0");
    return ("0x" + seed.padEnd(64, "0")) as Hex;
  };

  const chain: ChainHarness = {
    account: defaultAccount,
    accounts,

    async newAccount(opts) {
      // Derive a deterministic privkey from the account counter so
      // tests are reproducible across runs. These keys never leave
      // the in-memory VM, so entropy isn't a security concern.
      const seed = (accounts.length + 1).toString(16).padStart(64, "0");
      const privKey = `0x${seed}` as Hex;
      const balance = opts?.balance ?? DEFAULT_BALANCE;
      const handle = await seedAccount(privKey, balance);
      accounts.push(handle);
      nonceCache.set(handle.address, 0n);
      return handle;
    },

    async deploy(name, args = [], opts = {}) {
      const artifact = findArtifact(name);
      const sender = opts.from ?? defaultAccount;
      const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
      });
      const { reverted, createdAddress, revertReason } = await runTx({
        from: sender,
        data,
        value: opts.value,
      });
      if (reverted) throw decodeRevert(artifact.abi, revertReason ?? "0x");
      if (!createdAddress)
        throw new Error(`Deployment of ${name} produced no address`);
      try {
        hooks.onContractDeployed?.({
          address: createdAddress,
          name,
          deployedAtBlock: currentBlockNumber - 1n,
        });
      } catch {
        /* swallow */
      }
      return wrap(name, createdAddress, artifact.abi, sender);
    },

    getContract(name, address) {
      const artifact = findArtifact(name);
      return wrap(name, address, artifact.abi, defaultAccount);
    },

    async expectRevert(p, expected) {
      try {
        await p;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (expected && !msg.includes(expected)) {
          throw new Error(
            `Expected revert containing "${expected}" but got: ${msg}`,
          );
        }
        return;
      }
      throw new Error("Expected revert but call succeeded");
    },

    async balanceOf(address) {
      const acc = await vm.stateManager.getAccount(
        new Address(hexToBytes(address)),
      );
      return acc?.balance ?? 0n;
    },

    async setBalance(address, balance) {
      const addrObj = new Address(hexToBytes(address));
      const existing = await vm.stateManager.getAccount(addrObj);
      const acc = new Account(existing?.nonce ?? 0n, balance);
      await vm.stateManager.putAccount(addrObj, acc);
    },

    async snapshot() {
      const id = String(snapshotIdSeq++);
      const stateRoot = await vm.stateManager.getStateRoot();
      snapshots.push({
        id,
        stateRoot,
        blockNumber: currentBlockNumber,
        blockTimestamp: currentBlockTimestamp,
        pendingTimestampDelta,
        logCount: logBuffer.length,
        // Clone the nonce cache — we'll restore from this clone.
        nonces: new Map(nonceCache),
      });
      return id;
    },

    async revert(id) {
      // Find snapshot + drop everything after it (Ganache semantic:
      // revert invalidates all later snapshots).
      const idx = snapshots.findIndex((s) => s.id === id);
      if (idx < 0) return false;
      const snap = snapshots[idx];
      snapshots.length = idx; // drop snap and everything after

      await vm.stateManager.setStateRoot(snap.stateRoot);
      currentBlockNumber = snap.blockNumber;
      currentBlockTimestamp = snap.blockTimestamp;
      pendingTimestampDelta = snap.pendingTimestampDelta;
      logBuffer.length = snap.logCount;
      nonceCache.clear();
      for (const [k, v] of snap.nonces) nonceCache.set(k, v);
      return true;
    },

    async mine(blocks = 1) {
      // Nothing to do EVM-wise — we don't produce real blocks. Just
      // bump the counters so subsequent eth_blockNumber + tx receipts
      // see new values.
      const n = BigInt(blocks);
      // Apply any pending warp on the FIRST mined block, then
      // SLOT_DURATION on each subsequent block.
      if (pendingTimestampDelta !== 0n) {
        currentBlockTimestamp += pendingTimestampDelta;
        pendingTimestampDelta = 0n;
      }
      currentBlockNumber += n;
      currentBlockTimestamp += n * SLOT_DURATION;
    },

    async warp(seconds) {
      const n = typeof seconds === "bigint" ? seconds : BigInt(seconds);
      pendingTimestampDelta += n;
    },

    blockNumber: () => currentBlockNumber,
    blockTimestamp: () => currentBlockTimestamp + pendingTimestampDelta,

    async getLogs(filter = {}) {
      const from = filter.fromBlock ?? 0n;
      const to = filter.toBlock ?? currentBlockNumber;
      const addr = filter.address?.toLowerCase();
      const topicFilters = filter.topics ?? [];
      const matched = logBuffer.filter((log) => {
        if (log.blockNumber < from || log.blockNumber > to) return false;
        if (addr && log.address.toLowerCase() !== addr) return false;
        for (let i = 0; i < topicFilters.length; i++) {
          const want = topicFilters[i];
          if (want === null || want === undefined) continue;
          const have = log.topics[i];
          if (!have) return false;
          if (Array.isArray(want)) {
            if (!want.some((w) => w.toLowerCase() === have.toLowerCase()))
              return false;
          } else {
            if (want.toLowerCase() !== have.toLowerCase()) return false;
          }
        }
        return true;
      });

      // ABI-aware path: pre-decode + return parsed events.
      if (filter && (filter as { abi?: Abi }).abi) {
        const abi = (filter as { abi: Abi }).abi;
        const parsed = parseEventLogs({
          abi,
          eventName: (filter as { eventName?: string | string[] }).eventName,
          logs: matched.map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: l.blockNumber,
            logIndex: l.logIndex,
            transactionIndex: 0,
            blockHash: ("0x" + "0".repeat(64)) as Hex,
            transactionHash: ("0x" + "0".repeat(64)) as Hex,
            removed: false,
          })) as unknown as Parameters<typeof parseEventLogs>[0]["logs"],
        });
        return parsed.map((p, i) => ({
          eventName: p.eventName,
          args: (p.args ?? {}) as Record<string, unknown>,
          ...matched[i],
        }));
      }
      return matched;
    },

    transport: { request: request as unknown as EIP1193RequestFn },
  };

  // Sanity-link all the AbiEvent imports so unused-import lints
  // don't drop the type declaration we use as documentation.
  void ({} as AbiEvent);

  // Persistent-chain mutators. The ephemeral path doesn't use these;
  // the singleton in evmChainService.ts calls setCompiled() at the
  // start of every Run + loadInitialSnapshot() at attach time.
  const persistent: PersistentChainExtras = {
    setCompiled(c) {
      compiled = c;
    },
    async loadInitialSnapshot() {
      // Push the current account list + block info to the hook so
      // the dock has something to render before the first tx fires.
      const snaps: AccountSnapshot[] = [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        const balance = await chain.balanceOf(a.address);
        snaps.push({
          address: a.address,
          privateKey: a.privateKey,
          balanceWei: balance,
          nonce: nonceCache.get(a.address) ?? 0n,
          label: i === 0 ? "Default sender" : `Account #${i}`,
        });
      }
      try {
        hooks.onAccountsChanged?.(snaps);
        hooks.onBlockChanged?.(currentBlockNumber, currentBlockTimestamp);
      } catch {
        /* swallow */
      }
    },
  };

  return Object.assign(chain, persistent);
}

// Re-export the AccountSnapshot/ContractSnapshot/TxSnapshot/
// ChainAttachHooks types under stable names so evmChainService can
// import them without re-declaring. These are the SAME interfaces
// declared above; this block just re-exports them as values.
export type {
  AccountSnapshot as EvmAccountSnapshot,
  ContractSnapshot as EvmContractSnapshot,
  TxSnapshot as EvmTxSnapshot,
};

/// Singleton-friendly factory used by `evmChainService.ts`. Builds a
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
  // `evmChainService` so the GanacheDock UI can show balances /
  // recent contracts / recent txs across runs. The singleton is
  // browser-only (it imports our own runtime back), so we guard the
  // dynamic import — Node-side callers (smoke tests, the verifier)
  // still get a fresh ephemeral chain via the catch fallback.
  let chain: ChainHarness & PersistentChainExtras;
  try {
    const svc = await import("../lib/evmChainService");
    const { chain: persistent } = await svc.getOrCreateChain();
    const c = persistent as ChainHarness & PersistentChainExtras;
    c.setCompiled(compiled);
    await c.loadInitialSnapshot();
    chain = c;
  } catch {
    // No service available (likely Node) — fall back to ephemeral.
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

  // Tiny `expect` mirroring solidity.ts. Re-export from a shared module
  // before merging — this duplicate is for the POC only.
  const expect = (actual: unknown) => ({
    toBe(e: unknown) {
      if (!Object.is(actual, e)) {
        throw new Error(`Expected ${stringify(actual)} to be ${stringify(e)}`);
      }
    },
    toEqual(e: unknown) {
      if (JSON.stringify(actual, jsonReplacer) !== JSON.stringify(e, jsonReplacer)) {
        throw new Error(
          `Expected ${stringify(actual)} to equal ${stringify(e)}`,
        );
      }
    },
    toBeDefined() {
      if (actual === undefined) throw new Error("Expected value to be defined");
    },
    toBeUndefined() {
      if (actual !== undefined)
        throw new Error(`Expected ${stringify(actual)} to be undefined`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected ${stringify(actual)} to be truthy`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected ${stringify(actual)} to be falsy`);
    },
    toBeGreaterThan(n: number | bigint) {
      if (
        actual === undefined ||
        actual === null ||
        (actual as bigint | number) <= n
      )
        throw new Error(`Expected ${stringify(actual)} > ${stringify(n)}`);
    },
    toBeLessThan(n: number | bigint) {
      if (
        actual === undefined ||
        actual === null ||
        (actual as bigint | number) >= n
      )
        throw new Error(`Expected ${stringify(actual)} < ${stringify(n)}`);
    },
    toBeGreaterThanOrEqual(n: number | bigint) {
      if (
        actual === undefined ||
        actual === null ||
        (actual as bigint | number) < n
      )
        throw new Error(`Expected ${stringify(actual)} >= ${stringify(n)}`);
    },
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub))
        throw new Error(
          `Expected ${stringify(actual)} to contain "${sub}"`,
        );
    },
    toMatch(re: RegExp) {
      if (typeof actual !== "string" || !re.test(actual))
        throw new Error(`Expected ${stringify(actual)} to match ${re}`);
    },
  });

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    const fn = new AsyncFunction(
      "compiled",
      "chain",
      "expect",
      "test",
      "console",
      testCode,
    );
    const pending: Promise<void>[] = [];
    const wrappedTest = (
      name: string,
      body: () => void | Promise<void>,
    ) => {
      pending.push(testFn(name, body) as unknown as Promise<void>);
    };
    await fn(compiled, chain, expect, wrappedTest, consoleProxy);
    await Promise.all(pending);
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

// ---- helpers ------------------------------------------------------

function stringify(v: unknown): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, jsonReplacer);
  } catch {
    return String(v);
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString() + "n";
  if (value instanceof Uint8Array) {
    return "0x" + Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return value;
}
