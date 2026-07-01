import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@base/primitives/icon";
import { panelLeftClose } from "@base/primitives/icon/icons/panel-left-close";
import { panelLeftOpen } from "@base/primitives/icon/icons/panel-left-open";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { messageCircleMore } from "@base/primitives/icon/icons/message-circle-more";
import "@base/primitives/icon/icon.css";
import type { StreakAndXp } from "@/hooks/useStreakAndXp";
import type { Completion } from "@/hooks/useProgress";
import type { StreakShieldsState } from "@/hooks/useStreakShields";
import type { Course } from "@/data/types";
import LanguageChip from "@/components/atoms/LanguageChip/LanguageChip";
import TipDropdown from "@/components/molecules/TipDropdown/TipDropdown";
import TopBarSearch from "@/components/molecules/TopBarSearch/TopBarSearch";
import StatsChip from "./StatsChip";
import { isWeb } from "@/lib/platform";
import { openExternal } from "@/lib/openExternal";
import { useDismiss } from "@/hooks/useDismiss";
import { useT } from "@/i18n/i18n";
import "./TopBar.css";

/// Public Discord invite — single source of truth, shared with the
/// marketing site (see Web/libre.academy/src/components/Nav.tsx).
/// If the invite ever rotates, update both.
const DISCORD_INVITE = "https://discord.gg/2yPVVfuFdW";

/// Inline Discord "Clyde" mark. Mirrors the marketing site's
/// `icons/DiscordMark.tsx`. We don't pull in lucide-react v0's brand
/// glyphs (they were dropped in v1) just for one logo — the path is
/// hand-copied and stable. currentColor fill so the button's
/// hover/active treatment can tint it without prop drilling.
function DiscordMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export interface Tab {
  id: string;
  label: string;
  language: string;
  /// Group membership — when set, the tab renders with a colored
  /// bottom underline + tinted background tied to the group's
  /// colour token. Right-click → "Remove from group" clears it.
  groupId?: string;
  /// Human-facing group name. Surfaces in the right-click menu's
  /// list of "Add to group →" entries and (eventually) as a small
  /// badge prefix on the leftmost tab of each contiguous run.
  groupName?: string;
  /// Palette token suffix ("gold" / "coral" / "mint" / "sky" /
  /// "lavender"). Resolved by CSS into the active theme's accent
  /// hue via `--libre-tab-group-color-<token>` custom properties.
  groupColorToken?: string;
}

/// Group-only summary, used by the right-click menu's "Add to
/// group" submenu so we can list every group the user has created
/// (even ones whose members aren't visible in the current scroll
/// region of the tab strip).
export interface TabGroupSummary {
  id: string;
  name: string;
  colorToken: string;
}

