/// Drag-and-drop a `.fishbones` (or legacy `.kata`) archive onto the
/// app window to import it. Wraps Tauri 2's `onDragDropEvent` API and
/// gives the caller two pieces of state plus a sequential import
/// runner:
///
///   - `isDragging` — true while the OS reports a drag over the
///     window AND at least one of the file paths under the cursor
///     looks like a fishbones archive. Drives the drop-target overlay.
///   - `isImporting` — true while we're awaiting `invoke("import_course")`
///     calls after a drop. Multiple files import sequentially so the
///     UI can show a stable count.
///   - `progress` — `{ current: number; total: number }` while
///     importing; reset to `null` when idle.
///
/// The hook owns no business logic — it just funnels detected drops
/// into the caller-supplied `onImport(path)` callback. App.tsx uses
/// the existing `import_course` Tauri command and the same post-
/// import open-tab + refresh dance that the file-picker path
/// already does.
///
/// On non-Tauri builds (web), the listener install is a no-op — the
/// hook returns idle state forever and the import callback is never
/// fired. Drag-and-drop on the web uses the HTML5 DataTransfer API,
/// which is a different surface entirely; that path lives behind a
/// future TODO since the web Fishbones build doesn't have an
/// `import_course` backend equivalent yet.

import { useEffect, useRef, useState } from "react";
import { isWeb } from "../lib/platform";

const ARCHIVE_EXTENSIONS = [".fishbones", ".kata"];

function isArchivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface ArchiveDropProgress {
  /// 1-indexed current item being imported (for "2 of 5" copy).
  current: number;
  total: number;
}

export interface UseArchiveDropResult {
  /// True while the OS is reporting a drag over the window AND the
  /// dragged set contains at least one archive. Use this to render a
  /// drop-target overlay.
  isDragging: boolean;
  /// True while a drop is being processed (sequential
  /// `invoke("import_course")` calls). Use this to render a
  /// non-blocking progress indicator after the drop completes.
  isImporting: boolean;
  /// 1-indexed progress over the dropped set; null when idle.
  progress: ArchiveDropProgress | null;
}

export interface UseArchiveDropOptions {
  /// Called once per archive after it's detected as a drop. Should
  /// invoke the Tauri `import_course` command (or whatever
  /// backend-shaped equivalent the caller has) and resolve once the
  /// file is fully processed.
  ///
  /// Returning a rejected promise just logs — doesn't break the rest
  /// of the queue. The hook caller is responsible for surfacing
  /// failures to the user (toast / alert) inside the callback.
  onImport: (archivePath: string) => Promise<void>;
}

export function useArchiveDrop({ onImport }: UseArchiveDropOptions): UseArchiveDropResult {
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ArchiveDropProgress | null>(null);
  // Capture the latest onImport without re-subscribing the listener
  // every render — the Tauri listener registration is async and
  // expensive enough that re-running it on every render would race
  // with itself.
  const onImportRef = useRef(onImport);
  useEffect(() => {
    onImportRef.current = onImport;
  }, [onImport]);

  useEffect(() => {
    if (isWeb) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        // Lazy-import so the web build doesn't pull the desktop-only
        // module into its bundle. The vite alias for
        // `@tauri-apps/api/webview` may or may not resolve cleanly
        // on web — guarding behind isWeb above keeps this clean.
        const mod = await import("@tauri-apps/api/webview");
        if (cancelled) return;
        const u = await mod.getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "enter") {
            // Only highlight when at least one path looks importable.
            // Random files (PDFs, images) dragged over the window
            // shouldn't trigger the import overlay.
            if (p.paths.some(isArchivePath)) setIsDragging(true);
          } else if (p.type === "leave") {
            setIsDragging(false);
          } else if (p.type === "drop") {
            setIsDragging(false);
            const archives = p.paths.filter(isArchivePath);
            if (archives.length === 0) return;
            void runQueue(archives);
          }
          // 'over' fires constantly while the cursor moves; we don't
          // need it because 'enter' already set the dragging flag.
        });
        if (cancelled) {
          // Race: the effect was torn down between awaits. Unwind
          // immediately so we don't leak the listener.
          u();
          return;
        }
        unlisten = u;
      } catch (e) {
        // The webview module fails to import in some rare contexts
        // (web build with strict alias mismatch, embedded iframe).
        // Log + carry on — the file picker still works.
        // eslint-disable-next-line no-console
        console.warn("[fishbones] drag-drop listener install failed:", e);
      }
    })();

    async function runQueue(paths: string[]) {
      setIsImporting(true);
      setProgress({ current: 0, total: paths.length });
      for (let i = 0; i < paths.length; i++) {
        setProgress({ current: i + 1, total: paths.length });
        try {
          await onImportRef.current(paths[i]);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[fishbones] drop-import failed for", paths[i], e);
          // Keep going — partial success beats halt-on-first-failure.
        }
      }
      setIsImporting(false);
      setProgress(null);
    }

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []); // listener install is lifetime-of-component; ref pattern handles onImport changes

  // Idle helpers exposed verbatim so consumers don't bind the
  // setters directly.
  return { isDragging, isImporting, progress };
}
