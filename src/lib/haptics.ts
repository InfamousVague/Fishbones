/// Centralised haptic feedback service. Every "this should buzz"
/// surface in the app routes through one of the semantic intents
/// here instead of hand-rolling `navigator.vibrate()` calls — that
/// way the patterns stay tuned in one place, the user's
/// preferences are honoured globally, and the throttler prevents a
/// chaotic interaction from melting into a single long buzz.
///
/// Design brief: feel alive without burning the battery or
/// becoming a parlour trick. Each intent is a deliberate moment
/// of feedback that synchronises with what the eye sees — taps on
/// buttons, selections on segmented controls, a triple-pulse when
/// a lesson completes, a crescendo when a streak ticks up. The
/// intensity dial in Settings scales every pattern proportionally;
/// reduced-motion users get a flat-zero override regardless of
/// their settings choice.
///
/// Platform routing:
///
///   1. iOS / iPadOS (Tauri shell) — best path is the native
///      `UIImpactFeedbackGenerator` exposed via a Tauri command.
///      The TS side dispatches with the intent name; the Rust
///      bridge picks the matching feedback generator + intensity.
///      Falls through to (3) when the bridge isn't wired (web
///      build, dev server). Native bridge stub: `haptic_fire`
///      command in src-tauri.
///   2. Android (Tauri shell) — same Tauri-command path. The
///      Rust bridge maps intents to Android's
///      `VibrationEffect.createPredefined` constants where
///      available, with vibration-pattern fallbacks.
///   3. Web / non-mobile — `navigator.vibrate(pattern)` where
///      supported (Android Chrome, etc.); silently no-ops on
///      iOS Safari (no API) and on desktop.
///
/// The service is intentionally side-effect-free at import time —
/// nothing fires until `fireHaptic()` is called. Settings are
/// read on every call (cheap localStorage lookup) so a toggle
/// flip takes effect immediately without component re-mounts.

import { invoke } from "@tauri-apps/api/core";
import { isDesktop, isMobile } from "./platform";
import {
  evaluatePolicy,
  recordFireForTelemetry,
} from "@/lib/haptics/context";

// ─── Intents ──────────────────────────────────────────────────

/// Every haptic moment in the app maps to one of these intents.
/// Naming follows iOS's `UIImpactFeedbackGenerator` style + a
/// `notification.*` family for compound patterns.
///
/// When adding a new intent:
///   1. Add the case to `HapticIntent` here.
///   2. Add the pattern + iOS feedback-style mapping in
///      `INTENT_PROFILES` below.
///   3. Update the Rust bridge (if you've wired one) to handle
///      the new case.
///
/// Keep this list small. New surfaces should reach for an
/// existing intent before adding a new one — the more intents
/// we have, the harder it is to keep their patterns distinct
/// enough to feel different on a fingertip.
export type HapticIntent =
  /// Button tap, link tap, anything-the-user-just-pressed
  /// feedback. Used liberally on mobile primary controls.
  | "tap"
  /// Tab switch, segmented control change, theme picker pick.
  /// Slightly weightier than `tap` so the user can tell "I
  /// confirmed a choice" from "I touched a button."
  | "selection"
  /// Light impact — modal open, sheet present, popover dismiss.
  | "impact-light"
  /// Medium impact — significant transition (lesson change,
  /// course open, navigate-to-detail).
  | "impact-medium"
  /// Heavy impact — destructive confirmation, achievement
  /// unlock first-frame, certificate earned hero moment.
  | "impact-heavy"
  /// Notification family — three-pulse patterns mapped to
  /// success / warning / error semantics. Use these for
  /// asynchronous outcomes (test run finishes, sync completes,
  /// validation rejected).
  | "notification-success"
  | "notification-warning"
  | "notification-error"
  /// Streak-bump crescendo — ascending pulses that read as
  /// "+1 day, +2 day, +3 day" momentum. Fires on the streak
  /// counter incrementing.
  | "streak-bump"
  /// Level-up burst — five-pulse celebration for the
  /// achievement-unlock / level-up modal. Pairs with the
  /// confetti VFX timing.
  | "level-up"
  /// Course-complete finale — long descending pattern timed
  /// to the certificate-mint moment. Heavy + memorable.
  | "completion";

