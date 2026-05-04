import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import { applyTheme, loadTheme, type ThemeName } from "../../../theme/themes";
import type { UseFishbonesCloud } from "../../../hooks/useFishbonesCloud";
import ModalBackdrop from "../../Shared/ModalBackdrop";
import AccountSection from "./AccountSection";
import AiPane from "./AiPane";
import DiagnosticsPanel from "./DiagnosticsPanel";
import GeneralPane from "./GeneralPane";
import ThemePane from "./ThemePane";
import "./SettingsDialog.css";

interface Props {
  onDismiss: () => void;
  /// Cloud-sync hook instance (shared with App.tsx). Used to render
  /// the Account section. Required — SettingsDialog is only ever
  /// rendered inside App where `cloud` is in scope, so we don't
  /// bother making it optional.
  cloud: UseFishbonesCloud;
  /// Open the sign-in modal. Wired from App.tsx so the Account
  /// section can offer a "Sign in" CTA to signed-out users without
  /// each section having to know about the modal-state plumbing.
  ///
  /// Optional: omitted on the web build, where OAuth has no path
  /// (Tauri-only). When undefined we hide the Account section's
  /// sign-in CTA entirely.
  onRequestSignIn?: () => void;
}

interface Settings {
  anthropic_api_key: string | null;
  anthropic_model: string;
  openai_api_key: string | null;
}

type SectionId =
  | "general"
  | "ai"
  | "theme"
  | "data"
  | "diagnostics"
  | "account";

interface SectionDef {
  id: SectionId;
  label: string;
  hint: string;
}

const BASE_SECTIONS: SectionDef[] = [
  { id: "general", label: "General", hint: "Version + updates" },
  { id: "ai", label: "AI & API", hint: "Anthropic key + model" },
  { id: "theme", label: "Theme", hint: "App + editor colors" },
  { id: "data", label: "Data", hint: "Caches + courses" },
  { id: "diagnostics", label: "Resources", hint: "What's installed + what's not" },
];

const ACCOUNT_SECTION: SectionDef = {
  id: "account",
  label: "Account",
  hint: "Cloud sync · sign out",
};

