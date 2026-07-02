/// Mobile settings — minimal. The desktop SettingsDialog has four
/// rails (AI & API, Theme, Data, Account). On mobile we drop AI & API
/// (no API-key entry workflow on phones, the hidden-tests pipeline
/// is a desktop affordance) and tighten the rest into one stack.
///
/// Sections:
///   - Account     — sign-in CTA when signed out, profile + sign-out when signed in
///   - About       — version, link to libre.academy
///   - Reset       — wipe local progress (with click-to-confirm)
///
/// Triggered from the bottom-tab bar's "Settings" button.

import { useState } from "react";
import type { UseLibreCloud } from "@/hooks/useLibreCloud";
import type { RealtimeSyncHandle } from "@/hooks/useRealtimeSync";
import type { Completion } from "@/hooks/useProgress";
import type { Course } from "@/data/types";
import SyncDebugPanel from "@/components/organisms/dialogs/SettingsDialog/SyncDebugPanel";
import {
  applyTheme,
  loadTheme,
  THEMES,
  type ThemeName,
  type ScaleKey,
  SCALE_KEYS,
  SCALE_BOUNDS,
  DEFAULT_SCALES,
  loadScale,
  applyScale,
  resetScales,
} from "@/theme/themes";
import LanguageDropdown from "@/components/molecules/LanguageDropdown/LanguageDropdown";
// Cover-art thumbnails + per-theme preview palettes — the exact
// assets/data the desktop theme pickers render, so the mobile rows
// match the new graphics instead of the old three-stripe swatch.
import { themeThumb } from "@/components/organisms/dialogs/ThemePicker/themeThumbs";
import { useAnalyticsSetting } from "@/hooks/useAnalyticsSetting";
import { getSfxSettings, setSfxSettings, playSound } from "@/lib/sfx";
import { readHapticSettings, writeHapticSettings, haptics } from "@/lib/haptics";
import { THEME_PREVIEW } from "@/theme/themePreviews";
import "./MobileSettings.css";

/// Appearance scale knobs (same set as the desktop ThemePane). Plain
/// English labels — MobileSettings doesn't route through i18n.
const SCALE_META: { key: ScaleKey; label: string; sub: string }[] = [
  { key: "font", label: "Text size", sub: "Scale all interface text." },
  { key: "space", label: "Density", sub: "Padding, gaps and margins." },
  { key: "radius", label: "Corner roundness", sub: "Square to softly rounded." },
  { key: "border", label: "Border weight", sub: "Outline + divider thickness." },
  { key: "motion", label: "Motion", sub: "Animation speed; 0% is off." },
  { key: "blur", label: "Glass blur", sub: "Frosted-glass strength." },
];

interface Props {
  cloud: UseLibreCloud;
  /// Realtime sync hook handle. Drives the Sync diagnostics card —
  /// status badge, pending push counter, manual pull/push buttons,
  /// diff view. Optional for embeddings that don't run sync.
  realtime?: RealtimeSyncHandle;
  /// Local completion history. Source of truth for the "On this
  /// device" column of the sync diff.
  history?: readonly Completion[];
  /// Live course list — used to format diff entries with
  /// "Course Title · Lesson Title" instead of raw IDs.
  courses?: readonly Course[];
  onRequestSignIn: () => void;
  onResetProgress: () => Promise<void> | void;
  appVersion?: string;
}

