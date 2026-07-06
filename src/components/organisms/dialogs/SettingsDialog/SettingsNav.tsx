/// Left rail of the SettingsDialog. Cipher-style layout:
///
///   ┌─────────────────────────┐
///   │ Settings                │ ← header (always shown)
///   │                         │
///   │  ●Y  You         >      │ ← profile tile (signed-in only)
///   │      @you               │
///   │                         │
///   │  ⚙  General             │ ← flat nav list — flipped from
///   │     Version + updates   │   the old grouped layout because
///   │                         │   Cipher's reference doesn't use
///   │  🎨 Appearance          │   group headers and the rail
///   │     Theme · Language    │   reads cleaner without them.
///   │                         │
///   │  …                      │
///   │                         │
///   ├─────────────────────────┤
///   │ LIBRE 0.1.0 · DARK      │ ← footer (small uppercase chip)
///   └─────────────────────────┘
///
/// The component is purely presentational — selection state lives
/// in the parent. Profile tile click drills into the Account pane
/// via the `onProfileClick` callback (same pane the nav has its
/// own "Account" entry for, but the tile is the obvious target
/// when a learner wants to edit their identity).

import { Icon } from "@base/primitives/icon";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import type { PaneDef, PaneId } from "./panes";

interface UserDisplay {
  /// Human-facing display string. Display name when set, falling
  /// back to the email's local part. Empty when signed-out (the
  /// profile tile then doesn't render).
  name: string;
  /// Subtitle line under the name. Email when present, otherwise
  /// the auth provider description ("Signed in with Apple").
  sub: string;
  /// First-character avatar initial — uppercase letter pulled
  /// from name or email by the parent.
  initial: string;
}

interface Props {
  /// The full list of panes the user is allowed to open in this
  /// dialog instance. The web build, for example, slices Account
  /// off before passing in.
  panes: ReadonlyArray<PaneDef>;
  activeId: PaneId;
  onPaneSelect: (id: PaneId) => void;
  /// Profile information for the top tile. When `null`, the tile
  /// is hidden — that's the signed-out state on web/desktop.
  user?: UserDisplay | null;
  /// Drill-into-Account callback wired to the profile tile. The
  /// parent typically calls `onPaneSelect("account")` here, but
  /// keeping the callback explicit means the tile could open a
  /// different surface (a quick profile-editor modal, say) in
  /// the future without re-plumbing.
  onProfileClick?: () => void;
  /// App version + theme name shown in the footer chip. Both
  /// optional — empty values just render shorter footer text.
  appVersion?: string | null;
  themeName?: string | null;
  /// Fires every time the user clicks/taps the version chip. The
  /// parent dialog tallies the taps and reveals the Developer
  /// pane on the 10th in a row (5-second window). Plumbed as a
  /// callback rather than a counter so this component stays
  /// purely presentational — the gating logic lives in the
  /// dialog where the pane filter is already wired.
  onVersionTap?: () => void;
}

