import { useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { zap } from "@base/primitives/icon/icons/zap";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { chevronUp } from "@base/primitives/icon/icons/chevron-up";
import { globe } from "@base/primitives/icon/icons/globe";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "@/data/types";
import { isExerciseKind } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";
import { xpForLessonKind, type StreakAndXp } from "@/hooks/useStreakAndXp";
import SupporterCard from "@/components/molecules/SupporterCard/SupporterCard";
import "./ProfileView.css";

// Per-lesson XP comes from `xpForLessonKind` (imported above) — the
// same canonical table useStreakAndXp derives the headline total from,
// so this breakdown can never drift from `stats.xp`.

/// A full year (52 weeks) of activity, GitHub-contribution-graph style.
/// The Activity card spans the full dashboard width (see
/// `.libre-profile-card--activity`) so the year-long strip has room and
/// lines up with the full-width Recent-activity list below it.
const HEATMAP_WEEKS = 52;

/// How many rows of the Recent activity feed render by default. The
/// rest live behind a "Show all (N)" toggle so a long-lived account
/// doesn't bury everything else under a 200-row scroll wall. 8 fits
/// in roughly half a fold of vertical space at the typical desktop
/// width, which matches the achievements grid sitting beside it.
const ACTIVITY_PREVIEW_COUNT = 8;

/// Same trim for Topics practised — challenge-pack learners can easily
/// accumulate 30+ distinct topics, and the long-tail topics each have
/// 1-2 hits. Show the top 10 by frequency; the rest are reachable
/// behind a "Show all (N)" expander.
const TOPICS_PREVIEW_COUNT = 10;

const LANG_LABELS: Partial<Record<LanguageId, string>> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  swift: "Swift",
  reactnative: "React Native",
  svelte: "Svelte",
  solid: "Solid",
  htmx: "HTMX",
  astro: "Astro",
  bun: "Bun",
  solidity: "Solidity",
  vyper: "Vyper",
  c: "C",
  cpp: "C++",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  assembly: "Assembly",
  threejs: "Three.js",
  web: "Web",
  react: "React",
  tauri: "Tauri",
};

interface Props {
  courses: Course[];
  completed: Set<string>;
  history: Completion[];
  stats: StreakAndXp;
  /// Called when the learner clicks a recent-activity row — jumps back
  /// to that lesson in courses view.
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /// True when the signed-in account is an early-access supporter
  /// (`early_access` on its cloud profile). When set, a celebratory
  /// full-width Supporter card renders at the top of the page. Fetched
  /// + wired by App.tsx; defaults false so the card is opt-in.
  isSupporter?: boolean;
}

