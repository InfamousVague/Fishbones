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

import { buildBitcoinChain } from "@/runtimes/bitcoin/buildChain";
import type {
  BitcoinChainHarness,
  BitcoinChainSnapshot,
  BitcoinTxSnapshot,
  BitcoinBlockSnapshot,
} from "@/runtimes/bitcoin/types";

export type {
  BitcoinAccount,
  BitcoinChainHarness,
  BitcoinChainSnapshot,
  BitcoinTxSnapshot,
  BitcoinBlockSnapshot,
  BitcoinUtxo,
} from "@/runtimes/bitcoin/types";

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
  /// Snapshot id captured when the chain was first built — represents
  /// the pristine state (10 pre-funded accounts, genesis block, no
  /// txs). The runtime's `revertToPristine()` reverts to this point
  /// at the start of every Run so test assertions like "account[0]
  /// has 50 BTC" stay deterministic across Runs even though we
  /// intentionally leave the live chain dirty between runs (so the
  /// dock keeps showing activity).
  pristineSnap: string | null;
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
  pristineSnap: null,
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
///
/// We wrap the freshly-built harness with a thin proxy
/// (`instrumentChain`) that intercepts every mutating call —
/// `broadcast`, `send`, `mine`, `flushMempool`, `revert` — to:
///   1. Push freshly-broadcast txs and freshly-mined blocks into
///      the service's `recentTxs` / `recentBlocks` accumulators.
///      These are what the dock's "Recent transactions" / "Recent
///      blocks" panels read; without this they stayed empty no
///      matter how many txs the test ran.
///   2. Synchronously rebuild the snapshot + notify subscribers
///      after each mutation so the dock paints in the same frame.
///      A test that broadcasts → mines → reverts inside ~5 ms will
///      now show those events on the dock; the prior 250 ms
///      polling watcher missed them entirely.
///   3. Preserve the historical accumulator across `revert` so the
///      learner can still see the txs that "happened" in the test
///      run, even after isolation rolls the live UTXO state back.
///      The Accounts / UTXOs / Mempool panels reflect the live
///      (post-revert) state; the txs / blocks panels show history.
/// Sentinel marker the proxy carries so we can detect (and replace)
/// a chain that was wrapped by an OLDER version of `instrumentChain`
/// — or wasn't wrapped at all because it was created before the
/// proxy code landed and Vite HMR preserved it across module reloads.
/// Bump this string whenever `instrumentChain` changes shape.
const INSTRUMENT_VERSION = "v3-2026-05-05-pristine";
const INSTRUMENT_MARKER = Symbol.for(
  "fb.bitcoin.chainservice.instrument-version",
);

export async function getOrCreateBitcoinChain(): Promise<{
  chain: BitcoinChainHarness;
}> {
  // Reuse the existing chain ONLY if it was wrapped by the current
  // `instrumentChain` build. An older / un-wrapped chain (left over
  // from a hot-reload) gets re-wrapped on the spot — the underlying
  // harness is untouched, so balances/UTXOs/blocks already on it
  // stay intact; we just install the mutation proxy so the dock
  // starts seeing changes.
  // Reuse the cached chain ONLY when (a) it was wrapped by the
  // current `instrumentChain` build AND (b) we have a valid pristine
  // snapshot id captured at its creation. If either condition fails,
  // we throw the chain away and rebuild from scratch — the
  // alternative ("re-wrap in place") leaves us without a pristine
  // baseline, so test assertions like "account[0] has 50 BTC" break
  // forever once the chain has been touched.
  if (state.chain) {
    const marker =
      (state.chain as unknown as Record<symbol, unknown>)[INSTRUMENT_MARKER];
    if (marker === INSTRUMENT_VERSION && state.pristineSnap) {
      return { chain: state.chain };
    }
    // Stale build (from before this version's pristineSnap support)
    // OR a chain that lost its pristine reference somehow. Wipe and
    // rebuild — the user loses any accumulated history but gets
    // deterministic test runs back. The dock's recentTxs /
    // recentBlocks reset alongside since they're tied to a specific
    // chain instance.
  }
  state.chain = instrumentChain(buildBitcoinChain());
  state.lastRevision = -1;
  state.recentTxs = [];
  state.recentBlocks = [];
  // Capture the pristine snapshot id immediately, before any test
  // run can mutate the chain. `revertToPristine()` uses this so
  // every Run starts from the same baseline (10 pre-funded accounts
  // at 50 BTC each, just genesis on the chain) regardless of how
  // dirty the chain got from the previous Run.
  state.pristineSnap = state.chain.snapshot();
  rebuildSnapshot();
  notify();
  return { chain: state.chain };
}

