import "./LoadingScreen.css";
import HalftoneCanvas from "@/components/atoms/HalftoneCanvas/HalftoneCanvas";

interface LoadingScreenProps {
  /// Status line under the mark (e.g. "Checking for updates…"). Omit for none.
  status?: string | null;
  /// 0–1 determinate progress, or null/undefined for the indeterminate sweep.
  progress?: number | null;
  /// When true, hide the spinning mark and ALWAYS show the progress bar
  /// (indeterminate sweep while `progress` is null, determinate fill once it
  /// lands). The updater screen uses this — it's just a progress bar, no
  /// spinner competing with it.
  progressOnly?: boolean;
}

/// The branded boot / updater loading screen — ported from GhostWire's
/// `LoadingScreen`. A calm dark panel with the corner halftone-dot splash, a
/// soft accent aura, the spinning ribbon-snake mark, and a slim progress bar
/// (determinate fill or indeterminate sweep) + status line. Used as the body
/// of `.libre__bootloader` so the app boot and the pre-launch update fetcher
/// (see `usePrelaunchUpdate`) share one surface. Fills its positioned parent.
export default function LoadingScreen({
  status,
  progress,
  progressOnly = false,
}: LoadingScreenProps) {
  const pct =
    typeof progress === "number" ? Math.max(0, Math.min(1, progress)) : null;
  // The bar shows for any determinate progress, and always in progressOnly
  // (updater) mode — indeterminate sweep until the percentage lands.
  const showBar = progressOnly || pct !== null;
  const indeterminate = pct === null;
  return (
    <div className="libre-loadscreen" role="status" aria-label="Loading Libre">
      <HalftoneCanvas
        className="libre-loadscreen-halftone"
        maxR={1.3}
        minR={0.18}
        spacing={9}
      />
      <div className="libre-loadscreen-glow" aria-hidden />
      <div className="libre-loadscreen-body">
        {/* Spinner on a normal boot only. The updater screen (progressOnly)
            shows just the progress bar — no spinner competing with it. */}
        {progressOnly ? null : (
          <div className="libre-loadscreen-mark" aria-hidden />
        )}
        {showBar ? (
          <div
            className={`libre-loadscreen-bar${
              indeterminate ? " is-indeterminate" : ""
            }`}
          >
            <div
              className="libre-loadscreen-bar-fill"
              style={indeterminate ? undefined : { width: `${Math.round(pct! * 100)}%` }}
            />
          </div>
        ) : null}
        {status ? <div className="libre-loadscreen-status">{status}</div> : null}
      </div>
    </div>
  );
}
