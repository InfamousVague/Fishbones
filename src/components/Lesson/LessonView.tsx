import { useEffect, useRef, useState } from "react";
import {
  Course,
  Lesson,
  isCloze,
  isExerciseKind,
  isMicroPuzzle,
  isQuiz,
} from "../../data/types";
import { Icon } from "@base/primitives/icon";
import { panelLeftOpen } from "@base/primitives/icon/icons/panel-left-open";
import "@base/primitives/icon/icon.css";
import LessonReader from "./LessonReader";
import LessonNav from "./LessonNav";
import EditorPane from "../Editor/EditorPane";
import OutputPane from "../Output/OutputPane";
import PhoneToggleButton from "../FloatingPhone/PhoneToggleButton";
import {
  openPhonePopout,
  closePhonePopout,
  makePhonePreviewBus,
} from "../../lib/phonePopout";
import Workbench from "../Workbench/Workbench";
import MissingToolchainBanner from "../banners/MissingToolchain/MissingToolchainBanner";
import { useToolchainStatus } from "../../hooks/useToolchainStatus";
import { useLocalStorageState } from "../../hooks/useLocalStorageState";
import QuizView from "../Quiz/QuizView";
import MobileCloze from "../../mobile/MobileCloze";
import MobileMicroPuzzle from "../../mobile/MobileMicroPuzzle";
import { makeBus, openPoppedWorkbench, closePoppedWorkbench } from "../../lib/workbenchSync";
import { deriveSolutionFiles } from "../../lib/workbenchFiles";
import {
  emitEvent as emitVerifierEvent,
  onCommand as onVerifierCommand,
} from "../../lib/verify/bus";
import { runFiles, isPassing, type RunResult } from "../../runtimes";
import { useWorkbenchFiles } from "../../hooks/useWorkbenchFiles";
import type { Neighbors } from "../../lessonHelpers";

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

