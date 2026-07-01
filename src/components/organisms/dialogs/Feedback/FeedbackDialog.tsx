import { useState } from "react";
import { SegmentedControl } from "@base/primitives/segmented-control";
import "@base/primitives/segmented-control/segmented-control.css";
import { isWeb, detectOS } from "@/lib/platform";
import { useT } from "@/i18n/i18n";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import "./FeedbackDialog.css";

/// In-app feedback / bug-report / feature-request modal.
///
/// Posts to the relay's `POST /feedback`, which forwards each
/// submission to a Notion database with a SERVER-SIDE integration
/// token (see api/src/routes/feedback.rs). The token never reaches the
/// client — this dialog only needs the relay base URL.
///
/// Deliberately tiny: a type toggle (bug / feature / feedback), a
/// message, and an optional email for a reply. App version + platform
/// are attached automatically so a bug report carries the context we'd
/// otherwise have to ask for.

type Kind = "bug" | "feature" | "feedback";
type Status = "idle" | "sending" | "sent" | "error";

interface Props {
  /// Relay base URL (e.g. https://api.libre.academy). Passed in from
  /// the cloud hook so this dialog stays decoupled from it — it only
  /// needs the URL, not the whole sync surface.
  relayUrl: string;
  onClose: () => void;
}

/// App version — desktop only. The web build has no Tauri runtime, so
/// resolve it lazily and tolerate the dynamic import failing.
async function readAppVersion(): Promise<string | undefined> {
  if (isWeb) return undefined;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return undefined;
  }
}

export default function FeedbackDialog({ relayUrl, onClose }: Props) {
  const t = useT();
  const [kind, setKind] = useState<Kind>("feedback");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  // Honeypot — visually hidden + off the tab order. Real users never
  // fill it; bots that populate every field trip it and the backend
  // silently drops the submission.
  const [hp, setHp] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const empty = message.trim().length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending" || empty) {
      if (empty) setStatus("error");
      return;
    }
    setStatus("sending");
    try {
      const appVersion = await readAppVersion();
      // "Web" on the web build; the OS slug on desktop (the backend
      // normalises "macos" → "macOS" etc.).
      const platform = isWeb ? "Web" : detectOS();
      const res = await fetch(`${relayUrl}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          email: email.trim() || undefined,
          app_version: appVersion,
          platform,
          hp: hp || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  const KIND_OPTIONS = [
    { value: "bug", label: t("feedback.typeBug") },
    { value: "feature", label: t("feedback.typeFeature") },
    { value: "feedback", label: t("feedback.typeFeedback") },
  ];
  const placeholderKey =
    kind === "bug"
      ? "feedback.placeholderBug"
      : kind === "feature"
        ? "feedback.placeholderFeature"
        : "feedback.placeholderFeedback";

  return (
    <ModalBackdrop onDismiss={onClose} zIndex={200}>
      <div
        className="libre-feedback-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-feedback-title"
      >
        <button
          type="button"
          className="libre-feedback-close"
          onClick={onClose}
          aria-label={t("feedback.close")}
        >
          ×
        </button>

        {status === "sent" ? (
          <div className="libre-feedback-done">
            <div className="libre-feedback-done__mark" aria-hidden>
              ✓
            </div>
            <h2 className="libre-feedback-title">{t("feedback.sentTitle")}</h2>
            <p className="libre-feedback-blurb">{t("feedback.sentBody")}</p>
            <button
              type="button"
              className="libre-feedback-primary"
              onClick={onClose}
            >
              {t("feedback.close")}
            </button>
          </div>
        ) : (
          <form className="libre-feedback-form" onSubmit={submit}>
            <h2 className="libre-feedback-title" id="libre-feedback-title">
              {t("feedback.title")}
            </h2>
            <p className="libre-feedback-blurb">{t("feedback.blurb")}</p>

            <SegmentedControl
              className="libre-feedback-kinds"
              size="lg"
              ariaLabel={t("feedback.typeLabel")}
              value={kind}
              onChange={(v) => setKind(v as Kind)}
              options={KIND_OPTIONS}
            />

            <label className="libre-feedback-field">
              <span>{t("feedback.messageLabel")}</span>
              <textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (status === "error") setStatus("idle");
                }}
                placeholder={t(placeholderKey)}
                rows={5}
                maxLength={5000}
                required
                autoFocus
              />
            </label>

            <label className="libre-feedback-field">
              <span>{t("feedback.emailLabel")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("feedback.emailPlaceholder")}
                autoComplete="email"
              />
              <small className="libre-feedback-hint">
                {t("feedback.emailHint")}
              </small>
            </label>

            {/* Honeypot — off-screen + tabIndex -1 so real users never
                see or reach it. */}
            <div className="libre-feedback-hp" aria-hidden="true">
              <label>
                Company
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                />
              </label>
            </div>

            {status === "error" && (
              <p className="libre-feedback-error" role="alert">
                {empty
                  ? t("feedback.emptyError")
                  : t("feedback.errorGeneric")}
              </p>
            )}

            <button
              type="submit"
              className="libre-feedback-primary"
              disabled={status === "sending" || empty}
            >
              {status === "sending"
                ? t("feedback.sending")
                : t("feedback.send")}
            </button>
          </form>
        )}
      </div>
    </ModalBackdrop>
  );
}
