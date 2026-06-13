/// App-level status toast — bottom-center pill for one-shot
/// success / failure feedback on actions that otherwise complete
/// invisibly (course reinstall, sync, …). Visual treatment mirrors
/// the import-progress pill in ArchiveDropOverlay so the two read
/// as the same notification chrome.
///
/// Deliberately single-slot (one toast at a time, latest wins)
/// rather than a queue — the app surfaces at most one of these per
/// user action, and a queue invites notification buildup.

import { useEffect, useRef } from "react";
import { Icon } from "@base/primitives/icon";
import { checkCircle } from "@base/primitives/icon/icons/check-circle";
import { alertTriangle } from "@base/primitives/icon/icons/alert-triangle";
import "./AppToast.css";

export interface AppToastData {
  message: string;
  tone: "success" | "error";
}

interface Props {
  toast: AppToastData | null;
  onDismiss: () => void;
}

export default function AppToast({ toast, onDismiss }: Props) {
  // Keep the latest onDismiss in a ref so the auto-dismiss timer
  // keys off the toast alone — App passes an inline closure, and
  // re-arming the timer on every parent render would keep the
  // toast alive indefinitely while the user types.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!toast) return;
    // Errors linger longer — the user needs time to read the why.
    const ms = toast.tone === "error" ? 7000 : 3500;
    const id = window.setTimeout(() => dismissRef.current(), ms);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      className={`libre-app-toast libre-app-toast--${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      onClick={onDismiss}
      title="Dismiss"
    >
      <span className="libre-app-toast__icon" aria-hidden>
        <Icon
          icon={toast.tone === "error" ? alertTriangle : checkCircle}
          size="sm"
          color="currentColor"
        />
      </span>
      <span className="libre-app-toast__label">{toast.message}</span>
    </div>
  );
}