interface IntentProfile {
  /// Vibration pattern in milliseconds for the
  /// `navigator.vibrate(pattern)` web fallback. Numbers at
  /// even indices are buzz durations, odd indices are pauses.
  /// A single-number pattern is one buzz.
  pattern: number | number[];
  /// Logical "style" hint for the native iOS bridge — maps to
  /// `UIImpactFeedbackGenerator.FeedbackStyle` (light / medium
  /// / heavy / soft / rigid) OR a notification type
  /// (success / warning / error). Bridge code picks the
  /// generator class to instantiate.
  style:
    | "light"
    | "medium"
    | "heavy"
    | "soft"
    | "rigid"
    | "success"
    | "warning"
    | "error"
    | "pattern";
  /// Soft "do not fire this more often than every N ms" — a
  /// per-intent floor so a chatty surface can't spam the same
  /// haptic. Combined with the global throttle below; the
  /// stricter of the two wins.
  cooldownMs: number;
}

const INTENT_PROFILES: Record<HapticIntent, IntentProfile> = {
  tap:                  { pattern: 8,                          style: "light",   cooldownMs: 35  },
  selection:            { pattern: 12,                         style: "soft",    cooldownMs: 35  },
  "impact-light":       { pattern: 15,                         style: "light",   cooldownMs: 50  },
  "impact-medium":      { pattern: 22,                         style: "medium",  cooldownMs: 75  },
  "impact-heavy":       { pattern: 32,                         style: "heavy",   cooldownMs: 120 },
  "notification-success": { pattern: [20, 40, 28],             style: "success", cooldownMs: 350 },
  "notification-warning": { pattern: [40, 60, 40],             style: "warning", cooldownMs: 400 },
  "notification-error":   { pattern: [70, 35, 70],             style: "error",   cooldownMs: 450 },
  "streak-bump":        { pattern: [10, 50, 16, 50, 24],       style: "pattern", cooldownMs: 600 },
  "level-up":           { pattern: [22, 30, 28, 30, 36, 40, 55], style: "pattern", cooldownMs: 900 },
  completion:           { pattern: [30, 40, 40, 50, 90],       style: "pattern", cooldownMs: 1200 },
};

// ─── Settings ─────────────────────────────────────────────────

/// localStorage keys for the user-facing haptics preferences.
/// Read on every call so a Settings toggle propagates instantly.
const STORAGE_KEY_ENABLED = "libre:haptics-enabled";
const STORAGE_KEY_INTENSITY = "libre:haptics-intensity";

/// Sensible defaults. Mobile users get haptics on at 0.7 intensity
/// (close to native iOS "default" feel without overpowering chrome
/// taps); desktop users default OFF since most desktop machines
/// can't vibrate anyway and the few that can (laptops with a
/// gamepad plugged in) would feel out of place.
const DEFAULT_ENABLED = isMobile;
const DEFAULT_INTENSITY = 0.7;

export interface HapticSettings {
  enabled: boolean;
  /// 0.0 (off) to 1.0 (full strength). Scales vibration
  /// durations on the web fallback and is forwarded to the
  /// native bridge so iOS / Android can apply the same scale.
  intensity: number;
}

export function readHapticSettings(): HapticSettings {
  if (typeof localStorage === "undefined") {
    return { enabled: DEFAULT_ENABLED, intensity: DEFAULT_INTENSITY };
  }
  try {
    const enabledRaw = localStorage.getItem(STORAGE_KEY_ENABLED);
    const intensityRaw = localStorage.getItem(STORAGE_KEY_INTENSITY);
    const enabled = enabledRaw === null ? DEFAULT_ENABLED : enabledRaw === "1";
    const intensity = intensityRaw === null
      ? DEFAULT_INTENSITY
      : clamp01(Number.parseFloat(intensityRaw));
    return { enabled, intensity };
  } catch {
    return { enabled: DEFAULT_ENABLED, intensity: DEFAULT_INTENSITY };
  }
}

