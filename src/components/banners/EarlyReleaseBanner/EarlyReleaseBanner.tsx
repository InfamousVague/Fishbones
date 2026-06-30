import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { heart } from "@base/primitives/icon/icons/heart";
import "@base/primitives/icon/icon.css";
import { openExternal } from "../../../lib/openExternal";
import { useT } from "../../../i18n/i18n";
import "./EarlyReleaseBanner.css";

/// Early-release notice strip, mounted by App.tsx directly under the
/// TopBar (a `flex-shrink: 0` row inside `.libre`, so it pushes the
/// body down rather than overlapping it). Sets expectations honestly —
/// some art / audio / lesson copy is still placeholder or AI-generated
/// while we're in early release — and turns that into a soft support
/// ask: the money is what lets us replace the placeholders with work
/// from real artists, narrators, and teachers.
///
/// Dismissable, but re-surfaces after a week (timestamp in
/// localStorage) so the support message recirculates during early
/// release without nagging anyone who clicks it away. The "Support us"
/// button opens the marketing site's /support page (the full crypto
/// deck + supporter wall) via `openExternal`, so the desktop WebView
/// hands off to the OS browser instead of trapping the user.

const STORAGE_KEY = "libre:early-release-banner-dismissed-at";
/// Re-show after a week so the support message keeps circulating while
/// we're in early release — short enough to stay visible, long enough
/// not to nag.
const RESHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SUPPORT_URL = "https://libre.academy/support";

function dismissedRecently(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const at = parseInt(raw, 10);
    return Number.isFinite(at) && Date.now() - at < RESHOW_AFTER_MS;
  } catch {
    // localStorage can throw in private mode — just show the banner.
    return false;
  }
}

/// Self-contained beaker glyph so the badge doesn't depend on a
/// particular base-kit icon existing. Inherits the badge text colour.
function BeakerGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <path
        d="M6.2 1.8h3.6M6.8 2.2v3.4L3.4 11a1.6 1.6 0 0 0 1.4 2.4h6.4A1.6 1.6 0 0 0 12.6 11L9.2 5.6V2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.1 8.7h5.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EarlyReleaseBanner() {
  const t = useT();
  const [visible, setVisible] = useState(() => !dismissedRecently());

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Soft fail — the in-memory dismiss already hid the banner.
    }
  };

  return (
    <aside
      className="libre-early-banner"
      role="complementary"
      aria-label={t("banners.earlyAria")}
    >
      <span className="libre-early-banner__badge">
        <BeakerGlyph />
        {t("banners.earlyTag")}
      </span>

      <p className="libre-early-banner__text">
        <span className="libre-early-banner__warn">{t("banners.earlyWarn")}</span>{" "}
        <span className="libre-early-banner__support">
          {t("banners.earlySupport")}
        </span>
      </p>

      <div className="libre-early-banner__actions">
        <button
          type="button"
          className="libre-early-banner__cta"
          onClick={() => void openExternal(SUPPORT_URL)}
        >
          <Icon icon={heart} size="xs" color="currentColor" />
          {t("banners.earlyCta")}
        </button>
        <button
          type="button"
          className="libre-early-banner__close"
          onClick={dismiss}
          aria-label={t("banners.earlyDismiss")}
          title={t("banners.earlyDismiss")}
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
    </aside>
  );
}
