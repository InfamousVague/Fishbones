/// Full-screen preview of a single certificate with a "Download
/// as PNG" action. The on-screen preview is a CSS rendering of the
/// same layout the PNG generator paints to canvas — kept close
/// enough that the user gets a true WYSIWYG before they download.

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { download as downloadIcon } from "@base/primitives/icon/icons/download";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import ModalBackdrop from "../Shared/ModalBackdrop";
import type { Certificate } from "../../data/certificates";
import { buildVerifyUrl } from "../../data/certificates";
import { downloadCertificatePng } from "./generateCertificatePng";
import { playSound } from "../../lib/sfx";
import { fireHaptic } from "../../lib/haptics";
import { useT } from "../../i18n/i18n";
import "./CertificateModal.css";

interface Props {
  cert: Certificate;
  onDismiss: () => void;
}

export default function CertificateModal({ cert, onDismiss }: Props) {
  const t = useT();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The certificate is the app's hero artefact — opening it lands
  // with the official rubber-stamp cue + a weightier haptic than
  // ModalBackdrop's generic light tap. Mount-only; the haptic
  // engine collapses the overlap with the backdrop's own cue.
  useEffect(() => {
    playSound("stamp");
    void fireHaptic("completion");
  }, []);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadCertificatePng(cert);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }, [cert]);

  const issued = new Date(cert.issuedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <ModalBackdrop onDismiss={onDismiss} zIndex={200}>
      <div className="libre-cert-modal" role="dialog" aria-labelledby="libre-cert-title">
        <button
          type="button"
          className="libre-cert-modal__close"
          aria-label={t("certificates.ariaClose")}
          onClick={onDismiss}
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>

        {/* The on-screen preview. Mirrors the canvas-painted PNG
            layout closely enough that the user knows what'll land
            in their downloads folder. Sized to fit a typical
            modal viewport — the printed PNG is 1600×1200, this
            preview just scales the same composition down. */}
        <div className="libre-cert-card">
          <div className="libre-cert-card__inner">
            <div className="libre-cert-card__brand">
              <div className="libre-cert-card__wordmark">LIBRE.ACADEMY</div>
              <div className="libre-cert-card__tagline">
                {t("certificates.tagline")}
              </div>
              <div className="libre-cert-card__divider" />
            </div>

            <h2 id="libre-cert-title" className="libre-cert-card__title">
              {t("certificates.titleUpper")}
            </h2>

            <div className="libre-cert-card__presented">
              {t("certificates.presentedTo")}
            </div>
            <div className="libre-cert-card__recipient">
              {cert.recipientName}
            </div>
            <div className="libre-cert-card__recipient-underline" />

            <div className="libre-cert-card__for">
              {t("certificates.forSuccessfulCompletion")}
            </div>
            <div className="libre-cert-card__course">{cert.courseTitle}</div>

            <div className="libre-cert-card__stats">
              {cert.lessonCount === 1
                ? t("certificates.lessonsCompletedXp", { count: cert.lessonCount, xp: cert.xpEarned.toLocaleString() })
                : t("certificates.lessonsCompletedXpPlural", { count: cert.lessonCount, xp: cert.xpEarned.toLocaleString() })}
            </div>
            {cert.courseLanguage && (
              <div className="libre-cert-card__lang">
                {cert.courseLanguage.toUpperCase()}
              </div>
            )}

            <div className="libre-cert-card__footer">
              <div className="libre-cert-card__footer-left">
                <div className="libre-cert-card__date">{issued}</div>
                <div className="libre-cert-card__date-label">{t("certificates.dateOfIssue")}</div>
                <div className="libre-cert-card__issuer">
                  {t("certificates.issuedByLibre")}
                </div>
                <div className="libre-cert-card__certid">
                  {t("certificates.certificateIdPrefix", { id: cert.id.slice(0, 16) })}
                </div>
              </div>
              <div className="libre-cert-card__footer-right">
                {/* QR code stub — on-screen we render a placeholder
                    box with the verify URL text underneath so the
                    user knows what'll be in the PNG. The real QR
                    only generates on download (the qrcode lib is
                    only imported by the PNG generator). */}
                <div className="libre-cert-card__qr-placeholder" aria-hidden>
                  ▢
                </div>
                <div className="libre-cert-card__qr-caption">{t("certificates.scanToVerifyCaption")}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="libre-cert-modal__actions">
          <button
            type="button"
            className="libre-cert-modal__download"
            onClick={handleDownload}
            disabled={downloading}
          >
            <Icon icon={downloadIcon} size="xs" color="currentColor" />
            {downloading ? t("certificates.downloadingFull") : t("certificates.downloadAsPng")}
          </button>
          <div className="libre-cert-modal__verify-hint">
            {buildVerifyUrl(cert)}
          </div>
        </div>

        {error && (
          <div className="libre-cert-modal__error" role="alert">
            {t("certificates.modalError", { error })}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
