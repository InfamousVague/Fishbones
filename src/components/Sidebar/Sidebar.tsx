import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { bookOpen } from "@base/primitives/icon/icons/book-open";
import { code as codeIcon } from "@base/primitives/icon/icons/code";
import { helpCircle } from "@base/primitives/icon/icons/help-circle";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { settings as settingsIcon } from "@base/primitives/icon/icons/settings";
import { download as downloadIcon } from "@base/primitives/icon/icons/download";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { terminal as terminalIcon } from "@base/primitives/icon/icons/terminal";
import { swords } from "@base/primitives/icon/icons/swords";
import "@base/primitives/icon/icon.css";
import type { Course, Chapter, Lesson, LanguageId } from "../../data/types";
import { isChallengePack } from "../../data/types";
import { useCourseCover } from "../../hooks/useCourseCover";
import "./Sidebar.css";

/// Display name for a language id. Used by the "Rust challenges" style
/// section header so the learner sees which subset we're showing, not
/// a bare "Challenge packs" that's ambiguous when filtered.
function languageLabel(lang: LanguageId): string {
  switch (lang) {
    case "javascript":
      return "JavaScript";
    case "typescript":
      return "TypeScript";
    case "python":
      return "Python";
    case "rust":
      return "Rust";
    case "swift":
      return "Swift";
    case "go":
      return "Go";
    case "web":
      return "Web";
    case "threejs":
      return "Three.js";
    case "react":
      return "React";
    case "reactnative":
      return "React Native";
    case "c":
      return "C";
    case "cpp":
      return "C++";
    case "java":
      return "Java";
    case "kotlin":
      return "Kotlin";
    case "csharp":
      return "C#";
    case "assembly":
      return "Assembly";
  }
}

/// Maps a lesson kind to the glyph shown to the left of its title in the
/// sidebar. Keeping this in one place so adding a new lesson type is a
/// one-line change rather than hunting through LessonRow.
function iconForKind(kind: Lesson["kind"]) {
  switch (kind) {
    case "reading":
      return bookOpen;
    case "exercise":
    case "mixed":
      return codeIcon;
    case "quiz":
      return helpCircle;
  }
}

interface Props {
  courses: Course[];
  activeCourseId?: string;
  activeLessonId?: string;
  completed: Set<string>;
  /// Per-course "last opened" timestamps keyed by course id. Used ONLY
  /// by the sidebar-header carousel to sort recent-first — the course
  /// tree itself doesn't care about timestamps. Empty map is fine
  /// (carousel falls back to course array order).
  recents?: Record<string, number>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  /// Jump to a course via the header carousel — parent resolves the
  /// "resume at" lesson (last-open tab or first lesson) and hands that
  /// through. Separate from onSelectLesson so the carousel's click
  /// behavior is explicit rather than guessing a lesson id here.
  onSelectCourse?: (courseId: string) => void;
  /// Opens the course library modal.
  onLibrary: () => void;
  onSettings: () => void;
  /// Playground route — free-form coding sandbox, jsfiddle-style.
  onPlayground?: () => void;
  /// Which main-pane destination is currently showing. Used ONLY to draw
  /// an active state on the matching icon chip; clicking a chip calls
  /// its callback and lets the parent manage the state transition.
  /// "profile" stays a valid destination even though it's no longer in
  /// the sidebar — the top-bar streak pill's "View profile" CTA sets it.
  activeView?: "courses" | "profile" | "playground" | "library";
  onExportCourse?: (courseId: string, courseTitle: string) => void;
  onDeleteCourse?: (courseId: string, courseTitle: string) => void;
  onCourseSettings?: (courseId: string) => void;
}

