import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { useT } from "@/i18n/i18n";
import "./ConfirmDialog.css";

interface Props {
  title: string;
  /// Body text. Short paragraph explaining what will happen. Multi-line
  /// strings are rendered as-is; use `<br/>` in a node if you need markup.
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /// When true, the confirm button gets the red destructive treatment.
  /// Use for deletes, irrecoverable data loss, etc.
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/// App-styled confirmation modal. Replaces window.confirm() so we get
/// consistent theming + better UX. Backdrop, blur, escape-to-cancel,
/// and click-outside-to-cancel come from the shared `<ModalBackdrop>`.
/// Autofocus stays on the cancel button so the "safe" path is the
/// default Enter target.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  const resolvedConfirm = confirmLabel ?? t("common.ok");
  const resolvedCancel = cancelLabel ?? t("common.cancel");
  return (
    <ModalBackdrop onDismiss={onCancel} zIndex={200}>
      <div
        className="libre-confirm-panel"
        role="alertdialog"
        aria-labelledby="libre-confirm-title"
        aria-describedby="libre-confirm-message"
      >
        <div className="libre-confirm-title" id="libre-confirm-title">
          {title}
        </div>
        <div className="libre-confirm-message" id="libre-confirm-message">
          {message}
        </div>
        <div className="libre-confirm-actions">
          <button
            type="button"
            className="libre-confirm-btn libre-confirm-btn--cancel"
            onClick={onCancel}
            autoFocus
          >
            {resolvedCancel}
          </button>
          <button
            type="button"
            className={`libre-confirm-btn ${
              danger ? "libre-confirm-btn--danger" : "libre-confirm-btn--primary"
            }`}
            onClick={onConfirm}
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