/// Revert the chain to its as-built pristine state. The runtime
/// calls this at the top of every Run AND before each test body so
/// assertions like "account[0] starts with 50 BTC" stay
/// deterministic. The recentTxs / recentBlocks accumulators are NOT
/// cleared — the dock keeps showing what happened in the previous
/// Run until the new Run's mutations supersede them.
///
/// CRITICAL: the underlying harness deletes a snapshot id from its
/// internal ring after `revert()` consumes it (see `buildChain.ts`
/// line `state.snapshots.delete(id)`). So a single pristineSnap is
/// only good for one revert. We re-capture immediately after
/// reverting so the NEXT call still has a valid pristine id.
///
/// If anything goes wrong (id was evicted from the bounded ring,
/// the chain was hot-reloaded, snapshot/revert internals moved,
/// etc.) we DON'T silently no-op — that's exactly the bug that left
/// the chain accumulating dirty state across Runs. Instead we wipe
/// the chain and rebuild it from scratch, then notify subscribers.
/// The dock's history accumulators reset alongside, but the
/// learner gets deterministic test runs back, which matters more.
export function revertToPristine(): boolean {
  if (!state.chain || !state.pristineSnap) {
    rebuildChainFromScratch();
    return state.chain != null;
  }
  try {
    state.chain.revert(state.pristineSnap);
    // Re-snapshot the now-pristine state so the next call has a
    // valid pristine id to revert to.
    state.pristineSnap = state.chain.snapshot();
    return true;
  } catch {
    // Pristine id was lost. Fall through to a hard rebuild so the
    // next Run starts from real pristine.
    rebuildChainFromScratch();
    return state.chain != null;
  }
}

/// Last-resort fallback for `revertToPristine` — used when the
/// pristine snapshot id has gone missing (e.g. evicted from the
/// harness's bounded snapshot ring after many Runs). Discards the
/// current chain and any historical accumulators, builds a fresh
/// chain, and captures a new pristine baseline. Notifies dock
/// subscribers so the panels reset alongside.
function rebuildChainFromScratch(): void {
  state.chain = instrumentChain(buildBitcoinChain());
  state.lastRevision = -1;
  state.recentTxs = [];
  state.recentBlocks = [];
  state.pristineSnap = state.chain.snapshot();
  rebuildSnapshot();
  notify();
}

