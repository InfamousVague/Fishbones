import { useState } from "react";
import { isDesktop } from "@/lib/platform";
import {
  readAnalyticsEnabled,
  analyticsNoticeSeen,
  markAnalyticsNoticeSeen,
} from "@/lib/analyticsSettings";
import { useT } from "@/i18n/i18n";
import "./AnalyticsNotice.css";

/// First-run analytics disclosure strip. Analytics default ON (opt-out
/// model — see `analyticsSettings.ts`), so honesty requires telling the
/// learner once that anonymous, cookieless usage data is being shared
/// and pointing them at the off switch in Settings.
///
/// Mounted by App.tsx directly under the TopBar (a `flex-shrink: 0` row
/// inside `.libre`, so it pushes the body down rather than overlapping
/// it). Shown ONLY when all three hold:
///   - desktop build (`isDesktop`) — the web build has its own
///     hosted-site disclosure; iOS ships analytics off,
///   - analytics are currently enabled (`readAnalyticsEnabled()`) — no
///     point disclosing a thing the user already turned off,
///   - the one-time notice hasn't been acknowledged yet
///     (`!analyticsNoticeSeen()`).
///
/// Dismiss latches `markAnalyticsNoticeSeen()` so it never re-shows.
/// `role="status"` so assistive tech announces it as a passive
/// notification rather than an alert.

/// Self-contained bar-chart glyph so the strip doesn't depend on a
/// particular base-kit icon existing. Inherits the icon text colour.
function AnalyticsGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
      <path
        d="M2.5 13.5h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M4.5 13V9.5M8 13V5M11.5 13V7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AnalyticsNotice() {
  const t = useT();
  // Resolve the show gate once at mount. All three inputs are stable
  // for the lifetime of a launch — `isDesktop` is build-time, and the
  // stored flags don't change under us while the app is open (the only
  // writer, dismiss below, also flips `visible`).
  const [visible, setVisible] = useState(
    () => isDesktop && readAnalyticsEnabled() && !analyticsNoticeSeen(),
  );

  if (!visible) return null;

  const dismiss = () => {
    markAnalyticsNoticeSeen();
    setVisible(false);
  };

  return (
    <aside
      className="libre-analytics-notice"
      role="status"
      aria-label={t("settings.analyticsFirstRun")}
    >
      <span className="libre-analytics-notice__icon">
        <AnalyticsGlyph />
      </span>

      <p className="libre-analytics-notice__text">
        {t("settings.analyticsFirstRun")}
      </p>

      <div className="libre-analytics-notice__actions">
        <button
          type="button"
          className="libre-analytics-notice__dismiss"
          onClick={dismiss}
        >
          {t("settings.analyticsNoticeDismiss")}
        </button>
      </div>
    </aside>
  );
}
