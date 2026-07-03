/// First-launch "pick your Libre theme" modal.
///
/// Shows once on the very first session (gated on `libre:theme-picked-v1`),
/// before the sign-in nudge. Lists every theme — the classic Noir (default) plus
/// the nine cover-art themes — each as a card with a SQUIRCLE of its source
/// sci-fi cover beside a tiny live mock-up of the app chrome in that palette.
/// Clicking a card applies the theme LIVE (the whole app recolours behind the
/// modal), so the picker doubles as a full-screen preview; "Continue" persists
/// the choice. Dismissing (backdrop / ×) keeps whatever's applied and still
/// records the pick so the modal never re-appears. Users can re-theme any time
/// from Settings → Appearance.

import { useEffect, useState } from "react";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import {
  THEMES,
  applyTheme,
  readActiveTheme,
  type ThemeName,
} from "@/theme/themes";
import { THEME_PREVIEW } from "@/theme/themePreviews";
import { themeThumb } from "./themeThumbs";
import { shouldShowOnboarding } from "@/lib/onboarding";
import "./ThemePicker.css";

const PICKED_KEY = "libre:theme-picked-v1";

export function hasPickedTheme(): boolean {
  try {
    return !!localStorage.getItem(PICKED_KEY);
  } catch {
    return false;
  }
}
function markPicked(): void {
  try {
    localStorage.setItem(PICKED_KEY, "1");
  } catch {
    /* private mode — modal may re-appear next launch, harmless */
  }
}

/// Self-gating first-launch mount. Renders the picker once on the very first
/// session (no `libre:theme-picked-v1` yet), after a short delay so it arrives
/// just as the bootloader fades. Mount this (not the bare modal) near the top
/// of the app tree. Renders nothing once a theme has been picked.
export function ThemePickerFirstLaunch() {
  // Superseded by the OnboardingWizard for genuinely-new users (it owns the
  // theme step). Only render standalone if theme was never picked AND the
  // wizard isn't going to run — in practice this stays dormant, since
  // finishing the wizard stamps the theme-picked latch.
  const [open, setOpen] = useState(
    () => !hasPickedTheme() && !shouldShowOnboarding(),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setReady(true), 450);
    return () => window.clearTimeout(id);
  }, [open]);
  if (!open || !ready) return null;
  return <ThemePickerModal onClose={() => setOpen(false)} />;
}

interface Props {
  onClose?: () => void;
}

export default function ThemePickerModal({ onClose }: Props) {
  const [selected, setSelected] = useState<ThemeName>(() => readActiveTheme());

  const pick = (id: ThemeName) => {
    setSelected(id);
    applyTheme(id); // live preview — recolours the whole app behind the modal
  };
  const confirm = () => {
    markPicked();
    onClose?.();
  };

  const current = THEMES.find((t) => t.id === selected) ?? THEMES[0];

  return (
    <ModalBackdrop onDismiss={confirm} zIndex={210}>
      <div
        className="libre-theme-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-theme-picker-title"
      >
        <header className="libre-theme-picker__head">
          <h2
            id="libre-theme-picker-title"
            className="libre-theme-picker__title"
          >
            Choose your Libre
          </h2>
          <p className="libre-theme-picker__blurb">
            Every look is painted from a vintage sci-fi cover — halftone splash
            and all. Tap one to try it on; you can switch any time in Settings.
          </p>
        </header>

        <div className="libre-theme-picker__grid">
          {THEMES.map((tm) => {
            const thumb = themeThumb(tm.id);
            const colors = THEME_PREVIEW[tm.id] ?? {
              bg: "#000",
              fg: "#fff",
              accent: "#fff",
            };
            const active = selected === tm.id;
            return (
              <button
                type="button"
                key={tm.id}
                className={`libre-theme-card ${active ? "is-active" : ""}`}
                onClick={() => pick(tm.id)}
                aria-pressed={active}
              >
                {/* Cover-art squircle (or a colour tile for the no-art default). */}
                <span
                  className={`libre-theme-card__squircle${thumb ? "" : " libre-theme-card__squircle--tile"}`}
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

                {/* Tiny live mock-up of the app chrome in this palette. The
                    --swatch-* vars are set inline from THEME_PREVIEW so the
                    mock-up renders the destination theme regardless of which
                    theme is applied. */}
                <span
                  className="libre-theme-card__preview"
                  aria-hidden
                  style={
                    {
                      "--swatch-bg": colors.bg,
                      "--swatch-fg": colors.fg,
                      "--swatch-accent": colors.accent,
                    } as React.CSSProperties
                  }
                >
                  <span className="libre-theme-card__rail" />
                  <span className="libre-theme-card__sidebar">
                    <span className="libre-theme-card__srow" />
                    <span className="libre-theme-card__srow libre-theme-card__srow--active" />
                    <span className="libre-theme-card__srow" />
                  </span>
                  <span className="libre-theme-card__main">
                    <span className="libre-theme-card__topbar" />
                    <span className="libre-theme-card__line" style={{ width: "72%" }} />
                    <span className="libre-theme-card__line libre-theme-card__line--accent" style={{ width: "46%" }} />
                    <span className="libre-theme-card__line" style={{ width: "84%" }} />
                  </span>
                </span>

                <span className="libre-theme-card__text">
                  <span className="libre-theme-card__label">{tm.label}</span>
                  <span className="libre-theme-card__desc">{tm.description}</span>
                </span>

                <span className="libre-theme-card__check" aria-hidden>
                  ✓
                </span>
              </button>
            );
          })}
        </div>

        <footer className="libre-theme-picker__foot">
          <button
            type="button"
            className="libre-theme-picker__confirm"
            onClick={confirm}
          >
            Continue with {current.label}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
