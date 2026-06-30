/// 3-option (or 2-, or N-) segmented pill control. Adapted from
/// the Cipher settings idiom — used inline as a `SettingsRow`
/// control for enumerated choices that are small enough to
/// surface every option at once (Mode: Light/Dark/System,
/// Density: Compact/Cozy/Spacious, etc.).
///
/// Pure controlled component — pass `value` + `onChange`. The
/// inner button list is rendered with `role="radiogroup"` so
/// screen readers describe it as "one of N" rather than as a row
/// of unrelated buttons.

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (next: T) => void;
  /// Optional ARIA label for the whole group. Defaults to
  /// "Select an option" which is fine for context-rich rows
  /// where the label is already in the row's body slot.
  label?: string;
}

export default function SettingsSegmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label ?? "Select an option"}
      className="libre-settings-segmented"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={
              "libre-settings-segmented__btn" +
              (active ? " libre-settings-segmented__btn--active" : "")
            }
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
