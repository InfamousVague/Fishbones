/// Persists which tabs the learner had open across app launches.
///
/// The desktop app boots with `openTabs = []`, then an auto-open effect
/// in App.tsx fires that lands the learner on `courses[0]`'s first
/// lesson. That's the wrong behaviour for returning users — they want
/// to pick up where they left off, not get yanked back to whatever the
/// catalog sorted to the front of the shelf.
///
/// This module owns the persistence boundary:
///   - `loadPersistedTabs()` is called as the initial state for
///     `useState(openTabs)`. Returns the snapshot if one exists, or a
///     sentinel `null` when there's no persisted state at all (so
///     first-launch users still get the auto-open convenience).
///   - `savePersistedTabs()` is called from a useEffect on every change.
///
/// Storage key is versioned (`v1`) so a future change to the snapshot
/// shape can ship without tripping on an old shape's leftovers — bump
/// the version, ignore the old key, write the new one.
///
/// We deliberately use `localStorage` (synchronous, available before
/// React paints) rather than going through `lib/storage.ts` (async,
/// SQLite/IndexedDB-backed). The state is small (< 1 KB), tolerates
/// loss, and reading it on the first paint matters more than
/// durability — synchronous availability lets us hydrate before the
/// auto-open effect runs, avoiding a flash of "library → auto-open
/// courses[0] → restore actual saved tabs" thrash.

export interface OpenCourse {
  courseId: string;
  lessonId: string;
}

export interface PersistedTabsSnapshot {
  tabs: OpenCourse[];
  activeIndex: number;
}

const STORAGE_KEY = "fishbones:open-tabs:v1";

/// Read the saved snapshot. Returns `null` when the key is missing
/// (first launch — caller should run its existing auto-open default)
/// or when the stored value fails to parse / validate (corruption —
/// caller falls back to the same auto-open default).
///
/// An empty `tabs: []` snapshot is intentional, NOT null: it means the
/// learner explicitly closed every tab last session and wanted the
/// library view. Returning `null` only in the truly-no-data case keeps
/// the "first run" path distinct from the "user chose library" path.
export function loadPersistedTabs(): PersistedTabsSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode Safari throws on getItem when storage is full.
    // Treat as "no data" — same outcome as a missing key.
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSnapshot(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

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

function isValidSnapshot(value: unknown): value is PersistedTabsSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PersistedTabsSnapshot>;
  if (!Array.isArray(v.tabs)) return false;
  if (typeof v.activeIndex !== "number") return false;
  if (!Number.isInteger(v.activeIndex) || v.activeIndex < 0) return false;
  for (const tab of v.tabs) {
    if (!tab || typeof tab !== "object") return false;
    const t = tab as Partial<OpenCourse>;
    if (typeof t.courseId !== "string" || t.courseId.length === 0) return false;
    if (typeof t.lessonId !== "string" || t.lessonId.length === 0) return false;
  }
  return true;
}
