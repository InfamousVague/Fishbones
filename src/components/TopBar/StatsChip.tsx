import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { useHapticOnChange } from "../../hooks/useHaptic";
import { useSoundOnChange } from "../../hooks/useSoundOnChange";
import { flame } from "@base/primitives/icon/icons/flame";
import { check } from "@base/primitives/icon/icons/check";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { snowflake } from "@base/primitives/icon/icons/snowflake";
import "@base/primitives/icon/icon.css";
import type { StreakAndXp } from "../../hooks/useStreakAndXp";
import type { Completion } from "../../hooks/useProgress";
import {
  localDayKey,
  type StreakShieldsState,
} from "../../hooks/useStreakShields";
import { ProgressRing } from "../Shared/ProgressRing";
import { useT } from "../../i18n/i18n";

/// Semantic color tokens for the stats chips. Each row's uppercase label
/// is tinted to match its icon so the eye pairs them at a glance. Kept
/// in lockstep with the same constant in TopBar.tsx — they share the
/// same visual language.
const STAT_COLORS = {
  streak: "#ff9b5e",   // warm orange — fire
  lessons: "#7cd97c",  // success green
  xp: "#e8c46b",       // warm gold
  longest: "#c79bff",  // soft purple — personal-record accent
  freeze: "#7fc8ff",   // pale blue — ice / streak shield
} as const;

