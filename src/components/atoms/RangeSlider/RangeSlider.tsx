import { type CSSProperties, type InputHTMLAttributes } from "react";
import "./RangeSlider.css";

/// Shared range input with a FILLED leading track — the part of the rail
/// left of the thumb paints in the accent color so the current level is
/// visible at a glance (native WebKit range inputs only paint the thumb;
/// the rail reads as empty, which is what every settings slider used to
/// look like).
///
/// Drop-in replacement for `<input type="range">`: forwards every input
/// prop; keep passing the existing site class via `className` for sizing
/// (width/margins) — the atom owns appearance (track + thumb + fill).
///
/// The fill is a CSS custom property (`--libre-range-fill`) recomputed on
/// every render from value/min/max, so controlled inputs stay correct
/// without listeners.
export default function RangeSlider(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  const { className = "", style, value, min = 0, max = 100, ...rest } = props;
  const lo = Number(min);
  const hi = Number(max);
  const v = Number(value);
  const fill =
    Number.isFinite(v) && hi > lo
      ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))
      : 0;
  return (
    <input
      type="range"
      className={`libre-range ${className}`.trim()}
      style={{ ...style, "--libre-range-fill": `${fill}%` } as CSSProperties}
      value={value}
      min={min}
      max={max}
      {...rest}
    />
  );
}
