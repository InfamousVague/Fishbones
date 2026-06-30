import { useCallback, useEffect, useMemo, useState } from "react";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";
import LanguageChip from "@/components/atoms/LanguageChip/LanguageChip";
import MissingToolchainBanner from "@/components/molecules/banners/MissingToolchain/MissingToolchainBanner";
import { useToolchainStatus } from "@/hooks/useToolchainStatus";
import { languageForCheckId } from "./helpers";
import SettingsCard, { SettingsPage } from "./SettingsCard";
import SettingsRow from "./SettingsRow";
import { useT } from "@/i18n/i18n";

// ─── Diagnostics ──────────────────────────────────────────────────
//
// Probes the desktop app's bundled assets + user-data dirs and
// surfaces a Pass/Warn/Fail report grouped by category. Drives the
// "Settings → Diagnostics" pane.
//
// Backend: `run_diagnostics` Tauri command (see
// src-tauri/src/diagnostics.rs). All checks are read-only so it's
// safe to run repeatedly — UI offers a "Re-run" button that just
// re-invokes the command.
//
// Per-row install affordance: when a `fail` row's check id maps to
// a language (see `languageForCheckId`), the row gets an inline
// "Install" button that expands the full
// `MissingToolchainBanner` flow. Successful installs auto-rerun
// the probes so the row flips to `pass` without the learner
// hitting "Re-run" themselves.

interface CheckResult {
  id: string;
  category: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  remedy?: string | null;
}

interface DiagnosticsPanelProps {
  /// When set, skip the outer `SettingsPage` (title + description)
  /// wrapper and just render the status + per-category cards. Used
  /// when this panel is composed inside another pane's
  /// `SettingsPage` (e.g. the combined Data & storage pane); the
  /// parent provides the page-level title and we contribute only
  /// the inner sections.
  embedded?: boolean;
}

export default function DiagnosticsPanel({
  embedded,
}: DiagnosticsPanelProps = {}): React.ReactElement {
  const t = useT();
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /// Expanded-state for the inline install banner. Keyed by check id
  /// so multiple fail rows can each open their own banner without
  /// shadowing each other.
  const [expandedInstallId, setExpandedInstallId] = useState<string | null>(
    null,
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Lazy-import the Tauri invoke API so the web build (which
      // doesn't have Tauri) doesn't choke on a top-level import.
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<CheckResult[]>("run_diagnostics");
      setChecks(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  // Group results by category for the section headers.
  const byCategory = useMemo(() => {
    const m = new Map<string, CheckResult[]>();
    for (const c of checks ?? []) {
      const list = m.get(c.category) ?? [];
      list.push(c);
      m.set(c.category, list);
    }
    return m;
  }, [checks]);

  const failCount = (checks ?? []).filter((c) => c.status === "fail").length;
  const warnCount = (checks ?? []).filter((c) => c.status === "warn").length;

  const statusLabel = loading
    ? t("settings.runningChecks")
    : checks
      ? failCount > 0
        ? t(failCount === 1 ? "settings.checksFailing" : "settings.checksFailingPlural", {
            count: failCount,
          })
        : warnCount > 0
          ? t(warnCount === 1 ? "settings.warningsCount" : "settings.warningsCountPlural", {
              count: warnCount,
            })
          : t("settings.everythingGood")
      : "";

  const body = (
    <>
      <SettingsCard title={t("settings.toolchainStatus")}>
        <SettingsRow
          icon={rotateCcw}
          tone={
            failCount > 0
              ? "danger"
              : warnCount > 0
                ? "accent"
                : "default"
          }
          label={statusLabel}
          sub={
            error
              ? t("settings.resourceProbesFailed", { error })
              : undefined
          }
          control={
            <button
              className="libre-settings-secondary"
              onClick={() => void run()}
              disabled={loading}
            >
              {loading ? t("settings.rerunEllipsis") : t("settings.rerun")}
            </button>
          }
        />
      </SettingsCard>

      {checks &&
        Array.from(byCategory.entries()).map(([cat, items]) => (
          <SettingsCard key={cat} title={cat}>
            <ul className="libre-diagnostics-list" style={{ padding: 0 }}>
              {items.map((c) => {
                const lang = languageForCheckId(c.id);
                const canInstall = c.status !== "pass" && !!lang;
                const isExpanded = expandedInstallId === c.id;
                return (
                  <li
                    key={c.id}
                    className={`libre-diagnostics-item libre-diagnostics-item--${c.status}`}
                  >
                    <span
                      className={`libre-diagnostics-dot libre-diagnostics-dot--${c.status}`}
                      aria-hidden
                    />
                    <div className="libre-diagnostics-body">
                      <div className="libre-diagnostics-label">
                        {lang && (
                          <LanguageChip
                            language={lang}
                            size="xs"
                            iconOnly
                            className="libre-diagnostics-langchip"
                          />
                        )}
                        <span>{c.label}</span>
                      </div>
                      <div className="libre-diagnostics-detail">{c.detail}</div>
                      {c.remedy && c.status !== "pass" && (
                        <div className="libre-diagnostics-remedy">
                          → {c.remedy}
                        </div>
                      )}
                      {canInstall && lang && (
                        <div className="libre-diagnostics-install-row">
                          {!isExpanded ? (
                            <button
                              type="button"
                              className="libre-settings-secondary"
                              onClick={() => setExpandedInstallId(c.id)}
                            >
                              {t("settings.installLanguage", { language: capitalize(lang) })}
                            </button>
                          ) : (
                            <ToolchainInstallSlot
                              language={lang}
                              onInstalled={() => {
                                setExpandedInstallId(null);
                                void run();
                              }}
                              onDismiss={() => setExpandedInstallId(null)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </SettingsCard>
        ))}
    </>
  );

  if (embedded) return body;
  return (
    <SettingsPage
      title={t("settings.diagnosticsTitle")}
      description={t("settings.diagnosticsDescription")}
    >
      {body}
    </SettingsPage>
  );
}

/// Wraps `useToolchainStatus` + `MissingToolchainBanner` so the
/// Diagnostics row only pays the probe cost when the learner clicks
/// "Install". Without this wrapper the panel would fire one
/// `probe_language_toolchain` per fail-row at mount time even
/// though most users never click Install.
function ToolchainInstallSlot({
  language,
  onInstalled,
  onDismiss,
}: {
  language: string;
  onInstalled: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const t = useT();
  // cacheBust=0 is fine here; the slot mounts on click, probes once,
  // and the parent unmounts it on `onInstalled`.
  const { status, loading } = useToolchainStatus(language, 0);
  if (loading) {
    return (
      <div className="libre-diagnostics-install-loading">
        {t("settings.probingInstallHint", { language: capitalize(language) })}
      </div>
    );
  }
  if (!status || status.installed) {
    // Already installed (rare race: learner hit Install just as a
    // background install finished) or no install hint shipped — close
    // the slot and trigger a re-probe so the row updates anyway.
    return (
      <div className="libre-diagnostics-install-loading">
        {t("settings.noInstallRecipe", { language: capitalize(language) })}
      </div>
    );
  }
  return (
    <MissingToolchainBanner
      status={status}
      onInstalled={onInstalled}
      onDismiss={onDismiss}
    />
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
