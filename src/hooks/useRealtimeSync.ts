import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProgressRow,
  SettingRow,
  SolutionRow,
  SyncEvent,
  UseFishbonesCloud,
} from "./useFishbonesCloud";

/// Real-time cross-device sync orchestrator.
///
/// Wraps `useFishbonesCloud` with the lifecycle glue an app needs to
/// keep progress, solutions, and settings mirrored across every
/// authenticated device:
///
///   1. On sign-in (or first mount with a stored token), full-pull
///      every domain and hand the rows to the caller's `applyX`
///      functions so the local store catches up to the server.
///   2. Open a WebSocket subscription to `/sync/ws`. Every server
///      event (progress / solutions / settings) is forwarded to the
///      same `applyX` functions, so a write on a sibling device
///      reaches this one within a network round-trip.
///   3. Expose `pushProgress` / `pushSolutions` / `pushSettings`
///      helpers that debounce + coalesce per-(course, lesson, key)
///      so a learner mashing keys doesn't flood the relay.
///
/// The hook stays opinion-free about the local store's shape — the
/// caller passes plain `apply*` callbacks that know how to merge
/// rows into wherever they live (React state, IndexedDB, localStorage,
/// Tauri SQLite, etc.). The same hook works on web and desktop.
///
/// Failure semantics: every push is fire-and-forget with a console
/// warning on rejection. The on-disk DB is always the source of
/// truth; if the relay is unreachable we just don't echo to other
/// devices — the next successful push will re-sync them.

export interface RealtimeSyncOpts {
  cloud: UseFishbonesCloud;
  /// Apply a batch of progress rows pulled from the server (or
  /// pushed by another device via WS) to the local store. Row order
  /// is server-ordered (most-recent first); the applier should fold
  /// each row idempotently.
  applyProgress?: (rows: ProgressRow[]) => void;
  applySolutions?: (rows: SolutionRow[]) => void;
  applySettings?: (rows: SettingRow[]) => void;
  /// Optional debounce window for coalescing local writes before
  /// the cloud push fires. Defaults to 600ms — fast enough to feel
  /// "real time" between devices, slow enough that a burst of
  /// keystrokes settles into one request.
  pushDebounceMs?: number;
}

export interface RealtimeSyncHandle {
  status: "idle" | "syncing" | "live" | "error";
  error: string | null;
  /// Buffer one progress row for an upstream push. Coalesces by
  /// (course, lesson) — a second update to the same lesson within
  /// the debounce window replaces the first.
  pushProgress: (row: ProgressRow) => void;
  /// Same coalescing as pushProgress, keyed by (course, lesson).
  pushSolution: (row: SolutionRow) => void;
  /// Coalesce by `key`.
  pushSetting: (row: SettingRow) => void;
  /// Force-flush every buffered push synchronously. Useful before
  /// an unmount or sign-out so we don't lose the trailing edits.
  flush: () => Promise<void>;
}

