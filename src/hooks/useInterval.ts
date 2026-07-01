import { useEffect, useRef } from "react";

/// Declarative `setInterval` (the Dan-Abramov pattern). Runs `callback` every
/// `delay` ms while mounted; pass `delay = null` to pause without unmounting.
/// The callback is held in a ref so changing it (a fresh closure each render)
/// doesn't reset the timer, and the interval is cleared on unmount — removing
/// the hand-rolled setInterval + cleanup repeated across UpdateBanner,
/// QrScanner, OutputPane, SvmDock, StatsBar, Tour, FloatingIngestPanel, ….
export function useInterval(callback: () => void, delay: number | null): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}
