import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { panelLeftClose } from "@base/primitives/icon/icons/panel-left-close";
import { panelLeftOpen } from "@base/primitives/icon/icons/panel-left-open";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import type { StreakAndXp } from "../../hooks/useStreakAndXp";
import type { Completion } from "../../hooks/useProgress";
import type { Course } from "../../data/types";
import LanguageChip from "../LanguageChip/LanguageChip";
import TipDropdown from "../TipDropdown/TipDropdown";
import TopBarSearch from "../TopBarSearch/TopBarSearch";
import StatsChip from "./StatsChip";
import { isWeb } from "../../lib/platform";
import "./TopBar.css";

export interface Tab {
  id: string;
  label: string;
  language: string;
}

interface Props {
  tabs: Tab[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
  /// Move a tab from one position to another. Called when the user
  /// drag-drops a tab within the strip; App.tsx splices openTabs to
  /// apply the new order. Activeness is maintained — the tab that
  /// was active before the drag stays active afterwards. Optional —
  /// when omitted, tabs are not draggable.
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /// Learner's current streak + XP. Combined into a single trigger chip
  /// in the top bar — click to expand a detail dropdown. The chip is
  /// always rendered (even at level 1 / 0 streak) because the dropdown
  /// is also where unauthenticated learners pick up the cloud-sync
  /// sign-in CTA — hiding it would orphan that path.
  stats?: StreakAndXp;
  /// Lesson-completion log. Optional — when supplied, the dropdown
  /// renders a 4-week mini-heatmap so the learner sees their recent
  /// activity rhythm without leaving the bar. The full 20-week grid
  /// + per-language chart + badges live on the Profile page; this is
  /// a teaser. Omit to hide the heatmap (web embeds without a
  /// progress store).
  history?: Completion[];
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
}

/// Custom window top bar. The window is configured with
/// `titleBarStyle: "Overlay"` so the macOS traffic lights float over this bar
/// at the top-left. The bar doubles as a drag region via
/// `data-tauri-drag-region`. Individual clickable elements cancel drag by
/// NOT setting the attribute on themselves.
export default function TopBar({
  tabs,
  activeIndex,
  onActivate,
  onClose,
  onReorder,
  stats,
  history,
  onOpenProfile,
  sidebarCollapsed = false,
  onToggleSidebar,
  signedIn,
  userDisplayName,
  userEmail,
  onSignIn,
  onSignOut,
  onOpenSearch,
  courses,
  onOpenLesson,
}: Props) {
  // Always show the chip when stats are wired — the dropdown carries
  // both the level/streak detail and the cloud-sync sign-in path, so
  // hiding it for fresh learners would orphan the latter.
  const showStats = !!stats;

  // Drag-to-reorder state. `draggingIdx` is the source tab being
  // dragged; `overIdx` is the slot it would land in if dropped now.
  // Both clear on dragend / drop. We keep them as refs-on-state so a
  // re-render shows the live indicator (a 2px accent line on the
  // hovered slot's leading edge).
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const reorderable = !!onReorder;

  function handleDragStart(idx: number, e: React.DragEvent<HTMLButtonElement>) {
    if (!reorderable) return;
    setDraggingIdx(idx);
    // Required for Firefox to actually start the drag — and the data
    // payload is also useful if a future feature wants to drag tabs
    // out of the bar entirely (e.g. to spawn a popped-out window).
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }

  function handleDragOver(idx: number, e: React.DragEvent<HTMLButtonElement>) {
    if (!reorderable || draggingIdx === null) return;
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = "move";
    if (overIdx !== idx) setOverIdx(idx);
  }

  function handleDrop(idx: number, e: React.DragEvent<HTMLButtonElement>) {
    if (!reorderable) return;
    e.preventDefault();
    const from = draggingIdx;
    setDraggingIdx(null);
    setOverIdx(null);
    if (from === null || from === idx) return;
    onReorder?.(from, idx);
  }

  function handleDragEnd() {
    setDraggingIdx(null);
    setOverIdx(null);
  }

  return (
    <div className="fishbones__topbar" data-tauri-drag-region>
      {/* On desktop: reserved gutter so the macOS traffic lights
          (which `titleBarStyle: "Overlay"` floats over the bar at
          x≈18) don't collide with the sidebar toggle. On web:
          there are no traffic lights, so we use the same width
          for a brand element — Fishbones logo + wordmark — that
          links back to the marketing site one path-segment up. */}
      {isWeb ? (
        <a
          href="../"
          className="fishbones__topbar-brand"
          aria-label="Fishbones Academy home"
          data-tauri-drag-region={false}
        >
          {/* Match the marketing-site nav: skinny fish-skeleton
              wordmark followed by the `.academy` TLD. Same asset
              ships at fishbones.academy/fishbones_skinny_white.png
              and inside the embedded /learn/ build. */}
          <img
            src={`${import.meta.env.BASE_URL}fishbones_skinny_white.png`}
            alt="Fishbones"
            className="fishbones__topbar-brand-icon"
          />
          <span className="fishbones__topbar-brand-tld">.academy</span>
        </a>
      ) : (
        <div className="fishbones__topbar-window-controls" data-tauri-drag-region />
      )}

      {onToggleSidebar && (
        <button
          type="button"
          className="fishbones__topbar-sidebar-toggle"
          onClick={onToggleSidebar}
          title={
            sidebarCollapsed
              ? "Show sidebar (⌘\\)"
              : "Hide sidebar (⌘\\)"
          }
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-pressed={sidebarCollapsed}
        >
          <Icon
            icon={sidebarCollapsed ? panelLeftOpen : panelLeftClose}
            size="sm"
            color="currentColor"
          />
        </button>
      )}

      <div className="fishbones__topbar-tabs" data-tauri-drag-region>
        {tabs.map((tab, i) => {
          const isActive = i === activeIndex;
          const isDragging = draggingIdx === i;
          const isDragOver = overIdx === i && draggingIdx !== null && draggingIdx !== i;
          // Compute drop-side hint: if the dragged tab is moving
          // FORWARD (source < target) the drop happens AFTER the
          // hovered tab, so we draw the indicator on its trailing
          // edge. Backward drags drop BEFORE the hovered tab.
          const dropAfter = isDragOver && draggingIdx !== null && draggingIdx < i;
          return (
            <button
              key={tab.id}
              className={[
                "fishbones__tab",
                isActive && "fishbones__tab--active",
                isDragging && "fishbones__tab--dragging",
                isDragOver && "fishbones__tab--drag-over",
                dropAfter && "fishbones__tab--drop-after",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onActivate(i)}
              draggable={reorderable}
              onDragStart={(e) => handleDragStart(i, e)}
              onDragOver={(e) => handleDragOver(i, e)}
              onDrop={(e) => handleDrop(i, e)}
              onDragEnd={handleDragEnd}
              data-tauri-drag-region={false}
            >
              <LanguageChip
                language={tab.language}
                size="xs"
                iconOnly
                className="fishbones__tab-lang"
              />
              <span className="fishbones__tab-label">{tab.label}</span>
              <span
                className="fishbones__tab-close"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(i);
                }}
              >
                <Icon icon={xIcon} size="xs" color="currentColor" />
              </span>
            </button>
          );
        })}
      </div>

      <div className="fishbones__topbar-actions">
        {/* Tip jar — inline dropdown with the dev's crypto wallets so
            learners on the desktop can chip in without leaving the
            app. The button intentionally sits left of the
            search/stats so it's not behind a Cmd/Ctrl-K-only path. */}
        <TipDropdown />

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
            history={history}
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

