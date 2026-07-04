/// Mobile library — sectioned into "Books" + "Challenges" exactly
/// like the desktop CourseLibrary. Two view modes the learner can
/// flip between in the header:
///
///   - **grid** (default): info-dense `<CourseCard>` rows showing
///     title / author / status / progress meter. Same component the
///     desktop grid mode uses; on phone we render single-column.
///   - **covers**: 2:3 portrait `<BookCover>` tiles in a 2-col grid.
///     The visual that ships on book covers — completion-tier frames,
///     language badge, release pill, title overlay.
///
/// The two modes mirror desktop's view-mode toggle so a learner who
/// picked one preference on the laptop sees the same on the phone
/// (preference is stored under a separate key — different form
/// factor, different default — but the COMPONENTS rendered are
/// identical).
///
/// Filter strip is a single horizontal-scroll row of language pills —
/// no difficulty or topic axis on phone, since most learners on mobile
/// drill into one course rather than browsing the catalog.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Course, LanguageId } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";
import { isChallengePack, isExerciseTrack, isKoans, isLings } from "@/data/types";
import { prefetchCovers } from "@/hooks/useCourseCover";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { haptics } from "@/lib/haptics";
import { Icon } from "@base/primitives/icon";
import { search as searchIcon } from "@base/primitives/icon/icons/search";
import { layoutGrid as gridIcon } from "@base/primitives/icon/icons/layout-grid";
import { libraryBig as coversIcon } from "@base/primitives/icon/icons/library-big";
import BookCover from "@/components/templates/Library/BookCover";
import CourseCard from "@/components/templates/Library/CourseCard";
import PullToRefresh from "./PullToRefresh";
import { usePullToRefresh } from "./usePullToRefresh";
import "./MobileLibrary.css";

type ViewMode = "grid" | "covers";
const VIEW_MODE_KEY = "libre.mobile.libraryViewMode";

/// Which pane the Library tab is showing. "library" = the learner's
/// installed courses (the original mobile behaviour); "discover" = the
/// catalog browser. Owned by MobileApp so the segmented toggle in the
/// header can flip between the two while both keep sharing this tab.
export type LibraryPane = "library" | "discover" | "paths";

interface Props {
  courses: Course[];
  completed: Set<string>;
  /// Current pane + setter for the [My Library | Discover] segmented
  /// toggle. Optional so any embedding that hasn't wired Discover yet
  /// still type-checks and simply hides the toggle.
  pane?: LibraryPane;
  onPaneChange?: (pane: LibraryPane) => void;
  /// Full completion history — every (course, lesson, completed_at)
  /// tuple the learner has logged. Drives the "most-recent activity"
  /// sort: each course's position is its freshest completion
  /// timestamp. Optional so older embeddings that haven't wired
  /// `history` through yet still type-check; when absent the
  /// library falls back to the previous tier-only sort (in-progress
  /// → untouched → completed).
  history?: readonly Completion[];
  onOpenLesson: (course: Course, chapterIndex: number, lessonIndex: number) => void;
  /// Optional — spaced-repetition reviews due right now. When >0 the
  /// library shows a compact practice nudge card under the toggle
  /// (tap → Practice tab via onOpenPractice).
  practiceDue?: number;
  onOpenPractice?: () => void;
  /// Optional — long-pressing a course card opens a manage sheet with
  /// "Remove from library". The heavy lifting (storage delete + sync
  /// bookkeeping) lives in MobileApp; omitting the prop disables the
  /// long-press affordance entirely.
  onUninstall?: (course: Course) => Promise<void> | void;
  /// Optional — fired by the top-right search button to open the
  /// global mobile search palette. Left optional so callers that
  /// haven't wired the palette in yet still type-check.
  onOpenSearch?: () => void;
  /// Optional — pull-to-refresh handler. When provided, dragging
  /// down at the top of the page triggers this callback and shows
  /// the system-style ring indicator until the returned promise
  /// resolves. Wired by MobileApp to the realtime sync resync.
  onRefresh?: () => Promise<void> | void;
}

