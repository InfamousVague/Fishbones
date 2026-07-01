/// Mobile root. Renders a totally separate tree from the desktop App
/// — no TopBar, no Sidebar, no editor, no Playground, no AI orb.
/// Five bottom tabs: Library / Lesson / Practice / Profile / Settings.
///
/// The desktop App.tsx short-circuits to <MobileApp /> when the
/// `isMobile` predicate fires, so we don't pay for any of the
/// desktop chrome on phone-sized devices. Reuses the same hooks
/// (`useCourses`, `useProgress`, `useLibreCloud`, `useStreakAndXp`)
/// so progress, streak/XP, and account state flow through the existing
/// storage and relay backends without per-platform branches.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCourses } from "@/hooks/useCourses";
import { useCatalog } from "@/hooks/useCatalog";
import { useProgress } from "@/hooks/useProgress";
import { useLibreCloud } from "@/hooks/useLibreCloud";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useStreakAndXp } from "@/hooks/useStreakAndXp";
import { useWidgetSnapshot } from "./useWidgetSnapshot";
import {
  LIBRARY_INSTALLED_IDS_KEY,
  LIBRARY_MARKER_LESSON_ID,
  isLibraryMarkerRow,
  parseLibraryAllowlist,
  reconcilePerception,
  serializeLibraryAllowlist,
} from "@/lib/librarySync";
import { installCatalogEntryWeb } from "./installCatalogEntry";
import { track } from "@/lib/track";
import type { CatalogEntry } from "@/lib/catalog";
import { isHiddenCourse } from "@/lib/hiddenCourses";
import { unlockAudioContext } from "@/lib/sfx";
import { haptics } from "@/lib/haptics";
import type { Course, Lesson } from "@/data/types";
import { isoToUnixSeconds } from "@/lib/timestamps";
import MobileLibrary, { type LibraryPane } from "./MobileLibrary";
import MobileDiscover from "./MobileDiscover";
import MobileLesson from "./MobileLesson";
import MobilePlayground from "./MobilePlayground";
import MobileProfile from "./MobileProfile";
import MobileSettings from "./MobileSettings";
import PracticeView from "@/components/templates/Practice/PracticeView";
import MobileSearchPalette from "./MobileSearchPalette";
import SignInDialog from "@/components/organisms/dialogs/SignInDialog/SignInDialog";
import MobileTabBar, { type MobileTab } from "@/components/molecules/MobileTabBar/MobileTabBar";
import AiAssistant from "@/components/organisms/AiAssistant/AiAssistant";
import LibreLoader from "@/components/molecules/LibreLoader/LibreLoader";
import StreakExtendedOverlay from "./StreakExtendedOverlay";
import "./MobileApp.css";

type View =
  | "library"
  | "lesson"
  | "playground"
  | "practice"
  | "profile"
  | "settings";

interface ActiveLesson {
  course: Course;
  chapterIndex: number;
  lessonIndex: number;
}

