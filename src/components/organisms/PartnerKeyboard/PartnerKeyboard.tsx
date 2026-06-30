/// On-screen coding-symbol strip that pins above the mobile system
/// keyboard, so phone users can type code without dropping into
/// blocks-mode.
///
/// Ported from `prototypes/partner-keyboard/index.html` — the design
/// rationale + the iOS Safari positioning tricks live in the
/// prototype's top-of-script comment. Quick summary of what makes
/// this work:
///
///   1. `visualViewport` math + the `interactive-widget=resizes-
///      content` meta directive in index.html together ensure the
///      strip pins to the keyboard's top edge with no scroll-lag.
///   2. `pointerdown.preventDefault()` on every key keeps focus on
///      the target textarea so the soft keyboard stays up.
///   3. Insertion via `textarea.setRangeText()` preserves the
///      native undo stack (swipe-down-to-undo still works after
///      a strip insert).
///   4. iOS Safari draws a form-accessory bar (~44 pt) above the
///      system keyboard that no web API can hide. We shim the strip
///      down 44 px so its bottom edge meets the bar's top edge —
///      no empty gap. In the Tauri WKWebView build we'll disable
///      the bar via Swift and the shim becomes a no-op.
///
/// Portal-rendered into `document.body` so the strip escapes
/// whatever layout container the editor sits in and pins reliably
/// to the visual viewport's bottom.

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import "./PartnerKeyboard.css";

/// One entry in a category row.
///   - string → insert that string at cursor; key label = the string
///   - { label, insert, after? } → labelled snippet. `after` makes it
///     a paired insertion: both halves write, caret lands between
///     (or surrounds a current selection)
///   - { label, action } → a custom cursor / editing action (arrow
///     keys, line-start, delete-word, etc.)
export type KeyDef =
  | string
  | { label: string; insert: string; after?: string }
  | { label: string; action: CursorAction };

export type CursorAction =
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  | "line-start"
  | "line-end"
  | "delete-word"
  | "select-line";

interface Props {
  /// Textarea the strip drives. Focus on this element is the
  /// signal to show the strip; insertions target this element's
  /// `selectionStart` / `selectionEnd`.
  targetRef: RefObject<HTMLTextAreaElement | null>;
  /// Category id → key list. Override to provide language-specific
  /// rows. Defaults to the generic JS-flavoured set from the
  /// prototype.
  categories?: Record<string, KeyDef[]>;
  /// Category to show on first mount. Must be a key in `categories`.
  /// Defaults to "symbols".
  defaultCategory?: string;
}