/// Wrap a freshly-built harness so every mutating call updates the
/// chain service's accumulators + notifies dock subscribers
/// synchronously. Read-only methods are passed through untouched.
///
/// Designed so the wrapper is functionally indistinguishable from
/// the wrapped harness as far as test code is concerned — the
/// returned txid / block-snapshot shapes are identical, so lessons
/// can call `chain.send(...).txid`, `chain.mine()[0].height`, etc.
function instrumentChain(c: BitcoinChainHarness): BitcoinChainHarness {
  // Per-tx capture helper: read the freshly-broadcast tx from the
  // harness (which has the fully populated BitcoinTxSnapshot now,
  // including kind / fee / counts) and unshift into our recents.
  // De-dupe on txid so a re-broadcast doesn't double-list.
  function captureTx(txid: `0x${string}`): void {
    const tx = c.getTx(txid);
    if (!tx) return;
    const idx = state.recentTxs.findIndex((t) => t.txid === txid);
    if (idx >= 0) state.recentTxs[idx] = tx; // refresh with newer state
    else state.recentTxs.unshift(tx);
    // Trim to the same window the snapshot serializes; keeps memory
    // bounded across long sessions.
    if (state.recentTxs.length > 100) state.recentTxs.length = 100;
  }
  function captureBlocks(blocks: BitcoinBlockSnapshot[]): void {
    // unshift in reverse so the newest block ends up first.
    for (let i = blocks.length - 1; i >= 0; i--) {
      state.recentBlocks.unshift(blocks[i]);
      // Refresh confirmed txs in recentTxs (they now have a real
      // blockHeight / kind, which the dock renders as "block N"
      // instead of the pending strikethrough style).
      for (const txid of blocks[i].txids) captureTx(txid);
    }
    if (state.recentBlocks.length > 100) state.recentBlocks.length = 100;
  }
  function flush(): void {
    rebuildSnapshot();
    notify();
  }
  // Return a wrapper marked with the current instrument version so a
  // future `getOrCreateBitcoinChain` call can tell if this chain was
  // wrapped by the current code (vs. a stale build from before HMR).
  const wrapper: BitcoinChainHarness = {
    accounts: c.accounts,
    network: c.network,
    height: () => c.height(),
    utxos: (addr) => c.utxos(addr),
    balance: (addr) => c.balance(addr),
    getTx: (txid) => c.getTx(txid),
    mempool: () => c.mempool(),
    script: c.script,
    send: (from, to, amount, fee) => {
      const r = c.send(from, to, amount, fee);
      captureTx(r.txid);
      flush();
      return r;
    },
    broadcast: (rawTxHex) => {
      const r = c.broadcast(rawTxHex);
      captureTx(r.txid);
      flush();
      return r;
    },
    mine: (n) => {
      const blocks = c.mine(n);
      captureBlocks(blocks);
      flush();
      return blocks;
    },
    flushMempool: () => {
      c.flushMempool();
      flush();
    },
    snapshot: () => c.snapshot(),
    revert: (id) => {
      c.revert(id);
      // Live state (mempool / utxos / balances) rolls back, but we
      // intentionally KEEP recentTxs / recentBlocks so the learner
      // can still see what happened during the just-finished test
      // body. The dock will show "this tx was broadcast" even after
      // the chain technically rewinds.
      flush();
    },
  };
  // Tag the wrapper so the singleton-reuse check in
  // `getOrCreateBitcoinChain` can detect a stale build and re-wrap.
  (wrapper as unknown as Record<symbol, unknown>)[INSTRUMENT_MARKER] =
    INSTRUMENT_VERSION;
  return wrapper;
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
  state.pristineSnap = null;
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

/// True if the singleton chain has had any user-visible activity —
/// at least one mempool / confirmed tx, OR a non-genesis block, OR
/// a UTXO that didn't come from the initial faucet sweep. Used by
/// the dock visibility logic to decide "is there a transaction
/// here for the user to look at?" — when false, the dock is dormant
/// and can stay hidden on non-chain views (Playground, off-harness
/// lesson pages) until something happens.
///
/// Block count > 1 because the regtest chain always ships with
/// genesis (block 0), so "blocks > 0" would always be true on a
/// freshly-built chain. accounts is intentionally NOT a signal
/// here — the chain pre-seeds 5 wallets at startup so the user has
/// addresses to send from, but no transactions until they run a
/// lesson.
export function bitcoinChainHasActivity(
  snap: BitcoinChainSnapshot = state.snapshot,
): boolean {
  if (snap.txs.length > 0) return true;
  if (snap.mempool.length > 0) return true;
  if (snap.blocks.length > 1) return true;
  return false;
}

// Vite HMR cleanup. When this module hot-reloads, drop any chain
// reference held by the previous build so the next test run picks up
// the fresh `instrumentChain`. Without this, a long-running dev
// session would carry an un-wrapped chain across edits and the dock
// would silently never update — exactly the bug we hit when the v2
// proxy first landed.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    state.chain = null;
    state.snapshot = EMPTY_SNAPSHOT;
    state.lastRevision = -1;
    state.recentTxs = [];
    state.recentBlocks = [];
    state.pristineSnap = null;
  });
}
