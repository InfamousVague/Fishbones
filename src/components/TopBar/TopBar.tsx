import { useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { check } from "@base/primitives/icon/icons/check";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { panelLeftClose } from "@base/primitives/icon/icons/panel-left-close";
import { panelLeftOpen } from "@base/primitives/icon/icons/panel-left-open";
import "@base/primitives/icon/icon.css";
import type { StreakAndXp } from "../../hooks/useStreakAndXp";
import { ProgressRing } from "../Shared/ProgressRing";
import "./TopBar.css";

/// Semantic color tokens for the stats chips. Each row's uppercase label
/// is tinted to match its icon so the eye pairs them at a glance.
const STAT_COLORS = {
  streak: "#ff9b5e",   // warm orange — fire
  lessons: "#7cd97c",  // success green
  xp: "#e8c46b",       // warm gold
  longest: "#c79bff",  // soft purple — personal-record accent
} as const;

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
  /// Learner's current streak + XP. Combined into a single trigger chip
  /// in the top bar — click to expand a detail dropdown. Hidden entirely
  /// when the learner hasn't completed anything yet.
  stats?: StreakAndXp;
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
  stats,
  onOpenProfile,
  sidebarCollapsed = false,
  onToggleSidebar,
}: Props) {
  const showStats = !!stats && stats.lessonsCompleted > 0;

  return (
    <div className="fishbones__topbar" data-tauri-drag-region>
      {/* Reserved space for macOS traffic lights (they overlay this area). */}
      <div className="fishbones__topbar-window-controls" data-tauri-drag-region />

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
        {tabs.length > 0 && (
          <span className="fishbones__topbar-tabs-label" aria-hidden>
            Recents
          </span>
        )}
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            className={`fishbones__tab ${i === activeIndex ? "fishbones__tab--active" : ""}`}
            onClick={() => onActivate(i)}
          >
            <span className="fishbones__tab-lang">{langBadge(tab.language)}</span>
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
        ))}
      </div>

      <div className="fishbones__topbar-actions">
        {showStats && (
          <StatsChip stats={stats!} onOpenProfile={onOpenProfile} />
        )}
      </div>
    </div>
  );
}

/// Combined streak + level chip with a dropdown detail panel. Chip shows
/// streak flame + a small circular progress ring whose fill is XP-into-
/// current-level. Clicking expands a panel with the full numbers.
function StatsChip({
  stats,
  onOpenProfile,
}: {
  stats: StreakAndXp;
  onOpenProfile?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + escape dismissal.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const levelProgress =
    stats.xpForLevel > 0 ? stats.xpIntoLevel / stats.xpForLevel : 0;
  const streakActive = stats.streakDays >= 1;
  const xpToNext = Math.max(0, stats.xpForLevel - stats.xpIntoLevel);

  return (
    <div
      className="fishbones__topbar-stats-wrap"
      ref={wrapRef}
      data-tauri-drag-region={false}
    >
      <button
        className={`fishbones__topbar-stats-trigger ${
          open ? "fishbones__topbar-stats-trigger--open" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        title={`Level ${stats.level} · ${stats.streakDays} day streak`}
      >
        <span
          className={`fishbones__topbar-streak ${
            streakActive ? "fishbones__topbar-streak--active" : ""
          }`}
        >
          <span className="fishbones__topbar-streak-flame" aria-hidden>
            <Icon icon={flame} size="xs" color="currentColor" weight="bold" />
          </span>
          <span className="fishbones__topbar-streak-count">{stats.streakDays}</span>
        </span>
        <ProgressRing
          progress={levelProgress}
          size={22}
          stroke={2.5}
          label={String(stats.level)}
        />
      </button>

      {open && (
        <div className="fishbones__topbar-stats-panel" role="dialog" aria-label="Progress stats">
          <div className="fishbones__topbar-stats-hero">
            <ProgressRing
              progress={levelProgress}
              size={72}
              stroke={5}
              label={String(stats.level)}
              sublabel="level"
            />
            <div className="fishbones__topbar-stats-hero-body">
              <div className="fishbones__topbar-stats-heading">Level {stats.level}</div>
              <div className="fishbones__topbar-stats-sub">
                {stats.xpIntoLevel} / {stats.xpForLevel} XP
              </div>
              <div className="fishbones__topbar-stats-to-next">
                {xpToNext === 0
                  ? "Ready to level up — complete any lesson!"
                  : `${xpToNext} XP to level ${stats.level + 1}`}
              </div>
            </div>
          </div>

          <div className="fishbones__topbar-stats-divider" aria-hidden />

          <div className="fishbones__topbar-stats-grid">
            <StatBlock
              icon={flame}
              color={STAT_COLORS.streak}
              label={streakActive ? "Current streak" : "Streak"}
              value={`${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`}
              hint={
                stats.longestStreakDays > stats.streakDays
                  ? `best · ${stats.longestStreakDays} days`
                  : streakActive
                  ? "keep it going"
                  : "complete a lesson today to start"
              }
            />
            <StatBlock
              icon={check}
              color={STAT_COLORS.lessons}
              label="Lessons done"
              value={String(stats.lessonsCompleted)}
              hint="across all courses"
            />
            <StatBlock
              icon={sparkles}
              color={STAT_COLORS.xp}
              label="Total XP"
              value={String(stats.xp)}
              hint="5 reading · 10 quiz · 20 exercise"
            />
            <StatBlock
              icon={trophy}
              color={STAT_COLORS.longest}
              label="Longest streak"
              value={`${stats.longestStreakDays} ${
                stats.longestStreakDays === 1 ? "day" : "days"
              }`}
              hint="personal record"
            />
          </div>

          {/* Full-width CTA anchoring the bottom of the popup. Dropping into
              the Profile view gives the learner a natural "show me the
              full story" escape hatch after skimming the summary above. */}
          {onOpenProfile && (
            <button
              type="button"
              className="fishbones__topbar-stats-view-profile"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
            >
              View profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatBlock({
  icon,
  color,
  label,
  value,
  hint,
}: {
  icon: string;
  /// Hex color used for BOTH the icon and the uppercase label text so the
  /// visual pairing is obvious. The big value + hint stay in their
  /// neutral token colors so rows don't become overwhelming.
  color: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="fishbones__topbar-stats-block">
      <div className="fishbones__topbar-stats-block-label" style={{ color }}>
        <span className="fishbones__topbar-stats-block-icon" aria-hidden>
          <Icon icon={icon} size="xs" color="currentColor" weight="bold" />
        </span>
        {label}
      </div>
      <div className="fishbones__topbar-stats-block-value">{value}</div>
      <div className="fishbones__topbar-stats-block-hint">{hint}</div>
    </div>
  );
}

function langBadge(language: string): string {
  switch (language) {
    case "javascript":
    case "typescript":
      return "JS";
    case "python":
      return "PY";
    case "rust":
      return "RS";
    case "swift":
      return "SW";
    case "go":
      return "GO";
    default:
      return language.slice(0, 2).toUpperCase();
  }
}
