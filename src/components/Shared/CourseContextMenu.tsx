import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@base/primitives/icon";
import { settings as settingsIcon } from "@base/primitives/icon/icons/settings";
import { download as downloadIcon } from "@base/primitives/icon/icons/download";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";

/// Right-click-anywhere-a-cover-appears context menu. Extracted from
/// Sidebar so the library (shelf + grid) can mount the same UX without
/// re-implementing dismissal/positioning state. CSS classes are shared
/// with Sidebar's original menu (`.fishbones__context-menu*`) so visual
/// consistency stays free.
export interface CourseMenuTarget {
  courseId: string;
  courseTitle: string;
  x: number;
  y: number;
}

interface Props {
  menu: CourseMenuTarget | null;
  onDismiss: () => void;
  onSettings?: (courseId: string) => void;
  onExport?: (courseId: string, courseTitle: string) => void;
  onDelete?: (courseId: string, courseTitle: string) => void;
}

export default function CourseContextMenu({
  menu,
  onDismiss,
  onSettings,
  onExport,
  onDelete,
}: Props) {
  /// Dismiss on outside click, Escape. Matches the sidebar's original
  /// behavior. `click` (not `mousedown`) so the click that activates a
  /// menu item still hits the item's onClick before the dismiss fires.
  useEffect(() => {
    if (!menu) return;
    const close = () => onDismiss();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, onDismiss]);

  if (!menu) return null;
  if (!onSettings && !onExport && !onDelete) return null;

  // Portal to body so we escape any ancestor that creates a containing
  // block for fixed positioning (sidebars / modals with `backdrop-filter`,
  // `transform`, etc.) — without this the menu gets clipped by the
  // ancestor's `overflow: hidden`.
  return createPortal(
    <div
      className="fishbones__context-menu"
      style={{ left: menu.x, top: menu.y, position: "fixed", zIndex: 1000 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="fishbones__context-menu-label">{menu.courseTitle}</div>
      {onSettings && (
        <button
          className="fishbones__context-menu-item"
          onClick={() => {
            onSettings(menu.courseId);
            onDismiss();
          }}
        >
          <span className="fishbones__context-menu-icon" aria-hidden>
            <Icon icon={settingsIcon} size="xs" color="currentColor" />
          </span>
          Course settings…
        </button>
      )}
      {onExport && (
        <button
          className="fishbones__context-menu-item"
          onClick={() => {
            onExport(menu.courseId, menu.courseTitle);
            onDismiss();
          }}
        >
          <span className="fishbones__context-menu-icon" aria-hidden>
            <Icon icon={downloadIcon} size="xs" color="currentColor" />
          </span>
          Export course…
        </button>
      )}
      {onDelete && (
        <>
          <div className="fishbones__context-menu-sep" aria-hidden />
          <button
            className="fishbones__context-menu-item fishbones__context-menu-item--danger"
            onClick={() => {
              onDelete(menu.courseId, menu.courseTitle);
              onDismiss();
            }}
          >
            <span className="fishbones__context-menu-icon" aria-hidden>
              <Icon icon={xIcon} size="xs" color="currentColor" />
            </span>
            Delete course…
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

/// Helper hook: owns the menu state + returns a `show(course, event)`
/// function for consumers to wire into `onContextMenu`. Callers render
/// the `<CourseContextMenu menu={menu} onDismiss={close}>` bit with their
/// own action handlers.
export function useCourseMenu() {
  const [menu, setMenu] = useState<CourseMenuTarget | null>(null);
  const show = (
    course: { id: string; title: string },
    e: React.MouseEvent | MouseEvent,
  ) => {
    e.preventDefault();
    setMenu({ courseId: course.id, courseTitle: course.title, x: e.clientX, y: e.clientY });
  };
  const close = () => setMenu(null);
  return { menu, show, close };
}
