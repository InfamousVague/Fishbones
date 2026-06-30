/// First-run guided tour. Spotlights one UI element per step,
/// auto-narrates the body via a pre-generated ElevenLabs MP3, and
/// auto-advances when each step's audio finishes — same
/// wait-for-section-to-finish UX as the lesson narrator, applied
/// to onboarding.
///
/// Lifted from the stash app's `components/Tour.tsx` and adapted
/// for the bone-palette tokens + audio-driven advance. Differences
/// vs. stash:
///   - bone-tinted backdrop / spotlight (matches the rest of the
///     Libre chrome instead of stash's slate palette);
///   - per-step MP3 played via the `useTourAudio` singleton;
///   - auto-advance to the next step on `ended` so a user can
///     run the tour hands-free (still skippable + back-able);
///   - source of truth for steps is `tourSteps.json` →
///     `TOUR_STEPS` (typed + icon-resolved in `tourSteps.ts`),
///     not an i18n bundle. Single-language for now; refactor if
///     Libre picks up i18next for the rest of the UI later.

import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@base/primitives/icon";
import { play as playIcon } from "@base/primitives/icon/icons/play";
import { pause as pauseIcon } from "@base/primitives/icon/icons/pause";
import { volume2 } from "@base/primitives/icon/icons/volume-2";
import { volumeX } from "@base/primitives/icon/icons/volume-x";
import "@base/primitives/icon/icon.css";
import type { TourStep } from "./tourSteps";
import { useTourAudio } from "./useTourAudio";
import { useT } from "@/i18n/i18n";
import "./Tour.css";

interface TourProps {
  steps: TourStep[];
  active: boolean;
  /// Switch the App's top-level view before each step measures.
  /// The Tour component waits for the page to render (~450ms) when
  /// `step.page` differs from the current page, so the spotlight
  /// has a real DOM target to land on.
  onNavigate?: (page: string) => void;
  /// Per-step notification — useful for parent-side reactions like
  /// "auto-open the first installed lesson when we reach the editor
  /// step". The Tour itself never needs this; consumers do.
  onStepChange?: (stepIndex: number) => void;
  /// Fired when the user clicks Finish or Skip, OR when the last
  /// step's audio finishes and there's nothing to advance to.
  /// Caller persists the "tour completed" flag.
  onComplete: () => void;
}

