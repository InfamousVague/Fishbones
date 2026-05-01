/// Long-lived EVM chain singleton — the same in-process Ganache the
/// `runEvm` runtime spins up, but kept alive across multiple test
/// runs so the UI can show a coherent picture (account balances,
/// recently deployed contracts, last few transactions) instead of
/// "the chain just got torn down between your runs."
///
/// The shape is split in two:
///
///   - **`ChainHarness`** — the `chain.*` API tests run against. We
///     re-export the very one `runEvm` already builds; `runEvm` calls
///     `getOrCreateChain()` to either reuse the singleton or build a
///     fresh one (its own VM + accounts) when the caller doesn't want
///     to share state.
///
///   - **`EvmChainSnapshot`** — the read-model the UI subscribes to.
///     Updated on every successful tx. Carries account balances, a
///     ring-buffer of recent transactions, and the contracts we've
///     seen deploy.
///
/// Faucet:
///   `requestFaucet(address)` adds `FAUCET_AMOUNT` ETH to the target
///   account. Rate-limited per-address via localStorage so a learner
///   can't accidentally spam-click. Cooldown defaults to 5 minutes.
///
/// This module is browser-only (it talks to the in-process VM).
/// Importing it from a Node script would fail because @ethereumjs/vm's
/// async setup hooks expect a window. Lazy-import it from React
/// callers.

import type { Abi } from "viem";

// ── Public types ────────────────────────────────────────────────

export interface AccountSnapshot {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  balanceWei: bigint;
  /// Monotonically-increasing nonce (next-to-use), as tracked by the
  /// chain. Useful for the dock's "tx N of N" indicator.
  nonce: bigint;
  /// Display label — accounts[0] shows "Default sender" so the
  /// learner knows which account their tests are signing from.
  label: string;
}

export interface ContractSnapshot {
  address: `0x${string}`;
  /// Contract class name (e.g. "Counter") — pulled from
  /// `chain.deploy(name)`. Multiple deployments of the same name show
  /// up as separate entries with different addresses.
  name: string;
  /// Block this deploy landed in — matches what
  /// `chain.blockNumber()` returned at the time.
  deployedAtBlock: bigint;
}

export type TxSnapshotKind = "deploy" | "call" | "value-transfer" | "faucet";

export interface TxSnapshot {
  hash: `0x${string}`;
  kind: TxSnapshotKind;
  from: `0x${string}`;
  /// `to` is undefined on contract creation and on faucet (the faucet
  /// is a state poke, not a real tx). We render "—" in those cases.
  to?: `0x${string}`;
  /// Best-effort decoded function name. Undefined on faucet / deploy
  /// / value-transfer.
  fn?: string;
  valueWei: bigint;
  status: "success" | "reverted";
  blockNumber: bigint;
  /// Wallclock when the tx ran on the host. Used for "5s ago" rendering.
  timestamp: number;
}

export interface EvmChainSnapshot {
  /// Singleton or fresh-per-run. The dock listens to the singleton;
  /// the per-run service object is constructed only by `runEvm` and
  /// has no UI listeners.
  scope: "singleton" | "ephemeral";
  blockNumber: bigint;
  blockTimestamp: bigint;
  accounts: AccountSnapshot[];
  contracts: ContractSnapshot[];
  txs: TxSnapshot[];
  /// Bumped on every snapshot mutation. Comparable across snapshots
  /// so React useSyncExternalStore can debounce identity-only churn.
  revision: number;
}

export interface EvmChainServiceListener {
  (snap: EvmChainSnapshot): void;
}

// ── Internal state ──────────────────────────────────────────────

interface InternalState {
  // The actual ChainHarness (pulled in lazily so this module can be
  // tree-shaken from non-EVM lesson loads).
  chain: unknown | null;
  // Read-only snapshot — what the UI sees.
  snapshot: EvmChainSnapshot;
  listeners: Set<EvmChainServiceListener>;
}

const FAUCET_AMOUNT_WEI = 100n * 10n ** 18n; // +100 ETH per click
/// Cooldown between faucet hits per address. Default 5 minutes —
/// matches what real testnet faucets do, lets the learner build
/// muscle memory without making test flow annoying.
const FAUCET_COOLDOWN_MS = 5 * 60 * 1000;
const FAUCET_KEY_PREFIX = "fishbones:evm-faucet:";
const RECENT_TXS_LIMIT = 30;
const RECENT_CONTRACTS_LIMIT = 20;

const state: InternalState = {
  chain: null,
  snapshot: emptySnapshot(),
  listeners: new Set(),
};

