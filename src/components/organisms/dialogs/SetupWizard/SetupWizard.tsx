/// First-launch dependency-setup wizard.
///
/// Walks the user through getting Libre's local AI tutor working on
/// their machine — Homebrew + Ollama on macOS / Linux. Both are
/// optional (Libre runs fine without either; the cloud AI key path
/// in Settings → AI is the alternative), so the wizard is dismissable
/// and persists a "don't ask again" flag.
///
/// Flow:
///   1. On open, probe `ai_chat_install_status` for which deps are
///      present.
///   2. Render a two-row checklist (Homebrew, then Ollama). Each row
///      shows ✓ when installed; otherwise an install button.
///   3. Homebrew: button opens brew.sh in the OS browser (we can't
///      pipe-curl from inside the app — the official installer needs
///      a real interactive shell).
///   4. Ollama: button calls `ai_chat_install_ollama` which shells
///      out to `brew install ollama` and streams stdout/stderr back.
///      Disabled until Homebrew is present.
///
/// Gating:
///   - Web build → skip entirely (no Tauri commands available).
///   - `libre:setup-dismissed-v1 === "permanent"` → never reopen.
///   - Defers opening until FirstLaunchPrompt has resolved (signed-in
///     OR `libre:cloud:dismissed-v1` is set), so the two first-launch
///     modals don't stack.
///   - If BOTH deps are already installed, doesn't open (nothing to
///     do).

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { externalLink } from "@base/primitives/icon/icons/external-link";
import "@base/primitives/icon/icon.css";

import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { isDesktop } from "@/lib/platform";
import type { UseLibreCloud } from "@/hooks/useLibreCloud";
import { useT } from "@/i18n/i18n";
import "./SetupWizard.css";

const DISMISS_KEY = "libre:setup-dismissed-v1";
const CLOUD_DISMISS_KEY = "libre:cloud:dismissed-v1";

interface InstallStatus {
  ollama_installed: boolean;
  homebrew_installed: boolean;
}

interface InstallResult {
  success: boolean;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

function readDismissed(): "permanent" | "session" | null {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    return v === "permanent" || v === "session" ? v : null;
  } catch {
    return null;
  }
}

function writeDismissed(v: "permanent" | "session"): void {
  try {
    localStorage.setItem(DISMISS_KEY, v);
  } catch {
    /* private mode / quota — wizard just reopens next launch */
  }
}

interface Props {
  /// Cloud hook handle. Used to wait for sign-in resolution before
  /// opening so the wizard doesn't fight FirstLaunchPrompt for the
  /// screen on a brand-new launch.
  cloud: UseLibreCloud;
}

