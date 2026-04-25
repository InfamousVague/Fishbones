/// Workbench state sync between the main window and the popped-out workbench
/// window. We need two paths because BroadcastChannel does NOT cross Tauri
/// webview processes — each Tauri WebviewWindow is its own process with its
/// own storage and its own channel space. In a plain browser (vite dev) two
/// windows opened via window.open DO share BroadcastChannel, so the fallback
/// there is trivial.
///
/// Usage:
///   const bus = makeBus(courseId, lessonId);
///   bus.listen((msg) => { ... });           // returns unlisten fn
///   await bus.emit({ type: "code", value }); // fire and forget is fine
import type { WorkbenchFile } from "../data/types";
import type { RunResult } from "../runtimes";

export type WorkbenchMsg =
  // Whole-file-array updates. We send the full array rather than individual
  // diffs so receivers don't need to reason about ordering / applying edits,
  // and so adding or renaming files flows through the same channel.
  | { type: "files"; files: WorkbenchFile[] }
  | { type: "running" }
  | { type: "result"; result: RunResult }
  | { type: "complete" }
  | { type: "hello" } // popped window announces itself, main responds with files
  | { type: "close-request" } // main asks popped to close itself
  | { type: "closed" }; // popped announces it's going away (beforeunload)

export interface WorkbenchBus {
  /// Register a listener. Returns an unlisten function.
  listen(fn: (msg: WorkbenchMsg, from: "main" | "popped") => void): () => void;
  /// Broadcast a message to the other side. Safe to call on every keystroke.
  emit(msg: WorkbenchMsg, from: "main" | "popped"): void;
}

function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    !== "undefined";
}

/// Construct a bus keyed by course+lesson. Picks the Tauri event path when
/// we're inside the Tauri webview; falls back to BroadcastChannel for
/// `vite dev` / tests.
export function makeBus(courseId: string, lessonId: string): WorkbenchBus {
  const eventName = `kata:workbench:${courseId}:${lessonId}`;

  if (isTauri()) {
    // Tauri path: bridge through the event system. Payloads include the
    // origin so listeners can ignore their own echoes.
    return {
      listen(fn) {
        let unlisten: (() => void) | null = null;
        let disposed = false;
        // Tauri's unlisten is async under the hood; if the event plugin's
        // in-memory listener table has already dropped this handler (HMR
        // teardown, double-unmount from an error-boundary cascade, etc.)
        // it throws synchronously and the `async` wrapper surfaces that
        // as an unhandled rejection. Swallow — nothing to clean up.
        const safeUn = (un: () => void) => {
          try {
            const r = un() as unknown as Promise<void> | void;
            if (r && typeof (r as Promise<void>).catch === "function") {
              (r as Promise<void>).catch(() => {});
            }
          } catch {
            /* stale listener registry */
          }
        };
        import("@tauri-apps/api/event").then(({ listen }) => {
          if (disposed) return;
          listen<{ msg: WorkbenchMsg; from: "main" | "popped" }>(eventName, (ev) => {
            fn(ev.payload.msg, ev.payload.from);
          }).then((un) => {
            if (disposed) safeUn(un);
            else unlisten = un;
          });
        });
        return () => {
          disposed = true;
          if (unlisten) safeUn(unlisten);
        };
      },
      emit(msg, from) {
        import("@tauri-apps/api/event").then(({ emit }) => {
          emit(eventName, { msg, from }).catch(() => {
            /* ignore — the other side may not be listening yet */
          });
        });
      },
    };
  }

  // Browser/vite-dev path: BroadcastChannel. Re-open on each emit rather
  // than keeping a long-lived instance so we don't leak across hot reloads.
  return {
    listen(fn) {
      const channel = new BroadcastChannel(eventName);
      channel.onmessage = (ev) => {
        if (!ev.data) return;
        fn(ev.data.msg, ev.data.from);
      };
      return () => channel.close();
    },
    emit(msg, from) {
      const channel = new BroadcastChannel(eventName);
      channel.postMessage({ msg, from });
      channel.close();
    },
  };
}

/// Stable label used for the popped workbench window. Exported so the main
/// window can use it to close the popped window on "bring back here".
export function popOutLabel(lessonId: string): string {
  return `workbench-${lessonId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/// Open the workbench in a new window. Prefers Tauri's WebviewWindow API so
/// it lives inside the app; falls back to window.open for `vite dev` or if
/// the Tauri API is unavailable.
///
/// Passes `currentCode` via a URL param so the popped window paints with
/// the learner's in-progress code on first render. localStorage is not
/// reliable across Tauri webview windows (they can use separate storage
/// partitions), but URL params always make it through.
export async function openPoppedWorkbench(
  courseId: string,
  lessonId: string,
  title: string,
  currentFiles: WorkbenchFile[],
): Promise<void> {
  const base = new URL(window.location.href);
  base.searchParams.set("popped", "1");
  base.searchParams.set("course", courseId);
  base.searchParams.set("lesson", lessonId);
  // Encode the initial files payload as a base64 URL param so the popped
  // window can hydrate synchronously on mount — avoids the race where its
  // initial empty state broadcasts before listeners are wired up.
  base.searchParams.set("files", encodeFiles(currentFiles));
  const url = base.toString();
  const label = popOutLabel(lessonId);

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      // Focus an existing popped window for this lesson instead of spawning
      // duplicates. Tauri 2's getByLabel returns null when absent.
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow(label, {
        url,
        title: `Fishbones · ${title}`,
        width: 960,
        height: 720,
        minWidth: 560,
        minHeight: 380,
        resizable: true,
      });
      return;
    } catch (e) {
      console.warn("[fishbones] Tauri WebviewWindow failed, falling back to window.open:", e);
    }
  }

  window.open(url, label, "width=960,height=720");
}

/// Close the popped workbench window, if one is open. Tries the Tauri
/// WebviewWindow API first and falls back to a bus "close-request" so the
/// popped window can close itself (needed for the browser fallback since
/// the main window usually can't call .close() on a window it opened with
/// window.open when that window has navigated to a different origin — but
/// for same-origin, the popped window's own close() still works).
export async function closePoppedWorkbench(
  courseId: string,
  lessonId: string,
): Promise<void> {
  const label = popOutLabel(lessonId);

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = await WebviewWindow.getByLabel(label);
      if (win) await win.close();
      return;
    } catch (e) {
      console.warn("[fishbones] Tauri close failed, falling back to bus close-request:", e);
    }
  }

  // Browser / fallback path: ask the popped window to close itself.
  const bus = makeBus(courseId, lessonId);
  bus.emit({ type: "close-request" }, "main");
}

/// URL-safe encoding of the files array so we can pass it via query string.
/// Base64 survives quoting; JSON alone would need extra encoding for braces
/// and quotes.
export function encodeFiles(files: WorkbenchFile[]): string {
  const json = JSON.stringify(files);
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, "utf-8").toString("base64");
}

export function decodeFiles(encoded: string): WorkbenchFile[] | null {
  try {
    const json = typeof atob === "function"
      ? decodeURIComponent(escape(atob(encoded)))
      : Buffer.from(encoded, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as WorkbenchFile[];
  } catch {
    /* fall through */
  }
  return null;
}
