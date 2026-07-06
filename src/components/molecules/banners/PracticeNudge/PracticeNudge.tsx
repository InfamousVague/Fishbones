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
  onPractice,
  onDismiss,
}: {
  /// Number of due review items — drives the banner copy.
  due: number;
  onPractice: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
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
          {t(due === 1 ? "practiceNudge.body" : "practiceNudge.bodyPlural", {
            count: due,
          })}
        </div>
      </div>
      <div className="libre-practice-nudge__actions">
        <button
          type="button"
          className="libre-practice-nudge__go"
          onClick={onPractice}
        >
          {t("practiceNudge.practice")}
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