export default function SettingsNav({
  panes,
  activeId,
  onPaneSelect,
  user,
  onProfileClick,
  appVersion,
  themeName,
  onVersionTap,
}: Props) {
  const t = useT();
  return (
    <nav className="libre-settings-nav" aria-label={t("settings.navAria")}>
      {/* Title header — fixed strip at the top of the rail. The
          old SettingsDialog used to render "Settings" in a separate
          dialog-level header bar; moving it into the rail matches
          Cipher's layout and reclaims the dialog's top edge for
          content. */}
      <header className="libre-settings-nav__title-bar">
        <h1 className="libre-settings-nav__title">{t("settings.title")}</h1>
      </header>

      {/* Profile tile — only when signed in. Drills into the
          Account pane via `onProfileClick`. The avatar is a
          gradient-filled circle with the user's initial; we stop
          short of pulling a real avatar URL because Libre doesn't
          ship per-account profile pictures yet. */}
      {user && (
        <button
          type="button"
          className="libre-settings-nav__profile-tile"
          onClick={onProfileClick}
          aria-label={t("settings.ariaOpenAccount", { name: user.name })}
        >
          <span className="libre-settings-nav__profile-avatar" aria-hidden>
            {user.initial}
          </span>
          <span className="libre-settings-nav__profile-meta">
            <span className="libre-settings-nav__profile-name">
              {user.name}
            </span>
            <span className="libre-settings-nav__profile-sub">
              {/* `sub` may be an i18n key (provider description from
                  describeAuthProvider) or literal text (an email).
                  t() resolves keys and passes literals through. */}
              {t(user.sub)}
            </span>
          </span>
          <span className="libre-settings-nav__profile-chev" aria-hidden>
            <Icon icon={chevronRight} size="sm" color="currentColor" />
          </span>
        </button>
      )}

      {/* Flat nav list — Cipher dropped group headers; Libre used
          to surface them ("App", "AI", "Cloud", "Advanced"). For
          10 panes the headers were extra chrome that didn't earn
          their visual weight, and removing them lets the rail
          read as a calm vertical scan. Pane order in `panes.ts`
          still groups conceptually (app surfaces first, then
          AI/cloud, then advanced/dev) so the implicit ordering
          carries the categorical signal without needing labels. */}
      <div className="libre-settings-nav__list">
        {panes.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              className={
                "libre-settings-nav__item" +
                (active ? " libre-settings-nav__item--active" : "")
              }
              onClick={() => onPaneSelect(p.id)}
              aria-current={active ? "page" : undefined}
            >
              <span className="libre-settings-nav__item-icon" aria-hidden>
                <Icon icon={p.icon} size="lg" color="currentColor" />
              </span>
              <span className="libre-settings-nav__item-text">
                <span className="libre-settings-nav__item-label">
                  {t(p.label)}
                </span>
                {/* Hint is an i18n key from panes.ts — except when the
                    parent swapped in already-translated text (the
                    signed-out Account override), where t() passes the
                    literal through untouched. */}
                <span className="libre-settings-nav__item-hint">
                  {t(p.hint)}
                </span>
              </span>
              <span className="libre-settings-nav__item-chev" aria-hidden>
                <Icon icon={chevronRight} size="sm" color="currentColor" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer — version + theme chip, mimicking Cipher's
          "CIPHER 0.1.0 ALPHA · LIGHT" strip. Uppercase + tracked
          letterspacing reads as build metadata, distinct from
          interactive surfaces. Both fields are optional; omitted
          ones just shorten the strip. */}
      {(appVersion || themeName) && (
        <FooterChip
          appVersion={appVersion}
          themeName={themeName}
          onVersionTap={onVersionTap}
        />
      )}
    </nav>
  );
}

interface FooterProps {
  appVersion?: string | null;
  themeName?: string | null;
  onVersionTap?: () => void;
}

function FooterChip({ appVersion, themeName, onVersionTap }: FooterProps) {
  const t = useT();
  // Format the version with a leading "Libre" prefix; the version
  // string from `getVersion()` is bare ("0.1.15") and reads better
  // with the brand attached when sitting next to the theme label.
  const version = appVersion
    ? t("settings.libreVersion", { version: appVersion })
    : t("settings.libreOnly");
  // Version span is silently click-armed when `onVersionTap` is
  // wired — the parent dialog uses this to count 10 quick taps as
  // the easter-egg gesture to reveal the Developer pane. We don't
  // change the cursor / aria so the gate stays undiscovered until
  // someone tries it; the wrapped <span> remains visually
  // identical to the un-tappable version. `user-select: none` via
  // inline style stops a double-/triple-click from selecting the
  // text and triggering the OS context menu.
  return (
    <footer className="libre-settings-nav__footer">
      <span
        onClick={onVersionTap}
        style={onVersionTap ? { userSelect: "none" } : undefined}
      >
        {version}
      </span>
      {themeName && (
        <>
          <span aria-hidden>·</span>
          <span>{themeName}</span>
        </>
      )}
    </footer>
  );
}

/// Compute the small per-user display data the nav tile needs
/// from a `UseLibreCloud`-shaped user object. Exported as a
/// helper so the parent dialog can compute it once and pass the
/// derived `UserDisplay` straight in.
///
/// `signedInFallback` is the localised "Signed in" string used as a
/// last-resort name when the user has no display_name or email. The
/// caller passes `t("settings.signedIn")` so this helper can stay a
/// pure function (no hook coupling) and still produce locale-correct
/// output.
export function deriveUserDisplay(
  user: {
    email: string | null;
    display_name: string | null;
  } | null
    | false,
  providerLabel: string,
  signedInFallback: string,
): UserDisplay | null {
  if (!user || typeof user !== "object") return null;
  const trimmed = user.display_name?.trim() || null;
  const name = trimmed || user.email || signedInFallback;
  const sub = user.email && trimmed ? user.email : providerLabel;
  const initialSrc = trimmed || user.email || "";
  const initial = initialSrc ? initialSrc.charAt(0).toUpperCase() : "?";
  return { name, sub, initial };
}
