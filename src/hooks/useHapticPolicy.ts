/// Reactive hooks that surface the policy layer's current state.
/// Used by:
///   - the Settings → Haptics pane to render "currently dampened
///     by quiet hours" preview chips,
///   - the developer pane to display the live policy decision,
///   - any future surface that wants to UI-on-the-fact-that-
///     haptics-are-quieted (e.g. a focus-mode screen indicator).
///
/// Hooks are split rather than bundled into one mega-hook so a
/// component that only needs "are we in quiet hours?" doesn't
/// re-render when battery level changes, etc.

import { useEffect, useState } from "react";
import {
  evaluatePolicy,
  isWithinQuietHours,
  readQuietHours,
  readCategorySettings,
  readTelemetrySnapshot,
  type HapticCategory,
  type QuietHours,
  type PolicyDecision,
} from "@/lib/haptics/context";
import type { HapticIntent } from "@/lib/haptics";

/// Returns the current QuietHours config + whether the wall
/// clock is inside the configured window right now. Polls every
/// 30s because the clock-time check is cheap and we don't want
/// to wire window.setInterval into the engine itself (that'd
/// drain idle CPU).
export function useQuietHours(): {
  config: QuietHours;
  active: boolean;
} {
  const [state, setState] = useState(() => ({
    config: readQuietHours(),
    active: isWithinQuietHours(),
  }));
  useEffect(() => {
    const refresh = () =>
      setState({
        config: readQuietHours(),
        active: isWithinQuietHours(),
      });
    const id = window.setInterval(refresh, 30_000);
    window.addEventListener("libre:haptic-quiet-changed", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("libre:haptic-quiet-changed", refresh);
    };
  }, []);
  return state;
}

/// Returns the live per-category enable map. Updates when the
/// user flips a toggle in Settings → Haptics → Categories.
export function useHapticCategories(): Record<HapticCategory, boolean> {
  const [state, setState] = useState(() => readCategorySettings());
  useEffect(() => {
    const refresh = () => setState(readCategorySettings());
    window.addEventListener("libre:haptic-categories-changed", refresh);
    return () =>
      window.removeEventListener("libre:haptic-categories-changed", refresh);
  }, []);
  return state;
}

/// Returns the current policy decision for a given intent —
/// what the engine WOULD do if you fired that intent right now.
/// Useful for previewing in Settings ("this intent is currently
/// allowed at 65% intensity") and for the developer pane.
///
/// Re-evaluates on a 2s timer (cheap) so battery / quiet-hour
/// changes propagate without manual subscription.
export function useHapticDecision(intent: HapticIntent): PolicyDecision {
  const [state, setState] = useState(() => evaluatePolicy(intent));
  useEffect(() => {
    const refresh = () => setState(evaluatePolicy(intent));
    const id = window.setInterval(refresh, 2000);
    window.addEventListener("libre:haptic-categories-changed", refresh);
    window.addEventListener("libre:haptic-quiet-changed", refresh);
    window.addEventListener("libre:haptics-settings-changed", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("libre:haptic-categories-changed", refresh);
      window.removeEventListener("libre:haptic-quiet-changed", refresh);
      window.removeEventListener("libre:haptics-settings-changed", refresh);
    };
  }, [intent]);
  return state;
}

/// Live telemetry snapshot. Refreshes every 1s while the hook is
/// mounted. Used by the developer pane's "live fire log" view
/// and the Settings telemetry card.
export function useHapticTelemetry(): Record<HapticIntent, number> {
  const [state, setState] = useState(() => readTelemetrySnapshot());
  useEffect(() => {
    const refresh = () => setState(readTelemetrySnapshot());
    const id = window.setInterval(refresh, 1000);
    window.addEventListener("libre:haptic-telemetry-reset", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("libre:haptic-telemetry-reset", refresh);
    };
  }, []);
  return state;
}
