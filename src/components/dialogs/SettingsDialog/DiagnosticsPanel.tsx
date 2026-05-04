import { useCallback, useEffect, useMemo, useState } from "react";
import LanguageChip from "../../LanguageChip/LanguageChip";
import MissingToolchainBanner from "../../banners/MissingToolchain/MissingToolchainBanner";
import { useToolchainStatus } from "../../../hooks/useToolchainStatus";
import { languageForCheckId } from "./helpers";

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

export default function DiagnosticsPanel(): React.ReactElement {
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

  return (
    <section>
      <h3 className="fishbones-settings-section">Resources</h3>
      <p className="fishbones-settings-blurb">
        Read-only probes for bundled assets and user data. If something on
        the app is missing or broken, the cause usually shows up here as a
        red row with a remedy hint. Send a screenshot of this pane when
        filing a bug.
      </p>

      <div className="fishbones-settings-data-row">
        <div>
          <div className="fishbones-settings-data-label">
            {loading
              ? "Running checks…"
              : checks
                ? failCount > 0
                  ? `${failCount} ${failCount === 1 ? "check" : "checks"} failing`
                  : warnCount > 0
                    ? `${warnCount} ${warnCount === 1 ? "warning" : "warnings"}`
                    : "Everything looks good"
                : ""}
          </div>
          {error && (
            <div className="fishbones-settings-data-hint">
              Resource probes failed to run: {error}
            </div>
          )}
        </div>
        <button
          className="fishbones-settings-secondary"
          onClick={() => void run()}
          disabled={loading}
        >
          {loading ? "…" : "Re-run"}
        </button>
      </div>

      {checks &&
        Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat} className="fishbones-diagnostics-group">
            <div className="fishbones-diagnostics-group-title">{cat}</div>
            <ul className="fishbones-diagnostics-list">
              {items.map((c) => {
                const lang = languageForCheckId(c.id);
                const canInstall = c.status !== "pass" && !!lang;
                const isExpanded = expandedInstallId === c.id;
                return (
                  <li
                    key={c.id}
                    className={`fishbones-diagnostics-item fishbones-diagnostics-item--${c.status}`}
                  >
                    <span
                      className={`fishbones-diagnostics-dot fishbones-diagnostics-dot--${c.status}`}
                      aria-hidden
                    />
                    <div className="fishbones-diagnostics-body">
                      <div className="fishbones-diagnostics-label">
                        {lang && (
                          <LanguageChip
                            language={lang}
                            size="xs"
                            iconOnly
                            className="fishbones-diagnostics-langchip"
                          />
                        )}
                        <span>{c.label}</span>
                      </div>
                      <div className="fishbones-diagnostics-detail">{c.detail}</div>
                      {c.remedy && c.status !== "pass" && (
                        <div className="fishbones-diagnostics-remedy">
                          → {c.remedy}
                        </div>
                      )}
                      {canInstall && lang && (
                        <div className="fishbones-diagnostics-install-row">
                          {!isExpanded ? (
                            <button
                              type="button"
                              className="fishbones-settings-secondary"
                              onClick={() => setExpandedInstallId(c.id)}
                            >
                              Install {capitalize(lang)}
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
          </div>
        ))}
    </section>
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
  // cacheBust=0 is fine here; the slot mounts on click, probes once,
  // and the parent unmounts it on `onInstalled`.
  const { status, loading } = useToolchainStatus(language, 0);
  if (loading) {
    return (
      <div className="fishbones-diagnostics-install-loading">
        Probing {capitalize(language)} install hint…
      </div>
    );
  }
  if (!status || status.installed) {
    // Already installed (rare race: learner hit Install just as a
    // background install finished) or no install hint shipped — close
    // the slot and trigger a re-probe so the row updates anyway.
    return (
      <div className="fishbones-diagnostics-install-loading">
        No install recipe shipped for {capitalize(language)}. Try the
        remedy hint above.
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