export default function SetupWizard({ cloud }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [installing, setInstalling] = useState<
    "homebrew" | "ollama" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Open gate. We skip entirely on web (no Tauri commands) and on
  // permanent dismissal. Otherwise wait until FirstLaunchPrompt has
  // resolved one way or another:
  //   - cloud.user === null  → still booting, hold off
  //   - cloud.signedIn       → sign-in succeeded, FirstLaunchPrompt
  //                            already auto-dismissed
  //   - cloud.user === false → signed out; check the cloud-dismiss
  //                            flag — if absent, FirstLaunchPrompt is
  //                            still up and we should wait
  useEffect(() => {
    if (!isDesktop) return;
    if (readDismissed() === "permanent") return;
    if (cloud.user === null) return;
    if (cloud.user === false) {
      let cloudDismissed: string | null = null;
      try {
        cloudDismissed = localStorage.getItem(CLOUD_DISMISS_KEY);
      } catch {
        /* assume not dismissed */
      }
      if (!cloudDismissed) {
        // FirstLaunchPrompt is queued — re-evaluate when localStorage
        // changes. The `storage` event fires across same-origin tabs;
        // FirstLaunchPrompt mutates DISMISS_KEY directly, which doesn't
        // fire `storage` in the same tab — so we also poll at 1Hz as a
        // belt-and-braces fallback.
        const id = window.setInterval(() => {
          let next: string | null = null;
          try {
            next = localStorage.getItem(CLOUD_DISMISS_KEY);
          } catch {
            /* still inaccessible */
          }
          if (next) {
            window.clearInterval(id);
            // Re-run this effect's gating by toggling a state. We
            // simply call setOpen on the open path here — both the
            // probe and the open happen below.
            probeAndMaybeOpen();
          }
        }, 1000);
        return () => window.clearInterval(id);
      }
    }
    probeAndMaybeOpen();

    async function probeAndMaybeOpen() {
      try {
        const s = await invoke<InstallStatus>("ai_chat_install_status");
        setStatus(s);
        if (s.homebrew_installed && s.ollama_installed) {
          // Nothing to do — silently no-op and record a permanent
          // dismiss so we don't keep probing every launch.
          writeDismissed("permanent");
          return;
        }
        // Tiny delay so the wizard arrives just after the bootloader
        // fades + FirstLaunchPrompt is fully gone.
        window.setTimeout(() => setOpen(true), 600);
      } catch (e) {
        // Probe failed — likely an older binary without the command.
        // Silently skip; the wizard reopens on the next launch.
        console.warn("[setup-wizard] probe failed:", e);
      }
    }
  }, [cloud.user, cloud.signedIn]);

  if (!open || !status) return null;

  /// Re-probe after an install finishes so the row flips to "✓
  /// installed" without a restart. Called by both the ollama install
  /// path (which can confirm) and a manual "re-check" affordance for
  /// the Homebrew row (since we can't drive the brew.sh installer
  /// from inside the app).
  async function reprobe() {
    try {
      const s = await invoke<InstallStatus>("ai_chat_install_status");
      setStatus(s);
    } catch {
      /* leave the status as-is */
    }
  }

  async function openBrewInBrowser() {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://brew.sh");
    } catch {
      // Fallback if the opener plugin isn't loaded — open in the
      // current webview. On Tauri this navigates away from the app,
      // which is rough; better than nothing if openUrl fails.
      window.open("https://brew.sh", "_blank", "noopener,noreferrer");
    }
  }

  async function handleInstallOllama() {
    setInstalling("ollama");
    setError(null);
    setOutput(null);
    try {
      const result = await invoke<InstallResult>("ai_chat_install_ollama");
      if (result.success) {
        setOutput(tailOutput(result));
        await reprobe();
        // Also try to start the daemon so the user is fully ready to
        // chat once the wizard closes. Failure here is non-fatal —
        // they can start it manually later.
        try {
          await invoke<InstallResult>("ai_chat_start_ollama");
        } catch {
          /* daemon start failed; user can start manually */
        }
      } else {
        setError(tailOutput(result));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
    }
  }

  function handleDismiss() {
    writeDismissed(dontShowAgain ? "permanent" : "session");
    setOpen(false);
  }

  const brewOk = status.homebrew_installed;
  const ollamaOk = status.ollama_installed;
  const allDone = brewOk && ollamaOk;

  return (
    <ModalBackdrop onDismiss={handleDismiss} zIndex={200}>
      <div
        className="libre-setup-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-setup-wizard-title"
      >
        <button
          type="button"
          className="libre-setup-wizard__close"
          onClick={handleDismiss}
          aria-label={t("setup.close")}
        >
          ×
        </button>

        <h2 id="libre-setup-wizard-title" className="libre-setup-wizard__title">
          {t("setup.title")}
        </h2>
        <p className="libre-setup-wizard__blurb">{t("setup.blurb")}</p>

        <ol className="libre-setup-wizard__steps">
          <Step
            number={1}
            done={brewOk}
            installing={installing === "homebrew"}
            title={t("setup.brewTitle")}
            description={
              brewOk ? t("setup.brewDescriptionDone") : t("setup.brewDescription")
            }
            primaryAction={
              brewOk
                ? null
                : {
                    label: t("setup.brewInstallButton"),
                    onClick: openBrewInBrowser,
                    icon: externalLink,
                  }
            }
            secondaryAction={
              brewOk
                ? null
                : { label: t("setup.brewRecheck"), onClick: reprobe }
            }
          />
          <Step
            number={2}
            done={ollamaOk}
            installing={installing === "ollama"}
            disabled={!brewOk && !ollamaOk}
            title={t("setup.ollamaTitle")}
            description={
              ollamaOk
                ? t("setup.ollamaDescriptionDone")
                : !brewOk
                  ? t("setup.ollamaDescriptionNeedsBrew")
                  : t("setup.ollamaDescription")
            }
            primaryAction={
              ollamaOk
                ? null
                : {
                    label: installing === "ollama"
                      ? t("setup.installing")
                      : t("setup.ollamaInstallButton"),
                    onClick: handleInstallOllama,
                  }
            }
          />
        </ol>

        {error && <pre className="libre-setup-wizard__error">{error}</pre>}
        {output && !error && (
          <pre className="libre-setup-wizard__output">{output}</pre>
        )}

        <div className="libre-setup-wizard__footer">
          <label className="libre-setup-wizard__dontshow">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>{t("setup.dontShowAgain")}</span>
          </label>
          <button
            type="button"
            className="libre-setup-wizard__primary"
            onClick={handleDismiss}
            disabled={installing !== null}
          >
            {allDone ? t("setup.done") : t("setup.later")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

interface StepProps {
  number: number;
  done: boolean;
  installing?: boolean;
  /// Greyed-out variant — used for downstream steps that can't run
  /// until earlier ones complete (e.g. Ollama needs Homebrew first).
  disabled?: boolean;
  title: string;
  description: string;
  primaryAction:
    | { label: string; onClick: () => void; icon?: string }
    | null;
  secondaryAction?: { label: string; onClick: () => void } | null;
}

function Step({
  number,
  done,
  installing,
  disabled,
  title,
  description,
  primaryAction,
  secondaryAction,
}: StepProps) {
  return (
    <li
      className={[
        "libre-setup-step",
        done ? "libre-setup-step--done" : "",
        disabled ? "libre-setup-step--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="libre-setup-step__bullet" aria-hidden>
        {done ? (
          <Icon icon={checkIcon} size="sm" color="currentColor" />
        ) : (
          <span className="libre-setup-step__num">{number}</span>
        )}
      </span>
      <div className="libre-setup-step__body">
        <div className="libre-setup-step__title">{title}</div>
        <div className="libre-setup-step__desc">{description}</div>
        {(primaryAction || secondaryAction) && (
          <div className="libre-setup-step__actions">
            {primaryAction && (
              <button
                type="button"
                className="libre-setup-step__btn libre-setup-step__btn--primary"
                onClick={primaryAction.onClick}
                disabled={disabled || installing}
              >
                {primaryAction.icon && (
                  <Icon
                    icon={primaryAction.icon}
                    size="sm"
                    color="currentColor"
                  />
                )}
                <span>{primaryAction.label}</span>
              </button>
            )}
            {secondaryAction && (
              <button
                type="button"
                className="libre-setup-step__btn"
                onClick={secondaryAction.onClick}
                disabled={disabled || installing}
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/// Trim installer output to the last ~30 lines. `brew install` can
/// emit hundreds of lines for a cold install (dependency cascade,
/// font cache rebuild, etc.); the tail is what tells us whether the
/// final step succeeded.
function tailOutput(r: InstallResult): string {
  const both = `${r.stdout}\n${r.stderr}`.trim();
  const lines = both.split("\n").filter(Boolean);
  return lines.slice(-30).join("\n") || "(no output)";
}
