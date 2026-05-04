/// In-app local-chain dock — visible above smart-contract lessons.
/// Shows the same things you'd see in any anvil-style chain UI:
///
///   - Current block number + timestamp (updates as txs land)
///   - 10 pre-funded accounts with their balances. The default
///     sender (accounts[0]) is highlighted; the rest are listed
///     compactly below it.
///   - A "Request testnet ETH" button per account that adds
///     `FAUCET_AMOUNT` (100 ETH) to the balance and rate-limits
///     subsequent clicks (`FAUCET_COOLDOWN`, default 5 min).
///   - Recent contracts deployed in this session (last 20).
///   - Recent transactions (last 30).
///   - "Reset chain" button to drop all state.
///
/// The dock attaches to the `lib/evm/chainService` singleton — there's
/// exactly one chain and one snapshot, regardless of how many
/// places mount this component (banner + popout window will both
/// see the same numbers).

import { useEffect, useState, useCallback } from "react";
import {
  subscribe,
  getSnapshot,
  requestFaucet,
  resetChain,
  faucetCooldownRemainingMs,
  formatEth,
  shortAddr,
  FAUCET_AMOUNT,
  FAUCET_COOLDOWN,
  type EvmChainSnapshot,
  type AccountSnapshot,
  type TxSnapshot,
} from "../../lib/evm/chainService";
import "./ChainDock.css";

interface Props {
  /// When the dock is rendering inside its own popout window we
  /// don't show the "open in popout" button. The banner mode (default)
  /// shows it.
  variant?: "banner" | "popout";
  /// Called when the user clicks the "open in popout" button. Wired
  /// to `openEvmDockPopout()` by the caller; we don't import it here
  /// to keep the component testable without a Tauri shim.
  onOpenPopout?: () => void;
  /// Called on "Close" — banner mode renders an X to dismiss; popout
  /// mode hides the X (the OS window-close button takes over).
  onClose?: () => void;
}

