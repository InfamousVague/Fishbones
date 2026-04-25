import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Course, Lesson, isExerciseKind, isQuiz } from "./data/types";
import { makeBus, openPoppedWorkbench, closePoppedWorkbench } from "./lib/workbenchSync";
import { deriveSolutionFiles } from "./lib/workbenchFiles";
import { Icon } from "@base/primitives/icon";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { panelLeftOpen } from "@base/primitives/icon/icons/panel-left-open";
import "@base/primitives/icon/icon.css";
import Sidebar from "./components/Sidebar/Sidebar";
import TopBar from "./components/TopBar/TopBar";
import LessonReader from "./components/Lesson/LessonReader";
import LessonNav from "./components/Lesson/LessonNav";
import EditorPane from "./components/Editor/EditorPane";
import OutputPane from "./components/Output/OutputPane";
import Workbench from "./components/Workbench/Workbench";
import MissingToolchainBanner from "./components/MissingToolchain/MissingToolchainBanner";
import { useToolchainStatus } from "./hooks/useToolchainStatus";
import ImportDialog from "./components/ImportDialog/ImportDialog";
import BulkImportDialog from "./components/ImportDialog/BulkImportDialog";
import DocsImportDialog from "./components/ImportDialog/DocsImportDialog";
import SettingsDialog from "./components/SettingsDialog/SettingsDialog";
import CourseLibrary from "./components/Library/CourseLibrary";
import { DeferredMount, LoadingPane } from "./components/Shared/DeferredMount";
import FishbonesLoader from "./components/Shared/FishbonesLoader";
import ConfirmDialog from "./components/ConfirmDialog/ConfirmDialog";
import CourseSettingsModal from "./components/CourseSettings/CourseSettingsModal";
import FloatingIngestPanel from "./components/IngestPanel/FloatingIngestPanel";
import ProfileView from "./components/Profile/ProfileView";
import PlaygroundView from "./components/Playground/PlaygroundView";
import GeneratePackDialog from "./components/ChallengePack/GeneratePackDialog";
import { useIngestRun } from "./hooks/useIngestRun";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import QuizView from "./components/Quiz/QuizView";
import AiAssistant from "./components/AiAssistant/AiAssistant";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import { runFiles, isPassing, type RunResult } from "./runtimes";
import { useProgress } from "./hooks/useProgress";
import { useCourses } from "./hooks/useCourses";
import { useRecentCourses } from "./hooks/useRecentCourses";
import { useStreakAndXp } from "./hooks/useStreakAndXp";
import { useWorkbenchFiles } from "./hooks/useWorkbenchFiles";
import "./App.css";

interface OpenCourse {
  courseId: string;
  lessonId: string;
}

/// Languages that need a local compiler / VM / assembler installed on
/// the host before lessons in them can run. Used by LessonView to
/// decide whether to proactively probe the toolchain + show an install
/// banner. Everything else (JavaScript / TypeScript / Python / Web /
/// Three.js / React Native) runs fully in-browser OR hits an online
/// sandbox (Rust / Go / Swift) so the local machine doesn't need a
/// toolchain. Matches the set of languages `nativeRunners.ts` routes
/// to Tauri `run_*` commands.
const NATIVE_TOOLCHAIN_LANGUAGES = new Set<string>([
  "c",
  "cpp",
  "java",
  "kotlin",
  "csharp",
  "assembly",
]);

