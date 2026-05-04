import type { Course } from "../../data/types";
import LanguageChip from "../LanguageChip/LanguageChip";

/// One info-dense library card. Renders either:
///
///   - **Library mode** (default): a clickable card with title /
///     author / progress bar / per-card actions (Reinstall / Export
///     / Delete). Right-clicking surfaces the same context menu the
///     sidebar uses.
///   - **Discover mode** (`placeholder` true): a non-clickable card
///     with an Install button instead of the progress meter, used in
///     the catalog browser to show books the user hasn't installed
///     yet. The same wrapper is reused so visual weight stays
///     identical between Library and Discover.
///
/// Extracted from `CourseLibrary.tsx` — the parent owns the data
/// fetching + filter state; this is a pure render of one tile.
interface Props {
  course: Course;
  total: number;
  done: number;
  pct: number;
  onOpen: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /// Discover-mode flag — swaps the progress meter for an Install
  /// button (or "Installing…" spinner). Passed through from the
  /// library's per-tile install handler so the same code path works
  /// in both views.
  placeholder?: boolean;
  installing?: boolean;
  onInstall?: () => void;
  /// Library-mode update affordance. When set, the card shows a
  /// "Reinstall" button (or "Update" tinted variant if `hasUpdate`
  /// is also true). Same handler signature as `onUpdateCourse`
  /// upstream, just renamed at the boundary so this component
  /// speaks "reinstall".
  hasUpdate?: boolean;
  updating?: boolean;
  onReinstall?: () => void;
}

export default function CourseCard({
  course,
  total,
  done,
  pct,
  onOpen,
  onExport,
  onDelete,
  onContextMenu,
  placeholder,
  installing,
  onInstall,
  hasUpdate,
  updating,
  onReinstall,
}: Props) {
  const chapters = course.chapters.length;
  const status =
    pct === 0
      ? "not started"
      : pct === 1
        ? "completed"
        : `${Math.round(pct * 100)}%`;

  // Placeholder cards (Discover mode) have no progress, no chapters
  // yet — just metadata + the install affordance. We use the same
  // wrapper but render a different inner block.
  if (placeholder) {
    return (
      <div
        className="fishbones-library-card fishbones-library-card--placeholder"
        onContextMenu={onContextMenu}
      >
        <div className="fishbones-library-card-main">
          <div className="fishbones-library-card-header">
            <LanguageChip language={course.language} size="sm" />
            <span className="fishbones-library-card-status">Available</span>
          </div>
          <div className="fishbones-library-card-title">{course.title}</div>
          {course.author && (
            <div className="fishbones-library-card-author">by {course.author}</div>
          )}
          <div className="fishbones-library-card-meta">
            {chapters > 0
              ? `${chapters} chapter${chapters === 1 ? "" : "s"}`
              : "Catalog book"}
          </div>
        </div>
        <div className="fishbones-library-card-actions">
          <button
            className="fishbones-library-card-action fishbones-library-card-action--install"
            onClick={(e) => {
              e.stopPropagation();
              onInstall?.();
            }}
            disabled={installing || !onInstall}
            title="Add this book to your library"
          >
            {installing ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fishbones-library-card" onContextMenu={onContextMenu}>
      <button className="fishbones-library-card-main" onClick={onOpen}>
        <div className="fishbones-library-card-header">
          <LanguageChip language={course.language} size="sm" />
          <span className="fishbones-library-card-status">{status}</span>
        </div>
        <div className="fishbones-library-card-title">{course.title}</div>
        {course.author && (
          <div className="fishbones-library-card-author">by {course.author}</div>
        )}
        <div className="fishbones-library-card-progress" aria-hidden>
          <div
            className="fishbones-library-card-progress-fill"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <div className="fishbones-library-card-meta">
          {done}/{total} lessons · {chapters} chapter{chapters === 1 ? "" : "s"}
        </div>
      </button>
      <div className="fishbones-library-card-actions">
        {onReinstall && (
          <button
            className={`fishbones-library-card-action ${
              hasUpdate ? "fishbones-library-card-action--update" : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (!updating) onReinstall();
            }}
            disabled={updating}
            title={
              updating
                ? "Reinstalling…"
                : hasUpdate
                  ? "Update available — reapply bundled archive"
                  : "Reinstall — re-extract bundled archive"
            }
          >
            {updating ? "Reinstalling…" : hasUpdate ? "Update" : "Reinstall"}
          </button>
        )}
        {onExport && (
          <button
            className="fishbones-library-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onExport();
            }}
            title="Export as .fishbones archive"
          >
            Export
          </button>
        )}
        {onDelete && (
          <button
            className="fishbones-library-card-action fishbones-library-card-action--danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete this course from disk"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
