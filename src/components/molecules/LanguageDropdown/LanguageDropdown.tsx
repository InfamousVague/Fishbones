/// Single-language picker: flag + endonym, click to open a menu of
/// supported locales. Used in the desktop Settings dialog (Theme rail)
/// + the mobile Settings page so the user can switch languages from
/// either form factor.
///
/// Uses the existing `useLocale` hook for state, so the picker
/// composes cleanly into any tree depth without additional plumbing
/// — open Settings, pick a language, close, and the lesson reader
/// the user returns to is already in the new locale.
///
/// Visual layout — inline lockup of:
///   [🇺🇸] [English]    [▾]
/// On click, the menu drops below with the same shape per row:
///   [🇺🇸] English          ✓   ← active
///   [🇷🇺] Русский
///   ...
///
/// Mobile note: menu uses a fixed-position overlay so it doesn't get
/// clipped by the safe-area inset on iOS. The desktop Settings rail
/// has its own scroll context; for that we use `position: absolute`
/// inside the trigger button wrapper.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@base/primitives/icon";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import "@base/primitives/icon/icon.css";
import {
  LOCALE_FLAGS,
  LOCALE_NAMES,
  LOCALE_ENGLISH_NAMES,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/data/locales";
import { useLocale } from "@/hooks/useLocale";
import "./LanguageDropdown.css";

/// One menu's measured screen position. `top`/`left` are viewport
/// coordinates so `position: fixed` on the portaled menu reads
/// them directly. `minWidth` keeps the menu at least as wide as
/// the trigger so the option labels line up under the trigger
/// label. `align` flips left/right anchoring for the compact
/// variant (which used to anchor right via CSS — now we do it in
/// JS because the portal layer doesn't share the trigger's
/// containing block).
interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
}

export interface LanguageDropdownProps {
  /// "field" (default) — full-width row that fits Settings rails:
  /// flag + label + chevron + dropdown opens directly under.
  /// "compact" — pill-shaped trigger meant for the desktop top bar
  /// or mobile header. Same dropdown shape, just narrower trigger.
  variant?: "field" | "compact";
  /// Optional class to layer extra positioning / theming. Applied to
  /// the wrapper, not the popover (the popover is portaled to body).
  className?: string;
  /// Restrict the menu to a subset of locales — e.g. the languages a
  /// specific book is available in. Defaults to every SUPPORTED_LOCALE
  /// (the app-wide picker). Values not in `SUPPORTED_LOCALES` are the
  /// caller's responsibility to keep valid.
  locales?: readonly Locale[];
  /// Controlled value + change handler. Provide BOTH to drive the picker
  /// from external state (e.g. a per-book reading locale) instead of the
  /// app-wide `useLocale` hook; omit both to fall back to the app locale.
  value?: Locale;
  onChange?: (next: Locale) => void;
}

