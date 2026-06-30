import { useEffect, useState } from "react";
import { isWeb, isMobile } from "@/lib/platform";
import LoadingScreen from "@/components/molecules/LoadingScreen/LoadingScreen";

// The small pre-launch splash window (macOS) — a port of GhostWire's
// UpdaterSplash. It loads in the frameless `splashscreen` window (index.html
// ?splash=1, defined in tauri.macos.conf.json) while the main window is hidden.
// It checks for an update; if one is found it downloads + installs it and
// relaunches into the new version; otherwise it reveals the (hidden) main
// window and closes itself. The main window also self-reveals as a fallback
// (see main.tsx), so a failed/missing splash can never strand the app.

const CHECK_TIMEOUT_MS = 8_000; // a hung manifest must never trap the user here
const STALL_TIMEOUT_MS = 90_000; // no download progress this long → just launch
const MAX_SPLASH_MS = 12_000; // hard ceiling: hand off by then no matter what

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

export default function UpdaterSplash() {
  const [status, setStatus] = useState("Starting…");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let downloading = false;
    let closed = false;
    let mainSeen = false;
    let unlistenReady: (() => void) | undefined;

    async function closeSplash() {
      if (closed || isWeb) return;
      closed = true;
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const me = await WebviewWindow.getByLabel("splashscreen");
        setTimeout(() => void me?.close().catch(() => {}), 250);
      } catch {
        /* ignore */
      }
    }

    async function forceShowMain() {
      if (isWeb) return;
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const main = await WebviewWindow.getByLabel("main");
        await main?.show().catch(() => {});
        await main?.setFocus().catch(() => {});
      } catch {
        /* ignore */
      }
    }

    async function emitProceed() {
      if (isWeb) return;
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("splash://proceed").catch(() => {});
      } catch {
        /* ignore */
      }
    }

    // Listen EARLY for the main window finishing its load (App.tsx reveals it
    // once courses load + it has heard splash://proceed, then emits this).
    // Closing the splash on that is the normal hand-off — but NEVER while
    // downloading an update, which would tear down this window mid-download.
    void (async () => {
      if (isWeb) return;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenReady = await listen("main://ready", () => {
          mainSeen = true;
          if (!downloading) void closeSplash();
        });
      } catch {
        /* ignore */
      }
    })();

    // No update (or a bail): tell the (hidden) main window it may reveal itself
    // once its courses are loaded. It prefetches behind us and emits
    // main://ready when up, which closes this splash. Belt-and-suspenders: if it
    // never signals ready, force it up after the ceiling so the user is never
    // trapped on the splash.
    function handOff() {
      void emitProceed();
      if (mainSeen) {
        void closeSplash();
        return;
      }
      setTimeout(() => {
        if (closed || downloading) return;
        void forceShowMain();
        void closeSplash();
      }, MAX_SPLASH_MS);
    }

    async function run() {
      // No updater on web / mobile — hand straight off after a short beat.
      if (isWeb || isMobile) {
        setStatus("Loading…");
        handOff();
        return;
      }
      try {
        setStatus("Checking for updates…");
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await withTimeout(check(), CHECK_TIMEOUT_MS, "update check");
        if (cancelled) return;

        if (!update) {
          handOff();
          return;
        }

        // An update — keep the main window hidden (no proceed) and download +
        // install it, then relaunch into the new version.
        downloading = true;
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
            downloading = false;
            handOff(); // download wedged → launch the current version
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

        setStatus("Restarting to finish update…");
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("relaunch_for_update");
        } catch {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      } catch (e) {
        console.warn("[updater-splash] prelaunch check failed:", e);
        downloading = false;
        if (!cancelled) handOff();
      }
    }

    void run();
    return () => {
      cancelled = true;
      unlistenReady?.();
    };
  }, []);

  return <LoadingScreen status={status} progress={progress} />;
}
