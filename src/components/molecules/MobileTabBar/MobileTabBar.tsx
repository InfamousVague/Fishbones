/// Mobile-only bottom tab bar. Replaces the desktop TopBar + Sidebar
/// chrome on iOS. Renders four entries: Library / Playground /
/// Practice / Profile.
///
/// What's NOT in the bar (and where it lives instead):
///   - **Lesson** — there used to be a "Lesson" button that lit up
///     when there was an active lesson and jumped back to it. Dropped
///     2026-05-11 because the bar was getting cluttered (six entries
///     was over the comfortable max for thumb reach) and the same
///     navigation already happens via the Library tile tap. The
///     lesson view's own back button covers the reverse direction.
///   - **Settings** — folded into Profile as a gear button on that
///     page. Settings is a low-frequency surface; a dedicated tab
///     for it was wasted bar real estate compared to a one-tap
///     affordance from the Profile screen.
///
/// MobileTab still includes `"courses"` and `"settings"` in the
/// union because MobileApp's view-to-tab mapping references them
/// (the lesson view maps to "courses" — no rendered button, but the
/// type keeps that mapping honest in case we ever bring the buttons
/// back).

import { Icon } from "@base/primitives/icon";
import { library } from "@base/primitives/icon/icons/library";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import { user } from "@base/primitives/icon/icons/user";
import { squareTerminal } from "@base/primitives/icon/icons/square-terminal";
import "./MobileTabBar.css";

export type MobileTab =
  | "library"
  | "courses"
  | "playground"
  | "practice"
  | "profile"
  | "settings";

interface Props {
  active: MobileTab;
  onLibrary: () => void;
  /// Playground tab handler. Same optional-shape as `onPractice`
  /// for the same reason — embeddings that don't ship the
  /// Playground (older builds during rollout, or surfaces where
  /// the free-form sandbox doesn't belong) can omit the prop and
  /// the button hides.
  onPlayground?: () => void;
  /// Practice tab handler. Optional so embeddings without the
  /// Practice surface (legacy mobile builds during rollout) can
  /// still mount the bar; when omitted, the button is hidden.
  onPractice?: () => void;
  onProfile: () => void;
}

export default function MobileTabBar({
  active,
  onLibrary,
  onPlayground,
  onPractice,
  onProfile,
}: Props) {
  return (
    <>
      {/* Gradient blur band that catches content scrolling under the
          floating tab pill. Sibling to the nav rather than child so
          its z-index sits below the pill's `z-index: 100` — the pill
          stays opaque at its own level, the band only blurs the
          space behind. aria-hidden because it's pure visual chrome. */}
      <div className="libre-mtab-blur" aria-hidden />
      <nav className="libre-mtab" aria-label="Primary navigation">
        <button
          type="button"
          className={`libre-mtab__btn${active === "library" ? " libre-mtab__btn--active" : ""}`}
          onClick={onLibrary}
        >
          <Icon icon={library} size="lg" />
          <span>Library</span>
        </button>
        {onPlayground && (
          <button
            type="button"
            className={`libre-mtab__btn${active === "playground" ? " libre-mtab__btn--active" : ""}`}
            onClick={onPlayground}
          >
            <Icon icon={squareTerminal} size="lg" />
            <span>Playground</span>
          </button>
        )}
        {onPractice && (
          <button
            type="button"
            className={`libre-mtab__btn${active === "practice" ? " libre-mtab__btn--active" : ""}`}
            onClick={onPractice}
          >
            <Icon icon={dumbbell} size="lg" />
            <span>Practice</span>
          </button>
        )}
        <button
          type="button"
          className={`libre-mtab__btn${active === "profile" ? " libre-mtab__btn--active" : ""}`}
          onClick={onProfile}
        >
          <Icon icon={user} size="lg" />
          <span>Profile</span>
        </button>
      </nav>
    </>
  );
}
