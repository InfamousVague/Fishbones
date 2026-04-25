import { useCallback, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@base/primitives/icon";
import { externalLink } from "@base/primitives/icon/icons/external-link";
import "@base/primitives/icon/icon.css";
import "./LessonPopover.css";

export interface PopoverContent {
  kind: "symbol" | "term";
  heading: string;
  signature?: string;
  body: string;
  docUrl?: string;
}

interface Props {
  /// Viewport coordinates the popover should anchor to (typically the
  /// mouse position at the moment the trigger was hovered). `null`
  /// hides the popover.
  coords: { x: number; y: number } | null;
  content: PopoverContent | null;
  onOpenDoc?: (url: string) => void;
  onPopoverEnter?: () => void;
  onPopoverLeave?: () => void;
}

/// Popover that sits next to the mouse cursor. LessonReader captures
/// `clientX`/`clientY` from the `mouseover` event fired by a symbol or
/// term trigger and passes it in as `coords`. We render just below-and-
/// to-the-right of that point, flipping to above / to-the-left if we'd
/// clip off the viewport edge. No element-anchoring, no resize observers
/// — the popover stays where it first appeared until the user dismisses.
///
/// Portal-rendered into `document.body` so scroll parents can't clip it.
export default function LessonPopover({
  coords,
  content,
  onOpenDoc,
  onPopoverEnter,
  onPopoverLeave,
}: Props) {
  // Callback ref to trigger re-measurement once the popover mounts.
  const [popEl, setPopEl] = useState<HTMLDivElement | null>(null);
  const popRef = useCallback((node: HTMLDivElement | null) => {
    setPopEl(node);
  }, []);

  const [style, setStyle] = useState<{ top: number; left: number } | null>(
    null,
  );

  // Measure + position once on mount. We don't track mouse movement —
  // the popover stays where it first appeared so the user can move onto
  // it without it running away.
  useLayoutEffect(() => {
    if (!coords || !content || !popEl) {
      setStyle(null);
      return;
    }
    const popRect = popEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 14; // distance between cursor and popover edge

    // Start below-and-to-the-right of the cursor (the "standard" tooltip
    // placement on macOS / most desktop UI).
    let top = coords.y + GAP;
    let left = coords.x + GAP;

    // Flip above if we'd clip the bottom.
    if (top + popRect.height > vh - 8) {
      top = coords.y - popRect.height - GAP;
    }
    // Flip to the left if we'd clip the right.
    if (left + popRect.width > vw - 8) {
      left = coords.x - popRect.width - GAP;
    }
    // Clamp so the popover never leaves the viewport.
    top = Math.max(8, Math.min(top, vh - popRect.height - 8));
    left = Math.max(8, Math.min(left, vw - popRect.width - 8));

    setStyle({ top, left });
  }, [coords, content, popEl]);

  if (!content) return null;

  return createPortal(
    <div
      ref={popRef}
      className={`fishbones-popover fishbones-popover--${content.kind}`}
      style={{
        // Park far offscreen on first paint (before we've measured) so
        // the popover never flashes in the wrong spot.
        top: style?.top ?? -9999,
        left: style?.left ?? -9999,
        opacity: style ? 1 : 0,
        pointerEvents: style ? "auto" : "none",
      }}
      role="tooltip"
      onMouseEnter={onPopoverEnter}
      onMouseLeave={onPopoverLeave}
    >
      <div className="fishbones-popover-heading">{content.heading}</div>
      {content.signature && (
        <div className="fishbones-popover-signature">{content.signature}</div>
      )}
      <div className="fishbones-popover-body">{content.body}</div>
      {content.docUrl && onOpenDoc && (
        <button
          type="button"
          className="fishbones-popover-doclink"
          onClick={() => onOpenDoc(content.docUrl!)}
        >
          View full docs
          <span className="fishbones-popover-doclink-icon" aria-hidden>
            <Icon icon={externalLink} size="xs" color="currentColor" />
          </span>
        </button>
      )}
    </div>,
    document.body,
  );
}
