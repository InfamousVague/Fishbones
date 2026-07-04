/// Firing rules for the daily practice reminder. The nudge is a
/// once-per-day interruption, so the gate logic needs to be exact:
/// never before the chosen time, never without due work, never after
/// the goal is met, never twice in one day.

import { describe, expect, it } from "vitest";
import {
  shouldFireReminder,
  type PracticeReminderSettings,
} from "../usePracticeReminder";

const BASE: PracticeReminderSettings = { enabled: true, time: "18:00", goal: 10 };
const at = (h: number, m = 0) => new Date(2026, 6, 4, h, m);

describe("shouldFireReminder", () => {
  it("fires once past the chosen time with due reviews", () => {
    expect(shouldFireReminder(BASE, at(18, 0), 5, 0, null)).toBe(true);
    expect(shouldFireReminder(BASE, at(23, 59), 1, 3, null)).toBe(true);
  });

  it("never fires before the chosen time", () => {
    expect(shouldFireReminder(BASE, at(17, 59), 5, 0, null)).toBe(false);
    expect(shouldFireReminder(BASE, at(9), 5, 0, null)).toBe(false);
  });

  it("never fires when disabled", () => {
    expect(
      shouldFireReminder({ ...BASE, enabled: false }, at(20), 5, 0, null),
    ).toBe(false);
  });

  it("never fires with nothing due", () => {
    expect(shouldFireReminder(BASE, at(20), 0, 0, null)).toBe(false);
  });

  it("never fires once the daily goal is met", () => {
    expect(shouldFireReminder(BASE, at(20), 5, 10, null)).toBe(false);
    expect(shouldFireReminder(BASE, at(20), 5, 12, null)).toBe(false);
  });

  it("fires at most once per day", () => {
    expect(shouldFireReminder(BASE, at(20), 5, 0, "2026-07-04")).toBe(false);
    // …but yesterday's marker doesn't block today.
    expect(shouldFireReminder(BASE, at(20), 5, 0, "2026-07-03")).toBe(true);
  });
});
