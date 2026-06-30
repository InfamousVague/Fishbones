/// Browse-all surface for certificates — earned ones at the top
/// (full holographic ticket with QR + download), in-progress ones
/// below (same ticket frame, "Certificate in progress" eyebrow,
/// progress bar + percentage on the stub). Together the two
/// sections answer "what have I earned?" and "what am I working
/// toward?" on one wall.
///
/// In-progress filter: any course the learner has touched (≥1
/// completed lesson) that doesn't already have an earned cert
/// minted. Untouched courses don't appear — the page is a learner
/// bench, not a course catalogue. Discovery still happens on the
/// Library page.

import CertificateTicket from "./CertificateTicket";
import InProgressTicket from "./InProgressTicket";
import { SkeletonCardGrid } from "@/components/atoms/Skeleton/Skeleton";
import { useCertificates } from "@/hooks/useCertificates";
import type { Course } from "@/data/types";
import { useT } from "@/i18n/i18n";
import "./CertificatesPage.css";

interface Props {
  /// All installed courses. Filtered down to in-progress ones
  /// inside the component. Optional so the page still renders
  /// (earned-only) when no course list is plumbed through.
  courses?: Course[];
  /// Per-lesson completion set (keys: `${courseId}:${lessonId}`).
  /// Drives the per-course progress count on each in-progress
  /// ticket. Defaults to empty when not provided.
  completed?: Set<string>;
  /// Optional resume handler — wires the in-progress ticket's
  /// "Resume →" button to jump back into the course. Parent owns
  /// "where to resume at" (last-open lesson, first incomplete,
  /// etc.) so this signature is just `(courseId) => void`.
  onResume?: (courseId: string) => void;
}

export default function CertificatesPage({
  courses = [],
  completed = new Set(),
  onResume,
}: Props) {
  const t = useT();
  const { certificates, loaded } = useCertificates();

  // Earned: sort newest-first — the most recent achievement
  // reads as the most exciting one, so we lead with it.
  const earned = [...certificates].sort((a, b) =>
    b.issuedAt.localeCompare(a.issuedAt),
  );

  // Quick lookup: which courses already have a minted cert? We
  // skip those from the in-progress list so a course doesn't
  // appear in BOTH sections during the brief window between
  // "100% complete" and "cert minted" (or in any edge case
  // where progress equals total but the cert payload is missing).
  const earnedCourseIds = new Set(earned.map((c) => c.courseId));

  // In-progress: courses with ≥1 completed lesson but no minted
  // cert yet. We compute progress fresh from `completed` rather
  // than trusting any cached aggregate so the page reflects the
  // true current state on every render.
  const inProgress = courses
    .map((course) => {
      const totalLessons = course.chapters.reduce(
        (n, ch) => n + ch.lessons.length,
        0,
      );
      const doneLessons = course.chapters.reduce(
        (n, ch) =>
          n +
          ch.lessons.filter((l) => completed.has(`${course.id}:${l.id}`))
            .length,
        0,
      );
      return { course, doneLessons, totalLessons };
    })
    .filter(
      ({ course, doneLessons, totalLessons }) =>
        doneLessons > 0 &&
        doneLessons < totalLessons &&
        !earnedCourseIds.has(course.id),
    )
    // Sort by progress percentage descending — the cert closest
    // to being earned shows first, so the page leads with the
    // "almost there" surfaces.
    .sort((a, b) => {
      const pa = a.totalLessons > 0 ? a.doneLessons / a.totalLessons : 0;
      const pb = b.totalLessons > 0 ? b.doneLessons / b.totalLessons : 0;
      return pb - pa;
    });

  const hasEarned = earned.length > 0;
  const hasInProgress = inProgress.length > 0;

  return (
    <div className="libre-certs-page">
      <header className="libre-certs-page__header">
        <h1 className="libre-certs-page__title">{t("certificates.title")}</h1>
        <p className="libre-certs-page__subtitle">
          {t("certificates.pageSubtitle")}
        </p>
      </header>

      {!loaded ? (
        <div className="libre-certs-page__grid">
          <SkeletonCardGrid count={3} variant="ticket" />
        </div>
      ) : !hasEarned && !hasInProgress ? (
        <EmptyState />
      ) : (
        <>
          {hasInProgress && (
            <section className="libre-certs-page__section">
              <h2 className="libre-certs-page__section-title">
                {t("certificates.sectionInProgress")}
                <span className="libre-certs-page__section-count">
                  {inProgress.length}
                </span>
              </h2>
              <div className="libre-certs-page__grid">
                {inProgress.map(({ course, doneLessons, totalLessons }) => (
                  <InProgressTicket
                    key={course.id}
                    course={course}
                    doneLessons={doneLessons}
                    totalLessons={totalLessons}
                    onResume={onResume ? () => onResume(course.id) : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          {hasEarned && (
            <section className="libre-certs-page__section">
              <h2 className="libre-certs-page__section-title">
                {t("certificates.sectionEarned")}
                <span className="libre-certs-page__section-count">
                  {earned.length}
                </span>
              </h2>
              {/* `--earned` modifier flips the grid to single-
                  column full-width tickets. Completed certificates
                  are the page's headline artefact — they deserve
                  to lay out big, the way you'd pin a diploma to
                  a wall — whereas in-progress tickets keep the
                  compact 2-up grid since they're status indicators
                  more than achievements. */}
              <div className="libre-certs-page__grid libre-certs-page__grid--earned">
                {earned.map((cert) => {
                  // Look up the underlying course so the cert can
                  // render its badge punch-hole grid. Courses may
                  // be uninstalled after the cert is minted — in
                  // that case `chapters` resolves to undefined and
                  // CertificateTicket simply skips the badges row.
                  const course = courses.find(
                    (c) => c.id === cert.courseId,
                  );
                  return (
                    <CertificateTicket
                      key={cert.id}
                      cert={cert}
                      chapters={course?.chapters}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="libre-certs-page__empty">
      <div className="libre-certs-page__empty-seal" aria-hidden>
        ✦
      </div>
      <h2 className="libre-certs-page__empty-title">{t("certificates.emptyTitle")}</h2>
      <p className="libre-certs-page__empty-body">
        {t("certificates.emptyBody")}
      </p>
    </div>
  );
}
