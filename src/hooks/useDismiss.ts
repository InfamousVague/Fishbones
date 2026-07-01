import { useEffect, type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";

/// Dismiss-on-outside-interaction (+ Escape) for popovers / dropdowns /
/// menus. Calls `onClose` when an interaction lands outside `ref`, and —
/// unless `escape: false` — on the Escape key, composing `useEscapeKey` so
/// the two dismiss affordances share one definition.
///
/// Replaces the ~9 hand-rolled "addEventListener(pointerdown/mousedown) +
/// ref.contains() + remove on cleanup" blocks scattered across the
/// dropdowns and context menus (LanguageDropdown, CourseContextMenu,
/// StatsChip, Sidebar, TrayHeader, DownloadButton, …).
///
/// `event` selects the trigger so each call site keeps its exact semantics:
///   - "pointerdown" (default) — fires before a click on another control
///     resolves; what most of the dropdowns want.
///   - "mousedown" — legacy equivalent for sites that used it.
///   - "click" — for menus that must let the opening click's own onClick
///     run first (capture is still used; the outside check excludes self).
/// Listener is attached in the CAPTURE phase (matching the existing code),
/// so it sees the event before in-tree handlers stop propagation.
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: {
    escape?: boolean;
    enabled?: boolean;
    event?: "pointerdown" | "mousedown" | "click";
  } = {},
): void {
  const { escape = true, enabled = true, event = "pointerdown" } = opts;
  useEscapeKey(onClose, enabled && escape);
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: Event) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    document.addEventListener(event, onDown, true);
    return () => document.removeEventListener(event, onDown, true);
  }, [ref, onClose, enabled, event]);
}
