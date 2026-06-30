/// Two-state overlay paired with `useArchiveDrop`:
///
///   - When a `.academy` (or legacy `.libre` / `.kata`) is being
///     dragged over the app window, render a full-window drop target
///     ("Drop courses here") so the user gets unambiguous feedback
///     that the OS-level drag is being recognised by the right
///     surface.
///   - Once the drop happens, fade to a small bottom-center status
///     pill ("Importing 2 of 5…") that stays up until the queue
///     drains. Non-blocking — the rest of the app is interactable
///     while imports run.
///
/// Both states are decorative: the drop event itself is captured by
/// Tauri's webview, not by this component, so we set `pointer-events:
/// none` on the backdrop. This is the same pattern Slack / VS Code
/// use for drag previews.

import { Icon } from "@base/primitives/icon";
import { upload } from "@base/primitives/icon/icons/upload";
import { bookOpen } from "@base/primitives/icon/icons/book-open";
import { useT } from "@/i18n/i18n";
import "./ArchiveDropOverlay.css";

interface Props {
  /// Drag-over state from useArchiveDrop. When true, render the
  /// full-window drop target.
  isDragging: boolean;
  /// Import-in-flight state from useArchiveDrop. When true, render
  /// the bottom-center progress pill.
  isImporting: boolean;
  /// Progress payload from useArchiveDrop. Drives the "N of M" copy.
  progress: { current: number; total: number } | null;
}

export default function ArchiveDropOverlay({
  isDragging,
  isImporting,
  progress,
}: Props) {
  const t = useT();
  return (
    <>
      {/* Full-window drop target. Pointer-events disabled so the
          dashed-border glass surface doesn't intercept anything —
          the OS-level drag passes straight through to Tauri's
          webview drop handler. */}
      <div
        className={`libre-archive-drop ${
          isDragging ? "libre-archive-drop--active" : ""
        }`}
        aria-hidden={!isDragging}
      >
        <div className="libre-archive-drop__panel">
          <div className="libre-archive-drop__icon" aria-hidden>
            <Icon icon={upload} size="xl" color="currentColor" />
          </div>
          <div className="libre-archive-drop__title">
            {t("library.dropTitle")}
          </div>
          <div
            className="libre-archive-drop__sub"
            dangerouslySetInnerHTML={{ __html: t("library.dropSub") }}
          />
        </div>
      </div>

      {/* Bottom-center import progress pill. Independently rendered
          so a fast drop → import sequence can show progress without
          waiting for the dragging overlay to finish fading. */}
      {isImporting && progress && (
        <div className="libre-archive-toast" role="status" aria-live="polite">
          <span className="libre-archive-toast__icon" aria-hidden>
            <Icon icon={bookOpen} size="sm" color="currentColor" />
          </span>
          <span className="libre-archive-toast__label">
            {progress.total === 1
              ? t("library.importingOne")
              : t("library.importingProgress", { current: progress.current, total: progress.total })}
          </span>
          <span
            className="libre-archive-toast__bar"
            aria-hidden
            style={{
              ["--p" as string]: `${(progress.current / progress.total) * 100}%`,
            }}
          />
        </div>
      )}
    </>
  );
}
