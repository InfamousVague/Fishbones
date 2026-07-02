/// Practice dashboard — the "how am I doing" strip at the top of
/// the Practice page. Replaces the old four-tile stats row with a
/// richer 2-row grid:
///
///   row 1: daily-goal ring · practice-day streak · accuracy today
///          · 14-day activity sparkline
///   row 2: due · weak · mastered · deck coverage
///
/// Everything is derived — no state of its own beyond a re-read
/// tick. The `libre:practice-graded` event (dispatched by the store
/// after every grade) bumps the tick so the localStorage-backed
/// signals (day log, streak, today's counters via `stats`) refresh
/// live while a session grades in the background.
///
/// Stacks to two-column cards below 480px (goal + sparkline span
/// the full width) so it stays scannable at 390px.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { target } from "@base/primitives/icon/icons/target";
import { clock } from "@base/primitives/icon/icons/clock";
import { brain } from "@base/primitives/icon/icons/brain";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { gauge } from "@base/primitives/icon/icons/gauge";
import "@base/primitives/icon/icon.css";
import { ProgressRing } from "@/components/atoms/ProgressRing/ProgressRing";
import { useT } from "@/i18n/i18n";
import type { PracticeItem, PracticeRecord, PracticeStats } from "./types";
import { loadDayLog, practiceDayStreak } from "./practiceStore";
import "./PracticeDashboard.css";

/// Daily attempt target for the goal ring. Ten cards ≈ one default
/// session — "do one session a day" is the habit we're nudging.
const DAILY_GOAL = 10;

/// Mastery bar: a record with this many consecutive corrects counts
/// as mastered (same threshold the record docs call the "Mastery
/// badge" line).
const MASTERY_STREAK = 5;

/// Sparkline span.
const ACTIVITY_DAYS = 14;

interface Props {
  items: readonly PracticeItem[];
  records: ReadonlyMap<string, PracticeRecord>;
  stats: PracticeStats;
}

