import "./LoadingScreen.css";
import HalftoneCanvas from "@/components/atoms/HalftoneCanvas/HalftoneCanvas";
import { ProgressRing } from "@/components/atoms/ProgressRing/ProgressRing";

interface LoadingScreenProps {
  /// Status line under the indicator (e.g. "Checking for updates…"). Omit for none.
  status?: string | null;
  /// 0–1 determinate progress (an update download), or null/undefined for the
  /// normal indeterminate boot.
  progress?: number | null;
}

/// The branded boot / updater loading screen. Indeterminate (a normal boot or
/// the "checking for updates" beat) shows the spinning brand ring. Determinate
/// (an update download reporting progress) swaps to a circular progress ring
/// filling 0→100% — no linear bar. Used as the body of `.libre__bootloader`
/// and of the pre-launch splash window, so both share one surface.
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
        {pct === null ? (
          // Boot / checking: the spinning brand ring.
          <div className="libre-loadscreen-mark" aria-hidden />
        ) : (
          // Update download: a determinate circular progress ring.
          <div className="libre-loadscreen-ring">
            <ProgressRing
              progress={pct}
              size={96}
              stroke={8}
              label={`${Math.round(pct * 100)}%`}
              color="var(--gg-accent)"
            />
          </div>
        )}
        {status ? <div className="libre-loadscreen-status">{status}</div> : null}
      </div>
    </div>
  );
}
