import { useState } from "react";
import {
  THEMES,
  type ThemeName,
  loadHue,
  applyHue,
  DEFAULT_GG_HUE,
  type ScaleKey,
  SCALE_KEYS,
  SCALE_BOUNDS,
  DEFAULT_SCALES,
  loadScale,
  applyScale,
  resetScales,
} from "@/theme/themes";
import { themeThumb } from "@/components/organisms/dialogs/ThemePicker/themeThumbs";
import { THEME_PREVIEW } from "@/theme/themePreviews";
import LanguageDropdown from "@/components/molecules/LanguageDropdown/LanguageDropdown";
import SettingsCard, { SettingsPage } from "./SettingsCard";
import { VARIANTS, type VariantId } from "@/components/organisms/Sidebar/variants/registry";
import { useSidebarVariant } from "@/components/organisms/Sidebar/variants/useSidebarVariant";
import { useT } from "@/i18n/i18n";
import { track } from "@/lib/track";

interface ThemePaneProps {
  theme: ThemeName;
  onThemeChange: (next: ThemeName) => void;
}

/// Per-variant i18n key for the blurb shown under the layout
/// option's label. Resolved at render time so the strings track
/// the active locale.
const VARIANT_BLURB_KEYS: Record<VariantId, string> = {
  classic: "settings.sidebarClassicBlurb",
  grid: "settings.sidebarGridBlurb",
};

/// The Appearance scale knobs, in display order. Each drives one
/// `--libre-<key>-scale` multiplier over the design-token scales in
/// scale-tokens.css. Bounds come from SCALE_BOUNDS; all use a 5% step and
/// render their value as a percentage (100% = default).
const SCALE_ROWS: { key: ScaleKey; labelKey: string; subKey: string }[] = [
  { key: "font", labelKey: "settings.scaleFont", subKey: "settings.scaleFontSub" },
  { key: "space", labelKey: "settings.scaleSpace", subKey: "settings.scaleSpaceSub" },
  { key: "radius", labelKey: "settings.scaleRadius", subKey: "settings.scaleRadiusSub" },
  { key: "border", labelKey: "settings.scaleBorder", subKey: "settings.scaleBorderSub" },
  { key: "motion", labelKey: "settings.scaleMotion", subKey: "settings.scaleMotionSub" },
  { key: "blur", labelKey: "settings.scaleBlur", subKey: "settings.scaleBlurSub" },
];

