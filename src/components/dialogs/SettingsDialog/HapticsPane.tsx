/// "Haptics" pane — the full control panel for the haptic
/// feedback engine. Six cards stacked top-to-bottom:
///
///   1. **Master** — global toggle + intensity slider with
///      live preview.
///   2. **Categories** — per-category enable rows (chrome,
///      completion, celebration, error, focus, streak). Lets
///      the user keep "the buzz on the Run button" but disable
///      "the buzz on every tab switch", or vice versa.
///   3. **Quiet hours** — time-windowed dampening or muting.
///      Off / dampen / mute mode, start + end time pickers,
///      dampen-factor slider.
///   4. **Impacts** — preview row per impact intent.
///   5. **Notifications** — preview row per notification intent.
///   6. **Patterns** — preview row per pattern intent + the
///      curated preset library + a custom-pattern editor.
///   7. **Telemetry** — per-intent fire counts since launch,
///      with a Reset button.
///
/// Lives at the size + density of every other pane in the
/// Cipher-style settings dialog.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { play as playIcon } from "@base/primitives/icon/icons/play";
import { sliders } from "@base/primitives/icon/icons/sliders";
import { vibrate } from "@base/primitives/icon/icons/vibrate";
import { vibrateOff } from "@base/primitives/icon/icons/vibrate-off";
import { mousePointerClick } from "@base/primitives/icon/icons/mouse-pointer-click";
import { check } from "@base/primitives/icon/icons/check";
import { triangleAlert } from "@base/primitives/icon/icons/triangle-alert";
import { circleX } from "@base/primitives/icon/icons/circle-x";
import { flame } from "@base/primitives/icon/icons/flame";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { award } from "@base/primitives/icon/icons/award";
import { zap } from "@base/primitives/icon/icons/zap";
import { circle } from "@base/primitives/icon/icons/circle";
import { moon } from "@base/primitives/icon/icons/moon";
import { sun } from "@base/primitives/icon/icons/sun";
import { trash2 } from "@base/primitives/icon/icons/trash-2";

import {
  fireHaptic,
  firePattern,
  readHapticSettings,
  writeHapticSettings,
  onHapticSettingsChanged,
  type HapticIntent,
} from "../../../lib/haptics";
import {
  ALL_CATEGORIES,
  CATEGORY_META,
  readCategorySettings,
  writeCategorySetting,
  readQuietHours,
  writeQuietHours,
  readTelemetrySnapshot,
  resetTelemetry,
  INTENT_CATEGORY,
  type HapticCategory,
  type QuietHours,
} from "../../../lib/haptics/context";
import {
  PRESETS,
  listCustomPatterns,
  saveCustomPattern,
  deleteCustomPattern,
  newCustomPatternId,
  type Pattern,
  type Preset,
} from "../../../lib/haptics/patterns";

import SettingsCard, { SettingsPage } from "./SettingsCard";
import SettingsRow from "./SettingsRow";
import SettingsToggle from "./SettingsToggle";

interface IntentMeta {
  intent: HapticIntent;
  icon: string;
  label: string;
  sub: string;
}

const IMPACT_INTENTS: IntentMeta[] = [
  { intent: "tap", icon: mousePointerClick, label: "Tap", sub: "Light buzz on every button press. The default mobile chrome feedback." },
  { intent: "selection", icon: circle, label: "Selection", sub: "Confirms tab changes, theme picks, and segmented-control toggles." },
  { intent: "impact-light", icon: zap, label: "Light impact", sub: "Modal open, popover dismiss, sheet present." },
  { intent: "impact-medium", icon: zap, label: "Medium impact", sub: "Significant transition — lesson change, course open, navigation to detail." },
  { intent: "impact-heavy", icon: zap, label: "Heavy impact", sub: "Destructive confirmation, achievement unlock first frame." },
];

const NOTIFICATION_INTENTS: IntentMeta[] = [
  { intent: "notification-success", icon: check, label: "Success", sub: "Tests pass, lesson marked complete, sync finishes." },
  { intent: "notification-warning", icon: triangleAlert, label: "Warning", sub: "Validation rejected, network slow, optional step skipped." },
  { intent: "notification-error", icon: circleX, label: "Error", sub: "Tests fail, run errored, sync rejected." },
];

