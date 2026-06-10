/// Mini certificate banner — chrome-sized echo of the full cert
/// ticket (src/components/Certificates/CertificateTicket.tsx),
/// rendered above the active-course tree. The shape mirrors the
/// real ticket: parchment body on the left, perforated tear-off
/// stub on the right, holographic foil layered over both. Below
/// the ticket, a small metadata block surfaces progress + status
/// in plain text so the artefact doesn't have to carry every
/// piece of information visually.
///
/// Motion brief:
///   - Subtle, ALWAYS-ON ambient drift on the holo foil so the
///     hologram is visible even at rest. No big swings — just
///     enough movement that the rainbow shifts are obvious if
///     you glance at the banner.
///   - Hover does NOT shimmer or wobble. It only enlarges the
///     ticket slightly (scale 1.02) to advertise interactivity.
///     Clicking switches to the certificates page via the
///     `onClick` prop.
///
/// The hover-shimmer treatment from the previous revision was
/// distracting in chrome where the user glances 100x a session;
/// the ambient version keeps the hologram alive without yelling
/// for attention.
import { Icon } from "@base/primitives/icon";
import { award } from "@base/primitives/icon/icons/award";
import type { Course } from "../../data/types";
// chapterBadgeIcons drives the chapter-badge grid inside the
// cert body — pickIcon hashes a chapter id to one of ~20 Lucide
// glyphs, chapterRotation hashes the same id to a small askew
// angle so the grid reads hand-applied rather than mechanical.
import { chapterRotation, pickIcon } from "./chapterBadgeIcons";
import { useT } from "../../i18n/i18n";
import "./MiniCertBanner.css";

interface Props {
  course: Course;
  /// Number of completed lessons in this course. Drives the
  /// progress bar width and the "x / y" label below the ticket.
  doneLessons: number;
  /// Total lesson count across all chapters.
  totalLessons: number;
  /// Click handler — typically navigates to the certificates
  /// page. Optional: when omitted, the banner renders as a
  /// non-interactive `<div>` (no cursor, no role).
  onClick?: () => void;
  /// Per-lesson completion set (keys: `${courseId}:${lessonId}`).
  /// Drives the section-complete stamps row below the banner;
  /// without it the stamps section is omitted (the banner alone
  /// still renders).
  completed?: Set<string>;
}

