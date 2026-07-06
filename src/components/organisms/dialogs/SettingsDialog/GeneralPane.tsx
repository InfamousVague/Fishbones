import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { rocket } from "@base/primitives/icon/icons/rocket";
import { arrowDownToLine } from "@base/primitives/icon/icons/arrow-down-to-line";
import { info } from "@base/primitives/icon/icons/info";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import "@base/primitives/icon/icon.css";
import SettingsCard, { SettingsPage } from "./SettingsCard";
import SettingsRow from "./SettingsRow";
import SettingsToggle from "./SettingsToggle";
import LanguageSelect from "./LanguageSelect";
import DownloadLocalesSelect from "./DownloadLocalesSelect";
import { useT } from "@/i18n/i18n";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { track } from "@/lib/track";
import {
  AUTO_ADVANCE_DEFAULT,
  AUTO_ADVANCE_STORAGE_KEY,
  setAutoAdvanceEnabled,
} from "@/lib/autoAdvance";

/// "General" section of the Settings dialog. Hosts the Updates
/// sub-panel: current version, manual check-for-updates, and the
/// release-notes body when one is available. Mirrors the lifecycle
/// of `UpdateBanner` but lives in a discoverable place — the
/// floating banner is great for "you have an update" pings, less
/// great for "what version am I running" answers.
///
/// We import the updater plugin lazily so the web build (where the
/// plugin import would fail) never reaches this code path, and so
/// the dialog opens immediately even when the updater is slow.

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate"; checkedAt: number }
  | { kind: "available"; version: string; notes: string }
  // We no longer download in-app. Clicking install relaunches straight
  // into the pre-launch updater (usePrelaunchUpdate / the macOS splash),
  // which is the SINGLE owner of the download + install on next boot.
  // `restarting` is just the brief "app is relaunching" state before the
  // process exits.
  | { kind: "restarting" }
  | { kind: "error"; message: string };