function emptySnapshot(): EvmChainSnapshot {
  return {
    scope: "singleton",
    blockNumber: 0n,
    blockTimestamp: 0n,
    accounts: [],
    contracts: [],
    txs: [],
    revision: 0,
  };
}

// ── Singleton init ──────────────────────────────────────────────

/// Lazily build the persistent chain on first call. Subsequent calls
/// return the same instance. Use this from `runEvm` for in-app runs
/// (so deploys + balances persist between Run clicks); use a fresh
/// `buildChain(...)` directly for a sandboxed run.
export async function getOrCreateChain(): Promise<{
  chain: unknown;
  rebuildSnapshot: () => Promise<void>;
}> {
  if (!state.chain) {
    // Lazy-import the runtime so we don't pull @ethereumjs/vm into
    // every page. The runtime export gives us a builder we can call
    // with the compiled artifacts; we initialise it with an empty
    // contract registry — contracts get added as `chain.deploy()`
    // calls happen at lesson run time.
    const { _buildChainPersistent } = (await import(
      "../runtimes/evm"
    )) as unknown as {
      _buildChainPersistent: (
        attach: ChainAttachHooks,
      ) => Promise<{
        chain: unknown;
        rebuildSnapshot: () => Promise<void>;
      }>;
    };
    const built = await _buildChainPersistent(makeAttachHooks());
    state.chain = built.chain;
    await built.rebuildSnapshot();
    return built;
  }
  // Reuse — caller will wire fresh `compiled` artifacts via the
  // existing `chain.loadCompiled(...)` setter (added in evm.ts).
  return {
    chain: state.chain,
    rebuildSnapshot: async () => {
      // No-op when already built — the persistent chain instance
      // owns its own snapshot wiring via the attach hooks below.
    },
  };
}

/// Reset the chain — drops all state, fresh accounts, fresh block
/// counters. Wired to the dock's "Reset chain" button.
export async function resetChain(): Promise<void> {
  state.chain = null;
  state.snapshot = emptySnapshot();
  // Pre-warm: build fresh so the dock doesn't show "no chain" for a
  // beat between reset + the next call.
  await getOrCreateChain();
  notify();
}

// ── Snapshot updates ────────────────────────────────────────────

export interface ChainAttachHooks {
  onAccountsChanged(accounts: AccountSnapshot[]): void;
  onBlockChanged(blockNumber: bigint, blockTimestamp: bigint): void;
  onContractDeployed(c: ContractSnapshot): void;
  onTx(tx: TxSnapshot): void;
}

function makeAttachHooks(): ChainAttachHooks {
  return {
    onAccountsChanged(accounts) {
      state.snapshot = {
        ...state.snapshot,
        accounts,
        revision: state.snapshot.revision + 1,
      };
      notify();
    },
    onBlockChanged(blockNumber, blockTimestamp) {
      state.snapshot = {
        ...state.snapshot,
        blockNumber,
        blockTimestamp,
        revision: state.snapshot.revision + 1,
      };
      notify();
    },
    onContractDeployed(c) {
      const next = [c, ...state.snapshot.contracts].slice(
        0,
        RECENT_CONTRACTS_LIMIT,
      );
      state.snapshot = {
        ...state.snapshot,
        contracts: next,
        revision: state.snapshot.revision + 1,
      };
      notify();
    },
    onTx(tx) {
      const next = [tx, ...state.snapshot.txs].slice(0, RECENT_TXS_LIMIT);
      state.snapshot = {
        ...state.snapshot,
        txs: next,
        revision: state.snapshot.revision + 1,
      };
      notify();
    },
  };
}

function notify(): void {
  for (const l of state.listeners) {
    try {
      l(state.snapshot);
    } catch (e) {
      console.warn("[evmChainService] listener threw:", e);
    }
  }
}

// ── Public subscription API ─────────────────────────────────────

export function subscribe(l: EvmChainServiceListener): () => void {
  state.listeners.add(l);
  // Fire once so React's useSyncExternalStore picks up the current
  // snapshot synchronously.
  try {
    l(state.snapshot);
  } catch {
    /* swallow — never break a subscriber attach */
  }
  return () => {
    state.listeners.delete(l);
  };
}

export function getSnapshot(): EvmChainSnapshot {
  return state.snapshot;
}

// ── Faucet ──────────────────────────────────────────────────────

export interface FaucetResult {
  ok: boolean;
  /// New balance after the faucet hit. Same value the dock can
  /// optimistic-update against without waiting for the snapshot
  /// listener to fire.
  newBalanceWei?: bigint;
  /// Set when `ok: false`. Either "cooldown" with `cooldownRemainingMs`
  /// or "no-chain" / "error".
  reason?: "cooldown" | "no-chain" | "error";
  cooldownRemainingMs?: number;
  errorMessage?: string;
}

