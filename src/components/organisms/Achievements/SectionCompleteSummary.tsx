/// Surfaced when the learner finishes a chapter or a whole book. A transient
/// accent-glass BANNER that slides down from under the top bar and
/// auto-dismisses — far less intrusive than the full-screen modal takeover it
/// replaced. Two flavours via `kind`:
///
///   - `chapter` — chapter-end mini-celebration. Sound: `complete-section`.
///   - `book` — finished a whole book; shows the cover thumbnail. Sound:
///     `complete-book`.
///
/// The old coin-shower / confetti "flush" is gone (the `celebrate` lib was
/// retired in May 2026 for reading as ka-ching mobile-game noise); only the
/// sound cue remains as punctuation.
///
/// Presentational only — the engine that decides "show this now" lives in
/// App.tsx, which computes the section delta when the last lesson in a chapter
/// or course flips complete.

import { useEffect } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { flame } from "@base/primitives/icon/icons/flame";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { bookCheck } from "@base/primitives/icon/icons/book-check";

import { playSound } from "@/lib/sfx";
import { useTimeout } from "@/hooks/useTimeout";
import { useT } from "@/i18n/i18n";
import "./Achievements.css";

/// Auto-dismiss after this long — a banner shouldn't linger like a modal.
const AUTO_DISMISS_MS = 6000;

interface Props {
  kind: "chapter" | "book";
  /// Display title — "Chapter 4 / 12" / a section title, or the book title.
  heading: string;
  /// Optional subtitle, e.g. course name when kind is "chapter".
  subheading?: string;
  /// Cover URL for the "book" kind. Ignored for chapter.
  coverUrl?: string;
  /// XP earned across the lessons in this section — renders as a "+N XP" pill.
  xpEarned?: number;
  /// Current streak — rendered as a "17 day streak" pill when non-zero.
  streakDays?: number;
  onDismiss: () => void;
}

export default function SectionCompleteSummary({
  kind,
  heading,
  subheading,
  coverUrl,
  xpEarned,
  streakDays,
  onDismiss,
}: Props) {
  const t = useT();

  // Sound cue shortly after first paint so it doesn't feel detached on slower
  // machines. (The coin-shower visual was retired; the sound is the cue now.)
  useEffect(() => {
    const id = window.setTimeout(() => {
      playSound(kind === "book" ? "complete-book" : "complete-section");
    }, 60);
    return () => window.clearTimeout(id);
  }, [kind]);

  // Auto-dismiss — the banner clears itself after a beat (manual close still
  // works). Reuses the shared useTimeout hook.
  useTimeout(onDismiss, AUTO_DISMISS_MS);

  return (
    <aside
      className={`libre-ach-banner libre-ach-banner--${kind}`}
      role="status"
      aria-live="polite"
    >
      {kind === "book" && coverUrl ? (
        <img
          className="libre-ach-banner__cover"
          src={coverUrl}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="libre-ach-banner__sigil" aria-hidden>
          <Icon
            icon={kind === "book" ? bookCheck : flame}
            size="lg"
            color="currentColor"
          />
        </span>
      )}

      <div className="libre-ach-banner__text">
        <span className="libre-ach-banner__eyebrow">
          {kind === "book"
            ? t("achievements.bookComplete")
            : t("achievements.sectionComplete")}
        </span>
        <span className="libre-ach-banner__title">{heading}</span>
        {subheading ? (
          <span className="libre-ach-banner__sub">{subheading}</span>
        ) : null}
      </div>

      <div className="libre-ach-banner__stats">
        {xpEarned !== undefined && xpEarned > 0 ? (
          <span className="libre-ach-banner__stat">
            <Icon icon={sparkles} size="xs" color="currentColor" />
            <strong>+{xpEarned}</strong> XP
          </span>
        ) : null}
        {streakDays !== undefined && streakDays > 0 ? (
          <span className="libre-ach-banner__stat">
            <Icon icon={flame} size="xs" color="currentColor" />
            {t("achievements.dayStreak", { n: streakDays })}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className="libre-ach-banner__close"
        aria-label={t("achievements.dismissToast")}
        onClick={onDismiss}
      >
        <Icon icon={xIcon} size="xs" color="currentColor" />
      </button>
    </aside>
  );
}
