import { useEffect, useState } from "react";
import { logOut } from "@base/primitives/icon/icons/log-out";
import { trash2 } from "@base/primitives/icon/icons/trash-2";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";

import { describeAuthProvider } from "./helpers";
import { resetAccount } from "@/lib/resetAccount";
import type { UseLibreCloud } from "@/hooks/useLibreCloud";
import { useT } from "@/i18n/i18n";

import SettingsCard, { SettingsPage } from "./SettingsCard";
import SettingsRow from "./SettingsRow";

interface AccountSectionProps {
  user: {
    id: string;
    email: string | null;
    display_name: string | null;
    has_password: boolean;
    apple_linked: boolean;
    google_linked: boolean;
  };
  signingOut: boolean;
  deletingAccount: boolean;
  confirmDeleteAccount: boolean;
  onSignOut: () => void;
  onRequestDeleteConfirm: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  /// Cloud handle so the Start-fresh button can also wipe the
  /// learner's progress rows on the relay (best-effort — falls back
  /// to local-only when the relay route 404s or the device is
  /// offline).
  cloud: UseLibreCloud;
}

/// Account/Profile section, Cipher-style. Top card is the profile
/// hero — avatar + display name + email + provider. Following
/// cards group destructive affordances by escalation: sign-out
/// (reversible) → start-fresh (wipes progress, keeps account) →
/// delete-account (irreversible).
export default function AccountSection({
  user,
  signingOut,
  deletingAccount,
  confirmDeleteAccount,
  onSignOut,
  onRequestDeleteConfirm,
  onCancelDelete,
  onConfirmDelete,
  cloud,
}: AccountSectionProps) {
  const t = useT();
  const displayName = user.display_name?.trim() || null;
  // Avatar initial — first character of the display name, falling
  // back to the email's local part. Always uppercase for visual
  // consistency. If neither is available we fall through to "?".
  const initialSource = displayName || user.email || "";
  const initial = initialSource ? initialSource.charAt(0).toUpperCase() : "?";
  const providerLabel = describeAuthProvider(user);

  /// Start-fresh state machine. First click ARMS the button + starts
  /// a 5 s auto-disarm; second click within that window commits.
  /// Lots of friction on purpose — this nukes courses, completions,
  /// achievements, streaks, practice history, AND the cloud-side
  /// rows in one shot.
  const [freshArmed, setFreshArmed] = useState(false);
  const [freshBusy, setFreshBusy] = useState(false);
  const [freshMsg, setFreshMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!freshArmed) return;
    const id = window.setTimeout(() => setFreshArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [freshArmed]);

  const handleStartFresh = async () => {
    if (!freshArmed) {
      setFreshArmed(true);
      setFreshMsg(null);
      return;
    }
    setFreshArmed(false);
    setFreshBusy(true);
    setFreshMsg(t("settings.resetting"));
    try {
      const report = await resetAccount(cloud);
      setFreshMsg(t("settings.resetReloading", { message: report.message }));
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setFreshMsg(
        t("settings.resetFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      setFreshBusy(false);
    }
  };

  return (
    <SettingsPage
      title={t("settings.account")}
      description={t("settings.accountDescription")}
    >
      {/* ── Profile card ──────────────────────────────────────── */}
      <SettingsCard title={t("settings.profileCard")}>
        <div
          className="libre-settings-row libre-settings-row--avatar"
          style={{ alignItems: "center" }}
        >
          <span className="libre-settings-row__avatar" aria-hidden>
            {initial}
          </span>
          <span className="libre-settings-row__body">
            <span className="libre-settings-row__label">
              {displayName || user.email || t("settings.signedIn")}
            </span>
            <span className="libre-settings-row__sub">
              {user.email && displayName
                ? user.email
                : providerLabel}
            </span>
          </span>
          <span className="libre-settings-row__control">
            <span style={{ fontSize: 'var(--libre-fs-11)', color: "var(--color-text-tertiary)" }}>
              {providerLabel}
            </span>
          </span>
        </div>
      </SettingsCard>

      {/* ── Sign out ─────────────────────────────────────────── */}
      <SettingsCard title={t("settings.sessionCard")}>
        <SettingsRow
          icon={logOut}
          label={t("settings.signOutOfDevice")}
          sub={t("settings.signOutSub")}
          control={
            <button
              className="libre-settings-secondary"
              onClick={onSignOut}
              disabled={signingOut || deletingAccount}
            >
              {signingOut ? t("settings.signingOut") : t("auth.signOut")}
            </button>
          }
        />
      </SettingsCard>

      {/* ── Start fresh ──────────────────────────────────────── */}
      <SettingsCard title={t("settings.resetCard")}>
        <SettingsRow
          icon={rotateCcw}
          tone="danger"
          label={t("settings.startFresh")}
          sub={
            freshArmed
              ? t("settings.startFreshCloudArmedBody")
              : freshBusy
                ? freshMsg ?? t("settings.resetting")
                : freshMsg
                  ? freshMsg
                  : t("settings.startFreshCloudBody")
          }
          control={
            <button
              className="libre-settings-danger"
              disabled={freshBusy || signingOut || deletingAccount}
              onClick={handleStartFresh}
            >
              {freshBusy
                ? t("settings.resetting")
                : freshArmed
                  ? t("settings.confirm")
                  : t("settings.startFresh")}
            </button>
          }
        />
      </SettingsCard>

      {/* ── Delete account ──────────────────────────────────── */}
      <SettingsCard title={t("settings.dangerZone")}>
        <SettingsRow
          icon={trash2}
          tone="danger"
          label={t("settings.deleteAccount")}
          sub={t("settings.deleteAccountSub")}
          control={
            confirmDeleteAccount ? (
              <span
                style={{
                  display: "inline-flex",
                  gap: 'var(--libre-space-6)',
                }}
              >
                <button
                  className="libre-settings-secondary"
                  onClick={onCancelDelete}
                  disabled={deletingAccount}
                >
                  {t("settings.cancelBtn")}
                </button>
                <button
                  className="libre-settings-danger"
                  onClick={onConfirmDelete}
                  disabled={deletingAccount}
                >
                  {deletingAccount ? t("settings.deleting") : t("settings.reallyDelete")}
                </button>
              </span>
            ) : (
              <button
                className="libre-settings-danger"
                onClick={onRequestDeleteConfirm}
                disabled={signingOut}
              >
                {t("settings.deleteAccount")}
              </button>
            )
          }
        />
      </SettingsCard>
    </SettingsPage>
  );
}
