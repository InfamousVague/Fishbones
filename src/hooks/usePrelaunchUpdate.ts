import { useEffect, useState } from "react";
import { isWeb, isMobile } from "@/lib/platform";
import { consumeStagedUpdate, versionSatisfies } from "@/lib/pendingUpdate";

// Pre-launch update fetcher — a port of GhostWire's UpdaterSplash flow, minus
// the separate splash window (Libre is single-window). On desktop Tauri it
// checks for an update at launch and, if one is found, downloads + installs it
// (surfacing progress) then relaunches into the new version via the macOS-safe
// `relaunch_for_update` command. The returned status/progress drive the boot
// LoadingScreen, so the updater and the boot screen are one halftone surface.
//
// On web / mobile it's a no-op: status stays null and `busy` releases, so the
// normal boot loader ("loading Libre…") shows and the app reveals as usual.

const CHECK_TIMEOUT_MS = 15_000; // a hung manifest must never trap the user
const STALL_TIMEOUT_MS = 90_000; // no download progress this long → give up
const HOLD_CAP_MS = 2_500; // max we hold the boot reveal for the check itself

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

function pct(downloaded: number, total: number): number | null {
  return total > 0 ? downloaded / total : null;
}

export interface PrelaunchUpdate {
  /// Status line for the LoadingScreen, or null to show the default boot text.
  status: string | null;
  /// 0–1 download progress, or null for indeterminate.
  progress: number | null;
  /// While true the boot loader should stay up (checking briefly, or actively
  /// downloading an update before the relaunch).
  busy: boolean;
}

export function usePrelaunchUpdate(): PrelaunchUpdate {
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // Desktop holds the boot reveal briefly for the check; web/mobile never do.
  const [busy, setBusy] = useState(!isWeb && !isMobile);

  useEffect(() => {
    // Empty deps → runs once per mount (twice in StrictMode dev, where the
    // first pass is cancelled by cleanup and the second completes). No ref
    // guard: that would block the second pass and strand the loader.
    if (isWeb || isMobile) {
      setBusy(false);
      return;
    }

    let cancelled = false;
    let downloading = false;
    // Release the boot hold after a short cap so a slow/wedged check never
    // delays launch — unless we've started downloading (then we wait for it).
    const hold = window.setTimeout(() => {
      if (!downloading && !cancelled) setBusy(false);
    }, HOLD_CAP_MS);

    async function run() {
      try {
        // If a dedicated splashscreen window exists (macOS — see
        // tauri.macos.conf.json), IT is the sole launch updater. Doing the
        // check + download here too downloaded the update TWICE on every
        // launch (once per window) and surfaced progress in the big main
        // window instead of only the small splash. Defer entirely: release
        // the boot hold and let the splash own the update.
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const splash = await WebviewWindow.getByLabel("splashscreen").catch(
          () => null,
        );
        if (splash) {
          window.clearTimeout(hold);
          setStatus(null);
          setBusy(false);
          return;
        }

        // If the in-app Settings updater just staged a version and this boot
        // is already running it (or newer), the swap applied — skip the
        // redundant check so we don't re-download the same bytes. If we're
        // still behind, the swap didn't take, so fall through and let the
        // check download it (self-heals). See @/lib/pendingUpdate.
        const staged = consumeStagedUpdate();
        if (staged) {
          try {
            const { getVersion } = await import("@tauri-apps/api/app");
            const current = await getVersion();
            if (versionSatisfies(current, staged)) {
              window.clearTimeout(hold);
              setStatus(null);
              setBusy(false);
              return;
            }
          } catch {
            /* couldn't read version — fall through to a normal check */
          }
        }

        setStatus("Checking for updates…");
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await withTimeout(check(), CHECK_TIMEOUT_MS, "update check");
        if (cancelled) return;

        if (!update) {
          window.clearTimeout(hold);
          setStatus(null);
          setBusy(false);
          return;
        }

        // An update is available — prefetch + install it before the app opens.
        downloading = true;
        window.clearTimeout(hold);
        setBusy(true);
        setStatus(`Downloading update ${update.version}…`);
        setProgress(0);

        let downloaded = 0;
        let total = 0;
        let lastTick = Date.now();
        let stalled = false;
        const watchdog = window.setInterval(() => {
          if (!stalled && Date.now() - lastTick > STALL_TIMEOUT_MS) {
            stalled = true;
            window.clearInterval(watchdog);
            setBusy(false); // download wedged → just launch the current version
            setStatus(null);
          }
        }, 5_000);

        await update.downloadAndInstall((ev) => {
          lastTick = Date.now();
          if (stalled) return;
          const e = ev as unknown as {
            event: string;
            data?: { contentLength?: number; chunkLength?: number };
          };
          if (e.event === "Started") {
            total = e.data?.contentLength ?? 0;
            setProgress(pct(0, total));
          } else if (e.event === "Progress") {
            downloaded += e.data?.chunkLength ?? 0;
            setProgress(pct(downloaded, total));
          } else if (e.event === "Finished") {
            setProgress(1);
          }
        });
        window.clearInterval(watchdog);
        if (cancelled || stalled) return;

        // Installed — relaunch into the new version (macOS-safe path fully
        // exits then re-opens, avoiding Launch Services reopening the old
        // bundle). Falls back to the plugin's relaunch if the command is
        // missing.
        setStatus("Restarting to finish update…");
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("relaunch_for_update");
        } catch {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      } catch (e) {
        // Network blip / missing manifest / timeout — never block launch.
        console.warn("[prelaunch-update] check failed:", e);
        window.clearTimeout(hold);
        if (!cancelled) {
          setBusy(false);
          setStatus(null);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(hold);
    };
  }, []);

  return { status, progress, busy };
}
