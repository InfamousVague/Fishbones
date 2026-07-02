/// Freeze-affordance derivation shared by every surface that renders
/// a streak-shield panel (desktop StatsChip dropdown, mobile Profile).
/// Extracted from StatsChip so mobile doesn't re-implement the "when
/// is 'Freeze yesterday' actually useful" rules, which are subtle:
///
///   - shields must be wired and have budget left this week,
///   - the streak must currently be alive (there's nothing to save
///     otherwise — freezing into a dead run is a wasted shield),
///   - yesterday must have NO real completion (else the freeze is a
///     no-op) and must not already be frozen,
///   - and yesterday must be adjacent to a real active day: either
///     today already has a completion, or the run is surviving on
///     yesterday-grace alone and the freeze locks it in.
///
/// The 1-day grace baked into `computeStreaks` means a streak survives
/// one missed day on its own; the shield only becomes useful when the
/// learner is about to run out of grace.

import { useMemo } from "react";
import type { Completion } from "@/hooks/useProgress";
import { localDayKey, type StreakShieldsState } from "@/hooks/useStreakShields";

export interface FreezeAffordance {
  /// YYYY-MM-DD (local) for yesterday — the only day the UI offers
  /// to freeze.
  yesterdayKey: string;
  /// True when showing the "Freeze yesterday" CTA makes sense.
  canFreezeYesterday: boolean;
  /// Yesterday is already covered by a spent shield.
  yesterdayFrozen: boolean;
  /// The learner already completed something today.
  todayHasCompletion: boolean;
  /// Shields spent this ISO week (perWeek - available).
  usedShields: number;
  /// Total days ever frozen — drives the tiny snowflake-next-to-flame
  /// indicator.
  frozenDayCount: number;
}

export function useFreezeAffordance(
  history: readonly Completion[] | undefined,
  shields: StreakShieldsState | undefined,
  streakActive: boolean,
  streakDays: number,
): FreezeAffordance {
  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDayKey(d);
  }, []);
  const todayKey = useMemo(() => localDayKey(new Date()), []);

  const yesterdayHasCompletion = useMemo(() => {
    if (!history || history.length === 0) return false;
    for (const c of history) {
      if (localDayKey(new Date(c.completed_at * 1000)) === yesterdayKey) {
        return true;
      }
    }
    return false;
  }, [history, yesterdayKey]);

  const todayHasCompletion = useMemo(() => {
    if (!history || history.length === 0) return false;
    for (const c of history) {
      if (localDayKey(new Date(c.completed_at * 1000)) === todayKey) {
        return true;
      }
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
    (todayHasCompletion || streakDays >= 1);

  return {
    yesterdayKey,
    canFreezeYesterday,
    yesterdayFrozen,
    todayHasCompletion,
    usedShields: shields ? shields.perWeek - shields.available : 0,
    frozenDayCount: shields?.frozenDays.size ?? 0,
  };
}