export default function MobileApp() {
  const { courses: coursesAll, loaded, hydrateCourse, refresh: refreshCourses } =
    useCourses();
  const { catalog, loaded: catalogLoaded } = useCatalog();
  const {
    completed,
    history,
    markCompleted,
    markCompletedBatch,
    resetProgress,
    clearCourseCompletions,
    clearChapterCompletions,
  } = useProgress();
  const cloud = useLibreCloud();

  /// Cross-device library allowlist. Hydrated from localStorage on
  /// mount (so a cold-start before the cloud round-trips still shows
  /// the right set), updated by the realtime settings sync, and used
  /// to filter the visible course list. Null means "no published
  /// allowlist yet — render every local course" (mobile fresh-launch
  /// before any device has signed in).
  const [libraryAllowlist, setLibraryAllowlist] = useState<Set<string> | null>(
    () => {
      try {
        return parseLibraryAllowlist(localStorage.getItem(LIBRARY_INSTALLED_IDS_KEY));
      } catch {
        return null;
      }
    },
  );

  /// Library-marker-derived allowlist. Updated by the progress
  /// apply path whenever a marker row arrives from the relay. Lets
  /// desktop's installed-library list propagate even when the
  /// `/settings` endpoint isn't deployed (the marker
  /// rows ride the always-available `/progress` endpoint
  /// instead). Persisted to localStorage so a cold-start before
  /// the next pull settles still shows the right library.
  const SYNCED_LIBRARY_KEY = "libre.library.markers.v1";
  const [syncedLibraryIds, setSyncedLibraryIds] = useState<Set<string> | null>(
    () => {
      try {
        const raw = localStorage.getItem(SYNCED_LIBRARY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return null;
        const ids = parsed.filter((v): v is string => typeof v === "string");
        return new Set(ids);
      } catch {
        return null;
      }
    },
  );

  /// Visible course list. Three signals, in priority order:
  ///
  ///   1. **Library markers** — sentinel rows desktop pushes to
  ///      `/progress` carrying its installed-course-id
  ///      list. AUTHORITATIVE when present: desktop owns the
  ///      library (mobile has no Discover catalog), so seeing
  ///      markers means "show exactly these courses, hide the
  ///      rest." Fixes the case where mobile's web seed has 19
  ///      bundled books but desktop has only installed 11 of them.
  ///
  ///   2. **Settings allowlist** — the legacy path, populated by
  ///      `applySettings` when the relay's `/settings`
  ///      endpoint is deployed. Several relay deployments 404 on
  ///      this; markers (above) cover that gap.
  ///
  ///   3. **Completion-derived** — any course referenced by a
  ///      completion in `completed`. Backstop for the case where
  ///      neither marker nor allowlist sync has landed yet but the
  ///      user has progress. Less complete than (1) — won't
  ///      surface installed-but-untouched books — but better than
  ///      a fully empty library.
  ///
  /// When signed-out, we pass through the local seed so the
  /// first-launch experience isn't an empty shell. Once signed in
  /// AND we have any signal, the strict regime takes over.
  const courses = useMemo(() => {
    // Drop hidden courses up-front — these are installable via direct
    // URL / import but never surface in the Library tree (matches the
    // desktop App.tsx filter). Two checks: the saved-record `hidden`
    // flag (fresh seeds pick this up from the manifest), AND the
    // runtime `isHiddenCourse(id)` allow-list (catches existing
    // installs from before the flag was added — see
    // `lib/hiddenCourses.ts`). The runtime check is what makes the
    // filter work on devices that already had the course in
    // IndexedDB before the manifest flag flipped.
    const visibleAll = coursesAll.filter(
      (c) => !c.hidden && !isHiddenCourse(c.id),
    );
    if (!cloud.signedIn) return visibleAll;
    // Markers are authoritative — when present they REPLACE every
    // other signal, since they encode desktop's full list.
    if (syncedLibraryIds && syncedLibraryIds.size > 0) {
      return visibleAll.filter((c) => syncedLibraryIds.has(c.id));
    }
    // Backstop: settings allowlist OR completion-derived ids.
    const touchedCourseIds = new Set<string>();
    for (const key of completed) {
      const colon = key.indexOf(":");
      if (colon > 0) touchedCourseIds.add(key.slice(0, colon));
    }
    const haveAllowlist = libraryAllowlist !== null;
    const haveCompletions = touchedCourseIds.size > 0;
    if (!haveAllowlist && !haveCompletions) {
      // No signal at all — fresh sign-in, sync hasn't landed.
      // Show the seed (still hidden-filtered) so the user has
      // something while we wait.
      return visibleAll;
    }
    return visibleAll.filter(
      (c) =>
        (libraryAllowlist?.has(c.id) ?? false) ||
        touchedCourseIds.has(c.id),
    );
  }, [
    coursesAll,
    libraryAllowlist,
    syncedLibraryIds,
    completed,
    cloud.signedIn,
  ]);

  const stats = useStreakAndXp(history, courses);

  // ── Streak-extension celebration ───────────────────────────────
  // Watches `stats.streakDays` for an INCREASE and fires the
  // full-screen overlay. Skips the very first observation each
  // session so a learner who already has a multi-day streak when
  // they cold-launch the app doesn't get a celebration just for
  // opening it — only ACTUAL extensions (a fresh completion that
  // rolled the count forward) should trigger.
  //
  // `lastSeenStreakRef === null` means "we haven't observed any
  // stats yet" — the first useEffect run sets it to the current
  // count without showing the overlay. Subsequent runs compare
  // and show on strict increase.
  const [streakOverlayOpen, setStreakOverlayOpen] = useState(false);
  const lastSeenStreakRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastSeenStreakRef.current === null) {
      lastSeenStreakRef.current = stats.streakDays;
      return;
    }
    if (
      stats.streakDays > lastSeenStreakRef.current &&
      stats.streakDays > 0
    ) {
      setStreakOverlayOpen(true);
    }
    lastSeenStreakRef.current = stats.streakDays;
  }, [stats.streakDays]);

  // Publish the snapshot the iOS widgets + watchOS app read on
  // every render where streak / library / completions changed.
  // The hook handles its own debounce + dedupe so this is cheap.
  // No-op on non-iOS targets (the underlying Tauri command bails
  // out on platforms without an App Group container).
  useWidgetSnapshot({ courses, completed, history, stats });

  /// Real-time cross-device sync. Identical wiring to the desktop
  /// App.tsx — pulls progress / solutions / settings on sign-in,
  /// subscribes to the relay's WS bus, and exposes debounced push
  /// helpers that `markCompleted` below feeds into. Without this
  /// the phone stayed silent on the sync bus: the desktop's writes
  /// landed but the phone never echoed its own back, so a lesson
  /// marked complete on the phone never showed up on the desktop
  /// (and vice-versa).
  const realtime = useRealtimeSync({
    cloud,
    applyProgress: useCallback(
      (
        rows: Array<{
          course_id: string;
          lesson_id: string;
          /// ISO 8601 — the relay's wire format. We convert to unix
          /// seconds before handing to `markCompletedBatch` so the
          /// local history carries the original completion time
          /// across devices (without this, sign-in stamped every
          /// pulled row with `now()` and the streak/level/heatmap
          /// collapsed to a single day).
          completed_at: string;
        }>,
      ) => {
        // Split incoming rows into two streams:
        //   - real completions → markCompletedBatch (XP / streak)
        //   - library-marker rows (sentinel lesson id) →
        //     `syncedLibraryIds` set, used by the visible-courses
        //     filter so mobile converges on desktop's installed
        //     library even when the relay's settings endpoint 404s.
        const real: typeof rows = [];
        const markerCourseIds: string[] = [];
        for (const r of rows) {
          if (isLibraryMarkerRow(r)) markerCourseIds.push(r.course_id);
          else real.push(r);
        }
        // Bulk-apply real completions: one IDB tx + one React
        // setState pass for the whole batch. The previous per-row
        // path triggered 150+ separate transactions on a typical
        // sign-in, and on iOS WKWebView the awaited per-row reads
        // silently deactivated the tx so half the writes never
        // landed (the root cause of "phone shows 3-day streak
        // even after pull").
        markCompletedBatch(
          real.map((r) => ({
            courseId: r.course_id,
            lessonId: r.lesson_id,
            completedAtSec: isoToUnixSeconds(r.completed_at) ?? undefined,
          })),
        );
        if (markerCourseIds.length > 0) {
          setSyncedLibraryIds((prev) => {
            // Replace semantics: each pull/WS event is a fresh
            // snapshot of the desktop's installed list, so we
            // overwrite rather than union. (Union would let
            // removed-on-desktop books linger forever on mobile.)
            const next = new Set(markerCourseIds);
            // Mirror into localStorage so cold-start sees it before
            // the next sync round.
            try {
              localStorage.setItem(
                SYNCED_LIBRARY_KEY,
                JSON.stringify(Array.from(next).sort()),
              );
            } catch {
              /* swallow */
            }
            // Bail out of the setState if nothing changed — saves
            // a re-render of the library + tab bar on every WS tick.
            if (prev && prev.size === next.size) {
              let same = true;
              for (const id of next) {
                if (!prev.has(id)) {
                  same = false;
                  break;
                }
              }
              if (same) return prev;
            }
            return next;
          });
        }
      },
      [markCompletedBatch],
    ),
    applyProgressCleared: useCallback(
      (courseId: string, lessonIds: string[] | null) => {
        // Mirror desktop App.tsx — when a sibling device sends a
        // scoped reset (sidebar "Reset progress", chapter reset,
        // single-lesson mark-incomplete), drop matching rows here
        // so mobile converges instead of showing stale completions
        // for content the user already cleared elsewhere.
        // Mobile's own UI only exposes the whole-library "Reset
        // local progress" (handled by `resetProgress`), so we
        // never originate `progress_cleared` from this client —
        // we only ever HONOUR it.
        if (lessonIds && lessonIds.length > 0) {
          clearChapterCompletions(courseId, lessonIds);
        } else {
          clearCourseCompletions(courseId);
        }
      },
      [clearCourseCompletions, clearChapterCompletions],
    ),
    applySolutions: useCallback(
      (
        rows: Array<{ course_id: string; lesson_id: string; content: string }>,
      ) => {
        // Persist into the same workbench-localStorage key the desktop
        // uses, so the next mount of the lesson picks up the synced
        // version. Mobile doesn't render the workbench tab strip —
        // lessons run via a single solution string — but the storage
        // key shape is shared and deterministic.
        for (const r of rows) {
          try {
            const key = `kata:workbench:v1:${r.course_id}:${r.lesson_id}`;
            const previous = localStorage.getItem(key);
            const sig = previous
              ? (JSON.parse(previous) as { signature?: string }).signature ??
                ""
              : "";
            const parsed = JSON.parse(r.content) as unknown;
            const files = Array.isArray(parsed) ? parsed : null;
            if (!files) continue;
            localStorage.setItem(
              key,
              JSON.stringify({
                signature: sig,
                files,
                savedAt: Date.now(),
              }),
            );
          } catch {
            /* swallow — best-effort sync */
          }
        }
      },
      [],
    ),
    applySettings: useCallback(
      (rows: Array<{ key: string; value: string }>) => {
        for (const r of rows) {
          try {
            localStorage.setItem(r.key, r.value);
          } catch {
            /* swallow */
          }
          // The library allowlist piggybacks on the settings sync.
          // Re-parse and lift into React state so the visible-courses
          // memo invalidates and the library re-renders against the
          // freshly-pulled set without a focus-refresh round-trip.
          if (r.key === LIBRARY_INSTALLED_IDS_KEY) {
            setLibraryAllowlist(parseLibraryAllowlist(r.value));
          }
        }
      },
      [],
    ),
  });

  /// Mobile-side library push. Bidirectional by design — when the
  /// user adds or removes a course locally (e.g. a future "import
  /// course" path), we want desktop to learn about it. Gated on
  /// `libraryAllowlist !== null` so the 19-course first-launch seed
  /// doesn't clobber a desktop user's curated list before we've even
  /// pulled their value: mobile waits to see the cloud baseline,
  /// then reconciles by adding / removing only the IDs that actually
  /// changed locally vs the previous snapshot. That way a user
  /// installing a new course on the phone EXTENDS the cloud set
  /// instead of replacing it with the phone's local subset.
  const previousLocalIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const localIds = coursesAll.map((c) => c.id);
    const previous = previousLocalIdsRef.current;
    previousLocalIdsRef.current = new Set(localIds);
    // First observation of the local list — initialise the ref but
    // don't push (we haven't seen any user action yet, just the
    // bootloader handing us the seed).
    if (previous === null) return;
    if (!cloud.signedIn || !libraryAllowlist) return;
    const next = reconcilePerception(libraryAllowlist, localIds, previous);
    const serializedNext = serializeLibraryAllowlist(next);
    const serializedCurrent = serializeLibraryAllowlist(libraryAllowlist);
    if (serializedNext === serializedCurrent) return;
    setLibraryAllowlist(next);
    try {
      localStorage.setItem(LIBRARY_INSTALLED_IDS_KEY, serializedNext);
    } catch {
      /* swallow */
    }
    realtime.pushSetting({
      key: LIBRARY_INSTALLED_IDS_KEY,
      value: serializedNext,
      updated_at: new Date().toISOString(),
    });
  }, [coursesAll, loaded, cloud.signedIn, libraryAllowlist, realtime]);

  /// Which pane the Library tab shows — the installed library (default)
  /// or the Discover catalog. Lives here (not inside MobileLibrary) so
  /// both MobileLibrary and MobileDiscover share the same toggle state
  /// and the install handler below can flip back to "library" after a
  /// course lands.
  const [libraryPane, setLibraryPane] = useState<LibraryPane>("library");
  /// Catalog ids with a download in flight. Drives the per-tile
  /// spinner in Discover; cleared in the install handler's `finally`.
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

  /// Install a catalog course on mobile.
  ///
  /// Flow (mirrors desktop's `handleInstallCatalogEntry` + adds the
  /// mobile-only library-set bookkeeping the desktop gets from its
  /// bundled-packs seed):
  ///
  ///   1. Fetch + persist the course JSON via `installCatalogEntryWeb`
  ///      (which stamps `coverFetchedAt` so the web cover renders).
  ///   2. `refreshCourses()` so `coursesAll` picks up the new record
  ///      and the Library shelf re-derives.
  ///   3. Add the id to BOTH library sets so it survives MobileApp's
  ///      visibility filter immediately AND rides sync to desktop:
  ///        - `syncedLibraryIds` (+ `libre.library.markers.v1` +
  ///          a `pushProgress` marker row) — AUTHORITATIVE in the
  ///          filter when non-empty, so this is what makes the course
  ///          appear right now on a signed-in device whose desktop
  ///          markers already populated the set.
  ///        - `libraryAllowlist` (+ `LIBRARY_INSTALLED_IDS_KEY` +
  ///          a `pushSetting`) — the backstop path, and the value the
  ///          settings-based sync round-trips.
  ///      Updating both keeps every branch of the filter (and both
  ///      relay transports) consistent regardless of which sync
  ///      signals have landed on this device.
  ///
  /// The background push effect above would eventually extend the
  /// allowlist on its own (it watches `coursesAll`), but only when a
  /// cloud baseline already exists; doing it explicitly here also
  /// covers the null-baseline case and the authoritative marker set,
  /// so a freshly-installed course is never briefly hidden.
  const installEntry = useCallback(
    async (entry: CatalogEntry) => {
      if (installingIds.has(entry.id)) return;
      setInstallingIds((prev) => new Set(prev).add(entry.id));
      try {
        await installCatalogEntryWeb(entry);
        await refreshCourses();
        await hydrateCourse(entry.id);

        // ── Marker set (authoritative in the visibility filter) ──
        setSyncedLibraryIds((prev) => {
          const next = new Set(prev ?? []);
          next.add(entry.id);
          try {
            localStorage.setItem(
              SYNCED_LIBRARY_KEY,
              JSON.stringify(Array.from(next).sort()),
            );
          } catch {
            /* swallow */
          }
          return next;
        });
        // Ride the always-available /progress transport to desktop.
        realtime.pushProgress({
          course_id: entry.id,
          lesson_id: LIBRARY_MARKER_LESSON_ID,
          completed_at: new Date().toISOString(),
        });

        // ── Allowlist set (backstop path + settings transport) ──
        setLibraryAllowlist((prev) => {
          const next = new Set(prev ?? []);
          next.add(entry.id);
          const serialized = serializeLibraryAllowlist(next);
          try {
            localStorage.setItem(LIBRARY_INSTALLED_IDS_KEY, serialized);
          } catch {
            /* swallow */
          }
          realtime.pushSetting({
            key: LIBRARY_INSTALLED_IDS_KEY,
            value: serialized,
            updated_at: new Date().toISOString(),
          });
          return next;
        });

        track.courseInstall({ courseId: entry.id, source: "discover" });
        void haptics.success();
      } catch (e) {
        console.error("[libre] mobile install failed:", e);
        alert(
          `Couldn't install ${entry.title}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setInstallingIds((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [installingIds, refreshCourses, hydrateCourse, realtime],
  );

  const [view, setView] = useState<View>("library");
  const [active, setActive] = useState<ActiveLesson | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  // Cmd+K-style search overlay state. Lives at the app level (not
  // per-view) so any screen can pop the palette and any result can
  // navigate to a lesson without prop-drilling — and so the same
  // input survives a tab switch if the user dismisses without
  // selecting.
  const [searchOpen, setSearchOpen] = useState(false);

  // Hand off from index.html's inline preloader to our React loader.
  // Runs in a layout-effect (post-DOM-mutate, pre-paint) so the inline
  // preloader fades exactly when `<LibreLoader>` is on screen —
  // no black gap on cold-start. Safe to run once; the safety timeout
  // in main.tsx is a no-op if we got here first.
  useLayoutEffect(() => {
    document.body.classList.add("is-booted");
  }, []);

  // First user gesture: warm the AudioContext so the very first
  // achievement-unlock / level-up sfx pip plays without the iOS-
  // Safari silent-first-play wart. Without this the first
  // `playSound()` call after page load gets a suspended context and
  // the cue is silent — works for subsequent cues but the first
  // unlock of a session always missed.
  //
  // Mirrors the same effect in App.tsx (desktop). MobileApp was
  // missing it, which is why on phone the first achievement /
  // level-up after a fresh launch had no audio while later cues
  // worked fine. `pointerdown` covers both touch + mouse + pen
  // without overlapping with React's onClick (which fires later
  // and is too late to satisfy the autoplay policy).
  useEffect(() => {
    const onGesture = async () => {
      // Keep listening until the context actually reaches "running" —
      // on WKWebView the first gesture occasionally fails to flip it.
      // The silent-buffer kick inside `unlockAudioContext` runs
      // synchronously (before its first await), so the gesture still
      // counts as user-initiated playback despite the async handler.
      const unlocked = await unlockAudioContext();
      if (unlocked) window.removeEventListener("pointerdown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    return () => window.removeEventListener("pointerdown", onGesture);
  }, []);

  const lesson: Lesson | null = useMemo(() => {
    if (!active) return null;
    const ch = active.course.chapters[active.chapterIndex];
    if (!ch) return null;
    return ch.lessons[active.lessonIndex] ?? null;
  }, [active]);

  const openLesson = async (course: Course, chapterIndex: number, lessonIndex: number) => {
    const hydrated = await hydrateCourse(course.id);
    setActive({ course: hydrated ?? course, chapterIndex, lessonIndex });
    setView("lesson");
  };

  /// Open an installed course by id at its first incomplete lesson.
  /// Used by Discover's "Installed" tiles so tapping a course the
  /// learner already has jumps straight into it (rather than a no-op).
  /// Resolves against `courses` — the visibility-filtered list — which
  /// includes the course as soon as it's installed. Bails quietly if
  /// the course somehow isn't found or has no lessons.
  const openCourseById = async (courseId: string) => {
    const course = coursesAll.find((c) => c.id === courseId);
    if (!course) return;
    const key = (lessonId: string) => `${course.id}:${lessonId}`;
    for (let ci = 0; ci < course.chapters.length; ci++) {
      const ch = course.chapters[ci];
      for (let li = 0; li < ch.lessons.length; li++) {
        if (!completed.has(key(ch.lessons[li].id))) {
          await openLesson(course, ci, li);
          return;
        }
      }
    }
    // Every lesson complete (or no completions store hit) — open the
    // very first lesson so the tap still does something.
    if (course.chapters[0]?.lessons[0]) {
      await openLesson(course, 0, 0);
    }
  };

  const goNext = () => {
    if (!active) return;
    const ch = active.course.chapters[active.chapterIndex];
    if (!ch) return;
    if (active.lessonIndex + 1 < ch.lessons.length) {
      setActive({ ...active, lessonIndex: active.lessonIndex + 1 });
      return;
    }
    if (active.chapterIndex + 1 < active.course.chapters.length) {
      setActive({
        ...active,
        chapterIndex: active.chapterIndex + 1,
        lessonIndex: 0,
      });
    }
  };

  const goPrev = () => {
    if (!active) return;
    if (active.lessonIndex > 0) {
      setActive({ ...active, lessonIndex: active.lessonIndex - 1 });
      return;
    }
    if (active.chapterIndex > 0) {
      const prevCh = active.course.chapters[active.chapterIndex - 1];
      setActive({
        ...active,
        chapterIndex: active.chapterIndex - 1,
        lessonIndex: Math.max(0, prevCh.lessons.length - 1),
      });
    }
  };

  const hasPrev = active
    ? active.chapterIndex > 0 || active.lessonIndex > 0
    : false;
  const hasNext = active
    ? active.chapterIndex + 1 < active.course.chapters.length ||
      active.lessonIndex + 1 < active.course.chapters[active.chapterIndex].lessons.length
    : false;

  const onComplete = () => {
    if (!active || !lesson) return;
    void markCompleted(active.course.id, lesson.id);
    // Mirror to the realtime sync bus so the desktop (and other phones
    // signed into the same account) see this lesson tick green within
    // a network round-trip. Coalesced + fire-and-forget — the local
    // mark already succeeded, the relay echo is best-effort.
    realtime.pushProgress({
      course_id: active.course.id,
      lesson_id: lesson.id,
      completed_at: new Date().toISOString(),
    });
    // Triple-pulse celebration — the same `notification-success`
    // intent the desktop fires on test-pass, but on mobile this
    // is THE moment of triumph for reading lessons too. Pairs
    // with the in-app celebration VFX timing-wise; the haptic
    // hits a touch before the visual peak so the buzz reads as
    // cause, not coincident effect.
    void haptics.success();
    goNext();
  };

  // Used by the Settings "Reset local progress" button. We reset the
  // hook's in-memory + storage state in one shot.
  const resetLocalProgress = async () => {
    await resetProgress();
  };

  // Map app view → tab id. The tab bar's "courses" segment is for the
  // active lesson; everything else is a 1:1 view-to-tab mapping.
  const activeTab: MobileTab =
    view === "lesson"
      ? "courses"
      : view === "playground"
        ? "playground"
        : view === "practice"
          ? "practice"
          : view === "profile"
            ? "profile"
            : view === "settings"
              ? "settings"
              : "library";

  return (
    <div className="m-app">
      {!loaded && (
        <div className="m-app__boot">
          <LibreLoader label="loading" />
        </div>
      )}

      <main className="m-app__main">
        {view === "library" && libraryPane === "library" && (
          <MobileLibrary
            courses={courses}
            completed={completed}
            // `history` threads through so the library can sort by
            // most-recent activity (last lesson completion per
            // course). Without it, the library can only check the
            // completed-Set's CARDINALITY per course, not when each
            // completion happened — so a course you finished a lesson
            // in 2 minutes ago and one you touched 6 months ago
            // would tie. With history we can pick the freshest
            // completion's timestamp.
            history={history}
            pane={libraryPane}
            onPaneChange={setLibraryPane}
            onOpenLesson={openLesson}
            onOpenSearch={() => setSearchOpen(true)}
            // Pull-to-refresh → realtime resync. Pulls progress
            // (and library markers) from the relay, applies via
            // earliest-wins merge so the visible library + streak
            // / level converge with desktop.
            onRefresh={() => realtime.resync()}
          />
        )}
        {view === "library" && libraryPane === "discover" && (
          <MobileDiscover
            catalog={catalog}
            // Pass the full unfiltered local set (coursesAll), not the
            // visibility-filtered `courses`: Discover's "Installed"
            // state must reflect what's actually in IndexedDB, even
            // for a course that a stale marker set would hide on the
            // Library shelf. (In practice the install handler adds new
            // ids to the marker set immediately, so the two agree.)
            installed={coursesAll}
            loaded={catalogLoaded}
            installingIds={installingIds}
            pane={libraryPane}
            onPaneChange={setLibraryPane}
            onInstall={(entry) => void installEntry(entry)}
            onOpen={(courseId) => void openCourseById(courseId)}
          />
        )}
        {view === "lesson" && active && lesson && (
          <MobileLesson
            course={active.course}
            chapterIndex={active.chapterIndex}
            lessonIndex={active.lessonIndex}
            lesson={lesson}
            completed={completed}
            onBack={() => setView("library")}
            onComplete={onComplete}
            onPrev={hasPrev ? goPrev : undefined}
            onNext={hasNext ? goNext : undefined}
            onJump={(ci, li) =>
              setActive({ course: active.course, chapterIndex: ci, lessonIndex: li })
            }
            isCompleted={completed.has(`${active.course.id}:${lesson.id}`)}
          />
        )}
        {view === "playground" && <MobilePlayground />}
        {view === "practice" && (
          <PracticeView
            courses={courses}
            completed={completed}
            history={history}
            onOpenLesson={(courseId, lessonId) => {
              // Practice uses (courseId, lessonId) string keys; the
              // mobile openLesson wants (course, chapterIndex,
              // lessonIndex). Resolve the indices off the live
              // course tree before handing off.
              const course = courses.find((c) => c.id === courseId);
              if (!course) return;
              for (let ci = 0; ci < course.chapters.length; ci++) {
                const li = course.chapters[ci].lessons.findIndex(
                  (l) => l.id === lessonId,
                );
                if (li >= 0) {
                  void openLesson(course, ci, li);
                  return;
                }
              }
            }}
          />
        )}
        {view === "profile" && (
          <MobileProfile
            courses={courses}
            history={history}
            stats={stats}
            completed={completed}
            onOpenLesson={openLesson}
            onOpenSearch={() => setSearchOpen(true)}
            // Profile owns the entry point to Settings now that the
            // tab bar has dropped its dedicated Settings button.
            // Tapping the gear on Profile flips us to the settings
            // view — same render path as the old tab-bar button
            // used.
            onOpenSettings={() => setView("settings")}
            // Pull-to-refresh → realtime resync. Stats / heatmap
            // re-derive from the freshly-pulled history.
            onRefresh={() => realtime.resync()}
          />
        )}
        {view === "settings" && (
          <MobileSettings
            cloud={cloud}
            realtime={realtime}
            history={history}
            courses={courses}
            onRequestSignIn={() => setSignInOpen(true)}
            onResetProgress={resetLocalProgress}
          />
        )}
      </main>

      <MobileTabBar
        active={activeTab}
        // Light selection haptic on every tab switch — the
        // physical "tick" of moving between screens, modelled on
        // iOS's native tab-bar feel. Fires BEFORE `setView` so
        // the buzz lands as cause-of-transition rather than a
        // reaction to it.
        onLibrary={() => {
          void haptics.selection();
          setView("library");
        }}
        onPlayground={() => {
          void haptics.selection();
          setView("playground");
        }}
        onPractice={() => {
          void haptics.selection();
          setView("practice");
        }}
        onProfile={() => {
          void haptics.selection();
          setView("profile");
        }}
      />

      {/* Floating AI assistant. Same component as the desktop, but
          the underlying `useAiChat` hook autoselects the remote
          variant on mobile (see src/hooks/useAiChat.ts) — phone HTTPs
          straight to the user's configured Ollama host (typically a
          Mac on their Tailscale tailnet). When unconfigured the orb
          still mounts but probe reports unreachable, so the panel
          shows a "set the host in Settings" message rather than
          trying to drive a setup flow that wouldn't work on iOS. */}
      <AiAssistant
        lesson={active && lesson ? lesson : null}
        course={active?.course ?? null}
      />

      {signInOpen && (
        <SignInDialog
          cloud={cloud}
          onClose={() => setSignInOpen(false)}
        />
      )}

      {/* Streak-extension celebration. Renders unconditionally so
          the mount + animation flow runs cleanly on each
          extension; the `open` prop drives visibility internally
          and the component returns null when closed. Hosted here
          (above the search palette + sign-in dialog) so the
          overlay floats above every page surface. */}
      <StreakExtendedOverlay
        open={streakOverlayOpen}
        streakDays={stats.streakDays}
        history={history}
        onClose={() => setStreakOverlayOpen(false)}
      />

      <MobileSearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        courses={courses}
        onOpenLesson={openLesson}
      />
    </div>
  );
}
