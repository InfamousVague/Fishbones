/// Persisted opt-out for leaderboard participation — the source of truth for
/// "is the user OK with their stats appearing on the Friends + Global
/// leaderboards".
///
/// Model: OPT-OUT (mirrors analyticsSettings.ts). Participation is ON by
/// default; this stores the user's choice to turn it OFF. When opted out, the
/// client stops PUBLISHING the user's aggregate stats (XP / streak / lessons /
/// level) to the relay — their own progress still syncs across devices, they
/// simply don't appear on any leaderboard. The relay never receives a snapshot
/// to rank while opted out, so this is a real privacy gate, not just a UI hide.
///
/// No side effects, no imports of the cloud/sync code — the App-level publish
/// effect + any settings UI can read the flag cheaply.

/// localStorage key. Absent = participating (opt-out default). Set to "1" only
/// when the user has explicitly opted OUT.
const OPT_OUT_KEY = "libre:leaderboard:optOut";

/// Fired on `window` whenever the opt-out flag flips so any settings UI can
/// re-render. Mirrors the `libre:analytics-changed` convention.
export const LEADERBOARD_CHANGED_EVENT = "libre:leaderboard-changed";

/// Whether leaderboard participation is currently enabled. Defaults to `true`
/// (opt-out) — including when storage is unavailable, since a blocked
/// localStorage shouldn't silently flip a user's explicit opt-out.
export function readLeaderboardEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== "1";
  } catch {
    return true;
  }
}

/// Flip the opt-out flag and broadcast. `enabled = false` records the opt-out
/// (stops publishing); `enabled = true` clears it (resumes on the next stats
/// change).
export function setLeaderboardEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(OPT_OUT_KEY);
    else localStorage.setItem(OPT_OUT_KEY, "1");
  } catch {
    /* storage blocked — nothing to persist, still broadcast below */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(LEADERBOARD_CHANGED_EVENT, { detail: { enabled } }),
    );
  } catch {
    /* no window (SSR/tests) — harmless */
  }
}
