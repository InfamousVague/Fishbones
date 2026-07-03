import { useEffect, useState } from "react";
import {
  readLeaderboardEnabled,
  setLeaderboardEnabled as persistLeaderboardEnabled,
  LEADERBOARD_CHANGED_EVENT,
} from "@/lib/leaderboardSettings";

/// Reactive view of the leaderboard opt-out for the Settings → Privacy toggle
/// (and the onboarding wizard). Returns the current `enabled` state plus a
/// setter that persists the choice and broadcasts it, so the stats-publish
/// effect stops/resumes and any other open surface re-renders.
///
/// Mirrors `useAnalyticsSetting` — listens for both the in-process
/// `LEADERBOARD_CHANGED_EVENT` and the cross-window `storage` event so the
/// toggle stays in sync across a main window + a popout.
export function useLeaderboardSetting(): {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
} {
  const [enabled, setEnabled] = useState(() => readLeaderboardEnabled());
  useEffect(() => {
    const refresh = () => setEnabled(readLeaderboardEnabled());
    window.addEventListener(LEADERBOARD_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LEADERBOARD_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return { enabled, setEnabled: persistLeaderboardEnabled };
}
