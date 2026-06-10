/// Floating Docs window plumbing — same WebviewWindow/window.open
/// dual-path pattern as the phone popout (lib/phonePopout.ts), plus
/// cursor-relative placement: the window opens next to wherever the
/// user clicked the Docs button instead of at the OS default spot.
///
/// Single-instance: a second open call focuses the existing window
/// and tells it (via BroadcastChannel) to switch booklets, rather
/// than stacking duplicate docs windows.

import { bookletForLanguage } from "../data/docsBooklets";

const LABEL = "libre-docs";

/// Channel the opener uses to re-target an already-open docs window.
/// The DocsPopoutView listens; payload is `{ bookletId }`.
export const DOCS_NAV_CHANNEL = "libre-docs-nav";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenDocsOptions {
  /// Lesson language — resolves which booklet opens first.
  language?: string;
  /// Screen coordinates of the triggering click (MouseEvent.screenX/Y).
  /// Logical pixels on macOS, which is exactly what Tauri's window
  /// `x`/`y` options take — so the window lands beside the cursor.
  screenX?: number;
  screenY?: number;
}

export async function openDocsWindow(opts: OpenDocsOptions = {}): Promise<void> {
  const booklet = bookletForLanguage(opts.language);

  const base = new URL(window.location.href);
  // Strip sibling popout params so the docs window doesn't inherit a
  // workbench/phone identity from whatever surface launched it.
  for (const k of ["popped", "phone", "scope", "course", "lesson", "files"]) {
    base.searchParams.delete(k);
  }
  base.searchParams.set("docs", "1");
  base.searchParams.set("booklet", booklet.id);
  const url = base.toString();

  // Land the top-left corner a touch below-right of the cursor so
  // the click point stays visible. Fall back to a sane offset when
  // no coordinates were provided (keyboard activation).
  const x = Math.max(0, Math.round((opts.screenX ?? 240) + 16));
  const y = Math.max(0, Math.round((opts.screenY ?? 160) - 12));

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel(LABEL);
      if (existing) {
        await existing.setFocus();
        // Re-target the already-open window onto this booklet.
        new BroadcastChannel(DOCS_NAV_CHANNEL).postMessage({
          bookletId: booklet.id,
        });
        return;
      }
      new WebviewWindow(LABEL, {
        url,
        title: "Libre · Docs",
        width: 960,
        height: 680,
        minWidth: 540,
        minHeight: 400,
        resizable: true,
        x,
        y,
      });
      return;
    } catch (e) {
      console.warn(
        "[libre] Tauri WebviewWindow failed for docs popout, falling back to window.open:",
        e,
      );
    }
  }

  window.open(url, LABEL, `width=960,height=680,left=${x},top=${y}`);
}
