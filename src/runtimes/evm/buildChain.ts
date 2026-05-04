import { VM } from "@ethereumjs/vm";
import { Common, Chain, Hardfork } from "@ethereumjs/common";
import { LegacyTransaction } from "@ethereumjs/tx";
import { Block } from "@ethereumjs/block";
import {
  Address,
  Account,
  hexToBytes,
  bytesToHex,
  privateToAddress,
} from "@ethereumjs/util";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  encodeDeployData,
  encodeFunctionData,
  decodeFunctionResult,
  decodeErrorResult,
  encodeAbiParameters,
  decodeAbiParameters,
  parseEventLogs,
  getAddress,
  hashTypedData,
  keccak256 as viemKeccak256,
  type Abi,
  type AbiEvent,
  type EIP1193RequestFn,
  type TypedData,
  type TypedDataDomain,
} from "viem";

import { normalizeContractArgs } from "./helpers";
import type {
  Hex,
  CompiledContract,
  CompiledOutput,
  AccountHandle,
  RawLog,
  CallReceipt,
  ContractInstance,
  LogFilter,
  ChainHarness,
  ChainAttachHooks,
  AccountSnapshot,
  PersistentChainExtras,
} from "./types";
import { DEFAULT_PRIVKEYS, DEFAULT_BALANCE, SLOT_DURATION } from "./types";

