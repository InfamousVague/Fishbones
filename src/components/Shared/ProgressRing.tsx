/// Inline SVG circular progress ring. `progress` is 0–1; sweeps counter-
/// clockwise from 12 o'clock (the standard "how full is my level" visual
/// metaphor). Center `label` is shown inside; optional `sublabel` below
/// for the bigger hero variant. Track and fill colors inherit from CSS
/// via the classes below, so theming works without prop plumbing.
///
/// Extracted from TopBar.tsx so the Profile view can reuse the same ring
/// at a larger size without duplicating the SVG math.
///
/// **100% behavior**: when `progress >= 1`, the label text is replaced
/// with a centered white checkmark glyph. The ring itself stays
/// fully filled (the same circle-with-dashoffset machinery, just at
/// 0 offset). Override with `hideCheckOnComplete` for the rare
/// surfaces (e.g. the Profile XP-to-next-level ring) where "100%"
/// is a transient state and the number is more useful than a tick.

import "./ProgressRing.css";

export function ProgressRing({
  progress,
  size,
  stroke,
  label,
  sublabel,
  labelScale,
  hideCheckOnComplete = false,
}: {
  progress: number;
  size: number;
  stroke: number;
  label: string;
  sublabel?: string;
  /// Multiplier for the inner label font. Defaults to 1 — the topbar chip
  /// variant keeps that. The Profile hero bumps this up so the level
  /// number reads at a glance inside a 120px ring.
  labelScale?: number;
  /// Opt-out for surfaces where the number is the point and 100% is
  /// just a step on the way to the next level. Defaults to false:
  /// course-completion rings (the common case) get the checkmark.
  hideCheckOnComplete?: boolean;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    circumference * (1 - Math.max(0, Math.min(1, progress)));
  const isComplete = progress >= 1 && !hideCheckOnComplete;
  // Sized in stroke units so the tick scales with the ring. The
  // viewBox coords are in pixels matching `size`, so this gives a
  // chunky-but-not-overpowering checkmark at every ring size from
  // 16px (sidebar) to 120px (Profile hero).
  const checkSize = Math.max(size * 0.55, stroke * 3);
  return (
    <span
      className={`fishbones__progress-ring ${
        isComplete ? "fishbones__progress-ring--complete" : ""
      }`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="fishbones__progress-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="fishbones__progress-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          // Rotate -90deg so 0% starts at 12 o'clock, not 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {isComplete && (
          // Inline SVG checkmark — drawn rather than imported as an
          // icon so it inherits the ring's currentColor (matches the
          // fill stroke) and scales perfectly with `size`. Path is a
          // 24x24 reference glyph stretched into `checkSize` via the
          // outer transform.
          <g
            className="fishbones__progress-ring-check"
            transform={`translate(${(size - checkSize) / 2}, ${
              (size - checkSize) / 2
            }) scale(${checkSize / 24})`}
          >
            <path
              d="M5 12 L10 17 L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth={Math.max(2, stroke * 0.9)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>
      {!isComplete && (
        <span
          className="fishbones__progress-ring-label"
          style={
            labelScale && labelScale !== 1
              ? { fontSize: `${11 * labelScale}px` }
              : undefined
          }
        >
          {label}
          {sublabel && (
            <span
              className="fishbones__progress-ring-sublabel"
              style={
                labelScale && labelScale !== 1
                  ? { fontSize: `${9 * Math.min(labelScale, 1.6)}px` }
                  : undefined
              }
            >
              {sublabel}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
