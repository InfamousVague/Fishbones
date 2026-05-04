/// In-app Bitcoin local-chain dock — visible above bitcoin-harness
/// lessons. Same role as `ChainDock` plays for the EVM:
///
///   - Current tip height + tip block hash (truncated)
///   - 10 pre-funded learner accounts with their P2WPKH balances
///   - Recent UTXOs (last 30 by recency)
///   - Mempool (unconfirmed txs awaiting `chain.mine()`)
///   - Recent confirmed transactions (last 30)
///   - Recent mined blocks (last 30)
///   - "Mine" button to drain the mempool on demand
///   - "Reset" button to drop all chain state
///
/// Cloned (not generalized) from ChainDock — Bitcoin's UTXO model
/// has no concept of "account balance owned by a contract" so
/// trying to share columns with the EVM dock would force every
/// column to handle a pretend-Either type. Sharing the panel
/// grid CSS gives us visual continuity without that compromise.

import { useEffect, useState, useCallback } from "react";
import {
  subscribeBitcoinChain,
  getBitcoinChainSnapshot,
  resetBitcoinChain,
  type BitcoinChainSnapshot,
  type BitcoinAccount,
  type BitcoinTxSnapshot,
  type BitcoinUtxo,
  type BitcoinBlockSnapshot,
} from "../../lib/bitcoin/chainService";
import "../ChainDock/ChainDock.css";
import "./BitcoinChainDock.css";

interface Props {
  variant?: "banner" | "popout";
  onOpenPopout?: () => void;
  onClose?: () => void;
}

const SATS_PER_BTC = 100_000_000n;

