import { useCallback, useEffect, useRef, useState } from "react";

/// Copy text to the clipboard with transient "copied!" feedback. Returns
/// `{ copied, copy }` — `copied` flips true for `resetMs` (default 1500) after
/// a successful copy, then back to false. The reset timer lives in a ref and
/// is cleared on unmount, so the `setTimeout` leak the inline copies risked
/// (TipDropdown, OutputPane, VerifyCourseOverlay, AiPane, CourseSettingsModal)
/// can't happen.
///
/// Falls back to a hidden-textarea + execCommand where the async Clipboard
/// API is unavailable (older WKWebView, insecure origins).
export function useCopyToClipboard({ resetMs = 1500 }: { resetMs?: number } = {}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        }
      } catch {
        ok = false;
      }
      if (ok) {
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      }
      return ok;
    },
    [resetMs],
  );

  return { copied, copy };
}