export function faucetCooldownRemainingMs(
  address: `0x${string}`,
): number {
  try {
    const raw = localStorage.getItem(FAUCET_KEY_PREFIX + address.toLowerCase());
    if (!raw) return 0;
    const last = Number(raw);
    if (!Number.isFinite(last)) return 0;
    const remaining = FAUCET_COOLDOWN_MS - (Date.now() - last);
    return Math.max(0, remaining);
  } catch {
    return 0;
  }
}

export async function requestFaucet(
  address: `0x${string}`,
  amountWei: bigint = FAUCET_AMOUNT_WEI,
): Promise<FaucetResult> {
  const remaining = faucetCooldownRemainingMs(address);
  if (remaining > 0) {
    return { ok: false, reason: "cooldown", cooldownRemainingMs: remaining };
  }
  if (!state.chain) {
    return { ok: false, reason: "no-chain" };
  }
  try {
    // The persistent chain exposes `setBalance(addr, balance)` (anvil-style).
    // We add to the existing balance rather than overwriting so a learner
    // can stack faucet hits without losing their accumulated state.
    const chain = state.chain as {
      balanceOf: (a: `0x${string}`) => Promise<bigint>;
      setBalance: (a: `0x${string}`, b: bigint) => Promise<void>;
    };
    const current = await chain.balanceOf(address);
    const next = current + amountWei;
    await chain.setBalance(address, next);
    try {
      localStorage.setItem(
        FAUCET_KEY_PREFIX + address.toLowerCase(),
        String(Date.now()),
      );
    } catch {
      /* private mode / quota — best-effort only */
    }

    // Snapshot the faucet "tx" so it shows up in the recent-tx list.
    makeAttachHooks().onTx({
      hash: synthFaucetHash(address),
      kind: "faucet",
      from: address,
      to: address,
      valueWei: amountWei,
      status: "success",
      blockNumber: state.snapshot.blockNumber,
      timestamp: Date.now(),
    });

    // Refresh balances for all known accounts so the UI stays
    // coherent (the receiving account's balance changed).
    await refreshAccountBalances();

    return { ok: true, newBalanceWei: next };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

async function refreshAccountBalances(): Promise<void> {
  if (!state.chain) return;
  const chain = state.chain as {
    accounts: AccountSnapshot[];
    balanceOf: (a: `0x${string}`) => Promise<bigint>;
  };
  const refreshed: AccountSnapshot[] = [];
  for (let i = 0; i < chain.accounts.length; i++) {
    const acc = chain.accounts[i];
    try {
      const balanceWei = await chain.balanceOf(acc.address);
      refreshed.push({
        address: acc.address,
        privateKey: acc.privateKey,
        balanceWei,
        nonce: 0n, // current snapshot doesn't carry per-account nonce; UI doesn't use it yet
        label: i === 0 ? "Default sender" : `Account #${i}`,
      });
    } catch {
      // Couldn't fetch — keep the previous snapshot's view to avoid
      // a flash of "0 ETH" mid-refresh.
      refreshed.push(
        state.snapshot.accounts[i] ?? {
          address: acc.address,
          privateKey: acc.privateKey,
          balanceWei: 0n,
          nonce: 0n,
          label: i === 0 ? "Default sender" : `Account #${i}`,
        },
      );
    }
  }
  state.snapshot = {
    ...state.snapshot,
    accounts: refreshed,
    revision: state.snapshot.revision + 1,
  };
  notify();
}

function synthFaucetHash(addr: `0x${string}`): `0x${string}` {
  const ts = Date.now().toString(16).padStart(12, "0");
  return ("0x" + ts + addr.slice(2).padEnd(52, "0")) as `0x${string}`;
}

// ── Helper exports for the UI ───────────────────────────────────

export const FAUCET_COOLDOWN = FAUCET_COOLDOWN_MS;
export const FAUCET_AMOUNT = FAUCET_AMOUNT_WEI;

/// Format wei as ETH with up to 4 decimal places. Used by the dock's
/// balance column.
export function formatEth(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  // Keep 4 significant fractional digits; trim trailing zeros.
  const fracStr = (frac + 10n ** 18n)
    .toString()
    .slice(1)
    .slice(0, 4)
    .replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? "-" + out : out;
}

/// Compact `0x12ab...cdef` rendering.
export function shortAddr(addr: string): string {
  if (!addr || !addr.startsWith("0x") || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// We pull `Abi` from viem only to keep the public surface
// type-stable for downstream callers; the value isn't used here.
void ({} as Abi);