export default function LessonView({
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

  // React Native courses route their preview through a SEPARATE OS
  // window (the popped phone simulator) instead of a fixed bottom-
  // pane OutputPane. When this is true, the lesson workbench renders
  // the EditorPane full-width and the phone view lives in its own
  // popout. We track an "open" boolean to remember whether the user
  // last asked the popout to be on or off — the next Run auto-opens
  // it, and the toggle button reopens it after dismissal.
  const useFloatingPhone = courseLanguage === "reactnative";
  // Scope keyed on lesson so two RN lessons in different tabs each
  // get their own popout window + bus channel.
  const phoneScope = `lesson:${courseId}:${lesson.id}`;
  // The actual rendered popout window is owned by `lib/phonePopout.ts`
  // — this hook only persists the user's intent ("they want it open")
  // so the next session opens with the same preference. The current
  // value isn't read anywhere; the setter triggers the write-through.
  const [, setFloatingPhoneOpen] = useLocalStorageState<boolean>(
    "fishbones:floating-phone-open",
    true,
  );
  // Bus the LessonView pushes preview URLs through. Memoised
  // implicitly because makePhonePreviewBus is cheap; the popout
  // listens with the matching scope.
  const phoneBus = useFloatingPhone ? makePhonePreviewBus(phoneScope) : null;
  // When the user closes the lesson tab or pops the workbench out,
  // close the popout too — leaving an orphaned phone window for a
  // lesson the user has stopped looking at is just confusing.
  useEffect(() => {
    if (!useFloatingPhone) return;
    return () => {
      void closePhonePopout(phoneScope);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useFloatingPhone, phoneScope]);

  // SvelteKit lessons keep a long-lived `vite dev` process under
  // <app-data>/sveltekit-runs/<id>/. Stop it on lesson tab close
  // so we don't leak Node processes across sessions. Idempotent —
  // backend no-ops when nothing's running.
  useEffect(() => {
    const id = `${courseId}:${lesson.id}`;
    return () => {
      // Lazy-import to avoid loading the runtime module before
      // it's needed (the SvelteKit runtime pulls in extra Tauri
      // event-listener glue).
      void import("../../runtimes/sveltekit").then((m) =>
        m.stopSvelteKit(id),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lesson.id]);

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
    // Auto-pop the phone simulator open on every Run so a closed
    // popout surfaces itself when the user actually has output to
    // see. We open the OS window AND set the local "open" state so
    // the toggle button hides and we remember the preference. The
    // popout is idempotent — re-opening when already open just
    // focuses the existing window.
    if (useFloatingPhone) {
      setFloatingPhoneOpen(true);
      void openPhonePopout(phoneScope, lesson.title);
      // Tell the popout we're working on a new run so it can swap
      // to the "running…" placeholder instead of showing a stale
      // preview iframe through the compile.
      phoneBus?.emit({ type: "running" });
    }
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
      const harness =
        "harness" in lesson
          ? (lesson as { harness?: "evm" | "solana" }).harness
          : undefined;
      const r = await runFiles(
        effectiveLanguage,
        files,
        tests,
        undefined,
        // Identity passed through to the SvelteKit runner so the
        // long-lived `vite dev` process gets keyed per lesson —
        // re-runs hot-reload the same server instead of spinning
        // up a fresh project dir each time.
        `${courseId}:${lesson.id}`,
        harness,
      );
      // Defensive guard: a runtime can theoretically resolve to
      // undefined (unknown language id slipping past the LanguageId
      // switch, an untyped IPC failure). Surface a friendly error
      // rather than crashing the handler with `r.error` on undefined.
      if (!r) {
        const errResult: RunResult = {
          logs: [],
          error: `No runtime for language "${effectiveLanguage}".`,
          durationMs: 0,
        };
        setResult(errResult);
        emitVerifierEvent({
          type: "runResult",
          lessonId: lesson.id,
          passed: false,
          result: errResult,
        });
        if (useFloatingPhone) {
          phoneBus?.emit({
            type: "console",
            logs: [],
            error: `No runtime for language "${effectiveLanguage}".`,
          });
        }
        return;
      }
      setResult(r);
      const passed = isPassing(r);
      if (passed) onComplete();
      // Watch-mode verifier: announce the run finished + whether it
      // passed so the verify-course coroutine can advance to the
      // next lesson without polling React state.
      emitVerifierEvent({
        type: "runResult",
        lessonId: lesson.id,
        passed,
        result: r,
      });
      // Push the run outcome to the popped phone simulator. Preview
      // URL when present (RN runtime hands one back from the local
      // Tauri preview server); otherwise the captured logs + error
      // so a failed run is at least readable inside the popout.
      if (useFloatingPhone) {
        if (r.previewUrl) {
          phoneBus?.emit({ type: "preview", url: r.previewUrl });
        } else {
          phoneBus?.emit({
            type: "console",
            logs: r.logs ?? [],
            error: r.error,
          });
        }
      }
    } catch (e) {
      // Tauri IPC failures (missing command, serialization errors),
      // worker init failures — any thrown error from the runtime chain
      // lands here. Render it in the OutputPane so the user sees what
      // went wrong instead of a silent failed run.
      const errMsg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      const errResult: RunResult = {
        logs: [],
        error: errMsg,
        durationMs: 0,
      };
      setResult(errResult);
      emitVerifierEvent({
        type: "runResult",
        lessonId: lesson.id,
        passed: false,
        result: errResult,
      });
      if (useFloatingPhone) {
        phoneBus?.emit({ type: "console", logs: [], error: errMsg });
      }
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

  /// Watch-mode verifier wiring. The verifier coroutine (cmd+K →
  /// Verify course) emits commands targeting a specific lesson id;
  /// this LessonView listens and dispatches them to the same
  /// handlers the buttons use, so the editor visibly flips to
  /// solution code, the run button visibly fires, etc.
  ///
  /// We capture the latest handlers via a ref so the listener stays
  /// registered across re-renders without re-binding the window
  /// event each time the closure changes.
  const verifierHandlersRef = useRef({
    handleRevealSolution,
    handleRun,
    handleNext,
  });
  useEffect(() => {
    verifierHandlersRef.current = {
      handleRevealSolution,
      handleRun,
      handleNext,
    };
  });
  useEffect(() => {
    const off = onVerifierCommand((cmd) => {
      if (cmd.lessonId !== lesson.id) return;
      if (cmd.type === "revealSolution")
        verifierHandlersRef.current.handleRevealSolution();
      else if (cmd.type === "run")
        void verifierHandlersRef.current.handleRun();
      else if (cmd.type === "next")
        verifierHandlersRef.current.handleNext();
    });
    return off;
  }, [lesson.id]);

  /// Announce the lesson view is mounted + ready to receive
  /// commands. Fires once per lesson change. The verifier coroutine
  /// awaits this event before dispatching any per-lesson commands so
  /// it doesn't race the previous LessonView's unmount.
  useEffect(() => {
    emitVerifierEvent({
      type: "lessonReady",
      courseId,
      lessonId: lesson.id,
      kind: lesson.kind,
    });
  }, [courseId, lesson.id, lesson.kind]);

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

  // Cloze lessons share the column layout with quizzes — prose on top,
  // interactive code-with-chips below. We reuse MobileCloze for the
  // chip rendering since the UX is fundamentally the same on phone and
  // desktop (a code block with inline tappable slots); the only
  // surface-specific decision is the option-picker presentation, which
  // stays as a bottom sheet on both since it's compact and doesn't
  // need the screen real estate a popover would.
  if (isCloze(lesson)) {
    return (
      <div className="fishbones__lesson fishbones__lesson--column">
        <div className="fishbones__lesson-scroll">
          <LessonReader lesson={lesson} />
          <MobileCloze
            // Remount on lesson change so picks / fired-flag don't
            // leak the previous lesson's "correct" state — same fix
            // as the mobile MobileLesson dispatch.
            key={lesson.id}
            template={lesson.template}
            slots={lesson.slots}
            prompt={lesson.prompt}
            onComplete={onComplete}
            isCompleted={isCompleted}
          />
          <div className="fishbones__lesson-nav-wrap">{nav}</div>
        </div>
      </div>
    );
  }

  if (isMicroPuzzle(lesson)) {
    return (
      <div className="fishbones__lesson fishbones__lesson--column">
        <div className="fishbones__lesson-scroll">
          <LessonReader lesson={lesson} />
          <MobileMicroPuzzle
            key={lesson.id}
            challenges={lesson.challenges}
            language={lesson.language}
            prompt={lesson.prompt}
            isCompleted={isCompleted}
          />
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
          {useFloatingPhone ? (
            // RN-course path — editor takes the full workbench width
            // and the phone popout window (lib/phonePopout.ts) carries
            // the preview. We render the EditorPane inside a `solo`
            // wrapper that matches the Workbench's card chrome so the
            // visual weight stays consistent with the JS / Python
            // lesson surfaces.
            <div className="fishbones__lesson-workbench-solo">
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
            </div>
          ) : (
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
          )}
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

      {/* Phone simulator for RN courses now lives in its own OS
          window — opened lazily on first Run, or via this toggle
          button at any time. The popout listens on
          `makePhonePreviewBus(phoneScope)` for new preview URLs we
          push from `handleRun`. The button sits permanently in the
          corner because we can't reliably detect whether the user
          closed the OS window (Tauri webview close events bubble
          inconsistently across platforms), so the cheapest correct
          UX is "always offer to re-open / focus". `openPhonePopout`
          is idempotent — re-opening an already-open popout just
          focuses it. */}
      {useFloatingPhone && hasExercise && !popped && (
        <PhoneToggleButton
          onShow={() => {
            setFloatingPhoneOpen(true);
            void openPhonePopout(phoneScope, lesson.title);
            // If we already have a result for this lesson, replay
            // it into the popout so the freshly-opened window isn't
            // empty until the next Run.
            if (result?.previewUrl) {
              phoneBus?.emit({ type: "preview", url: result.previewUrl });
            } else if (result) {
              phoneBus?.emit({
                type: "console",
                logs: result.logs ?? [],
                error: result.error,
              });
            }
          }}
        />
      )}
    </div>
  );
}
