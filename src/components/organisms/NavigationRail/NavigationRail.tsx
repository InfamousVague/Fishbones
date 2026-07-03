/// Slim icon-only rail to the LEFT of the floating sidebar. Holds the
/// app's primary navigation (Library / Sandbox / Discover /
/// Practice / Achievements / Tracks / Trees) plus the persistent
/// footer cluster
/// (Settings + sidebar toggle).
///
/// Why a separate rail instead of more sidebar chrome:
///   - The sidebar collapses entirely when the learner hits Hide
///     Sidebar; with the nav living INSIDE the sidebar, that hid the
///     primary route switcher too. A rail lives outside the sidebar
///     so navigation stays reachable in collapsed mode.
///   - A 56px-wide icon column is much more efficient real estate
///     for nav than the 260px-wide course-tree sidebar — the icons
///     read as a fixed reference column the way macOS sidebars do.
///   - Pinning Settings + the sidebar toggle to the bottom of the
///     rail puts the "infrastructure" controls in a stable corner
///     out of the primary scan path.
///
/// Visual chrome mirrors the sidebar's frosted-glass treatment so the
/// rail and sidebar read as a paired unit despite living in separate
/// containers.

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { compass as compassIcon } from "@base/primitives/icon/icons/compass";
import { swords } from "@base/primitives/icon/icons/swords";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import { award } from "@base/primitives/icon/icons/award";
import { route } from "@base/primitives/icon/icons/route";
import { terminal as terminalIcon } from "@base/primitives/icon/icons/terminal";
import { users as usersIcon } from "@base/primitives/icon/icons/users";
import { megaphone } from "@base/primitives/icon/icons/megaphone";
import { settings as settingsIcon } from "@base/primitives/icon/icons/settings";
import { circleHelp } from "@base/primitives/icon/icons/circle-help";
import { play as playIcon } from "@base/primitives/icon/icons/play";
import { lock } from "@base/primitives/icon/icons/lock";
import { Tooltip } from "@base/primitives/tooltip";
import "@base/primitives/icon/icon.css";
import "@base/primitives/tooltip/tooltip.css";
import { formatShortcutForTitle } from "@/components/atoms/ShortcutHint/ShortcutHint";
import { useT } from "@/i18n/i18n";
import "./NavigationRail.css";

