import { useEffect, useState } from "react";
import { storage, type Completion } from "@/lib/storage";
import {
  clearWorkbenchForChapter,
  clearWorkbenchForCourse,
  clearWorkbenchForLesson,
} from "./useWorkbenchFiles";

export type { Completion };

/// Syncs the "completed lessons" Set to the active storage backend
/// (SQLite via Tauri on desktop, IndexedDB on web). The Set is the
/// source of truth while the app is open; on first mount we
/// rehydrate from storage, and markCompleted writes through.
/// `history` gives the same data as a timestamped array, for
/// streak / XP math.
///
/// Falls back gracefully when storage throws (e.g. older Tauri DB
/// migration mid-flight, IndexedDB unavailable in private mode) so
/// the UI still renders and lets the learner read.
export function useProgress() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Completion[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await storage.listCompletions();
        if (cancelled) return;
        const s = new Set<string>();
        for (const r of rows) s.add(`${r.course_id}:${r.lesson_id}`);
        setCompleted(s);
        setHistory(rows);
      } catch {
        // Storage unavailable — stay with the empty set so the UI
        // renders. Reads-only behaviour for the session.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /// Mark a lesson complete. `completedAtSec` is unix seconds; when
  /// omitted we stamp `now()` (the local "I just finished this" path).
  /// The cloud-sync path passes the row's original timestamp from the
  /// relay so cross-device sync preserves the actual completion time
  /// — without this, a fresh device pulling 100+ history rows
  /// stamped them all with `now()`, collapsing the activity heatmap
  /// to a single "today" column and the streak to one day.
  ///
  /// In-memory updates use "earliest wins" merge semantics to match
  /// the storage layer: if we already have a record for this lesson
  /// at an earlier timestamp, keep the earlier one. Avoids a
  /// late-arriving sync row backdating a freshly self-marked lesson
  /// to a value newer than what the user just did.
  function markCompleted(
    courseId: string,
    lessonId: string,
    completedAtSec?: number,
  ) {
    const key = `${courseId}:${lessonId}`;
    const supplied = completedAtSec ?? Math.floor(Date.now() / 1000);
    setCompleted((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setHistory((prev) => {
      const existingIdx = prev.findIndex(
        (r) => r.course_id === courseId && r.lesson_id === lessonId,
      );
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        const merged = Math.min(existing.completed_at, supplied);
        if (merged === existing.completed_at) return prev;
        const next = prev.slice();
        next[existingIdx] = { ...existing, completed_at: merged };
        return next;
      }
      return [
        ...prev,
        {
          course_id: courseId,
          lesson_id: lessonId,
          completed_at: supplied,
        },
      ];
    });
    // Fire-and-forget persistence. Storage layer also runs the
    // "earliest wins" merge so the on-disk row matches the in-memory
    // history regardless of which arrived first.
    storage.markCompletion(courseId, lessonId, supplied).catch(() => {});
  }

  /// Bulk-apply many completions at once. Used by the cloud-sync
  /// apply path so a 150-row pull doesn't trigger 150 React renders
  /// + 150 IDB transactions. One setState merges every row into
  /// `completed` + `history` (earliest-wins per id), one storage
  /// call writes them all in a single transaction.
  ///
  /// Each row's `completedAtSec` may be undefined → fall back to
  /// `now()` like the single-row path. The cloud-sync path always
  /// supplies one (converted from the relay's ISO 8601 timestamp);
  /// this is just defensive.
  function markCompletedBatch(
    rows: ReadonlyArray<{
      courseId: string;
      lessonId: string;
      completedAtSec?: number;
    }>,
  ) {
    if (rows.length === 0) return;
    const nowSec = Math.floor(Date.now() / 1000);
    // Pre-resolve every supplied timestamp so the storage call and
    // the React state merge see identical values.
    const resolved = rows.map((r) => ({
      courseId: r.courseId,
      lessonId: r.lessonId,
      completedAt: r.completedAtSec ?? nowSec,
    }));
    setCompleted((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const r of resolved) {
        const key = `${r.courseId}:${r.lessonId}`;
        if (!next.has(key)) {
          next.add(key);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
    setHistory((prev) => {
      // Index existing rows for O(N+M) merge instead of O(N*M).
      const byKey = new Map<string, number>();
      prev.forEach((row, i) =>
        byKey.set(`${row.course_id}:${row.lesson_id}`, i),
      );
      const next = prev.slice();
      let mutated = false;
      for (const r of resolved) {
        const key = `${r.courseId}:${r.lessonId}`;
        const existingIdx = byKey.get(key);
        if (existingIdx !== undefined) {
          const existing = next[existingIdx];
          const merged = Math.min(existing.completed_at, r.completedAt);
          if (merged !== existing.completed_at) {
            next[existingIdx] = { ...existing, completed_at: merged };
            mutated = true;
          }
          continue;
        }
        next.push({
          course_id: r.courseId,
          lesson_id: r.lessonId,
          completed_at: r.completedAt,
        });
        byKey.set(key, next.length - 1);
        mutated = true;
      }
      return mutated ? next : prev;
    });
    storage.markCompletionsBulk(resolved).catch(() => {});
  }

  /// Reset a single lesson's completion. Drops the key from the in-memory
  /// Set and history array immediately so progress rings update without
  /// a re-fetch, then fires the matching storage delete.
  ///
  /// Also clears the per-lesson workbench (saved editor content) so the
  /// reset puts the lesson back to its starter state — without this,
  /// "Reset progress" only cleared the completion checkmark while the
  /// learner's last solution stayed in localStorage and re-loaded
  /// the next time they opened the lesson.
  function clearLessonCompletion(courseId: string, lessonId: string) {
    const key = `${courseId}:${lessonId}`;
    setCompleted((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setHistory((prev) =>
      prev.filter((r) => !(r.course_id === courseId && r.lesson_id === lessonId)),
    );
    storage.clearLessonCompletion(courseId, lessonId).catch(() => {});
    clearWorkbenchForLesson(courseId, lessonId);
  }

  /// Reset every lesson in a chapter. We don't have a chapter id in the schema
  /// (completions are flat per-lesson) so the caller passes in the list of
  /// lesson_ids that belong to the chapter. Local state updates happen in one
  /// batched setState; the storage deletes are fired in parallel.
  ///
  /// Workbench files for each chapter lesson get nuked alongside the
  /// completion records so the reset is a true "back to starter" rather
  /// than just clearing checkmarks (see `clearLessonCompletion` for the
  /// rationale).
  function clearChapterCompletions(courseId: string, lessonIds: string[]) {
    if (lessonIds.length === 0) return;
    const keys = new Set(lessonIds.map((id) => `${courseId}:${id}`));
    const lessonIdSet = new Set(lessonIds);
    setCompleted((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const k of keys) {
        if (next.delete(k)) mutated = true;
      }
      return mutated ? next : prev;
    });
    setHistory((prev) =>
      prev.filter(
        (r) => !(r.course_id === courseId && lessonIdSet.has(r.lesson_id)),
      ),
    );
    storage.clearChapterCompletions(courseId, lessonIds).catch(() => {});
    clearWorkbenchForChapter(courseId, lessonIds);
  }

  /// Reset every completion for a course. Single command call instead of
  /// per-lesson fan-out — the backend has a course-scoped DELETE.
  ///
  /// Also wipes every saved workbench under this course so the editor
  /// shows the original starter on the next visit (and any currently-
  /// mounted LessonView snaps back via the broadcast inside
  /// `clearWorkbenchForCourse`).
  function clearCourseCompletions(courseId: string) {
    setCompleted((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const k of prev) {
        if (k.startsWith(`${courseId}:`)) {
          next.delete(k);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
    setHistory((prev) => prev.filter((r) => r.course_id !== courseId));
    storage.clearCourseCompletions(courseId).catch(() => {});
    clearWorkbenchForCourse(courseId);
  }

  /// Wipe ALL local completions + history. Used by the mobile Settings
  /// "Reset local progress" button. We iterate distinct course ids in
  /// the current `completed` set and delegate to the per-course clear
  /// API on the storage backend, then reset in-memory state.
  /// Cloud-synced devices keep their own copies — this is local-only.
  async function resetProgress() {
    const courseIds = new Set<string>();
    for (const k of completed) courseIds.add(k.split(":", 1)[0]);
    for (const r of history) courseIds.add(r.course_id);
    await Promise.all(
      Array.from(courseIds).map((id) =>
        storage.clearCourseCompletions(id).catch(() => {}),
      ),
    );
    // Drop every per-lesson workbench so the wipe is a true back-to-
    // starter — same rationale as `clearCourseCompletions`. Walks each
    // touched course; lives mostly in localStorage so this is cheap.
    for (const id of courseIds) {
      clearWorkbenchForCourse(id);
    }
    setCompleted(new Set());
    setHistory([]);
  }

  return {
    completed,
    history,
    markCompleted,
    markCompletedBatch,
    clearLessonCompletion,
    clearChapterCompletions,
    clearCourseCompletions,
    resetProgress,
    loaded,
  };
}