const PATTERN_INTENTS: IntentMeta[] = [
  { intent: "streak-bump", icon: flame, label: "Streak bump", sub: "Ascending crescendo when the streak counter ticks up." },
  { intent: "level-up", icon: award, label: "Level up", sub: "Five-pulse celebration on the level-up modal, paired with confetti." },
  { intent: "completion", icon: trophy, label: "Course complete", sub: "Long descending finale timed to the certificate-mint moment." },
];

export default function HapticsPane() {
  // ─── Master settings ─────────────────────────────────────────
  const initial = readHapticSettings();
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [intensity, setIntensity] = useState<number>(initial.intensity);

  useEffect(() => {
    return onHapticSettingsChanged((next) => {
      setEnabled(next.enabled);
      setIntensity(next.intensity);
    });
  }, []);

  const onToggleEnabled = (next: boolean) => {
    setEnabled(next);
    writeHapticSettings({ enabled: next });
    if (next) void fireHaptic("tap");
  };
  const onIntensity = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setIntensity(clamped);
    writeHapticSettings({ intensity: clamped });
  };
  const onIntensityRelease = () => {
    if (enabled) void fireHaptic("selection");
  };

  // ─── Category settings ───────────────────────────────────────
  const [categories, setCategories] = useState<Record<HapticCategory, boolean>>(
    () => readCategorySettings(),
  );
  useEffect(() => {
    const handler = () => setCategories(readCategorySettings());
    window.addEventListener("libre:haptic-categories-changed", handler);
    return () =>
      window.removeEventListener("libre:haptic-categories-changed", handler);
  }, []);

  // ─── Quiet hours ─────────────────────────────────────────────
  const [quiet, setQuiet] = useState<QuietHours>(() => readQuietHours());
  useEffect(() => {
    const handler = () => setQuiet(readQuietHours());
    window.addEventListener("libre:haptic-quiet-changed", handler);
    return () =>
      window.removeEventListener("libre:haptic-quiet-changed", handler);
  }, []);
  const updateQuiet = (next: Partial<QuietHours>) => {
    writeQuietHours(next);
  };

  // ─── Custom patterns ─────────────────────────────────────────
  const [customs, setCustoms] = useState<Pattern[]>(() => listCustomPatterns());
  useEffect(() => {
    const handler = () => setCustoms(listCustomPatterns());
    window.addEventListener("libre:haptic-patterns-changed", handler);
    return () =>
      window.removeEventListener("libre:haptic-patterns-changed", handler);
  }, []);

  // ─── Telemetry ───────────────────────────────────────────────
  // Refresh every 2s while the pane is open so the counters tick
  // live if the user fires haptics from another part of the app
  // (e.g. opens settings, tabs out to do something, comes back).
  const [telemetry, setTelemetry] = useState(() => readTelemetrySnapshot());
  useEffect(() => {
    const id = window.setInterval(() => {
      setTelemetry(readTelemetrySnapshot());
    }, 2000);
    const handler = () => setTelemetry(readTelemetrySnapshot());
    window.addEventListener("libre:haptic-telemetry-reset", handler);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("libre:haptic-telemetry-reset", handler);
    };
  }, []);

  const totalFires = useMemo(
    () => Object.values(telemetry).reduce((a, b) => a + b, 0),
    [telemetry],
  );

  // ─── Preview helpers ─────────────────────────────────────────
  const renderPlay = (intent: HapticIntent) => (
    <button
      type="button"
      onClick={() => void fireHaptic(intent)}
      aria-label={`Preview ${intent} haptic`}
      className="libre-settings-cue-play"
    >
      <Icon icon={playIcon} size="xs" color="currentColor" />
    </button>
  );

  return (
    <SettingsPage
      title="Haptics"
      description="Tactile feedback timed with what's on screen. On supported devices, every primary interaction fires a subtle buzz so the app feels alive in your hand. Use the cards below to tune which moments buzz, how strongly, and when."
    >
      {/* ─── 1. Master ──────────────────────────────────────── */}
      <SettingsCard title="Master">
        <SettingsRow
          icon={enabled ? vibrate : vibrateOff}
          tone={enabled ? "accent" : "default"}
          label="Haptic feedback"
          sub="Master switch — kills every buzz when off."
          control={
            <SettingsToggle
              checked={enabled}
              onChange={onToggleEnabled}
              label="Haptic feedback"
            />
          }
        />
        <SettingsRow
          icon={sliders}
          label="Intensity"
          sub={`Scales every pattern's duration. Currently ${Math.round(intensity * 100)}%.`}
          control={
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={intensity}
              onChange={(e) => onIntensity(Number.parseFloat(e.target.value))}
              onPointerUp={onIntensityRelease}
              onKeyUp={(e) => {
                if (
                  e.key === "ArrowLeft" ||
                  e.key === "ArrowRight" ||
                  e.key === "Home" ||
                  e.key === "End"
                ) {
                  onIntensityRelease();
                }
              }}
              aria-label="Haptic intensity"
              disabled={!enabled}
              className="libre-settings-cue-slider"
            />
          }
        />
      </SettingsCard>

      {/* ─── 2. Categories ──────────────────────────────────── */}
      <SettingsCard
        title="Categories"
        // Per-category gates let users keep the feedback they
        // want and silence the rest. Toggling off a category
        // here doesn't reach back into the master switch — the
        // master can stay on while specific moments mute.
      >
        {ALL_CATEGORIES.map((cat) => {
          const meta = CATEGORY_META[cat];
          return (
            <SettingsRow
              key={cat}
              icon={categoryIconFor(cat)}
              label={meta.label}
              sub={meta.description}
              control={
                <SettingsToggle
                  checked={categories[cat]}
                  onChange={(next) => {
                    writeCategorySetting(cat, next);
                  }}
                  label={meta.label}
                  disabled={!enabled}
                />
              }
            />
          );
        })}
      </SettingsCard>

      {/* ─── 3. Quiet hours ─────────────────────────────────── */}
      <SettingsCard title="Quiet hours">
        <SettingsRow
          icon={moon}
          label="Mode"
          sub={
            quiet.mode === "off"
              ? "Off — haptics play at full strength all day."
              : quiet.mode === "dampen"
                ? `Dampen during ${quiet.startHHMM}–${quiet.endHHMM} (${Math.round(quiet.dampenFactor * 100)}% intensity).`
                : `Mute during ${quiet.startHHMM}–${quiet.endHHMM}.`
          }
          control={
            <select
              value={quiet.mode}
              onChange={(e) =>
                updateQuiet({
                  mode: e.target.value as QuietHours["mode"],
                })
              }
              disabled={!enabled}
              className="libre-settings-cue-slider"
              aria-label="Quiet hours mode"
            >
              <option value="off">Off</option>
              <option value="dampen">Dampen</option>
              <option value="mute">Mute</option>
            </select>
          }
        />
        {quiet.mode !== "off" && (
          <>
            <SettingsRow
              icon={moon}
              label="Start"
              sub="When the quiet window begins (24-hour, local time)."
              control={
                <input
                  type="time"
                  value={quiet.startHHMM}
                  onChange={(e) => updateQuiet({ startHHMM: e.target.value })}
                  disabled={!enabled}
                  className="libre-settings-cue-slider"
                  aria-label="Quiet hours start"
                />
              }
            />
            <SettingsRow
              icon={sun}
              label="End"
              sub="When the window lifts. End-before-start wraps midnight."
              control={
                <input
                  type="time"
                  value={quiet.endHHMM}
                  onChange={(e) => updateQuiet({ endHHMM: e.target.value })}
                  disabled={!enabled}
                  className="libre-settings-cue-slider"
                  aria-label="Quiet hours end"
                />
              }
            />
            {quiet.mode === "dampen" && (
              <SettingsRow
                icon={sliders}
                label="Dampen factor"
                sub={`Intensity multiplier inside the window. ${Math.round(quiet.dampenFactor * 100)}%.`}
                control={
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={quiet.dampenFactor}
                    onChange={(e) =>
                      updateQuiet({
                        dampenFactor: Number.parseFloat(e.target.value),
                      })
                    }
                    disabled={!enabled}
                    className="libre-settings-cue-slider"
                    aria-label="Quiet hours dampen factor"
                  />
                }
              />
            )}
          </>
        )}
      </SettingsCard>

      {/* ─── 4. Impacts ─────────────────────────────────────── */}
      <SettingsCard title="Impacts">
        {IMPACT_INTENTS.map((m) => (
          <SettingsRow
            key={m.intent}
            icon={m.icon}
            label={m.label}
            sub={m.sub}
            control={renderPlay(m.intent)}
          />
        ))}
      </SettingsCard>

      {/* ─── 5. Notifications ───────────────────────────────── */}
      <SettingsCard title="Notifications">
        {NOTIFICATION_INTENTS.map((m) => (
          <SettingsRow
            key={m.intent}
            icon={m.icon}
            tone="accent"
            label={m.label}
            sub={m.sub}
            control={renderPlay(m.intent)}
          />
        ))}
      </SettingsCard>

      {/* ─── 6. Patterns + presets + custom ──────────────────── */}
      <SettingsCard title="Patterns">
        {PATTERN_INTENTS.map((m) => (
          <SettingsRow
            key={m.intent}
            icon={m.icon}
            label={m.label}
            sub={m.sub}
            control={renderPlay(m.intent)}
          />
        ))}
      </SettingsCard>

      <SettingsCard title="Preset library">
        {PRESETS.map((preset) => (
          <PresetRow key={preset.id} preset={preset} disabled={!enabled} />
        ))}
      </SettingsCard>

      <SettingsCard title="Custom patterns">
        <CustomPatternEditor disabled={!enabled} />
        {customs.length > 0 && (
          customs.map((p) => (
            <SettingsRow
              key={p.id}
              icon={vibrate}
              label={p.id}
              sub={`${p.beats.length} beats · ${p.beats.reduce((s, [ms]) => s + ms, 0)}ms total`}
              control={
                <div style={{ display: "flex", gap: 'var(--libre-space-4)' }}>
                  <button
                    type="button"
                    onClick={() => void firePattern(p, "celebration")}
                    aria-label={`Preview ${p.id}`}
                    className="libre-settings-cue-play"
                  >
                    <Icon icon={playIcon} size="xs" color="currentColor" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCustomPattern(p.id)}
                    aria-label={`Delete ${p.id}`}
                    className="libre-settings-cue-play"
                  >
                    <Icon icon={trash2} size="xs" color="currentColor" />
                  </button>
                </div>
              }
            />
          ))
        )}
      </SettingsCard>

      {/* ─── 7. Telemetry ───────────────────────────────────── */}
      <SettingsCard title="Telemetry">
        <SettingsRow
          icon={sliders}
          label="Fires this session"
          sub={`${totalFires} buzz${totalFires === 1 ? "" : "es"} since launch. Live count, in-memory only — never persisted, never sent anywhere.`}
          control={
            <button
              type="button"
              onClick={() => resetTelemetry()}
              className="libre-settings-cue-play"
              aria-label="Reset telemetry"
              title="Reset counters"
            >
              <Icon icon={trash2} size="xs" color="currentColor" />
            </button>
          }
        />
        {(Object.keys(INTENT_CATEGORY) as HapticIntent[])
          .sort((a, b) => (telemetry[b] ?? 0) - (telemetry[a] ?? 0))
          .filter((intent) => (telemetry[intent] ?? 0) > 0)
          .map((intent) => (
            <SettingsRow
              key={intent}
              icon={iconForIntent(intent)}
              label={intent}
              sub={`Category: ${INTENT_CATEGORY[intent]}`}
              control={
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {telemetry[intent]}
                </span>
              }
            />
          ))}
        {totalFires === 0 && (
          <SettingsRow
            icon={circle}
            label="No fires yet"
            sub="Use the Play buttons above to audition any intent and the count appears here."
          />
        )}
      </SettingsCard>
    </SettingsPage>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function categoryIconFor(cat: HapticCategory): string {
  switch (cat) {
    case "chrome":      return mousePointerClick;
    case "completion":  return check;
    case "celebration": return award;
    case "error":       return circleX;
    case "focus":       return circle;
    case "streak":      return flame;
  }
}