// Default category set. Identical to the prototype's CATEGORIES
// object — when we want language-specific rows we'll pass a
// custom map via the `categories` prop instead of mutating this.
const DEFAULT_CATEGORIES: Record<string, KeyDef[]> = {
  symbols: [
    "(", ")", "[", "]", "{", "}", "<", ">",
    ";", ":", ",", ".", "?", "!", "@", "#", "$",
    '"', "'", "`", "\\", "/", "|", "&", "*", "_",
    "+", "-", "=", "^", "~", "%",
  ],
  pairs: [
    { label: "()", insert: "(", after: ")" },
    { label: "[]", insert: "[", after: "]" },
    { label: "{}", insert: "{", after: "}" },
    { label: "<>", insert: "<", after: ">" },
    { label: '""', insert: '"', after: '"' },
    { label: "''", insert: "'", after: "'" },
    { label: "``", insert: "`", after: "`" },
    { label: "/* */", insert: "/* ", after: " */" },
    { label: "<!-- -->", insert: "<!-- ", after: " -->" },
  ],
  operators: [
    "=", "==", "===", "!=", "!==",
    "+=", "-=", "*=", "/=",
    "+", "-", "*", "/", "%", "**",
    "&&", "||", "??", "!",
    "<", ">", "<=", ">=",
    "++", "--",
    "<<", ">>", "&", "|", "^", "~",
    "?:",
  ],
  js: [
    { label: "=>", insert: " => " },
    { label: "const", insert: "const " },
    { label: "let", insert: "let " },
    { label: "var", insert: "var " },
    { label: "function", insert: "function " },
    { label: "return", insert: "return " },
    { label: "if", insert: "if (", after: ") {\n  \n}" },
    { label: "else", insert: " else " },
    { label: "for", insert: "for (let i = 0; i < ", after: "; i++) {\n  \n}" },
    { label: "while", insert: "while (", after: ") {\n  \n}" },
    { label: "log()", insert: "console.log(", after: ")" },
    { label: ".length", insert: ".length" },
    { label: ".map(", insert: ".map((x) => ", after: ")" },
    { label: ".filter(", insert: ".filter((x) => ", after: ")" },
    { label: ".forEach(", insert: ".forEach((x) => ", after: ")" },
    { label: ".reduce(", insert: ".reduce((acc, x) => ", after: ", null)" },
    { label: "try", insert: "try {\n  ", after: "\n} catch (e) {\n  \n}" },
    { label: "async", insert: "async " },
    { label: "await", insert: "await " },
  ],
  cursor: [
    { label: "tab", insert: "  " },
    { label: "↩", insert: "\n" },
    { label: "←", action: "arrow-left" },
    { label: "↑", action: "arrow-up" },
    { label: "↓", action: "arrow-down" },
    { label: "→", action: "arrow-right" },
    { label: "⤒", action: "line-start" },
    { label: "⤓", action: "line-end" },
    { label: "⌫ word", action: "delete-word" },
    { label: "sel-line", action: "select-line" },
  ],
};

/// User-agent based iOS detection. Conservative enough to avoid
/// false positives on M-series macs (which expose `MacIntel` +
/// touch points like iPads). The accessory-bar shim only applies
/// when this is true.
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/// Approximate height of the iOS form accessory bar in CSS pixels.
/// 44 pt on iPhone; iPad varies slightly but 44 is close enough that
/// the visual flush works on both.
const IOS_ACCESSORY_BAR_PX = 44;