/// Combined streak + level chip with a dropdown detail panel. Chip shows
/// streak flame + a small circular progress ring whose fill is XP-into-
/// current-level. Clicking expands a panel with the full numbers AND the
/// account row (sign-in / sign-out).
export default function StatsChip({
  stats,
  statsReady = true,
  history,
  shields,
  onOpenProfile,
  signedIn,
  userDisplayName,
  userEmail,
  onSignIn,
  onSignOut,
}: {
  stats: StreakAndXp;
  /// True once the data `stats` is derived from (courses + completion
  /// history) has loaded. The streak/level cues below gate on this so
  /// the 0 → real hydration on app launch is absorbed as the baseline
  /// instead of firing a celebratory sound/haptic on every load.
  statsReady?: boolean;
  history?: Completion[];
  /// Streak-shield state. When wired, the dropdown renders a small
  /// "freezes" panel showing how many shields remain this week + a
  /// "Freeze yesterday" button that surfaces only when the streak is
  /// in jeopardy (no completion yesterday + the day isn't already
  /// frozen). Omit on embeds that don't ship the shield hook.
  shields?: StreakShieldsState;
  onOpenProfile?: () => void;
  signedIn?: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
  onSignIn?: () => void;
  onSignOut?: () => void;
}) {
  const t = useT();
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

  // Streak crescendo + level-up celebration on increase. The
  // `when` predicate ensures we only fire on increases — a
  // reset (streak broken) wouldn't be a celebratory moment.
  // skipInitial keeps the haptic from firing on every mount
  // (the chip re-mounts whenever the topbar route re-renders).
  useHapticOnChange(stats.streakDays, "streak-bump", {
    when: (prev, next) => next > prev,
    ready: statsReady,
  });
  useHapticOnChange(stats.level, "level-up", {
    when: (prev, next) => next > prev,
    ready: statsReady,
  });
  // Sound counterparts for the streak. The `streak-tick`/`streak-flame`
  // cues existed in sfx but were never wired to anything. A milestone
  // day gets the fuller `streak-flame`; an ordinary day-flip gets the
  // soft `streak-tick`. Level-up's SOUND already fires from
  // useAchievements, so it isn't duplicated here (only the haptic above).
  const streakMilestones = [3, 7, 14, 30, 50, 100, 365];
  useSoundOnChange(stats.streakDays, "streak-tick", {
    when: (prev, next) => next > prev && !streakMilestones.includes(next),
    ready: statsReady,
  });
  useSoundOnChange(stats.streakDays, "streak-flame", {
    when: (prev, next) => next > prev && streakMilestones.includes(next),
    ready: statsReady,
  });
  // Streak BROKEN — the candle blow-out. Fires when the computed
  // streak drops mid-session (first completion after missed days
  // resets it to 1, or the day rolls over past a grace window).
  // `prev >= 2` so going 0 → 1 → … never reads as a loss.
  useSoundOnChange(stats.streakDays, "flame-out", {
    increaseOnly: false,
    when: (prev, next) => next < prev && prev >= 2,
    ready: statsReady,
  });

  /// Freeze-affordance state. The "Freeze yesterday" CTA shows only when:
  ///   - shields are wired,
  ///   - the learner has at least one shield available this week,
  ///   - they had a completion today OR yesterday already (no point
  ///     freezing into the void — without an adjacent real day there's
  ///     no streak to preserve),
  ///   - yesterday has no real completion (otherwise the freeze is a
  ///     no-op — the streak is already alive),
  ///   - and yesterday isn't already frozen.
  ///
  /// The 1-day grace baked into `computeStreaks` means a streak survives
  /// one missed day on its own. The shield only becomes useful when the
  /// learner is about to run out of grace — i.e. they're staring at the
  /// app TODAY without having practiced YESTERDAY and don't want to
  /// scramble a lesson in to keep the run alive.
  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDayKey(d);
  }, []);
  const todayKey = useMemo(() => localDayKey(new Date()), []);
  const yesterdayHasCompletion = useMemo(() => {
    if (!history || history.length === 0) return false;
    for (const c of history) {
      const d = new Date(c.completed_at * 1000);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      if (`${d.getFullYear()}-${m}-${day}` === yesterdayKey) return true;
    }
    return false;
  }, [history, yesterdayKey]);
  const todayHasCompletion = useMemo(() => {
    if (!history || history.length === 0) return false;
    for (const c of history) {
      const d = new Date(c.completed_at * 1000);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      if (`${d.getFullYear()}-${m}-${day}` === todayKey) return true;
    }
    return false;
  }, [history, todayKey]);
  const yesterdayFrozen = !!shields?.frozenDays.has(yesterdayKey);
  const canFreezeYesterday =
    !!shields &&
    shields.available > 0 &&
    streakActive &&
    !yesterdayHasCompletion &&
    !yesterdayFrozen &&
    // Only worth offering when yesterday is actually adjacent to a real
    // active day — either today already has a completion, or the streak
    // engine is currently surviving on yesterday-grace alone (which we
    // detect by streakActive + no-completion-today: the run is hanging
    // on by its fingernails and a freeze locks it in).
    (todayHasCompletion || stats.streakDays >= 1);
  const usedShields =
    shields ? shields.perWeek - shields.available : 0;
  const frozenDayCount = shields?.frozenDays.size ?? 0;

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

  return (
    <div
      className="libre__topbar-stats-wrap"
      ref={wrapRef}
      data-tauri-drag-region={false}
    >
      <button
        className={`libre__topbar-stats-trigger ${
          open ? "libre__topbar-stats-trigger--open" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        title={t("stats.triggerTitle", { level: stats.level, days: stats.streakDays })}
      >
        <span
          className={`libre__topbar-streak ${
            streakActive ? "libre__topbar-streak--active" : ""
          }`}
        >
          <span className="libre__topbar-streak-flame" aria-hidden>
            <Icon icon={flame} size="xs" color="currentColor" weight="bold" />
          </span>
          <span className="libre__topbar-streak-count">{stats.streakDays}</span>
          {/* Tiny snowflake when at least one day in the current run was
              shield-frozen — surfaces the protected state at a glance
              without forcing the learner to open the dropdown. */}
          {frozenDayCount > 0 && (
            <span
              className="libre__topbar-streak-frozen"
              aria-label={t(
                frozenDayCount === 1 ? "stats.daysFrozen" : "stats.daysFrozenPlural",
                { n: frozenDayCount },
              )}
              title={t(
                frozenDayCount === 1 ? "stats.daysFrozen" : "stats.daysFrozenPlural",
                { n: frozenDayCount },
              )}
            >
              <Icon icon={snowflake} size="xs" color="currentColor" weight="bold" />
            </span>
          )}
        </span>
        <ProgressRing
          progress={levelProgress}
          size={22}
          stroke={2.5}
          label={String(stats.level)}
        />
      </button>

      {open && (
        <div className="libre__topbar-stats-panel" role="dialog" aria-label={t("stats.progressStats")}>
          {/* Hero row. The ring's centre already shows the level
              number, so the right-hand body promotes the SIGNED-IN
              identity (name + email) instead of duplicating "Level N"
              as a heading. When the learner is signed out, we fall
              back to a plain Level heading so the row still has
              something to anchor against the ring. */}
          <div className="libre__topbar-stats-hero">
            <ProgressRing
              progress={levelProgress}
              size={72}
              stroke={5}
              label={String(stats.level)}
              sublabel={t("stats.level")}
            />
            <div className="libre__topbar-stats-hero-body">
              {signedIn === true && (userDisplayName?.trim() || userEmail) ? (
                <>
                  <div className="libre__topbar-stats-heading">
                    {userDisplayName?.trim() || userEmail}
                  </div>
                  {userEmail && userDisplayName?.trim() && (
                    <div className="libre__topbar-stats-sub">{userEmail}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="libre__topbar-stats-heading">
                    {t("stats.levelHeading", { level: stats.level })}
                  </div>
                  <div className="libre__topbar-stats-sub">
                    {t("stats.xpProgress", { into: stats.xpIntoLevel, forLevel: stats.xpForLevel })}
                  </div>
                </>
              )}
              <div className="libre__topbar-stats-to-next">
                {xpToNext === 0
                  ? t("stats.readyLevelUp")
                  : t("stats.xpToNext", { xp: xpToNext, level: stats.level + 1 })}
              </div>
            </div>
          </div>

          <div className="libre__topbar-stats-divider" aria-hidden />

          <div className="libre__topbar-stats-grid">
            <StatBlock
              icon={flame}
              color={STAT_COLORS.streak}
              label={streakActive ? t("stats.currentStreak") : t("stats.streakLabel")}
              value={`${stats.streakDays} ${stats.streakDays === 1 ? t("stats.day") : t("stats.days")}`}
              hint={
                stats.longestStreakDays > stats.streakDays
                  ? t("stats.bestStreak", { n: stats.longestStreakDays })
                  : streakActive
                  ? t("stats.keepGoing")
                  : t("stats.completeToStart")
              }
            />
            <StatBlock
              icon={check}
              color={STAT_COLORS.lessons}
              label={t("stats.lessonsDone")}
              value={String(stats.lessonsCompleted)}
              hint={t("stats.acrossAllCourses")}
            />
            <StatBlock
              icon={sparkles}
              color={STAT_COLORS.xp}
              label={t("stats.totalXp")}
              value={String(stats.xp)}
              hint={t("stats.xpScheme")}
            />
            <StatBlock
              icon={trophy}
              color={STAT_COLORS.longest}
              label={t("stats.longestStreak")}
              value={`${stats.longestStreakDays} ${
                stats.longestStreakDays === 1 ? t("stats.day") : t("stats.days")
              }`}
              hint={t("stats.personalRecord")}
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
              className="libre__topbar-stats-mini-heat"
              aria-label={t("stats.activityAria")}
            >
              <div className="libre__topbar-stats-mini-heat-head">
                <span className="libre__topbar-stats-mini-heat-label">
                  {t("stats.recentActivity")}
                </span>
                <span className="libre__topbar-stats-mini-heat-count">
                  {miniHeatmap.activeDays === 0
                    ? t("stats.noActivity")
                    : t(
                        miniHeatmap.activeDays === 1
                          ? "stats.activeDays"
                          : "stats.activeDaysPlural",
                        { n: miniHeatmap.activeDays },
                      )}
                </span>
              </div>
              <div className="libre__topbar-stats-mini-heat-body">
                <div className="libre__topbar-stats-mini-heat-rowlabels" aria-hidden>
                  <span />
                  <span>M</span>
                  <span />
                  <span>W</span>
                  <span />
                  <span>F</span>
                  <span />
                </div>
                <div className="libre__topbar-stats-mini-heat-grid">
                  {miniHeatmap.cells.map((c: { key: string; count: number; label: string; isPad: boolean }) => {
                    if (c.isPad) {
                      return (
                        <span
                          key={c.key}
                          className="libre__topbar-stats-mini-heat-cell libre__topbar-stats-mini-heat-cell--pad"
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
                        className={`libre__topbar-stats-mini-heat-cell libre__topbar-stats-mini-heat-cell--lvl-${lvl}`}
                        title={c.label}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Streak shield panel. Only renders when `shields` is wired
              (the desktop / iOS hook). Shows the per-week budget as a
              row of pip dots — filled = used, hollow = available — plus
              a CTA to freeze yesterday when the streak is on the brink.
              Position chosen so it sits adjacent to the streak stat
              block above it without competing with the View-profile
              CTA below. */}
          {shields && (
            <div
              className="libre__topbar-stats-freeze"
              aria-label={t("stats.streakShieldsAria")}
            >
              <div className="libre__topbar-stats-freeze-head">
                <span
                  className="libre__topbar-stats-freeze-icon"
                  style={{ color: STAT_COLORS.freeze }}
                  aria-hidden
                >
                  <Icon icon={snowflake} size="xs" color="currentColor" weight="bold" />
                </span>
                <span className="libre__topbar-stats-freeze-label">
                  {t("stats.streakShieldsLabel")}
                </span>
                <span className="libre__topbar-stats-freeze-count">
                  {t("stats.shieldsCount", { available: shields.available, perWeek: shields.perWeek })}
                </span>
              </div>
              <div className="libre__topbar-stats-freeze-pips" aria-hidden>
                {Array.from({ length: shields.perWeek }).map((_, i) => (
                  <span
                    key={i}
                    className={`libre__topbar-stats-freeze-pip ${
                      i < usedShields
                        ? "libre__topbar-stats-freeze-pip--used"
                        : ""
                    }`}
                  />
                ))}
              </div>
              <div className="libre__topbar-stats-freeze-hint">
                {canFreezeYesterday
                  ? t("stats.hintCanFreeze")
                  : yesterdayFrozen
                  ? t("stats.hintYesterdayFrozen")
                  : shields.available === 0
                  ? t("stats.hintNoShields")
                  : todayHasCompletion
                  ? t("stats.hintTodayActive")
                  : t("stats.hintRefillsMonday")}
              </div>
              {canFreezeYesterday && (
                <button
                  type="button"
                  className="libre__topbar-stats-freeze-btn"
                  onClick={() => {
                    shields.freezeDay(yesterdayKey);
                  }}
                >
                  <Icon icon={snowflake} size="xs" color="currentColor" weight="bold" />
                  <span>{t("stats.freezeYesterday")}</span>
                </button>
              )}
            </div>
          )}

          {/* Account row + View-profile CTA, anchored to the bottom of
              the popup. When the learner is signed out, "Sign in"
              becomes the primary call-to-action and "View profile"
              steps down to a secondary outline; when they're signed in,
              the identity + a quiet "Sign out" link replaces the row
              and "View profile" goes back to primary. */}
          {signedIn === false && onSignIn && (
            <div className="libre__topbar-stats-account">
              <div className="libre__topbar-stats-account-row">
                <button
                  type="button"
                  className="libre__topbar-stats-signin"
                  onClick={() => {
                    setOpen(false);
                    onSignIn();
                  }}
                >
                  {t("auth.signIn")}
                </button>
                {onOpenProfile && (
                  <button
                    type="button"
                    className="libre__topbar-stats-view-profile libre__topbar-stats-view-profile--secondary"
                    onClick={() => {
                      setOpen(false);
                      onOpenProfile();
                    }}
                  >
                    {t("stats.viewProfile")}
                  </button>
                )}
              </div>
            </div>
          )}

          {signedIn === true && (
            <div className="libre__topbar-stats-account">
              {/* Identity card removed from this row — the hero block
                  above promotes name + email next to the level ring,
                  so duplicating it here was just visual noise. */}
              <div className="libre__topbar-stats-account-row">
                {onOpenProfile && (
                  <button
                    type="button"
                    className="libre__topbar-stats-view-profile"
                    onClick={() => {
                      setOpen(false);
                      onOpenProfile();
                    }}
                  >
                    {t("stats.viewProfile")}
                  </button>
                )}
                {onSignOut && (
                  <button
                    type="button"
                    className="libre__topbar-stats-signout"
                    onClick={() => {
                      setOpen(false);
                      onSignOut();
                    }}
                  >
                    {t("auth.signOut")}
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
              className="libre__topbar-stats-view-profile"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
            >
              {t("stats.viewProfile")}
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
  span,
}: {
  icon: string;
  /// Hex color used for BOTH the icon and the uppercase label text so the
  /// visual pairing is obvious. The big value + hint stay in their
  /// neutral token colors so rows don't become overwhelming.
  color: string;
  label: string;
  value: string;
  hint: string;
  /// When true, the block stretches across all columns of the parent
  /// grid (used for the coins "wallet" footer so it doesn't strand a
  /// lonely 5th item in the 2-col layout). The hint also gets to wrap
  /// freely instead of being clipped to a single ellipsised line.
  span?: boolean;
}) {
  return (
    <div
      className="libre__topbar-stats-block"
      style={span ? { gridColumn: "1 / -1" } : undefined}
    >
      <div className="libre__topbar-stats-block-label" style={{ color }}>
        <span className="libre__topbar-stats-block-icon" aria-hidden>
          <Icon icon={icon} size="xs" color="currentColor" weight="bold" />
        </span>
        {label}
      </div>
      <div className="libre__topbar-stats-block-value">{value}</div>
      <div
        className="libre__topbar-stats-block-hint"
        style={span ? { whiteSpace: "normal" } : undefined}
      >
        {hint}
      </div>
    </div>
  );
}