export function writeHapticSettings(next: Partial<HapticSettings>): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (typeof next.enabled === "boolean") {
      localStorage.setItem(STORAGE_KEY_ENABLED, next.enabled ? "1" : "0");
    }
    if (typeof next.intensity === "number") {
      localStorage.setItem(
        STORAGE_KEY_INTENSITY,
        clamp01(next.intensity).toFixed(2),
      );
    }
    // Fire a window event so any subscribed UI (the Settings
    // pane's live preview, the "haptics off" toast, etc.) can
    // re-render without polling localStorage.
    window.dispatchEvent(new CustomEvent("libre:haptics-settings-changed"));
  } catch {
    /* private mode / quota / SSR — ignore */
  }
}

// ─── Reduced motion ───────────────────────────────────────────

/// Cached result of `prefers-reduced-motion`. Read once on first
/// fire since the value rarely changes mid-session; if a user
/// changes the OS setting they typically need a restart for it
/// to propagate anyway.
let cachedReducedMotion: boolean | null = null;
function prefersReducedMotion(): boolean {
  if (cachedReducedMotion !== null) return cachedReducedMotion;
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    cachedReducedMotion = false;
    return false;
  }
  try {
    cachedReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  } catch {
    cachedReducedMotion = false;
  }
  return cachedReducedMotion!;
}

// ─── Throttle ─────────────────────────────────────────────────

/// Global floor — even unrelated haptics back off if they're
/// fired in rapid succession. Prevents a long-press from melting
/// into one continuous buzz when each frame fires its own intent.
const GLOBAL_THROTTLE_MS = 25;

/// Tracks the last fire time per intent (for the per-intent
/// cooldown) and globally (for the global floor).
const lastFireAt = new Map<HapticIntent, number>();
let lastGlobalFireAt = 0;

function shouldFire(intent: HapticIntent, now: number): boolean {
  if (now - lastGlobalFireAt < GLOBAL_THROTTLE_MS) return false;
  const cooldown = INTENT_PROFILES[intent].cooldownMs;
  const lastForIntent = lastFireAt.get(intent) ?? 0;
  if (now - lastForIntent < cooldown) return false;
  return true;
}

function recordFire(intent: HapticIntent, now: number): void {
  lastGlobalFireAt = now;
  lastFireAt.set(intent, now);
}

// ─── Pattern scaling ──────────────────────────────────────────

/// Apply the user's intensity slider to a pattern. The web
/// fallback's `navigator.vibrate` only honours buzz DURATION
/// (not amplitude), so intensity scales the durations. The
/// pauses between buzzes are preserved — scaling them too
/// would muddle the rhythmic character of multi-pulse intents.
function scalePattern(
  pattern: number | number[],
  intensity: number,
): number | number[] {
  const scale = clamp01(intensity);
  if (typeof pattern === "number") {
    return Math.max(0, Math.round(pattern * scale));
  }
  return pattern.map((ms, i) =>
    // Even indices are buzzes; odd indices are pauses.
    i % 2 === 0 ? Math.max(0, Math.round(ms * scale)) : ms,
  );
}

// ─── Native bridge (Tauri) ─────────────────────────────────────

/// Result type from the Rust `haptic_fire` command. The bridge
/// is best-effort — if it isn't wired (web build, dev server,
/// older app version) the invoke promise rejects and we fall
/// through to the web fallback. `available: false` is a soft
/// signal from a wired bridge that there's no hardware support
/// (iPod touch, iPad without Taptic Engine), in which case we
/// also fall through.
interface NativeHapticResult {
  fired: boolean;
  available: boolean;
}

/// Cached result of "is the native Tauri haptic bridge there?"
/// — true means at least one previous invoke succeeded; false
/// means we hit an "unknown command" error and shouldn't bother
/// trying again this session. null = haven't checked yet.
let nativeBridgeAvailable: boolean | null = null;

async function fireNativeHaptic(
  intent: HapticIntent,
  intensity: number,
): Promise<boolean> {
  // If a prior invoke rejected with "command not found" we
  // remember that and skip — invoking an unknown command on
  // every haptic would log a console error per fire.
  if (nativeBridgeAvailable === false) return false;
  try {
    const result = await invoke<NativeHapticResult>("haptic_fire", {
      intent,
      style: INTENT_PROFILES[intent].style,
      intensity,
      pattern: INTENT_PROFILES[intent].pattern,
    });
    nativeBridgeAvailable = true;
    return result.fired && result.available;
  } catch {
    nativeBridgeAvailable = false;
    return false;
  }
}

