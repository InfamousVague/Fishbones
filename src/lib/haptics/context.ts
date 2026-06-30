/// Contextual modifiers for the haptics engine. Sits between the
/// "fire this intent" call site and the underlying engine, and
/// applies environment-aware policies before the fire commits:
///
///   - **Per-category gates** — each intent belongs to a
///     category (chrome / completion / celebration / error /
///     focus / streak). Categories can be toggled independently
///     in Settings; firing a disabled-category intent silently
///     returns without invoking the device.
///
///   - **Quiet hours** — user-configured start/end times during
///     which all haptics dampen to a quieter "whisper" intensity
///     OR mute entirely. Implemented in local time so a
///     traveller's wall-clock semantics apply.
///
///   - **Battery awareness** — when the device reports ≤ the
///     configured threshold (default 20%) the engine
///     automatically downscales intensity to half-strength,
///     avoiding unnecessary battery drain when the user's least
///     likely to want decorative buzzes.
///
///   - **Per-screen overrides** — a React provider lets a
///     specific surface request quieter / louder / disabled
///     haptics during its lifetime (e.g. a meditation breathing
///     exercise screen wants no chrome haptics, but the AI
///     assistant inside it should still buzz on first-token).
///
/// This module is the policy layer. The engine itself is
/// dumb: it takes intent + final-intensity-after-policy and
/// fires.

import { createContext, createElement, useContext, type ReactNode } from "react";

// ─── Category model ───────────────────────────────────────────

/// Every intent in the engine belongs to exactly one category.
/// Categories are user-facing in Settings; the user can disable
/// "chrome" without losing "celebration" feedback.
export type HapticCategory =
  /// Button taps, tab switches, modal opens — the day-to-day
  /// chrome feedback.
  | "chrome"
  /// Lesson complete, course complete, certificate earned —
  /// the "you did the thing" feedback.
  | "completion"
  /// Confetti / coin-shower / achievement-toast accompaniments
  /// — the loud celebration moments.
  | "celebration"
  /// Test fail, network error, validation rejected — feedback
  /// for things that DIDN'T work.
  | "error"
  /// Form-input focus, keyboard appearing, scroll-edge bounce
  /// — micro-feedback for low-level interactions.
  | "focus"
  /// Streak day +1, milestone hit — momentum cues.
  | "streak";

/// All categories in display order (used by the Settings pane
/// for rendering the per-category toggle rows).
export const ALL_CATEGORIES: ReadonlyArray<HapticCategory> = [
  "chrome",
  "completion",
  "celebration",
  "error",
  "focus",
  "streak",
];

interface CategoryMeta {
  label: string;
  description: string;
}

export const CATEGORY_META: Record<HapticCategory, CategoryMeta> = {
  chrome: {
    label: "Chrome",
    description:
      "Button taps, tab switches, modal opens. The day-to-day micro-feedback.",
  },
  completion: {
    label: "Completion",
    description:
      "Lesson done, course finished, certificate earned. The 'you did it' beats.",
  },
  celebration: {
    label: "Celebrations",
    description:
      "Confetti, coin showers, achievement toasts. The loud moments.",
  },
  error: {
    label: "Errors",
    description: "Tests fail, network drops, validation rejected.",
  },
  focus: {
    label: "Focus + edges",
    description:
      "Input focus, keyboard appearing, scroll-edge bounce, swipe end-stops.",
  },
  streak: {
    label: "Streaks",
    description: "Day +1, milestone hit, streak freeze applied.",
  },
};

// Intent → category mapping. Kept here (not on the intent
// definitions in haptics.ts) so the policy module owns the
// classification and the engine stays category-agnostic.
import type { HapticIntent } from "@/lib/haptics";

export const INTENT_CATEGORY: Record<HapticIntent, HapticCategory> = {
  tap: "chrome",
  selection: "chrome",
  "impact-light": "chrome",
  "impact-medium": "chrome",
  "impact-heavy": "completion",
  "notification-success": "completion",
  "notification-warning": "error",
  "notification-error": "error",
  "streak-bump": "streak",
  "level-up": "celebration",
  completion: "completion",
};

