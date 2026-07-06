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
import { useStreakAndXp, xpForLessonKind } from "@/hooks/useStreakAndXp";
import { useStreakShields } from "@/hooks/useStreakShields";
import type { CloudStats } from "@/hooks/useLibreCloud";
import { harvestPracticeItems } from "@/components/templates/Practice/practiceHarvest";
import { loadAllRecords, summariseStats } from "@/components/templates/Practice/practiceStore";
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
import { playSound, unlockAudioContext } from "@/lib/sfx";
import XpBurst, { fireXpBurst } from "@/components/atoms/XpBurst/XpBurst";
import { haptics } from "@/lib/haptics";
import type { Course, Lesson } from "@/data/types";
import { isoToUnixSeconds, unixSecondsToIso } from "@/lib/timestamps";
import { applySyncedWorkbench } from "@/hooks/useWorkbenchFiles";
import { applySettingRowsLocally } from "@/lib/settingsSync";
import { useSettingsSyncBridge } from "@/hooks/useSettingsSyncBridge";
import MobileLibrary, { type LibraryPane } from "./MobileLibrary";
import MobileDiscover from "./MobileDiscover";
import MobileLesson from "./MobileLesson";
import MobilePlayground from "./MobilePlayground";
import MobileProfile from "./MobileProfile";
import MobileSettings from "./MobileSettings";
import MobilePractice from "./MobilePractice";
import MonkeysPawView from "@/components/organisms/MonkeysPaw/MonkeysPawView";
import { usePracticeReminder } from "./usePracticeReminder";
import SocialView from "@/components/templates/Social/SocialView";
import ProfileCard from "@/components/molecules/ProfileCard/ProfileCard";
import CertificatesPage from "@/components/organisms/Certificates/CertificatesPage";
import PathsPage from "@/components/templates/Paths/PathsPage";
import ChallengesView from "@/components/templates/Challenges/ChallengesView";
import { mintCertificate } from "@/data/certificates";
import { notifyCertificatesChanged } from "@/hooks/useCertificates";
import MobileSearchPalette from "./MobileSearchPalette";
import SignInDialog from "@/components/organisms/dialogs/SignInDialog/SignInDialog";
import { OnboardingWizard } from "@/components/organisms/dialogs/OnboardingWizard/OnboardingWizard";
import { readLeaderboardEnabled } from "@/lib/leaderboardSettings";
import MobileTabBar, { type MobileTab } from "@/components/molecules/MobileTabBar/MobileTabBar";
import AiAssistant from "@/components/organisms/AiAssistant/AiAssistant";
import LibreLoader from "@/components/molecules/LibreLoader/LibreLoader";
import SectionCompleteSummary from "@/components/organisms/Achievements/SectionCompleteSummary";
import { EarlyReleaseBanner } from "@/components/molecules/banners/EarlyReleaseBanner/EarlyReleaseBanner";
import { useSoundOnChange } from "@/hooks/useSoundOnChange";
import "./MobileApp.css";