export interface NavigationRailProps {
  /// Which main-pane destination is currently showing. Drives the
  /// pill highlight. "courses" / "profile" are valid app routes that
  /// don't map to a rail icon — those return `undefined active` so
  /// no rail row lights up.
  activeView?:
    | "courses"
    | "profile"
    | "sandbox"
    | "library"
    | "discover"
    | "challenges"
    | "monkeyspaw"
    | "practice"
    | "paths"
    | "certificates"
    | "social";
  onLibrary: () => void;
  /// Resume-most-recent affordance. When present, surfaces a play
  /// chip at the very top of the rail (above Library) that drops
  /// the learner back into the course they touched most recently,
  /// at the first uncompleted lesson. Hidden when omitted OR when
  /// `resumeLabel` is empty — the App passes both together (the
  /// label is the course title, used as the tooltip; both come
  /// from the same memoised resume-candidate calculation). Keeping
  /// the resolution in App means the rail stays a dumb renderer.
  onResume?: () => void;
  /// Tooltip / aria-label for the resume button — typically the
  /// course title ("Resume: The Rust Programming Language"). The
  /// button only renders when both `onResume` AND a non-empty
  /// label are provided, so a course with no recents shows
  /// nothing rather than a "Resume —" with a blank line.
  resumeLabel?: string;
  /// Discover route — browse catalog books + challenge packs not
  /// yet in the user's library. Optional; embeddings without one
  /// just hide the chip.
  onDiscover?: () => void;
  /// Tracks route — curated linear learning paths. (The Trees
  /// surface was retired in the 2026-05 redesign; Tracks is now
  /// the sole "outcome-driven sequence" affordance.)
  onChallenges?: () => void;
  /// Monkey's Paw route — adversarial test-writing duels where the
  /// learner writes only tests and a maliciously-literal genie writes
  /// the laziest code that passes them. Optional; hidden when the
  /// host doesn't wire it.
  onMonkeysPaw?: () => void;
  /// Practice route — review-mode that resurfaces quizzes and
  /// blocks puzzles from courses the learner has already touched.
  /// The rest of the app is linear-by-lesson; Practice is the
  /// random-access "drill weak spots" surface that closes the
  /// learn → review loop.
  onPractice?: () => void;
  /// Count of spaced-repetition cards due right now — badges the
  /// Practice rail item so pending reviews are visible without opening
  /// the tab. 0/undefined hides the badge.
  practiceDue?: number;
  /// Paths route — curated, goal-oriented sequences that thread
  /// courses / Exercism tracks / koans / *-lings into a journey
  /// ("entry-level developer", "mobile app developer", "systems
  /// engineer", …). Sits just above Certificates: Paths is the
  /// "here's the map" surface, Certificates is the "here's what
  /// you've collected" surface — map first, trophies after.
  /// Optional; when omitted the chip just doesn't render.
  onPaths?: () => void;
  /// Certificates route — browse-all surface for course-completion
  /// certificates. The shareable "trophy case" of finished courses.
  onCertificates?: () => void;
  /// Sandbox route — free-form coding workspace with multi-project
  /// support (per-project file list + language + git later in the
  /// roadmap). Optional so embeddings that don't ship the sandbox
  /// can just hide the chip.
  onSandbox?: () => void;
  /// Social route — the consolidated Friends + Leaderboard page. Lives
  /// in the bottom cluster (with Feedback + Settings) rather than the
  /// primary top stack: it's a "people" surface, not a learning
  /// destination, so it sits with the other infrastructure controls.
  /// Optional — embeddings without a relay (no accounts) just hide it.
  onSocial?: () => void;
  /// Opens the in-app feedback / bug-report / feature-request dialog.
  /// Docked at the bottom of the rail (moved out of the top bar) so the
  /// "tell us" affordance sits with Settings in the stable corner.
  /// Optional — embeddings without a relay hide it.
  onFeedback?: () => void;
  onSettings: () => void;
  /// Re-trigger the guided tour (auto-runs on first launch; this
  /// puts a permanent affordance in the rail so a learner who
  /// dismissed it can come back). Optional — embeddings that
  /// don't ship the tour just hide the row.
  onStartTour?: () => void;
  /// Toggle the floating sidebar's visibility. The icon flips between
  /// panel-left-close (sidebar visible → click to hide) and
  /// panel-left-open (sidebar hidden → click to show). When omitted,
  /// the toggle row simply doesn't render — useful for surfaces that
  /// don't ship a sidebar (popped workbench, phone popout, etc., even
  /// though those don't render this rail today either).
  onToggleSidebar?: () => void;
  sidebarCollapsed?: boolean;
}

interface RailItemProps {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  /// Draw the active state as a self-contained filled pill instead of
  /// riding the top cluster's shared sliding indicator. Used by the
  /// bottom-cluster Social item, which lives outside the pill's
  /// measured container.
  activeStandalone?: boolean;
  /// The active-state ring is drawn via a `--active` modifier class;
  /// the title attribute carries the visible label since the rail
  /// itself is icon-only. Same vocabulary the MobileTabBar uses.
  pressed?: boolean;
  /// Optional count badge (e.g. spaced-repetition reviews due). Shown
  /// top-right of the icon when > 0; capped at "9+".
  badge?: number;
  /// Marks the route as not-yet-shipped: the button is visually dimmed,
  /// non-interactive (no onClick, `aria-disabled`), and wears a small
  /// lock badge. We use `aria-disabled` rather than the native
  /// `disabled` attribute so the "Coming soon" tooltip still appears on
  /// hover (disabled buttons swallow pointer events in most engines).
  comingSoon?: boolean;
  /// Localised "Coming soon" suffix appended to the tooltip / accessible
  /// name when `comingSoon` is set.
  comingSoonLabel?: string;
}