function iconForIntent(intent: HapticIntent): string {
  switch (intent) {
    case "tap":
    case "selection":           return mousePointerClick;
    case "impact-light":
    case "impact-medium":
    case "impact-heavy":        return zap;
    case "notification-success": return check;
    case "notification-warning": return triangleAlert;
    case "notification-error":  return circleX;
    case "streak-bump":         return flame;
    case "level-up":            return award;
    case "completion":          return trophy;
  }
}

function PresetRow({ preset, disabled }: { preset: Preset; disabled: boolean }) {
  return (
    <SettingsRow
      icon={vibrate}
      label={`${preset.glyph}  ${preset.label}`}
      sub={preset.description}
      control={
        <button
          type="button"
          onClick={() => void firePattern(preset, "completion")}
          aria-label={`Preview ${preset.label}`}
          className="libre-settings-cue-play"
          disabled={disabled}
        >
          <Icon icon={playIcon} size="xs" color="currentColor" />
        </button>
      }
    />
  );
}

/// Inline custom-pattern editor. Beat count + per-beat ms input.
/// Saved to localStorage; appears in the custom-patterns list
/// above. Intentionally minimal — power users can hand-edit JSON
/// via the localStorage panel if they want richer composition.
function CustomPatternEditor({ disabled }: { disabled: boolean }) {
  const [beats, setBeats] = useState<Array<{ ms: number; kind: "buzz" | "pause" }>>(
    () => [
      { ms: 20, kind: "buzz" },
      { ms: 80, kind: "pause" },
      { ms: 20, kind: "buzz" },
    ],
  );
  const [savedFlash, setSavedFlash] = useState(false);

  const preview = () => {
    if (disabled) return;
    void firePattern(
      {
        id: "custom-preview",
        beats: beats.map((b) => [b.ms, b.kind] as [number, "buzz" | "pause"]),
      },
      "celebration",
    );
  };

  const save = () => {
    const id = newCustomPatternId();
    saveCustomPattern({
      id,
      beats: beats.map((b) => [b.ms, b.kind] as [number, "buzz" | "pause"]),
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  const addBeat = () => {
    const lastKind = beats[beats.length - 1]?.kind ?? "buzz";
    setBeats([
      ...beats,
      { ms: lastKind === "buzz" ? 60 : 20, kind: lastKind === "buzz" ? "pause" : "buzz" },
    ]);
  };

  const removeBeat = (i: number) => {
    setBeats(beats.filter((_, idx) => idx !== i));
  };

  const updateBeat = (
    i: number,
    field: "ms" | "kind",
    value: number | "buzz" | "pause",
  ) => {
    setBeats(
      beats.map((b, idx) =>
        idx === i ? { ...b, [field]: value as never } : b,
      ),
    );
  };

  return (
    <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 'var(--libre-space-8)' }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 'var(--libre-space-6)' }}>
        {beats.map((b, i) => (
          <div
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 'var(--libre-space-4)',
              padding: "4px 6px",
              borderRadius: 'var(--libre-radius-6)',
              border: "1px solid var(--color-border-default)",
              background: "var(--color-bg-secondary)",
            }}
          >
            <select
              value={b.kind}
              onChange={(e) =>
                updateBeat(i, "kind", e.target.value as "buzz" | "pause")
              }
              disabled={disabled}
              aria-label="Beat kind"
              style={{
                background: "transparent",
                color: "var(--color-text-primary)",
                border: 0,
                fontSize: 'var(--libre-fs-11)',
              }}
            >
              <option value="buzz">buzz</option>
              <option value="pause">pause</option>
            </select>
            <input
              type="number"
              value={b.ms}
              min={0}
              max={2000}
              step={1}
              onChange={(e) =>
                updateBeat(i, "ms", Math.max(0, Number.parseInt(e.target.value, 10) || 0))
              }
              disabled={disabled}
              aria-label="Beat duration in ms"
              style={{
                width: 'var(--libre-size-56)',
                background: "transparent",
                color: "var(--color-text-primary)",
                border: 0,
                fontVariantNumeric: "tabular-nums",
                fontSize: 'var(--libre-fs-11)',
              }}
            />
            <span style={{ fontSize: 'var(--libre-fs-10)', color: "var(--color-text-tertiary)" }}>ms</span>
            <button
              type="button"
              onClick={() => removeBeat(i)}
              disabled={disabled || beats.length <= 1}
              aria-label="Remove beat"
              style={{
                background: "transparent",
                color: "var(--color-text-tertiary)",
                border: 0,
                cursor: "pointer",
                padding: 0,
                fontSize: 'var(--libre-fs-12)',
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addBeat}
          disabled={disabled || beats.length >= 16}
          className="libre-settings-cue-play"
          aria-label="Add beat"
        >
          +
        </button>
      </div>
      <div style={{ display: "flex", gap: 'var(--libre-space-6)' }}>
        <button
          type="button"
          onClick={preview}
          className="libre-settings-cue-play"
          disabled={disabled}
        >
          <Icon icon={playIcon} size="xs" color="currentColor" />
          <span style={{ marginLeft: 'var(--libre-space-4)' }}>Preview</span>
        </button>
        <button
          type="button"
          onClick={save}
          className="libre-settings-cue-play"
          disabled={disabled}
        >
          {savedFlash ? "Saved!" : "Save as custom"}
        </button>
      </div>
    </div>
  );
}