/// Two-column settings dialog with a left-rail section nav and a right-side
/// scrollable pane. Keeps the panel at a bounded max-height so additional
/// sections never push the Save button off the screen.
export default function SettingsDialog({ onDismiss, cloud, onRequestSignIn }: Props) {
  const [section, setSection] = useState<SectionId>("general");
  const [apiKey, setApiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [model, setModel] = useState<string>("claude-sonnet-4-5");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearingCourses, setClearingCourses] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [confirmClearCourses, setConfirmClearCourses] = useState(false);
  const [syncingCourses, setSyncingCourses] = useState(false);
  /// Last-sync result message. Held for ~4s after a manual sync so the
  /// learner can see the outcome ("1 new course added" / "Already up
  /// to date") before the row reverts to the idle state.
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
  // Account-section state. `confirmDeleteAccount` follows the same
  // click-to-confirm pattern as `confirmClearCourses` above so the
  // destructive-action UX is consistent across the dialog.
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Account is always in the rail — when signed out the section
  // shows a sign-in CTA so the entry point is discoverable before
  // the learner has an account. The `hint` swaps out depending on
  // sign-in state to give the rail a useful summary either way.
  //
  // Web build: drop the rail entry entirely. There's nothing to do
  // in the Account section without a sign-in path, and showing an
  // empty pane is worse than not advertising it.
  const accountAvailable = !!onRequestSignIn || cloud.signedIn;
  const sections = useMemo<SectionDef[]>(
    () => [
      ...BASE_SECTIONS,
      ...(accountAvailable
        ? [
            cloud.signedIn
              ? ACCOUNT_SECTION
              : { ...ACCOUNT_SECTION, hint: "Sign in to sync progress" },
          ]
        : []),
    ],
    [cloud.signedIn, accountAvailable],
  );

  // If the active section disappears (e.g. user signs out while the
  // dialog is open), fall back to General so we don't render a
  // dangling section pointer with no nav entry.
  useEffect(() => {
    if (!sections.find((s) => s.id === section)) {
      setSection("general");
    }
  }, [sections, section]);

  function handleThemeChange(next: ThemeName) {
    setTheme(next);
    applyTheme(next);
  }

  useEffect(() => {
    invoke<Settings>("load_settings")
      .then((s) => {
        setApiKey(s.anthropic_api_key ?? "");
        setOpenaiKey(s.openai_api_key ?? "");
        if (s.anthropic_model) setModel(s.anthropic_model);
      })
      .catch(() => { /* not in tauri — ignore */ });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await invoke("save_settings", {
        settings: {
          anthropic_api_key: apiKey.trim() || null,
          anthropic_model: model,
          openai_api_key: openaiKey.trim() || null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function clearAllCourses() {
    setClearingCourses(true);
    setError(null);
    try {
      const entries = await invoke<Array<{ id: string }>>("list_courses");
      for (const e of entries) {
        await invoke("delete_course", { courseId: e.id });
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setClearingCourses(false);
    }
  }

  async function clearIngestCache() {
    setClearingCache(true);
    setError(null);
    try {
      await invoke("cache_clear", { bookId: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingCache(false);
    }
  }

  /// Sync newly-bundled course packs into the local install.
  ///
  /// Calls the Rust `refresh_bundled_courses` command which re-runs the
  /// seed routine in force-refresh mode: any NEW pack that landed in
  /// the binary's bundled-packs/ since the last sync gets seeded, and
  /// any EXISTING pack the user still has installed gets re-extracted
  /// so lesson / drill / cover updates land. User-deleted packs stay
  /// deleted (we respect their choice).
  ///
  /// On success we full-reload the window so `useCourses` picks up the
  /// fresh course folders without us having to plumb a refresh callback
  /// through props. Same pattern as `clearAllCourses` above.
  async function syncCourses() {
    setSyncingCourses(true);
    setSyncResult(null);
    setError(null);
    try {
      const report = await invoke<{
        new: number;
        refreshed: number;
        skipped_deleted: number;
      }>("refresh_bundled_courses");
      const parts: string[] = [];
      if (report.new > 0) {
        parts.push(`${report.new} new course${report.new === 1 ? "" : "s"}`);
      }
      if (report.refreshed > 0) {
        parts.push(`${report.refreshed} refreshed`);
      }
      const message =
        parts.length > 0 ? `Synced — ${parts.join(", ")}.` : "Already up to date.";
      setSyncResult(message);
      // If we actually changed something on disk, reload the window so
      // the course list re-fetches. Up-to-date case skips the reload to
      // avoid flickering the whole UI for a no-op.
      if (report.new > 0 || report.refreshed > 0) {
        // Brief delay so the user reads the success message before the
        // window blanks for the reload.
        setTimeout(() => window.location.reload(), 700);
      } else {
        // Clear the "already up to date" message after a few seconds.
        setTimeout(() => setSyncResult(null), 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingCourses(false);
    }
  }

  return (
    <ModalBackdrop onDismiss={onDismiss}>
      <div className="fishbones-settings-panel">
        <div className="fishbones-settings-header">
          <span className="fishbones-settings-title">Settings</span>
          <button className="fishbones-settings-close" onClick={onDismiss}>×</button>
        </div>

        <div className="fishbones-settings-columns">
          <nav className="fishbones-settings-nav" aria-label="Settings sections">
            {sections.map((s) => (
              <button
                key={s.id}
                className={`fishbones-settings-nav-item ${
                  section === s.id ? "fishbones-settings-nav-item--active" : ""
                }`}
                onClick={() => setSection(s.id)}
              >
                <span className="fishbones-settings-nav-label">{s.label}</span>
                <span className="fishbones-settings-nav-hint">{s.hint}</span>
              </button>
            ))}
          </nav>

          <div className="fishbones-settings-body">
            {section === "general" && <GeneralPane />}

            {section === "ai" && (
              <AiPane
                apiKey={apiKey}
                onApiKeyChange={setApiKey}
                openaiKey={openaiKey}
                onOpenaiKeyChange={setOpenaiKey}
                model={model}
                onModelChange={setModel}
              />
            )}

            {section === "theme" && (
              <ThemePane theme={theme} onThemeChange={handleThemeChange} />
            )}

            {section === "data" && (
              <section>
                <h3 className="fishbones-settings-section">Data</h3>
                <p className="fishbones-settings-blurb">
                  Pull in new bundled books, clear caches, or wipe local content.
                  Your API key and preferences stay.
                </p>
                <div className="fishbones-settings-data-row">
                  <div>
                    <div className="fishbones-settings-data-label">Sync latest courses</div>
                    <div className="fishbones-settings-data-hint">
                      Pulls newly-bundled books into your library and refreshes any
                      existing courses with the latest lessons + drills. Deleted
                      packs stay deleted.
                      {syncResult && (
                        <span className="fishbones-settings-data-success">
                          {" · "}
                          {syncResult}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="fishbones-settings-secondary"
                    onClick={syncCourses}
                    disabled={syncingCourses}
                  >
                    {syncingCourses ? "Syncing…" : "Sync now"}
                  </button>
                </div>
                <div className="fishbones-settings-data-row">
                  <div>
                    <div className="fishbones-settings-data-label">Ingest cache</div>
                    <div className="fishbones-settings-data-hint">
                      Clearing forces the next AI import to re-call Claude for every stage.
                    </div>
                  </div>
                  <button
                    className="fishbones-settings-danger"
                    onClick={clearIngestCache}
                    disabled={clearingCache}
                  >
                    {clearingCache ? "…" : "Clear cache"}
                  </button>
                </div>
                <div className="fishbones-settings-data-row">
                  <div>
                    <div className="fishbones-settings-data-label">All courses + progress</div>
                    <div className="fishbones-settings-data-hint">
                      Deletes every course from disk and resets lesson completion. Cannot be undone.
                    </div>
                  </div>
                  {confirmClearCourses ? (
                    <div className="fishbones-settings-confirm">
                      <button
                        className="fishbones-settings-secondary"
                        onClick={() => setConfirmClearCourses(false)}
                        disabled={clearingCourses}
                      >
                        Cancel
                      </button>
                      <button
                        className="fishbones-settings-danger"
                        onClick={clearAllCourses}
                        disabled={clearingCourses}
                      >
                        {clearingCourses ? "Clearing…" : "Really clear"}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="fishbones-settings-danger"
                      onClick={() => setConfirmClearCourses(true)}
                    >
                      Clear all courses
                    </button>
                  )}
                </div>
              </section>
            )}

            {section === "diagnostics" && <DiagnosticsPanel />}

            {section === "account" &&
              onRequestSignIn &&
              !(cloud.signedIn && typeof cloud.user === "object" && cloud.user) && (
                <section>
                  <h3 className="fishbones-settings-section">Account</h3>
                  <p className="fishbones-settings-blurb">
                    Sign in to sync progress, streaks, and lesson history
                    between devices, upload your imported books, and share
                    courses with friends. Fishbones works fully offline
                    without an account — signing in is purely additive.
                  </p>
                  <button
                    type="button"
                    className="fishbones-settings-primary"
                    onClick={() => {
                      onRequestSignIn();
                      onDismiss();
                    }}
                  >
                    Sign in
                  </button>
                </section>
              )}

            {section === "account" && cloud.signedIn && typeof cloud.user === "object" && cloud.user && (
              <AccountSection
                user={cloud.user}
                signingOut={signingOut}
                deletingAccount={deletingAccount}
                confirmDeleteAccount={confirmDeleteAccount}
                onSignOut={async () => {
                  setSigningOut(true);
                  setError(null);
                  try {
                    await cloud.signOut();
                    // Close the dialog so the user doesn't sit on an
                    // Account section that no longer applies. Defer one
                    // tick so React unmounts cleanly.
                    onDismiss();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSigningOut(false);
                  }
                }}
                onRequestDeleteConfirm={() => setConfirmDeleteAccount(true)}
                onCancelDelete={() => setConfirmDeleteAccount(false)}
                onConfirmDelete={async () => {
                  setDeletingAccount(true);
                  setError(null);
                  try {
                    await cloud.deleteAccount();
                    onDismiss();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    setConfirmDeleteAccount(false);
                  } finally {
                    setDeletingAccount(false);
                  }
                }}
              />
            )}

            {error && <div className="fishbones-settings-error">{error}</div>}
          </div>
        </div>

        {/* Footer sits outside the scroll body so the Save button is always
            visible regardless of section length. Only the AI section has a
            committable field; on other sections the Save button is hidden
            to avoid implying unsaved state. */}
        <div className="fishbones-settings-footer">
          {saved && (
            <span className="fishbones-settings-saved">
              <Icon icon={checkIcon} size="xs" color="currentColor" />
              saved
            </span>
          )}
          {section === "ai" && (
            <button
              className="fishbones-settings-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {section !== "ai" && (
            <span className="fishbones-settings-footer-hint">
              Changes on this tab apply immediately.
            </span>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