function RailItem({
  icon,
  label,
  onClick,
  active,
  activeStandalone,
  pressed,
  badge,
  comingSoon,
  comingSoonLabel,
}: RailItemProps) {
  const tip =
    comingSoon && comingSoonLabel ? `${label} · ${comingSoonLabel}` : label;
  return (
    <Tooltip content={tip} placement="right" delay={120}>
      <button
        type="button"
        className={
          "libre-nav-rail__item" +
          (active
            ? activeStandalone
              ? " libre-nav-rail__item--active-standalone"
              : " libre-nav-rail__item--active"
            : "") +
          (comingSoon ? " libre-nav-rail__item--coming-soon" : "")
        }
        onClick={comingSoon ? undefined : onClick}
        aria-disabled={comingSoon || undefined}
        aria-label={tip}
        aria-pressed={comingSoon ? undefined : pressed}
      >
        {/* size="xl" — bumped up from the original "sm" so the rail
            glyphs read as primary-nav, but stepped down from "2xl"
            which crowded the 40×40 button. xl (22px) leaves ~9px
            of ring inside the button for hover / active contrast. */}
        <Icon icon={icon} size="xl" color="currentColor" />
        {comingSoon ? (
          <span className="libre-nav-rail__lock" aria-hidden>
            <Icon icon={lock} size="xs" color="currentColor" />
          </span>
        ) : (
          badge !== undefined &&
          badge > 0 && (
            <span className="libre-nav-rail__badge" aria-hidden>
              {badge > 9 ? "9+" : badge}
            </span>
          )
        )}
      </button>
    </Tooltip>
  );
}

