import { useMemo } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { zap } from "@base/primitives/icon/icons/zap";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import { rocket } from "@base/primitives/icon/icons/rocket";
import { brain } from "@base/primitives/icon/icons/brain";
import { graduationCap } from "@base/primitives/icon/icons/graduation-cap";
import { star } from "@base/primitives/icon/icons/star";
import { award } from "@base/primitives/icon/icons/award";
import { crown } from "@base/primitives/icon/icons/crown";
import { medal } from "@base/primitives/icon/icons/medal";
import { target as targetIcon } from "@base/primitives/icon/icons/target";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "../../data/types";
import { isExerciseKind } from "../../data/types";
import type { Completion } from "../../hooks/useProgress";
import type { StreakAndXp } from "../../hooks/useStreakAndXp";
import "./ProfileView.css";

/// Per-lesson XP — MUST stay in sync with useStreakAndXp + MobileProfile.
/// Kept duplicated (not imported) because the hook only exports computed
/// totals, not the per-kind map. If we ever add a kind, update all three
/// in the same commit.
const XP_PER_KIND = {
  reading: 5,
  quiz: 10,
  cloze: 10,
  micropuzzle: 10,
  puzzle: 15,
  exercise: 20,
  mixed: 20,
} as const;

/// Stat-tile accent palette. Each tone shows up as the tile's left-edge
/// stripe, the icon's tinted background, and (for rings) the stroke
/// color. Picked to read as distinct on a dark + light shell without any
/// becoming the "loudest" — the page is meant to feel composed, not
/// circus.
const TONE = {
  streak: "#f59e3b",
  lessons: "#7cd9d3",
  xp: "#fcd34d",
  level: "#7cd97c",
  longest: "#c79bff",
} as const;

/// 20 weeks of activity. Wider than mobile's 12-week strip because the
/// desktop column is wider — enough cells to show seasonal patterns
/// rather than just "the current sprint".
const HEATMAP_WEEKS = 20;

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
}