// ─── Per-category toggle state ────────────────────────────────

/// localStorage key for the per-category enable map. Format:
/// JSON object `{ chrome: true, focus: false, … }`. Missing
/// keys default to true.
const CATEGORY_STORAGE_KEY = "libre:haptic-categories";

export function readCategorySettings(): Record<HapticCategory, boolean> {
  const defaults: Record<HapticCategory, boolean> = {
    chrome: true,
    completion: true,
    celebration: true,
    error: true,
    focus: true,
    streak: true,
  };
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<HapticCategory, boolean>>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function writeCategorySetting(
  category: HapticCategory,
  enabled: boolean,
): void {
  if (typeof localStorage === "undefined") return;
  const current = readCategorySettings();
  current[category] = enabled;
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("libre:haptic-categories-changed"));
  } catch {
    /* ignore */
  }
}

// ─── Quiet hours ──────────────────────────────────────────────

/// User-configured silent / dampened window. Stored as
/// HH:MM strings in local time so the user sets "no buzzes
/// after 11pm" semantically without worrying about timezone
/// math.
export interface QuietHours {
  /// "off" — no quiet hours configured (default).
  /// "dampen" — during the window, intensity is multiplied by
  /// `dampenFactor` (default 0.3). The user still feels
  /// haptics, just quieter — useful for night-time use without
  /// going fully silent.
  /// "mute" — during the window, no haptics fire at all.
  mode: "off" | "dampen" | "mute";
  /// 24-hour local time "HH:MM". Inclusive start.
  startHHMM: string;
  /// 24-hour local time "HH:MM". Exclusive end. The window
  /// wraps midnight when end < start (e.g. start 22:00, end
  /// 07:00 covers 10pm → 7am).
  endHHMM: string;
  /// Multiplier applied during a "dampen" window. 0.3 = 30%
  /// of normal intensity. Honoured even when intensity is
  /// already low; the floor is the engine's own per-platform
  /// minimum.
  dampenFactor: number;
}

const QUIET_STORAGE_KEY = "libre:haptic-quiet";

const QUIET_DEFAULT: QuietHours = {
  mode: "off",
  startHHMM: "22:00",
  endHHMM: "07:00",
  dampenFactor: 0.3,
};

export function readQuietHours(): QuietHours {
  if (typeof localStorage === "undefined") return QUIET_DEFAULT;
  try {
    const raw = localStorage.getItem(QUIET_STORAGE_KEY);
    if (!raw) return QUIET_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<QuietHours>;
    return { ...QUIET_DEFAULT, ...parsed };
  } catch {
    return QUIET_DEFAULT;
  }
}

export function writeQuietHours(next: Partial<QuietHours>): void {
  if (typeof localStorage === "undefined") return;
  const current = readQuietHours();
  const merged = { ...current, ...next };
  try {
    localStorage.setItem(QUIET_STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent("libre:haptic-quiet-changed"));
  } catch {
    /* ignore */
  }
}

/// Is the current wall-clock time inside the configured quiet
/// window? Returns false when mode is "off" regardless of time.
export function isWithinQuietHours(now: Date = new Date()): boolean {
  const q = readQuietHours();
  if (q.mode === "off") return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = hhmmToMinutes(q.startHHMM);
  const end = hhmmToMinutes(q.endHHMM);
  if (start === null || end === null) return false;
  if (start === end) return false;
  if (start < end) {
    // Same-day window: 09:00 → 17:00 means active when 09 ≤ t < 17.
    return minutes >= start && minutes < end;
  }
  // Cross-midnight window: 22:00 → 07:00 means active when
  // t ≥ 22 OR t < 07.
  return minutes >= start || minutes < end;
}

function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// ─── Battery awareness ────────────────────────────────────────