/// Floating left rail. Completion dots fill in as lessons get marked done
/// (unit test passes, mark-read, etc.). The chapter header shows `x / y`
/// lessons complete so users see progress at a glance.
export default function Sidebar({
  courses,
  activeCourseId,
  activeLessonId,
  completed,
  recents = {},
  onSelectLesson,
  onSelectCourse,
  onLibrary,
  onSettings,
  onPlayground,
  activeView = "courses",
  onExportCourse,
  onDeleteCourse,
  onCourseSettings,
}: Props) {
  /// Open context menu state, positioned at the cursor when a course card
  /// is right-clicked. One menu at a time across the sidebar — opening a
  /// new one closes the previous. Clicking outside, pressing Escape, or
  /// scrolling the sidebar dismisses it.
  const [menu, setMenu] = useState<{
    courseId: string;
    courseTitle: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // `click` (not `mousedown`) so the click that opens a menu item still
    // hits the item before the dismiss fires. `contextmenu` dismiss on a
    // different card lets the new card open its own menu immediately.
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <aside className="fishbones__sidebar">
      {/* Primary nav — vertical list with icon + label. Claude-Code-style:
          full-width rows, clear call-outs, no ambiguity about what each
          chip does. Routes (Profile / Playground) show an active state
          when their view is open; one-shot actions (Library / Import /
          Settings) stay neutral. */}
      {/* Sidebar nav is now a thin trio: Library (which owns all the
          import flows — PDF + bulk PDF + .fishbones archive), the
          Playground route, and Settings. Profile lives on the top-bar
          streak pill alongside level/XP so it's adjacent to the data
          it belongs with, not hiding in the left rail. */}
      {/* Recent-courses carousel lives at the very top of the sidebar —
          it's the first thing the learner's eye hits when switching
          contexts. Horizontally scrollable row of cover thumbnails,
          newest-activity first. Hidden when there's 0 or 1 course
          (nothing to switch between). Clicking a thumbnail jumps to
          the course — the parent resolves which lesson to resume. */}
      {onSelectCourse && (
        <CourseCarousel
          courses={courses}
          recents={recents}
          completed={completed}
          onSelectCourse={onSelectCourse}
          onContextMenu={
            onExportCourse || onDeleteCourse || onCourseSettings
              ? (course, e) => {
                  e.preventDefault();
                  setMenu({
                    courseId: course.id,
                    courseTitle: course.title,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }
              : undefined
          }
        />
      )}

      {/* Primary nav sits BELOW the carousel. Rationale: the carousel
          is the frequent-action (switch course); the nav is the
          occasional-action (import, settings, playground). Putting the
          frequent one first matches how the learner actually uses the
          sidebar. */}
      <div className="fishbones__sidebar-nav">
        <SidebarNavItem
          icon={libraryBig}
          label="Library"
          onClick={onLibrary}
          active={activeView === "library"}
        />
        {onPlayground && (
          <SidebarNavItem
            icon={terminalIcon}
            label="Playground"
            onClick={onPlayground}
            active={activeView === "playground"}
          />
        )}
        <SidebarNavItem
          icon={settingsIcon}
          label="Settings"
          onClick={onSettings}
        />
      </div>

      <nav className="fishbones__nav">
        {(() => {
          // Partition into books vs challenge packs so they render under
          // distinct section headers. Order within each group is preserved
          // (newest-first comes from the caller). We still render a single
          // list when only one kind is present — no empty headers.
          const books = courses.filter((c) => !isChallengePack(c));
          const packs = courses.filter((c) => isChallengePack(c));

          const renderGroup = (
            course: Course,
          ): React.ReactElement => (
            <CourseGroup
              key={course.id}
              course={course}
              isActiveCourse={course.id === activeCourseId}
              activeLessonId={activeLessonId}
              completed={completed}
              onSelectLesson={onSelectLesson}
              onContextMenu={
                onExportCourse || onDeleteCourse || onCourseSettings
                  ? (e: React.MouseEvent) => {
                      e.preventDefault();
                      setMenu({
                        courseId: course.id,
                        courseTitle: course.title,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }
                  : undefined
              }
            />
          );

          // Active course (if any) is lifted to the top of the nav under
          // a "Current" header so the "which course am I in" question is
          // answered before the eye even reaches the list. When you ARE
          // focused on a course, the rest of the sidebar narrows to just
          // that language's challenge packs — other courses would be
          // noise you're not currently using, challenge packs in the
          // same language are the natural practice companion. When no
          // course is active (just launched, or on Profile / Playground),
          // we skip the Current header and show everything under the
          // normal sections so the learner can pick.
          const activeCourse =
            courses.find((c) => c.id === activeCourseId) ?? null;
          const inactiveBooks = books.filter((c) => c.id !== activeCourseId);
          const inactivePacks = packs.filter((c) => c.id !== activeCourseId);

          // Language-filtered packs when focused on a course. We match
          // the pack's primary language to the active course's language.
          const relevantPacks = activeCourse
            ? inactivePacks.filter((p) => p.language === activeCourse.language)
            : inactivePacks;

          return (
            <>
              {activeCourse && (
                <>
                  <div className="fishbones__nav-section">Current</div>
                  {renderGroup(activeCourse)}
                </>
              )}
              {!activeCourse && inactiveBooks.length > 0 && (
                <>
                  <div className="fishbones__nav-section">Courses</div>
                  {inactiveBooks.map(renderGroup)}
                </>
              )}
              {relevantPacks.length > 0 && (
                <>
                  <div className="fishbones__nav-section fishbones__nav-section--packs">
                    <span className="fishbones__nav-section-icon" aria-hidden>
                      <Icon icon={swords} size="xs" color="currentColor" />
                    </span>
                    {activeCourse
                      ? `${languageLabel(activeCourse.language)} challenges`
                      : "Challenge packs"}
                  </div>
                  {relevantPacks.map(renderGroup)}
                </>
              )}
            </>
          );
        })()}
      </nav>

      {menu && (onExportCourse || onDeleteCourse || onCourseSettings) && (
        <div
          className="fishbones__context-menu"
          // Position at cursor. Fixed positioning so scroll state doesn't
          // matter — the window-level click listener dismisses us anyway.
          style={{ left: menu.x, top: menu.y }}
          // Stop the click from bubbling to window and dismissing before
          // the item's onClick fires.
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fishbones__context-menu-label">{menu.courseTitle}</div>
          {onCourseSettings && (
            <button
              className="fishbones__context-menu-item"
              onClick={() => {
                onCourseSettings(menu.courseId);
                setMenu(null);
              }}
            >
              <span className="fishbones__context-menu-icon" aria-hidden>
                <Icon icon={settingsIcon} size="xs" color="currentColor" />
              </span>
              Course settings…
            </button>
          )}
          {onExportCourse && (
            <button
              className="fishbones__context-menu-item"
              onClick={() => {
                onExportCourse(menu.courseId, menu.courseTitle);
                setMenu(null);
              }}
            >
              <span className="fishbones__context-menu-icon" aria-hidden>
                <Icon icon={downloadIcon} size="xs" color="currentColor" />
              </span>
              Export course…
            </button>
          )}
          {onDeleteCourse && (
            <>
              {/* Separator between non-destructive and destructive actions. */}
              <div className="fishbones__context-menu-sep" aria-hidden />
              <button
                className="fishbones__context-menu-item fishbones__context-menu-item--danger"
                onClick={() => {
                  onDeleteCourse(menu.courseId, menu.courseTitle);
                  setMenu(null);
                }}
              >
                <span className="fishbones__context-menu-icon" aria-hidden>
                  <Icon icon={xIcon} size="xs" color="currentColor" />
                </span>
                Delete course…
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function CourseGroup({
  course,
  isActiveCourse,
  activeLessonId,
  completed,
  onSelectLesson,
  onContextMenu,
}: {
  course: Course;
  isActiveCourse: boolean;
  activeLessonId?: string;
  completed: Set<string>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  // The active course is always expanded — the learner is working inside
  // it and needs its tree visible. Inactive courses default collapsed;
  // clicking the row expands them inline so the learner can peek
  // without switching focus.
  const [expanded, setExpanded] = useState(isActiveCourse);

  const totalLessons = course.chapters.reduce((n, ch) => n + ch.lessons.length, 0);
  const doneLessons = course.chapters.reduce(
    (n, ch) => n + ch.lessons.filter((l) => completed.has(`${course.id}:${l.id}`)).length,
    0
  );
  const pct = totalLessons > 0 ? doneLessons / totalLessons : 0;

  // Active course: full card with progress bar, always expanded. The
  // elevated surface and the progress-bar treatment advertise "this is
  // the course you're in" unambiguously.
  if (isActiveCourse) {
    return (
      <div className="fishbones__course fishbones__course--active">
        <div
          className="fishbones__course-card fishbones__course-card--expanded fishbones__course-card--active"
          onContextMenu={onContextMenu}
        >
          <div className="fishbones__course-title fishbones__course-title--static">
            <span className="fishbones__course-active-dot" aria-hidden />
            <span className="fishbones__course-name">{course.title}</span>
            <span className="fishbones__course-progress">
              {doneLessons}/{totalLessons}
            </span>
          </div>
          <div className="fishbones__course-progress-bar" aria-hidden>
            <div
              className="fishbones__course-progress-fill"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>

        <div className="fishbones__course-body">
          {course.chapters.map((chapter) => (
            <ChapterBlock
              key={chapter.id}
              chapter={chapter}
              courseId={course.id}
              activeLessonId={activeLessonId}
              completed={completed}
              onSelectLesson={onSelectLesson}
            />
          ))}
        </div>
      </div>
    );
  }

  // Inactive course: compact single-line row that matches the top nav
  // item pattern (icon/caret + label + trailing count). Clicking the
  // row expands inline so the learner can still jump into a specific
  // lesson of a non-focused course without changing this one's "active"
  // state — selecting a lesson inside will promote it to active via
  // `onSelectLesson`, at which point the next render treats it as
  // active and shows the full card.
  return (
    <div className="fishbones__course fishbones__course--compact">
      <button
        className="fishbones__course-row"
        onClick={() => setExpanded(!expanded)}
        onContextMenu={onContextMenu}
      >
        <span className="fishbones__course-row-caret" aria-hidden>
          <Icon
            icon={expanded ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        <span className="fishbones__course-name">{course.title}</span>
        <span className="fishbones__course-row-progress">
          {doneLessons}/{totalLessons}
        </span>
      </button>

      {expanded && (
        <div className="fishbones__course-body">
          {course.chapters.map((chapter) => (
            <ChapterBlock
              key={chapter.id}
              chapter={chapter}
              courseId={course.id}
              activeLessonId={undefined}
              completed={completed}
              onSelectLesson={onSelectLesson}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/// FLIP animation constants. Must stay in sync with
/// `.fishbones__carousel-item` width (74) and `.fishbones__carousel-scroll`
/// gap (10) in Sidebar.css. We hardcode rather than measuring at runtime
/// because the values are stable and per-render DOM reads are wasted work.
const CAROUSEL_CARD_WIDTH_PX = 74;
const CAROUSEL_CARD_GAP_PX = 10;
const CAROUSEL_CARD_STEP_PX = CAROUSEL_CARD_WIDTH_PX + CAROUSEL_CARD_GAP_PX;
const CAROUSEL_SLIDE_MS = 350;

/// Horizontal-scrolling thumbnail row in the sidebar header. Ordered by
/// last-opened timestamp (see `useRecentCourses`) so the course the
/// learner was just in lands at the left edge — regardless of whether
/// they completed a lesson in it. Courses with no open-timestamp fall
/// to the right in their natural array order. Hidden when there are
/// < 2 courses — switching is pointless.
///
/// Reorder behaviour uses FLIP animation: when a click bumps a book to
/// the front, the user sees the book GLIDE from its old slot to slot 0
/// rather than teleporting. Neighbours also slide down by one to fill
/// the hole. Feels like a real reshuffle instead of a jarring jump.
function CourseCarousel({
  courses,
  recents,
  completed,
  onSelectCourse,
  onContextMenu,
}: {
  courses: Course[];
  recents: Record<string, number>;
  /// Lesson completion set (keys: `${courseId}:${lessonId}`). Used to
  /// draw a per-cover progress strip so the carousel gives at-a-glance
  /// "how far am I in each book" signal.
  completed: Set<string>;
  onSelectCourse: (courseId: string) => void;
  onContextMenu?: (course: Course, e: React.MouseEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /// Each course's index at the END of the previous render. We compare
  /// against the current sort to figure out which cards moved and by
  /// how many slots — that delta drives the invert-translate step of
  /// the FLIP animation.
  const prevIndicesRef = useRef<Map<string, number>>(new Map());

  const sorted = useMemo(() => {
    // Bucket courses: ones with a recents entry (known activity time)
    // vs ones without. Within the "known" bucket, recent-first. The
    // unknown bucket keeps the original array order (library's
    // newest-imported-first convention) at the end.
    const withRecents = courses
      .filter((c) => recents[c.id] !== undefined)
      .sort((a, b) => (recents[b.id] ?? 0) - (recents[a.id] ?? 0));
    const withoutRecents = courses.filter((c) => recents[c.id] === undefined);
    return [...withRecents, ...withoutRecents];
  }, [courses, recents]);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    // Build the new index map fresh each render so we can compare to
    // the stashed previous map. Using a Map (not a Record) because
    // forEach over entries is cleaner and reads better in the loops
    // below.
    const newIndices = new Map<string, number>();
    sorted.forEach((c, i) => newIndices.set(c.id, i));

    const prev = prevIndicesRef.current;
    prevIndicesRef.current = newIndices;

    // First render: nothing to animate from. Also skips the case where
    // the carousel mounted with < 2 courses and is only now crossing
    // the threshold — we'd rather the row appear in place than have
    // a multi-card cascade of slides on first show.
    if (prev.size === 0) return;

    // Invert step: any card whose index changed gets an inline
    // translateX that puts it BACK at its old visual position. We
    // collect them into an array so the subsequent play step doesn't
    // have to re-query the DOM.
    const animating: HTMLElement[] = [];
    for (const [id, newIdx] of newIndices) {
      const prevIdx = prev.get(id);
      if (prevIdx === undefined || prevIdx === newIdx) continue;
      const el = scrollEl.querySelector<HTMLElement>(
        `[data-course-id="${CSS.escape(id)}"]`,
      );
      if (!el) continue;
      const deltaX = (prevIdx - newIdx) * CAROUSEL_CARD_STEP_PX;
      el.style.transition = "none";
      el.style.transform = `translateX(${deltaX}px)`;
      animating.push(el);
    }

    if (animating.length === 0) return;

    // Force a synchronous layout so the browser commits the invert
    // transforms before we queue the play. Without this, some browsers
    // will batch the two style changes and skip straight to identity.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    scrollEl.offsetWidth;

    // Play step: on the next frame, enable the transition and clear
    // the inline transform so each card animates from its old position
    // (invert) back to identity (its new slot).
    const rafId = requestAnimationFrame(() => {
      for (const el of animating) {
        el.style.transition = `transform ${CAROUSEL_SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        el.style.transform = "";
      }
    });

    // Once the slide finishes, release the inline `transition` so the
    // base CSS transition (0.18s on hover scale) takes over again.
    // Small buffer on the timeout so we don't cut off the last frame.
    const cleanupId = window.setTimeout(() => {
      for (const el of animating) {
        el.style.transition = "";
      }
    }, CAROUSEL_SLIDE_MS + 50);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(cleanupId);
    };
  }, [sorted]);

  if (sorted.length < 2) return null;

  return (
    <div className="fishbones__carousel" aria-label="Recent courses">
      <div className="fishbones__carousel-scroll" ref={scrollRef}>
        {sorted.map((c) => (
          <CarouselItem
            key={c.id}
            course={c}
            progress={courseProgress(c, completed)}
            onClick={() => onSelectCourse(c.id)}
            onContextMenu={
              onContextMenu ? (e) => onContextMenu(c, e) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

/// Single cover thumbnail in the carousel. Shows the extracted cover if
/// one exists; otherwise a language-tinted mini-tile with the short
/// language code. Same cover-loading path as BookCover — the hook
/// dedupes repeat requests across mounts.
function CarouselItem({
  course,
  progress,
  onClick,
  onContextMenu,
}: {
  course: Course;
  /// Fraction 0..1 of completed lessons. Drives the bottom progress
  /// strip over the cover. Also surfaces in the tooltip so hovering a
  /// thumbnail gives a concrete "x of y" number.
  progress: { pct: number; done: number; total: number };
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const coverUrl = useCourseCover(course.id, course.coverFetchedAt);
  const hasCover = !!coverUrl;
  const { pct, done, total } = progress;
  const pctLabel =
    total === 0
      ? ""
      : pct === 1
      ? " · complete"
      : pct === 0
      ? " · not started"
      : ` · ${done}/${total} lessons`;

  return (
    <button
      type="button"
      data-course-id={course.id}
      className={`fishbones__carousel-item fishbones__carousel-item--lang-${course.language} ${
        hasCover ? "" : "fishbones__carousel-item--no-cover"
      }`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`${course.title}${pctLabel}`}
      aria-label={`Open ${course.title}${pctLabel}`}
    >
      {hasCover ? (
        <img
          className="fishbones__carousel-cover"
          src={coverUrl}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="fishbones__carousel-glyph" aria-hidden>
          {carouselGlyph(course.language)}
        </span>
      )}
      {/* Title + author overlay with a dark gradient, matching the
          library shelf's BookCover treatment so carousel thumbs read
          as miniaturized versions of the same card. Only shown when
          there's a cover — fallback tiles already surface the title
          via the language-tinted block itself. */}
      {hasCover && (
        <>
          <span className="fishbones__carousel-shadow" aria-hidden />
          <span className="fishbones__carousel-label">
            <span className="fishbones__carousel-label-title">{course.title}</span>
            {course.author && (
              <span className="fishbones__carousel-label-author">
                {course.author}
              </span>
            )}
          </span>
        </>
      )}
      {/* Progress strip along the bottom edge of the cover. Shown for
          every course (even 0%) so the carousel reads as a consistent
          row of status bars — uniform height keeps the cover row from
          jumping when the learner's first completion lands. */}
      {total > 0 && (
        <span className="fishbones__carousel-progress" aria-hidden>
          <span
            className="fishbones__carousel-progress-fill"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </span>
      )}
    </button>
  );
}

/// Compute the 0..1 progress fraction for a course given the completion
/// set the sidebar already has in scope. Keyed by `${courseId}:${lessonId}`
/// so it mirrors the shape used everywhere else (useProgress, library,
/// profile view).
function courseProgress(
  course: Course,
  completed: Set<string>,
): { pct: number; done: number; total: number } {
  let total = 0;
  let done = 0;
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      total += 1;
      if (completed.has(`${course.id}:${l.id}`)) done += 1;
    }
  }
  return { pct: total > 0 ? done / total : 0, done, total };
}

/// Short language tag for the carousel fallback tile. Same list as
/// BookCover.tsx's langGlyph — kept local here so the sidebar doesn't
/// import internals from the library folder.
function carouselGlyph(lang: LanguageId): string {
  switch (lang) {
    case "javascript":
      return "JS";
    case "typescript":
      return "TS";
    case "python":
      return "PY";
    case "rust":
      return "RS";
    case "swift":
      return "SW";
    case "go":
      return "GO";
    case "web":
      return "WEB";
    case "threejs":
      return "3D";
    case "react":
      return "RX";
    case "reactnative":
      return "RN";
    case "c":
      return "C";
    case "cpp":
      return "C++";
    case "java":
      return "JV";
    case "kotlin":
      return "KT";
    case "csharp":
      return "C#";
    case "assembly":
      return "ASM";
  }
}

/// Vertical nav-list row at the top of the sidebar. Icon + label, full
/// width. `active` controls the highlighted pill state for persistent
/// destinations (Profile, Playground) so the learner always knows which
/// main-pane route they're on.
function SidebarNavItem({
  icon,
  label,
  onClick,
  active,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`fishbones__sidebar-nav-item ${active ? "fishbones__sidebar-nav-item--active" : ""}`}
      onClick={onClick}
    >
      <span className="fishbones__sidebar-nav-icon" aria-hidden>
        <Icon icon={icon} size="sm" color="currentColor" />
      </span>
      <span className="fishbones__sidebar-nav-label">{label}</span>
    </button>
  );
}

function ChapterBlock({
  chapter,
  courseId,
  activeLessonId,
  completed,
  onSelectLesson,
}: {
  chapter: Chapter;
  courseId: string;
  activeLessonId?: string;
  completed: Set<string>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
}) {
  const done = chapter.lessons.filter((l) => completed.has(`${courseId}:${l.id}`)).length;
  const total = chapter.lessons.length;

  return (
    <div className="fishbones__chapter">
      <div className="fishbones__chapter-title">
        <span>{chapter.title}</span>
        <span className="fishbones__chapter-progress">
          {done}/{total}
        </span>
      </div>
      {chapter.lessons.map((lesson) => (
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          isCompleted={completed.has(`${courseId}:${lesson.id}`)}
          isActive={lesson.id === activeLessonId}
          onSelect={() => onSelectLesson(courseId, lesson.id)}
          difficulty={
            lesson.kind === "exercise" || lesson.kind === "mixed"
              ? lesson.difficulty
              : undefined
          }
        />
      ))}
    </div>
  );
}

function LessonRow({
  lesson,
  isCompleted,
  isActive,
  onSelect,
  difficulty,
}: {
  lesson: Lesson;
  isCompleted: boolean;
  isActive: boolean;
  onSelect: () => void;
  /// Only present for challenge-pack exercise rows. Drives a colored dot
  /// (easy → green, medium → amber, hard → red) that replaces the default
  /// kind-based accent so a pack reads as ramp-up, not as ordered lessons.
  difficulty?: "easy" | "medium" | "hard";
}) {
  return (
    <button
      className={`fishbones__nav-item fishbones__lesson-item fishbones__lesson-item--${lesson.kind} ${
        isActive ? "fishbones__nav-item--active" : ""
      }`}
      onClick={onSelect}
    >
      <LessonStatusIcon
        kind={lesson.kind}
        completed={isCompleted}
        active={isActive}
        difficulty={difficulty}
      />
      <span className="fishbones__lesson-name">{lesson.title}</span>
    </button>
  );
}

/// Single icon slot to the left of the lesson title. The same kind-glyph
/// (book / code / help-circle) is rendered across every state — only the
/// circle around it changes:
///   - pending: hollow ring, icon is a barely-visible dim gray
///   - active: hollow ring brightened, icon slightly more visible + halo
///   - done:  filled white circle with a black icon inside (inverted)
/// Keeping the glyph persistent means a completed lesson still advertises
/// what it was (reading vs exercise vs quiz), just styled differently.
///
/// When `difficulty` is set (challenge-pack lessons), we ALSO add a
/// `--diff-*` modifier so CSS can tint the pending/active ring to the
/// difficulty color (green/amber/red). Completed state still inverts to
/// the filled white disc — once you've solved it, difficulty is history.
function LessonStatusIcon({
  kind,
  completed,
  active,
  difficulty,
}: {
  kind: Lesson["kind"];
  completed: boolean;
  active: boolean;
  difficulty?: "easy" | "medium" | "hard";
}) {
  const state = completed ? "done" : active ? "active" : "pending";
  const diffClass = difficulty ? ` fishbones__lesson-status--diff-${difficulty}` : "";
  return (
    <span
      className={`fishbones__lesson-status fishbones__lesson-status--${state} fishbones__lesson-status--${kind}${diffClass}`}
      aria-hidden
    >
      <Icon icon={iconForKind(kind)} size="xs" color="currentColor" />
    </span>
  );
}