export function useRealtimeSync(opts: RealtimeSyncOpts): RealtimeSyncHandle {
  const {
    cloud,
    applyProgress,
    applySolutions,
    applySettings,
    pushDebounceMs = 600,
  } = opts;

  const [status, setStatus] = useState<RealtimeSyncHandle["status"]>("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs for the appliers so the effects below don't re-fire on
  // every render — callers typically inline `applyX` lambdas which
  // would otherwise churn the dep arrays.
  const applyProgressRef = useRef(applyProgress);
  applyProgressRef.current = applyProgress;
  const applySolutionsRef = useRef(applySolutions);
  applySolutionsRef.current = applySolutions;
  const applySettingsRef = useRef(applySettings);
  applySettingsRef.current = applySettings;

  // Push buffers — keyed maps so we can coalesce repeated edits to
  // the same (course, lesson) or settings key into one network call.
  const progressBuf = useRef(new Map<string, ProgressRow>());
  const solutionsBuf = useRef(new Map<string, SolutionRow>());
  const settingsBuf = useRef(new Map<string, SettingRow>());
  const flushTimer = useRef<number | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const progressRows = Array.from(progressBuf.current.values());
    const solutionRows = Array.from(solutionsBuf.current.values());
    const settingRows = Array.from(settingsBuf.current.values());
    progressBuf.current.clear();
    solutionsBuf.current.clear();
    settingsBuf.current.clear();
    try {
      // Run in parallel — they're independent endpoints. Failures
      // log but don't stop the others.
      await Promise.all([
        progressRows.length > 0
          ? cloud.pushProgress(progressRows).catch((e) => {
              console.warn("[realtime-sync] push progress failed:", e);
            })
          : Promise.resolve(),
        solutionRows.length > 0
          ? cloud.pushSolutions(solutionRows).catch((e) => {
              console.warn("[realtime-sync] push solutions failed:", e);
            })
          : Promise.resolve(),
        settingRows.length > 0
          ? cloud.pushSettings(settingRows).catch((e) => {
              console.warn("[realtime-sync] push settings failed:", e);
            })
          : Promise.resolve(),
      ]);
    } catch (e) {
      // Promise.all in this shape can't actually reject (each .catch
      // swallows), but TypeScript doesn't know that.
      console.warn("[realtime-sync] flush failed:", e);
    }
  }, [cloud]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      void flush();
    }, pushDebounceMs);
  }, [flush, pushDebounceMs]);

  const pushProgress = useCallback(
    (row: ProgressRow) => {
      progressBuf.current.set(`${row.course_id}:${row.lesson_id}`, row);
      scheduleFlush();
    },
    [scheduleFlush],
  );
  const pushSolution = useCallback(
    (row: SolutionRow) => {
      solutionsBuf.current.set(`${row.course_id}:${row.lesson_id}`, row);
      scheduleFlush();
    },
    [scheduleFlush],
  );
  const pushSetting = useCallback(
    (row: SettingRow) => {
      settingsBuf.current.set(row.key, row);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // Initial pull + WS subscription. Re-fires when the user toggles
  // sign-in state. The cleanup tears down both the WS and any
  // pending flush timer so a sign-out cuts off cleanly.
  useEffect(() => {
    if (!cloud.signedIn) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("syncing");
    setError(null);
    void (async () => {
      try {
        const [progress, solutions, settings] = await Promise.all([
          cloud.pullProgress(),
          cloud.pullSolutions(),
          cloud.pullSettings(),
        ]);
        if (cancelled) return;
        applyProgressRef.current?.(progress);
        applySolutionsRef.current?.(solutions);
        applySettingsRef.current?.(settings);
        setStatus("live");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    const teardownSocket = cloud.subscribeSync((event: SyncEvent) => {
      switch (event.type) {
        case "hello":
          // Server has us subscribed; status flips to live once the
          // initial pull settles (above).
          break;
        case "resync": {
          // Backlog overflowed — re-pull everything. Cheap insurance.
          void Promise.all([
            cloud.pullProgress(),
            cloud.pullSolutions(),
            cloud.pullSettings(),
          ])
            .then(([p, s, st]) => {
              applyProgressRef.current?.(p);
              applySolutionsRef.current?.(s);
              applySettingsRef.current?.(st);
            })
            .catch((e) => {
              console.warn("[realtime-sync] resync failed:", e);
            });
          break;
        }
        case "progress":
          applyProgressRef.current?.(event.rows);
          break;
        case "solutions":
          applySolutionsRef.current?.(event.rows);
          break;
        case "settings":
          applySettingsRef.current?.(event.rows);
          break;
      }
    });

    return () => {
      cancelled = true;
      teardownSocket();
      if (flushTimer.current !== null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [cloud]);

  // Best-effort flush before unload so a refresh / app-quit doesn't
  // strand the last burst of edits in the buffer. The pushes are
  // fire-and-forget here — the browser may cut us off before they
  // settle, but they'll still be in the buffer next session.
  useEffect(() => {
    const handler = () => {
      void flush();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [flush]);

  return {
    status,
    error,
    pushProgress,
    pushSolution,
    pushSetting,
    flush,
  };
}