/// Format sats as a human-readable BTC amount. Drops trailing zeros
/// past the first relevant non-zero — `100_000_000n` becomes "1",
/// `12_345_678n` becomes "0.12345678", etc. Lessons can teach
/// learners that 1 BTC = 100,000,000 sats, but the dock prefers
/// readability.
function formatBtc(sats: bigint): string {
  if (sats === 0n) return "0";
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / SATS_PER_BTC;
  const frac = abs % SATS_PER_BTC;
  let fracStr = frac.toString().padStart(8, "0");
  // Trim trailing zeros, keep at least one digit after the decimal
  // when the whole part is zero so "0" never appears as just "0."
  fracStr = fracStr.replace(/0+$/, "");
  const out = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${out}` : out;
}

function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function shortHex(hex: string, head = 8, tail = 4): string {
  return shortAddr(hex, head, tail);
}

function secondsAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function BitcoinChainDock({
  variant = "banner",
  onOpenPopout,
  onClose,
}: Props) {
  const [snap, setSnap] = useState<BitcoinChainSnapshot>(() =>
    getBitcoinChainSnapshot(),
  );
  const [, setTick] = useState(0);

  useEffect(() => subscribeBitcoinChain(setSnap), []);

  // Once-a-second tick so "Xs ago" timestamps re-render without
  // bouncing on every chain mutation.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const onReset = useCallback(() => {
    if (
      !confirm(
        "Reset the chain? All balances, UTXOs, and mined blocks will be cleared.",
      )
    ) {
      return;
    }
    resetBitcoinChain();
  }, []);

  const balanceFor = useCallback(
    (acct: BitcoinAccount): bigint => {
      let sum = 0n;
      for (const u of snap.utxos) {
        if (u.address === acct.p2wpkhAddress) sum += u.value;
      }
      return sum;
    },
    [snap.utxos],
  );

  const defaultAcc = snap.accounts[0];
  const otherAccs = snap.accounts.slice(1);
  const tipBlock = snap.blocks[0];

  return (
    <div
      className={`chain-dock chain-dock--${variant} btc-dock`}
      role="region"
      aria-label="In-process Bitcoin regtest chain"
    >
      <header className="chain-dock__header">
        <div className="chain-dock__title">
          <span className="chain-dock__chip btc-dock__chip">Local Bitcoin</span>
          <span className="chain-dock__block">
            tip <strong>{snap.height >= 0 ? snap.height : "—"}</strong>
          </span>
          {tipBlock && (
            <span
              className="chain-dock__timestamp btc-dock__hash"
              title={tipBlock.hash}
            >
              {shortHex(tipBlock.hash)}
            </span>
          )}
        </div>
        <div className="chain-dock__actions">
          {variant === "banner" && onOpenPopout && (
            <button
              type="button"
              className="chain-dock__btn chain-dock__btn--ghost"
              onClick={onOpenPopout}
              title="Open the Bitcoin dock in its own window"
            >
              ↗ Pop out
            </button>
          )}
          <button
            type="button"
            className="chain-dock__btn chain-dock__btn--ghost"
            onClick={onReset}
            title="Drop all chain state"
          >
            Reset
          </button>
          {variant === "banner" && onClose && (
            <button
              type="button"
              className="chain-dock__btn chain-dock__btn--icon"
              onClick={onClose}
              aria-label="Close dock"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="chain-dock__body">
        <div className="chain-dock__grid btc-dock__grid">
          {/* ── Accounts: balances aggregated over P2WPKH UTXOs ── */}
          <section className="chain-dock__panel chain-dock__panel--accounts">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">Accounts</span>
              {snap.accounts.length > 0 && (
                <span className="chain-dock__panel-meta">
                  {snap.accounts.length}
                </span>
              )}
            </header>
            <div className="chain-dock__panel-body">
              {!defaultAcc && (
                <div className="chain-dock__empty">
                  The chain hasn't been initialised yet. Run a Bitcoin
                  lesson to spin it up.
                </div>
              )}
              {defaultAcc && (
                <BitcoinAccountRow
                  acct={defaultAcc}
                  balanceSats={balanceFor(defaultAcc)}
                  isDefault
                />
              )}
              {otherAccs.length > 0 && (
                <details className="chain-dock__more">
                  <summary>+{otherAccs.length} other accounts</summary>
                  <div className="chain-dock__more-list">
                    {otherAccs.map((a) => (
                      <BitcoinAccountRow
                        key={a.p2wpkhAddress}
                        acct={a}
                        balanceSats={balanceFor(a)}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>

          {/* ── Mempool: unconfirmed txs awaiting mine() ── */}
          <section className="chain-dock__panel btc-dock__panel--mempool">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">Mempool</span>
              <span className="chain-dock__panel-meta">
                {snap.mempool.length}
              </span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.mempool.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  Empty. Broadcast a tx and it'll queue here until you
                  call <code>chain.mine()</code>.
                </div>
              )}
              <ul className="btc-dock__tx-list">
                {snap.mempool.slice(0, 6).map((tx) => (
                  <BitcoinMempoolRow key={tx.txid} tx={tx} />
                ))}
              </ul>
            </div>
          </section>

          {/* ── Recent confirmed txs ── */}
          <section className="chain-dock__panel chain-dock__panel--txs">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">
                Recent transactions
              </span>
              <span className="chain-dock__panel-meta">{snap.txs.length}</span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.txs.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  No mined txs yet.
                </div>
              )}
              <ul className="btc-dock__tx-list">
                {snap.txs.slice(0, 8).map((tx) => (
                  <BitcoinTxRow key={tx.txid} tx={tx} />
                ))}
              </ul>
            </div>
          </section>

          {/* ── Recent blocks (height, txid count, ago) ── */}
          <section className="chain-dock__panel btc-dock__panel--blocks">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">Recent blocks</span>
              <span className="chain-dock__panel-meta">
                {snap.blocks.length}
              </span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.blocks.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  No blocks mined yet (genesis only).
                </div>
              )}
              <ul className="btc-dock__block-list">
                {snap.blocks.slice(0, 6).map((b) => (
                  <BitcoinBlockRow key={b.hash} block={b} />
                ))}
              </ul>
            </div>
          </section>

          {/* ── Recent UTXOs (last 30 by recency) ── */}
          <section className="chain-dock__panel btc-dock__panel--utxos">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">Recent UTXOs</span>
              <span className="chain-dock__panel-meta">
                {snap.utxos.length}
              </span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.utxos.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  No unspent outputs yet.
                </div>
              )}
              <ul className="btc-dock__utxo-list">
                {snap.utxos.slice(0, 8).map((u) => (
                  <BitcoinUtxoRow key={`${u.txid}:${u.vout}`} utxo={u} />
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function BitcoinAccountRow({
  acct,
  balanceSats,
  isDefault,
}: {
  acct: BitcoinAccount;
  balanceSats: bigint;
  isDefault?: boolean;
}) {
  return (
    <div
      className={`chain-dock__acc ${isDefault ? "chain-dock__acc--default" : ""}`}
    >
      <div className="chain-dock__acc-meta">
        <span className="chain-dock__acc-label">{acct.label}</span>
        <span
          className="chain-dock__acc-addr"
          title={acct.p2wpkhAddress}
        >
          {shortAddr(acct.p2wpkhAddress)}
        </span>
      </div>
      <span className="chain-dock__acc-balance">
        {formatBtc(balanceSats)} <em>BTC</em>
      </span>
    </div>
  );
}

function BitcoinMempoolRow({ tx }: { tx: BitcoinTxSnapshot }) {
  return (
    <li className="btc-dock__tx-row btc-dock__tx-row--pending">
      <span className={`btc-dock__tx-kind btc-dock__tx-kind--${tx.kind}`}>
        {tx.kind}
      </span>
      <span className="btc-dock__tx-id" title={tx.txid}>
        {shortHex(tx.txid)}
      </span>
      <span className="btc-dock__tx-flow">
        {tx.inCount}→{tx.outCount}
      </span>
      <span className="btc-dock__tx-amount">
        {formatBtc(tx.totalOutSats)} BTC
      </span>
      {tx.feeSats !== null && tx.feeSats > 0n && (
        <span className="btc-dock__tx-fee" title="fee in sats">
          fee {tx.feeSats.toString()}s
        </span>
      )}
    </li>
  );
}

function BitcoinTxRow({ tx }: { tx: BitcoinTxSnapshot }) {
  return (
    <li className="btc-dock__tx-row">
      <span className={`btc-dock__tx-kind btc-dock__tx-kind--${tx.kind}`}>
        {tx.kind}
      </span>
      <span className="btc-dock__tx-id" title={tx.txid}>
        {shortHex(tx.txid)}
      </span>
      <span className="btc-dock__tx-flow">
        {tx.inCount}→{tx.outCount}
      </span>
      <span className="btc-dock__tx-amount">
        {formatBtc(tx.totalOutSats)} BTC
      </span>
      {tx.blockHeight !== null && (
        <span className="btc-dock__tx-block">block {tx.blockHeight}</span>
      )}
      <span className="chain-dock__tx-ago">{secondsAgo(tx.timestamp)}</span>
    </li>
  );
}

function BitcoinBlockRow({ block }: { block: BitcoinBlockSnapshot }) {
  return (
    <li className="btc-dock__block-row">
      <span className="btc-dock__block-height">#{block.height}</span>
      <span className="btc-dock__block-hash" title={block.hash}>
        {shortHex(block.hash)}
      </span>
      <span className="btc-dock__block-txs">
        {block.txids.length} tx{block.txids.length === 1 ? "" : "s"}
      </span>
      <span className="chain-dock__tx-ago">{secondsAgo(block.timestamp)}</span>
    </li>
  );
}

function BitcoinUtxoRow({ utxo }: { utxo: BitcoinUtxo }) {
  return (
    <li className="btc-dock__utxo-row">
      <span className="btc-dock__utxo-amount">
        {formatBtc(utxo.value)} BTC
      </span>
      <span className="btc-dock__utxo-out" title={`${utxo.txid}:${utxo.vout}`}>
        {shortHex(utxo.txid)}:{utxo.vout}
      </span>
      {utxo.address && (
        <span className="btc-dock__utxo-addr" title={utxo.address}>
          → {shortAddr(utxo.address)}
        </span>
      )}
      <span className="btc-dock__utxo-height">block {utxo.height}</span>
    </li>
  );
}
