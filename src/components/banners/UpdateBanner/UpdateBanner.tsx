// OTA update banner. On startup, asks the Tauri updater plugin to
// check the configured endpoint for a newer version. If one is
// available, surfaces a small floating banner offering to download
// + install. While the download is in flight, the banner shows
// progress; on completion, swaps the CTA to "Restart now" which
// applies the update and relaunches.
//
// Why a banner and not a modal: updates aren't blocking. The user
// can keep working through their lesson; the banner waits at the
// bottom-right with a low-intensity surface until they're ready.
//
// Where this gets imported: App.tsx mounts it once, top-level. It
// renders nothing while idle — only once an update is detected.
//
// Web build short-circuits to null. The updater plugin throws the
// moment it's invoked outside Tauri, so we gate the import via
// `isDesktop`.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { downloadCloud } from "@base/primitives/icon/icons/download-cloud";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import { isDesktop } from "../../../lib/platform";
import "./UpdateBanner.css";

/// Size of the polling interval for "check again" — once an hour is
/// generous; the user usually re-launches the app within that window
/// anyway. Set to 0 to disable polling.
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;

/// localStorage key for remembered "user dismissed this version" so
/// re-mounting the app doesn't re-spam them. We DON'T persist across
/// versions — once a NEW version ships, the banner reappears.
const DISMISSED_KEY = "fishbones:update-banner-dismissed-version";

type State =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; downloaded: number; total: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export function UpdateBanner(): React.ReactElement | null {
  // Web build never has the updater plugin. Bail early so the
  // dynamic import below doesn't even run.
  if (!isDesktop) return null;

  const [state, setState] = useState<State>({ kind: "idle" });
  const dismissedFor = useRef<string | null>(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(DISMISSED_KEY)
      : null,
  );

  // Run the check on mount + on a recurring interval. Each check
  // dynamically imports the plugin so the web build can omit it
  // entirely (Vite tree-shakes the import out when isDesktop is
  // statically false at build time).
  useEffect(() => {
    let cancelled = false;
    const runCheck = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled) return;
        if (!update) {
          setState({ kind: "idle" });
          return;
        }
        if (dismissedFor.current === update.version) {
          // User already said "not now" for this version. Stay
          // hidden until the next version ships.
          return;
        }
        setState({
          kind: "available",
          version: update.version,
          notes: update.body ?? "",
        });
      } catch (e) {
        // Network blip, GitHub 503, manifest temporarily missing.
        // Quietly swallow — we'll retry on the next interval.
        // Log so the maintainer can debug from devtools.
        // eslint-disable-next-line no-console
        console.warn("[updater] check failed:", e);
      }
    };
    void runCheck();
    if (RECHECK_INTERVAL_MS > 0) {
      const id = window.setInterval(runCheck, RECHECK_INTERVAL_MS);
      return () => {
        cancelled = true;
        window.clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const onDownload = useCallback(async () => {
    if (state.kind !== "available") return;
    setState({
      kind: "downloading",
      version: state.version,
      downloaded: 0,
      total: 0,
    });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setState({ kind: "error", message: "Update no longer available." });
        return;
      }
      // The downloadAndInstall API streams progress events. We use
      // them to animate the banner's progress bar.
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            setState({
              kind: "downloading",
              version: update.version,
              downloaded: 0,
              total,
            });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setState({
              kind: "downloading",
              version: update.version,
              downloaded,
              total,
            });
            break;
          case "Finished":
            setState({ kind: "ready", version: update.version });
            break;
        }
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [state]);

  const onRestart = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      // If relaunch fails the user can quit + reopen manually. The
      // update is already staged on disk at this point, so the next
      // launch picks it up automatically.
      // eslint-disable-next-line no-console
      console.error("[updater] relaunch failed:", e);
    }
  }, []);

  const onDismiss = useCallback(() => {
    if (state.kind !== "available") {
      // Mid-download dismiss does the same — record dismissal of
      // the in-flight version so we don't badger them again.
    }
    const v =
      state.kind === "available" ||
      state.kind === "downloading" ||
      state.kind === "ready"
        ? state.version
        : null;
    if (v && typeof localStorage !== "undefined") {
      localStorage.setItem(DISMISSED_KEY, v);
      dismissedFor.current = v;
    }
    setState({ kind: "idle" });
  }, [state]);

  if (state.kind === "idle") return null;

  return (
    <div className="fishbones-update-banner" role="status" aria-live="polite">
      <div className="fishbones-update-banner__icon" aria-hidden>
        <Icon icon={downloadCloud} size="sm" color="currentColor" />
      </div>
      <div className="fishbones-update-banner__body">
        {state.kind === "available" && (
          <>
            <div className="fishbones-update-banner__title">
              Fishbones {state.version} is ready to install
            </div>
            <div className="fishbones-update-banner__sub">
              Click Install to download in the background.
            </div>
          </>
        )}
        {state.kind === "downloading" && (
          <>
            <div className="fishbones-update-banner__title">
              Downloading {state.version}…
            </div>
            <div className="fishbones-update-banner__progress" aria-hidden>
              <div
                className="fishbones-update-banner__progress-bar"
                style={{
                  width:
                    state.total > 0
                      ? `${Math.min(100, (state.downloaded / state.total) * 100)}%`
                      : "5%",
                }}
              />
            </div>
            <div className="fishbones-update-banner__sub">
              {state.total > 0
                ? `${formatBytes(state.downloaded)} / ${formatBytes(state.total)}`
                : `${formatBytes(state.downloaded)} downloaded`}
            </div>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <div className="fishbones-update-banner__title">
              {state.version} downloaded — restart to apply
            </div>
            <div className="fishbones-update-banner__sub">
              Your tabs and progress will be reopened automatically.
            </div>
          </>
        )}
        {state.kind === "error" && (
          <>
            <div className="fishbones-update-banner__title">
              Update failed
            </div>
            <div className="fishbones-update-banner__sub">{state.message}</div>
          </>
        )}
      </div>
      <div className="fishbones-update-banner__actions">
        {state.kind === "available" && (
          <button
            type="button"
            className="fishbones-update-banner__btn fishbones-update-banner__btn--primary"
            onClick={() => void onDownload()}
          >
            Install
          </button>
        )}
        {state.kind === "ready" && (
          <button
            type="button"
            className="fishbones-update-banner__btn fishbones-update-banner__btn--primary"
            onClick={() => void onRestart()}
          >
            Restart now
          </button>
        )}
        <button
          type="button"
          className="fishbones-update-banner__btn fishbones-update-banner__btn--ghost"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
