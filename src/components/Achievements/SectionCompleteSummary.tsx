/// Summary card surfaced when the learner finishes a chapter or a
/// whole book. Two flavours, distinguished by the `kind` prop:
///
///   - `chapter` — slides up over the lesson view, dismissable, used
///     for chapter-end mini-celebrations. Sound: `complete-section`.
///   - `book` — full-screen modal takeover with the book cover
///     floating up + tilting, used for "you finished a whole book"
///     moments. Sound: `complete-book`. Sustained confetti wash.
///
/// Both renderings share the same data model: course title, optional
/// subtitle ("Chapter 4 / 12"), the XP earned in this section, the
/// streak day count, and any achievements freshly unlocked alongside.
///
/// The component is presentational only — the engine that decides
/// "show this card now" lives in the parent (App.tsx). The parent
/// computes the section delta when the last lesson in a chapter or
/// course flips complete.

import { useCallback, useEffect } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { flame } from "@base/primitives/icon/icons/flame";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { bookCheck } from "@base/primitives/icon/icons/book-check";

import {
  celebrate,
  accelerateActiveCelebrations,
  dismissActiveCelebrations,
} from "../../lib/celebrate";
import { playSound } from "../../lib/sfx";
import ModalBackdrop from "../Shared/ModalBackdrop";
import { useT } from "../../i18n/i18n";
import "./Achievements.css";

/// How long the closing coin shower runs at the bumped rate before
/// being torn down. Mirrors the same constant in
/// `AchievementModal.tsx` — 350 ms is enough for the visible coin
/// tail to flush at the 4× rate without dragging past the moment
/// the modal vanishes.
const FAREWELL_FLUSH_MS = 350;

interface Props {
  kind: "chapter" | "book";
  /// Display title — for chapters, "Chapter 4 / 12" or
  /// "Section title". For books, the book title itself.
  heading: string;
  /// Optional subtitle, e.g. course name when kind is "chapter".
  subheading?: string;
  /// Cover URL for the "book" kind. Ignored for chapter.
  coverUrl?: string;
  /// XP earned across the lessons in this section. Renders as
  /// a "+N XP" pill when provided.
  xpEarned?: number;
  /// Current streak — included in the summary as warm flavour
  /// ("17 day streak") if non-zero.
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
  // Wrap the parent's onDismiss with a closing flourish + tear-down
  // pass on the coin shower. Without this the celebrate video kept
  // playing for its full duration even after the modal vanished —
  // the celebration outlived the thing it was celebrating, which
  // read as "stuck overlay" not "wrap-up". Same shape as
  // `AchievementModal.handleDismiss`:
  //   1. Bump every active celebrate video to 4× so the remaining
  //      coin frames flush fast (baseline is 2× per
  //      `lib/celebrate.ts`, so this doubles the playback rate at
  //      dismiss time).
  //   2. Schedule a forced dismiss after FAREWELL_FLUSH_MS so the
  //      overlay is guaranteed gone even if `ended` doesn't fire
  //      on a malformed asset.
  //   3. Call the parent's onDismiss so the modal unmounts in
  //      parallel with the video's accelerated tail.
  const handleDismiss = useCallback(() => {
    accelerateActiveCelebrations(4.0);
    window.setTimeout(() => {
      dismissActiveCelebrations();
    }, FAREWELL_FLUSH_MS);
    onDismiss();
  }, [onDismiss]);

  // Belt-and-suspenders: if the card unmounts for any OTHER reason
  // (parent re-renders, ESC key handled by ModalBackdrop's own
  // listener fired but somehow bypassed handleDismiss, React
  // StrictMode double-invokes during dev), still tear down any
  // active celebration on the way out so we don't leak a playing
  // video into the next mount.
  useEffect(() => {
    return () => {
      dismissActiveCelebrations();
    };
  }, []);
  // Sound + confetti on first paint. Use a tiny timeout so the
  // browser actually paints the card before the audio fires —
  // otherwise the cue feels detached on slower machines.
  useEffect(() => {
    const t = setTimeout(() => {
      if (kind === "book") {
        playSound("complete-book");
        void celebrate("large", { x: 0.5, y: 0.35 });
        // Second burst at the 1.6 s mark so the wash sustains for
        // the full sound cue.
        setTimeout(() => {
          void celebrate("medium", { x: 0.5, y: 0.35 });
        }, 1600);
      } else {
        playSound("complete-section");
        void celebrate("small", { x: 0.5, y: 0.35 });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [kind]);

  const body = (
    <div className={`libre-ach-summary libre-ach-summary--${kind}`}>
      {kind === "book" && coverUrl ? (
        <div className="libre-ach-summary__cover">
          <img src={coverUrl} alt="" draggable={false} />
        </div>
      ) : (
        <div className="libre-ach-summary__sigil" aria-hidden>
          <Icon
            icon={kind === "book" ? bookCheck : flame}
            size="2xl"
            color="currentColor"
          />
        </div>
      )}
      <div className="libre-ach-summary__head">
        <span className="libre-ach-summary__eyebrow">
          {kind === "book" ? t("achievements.bookComplete") : t("achievements.sectionComplete")}
        </span>
        <h2 className="libre-ach-summary__title">{heading}</h2>
        {subheading ? (
          <span className="libre-ach-summary__sub">{subheading}</span>
        ) : null}
      </div>
      <div className="libre-ach-summary__stats">
        {xpEarned !== undefined && xpEarned > 0 ? (
          <span className="libre-ach-summary__stat">
            <Icon icon={sparkles} size="sm" color="currentColor" />
            <strong>+{xpEarned}</strong> XP
          </span>
        ) : null}
        {streakDays !== undefined && streakDays > 0 ? (
          <span className="libre-ach-summary__stat">
            <Icon icon={flame} size="sm" color="currentColor" />
            {t("achievements.dayStreak", { n: streakDays })}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="libre-ach-summary__cta"
        onClick={handleDismiss}
      >
        {t("achievements.keepGoing")}
      </button>
      <button
        type="button"
        className="libre-ach-summary__close"
        aria-label={t("achievements.dismissToast")}
        onClick={handleDismiss}
      >
        <Icon icon={xIcon} size="xs" color="currentColor" />
      </button>
    </div>
  );

  // Both variants get the heavier `libre-ach-modal-backdrop` —
  // dim 0.62 + 10 px blur — same treatment the unlock-modal uses.
  // Earlier the chapter variant was deliberately `--quiet` (clear
  // backdrop, just centre-position) so it read as a floating
  // mini-modal over the lesson view, but with the coin shower
  // playing behind it the missing backdrop meant the gold
  // particles competed with the card text for attention. Matching
  // the achievement modal's chrome resolves the legibility
  // problem and keeps every "celebrate moment" surface visually
  // consistent (same dim, same blur, same z-band).
  //
  // zIndex 10010 puts this summary above the celebration video
  // (which lives at z 9999 in `lib/celebrate.ts`). Without that
  // bump the coins paint over the summary card.
  return (
    <ModalBackdrop
      onDismiss={handleDismiss}
      zIndex={10010}
      className="libre-ach-modal-backdrop"
    >
      {body}
    </ModalBackdrop>
  );
}
