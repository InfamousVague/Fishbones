import "./FishbonesLoader.css";

interface Props {
  /// Visible text under the spinner. Pass an empty string (or omit) to
  /// hide the label when the loader sits inside a compact surface like a
  /// book-cover overlay.
  label?: string;
  /// Size preset. `md` (default) matches the bootloader + OutputPane
  /// size. `sm` is the compact size used in book-cover overlays.
  size?: "sm" | "md";
}

/// The shared Fishbones spinner — a theme-tinted fish-bone logo pulsing
/// inside a rotating ring. Used by the app bootloader, the OutputPane
/// "running…" state, and the per-book library hydration overlay so all
/// three speak the same visual vocabulary.
export default function FishbonesLoader({ label, size = "md" }: Props) {
  return (
    <div className={`fishbones-loader fishbones-loader--${size}`} role="status">
      <div className="fishbones-loader-stack" aria-hidden>
        <div className="fishbones-loader-ring" />
        <div className="fishbones-loader-logo" />
      </div>
      {label && <div className="fishbones-loader-label">{label}</div>}
    </div>
  );
}
