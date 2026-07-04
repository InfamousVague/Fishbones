/// Mobile Practice — the phone shell around the shared PracticeView.
/// The shared page already ships the stats dashboard (goal ring,
/// practice streak, accuracy, activity sparkline), so this wrapper
/// adds only what mobile uniquely needs:
///
///   1. Reminder strip — a compact due-summary row with the alarm
///      bell; expanding it lets the learner set a daily reminder
///      time + goal. The engine (usePracticeReminder, hosted by
///      MobileApp so it runs app-wide) nudges in-app once the time
///      passes with due reviews outstanding.
///   2. Monkey's Paw entry — routes to MobileApp's "monkeyspaw"
///      view (the duels were desktop-only until now).
///
/// The shared PracticeView renders below untouched — same session
/// engine, same SRS store as desktop.

import { useState } from "react";
import type { Course } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";
import PracticeView from "@/components/templates/Practice/PracticeView";
import {
  type PracticeReminderSettings,
} from "./usePracticeReminder";
import { haptics } from "@/lib/haptics";
import { Icon } from "@base/primitives/icon";
import { alarmClock } from "@base/primitives/icon/icons/alarm-clock";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import "./MobilePractice.css";

interface Props {
  courses: readonly Course[];
  completed: Set<string>;
  history: readonly Completion[];
  dueCount: number;
  reminder: PracticeReminderSettings;
  onReminderChange: (next: PracticeReminderSettings) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  onMonkeysPaw: () => void;
}

const GOALS = [5, 10, 20] as const;

export default function MobilePractice({
  courses,
  completed,
  history,
  dueCount,
  reminder,
  onReminderChange,
  onOpenLesson,
  onMonkeysPaw,
}: Props) {
  const [reminderOpen, setReminderOpen] = useState(false);

  return (
    <div className="m-practice">
      {/* ── Reminder strip ── */}
      <div className="m-practice__hero">
        <div className="m-practice__hero-text">
          <span className="m-practice__hero-title">
            {dueCount > 0
              ? `${dueCount} review${dueCount === 1 ? "" : "s"} due`
              : "All caught up"}
          </span>
          <span className="m-practice__hero-sub">
            {reminder.enabled
              ? `Daily reminder at ${reminder.time}`
              : "Set a daily reminder to keep the chain alive"}
          </span>
        </div>
        <button
          type="button"
          className={
            "m-practice__bell" + (reminder.enabled ? " m-practice__bell--on" : "")
          }
          aria-label="Practice reminder settings"
          aria-expanded={reminderOpen}
          onClick={() => {
            void haptics.selection();
            setReminderOpen((v) => !v);
          }}
        >
          <Icon icon={alarmClock} size="sm" color="currentColor" />
        </button>
      </div>

      {/* ── Reminder + goal card (collapsible) ── */}
      {reminderOpen && (
        <div className="m-practice__reminder">
          <button
            type="button"
            role="switch"
            aria-checked={reminder.enabled}
            className="m-set__row m-set__row--button"
            onClick={() =>
              onReminderChange({ ...reminder, enabled: !reminder.enabled })
            }
          >
            <span className="m-set__row-title">Daily practice reminder</span>
            <span
              className={
                "m-set__switch" + (reminder.enabled ? " m-set__switch--on" : "")
              }
              aria-hidden
            >
              <span className="m-set__switch-thumb" />
            </span>
          </button>
          {reminder.enabled && (
            <div className="m-practice__reminder-row">
              <label className="m-practice__reminder-label" htmlFor="m-practice-time">
                Remind me at
              </label>
              <input
                id="m-practice-time"
                type="time"
                className="m-practice__time"
                value={reminder.time}
                onChange={(e) =>
                  onReminderChange({ ...reminder, time: e.target.value || "18:00" })
                }
              />
            </div>
          )}
          <div className="m-practice__reminder-row">
            <span className="m-practice__reminder-label">Daily goal</span>
            <div className="m-practice__goal-pills" role="radiogroup" aria-label="Daily goal">
              {GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={reminder.goal === g}
                  className={
                    "m-practice__goal-pill" +
                    (reminder.goal === g ? " m-practice__goal-pill--active" : "")
                  }
                  onClick={() => onReminderChange({ ...reminder, goal: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <p className="m-practice__reminder-hint">
            Reminders pop up in the app once your time passes with reviews
            still due — and go quiet once you hit your goal. Allow
            notifications when asked and they'll reach you outside the app
            too.
          </p>
        </div>
      )}

      {/* ── Monkey's Paw entry — duels, now on mobile ── */}
      <button type="button" className="m-practice__paw" onClick={() => {
        void haptics.medium();
        onMonkeysPaw();
      }}>
        <span className="m-practice__paw-icon" aria-hidden>
          <Icon icon={dumbbell} size="sm" color="currentColor" />
        </span>
        <span className="m-practice__paw-text">
          <span className="m-practice__paw-title">Monkey's Paw duels</span>
          <span className="m-practice__paw-sub">
            Outwit cursed code — 120 duels across four languages
          </span>
        </span>
      </button>

      {/* ── The shared session engine + stats dashboard ── */}
      <PracticeView
        courses={courses}
        completed={completed}
        history={history}
        onOpenLesson={onOpenLesson}
      />
    </div>
  );
}