export default function LanguageDropdown({
  variant = "field",
  className,
  locales,
  value,
  onChange,
}: LanguageDropdownProps) {
  // App-locale hook is always called (hooks can't be conditional); the
  // controlled `value`/`onChange` override it when supplied so the same
  // component serves both the global picker and the per-book one.
  const [appLocale, setAppLocale] = useLocale();
  const locale = value ?? appLocale;
  const setLocale = onChange ?? setAppLocale;
  const options = locales ?? SUPPORTED_LOCALES;
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  // Measured `position: fixed` coords for the portaled menu.
  // `null` until the menu opens + we measure the trigger; the
  // portaled `<ul>` doesn't render until we have real numbers
  // (otherwise it'd briefly paint at 0,0 in the top-left of
  // the viewport before the layout effect fires).
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  /// Measure the trigger and compute where the menu should sit.
  /// Called when the menu opens, on resize, and on scroll inside
  /// any ancestor (so scrolling the settings dialog's body
  /// doesn't detach the menu from the trigger). The menu LEFT-aligns
  /// under the trigger (both variants) so its options line up beneath
  /// the trigger label; it's only nudged left when it would otherwise
  /// spill off the right edge of the viewport. (The compact variant
  /// used to right-anchor for a top-bar trigger, but the only compact
  /// consumer is the lesson reader's per-book picker, which sits in the
  /// content column — right-anchoring pushed the menu left of its
  /// trigger.)
  const measure = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // Menu width upper bound from CSS — keep in sync with the
    // `max-width` on `.libre-langdrop__menu`. Used as the worst-case
    // width for the right-edge overflow check.
    const menuMaxWidth = 240;
    const minWidth = Math.max(rect.width, 0);
    const margin = 8;
    const menuWidth = Math.max(minWidth, menuMaxWidth);
    // Left edges aligned; shift left just enough to stay on-screen.
    let left = rect.left;
    const overflowRight = left + menuWidth - (window.innerWidth - margin);
    if (overflowRight > 0) left -= overflowRight;
    left = Math.max(margin, left);
    setMenuPos({
      top: rect.bottom + 6, // matches the previous `top: calc(100% + 6px)`
      left,
      minWidth,
    });
  };

  // Re-measure when the menu opens. `useLayoutEffect` so the
  // measurement happens after DOM commit but before paint —
  // otherwise we'd briefly paint the menu at a stale position
  // when reopening after a layout shift.
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    measure();
    // Re-measure on window resize + on scroll of any scrollable
    // ancestor. We listen to `scroll` at capture so it catches
    // every nested scroll container (the settings dialog body
    // is one such container — without capture we'd only see the
    // window scroll).
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
    // `variant` could change at runtime in theory (host swaps
    // the prop); re-measure if so. eslint-disable for `measure`
    // because it captures `variant` via closure — listing it
    // would also force-rerun on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant]);

  // Click-outside-to-close. Captures pointerdown so a synchronous
  // toggle on the trigger button doesn't immediately re-close the
  // menu we just opened. With the menu portaled to document.body
  // it's no longer inside `wrapperRef`, so we ALSO ignore clicks
  // inside the menu itself — otherwise picking an option would
  // race the click-outside handler.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) {
        setOpen(false);
        return;
      }
      if (wrapperRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <div
      ref={wrapperRef}
      className={
        "libre-langdrop" +
        (variant === "compact" ? " libre-langdrop--compact" : " libre-langdrop--field") +
        (className ? " " + className : "")
      }
    >
      <button
        ref={triggerRef}
        type="button"
        className="libre-langdrop__trigger"
        aria-label="Select language"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="libre-langdrop__flag" aria-hidden>
          {LOCALE_FLAGS[locale]}
        </span>
        <span className="libre-langdrop__label">{LOCALE_NAMES[locale]}</span>
        <span className="libre-langdrop__chevron" aria-hidden>
          <Icon icon={chevronDown} size="sm" color="currentColor" />
        </span>
      </button>
      {/* Menu renders into `document.body` so ancestor
          `overflow: hidden` containers (the SettingsCard's
          rounded-corner clip, the settings dialog's body
          scroll, any future card chrome that needs clipping)
          can't clip it. Coords come from `measure()` above;
          `menuPos` is null until the trigger has been measured,
          which avoids a one-frame flash at viewport (0, 0). */}
      {open &&
        menuPos &&
        createPortal(
          <ul
            ref={menuRef}
            className="libre-langdrop__menu libre-langdrop__menu--portaled"
            role="listbox"
            aria-label="Language"
            style={{
              position: "fixed",
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              minWidth: `${menuPos.minWidth}px`,
            }}
          >
            {options.map((l) => {
              const active = l === locale;
              return (
                <li key={l}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={
                      "libre-langdrop__option" +
                      (active ? " libre-langdrop__option--active" : "")
                    }
                    onClick={() => pick(l)}
                  >
                    <span className="libre-langdrop__flag" aria-hidden>
                      {LOCALE_FLAGS[l]}
                    </span>
                    {/* Endonym + muted English name, stacked — same
                        vocabulary as the Settings language picker so a
                        learner who can't read the endonym still finds
                        their language. */}
                    <span className="libre-langdrop__names">
                      <span className="libre-langdrop__label">
                        {LOCALE_NAMES[l]}
                      </span>
                      <span className="libre-langdrop__english">
                        {LOCALE_ENGLISH_NAMES[l]}
                      </span>
                    </span>
                    {active && (
                      <span className="libre-langdrop__check" aria-hidden>
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
