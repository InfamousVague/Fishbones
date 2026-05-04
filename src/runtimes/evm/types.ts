import type {
  Abi,
  EIP1193RequestFn,
} from "viem";

export type Hex = `0x${string}`;

export interface CompiledContract {
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
}

export interface CompiledOutput {
  errors?: Array<{
    severity: "error" | "warning" | "info";
    formattedMessage?: string;
    message?: string;
  }>;
  contracts: Record<string, Record<string, CompiledContract>>;
}

export interface AccountHandle {
  address: Hex;
  privateKey: Hex;
  /// Convenience: same shape as `chain.sendTransaction(...)` but
  /// implicitly signed by this account. Wired at chain-build time.
  sendTransaction?: (opts: {
    to?: Hex;
    value?: bigint;
    data?: Hex;
  }) => Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: RawLog[];
    events: Array<{ eventName: string; args: Record<string, unknown> }>;
  }>;
}

export interface DeployOpts {
  value?: bigint;
  from?: AccountHandle;
}

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
}

export interface CallReceipt {
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

export interface ContractInstance {
  address: Hex;
  abi: Abi;
  read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  write: Record<string, (...args: unknown[]) => Promise<CallReceipt>>;
  /// Re-bind the same contract to a different sender for the next call.
  connect(account: AccountHandle): ContractInstance;
}

export interface LogFilter {
  address?: Hex;
  fromBlock?: bigint;
  toBlock?: bigint;
  /// Optional viem-style topic filter: `[topic0, topic1, ...]` where
  /// each entry can be `null` (any), a single `Hex`, or an array of
  /// `Hex` (any-of).
  topics?: Array<Hex | Hex[] | null>;
}

export interface ChainHarness {
  /// Default sender for every transaction unless `from:` is supplied.
  /// Mirrors anvil's account 0; balance 1,000,000 ETH.
  account: AccountHandle;
  /// 10 pre-funded EOAs total — anvil convention. The
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
  /// Set an account's balance directly (anvil convention).
  /// Useful for funding test characters that don't need a real EOA.
  setBalance(address: Hex, balance: bigint): Promise<void>;
  /// Send a raw value transfer from `chain.account` (or `from`) to
  /// `to`. Used by tests that fund a contract via its `receive()`
  /// hook without a proper function call.
  send(to: Hex, value: bigint, opts?: { from?: AccountHandle; data?: Hex }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
  }>;
  /// Viem-shaped send-transaction. Mirrors what `chain.deploy` /
  /// `c.write.foo()` returns (events + logs decoded against every
  /// known contract ABI), so tests asserting on `tx.events` after a
  /// raw fallback/receive deposit work the same as a regular call.
  sendTransaction(opts: {
    to?: Hex;
    value?: bigint;
    data?: Hex;
    from?: AccountHandle | Hex;
  }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: RawLog[];
    events: Array<{ eventName: string; args: Record<string, unknown> }>;
  }>;
  /// secp256k1-sign an arbitrary 32-byte digest with an account's
  /// private key. Returns the v/r/s components in the same shape
  /// `ecrecover` consumes on-chain. Tests use this to drive
  /// signature-verification contracts without pulling viem into the
  /// test code.
  sign(account: AccountHandle, digest: Hex): Promise<{ v: number; r: Hex; s: Hex }>;
  /// EIP-712 typed-data signer. Hashes the supplied domain + types +
  /// message via viem's `hashTypedData`, then ECDSA-signs the digest
  /// with the account's private key. Tests using viem's tuple shape
  /// `(account, { domain, types, primaryType, message })` and the
  /// older `(account, domain, types, message)` four-arg shape both
  /// resolve to the same digest.
  signTypedData(
    account: AccountHandle,
    domainOrTypedData: unknown,
    types?: unknown,
    messageOrPrimaryType?: unknown,
    maybeMessage?: unknown,
  ): Promise<{ v: number; r: Hex; s: Hex; signature: Hex; digest: Hex }>;

  /// Snapshot/revert chain state. `revert(id)` returns to the exact
  /// state at the time of `snapshot()` AND invalidates all snapshots
  /// taken AFTER the reverted-to point — same semantics as Hardhat /
  /// the dev chain. Returns false if the id is unknown / already consumed.
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
  /// the dev chain `evm_*` extensions. See `request()` below for the
  /// supported method list.
  transport: { request: EIP1193RequestFn };

  /// Pass-throughs to viem so test code doesn't have to import the
  /// library inside its `new AsyncFunction(...)` shell. These mirror
  /// the same-named viem exports verbatim.
  keccak256(data: Hex | Uint8Array): Hex;
  encodeAbiParameters(
    params: ReadonlyArray<{ type: string; name?: string }>,
    values: readonly unknown[],
  ): Hex;
  decodeAbiParameters(
    params: ReadonlyArray<{ type: string; name?: string }>,
    data: Hex,
  ): unknown[];
  encodeFunctionData(args: { abi: Abi; functionName: string; args?: readonly unknown[] }): Hex;
  decodeFunctionResult(args: { abi: Abi; functionName: string; data: Hex }): unknown;
  /// Tight-packed encoding (ethers' `solidityPacked` shape) for tests
  /// that build Merkle leaves / commit hashes off-chain.
  solidityPacked(types: string[], values: unknown[]): Hex;
  /// Alias — some lessons import `chain.encodePacked` instead.
  encodePacked(types: string[], values: unknown[]): Hex;
  /// Resolve a deployed contract by name + address. Mirrors ethers'
  /// `contractAt` / Hardhat `getContractAt` shape so tests can drive
  /// contracts that were deployed via a factory (CREATE2, EIP-1167).
  attach(name: string, address: Hex): ContractInstance;
  at(name: string, address: Hex): ContractInstance;
  /// Wrap an arbitrary `{address, abi}` so a proxy can be driven via
  /// its underlying implementation ABI.
  withContract(opts: { address: Hex; abi: Abi }): ContractInstance;
  /// Read deployed bytecode at an address (proxy / clone tests).
  getCode(address: Hex): Promise<Hex>;
}

export const DEFAULT_PRIVKEYS: Hex[] = [
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
export const DEFAULT_BALANCE = 10n ** 24n; // 1,000,000 ETH — generous for tests
export const SLOT_DURATION = 12n; // post-merge: a block every 12 seconds

/// Optional hooks the long-lived chain singleton (in
/// `evm/chainService`) wires up so the in-app ChainDock UI re-renders
/// when state changes. The ephemeral test path (default) passes
/// `undefined` and the chain runs without any side-effects.
export interface ChainAttachHooks {
  onAccountsChanged?(accounts: AccountSnapshot[]): void;
  onBlockChanged?(blockNumber: bigint, blockTimestamp: bigint): void;
  onContractDeployed?(c: ContractSnapshot): void;
  onTx?(tx: TxSnapshot): void;
}

export interface AccountSnapshot {
  address: Hex;
  privateKey: Hex;
  balanceWei: bigint;
  nonce: bigint;
  label: string;
}

export interface ContractSnapshot {
  address: Hex;
  name: string;
  deployedAtBlock: bigint;
}

export interface TxSnapshot {
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
export interface PersistentChainExtras {
  setCompiled(c: CompiledOutput): void;
  loadInitialSnapshot(): Promise<void>;
}

