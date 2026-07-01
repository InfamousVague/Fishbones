import { useEffect, useRef } from "react";

/// Declarative `setTimeout`. Fires `callback` once after `delay` ms; pass
/// `delay = null` to disable, or change `delay` to restart the timer. The
/// callback is held in a ref so re-renders don't restart it, and the timer is
/// cleared on unmount — companion to `useInterval`, replacing the one-shot
/// setTimeout + cleanup repeated across AppToast, InstallBanner, TipDropdown,
/// AiPane, VerifyCourseOverlay, ….
export function useTimeout(callback: () => void, delay: number | null): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = window.setTimeout(() => saved.current(), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
}
