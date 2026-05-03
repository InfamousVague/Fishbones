/// "Watch mode" verifier bus — a tiny typed pub-sub layer that lets
/// the verify-course coroutine drive the lesson UI from the outside:
///
///   verifier coroutine                  React tree
///   ─────────────────                   ──────────
///   dispatchCommand("revealSolution")  → LessonView listens → swaps
///                                         editor files to solution
///   dispatchCommand("run")             → LessonView listens → fires
///                                         handleRun()
///   dispatchCommand("next")            → LessonView listens → fires
///                                         handleNext()
///   dispatchCommand("answerQuiz")      → QuizView listens → marks
///                                         every question correct
///
///   <─ emitEvent("lessonReady")         from LessonView mount/change
///   <─ emitEvent("runResult", passed)   from LessonView after handleRun
///   <─ emitEvent("lessonComplete")      from App's
///                                         markCompletedAndCelebrate
///
/// Why window CustomEvents instead of (a) zustand/context, (b) a
/// React ref-controller, (c) extending the existing `workbenchSync`
/// bus:
///
/// (a) Zustand would require every listener to be a hook; the
///     verifier coroutine isn't a React hook so it'd need to bridge
///     anyway. Adds a dep + a store for one ephemeral concern.
/// (b) Refs need the verifier to know which component instance is
///     "current" — wiring it through tab state, popped-window state,
///     etc. is fragile. Window events let any mounted listener self-
///     register without a routing layer.
/// (c) The workbench bus is per-(courseId, lessonId) and goes
///     through Tauri's native event system — overkill for a same-
///     window control channel and would mix concerns.
///
/// Each command + event carries the `lessonId` it targets so stale
/// listeners (e.g. a LessonView mid-unmount) ignore commands meant
/// for the next lesson.

import type { RunResult } from "../runtimes";

export type VerifierCommand =
  | { type: "revealSolution"; lessonId: string }
  | { type: "run"; lessonId: string }
  | { type: "next"; lessonId: string }
  | { type: "answerQuiz"; lessonId: string };

export type VerifierEvent =
  | {
      type: "lessonReady";
      courseId: string;
      lessonId: string;
      kind: string;
    }
  | {
      type: "runResult";
      lessonId: string;
      passed: boolean;
      result: RunResult | null;
    }
  | { type: "lessonComplete"; courseId: string; lessonId: string };

const COMMAND_EVENT = "fishbones:verifier:command";
const EVENT_EVENT = "fishbones:verifier:event";

export function dispatchCommand(cmd: VerifierCommand): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: cmd }));
}

export function emitEvent(evt: VerifierEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_EVENT, { detail: evt }));
}

export function onCommand(
  fn: (cmd: VerifierCommand) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const ce = e as CustomEvent<VerifierCommand>;
    if (ce.detail) fn(ce.detail);
  };
  window.addEventListener(COMMAND_EVENT, handler);
  return () => window.removeEventListener(COMMAND_EVENT, handler);
}

export function onEvent(fn: (evt: VerifierEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const ce = e as CustomEvent<VerifierEvent>;
    if (ce.detail) fn(ce.detail);
  };
  window.addEventListener(EVENT_EVENT, handler);
  return () => window.removeEventListener(EVENT_EVENT, handler);
}

/// Resolve when `pred(evt)` returns true. Rejects on signal abort or
/// timeout. Used by the verifier coroutine to wait for the UI's
/// async response (lesson mounting, run finishing, quiz completing).
export function waitForEvent(
  pred: (evt: VerifierEvent) => boolean,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<VerifierEvent> {
  return new Promise<VerifierEvent>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let off: (() => void) | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (off) off();
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };

    if (opts.signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    opts.signal?.addEventListener("abort", onAbort);

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for verifier event (${opts.timeoutMs}ms)`));
    }, opts.timeoutMs);

    off = onEvent((evt) => {
      if (pred(evt)) {
        cleanup();
        resolve(evt);
      }
    });
  });
}
