import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@base/primitives/icon";
import { fileText } from "@base/primitives/icon/icons/file-text";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { compass as compassIcon } from "@base/primitives/icon/icons/compass";
import { trees as treesIcon } from "@base/primitives/icon/icons/trees";
import { settings as settingsIcon } from "@base/primitives/icon/icons/settings";
import { download as downloadIcon } from "@base/primitives/icon/icons/download";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { terminal as terminalIcon } from "@base/primitives/icon/icons/terminal";
import { swords } from "@base/primitives/icon/icons/swords";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";
import "@base/primitives/icon/icon.css";
import type { Course } from "../../data/types";
import { isChallengePack } from "../../data/types";
import { languageLabel } from "./labels";
import CourseGroup from "./CourseGroup";
import CourseCarousel from "./CourseCarousel";
import DocsSidebarNav, { SidebarNavItem } from "./DocsSidebarNav";
import "./Sidebar.css";

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
  /// Discover route — browse catalog books + challenge packs not
  /// yet in the user's library. Distinct from `onLibrary` so the
  /// installed shelf and the available-to-install shelf don't
  /// share a surface. Optional — embeddings without a discover
  /// view just don't render the entry.
  onDiscover?: () => void;
  onSettings: () => void;
  /// Trees route — skill-tree explorer. Optional so embeddings
  /// without a trees pane (popped workbench, mobile) don't grow a
  /// dead chip.
  onTrees?: () => void;
  /// Playground route — free-form coding sandbox, jsfiddle-style.
  onPlayground?: () => void;
  /// Docs route — in-app documentation. Optional so embeddings of the
  /// sidebar without a docs pane (e.g. the popped-out workbench window)
  /// don't grow a dead chip.
  onDocs?: () => void;
  /// When `activeView === "docs"`, the sidebar swaps its course tree
  /// for a docs-page nav driven by this id. Lifted from App-level so
  /// the same state drives both the sidebar list and DocsView's main
  /// pane — without it the user would see two separate sidebars.
  /// Undefined means "not in docs mode" and the sidebar renders the
  /// regular course tree.
  docsActiveId?: string;
  /// Called when the user clicks a docs page in the sidebar nav.
  /// App.tsx forwards this to its `setDocsActiveId` so DocsView
  /// re-renders with the new page. Optional so callers without docs
  /// support don't have to wire it up.
  onDocsSelect?: (pageId: string) => void;
  /// Which main-pane destination is currently showing. Used ONLY to draw
  /// an active state on the matching icon chip; clicking a chip calls
  /// its callback and lets the parent manage the state transition.
  /// "profile" stays a valid destination even though it's no longer in
  /// the sidebar — the top-bar streak pill's "View profile" CTA sets it.
  activeView?:
    | "courses"
    | "profile"
    | "playground"
    | "library"
    | "discover"
    | "docs"
    | "trees";
  onExportCourse?: (courseId: string, courseTitle: string) => void;
  onDeleteCourse?: (courseId: string, courseTitle: string) => void;
  onCourseSettings?: (courseId: string) => void;
  /// Wipe a single lesson's completion. Surfaced via the lesson row's
  /// right-click menu when the lesson is currently marked complete.
  onResetLesson?: (courseId: string, lessonId: string) => void;
  /// Wipe every completion in a chapter. The sidebar passes the chapter's
  /// lesson_ids since completions are stored flat per-lesson (no chapter id
  /// in the schema).
  onResetChapter?: (courseId: string, lessonIds: string[]) => void;
  /// Wipe every completion in a course. Reachable from the course
  /// right-click menu (sits between Export and Delete).
  onResetCourse?: (courseId: string) => void;
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
  onDiscover,
  onTrees,
  onSettings,
  onPlayground,
  onDocs,
  docsActiveId,
  onDocsSelect,
  activeView = "courses",
  onExportCourse,
  onDeleteCourse,
  onCourseSettings,
  onResetLesson,
  onResetChapter,
  onResetCourse,
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

  /// Same shape, separate state slot for the chapter right-click menu —
  /// the data shape differs (chapter title, lesson_ids) so reusing `menu`
  /// would mean a discriminated union. A second slot is simpler.
  const [chapterMenu, setChapterMenu] = useState<{
    courseId: string;
    chapterTitle: string;
    lessonIds: string[];
    x: number;
    y: number;
  } | null>(null);

  /// Lesson right-click menu. Only opened for completed lessons (the only
  /// V1 action is "mark incomplete"); incomplete lessons skip the menu
  /// entirely so the learner doesn't see an empty popover.
  const [lessonMenu, setLessonMenu] = useState<{
    courseId: string;
    lessonId: string;
    lessonTitle: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    // One shared close path so a click anywhere outside (or Escape) drops
    // whichever of the three menus is open. Only attach the listeners
    // when something IS open — saves a no-op listener on every render.
    const anyOpen = menu || chapterMenu || lessonMenu;
    if (!anyOpen) return;
    const close = () => {
      setMenu(null);
      setChapterMenu(null);
      setLessonMenu(null);
    };
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
  }, [menu, chapterMenu, lessonMenu]);

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
          the course — the parent resolves which lesson to resume.
          Also hidden when the sidebar is in docs mode — the rail
          becomes the docs nav, so a course-switcher would be noise. */}
      {activeView !== "docs" && onSelectCourse && (
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
        {onDiscover && (
          <SidebarNavItem
            icon={compassIcon}
            label="Discover"
            onClick={onDiscover}
            active={activeView === "discover"}
          />
        )}
        {onTrees && (
          <SidebarNavItem
            icon={treesIcon}
            label="Trees"
            onClick={onTrees}
            active={activeView === "trees"}
          />
        )}
        {onPlayground && (
          <SidebarNavItem
            icon={terminalIcon}
            label="Playground"
            onClick={onPlayground}
            active={activeView === "playground"}
          />
        )}
        {onDocs && (
          <SidebarNavItem
            icon={fileText}
            label="Docs"
            onClick={onDocs}
            active={activeView === "docs"}
          />
        )}
        <SidebarNavItem
          icon={settingsIcon}
          label="Settings"
          onClick={onSettings}
        />
      </div>

      {activeView === "docs" ? (
        <DocsSidebarNav
          activeId={docsActiveId}
          onSelect={onDocsSelect}
        />
      ) : (
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
                onExportCourse || onDeleteCourse || onCourseSettings || onResetCourse
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
              onChapterContextMenu={
                onResetChapter
                  ? (chapter, e) => {
                      e.preventDefault();
                      setChapterMenu({
                        courseId: course.id,
                        chapterTitle: chapter.title,
                        lessonIds: chapter.lessons.map((l) => l.id),
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }
                  : undefined
              }
              onLessonContextMenu={
                onResetLesson
                  ? (lesson, isCompleted, e) => {
                      // Skip the menu entirely for not-yet-completed
                      // lessons — the only V1 action is reset, and
                      // there's nothing to reset.
                      if (!isCompleted) return;
                      e.preventDefault();
                      setLessonMenu({
                        courseId: course.id,
                        lessonId: lesson.id,
                        lessonTitle: lesson.title,
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

          // The sidebar is the LEARNER'S BENCH — only show courses the
          // learner has touched (≥1 completed lesson). Untouched courses
          // live on the Library page where the learner goes to *find new
          // things*. Without this filter, a bundled-pack-heavy install
          // dumps 24 sections into the sidebar and turns a working
          // surface into a discovery surface. The active course is an
          // exception — if you JUST opened a course, we want it visible
          // in "Current" even though completion is still 0.
          const isStarted = (c: Course): boolean =>
            c.chapters.some((ch) =>
              ch.lessons.some((l) => completed.has(`${c.id}:${l.id}`)),
            );

          const inactiveBooks = books.filter(
            (c) => c.id !== activeCourseId && isStarted(c),
          );
          // Challenge packs intentionally skip the `isStarted` filter
          // — packs are small, language-pickable practice surfaces, and
          // the "I have a Ruby pack but never saw it because the
          // sidebar hid it until I started a lesson" failure mode is
          // worse than showing 11 unstarted tiles. Books still filter
          // by started so the bench doesn't drown in 30+ untouched
          // long-form courses on a fresh install.
          const inactivePacks = packs.filter((c) => c.id !== activeCourseId);

          // Language-filtered packs when focused on a course. We match
          // the pack's primary language to the active course's language.
          const relevantPacks = activeCourse
            ? inactivePacks.filter((p) => p.language === activeCourse.language)
            : inactivePacks;

          // Empty state: no started courses AND no active course means
          // a brand-new install (or the learner reset everything). Send
          // them to the library — that's where new courses come from.
          const hasAnything =
            !!activeCourse || inactiveBooks.length > 0 || relevantPacks.length > 0;

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
                  <div className="fishbones__nav-section">In progress</div>
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
              {!hasAnything && (
                <div className="fishbones__nav-empty">
                  <p className="fishbones__nav-empty-headline">
                    Nothing started yet
                  </p>
                  <p className="fishbones__nav-empty-body">
                    Pick something from the library to get going. Courses
                    you start will show up here.
                  </p>
                  <button
                    type="button"
                    className="fishbones__nav-empty-cta"
                    onClick={onLibrary}
                  >
                    <span aria-hidden>
                      <Icon icon={libraryBig} size="xs" color="currentColor" />
                    </span>
                    Open Library
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </nav>
      )}

      {menu && (onExportCourse || onDeleteCourse || onCourseSettings || onResetCourse) && createPortal(
        <div
          className="fishbones__context-menu"
          // Position at cursor. Fixed positioning so scroll state doesn't
          // matter — the window-level click listener dismisses us anyway.
          // Portalled to document.body so the sidebar's `backdrop-filter`
          // (which makes the sidebar a containing block for fixed
          // descendants) doesn't clip us.
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
          {/* Reset progress sits between the safe actions and Delete:
              destructive in that it wipes completion state, but recoverable
              (the lessons are still there to re-complete). Styled like the
              Settings/Export rows, NOT like the Delete row. */}
          {onResetCourse && (
            <button
              className="fishbones__context-menu-item"
              onClick={() => {
                onResetCourse(menu.courseId);
                setMenu(null);
              }}
            >
              <span className="fishbones__context-menu-icon" aria-hidden>
                <Icon icon={rotateCcw} size="xs" color="currentColor" />
              </span>
              Reset progress
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
        </div>,
        document.body,
      )}

      {chapterMenu && onResetChapter && createPortal(
        <div
          className="fishbones__context-menu"
          style={{ left: chapterMenu.x, top: chapterMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fishbones__context-menu-label">{chapterMenu.chapterTitle}</div>
          <button
            className="fishbones__context-menu-item"
            onClick={() => {
              onResetChapter(chapterMenu.courseId, chapterMenu.lessonIds);
              setChapterMenu(null);
            }}
          >
            <span className="fishbones__context-menu-icon" aria-hidden>
              <Icon icon={rotateCcw} size="xs" color="currentColor" />
            </span>
            Reset chapter progress
          </button>
        </div>,
        document.body,
      )}

      {lessonMenu && onResetLesson && createPortal(
        <div
          className="fishbones__context-menu"
          style={{ left: lessonMenu.x, top: lessonMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fishbones__context-menu-label">{lessonMenu.lessonTitle}</div>
          <button
            className="fishbones__context-menu-item"
            onClick={() => {
              onResetLesson(lessonMenu.courseId, lessonMenu.lessonId);
              setLessonMenu(null);
            }}
          >
            <span className="fishbones__context-menu-icon" aria-hidden>
              <Icon icon={rotateCcw} size="xs" color="currentColor" />
            </span>
            Mark incomplete
          </button>
        </div>,
        document.body,
      )}
    </aside>
  );
}
