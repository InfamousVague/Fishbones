/// A single setting row — icon chip on the left, label + sub-text
/// in the middle, control on the right (toggle / select / button /
/// value). Lives inside a `SettingsCard`; multiple rows in the
/// same card auto-separate with a hairline border between them via
/// `:not(:first-child)` in CSS.
///
/// Adapted from the Cipher settings pattern. The 3-column grid
/// (icon | body | control) keeps every row visually aligned
/// regardless of how long the sub-text is — sub-text wraps inside
/// the body column rather than pushing the control off the right.

import { Icon } from "@base/primitives/icon";
import type { ReactNode } from "react";

interface Props {
  /// Lucide-style icon path string (imported from
  /// `@base/primitives/icon/icons/...`). Goes in the icon chip on
  /// the left. Optional — rows without an icon get a narrower
  /// 2-column layout via `--no-icon`.
  icon?: string;
  /// Tone of the icon chip:
  ///   "default" — neutral chip background, secondary-text icon
  ///   "accent"  — accent-soft background, accent-coloured icon
  ///   "danger"  — danger-soft background, danger-coloured icon
  ///                (also tints the label red — for destructive
  ///                affordances like "Delete account")
  tone?: "default" | "accent" | "danger";
  /// Primary label, e.g. "Desktop notifications". Required.
  label: ReactNode;
  /// Secondary explanatory line under the label. Optional — rows
  /// without sub-text just show the label.
  sub?: ReactNode;
  /// Right-hand control. Pass a `SettingsToggle`, a `<select>`, a
  /// button, or any custom widget. The grid cell sizes to the
  /// content's natural width.
  control?: ReactNode;
  /// When set, the whole row becomes clickable. Useful for
  /// "drill in" affordances where the entire row should trigger
  /// the action (not just the control). Mutually exclusive with
  /// `control` semantically — a clickable row with a control
  /// inside creates conflicting hit targets.
  onClick?: () => void;
}

export default function SettingsRow({
  icon,
  tone = "default",
  label,
  sub,
  control,
  onClick,
}: Props) {
  const className =
    "libre-settings-row" +
    (tone !== "default" ? ` libre-settings-row--${tone}` : "") +
    (onClick ? " libre-settings-row--clickable" : "") +
    (!icon ? " libre-settings-row--no-icon" : "");

  const inner = (
    <>
      {icon && (
        <span className="libre-settings-row__icon" aria-hidden>
          <Icon icon={icon} size="lg" color="currentColor" />
        </span>
      )}
      <span className="libre-settings-row__body">
        <span className="libre-settings-row__label">{label}</span>
        {sub && <span className="libre-settings-row__sub">{sub}</span>}
      </span>
      {control && <span className="libre-settings-row__control">{control}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}