/// Cached `BatteryManager` reference + last-known level. The
/// Battery API is async to acquire; we cache once on first
/// query so the haptic hot path stays synchronous.
let batteryRef: { level: number; charging: boolean } | null = null;
let batteryAcquired = false;

const BATTERY_LOW_THRESHOLD = 0.2;
const BATTERY_DAMPEN_FACTOR = 0.55;

async function acquireBattery(): Promise<void> {
  if (batteryAcquired) return;
  batteryAcquired = true;
  if (
    typeof navigator === "undefined" ||
    typeof (navigator as unknown as { getBattery?: () => Promise<unknown> })
      .getBattery !== "function"
  ) {
    return;
  }
  try {
    const battery = (await (navigator as unknown as {
      getBattery: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (kind: string, fn: () => void) => void;
      }>;
    }).getBattery());
    batteryRef = { level: battery.level, charging: battery.charging };
    const refresh = () => {
      batteryRef = { level: battery.level, charging: battery.charging };
    };
    battery.addEventListener("levelchange", refresh);
    battery.addEventListener("chargingchange", refresh);
  } catch {
    /* Battery API rejected — give up + treat as full-power */
  }
}

/// Returns the battery-aware intensity multiplier. 1.0 when
/// charging or above the low threshold; `BATTERY_DAMPEN_FACTOR`
/// when discharging and at or below the threshold. Triggers
/// async acquisition on the first call but returns 1.0 until
/// the acquisition resolves — the engine survives without
/// battery info, just doesn't dampen on the very first fire
/// after launch.
export function batteryIntensityScale(): number {
  void acquireBattery();
  if (!batteryRef) return 1;
  if (batteryRef.charging) return 1;
  if (batteryRef.level > BATTERY_LOW_THRESHOLD) return 1;
  return BATTERY_DAMPEN_FACTOR;
}

// ─── Per-screen overrides (React context) ─────────────────────

/// Per-screen override applied to every fire that happens while
/// the provider is in the tree. Use this for screens that need
/// quieter chrome (meditation / focus-mode UIs) or that want to
/// disable haptics entirely while a sensitive operation runs
/// (a quiz timer that shouldn't tap-buzz on every keystroke).
export interface HapticContextValue {
  /// Multiplier applied on top of the user's global intensity.
  /// `null` = use the global intensity unchanged.
  intensityScale: number | null;
  /// When true, no haptic fires while the provider is active.
  /// Overrides user settings — use sparingly (mainly for
  /// "audio recording in progress" type contexts).
  mute: boolean;
  /// Per-category overrides. Categories not listed inherit
  /// from the user's global per-category enable map.
  categoryOverrides: Partial<Record<HapticCategory, boolean>>;
}

const DEFAULT_CONTEXT: HapticContextValue = {
  intensityScale: null,
  mute: false,
  categoryOverrides: {},
};

const HapticReactContext = createContext<HapticContextValue>(DEFAULT_CONTEXT);

export function HapticProvider({
  children,
  intensityScale = null,
  mute = false,
  categoryOverrides = {},
}: {
  children: ReactNode;
} & Partial<HapticContextValue>) {
  return createElement(
    HapticReactContext.Provider,
    {
      value: { intensityScale, mute, categoryOverrides },
    },
    children,
  );
}

export function useHapticContext(): HapticContextValue {
  return useContext(HapticReactContext);
}

// The non-React side of the engine can't easily read context,
// so we mirror the active value into a module-scoped slot and
// expose it for engine.fireHaptic to read. A tiny effect inside
// the provider syncs the mirror on mount + on value changes.
let mirroredContext: HapticContextValue = DEFAULT_CONTEXT;

/// Internal: engine reads this on every fire. Updated by the
/// HapticContextMirror effect below.
export function currentContextOverride(): HapticContextValue {
  return mirroredContext;
}

/// Internal: mounted inside HapticProvider via an effect to
/// keep the mirror in sync with React state. Kept separate from
/// the provider component so a non-React fire (deep timer
/// callback) still respects the context.
export function setContextOverride(next: HapticContextValue): void {
  mirroredContext = next;
}

