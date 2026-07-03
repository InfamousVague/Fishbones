/// First-launch onboarding wizard.
///
/// Runs once for a genuinely new user (self-gates on `shouldShowOnboarding()`),
/// walking them through: welcome → theme → privacy → a couple of basics → done.
/// Mirrors the `ThemePickerFirstLaunch` self-gating mount pattern and OWNS
/// theme selection, so it supersedes the standalone first-launch theme picker
/// (completing it stamps the legacy theme-picked latch via `markOnboarded()`).
///
/// Copy is plain English (like ThemePickerModal + MobileSettings) — the
/// first-launch surfaces don't route through i18n.

import { useEffect, useState, type CSSProperties } from "react";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import {
  THEMES,
  applyTheme,
  readActiveTheme,
  type ThemeName,
  type ScaleKey,
  SCALE_BOUNDS,
  loadScale,
  applyScale,
} from "@/theme/themes";
import { THEME_PREVIEW } from "@/theme/themePreviews";
import { themeThumb } from "@/components/organisms/dialogs/ThemePicker/themeThumbs";
import SettingsToggle from "@/components/organisms/dialogs/SettingsDialog/SettingsToggle";
import LanguageDropdown from "@/components/molecules/LanguageDropdown/LanguageDropdown";
import {
  readAnalyticsEnabled,
  setAnalyticsEnabled,
  markAnalyticsNoticeSeen,
} from "@/lib/analyticsSettings";
import {
  readLeaderboardEnabled,
  setLeaderboardEnabled,
} from "@/lib/leaderboardSettings";
import { shouldShowOnboarding, markOnboarded } from "@/lib/onboarding";
// Reuse the first-launch theme picker's card styling for the theme step.
import "@/components/organisms/dialogs/ThemePicker/ThemePicker.css";
import "./OnboardingWizard.css";

const STEP_COUNT = 5;

/// Self-gating first-launch mount. Renders the wizard once for a genuinely new
/// user, after a short delay so it lands as the bootloader fades. Mount THIS
/// (not the bare modal) near the top of the app tree; renders nothing once the
/// user has onboarded (or is a pre-existing user).
export function OnboardingWizard() {
  const [open, setOpen] = useState(() => shouldShowOnboarding());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setReady(true), 400);
    return () => window.clearTimeout(id);
  }, [open]);
  if (!open || !ready) return null;
  return <OnboardingWizardModal onClose={() => setOpen(false)} />;
}

interface Props {
  onClose: () => void;
}

