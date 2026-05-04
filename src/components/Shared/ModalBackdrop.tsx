import { type ReactNode, type MouseEvent } from "react";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import "./ModalBackdrop.css";

interface Props {
  /// Click-on-backdrop OR Escape-key callback. The two are wired
  /// together because every dialog in the app treats them as
  /// equivalent dismiss signals — separating them was always a
  /// footgun (one path closed cleanly, the other left state behind).
  onDismiss: () => void;
  /// Stacking order. Defaults to `100` (the Fishbones dialog tier).
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
/// (`<div className="fishbones-X-backdrop" onClick={onCancel}>...`)
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

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const cls = className ? `fb-modal-backdrop ${className}` : "fb-modal-backdrop";
  return (
    <div className={cls} style={{ zIndex }} onClick={onDismiss}>
      <div className="fb-modal-backdrop__panel" onClick={stop}>
        {children}
      </div>
    </div>
  );
}
