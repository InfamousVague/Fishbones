/// In-progress companion to CertificateTicket. Same parchment + foil
/// + tear-off-stub frame, but the body shows "what you're working
/// toward" instead of an earned achievement: course title in place of
/// the recipient signature, a progress bar where the rule + "for
/// completing" lines live on the earned ticket, and a big percentage
/// + lesson count on the stub instead of the QR + Download chip.
///
/// Visual intent: when the gallery shows earned + in-progress side-
/// by-side, the in-progress cards read as the SAME family — same
/// shape, same hologram language — but clearly unfinished. The user
/// gets a coherent "here's what's done, here's what's coming" wall
/// of artefacts.
///
/// No download, no QR, no flip — there's nothing to verify yet.
/// Hover gives the same shimmer treatment the earned ticket uses
/// (it's the closest visual sibling we have, so it should respond
/// to attention the same way).

import type { Course } from "@/data/types";
import { useT } from "@/i18n/i18n";
import "./CertificateTicket.css";
import "./InProgressTicket.css";

interface Props {
  course: Course;
  doneLessons: number;
  totalLessons: number;
  /// Optional click handler — typically jumps the learner straight
  /// into the course's resume-at lesson so the cert page doubles as
  /// a "pick up where you left off" surface.
  onResume?: () => void;
}

export default function InProgressTicket({
  course,
  doneLessons,
  totalLessons,
  onResume,
}: Props) {
  const t = useT();
  const pct = totalLessons > 0 ? doneLessons / totalLessons : 0;
  const pctLabel = `${Math.round(pct * 100)}%`;
  const remaining = Math.max(totalLessons - doneLessons, 0);

  return (
    <div className="libre-cert-ticket-stage">
      <article
        className="libre-cert-ticket libre-cert-ticket--in-progress"
        aria-label={t("certificates.ariaInProgressFor", { title: course.title, done: doneLessons, total: totalLessons })}
      >
        {/* Hologram + shine layers — same elements the earned
            ticket uses; the in-progress modifier dials their
            opacity down a touch (defined in InProgressTicket.css)
            so the whole card reads as not-yet-earned. */}
        <div className="libre-cert-ticket__holo" aria-hidden />
        <div className="libre-cert-ticket__shine" aria-hidden />

        {/* ─── Body (left) ─────────────────────────────── */}
        <section className="libre-cert-ticket__body">
          <header className="libre-cert-ticket__body-head">
            <div className="libre-cert-ticket__brand">
              <span className="libre-cert-ticket__sparkle" aria-hidden>
                ✦
              </span>
              <span className="libre-cert-ticket__wordmark">
                LIBRE.ACADEMY
              </span>
            </div>
            <div className="libre-cert-ticket__daterange">
              {doneLessons > 0 ? t("certificates.started") : t("certificates.notStarted")}
            </div>
          </header>

          <div className="libre-cert-ticket__eyebrow">
            {t("certificates.inProgressEyebrow")}
          </div>
          <div className="libre-cert-ticket__recipient libre-cert-ticket__recipient--course">
            {course.title}
          </div>

          {/* Big progress bar — replaces the rule + "for completing"
              lines from the earned ticket. Reads as the visual
              centrepiece of an in-progress card. */}
          <div className="libre-progress-ticket__bar" aria-hidden>
            <div
              className="libre-progress-ticket__bar-fill"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>

          <div className="libre-cert-ticket__body-foot">
            <span className="libre-cert-ticket__stats">
              {totalLessons === 1
                ? t("certificates.lessonsXOfY", { done: doneLessons, total: totalLessons })
                : t("certificates.lessonsXOfYPlural", { done: doneLessons, total: totalLessons })}
              {remaining > 0 && `  ·  ${t("certificates.remainingSuffix", { count: remaining })}`}
            </span>
            {course.language && (
              <span className="libre-cert-ticket__lang">
                {course.language.toUpperCase()}
              </span>
            )}
          </div>
        </section>

        {/* ─── Stub (right) ───────────────────────────── */}
        <section className="libre-cert-ticket__stub">
          <div className="libre-cert-ticket__stub-eyebrow">
            {t("certificates.progressEyebrow")}
          </div>
          <div
            className="libre-progress-ticket__pct"
            aria-label={t("certificates.ariaPctComplete", { pct: pctLabel })}
          >
            {pctLabel}
          </div>
          {onResume ? (
            <button
              type="button"
              className="libre-cert-ticket__download libre-progress-ticket__resume"
              onClick={onResume}
              aria-label={t("certificates.ariaResume", { title: course.title })}
            >
              {t("certificates.resume")}
            </button>
          ) : (
            <div className="libre-progress-ticket__lesson-count">
              {t("certificates.lessonsTotal", { total: totalLessons })}
            </div>
          )}
          <div className="libre-cert-ticket__stub-id">
            {t("certificates.idPrefix", { id: course.id.slice(0, 12) })}
          </div>
        </section>
      </article>
    </div>
  );
}