const PADDING = 8;
const TOOLTIP_W = 360;
const TOOLTIP_GAP = 14;
const VIEWPORT_MARGIN = 16;
/// How long to wait after `onNavigate` fires before measuring the
/// target. The App's view-switch is synchronous but the new page's
/// React tree mounts on the next frame and may run an async
/// markdown render — 450ms is conservative enough to cover both
/// without making the user notice the delay.
const NAV_SETTLE_MS = 450;
const SAME_PAGE_SETTLE_MS = 60;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export function Tour({
  steps,
  active,
  onNavigate,
  onStepChange,
  onComplete,
}: TourProps) {
  const t = useT();
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);

  const step = steps[currentStep];
  const lastPageRef = useRef<string | null>(null);

  // Audio for the current step. Auto-plays whenever the step
  // changes (and the user hasn't muted). Returns a `done` flag the
  // effect below uses to auto-advance.
  const audio = useTourAudio({
    stepId: step?.id ?? null,
    autoPlay: active && !muted,
  });

  // ── Step transition: navigate, settle, measure ─────────────────
  useEffect(() => {
    if (!active || !step) return;
    setReady(false);
    setTargetRect(null);
    onStepChange?.(currentStep);
    const isPageChange = lastPageRef.current !== step.page;
    if (isPageChange && step.page) {
      onNavigate?.(step.page);
      lastPageRef.current = step.page;
    }
    // The settle delay is shorter when we're staying on the same
    // page — no need to wait for a fresh mount, just for any
    // existing layout-shifting effects (e.g. a sidebar toggle that
    // happens to be running) to settle.
    const delay = isPageChange ? NAV_SETTLE_MS : SAME_PAGE_SETTLE_MS;
    const timer = setTimeout(() => {
      const el = document.querySelector(step.target);
      setTargetRect(el ? el.getBoundingClientRect() : null);
      setReady(true);
      // Scroll the target into view if it's off-screen — otherwise
      // the spotlight + tooltip both render but the learner can't
      // see what we're pointing at.
      if (el) {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          /* old engines — ignore */
        }
      }
    }, delay);
    return () => clearTimeout(timer);
    // intentionally minimal deps — `step` and the callbacks are
    // derived from `currentStep`, re-running on every change of
    // those would cause double-fires on prop-identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentStep]);

  // ── Keep the rect in sync with resizes / layout shifts ─────────
  // The inner-page content can resize after the tour starts (a
  // late-loading image, a sidebar collapse, etc.). A 600ms poll
  // catches those without a MutationObserver.
  useEffect(() => {
    if (!active || !ready || !step) return;
    const update = () => {
      const el = document.querySelector(step.target);
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    const interval = setInterval(update, 600);
    return () => {
      window.removeEventListener("resize", update);
      clearInterval(interval);
    };
  }, [active, ready, step?.target]);

  const next = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
      setCurrentStep(0);
    }
  }, [currentStep, steps.length, onComplete]);

  const prev = useCallback(() => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  }, [currentStep]);

  const dismiss = useCallback(() => {
    onComplete();
    setCurrentStep(0);
  }, [onComplete]);

  // Auto-advance: when the current step's audio finishes naturally,
  // advance. The `done` flag is one-shot per step (the audio hook
  // resets it on stepId change), so we don't re-fire mid-step.
  useEffect(() => {
    if (!active || !audio.done) return;
    next();
  }, [active, audio.done, next]);

  // Reset to step 0 every time the tour is re-activated. Without
  // this, a learner who finished + re-opens via the help button
  // would land on the last step.
  useEffect(() => {
    if (active) {
      setCurrentStep(0);
      lastPageRef.current = null;
    }
  }, [active]);

  if (!active || !step) return null;

  // ── Tooltip placement ─────────────────────────────────────────
  // Mirror of the stash logic, with a tighter top-edge clamp because
  // the bone-palette progress bar at the top of the tooltip is taller
  // than stash's.
  const placement = step.placement || "bottom";
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipStyle: React.CSSProperties = {};
  const tooltipH = 320;

  if (targetRect && ready) {
    let top = 0;
    let left = 0;
    switch (placement) {
      case "bottom":
        top = targetRect.bottom + TOOLTIP_GAP;
        left = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;
        break;
      case "top":
        top = targetRect.top - TOOLTIP_GAP - tooltipH;
        left = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
        left = targetRect.right + TOOLTIP_GAP;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
        left = targetRect.left - TOOLTIP_W - TOOLTIP_GAP;
        break;
    }
    tooltipStyle.top = clamp(top, VIEWPORT_MARGIN, vh - tooltipH);
    tooltipStyle.left = clamp(
      left,
      VIEWPORT_MARGIN,
      vw - TOOLTIP_W - VIEWPORT_MARGIN,
    );
  } else {
    // No target → centered modal-style. Happens when the selector
    // doesn't match (e.g. step 4 "Audiobook narration" runs before
    // the user has opened a lesson) — the body text alone carries
    // the message in that case.
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  }

  // Spotlight rect — clipped to the viewport so a target whose
  // edge runs off-screen doesn't punch a hole into nothing.
  const spotlightRect =
    targetRect && ready
      ? (() => {
          const edge = 6;
          const top = Math.max(edge, targetRect.top - PADDING);
          const left = Math.max(edge, targetRect.left - PADDING);
          const right = Math.min(vw - edge, targetRect.right + PADDING);
          const bottom = Math.min(vh - edge, targetRect.bottom + PADDING);
          return { top, left, width: right - left, height: bottom - top };
        })()
      : null;

  const progressPct = ((currentStep + 1) / steps.length) * 100;
  // Audio sub-progress within the current step. Drives a thin
  // secondary fill on top of the step-progress bar so the listener
  // can see how much of THIS step's narration is left.
  const audioPct = Math.max(0, Math.min(1, audio.progress)) * 100;

  return (
    <div className="libre-tour" role="dialog" aria-label={t("tour.ariaLabel")}>
      {/* Constant dimmed backdrop. The mask cuts a hole around the
          spotlight rect so the actual UI shows through, drawing the
          eye to the called-out element. */}
      <div className="libre-tour__backdrop" onClick={dismiss}>
        {spotlightRect ? (
          <div
            className="libre-tour__backdrop-mask"
            style={{
              maskImage:
                "linear-gradient(#000 0 0), linear-gradient(#000 0 0)",
              WebkitMaskImage:
                "linear-gradient(#000 0 0), linear-gradient(#000 0 0)",
              maskComposite: "exclude",
              WebkitMaskComposite: "xor",
              maskPosition: `0 0, ${spotlightRect.left}px ${spotlightRect.top}px`,
              WebkitMaskPosition: `0 0, ${spotlightRect.left}px ${spotlightRect.top}px`,
              maskSize: `100% 100%, ${spotlightRect.width}px ${spotlightRect.height}px`,
              WebkitMaskSize: `100% 100%, ${spotlightRect.width}px ${spotlightRect.height}px`,
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
            }}
          />
        ) : (
          <div className="libre-tour__backdrop-full" />
        )}
      </div>

      {spotlightRect && (
        <div
          className="libre-tour__spotlight"
          style={{
            top: spotlightRect.top,
            left: spotlightRect.left,
            width: spotlightRect.width,
            height: spotlightRect.height,
          }}
          aria-hidden
        />
      )}

      {ready && (
        <div
          key={currentStep}
          className="libre-tour__tooltip"
          style={tooltipStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="libre-tour__progress-bar">
            <div
              className="libre-tour__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
            {/* Audio sub-progress — only visible while the step's
                MP3 is actually playing. Lets the user see "I'm
                halfway through this step's narration" without
                cluttering the UI when audio is muted / unavailable. */}
            {audio.available && (
              <div
                className="libre-tour__progress-audio"
                style={{ width: `${audioPct}%` }}
              />
            )}
          </div>

          <div className="libre-tour__header">
            <div
              className="libre-tour__icon"
              style={{ background: `${step.iconColor}1a` }}
            >
              <span style={{ color: step.iconColor }}>
                <Icon icon={step.icon} size="base" color="currentColor" />
              </span>
            </div>
            <div className="libre-tour__header-text">
              <div className="libre-tour__step-label">
                {t("tour.stepOfTotal", { current: currentStep + 1, total: steps.length })}
              </div>
              <div className="libre-tour__title">{step.title}</div>
            </div>
            {/* Mute / unmute the narration. Persists across steps but
                NOT across tour sessions — re-opening the tour starts
                with audio on. (If users hate it we can persist
                muted-state to localStorage; not on by default to
                avoid silently breaking the audio-first UX.) */}
            {audio.available && (
              <button
                type="button"
                className="libre-tour__mute"
                onClick={() => {
                  setMuted((m) => {
                    const next = !m;
                    if (next) audio.pause();
                    else audio.play();
                    return next;
                  });
                }}
                aria-label={muted ? t("tour.unmute") : t("tour.mute")}
                title={muted ? t("tour.unmute") : t("tour.mute")}
              >
                <Icon
                  icon={muted ? volumeX : volume2}
                  size="xs"
                  color="currentColor"
                />
              </button>
            )}
          </div>

          <div className="libre-tour__body">{step.body}</div>

          <div className="libre-tour__dots" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={
                  "libre-tour__dot" +
                  (i === currentStep ? " libre-tour__dot--active" : "") +
                  (i < currentStep ? " libre-tour__dot--done" : "")
                }
              />
            ))}
          </div>

          <div className="libre-tour__footer">
            <button
              type="button"
              className="libre-tour__btn libre-tour__btn--ghost"
              onClick={dismiss}
            >
              {t("tour.skip")}
            </button>
            <div className="libre-tour__actions">
              {audio.available && (
                <button
                  type="button"
                  className="libre-tour__btn libre-tour__btn--ghost libre-tour__btn--icon"
                  onClick={() => (audio.isPlaying ? audio.pause() : audio.play())}
                  aria-label={audio.isPlaying ? t("tour.pause") : t("tour.play")}
                  title={audio.isPlaying ? t("tour.pause") : t("tour.play")}
                >
                  <Icon
                    icon={audio.isPlaying ? pauseIcon : playIcon}
                    size="xs"
                    color="currentColor"
                  />
                </button>
              )}
              {currentStep > 0 && (
                <button
                  type="button"
                  className="libre-tour__btn libre-tour__btn--ghost"
                  onClick={prev}
                >
                  {t("tour.back")}
                </button>
              )}
              <button
                type="button"
                className="libre-tour__btn libre-tour__btn--primary"
                onClick={next}
              >
                {currentStep === steps.length - 1 ? t("tour.finish") : t("tour.next")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Tour;