export default function ThemePane({ theme, onThemeChange }: ThemePaneProps) {
  const [sidebarVariant, setSidebarVariant] = useSidebarVariant();
  const t = useT();
  // GhostWire accent hue — only meaningful for the default-dark theme, whose
  // whole palette derives from --gg-hue. The slider applies + persists live.
  const [hue, setHue] = useState(() => loadHue());
  const updateHue = (next: number) => {
    setHue(next);
    applyHue(next);
  };
  // Appearance scale knobs — each writes a `--libre-<k>-scale` multiplier
  // inline on <html> live (and persists it), reshaping the whole UI.
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
  return (
    <SettingsPage
      title={t("settings.appearance")}
      description={t("settings.appearanceDescription")}
    >
      {/* Language — single setting that drives BOTH the i18n runtime
          (every UI string in the chrome — nav, dialogs, sandbox,
          library, etc.) and the lesson-content overlay (Libre-
          authored courses re-render in the picked locale). Two
          separate settings here was a UX trap: 95% of users want
          their app + their courses in the same language. Edge cases
          (Spanish-speaker drilling a Russian course) can still
          read the source language directly in the lesson — the
          locale setting only affects translated content. */}
      <SettingsCard title={t("settings.language")}>
        <div className="libre-settings-row libre-settings-row--no-icon">
          <div className="libre-settings-row__body">
            <span className="libre-settings-row__label">
              {t("settings.language")}
            </span>
            <span className="libre-settings-row__sub">
              {t("settings.languageDescription")}
            </span>
          </div>
          <div className="libre-settings-row__control">
            <LanguageDropdown variant="compact" />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={t("settings.themeCard")}>
        <div
          className="libre-settings-model-group libre-settings-model-group--scroll"
          style={{ padding: "var(--libre-space-14) var(--libre-space-20)" }}
        >
          {THEMES.map((t) => {
            const thumb = themeThumb(t.id);
            const colors = THEME_PREVIEW[t.id] ?? {
              bg: "#000",
              fg: "#fff",
              accent: "#fff",
            };
            return (
            <label
              key={t.id}
              className={`libre-settings-model ${theme === t.id ? "is-active" : ""}`}
            >
              <input
                type="radio"
                name="libre-theme"
                value={t.id}
                checked={theme === t.id}
                onChange={() => {
                  track.themeChange(t.id);
                  onThemeChange(t.id);
                }}
              />
              {/* Cover-art squircle — the source sci-fi cover the theme is
                  painted from. The classic default-dark has no art, so it
                  renders a colour tile from its preview palette instead. */}
              <span
                className="libre-settings-theme-squircle"
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
              {/* Mini-app preview — a tiny mockup of the actual
                  layout (left nav rail, sidebar, top bar, and a
                  stack of "code line" blocks on the right). The
                  per-theme selectors in SettingsDialog.css feed
                  `--swatch-bg / --swatch-fg / --swatch-accent`
                  into this component so the preview shows the
                  destination theme's colours regardless of which
                  theme is currently APPLIED to the app. The
                  layout is structural (no real text) so it
                  reads as "this is how the app will look" at a
                  glance without the noise of actual content. */}
              <span
                className="libre-settings-theme-preview"
                data-theme={t.id}
                aria-hidden
              >
                <span className="libre-settings-theme-preview__rail" />
                <span className="libre-settings-theme-preview__sidebar">
                  <span className="libre-settings-theme-preview__sidebar-row" />
                  <span className="libre-settings-theme-preview__sidebar-row libre-settings-theme-preview__sidebar-row--active" />
                  <span className="libre-settings-theme-preview__sidebar-row" />
                  <span className="libre-settings-theme-preview__sidebar-row" />
                </span>
                <span className="libre-settings-theme-preview__main">
                  <span className="libre-settings-theme-preview__topbar" />
                  <span className="libre-settings-theme-preview__code">
                    <span className="libre-settings-theme-preview__line" style={{ width: "70%" }} />
                    <span className="libre-settings-theme-preview__line libre-settings-theme-preview__line--accent" style={{ width: "48%" }} />
                    <span className="libre-settings-theme-preview__line" style={{ width: "82%" }} />
                    <span className="libre-settings-theme-preview__line" style={{ width: "38%" }} />
                    <span className="libre-settings-theme-preview__line libre-settings-theme-preview__line--accent" style={{ width: "62%" }} />
                  </span>
                </span>
              </span>
              <div className="libre-settings-model-text">
                <div className="libre-settings-model-label">{t.label}</div>
                <div className="libre-settings-model-hint">{t.description}</div>
              </div>
            </label>
            );
          })}
        </div>
      </SettingsCard>

      {/* Accent hue — only for the GhostWire default-dark theme, whose
          accent, white→accent gradients, glows, glass rims and the aurora +
          halftone all derive from a single --gg-hue. Drag to recolour the
          whole theme live; the choice is persisted. */}
      {theme === "default-dark" && (
        <SettingsCard title={t("settings.accentHueCard")}>
          <div className="libre-settings-row libre-settings-row--no-icon">
            <div className="libre-settings-row__body">
              <span className="libre-settings-row__label">
                {t("settings.accentHue")}
              </span>
              <span className="libre-settings-row__sub">
                {t("settings.accentHueDescription")}
              </span>
            </div>
            <div className="libre-settings-row__control">
              <div className="libre-settings-hue">
                <span
                  className="libre-settings-hue__swatch"
                  style={{ background: `hsl(${hue} 74% 66%)` }}
                  aria-hidden
                />
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={hue}
                  className="libre-settings-hue__slider"
                  aria-label={t("settings.accentHue")}
                  onChange={(e) => updateHue(Number(e.target.value))}
                />
                <button
                  type="button"
                  className="libre-settings-hue__reset"
                  onClick={() => updateHue(DEFAULT_GG_HUE)}
                >
                  {t("settings.accentHueReset")}
                </button>
              </div>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Sidebar layout — flip between the default list view and
          the higher-density grid view of numbered lesson cells.
          Same radio-row pattern the theme list uses, so the
          control reads as a familiar settings choice rather than
          a separate widget class. Switch is instant — the
          App-level Sidebar slot subscribes to `useSidebarVariant`
          and swaps which component renders the moment the radio
          flips. */}
      <SettingsCard title={t("settings.sidebarLayoutCard")}>
        <div
          className="libre-settings-model-group"
          style={{ padding: "var(--libre-space-14) var(--libre-space-20)" }}
        >
          {VARIANTS.map((v) => (
            <label
              key={v.id}
              className={`libre-settings-model ${sidebarVariant === v.id ? "is-active" : ""}`}
            >
              <input
                type="radio"
                name="libre-sidebar-variant"
                value={v.id}
                checked={sidebarVariant === v.id}
                onChange={() => setSidebarVariant(v.id)}
              />
              <div>
                <div className="libre-settings-model-label">{v.label}</div>
                <div className="libre-settings-model-hint">
                  {t(VARIANT_BLURB_KEYS[v.id])}
                </div>
              </div>
            </label>
          ))}
        </div>
      </SettingsCard>

      {/* Scale & motion — global multipliers over the generated design-token
          scales (spacing / type / radius / border / motion / blur). Each
          slider writes --libre-<k>-scale inline on <html>; because the tokens
          are calc(raw * scale), the whole interface reshapes live. */}
      <SettingsCard title={t("settings.scaleCard")}>
        {SCALE_ROWS.map((row) => {
          const [min, max] = SCALE_BOUNDS[row.key];
          const val = scales[row.key];
          return (
            <div
              key={row.key}
              className="libre-settings-row libre-settings-row--no-icon"
            >
              <div className="libre-settings-row__body">
                <span className="libre-settings-row__label">
                  {t(row.labelKey)}
                </span>
                <span className="libre-settings-row__sub">{t(row.subKey)}</span>
              </div>
              <div className="libre-settings-row__control">
                <div className="libre-settings-scale">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.05}
                    value={val}
                    className="libre-settings-scale__slider"
                    aria-label={t(row.labelKey)}
                    onChange={(e) =>
                      updateScale(row.key, Number(e.target.value))
                    }
                  />
                  <span className="libre-settings-scale__val">
                    {t("settings.scaleValue", { percent: Math.round(val * 100) })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div className="libre-settings-row libre-settings-row--no-icon">
          <div className="libre-settings-row__body">
            <span className="libre-settings-row__label">
              {t("settings.scaleReset")}
            </span>
            <span className="libre-settings-row__sub">
              {t("settings.scaleResetSub")}
            </span>
          </div>
          <div className="libre-settings-row__control">
            <button
              type="button"
              className="libre-settings-hue__reset"
              onClick={resetAllScales}
            >
              {t("settings.accentHueReset")}
            </button>
          </div>
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
