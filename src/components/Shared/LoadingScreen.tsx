import "./LoadingScreen.css";
import HalftoneCanvas from "./HalftoneCanvas";

interface LoadingScreenProps {
  /// Status line under the mark (e.g. "Checking for updates…"). Omit for none.
  status?: string | null;
  /// 0–1 determinate progress, or null/undefined for the indeterminate sweep.
  progress?: number | null;
}

/// The branded boot / updater loading screen — ported from GhostWire's
/// `LoadingScreen`. A calm dark panel with the corner halftone-dot splash, a
/// soft accent aura, the spinning ribbon-snake mark, and a slim progress bar
/// (determinate fill or indeterminate sweep) + status line. Used as the body
/// of `.libre__bootloader` so the app boot and the pre-launch update fetcher
/// (see `usePrelaunchUpdate`) share one surface. Fills its positioned parent.
export default function LoadingScreen({ status, progress }: LoadingScreenProps) {
  const pct =
    typeof progress === "number" ? Math.max(0, Math.min(1, progress)) : null;
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
        <div className="libre-loadscreen-mark" aria-hidden />
        <div
          className={`libre-loadscreen-bar${pct === null ? " is-indeterminate" : ""}`}
        >
          <div
            className="libre-loadscreen-bar-fill"
            style={pct === null ? undefined : { width: `${Math.round(pct * 100)}%` }}
          />
        </div>
        {status ? <div className="libre-loadscreen-status">{status}</div> : null}
      </div>
    </div>
  );
}
