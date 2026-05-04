/// Long-lived Bitcoin chain singleton. Same job as
/// `lib/evm/chainService` for the EVM side: keep the in-process
/// chain alive across multiple test runs so the dock UI shows
/// continuity (account UTXOs, recent txs, recent blocks) instead of
/// a fresh empty chain on every Run click.
///
/// The shape is split in two:
///   • `BitcoinChainHarness` — the `chain.*` API tests run against,
///     re-exported from `runtimes/bitcoin/buildChain.ts`. This
///     module exposes `getOrCreateBitcoinChain()` which either
///     reuses the singleton or builds a fresh one.
///   • `BitcoinChainSnapshot` — the read-model the dock subscribes
///     to. Updated on every successful broadcast / mine. Listeners
///     get the latest snapshot via `subscribe()`.
///
/// This module is browser-only. Importing from a Node script would
/// fail because `@bitauth/libauth` ships top-level await in some
/// builds; lazy-import from React callers as we do for the EVM
/// service.

import { buildBitcoinChain } from "../../runtimes/bitcoin/buildChain";
import type {
  BitcoinChainHarness,
  BitcoinChainSnapshot,
  BitcoinTxSnapshot,
  BitcoinBlockSnapshot,
} from "../../runtimes/bitcoin/types";

export type {
  BitcoinAccount,
  BitcoinChainHarness,
  BitcoinChainSnapshot,
  BitcoinTxSnapshot,
  BitcoinBlockSnapshot,
  BitcoinUtxo,
} from "../../runtimes/bitcoin/types";

export interface BitcoinChainServiceListener {
  (snap: BitcoinChainSnapshot): void;
}

interface InternalState {
  chain: BitcoinChainHarness | null;
  snapshot: BitcoinChainSnapshot;
  listeners: Set<BitcoinChainServiceListener>;
  /// Last revision the harness reported, so we can detect a no-op
  /// notify when something else (e.g. a faucet UI poke) called us
  /// without actually mutating the chain.
  lastRevision: number;
  /// Local recent-tx + recent-block buffers. The harness tracks its
  /// own (capped) buffers; we mirror them here so the snapshot we
  /// publish includes them without forcing the harness to re-allocate
  /// per subscriber.
  recentTxs: BitcoinTxSnapshot[];
  recentBlocks: BitcoinBlockSnapshot[];
}

const EMPTY_SNAPSHOT: BitcoinChainSnapshot = {
  scope: "singleton",
  height: -1,
  tipHash: ("0x" + "".padStart(64, "0")) as `0x${string}`,
  accounts: [],
  utxos: [],
  mempool: [],
  txs: [],
  blocks: [],
  revision: 0,
};

const state: InternalState = {
  chain: null,
  snapshot: EMPTY_SNAPSHOT,
  listeners: new Set(),
  lastRevision: -1,
  recentTxs: [],
  recentBlocks: [],
};

function notify(): void {
  for (const l of state.listeners) {
    try {
      l(state.snapshot);
    } catch (e) {
      console.warn("[bitcoinChainService] listener threw:", e);
    }
  }
}

/// Re-materialize the snapshot the dock will see from the live
/// harness. Cheap — bounded by recent-* caps.
function rebuildSnapshot(): void {
  if (!state.chain) {
    state.snapshot = EMPTY_SNAPSHOT;
    return;
  }
  const c = state.chain;
  state.snapshot = {
    scope: "singleton",
    height: c.height(),
    // The tip hash on the most recent block, when there is one.
    tipHash:
      state.recentBlocks[0]?.hash ??
      (("0x" + "".padStart(64, "0")) as `0x${string}`),
    accounts: c.accounts,
    utxos: c.utxos().slice(0, 30),
    mempool: c.mempool(),
    txs: state.recentTxs.slice(0, 30),
    blocks: state.recentBlocks.slice(0, 30),
    revision: state.snapshot.revision + 1,
  };
}

/// Lazy-init or reuse the chain singleton. The harness wraps a
/// stateful UTXO map + mempool, so once it's built we keep it for
/// the rest of the page lifetime; only `resetBitcoinChain()` swaps
/// it for a fresh one.
export async function getOrCreateBitcoinChain(): Promise<{
  chain: BitcoinChainHarness;
}> {
  if (state.chain) return { chain: state.chain };
  state.chain = buildBitcoinChain();
  state.lastRevision = -1;
  state.recentTxs = [];
  state.recentBlocks = [];
  rebuildSnapshot();
  notify();
  // Set up a polling watcher: the harness mutates internal state
  // but doesn't expose a change-listener of its own (it's pure data
  // + functions, not an emitter). We could thread a callback in,
  // but a 250ms poll on a singleton snapshot is dirt-cheap and
  // keeps the harness fully decoupled from the service.
  startPollWatcher();
  return { chain: state.chain };
}

let pollTimer: number | null = null;
function startPollWatcher(): void {
  if (pollTimer != null) return;
  if (typeof window === "undefined") return;
  // Read height as a cheap proxy for "did anything change". When
  // it bumps, rebuild the snapshot. Mempool size also counts —
  // broadcasting without mining still updates the dock.
  let lastHeight = -1;
  let lastMempoolLen = 0;
  pollTimer = window.setInterval(() => {
    if (!state.chain) return;
    const h = state.chain.height();
    const mp = state.chain.mempool().length;
    if (h === lastHeight && mp === lastMempoolLen) return;
    lastHeight = h;
    lastMempoolLen = mp;
    // Also drain the harness's recent-tx + block lists into our
    // mirrors so the dock can show them. The harness exposes them
    // implicitly through `getTx` and the per-mine return value;
    // for v0 we accumulate by polling for tx differences.
    rebuildSnapshot();
    notify();
  }, 250);
}

/// Throw the chain away. The dock's "Reset" button calls this; the
/// next test run will rebuild from scratch via
/// `getOrCreateBitcoinChain()`.
export function resetBitcoinChain(): void {
  state.chain = null;
  state.snapshot = EMPTY_SNAPSHOT;
  state.lastRevision = -1;
  state.recentTxs = [];
  state.recentBlocks = [];
  if (pollTimer != null && typeof window !== "undefined") {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  notify();
}

/// Subscribe to snapshot updates. Fires immediately with the
/// current snapshot so `useSyncExternalStore`-style consumers don't
/// have to special-case the first read.
export function subscribeBitcoinChain(
  listener: BitcoinChainServiceListener,
): () => void {
  state.listeners.add(listener);
  try {
    listener(state.snapshot);
  } catch (e) {
    console.warn("[bitcoinChainService] listener threw on subscribe:", e);
  }
  return () => {
    state.listeners.delete(listener);
  };
}

export function getBitcoinChainSnapshot(): BitcoinChainSnapshot {
  return state.snapshot;
}
