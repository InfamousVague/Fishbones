/// In-app local-SVM dock — visible above any Solana lesson. Mirrors
/// the EVM `<ChainDock>` (same `chain-dock__*` classes, same panel
/// vocabulary) so the two surfaces read as siblings; the differences
/// are pure semantics:
///
///   - "block" → "slot" (Solana's monotonic clock)
///   - "ETH"   → "SOL" (with lamports as the precision unit)
///   - "contracts" → "programs" (BPF executables, not EVM bytecode)
///   - addresses are base58 keypairs, not 0x-hex
///
/// Attaches to the `svmChainService` singleton — there's exactly one
/// SVM and one snapshot, so the same UI rendered in two places (e.g.
/// banner + a future popout) sees the same numbers.
///
/// **Desktop-only.** LiteSVM is a Rust napi addon and doesn't run in
/// the browser. The web build's "this lesson needs the desktop app"
/// path catches Solana lessons before this component ever mounts.

import { useEffect, useState, useCallback } from "react";
import { useT } from "@/i18n/i18n";
import { useInterval } from "@/hooks/useInterval";
import {
  subscribe,
  getSnapshot,
  requestAirdrop,
  resetSvmChain,
  airdropCooldownRemainingMs,
  formatSol,
  shortAddr,
  AIRDROP_AMOUNT,
  AIRDROP_COOLDOWN,
  type SvmChainSnapshot,
  type AccountSnapshot,
  type TxSnapshot,
} from "@/lib/svm/chainService";
import type { Address } from "@solana/kit";
import "@/components/organisms/ChainDock/ChainDock.css";
import "./SvmDock.css";

interface Props {
  /// Banner-mode is the default (mounted above the workbench by
  /// `<SvmDockBanner>`). `popout` mode is rendered inside its own
  /// OS window — same component, slightly different chrome (no
  /// "open in popout" button since we'd be opening ourselves).
  variant?: "banner" | "popout";
  /// Wired by the banner to `openSvmDockPopout()`. Hidden when
  /// `variant === "popout"`.
  onOpenPopout?: () => void;
  /// Banner-mode only: dismiss the dock for the current session.
  onClose?: () => void;
}