export default function App() {
  const {
    courses,
    loaded: coursesLoaded,
    refresh: refreshCourses,
    hydrateCourse,
    hydrating,
  } = useCourses();

  const [openTabs, setOpenTabs] = useState<OpenCourse[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [docsImportOpen, setDocsImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Pending delete request queued by the library / sidebar context menu.
  // Kept in state rather than firing window.confirm() directly so we can
  // render an app-styled modal with Escape + backdrop-click dismissal.
  const [pendingDelete, setPendingDelete] = useState<{
    courseId: string;
    courseTitle: string;
  } | null>(null);

  /// Completion state lives in SQLite; the hook loads on mount and writes
  /// through on markCompleted. Keys are `${courseId}:${lessonId}`.
  const { completed, history, markCompleted } = useProgress();

  /// Timestamp of the last fresh completion (transition from incomplete →
  /// complete). Drives the AI tutor's happy-celebration loop. Plain
  /// markCompleted is idempotent — re-passing a lesson the user has
  /// already finished doesn't re-fire it — so we filter on the
  /// `completed` set up here. The AiAssistant resets to idle on its
  /// own a few seconds later.
  const [celebrateAt, setCelebrateAt] = useState(0);
  function markCompletedAndCelebrate(courseId: string, lessonId: string) {
    const key = `${courseId}:${lessonId}`;
    if (!completed.has(key)) setCelebrateAt(Date.now());
    markCompleted(courseId, lessonId);
  }
  const stats = useStreakAndXp(history, courses);

  /// Per-course "last opened" timestamps for the sidebar carousel. Stored
  /// in localStorage so recent-first ordering survives an app restart.
  /// Updated inside selectLesson so any path that navigates to a course
  /// (tab click, sidebar lesson click, carousel click, library open) feeds
  /// the signal uniformly.
  const { recents: recentCourses, touch: touchRecentCourse } = useRecentCourses();

  /// Ingest run lifted to app level so it survives ImportDialog dismissal.
  /// Every per-lesson save triggers onCourseSaved, which re-fetches the
  /// courses list — the sidebar fills in with new lessons as the pipeline
  /// generates them. Debounced via useCourses' own internal handling.
  const {
    run: ingest,
    start: startIngest,
    startBulk: startBulkIngest,
    startRegenExercises,
    startGenerateChallengePack,
    startDocsIngest,
    startEnrichCourse,
    startRetryLesson,
    cancel: cancelIngest,
    dismiss: dismissIngest,
  } = useIngestRun({ onCourseSaved: () => { refreshCourses(); } });

  /// Course-id of the course whose settings modal is open. `null` when
  /// no settings modal is showing. Opened from the sidebar's right-click
  /// "Course settings…" action.
  const [courseSettingsId, setCourseSettingsId] = useState<string | null>(null);

  /// Which main-pane route is showing. "courses" is the default (welcome /
  /// inline library / lesson view depending on tab state). "profile" and
  /// "playground" are dedicated destinations triggered from the sidebar
  /// iconbar. Selecting a lesson anywhere forces back to "courses" so the
  /// learner isn't stuck on a side view after clicking a sidebar item.
  const [view, setView] = useState<
    "courses" | "profile" | "playground" | "library"
  >(
    "courses",
  );

  /// Challenge-pack generation dialog visibility. Opened from the Profile
  /// page's "Generate challenge pack" CTA; runs through useIngestRun when
  /// submitted and closes itself.
  const [genPackOpen, setGenPackOpen] = useState(false);

  /// Sidebar collapsed state. Persisted so a learner who prefers the
  /// full-width pane (e.g. writing a long exercise) doesn't have to
  /// re-hide the sidebar every launch. Toggled by the top-bar button or
  /// Cmd+\\ (matches VS Code's muscle memory).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("kata:sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "kata:sidebarCollapsed",
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      /* private mode — fine to drop */
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+\ on macOS, Ctrl+\ elsewhere — matches VS Code.
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /// Cmd+K (Ctrl+K) — global command palette toggle. Lives at the
  /// app root so it works from every route + every focus state.
  /// Browsers default Cmd+K to "address bar focus" inside <input>;
  /// preventDefault flips that for our keystroke specifically. The
  /// palette's own Esc / repeated Cmd+K handlers manage close.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On fresh launch (courses loaded, no tabs yet), open the first lesson
  // of the first course as a convenience. Skipped on re-mount once the
  // learner has actively opened/closed tabs — closing the last tab should
  // NOT auto-re-open it, the learner wanted the library view. The ref is
  // flipped after the first auto-open OR after any manual selectLesson
  // call so repeated close-all cycles don't keep re-opening.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (didAutoOpen.current) return;
    if (coursesLoaded && courses.length > 0 && openTabs.length === 0) {
      didAutoOpen.current = true;
      const first = courses[0];
      const firstLessonId = first.chapters[0]?.lessons[0]?.id;
      if (firstLessonId) {
        setOpenTabs([{ courseId: first.id, lessonId: firstLessonId }]);
      }
    }
  }, [coursesLoaded, courses, openTabs.length]);

  const activeTab = openTabs[activeTabIndex];
  const activeCourse = courses.find((c) => c.id === activeTab?.courseId) ?? null;
  const activeLesson = findLesson(activeCourse, activeTab?.lessonId);

  function selectLesson(courseId: string, lessonId: string) {
    // Once the learner has explicitly opened something, the auto-open-
    // first-lesson effect stands down — they're driving.
    didAutoOpen.current = true;
    // Mark this course as "just opened" — the sidebar carousel sorts
    // by these timestamps to keep the most-active course leftmost.
    touchRecentCourse(courseId);
    // Pull in the full course body (starter / solution / tests) if we
    // only have the summary from the initial fast load. No-op if it's
    // already hydrated, so this is safe to fire on every selection.
    // Not awaited — the tab opens immediately and the LessonView
    // re-renders when the full body arrives. This makes "slow click"
    // feel instant while still ensuring the body is available by the
    // time the learner clicks Run.
    void hydrateCourse(courseId);
    // Selecting a lesson always routes back to courses view — otherwise
    // we'd switch the sidebar's active tab silently while the main pane
    // still shows Profile / Playground. That's disorienting.
    setView("courses");
    const existing = openTabs.findIndex((t) => t.courseId === courseId);
    if (existing >= 0) {
      const updated = [...openTabs];
      updated[existing] = { courseId, lessonId };
      setOpenTabs(updated);
      setActiveTabIndex(existing);
    } else {
      setOpenTabs([...openTabs, { courseId, lessonId }]);
      setActiveTabIndex(openTabs.length);
    }
  }

  /// Ask for a destination then shell out to the Rust `export_course` command,
  /// which zips the course folder (course.json + any sibling assets) into a
  /// `.fishbones` archive. We derive a default filename from the course title
  /// so the save sheet starts on a useful name.
  async function exportCourse(courseId: string, courseTitle: string) {
    try {
      const defaultName = slugify(courseTitle) + ".fishbones";
      const destination = await save({
        defaultPath: defaultName,
        filters: [{ name: "Fishbones course", extensions: ["fishbones", "kata"] }],
        title: `Export "${courseTitle}"`,
      });
      if (!destination) return; // user cancelled
      await invoke("export_course", { courseId, destination });
    } catch (e) {
      // Keep this simple — surface via alert for now. A toast would be nicer
      // but there's no toast system yet; the happy path just succeeds silently.
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Export failed: ${msg}`);
    }
  }

  /// Export every course in the library into a single directory as
  /// `.fishbones` archives. One prompt, no per-course save sheets.
  /// Failures don't halt the batch — they're collected and surfaced at
  /// the end so a flaky file doesn't strand the rest.
  async function bulkExportLibrary() {
    try {
      if (courses.length === 0) {
        alert("Library is empty — nothing to export.");
        return;
      }
      const destDir = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose destination folder for library export",
      });
      if (typeof destDir !== "string") return;
      const failures: Array<{ title: string; error: string }> = [];
      for (const c of courses) {
        const filename = slugify(c.title) + ".fishbones";
        const destination = `${destDir}/${filename}`;
        try {
          await invoke("export_course", { courseId: c.id, destination });
        } catch (e) {
          failures.push({
            title: c.title,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      const exported = courses.length - failures.length;
      if (failures.length === 0) {
        alert(`Exported ${exported} course${exported === 1 ? "" : "s"} to ${destDir}`);
      } else {
        const msg = failures.map((f) => `• ${f.title}: ${f.error}`).join("\n");
        alert(
          `Exported ${exported} of ${courses.length}. ${failures.length} failed:\n\n${msg}`,
        );
      }
    } catch (e) {
      alert(
        `Bulk export failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /// Open a course from the Library view. Reuses the `selectLesson` path
  /// (which upserts an open tab) and targets the first lesson if the
  /// course isn't already open.
  function openCourseFromLibrary(courseId: string) {
    const c = courses.find((x) => x.id === courseId);
    if (!c) return;
    const existing = openTabs.find((t) => t.courseId === courseId);
    const lessonId = existing?.lessonId ?? c.chapters[0]?.lessons[0]?.id;
    if (!lessonId) return;
    selectLesson(courseId, lessonId);
  }

  /// Queue a delete for confirmation. The actual deletion runs in
  /// `performDelete` once the user clicks Delete in the ConfirmDialog.
  function deleteCourseFromLibrary(courseId: string, courseTitle: string) {
    setPendingDelete({ courseId, courseTitle });
  }

  /// Actually wipe the course: remove the course dir, drop open tabs, clear
  /// the book's ingest cache so a re-import starts fresh. Errors on cache
  /// clear are swallowed because cache may already be gone; the course
  /// delete is the important part.
  async function performDelete(courseId: string) {
    try {
      await invoke("delete_course", { courseId });
      await invoke("cache_clear", { bookId: courseId }).catch((e) => {
        console.warn("[fishbones] cache_clear after delete failed:", e);
      });
      setOpenTabs((prev) => prev.filter((t) => t.courseId !== courseId));
      await refreshCourses();
    } catch (e) {
      console.error("[fishbones] delete_course failed:", e);
    } finally {
      setPendingDelete(null);
    }
  }

  /// Import a previously-exported `.fishbones` (or legacy `.kata`) archive.
  /// Opens the native file picker filtered to both extensions, then hands the
  /// absolute path to the Rust `import_course` command which unzips into the
  /// courses dir. On success we refresh the sidebar and jump to the first
  /// lesson.
  async function importCourseArchive() {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Fishbones course", extensions: ["fishbones", "kata"] }],
      });
      if (typeof picked !== "string") return; // user cancelled
      const courseId = await invoke<string>("import_course", {
        archivePath: picked,
      });
      const fresh = await refreshCourses();
      const imported = fresh.find((c) => c.id === courseId);
      if (!imported || imported.chapters.length === 0) return;
      const firstLessonId = imported.chapters[0].lessons[0]?.id;
      if (!firstLessonId) return;
      setOpenTabs((prev) => {
        const without = prev.filter((t) => t.courseId !== courseId);
        const next = [...without, { courseId, lessonId: firstLessonId }];
        setActiveTabIndex(next.length - 1);
        return next;
      });
      setView("courses");
    } catch (e) {
      console.error("[fishbones] import_course failed:", e);
      alert(
        `Couldn't import course archive: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function closeTab(index: number) {
    const next = openTabs.filter((_, i) => i !== index);
    setOpenTabs(next);
    if (activeTabIndex >= next.length) {
      setActiveTabIndex(Math.max(0, next.length - 1));
    } else if (activeTabIndex > index) {
      setActiveTabIndex(activeTabIndex - 1);
    }
  }

  const tabs = openTabs.map((t) => {
    const c = courses.find((x) => x.id === t.courseId);
    return {
      id: t.courseId,
      label: c?.title ?? t.courseId,
      language: c?.language ?? "javascript",
    };
  });

  return (
    <div
      className={`fishbones ${
        sidebarCollapsed ? "fishbones--sidebar-collapsed" : ""
      }`}
    >
      {/* First-load overlay. Shown until `useCourses` resolves its
          initial list so the learner sees a branded loader instead of
          an empty sidebar + blank welcome flash. Same fish-bone spinner
          the OutputPane uses — keeps the loading vocabulary consistent
          across the app. Fades itself out via CSS once coursesLoaded
          flips true. */}
      <div
        className={`fishbones__bootloader ${
          coursesLoaded ? "fishbones__bootloader--hidden" : ""
        }`}
        aria-hidden={coursesLoaded}
      >
        <FishbonesLoader label="loading Fishbones…" />
      </div>

      <TopBar
        tabs={tabs}
        activeIndex={activeTabIndex}
        onActivate={(i) => {
          // Tabs live in the top bar across every route, so clicking one
          // should always land on the course view — otherwise the learner
          // sees the tab highlight change while still looking at Profile
          // or Playground, which feels broken.
          setView("courses");
          setActiveTabIndex(i);
        }}
        onClose={closeTab}
        stats={stats}
        onOpenProfile={() => setView("profile")}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="fishbones__body">
        <Sidebar
          courses={courses}
          activeCourseId={view === "courses" ? activeCourse?.id : undefined}
          activeLessonId={view === "courses" ? activeLesson?.id : undefined}
          completed={completed}
          recents={recentCourses}
          onSelectLesson={selectLesson}
          onSelectCourse={openCourseFromLibrary}
          onLibrary={() => setView("library")}
          onSettings={() => setSettingsOpen(true)}
          onPlayground={() => setView("playground")}
          activeView={view}
          onExportCourse={exportCourse}
          onDeleteCourse={deleteCourseFromLibrary}
          onCourseSettings={(id) => setCourseSettingsId(id)}
        />

        <main className="fishbones__main">
          {view === "profile" ? (
            <ProfileView
              courses={courses}
              completed={completed}
              history={history}
              stats={stats}
              onOpenLesson={selectLesson}
              onGeneratePack={() => setGenPackOpen(true)}
            />
          ) : view === "playground" ? (
            <PlaygroundView />
          ) : view === "library" ? (
            // Library view — renders the inline CourseLibrary as the main
            // pane content (not as a modal overlay). DeferredMount paints
            // a "Loading library…" card for one animation frame so the
            // sidebar click feels instant even when the cover-loading
            // IPCs stack up under StrictMode's dev-mode double-render.
            <DeferredMount
              phase="library"
              fallback={<LoadingPane label="Loading library…" />}
            >
              <CourseLibrary
                mode="inline"
                courses={courses}
                completed={completed}
                hydrating={hydrating}
                onDismiss={() => setView("courses")}
                onOpen={(id) => openCourseFromLibrary(id)}
                onImport={() => setImportOpen(true)}
                onBulkImport={() => setBulkImportOpen(true)}
                onDocsImport={() => setDocsImportOpen(true)}
                onImportArchive={importCourseArchive}
                onExport={exportCourse}
                onDelete={deleteCourseFromLibrary}
                onSettings={(id) => setCourseSettingsId(id)}
                onBulkExport={bulkExportLibrary}
              />
            </DeferredMount>
          ) : courses.length === 0 && coursesLoaded ? (
            <div className="fishbones__welcome">
              <div className="fishbones__welcome-inner">
                <div className="fishbones__welcome-glyph" aria-hidden>
                  <Icon icon={libraryBig} size="2xl" color="currentColor" weight="light" />
                </div>
                <h1 className="fishbones__welcome-title">Welcome to Fishbones</h1>
                <p className="fishbones__welcome-blurb">
                  Turn any technical book into an interactive course. Pick a PDF
                  to import, and Fishbones will split it into lessons, generate
                  exercises, and let you code along chapter by chapter.
                </p>
                <div className="fishbones__welcome-actions">
                  <button
                    className="fishbones__welcome-primary"
                    onClick={() => setImportOpen(true)}
                  >
                    Import a PDF
                  </button>
                  <button
                    className="fishbones__welcome-secondary"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Open Settings
                  </button>
                </div>
                <p className="fishbones__welcome-hint">
                  You'll need an Anthropic API key in Settings for the AI-assisted
                  structuring pipeline. Without one, imports fall back to simple
                  section splits.
                </p>
              </div>
            </div>
          ) : openTabs.length === 0 ? (
            // No tabs open (all closed, or freshly launched before first
            // tab was created) — render the library inline so the learner
            // has a launching pad instead of a blank pane.
            <DeferredMount
              phase="library-empty"
              fallback={<LoadingPane label="Loading library…" />}
            >
              <CourseLibrary
                mode="inline"
                courses={courses}
                completed={completed}
                hydrating={hydrating}
                onDismiss={() => { /* inline mode has no dismiss affordance */ }}
                onOpen={(id) => openCourseFromLibrary(id)}
                onImport={() => setImportOpen(true)}
                onBulkImport={() => setBulkImportOpen(true)}
                onDocsImport={() => setDocsImportOpen(true)}
                onImportArchive={importCourseArchive}
                onExport={exportCourse}
                onDelete={deleteCourseFromLibrary}
                onSettings={(id) => setCourseSettingsId(id)}
                onBulkExport={bulkExportLibrary}
              />
            </DeferredMount>
          ) : activeLesson && activeCourse ? (
            <LessonView
              // Key on course+lesson so the editor/code state and quiz answers
              // fully reset when navigating via Prev/Next — otherwise React
              // would reuse stale component state across lessons.
              key={`${activeCourse.id}:${activeLesson.id}`}
              courseId={activeCourse.id}
              courseLanguage={activeCourse.language}
              lesson={activeLesson}
              neighbors={findNeighbors(activeCourse, activeLesson.id)}
              isCompleted={completed.has(`${activeCourse.id}:${activeLesson.id}`)}
              onComplete={() => markCompletedAndCelebrate(activeCourse.id, activeLesson.id)}
              onNavigate={(lessonId) => selectLesson(activeCourse.id, lessonId)}
              onRetryLesson={(lessonId) =>
                startRetryLesson(
                  activeCourse.id,
                  lessonId,
                  activeLesson.title.replace(/\s*\(demoted\)\s*$/i, "").trim(),
                )
              }
            />
          ) : (
            <div className="fishbones__empty">
              <p>Pick a lesson from the sidebar to get started.</p>
            </div>
          )}
        </main>
      </div>

      {settingsOpen && <SettingsDialog onDismiss={() => setSettingsOpen(false)} />}


      {genPackOpen && (
        <GeneratePackDialog
          onDismiss={() => setGenPackOpen(false)}
          onStart={(opts) => {
            startGenerateChallengePack(opts);
            setGenPackOpen(false);
          }}
        />
      )}

      {docsImportOpen && (
        <DocsImportDialog
          onDismiss={() => setDocsImportOpen(false)}
          onStart={(opts) => {
            startDocsIngest(opts);
            setDocsImportOpen(false);
          }}
        />
      )}

      {courseSettingsId && (() => {
        const course = courses.find((c) => c.id === courseSettingsId);
        if (!course) return null;
        return (
          <CourseSettingsModal
            course={course}
            onDismiss={() => setCourseSettingsId(null)}
            onExport={() => exportCourse(course.id, course.title)}
            onDelete={() => deleteCourseFromLibrary(course.id, course.title)}
            onRegenerateExercises={() => startRegenExercises(course.id, course.title)}
            onEnrichLessons={() => startEnrichCourse(course.id, course.title)}
            onCoverRefreshed={async (fetchedAt) => {
              // Load the course JSON, bump coverFetchedAt, save it back.
              // Avoids the "stale blob URL" problem the first time a
              // cover is fetched for an existing course — useCourseCover
              // reruns whenever this value changes.
              try {
                const current = await invoke<Course>("load_course", {
                  courseId: course.id,
                });
                current.coverFetchedAt = fetchedAt;
                await invoke("save_course", {
                  courseId: course.id,
                  body: current,
                });
                await refreshCourses();
              } catch (e) {
                console.error("[fishbones] cover save failed:", e);
              }
            }}
            onChangeLanguage={async (language) => {
              // Load → mutate → save → refresh. Same pattern as the
              // cover-refresh handler above. Only the top-level
              // `language` changes; lesson-level `language` fields are
              // left alone because they're valid in their own right
              // (e.g. a Python course with a quiz lesson whose language
              // is "plaintext" is fine — the quiz doesn't run code).
              const current = await invoke<Course>("load_course", {
                courseId: course.id,
              });
              current.language = language;
              await invoke("save_course", {
                courseId: course.id,
                body: current,
              });
              await refreshCourses();
            }}
          />
        );
      })()}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.courseTitle}"?`}
          message={
            `This removes the course, all lesson progress, and the ingest cache from disk. ` +
            `Re-importing the same PDF later will run the full AI pipeline from scratch.\n\n` +
            `This can't be undone.`
          }
          confirmLabel="Delete course"
          cancelLabel="Keep"
          danger
          onConfirm={() => performDelete(pendingDelete.courseId)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {bulkImportOpen && (
        <BulkImportDialog
          onDismiss={() => setBulkImportOpen(false)}
          onStartQueue={(items) => {
            // Hands off to the queue runner. FloatingIngestPanel shows
            // progress across the batch. Dialog dismisses itself.
            startBulkIngest(items);
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          onDismiss={() => setImportOpen(false)}
          onStartAiIngest={(opts) => {
            // Fire-and-forget — the pipeline runs detached and the floating
            // panel (below) shows progress. Dialog already closes itself.
            startIngest(opts);
          }}
          onSavedCourse={async (courseId) => {
            // Non-AI path: the deterministic splitter already saved the
            // course. Refresh the sidebar + jump to the first lesson.
            const fresh = await refreshCourses();
            const imported = fresh.find((c) => c.id === courseId);
            if (!imported || imported.chapters.length === 0) return;
            const firstLessonId = imported.chapters[0].lessons[0]?.id;
            if (!firstLessonId) return;
            setOpenTabs((prev) => {
              const without = prev.filter((t) => t.courseId !== courseId);
              const next = [...without, { courseId, lessonId: firstLessonId }];
              setActiveTabIndex(next.length - 1);
              return next;
            });
          }}
        />
      )}

      {ingest.status !== "idle" && (
        <FloatingIngestPanel
          run={ingest}
          onCancel={cancelIngest}
          onDismiss={dismissIngest}
          onOpen={(bookId) => {
            const c = courses.find((x) => x.id === bookId);
            if (!c || c.chapters.length === 0) return;
            const firstLessonId = c.chapters[0].lessons[0]?.id;
            if (!firstLessonId) return;
            setOpenTabs((prev) => {
              const without = prev.filter((t) => t.courseId !== bookId);
              const next = [...without, { courseId: bookId, lessonId: firstLessonId }];
              setActiveTabIndex(next.length - 1);
              return next;
            });
            dismissIngest();
          }}
        />
      )}

      {/* Floating local-LLM tutor. Lives at the root so it persists
          across library / lesson / playground / profile routes —
          same character, same conversation state. System prompt is
          rebuilt from the active lesson on each send(). */}
      <AiAssistant
        lesson={activeLesson}
        course={activeCourse}
        celebrateAt={celebrateAt}
      />

      {/* Cmd+K command palette. Searches across actions + every
          loaded course / lesson. Opening a lesson reuses the same
          selectLesson path the sidebar uses, so tab + recents
          state stay coherent. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        courses={courses}
        actions={{
          openLibrary: () => setView("library"),
          openPlayground: () => setView("playground"),
          openProfile: () => setView("profile"),
          openSettings: () => setSettingsOpen(true),
          importBook: () => setImportOpen(true),
          // Triggering "ask AI" from the palette dispatches the same
          // event the lesson reader's `?` badges fire. Empty detail
          // leaves the panel open without a pre-canned prompt so the
          // learner can type their own question.
          askAi: () => {
            window.dispatchEvent(
              new CustomEvent("fishbones:ask-ai", {
                detail: { kind: "open" },
              }),
            );
          },
        }}
        onOpenLesson={(courseId, lessonId) => selectLesson(courseId, lessonId)}
      />
    </div>
  );
}

interface Neighbors {
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

function LessonView({
  courseId,
  courseLanguage,
  lesson,
  neighbors,
  isCompleted,
  onComplete,
  onNavigate,
  onRetryLesson,
}: {
  courseId: string;
  /// Primary language of the PARENT course. Used as an override signal
  /// for `runFiles` — when the course is "reactnative", lessons always
  /// run through the RN runtime regardless of how the individual
  /// lesson's `language` field ended up tagged. LLM-generated lessons
  /// sometimes default to "javascript" for JSX code, which otherwise
  /// sends RN source to the JavaScript worker and fails with an
  /// opaque `AsyncFunction@[native code]` blob-URL error.
  courseLanguage: Course["language"];
  lesson: Lesson;
  neighbors: Neighbors;
  isCompleted: boolean;
  onComplete: () => void;
  onNavigate: (lessonId: string) => void;
  /// Fires when the "Retry this exercise" inline button is clicked on
  /// a demoted lesson. App wires this to `startRetryLesson`.
  onRetryLesson?: (lessonId: string) => void;
}) {
  const hasExercise = isExerciseKind(lesson);
  // Multi-file workbench state. We always deal in arrays here — legacy
  // single-file lessons get synthesized into a one-element array by
  // `deriveStarterFiles`. Storing an array even for the single-file case
  // keeps the EditorPane contract uniform.
  // `useWorkbenchFiles` reads from localStorage synchronously on first
  // render so reopening a lesson restores the learner's in-progress code
  // instead of snapping back to the starter. Reset clears the save and
  // returns to starter in one step.
  const { files, setFiles, resetToStarter } = useWorkbenchFiles(
    courseId,
    lesson,
    hasExercise,
  );
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  // When true, the workbench has been popped out into a separate window and
  // the main-window editor gets hidden in favor of a "currently popped out"
  // placeholder. Reset on lesson change via the parent's keyed remount.
  const [popped, setPopped] = useState(false);

  // Proactive toolchain probe. When the lesson's language is one that
  // needs a local compiler (C / C++ / Java / Kotlin / C# / Assembly),
  // hit `probe_language_toolchain` on mount — matches the pattern
  // PlaygroundView uses. If the probe says "not installed" (or
  // installed-but-broken, e.g. the macOS `java` stub without a real
  // JDK), we render the install banner above the workbench so the
  // learner sees it BEFORE clicking Run instead of after a failed
  // compile. Browser-hosted languages (JS/TS/Python/etc.) short-
  // circuit inside `probe_language_toolchain` to installed=true, so
  // the banner never appears for them.
  const [tcRefresh, setTcRefresh] = useState(0);
  // Reading-only lessons don't have a `language` field — only exercise
  // and mixed-content lessons do. Skip the probe entirely for readers.
  const lessonLanguage = hasExercise ? lesson.language : undefined;
  const needsLocalToolchain =
    !!lessonLanguage && NATIVE_TOOLCHAIN_LANGUAGES.has(lessonLanguage);
  const { status: lessonToolchainStatus } = useToolchainStatus(
    needsLocalToolchain ? lessonLanguage! : "",
    tcRefresh,
  );
  const showLessonToolchainBanner =
    needsLocalToolchain &&
    !!lessonToolchainStatus &&
    !lessonToolchainStatus.installed &&
    !!lessonToolchainStatus.install_hint;


  async function handleRun() {
    if (!hasExercise) return;
    setRunning(true);
    setResult(null);
    try {
      const tests = "tests" in lesson ? lesson.tests : undefined;
      // Prefer the course's language when it's a whole-app runtime
      // (react native, web, threejs) — those are meta-languages where
      // the RUN behaviour is owned by the course, not the individual
      // lesson. The fix for docs-generated RN courses: the LLM
      // sometimes stamps `lesson.language: "javascript"` for JSX code
      // even though we told it the course is "reactnative". Without
      // this override we'd dispatch to the JS worker and blow up with
      // an AsyncFunction blob error.
      const effectiveLanguage =
        courseLanguage === "reactnative" ||
        courseLanguage === "web" ||
        courseLanguage === "threejs"
          ? courseLanguage
          : lesson.language;
      const r = await runFiles(effectiveLanguage, files, tests);
      // Defensive guard: a runtime can theoretically resolve to
      // undefined (unknown language id slipping past the LanguageId
      // switch, an untyped IPC failure). Surface a friendly error
      // rather than crashing the handler with `r.error` on undefined.
      if (!r) {
        setResult({
          logs: [],
          error: `No runtime for language "${effectiveLanguage}".`,
          durationMs: 0,
        });
        return;
      }
      setResult(r);
      if (isPassing(r)) onComplete();
    } catch (e) {
      // Tauri IPC failures (missing command, serialization errors),
      // worker init failures — any thrown error from the runtime chain
      // lands here. Render it in the OutputPane so the user sees what
      // went wrong instead of a silent failed run.
      setResult({
        logs: [],
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
        durationMs: 0,
      });
    } finally {
      setRunning(false);
    }
  }

  /// Reset reverts every file to its starter content AND wipes the saved
  /// copy in localStorage so the next lesson-open also starts fresh. Safe
  /// to call always — the hook no-ops when the lesson isn't an exercise.
  function handleReset() {
    resetToStarter();
    setActiveFileIdx(0);
  }

  /// Reveal solution swaps the entire file set to the reference solution.
  /// Clears the run result so the learner sees a fresh state to run against;
  /// gated by EditorPane's confirmation dialog so it can't fire by accident.
  function handleRevealSolution() {
    if (hasExercise) {
      setFiles(deriveSolutionFiles(lesson));
      setActiveFileIdx(0);
      setResult(null);
    }
  }

  /// Per-file edit handler. Immutably replaces the content of files[index].
  /// React re-renders EditorPane with the new array; Monaco picks up the
  /// new value for the active file.
  function handleFileChange(index: number, next: string) {
    setFiles((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const copy = prev.slice();
      copy[index] = { ...copy[index], content: next };
      return copy;
    });
  }

  const hints =
    hasExercise && "hints" in lesson && lesson.hints ? lesson.hints : undefined;

  // Keep the main window and the popped-out window in sync. The bus chooses
  // Tauri events (for native multi-window) or BroadcastChannel (for vite
  // dev) under the hood — we only see a clean listen/emit API here.
  useEffect(() => {
    if (!hasExercise) return;
    const bus = makeBus(courseId, lesson.id);
    const unlisten = bus.listen((msg, from) => {
      if (from !== "popped") return;
      if (msg.type === "files") setFiles(msg.files);
      if (msg.type === "running") setRunning(true);
      if (msg.type === "result") {
        setResult(msg.result);
        setRunning(false);
      }
      if (msg.type === "complete") onComplete();
      // The popped window fires `hello` once it mounts so we can push it
      // our current files (otherwise it'd load with starter text even if
      // the user had edited here).
      if (msg.type === "hello") {
        bus.emit({ type: "files", files }, "main");
      }
      // Popped window is going away — flip the inline workbench back on
      // so the learner doesn't stare at a "popped out" placeholder over
      // an empty detached window.
      if (msg.type === "closed") {
        setPopped(false);
      }
    });
    return unlisten;
    // `files` intentionally omitted — we re-broadcast via the effect
    // below. Including it here would re-register the listener on every
    // keystroke and drop pending messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lesson.id, hasExercise, onComplete]);

  useEffect(() => {
    if (!hasExercise) return;
    const bus = makeBus(courseId, lesson.id);
    bus.emit({ type: "files", files }, "main");
  }, [files, courseId, lesson.id, hasExercise]);

  /// Open the workbench in a detached window. Uses Tauri's WebviewWindow
  /// when available so the popped window lives inside the app; falls back
  /// to window.open for vite dev or if the capability is missing. We pass
  /// the current code through the URL so the popped window paints with
  /// the learner's in-progress code on first render — localStorage isn't
  /// reliably shared across Tauri webview windows.
  async function handlePopOut() {
    if (!hasExercise) return;
    try {
      await openPoppedWorkbench(courseId, lesson.id, lesson.title, files);
      setPopped(true);
    } catch (e) {
      console.error("[fishbones] pop-out failed:", e);
    }
  }

  /// Bring the workbench back into the main window. Closes the popped
  /// window too so we don't leave a zombie detached view. The popped
  /// window's `beforeunload` also emits `closed` which flips our state,
  /// but setting it here too makes the main-window transition instant
  /// instead of waiting for the round-trip.
  async function handleReopenInline() {
    setPopped(false);
    await closePoppedWorkbench(courseId, lesson.id);
  }

  // Reading-only lessons have no run/quiz gate — the Next button stands in
  // as the "I read this" affordance. Exercise/quiz lessons get marked complete
  // when the user actually solves them, so Next there is just navigation.
  const isReadingOnly = !hasExercise && !isQuiz(lesson);

  function handleNext() {
    if (!neighbors.next) return;
    if (isReadingOnly && !isCompleted) {
      onComplete();
    }
    onNavigate(neighbors.next.id);
  }
  function handlePrev() {
    if (neighbors.prev) onNavigate(neighbors.prev.id);
  }

  const nextLabel =
    isReadingOnly && !isCompleted && neighbors.next ? "mark read & next" : "next";

  const nav = (
    <LessonNav
      prev={neighbors.prev}
      next={neighbors.next}
      onPrev={handlePrev}
      onNext={handleNext}
      nextLabel={nextLabel}
    />
  );

  // Quiz lessons are rendered inline under the lesson prose with no editor /
  // output pane — the quiz widget handles its own answer flow. Column layout
  // so reader and quiz stack vertically inside a single scroll container.
  if (isQuiz(lesson)) {
    return (
      <div className="fishbones__lesson fishbones__lesson--column">
        <div className="fishbones__lesson-scroll">
          <LessonReader lesson={lesson} />
          <QuizView lesson={lesson} onComplete={onComplete} />
          <div className="fishbones__lesson-nav-wrap">{nav}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fishbones__lesson">
      <LessonReader
        lesson={lesson}
        footer={nav}
        onRetryLesson={onRetryLesson}
      />
      {hasExercise && !popped && (
        <div className="fishbones__lesson-workbench-wrap">
          {showLessonToolchainBanner && lessonToolchainStatus && (
            // Proactive missing-toolchain nudge. Sits above the
            // workbench so the learner doesn't click Run, wait for
            // compile, and THEN discover their JDK is missing — they
            // see "Java isn't installed" with a one-click Install
            // button the moment the lesson opens. `tcRefresh` re-runs
            // the probe after a successful install so this clears
            // itself once the toolchain lands on PATH.
            <MissingToolchainBanner
              status={lessonToolchainStatus}
              onInstalled={() => setTcRefresh((n) => n + 1)}
            />
          )}
          <Workbench
            widthControlsParent
            editor={
              <EditorPane
                language={lesson.language}
                files={files}
                activeIndex={activeFileIdx}
                onActiveIndexChange={setActiveFileIdx}
                onChange={handleFileChange}
                onRun={handleRun}
                hints={hints}
                onReset={handleReset}
                onRevealSolution={handleRevealSolution}
                onPopOut={handlePopOut}
              />
            }
            output={
              <OutputPane
                result={result}
                running={running}
                suppressToolchainBanner={showLessonToolchainBanner}
                language={lesson.language}
                testsExpected={"tests" in lesson && !!lesson.tests?.trim()}
              />
            }
          />
        </div>
      )}
      {hasExercise && popped && (
        <button
          className="fishbones__workbench-popped-pill"
          onClick={handleReopenInline}
          title="Close the popped window and dock the workbench back into this pane"
        >
          <span className="fishbones__workbench-popped-pill-icon" aria-hidden>
            <Icon icon={panelLeftOpen} size="xs" color="currentColor" />
          </span>
          <span>pop back in</span>
        </button>
      )}
    </div>
  );
}

/// Flatten all chapters into a linear lesson list and return the siblings of
/// the given lessonId. Returning null at the ends lets the nav disable the
/// Prev/Next buttons without additional branching in the view.
function findNeighbors(course: Course, lessonId: string): Neighbors {
  const flat: Array<{ id: string; title: string }> = [];
  for (const ch of course.chapters) {
    for (const l of ch.lessons) flat.push({ id: l.id, title: l.title });
  }
  const idx = flat.findIndex((x) => x.id === lessonId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "course";
}

function findLesson(course: Course | null, lessonId: string | undefined): Lesson | null {
  if (!course || !lessonId) return null;
  for (const ch of course.chapters) {
    const found = ch.lessons.find((l) => l.id === lessonId);
    if (found) return found;
  }
  return null;
}
