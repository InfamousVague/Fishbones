/// Daily practice reminder — user-configurable, in-app first.
///
/// The learner picks a time of day (and a daily attempt goal); when
/// that time passes and they still have due reviews and haven't hit
/// the goal, the app nudges them:
///   - an in-app banner (always — rendered by MobileApp above the
///     tab bar), fired at most once per day,
///   - a system Notification when the platform granted permission
///     (Android / desktop web; iOS only surfaces these for
///     home-screen-installed PWAs). Permission is requested from the
///     enable-toggle tap so the prompt rides a user gesture.
///
/// Web has no reliable scheduled-notification primitive (Notification
/// Triggers never shipped cross-browser), so the engine checks on
/// mount + every minute while the app is open, and again on
/// visibilitychange — which covers the realistic PWA usage pattern
/// (open the app → get nudged if you're past your time).
///
/// Settings persist to `libre.practice.reminder.v1`; the last-fired
/// day to `libre.practice.reminder.fired.v1` so backgrounding /
/// relaunching doesn't re-nudge the same day.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PracticeReminderSettings {
  enabled: boolean;
  /// "HH:MM" 24h local time.
  time: string;
  /// Daily attempt goal — drives the hero ring on the Practice page.
  goal: number;
}

const SETTINGS_KEY = "libre.practice.reminder.v1";
const FIRED_KEY = "libre.practice.reminder.fired.v1";

export const DEFAULT_REMINDER: PracticeReminderSettings = {
  enabled: false,
  time: "18:00",
  goal: 10,
};

export function loadReminderSettings(): PracticeReminderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_REMINDER;
    const parsed = JSON.parse(raw) as Partial<PracticeReminderSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      time: /^\d{2}:\d{2}$/.test(parsed.time ?? "") ? parsed.time! : "18:00",
      goal:
        typeof parsed.goal === "number" && parsed.goal > 0
          ? Math.min(parsed.goal, 100)
          : 10,
    };
  } catch {
    return DEFAULT_REMINDER;
  }
}

export function saveReminderSettings(s: PracticeReminderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — the toggle just won't persist */
  }
}

function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/// Pure firing rule — exported for tests. Fires when the reminder is
/// enabled, the local time-of-day has passed the configured time,
/// there is still work to do (due reviews AND goal not met), and we
/// haven't already fired today.
export function shouldFireReminder(
  settings: PracticeReminderSettings,
  now: Date,
  dueCount: number,
  attemptsToday: number,
  lastFiredDay: string | null,
): boolean {
  if (!settings.enabled) return false;
  if (dueCount <= 0) return false;
  if (attemptsToday >= settings.goal) return false;
  if (lastFiredDay === localDayKey(now)) return false;
  const [hh, mm] = settings.time.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= hh * 60 + mm;
}

export interface PracticeReminderState {
  settings: PracticeReminderSettings;
  setSettings: (next: PracticeReminderSettings) => void;
  /// Non-null when the in-app nudge should be showing.
  nudge: { dueCount: number } | null;
  dismissNudge: () => void;
}

export function usePracticeReminder(
  dueCount: number,
  attemptsToday: number,
): PracticeReminderState {
  const [settings, setSettingsState] = useState<PracticeReminderSettings>(
    () => loadReminderSettings(),
  );
  const [nudge, setNudge] = useState<{ dueCount: number } | null>(null);
  // Live values for the interval callback without re-arming it.
  const liveRef = useRef({ settings, dueCount, attemptsToday });
  liveRef.current = { settings, dueCount, attemptsToday };

  const setSettings = useCallback((next: PracticeReminderSettings) => {
    setSettingsState(next);
    saveReminderSettings(next);
    // Ask for system-notification permission on ENABLE — this runs
    // inside the toggle's tap, so the browser prompt is allowed.
    // Fire-and-forget; in-app nudges work either way.
    if (next.enabled && typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
  }, []);

  const check = useCallback(() => {
      const { settings: s, dueCount: due, attemptsToday: att } = liveRef.current;
      let fired: string | null = null;
      try {
        fired = localStorage.getItem(FIRED_KEY);
      } catch {
        /* ignore */
      }
      if (!shouldFireReminder(s, new Date(), due, att, fired)) return;
      try {
        localStorage.setItem(FIRED_KEY, localDayKey(new Date()));
      } catch {
        /* ignore */
      }
      setNudge({ dueCount: due });
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification("Time to practice", {
            body: `${due} review${due === 1 ? "" : "s"} waiting — keep the chain alive.`,
            tag: "libre-practice-reminder",
          });
        } catch {
          /* some engines require SW-backed notifications — in-app
             nudge already covers it */
        }
      }
  }, []);

  // Re-check on mount + every minute + when the tab becomes visible.
  useEffect(() => {
    check();
    const id = window.setInterval(check, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [check]);

  // ALSO re-check whenever the inputs move — at boot the due count
  // hydrates ASYNC (courses + records land after mount), so the
  // mount-time check sees 0 and the interval would delay the nudge a
  // full minute. The once-per-day fired marker makes this idempotent.
  useEffect(() => {
    check();
  }, [check, dueCount, attemptsToday]);

  return {
    settings,
    setSettings,
    nudge,
    dismissNudge: () => setNudge(null),
  };
}
