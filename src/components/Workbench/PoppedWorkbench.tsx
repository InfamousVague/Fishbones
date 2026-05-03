import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Course, ExerciseLesson, MixedLesson, WorkbenchFile } from "../../data/types";
import { isExerciseKind } from "../../data/types";
import { runFiles, isPassing, type RunResult } from "../../runtimes";
import { decodeFiles, makeBus } from "../../lib/workbenchSync";
import { deriveSolutionFiles, deriveStarterFiles } from "../../lib/workbenchFiles";
import EditorPane from "../Editor/EditorPane";
import OutputPane from "../Output/OutputPane";
import Workbench from "./Workbench";
import "./Workbench.css";

/// Standalone workbench rendered when the URL carries `?popped=1`. The main
/// app window opens this via Tauri's WebviewWindow (or `window.open` in the
/// browser fallback), and both windows sync the full files array + run
/// result through the bus (Tauri events natively, BroadcastChannel in the
/// browser). Kept intentionally minimal — no sidebar, reader, or tabs. The
/// popped window's only job is to give the editor + console more room.
export default function PoppedWorkbench() {
  const params = new URLSearchParams(window.location.search);
  const courseId = params.get("course") ?? "";
  const lessonId = params.get("lesson") ?? "";

  const [lesson, setLesson] = useState<ExerciseLesson | MixedLesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<WorkbenchFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  // Hydration gate — see App.tsx for the same pattern. Without it, the
  // initial empty files array races over to the main window and wipes the
  // learner's in-progress code before our URL-param seed has committed.
  const hydratedRef = useRef(false);

  // Pull the course from the backend for starter/solution/tests. Seed the
  // files array from:
  //   1. ?files= URL param (encoded by main window at pop time) — survives
  //      across Tauri webview storage partitions
  //   2. deriveStarterFiles(lesson) fallback if the param is missing
  useEffect(() => {
    let cancelled = false;
    invoke<Course>("load_course", { courseId })
      .then((c) => {
        if (cancelled) return;
        for (const ch of c.chapters) {
          const found = ch.lessons.find((l) => l.id === lessonId);
          if (found && isExerciseKind(found)) {
            setLesson(found);
            const fromUrl = params.get("files");
            const decoded = fromUrl ? decodeFiles(fromUrl) : null;
            setFiles(decoded ?? deriveStarterFiles(found));
            queueMicrotask(() => {
              hydratedRef.current = true;
            });
            return;
          }
        }
        setError(`Lesson ${lessonId} not found in ${courseId}`);
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lessonId]);

  // Bidirectional sync. Same bus abstraction the main window uses.
  useEffect(() => {
    if (!courseId || !lessonId) return;
    const bus = makeBus(courseId, lessonId);
    const unlisten = bus.listen((msg, from) => {
      if (from === "popped") return;
      if (msg.type === "files" && hydratedRef.current) setFiles(msg.files);
      if (msg.type === "running") setRunning(true);
      if (msg.type === "result") {
        setResult(msg.result);
        setRunning(false);
      }
      if (msg.type === "close-request") {
        window.close();
      }
    });
    return unlisten;
  }, [courseId, lessonId]);

  // Emit goodbye on unload so the main window restores the inline editor.
  useEffect(() => {
    if (!courseId || !lessonId) return;
    const handler = () => {
      const bus = makeBus(courseId, lessonId);
      bus.emit({ type: "closed" }, "popped");
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
  }, [courseId, lessonId]);

  useEffect(() => {
    if (!courseId || !lessonId) return;
    if (!hydratedRef.current) return;
    const bus = makeBus(courseId, lessonId);
    bus.emit({ type: "files", files }, "popped");
  }, [files, courseId, lessonId]);

  function handleFileChange(index: number, next: string) {
    setFiles((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const copy = prev.slice();
      copy[index] = { ...copy[index], content: next };
      return copy;
    });
  }

  async function handleRun() {
    if (!lesson) return;
    setRunning(true);
    setResult(null);
    const bus = makeBus(courseId, lessonId);
    bus.emit({ type: "running" }, "popped");
    try {
      const harness =
        "harness" in lesson ? (lesson as { harness?: "evm" | "solana" }).harness : undefined;
      const r = await runFiles(
        lesson.language,
        files,
        lesson.tests,
        undefined,
        undefined,
        harness,
      );
      setResult(r);
      bus.emit({ type: "result", result: r }, "popped");
      if (isPassing(r)) bus.emit({ type: "complete" }, "popped");
    } finally {
      setRunning(false);
    }
  }

  if (error) {
    return <div style={{ padding: 20, color: "#ef6f6f" }}>{error}</div>;
  }
  if (!lesson) {
    return <div style={{ padding: 20, color: "#888" }}>Loading…</div>;
  }

  return (
    <div className="fishbones-workbench-standalone-host">
      <div className="fishbones-workbench-standalone-title">
        {lesson.title} · <span>popped workbench</span>
      </div>
      <Workbench
        storageKey="kata:workbench-split:popped"
        editor={
          <EditorPane
            language={lesson.language}
            files={files}
            activeIndex={activeIdx}
            onActiveIndexChange={setActiveIdx}
            onChange={handleFileChange}
            onRun={handleRun}
            hints={lesson.hints}
            onReset={() => {
              setFiles(deriveStarterFiles(lesson));
              setActiveIdx(0);
            }}
            onRevealSolution={() => {
              setFiles(deriveSolutionFiles(lesson));
              setActiveIdx(0);
              setResult(null);
            }}
          />
        }
        output={<OutputPane result={result} running={running} />}
      />
    </div>
  );
}