export default function PartnerKeyboard({
  targetRef,
  categories = DEFAULT_CATEGORIES,
  defaultCategory = "symbols",
}: Props) {
  const pkRef = useRef<HTMLDivElement | null>(null);
  const activeCategoryRef = useRef<string>(defaultCategory);

  // ───────────────────────────────────────────────────────────
  // Mount: build the strip into the portal target on focus, tear
  // it down on blur. We can't render-render the keys via React
  // because the no-focus-loss trick (`pointerdown.preventDefault`)
  // requires native event handlers; React's synthetic system fires
  // AFTER the default action, so by the time onClick runs the
  // textarea has already blurred.
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    const target = targetRef.current;
    const pk = pkRef.current;
    if (!target || !pk) return;

    const tabsEl = pk.querySelector(".libre-pk__tabs") as HTMLDivElement;
    const rowEl = pk.querySelector(".libre-pk__row") as HTMLDivElement;
    if (!tabsEl || !rowEl) return;

    // pointerdown / mousedown / touchstart preventDefault is what
    // keeps the soft keyboard from dismissing when a strip key is
    // tapped. Attached via vanilla addEventListener so the
    // `preventDefault` actually beats the browser's default focus-
    // transfer behaviour (React's synthetic events fire too late).
    const preventBlur = (el: HTMLElement) => {
      const stop = (e: Event) => e.preventDefault();
      el.addEventListener("pointerdown", stop);
      el.addEventListener("mousedown", stop);
      el.addEventListener("touchstart", stop, { passive: false });
    };

    // Single insertion point — same setRangeText flow as the
    // prototype. `before` lands at the cursor; `after` (optional)
    // lands AFTER, with the caret left between them (or with the
    // existing selection wrapped if one was active).
    const insertAtCursor = (before: string, after = "") => {
      target.focus();
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const hadSelection = start !== end;
      const selected = target.value.slice(start, end);
      if (after) {
        target.setRangeText(before + selected + after, start, end, "preserve");
        const caret = hadSelection
          ? start + before.length + selected.length
          : start + before.length;
        target.setSelectionRange(caret, caret);
      } else {
        target.setRangeText(before, start, end, "end");
      }
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };

    // Custom cursor / editing actions. textareas don't expose a
    // command palette so we compute new caret positions via
    // selectionStart / End math against the live value.
    const runAction = (name: CursorAction) => {
      target.focus();
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      if (name === "arrow-left") {
        const p = Math.max(0, start - 1);
        target.setSelectionRange(p, p);
      } else if (name === "arrow-right") {
        const p = Math.min(value.length, end + 1);
        target.setSelectionRange(p, p);
      } else if (name === "arrow-up" || name === "arrow-down") {
        const lines = value.split("\n");
        let offset = 0;
        let lineIdx = 0;
        let col = 0;
        for (let i = 0; i < lines.length; i++) {
          const len = lines[i].length + 1;
          if (offset + len > start) {
            lineIdx = i;
            col = start - offset;
            break;
          }
          offset += len;
        }
        const tIdx = name === "arrow-up" ? lineIdx - 1 : lineIdx + 1;
        if (tIdx < 0 || tIdx >= lines.length) return;
        let off = 0;
        for (let i = 0; i < tIdx; i++) off += lines[i].length + 1;
        const newCol = Math.min(col, lines[tIdx].length);
        const p = off + newCol;
        target.setSelectionRange(p, p);
      } else if (name === "line-start") {
        const ls = value.lastIndexOf("\n", start - 1) + 1;
        target.setSelectionRange(ls, ls);
      } else if (name === "line-end") {
        let le = value.indexOf("\n", end);
        if (le === -1) le = value.length;
        target.setSelectionRange(le, le);
      } else if (name === "delete-word") {
        if (start !== end) {
          target.setRangeText("", start, end, "start");
        } else {
          const tail = value.slice(0, start);
          const match = tail.match(/[\s\W]*\w+[\s\W]*$|\W+$|\s+$/);
          const cut = match ? match[0].length : 1;
          target.setRangeText("", start - cut, start, "start");
        }
        target.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (name === "select-line") {
        const ls = value.lastIndexOf("\n", start - 1) + 1;
        let le = value.indexOf("\n", end);
        if (le === -1) le = value.length;
        target.setSelectionRange(ls, le);
      }
    };

    const renderTabs = () => {
      tabsEl.innerHTML = "";
      for (const cat of Object.keys(categories)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "libre-pk__tab" + (cat === activeCategoryRef.current ? " libre-pk__tab--active" : "");
        btn.textContent = cat;
        preventBlur(btn);
        btn.addEventListener("click", () => {
          activeCategoryRef.current = cat;
          renderTabs();
          renderRow();
        });
        tabsEl.appendChild(btn);
      }
    };

    const renderRow = () => {
      rowEl.innerHTML = "";
      const items = categories[activeCategoryRef.current] ?? [];
      for (const item of items) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "libre-pk__key";
        if (typeof item === "string") {
          key.textContent = item;
          preventBlur(key);
          key.addEventListener("click", () => insertAtCursor(item));
        } else if ("action" in item) {
          key.textContent = item.label;
          key.className += " libre-pk__key--mod";
          if (item.label.length > 2) key.className += " libre-pk__key--wide";
          preventBlur(key);
          key.addEventListener("click", () => runAction(item.action));
        } else {
          key.textContent = item.label;
          if (item.label.length > 2) key.className += " libre-pk__key--wide libre-pk__key--snippet";
          preventBlur(key);
          key.addEventListener("click", () =>
            insertAtCursor(item.insert, item.after ?? ""),
          );
        }
        rowEl.appendChild(key);
      }
    };

    // ─── Positioning ─────────────────────────────────────────
    // Shim is focus-driven so it works under both viewport modes:
    //   - Modern Safari with `interactive-widget=resizes-content`
    //     shrinks the layout viewport when the keyboard appears, so
    //     `inset = window.innerHeight − visualViewport.height`
    //     collapses to 0. `bottom: 0` then lands at the keyboard's
    //     top edge. To get visually flush with the iOS form
    //     accessory bar (the floating ↑↓✓ pill iOS draws above
    //     every focused input — see the screenshot in this commit
    //     message), the strip needs to dip DOWN into the bar's
    //     region so the bar paints on TOP of the strip's bottom
    //     edge. That requires a NEGATIVE bottom on the strip: −44 px
    //     (= − IOS_ACCESSORY_BAR_PX). The matching `padding-bottom`
    //     of 44 px on .libre-pk keeps the keys + tabs above the bar.
    //   - Older Safari without the directive: inset reports the
    //     keyboard's height (sometimes + the bar's 44 px). Same
    //     formula `inset − shim` lands the strip on the bar's top
    //     edge.
    //
    // The earlier `Math.max(0, ...)` clamp was the bug — it
    // prevented the negative bottom in the modern-Safari case, so
    // the strip stayed at `bottom: 0` above the accessory bar
    // instead of merging with it.
    const sync = () => {
      const focused = document.activeElement === target;
      const shim = IS_IOS && focused ? IOS_ACCESSORY_BAR_PX : 0;
      pk.style.setProperty("--libre-pk-shim", `${shim}px`);
      const vv = window.visualViewport;
      if (!vv) {
        pk.style.bottom = "0px";
        return;
      }
      const inset = window.innerHeight - (vv.height + vv.offsetTop);
      // Negative bottom is intentional in the modern-Safari case so
      // the strip's bottom region tucks behind the accessory bar.
      // Clamped only against unreasonably-large negative values
      // (e.g., a stale shim left in place after blur) so we can't
      // accidentally yank the strip miles off-screen.
      const next = inset - shim;
      pk.style.bottom = `${Math.max(-IOS_ACCESSORY_BAR_PX, next)}px`;
    };

    const onFocus = () => {
      pk.classList.add("libre-pk--active");
      sync();
      requestAnimationFrame(() => requestAnimationFrame(sync));
    };
    const onBlur = () => {
      // Grace window — a stray focus transfer to a non-key element
      // shouldn't dismiss the strip. With preventBlur in place this
      // shouldn't happen, but belt-and-suspenders against engine
      // quirks.
      setTimeout(() => {
        if (document.activeElement !== target) {
          pk.classList.remove("libre-pk--active");
          sync();
        }
      }, 120);
    };

    target.addEventListener("focus", onFocus);
    target.addEventListener("blur", onBlur);

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", sync);
      window.visualViewport.addEventListener("scroll", sync);
    }
    window.addEventListener("resize", sync);
    const onOrientation = () => requestAnimationFrame(sync);
    window.addEventListener("orientationchange", onOrientation);

    renderTabs();
    renderRow();
    sync();

    // If the textarea already had focus on mount (rare but
    // possible — React StrictMode can double-fire effects), show
    // the strip immediately.
    if (document.activeElement === target) onFocus();

    return () => {
      target.removeEventListener("focus", onFocus);
      target.removeEventListener("blur", onBlur);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", sync);
        window.visualViewport.removeEventListener("scroll", sync);
      }
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [targetRef, categories]);

  // The portal target. We render into document.body so the strip
  // escapes parent layouts (e.g., a clipped scrollable container)
  // and pins reliably to the visual viewport's bottom.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={pkRef}
      className="libre-pk"
      role="toolbar"
      aria-label="Coding symbols"
    >
      <div className="libre-pk__tabs" />
      <div className="libre-pk__row" />
    </div>,
    document.body,
  );
}
