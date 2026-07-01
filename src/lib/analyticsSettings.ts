/// Persisted opt-out for product analytics — the ONE source of truth
/// for "is the user OK with anonymous usage analytics".
///
/// Model: OPT-OUT. Analytics are ON by default (web + desktop); this
/// module stores the user's choice to turn them OFF. Plausible is
/// cookieless and doesn't fingerprint, so the data is anonymous — but
/// the desktop app is marketed as privacy-respecting, so we (a) always
/// offer a one-click off switch in Settings → Privacy and (b) show a
/// one-time first-run notice.
///
/// This module has NO side effects and does NOT import the analytics
/// engine, so the Settings pane + the `track.ts` cheap-gate can read
/// the flag without pulling in the script-injection / fetch code.

/// localStorage key. Absent = analytics enabled (opt-out default). Set
/// to "1" only when the user has explicitly opted OUT.
const OPT_OUT_KEY = "libre.analytics.optOut";

/// Latch for the one-time first-run disclosure.
const NOTICE_KEY = "libre.analytics.noticeSeen";

/// Fired on `window` whenever the opt-out flag flips, so the engine can
/// stop/clear (or resume) and any settings UI can re-render. Mirrors
/// the `libre:haptic-*-changed` convention.
export const ANALYTICS_CHANGED_EVENT = "libre:analytics-changed";

/// Whether analytics are currently enabled. Defaults to `true`
/// (opt-out) — including when storage is unavailable, since a blocked
/// localStorage shouldn't silently flip a user's explicit opt-out
/// (they can't have opted out if they can't persist it, so ON is the
/// documented default state).
export function readAnalyticsEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== "1";
  } catch {
    return true;
  }
}

/// Flip the opt-out flag and broadcast the change. `enabled = false`
/// records the opt-out; `enabled = true` clears it. The engine listens
/// for `ANALYTICS_CHANGED_EVENT` to drop its queue on opt-out or resume
/// flushing on opt-in.
export function setAnalyticsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(OPT_OUT_KEY);
    else localStorage.setItem(OPT_OUT_KEY, "1");
  } catch {
    /* storage blocked — nothing to persist, still broadcast below */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(ANALYTICS_CHANGED_EVENT, { detail: { enabled } }),
    );
  } catch {
    /* no window (SSR/tests) — harmless */
  }
}

/// Has the first-run analytics notice been shown yet? Defaults to
/// `true` (i.e. "already seen", so we DON'T show it) when storage is
/// unavailable — a surface that can't persist the latch shouldn't
/// nag on every launch.
export function analyticsNoticeSeen(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return true;
  }
}

/// Latch the first-run notice so it never shows again.
export function markAnalyticsNoticeSeen(): void {
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* ignore */
  }
}