export function ChainDock({ variant = "banner", onOpenPopout, onClose }: Props) {
  const [snap, setSnap] = useState<EvmChainSnapshot>(() => getSnapshot());
  const [pendingFaucet, setPendingFaucet] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);

  useEffect(() => subscribe(setSnap), []);

  // Tick once a second so the cooldown countdown + "Xs ago" relative
  // times re-render. Cheap — single setState call, no work.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const onFaucet = useCallback(
    async (address: `0x${string}`) => {
      setPendingFaucet((prev) => {
        const next = new Set(prev);
        next.add(address);
        return next;
      });
      try {
        await requestFaucet(address);
      } finally {
        setPendingFaucet((prev) => {
          const next = new Set(prev);
          next.delete(address);
          return next;
        });
      }
    },
    [],
  );

  const onReset = useCallback(async () => {
    if (!confirm("Reset the chain? All balances, contracts, and transactions will be cleared.")) {
      return;
    }
    await resetChain();
  }, []);

  const defaultAcc = snap.accounts[0];
  const otherAccs = snap.accounts.slice(1);

  return (
    <div
      className={`chain-dock chain-dock--${variant}`}
      role="region"
      aria-label="In-process Ethereum dev chain"
    >
      <header className="chain-dock__header">
        <div className="chain-dock__title">
          <span className="chain-dock__chip">Local chain</span>
          <span className="chain-dock__block">
            block <strong>{snap.blockNumber.toString()}</strong>
          </span>
          <span className="chain-dock__timestamp">
            {snap.blockTimestamp > 0n
              ? new Date(Number(snap.blockTimestamp) * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)
              : "—"}
          </span>
        </div>
        <div className="chain-dock__actions">
          {variant === "banner" && onOpenPopout && (
            <button
              type="button"
              className="chain-dock__btn chain-dock__btn--ghost"
              onClick={onOpenPopout}
              title="Open the dock in its own window"
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

      {/* Body. Mirrors the editor/output pattern: each sub-panel
          has its own header strip (bg-secondary, uppercase label,
          right-side count chip) and a body sitting on bg-primary.
          That's why the three columns read as part of the same
          family as the workbench rather than a standalone overlay. */}
      <div className="chain-dock__body">
        <div className="chain-dock__grid">
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
                  The chain hasn't been initialised yet. Run a smart-contract
                  lesson to spin it up.
                </div>
              )}
              {defaultAcc && (
                <AccountRow
                  acc={defaultAcc}
                  isDefault
                  pending={pendingFaucet.has(defaultAcc.address)}
                  onFaucet={onFaucet}
                />
              )}
              {otherAccs.length > 0 && (
                <details className="chain-dock__more">
                  <summary>+{otherAccs.length} other accounts</summary>
                  <div className="chain-dock__more-list">
                    {otherAccs.map((a) => (
                      <AccountRow
                        key={a.address}
                        acc={a}
                        pending={pendingFaucet.has(a.address)}
                        onFaucet={onFaucet}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>

          <section className="chain-dock__panel chain-dock__panel--contracts">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">Contracts</span>
              <span className="chain-dock__panel-meta">
                {snap.contracts.length}
              </span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.contracts.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  No deploys yet.
                </div>
              )}
              <ul className="chain-dock__contract-list">
                {snap.contracts.slice(0, 8).map((c) => (
                  <li key={c.address} className="chain-dock__contract">
                    <span className="chain-dock__contract-name">{c.name}</span>
                    <span className="chain-dock__contract-addr">
                      {shortAddr(c.address)}
                    </span>
                    <span className="chain-dock__contract-block">
                      block {c.deployedAtBlock.toString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="chain-dock__panel chain-dock__panel--txs">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">Recent transactions</span>
              <span className="chain-dock__panel-meta">{snap.txs.length}</span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.txs.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  No txs yet.
                </div>
              )}
              <ul className="chain-dock__tx-list">
                {snap.txs.slice(0, 8).map((tx) => (
                  <TxRow key={tx.hash} tx={tx} />
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

interface AccountRowProps {
  acc: AccountSnapshot;
  isDefault?: boolean;
  pending: boolean;
  onFaucet: (a: `0x${string}`) => void;
}

function AccountRow({ acc, isDefault, pending, onFaucet }: AccountRowProps) {
  const remaining = faucetCooldownRemainingMs(acc.address);
  const onCooldown = remaining > 0;
  return (
    <div
      className={`chain-dock__acc ${isDefault ? "chain-dock__acc--default" : ""}`}
    >
      <div className="chain-dock__acc-meta">
        <span className="chain-dock__acc-label">{acc.label}</span>
        <span className="chain-dock__acc-addr">{shortAddr(acc.address)}</span>
      </div>
      <span className="chain-dock__acc-balance">
        {formatEth(acc.balanceWei)} <em>ETH</em>
      </span>
      <button
        type="button"
        className="chain-dock__btn chain-dock__btn--faucet"
        disabled={pending || onCooldown}
        onClick={() => onFaucet(acc.address)}
        title={
          onCooldown
            ? `Cooldown — try again in ${formatRemaining(remaining)}`
            : `Add ${formatEth(FAUCET_AMOUNT)} ETH to this account (resets every ${formatRemaining(FAUCET_COOLDOWN)})`
        }
      >
        {pending
          ? "…"
          : onCooldown
            ? formatRemaining(remaining)
            : `+${formatEth(FAUCET_AMOUNT)} ETH`}
      </button>
    </div>
  );
}

function TxRow({ tx }: { tx: TxSnapshot }) {
  const ago = secondsAgo(tx.timestamp);
  const kindLabel = {
    deploy: "deploy",
    call: "call",
    "value-transfer": "transfer",
    faucet: "faucet",
  }[tx.kind];
  return (
    <li className={`chain-dock__tx chain-dock__tx--${tx.status}`}>
      <span className={`chain-dock__tx-kind chain-dock__tx-kind--${tx.kind}`}>
        {kindLabel}
      </span>
      <span className="chain-dock__tx-from">{shortAddr(tx.from)}</span>
      {tx.to && tx.kind !== "faucet" && (
        <>
          <span className="chain-dock__tx-arrow">→</span>
          <span className="chain-dock__tx-to">{shortAddr(tx.to)}</span>
        </>
      )}
      {tx.valueWei > 0n && (
        <span className="chain-dock__tx-value">
          {formatEth(tx.valueWei)} ETH
        </span>
      )}
      <span className="chain-dock__tx-block">
        block {tx.blockNumber.toString()}
      </span>
      <span className="chain-dock__tx-ago">{ago}</span>
    </li>
  );
}

function secondsAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${m}m ${remS.toString().padStart(2, "0")}s`;
}