export default function PracticeDashboard({ items, records, stats }: Props) {
  const t = useT();

  // Re-read localStorage-derived signals whenever a grade lands.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    function bump() {
      setTick((n) => n + 1);
    }
    window.addEventListener("libre:practice-graded", bump);
    return () => {
      window.removeEventListener("libre:practice-graded", bump);
    };
  }, []);

  const streak = useMemo(() => practiceDayStreak(), [tick]);
  const activity = useMemo(() => {
    const byDay = new Map(loadDayLog().map((e) => [e.dayKey, e]));
    return lastNDayKeys(ACTIVITY_DAYS).map((dayKey) => {
      const e = byDay.get(dayKey);
      return { dayKey, attempts: e?.attempts ?? 0, correct: e?.correct ?? 0 };
    });
  }, [tick]);

  // Deck-shape numbers: mastered + coverage join records against the
  // LIVE item list so orphaned records (rewritten lessons) never count.
  const { mastered, attempted } = useMemo(() => {
    let masteredCount = 0;
    let attemptedCount = 0;
    for (const item of items) {
      const rec = records.get(item.id);
      if (!rec || rec.attempts === 0) continue;
      attemptedCount += 1;
      if (rec.streak >= MASTERY_STREAK) masteredCount += 1;
    }
    return { mastered: masteredCount, attempted: attemptedCount };
  }, [items, records]);

  const goalDone = Math.min(stats.attemptsToday, DAILY_GOAL);
  const accuracy =
    stats.attemptsToday > 0
      ? `${Math.round((stats.correctToday / stats.attemptsToday) * 100)}%`
      : "—";
  const coveragePct =
    items.length > 0 ? Math.round((attempted / items.length) * 100) : 0;

  return (
    <section className="libre-practice-dash">
      <div className="libre-practice-dash-grid">
        {/* Daily goal — ring + meta. */}
        <div className="libre-practice-dash-card libre-practice-dash-card--goal">
          <ProgressRing
            progress={stats.attemptsToday / DAILY_GOAL}
            size={52}
            stroke={5}
            label={`${goalDone}`}
            color="var(--libre-c-fcd34d)"
          />
          <div className="libre-practice-dash-card-text">
            <span className="libre-practice-dash-card-label">
              {t("practice.dashGoal")}
            </span>
            <span className="libre-practice-dash-card-value libre-practice-dash-card-value--sm">
              {t("practice.dashGoalMeta", {
                done: stats.attemptsToday,
                target: DAILY_GOAL,
              })}
            </span>
          </div>
        </div>

        <DashStat
          icon={flame}
          tone="streak"
          value={streak}
          label={t("practice.dashStreak")}
          meta={
            streak === 1
              ? t("practice.dashStreakDays", { count: streak })
              : t("practice.dashStreakDaysPlural", { count: streak })
          }
        />

        <DashStat
          icon={target}
          tone="accuracy"
          value={accuracy}
          label={t("practice.dashAccuracy")}
        />

        {/* 14-day activity sparkline. */}
        <div className="libre-practice-dash-card libre-practice-dash-card--activity">
          <div className="libre-practice-dash-card-text">
            <span className="libre-practice-dash-card-label">
              {t("practice.dashActivity")}
            </span>
            <Sparkline days={activity} />
          </div>
        </div>

        <DashStat
          icon={clock}
          tone="due"
          value={stats.dueCount}
          label={t("practice.dashDue")}
        />
        <DashStat
          icon={brain}
          tone="weak"
          value={stats.weakCount}
          label={t("practice.dashWeak")}
        />
        <DashStat
          icon={trophy}
          tone="mastered"
          value={mastered}
          label={t("practice.dashMastered")}
        />
        <DashStat
          icon={gauge}
          tone="coverage"
          value={`${coveragePct}%`}
          label={t("practice.dashCoverage")}
          meta={`${attempted}/${items.length}`}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// DashStat — compact icon + value + label card (StatTile's successor,
// with an optional small meta line under the label).

function DashStat({
  icon,
  tone,
  value,
  label,
  meta,
}: {
  icon: string;
  tone: "streak" | "accuracy" | "due" | "weak" | "mastered" | "coverage";
  value: number | string;
  label: string;
  meta?: string;
}) {
  return (
    <div
      className={`libre-practice-dash-card libre-practice-dash-card--${tone}`}
    >
      <span className="libre-practice-dash-card-icon" aria-hidden>
        <Icon icon={icon} size="base" color="currentColor" />
      </span>
      <div className="libre-practice-dash-card-text">
        <span className="libre-practice-dash-card-value">{value}</span>
        <span className="libre-practice-dash-card-label">{label}</span>
        {meta && <span className="libre-practice-dash-card-meta">{meta}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — inline SVG bars, one per day, correct portion painted
// in the success tone over a soft attempts track.

function Sparkline({
  days,
}: {
  days: ReadonlyArray<{ dayKey: string; attempts: number; correct: number }>;
}) {
  const H = 36;
  const BAR = 8;
  const GAP = 2;
  const W = days.length * (BAR + GAP) - GAP;
  const max = Math.max(1, ...days.map((d) => d.attempts));
  return (
    <svg
      className="libre-practice-dash-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {days.map((d, i) => {
        const x = i * (BAR + GAP);
        // Every day gets at least a 2px stub so the axis reads as a
        // timeline even on zero-activity days.
        const hAll = d.attempts > 0 ? Math.max(3, (d.attempts / max) * H) : 2;
        const hOk = d.correct > 0 ? Math.max(3, (d.correct / max) * H) : 0;
        return (
          <g key={d.dayKey}>
            <rect
              className="libre-practice-dash-spark-bar"
              x={x}
              y={H - hAll}
              width={BAR}
              height={hAll}
              rx={1.5}
            />
            {hOk > 0 && (
              <rect
                className="libre-practice-dash-spark-bar-ok"
                x={x}
                y={H - hOk}
                width={BAR}
                height={hOk}
                rx={1.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers.

/// Local day keys for the last `n` days, oldest → newest, today
/// last. Uses calendar arithmetic (not ms subtraction) so DST
/// transitions can't skip or duplicate a day.
function lastNDayKeys(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${d.getFullYear()}-${m}-${day}`);
  }
  return out;
}