export default function MobileSettings({
  cloud,
  realtime,
  history,
  courses,
  onRequestSignIn,
  onResetProgress,
  appVersion = "0.1.4",
}: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Theme picker state — initialise from the current persisted choice
  // (loadTheme reads localStorage). `applyTheme` writes-through on
  // every selection so the change persists across launches.
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
  // Anonymous-analytics opt-out. Same persisted key + broadcast the
  // desktop Settings → Data pane uses, so the choice syncs semantics
  // across surfaces (the analytics engine reacts to the event).
  const analytics = useAnalyticsSetting();
  // Sound + haptics preferences — same persisted keys the desktop
  // Sounds/Haptics panes write, so the choice follows the account via
  // settings sync. Local mirrors for immediate slider/toggle feedback.
  const [sfx, setSfx] = useState(() => getSfxSettings());
  const [haptic, setHaptic] = useState(() => readHapticSettings());
  const updateSfx = (next: Partial<{ enabled: boolean; volume: number }>) => {
    setSfxSettings(next);
    setSfx(getSfxSettings());
  };
  const updateHaptic = (
    next: Partial<{ enabled: boolean; intensity: number }>,
  ) => {
    writeHapticSettings(next);
    setHaptic(readHapticSettings());
  };

  function handleThemeChange(next: ThemeName) {
    setTheme(next);
    applyTheme(next);
  }

  // Appearance scale knobs — each writes a `--libre-<k>-scale` multiplier
  // inline on <html> (and persists), reshaping the whole UI live.
  const [scales, setScales] = useState<Record<ScaleKey, number>>(
    () =>
      Object.fromEntries(
        SCALE_KEYS.map((k) => [k, loadScale(k)]),
      ) as Record<ScaleKey, number>,
  );
  const updateScale = (k: ScaleKey, next: number) => {
    setScales((prev) => ({ ...prev, [k]: next }));
    applyScale(k, next);
  };
  const resetAllScales = () => {
    resetScales();
    setScales(
      Object.fromEntries(
        SCALE_KEYS.map((k) => [k, DEFAULT_SCALES[k]]),
      ) as Record<ScaleKey, number>,
    );
  };

  const signedIn = cloud.signedIn === true;
  const user =
    typeof cloud.user === "object" && cloud.user ? cloud.user : null;

  const onReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setResetting(true);
    try {
      await onResetProgress();
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  return (
    <div className="m-set">
      <header className="m-set__head">
        <h1 className="m-set__title">Settings</h1>
      </header>

      <section className="m-set__section">
        <h3 className="m-set__section-title">Account</h3>
        {signedIn && user ? (
          <>
            <div className="m-set__row m-set__row--passive">
              <div className="m-set__row-text">
                <span className="m-set__row-title">{user.display_name}</span>
                <span className="m-set__row-meta">{user.email}</span>
              </div>
            </div>
            <button
              type="button"
              className="m-set__row m-set__row--button m-set__row--danger"
              onClick={async () => {
                setSigningOut(true);
                try {
                  await cloud.signOut();
                } finally {
                  setSigningOut(false);
                }
              }}
              disabled={signingOut}
            >
              <span className="m-set__row-title">
                {signingOut ? "Signing out…" : "Sign out"}
              </span>
            </button>
          </>
        ) : (
          <>
            <p className="m-set__blurb">
              Sign in to sync progress, streaks, and lesson history between
              devices. Libre runs entirely offline without an account —
              signing in is purely additive.
            </p>
            <button
              type="button"
              className="m-set__row m-set__row--button m-set__row--primary"
              onClick={onRequestSignIn}
            >
              <span className="m-set__row-title">Sign in</span>
            </button>
          </>
        )}
      </section>

      {signedIn && realtime && (
        <section className="m-set__section">
          <SyncDebugPanel
            cloud={cloud}
            realtime={realtime}
            history={history ?? []}
            describeLesson={(courseId, lessonId) => {
              const course = courses?.find((c) => c.id === courseId);
              if (!course) return `${courseId} · ${lessonId}`;
              for (const ch of course.chapters) {
                const lesson = ch.lessons.find((l) => l.id === lessonId);
                if (lesson) return `${course.title} · ${lesson.title}`;
              }
              return `${course.title} · ${lessonId}`;
            }}
          />
        </section>
      )}

      <section className="m-set__section">
        <h3 className="m-set__section-title">Theme</h3>
        <p className="m-set__blurb">
          App + editor colors. Picks land instantly and persist across
          launches; same library as the desktop app.
        </p>
        <ul className="m-set__theme-list" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => {
            const active = t.id === theme;
            const thumb = themeThumb(t.id);
            const colors = THEME_PREVIEW[t.id] ?? {
              bg: "#000",
              fg: "#fff",
              accent: "#fff",
            };
            return (
              <li key={t.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    "m-set__theme-row" + (active ? " is-active" : "")
                  }
                  onClick={() => handleThemeChange(t.id)}
                >
                  {/* Cover-art squircle — same JPGs the desktop pickers
                      use (themeThumbs glob). Colour-tile fallback for
                      any future theme that ships without art. */}
                  <span
                    className="m-set__theme-squircle"
                    aria-hidden
                    style={
                      thumb
                        ? undefined
                        : {
                            background: `radial-gradient(120% 120% at 20% 12%, ${colors.accent}40 0%, transparent 46%), ${colors.bg}`,
                          }
                    }
                  >
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : null}
                  </span>
                  {/* Mini app-chrome mock-up in the destination palette
                      (inline --swatch-* from the generated THEME_PREVIEW,
                      so it can never go stale against the registry). */}
                  <span
                    className="m-set__theme-preview"
                    aria-hidden
                    style={
                      {
                        "--swatch-bg": colors.bg,
                        "--swatch-fg": colors.fg,
                        "--swatch-accent": colors.accent,
                      } as React.CSSProperties
                    }
                  >
                    <span className="m-set__theme-prev-rail" />
                    <span className="m-set__theme-prev-side">
                      <span className="m-set__theme-prev-srow" />
                      <span className="m-set__theme-prev-srow m-set__theme-prev-srow--active" />
                      <span className="m-set__theme-prev-srow" />
                    </span>
                    <span className="m-set__theme-prev-main">
                      <span className="m-set__theme-prev-topbar" />
                      <span className="m-set__theme-prev-line" style={{ width: "72%" }} />
                      <span
                        className="m-set__theme-prev-line m-set__theme-prev-line--accent"
                        style={{ width: "46%" }}
                      />
                      <span className="m-set__theme-prev-line" style={{ width: "84%" }} />
                    </span>
                  </span>
                  <span className="m-set__theme-text">
                    <span className="m-set__theme-label">{t.label}</span>
                    <span className="m-set__theme-desc">{t.description}</span>
                  </span>
                  <span className="m-set__theme-check" aria-hidden>
                    ✓
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="m-set__section">
        <h3 className="m-set__section-title">Scale &amp; motion</h3>
        <p className="m-set__blurb">
          Every spacing, type size, corner, border, transition and blur is
          driven by a global token — each dial moves them all in lockstep.
          Choices persist across launches.
        </p>
        {SCALE_META.map((row) => {
          const [min, max] = SCALE_BOUNDS[row.key];
          const val = scales[row.key];
          return (
            <div key={row.key} className="m-set__scale-row">
              <div className="m-set__scale-text">
                <span className="m-set__row-title">{row.label}</span>
                <span className="m-set__row-meta">{row.sub}</span>
              </div>
              <div className="m-set__scale-control">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={0.05}
                  value={val}
                  className="m-set__scale-slider"
                  aria-label={row.label}
                  onChange={(e) => updateScale(row.key, Number(e.target.value))}
                />
                <span className="m-set__scale-val">
                  {Math.round(val * 100)}%
                </span>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="m-set__row m-set__row--button"
          onClick={resetAllScales}
        >
          <span className="m-set__row-title">Reset to defaults</span>
        </button>
      </section>

      <section className="m-set__section">
        <h3 className="m-set__section-title">Sound &amp; haptics</h3>
        <p className="m-set__blurb">
          Completion chimes and touch feedback. The phone is where the
          buzz actually lands — these were desktop-only settings before.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={sfx.enabled}
          className="m-set__row m-set__row--button"
          onClick={() => updateSfx({ enabled: !sfx.enabled })}
        >
          <span className="m-set__row-title">Sound effects</span>
          <span
            className={"m-set__switch" + (sfx.enabled ? " m-set__switch--on" : "")}
            aria-hidden
          >
            <span className="m-set__switch-thumb" />
          </span>
        </button>
        {sfx.enabled && (
          <div className="m-set__scale-row">
            <div className="m-set__scale-text">
              <span className="m-set__row-title">Volume</span>
            </div>
            <div className="m-set__scale-control">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sfx.volume}
                className="m-set__scale-slider"
                aria-label="Sound volume"
                onChange={(e) => updateSfx({ volume: Number(e.target.value) })}
                // Audible preview on release, not per-tick — dragging
                // through 20 values shouldn't machine-gun the chime.
                onPointerUp={() => playSound("xp-pop", { volume: sfx.volume })}
              />
              <span className="m-set__scale-val">{Math.round(sfx.volume * 100)}%</span>
            </div>
          </div>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={haptic.enabled}
          className="m-set__row m-set__row--button"
          onClick={() => {
            const next = !haptic.enabled;
            updateHaptic({ enabled: next });
            if (next) void haptics.success();
          }}
        >
          <span className="m-set__row-title">Haptic feedback</span>
          <span
            className={"m-set__switch" + (haptic.enabled ? " m-set__switch--on" : "")}
            aria-hidden
          >
            <span className="m-set__switch-thumb" />
          </span>
        </button>
        {haptic.enabled && (
          <div className="m-set__scale-row">
            <div className="m-set__scale-text">
              <span className="m-set__row-title">Intensity</span>
            </div>
            <div className="m-set__scale-control">
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={haptic.intensity}
                className="m-set__scale-slider"
                aria-label="Haptic intensity"
                onChange={(e) => updateHaptic({ intensity: Number(e.target.value) })}
                onPointerUp={() => void haptics.medium()}
              />
              <span className="m-set__scale-val">{Math.round(haptic.intensity * 100)}%</span>
            </div>
          </div>
        )}
      </section>

      <section className="m-set__section">
        <h3 className="m-set__section-title">Language</h3>
        <p className="m-set__blurb">
          Translates Libre-authored courses into your preferred language.
          Third-party books stay in their original language. Choice persists
          across launches and syncs to your other devices when signed in.
        </p>
        <LanguageDropdown variant="field" />
      </section>

      <section className="m-set__section">
        <h3 className="m-set__section-title">About</h3>
        <div className="m-set__row m-set__row--passive">
          <div className="m-set__row-text">
            <span className="m-set__row-title">Libre</span>
            <span className="m-set__row-meta">v{appVersion}</span>
          </div>
        </div>
        <a
          className="m-set__row m-set__row--link"
          href="https://libre.academy"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="m-set__row-title">libre.academy</span>
          <span className="m-set__row-chevron" aria-hidden>
            ↗
          </span>
        </a>
      </section>

      <section className="m-set__section">
        <h3 className="m-set__section-title">Privacy</h3>
        <p className="m-set__blurb">
          Anonymous, cookieless product analytics (Plausible) — no personal
          data, no cross-site tracking. Turning it off stops all reporting
          from this device immediately.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={analytics.enabled}
          className="m-set__row m-set__row--button"
          onClick={() => analytics.setEnabled(!analytics.enabled)}
        >
          <span className="m-set__row-title">Share anonymous usage data</span>
          <span
            className={
              "m-set__switch" + (analytics.enabled ? " m-set__switch--on" : "")
            }
            aria-hidden
          >
            <span className="m-set__switch-thumb" />
          </span>
        </button>
      </section>

      <section className="m-set__section">
        <h3 className="m-set__section-title">Data</h3>
        <p className="m-set__blurb">
          Wipes every "lesson complete" flag on this device. Cloud-synced
          progress on other devices isn't touched.
        </p>
        <button
          type="button"
          className={`m-set__row m-set__row--button${confirmReset ? " m-set__row--danger" : ""}`}
          onClick={onReset}
          disabled={resetting}
        >
          <span className="m-set__row-title">
            {resetting
              ? "Resetting…"
              : confirmReset
                ? "Tap again to confirm"
                : "Reset local progress"}
          </span>
        </button>
      </section>
    </div>
  );
}