export async function buildChain(
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
  // after the reverted-to point — matches Anvil/Hardhat semantics.
  interface Snapshot {
    id: string;
    stateRoot: Uint8Array;
    blockNumber: bigint;
    blockTimestamp: bigint;
    pendingTimestampDelta: bigint;
    logCount: number;
    nonces: Map<string, bigint>;
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
    // Use viem's checksummed address so it byte-equals what
    // `decodeFunctionResult` returns from a contract's `owner()` etc.
    // Tests like `expect(await c.read.owner()).toBe(chain.account.address)`
    // depend on both sides being checksummed.
    const addrHex = getAddress(bytesToHex(addrBytes)) as Hex;
    const existing = await vm.stateManager.getAccount(new Address(addrBytes));
    const acc = new Account(existing?.nonce ?? 0n, balance);
    await vm.stateManager.putAccount(new Address(addrBytes), acc);
    return { address: addrHex, privateKey: privKeyHex };
  };

  // Pre-fund the standard 10 anvil accounts.
  const accounts: AccountHandle[] = [];
  for (const pk of DEFAULT_PRIVKEYS) {
    accounts.push(await seedAccount(pk, DEFAULT_BALANCE));
  }
  const defaultAccount = accounts[0];

  // Nonce cache. We could read from VM state on every tx, but the
  // VM increments the on-account nonce post-tx anyway, so we track
  // the next-to-use nonce here for fast access. Snapshot/revert
  // checkpoints this map. Keys are normalized to lowercase so a
  // checksummed `chain.account.address` and a lowercased one from
  // viem's JSON-RPC layer hit the same cache entry.
  const nonceCache = new Map<string, bigint>();
  const nonceKey = (addr: Hex | string): string => addr.toLowerCase();
  for (const a of accounts) nonceCache.set(nonceKey(a.address), 0n);

  // Note: runTx now reads the live nonce from VM state on every call
  // and updates the cache afterward, so a separate `nextNonce` helper
  // isn't needed any more. The cache survives only to answer
  // `eth_getTransactionCount` cheaply between txs.

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

    // Always read the live nonce from VM state instead of trusting the
    // cache — the cache can drift when a tx fails validation (it gets
    // incremented before runTx, but the VM doesn't advance) or across
    // singleton-chain reuse between verifier sessions. Live read is
    // O(1) for the in-process VM, and we still update the cache so
    // `eth_getTransactionCount` is responsive.
    const fromAddr = new Address(hexToBytes(params.from.address));
    const fromAcc = await vm.stateManager.getAccount(fromAddr);
    const txNonce = fromAcc?.nonce ?? 0n;
    nonceCache.set(nonceKey(params.from.address), txNonce + 1n);

    // Cancun enforces EIP-1559: every block has a baseFeePerGas the
    // tx must clear or the VM rejects with "gasPrice (X) is less
    // than the block's baseFeePerGas (Y)". @ethereumjs/vm starts at
    // baseFee = 7 wei and ratchets up with every full block, so a
    // long-running session needs a comfortable margin. 1 gwei is
    // plenty above baseFee while keeping gas costs small enough that
    // tests asserting on near-max balances (SafeMath overflow) and
    // on exact balance diffs (Merkle airdrop) don't get blown out.
    const tx = LegacyTransaction.fromTxData(
      {
        nonce: txNonce,
        gasPrice: 10n ** 9n, // 1 gwei
        gasLimit: 30_000_000n,
        to: params.to,
        value: params.value ?? 0n,
        data: hexToBytes(params.data),
      },
      { common },
    ).sign(hexToBytes(params.from.privateKey));

    // Build a block whose header carries the harness's tracked
    // number/timestamp so `block.number` and `block.timestamp` inside
    // the EVM match what `chain.blockNumber()` / `chain.blockTimestamp()`
    // report. Without this every test reads `block.timestamp == 0` /
    // `block.number == 0`, which breaks any time-aware lesson.
    const txBlock = Block.fromBlockData(
      {
        header: {
          number: currentBlockNumber,
          timestamp: currentBlockTimestamp,
          gasLimit: 30_000_000n,
          baseFeePerGas: 7n,
        },
      },
      { common },
    );

    const result = await vm.runTx({ tx, block: txBlock, skipBalance: false });
    const reverted = !!result.execResult.exceptionError;
    const returnValue = bytesToHex(result.execResult.returnValue) as Hex;

    // Capture logs for getLogs()/event helpers — only on success
    // (reverted txs are rolled back and the dev chain doesn't keep their
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

    // Pre-decode events for the receipt (`CallReceipt.events`). A
    // call typically lives in one contract, but emitted logs can come
    // from ANY contract the call touches — a Coordinator's
    // `fulfillRandomness()` calling back into a `RandomDice` consumer,
    // an Oracle's `fulfillRequest()` calling into a Client. The
    // calling contract's ABI alone misses those. Walk the calling ABI
    // first (when supplied) and then every other loaded contract's
    // ABI, and merge unique decodes by `(logIndex)` so a multi-event
    // tx with cross-contract emissions decodes cleanly.
    const events: Array<{ eventName: string; args: Record<string, unknown> }> =
      [];
    if (txLogs.length > 0) {
      const abis: Abi[] = [];
      if (params.abi) abis.push(params.abi);
      for (const file of Object.keys(compiled.contracts ?? {})) {
        for (const name of Object.keys(compiled.contracts[file])) {
          const a = compiled.contracts[file][name].abi;
          if (a && !abis.includes(a)) abis.push(a);
        }
      }
      const decoded = new Map<number, { eventName: string; args: Record<string, unknown> }>();
      for (const candidate of abis) {
        try {
          const parsed = parseEventLogs({
            abi: candidate,
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
          for (const p of parsed) {
            const idx = (p as unknown as { logIndex: number }).logIndex;
            if (!decoded.has(idx)) {
              decoded.set(idx, {
                eventName: p.eventName,
                args: (p.args ?? {}) as Record<string, unknown>,
              });
            }
          }
        } catch {
          /* ABI doesn't match — try next candidate */
        }
      }
      // Re-emit in original log order so `events[i]` aligns with `logs[i]`.
      for (const log of txLogs) {
        const e = decoded.get(log.logIndex);
        if (e) events.push(e);
      }
    }

    // We DON'T auto-advance block number or timestamp per tx —
    // multiple txs share the same "current block" until `chain.mine()`
    // commits and advances it (anvil's "instant mine off" / interval-
    // mining model). Tests typically assert that `block.number` and
    // `block.timestamp` inside a deploy match what `chain.blockNumber()`
    // / `chain.blockTimestamp()` return on the next read, AND that
    // `mine(N)` produces an exact +N delta. Auto-advancing per tx
    // breaks both.
    const thisBlock = currentBlockNumber;

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
        ? (getAddress(bytesToHex(result.createdAddress.bytes)) as Hex)
        : undefined,
      logs: txLogs,
      events,
      gasUsed: result.totalGasSpent,
      blockNumber: thisBlock,
      revertReason: reverted ? returnValue : undefined,
    };
  };

  // Solidity built-in `Panic(uint256)` and `Error(string)` selectors.
  // These aren't in user ABIs but the EVM emits them for things like
  // `abi.decode` failures, division by zero, array OOB, etc., so the
  // generic decoder needs to recognize them.
  const SOLIDITY_BUILTIN_ABI: Abi = [
    {
      type: "error",
      name: "Panic",
      inputs: [{ name: "code", type: "uint256" }],
    },
    {
      type: "error",
      name: "Error",
      inputs: [{ name: "message", type: "string" }],
    },
  ];
  const decodeRevert = (abi: Abi, data: Hex): Error => {
    if (data === "0x" || data.length < 10) {
      return new Error("execution reverted (no reason)");
    }
    // Try the calling contract's ABI first, then every loaded
    // contract's ABI (the revert may originate in a callee — e.g.,
    // a phishing wrapper calling the real wallet), then the standard
    // Panic/Error pair so tests asserting on `'Panic'` (abi.decode
    // failures) or named custom errors from a callee can match.
    const candidates: Abi[] = [abi];
    for (const file of Object.keys(compiled.contracts ?? {})) {
      for (const name of Object.keys(compiled.contracts[file])) {
        const c = compiled.contracts[file][name].abi;
        if (c && c !== abi) candidates.push(c);
      }
    }
    candidates.push(SOLIDITY_BUILTIN_ABI);
    for (const candidate of candidates) {
      try {
        const decoded = decodeErrorResult({ abi: candidate, data });
        const args = (decoded.args ?? [])
          .map((a) => (typeof a === "bigint" ? a.toString() : String(a)))
          .join(", ");
        return new Error(
          `execution reverted: ${decoded.errorName}(${args})`,
        );
      } catch {
        /* try next */
      }
    }
    // Last-ditch manual selector match — viem's `decodeErrorResult`
    // can throw on raw 4-byte reverts (no abi-encoded args) where it
    // expected a payload; lessons that emit `revert(selector, 4)` from
    // hand-written assembly fall in this bucket. Walk every loaded
    // ABI's `error` definitions and compare selectors directly.
    const selector = data.slice(0, 10).toLowerCase();
    for (const candidate of candidates) {
      for (const item of candidate) {
        if (item.type !== "error") continue;
        const err = item as unknown as {
          name: string;
          inputs?: ReadonlyArray<{ type: string }>;
        };
        const sig = `${err.name}(${(err.inputs ?? []).map((i) => i.type).join(",")})`;
        const sel = viemKeccak256(new TextEncoder().encode(sig)).slice(0, 10).toLowerCase();
        if (sel === selector) {
          return new Error(`execution reverted: ${err.name}()`);
        }
      }
    }
    return new Error(`execution reverted (raw=${data})`);
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
      // Every function gets a `read` entry — for view/pure it's the
      // natural fit, for non-view it's a static-call simulation that
      // returns the function's return values without committing state.
      // Tests that want to assert on the return value of a non-view
      // (e.g., a low-level-call helper) read it via `read.foo()`.
      inst.read[fnName] = async (...callArgs: unknown[]) => {
        const args = normalizeContractArgs(callArgs, item.inputs ?? []);
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
      if (!isView) {
        inst.write[fnName] = async (
          ...callArgs: unknown[]
        ): Promise<CallReceipt> => {
          // Final argument may be `{ value: bigint }` viem-style — strip
          // it off the args list before encoding so calldata stays clean.
          let value: bigint | undefined;
          let args: unknown[] = callArgs;
          if (
            callArgs.length > 0 &&
            typeof callArgs[callArgs.length - 1] === "object" &&
            callArgs[callArgs.length - 1] !== null &&
            !Array.isArray(callArgs[callArgs.length - 1]) &&
            "value" in (callArgs[callArgs.length - 1] as Record<string, unknown>)
          ) {
            const last = callArgs[callArgs.length - 1] as { value?: bigint };
            value = last.value;
            args = callArgs.slice(0, -1);
          }
          args = normalizeContractArgs(args, item.inputs ?? []);
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

  // ---- JSON-RPC transport (Anvil shape) -------------------
  //
  // Implements the methods the average viem/ethers test exercises:
  // chain id, block info, balance/code/nonce reads, eth_call,
  // eth_sendRawTransaction, eth_getLogs/getTransactionReceipt, plus
  // the `evm_*` extensions the dev-chain ecosystem standardised for snapshot + time
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
        return ("0x" + (nonceCache.get(nonceKey(addr)) ?? 0n).toString(16)) as Hex;
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
        // Anvil returns the tx hash; we synthesize a stable one
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
      nonceCache.set(nonceKey(handle.address), 0n);
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

    async send(to, value, opts = {}) {
      const sender = opts.from ?? defaultAccount;
      const result = await runTx({
        from: sender,
        to,
        data: opts.data ?? ("0x" as Hex),
        value,
      });
      return {
        status: result.reverted ? "reverted" : "success",
        blockNumber: result.blockNumber,
      };
    },

    async sendTransaction(opts) {
      // Viem-style raw tx send. Tests use this to fund a contract via
      // its `receive()` / `fallback()` hook and assert on the events
      // emitted, so we run an ABI-less decode against any matching
      // log topics from contracts the chain has seen deploy. (We don't
      // know which ABI the caller intended; we walk every known one.)
      const sender =
        opts.from && typeof opts.from === "object"
          ? (opts.from as AccountHandle)
          : opts.from
            ? accounts.find(
                (a) => a.address.toLowerCase() === (opts.from as Hex).toLowerCase(),
              ) ?? defaultAccount
            : defaultAccount;
      const result = await runTx({
        from: sender,
        to: opts.to,
        data: opts.data ?? ("0x" as Hex),
        value: opts.value,
      });
      // Best-effort event decoding: try every loaded contract's ABI.
      let events: Array<{ eventName: string; args: Record<string, unknown> }> =
        result.events;
      if (events.length === 0 && result.logs.length > 0) {
        for (const file of Object.keys(compiled.contracts)) {
          for (const name of Object.keys(compiled.contracts[file])) {
            const abi = compiled.contracts[file][name].abi;
            try {
              const parsed = parseEventLogs({
                abi,
                logs: result.logs.map((l) => ({
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
              if (parsed.length > 0) {
                events = parsed.map((p) => ({
                  eventName: p.eventName,
                  args: (p.args ?? {}) as Record<string, unknown>,
                }));
                break;
              }
            } catch {
              /* ABI doesn't match — try next */
            }
          }
          if (events.length > 0) break;
        }
      }
      return {
        status: result.reverted ? ("reverted" as const) : ("success" as const),
        blockNumber: result.blockNumber,
        logs: result.logs,
        events,
      };
    },

    async sign(account, digest) {
      // ECDSA-sign the 32-byte digest with the account's private key.
      // We return the v/r/s shape `ecrecover` expects on-chain. v is
      // `27 + recovery` to match Ethereum convention (the EVM's
      // ecrecover precompile rejects v=0/1).
      const sig = secp256k1.sign(
        hexToBytes(digest),
        hexToBytes(account.privateKey),
        { lowS: true },
      );
      const r = ("0x" + sig.r.toString(16).padStart(64, "0")) as Hex;
      const s = ("0x" + sig.s.toString(16).padStart(64, "0")) as Hex;
      const v = 27 + (sig.recovery ?? 0);
      return { v, r, s };
    },

    async signTypedData(
      account: AccountHandle,
      domainOrTypedData: TypedDataDomain | {
        domain: TypedDataDomain;
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType?: string;
        message: Record<string, unknown>;
      },
      types?: Record<string, Array<{ name: string; type: string }>>,
      messageOrPrimaryType?: Record<string, unknown> | string,
      maybeMessage?: Record<string, unknown>,
    ) {
      // Two shapes:
      //   chain.signTypedData(account, domain, types, message)         (4-arg)
      //   chain.signTypedData(account, { domain, types, primaryType, message }) (1-arg)
      // Tests written against either viem's wallet-client API or the
      // older "domain + types + message" tuple work the same. We hash
      // via viem's `hashTypedData` and ECDSA-sign with the account's
      // private key.
      let domain: TypedDataDomain;
      let typesArg: Record<string, Array<{ name: string; type: string }>>;
      let primaryType: string | undefined;
      let message: Record<string, unknown>;
      if (
        domainOrTypedData &&
        typeof domainOrTypedData === "object" &&
        "domain" in domainOrTypedData &&
        "types" in domainOrTypedData
      ) {
        const td = domainOrTypedData as {
          domain: TypedDataDomain;
          types: Record<string, Array<{ name: string; type: string }>>;
          primaryType?: string;
          message: Record<string, unknown>;
        };
        domain = td.domain;
        typesArg = td.types;
        primaryType = td.primaryType;
        message = td.message;
      } else {
        domain = domainOrTypedData as TypedDataDomain;
        typesArg = types ?? {};
        if (typeof messageOrPrimaryType === "string") {
          primaryType = messageOrPrimaryType;
          message = maybeMessage ?? {};
        } else {
          message = messageOrPrimaryType ?? {};
        }
      }
      // Pick a primaryType automatically when the caller didn't give
      // one — find the only struct that no other struct references.
      if (!primaryType) {
        const names = Object.keys(typesArg);
        const referenced = new Set<string>();
        for (const k of names) {
          for (const f of typesArg[k]) {
            const base = f.type.replace(/\[.*\]$/, "");
            if (typesArg[base]) referenced.add(base);
          }
        }
        const candidates = names.filter((n) => !referenced.has(n));
        primaryType = candidates[0] ?? names[0] ?? "";
      }
      const digest = hashTypedData({
        domain,
        types: typesArg as unknown as TypedData,
        primaryType,
        message,
      } as Parameters<typeof hashTypedData>[0]);
      const sig = secp256k1.sign(
        hexToBytes(digest),
        hexToBytes(account.privateKey),
        { lowS: true },
      );
      const r = ("0x" + sig.r.toString(16).padStart(64, "0")) as Hex;
      const s = ("0x" + sig.s.toString(16).padStart(64, "0")) as Hex;
      const v = 27 + (sig.recovery ?? 0);
      // Return both the v/r/s shape (for ecrecover) and a packed
      // `signature` hex (for OZ-style ECDSA.recover) so tests using
      // either pattern work.
      const signature = ("0x" + r.slice(2) + s.slice(2) + v.toString(16).padStart(2, "0")) as Hex;
      return { v, r, s, signature, digest };
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
      // Find snapshot + drop everything after it (Anvil semantic:
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

      // ABI-aware path: pre-decode + return parsed events. We forward
      // the caller's `args` filter to viem's parseEventLogs so a query
      // like `{ args: { from: alice } }` actually narrows the result
      // set by the matching indexed arg (topic position derived from
      // the event ABI). Without forwarding, the filter was silently
      // dropped and every event came back.
      if (filter && (filter as { abi?: Abi }).abi) {
        const abi = (filter as { abi: Abi }).abi;
        const f = filter as {
          eventName?: string | string[];
          args?: Record<string, unknown> | unknown[];
        };
        const parsed = parseEventLogs({
          abi,
          eventName: f.eventName,
          args: f.args,
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
        } as unknown as Parameters<typeof parseEventLogs>[0]);
        return parsed.map((p) => {
          const decoded = p as unknown as {
            eventName?: string;
            args?: Record<string, unknown> | unknown[];
            address: Hex;
            topics: Hex[];
            data: Hex;
            blockNumber: bigint;
            logIndex: number;
          };
          return {
            eventName: decoded.eventName,
            args: (decoded.args ?? {}) as Record<string, unknown>,
            address: decoded.address,
            topics: decoded.topics,
            data: decoded.data,
            blockNumber: decoded.blockNumber,
            logIndex: decoded.logIndex,
          };
        });
      }
      return matched;
    },

    transport: { request: request as unknown as EIP1193RequestFn },

    keccak256(data) {
      const bytes = typeof data === "string" ? hexToBytes(data as Hex) : data;
      return viemKeccak256(bytes);
    },
    encodeAbiParameters(params, values) {
      return encodeAbiParameters(
        params as readonly { type: string; name?: string }[],
        values as readonly unknown[],
      );
    },
    decodeAbiParameters(params, data) {
      return decodeAbiParameters(
        params as readonly { type: string; name?: string }[],
        data,
      ) as unknown[];
    },
    encodeFunctionData(args) {
      return encodeFunctionData(args);
    },
    decodeFunctionResult(args) {
      return decodeFunctionResult(args);
    },
    // Tight-packed encoding (ethers' `solidityPacked` shape) — used by
    // tests that build Merkle leaves / commit hashes off-chain.
    solidityPacked(types: string[], values: unknown[]): Hex {
      let out = "0x";
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        const v = values[i];
        if (t === "bytes32") {
          const h = (v as string).toLowerCase().replace(/^0x/, "");
          out += h.padStart(64, "0");
        } else if (t === "address") {
          const h = (v as string).toLowerCase().replace(/^0x/, "");
          out += h.padStart(40, "0");
        } else if (/^u?int(\d+)?$/.test(t)) {
          const m = t.match(/^u?int(\d+)?$/);
          const bits = m && m[1] ? parseInt(m[1], 10) : 256;
          const hexLen = bits / 4;
          const bn = BigInt(v as string | number | bigint);
          out += bn.toString(16).padStart(hexLen, "0");
        } else if (t === "bool") {
          out += v ? "01" : "00";
        } else if (t === "string" || t === "bytes") {
          const bytes =
            typeof v === "string" && t === "string"
              ? new TextEncoder().encode(v)
              : typeof v === "string"
                ? hexToBytes(v as Hex)
                : (v as Uint8Array);
          out += Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        } else {
          throw new Error(`solidityPacked: unsupported type ${t}`);
        }
      }
      return out as Hex;
    },
    // Alias — some lessons import `chain.encodePacked` instead.
    encodePacked(types: string[], values: unknown[]): Hex {
      return chain.solidityPacked(types, values);
    },
    // Resolve a deployed contract by name + address. Mirrors the
    // ethers `contractAt` / Hardhat `getContractAt` shape that lessons
    // use when the contract was created via a factory (CREATE2,
    // EIP-1167) and so isn't tracked in our deploy registry.
    attach(name: string, address: Hex): ContractInstance {
      const artifact = findArtifact(name);
      return wrap(name, address, artifact.abi, defaultAccount);
    },
    at(name: string, address: Hex): ContractInstance {
      return chain.attach(name, address);
    },
    // Wrap an arbitrary `{address, abi}` so tests can drive a
    // proxy-shaped contract through its underlying implementation ABI.
    withContract(opts: { address: Hex; abi: Abi }): ContractInstance {
      return wrap("Anonymous", opts.address, opts.abi, defaultAccount);
    },
    // Read deployed bytecode at an address (proxy / clone tests).
    async getCode(address: Hex): Promise<Hex> {
      const code = await vm.stateManager.getContractCode(
        new Address(hexToBytes(address)),
      );
      return bytesToHex(code) as Hex;
    },
  };

  // Sanity-link all the AbiEvent imports so unused-import lints
  // don't drop the type declaration we use as documentation.
  void ({} as AbiEvent);

  // Persistent-chain mutators. The ephemeral path doesn't use these;
  // the singleton in evm/chainService.ts calls setCompiled() at the
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
          nonce: nonceCache.get(nonceKey(a.address)) ?? 0n,
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

  // Bind a per-account `sendTransaction(opts)` that delegates through
  // `chain.sendTransaction` with the account pre-set as the sender.
  // Done after `chain` is constructed so it can reference itself.
  const bindAccountSend = (a: AccountHandle): void => {
    a.sendTransaction = (opts) =>
      chain.sendTransaction({ ...opts, from: a });
  };
  for (const a of accounts) bindAccountSend(a);
  // Account creation also needs the binding — wrap newAccount.
  const origNewAccount = chain.newAccount.bind(chain);
  chain.newAccount = async (opts) => {
    const a = await origNewAccount(opts);
    bindAccountSend(a);
    return a;
  };

  return Object.assign(chain, persistent);
}
