import { useState } from "react";
import {
  THEMES,
  type ThemeName,
  loadHue,
  applyHue,
  DEFAULT_GG_HUE,
} from "../../../theme/themes";
import { themeThumb } from "../ThemePicker/themeThumbs";
import { THEME_PREVIEW } from "../../../theme/themePreviews";
import LanguageDropdown from "../../LanguageDropdown/LanguageDropdown";
import SettingsCard, { SettingsPage } from "./SettingsCard";
import { VARIANTS, type VariantId } from "../../Sidebar/variants/registry";
import { useSidebarVariant } from "../../Sidebar/variants/useSidebarVariant";
import { useT } from "../../../i18n/i18n";

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
          style={{ padding: "14px 20px" }}
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
                onChange={() => onThemeChange(t.id)}
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
          style={{ padding: "14px 20px" }}
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
    </SettingsPage>
  );
}