export default function MiniCertBanner({
  course,
  doneLessons,
  totalLessons,
  onClick,
  completed,
}: Props) {
  const t = useT();
  const pct = totalLessons > 0 ? doneLessons / totalLessons : 0;
  const pctLabel = `${Math.round(pct * 100)}%`;
  const isComplete = totalLessons > 0 && doneLessons === totalLessons;

  // Chapters with ALL their lessons complete. Drives the "Badges"
  // stat in the stub — same definition the badge punch-hole grid
  // below uses, so the count on the right and the punched icons
  // on the left always agree. When `completed` isn't provided
  // (the optional prop), every chapter falls through to 0 done →
  // 0 earned, which is the correct read of "we have no data".
  const earnedChapters = completed
    ? course.chapters.reduce(
        (n, ch) =>
          n +
          (ch.lessons.length > 0 &&
          ch.lessons.every((l) => completed.has(`${course.id}:${l.id}`))
            ? 1
            : 0),
        0,
      )
    : 0;

  // Render as a button when click handler is wired so keyboard +
  // assistive tech users get the full interaction surface; fall
  // back to a non-interactive div otherwise so the banner
  // doesn't advertise interactivity it can't deliver.
  const TicketTag = onClick ? "button" : "div";
  const ticketProps = onClick
    ? {
        type: "button" as const,
        onClick,
        "aria-label": t("certificates.openCertAria", {
          course: course.title,
          pct: pctLabel,
        }),
      }
    : { "aria-hidden": true as const };

  return (
    <div className="libre-mini-cert-shell">
      <TicketTag
        className={`libre-mini-cert ${
          isComplete ? "libre-mini-cert--complete" : ""
        } ${onClick ? "libre-mini-cert--interactive" : ""}`}
        title={onClick ? t("certificates.openCertificates") : undefined}
        {...ticketProps}
      >
        {/* Inner motion wrapper carries the ambient breathe
            animation; the outer button carries the hover-scale
            transform. Two layers because CSS animations override
            regular rules' transforms — if both were on the same
            element, the hover scale would never apply while the
            breathe was running. With them split, the
            transforms compose visually (button scale * inner
            rotation/scale) and both stay active. */}
        <div className="libre-mini-cert__motion">
          {/* Holo + shine overlays — inset to the motion
              wrapper so they ride along with the breathe
              transform. Ambient foil drift runs on its own loop
              independently of the card breathe. */}
          <div className="libre-mini-cert__holo" aria-hidden />
          <div className="libre-mini-cert__shine" aria-hidden />

          <div className="libre-mini-cert__body">
            <div className="libre-mini-cert__head">
              {/* Lucide `award` glyph stands in for the previous
                  ✦ sparkle — same eyebrow companion role, but
                  reads explicitly as a certificate / award icon
                  without depending on a typographic flourish
                  that renders inconsistently across font
                  stacks. */}
              <span className="libre-mini-cert__icon" aria-hidden>
                <Icon icon={award} size="xs" color="currentColor" />
              </span>
              <span className="libre-mini-cert__eyebrow">
                {isComplete ? t("certificates.earned") : t("certificates.certificate")}
              </span>
            </div>

            <div className="libre-mini-cert__course">{course.title}</div>

            <div className="libre-mini-cert__bar" aria-hidden>
              <div
                className="libre-mini-cert__bar-fill"
                style={{ width: `${Math.round(pct * 100)}%` }}
              />
            </div>

            {/* Badge punch-hole grid. One slot per chapter, laid
                out as a square grid at the bottom of the cert
                body. Earned chapters render as a dark icon-shaped
                "punch" through the parchment — slight per-chapter
                rotation so the grid reads as semi-random / hand-
                applied rather than a regular sticker sheet.
                Pending chapters render as a faint outline of the
                same icon, ready to be earned. */}
            {completed && course.chapters.length > 0 && (
              <div
                className="libre-mini-cert__badges"
                role="list"
                aria-label={t("certificates.ariaBadges")}
              >
                {course.chapters.map((chapter, idx) => {
                  // Some imported courses ship chapters without an `id`;
                  // fall back to a stable index-based key so badges stay
                  // unique + deterministic and React keys don't collide.
                  const chapterKey = chapter.id ?? `${course.id}-ch-${idx}`;
                  const total = chapter.lessons.length;
                  const done = chapter.lessons.filter((l) =>
                    completed.has(`${course.id}:${l.id}`),
                  ).length;
                  const earned = total > 0 && done === total;
                  const rotation = chapterRotation(chapterKey);
                  return (
                    <span
                      key={chapterKey}
                      role="listitem"
                      className={
                        "libre-mini-cert__badge " +
                        (earned
                          ? "libre-mini-cert__badge--earned"
                          : "libre-mini-cert__badge--pending")
                      }
                      style={{ transform: `rotate(${rotation}deg)` }}
                      title={
                        earned
                          ? t("certificates.chapterEarned", { chapter: chapter.title })
                          : t("certificates.chapterProgress", {
                              chapter: chapter.title,
                              done,
                              total,
                            })
                      }
                    >
                      <Icon
                        icon={pickIcon(chapterKey)}
                        size="xs"
                        color="currentColor"
                        // Bumped stroke weight for earned badges
                        // so the icon's line-art fills more of
                        // its silhouette — reads as a thicker,
                        // punched-through shape rather than a
                        // line drawing.
                        weight={earned ? "bold" : "regular"}
                      />
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tear-off stub on the right — perforated separator on
              its left edge mirrors the full ticket's notch+dash
              treatment. Hosts a stack of stat blocks now that the
              cert body grew vertically with the badge grid; the
              extra real estate would otherwise have left the
              stub feeling under-filled with just a single PCT
              readout. Stats stack as PCT (hero) → Lessons →
              Badges, with the course's short id pinned at the
              bottom as the artefact serial. */}
          <div className="libre-mini-cert__stub" aria-hidden>
            <div className="libre-mini-cert__stub-stats">
              <div
                className={
                  "libre-mini-cert__stub-stat libre-mini-cert__stub-stat--hero"
                }
              >
                <div className="libre-mini-cert__stub-stat-label">{t("certificates.stubPct")}</div>
                <div className="libre-mini-cert__stub-stat-value">
                  {pctLabel}
                </div>
              </div>
              <div className="libre-mini-cert__stub-stat">
                <div className="libre-mini-cert__stub-stat-label">{t("certificates.stubLessons")}</div>
                <div className="libre-mini-cert__stub-stat-value">
                  {doneLessons}
                  <span className="libre-mini-cert__stub-stat-suffix">
                    /{totalLessons}
                  </span>
                </div>
              </div>
              <div className="libre-mini-cert__stub-stat">
                <div className="libre-mini-cert__stub-stat-label">{t("certificates.stubBadges")}</div>
                <div className="libre-mini-cert__stub-stat-value">
                  {earnedChapters}
                  <span className="libre-mini-cert__stub-stat-suffix">
                    /{course.chapters.length}
                  </span>
                </div>
              </div>
            </div>
            <div className="libre-mini-cert__stub-id">
              {course.id.slice(0, 6).toUpperCase()}
            </div>
          </div>
        </div>
      </TicketTag>
      {/* Progress meta line ("N / M lessons · K to go") used to
          render here. Retired because the cert body already
          carries the percentage + chapter badge grid; the
          duplicate text underneath cluttered the sidebar and
          competed with the active chapter tree below. The full
          numerical breakdown still lives on the Certificates
          page that the banner click-opens. */}
    </div>
  );
}