/// Profile / stats page. Reads directly from the same hooks the StatsChip
/// dropdown uses, but lays everything out as a dedicated surface — twin
/// rings, color-toned stat tiles, 20-week activity heatmap, per-language
/// brand-colored XP bar chart, achievement badges grid, topic chips, and
/// a recent-activity timeline. Visual parity with MobileProfile so the
/// two surfaces feel like sibling views of the same data, sized for
/// each form factor.
export default function ProfileView({
  courses,
  completed,
  history,
  stats,
  onOpenLesson,
}: Props) {
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
  /// Also tracks the activeDays count + earliest+latest dates so the
  /// summary line under the grid can tell the learner what they're
  /// looking at ("12 active days across the last 20 weeks").
  const heatmap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of history) {
      const key = localDayKey(c.completed_at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDow = today.getDay(); // 0=Sun, 6=Sat
    // First day of the grid = Sunday of the (HEATMAP_WEEKS-1)-weeks-ago
    // week. We start the grid that far back so it ends with this week's
    // Sunday + intervening days up to today.
    const start = new Date(today);
    start.setDate(start.getDate() - todayDow - (HEATMAP_WEEKS - 1) * 7);

    const cells: Array<{
      key: string;
      count: number;
      label: string;
      isPad: boolean;
    }> = [];
    let firstActive: Date | null = null;
    let lastActive: Date | null = null;
    let activeDays = 0;
    let totalCompletions = 0;
    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d > today) {
        // Future day in the current week — render an invisible
        // placeholder so today lands at row=todayDow rather than the
        // bottom of the last column.
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
        if (!firstActive) firstActive = new Date(d);
        lastActive = new Date(d);
      }
      cells.push({
        key,
        count,
        label: `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${count} lesson${count === 1 ? "" : "s"}`,
        isPad: false,
      });
    }
    // Anchor color binning to the busy days inside the window so a
    // single 50-lesson day months ago doesn't squash the rest of the
    // chart into pale boxes.
    const peak = Math.max(1, ...cells.map((c) => c.count));
    return { cells, peak, activeDays, totalCompletions, firstActive, lastActive, start };
  }, [history]);

  /// Per-language XP breakdown — bars sorted descending, language
  /// totals shown on the right. Cap to top 8 (vs mobile's 6) since
  /// desktop has the vertical room for a slightly fuller chart.
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
      const kind = kindByKey.get(`${h.course_id}:${h.lesson_id}`) ?? "reading";
      const xp = XP_PER_KIND[kind as keyof typeof XP_PER_KIND] ?? XP_PER_KIND.reading;
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

  /// Newest-first slice of completions, capped at 24. Orphaned entries
  /// (course was deleted) are dropped rather than rendered as ghosts.
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
      if (out.length >= 24) break;
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

  /// Achievement / milestone unlocks. Twelve total — same set as
  /// MobileProfile so progress reads identically across surfaces.
  /// Order is roughly easiest → hardest top-to-bottom.
  const milestones = useMemo<MilestoneSpec[]>(
    () => [
      { id: "first-lesson", label: "First lesson", icon: bookOpenCheck, target: 1, actual: stats.lessonsCompleted, unit: "lesson" },
      { id: "ten-lessons", label: "Ten lessons", icon: graduationCap, target: 10, actual: stats.lessonsCompleted, unit: "lessons" },
      { id: "hundred-lessons", label: "Century", icon: trophy, target: 100, actual: stats.lessonsCompleted, unit: "lessons" },
      { id: "streak-3", label: "3-day streak", icon: flame, target: 3, actual: Math.max(stats.streakDays, stats.longestStreakDays), unit: "days" },
      { id: "streak-7", label: "Week strong", icon: targetIcon, target: 7, actual: Math.max(stats.streakDays, stats.longestStreakDays), unit: "days" },
      { id: "streak-30", label: "Iron habit", icon: medal, target: 30, actual: Math.max(stats.streakDays, stats.longestStreakDays), unit: "days" },
      { id: "level-5", label: "Apprentice", icon: star, target: 5, actual: stats.level, unit: "level" },
      { id: "level-10", label: "Adept", icon: award, target: 10, actual: stats.level, unit: "level" },
      { id: "level-20", label: "Mastered", icon: crown, target: 20, actual: stats.level, unit: "level" },
      { id: "languages-3", label: "Polyglot", icon: brain, target: 3, actual: langChart.rows.filter((r) => r.xp > 0).length, unit: "languages" },
      { id: "xp-1000", label: "1k XP", icon: zap, target: 1000, actual: stats.xp, unit: "XP" },
      { id: "xp-10000", label: "10k XP", icon: rocket, target: 10000, actual: stats.xp, unit: "XP" },
    ],
    [stats, langChart],
  );

  void completed;

  const xpToNext = Math.max(0, stats.xpForLevel - stats.xpIntoLevel);

  return (
    <div className="fishbones-profile">
      <div className="fishbones-profile-scroll">
        <div className="fishbones-profile-inner">
          {/* Hero — twin rings (streak target + XP into level) flanked
              by a header. The two rings are the page's emotional
              focal point: "what number am I chasing right now?". */}
          <section className="fishbones-profile-hero" aria-label="Streak and level">
            <div className="fishbones-profile-hero-text">
              <h1 className="fishbones-profile-hero-title">Profile</h1>
              <p className="fishbones-profile-hero-sub">
                Level {stats.level} ·{" "}
                {xpToNext === 0
                  ? "ready to level up — complete any lesson"
                  : `${xpToNext} XP to level ${stats.level + 1}`}
              </p>
            </div>
            <div className="fishbones-profile-rings">
              <RingGauge
                value={stats.streakDays}
                target={ringStreakTarget(stats.streakDays)}
                label="Streak"
                icon={flame}
                tone="streak"
              />
              <RingGauge
                value={stats.xpIntoLevel}
                target={Math.max(stats.xpForLevel, 1)}
                label={`Level ${stats.level}`}
                icon={zap}
                tone="level"
              />
            </div>
          </section>

          {/* Four color-toned stat tiles. Same data the rings cover but
              flat / numeric — rings for emotional pull, tiles for
              at-a-glance scanning. Desktop arranges them in a single
              row of 4 instead of mobile's 2×2 grid. */}
          <div className="fishbones-profile-stats" role="list">
            <StatTile icon={flame} tone="streak" value={stats.streakDays} label="Day streak" />
            <StatTile icon={bookOpenCheck} tone="lessons" value={stats.lessonsCompleted} label="Lessons" />
            <StatTile icon={zap} tone="xp" value={stats.xp} label="Total XP" />
            <StatTile icon={trophy} tone="longest" value={stats.longestStreakDays} label="Longest streak" />
          </div>

          {/* Activity heatmap — 20 weeks, calendar-aligned. Rows are
              stable weekdays (Sun at top, Sat at bottom) so the
              Mon/Wed/Fri labels on the left have meaning. The
              summary line below tells the learner what time range
              they're looking at and how active they've been in it,
              answering the "is this real data?" question. */}
          <section className="fishbones-profile-section">
            <div className="fishbones-profile-section-head">
              <h2 className="fishbones-profile-section-title">Activity</h2>
              <span className="fishbones-profile-heatmap-summary">
                {heatmap.activeDays === 0
                  ? "No completions yet — open a lesson to start the chart."
                  : `${heatmap.totalCompletions} completion${heatmap.totalCompletions === 1 ? "" : "s"} across ${heatmap.activeDays} active day${heatmap.activeDays === 1 ? "" : "s"} · last ${HEATMAP_WEEKS} weeks`}
              </span>
            </div>
            <div className="fishbones-profile-heatmap-wrap">
              {/* Day-of-week labels. Show only Mon / Wed / Fri to
                  avoid clutter — same convention as GitHub's
                  contribution graph. */}
              <div className="fishbones-profile-heatmap-rowlabels" aria-hidden>
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
            <div className="fishbones-profile-heatmap-legend" aria-hidden>
              <span>Less</span>
              <span className="fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--lvl-0" />
              <span className="fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--lvl-1" />
              <span className="fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--lvl-2" />
              <span className="fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--lvl-3" />
              <span className="fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--lvl-4" />
              <span>More</span>
            </div>
          </section>

          {/* Per-language XP — horizontal bars, brand-tinted via
              `data-lang` so JS reads yellow, Rust reads oxblood, etc.
              Doubles as a "languages I've touched" surface. */}
          {langChart.rows.length > 0 && (
            <section className="fishbones-profile-section">
              <h2 className="fishbones-profile-section-title">XP by language</h2>
              <ul className="fishbones-profile-lang-chart" role="list">
                {langChart.rows.map((r) => (
                  <li key={r.lang} className="fishbones-profile-lang-row">
                    <span className="fishbones-profile-lang-name" data-lang={r.lang}>
                      {LANG_LABELS[r.lang] ?? r.lang}
                    </span>
                    <div className="fishbones-profile-lang-bar" aria-hidden data-lang={r.lang}>
                      <div
                        className="fishbones-profile-lang-bar-fill"
                        style={{ width: `${Math.max(r.pct * 100, 2)}%` }}
                      />
                    </div>
                    <span className="fishbones-profile-lang-meta">
                      {r.lessonsDone}
                      <span className="fishbones-profile-lang-meta-sub">/{r.lessonsTotal}</span>
                    </span>
                    <span className="fishbones-profile-lang-xp">{r.xp} XP</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Achievement badges — unlocked ones glow gold, locked ones
              dim with a "x / target" hint so the next goal stays
              visible. Six columns × two rows on desktop (vs mobile's
              3×4) — the page has the horizontal room. */}
          <section className="fishbones-profile-section">
            <h2 className="fishbones-profile-section-title">Achievements</h2>
            <ul className="fishbones-profile-badges" role="list">
              {milestones.map((m) => {
                const unlocked = m.actual >= m.target;
                return (
                  <li
                    key={m.id}
                    className={
                      "fishbones-profile-badge" +
                      (unlocked ? " fishbones-profile-badge--unlocked" : "")
                    }
                    title={
                      unlocked
                        ? `${m.label} unlocked`
                        : `${m.actual}/${m.target} ${m.unit}`
                    }
                  >
                    <span className="fishbones-profile-badge-icon" aria-hidden>
                      <Icon icon={m.icon} size="sm" color="currentColor" />
                    </span>
                    <span className="fishbones-profile-badge-label">{m.label}</span>
                    <span className="fishbones-profile-badge-meta">
                      {unlocked ? "Unlocked" : `${m.actual}/${m.target}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Topics — pulled only from challenge-pack lessons (they
              carry the `topic` tag). Desktop-unique; books don't have
              topics, so a learner who only reads books sees nothing. */}
          {topicStats.length > 0 && (
            <section className="fishbones-profile-section">
              <h2 className="fishbones-profile-section-title">Topics practised</h2>
              <div className="fishbones-profile-topic-grid">
                {topicStats.map((t) => (
                  <div key={t.topic} className="fishbones-profile-topic-chip">
                    <span className="fishbones-profile-topic-name">{t.topic}</span>
                    <span className="fishbones-profile-topic-count">{t.count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent activity timeline. Clicks jump back to the lesson. */}
          <section className="fishbones-profile-section">
            <h2 className="fishbones-profile-section-title">Recent activity</h2>
            {recentActivity.length > 0 ? (
              <ul className="fishbones-profile-activity">
                {recentActivity.map((r, i) => (
                  <li key={`${r.courseId}:${r.lessonId}:${i}`}>
                    <button
                      className="fishbones-profile-activity-row"
                      onClick={() => onOpenLesson(r.courseId, r.lessonId)}
                    >
                      <span
                        className={`fishbones-profile-activity-kind fishbones-profile-activity-kind--${r.kind}`}
                        aria-hidden
                      />
                      <span className="fishbones-profile-activity-body">
                        <span className="fishbones-profile-activity-lesson">
                          {r.lessonTitle}
                        </span>
                        <span className="fishbones-profile-activity-course">
                          {r.courseTitle}
                        </span>
                      </span>
                      <span className="fishbones-profile-activity-time">
                        {formatRelative(r.completedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fishbones-profile-empty">
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

interface MilestoneSpec {
  id: string;
  label: string;
  icon: string;
  target: number;
  actual: number;
  unit: string;
}

/// Pick the next milestone target a streak should chase — 3 / 7 / 14 /
/// 30 / 60 / 100 / 365 ladder. Empty rings on a 200-day streak would
/// feel demotivating; this keeps the fill always relative to the next
/// reachable goal.
function ringStreakTarget(streak: number): number {
  for (const t of [3, 7, 14, 30, 60, 100, 365]) {
    if (streak < t) return t;
  }
  return Math.max(streak + 30, 365);
}

function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/// Circular SVG gauge. Fill is animated via stroke-dashoffset (CSS
/// transition), so React re-renders drive the visual change for free.
/// Sized via CSS (--ring-size on the parent) so the same component
/// works in the StatsChip dropdown and on the full Profile page.
function RingGauge({
  value,
  target,
  label,
  icon,
  tone,
}: {
  value: number;
  target: number;
  label: string;
  icon: string;
  tone: "streak" | "level";
}) {
  const pct = target > 0 ? Math.min(value / target, 1) : 0;
  const r = 42;
  const c = Math.round(2 * Math.PI * r * 100) / 100;
  const offset = c * (1 - pct);
  return (
    <div className={`fishbones-profile-ring fishbones-profile-ring--${tone}`}>
      <svg viewBox="0 0 100 100" className="fishbones-profile-ring-svg" aria-hidden>
        <circle className="fishbones-profile-ring-track" cx="50" cy="50" r={r} fill="none" />
        <circle
          className="fishbones-profile-ring-fill"
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="fishbones-profile-ring-body">
        <span className="fishbones-profile-ring-icon" aria-hidden>
          <Icon icon={icon} size="xl" color="currentColor" />
        </span>
        <span className="fishbones-profile-ring-value">{value}</span>
        <span className="fishbones-profile-ring-label">{label}</span>
      </div>
    </div>
  );
}

/// One stat tile. Icon-tinted by `tone` so the four tiles read as
/// distinct numerics even when the values are similar.
function StatTile({
  icon,
  tone,
  value,
  label,
}: {
  icon: string;
  tone: keyof typeof TONE;
  value: number;
  label: string;
}) {
  return (
    <div
      className={`fishbones-profile-stat fishbones-profile-stat--${tone}`}
      role="listitem"
    >
      <span className="fishbones-profile-stat-icon" aria-hidden>
        <Icon icon={icon} size="base" color="currentColor" />
      </span>
      <div className="fishbones-profile-stat-text">
        <span className="fishbones-profile-stat-value">{value}</span>
        <span className="fishbones-profile-stat-label">{label}</span>
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
  // Bin counts to 5 levels (0-4). Level 0 = no activity (muted);
  // levels 1-4 ramp from quiet to bright.
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
      className="fishbones-profile-heatmap"
      aria-label={`Activity over the last ${HEATMAP_WEEKS} weeks`}
    >
      {cells.map((c) =>
        c.isPad ? (
          <span
            key={c.key}
            className="fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--pad"
            aria-hidden
          />
        ) : (
          <span
            key={c.key}
            className={`fishbones-profile-heatmap-cell fishbones-profile-heatmap-cell--lvl-${level(c.count)}`}
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
