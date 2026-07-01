import { useEffect, useState } from "react";
import {
  readAnalyticsEnabled,
  setAnalyticsEnabled as persistAnalyticsEnabled,
  ANALYTICS_CHANGED_EVENT,
} from "@/lib/analyticsSettings";

/// Reactive view of the analytics opt-out for the Settings → Privacy
/// toggle (and the first-run notice). Returns the current `enabled`
/// state plus a setter that persists the choice and broadcasts it, so
/// the analytics engine can react (drop its queue on opt-out, resume on
/// opt-in) and any other open surface re-renders.
///
/// Listens for both the in-process `ANALYTICS_CHANGED_EVENT` and the
/// cross-window `storage` event, so flipping the toggle in the main
/// window updates a Settings dialog open in a popout and vice-versa.
export function useAnalyticsSetting(): {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
} {
  const [enabled, setEnabled] = useState(() => readAnalyticsEnabled());
  useEffect(() => {
    const refresh = () => setEnabled(readAnalyticsEnabled());
    window.addEventListener(ANALYTICS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ANALYTICS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return { enabled, setEnabled: persistAnalyticsEnabled };
}
