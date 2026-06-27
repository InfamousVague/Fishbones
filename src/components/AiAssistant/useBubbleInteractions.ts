/// Click delegation for assistant message bubbles, shared by the
/// chat AND agent panels (so behaviour can't drift between them).
/// Attach to the scroller element that contains the rendered bubbles.
///
/// Handles three click targets (bubble-phase delegated listener;
/// `preventDefault()` cancels the browser's default action — including
/// a <summary>'s collapse-toggle when a copy button lives inside it):
///   1. `libre://` deep links → in-app navigation CustomEvents
///      (the host App / TrayPanel listens and opens the lesson/course).
///   2. Any other absolute URL → the OS default browser (never let the
///      WebView navigate away from the app and trap the user).
///   3. `.libre-chat-code-copy[data-copy]` buttons → copy the code
///      block's source (base64-encoded by the renderer) to the
///      clipboard, with brief "Copied" feedback.

import { useEffect, type RefObject } from "react";
import { decodeB64 } from "./chatMarkdown";

export function useBubbleInteractions(
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onClick = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target) return;

      // Copy button (delegated). preventDefault + stopPropagation so
      // a copy button living inside a <summary> doesn't also toggle
      // the <details> collapse.
      const copyBtn = target.closest(
        ".libre-chat-code-copy",
      ) as HTMLElement | null;
      if (copyBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const b64 = copyBtn.getAttribute("data-copy") ?? "";
        const code = decodeB64(b64);
        void copyText(code, copyBtn);
        return;
      }

      // Link handling — walk up to the nearest <a>.
      let node: Element | null = target;
      while (node && node.tagName !== "A") node = node.parentElement;
      if (!node) return;
      const href = (node as HTMLAnchorElement).getAttribute("href") ?? "";

      if (href.startsWith("libre://")) {
        ev.preventDefault();
        const courseMatch = href.match(/^libre:\/\/course\/([^/?#]+)/);
        if (courseMatch) {
          window.dispatchEvent(
            new CustomEvent("libre:open-course", {
              detail: { courseId: courseMatch[1] },
            }),
          );
          return;
        }
        const lessonMatch = href.match(/^libre:\/\/lesson\/([^/?#]+)\/([^/?#]+)/);
        if (lessonMatch) {
          window.dispatchEvent(
            new CustomEvent("libre:open-lesson", {
              detail: { courseId: lessonMatch[1], lessonId: lessonMatch[2] },
            }),
          );
        }
        return;
      }

      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        return;
      }
      const isExternal =
        /^[a-z][a-z0-9+.-]*:\/\//i.test(href) || href.startsWith("mailto:");
      if (!isExternal) return;
      ev.preventDefault();
      void (async () => {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(href);
        } catch {
          window.open(href, "_blank", "noopener,noreferrer");
        }
      })();
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [ref]);
}

async function copyText(text: string, btn: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (rare in the WebView) — fall back to
    // a hidden textarea + execCommand.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      return;
    }
  }
  const prev = btn.textContent;
  btn.textContent = "Copied";
  btn.classList.add("is-copied");
  window.setTimeout(() => {
    btn.textContent = prev;
    btn.classList.remove("is-copied");
  }, 1200);
}
