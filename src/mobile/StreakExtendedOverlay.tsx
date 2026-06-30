/// Mobile streak-extension celebration. Mirrors the Duolingo
/// pattern: when the learner's first completion of a new
/// calendar day rolls their streak forward (or starts a fresh
/// one), a dimmed full-screen overlay slides up, the new streak
/// number bounces in, and the last 7 days animate in as a row of
/// pills with the active days lit up.
///
/// Auto-dismisses after ~5 s. Tap-outside / Escape close it
/// immediately. The component is purely presentational — the
/// hosting `MobileApp.tsx` owns the "did the streak just go up?"
/// detection and controls the `open` prop.

import { useEffect, useMemo } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import "@base/primitives/icon/icon.css";
import type { Completion } from "@/hooks/useProgress";
import "./StreakExtendedOverlay.css";

interface Props {
  open: boolean;
  /// The new (extended) streak count to celebrate. Drives the
  /// number in the centre of the card.
  streakDays: number;
  /// Completion history; used to build the 7-day grid of
  /// activity pills. The grid shows the rolling last 7 days
  /// (today + the 6 days before), with each day lit if the
  /// learner had at least one completion on that local date.
  history: Completion[];
  /// Frozen days (streak shields). Counted as activity in the
  /// pill row so the learner sees their shield-protected days
  /// rendered the same as real completions. Optional — the host
  /// can omit when shields aren't loaded.
  frozenDays?: ReadonlySet<string>;
  /// Fired when the overlay should close (tap-outside, Escape,
  /// or the auto-dismiss timeout).
  onClose: () => void;
}

/// How long the overlay stays up before auto-dismissing. Long
/// enough to let the pill animation finish + the user read the
/// number; short enough that a half-paying-attention learner
/// isn't trapped behind it.
const AUTO_DISMISS_MS = 5000;

/// Build the last-7-days grid. Today is the right-most pill;
/// six days ago is the leftmost. Each entry carries a short
/// two-letter weekday label, whether it's today (special
/// outline), and whether the learner had activity on that day
/// (the pill lights up with the streak gradient).
function buildLastSevenDays(
  history: Completion[],
  frozenDays?: ReadonlySet<string>,
): Array<{ label: string; isToday: boolean; hasActivity: boolean }> {
  // Set of YYYY-MM-DD strings the learner has activity on.
  // Mirrors the `localDayKey` logic in `useStreakAndXp.ts`.
  const activeDays = new Set<string>();
  for (const c of history) activeDays.add(localDayKey(c.completed_at));
  if (frozenDays) for (const d of frozenDays) activeDays.add(d);

  const labels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const today = new Date();
  const out: Array<{
    label: string;
    isToday: boolean;
    hasActivity: boolean;
  }> = [];
  // Walk from 6-days-ago → today so the right-most pill is the
  // current day. Mirrors how iOS / Android health apps render
  // weekly bar charts.
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateKey = formatDayKey(d);
    out.push({
      label: labels[d.getDay()],
      isToday: i === 0,
      hasActivity: activeDays.has(dateKey),
    });
  }
  return out;
}

function formatDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/// Mirrors `useStreakAndXp.localDayKey` — duplicated rather than
/// imported so this component stays self-contained.
function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return formatDayKey(d);
}

export default function StreakExtendedOverlay({
  open,
  streakDays,
  history,
  frozenDays,
  onClose,
}: Props) {
  // Auto-dismiss timer. Re-armed every time `open` flips to true
  // so subsequent extensions don't pile up.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(onClose, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [open, onClose]);

  // Escape to dismiss — useful on the iPad keyboard case and for
  // accessibility-tool users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const week = useMemo(
    () => buildLastSevenDays(history, frozenDays),
    [history, frozenDays],
  );

  if (!open) return null;

  return (
    <div
      className="m-streak-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Streak extended to ${streakDays} days`}
      onClick={onClose}
    >
      <div
        className="m-streak-overlay__card"
        // Stop card-internal clicks from bubbling to the backdrop
        // (which would dismiss the overlay prematurely).
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-streak-overlay__flame" aria-hidden>
          <Icon icon={flame} size="xl" color="currentColor" weight="bold" />
        </div>
        <div className="m-streak-overlay__count">{streakDays}</div>
        <div className="m-streak-overlay__caption">
          {streakDays === 1 ? "day streak!" : "day streak!"}
        </div>

        {/* 7-day pill row. Each pill animates in with a staggered
            delay driven by its CSS custom property `--i`. The
            active pills also pop the flame ring on; inactive
            (and future) days stay as ghost outlines. */}
        <ul className="m-streak-overlay__week" aria-hidden>
          {week.map((day, idx) => (
            <li
              key={idx}
              className={
                "m-streak-overlay__day" +
                (day.hasActivity ? " m-streak-overlay__day--active" : "") +
                (day.isToday ? " m-streak-overlay__day--today" : "")
              }
              style={{ "--i": idx } as React.CSSProperties}
            >
              <span className="m-streak-overlay__day-label">{day.label}</span>
              <span className="m-streak-overlay__day-mark" aria-hidden>
                {day.hasActivity ? (
                  <Icon
                    icon={flame}
                    size="xs"
                    color="currentColor"
                    weight="bold"
                  />
                ) : (
                  <span className="m-streak-overlay__day-dot" />
                )}
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="m-streak-overlay__btn"
          onClick={onClose}
        >
          Keep going
        </button>
      </div>
    </div>
  );
}
