import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@base/primitives/icon";
import { wrench } from "@base/primitives/icon/icons/wrench";
import "@base/primitives/icon/icon.css";
import type { ToolchainStatus } from "../../hooks/useToolchainStatus";
import "./MissingToolchainBanner.css";

interface InstallResult {
  success: boolean;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

interface Props {
  status: ToolchainStatus;
  /// Called after a successful install so the parent can re-probe the
  /// toolchain (bumping its cacheBust counter). Not called on failure —
  /// the banner stays visible so the user can retry.
  onInstalled: () => void;
  /// Optional dismiss handler. When present, a "Skip" button appears so
  /// the learner can hide the banner temporarily (state is owned by the
  /// parent — we just call this). Omitted in the Playground where the
  /// banner is informational-only; wired in lesson views where a user
  /// might want to dismiss and keep reading the prose.
  onDismiss?: () => void;
}

/// Prompt-to-install banner for a missing language toolchain. Shown
/// above the editor in the Playground (or on top of an exercise lesson
/// when the lesson's language isn't installed).
///
/// Visual hierarchy:
///   1. Title — "Kotlin isn't installed" (concrete, no jargon).
///   2. Description — plain English "why / what this will do".
///   3. Command — the exact shell string that will run (monospace, read-only).
///   4. Password field (only when `requires_password`).
///   5. Install button + error rollup.
export default function MissingToolchainBanner({
  status,
  onInstalled,
  onDismiss,
}: Props) {
  const [installing, setInstalling] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  // The parent should only render us when status.installed is false and
  // install_hint is populated. We guard defensively so a misconfigured
  // call-site doesn't blank the page.
  if (status.installed || !status.install_hint) {
    return null;
  }
  const hint = status.install_hint;
  const labelLang = capitalize(status.language);

  async function handleInstall() {
    if (hint.requires_password && !password.trim()) {
      setError("Password is required for this install.");
      return;
    }
    setInstalling(true);
    setError(null);
    setOutput(null);
    try {
      const result = await invoke<InstallResult>(
        "install_language_toolchain",
        {
          language: status.language,
          password: hint.requires_password ? password : null,
          // Pass the command we just displayed to the user. Probe-derived
          // hints (e.g. Kotlin's "needs a JDK" variant runs `brew install
          // openjdk` instead of the static `brew install kotlin`) need
          // the backend to run exactly what the banner promised — without
          // this, the backend falls back to the recipe's default and the
          // learner sees brew report "kotlin is already installed".
          command: hint.command,
        },
      );
      if (result.success) {
        // Keep the tail of stdout/stderr visible for a moment so the
        // learner sees "✓ installed" or the brew tap output before the
        // banner disappears.
        setOutput(tailOutput(result));
        // Clear password from memory as soon as we've used it.
        setPassword("");
        onInstalled();
      } else {
        setError(
          `Install exited with a non-zero status.\n\n${tailOutput(result)}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div
      className="fishbones-missing-tc"
      role="status"
      aria-live="polite"
    >
      <div className="fishbones-missing-tc-icon" aria-hidden>
        <Icon icon={wrench} size="sm" color="currentColor" weight="regular" />
      </div>
      <div className="fishbones-missing-tc-body">
        <div className="fishbones-missing-tc-title">
          {hint.title ?? `${labelLang} isn't installed`}
        </div>
        <div className="fishbones-missing-tc-desc">{hint.description}</div>

        <div className="fishbones-missing-tc-cmd" role="note" aria-label="Install command">
          <code>{hint.command}</code>
        </div>

        {hint.requires_password && !installing && (
          <div className="fishbones-missing-tc-pw-row">
            <label className="fishbones-missing-tc-pw-label">
              Admin password
              <input
                type="password"
                className="fishbones-missing-tc-pw-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={installing}
              />
            </label>
            <div className="fishbones-missing-tc-pw-hint">
              Stays on your machine — piped directly into <code>sudo</code> and
              never logged or persisted.
            </div>
          </div>
        )}

        {error && (
          <pre className="fishbones-missing-tc-error">{error}</pre>
        )}
        {output && !error && (
          <pre className="fishbones-missing-tc-output">{output}</pre>
        )}
      </div>

      <div className="fishbones-missing-tc-actions">
        <button
          type="button"
          className="fishbones-missing-tc-btn fishbones-missing-tc-btn--primary"
          onClick={handleInstall}
          disabled={
            installing || (hint.requires_password && !password.trim())
          }
          title={`Runs: ${hint.command}`}
        >
          {installing ? "Installing…" : (hint.button_label ?? `Install ${labelLang}`)}
        </button>
        {onDismiss && !installing && (
          <button
            type="button"
            className="fishbones-missing-tc-btn"
            onClick={onDismiss}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

/// Trim installer output to something readable in the banner. Brew
/// can emit thousands of lines during a cold install — we keep the
/// last ~40 lines of whichever stream had the most signal.
function tailOutput(r: InstallResult): string {
  const both = `${r.stdout}\n${r.stderr}`.trim();
  const lines = both.split("\n").filter(Boolean);
  const tail = lines.slice(-40).join("\n");
  return tail || "(no output)";
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