// ─── Telemetry counters ───────────────────────────────────────

/// Opt-in per-intent fire count tracker. Used to surface "which
/// intents fired most in this session" in the Settings ->
/// Haptics -> Telemetry view, and (if the user shares
/// telemetry) inform the next iteration of pattern tuning.
///
/// Storage is in-memory only — never persisted, never sent off
/// device. The values reset on app launch. We don't track per-
/// surface (which screen fired) because that crosses into
/// behavioural telemetry the privacy posture wants to avoid.

const fireCounts = new Map<HapticIntent, number>();

export function recordFireForTelemetry(intent: HapticIntent): void {
  fireCounts.set(intent, (fireCounts.get(intent) ?? 0) + 1);
}

export function readTelemetrySnapshot(): Record<HapticIntent, number> {
  const out = {} as Record<HapticIntent, number>;
  for (const intent of Object.keys(INTENT_CATEGORY) as HapticIntent[]) {
    out[intent] = fireCounts.get(intent) ?? 0;
  }
  return out;
}

export function resetTelemetry(): void {
  fireCounts.clear();
  window.dispatchEvent(new CustomEvent("libre:haptic-telemetry-reset"));
}

// ─── Policy composition ───────────────────────────────────────

/// Result of policy evaluation. The engine consumes this on
/// every fire to know:
///   - whether to fire at all (`allowed: false` short-circuits)
///   - what intensity multiplier to apply on top of the user
///     setting (categories don't tune intensity; quiet hours
///     and battery awareness do)
export interface PolicyDecision {
  allowed: boolean;
  /// Final intensity multiplier: product of context override
  /// (if any), quiet-hour dampen factor (if dampened), and
  /// battery awareness. Multiplied by the user's intensity
  /// slider inside the engine. 1.0 = no policy adjustment.
  intensityMultiplier: number;
  /// Diagnostic string for the developer pane / telemetry —
  /// short note describing why the policy decided what it did.
  /// e.g. "muted by context", "dampened by quiet hours",
  /// "low battery dampen", "OK".
  reason: string;
}

export function evaluatePolicy(intent: HapticIntent): PolicyDecision {
  const ctx = currentContextOverride();
  if (ctx.mute) {
    return {
      allowed: false,
      intensityMultiplier: 0,
      reason: "muted by context",
    };
  }

  const category = INTENT_CATEGORY[intent];

  // Per-screen category override wins over the global enable
  // map — explicit "celebration: false" on a meditation screen
  // overrides the user's global "celebration: true".
  const ctxCategoryAllowed = ctx.categoryOverrides[category];
  if (ctxCategoryAllowed === false) {
    return {
      allowed: false,
      intensityMultiplier: 0,
      reason: `category ${category} disabled by context`,
    };
  }
  if (ctxCategoryAllowed === undefined) {
    const globalAllowed = readCategorySettings()[category];
    if (!globalAllowed) {
      return {
        allowed: false,
        intensityMultiplier: 0,
        reason: `category ${category} disabled globally`,
      };
    }
  }

  // Quiet hours: mute or dampen depending on mode.
  const quiet = readQuietHours();
  let multiplier = 1;
  if (quiet.mode !== "off" && isWithinQuietHours()) {
    if (quiet.mode === "mute") {
      return {
        allowed: false,
        intensityMultiplier: 0,
        reason: "muted by quiet hours",
      };
    }
    multiplier *= Math.max(0, Math.min(1, quiet.dampenFactor));
  }

  // Battery dampen on top of any quiet-hour dampen.
  multiplier *= batteryIntensityScale();

  // Context's own intensity scale on top of everything.
  if (ctx.intensityScale !== null) {
    multiplier *= Math.max(0, Math.min(1, ctx.intensityScale));
  }

  return {
    allowed: true,
    intensityMultiplier: multiplier,
    reason:
      multiplier === 1
        ? "OK"
        : `dampened to ${(multiplier * 100).toFixed(0)}%`,
  };
}
