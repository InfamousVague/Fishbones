import { useEffect, useState, type ReactNode } from "react";
import FishbonesLoader from "./FishbonesLoader";
import "./DeferredMount.css";

/// Two-phase mount: renders `fallback` on first paint, then swaps to
/// `children` after one animation frame. Buys us instant visual
/// feedback for navigation actions whose real content is expensive to
/// mount (library grid with N cover IPCs, etc.) without any React
/// concurrent-mode wiring.
///
/// Keyed renders: pass a distinct `phase` prop when the same loader
/// should re-trigger (e.g. user clicks Library → navigates away →
/// clicks Library again). The component resets to fallback whenever
/// `phase` changes.
export function DeferredMount({
  fallback,
  children,
  phase,
}: {
  fallback: ReactNode;
  children: ReactNode;
  phase?: string | number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  return ready ? <>{children}</> : <>{fallback}</>;
}

/// Centered "Loading <label>…" card. Used as the `fallback` for
/// DeferredMount on the main pane. Uses the shared FishbonesLoader so
/// this pane speaks the same visual vocabulary as the boot overlay and
/// the OutputPane's "running…" state.
export function LoadingPane({ label }: { label: string }) {
  return (
    <div className="fishbones-loading-pane">
      <FishbonesLoader label={label} />
    </div>
  );
}
