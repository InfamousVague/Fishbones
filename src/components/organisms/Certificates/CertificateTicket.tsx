/// Horizontal certificate ticket — single view, no flip. Layout
/// mirrors the downloadable PNG (`generateCertificatePng.ts`):
/// main body on the left with the cert face, tear-off stub on the
/// right with the QR verification code. Hover triggers a subtle
/// holographic shimmer + gentle wobble; clicking the Download
/// button on the stub saves the PNG.
///
/// No flip / no back face — the QR is visible at all times on the
/// stub so there's nothing to reveal via interaction. The whole
/// ticket is a single static surface that doubles as the on-screen
/// preview AND the source-of-truth for the printed artefact.

import { useEffect, useState } from "react";
// `qrcode` is imported dynamically in the effect below so it
// code-splits out of this component's chunk.
import { Icon } from "@base/primitives/icon";
import { download as downloadIcon } from "@base/primitives/icon/icons/download";
import type { Certificate } from "@/data/certificates";
import { buildVerifyUrl } from "@/data/certificates";
import type { Chapter } from "@/data/types";
import {
  chapterRotation,
  pickIcon,
} from "@/components/organisms/Sidebar/chapterBadgeIcons";
import { downloadCertificatePng } from "./generateCertificatePng";
import { useT } from "@/i18n/i18n";
import "./CertificateTicket.css";

interface Props {
  cert: Certificate;
  /// Chapters from the underlying course, when the parent can
  /// resolve them. Drives the badge punch-hole grid at the
  /// bottom of the cert body — one icon per chapter, painted as
  /// a hard silhouette in the cert ink colour, rotated a few
  /// degrees off-axis per chapter so the row reads as semi-
  /// random / hand-applied. Optional because the cert payload
  /// itself doesn't carry chapter snapshots — older certs whose
  /// underlying course was uninstalled simply render without
  /// the badges row, no missing-data UI to manage.
  chapters?: ReadonlyArray<Chapter>;
}

export default function CertificateTicket({ cert, chapters }: Props) {
  const t = useT();
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  // Render the QR once per cert. The verify URL is deterministic
  // from the cert payload so re-running for a stable cert produces
  // an identical image.
  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(buildVerifyUrl(cert), {
          width: 260,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [cert]);

  const issuedDate = new Date(cert.issuedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const startedDate = cert.startedAt
    ? new Date(cert.startedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const dateRange = startedDate
    ? `${startedDate} → ${issuedDate}`
    : issuedDate;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadCertificatePng(cert);
    } catch {
      /* errors are surfaced in the console via the generator */
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="libre-cert-ticket-stage">
      <article
        className="libre-cert-ticket"
        aria-label={t("certificates.ariaCertFor", { title: cert.courseTitle })}
      >
        {/* Holographic foil — rainbow gradient masked by a tiled
            sparkle pattern, composited via multiply blend. */}
        <div className="libre-cert-ticket__holo" aria-hidden />
        {/* Diagonal shine band — drifts across via --p on hover. */}
        <div className="libre-cert-ticket__shine" aria-hidden />

        {/* ─── Body (left) ─────────────────────────────── */}
        <section className="libre-cert-ticket__body">
          {/* Header row is now just the date — the wordmark image
              that previously occupied the left half of this row
              was retired. It crowded the daterange + the
              eyebrow underneath against the recipient name,
              causing the whole body to overflow the 5:2 ticket
              on long course titles. The brand identity still
              shows on the in-progress ticket and via the QR
              verify URL on the stub. */}
          <header className="libre-cert-ticket__body-head">
            <div className="libre-cert-ticket__daterange">{dateRange}</div>
          </header>

          <div className="libre-cert-ticket__eyebrow">
            {t("certificates.ofCompletion")}
          </div>
          <div className="libre-cert-ticket__recipient">
            {cert.recipientName}
          </div>
          <div className="libre-cert-ticket__rule" />
          <div className="libre-cert-ticket__for">{t("certificates.forCompleting")}</div>
          <div className="libre-cert-ticket__course">{cert.courseTitle}</div>

          {/* Badge grid — one line-art sticker icon per chapter,
              rotated a few degrees per chapter so the row reads
              as hand-applied rather than machine-set.
              The cert is by definition fully earned (no cert is
              minted unless the course is 100% complete), so every
              chapter renders as "earned" — there's no pending
              state to manage on this surface. Skipped when the
              parent can't resolve the course chapters (older cert
              records where the underlying course has been
              uninstalled). */}
          {chapters && chapters.length > 0 && (
            <div
              className="libre-cert-ticket__badges"
              role="list"
              aria-label={t("certificates.ariaBadges")}
            >
              {chapters.map((chapter) => {
                const rotation = chapterRotation(chapter.id);
                return (
                  <span
                    key={chapter.id}
                    role="listitem"
                    className="libre-cert-ticket__badge"
                    style={{ transform: `rotate(${rotation}deg)` }}
                    title={chapter.title}
                  >
                    <Icon
                      icon={pickIcon(chapter.id)}
                      size="sm"
                      color="currentColor"
                      weight="bold"
                    />
                  </span>
                );
              })}
            </div>
          )}

          <div className="libre-cert-ticket__body-foot">
            <span className="libre-cert-ticket__stats">
              {cert.lessonCount === 1
                ? t("certificates.lessonCount", { count: cert.lessonCount })
                : t("certificates.lessonCountPlural", { count: cert.lessonCount })}
              {"  ·  "}
              {cert.xpEarned.toLocaleString()} XP
            </span>
            {cert.courseLanguage && (
              <span className="libre-cert-ticket__lang">
                {cert.courseLanguage.toUpperCase()}
              </span>
            )}
          </div>
        </section>

        {/* ─── Stub (right) ───────────────────────────── */}
        <section className="libre-cert-ticket__stub">
          <div className="libre-cert-ticket__stub-eyebrow">
            {t("certificates.scanToVerify")}
          </div>
          {qrDataUrl ? (
            <div className="libre-cert-ticket__qr">
              <img src={qrDataUrl} alt={t("certificates.ariaQr")} />
            </div>
          ) : (
            <div className="libre-cert-ticket__qr libre-cert-ticket__qr--loading" />
          )}
          <button
            type="button"
            className="libre-cert-ticket__download"
            onClick={handleDownload}
            disabled={downloading}
            aria-label={t("certificates.ariaDownload")}
          >
            <Icon icon={downloadIcon} size="xs" color="currentColor" />
            {downloading ? t("certificates.downloading") : t("certificates.downloadPng")}
          </button>
          <div className="libre-cert-ticket__stub-id">
            {t("certificates.idPrefix", { id: cert.id.slice(0, 12) })}
          </div>
        </section>
      </article>
    </div>
  );
}
