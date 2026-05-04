/// Persists which tabs the learner had open at the moment of the
/// last write. Currently the app boots with `openTabs = []` (Library
/// route) every time, so we don't *re-hydrate* from this snapshot —
/// but we keep writing it so a future "Resume last session" button
/// (or telemetry) has something to read.
///
/// `validateTabsAgainstCourses` is exported because callers that DO
/// want to consume a snapshot (e.g. a future resume flow) need to
/// drop tabs whose course/lesson was uninstalled before re-mounting.
///
/// Storage key is versioned (`v1`) so a future change to the snapshot
/// shape can ship without tripping on an old shape's leftovers — bump
/// the version, ignore the old key, write the new one.
///
/// We deliberately use `localStorage` (synchronous, available before
/// React paints) rather than going through `lib/storage.ts` (async,
/// SQLite/IndexedDB-backed). The state is small (< 1 KB) and tolerates
/// loss.

export interface OpenCourse {
  courseId: string;
  lessonId: string;
}

export interface PersistedTabsSnapshot {
  tabs: OpenCourse[];
  activeIndex: number;
}

const STORAGE_KEY = "fishbones:open-tabs:v1";

/// Write the current open-tabs state. Silently no-ops when storage is
/// unavailable or write fails — losing one update doesn't break the
/// app, and surfacing the error would be noise.
export function savePersistedTabs(snapshot: PersistedTabsSnapshot): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode — fine, we'll try again next change */
  }
}

/// Drop tabs whose course or lesson no longer exists in the current
/// installed library. Stale references would crash LessonView — better
/// to silently filter and let the learner re-pick from the library.
///
/// Also clamps `activeIndex` into the new tabs[] range so the active-tab
/// pointer never goes out of bounds.
export function validateTabsAgainstCourses(
  snapshot: PersistedTabsSnapshot,
  courses: ReadonlyArray<{ id: string; chapters: ReadonlyArray<{ lessons: ReadonlyArray<{ id: string }> }> }>,
): PersistedTabsSnapshot {
  const valid = snapshot.tabs.filter((t) => {
    const course = courses.find((c) => c.id === t.courseId);
    if (!course) return false;
    return course.chapters.some((ch) => ch.lessons.some((l) => l.id === t.lessonId));
  });
  if (valid.length === snapshot.tabs.length) return snapshot;
  // At least one tab was filtered out — clamp the active index to the
  // surviving range. If the active tab was the one removed we land on
  // the same position (or the last surviving tab if we ran off the end).
  const activeIndex = Math.min(snapshot.activeIndex, Math.max(0, valid.length - 1));
  return { tabs: valid, activeIndex };
}