function OnboardingWizardModal({ onClose }: Props) {
  const [step, setStep] = useState(0);

  // Theme — applies live (applyTheme write-through persists immediately).
  const [theme, setTheme] = useState<ThemeName>(() => readActiveTheme());
  const pickTheme = (id: ThemeName) => {
    setTheme(id);
    applyTheme(id);
  };

  // Privacy — held in local state, committed on finish. Default opt-IN.
  const [analyticsOn, setAnalyticsOn] = useState(() => readAnalyticsEnabled());
  const [leaderboardOn, setLeaderboardOn] = useState(() =>
    readLeaderboardEnabled(),
  );

  // Basics — text size + density apply live via the global scale multipliers.
  const [fontScale, setFontScale] = useState(() => loadScale("font"));
  const [spaceScale, setSpaceScale] = useState(() => loadScale("space"));
  const setScale = (key: ScaleKey, value: number, set: (n: number) => void) => {
    set(value);
    applyScale(key, value);
  };

  const finish = () => {
    setAnalyticsEnabled(analyticsOn);
    setLeaderboardEnabled(leaderboardOn);
    // The Privacy step IS the analytics disclosure — latch the standalone
    // first-run notice so it doesn't also appear.
    markAnalyticsNoticeSeen();
    markOnboarded();
    onClose();
  };

  const last = STEP_COUNT - 1;
  const next = () => (step < last ? setStep(step + 1) : finish());
  const back = () => setStep((s) => Math.max(0, s - 1));
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <ModalBackdrop onDismiss={finish} zIndex={220}>
      <div
        className="libre-onb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-onb-title"
      >
        <div className="libre-onb__dots" aria-hidden>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <span
              key={i}
              className={
                "libre-onb__dot" +
                (i === step ? " libre-onb__dot--active" : "") +
                (i < step ? " libre-onb__dot--done" : "")
              }
            />
          ))}
        </div>

        <div className="libre-onb__body">
          {step === 0 && (
            <div className="libre-onb__hero">
              <img
                className="libre-onb__logo"
                src={`${import.meta.env.BASE_URL}libreacademy.png`}
                alt=""
                width={350}
                height={123}
                draggable={false}
                aria-hidden
              />
              <h2 id="libre-onb-title" className="libre-onb__title">
                Welcome to Libre
              </h2>
              <p className="libre-onb__blurb">
                Learn to code through real books and hands-on exercises — all on
                your own machine. Let's set a few things up; it takes about 20
                seconds and everything here is changeable later in Settings.
              </p>
            </div>
          )}

          {step === 1 && (
            <>
              <h2 id="libre-onb-title" className="libre-onb__title">
                Choose your look
              </h2>
              <p className="libre-onb__blurb">
                Every theme is painted from a vintage sci-fi cover. Tap one to
                try it on — the whole app recolours live.
              </p>
              <div className="libre-onb__theme-grid">
                {THEMES.map((tm) => {
                  const thumb = themeThumb(tm.id);
                  const colors = THEME_PREVIEW[tm.id] ?? {
                    bg: "#000",
                    fg: "#fff",
                    accent: "#fff",
                  };
                  const active = theme === tm.id;
                  return (
                    <button
                      type="button"
                      key={tm.id}
                      className={`libre-theme-card ${active ? "is-active" : ""}`}
                      onClick={() => pickTheme(tm.id)}
                      aria-pressed={active}
                    >
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
                      <span
                        className="libre-theme-card__preview"
                        aria-hidden
                        style={
                          {
                            "--swatch-bg": colors.bg,
                            "--swatch-fg": colors.fg,
                            "--swatch-accent": colors.accent,
                          } as CSSProperties
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
            </>
          )}

          {step === 2 && (
            <>
              <h2 id="libre-onb-title" className="libre-onb__title">
                Privacy
              </h2>
              <p className="libre-onb__blurb">
                Libre runs fully offline. Both of these are on by default — flip
                either off and that data is never shared.
              </p>
              <div className="libre-onb__rows">
                <div className="libre-onb__row">
                  <div className="libre-onb__row-text">
                    <span className="libre-onb__row-label">
                      Anonymous usage analytics
                    </span>
                    <span className="libre-onb__row-sub">
                      Cookieless, no fingerprinting — just which features get
                      used, so we can improve them. Never your code or lesson
                      content.
                    </span>
                  </div>
                  <SettingsToggle
                    checked={analyticsOn}
                    onChange={setAnalyticsOn}
                    label="Anonymous usage analytics"
                  />
                </div>
                <div className="libre-onb__row">
                  <div className="libre-onb__row-text">
                    <span className="libre-onb__row-label">
                      Appear on leaderboards
                    </span>
                    <span className="libre-onb__row-sub">
                      Share your XP, streak and lessons on the Friends + Global
                      boards (only ever when you're signed in). Off means you
                      still sync across devices — you just don't rank.
                    </span>
                  </div>
                  <SettingsToggle
                    checked={leaderboardOn}
                    onChange={setLeaderboardOn}
                    label="Appear on leaderboards"
                  />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 id="libre-onb-title" className="libre-onb__title">
                A couple of basics
              </h2>
              <p className="libre-onb__blurb">
                Pick your language and dial in a comfortable text size. There's
                a lot more to tune later in Settings → Appearance.
              </p>
              <div className="libre-onb__rows">
                <div className="libre-onb__field">
                  <span className="libre-onb__row-label">Language</span>
                  <span className="libre-onb__row-sub">
                    Translates Libre-authored courses and the whole interface.
                  </span>
                  <LanguageDropdown variant="field" />
                </div>
                <div className="libre-onb__field">
                  <div className="libre-onb__slider-head">
                    <span className="libre-onb__row-label">Text size</span>
                    <span className="libre-onb__slider-val">
                      {Math.round(fontScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    className="libre-onb__slider"
                    min={SCALE_BOUNDS.font[0]}
                    max={SCALE_BOUNDS.font[1]}
                    step={0.05}
                    value={fontScale}
                    aria-label="Text size"
                    onChange={(e) =>
                      setScale("font", Number(e.target.value), setFontScale)
                    }
                  />
                </div>
                <div className="libre-onb__field">
                  <div className="libre-onb__slider-head">
                    <span className="libre-onb__row-label">Density</span>
                    <span className="libre-onb__slider-val">
                      {Math.round(spaceScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    className="libre-onb__slider"
                    min={SCALE_BOUNDS.space[0]}
                    max={SCALE_BOUNDS.space[1]}
                    step={0.05}
                    value={spaceScale}
                    aria-label="Density"
                    onChange={(e) =>
                      setScale("space", Number(e.target.value), setSpaceScale)
                    }
                  />
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <div className="libre-onb__hero">
              <div className="libre-onb__mark" aria-hidden>
                🎉
              </div>
              <h2 id="libre-onb-title" className="libre-onb__title">
                You're all set
              </h2>
              <p className="libre-onb__blurb">
                The {current.label} theme is applied and ready. Open the Library
                and start your first book — remember, everything here lives in
                Settings if you want to change it.
              </p>
            </div>
          )}
        </div>

        <footer className="libre-onb__foot">
          {step < last ? (
            <button type="button" className="libre-onb__skip" onClick={finish}>
              Skip
            </button>
          ) : (
            <span />
          )}
          <div className="libre-onb__nav">
            {step > 0 && (
              <button type="button" className="libre-onb__back" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="libre-onb__next" onClick={next}>
              {step === 0
                ? "Get started"
                : step === last
                  ? "Start learning"
                  : "Next"}
            </button>
          </div>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