function isTauri(): boolean {
  return (
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

interface Props {
  /// When set, fires `checkForUpdates()` exactly once on mount. Used by
  /// the floating `UpdateBanner` to redirect "install" clicks through
  /// Settings — the banner asks App.tsx to open this dialog with the
  /// flag on, and we kick the check immediately so the learner lands
  /// on a "checking… → available → install" surface without an extra
  /// button press. The auto-fire is intentionally gated on a ref so a
  /// parent re-render that flips the prop back to undefined doesn't
  /// cancel the in-flight check.
  autoCheckUpdates?: boolean;
}

export default function GeneralPane({ autoCheckUpdates }: Props = {}) {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  /// Ref guard so the auto-check fires exactly once per mount even
  /// if React strict-mode double-invokes the effect or the parent
  /// re-renders before the check completes.
  const autoCheckFiredRef = useRef(false);

  // Read the current app version off the Tauri runtime. `getVersion`
  // returns whatever's in `tauri.conf.json` so this is the source of
  // truth — `package.json`'s version drifts (it stays at 0.1.0
  // because it's not the published artifact). Web builds skip this.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        /* keep null — UI handles the "unknown" case */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      setState({ kind: "error", message: t("settings.updatesDesktopOnly") });
      return;
    }
    setState({ kind: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      track.update("check");
      const update = await check();
      if (!update) {
        setState({ kind: "uptodate", checkedAt: Date.now() });
        return;
      }
      track.update("available");
      setState({
        kind: "available",
        version: update.version,
        notes: update.body ?? "",
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [t]);

  /// Auto-fire `checkForUpdates()` once when the host opens this
  /// pane with `autoCheckUpdates`. The ref guard ensures we don't
  /// re-check if the prop stays true across re-renders, and the
  /// `state.kind === "idle"` precondition skips the auto-fire when
  /// the user has already kicked a check by hand. Mirrors the
  /// `UpdateBanner` flow: toast click → host opens this dialog
  /// with the flag → we synthesise the click.
  useEffect(() => {
    if (!autoCheckUpdates) return;
    if (autoCheckFiredRef.current) return;
    if (state.kind !== "idle") return;
    autoCheckFiredRef.current = true;
    void checkForUpdates();
  }, [autoCheckUpdates, state.kind, checkForUpdates]);

  /// Install action. Deliberately does NOT download here — it relaunches
  /// straight into the app's pre-launch update process (usePrelaunchUpdate
  /// / the macOS splash window), which checks, downloads, installs, and
  /// relaunches into the new version on the next boot.
  ///
  /// Why: downloading in-app here AND again in the pre-launch updater was
  /// the double-download bug — the in-app install didn't always apply
  /// before the reopened app re-checked (the macOS bundle-swap race), so
  /// the boot updater re-downloaded the same bytes. Funnelling every
  /// "install" through the single pre-launch download path removes the
  /// duplication entirely and makes the flow: click → app relaunches →
  /// splash downloads once → new version.
  const rebootIntoUpdate = useCallback(async () => {
    if (!isTauri()) return;
    track.update("install");
    setState({ kind: "restarting" });
    try {
      // macOS-safe relaunch (see relaunch_for_update in lib.rs): fully
      // exits and reopens the bundle, so the reopened app runs its
      // pre-launch update check + single download. Falls back to the
      // plugin relaunch on a dev binary / non-macOS.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("relaunch_for_update");
    } catch {
      try {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }, []);

  // Learner-pace preference. Off by default — the surprise factor
  // of being teleported to the next lesson is small but real, and
  // we want learners who don't know about the toggle to keep the
  // existing "sit on the pass screen until I click Next" flow.
  // Lives on the same key the imperative reader in `lib/autoAdvance
  // .ts` watches; both surfaces stay in sync via the underlying
  // localStorage write.
  const [autoAdvance, setAutoAdvanceState] = useLocalStorageState<boolean>(
    AUTO_ADVANCE_STORAGE_KEY,
    AUTO_ADVANCE_DEFAULT,
    // Match the lib module's `"1"` / `"0"` encoding so the two
    // readers see the same value byte-for-byte. Without this the
    // hook's default JSON serialisation would write `true` / `false`
    // and the imperative reader's `=== "1"` check would always be
    // false.
    {
      serialize: (v) => (v ? "1" : "0"),
      deserialize: (raw) => raw === "1",
    },
  );

  return (
    <SettingsPage
      title={t("settings.general")}
      description={t("settings.generalDescription")}
    >
      <SettingsCard title={t("settings.updatesCard")}>
        <SettingsRow
          icon={info}
          label={t("settings.appVersionLabel")}
          sub={
            version ? (
              <>
                {t("settings.appVersionRunning")} <strong>v{version}</strong>
                {state.kind === "uptodate" && ` · ${t("settings.appVersionUpToDate")}`}
              </>
            ) : (
              <>{t("settings.appVersionReading")}</>
            )
          }
          control={
            <button
              className="libre-settings-secondary"
              onClick={checkForUpdates}
              disabled={
                state.kind === "checking" || state.kind === "restarting"
              }
            >
              {state.kind === "checking" ? t("settings.checkingUpdates") : t("settings.checkForUpdates")}
            </button>
          }
        />
      </SettingsCard>

      {state.kind === "available" && (
        <div className="libre-settings-update">
          <div className="libre-settings-update-head">
            <Icon icon={rocket} size="sm" color="currentColor" />
            <div>
              <div className="libre-settings-update-title">
                {t("settings.updateAvailableTitle", { version: state.version })}
              </div>
              <div className="libre-settings-update-sub">
                {t("settings.updateAvailableSub")}
              </div>
            </div>
            <button
              className="libre-settings-primary"
              onClick={rebootIntoUpdate}
            >
              <Icon icon={arrowDownToLine} size="xs" color="currentColor" />
              {t("settings.downloadInstall")}
            </button>
          </div>
          {state.notes.trim().length > 0 && (
            <div className="libre-settings-update-notes">
              <div className="libre-settings-update-notes-label">
                {t("settings.whatsNew")}
              </div>
              <pre className="libre-settings-update-notes-body">
                {state.notes}
              </pre>
            </div>
          )}
        </div>
      )}

      {state.kind === "restarting" && (
        <div className="libre-settings-update">
          <div className="libre-settings-update-head">
            <Icon icon={arrowDownToLine} size="sm" color="currentColor" />
            <div>
              <div className="libre-settings-update-title">
                {t("settings.updateRestartingTitle")}
              </div>
              <div className="libre-settings-update-sub">
                {t("settings.updateRestartingSub")}
              </div>
            </div>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="libre-settings-error">
          {t("settings.updateError", { message: state.message })}
        </div>
      )}

      {/* Language — a single setting that drives BOTH the i18n runtime
          (every UI string in the chrome) and the lesson-content overlay
          (Libre-authored courses re-render in the picked locale). Lives
          here in General (rather than Appearance) so it sits alongside
          the app's other top-level preferences. The searchable +
          scrollable picker copes with the 17 registered locales without
          running off-screen. */}
      <SettingsCard title={t("settings.languageCard")}>
        <div className="libre-settings-row libre-settings-row--no-icon">
          <div className="libre-settings-row__body">
            <span className="libre-settings-row__label">
              {t("settings.language")}
            </span>
            <span className="libre-settings-row__sub">
              {t("settings.languageDescription")}
            </span>
          </div>
        </div>
        <LanguageSelect />
      </SettingsCard>

      <SettingsCard title={t("settings.downloadLanguagesCard")}>
        <div className="libre-settings-row libre-settings-row--no-icon">
          <div className="libre-settings-row__body">
            <span className="libre-settings-row__label">
              {t("settings.downloadLanguages")}
            </span>
            <span className="libre-settings-row__sub">
              {t("settings.downloadLanguagesDescription")}
            </span>
          </div>
        </div>
        <DownloadLocalesSelect />
      </SettingsCard>

      <SettingsCard title={t("settings.learningCard")}>
        <SettingsRow
          icon={arrowRight}
          tone={autoAdvance ? "accent" : "default"}
          label={t("settings.autoAdvanceLabel")}
          sub={t("settings.autoAdvanceSub")}
          control={
            <SettingsToggle
              checked={autoAdvance}
              onChange={(next) => {
                // Two writes: the React-state setter (so the
                // toggle re-renders immediately) AND the
                // imperative module setter (which the completion
                // path reads from). Both target the same
                // localStorage key, so a later page reload would
                // pick up either write — the duplication exists
                // only to make this surface's onChange handler
                // self-contained without having to wait on the
                // useEffect-based persistence.
                setAutoAdvanceState(next);
                setAutoAdvanceEnabled(next);
                track.settingChange({ key: "autoAdvance", value: next });
              }}
              label={t("settings.autoAdvanceLabel")}
            />
          }
        />
      </SettingsCard>

    </SettingsPage>
  );
}
