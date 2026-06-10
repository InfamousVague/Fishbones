import { type ReactNode, type MouseEvent, useEffect } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { fireHaptic } from "../../lib/haptics";
import "./ModalBackdrop.css";

interface Props {
  /// Click-on-backdrop OR Escape-key callback. The two are wired
  /// together because every dialog in the app treats them as
  /// equivalent dismiss signals — separating them was always a
  /// footgun (one path closed cleanly, the other left state behind).
  onDismiss: () => void;
  /// Stacking order. Defaults to `100` (the Libre dialog tier).
  /// Override for nested or higher-priority surfaces (the catalog
  /// modal, install banner overlay, etc.).
  zIndex?: number;
  /// Skip the Escape-key listener. Useful for nested modals where
  /// the parent already owns the Escape behaviour.
  closeOnEscape?: boolean;
  /// Inner panel. Click events on the children DO NOT bubble to
  /// `onDismiss` — that's handled by the wrapper here.
  children: ReactNode;
  /// Optional extra class on the backdrop element. Used for
  /// surface-specific styling (e.g. mobile bottom-sheet treatment
  /// on SignInDialog where the backdrop centers content at the
  /// bottom of the viewport instead of the middle).
  className?: string;
}

/// Standard fixed-position backdrop with blur, click-to-dismiss, and
/// Escape-to-dismiss. Replaces the boilerplate that lived in 9
/// different dialog components — every one of them did the same thing
/// (`<div className="libre-X-backdrop" onClick={onCancel}>...`)
/// with subtly different `--X--` slugs.
///
/// Children should be the dialog panel itself. Click events on the
/// panel are stopped here so the backdrop click only fires when the
/// user actually clicks the dimmed margin, not when they click inside
/// the dialog.
export default function ModalBackdrop({
  onDismiss,
  zIndex = 100,
  closeOnEscape = true,
  className,
  children,
}: Props) {
  useEscapeKey(onDismiss, closeOnEscape);

  // Light impact on every modal MOUNT. Centralised here so every
  // dialog in the app (sign-in, course settings, achievement
  // unlock modal, etc.) gets a uniform "something just opened"
  // tactile cue without having to wire haptics per consumer.
  // Skips the haptic if the modal opens immediately on app
  // launch — the throttle in the engine handles repeated mounts.
  useEffect(() => {
    void fireHaptic("impact-light");
  }, []);

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const cls = className ? `libre-modal-backdrop ${className}` : "libre-modal-backdrop";

  // Portal to `document.body` so the backdrop ALWAYS occupies the
  // full viewport. CSS `position: fixed` is normally relative to
  // the viewport, but an ancestor with `transform`, `filter`,
  // `backdrop-filter`, or `will-change: transform` creates a new
  // containing block — and the fixed element becomes anchored to
  // THAT ancestor instead. The sandbox sidebar has at least one
  // such ancestor in the chain (the main rail uses `backdrop-
  // filter` for its frosted-glass surface; popout windows use
  // transformed wrappers for slide-in transitions). Portaling to
  // body sidesteps all of those.
  if (typeof document === "undefined") {
    // SSR / test fallback — render inline. There's no portal
    // target in those environments anyway.
    return (
      <div className={cls} style={{ zIndex }} onClick={onDismiss}>
        <div className="libre-modal-backdrop__panel" onClick={stop}>
          {children}
        </div>
      </div>
    );
  }
  return createPortal(
    <div className={cls} style={{ zIndex }} onClick={onDismiss}>
      <div className="libre-modal-backdrop__panel" onClick={stop}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
