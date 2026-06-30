import { useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { plus } from "@base/primitives/icon/icons/plus";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { filePlus } from "@base/primitives/icon/icons/file-plus";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { globe } from "@base/primitives/icon/icons/globe";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import "./AddCourseButton.css";

interface Props {
  /// Smart file picker: open the OS file dialog with all supported
  /// course formats (.pdf, .epub, .academy, .libre, .kata, .zip,
  /// .json), then sniff each result and dispatch to the right
  /// handler. Fires when the user clicks the main split-button face
  /// OR the matching dropdown item.
  onSmartPick: () => void;
  /// Bulk PDF/EPUB queue (the existing batch-import wizard). Hidden
  /// when omitted. Useful when the user wants to import many books
  /// at once with the dedicated UI rather than the smart picker's
  /// generic file dialog.
  onBulkPdfs?: () => void;
  /// Crawl a docs site URL. URL-only, no file → kept as a separate
  /// menu item rather than folded into the smart picker.
  onDocsUrl?: () => void;
  /// Imports a previously-exported `.academy` archive (or its legacy
  /// `.libre` predecessor). The smart picker handles archives
  /// too, so this is a redundant convenience — kept for users who
  /// specifically want the "Archive" affordance.
  onArchive?: () => void;
  /// Opens the catalog browser modal so the user can search the
  /// official Libre library and install courses they don't
  /// have yet. Distinct from `onSmartPick` — that's for files /
  /// URLs the user already has; this discovers what's available.
  onBrowseCatalog?: () => void;
}

/// Single "Add course" entry point in the library header. Replaces
/// the old four-button segmented control (Book / Bulk books / Docs
/// site / Archive) with a split button:
///
///   [ + Add course | ▾ ]
///
/// Click the LEFT half → smart picker (covers most cases — PDFs,
/// EPUBs, archives, JSON exports). Click the RIGHT half → dropdown
/// with explicit alternatives (bulk wizard, docs URL, archive).
///
/// The dropdown anchors below the button via a CSS-positioned
/// element rather than a portal because the library header isn't
/// inside a clipping ancestor — keeps the markup simple.
export default function AddCourseButton({
  onSmartPick,
  onBulkPdfs,
  onDocsUrl,
  onArchive,
  onBrowseCatalog,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismiss. Listening at the window level avoids
  // having to weave refs through every conceivable child of the
  // library header.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dispatch = (fn: (() => void) | undefined) => {
    setOpen(false);
    if (fn) fn();
  };

  return (
    <div className="libre-addcourse" ref={wrapperRef}>
      <div className="libre-addcourse-split">
        <button
          type="button"
          className="libre-addcourse-main"
          onClick={onSmartPick}
          title={t("addCourse.primaryTitle")}
        >
          <Icon icon={plus} size="xs" color="currentColor" />
          <span>{t("addCourse.primary")}</span>
        </button>
        <button
          type="button"
          className="libre-addcourse-caret"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t("addCourse.caretAria")}
          title={t("addCourse.caretTitle")}
        >
          <Icon icon={chevronDown} size="xs" color="currentColor" />
        </button>
      </div>

      {open && (
        <div
          className="libre-addcourse-menu"
          role="menu"
          aria-label={t("addCourse.menuAria")}
        >
          <button
            type="button"
            role="menuitem"
            className="libre-addcourse-item"
            onClick={() => dispatch(onSmartPick)}
          >
            <Icon icon={filePlus} size="xs" color="currentColor" />
            <span className="libre-addcourse-item-body">
              <span className="libre-addcourse-item-title">
                {t("addCourse.pickFile")}
              </span>
              <span className="libre-addcourse-item-hint">
                {t("addCourse.pickFileHint")}
              </span>
            </span>
          </button>
          {onBulkPdfs && (
            <button
              type="button"
              role="menuitem"
              className="libre-addcourse-item"
              onClick={() => dispatch(onBulkPdfs)}
            >
              <Icon icon={libraryBig} size="xs" color="currentColor" />
              <span className="libre-addcourse-item-body">
                <span className="libre-addcourse-item-title">
                  {t("addCourse.bulkPdfs")}
                </span>
                <span className="libre-addcourse-item-hint">
                  {t("addCourse.bulkPdfsHint")}
                </span>
              </span>
            </button>
          )}
          {onDocsUrl && (
            <button
              type="button"
              role="menuitem"
              className="libre-addcourse-item"
              onClick={() => dispatch(onDocsUrl)}
            >
              <Icon icon={globe} size="xs" color="currentColor" />
              <span className="libre-addcourse-item-body">
                <span className="libre-addcourse-item-title">
                  {t("addCourse.docsUrl")}
                </span>
                <span className="libre-addcourse-item-hint">
                  {t("addCourse.docsUrlHint")}
                </span>
              </span>
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              role="menuitem"
              className="libre-addcourse-item"
              onClick={() => dispatch(onArchive)}
            >
              <Icon icon={filePlus} size="xs" color="currentColor" />
              <span className="libre-addcourse-item-body">
                <span className="libre-addcourse-item-title">
                  {t("addCourse.archive")}
                </span>
                <span className="libre-addcourse-item-hint">
                  {t("addCourse.archiveHint")}
                </span>
              </span>
            </button>
          )}
          {onBrowseCatalog && (
            <button
              type="button"
              role="menuitem"
              className="libre-addcourse-item"
              onClick={() => dispatch(onBrowseCatalog)}
            >
              <Icon icon={libraryBig} size="xs" color="currentColor" />
              <span className="libre-addcourse-item-body">
                <span className="libre-addcourse-item-title">
                  {t("addCourse.browseCatalog")}
                </span>
                <span className="libre-addcourse-item-hint">
                  {t("addCourse.browseCatalogHint")}
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
