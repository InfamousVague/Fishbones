/// Unified skeleton-placeholder primitive.
///
/// Before this existed the app spoke two loading dialects — the
/// `LibreLoader` spinner and "nothing / pop-in" — plus a single
/// orphaned skeleton on mobile (`MobileReader`). This consolidates
/// the placeholder vocabulary into one shimmer block so every
/// content surface that waits on data can reserve its space and
/// shimmer instead of flashing empty then snapping in.
///
/// Decision rule (keep this consistent across the app):
///   - Content panes that wait on data  → Skeleton (this).
///   - Transient user actions (run / install / send / probe) →
///     `LibreLoader` (the spinner stays correct there).
///   - App boot → the existing full-screen bootloader.
///
/// The shimmer keyframe is namespaced `libre-skeleton-shimmer` to
/// avoid colliding with the decorative holographic `*-shimmer`
/// keyframes used by certificates / achievements (those are reward
/// effects, not loading states). Honors `prefers-reduced-motion`.

import "./Skeleton.css";

type SkeletonVariant = "line" | "block" | "circle" | "card" | "ticket";

interface SkeletonProps {
  variant?: SkeletonVariant;
  /// CSS length; defaults to 100% (block/line) or the variant's
  /// intrinsic size (card/ticket/circle).
  width?: string;
  height?: string;
  className?: string;
  style?: React.CSSProperties;
}

/// A single shimmer block. Presentational only — the *container*
/// that swaps skeleton↔content should own `aria-busy`, so this is
/// `aria-hidden`.
export function Skeleton({
  variant = "block",
  width,
  height,
  className = "",
  style,
}: SkeletonProps) {
  return (
    <span
      className={`libre-skeleton libre-skeleton--${variant} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden
    />
  );
}

/// N text lines with a short final line — mirrors the original
/// MobileReader skeleton so the lesson body reads as "prose is
/// coming" rather than a blank gap.
export function SkeletonText({
  lines = 4,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={`libre-skeleton-text ${className}`}
      aria-busy="true"
      aria-hidden
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="line"
          className={i === lines - 1 ? "libre-skeleton--short" : ""}
        />
      ))}
    </div>
  );
}

/// Book-cover-shaped placeholder (2/3 aspect) for the library /
/// discover grid. Rendered inside the SAME grid container as real
/// cards so the columns line up exactly → zero layout shift when
/// the real covers replace the placeholders.
export function SkeletonCard({
  variant = "card",
  className = "",
}: {
  variant?: "card" | "ticket";
  className?: string;
}) {
  return <Skeleton variant={variant} className={className} />;
}

/// Convenience: a run of N skeleton cards for grids. `count`
/// defaults to a shelf-ful; pass the last-known course count for an
/// even tighter match.
export function SkeletonCardGrid({
  count = 8,
  variant = "card",
}: {
  count?: number;
  variant?: "card" | "ticket";
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </>
  );
}
