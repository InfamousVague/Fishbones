import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { check } from "@base/primitives/icon/icons/check";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { trophy } from "@base/primitives/icon/icons/trophy";
import "@base/primitives/icon/icon.css";
import type { StreakAndXp } from "../../hooks/useStreakAndXp";
import type { Completion } from "../../hooks/useProgress";
import { ProgressRing } from "../Shared/ProgressRing";

/// Semantic color tokens for the stats chips. Each row's uppercase label
/// is tinted to match its icon so the eye pairs them at a glance. Kept
/// in lockstep with the same constant in TopBar.tsx — they share the
/// same visual language.
const STAT_COLORS = {
  streak: "#ff9b5e",   // warm orange — fire
  lessons: "#7cd97c",  // success green
  xp: "#e8c46b",       // warm gold
  longest: "#c79bff",  // soft purple — personal-record accent
} as const;

/// Combined streak + level chip with a dropdown detail panel. Chip shows
/// streak flame + a small circular progress ring whose fill is XP-into-
/// current-level. Clicking expands a panel with the full numbers AND the
/// account row (sign-in / sign-out).
export default function StatsChip({
  stats,
  history,
  onOpenProfile,
  signedIn,
  userDisplayName,
  userEmail,
  onSignIn,
  onSignOut,
}: {
  stats: StreakAndXp;
  history?: Completion[];
  onOpenProfile?: () => void;
  signedIn?: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
  onSignIn?: () => void;
  onSignOut?: () => void;
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

  /// 4-week mini heatmap. Calendar-aligned: each column = one Sun–Sat
  /// week, so rows correspond to stable weekdays. Future days in the
  /// current week render as invisible padding so today lands at its
  /// correct weekday row instead of the bottom of the column. Same
  /// rendering approach as the Profile page's full 20-week grid, just
  /// 4 weeks and 8px cells.
  const miniHeatmap = useMemo(() => {
    if (!history || history.length === 0) return null;
    const counts = new Map<string, number>();
    for (const c of history) {
      const d = new Date(c.completed_at * 1000);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      counts.set(
        `${d.getFullYear()}-${m}-${day}`,
        (counts.get(`${d.getFullYear()}-${m}-${day}`) ?? 0) + 1,
      );
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDow = today.getDay();
    const start = new Date(today);
    // 4-week calendar window ending in the current week.
    start.setDate(start.getDate() - todayDow - 3 * 7);
    const cells: Array<{
      key: string;
      count: number;
      label: string;
      isPad: boolean;
    }> = [];
    let activeDays = 0;
    for (let i = 0; i < 4 * 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d > today) {
        cells.push({ key: `pad-${i}`, count: 0, label: "", isPad: true });
        continue;
      }
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = `${d.getFullYear()}-${m}-${day}`;
      const count = counts.get(key) ?? 0;
      if (count > 0) activeDays += 1;
      cells.push({
        key,
        count,
        label: `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${count}`,
        isPad: false,
      });
    }
    const peak = Math.max(1, ...cells.map((c) => c.count));
    return { cells, peak, activeDays };
  }, [history]);

  /// Next-milestone hint. Picks the closest still-locked achievement
  /// from the same set the Profile page renders, so the dropdown
  /// always points at "the next thing to unlock". Falls back silently
  /// when every milestone is unlocked.
  const nextMilestone = useMemo(() => {
    const targets: Array<{ label: string; target: number; actual: number; unit: string }> = [
      { label: "First lesson", target: 1, actual: stats.lessonsCompleted, unit: "lesson" },
      { label: "Ten lessons", target: 10, actual: stats.lessonsCompleted, unit: "lessons" },
      { label: "Century", target: 100, actual: stats.lessonsCompleted, unit: "lessons" },
      { label: "3-day streak", target: 3, actual: Math.max(stats.streakDays, stats.longestStreakDays), unit: "days" },
      { label: "Week strong", target: 7, actual: Math.max(stats.streakDays, stats.longestStreakDays), unit: "days" },
      { label: "Iron habit", target: 30, actual: Math.max(stats.streakDays, stats.longestStreakDays), unit: "days" },
      { label: "Apprentice", target: 5, actual: stats.level, unit: "level" },
      { label: "Adept", target: 10, actual: stats.level, unit: "level" },
      { label: "Mastered", target: 20, actual: stats.level, unit: "level" },
      { label: "1k XP", target: 1000, actual: stats.xp, unit: "XP" },
      { label: "10k XP", target: 10000, actual: stats.xp, unit: "XP" },
    ];
    // Closest = smallest remaining gap (target - actual), among locked.
    let best: typeof targets[number] | null = null;
    let bestGap = Infinity;
    for (const t of targets) {
      if (t.actual >= t.target) continue;
      const gap = t.target - t.actual;
      if (gap < bestGap) {
        bestGap = gap;
        best = t;
      }
    }
    return best;
  }, [stats]);

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
          {/* Hero row. The ring's centre already shows the level
              number, so the right-hand body promotes the SIGNED-IN
              identity (name + email) instead of duplicating "Level N"
              as a heading. When the learner is signed out, we fall
              back to a plain Level heading so the row still has
              something to anchor against the ring. */}
          <div className="fishbones__topbar-stats-hero">
            <ProgressRing
              progress={levelProgress}
              size={72}
              stroke={5}
              label={String(stats.level)}
              sublabel="level"
            />
            <div className="fishbones__topbar-stats-hero-body">
              {signedIn === true && (userDisplayName?.trim() || userEmail) ? (
                <>
                  <div className="fishbones__topbar-stats-heading">
                    {userDisplayName?.trim() || userEmail}
                  </div>
                  {userEmail && userDisplayName?.trim() && (
                    <div className="fishbones__topbar-stats-sub">{userEmail}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="fishbones__topbar-stats-heading">Level {stats.level}</div>
                  <div className="fishbones__topbar-stats-sub">
                    {stats.xpIntoLevel} / {stats.xpForLevel} XP
                  </div>
                </>
              )}
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

          {/* 4-week mini heatmap. Calendar-aligned, same 5-level
              ramp as the Profile page's full grid. The header shows
              the active-days count so the dropdown answers "is this
              real data?" without leaving the bar. View Profile
              upgrades to the full 20-week grid + per-language chart
              + badges. Hidden when `history` isn't wired. */}
          {miniHeatmap && (
            <div
              className="fishbones__topbar-stats-mini-heat"
              aria-label="Activity over the last 4 weeks"
            >
              <div className="fishbones__topbar-stats-mini-heat-head">
                <span className="fishbones__topbar-stats-mini-heat-label">
                  Recent activity
                </span>
                <span className="fishbones__topbar-stats-mini-heat-count">
                  {miniHeatmap.activeDays === 0
                    ? "no activity yet"
                    : `${miniHeatmap.activeDays} active day${miniHeatmap.activeDays === 1 ? "" : "s"} · last 4 weeks`}
                </span>
              </div>
              <div className="fishbones__topbar-stats-mini-heat-body">
                <div className="fishbones__topbar-stats-mini-heat-rowlabels" aria-hidden>
                  <span />
                  <span>M</span>
                  <span />
                  <span>W</span>
                  <span />
                  <span>F</span>
                  <span />
                </div>
                <div className="fishbones__topbar-stats-mini-heat-grid">
                  {miniHeatmap.cells.map((c: { key: string; count: number; label: string; isPad: boolean }) => {
                    if (c.isPad) {
                      return (
                        <span
                          key={c.key}
                          className="fishbones__topbar-stats-mini-heat-cell fishbones__topbar-stats-mini-heat-cell--pad"
                          aria-hidden
                        />
                      );
                    }
                    const lvl =
                      c.count <= 0
                        ? 0
                        : c.count >= miniHeatmap.peak
                        ? 4
                        : c.count / miniHeatmap.peak >= 0.7
                        ? 4
                        : c.count / miniHeatmap.peak >= 0.45
                        ? 3
                        : c.count / miniHeatmap.peak >= 0.2
                        ? 2
                        : 1;
                    return (
                      <span
                        key={c.key}
                        className={`fishbones__topbar-stats-mini-heat-cell fishbones__topbar-stats-mini-heat-cell--lvl-${lvl}`}
                        title={c.label}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Next-milestone teaser — points the learner at the closest
              still-locked achievement so the View Profile button has
              a concrete reward attached to it. Hidden when every
              milestone is unlocked. */}
          {nextMilestone && (
            <div className="fishbones__topbar-stats-next">
              <span className="fishbones__topbar-stats-next-label">Next</span>
              <span className="fishbones__topbar-stats-next-name">
                {nextMilestone.label}
              </span>
              <span className="fishbones__topbar-stats-next-progress">
                {nextMilestone.actual}/{nextMilestone.target}{" "}
                <span className="fishbones__topbar-stats-next-unit">
                  {nextMilestone.unit}
                </span>
              </span>
            </div>
          )}

          {/* Account row + View-profile CTA, anchored to the bottom of
              the popup. When the learner is signed out, "Sign in"
              becomes the primary call-to-action and "View profile"
              steps down to a secondary outline; when they're signed in,
              the identity + a quiet "Sign out" link replaces the row
              and "View profile" goes back to primary. */}
          {signedIn === false && onSignIn && (
            <div className="fishbones__topbar-stats-account">
              <div className="fishbones__topbar-stats-account-row">
                <button
                  type="button"
                  className="fishbones__topbar-stats-signin"
                  onClick={() => {
                    setOpen(false);
                    onSignIn();
                  }}
                >
                  Sign in
                </button>
                {onOpenProfile && (
                  <button
                    type="button"
                    className="fishbones__topbar-stats-view-profile fishbones__topbar-stats-view-profile--secondary"
                    onClick={() => {
                      setOpen(false);
                      onOpenProfile();
                    }}
                  >
                    View profile
                  </button>
                )}
              </div>
            </div>
          )}

          {signedIn === true && (
            <div className="fishbones__topbar-stats-account">
              {/* Identity card removed from this row — the hero block
                  above promotes name + email next to the level ring,
                  so duplicating it here was just visual noise. */}
              <div className="fishbones__topbar-stats-account-row">
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
                {onSignOut && (
                  <button
                    type="button"
                    className="fishbones__topbar-stats-signout"
                    onClick={() => {
                      setOpen(false);
                      onSignOut();
                    }}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Fallback for embeds that don't wire `signedIn` at all —
              keeps the old single-CTA shape so non-Tauri builds aren't
              broken. */}
          {signedIn === undefined && onOpenProfile && (
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
