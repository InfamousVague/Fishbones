import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProgressRow,
  SettingRow,
  SolutionRow,
  SyncEvent,
  UseLibreCloud,
} from "./useLibreCloud";

/// Real-time cross-device sync orchestrator.
///
/// Wraps `useLibreCloud` with the lifecycle glue an app needs to
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
  cloud: UseLibreCloud;
  /// Apply a batch of progress rows pulled from the server (or
  /// pushed by another device via WS) to the local store. Row order
  /// is server-ordered (most-recent first); the applier should fold
  /// each row idempotently.
  applyProgress?: (rows: ProgressRow[]) => void;
  /// Apply a per-course / per-lesson progress wipe pushed from another
  /// device (or echoed back from this device's own scoped reset).
  /// `lessonIds === null` means the whole course was reset; a non-null
  /// array means those specific lessons. Reducer should drop matching
  /// completion rows from the in-memory + on-disk store the same way
  /// `clearCourseCompletions` / `clearChapterCompletions` /
  /// `clearLessonCompletion` would for a local trigger. Idempotent —
  /// if the rows aren't there, do nothing.
  applyProgressCleared?: (
    courseId: string,
    lessonIds: string[] | null,
  ) => void;
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
  /// Force a full re-pull from the server: pulls progress / solutions
  /// / settings and runs them through the caller's `applyX` functions
  /// just like sign-in does. Surface this in a debug panel so a user
  /// who suspects local + server have drifted can manually catch up.
  /// Returns when every applier finishes.
  resync: () => Promise<void>;
  /// Snapshot of how many rows are currently buffered for an upcoming
  /// push (i.e. local edits that haven't been flushed to the relay
  /// yet). Bumps as the user edits and drops back to zero after the
  /// debounced flush succeeds.
  pendingPushCount: { progress: number; solutions: number; settings: number };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function useRealtimeSync(opts: RealtimeSyncOpts): RealtimeSyncHandle {
  const {
    cloud,
    applyProgress,
    applyProgressCleared,
    applySolutions,
    applySettings,
    pushDebounceMs = 600,
  } = opts;

  const [status, setStatus] = useState<RealtimeSyncHandle["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  /// Bumped when visibility flips back to "visible" so the pull /
  /// subscribe effect re-runs against a fresh WebSocket. iOS WKWebView
  /// silently suspends backgrounded sockets; without this, sync stalls
  /// after the first app-switch until a manual refresh.
  const [resyncEpoch, setResyncEpoch] = useState(0);

  // Refs for the appliers so the effects below don't re-fire on
  // every render — callers typically inline `applyX` lambdas which
  // would otherwise churn the dep arrays.
  const applyProgressRef = useRef(applyProgress);
  applyProgressRef.current = applyProgress;
  const applyProgressClearedRef = useRef(applyProgressCleared);
  applyProgressClearedRef.current = applyProgressCleared;
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

  /// Mirror of the buffer sizes as React state so the SyncDebugPanel
  /// can display them. Mutating refs alone don't trigger re-renders;
  /// we bump this whenever a buffer adds or drains.
  const [pendingPushCount, setPendingPushCount] = useState({
    progress: 0,
    solutions: 0,
    settings: 0,
  });
  const refreshPendingCount = useCallback(() => {
    setPendingPushCount({
      progress: progressBuf.current.size,
      solutions: solutionsBuf.current.size,
      settings: settingsBuf.current.size,
    });
  }, []);

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
    refreshPendingCount();
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
      refreshPendingCount();
      scheduleFlush();
    },
    [scheduleFlush, refreshPendingCount],
  );
  const pushSolution = useCallback(
    (row: SolutionRow) => {
      solutionsBuf.current.set(`${row.course_id}:${row.lesson_id}`, row);
      refreshPendingCount();
      scheduleFlush();
    },
    [scheduleFlush, refreshPendingCount],
  );
  const pushSetting = useCallback(
    (row: SettingRow) => {
      settingsBuf.current.set(row.key, row);
      refreshPendingCount();
      scheduleFlush();
    },
    [scheduleFlush, refreshPendingCount],
  );

  /// Force a full re-pull. Cheapest implementation: bump the
  /// `resyncEpoch` state below — the main pull / subscribe effect
  /// lists `resyncEpoch` in its deps, so the bump tears down the
  /// (potentially stale) WS, re-opens a fresh one, and re-pulls
  /// everything via the same applier path sign-in uses. Returns a
  /// promise that resolves once the next pull settles, so a debug
  /// panel can show a spinner against the actual round-trip.
  const resyncSettlePromiseRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
  } | null>(null);
  const resync = useCallback(async (): Promise<void> => {
    if (resyncSettlePromiseRef.current) {
      // Already a pull in flight from a previous resync click; share
      // its promise rather than queueing a second.
      return resyncSettlePromiseRef.current.promise;
    }
    let resolveFn: () => void = () => {};
    const settle = new Promise<void>((r) => {
      resolveFn = r;
    });
    resyncSettlePromiseRef.current = { promise: settle, resolve: resolveFn };
    setResyncEpoch((n) => n + 1);
    return settle;
  }, []);

  // Initial pull + WS subscription. Re-fires when the user toggles
  // sign-in state. The cleanup tears down both the WS and any
  // pending flush timer so a sign-out cuts off cleanly. The
  // `resyncEpoch` state below force-re-runs this effect when the
  // visibility-resume handler fires — needed because iOS WKWebView
  // suspends WS connections on background and may not fire `close`
  // when iOS kills them, so a stale-but-"open" socket would silently
  // miss every event until something else triggered a reconnect.
  useEffect(() => {
    if (!cloud.signedIn) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("syncing");
    setError(null);
    void (async () => {
      // CRITICAL: use `allSettled`, NOT `all`. The three pull
      // endpoints are independent — if the relay returns 404 on
      // one (e.g. `/settings` is unimplemented on a
      // staging deploy or older relay version), `Promise.all`
      // would reject the whole batch and the progress + solutions
      // pulls — which DID succeed — would silently never apply.
      // That was the actual root cause of the "level 103 on
      // desktop, 0 on mobile" sync drift the user kept seeing:
      // settings 404'd, the catch branch flipped status to
      // "error", and the just-fetched progress array was never
      // handed to applyProgressRef. With allSettled each fulfilled
      // value applies independently; rejected ones get logged but
      // don't block the rest. Status flips to "error" only when
      // EVERY endpoint failed — partial success still reads as
      // "live" with a console warning.
      const [progressR, solutionsR, settingsR] = await Promise.allSettled([
        cloud.pullProgress(),
        cloud.pullSolutions(),
        cloud.pullSettings(),
      ]);
      if (cancelled) {
        const pending = resyncSettlePromiseRef.current;
        resyncSettlePromiseRef.current = null;
        pending?.resolve();
        return;
      }
      const failures: string[] = [];
      if (progressR.status === "fulfilled") {
        applyProgressRef.current?.(progressR.value);
      } else {
        const msg = errorMessage(progressR.reason);
        failures.push(`progress: ${msg}`);
        console.warn("[realtime-sync] pull progress failed:", progressR.reason);
      }
      if (solutionsR.status === "fulfilled") {
        applySolutionsRef.current?.(solutionsR.value);
      } else {
        const msg = errorMessage(solutionsR.reason);
        failures.push(`solutions: ${msg}`);
        console.warn("[realtime-sync] pull solutions failed:", solutionsR.reason);
      }
      if (settingsR.status === "fulfilled") {
        applySettingsRef.current?.(settingsR.value);
      } else {
        const msg = errorMessage(settingsR.reason);
        failures.push(`settings: ${msg}`);
        console.warn("[realtime-sync] pull settings failed:", settingsR.reason);
      }
      // Three-way outcome:
      //   - all 3 ok   → live, no error
      //   - some ok    → live, surface the failures so the debug
      //                  panel can still flag them, but don't
      //                  pretend the successful pulls didn't apply
      //   - all failed → error
      if (failures.length === 3) {
        setStatus("error");
        setError(failures.join(" · "));
      } else {
        setStatus("live");
        setError(failures.length > 0 ? failures.join(" · ") : null);
      }
      // Resolve the pending `resync()` promise so a debug panel
      // spinner stops. Idempotent.
      const pending = resyncSettlePromiseRef.current;
      resyncSettlePromiseRef.current = null;
      pending?.resolve();
    })();

    const teardownSocket = cloud.subscribeSync((event: SyncEvent) => {
      switch (event.type) {
        case "hello":
          // Server has us subscribed; status flips to live once the
          // initial pull settles (above).
          break;
        case "resync": {
          // Backlog overflowed — re-pull everything. Same partial-
          // failure tolerance as the initial pull above (allSettled,
          // not all) so a 404 on one endpoint doesn't black-hole
          // the others.
          void (async () => {
            const [pr, sr, str] = await Promise.allSettled([
              cloud.pullProgress(),
              cloud.pullSolutions(),
              cloud.pullSettings(),
            ]);
            if (pr.status === "fulfilled") applyProgressRef.current?.(pr.value);
            else console.warn("[realtime-sync] resync progress failed:", pr.reason);
            if (sr.status === "fulfilled") applySolutionsRef.current?.(sr.value);
            else console.warn("[realtime-sync] resync solutions failed:", sr.reason);
            if (str.status === "fulfilled") applySettingsRef.current?.(str.value);
            else console.warn("[realtime-sync] resync settings failed:", str.reason);
          })();
          break;
        }
        case "progress":
          applyProgressRef.current?.(event.rows);
          break;
        case "progress_cleared":
          // Scoped wipe broadcast by another device (or echoed back
          // from this device's own reset, idempotent). Drop matching
          // rows so the local view converges to the cleared state
          // instead of the next bulk push re-filling them.
          applyProgressClearedRef.current?.(event.course_id, event.lesson_ids);
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
    // `resyncEpoch` (state below) is intentionally a dep so the
    // visibility-resume handler can force a full re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, resyncEpoch]);

  // Best-effort flush before unload so a refresh / app-quit doesn't
  // strand the last burst of edits in the buffer. The pushes are
  // fire-and-forget here — the browser may cut us off before they
  // settle, but they'll still be in the buffer next session.
  //
  // ALSO flushes on `visibilitychange` to "hidden" — iOS WKWebView
  // doesn't fire `beforeunload` when the user backgrounds the app,
  // so without this hook a buffered `pushProgress` from "tap Next on
  // a lesson, immediately switch apps" would be lost. visibility ->
  // hidden is the iOS-equivalent signal.
  useEffect(() => {
    const onUnload = () => {
      void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void flush();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  // iOS WKWebView aggressively suspends backgrounded WebViews; on
  // resume the WS we opened earlier may be silently dead (no `close`
  // event fired by the OS, no error from the server end either —
  // just stale). Without intervention, the user comes back to the
  // app and sees no live progress sync until they tap something
  // that triggers a fresh fetch. This effect bumps a `resyncEpoch`
  // state on every visibility -> visible transition; the main pull
  // / subscribe effect above lists `resyncEpoch` in its deps, so a
  // bump tears down the (probably stale) WS, re-opens a fresh one,
  // and re-pulls progress / solutions / settings to catch up on
  // whatever changed while we were backgrounded.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setResyncEpoch((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return {
    status,
    error,
    pushProgress,
    pushSolution,
    pushSetting,
    flush,
    resync,
    pendingPushCount,
  };
}