// ─── Web fallback ─────────────────────────────────────────────

function fireWebHaptic(
  intent: HapticIntent,
  intensity: number,
): boolean {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.vibrate !== "function"
  ) {
    return false;
  }
  const profile = INTENT_PROFILES[intent];
  const scaled = scalePattern(profile.pattern, intensity);
  try {
    // navigator.vibrate returns true if accepted; some
    // browsers (iOS Safari) silently no-op + return false.
    return navigator.vibrate(scaled) === true;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────

/// Fire a haptic for the given intent. Runs the policy layer
/// first (categories, quiet hours, battery awareness, per-screen
/// overrides), then attempts the native Tauri bridge, then falls
/// back to `navigator.vibrate`. Best-effort + async-safe: the
/// returned promise resolves once the bridge attempt finishes
/// regardless of whether the haptic actually fired on hardware.
///
/// Most call sites don't need to await — fire and forget. Tests +
/// the developer preview surface can await to know when the
/// engine has fully consulted the bridge.
export async function fireHaptic(intent: HapticIntent): Promise<void> {
  // Desktop: skip entirely. Most desktop machines have no
  // haptic hardware, and the few that do (a paired iPhone via
  // Continuity, a haptic gamepad) shouldn't be driven by chrome
  // taps. Mobile users + future tablet builds get the full
  // experience.
  if (isDesktop && !isMobile) return;

  const settings = readHapticSettings();
  if (!settings.enabled || settings.intensity <= 0) return;
  if (prefersReducedMotion()) return;

  // Policy layer — categories, quiet hours, battery, context.
  // Returns early when the policy denies; otherwise hands back
  // an intensity multiplier we fold into the user setting.
  const decision = evaluatePolicy(intent);
  if (!decision.allowed) return;
  const effectiveIntensity = clamp01(
    settings.intensity * decision.intensityMultiplier,
  );
  if (effectiveIntensity <= 0) return;

  const now = Date.now();
  if (!shouldFire(intent, now)) return;
  recordFire(intent, now);
  recordFireForTelemetry(intent);

  // Try the native bridge first; fall through to web vibrate
  // if it isn't available or returned `available: false`.
  const nativeFired = await fireNativeHaptic(intent, effectiveIntensity);
  if (nativeFired) return;
  fireWebHaptic(intent, effectiveIntensity);
}

/// Convenience helpers — each maps to a single intent, named so
/// consumers can read like prose at the call site. Use these in
/// place of `fireHaptic("…")` when the intent is unambiguous.
export const haptics = {
  tap: () => fireHaptic("tap"),
  selection: () => fireHaptic("selection"),
  light: () => fireHaptic("impact-light"),
  medium: () => fireHaptic("impact-medium"),
  heavy: () => fireHaptic("impact-heavy"),
  success: () => fireHaptic("notification-success"),
  warning: () => fireHaptic("notification-warning"),
  error: () => fireHaptic("notification-error"),
  streakBump: () => fireHaptic("streak-bump"),
  levelUp: () => fireHaptic("level-up"),
  completion: () => fireHaptic("completion"),
} as const;

// ─── Animation-synchronised fire ──────────────────────────────

/// Fire a haptic at a specific delay from now. Useful for
/// syncing the buzz with an animation keyframe — e.g. a
/// celebration that pulses on the 200ms / 450ms / 800ms
/// keyframes of a confetti burst.
///
/// Returns a cancel function so callers that unmount before
/// the delay elapses don't fire a haptic on a dead component.
export function fireHapticAt(
  intent: HapticIntent,
  delayMs: number,
): () => void {
  if (delayMs <= 0) {
    void fireHaptic(intent);
    return () => {};
  }
  const id = window.setTimeout(() => {
    void fireHaptic(intent);
  }, delayMs);
  return () => window.clearTimeout(id);
}

/// Fire a sequence of haptics at relative time offsets. Each
/// entry is `[intent, msFromStart]`. Returns a cancel function
/// that clears every pending timer.
///
/// Example — pulse on the 0/300/650ms keyframes of a section-
/// complete VFX:
///
///   fireHapticSequence([
///     ["impact-medium", 0],
///     ["impact-light", 300],
///     ["notification-success", 650],
///   ]);
export function fireHapticSequence(
  steps: Array<readonly [HapticIntent, number]>,
): () => void {
  const cancels = steps.map(([intent, ms]) => fireHapticAt(intent, ms));
  return () => cancels.forEach((cancel) => cancel());
}

// ─── Pattern firing (custom / preset) ─────────────────────────

/// Fire an arbitrary pattern from the pattern library. Bypasses
/// the named-intent system — the pattern's beats become the
/// `navigator.vibrate` payload directly, scaled by the user's
/// intensity setting + policy multipliers.
///
/// Used by:
///   - the custom-pattern preview row in Settings,
///   - feature code that wants a named preset for a specific
///     moment without registering it as a new intent (e.g.
///     the heartbeat pattern on streak milestones),
///   - the streak-milestone path that repeats a pattern N
///     times where N is the count of milestone days.
///
/// `category` lets the policy layer apply the right per-category
/// gate even though we're not going through the intent map.
/// Defaults to "completion" — the category most curated patterns
/// belong to.
export async function firePattern(
  pattern: import("@/lib/haptics/patterns").Pattern,
  category: import("@/lib/haptics/context").HapticCategory = "completion",
): Promise<void> {
  if (isDesktop && !isMobile) return;
  const settings = readHapticSettings();
  if (!settings.enabled || settings.intensity <= 0) return;
  if (prefersReducedMotion()) return;

  // Map the bare-category fire to a sentinel intent so the
  // policy layer sees a real HapticIntent. We use the lowest-
  // weight intent in each category for the throttle key, since
  // a custom pattern's "cost" to the user is roughly equivalent
  // to one chrome buzz no matter how long the pattern is.
  const sentinel: HapticIntent =
    category === "celebration"
      ? "level-up"
      : category === "streak"
        ? "streak-bump"
        : category === "error"
          ? "notification-warning"
          : category === "focus"
            ? "tap"
            : category === "chrome"
              ? "selection"
              : "notification-success";
  const decision = evaluatePolicy(sentinel);
  if (!decision.allowed) return;
  const effectiveIntensity = clamp01(
    settings.intensity * decision.intensityMultiplier,
  );
  if (effectiveIntensity <= 0) return;

  const now = Date.now();
  if (!shouldFire(sentinel, now)) return;
  recordFire(sentinel, now);
  recordFireForTelemetry(sentinel);

  // Materialise the pattern + scale buzz durations by the
  // effective intensity. We do the work here (rather than
  // calling into intensityScale + materialise from the patterns
  // module) so we keep the engine's hot path dependency-free.
  const materialised = pattern.beats.map(([ms, kind]) =>
    kind === "buzz" ? Math.max(0, Math.round(ms * effectiveIntensity)) : ms,
  );
  // Trim leading/trailing zeros so navigator.vibrate doesn't
  // reject the input on some browsers.
  while (materialised.length > 0 && materialised[0] === 0) materialised.shift();
  while (
    materialised.length > 0 &&
    materialised[materialised.length - 1] === 0
  ) {
    materialised.pop();
  }
  if (materialised.length === 0) return;

  // For pattern firing we skip the native bridge — the bridge
  // accepts one named style at a time, not a freeform beat list.
  // Web vibrate handles arbitrary patterns natively. Future
  // native-bridge versions can grow a `fire_pattern` command
  // that wraps `UIImpactFeedbackGenerator` calls in a JS-side
  // timer; for now web is the universal fallback.
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  ) {
    try {
      navigator.vibrate(materialised);
    } catch {
      /* ignore */
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/// Subscribe to settings-changed events fired by
/// `writeHapticSettings`. Returns an unsubscribe function. Used
/// by the Settings pane to drive a live preview that re-fires
/// the chosen intent whenever the slider moves.
export function onHapticSettingsChanged(
  handler: (settings: HapticSettings) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => handler(readHapticSettings());
  window.addEventListener("libre:haptics-settings-changed", wrapped);
  return () =>
    window.removeEventListener("libre:haptics-settings-changed", wrapped);
}
