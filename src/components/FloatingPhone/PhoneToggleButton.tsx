import { Icon } from "@base/primitives/icon";
import { smartphone } from "@base/primitives/icon/icons/smartphone";
import "@base/primitives/icon/icon.css";
import "./PhoneToggleButton.css";

interface PhoneToggleButtonProps {
  /// Called when the user clicks the button — the parent should
  /// re-open the phone popout window via `lib/phonePopout.ts`.
  onShow: () => void;
}

/// Small floating round button that re-opens the phone popout window
/// after it's been closed. Lives in the bottom-right corner just
/// above the AI orb (which sits at right: 20px / bottom: 20px), so
/// the two coexist as a small stack without overlapping.
export default function PhoneToggleButton({ onShow }: PhoneToggleButtonProps) {
  return (
    <button
      type="button"
      className="fishbones-phone-toggle-button"
      onClick={onShow}
      aria-label="Show phone simulator"
      title="Show phone simulator"
    >
      <Icon icon={smartphone} size="sm" color="currentColor" />
    </button>
  );
}
