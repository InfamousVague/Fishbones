import { useCallback, useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { rocket } from "@base/primitives/icon/icons/rocket";
import { arrowDownToLine } from "@base/primitives/icon/icons/arrow-down-to-line";
import "@base/primitives/icon/icon.css";

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
  | { kind: "downloading"; progress: number; total: number | null }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function isTauri(): boolean {
  return (
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

export default function GeneralPane() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

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
      setState({ kind: "error", message: "Updates are only checked from the desktop build." });
      return;
    }
    setState({ kind: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setState({ kind: "uptodate", checkedAt: Date.now() });
        return;
      }
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
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauri()) return;
    setState({ kind: "downloading", progress: 0, total: null });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setState({ kind: "uptodate", checkedAt: Date.now() });
        return;
      }
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            setState({ kind: "downloading", progress: 0, total });
            break;
          case "Progress":
            downloaded += event.data.chunkLength ?? 0;
            setState({ kind: "downloading", progress: downloaded, total });
            break;
          case "Finished":
            setState({ kind: "ready" });
            break;
        }
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  return (
    <section>
      <h3 className="fishbones-settings-section">General</h3>
      <p className="fishbones-settings-blurb">
        About this build, and where to grab the next one.
      </p>

      {/* ── Updates sub-panel ─────────────────────────────────── */}
      <div className="fishbones-settings-data-row">
        <div>
          <div className="fishbones-settings-data-label">App version</div>
          <div className="fishbones-settings-data-hint">
            {version ? (
              <>
                You're running <strong>v{version}</strong>.
              </>
            ) : (
              <>Reading version…</>
            )}
            {state.kind === "uptodate" && (
              <span className="fishbones-settings-data-success">
                {" · "}You're up to date.
              </span>
            )}
          </div>
        </div>
        <button
          className="fishbones-settings-secondary"
          onClick={checkForUpdates}
          disabled={state.kind === "checking" || state.kind === "downloading"}
        >
          {state.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
      </div>

      {state.kind === "available" && (
        <div className="fishbones-settings-update">
          <div className="fishbones-settings-update-head">
            <Icon icon={rocket} size="sm" color="currentColor" />
            <div>
              <div className="fishbones-settings-update-title">
                Fishbones v{state.version} is available
              </div>
              <div className="fishbones-settings-update-sub">
                Download + install from inside the app — no reinstall needed.
              </div>
            </div>
            <button
              className="fishbones-settings-primary"
              onClick={downloadAndInstall}
            >
              <Icon icon={arrowDownToLine} size="xs" color="currentColor" />
              Download &amp; install
            </button>
          </div>
          {state.notes.trim().length > 0 && (
            <div className="fishbones-settings-update-notes">
              <div className="fishbones-settings-update-notes-label">
                What's new
              </div>
              <pre className="fishbones-settings-update-notes-body">
                {state.notes}
              </pre>
            </div>
          )}
        </div>
      )}

      {state.kind === "downloading" && (
        <div className="fishbones-settings-update">
          <div className="fishbones-settings-update-head">
            <Icon icon={arrowDownToLine} size="sm" color="currentColor" />
            <div>
              <div className="fishbones-settings-update-title">
                Downloading update…
              </div>
              <div className="fishbones-settings-update-sub">
                {state.total
                  ? `${(state.progress / 1024 / 1024).toFixed(1)} / ${(
                      state.total / 1024 / 1024
                    ).toFixed(1)} MB`
                  : `${(state.progress / 1024 / 1024).toFixed(1)} MB downloaded`}
              </div>
            </div>
          </div>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="fishbones-settings-update">
          <div className="fishbones-settings-update-head">
            <Icon icon={checkIcon} size="sm" color="currentColor" />
            <div>
              <div className="fishbones-settings-update-title">
                Update installed
              </div>
              <div className="fishbones-settings-update-sub">
                Restart the app to switch to the new version.
              </div>
            </div>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="fishbones-settings-error">
          Couldn't check for updates: {state.message}
        </div>
      )}
    </section>
  );
}
