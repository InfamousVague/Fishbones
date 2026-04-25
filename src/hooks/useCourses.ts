import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { seedCourses } from "../data/seedCourses";
import type { Course } from "../data/types";

/// Load the user's courses from the app data dir.
///
/// First-launch seeding: if the app data dir has no courses, we serialize the
/// built-in `seedCourses` to disk via `save_course` so the same storage path
/// works whether the course came from the bundled seed, an ingested book, or
/// an imported `.fishbones` / `.kata` archive.
///
/// ## Two-stage loading
///
/// On a realistic library (~24 courses, ~12 MB of combined JSON) the old
/// "fire `load_course` in parallel for every entry, setState once" pattern
/// hung the main thread for 1-3 seconds. Now:
///
///   1. A single `list_courses_summary` IPC returns EVERY course in one
///      payload with the heavy per-lesson fields (`starter`, `solution`,
///      `tests`, `files`, `solutionFiles`, prose) stripped server-side.
///      Cuts payload by ~75% and collapses N IPCs into 1 — the library,
///      sidebar, and profile all render immediately.
///   2. In the background, we hydrate each course to its full body via
///      the existing `load_course` command, one batch of 4 at a time
///      with `setTimeout(0)` yields between batches. When the learner
///      opens a lesson before its course has hydrated, `hydrateCourse`
///      awaits the full load so the lesson view gets real starter /
///      solution / tests.
///
/// Outside Tauri (plain `vite dev` or unit tests) we fall back to the
/// seed set so components render.
export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set of course ids currently being hydrated in the background.
  // Exposed through the return value so BookCover / Sidebar can render a
  // dimmed-cover loading overlay until the full body lands.
  const [hydrating, setHydrating] = useState<Set<string>>(new Set());
  // Track which courses we've fully hydrated (lesson bodies present)
  // and any hydration promises currently in flight, so concurrent
  // `hydrateCourse` calls for the same id de-dupe to one IPC.
  const hydratedIds = useRef<Set<string>>(new Set());
  const inflight = useRef<Map<string, Promise<Course>>>(new Map());

  // Fire a full `load_course` and swap the returned Course into state,
  // replacing whatever summary (or stale full copy) was there before.
  // Idempotent + de-duped so the selectLesson hot path is safe to call
  // unconditionally.
  const hydrateCourse = useCallback(async (courseId: string): Promise<Course | null> => {
    if (hydratedIds.current.has(courseId)) {
      // Already hydrated — caller gets the current state entry.
      return null;
    }
    const existing = inflight.current.get(courseId);
    if (existing) return existing;
    setHydrating((prev) => {
      if (prev.has(courseId)) return prev;
      const next = new Set(prev);
      next.add(courseId);
      return next;
    });
    const p = (async () => {
      try {
        const full = await invoke<Course>("load_course", { courseId });
        hydratedIds.current.add(courseId);
        setCourses((prev) =>
          prev.map((c) => (c.id === courseId ? full : c)),
        );
        return full;
      } finally {
        inflight.current.delete(courseId);
        setHydrating((prev) => {
          if (!prev.has(courseId)) return prev;
          const next = new Set(prev);
          next.delete(courseId);
          return next;
        });
      }
    })();
    inflight.current.set(courseId, p);
    return p;
  }, []);

  async function refresh(): Promise<Course[]> {
    const t0 = performance.now();
    try {
      // Stage 1: fast summary pull. One IPC, heavy fields stripped
      // server-side. Flips `loaded` the moment this returns so the
      // bootloader dismisses and the library renders.
      let summaries = await invoke<Course[]>("list_courses_summary");
      const tSummary = performance.now();

      // First-launch seed: if the user has no courses on disk AND we
      // ship bundled seed content, serialize it to disk and re-list.
      // Mirrors the old behaviour — unchanged semantics, just keyed
      // off the summary count.
      if (summaries.length === 0 && seedCourses.length > 0) {
        await Promise.all(
          seedCourses.map((c) =>
            invoke("save_course", { courseId: c.id, body: c }),
          ),
        );
        summaries = await invoke<Course[]>("list_courses_summary");
      }

      // Previous session may have left `hydratedIds` populated — reset
      // it so the background upgrade below rehydrates fresh state.
      hydratedIds.current = new Set();
      setCourses(summaries);
      setLoaded(true);
      setError(null);
      const tSetState = performance.now();
      const payloadBytes = (() => {
        try {
          return new Blob([JSON.stringify(summaries)]).size;
        } catch {
          return -1;
        }
      })();
      // eslint-disable-next-line no-console
      console.log(
        `[load] summary invoke=${(tSummary - t0).toFixed(0)}ms ` +
          `react=${(tSetState - tSummary).toFixed(0)}ms ` +
          `courses=${summaries.length} ` +
          `payload=${(payloadBytes / 1024).toFixed(0)}KB`,
      );

      // Stage 2: background hydration. Pull each course's full body
      // one batch at a time with `setTimeout(0)` yields between so
      // the event loop can paint + handle clicks between deserialises.
      // Don't await this inside `refresh` — we want the caller (and
      // the bootloader gate) unblocked.
      void (async () => {
        const tHydStart = performance.now();
        const BATCH = 4;
        for (let i = 0; i < summaries.length; i += BATCH) {
          const slice = summaries.slice(i, i + BATCH);
          await Promise.all(slice.map((s) => hydrateCourse(s.id)));
          if (i + BATCH < summaries.length) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `[load] hydration=${(performance.now() - tHydStart).toFixed(0)}ms ` +
            `(${summaries.length} courses)`,
        );
      })();

      return summaries;
    } catch (e) {
      // Not in Tauri, or backend failed. Use the bundled seed so the UI at
      // least renders something.
      setCourses(seedCourses);
      setError(e instanceof Error ? e.message : String(e));
      return seedCourses;
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// Auto-refresh whenever the app window regains focus or becomes
  /// visible. Cheap (one IPC + N file reads, ~50-200ms total for a
  /// few-dozen-course library) and catches the common "I edited a
  /// course.json from a script / re-ran ingest while the app was
  /// open" case without forcing the user to restart. Throttled to one
  /// refresh per ~2s so quickly toggling away-and-back doesn't
  /// hammer the backend.
  useEffect(() => {
    let lastRun = 0;
    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastRun < 2000) return;
      lastRun = now;
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { courses, loaded, error, refresh, hydrateCourse, hydrating };
}
