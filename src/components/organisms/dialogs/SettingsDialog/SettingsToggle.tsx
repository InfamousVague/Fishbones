/// Pill-shaped switch toggle. Adapted from the Cipher settings
/// pattern — a 38×22px button with a 18×18 knob that slides
/// between off (muted track) and on (accent-coloured track) via
/// CSS transitions. Used inside `SettingsRow` as the right-hand
/// control for boolean preferences.
///
/// Stateless on its own — pass `checked` + `onChange` to wire it
/// into a parent's controlled state. The button carries
/// `role="switch"` + `aria-checked` so screen readers report it
/// as a toggle, not a generic button.

import { haptics } from "@/lib/haptics";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /// Accessibility label — shown to screen readers + used as the
  /// title attribute for pointer users on hover. The visible
  /// label lives in the parent `SettingsRow`'s body slot, not on
  /// the toggle itself.
  label: string;
  disabled?: boolean;
}

export default function SettingsToggle({
  checked,
  onChange,
  label,
  disabled,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={
        "libre-settings-switch" +
        (checked ? " libre-settings-switch--on" : "")
      }
      onClick={() => {
        // Selection haptic on every toggle flip. Centralised here
        // so the dozens of settings rows (and any other consumer
        // that uses this component) get the buzz for free, with
        // no per-call wiring required. The fire-before-onChange
        // order matters: even if the parent's onChange throws
        // synchronously, the user's tap still felt registered.
        void haptics.selection();
        onChange(!checked);
      }}
    />
  );
}
