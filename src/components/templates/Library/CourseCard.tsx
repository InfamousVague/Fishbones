import { memo } from "react";
import type { Course } from "@/data/types";
import { languageMeta } from "@/lib/languages";
import LanguageChip from "@/components/atoms/LanguageChip/LanguageChip";
import { useT } from "@/i18n/i18n";
import { useLocale } from "@/hooks/useLocale";
import { localizedCourse } from "@/data/localize";
// Card chrome lives in CourseLibrary.css alongside the grid +
// sidebar styles. Importing it from this file (rather than relying
// on a parent like CourseLibrary to bring it in) means every
// consumer — including MobileLibrary, which doesn't render
// CourseLibrary at all — picks up the styles. Without this import
// the iPad library renders cards as raw flow content with no card
// chrome, no progress bar styling, no hover states.
import "./CourseLibrary.css";

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
  /// Right-click handler — surfaces the card's context menu
  /// (Reinstall / Export / Settings / Reset / Delete). The parent
  /// `CourseLibrary` opens its own context menu component with the
  /// full action set; this card no longer renders inline buttons
  /// for those actions to keep the grid visually clean.
  onContextMenu?: (e: React.MouseEvent) => void;
  /// Discover-mode flag — swaps the progress meter for an Install
  /// button (or "Installing…" spinner). Passed through from the
  /// library's per-tile install handler so the same code path works
  /// in both views.
  placeholder?: boolean;
  installing?: boolean;
  onInstall?: () => void;
  /// Update-available indicator — a small dot in the card header
  /// when an updated bundled archive is on disk. Replaces the
  /// loud "Update" button the card used to render; the actual
  /// reinstall action now lives in the right-click context menu
  /// only, surfaced upstream via `onUpdateCourse`.
  hasUpdate?: boolean;
  /// Optional inline style — used by CourseLibrary to set the
  /// `--libre-ripple-i` custom property per card so the mount-time
  /// ripple animation staggers across the grid in index order.
  /// Spread onto the root div in BOTH the installed and
  /// placeholder render paths; the library's CSS reads the
  /// custom property as `animation-delay`.
  style?: React.CSSProperties;
}

function CourseCardImpl({
  course: rawCourse,
  total,
  done,
  pct,
  onOpen,
  onContextMenu,
  placeholder,
  installing,
  onInstall,
  hasUpdate,
  style,
}: Props) {
  const t = useT();
  // Localize the book title/description for the active app language —
  // translated courses show their translated title on the shelf and
  // fall back to English when the locale has no course-level
  // translation (partial translations are first-class).
  const [locale] = useLocale();
  const course = localizedCourse(rawCourse, locale);
  const chapters = course.chapters.length;
  const isCompleted = pct === 1;
  const status =
    pct === 0
      ? t("library.notStartedLower")
      : isCompleted
        ? t("library.completedLower")
        : `${Math.round(pct * 100)}%`;

  // Placeholder cards (Discover mode) have no progress, no chapters
  // yet — just metadata + the install affordance. We use the same
  // wrapper but render a different inner block.
  if (placeholder) {
    return (
      <div
        className="libre-library-card libre-library-card--placeholder"
        onContextMenu={onContextMenu}
        style={style}
      >
        <div className="libre-library-card-main">
          <div className="libre-library-card-header">
            <LanguageChip language={course.language} size="sm" />
            <span className="libre-library-card-status">{t("library.available")}</span>
          </div>
          <div className="libre-library-card-title">{course.title}</div>
          {course.author && (
            <div className="libre-library-card-author">{t("library.authorPrefix", { author: course.author })}</div>
          )}
          <div className="libre-library-card-meta">
            {chapters > 0
              ? chapters === 1
                ? t("library.chapterCount", { count: chapters })
                : t("library.chapterCountPlural", { count: chapters })
              : t("library.catalogBook")}
          </div>
        </div>
        <div className="libre-library-card-actions">
          <button
            type="button"
            className="libre-library-card-action libre-library-card-action--install"
            onClick={(e) => {
              e.stopPropagation();
              onInstall?.();
            }}
            disabled={installing || !onInstall}
            title={t("library.installTitle")}
          >
            {installing ? t("library.installing") : t("library.install")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="libre-library-card" onContextMenu={onContextMenu} style={style}>
      <button
        type="button"
        className="libre-library-card-main"
        onClick={onOpen}
      >
        <div className="libre-library-card-header">
          <LanguageChip language={course.language} size="sm" />
          {hasUpdate && (
            <span
              className="libre-library-card-update-dot"
              aria-label={t("library.updateAvailable")}
              title={t("library.updateAvailable")}
            />
          )}
          <span
            className={
              isCompleted
                ? "libre-library-card-status libre-library-card-status--completed"
                : "libre-library-card-status"
            }
          >
            {isCompleted && (
              // Crown icon — marks fully-finished courses on the
              // grid view. Inline SVG so we don't pull in an icon
              // library just for one glyph; sized to sit in the
              // baseline of the uppercase status text.
              <svg
                className="libre-library-card-status-icon"
                viewBox="0 0 24 24"
                width="11"
                height="11"
                fill="currentColor"
                aria-hidden
              >
                <path d="M3 7l4 5 5-7 5 7 4-5v11H3V7zm0 13h18v2H3z" />
              </svg>
            )}
            {status}
          </span>
        </div>
        <div className="libre-library-card-title">{course.title}</div>
        {course.author && (
          <div className="libre-library-card-author">
            {t("library.authorPrefix", { author: course.author })}
          </div>
        )}
        <div className="libre-library-card-progress" aria-hidden>
          <div
            className="libre-library-card-progress-fill"
            // Language-accent fill — same recipe as the Challenges cards
            // and the shelf BookCover strip, so progress reads the same
            // colour everywhere a course appears.
            style={{
              width: `${pct * 100}%`,
              background: languageMeta(course.language).color,
            }}
          />
        </div>
        <div className="libre-library-card-meta">
          {chapters === 1
            ? t("library.cardMeta", { done, total, chapters })
            : t("library.cardMetaPlural", { done, total, chapters })}
        </div>
      </button>
    </div>
  );
}

/// Memo-wrapped because the library re-renders on every filter / sort /
/// search keystroke; without this each of those re-renders walks every
/// card's render function even when its props haven't changed. The
/// default shallow-equal works — every prop is a primitive, a stable
/// course-object reference, or a stable callback (parent uses
/// `useCallback` on the per-card handlers).
const CourseCard = memo(CourseCardImpl);
export default CourseCard;