export function SvmDock({ variant = "banner", onOpenPopout, onClose }: Props) {
  const t = useT();
  const [snap, setSnap] = useState<SvmChainSnapshot>(() => getSnapshot());
  const [pendingAirdrop, setPendingAirdrop] = useState<Set<string>>(new Set());
  // Tick once a second so the cooldown countdown + "Xs ago" relative
  // times re-render. Cheap — single setState call, no work.
  const [, setTick] = useState(0);

  useEffect(() => subscribe(setSnap), []);

  useInterval(() => setTick((t) => t + 1), 1000);

  const onAirdrop = useCallback(async (address: Address) => {
    setPendingAirdrop((prev) => {
      const next = new Set(prev);
      next.add(address);
      return next;
    });
    try {
      await requestAirdrop(address);
    } catch (e) {
      // Cooldown error or harness failure — surface in console; the
      // disabled state on the button already prevents spam.
      console.warn("[svm-dock] airdrop failed:", e);
    } finally {
      setPendingAirdrop((prev) => {
        const next = new Set(prev);
        next.delete(address);
        return next;
      });
    }
  }, []);

  const onReset = useCallback(async () => {
    if (!confirm(t("chainDock.resetConfirmSvm"))) {
      return;
    }
    await resetSvmChain();
  }, [t]);

  const defaultAcc = snap.accounts[0];
  const otherAccs = snap.accounts.slice(1);
  const slotDate =
    snap.unixTimestamp > 0n
      ? new Date(Number(snap.unixTimestamp) * 1000)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19)
      : "—";

  return (
    <div
      className={`chain-dock chain-dock--${variant}`}
      role="region"
      aria-label={t("chainDock.regionSvm")}
    >
      <header className="chain-dock__header">
        <div className="chain-dock__title">
          <span className="chain-dock__chip svm-dock__chip">{t("chainDock.localSvm")}</span>
          <span className="chain-dock__block">
            {t("chainDock.slotPrefix")} <strong>{snap.slot.toString()}</strong>
          </span>
          <span className="chain-dock__timestamp">{slotDate}</span>
        </div>
        <div className="chain-dock__actions">
          {variant === "banner" && onOpenPopout && (
            <button
              type="button"
              className="chain-dock__btn chain-dock__btn--ghost"
              onClick={onOpenPopout}
              title={t("chainDock.popOutTitle")}
            >
              {t("chainDock.popOut")}
            </button>
          )}
          <button
            type="button"
            className="chain-dock__btn chain-dock__btn--ghost"
            onClick={onReset}
            title={t("chainDock.resetTitleSvm")}
          >
            {t("chainDock.reset")}
          </button>
          {variant === "banner" && onClose && (
            <button
              type="button"
              className="chain-dock__btn chain-dock__btn--icon"
              onClick={onClose}
              aria-label={t("chainDock.closeDock")}
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="chain-dock__body">
        <div className="chain-dock__grid">
          <section className="chain-dock__panel chain-dock__panel--accounts">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">{t("chainDock.accounts")}</span>
              {snap.accounts.length > 0 && (
                <span className="chain-dock__panel-meta">
                  {snap.accounts.length}
                </span>
              )}
            </header>
            <div className="chain-dock__panel-body">
              {!defaultAcc && (
                <div className="chain-dock__empty">
                  {t("chainDock.notInitialisedSvm")}
                </div>
              )}
              {defaultAcc && (
                <AccountRow
                  acc={defaultAcc}
                  isDefault
                  pending={pendingAirdrop.has(defaultAcc.address)}
                  onAirdrop={onAirdrop}
                />
              )}
              {otherAccs.length > 0 && (
                <details className="chain-dock__more">
                  <summary>{t("chainDock.otherAccounts", { count: otherAccs.length })}</summary>
                  <div className="chain-dock__more-list">
                    {otherAccs.map((a) => (
                      <AccountRow
                        key={a.address}
                        acc={a}
                        pending={pendingAirdrop.has(a.address)}
                        onAirdrop={onAirdrop}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>

          <section className="chain-dock__panel chain-dock__panel--contracts">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">{t("chainDock.programs")}</span>
              <span className="chain-dock__panel-meta">
                {snap.programs.length}
              </span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.programs.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  {t("chainDock.noDeploys")}
                </div>
              )}
              <ul className="chain-dock__contract-list">
                {snap.programs.slice(0, 8).map((p) => (
                  <li key={p.programId} className="chain-dock__contract">
                    <span className="chain-dock__contract-name">{p.name}</span>
                    <span className="chain-dock__contract-addr">
                      {shortAddr(p.programId)}
                    </span>
                    <span className="chain-dock__contract-block">
                      {t("chainDock.slotN", { slot: p.deployedAtSlot.toString() })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="chain-dock__panel chain-dock__panel--txs">
            <header className="chain-dock__panel-header">
              <span className="chain-dock__panel-label">{t("chainDock.recentTxs")}</span>
              <span className="chain-dock__panel-meta">{snap.txs.length}</span>
            </header>
            <div className="chain-dock__panel-body">
              {snap.txs.length === 0 && (
                <div className="chain-dock__empty chain-dock__empty--inline">
                  {t("chainDock.noTxs")}
                </div>
              )}
              <ul className="chain-dock__tx-list">
                {snap.txs.slice(0, 8).map((tx) => (
                  <TxRow key={tx.signature} tx={tx} />
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
  onAirdrop: (a: Address) => void;
}

function AccountRow({ acc, isDefault, pending, onAirdrop }: AccountRowProps) {
  const t = useT();
  const remaining = airdropCooldownRemainingMs(acc.address);
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
        {formatSol(acc.lamports)} <em>SOL</em>
      </span>
      <button
        type="button"
        className="chain-dock__btn chain-dock__btn--faucet"
        disabled={pending || onCooldown}
        onClick={() => onAirdrop(acc.address)}
        title={
          onCooldown
            ? t("chainDock.airdropCooldownTitle", { time: formatRemaining(remaining) })
            : t("chainDock.airdropAddTitle", {
                amount: formatSol(AIRDROP_AMOUNT),
                time: formatRemaining(AIRDROP_COOLDOWN),
              })
        }
      >
        {pending
          ? "…"
          : onCooldown
            ? formatRemaining(remaining)
            : `+${formatSol(AIRDROP_AMOUNT)} SOL`}
      </button>
    </div>
  );
}

function TxRow({ tx }: { tx: TxSnapshot }) {
  const t = useT();
  const ago = secondsAgo(tx.timestamp);
  const kindKey: Record<TxSnapshot["kind"], string> = {
    deploy: "chainDock.txKindDeploy",
    invoke: "chainDock.txKindInvoke",
    transfer: "chainDock.txKindTransfer",
    airdrop: "chainDock.txKindAirdrop",
  };
  return (
    <li className={`chain-dock__tx chain-dock__tx--${tx.status}`}>
      <span className={`chain-dock__tx-kind chain-dock__tx-kind--${tx.kind}`}>
        {t(kindKey[tx.kind])}
      </span>
      <span className="chain-dock__tx-from">{shortAddr(tx.feePayer)}</span>
      {tx.to && tx.kind !== "airdrop" && (
        <>
          <span className="chain-dock__tx-arrow">→</span>
          <span className="chain-dock__tx-to">{shortAddr(tx.to)}</span>
        </>
      )}
      {tx.valueLamports > 0n && (
        <span className="chain-dock__tx-value">
          {formatSol(tx.valueLamports)} SOL
        </span>
      )}
      <span className="chain-dock__tx-block">
        {t("chainDock.slotN", { slot: tx.slot.toString() })}
      </span>
      <span className="chain-dock__tx-ago">{t(ago.key, { count: ago.count })}</span>
    </li>
  );
}

/// Returns an i18n key + count for the relative-time chip — the
/// consuming component passes them through `t()` (plain module-level
/// helper, so no hooks here).
function secondsAgo(ts: number): { key: string; count: number } {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return { key: "chainDock.agoSeconds", count: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { key: "chainDock.agoMinutes", count: m };
  const h = Math.floor(m / 60);
  return { key: "chainDock.agoHours", count: h };
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${m}m ${remS.toString().padStart(2, "0")}s`;
}
