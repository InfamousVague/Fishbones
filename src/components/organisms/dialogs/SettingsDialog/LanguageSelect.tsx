/// Searchable, scrollable language picker for Settings → General.
///
/// Replaces the old top-bar / rail `LanguageDropdown` menu, which was
/// a plain popover that couldn't cope with 17 locales: the list ran
/// off-screen with no scroll and no way to find a language without
/// eyeballing the whole thing.
///
/// This picker is:
///   - Searchable — the filter input matches against the endonym
///     (LOCALE_NAMES, e.g. "Español"), the English name
///     (LOCALE_ENGLISH_NAMES, e.g. "Spanish") and the locale code
///     ("es"), so a learner can find their language however they think
///     of it.
///   - Scrollable — the option list is a bounded `max-height` box with
///     `overflow-y: auto`, so it never runs off-screen no matter how
///     many locales are registered.
///   - Keyboard-navigable — ↑/↓ move the active row, Enter selects,
///     Home/End jump to the ends. The active row scrolls into view.
///   - Legible — each row shows flag + endonym + English name; the
///     currently-selected locale is highlighted with a check.
///
/// Data comes straight from `@/data/locales` (SUPPORTED_LOCALES +
/// the three label maps), so adding a locale there lights it up here
/// with no change to this file.

import { useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { search as searchIcon } from "@base/primitives/icon/icons/search";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import {
  LOCALE_FLAGS,
  LOCALE_NAMES,
  LOCALE_ENGLISH_NAMES,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/data/locales";
import { useLocale } from "@/hooks/useLocale";
import { useT } from "@/i18n/i18n";
import { track } from "@/lib/track";
import "./LanguageSelect.css";

/// Case/diacritic-insensitive-ish normaliser for matching. We lower-
/// case and strip combining marks so "Español" matches a typed
/// "espanol" and "日本語" matches by code. Endonyms in non-Latin
/// scripts still match on their own script + the English name + code.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function localeMatches(locale: Locale, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return (
    normalize(LOCALE_NAMES[locale]).includes(q) ||
    normalize(LOCALE_ENGLISH_NAMES[locale]).includes(q) ||
    locale.toLowerCase().includes(q)
  );
}

export default function LanguageSelect() {
  const [locale, setLocale] = useLocale();
  const t = useT();
  const [query, setQuery] = useState("");
  // Which row the keyboard has "focused" for Enter-to-select. Index
  // into the FILTERED list. Reset toward 0 whenever the filter changes
  // (via the useMemo below clamping it).
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(
    () => SUPPORTED_LOCALES.filter((l) => localeMatches(l, query)),
    [query],
  );

  // Keep the active index in range as the filtered list shrinks/grows.
  const clampedActive = Math.min(
    activeIndex,
    Math.max(0, filtered.length - 1),
  );

  const pick = (next: Locale) => {
    setLocale(next);
    track.settingChange({ key: "locale", value: next });
  };

  const scrollRowIntoView = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    const row = list.children[index] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = Math.min(clampedActive + 1, filtered.length - 1);
        setActiveIndex(next);
        scrollRowIntoView(next);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const next = Math.max(clampedActive - 1, 0);
        setActiveIndex(next);
        scrollRowIntoView(next);
        break;
      }
      case "Home": {
        e.preventDefault();
        setActiveIndex(0);
        scrollRowIntoView(0);
        break;
      }
      case "End": {
        e.preventDefault();
        const last = filtered.length - 1;
        setActiveIndex(last);
        scrollRowIntoView(last);
        break;
      }
      case "Enter": {
        e.preventDefault();
        const target = filtered[clampedActive];
        if (target) pick(target);
        break;
      }
    }
  };

  return (
    <div className="libre-langselect">
      <label className="libre-langselect__search">
        <span className="libre-langselect__search-icon" aria-hidden>
          <Icon icon={searchIcon} size="sm" color="currentColor" />
        </span>
        <input
          type="text"
          className="libre-langselect__search-input"
          placeholder={t("settings.languageSearchPlaceholder")}
          aria-label={t("settings.languageSearch")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {filtered.length === 0 ? (
        <div className="libre-langselect__empty">
          {t("settings.languageNoResults", { query: query.trim() })}
        </div>
      ) : (
        <ul
          ref={listRef}
          className="libre-langselect__list"
          role="listbox"
          aria-label={t("settings.language")}
        >
          {filtered.map((l, i) => {
            const active = l === locale;
            const focused = i === clampedActive;
            return (
              <li key={l}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={
                    "libre-langselect__option" +
                    (active ? " libre-langselect__option--active" : "") +
                    (focused ? " libre-langselect__option--focused" : "")
                  }
                  onClick={() => pick(l)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="libre-langselect__flag" aria-hidden>
                    {LOCALE_FLAGS[l]}
                  </span>
                  <span className="libre-langselect__names">
                    <span className="libre-langselect__endonym">
                      {LOCALE_NAMES[l]}
                    </span>
                    <span className="libre-langselect__english">
                      {LOCALE_ENGLISH_NAMES[l]}
                    </span>
                  </span>
                  {active && (
                    <span className="libre-langselect__check" aria-hidden>
                      <Icon icon={checkIcon} size="sm" color="currentColor" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