interface Props {
  tabs: Tab[];
  /// Every group the user has created, regardless of which tabs are
  /// currently in it. Drives the right-click "Add to group" submenu
  /// + the "Rename group" affordance. Empty array when no groups
  /// exist; the menu hides those rows in that case.
  groups?: TabGroupSummary[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
  /// Move a tab from one position to another. Called when the user
  /// drag-drops a tab within the strip; App.tsx splices openTabs to
  /// apply the new order. Activeness is maintained — the tab that
  /// was active before the drag stays active afterwards. Optional —
  /// when omitted, tabs are not draggable.
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /// Set / clear a tab's group membership. `null` removes the tab
  /// from any group it was in (and prunes the group definition if
  /// it had no other members). Optional — when omitted, the
  /// right-click "Add to group" / "Remove from group" rows hide.
  onSetTabGroup?: (tabIndex: number, groupId: string | null) => void;
  /// Create a new group containing only `tabIndex`. The caller picks
  /// a default name; learners can rename via `onRenameGroup`. Hides
  /// the menu's "New group" row when omitted.
  onCreateGroup?: (tabIndex: number, name: string) => void;
  /// Rename an existing group. Hides the "Rename group" row when
  /// omitted.
  onRenameGroup?: (groupId: string, name: string) => void;
  /// Learner's current streak + XP. Combined into a single trigger chip
  /// in the top bar — click to expand a detail dropdown. The chip is
  /// always rendered (even at level 1 / 0 streak) because the dropdown
  /// is also where unauthenticated learners pick up the cloud-sync
  /// sign-in CTA — hiding it would orphan that path.
  stats?: StreakAndXp;
  /// True once `stats`'s underlying data (courses + completion history)
  /// has loaded. Forwarded to StatsChip so its streak/level cues don't
  /// fire on the 0 → real hydration at launch.
  statsReady?: boolean;
  /// Lesson-completion log. Optional — when supplied, the dropdown
  /// renders a 4-week mini-heatmap so the learner sees their recent
  /// activity rhythm without leaving the bar. The full 20-week grid
  /// + per-language chart + badges live on the Profile page; this is
  /// a teaser. Omit to hide the heatmap (web embeds without a
  /// progress store).
  history?: Completion[];
  /// Streak-shield state (per-week freeze budget + frozen-day log).
  /// Threaded straight through to StatsChip — when supplied, the stats
  /// dropdown grows a "Streak shields" panel with a "Freeze yesterday"
  /// CTA. Omit on web embeds that don't ship the shield hook.
  shields?: StreakShieldsState;
  /// Called when the "View Profile" button at the bottom of the stats
  /// dropdown is clicked. Routes the main pane to the Profile view.
  onOpenProfile?: () => void;
  /// Whether the sidebar is currently collapsed. Drives the toggle
  /// button's icon so it always shows the *action* the click will
  /// perform (show panel when collapsed, hide panel when expanded).
  sidebarCollapsed?: boolean;
  /// Toggles sidebar visibility. Also mapped to Cmd/Ctrl+\ at the app
  /// level, but the button gives learners an obvious, discoverable path.
  onToggleSidebar?: () => void;

  /// Cloud-sync auth state, surfaced in the dropdown's account row.
  /// `signedIn=false` shows a "Sign in" button next to "View profile";
  /// `signedIn=true` shows the user identity + a "Sign out" link.
  /// Pass `undefined` (or omit) to hide the account row entirely —
  /// useful for embeds / non-Tauri builds where cloud isn't wired.
  signedIn?: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
  /// Opens the sign-in modal. Only invoked when `signedIn === false`.
  onSignIn?: () => void;
  /// Best-effort logout (revokes the token server-side and clears local
  /// cache). Errors are swallowed in the hook; the chip just goes back
  /// to the signed-out state.
  onSignOut?: () => void;

  /// Opens the feedback / bug-report / feature-request modal. Omit to
  /// hide the feedback button (e.g. embeds without a relay).
  onOpenFeedback?: () => void;

  /// Opens the full CommandPalette modal (the surface that Cmd/Ctrl+K
  /// also binds to). Wired to the trailing ⌘K kbd hint inside the
  /// inline search input — visitors who need actions like "Open
  /// settings" or "Import a book" still have a path to them. Omit to
  /// hide the kbd hint trigger.
  onOpenSearch?: () => void;

  /// Course list — feeds the inline search input's result pool. The
  /// input is hidden if not supplied, so embeds without courses can
  /// pass `undefined` to suppress the search affordance. */
  courses?: Course[];
  /// Open a specific lesson. Same shape App.tsx already uses for
  /// selectLesson + sidebar tap-throughs; the search dropdown calls
  /// this when the user picks a lesson result.
  onOpenLesson?: (courseId: string, lessonId: string) => void;

  /// Browser-style back / forward over the main view — the history arrows at
  /// the left of the bar. Omit `onBack`/`onForward` to hide the arrows.
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

/// Custom window top bar. The window is configured with
/// `titleBarStyle: "Overlay"` so the macOS traffic lights float over this bar
/// at the top-left. The bar doubles as a drag region via
/// `data-tauri-drag-region`. Individual clickable elements cancel drag by
/// NOT setting the attribute on themselves.
export default function TopBar({
  tabs,
  groups = [],
  activeIndex,
  onActivate,
  onClose,
  onReorder,
  onSetTabGroup,
  onCreateGroup,
  onRenameGroup,
  stats,
  statsReady,
  history,
  shields,
  onOpenProfile,
  sidebarCollapsed = false,
  onToggleSidebar,
  signedIn,
  userDisplayName,
  userEmail,
  onSignIn,
  onSignOut,
  onOpenFeedback,
  onOpenSearch,
  courses,
  onOpenLesson,
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
}: Props) {
  const t = useT();
  // Always show the chip when stats are wired — the dropdown carries
  // both the level/streak detail and the cloud-sync sign-in path, so
  // hiding it for fresh learners would orphan the latter.
  const showStats = !!stats;

  // Drag-to-reorder via POINTER events. HTML5 drag-and-drop is unreliable in
  // WKWebView (the Tauri desktop webview) — `dragstart`/`drop` frequently
  // never fire — which is why the rest of the app drives dragging with
  // pointer events too. We capture the pointer on the source tab, track it
  // across the strip, and reorder on release. `draggingIdx` dims/lifts the
  // source tab; `overIdx` draws the drop indicator on the hovered tab. Refs
  // mirror them so the pointerup closure reads the latest values.
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const tabsStripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    from: number;
    startX: number;
    started: boolean;
  } | null>(null);
  const overIdxRef = useRef<number | null>(null);
  // Set right after a real drag so the click that fires on pointerup doesn't
  // ALSO re-activate the source tab; the tab's onClick clears it.
  const suppressClickRef = useRef(false);
  const reorderable = !!onReorder;

  // Index of the tab whose box clientX falls within (clamped to the strip's
  // ends). Matches the index semantics `reorderTab` (App.tsx) expects.
  function tabIndexAtX(clientX: number): number | null {
    const strip = tabsStripRef.current;
    if (!strip) return null;
    const els = Array.from(strip.querySelectorAll<HTMLElement>(".libre__tab"));
    if (!els.length) return null;
    for (let i = 0; i < els.length; i++) {
      if (clientX <= els[i].getBoundingClientRect().right) return i;
    }
    return els.length - 1;
  }

  function handleTabPointerDown(
    idx: number,
    e: React.PointerEvent<HTMLButtonElement>,
  ) {
    // Left button only; never start a drag from the close affordance.
    if (!reorderable || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".libre__tab-close")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { from: idx, startX: e.clientX, started: false };
  }

  function handleTabPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.started) {
      // A few px of slop so a plain click isn't read as a drag.
      if (Math.abs(e.clientX - d.startX) < 4) return;
      d.started = true;
      setDraggingIdx(d.from);
    }
    const over = tabIndexAtX(e.clientX);
    if (over !== null && over !== overIdxRef.current) {
      overIdxRef.current = over;
      setOverIdx(over);
    }
  }

  function endTabDrag(
    e: React.PointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
    const from = d?.from ?? null;
    const to = overIdxRef.current;
    const dragged = !!d?.started;
    overIdxRef.current = null;
    setDraggingIdx(null);
    setOverIdx(null);
    if (dragged) {
      // Swallow the click that follows a real drag.
      suppressClickRef.current = true;
      if (commit && from !== null && to !== null && from !== to) {
        onReorder?.(from, to);
      }
    }
  }

  // ── Tab right-click menu ───────────────────────────────────────
  // Anchor coords + the index of the tab the menu was opened on.
  // Single menu at a time across the strip; opening on a different
  // tab replaces the previous. Click-outside / Escape dismiss.
  const [tabMenu, setTabMenu] = useState<{
    tabIndex: number;
    x: number;
    y: number;
  } | null>(null);
  // Ref on the portaled menu so the dismiss excludes clicks inside it
  // (replaces the menu's own `stopPropagation`). `event: "click"` keeps
  // the original semantics — the click that opens a menu item still
  // hits the item's onClick before the outside-dismiss fires.
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  useDismiss(tabMenuRef, closeTabMenu, {
    enabled: !!tabMenu,
    event: "click",
  });
  function openTabMenu(tabIndex: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setTabMenu({ tabIndex, x: e.clientX, y: e.clientY });
  }
  const groupable = !!onSetTabGroup && !!onCreateGroup;

  return (
    <div className="libre__topbar" data-tauri-drag-region>
      {/* On desktop: reserved gutter so the macOS traffic lights
          (which `titleBarStyle: "Overlay"` floats over the bar at
          x≈18) don't collide with the sidebar toggle. On web:
          there are no traffic lights, so we use the same width
          for a brand element — Libre logo + wordmark — that
          links back to the marketing site one path-segment up. */}
      {/* macOS traffic-light spacer — the OS draws close / minimise
          / maximise buttons in this region on Tauri; we leave it
          empty so they don't collide with our chrome. The web
          build has no traffic lights, so this gutter is just a
          left-edge spacer keeping the brand wordmark from sitting
          flush against the window edge. */}
      {!isWeb && (
        <div className="libre__topbar-window-controls" data-tauri-drag-region />
      )}
      {/* Browser-style back / forward over the main view. Disabled at the ends
          of the trail. */}
      {(onBack || onForward) && (
        <div className="libre__topbar-nav">
          <button
            type="button"
            className="libre__topbar-navbtn"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Back"
            title="Back"
            data-tauri-drag-region={false}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="libre__topbar-navbtn"
            onClick={onForward}
            disabled={!canGoForward}
            aria-label="Forward"
            title="Forward"
            data-tauri-drag-region={false}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}
      {/* Brand wordmark moved out of the top bar — it now lives in
          the Library page's header next to the title, where it's
          larger and reads as the page identity rather than chrome
          repeated on every screen. The traffic-light spacer above
          still anchors the left edge on desktop; on web the row
          flows from the sidebar toggle. See
          CourseLibrary.tsx → `.libre-library-brand-mark`. */}

      {onToggleSidebar && (
        <button
          type="button"
          className="libre__topbar-sidebar-toggle"
          onClick={onToggleSidebar}
          title={
            sidebarCollapsed
              ? t("topBar.showSidebarTitle")
              : t("topBar.hideSidebarTitle")
          }
          aria-label={
            sidebarCollapsed ? t("nav.showSidebar") : t("nav.hideSidebar")
          }
          aria-pressed={sidebarCollapsed}
        >
          <Icon
            icon={sidebarCollapsed ? panelLeftOpen : panelLeftClose}
            size="lg"
            color="currentColor"
          />
        </button>
      )}

      <div
        className="libre__topbar-tabs"
        data-tauri-drag-region
        ref={tabsStripRef}
      >
        {tabs.map((tab, i) => {
          const isActive = i === activeIndex;
          const isDragging = draggingIdx === i;
          const isDragOver = overIdx === i && draggingIdx !== null && draggingIdx !== i;
          // Compute drop-side hint: if the dragged tab is moving
          // FORWARD (source < target) the drop happens AFTER the
          // hovered tab, so we draw the indicator on its trailing
          // edge. Backward drags drop BEFORE the hovered tab.
          const dropAfter = isDragOver && draggingIdx !== null && draggingIdx < i;
          // First-of-group flag: the tab is grouped AND its left
          // neighbour is in a DIFFERENT group (or ungrouped). Used
          // to render the group-name badge prefix only on the run
          // leader, not on every tab in the group.
          const isFirstOfGroup =
            !!tab.groupId &&
            (i === 0 || tabs[i - 1].groupId !== tab.groupId);
          // Inline custom property for the group's accent colour —
          // resolved by CSS into the active theme's hue. When the
          // tab isn't grouped, leaving the property unset lets the
          // base `.libre__tab` rule render its default chrome.
          const styleVars = tab.groupColorToken
            ? ({
                "--libre-tab-group-color": `var(--libre-tab-group-color-${tab.groupColorToken})`,
              } as React.CSSProperties)
            : undefined;
          return (
            <button
              key={tab.id}
              className={[
                "libre__tab",
                isActive && "libre__tab--active",
                isDragging && "libre__tab--dragging",
                isDragOver && "libre__tab--drag-over",
                dropAfter && "libre__tab--drop-after",
                tab.groupId && "libre__tab--grouped",
              ]
                .filter(Boolean)
                .join(" ")}
              style={styleVars}
              onClick={() => {
                // A drag just happened on this tab — eat the trailing click
                // so we don't also re-activate it.
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onActivate(i);
              }}
              onContextMenu={(e) => openTabMenu(i, e)}
              onPointerDown={(e) => handleTabPointerDown(i, e)}
              onPointerMove={handleTabPointerMove}
              onPointerUp={(e) => endTabDrag(e, true)}
              onPointerCancel={(e) => endTabDrag(e, false)}
              data-tauri-drag-region={false}
            >
              {isFirstOfGroup && (
                <span
                  className="libre__tab-group-badge"
                  title={t("topBar.groupTitle", { name: tab.groupName ?? "" })}
                >
                  {tab.groupName}
                </span>
              )}
              <LanguageChip
                language={tab.language}
                size="sm"
                iconOnly
                className="libre__tab-lang"
              />
              <span className="libre__tab-label">{tab.label}</span>
              <span
                className="libre__tab-close"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(i);
                }}
              >
                <Icon icon={xIcon} size="sm" color="currentColor" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab right-click menu. Portal'd to document.body so the
          topbar's `overflow: hidden` (it sometimes ends up on the
          tab-strip parent under tight viewports) doesn't clip us. */}
      {tabMenu && groupable && (() => {
        const tab = tabs[tabMenu.tabIndex];
        if (!tab) return null;
        const otherGroups = groups.filter((g) => g.id !== tab.groupId);
        return createPortal(
          <div
            ref={tabMenuRef}
            className="libre__tab-menu"
            style={{ left: tabMenu.x, top: tabMenu.y }}
            role="menu"
            aria-label={t("topBar.tabActions")}
          >
            <div className="libre__tab-menu-label">{tab.label}</div>
            <button
              type="button"
              role="menuitem"
              className="libre__tab-menu-item"
              onClick={() => {
                setTabMenu(null);
                onClose(tabMenu.tabIndex);
              }}
            >
              {t("topBar.closeTab")}
            </button>
            <div className="libre__tab-menu-sep" aria-hidden />
            {!tab.groupId && (
              <button
                type="button"
                role="menuitem"
                className="libre__tab-menu-item"
                onClick={() => {
                  setTabMenu(null);
                  // Default group name = the tab's label, capped at
                  // 24 chars. Learner can rename via the right-click
                  // menu's "Rename group" row.
                  const fallback = tab.label.slice(0, 24);
                  onCreateGroup?.(tabMenu.tabIndex, fallback);
                }}
              >
                {t("topBar.newGroupWithTab")}
              </button>
            )}
            {!tab.groupId && otherGroups.length > 0 && (
              <>
                <div className="libre__tab-menu-section">
                  {t("topBar.addToGroup")}
                </div>
                {otherGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="menuitem"
                    className="libre__tab-menu-item libre__tab-menu-item--with-swatch"
                    onClick={() => {
                      setTabMenu(null);
                      onSetTabGroup?.(tabMenu.tabIndex, g.id);
                    }}
                  >
                    <span
                      className="libre__tab-menu-swatch"
                      style={{
                        background: `var(--libre-tab-group-color-${g.colorToken})`,
                      }}
                      aria-hidden
                    />
                    {g.name}
                  </button>
                ))}
              </>
            )}
            {tab.groupId && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="libre__tab-menu-item"
                  onClick={() => {
                    setTabMenu(null);
                    onSetTabGroup?.(tabMenu.tabIndex, null);
                  }}
                >
                  {t("topBar.removeFromGroup")}
                </button>
                {onRenameGroup && (
                  <button
                    type="button"
                    role="menuitem"
                    className="libre__tab-menu-item"
                    onClick={() => {
                      setTabMenu(null);
                      const next = window.prompt(
                        t("topBar.groupNamePrompt"),
                        tab.groupName ?? "",
                      );
                      if (next != null && next.trim().length > 0) {
                        onRenameGroup(tab.groupId!, next.trim());
                      }
                    }}
                  >
                    {t("topBar.renameGroup")}
                  </button>
                )}
                {otherGroups.length > 0 && (
                  <>
                    <div className="libre__tab-menu-section">
                      {t("topBar.moveToGroup")}
                    </div>
                    {otherGroups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        role="menuitem"
                        className="libre__tab-menu-item libre__tab-menu-item--with-swatch"
                        onClick={() => {
                          setTabMenu(null);
                          onSetTabGroup?.(tabMenu.tabIndex, g.id);
                        }}
                      >
                        <span
                          className="libre__tab-menu-swatch"
                          style={{
                            background: `var(--libre-tab-group-color-${g.colorToken})`,
                          }}
                          aria-hidden
                        />
                        {g.name}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>,
          document.body,
        );
      })()}

      <div className="libre__topbar-actions">
        {/* Tip jar — inline dropdown with the dev's crypto wallets so
            learners on the desktop can chip in without leaving the
            app. The button intentionally sits left of the
            search/stats so it's not behind a Cmd/Ctrl-K-only path. */}
        <TipDropdown />

        {/* Discord invite — Clyde mark + short "Join" label, mirroring
            the marketing site's "Discord" pill in shape so the row of
            actions reads as one cohesive strip. Sits between the tip
            jar and search so the social affordance stays visible
            from every view without competing with the lesson tabs
            above. Routes through openExternal so the desktop
            WebView hands off to the OS browser (else the user would
            get trapped on discord.com inside the app shell). */}
        <button
          type="button"
          className="libre__topbar-icon-btn libre__topbar-icon-btn--discord"
          onClick={() => void openExternal(DISCORD_INVITE)}
          aria-label={t("topBar.joinDiscord")}
          title={t("topBar.joinDiscord")}
        >
          <DiscordMark size={17} />
        </button>

        {/* Feedback — opens the in-app feedback / bug-report / feature-
            request modal (App.tsx owns the open state; the modal posts
            to the relay's /feedback → Notion). Sits next to the Discord
            pill so the "talk to us" affordances cluster together. */}
        {onOpenFeedback && (
          <button
            type="button"
            className="libre__topbar-icon-btn"
            onClick={onOpenFeedback}
            aria-label={t("topBar.feedback")}
            title={t("topBar.feedbackTitle")}
          >
            <Icon icon={messageCircleMore} size="base" color="currentColor" />
          </button>
        )}

        {/* Inline search — real <input> with a dropdown of ranked
            course/lesson hits. The trailing ⌘K hint inside the input
            still pops the full CommandPalette for power-user actions
            (Open Settings, Import a book, …). Hidden if the embed
            doesn't supply courses. */}
        {courses && onOpenLesson && (
          <TopBarSearch
            courses={courses}
            onOpenLesson={onOpenLesson}
            onOpenFullSearch={onOpenSearch}
          />
        )}
        {showStats && (
          <StatsChip
            stats={stats!}
            statsReady={statsReady}
            history={history}
            shields={shields}
            onOpenProfile={onOpenProfile}
            signedIn={signedIn}
            userDisplayName={userDisplayName}
            userEmail={userEmail}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
          />
        )}
      </div>
    </div>
  );
}