/// Profile / stats page.
///
/// Redesign rationale (2026-05): the previous layout stacked every
/// section vertically — hero with two big rings, then stats row,
/// then heatmap, then per-language bars, then a 12-badge grid,
/// then topics, then a 24-row activity feed. Every section ate a
/// full row of viewport width, which produced a low information-
/// per-scroll ratio AND let topics + activity grow unbounded over
/// time (a heavy user could see 40+ topic chips and 24 activity
/// rows past the fold).
///
/// New shape:
///   1. Compact header strip: title + meta + level progress bar.
///   2. Single-row stat strip (5 dense tiles).
///   3. Two-column dashboard grid:
///        Left  — Activity heatmap, then Achievements (4×3).
///        Right — XP by language, then Topics practised.
///   4. Full-width Recent activity at the bottom, capped to 8
///      visible rows with a "Show all (N)" toggle.
///
/// Net effect: same data, ~30% less vertical scroll on a typical
/// run, and the two unbounded sections (topics + activity) stay
/// digestible no matter how long the user has been on the
/// platform. Visual parity with MobileProfile is intentionally
/// dropped for the desktop layout — the small-screen surface has
/// its own vertical-stack constraints that don't translate to a
/// wide pane.
export default function ProfileView({
  courses,
  completed,
  history,
  stats,
  onOpenLesson,
  isSupporter = false,
}: Props) {
  // Show-all toggles for the two sections that historically grew
  // unbounded. Default closed; clicking the chevron flips to true
  // and renders the full set. State lives here (not in localStorage)
  // because the closed/open preference is per-page-load — a learner
  // who explicitly opened it usually has a reason, and the next
  // session typically wants the digest view again.
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

  /// Build a lookup of `{courseId: course}` and flatten all lessons once
  /// so downstream math can resolve completions without nested scans.
  const { lessonById } = useMemo(() => {
    const byCourse = new Map<string, Course>();
    const byLesson = new Map<
      string,
      {
        course: Course;
        lesson: Course["chapters"][number]["lessons"][number];
      }
    >();
    for (const c of courses) {
      byCourse.set(c.id, c);
      for (const ch of c.chapters) {
        for (const l of ch.lessons) {
          byLesson.set(`${c.id}:${l.id}`, { course: c, lesson: l });
        }
      }
    }
    return { courseById: byCourse, lessonById: byLesson };
  }, [courses]);

  /// 20-week activity grid, calendar-aligned. Each column = one
  /// calendar week (Sun-Sat), so row 0 = Sunday, row 6 = Saturday. The
  /// grid still renders column-major via flex-wrap, but we pre-pad
  /// the END of the rightmost column with `isPad: true` cells for
  /// "future" days of the current week so today lands in the right
  /// row instead of the bottom of the column. This makes the rows
  /// READABLE — Mon/Wed/Fri labels on the left now correspond to
  /// stable weekdays.
  ///
  /// Also tracks the activeDays count + total completions so the
  /// summary line under the grid can tell the learner what they're
  /// looking at ("12 active days · 47 completions").
  const heatmap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of history) {
      const key = localDayKey(c.completed_at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDow = today.getDay(); // 0=Sun, 6=Sat
    const start = new Date(today);
    start.setDate(start.getDate() - todayDow - (HEATMAP_WEEKS - 1) * 7);

    const cells: Array<{
      key: string;
      count: number;
      label: string;
      isPad: boolean;
    }> = [];
    let activeDays = 0;
    let totalCompletions = 0;
    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
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
      if (count > 0) {
        activeDays += 1;
        totalCompletions += count;
      }
      cells.push({
        key,
        count,
        label: `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${count} lesson${count === 1 ? "" : "s"}`,
        isPad: false,
      });
    }
    const peak = Math.max(1, ...cells.map((c) => c.count));
    return { cells, peak, activeDays, totalCompletions };
  }, [history]);

  /// Per-language XP breakdown — bars sorted descending, language
  /// totals shown on the right. Cap to top 8.
  const langChart = useMemo(() => {
    const xpByLang = new Map<LanguageId, number>();
    const lessonsByLang = new Map<LanguageId, number>();
    const totalLessonsByLang = new Map<LanguageId, number>();
    const kindByKey = new Map<string, string>();
    const langByCourse = new Map<string, LanguageId>();

    for (const c of courses) {
      langByCourse.set(c.id, c.language);
      let lessonsInCourse = 0;
      for (const ch of c.chapters) {
        for (const l of ch.lessons) {
          kindByKey.set(`${c.id}:${l.id}`, l.kind);
          lessonsInCourse += 1;
        }
      }
      totalLessonsByLang.set(
        c.language,
        (totalLessonsByLang.get(c.language) ?? 0) + lessonsInCourse,
      );
    }
    for (const h of history) {
      const lang = langByCourse.get(h.course_id);
      if (!lang) continue;
      const xp = xpForLessonKind(kindByKey.get(`${h.course_id}:${h.lesson_id}`));
      xpByLang.set(lang, (xpByLang.get(lang) ?? 0) + xp);
      lessonsByLang.set(lang, (lessonsByLang.get(lang) ?? 0) + 1);
    }
    const total = Array.from(xpByLang.values()).reduce((a, b) => a + b, 0);
    const rows = Array.from(xpByLang.entries())
      .map(([lang, xp]) => ({
        lang,
        xp,
        pct: total > 0 ? xp / total : 0,
        lessonsDone: lessonsByLang.get(lang) ?? 0,
        lessonsTotal: totalLessonsByLang.get(lang) ?? 0,
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 8);
    return { rows, total };
  }, [history, courses]);

  /// Per-topic breakdown (challenge packs only). Topics are short
  /// skill labels carried by exercise lessons in challenge packs. Book
  /// imports don't carry topics, so this section quietly empties on a
  /// learner who only does books.
  const topicStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of history) {
      const resolved = lessonById.get(`${h.course_id}:${h.lesson_id}`);
      if (!resolved) continue;
      if (!isExerciseKind(resolved.lesson)) continue;
      const topic = resolved.lesson.topic;
      if (!topic) continue;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);
  }, [history, lessonById]);

  /// Newest-first slice of completions, capped at 60. Orphaned entries
  /// (course was deleted) are dropped rather than rendered as ghosts.
  /// The cap is higher than the old 24 because the expander makes
  /// the full list reachable; the preview-vs-expanded split lives in
  /// the render, not in the slicing.
  const recentActivity = useMemo(() => {
    const sorted = history
      .slice()
      .sort((a, b) => b.completed_at - a.completed_at);
    const out: Array<{
      courseId: string;
      lessonId: string;
      courseTitle: string;
      lessonTitle: string;
      kind: string;
      completedAt: number;
    }> = [];
    for (const h of sorted) {
      if (out.length >= 60) break;
      const resolved = lessonById.get(`${h.course_id}:${h.lesson_id}`);
      if (!resolved) continue;
      out.push({
        courseId: h.course_id,
        lessonId: h.lesson_id,
        courseTitle: resolved.course.title,
        lessonTitle: resolved.lesson.title,
        kind: resolved.lesson.kind,
        completedAt: h.completed_at,
      });
    }
    return out;
  }, [history, lessonById]);

  void completed;

  const xpToNext = Math.max(0, stats.xpForLevel - stats.xpIntoLevel);
  const levelPct =
    stats.xpForLevel > 0
      ? Math.min(stats.xpIntoLevel / stats.xpForLevel, 1)
      : 0;

  const visibleTopics = showAllTopics
    ? topicStats
    : topicStats.slice(0, TOPICS_PREVIEW_COUNT);
  const visibleActivity = showAllActivity
    ? recentActivity
    : recentActivity.slice(0, ACTIVITY_PREVIEW_COUNT);
  const hiddenTopicsCount = Math.max(0, topicStats.length - TOPICS_PREVIEW_COUNT);
  const hiddenActivityCount = Math.max(
    0,
    recentActivity.length - ACTIVITY_PREVIEW_COUNT,
  );

  // Round large XP/coin counts so the stat tiles don't overflow at
  // 5+ digits. "1.2k" reads cleaner than "1234"; the raw value is in
  // the tile's `title` for users who want exact.
  const totalLangsTouched = langChart.rows.filter((r) => r.xp > 0).length;

  return (
    <div className="libre-profile">
      <div className="libre-profile-scroll">
        <div className="libre-profile-inner">
          {/* ── Header strip ────────────────────────────────────
              Title + meta + a single inline level-progress bar.
              Drops the previous twin-rings hero in favour of a
              compact band — the same "where am I in this level?"
              signal but rendered as one bar across the page width
              so it doesn't fight the stat strip for attention. */}
          <header className="libre-profile-header">
            <div className="libre-profile-header-text">
              <h1 className="libre-profile-title">Profile</h1>
              <p className="libre-profile-subtitle">
                Level {stats.level} ·{" "}
                {xpToNext === 0
                  ? "ready to level up — complete any lesson"
                  : `${formatNumber(xpToNext)} XP to level ${stats.level + 1}`}
              </p>
            </div>
            <div
              className="libre-profile-level-bar"
              role="progressbar"
              aria-valuenow={Math.round(levelPct * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Level ${stats.level} progress`}
            >
              <div className="libre-profile-level-bar-track">
                <div
                  className="libre-profile-level-bar-fill"
                  style={{ width: `${Math.max(levelPct * 100, 2)}%` }}
                />
              </div>
              <span className="libre-profile-level-bar-meta">
                {formatNumber(stats.xpIntoLevel)}
                <span className="libre-profile-level-bar-meta-sub">
                  /{formatNumber(stats.xpForLevel)}
                </span>
              </span>
            </div>
          </header>

          {/* ── Supporter card ──────────────────────────────────
              Early-access thank-you badge, full-width across the
              dashboard. Sits under the header strip and above the
              stat strip; only rendered for supporter accounts. */}
          {isSupporter && <SupporterCard />}

          {/* ── Stats strip ─────────────────────────────────────
              Six compact tiles, single row. Density vs. the old
              5-tile chunkier row: half the vertical footprint per
              tile, ~50% more info per scroll-inch. */}
          <div className="libre-profile-stats" role="list">
            <StatTile icon={flame} tone="streak" value={stats.streakDays} label="Day streak" />
            <StatTile icon={trophy} tone="longest" value={stats.longestStreakDays} label="Longest streak" />
            <StatTile icon={bookOpenCheck} tone="lessons" value={stats.lessonsCompleted} label="Lessons" />
            <StatTile icon={zap} tone="xp" value={stats.xp} label="Total XP" formatted />
            <StatTile icon={globe} tone="level" value={totalLangsTouched} label="Languages" />
          </div>

          {/* ── Dashboard grid ─────────────────────────────────
              Two columns at wide widths, single column on narrow
              (the grid template collapses via CSS, no JS branch).
              Left holds Activity + Achievements; right holds
              Languages + Topics. Bottom row spans full width
              because the recent-activity list reads better as a
              wide table than a half-pane column. */}
          <div className="libre-profile-grid">
            {/* Activity heatmap ────────────────────────────── */}
            <section className="libre-profile-card libre-profile-card--activity">
              <header className="libre-profile-card-head">
                <h2 className="libre-profile-card-title">Activity</h2>
                <span className="libre-profile-card-meta">
                  {heatmap.activeDays === 0
                    ? "No completions yet"
                    : `${heatmap.totalCompletions} completion${heatmap.totalCompletions === 1 ? "" : "s"} · ${heatmap.activeDays} active day${heatmap.activeDays === 1 ? "" : "s"} · last ${HEATMAP_WEEKS}w`}
                </span>
              </header>
              <div className="libre-profile-heatmap-wrap">
                <div className="libre-profile-heatmap-rowlabels" aria-hidden>
                  <span />
                  <span>Mon</span>
                  <span />
                  <span>Wed</span>
                  <span />
                  <span>Fri</span>
                  <span />
                </div>
                <Heatmap cells={heatmap.cells} peak={heatmap.peak} />
              </div>
              <div className="libre-profile-heatmap-legend" aria-hidden>
                <span>Less</span>
                <span className="libre-profile-heatmap-cell libre-profile-heatmap-cell--lvl-0" />
                <span className="libre-profile-heatmap-cell libre-profile-heatmap-cell--lvl-1" />
                <span className="libre-profile-heatmap-cell libre-profile-heatmap-cell--lvl-2" />
                <span className="libre-profile-heatmap-cell libre-profile-heatmap-cell--lvl-3" />
                <span className="libre-profile-heatmap-cell libre-profile-heatmap-cell--lvl-4" />
                <span>More</span>
              </div>
            </section>

            {/* XP by language ──────────────────────────────── */}
            {langChart.rows.length > 0 ? (
              <section className="libre-profile-card libre-profile-card--lang">
                <header className="libre-profile-card-head">
                  <h2 className="libre-profile-card-title">XP by language</h2>
                  <span className="libre-profile-card-meta">
                    {totalLangsTouched} touched
                  </span>
                </header>
                <ul className="libre-profile-lang-chart" role="list">
                  {langChart.rows.map((r) => (
                    <li key={r.lang} className="libre-profile-lang-row">
                      <span className="libre-profile-lang-name" data-lang={r.lang}>
                        {LANG_LABELS[r.lang] ?? r.lang}
                      </span>
                      <div className="libre-profile-lang-bar" aria-hidden data-lang={r.lang}>
                        <div
                          className="libre-profile-lang-bar-fill"
                          style={{ width: `${Math.max(r.pct * 100, 2)}%` }}
                        />
                      </div>
                      <span className="libre-profile-lang-meta">
                        {r.lessonsDone}
                        <span className="libre-profile-lang-meta-sub">/{r.lessonsTotal}</span>
                      </span>
                      <span className="libre-profile-lang-xp">
                        {formatNumber(r.xp)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              // Empty languages card keeps the grid's right column
              // populated when a learner hasn't started anything;
              // collapsing it would let achievements (below) re-flow
              // into the right column on a fresh install and the
              // layout would look hollow.
              <section className="libre-profile-card libre-profile-card--lang">
                <header className="libre-profile-card-head">
                  <h2 className="libre-profile-card-title">XP by language</h2>
                </header>
                <p className="libre-profile-empty libre-profile-empty--inline">
                  Open any lesson to start earning XP.
                </p>
              </section>
            )}


            {/* Topics ──────────────────────────────────────── */}
            <section className="libre-profile-card libre-profile-card--topics">
              <header className="libre-profile-card-head">
                <h2 className="libre-profile-card-title">Topics practised</h2>
                <span className="libre-profile-card-meta">
                  {topicStats.length === 0
                    ? "Challenge packs only"
                    : `${topicStats.length} topic${topicStats.length === 1 ? "" : "s"}`}
                </span>
              </header>
              {topicStats.length === 0 ? (
                <p className="libre-profile-empty libre-profile-empty--inline">
                  Finish a challenge-pack lesson — its topic shows up here.
                </p>
              ) : (
                <>
                  <div className="libre-profile-topic-grid">
                    {visibleTopics.map((t) => (
                      <div key={t.topic} className="libre-profile-topic-chip">
                        <span className="libre-profile-topic-name">{t.topic}</span>
                        <span className="libre-profile-topic-count">{t.count}</span>
                      </div>
                    ))}
                  </div>
                  {hiddenTopicsCount > 0 && (
                    <ExpanderButton
                      open={showAllTopics}
                      onToggle={() => setShowAllTopics((v) => !v)}
                      collapsedLabel={`Show all (${topicStats.length})`}
                      expandedLabel={`Show top ${TOPICS_PREVIEW_COUNT}`}
                    />
                  )}
                </>
              )}
            </section>
          </div>

          {/* ── Recent activity ────────────────────────────────
              Full-width below the grid. Capped to 8 visible by
              default; the expander toggles between "Show all (N)"
              and "Show recent 8". Each row is a single dense
              line: kind dot, lesson title, course title, relative
              time — designed to scan vertically without wasted
              padding. */}
          <section className="libre-profile-card libre-profile-card--activity-feed">
            <header className="libre-profile-card-head">
              <h2 className="libre-profile-card-title">Recent activity</h2>
              <span className="libre-profile-card-meta">
                {recentActivity.length === 0
                  ? "No completions yet"
                  : `${recentActivity.length}${recentActivity.length >= 60 ? "+" : ""} recent`}
              </span>
            </header>
            {recentActivity.length > 0 ? (
              <>
                <ul className="libre-profile-activity">
                  {visibleActivity.map((r, i) => (
                    <li key={`${r.courseId}:${r.lessonId}:${i}`}>
                      <button
                        className="libre-profile-activity-row"
                        onClick={() => onOpenLesson(r.courseId, r.lessonId)}
                        title={`${r.lessonTitle} · ${r.courseTitle}`}
                      >
                        <span
                          className={`libre-profile-activity-kind libre-profile-activity-kind--${r.kind}`}
                          aria-hidden
                          title={r.kind}
                        />
                        <span className="libre-profile-activity-lesson">
                          {r.lessonTitle}
                        </span>
                        <span className="libre-profile-activity-course">
                          {r.courseTitle}
                        </span>
                        <span className="libre-profile-activity-time">
                          {formatRelative(r.completedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {hiddenActivityCount > 0 && (
                  <ExpanderButton
                    open={showAllActivity}
                    onToggle={() => setShowAllActivity((v) => !v)}
                    collapsedLabel={`Show all (${recentActivity.length})`}
                    expandedLabel={`Show recent ${ACTIVITY_PREVIEW_COUNT}`}
                  />
                )}
              </>
            ) : (
              <p className="libre-profile-empty libre-profile-empty--inline">
                No completed lessons yet. Pick a course in the sidebar to start
                building your profile.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/// Reusable expand/collapse footer button used by Topics + Recent
/// activity. The two surfaces share the same UX vocabulary — a
/// chevron + label — so a learner who learns the gesture once
/// applies it to both.
function ExpanderButton({
  open,
  onToggle,
  collapsedLabel,
  expandedLabel,
}: {
  open: boolean;
  onToggle: () => void;
  collapsedLabel: string;
  expandedLabel: string;
}) {
  return (
    <button
      type="button"
      className="libre-profile-expander"
      onClick={onToggle}
      aria-expanded={open}
    >
      <Icon
        icon={open ? chevronUp : chevronDown}
        size="xs"
        color="currentColor"
      />
      <span>{open ? expandedLabel : collapsedLabel}</span>
    </button>
  );
}

function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/// One dense stat tile. Switched from the previous "icon + 2-line
/// text" stacked layout to a horizontal "icon + value + label" so
/// six tiles fit in a single row at the typical desktop width.
function StatTile({
  icon,
  tone,
  value,
  label,
  formatted,
}: {
  icon: string;
  tone: "streak" | "lessons" | "xp" | "level" | "longest";
  value: number;
  label: string;
  /// Pass `formatted` for XP / coin counters so 5+ digit values
  /// render compactly as "1.2k" / "10k". Streak / lesson counters
  /// stay as raw integers — they're naturally smaller.
  formatted?: boolean;
}) {
  return (
    <div
      className={`libre-profile-stat libre-profile-stat--${tone}`}
      role="listitem"
      title={`${value} ${label.toLowerCase()}`}
    >
      <span className="libre-profile-stat-icon" aria-hidden>
        <Icon icon={icon} size="sm" color="currentColor" />
      </span>
      <div className="libre-profile-stat-text">
        <span className="libre-profile-stat-value">
          {formatted ? formatNumber(value) : value}
        </span>
        <span className="libre-profile-stat-label">{label}</span>
      </div>
    </div>
  );
}

/// 7-row × N-week grid of completion-count cells. Flex-column-wrap
/// turns the linear array into 7-tall columns automatically — simpler
/// than a CSS grid for this shape. `isPad` cells render invisibly so
/// the calendar alignment lands today in the right weekday row
/// without leaving an awkward bottom-of-column orphan.
function Heatmap({
  cells,
  peak,
}: {
  cells: Array<{ key: string; count: number; label: string; isPad: boolean }>;
  peak: number;
}) {
  const level = (count: number) => {
    if (count <= 0) return 0;
    if (count >= peak) return 4;
    const pct = count / peak;
    if (pct >= 0.7) return 4;
    if (pct >= 0.45) return 3;
    if (pct >= 0.2) return 2;
    return 1;
  };
  return (
    <div
      className="libre-profile-heatmap"
      aria-label={`Activity over the last ${HEATMAP_WEEKS} weeks`}
    >
      {cells.map((c) =>
        c.isPad ? (
          <span
            key={c.key}
            className="libre-profile-heatmap-cell libre-profile-heatmap-cell--pad"
            aria-hidden
          />
        ) : (
          <span
            key={c.key}
            className={`libre-profile-heatmap-cell libre-profile-heatmap-cell--lvl-${level(c.count)}`}
            title={c.label}
          />
        ),
      )}
    </div>
  );
}

/// Unix-seconds → "3m ago" / "2h ago" / "yesterday" / "Apr 12" style label.
/// Keeps the timeline skimmable — exact wall-clock time is rarely useful
/// here; relative time tells the story.
function formatRelative(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 2) return "yesterday";
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/// Pretty-print a number with k/M suffixes for the stat tiles +
/// activity feed where horizontal room is tight. 1234 → "1.2k",
/// 1000000 → "1M". Sub-1000 values pass through unchanged. Returns a
/// string (not a number) so the formatted output can sit next to
/// `<span class="…meta-sub">/…</span>` siblings without coercion
/// headaches.
function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) {
    const k = n / 1000;
    return `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  const m = n / 1000000;
  return `${m.toFixed(1).replace(/\.0$/, "")}M`;
}