export default function NavigationRail({
  activeView,
  onLibrary,
  onResume,
  resumeLabel,
  onDiscover,
  onChallenges,
  onPractice,
  // Badges the Practice rail item with the count of spaced-repetition
  // cards due right now (Practice shipped out of "coming soon" in 2.7).
  practiceDue,
  onPaths,
  onCertificates,
  onSandbox,
  onSocial,
  onFeedback,
  onSettings,
  onStartTour,
  // `onToggleSidebar` / `sidebarCollapsed` are still declared on
  // the props interface so existing call sites pass through
  // without a refactor, but the rail no longer renders the
  // toggle — that moved to the fixed `<SidebarToggle />` chip
  // anchored next to the macOS traffic lights (see App.tsx).
}: NavigationRailProps) {
  const t = useT();
  // Sliding-pill indicator: a single absolutely-positioned element
  // animates its `top` between the active rail button's positions
  // rather than the highlight snapping from one button to another.
  // We measure the active button's offset relative to the top
  // cluster after every render that affects which button is active
  // OR which buttons are present (sign-in toggling Trees / Discover
  // visibility, etc.) so the pill stays glued to the right anchor.
  // Using `useLayoutEffect` so the measurement happens before paint
  // — without it the pill snaps to top:0 on the first frame and
  // visibly leaps into place a microframe later.
  const topRef = useRef<HTMLDivElement>(null);
  const [pillTop, setPillTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const top = topRef.current;
    if (!top) {
      setPillTop(null);
      return;
    }
    const activeBtn = top.querySelector(
      ".libre-nav-rail__item--active",
    ) as HTMLElement | null;
    if (!activeBtn) {
      // Active route doesn't have a rail icon (e.g. "courses" or
      // "profile" routes). Hide the pill so an old position doesn't
      // float over the rail looking stuck.
      setPillTop(null);
      return;
    }
    const topRect = top.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setPillTop(btnRect.top - topRect.top);
    // Re-measure when conditional items toggle visibility — without
    // these in the deps, a rail item appearing (e.g. user signs in
    // and Trees becomes available) would shift the active button's
    // offset without re-running the effect, leaving the pill
    // misaligned.
  }, [activeView, onDiscover, onChallenges, onPractice, onPaths, onCertificates, onSandbox]);

  return (
    <nav className="libre-nav-rail" aria-label={t("nav.primaryNavigation")}>
      <div className="libre-nav-rail__top" ref={topRef}>
        {pillTop !== null && (
          <span
            className="libre-nav-rail__pill"
            style={{ transform: `translateY(${pillTop}px)` }}
            aria-hidden
          >
            {/* Flat accent pill — the iridescent foil treatment is
                now reserved for certificates + the AI assistant
                button. The active-route indicator is intentionally
                quiet so it reads as a state hint rather than a
                second CTA. */}
          </span>
        )}
        {/* Order rationale (top → bottom):
              0. Resume       — when the learner has a course in
                               recents, the very first chip is a
                               play button that drops them right
                               back in. Hidden on first launch
                               (no recents) and after a deliberate
                               library teardown.
              1. Paths        — the "here's the map" surface, pinned
                               directly under Resume: the first
                               question after "continue?" is "what's
                               next on my route?"
              2. Library      — the home + most-visited surface
              3. Challenges   — exercise-driven content beside the
                               books it complements
              4. Sandbox      — open-ended editor + project workspace
              5. Practice     — the review umbrella (spaced-repetition
                               deck + Monkey's Paw duels — the Paw's
                               rail chip folded in here in the V30
                               practice rework)
              6. Certificates — permanent / shareable artefacts of
                               course completion
           (Discover sits ABOVE this whole cluster — very top of the
            rail, before Resume — per the 2026-07 direction to lead
            with the catalog browser.)
        */}
        {/* Discover leads the rail — the catalog browser is the
            acquisition surface (find your next book), so it sits
            above even Resume per 2026-07 direction. */}
        {onDiscover && (
          <RailItem
            icon={compassIcon}
            label={t("nav.discover")}
            onClick={onDiscover}
            active={activeView === "discover"}
          />
        )}
        {onResume && resumeLabel && (
          <RailItem
            icon={playIcon}
            label={`${t("nav.resumePrefix")} ${resumeLabel}`}
            onClick={onResume}
          />
        )}
        {onPaths && (
          <RailItem
            icon={route}
            label={t("nav.paths")}
            onClick={onPaths}
            active={activeView === "paths"}
          />
        )}
        <RailItem
          icon={libraryBig}
          label={t("nav.library")}
          onClick={onLibrary}
          active={activeView === "library"}
        />
        {/* Challenges lifted directly under Library — the library is
            books-only and exercise-driven content (Exercism tracks +
            in-house challenge packs + koans) is the natural next
            category in the catalogue hierarchy, so the two icons sit
            together visually. The page was called "Tracks" until the
            V27 koans ingest; "Tracks" is being held in reserve as a
            slot for a future feature, so the user-facing label moved
            to "Challenges" and the icon flipped from train-track to
            crossed swords to match the gamified-challenge metaphor. */}
        {onChallenges && (
          <RailItem
            icon={swords}
            label={t("nav.challenges")}
            onClick={onChallenges}
            active={activeView === "challenges"}
          />
        )}
        {/* Monkey's Paw no longer gets its own rail chip — it lives
            under Practice as a practice type (the Practice page's
            mode cards route there), so the rail stays one chip per
            surface family. */}
        {onSandbox && (
          <RailItem
            icon={terminalIcon}
            label={t("nav.sandbox")}
            onClick={onSandbox}
            active={activeView === "sandbox"}
          />
        )}
        {onPractice && (
          <RailItem
            icon={dumbbell}
            label={t("nav.practice")}
            onClick={onPractice}
            active={activeView === "practice"}
            badge={practiceDue}
          />
        )}
        {onCertificates && (
          <RailItem
            icon={award}
            label={t("nav.certificates")}
            onClick={onCertificates}
            active={activeView === "certificates"}
          />
        )}
      </div>
      <div className="libre-nav-rail__bottom">
        {/* Bottom cluster, top → bottom: Social, Feedback, help,
            Settings. Settings is at the very bottom (conventional
            Mac-app spot); above it sit the "people + infrastructure"
            affordances that aren't learning destinations —
            Social (Friends + Leaderboard), Feedback (bug reports /
            feature requests), and the guided-tour re-trigger. */}
        {onSocial && (
          <RailItem
            icon={usersIcon}
            label={t("nav.social")}
            onClick={onSocial}
            active={activeView === "social"}
            activeStandalone
          />
        )}
        {onFeedback && (
          <RailItem
            icon={megaphone}
            label={t("nav.feedback")}
            onClick={onFeedback}
          />
        )}
        {/* The sidebar toggle that used to live here was moved to a
            fixed-position chip just to the right of the macOS
            traffic lights (see `<SidebarToggle />` in App.tsx).
            The `onToggleSidebar` / `sidebarCollapsed` props are
            still accepted on this component so existing call
            sites pass through cleanly — they're just unused in
            the rail now. */}
        {onStartTour && (
          <RailItem
            icon={circleHelp}
            label={t("nav.takeTour")}
            onClick={onStartTour}
          />
        )}
        <RailItem
          icon={settingsIcon}
          label={formatShortcutForTitle(t("nav.settings"), "app.settings")}
          onClick={onSettings}
        />
      </div>
    </nav>
  );
}
