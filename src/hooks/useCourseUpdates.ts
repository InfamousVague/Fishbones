/// Per-course "is an update available" map for the Library cover
/// badges. Runs the upstream comparison on mount + whenever the
/// course list changes, then exposes a refresh helper for the cmd+K
/// actions to call after they sync a course.
///
/// Concurrency: courses are checked in parallel via Promise.all. The
/// per-course `checkUpdateAvailable` does one fetch + one
/// crypto.subtle hash, so even a 30-course library settles in a
/// couple hundred ms. Failures (network, 404) are absorbed silently
/// — a missing badge is the right fallback for "we couldn't tell".
///
/// Persistence: the backfill write inside `checkUpdateAvailable` is
/// fire-and-forget; we don't refresh the in-memory course list when
/// it lands because the only mutated field (`bundleSha`) doesn't
/// change anything user-visible.

import { useCallback, useEffect, useState } from "react";
import type { Course } from "@/data/types";
import { checkUpdateAvailable, clearUpdateCache } from "@/lib/courseSync";
import { storage } from "@/lib/storage";

export function useCourseUpdates(courses: Course[]): {
  /// Map from courseId → true when an upstream update is available.
  /// Missing keys = unknown (still loading or no bundled counterpart).
  updates: Record<string, boolean>;
  /// Force a recheck for one course id. Useful after a "Reapply
  /// bundled starter" action so the badge clears immediately
  /// instead of waiting for the next library mount.
  recheck: (courseId: string) => Promise<void>;
  /// Force a recheck of every course. Cheap thanks to the parallel
  /// fan-out; called when the user clicks "Refresh library".
  recheckAll: () => Promise<void>;
} {
  const [updates, setUpdates] = useState<Record<string, boolean>>({});

  const checkAll = useCallback(async (list: Course[]) => {
    // Sequential with a setTimeout(0) yield between courses, NOT
    // Promise.all. The hash work (canonicalJson + SHA-256) is
    // CPU-bound and blocks the event loop — Promise.all stacked all
    // 24 courses' worth of canonicalisation back-to-back, freezing
    // the app for several seconds on every Library ↔ Discover nav.
    // Sequential + yield trades a touch more wall-time for a UI
    // that stays responsive throughout, and second-and-beyond mounts
    // hit the module-level cache in courseSync.ts so the freeze
    // only ever happens once per session per course.
    const t0 = performance.now();
    const next: Record<string, boolean> = {};
    for (const c of list) {
      try {
        const r = await checkUpdateAvailable(c);
        next[c.id] = r.available;
      } catch {
        next[c.id] = false;
      }
      // Yield so the browser can paint + handle clicks between
      // courses. Cheap when the cache is warm (returns sync-ish);
      // critical on the first cold pass.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    setUpdates(next);
    // eslint-disable-next-line no-console
    console.log(
      `[lib] update-check ${list.length} courses in ${(performance.now() - t0).toFixed(0)}ms`,
    );
  }, []);

  useEffect(() => {
    if (courses.length === 0) return;
    void checkAll(courses);
    // We re-check every time the course list array identity changes —
    // typically on app load + after refresh(). Per-course content
    // changes don't refresh by themselves; that's what `recheck` is
    // for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.length]);

  const recheck = useCallback(
    async (courseId: string) => {
      // Invalidate the module-level cache for this course before
      // we fetch — otherwise the cached pre-update result would
      // win and the badge wouldn't clear.
      clearUpdateCache(courseId);
      // Load FRESH from disk rather than reading from the `courses`
      // prop. The prop is captured at click time; by the time
      // `recheck` runs after a sync, the parent's `refreshCourses`
      // is mid-flight and the in-memory copy may still be the
      // pre-sync version. Reading from disk avoids the race —
      // `storage.loadCourse` returns the just-written course with
      // the freshly stamped `bundleSha`.
      try {
        const fresh = await storage.loadCourse(courseId);
        const r = await checkUpdateAvailable(fresh);
        setUpdates((prev) => ({ ...prev, [courseId]: r.available }));
      } catch {
        // Leave the previous value in place — a transient fetch
        // failure shouldn't clear a real signal.
      }
    },
    [],
  );

  const recheckAll = useCallback(async () => {
    // The user explicitly asked for a refresh; blow away the cache
    // so we actually re-fetch + re-hash rather than serving stale.
    clearUpdateCache();
    await checkAll(courses);
  }, [checkAll, courses]);

  return { updates, recheck, recheckAll };
}
