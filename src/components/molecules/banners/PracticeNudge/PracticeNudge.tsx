import { Icon } from "@base/primitives/icon";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import "./PracticeNudge.css";

/// "Welcome back — review something?" floating banner.
///
/// Shown by the host when the learner returns after a few hours away AND
/// has practice items due (see lib/practiceNudge.ts for the gap gate).
/// Accepting starts a review session immediately and the host returns
/// the learner to wherever they were once the session ends; dismissing
/// latches for the sitting. Mirrors the UpdateBanner's floating-card
/// placement so alerts share one visual language.
export default function PracticeNudge({
  due,
  chapters,
  onPractice,
  onDismiss,
}: {
  /// Number of due review items — drives the fallback banner copy
  /// when no recent-chapter scope is available.
  due: number;
  /// The 1-2 most recently studied chapters (see recentReview.ts).
  /// When present the banner becomes the tailored "let's review what
  /// you learned last time" prompt with chapter chips, and accepting
  /// starts a session scoped to exactly those chapters.
  chapters?: ReadonlyArray<{ chapterTitle: string; courseTitle: string }>;
  onPractice: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const tailored = !!chapters && chapters.length > 0;
  return (
    <div
      className="libre-practice-nudge"
      role="status"
      aria-label={t("practiceNudge.title")}
    >
      <div className="libre-practice-nudge__icon" aria-hidden>
        <Icon icon={dumbbell} size="sm" color="currentColor" />
      </div>
      <div className="libre-practice-nudge__body">
        <div className="libre-practice-nudge__title">
          {t("practiceNudge.title")}
        </div>
        <div className="libre-practice-nudge__sub">
          {tailored
            ? t("practiceNudge.reviewBody")
            : t(due === 1 ? "practiceNudge.body" : "practiceNudge.bodyPlural", {
                count: due,
              })}
        </div>
        {tailored && (
          <div className="libre-practice-nudge__chapters">
            {chapters!.map((c) => (
              <span
                key={`${c.courseTitle}:${c.chapterTitle}`}
                className="libre-practice-nudge__chapter"
                title={`${c.chapterTitle} — ${c.courseTitle}`}
              >
                {c.chapterTitle}
                <em>{c.courseTitle}</em>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="libre-practice-nudge__actions">
        <button
          type="button"
          className="libre-practice-nudge__go"
          onClick={onPractice}
        >
          {t(tailored ? "practiceNudge.review" : "practiceNudge.practice")}
        </button>
        <button
          type="button"
          className="libre-practice-nudge__dismiss"
          onClick={onDismiss}
          aria-label={t("practiceNudge.dismiss")}
          title={t("practiceNudge.dismiss")}
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
    </div>
  );
}