type View =
  | "library"
  | "lesson"
  | "playground"
  | "practice"
  | "profile"
  | "social"
  | "certs"
  | "challenges"
  | "monkeyspaw"
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
    loaded: progressLoaded,
    markCompleted,
    markCompletedBatch,
    resetProgress,
    clearCourseCompletions,
    clearChapterCompletions,
  } = useProgress();
  const cloud = useLibreCloud();

  // Early-access supporter flag for the signed-in learner's OWN
  // profile. `cloud.user` is the account object only when signed in
  // (`false` when logged out, `null` while booting), so we key the
  // one-shot `early_access` fetch off the account id and re-run on
  // sign-in / sign-out / account switch. Errors + unmounts leave the
  // flag false, so the Supporter card simply doesn't appear.
  const signedInUserId =
    typeof cloud.user === "object" && cloud.user ? cloud.user.id : null;
  const [isSupporter, setIsSupporter] = useState(false);
  const cloudGetProfile = cloud.getProfile;
  useEffect(() => {
    if (!signedInUserId) {
      setIsSupporter(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await cloudGetProfile(signedInUserId);
        if (!cancelled) setIsSupporter(!!p.early_access);
      } catch {
        if (!cancelled) setIsSupporter(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedInUserId, cloudGetProfile]);

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

  // Streak shields (freezes). Same shared hook the desktop TopBar
  // uses — localStorage-backed weekly budget + frozen-day registry.
  // Feeding `frozenDays` into the streak engine makes frozen days
  // count as phantom completions, so the streak number, celebration
  // trigger, profile rings and widget snapshot all honor freezes.
  const shields = useStreakShields();
  // Stats use the UNFILTERED course list — desktop parity (see the
  // matching comment in App.tsx). The visible `courses` memo above
  // drops hidden courses and anything outside the synced library,
  // and a completion whose course isn't in the list passed here
  // falls back to the reading award (5 XP) instead of its real
  // kind — so filtering would silently shrink exercise/quiz XP and
  // make mobile's pushed `total_xp` disagree with desktop's.
  const stats = useStreakAndXp(history, coursesAll, shields.frozenDays);
  // Stats are "ready" once BOTH stores hydrated — never push (or
  // celebrate) the 0 → real placeholder transition.
  const statsReady = loaded && progressLoaded;

  // ── Streak celebration — DESKTOP PARITY ───────────────────────────
  // Same audible cues the desktop StatsChip plays: a soft tick on an
  // ordinary day-flip, the fuller flame on milestone days, and the
  // blow-out when a run breaks. (The old full-screen mobile-only
  // overlay was removed: it was glitchy — hydration could fire it on
  // launch — and mobile surfaces should match their desktop
  // equivalents, which celebrate streaks with sound + the stats
  // surfaces, not a takeover.) Gated on statsReady so the 0 → real
  // hydration never plays as an "increase".
  const streakMilestones = [3, 7, 14, 30, 50, 100, 365];
  useSoundOnChange(stats.streakDays, "streak-tick", {
    when: (prev, next) => next > prev && !streakMilestones.includes(next),
    ready: statsReady,
  });
  useSoundOnChange(stats.streakDays, "streak-flame", {
    when: (prev, next) => next > prev && streakMilestones.includes(next),
    ready: statsReady,
  });
  useSoundOnChange(stats.streakDays, "flame-out", {
    increaseOnly: false,
    when: (prev, next) => next < prev && prev >= 2,
    ready: statsReady,
  });

  // Publish the snapshot the iOS widgets + watchOS app read on
  // every render where streak / library / completions changed.
  // The hook handles its own debounce + dedupe so this is cheap.
  // No-op on non-iOS targets (the underlying Tauri command bails
  // out on platforms without an App Group container).
  useWidgetSnapshot({ courses, completed, history, stats });


  // ── Push aggregate stats to the relay for friends + leaderboards ──
  // Same debounced effect as desktop App.tsx: phone-only learners
  // previously never uploaded a snapshot, so their leaderboard rows
  // sat stale/zero for everyone else. Guards: signed-in + statsReady,
  // value-diffed vs the last push, debounced 1.5s so a burst of
  // completions folds into one PUT. pushStats itself is best-effort.
  const lastPushedStatsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cloud.signedIn || !statsReady) return;
    // Leaderboard opt-out gate — see App.tsx: own progress still syncs, but no
    // aggregate snapshot is published for the relay to rank.
    if (!readLeaderboardEnabled()) return;
    const snapshot: CloudStats = {
      total_xp: stats.xp,
      current_streak_days: stats.streakDays,
      longest_streak_days: stats.longestStreakDays,
      lessons_completed: stats.lessonsCompleted,
      level: stats.level,
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastPushedStatsRef.current) return;
    const timer = window.setTimeout(() => {
      lastPushedStatsRef.current = serialized;
      void cloud.pushStats(snapshot);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    cloud,
    cloud.signedIn,
    statsReady,
    stats.xp,
    stats.streakDays,
    stats.longestStreakDays,
    stats.lessonsCompleted,
    stats.level,
  ]);

  // Spaced-repetition "reviews due" count for the Practice tab badge.
  // Mirrors the desktop nav-rail badge: re-pulled on the
  // `libre:practice-graded` event the practice store dispatches after
  // every graded attempt / reset.
  const [practiceRecordsVersion, setPracticeRecordsVersion] = useState(0);
  useEffect(() => {
    const bump = () => setPracticeRecordsVersion((v) => v + 1);
    window.addEventListener("libre:practice-graded", bump);
    return () => window.removeEventListener("libre:practice-graded", bump);
  }, []);
  const practiceStats = useMemo(() => {
    const items = harvestPracticeItems(courses, completed);
    return summariseStats(items, loadAllRecords());
    // practiceRecordsVersion is the re-pull trigger; loadAllRecords()
    // reads localStorage so it isn't a reactive dep by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, completed, practiceRecordsVersion]);
  const practiceDue = practiceStats.dueCount;

  // Daily practice reminder — settings owned here so the engine runs
  // app-wide (the nudge should fire no matter which tab is open).
  const practiceReminder = usePracticeReminder(
    practiceDue,
    practiceStats.attemptsToday,
  );

  // Installed-PWA app badge: mirror the due count onto the home-screen
  // icon where the platform supports it (Chromium PWAs; iOS 16.4+
  // installed). Silent no-op elsewhere.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (practiceDue > 0) void nav.setAppBadge?.(practiceDue).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [practiceDue]);

  // ── Certificate minting on book completion ─────────────────────────
  // Ported from desktop App.tsx: watch the completed set for NEW keys
  // (ref init'd to the mount-time set so cold-start history never
  // triggers; >5 new keys = sync back-fill, also skipped), and when a
  // fresh completion closes out a whole book, mint the certificate.
  // mintCertificate is idempotent per courseId, so StrictMode double
  // effects / sync replays can't duplicate.
  /// Chapter / book completion card — the same SectionCompleteSummary
  /// takeover desktop shows (chapter slides up, book is fullscreen).
  const [sectionSummary, setSectionSummary] = useState<
    | { kind: "chapter"; courseId: string; chapterIdx: number; xpEarned: number }
    | { kind: "book"; courseId: string; xpEarned: number }
    | null
  >(null);
  const prevCompletedRef = useRef<Set<string>>(completed);
  useEffect(() => {
    const prev = prevCompletedRef.current;
    if (prev === completed) return;
    const newKeys: string[] = [];
    for (const k of completed) if (!prev.has(k)) newKeys.push(k);
    prevCompletedRef.current = completed;
    if (newKeys.length === 0 || newKeys.length > 5) return;
    for (const key of newKeys) {
      const [courseId, lessonId] = key.split(":");
      const course = coursesAll.find((c) => c.id === courseId);
      if (!course) continue;
      const chapterIdx = course.chapters.findIndex((ch) =>
        ch.lessons.some((l) => l.id === lessonId),
      );
      const chapter = chapterIdx >= 0 ? course.chapters[chapterIdx] : null;
      const lessonKind = chapter?.lessons.find((l) => l.id === lessonId)?.kind;
      const xpEarned =
        lessonKind === "reading"
          ? 5
          : lessonKind === "quiz"
            ? 10
            : lessonKind === "exercise" || lessonKind === "mixed"
              ? 20
              : 0;
      const allChapterDone =
        !!chapter &&
        chapter.lessons.every((l) => completed.has(`${courseId}:${l.id}`));
      const allBookDone = course.chapters.every((ch) =>
        ch.lessons.every((l) => completed.has(`${courseId}:${l.id}`)),
      );
      if (allChapterDone && !allBookDone) {
        setSectionSummary({ kind: "chapter", courseId, chapterIdx, xpEarned });
      }
      if (!allBookDone) continue;
      setSectionSummary({ kind: "book", courseId, xpEarned });
      const totalLessons = course.chapters.reduce(
        (n, ch) => n + ch.lessons.length,
        0,
      );
      const recipientName =
        (typeof cloud.user === "object" && cloud.user?.display_name) ||
        (typeof cloud.user === "object" && cloud.user?.email
          ? cloud.user.email.split("@")[0]
          : null) ||
        "Libre learner";
      const recipientEmail =
        typeof cloud.user === "object" && cloud.user?.email
          ? cloud.user.email
          : undefined;
      const courseHistory = history.filter((c) => c.course_id === courseId);
      const startedAt =
        courseHistory.length > 0
          ? new Date(
              Math.min(...courseHistory.map((c) => c.completed_at)) * 1000,
            ).toISOString()
          : undefined;
      void mintCertificate({
        courseId,
        courseTitle: course.title,
        courseLanguage: course.language,
        recipientName,
        recipientEmail,
        lessonCount: totalLessons,
        xpEarned: 0,
        startedAt,
      }).then(() => notifyCertificatesChanged());
    }
  }, [completed, coursesAll, cloud.user, history]);

  /// Mirror of `realtime.status`, readable from inside the applier
  /// callbacks below (which close over refs, not render values). Used
  /// to tell FULL PULLS apart from live WS deltas in `applyProgress`:
  /// the initial sign-in / `resync()` pull runs while status is still
  /// "idle" / "syncing" (the hook only flips to "live" after the pull
  /// applies), whereas WS events and reconnect re-pulls arrive at
  /// "live". Declared before the hook call because the appliers are
  /// constructed as hook options; assigned right after it returns.
  const realtimeStatusRef = useRef<"idle" | "syncing" | "live" | "error">(
    "idle",
  );

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
          // REPLACE vs UNION depends on which path delivered the
          // batch:
          //
          //   - FULL PULLS (sign-in / resync — the hook is still
          //     "syncing" when the applier runs) carry the server's
          //     complete marker table, so replacing converges mobile
          //     on the true set, including removals (a course deleted
          //     on desktop also has its marker rows deleted server-
          //     side via deleteCourseProgress).
          //
          //   - WS DELTA events carry only the rows just pushed. The
          //     relay echoes our own pushes back, so mobile installing
          //     one course produced a 1-marker delta that — under the
          //     old unconditional replace — collapsed the phone's
          //     visible library to that single course until the next
          //     full pull. Desktop's delta pushes are no better a
          //     snapshot: they list desktop's installed set, which
          //     excludes mobile-only installs. Deltas therefore only
          //     ever UNION; removals wait for the next full pull.
          //
          // (Tiny race: a delta landing in the gap between the pull
          // resolving and the "live" status committing is treated as a
          // full snapshot. Self-heals on the next pull, and the window
          // is one render during sign-in.)
          const isFullSnapshot = realtimeStatusRef.current !== "live";
          setSyncedLibraryIds((prev) => {
            const next = isFullSnapshot
              ? new Set(markerCourseIds)
              : new Set([...(prev ?? []), ...markerCourseIds]);
            // Bail out of the setState if nothing changed — saves
            // a re-render of the library + tab bar on every WS tick
            // (and skips the localStorage mirror write below).
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
        //
        // Sentinel course id `"*"` (with null lesson_ids) means the
        // whole ACCOUNT was wiped on another device ("Start fresh") —
        // run the same full local wipe the Settings button drives so
        // the phone converges instead of re-uploading its stale
        // history on the next reconcile.
        if (courseId === "*" && lessonIds === null) {
          void resetProgress();
          return;
        }
        if (lessonIds && lessonIds.length > 0) {
          clearChapterCompletions(courseId, lessonIds);
        } else {
          clearCourseCompletions(courseId);
        }
      },
      [clearCourseCompletions, clearChapterCompletions, resetProgress],
    ),
    applySolutions: useCallback(
      (
        rows: Array<{
          course_id: string;
          lesson_id: string;
          content: string;
          updated_at: string;
        }>,
      ) => {
        // Persist into the same workbench-localStorage key the editor
        // reads (shared helper in useWorkbenchFiles — an earlier
        // applier wrote a dead `kata:` prefix nothing read), so the
        // next mount of the lesson picks up the synced version.
        // Mobile doesn't render the workbench tab strip — lessons run
        // via a single solution string — but the storage key shape is
        // shared and deterministic. The helper computes a reader-
        // acceptable signature from the synced files and applies
        // last-write-wins against the local save timestamp.
        for (const r of rows) {
          applySyncedWorkbench(
            r.course_id,
            r.lesson_id,
            r.content,
            r.updated_at,
          );
        }
      },
      [],
    ),
    applySettings: useCallback(
      (rows: Array<{ key: string; value: string }>) => {
        // Shared helper: write each row to localStorage under its wire
        // key and fold live-store keys (locale) into their in-memory
        // stores, with the suppression flag up so the outbound bridge
        // can't re-push what we just received.
        applySettingRowsLocally(rows);
        for (const r of rows) {
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
    /// Snapshot of local completion history in push-row shape, used by
    /// the hook's sign-in reconciliation to push local-only rows (e.g.
    /// progress earned while signed out) up to the relay. Same mapping
    /// the SyncDebugPanel "Push all" button uses. `history` never
    /// contains library-marker rows (the applier above splits them out
    /// before they reach the completion store), so no filtering needed.
    collectLocalProgress: useCallback(
      () =>
        history.map((h) => ({
          course_id: h.course_id,
          lesson_id: h.lesson_id,
          completed_at: unixSecondsToIso(h.completed_at),
        })),
      [history],
    ),
  });
  // Keep the status mirror fresh for the appliers above. Assigning
  // during render is safe: appliers only run from async callbacks, by
  // which point the render that produced the latest status committed.
  realtimeStatusRef.current = realtime.status;

  /// Outbound settings bridge — forwards `libre:setting-changed`
  /// CustomEvents (dispatched by preference modules like `useLocale`
  /// that sit below the cloud stack in the dep graph) into
  /// `realtime.pushSetting` so a language flip here lands on the
  /// user's other devices. Inbound remote applies are suppressed
  /// inside the hook so they can't echo back up.
  useSettingsSyncBridge(realtime);

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
  // Guided path to auto-open (from the onboarding "what to learn" pick).
  const [pendingPathId, setPendingPathId] = useState<string | null>(null);
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
  /// Public-profile popup opened from leaderboard / friends rows.
  const [profileCardUserId, setProfileCardUserId] = useState<string | null>(
    null,
  );
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

  // ── Deep links: ?courseId=…&lessonId=… ────────────────────────────
  // The marketing site's course pages hand learners over to /learn/
  // with these params ("Open in browser"). Desktop has handled them
  // since the web build shipped; mobile silently dropped them and
  // landed everyone on the Library. Parse once at mount, then jump as
  // soon as the course list has loaded. Cleared after a successful
  // match so a stale ?courseId in history can't re-yank the learner.
  const [pendingOpen, setPendingOpen] = useState<{
    courseId: string;
    lessonId?: string;
  } | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const courseId = params.get("courseId");
      if (!courseId) return null;
      return { courseId, lessonId: params.get("lessonId") ?? undefined };
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!pendingOpen || !loaded) return;
    // Resolve against coursesAll (not the visibility-filtered list) so
    // hidden / unlisted courses stay openable by direct URL — that's
    // the point of the unlisted flag.
    const course = coursesAll.find((c) => c.id === pendingOpen.courseId);
    if (!course) return;
    setPendingOpen(null);
    if (pendingOpen.lessonId) {
      for (let ci = 0; ci < course.chapters.length; ci++) {
        const ch = course.chapters[ci];
        for (let li = 0; li < ch.lessons.length; li++) {
          if (ch.lessons[li].id === pendingOpen.lessonId) {
            void openLesson(course, ci, li);
            return;
          }
        }
      }
    }
    // No lesson id (or a stale one) — first incomplete lesson.
    void openCourseById(course.id);
    // openLesson / openCourseById are stable-enough closures re-created
    // per render; the guard state (pendingOpen → null) prevents re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, loaded, coursesAll]);

  // ── Session restore ────────────────────────────────────────────────
  // Native reading apps reopen where you left off; mobile previously
  // always cold-launched to the Library. Persist the active lesson by
  // STABLE ids (course + lesson, not indices — course updates can
  // reorder chapters) whenever it changes; clear when the learner
  // deliberately backs out to the Library. Restored once per launch,
  // and only when no ?courseId deep link claimed the landing first.
  const ACTIVE_LESSON_KEY = "libre.mobile.active-lesson.v1";
  useEffect(() => {
    if (!active) return;
    const lessonId =
      active.course.chapters[active.chapterIndex]?.lessons[active.lessonIndex]?.id;
    if (!lessonId) return;
    try {
      localStorage.setItem(
        ACTIVE_LESSON_KEY,
        JSON.stringify({ courseId: active.course.id, lessonId }),
      );
    } catch {
      /* quota / private mode — resume just won't survive relaunch */
    }
  }, [active]);
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current || !loaded) return;
    didRestoreRef.current = true;
    if (pendingOpen) return; // deep link wins the landing
    try {
      const raw = localStorage.getItem(ACTIVE_LESSON_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { courseId?: string; lessonId?: string };
      if (!saved?.courseId || !saved.lessonId) return;
      const course = coursesAll.find((c) => c.id === saved.courseId);
      if (!course) return;
      for (let ci = 0; ci < course.chapters.length; ci++) {
        const li = course.chapters[ci].lessons.findIndex(
          (l) => l.id === saved.lessonId,
        );
        if (li >= 0) {
          void openLesson(course, ci, li);
          return;
        }
      }
    } catch {
      /* malformed record — ignore, land on Library */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pendingOpen, coursesAll]);

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

  /// Install a course by id from the catalog — the Paths page's
  /// install-in-place affordance. Resolves the id against the live
  /// catalog and reuses the same installEntry pipeline Discover uses
  /// (cover stamping, allowlist + marker bookkeeping, analytics).
  const installCourseById = async (courseId: string): Promise<void> => {
    const { fetchCatalog } = await import("@/lib/catalog");
    const entries = await fetchCatalog();
    const entry = entries.find((e) => e.id === courseId);
    if (!entry) throw new Error(`course not in catalog: ${courseId}`);
    await installEntry(entry);
  };

  /// Remove an installed course. Four-part bookkeeping so the delete
  /// STAYS deleted across sync:
  ///   1. drop the IndexedDB record (frees the stored JSON),
  ///   2. remove the course from the synced library-marker set locally
  ///      AND delete its marker row on the relay (else the next full
  ///      pull resurrects it in `syncedLibraryIds`),
  ///   3. remove it from the settings allowlist + push the shrunk list,
  ///   4. if the learner was inside that course, back out to the
  ///      Library and forget the session-restore point.
  /// Caveat: a future SEED_VERSION bump re-seeds the record for
  /// signed-out visitors (same behavior as desktop-web); the allow-
  /// list/markers keep it hidden for signed-in accounts.
  const uninstallCourse = async (course: Course) => {
    const { storage } = await import("@/lib/storage");
    await storage.deleteCourse(course.id);
    track.courseUninstall(course.id);
    setSyncedLibraryIds((prev) => {
      if (!prev || !prev.has(course.id)) return prev;
      const next = new Set(prev);
      next.delete(course.id);
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
    void cloud.deleteCourseProgress(course.id, [LIBRARY_MARKER_LESSON_ID]);
    setLibraryAllowlist((prev) => {
      if (!prev || !prev.has(course.id)) return prev;
      const next = new Set(prev);
      next.delete(course.id);
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
    if (active?.course.id === course.id) {
      setActive(null);
      setView("library");
      try {
        localStorage.removeItem(ACTIVE_LESSON_KEY);
      } catch {
        /* swallow */
      }
    }
    await refreshCourses();
  };

  const onComplete = () => {
    if (!active || !lesson) return;
    // Fresh-completion celebration — XP is only awarded once per
    // lesson, so the sound + floating "+N XP" burst fire only when
    // this key isn't already in the completed set (re-passing a
    // lesson deliberately shouldn't re-reward). Mirrors the desktop
    // markCompletedAndCelebrate flow; the XP value comes from the
    // same canonical table useStreakAndXp derives totals from, so
    // the burst always matches what the headline number gains.
    const isFresh = !completed.has(`${active.course.id}:${lesson.id}`);
    if (isFresh) {
      const xp = xpForLessonKind(lesson.kind);
      playSound("xp-pop", { volume: 0.7 });
      fireXpBurst(xp);
      // Web-only analytics event (coarse ids, no PII) — same event
      // the desktop web build logs, so mobile completions stop being
      // invisible in the dashboard's course breakdown.
      void import("@/lib/analytics").then(({ trackEvent }) => {
        trackEvent("lesson.complete", {
          courseId: active.course.id,
          lessonId: lesson.id,
        });
      });
    }
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
        : view === "practice" || view === "monkeyspaw"
          ? "practice"
          : view === "profile" || view === "social" || view === "certs" || view === "challenges"
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

      {/* Early-release notice — the same banner desktop shows under
          its TopBar: placeholder/AI content disclosure + support CTA.
          Flex sibling above the scroll pane so it pushes content down. */}
      <EarlyReleaseBanner />

      <main className="m-app__main">
        {view === "library" && libraryPane === "library" && (
          <MobileLibrary
            courses={courses}
            completed={completed}
            practiceDue={practiceDue}
            onOpenPractice={() => setView("practice")}
            onUninstall={uninstallCourse}
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
        {view === "library" && libraryPane === "paths" && (
          <div className="m-paths">
            {/* Same segmented switch the Library/Discover panes render,
                so Paths reads as the third pane of one surface. */}
            <div className="m-lib__segmented" role="tablist" aria-label="Library, Discover or Paths">
              {(["library", "discover", "paths"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={libraryPane === p}
                  className={`m-lib__seg${libraryPane === p ? " m-lib__seg--active" : ""}`}
                  onClick={() => {
                    void haptics.selection();
                    setLibraryPane(p);
                  }}
                >
                  {p === "library" ? "My Library" : p === "discover" ? "Discover" : "Paths"}
                </button>
              ))}
            </div>
            <PathsPage
              initialSelectedId={pendingPathId}
              courses={courses}
              completed={completed}
              onOpenCourse={(courseId) => void openCourseById(courseId)}
              onBrowseCatalog={() => setLibraryPane("discover")}
              onInstallCourse={installCourseById}
            />
          </div>
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
            onBack={() => {
              // Deliberate exit — forget the resume point so the next
              // launch lands on the Library, not back in the lesson.
              try {
                localStorage.removeItem(ACTIVE_LESSON_KEY);
              } catch {
                /* ignore */
              }
              setView("library");
            }}
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
        {view === "monkeyspaw" && (
          <MonkeysPawView onBack={() => setView("practice")} />
        )}
        {view === "practice" && (
          <MobilePractice
            courses={courses}
            completed={completed}
            history={history}
            dueCount={practiceDue}
            reminder={practiceReminder.settings}
            onReminderChange={practiceReminder.setSettings}
            onMonkeysPaw={() => setView("monkeyspaw")}
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
            // Friends + leaderboard live one tap away from Profile
            // (the tab bar is at its four-slot thumb-reach max).
            onOpenSocial={() => {
              void haptics.selection();
              setView("social");
            }}
            onOpenCerts={() => {
              void haptics.selection();
              setView("certs");
            }}
            onOpenChallenges={() => {
              void haptics.selection();
              setView("challenges");
            }}
            // Streak shields — the Profile hosts the freeze panel
            // (weekly budget pips + "Freeze yesterday"), mirroring
            // the desktop TopBar stats dropdown.
            shields={shields}
            // Identity hero: signed-in account (avatar + name) or a
            // "sign in to sync" affordance when anonymous.
            user={cloud.user || null}
            // Early-access supporter badge (thank-you card under the
            // hero), fetched from the account's `early_access` flag.
            isSupporter={isSupporter}
            onRequestSignIn={() => setSignInOpen(true)}
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
        {view === "social" && (
          // The desktop SocialView is prop-driven (no hook deps) and
          // ships its own <=520px responsive block, so mobile mounts
          // it directly — same pattern as PracticeView above.
          <div className="m-social">
          <SocialView
            listFriends={cloud.listFriends}
            addFriend={cloud.addFriend}
            listFriendRequests={cloud.listFriendRequests}
            acceptFriendRequest={cloud.acceptFriendRequest}
            removeFriend={cloud.removeFriend}
            getFriendsLeaderboard={cloud.getFriendsLeaderboard}
            getGlobalLeaderboard={cloud.getGlobalLeaderboard}
            getProfile={cloud.getProfile}
            onOpenProfile={(userId) => setProfileCardUserId(userId)}
            currentUserId={
              typeof cloud.user === "object" && cloud.user
                ? cloud.user.id
                : null
            }
            onSignIn={() => setSignInOpen(true)}
          />
          </div>
        )}
        {view === "certs" && (
          // Desktop CertificatesPage inside a mobile wrapper. The
          // ticket is a fixed-proportion print artifact — at phone
          // widths its 7-row body crushes to 0-height rows — so the
          // .m-certs CSS renders each stage at design width and
          // scales it down instead (see MobileApp.css).
          <MobileCertsFrame>
            <CertificatesPage
              courses={courses}
              completed={completed}
              onResume={(courseId) => void openCourseById(courseId)}
            />
          </MobileCertsFrame>
        )}
        {view === "challenges" && (
          // Desktop tier browser, embedded like Practice/Social/Certs.
          <ChallengesView
            courses={courses}
            completed={completed}
            onOpenLesson={(courseId, lessonId) => {
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
            // Cloud-aware reset — local reducer first for instant UI,
            // then the relay forgets the rows (desktop parity; without
            // the cloud call the next sync pull re-completes the pack).
            onResetCourse={(courseId) => {
              clearCourseCompletions(courseId);
              void cloud.deleteCourseProgress(courseId);
            }}
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
        practiceDue={practiceDue}
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

      {/* First-launch onboarding wizard — self-gates on shouldShowOnboarding().
          Mobile has no standalone theme picker, so this is the phone's entire
          first-run configure flow (theme → privacy → basics). */}
      <OnboardingWizard
        onPickLearningPath={(pathId) => {
          setPendingPathId(pathId);
          setView("library");
          setLibraryPane("paths");
        }}
      />

      {/* Public profile popup — opened from leaderboard / friends
          rows. Same overlay + cloud wiring as desktop App.tsx. */}
      {profileCardUserId && (
        <ProfileCard
          userId={profileCardUserId}
          getProfile={cloud.getProfile}
          onAddFriend={async (email) => {
            await cloud.addFriend(email);
          }}
          onRemoveFriend={cloud.removeFriend}
          onAcceptRequest={cloud.acceptFriendRequest}
          onClose={() => setProfileCardUserId(null)}
        />
      )}

      {/* Floating "+N XP" reward bursts — portaled to <body>, fired
          from onComplete on fresh completions. */}
      <XpBurst />

      {/* Practice-reminder nudge — fires once a day when the chosen
          time passes with reviews still due (see usePracticeReminder). */}
      {practiceReminder.nudge && (
        <div className="m-app__nudge" role="status">
          <span className="m-app__nudge-text">
            Time to practice — {practiceReminder.nudge.dueCount} review
            {practiceReminder.nudge.dueCount === 1 ? "" : "s"} due
          </span>
          <button
            type="button"
            className="m-app__nudge-go"
            onClick={() => {
              practiceReminder.dismissNudge();
              void haptics.selection();
              setView("practice");
            }}
          >
            Practice
          </button>
          <button
            type="button"
            className="m-app__nudge-later"
            onClick={() => practiceReminder.dismissNudge()}
            aria-label="Dismiss"
          >
            Later
          </button>
        </div>
      )}

      {/* Chapter / book completion summary — desktop component,
          desktop behavior: chapter card slides up, book completion is
          a fullscreen takeover. */}
      {sectionSummary
        ? (() => {
            const course = coursesAll.find(
              (c) => c.id === sectionSummary.courseId,
            );
            if (!course) return null;
            const chapter =
              sectionSummary.kind === "chapter"
                ? course.chapters[sectionSummary.chapterIdx]
                : null;
            const heading =
              sectionSummary.kind === "book"
                ? course.title
                : chapter?.title ?? `Chapter ${sectionSummary.chapterIdx + 1}`;
            const subheading =
              sectionSummary.kind === "book" ? "Book complete" : course.title;
            return (
              <SectionCompleteSummary
                kind={sectionSummary.kind}
                heading={heading}
                subheading={subheading}
                xpEarned={sectionSummary.xpEarned}
                streakDays={stats.streakDays}
                onDismiss={() => setSectionSummary(null)}
              />
            );
          })()
        : null}

      <MobileSearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        courses={courses}
        onOpenLesson={openLesson}
      />
    </div>
  );
}

/// Certificates wrapper — measures its own width and drives the
/// ticket-stage scale vars (see the .m-certs rules in MobileApp.css).
/// The certificate ticket is a print-like artifact designed for a
/// ~520px column; squeezing its LAYOUT crushes the flex rows, so we
/// lay each stage out at design width and scale the finished artifact
/// down. Measured in JS because the pure-CSS route needs length÷length
/// calc() division, which Chrome/WebKit only support behind very
/// recent versions.
function MobileCertsFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  // The page carries ~32px side gutters inside this wrapper; the
  // design width matches the desktop ticket column.
  const col = Math.max(0, width - 64);
  const DESIGN = 520;
  // Stage height ≈ 0.49 × its width (5:2 ticket + hover-tilt padding).
  const style =
    col > 0 && col < DESIGN
      ? ({
          "--m-cert-w": `${DESIGN}px`,
          "--m-cert-scale": String(col / DESIGN),
          "--m-cert-mr": `${col - DESIGN}px`,
          "--m-cert-mb": `${Math.round(0.49 * col - 0.49 * DESIGN)}px`,
        } as React.CSSProperties)
      : undefined;
  return (
    <div className="m-certs" ref={ref} style={style}>
      {children}
    </div>
  );
}