const LANG_LABELS: Partial<Record<LanguageId, string>> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  c: "C",
  cpp: "C++",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  swift: "Swift",
  assembly: "Assembly",
  reactnative: "React Native",
  threejs: "Three.js",
  bun: "Bun",
  solidity: "Solidity",
};

function labelFor(id: LanguageId): string {
  return LANG_LABELS[id] ?? id;
}

function nextLessonOf(course: Course, completed: Set<string>): {
  ch: number;
  ls: number;
  total: number;
  done: number;
} {
  // useProgress stores keys as `${courseId}:${lessonId}` — match that
  // here or `completed.has(...)` will always return false.
  const key = (lessonId: string) => `${course.id}:${lessonId}`;
  let total = 0;
  let done = 0;
  for (const c of course.chapters) {
    for (const l of c.lessons) {
      total += 1;
      if (completed.has(key(l.id))) done += 1;
    }
  }
  for (let ci = 0; ci < course.chapters.length; ci++) {
    const ch = course.chapters[ci];
    for (let li = 0; li < ch.lessons.length; li++) {
      if (!completed.has(key(ch.lessons[li].id))) {
        return { ch: ci, ls: li, total, done };
      }
    }
  }
  return { ch: 0, ls: 0, total, done };
}

export default function MobileLibrary({
  courses,
  completed,
  history,
  pane,
  onPaneChange,
  onOpenLesson,
  practiceDue,
  onOpenPractice,
  onUninstall,
  onOpenSearch,
  onRefresh,
}: Props) {
  // Pull-to-refresh — only arms when the host actually wires a
  // refresh handler. The hook is inert (no listeners attached)
  // when `onRefresh` is undefined.
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: onRefresh ?? (() => {}),
    enabled: !!onRefresh,
  });
  const [filter, setFilter] = useState<LanguageId | "all">("all");

  /// Long-press → manage sheet ("Remove from library"). Pointer-based
  /// (550ms hold, cancelled by >10px drift or release) because iOS
  /// Safari doesn't fire contextmenu for arbitrary elements. The
  /// suppress ref eats the click that iOS synthesizes after the hold
  /// so the course doesn't ALSO open underneath the sheet.
  const [manageCourse, setManageCourse] = useState<Course | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  };
  const pressHandlers = (c: Course) =>
    onUninstall
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            pressOrigin.current = { x: e.clientX, y: e.clientY };
            pressTimer.current = window.setTimeout(() => {
              pressTimer.current = null;
              suppressClick.current = true;
              void haptics.medium();
              setManageCourse(c);
            }, 550);
          },
          onPointerMove: (e: React.PointerEvent) => {
            const o = pressOrigin.current;
            if (!o) return;
            if (Math.abs(e.clientX - o.x) > 10 || Math.abs(e.clientY - o.y) > 10) {
              cancelPress();
            }
          },
          onPointerUp: cancelPress,
          onPointerCancel: cancelPress,
          onClickCapture: (e: React.MouseEvent) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          },
          onContextMenu: (e: React.MouseEvent) => {
            // Desktop-pointer fallback: right-click opens the same sheet.
            e.preventDefault();
            setManageCourse(c);
          },
        }
      : {};
  /// Persisted view-mode preference. Default "grid" so the first-time
  /// experience matches the desktop default; a learner who flips to
  /// "covers" gets that preference back across launches via
  /// localStorage. Stored under a mobile-specific key so the desktop's
  /// preference doesn't bleed across form factors.
  const [viewMode, setViewMode] = useLocalStorageState<ViewMode>(
    VIEW_MODE_KEY,
    "grid",
    {
      serialize: (v) => v,
      deserialize: (raw) => (raw === "covers" ? "covers" : "grid"),
    },
  );

  // Prefetch every course's cover on first paint so scrolling doesn't
  // trigger a fetch storm. Same pattern desktop CourseLibrary uses.
  useEffect(() => {
    void prefetchCovers(
      courses.map((c) => ({
        courseId: c.id,
        cacheBust: c.coverFetchedAt,
      })),
    );
  }, [courses]);

  // Languages that actually have at least one course. Drives the pill
  // row — no point showing "Rust" if the user has no Rust courses.
  const availableLangs = useMemo(() => {
    const seen = new Set<LanguageId>();
    for (const c of courses) seen.add(c.language);
    return Array.from(seen);
  }, [courses]);

  const filtered = useMemo(() => {
    if (filter === "all") return courses;
    return courses.filter((c) => c.language === filter);
  }, [courses, filter]);

  /// Build a map of `courseId → most-recent completion timestamp`
  /// from the flat history array. One pass; later completions
  /// overwrite earlier ones for the same course (we only care about
  /// the MAX). Empty when `history` isn't wired so the fallback
  /// branch in the sort below kicks in cleanly. `unix seconds`
  /// scale (matches Completion.completed_at directly).
  const lastTouchedAt = useMemo(() => {
    const m = new Map<string, number>();
    if (!history) return m;
    for (const row of history) {
      const prev = m.get(row.course_id) ?? 0;
      if (row.completed_at > prev) m.set(row.course_id, row.completed_at);
    }
    return m;
  }, [history]);

  /// Group filtered courses by KIND — "Books" (long-form prose with
  /// chapters and exercises) up top, "Challenges" (per-language
  /// exercise packs) at the bottom. Mirrors the desktop
  /// CourseLibrary's section structure so the visual layout reads
  /// the same on phone vs desktop. A learner who knows where to find
  /// the Bitcoin book in the desktop library finds it in the same
  /// pile when they pick up the phone.
  ///
  /// Within each section we sort by MOST RECENT ACTIVITY. Each
  /// course's sort key is the freshest `completed_at` timestamp
  /// across its completion history (lookup table built above). Two-
  /// tier sort:
  ///   - Tier 0 — has activity (any completion logged) → ORDER by
  ///     timestamp descending (most-recent first). The course you
  ///     last touched lands at the top of the section.
  ///   - Tier 1 — no activity yet → keep `filtered` order so the
  ///     untouched pile stays stable (no churn on every render).
  /// Fully-completed courses no longer sink to the bottom because
  /// "I finished this 10 minutes ago" is way more useful than "I
  /// haven't touched it since 2024" as the implicit recency signal.
  /// The learner can always scroll past completed courses if they
  /// want to find a pristine one.
  ///
  /// Falls back to the previous tier-only sort when `history` isn't
  /// available so older callers / empty-history first-launch states
  /// still render a sensible order.
  const sections = useMemo(() => {
    const books: Course[] = [];
    const tracks: Course[] = [];
    const challenges: Course[] = [];
    for (const c of filtered) {
      // Koans + *lings share the Challenges shelf with the in-house
      // challenge packs — all are exercise-driven sequential
      // practice and the dedicated Challenges page (formerly
      // "Tracks") groups them together. Keeping the desktop + mobile
      // bucketing aligned means a learner switching surfaces finds
      // the same content in the same neighbourhood.
      if (isChallengePack(c) || isKoans(c) || isLings(c)) challenges.push(c);
      else if (isExerciseTrack(c)) tracks.push(c);
      else books.push(c);
    }
    const hasHistory = history && history.length > 0;
    const sortByActivity = hasHistory
      ? (a: Course, b: Course) => {
          const ta = lastTouchedAt.get(a.id) ?? 0;
          const tb = lastTouchedAt.get(b.id) ?? 0;
          if (ta === 0 && tb === 0) return 0; // both pristine — keep filtered order
          // Untouched courses sort AFTER touched ones; otherwise
          // recent-first within the touched group.
          if (ta === 0) return 1;
          if (tb === 0) return -1;
          return tb - ta;
        }
      : // Legacy fallback (no history): keep the tier scheme so a
        // fresh-install user still sees something reasonable.
        (a: Course, b: Course) => {
          const tier = (c: Course) => {
            const { total, done } = nextLessonOf(c, completed);
            if (total === 0) return 1;
            if (done >= total) return 2;
            if (done > 0) return 0;
            return 1;
          };
          return tier(a) - tier(b);
        };
    books.sort(sortByActivity);
    tracks.sort(sortByActivity);
    challenges.sort(sortByActivity);
    const out: Array<{ key: string; label: string; rows: Course[] }> = [];
    if (books.length > 0) {
      out.push({ key: "books", label: "Books", rows: books });
    }
    if (tracks.length > 0) {
      out.push({ key: "tracks", label: "Tracks", rows: tracks });
    }
    if (challenges.length > 0) {
      out.push({ key: "challenges", label: "Challenges", rows: challenges });
    }
    return out;
  }, [filtered, completed, lastTouchedAt, history]);

  return (
    <div
      className="m-lib"
      // Translate the page content down by the current pull distance
      // so the floating refresh indicator slides into view above it.
      // No transition while the finger is moving (the hook updates
      // pullDistance per touchmove); the hook itself springs back to
      // 0 with a CSS transition once the gesture ends.
      style={{
        transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
        transition:
          pullDistance > 0 && !isRefreshing ? "none" : "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <PullToRefresh pullDistance={pullDistance} isRefreshing={isRefreshing} />
      {pane && onPaneChange && (
        <div className="m-lib__segmented" role="tablist" aria-label="Library or Discover">
          <button
            type="button"
            role="tab"
            aria-selected={pane === "library"}
            className={`m-lib__seg${pane === "library" ? " m-lib__seg--active" : ""}`}
            onClick={() => {
              void haptics.selection();
              onPaneChange("library");
            }}
          >
            My Library
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === "discover"}
            className={`m-lib__seg${pane === "discover" ? " m-lib__seg--active" : ""}`}
            onClick={() => {
              void haptics.selection();
              onPaneChange("discover");
            }}
          >
            Discover
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === "paths"}
            className={`m-lib__seg${pane === "paths" ? " m-lib__seg--active" : ""}`}
            onClick={() => {
              void haptics.selection();
              onPaneChange?.("paths");
            }}
          >
            Paths
          </button>
        </div>
      )}
      {(practiceDue ?? 0) > 0 && onOpenPractice && (
        <button
          type="button"
          className="m-lib__practice-nudge"
          onClick={() => {
            void haptics.selection();
            onOpenPractice();
          }}
        >
          <span className="m-lib__practice-nudge-dot" aria-hidden />
          <span className="m-lib__practice-nudge-text">
            {practiceDue} review{practiceDue === 1 ? "" : "s"} due — a quick
            session keeps the chain alive
          </span>
          <span className="m-lib__practice-nudge-go" aria-hidden>→</span>
        </button>
      )}

      <header className="m-lib__head">
        <div className="m-lib__head-text">
          <h1 className="m-lib__title">Library</h1>
          <p className="m-lib__subtitle">
            {courses.length} course{courses.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="m-lib__head-actions">
          {/* View-mode toggle: grid (info-dense cards, default) vs.
              covers (2:3 cover tiles). Mirrors desktop's view toggle
              just at phone scale. */}
          <div
            className="m-lib__viewtoggle"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              className={`m-lib__viewbtn${viewMode === "grid" ? " m-lib__viewbtn--active" : ""}`}
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              aria-label="Grid view"
              title="Grid view"
            >
              <Icon icon={gridIcon} size="sm" color="currentColor" />
            </button>
            <button
              type="button"
              className={`m-lib__viewbtn${viewMode === "covers" ? " m-lib__viewbtn--active" : ""}`}
              onClick={() => setViewMode("covers")}
              aria-pressed={viewMode === "covers"}
              aria-label="Covers view"
              title="Covers view"
            >
              <Icon icon={coversIcon} size="sm" color="currentColor" />
            </button>
          </div>
          {onOpenSearch && (
            <button
              type="button"
              className="m-lib__search"
              onClick={onOpenSearch}
              aria-label="Search"
            >
              <Icon icon={searchIcon} size="sm" color="currentColor" />
            </button>
          )}
        </div>
      </header>

      {availableLangs.length > 1 && (
        <nav
          className="m-lib__filter"
          role="tablist"
          aria-label="Filter by language"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={`m-lib__pill${filter === "all" ? " m-lib__pill--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
            <span className="m-lib__pill-count">{courses.length}</span>
          </button>
          {availableLangs.map((lang) => {
            const count = courses.filter((c) => c.language === lang).length;
            return (
              <button
                key={lang}
                type="button"
                role="tab"
                aria-selected={filter === lang}
                className={`m-lib__pill${filter === lang ? " m-lib__pill--active" : ""}`}
                onClick={() => setFilter(lang)}
              >
                {labelFor(lang)}
                <span className="m-lib__pill-count">{count}</span>
              </button>
            );
          })}
        </nav>
      )}

      {sections.map((sec) => (
        <section
          key={sec.key}
          className={`m-lib__section m-lib__section--${sec.key}`}
          aria-label={sec.label}
        >
          <header className="m-lib__section-head">
            <h2 className="m-lib__section-title">{sec.label}</h2>
            <span className="m-lib__section-count">{sec.rows.length}</span>
          </header>
          {viewMode === "grid" ? (
            // Info-dense single-column list of CourseCards. Same
            // component the desktop grid mode renders; on phone the
            // grid collapses to one column so each card gets full
            // width for title / author / progress meter.
            <ul className="m-lib__cardlist" role="list">
              {sec.rows.map((c) => {
                const { ch, ls, total, done } = nextLessonOf(c, completed);
                const pct = total > 0 ? done / total : 0;
                return (
                  <li key={c.id} className="m-lib__cardcell" {...pressHandlers(c)}>
                    <CourseCard
                      course={c}
                      total={total}
                      done={done}
                      pct={pct}
                      onOpen={() => {
                        // Medium impact on course open — the
                        // "diving into something significant"
                        // moment. Heavier than a chrome tap so
                        // the transition reads as a deliberate
                        // commitment.
                        void haptics.medium();
                        onOpenLesson(c, ch, ls);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            // 2:3 portrait cover tiles, two columns. The cover-art
            // experience.
            <ul className="m-lib__grid" role="list">
              {sec.rows.map((c) => {
                const { ch, ls, total, done } = nextLessonOf(c, completed);
                const pct = total > 0 ? done / total : 0;
                return (
                  <li key={c.id} className="m-lib__cell" {...pressHandlers(c)}>
                    <BookCover
                      course={c}
                      progress={pct}
                      onOpen={() => {
                        void haptics.medium();
                        onOpenLesson(c, ch, ls);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {/* Manage sheet — long-press target. Backdrop tap or Cancel
          dismisses; Remove hands off to MobileApp's uninstall flow. */}
      {manageCourse && (
        <div
          className="m-lib__sheet-backdrop"
          onClick={() => setManageCourse(null)}
        >
          <div
            className="m-lib__sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Manage ${manageCourse.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="m-lib__sheet-grip" aria-hidden />
            <div className="m-lib__sheet-title">{manageCourse.title}</div>
            <button
              type="button"
              className="m-lib__sheet-btn m-lib__sheet-btn--danger"
              onClick={() => {
                const c = manageCourse;
                setManageCourse(null);
                void haptics.warning();
                void onUninstall?.(c);
              }}
            >
              Remove from library
            </button>
            <button
              type="button"
              className="m-lib__sheet-btn"
              onClick={() => setManageCourse(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Old `CoverArt` helper removed — its responsibilities (cover load,
// fallback tile, language tint) are now handled by the shared
// `<BookCover>` component which mobile uses identically to desktop.
