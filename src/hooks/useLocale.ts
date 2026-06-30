/// React hook for the user's preferred locale. Backed by:
///   - localStorage (synchronous, persists across launches)
///   - the cloud-sync `settings` channel when signed in (so a learner
///     who flips to Spanish on their iPad sees Spanish on their Mac)
///
/// First-launch heuristic: read `navigator.language` and pick the
/// closest supported locale (Russian browser → ru, Korean → kr, etc).
/// Falls back to English when the browser language has no Libre
/// translation. The user can override at any time via the dropdown.
///
/// Usage:
///   const [locale, setLocale] = useLocale();
///   const text = localizedLesson(lesson, locale);
///
/// Using anywhere — desktop, mobile, web embed — gets the same
/// preference. The hook is safe to call from any tree depth; the
/// underlying storage is the single source of truth.

import { useCallback, useEffect } from "react";
import {
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/data/locales";
import { useLocalStorageState } from "./useLocalStorageState";

/// Cached default so every call site in the same session returns the
/// same value. `detectLocale` reads `navigator.language` which can in
/// theory change mid-session (it can't, in practice), and pinning the
/// default keeps the hook's first-render output stable.
let cachedDefault: Locale | null = null;

function defaultLocale(): Locale {
  if (cachedDefault) return cachedDefault;
  cachedDefault = detectLocale();
  return cachedDefault;
}

export function useLocale(): readonly [Locale, (next: Locale) => void] {
  const [raw, setRaw] = useLocalStorageState<Locale>(
    LOCALE_STORAGE_KEY,
    defaultLocale(),
  );
  // Defensive: if a previously-installed Libre once persisted a
  // locale code we no longer support (or if a corrupt cloud-sync
  // payload landed it), fall back rather than render garbage.
  const locale: Locale = isLocale(raw) ? raw : defaultLocale();

  // Mirror the active locale onto a `<html>`-level data attribute so
  // CSS / non-React surfaces (the inline preloader in index.html, the
  // print stylesheet) can react to it without subscribing to React
  // state. This is the same pattern `applyTheme` uses.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-locale", locale);
  }, [locale]);

  const set = useCallback(
    (next: Locale) => {
      if (!isLocale(next)) return;
      setRaw(next);
      // Best-effort cloud sync — if the user is signed in, push the
      // new locale through the same `settings` channel that theme
      // uses. Implemented as a CustomEvent so this hook doesn't have
      // to import `useLibreCloud` (avoiding a layered dep cycle:
      // useLocale lives below the cloud hook in the dep graph). The
      // App-level cloud bootstrap subscribes and forwards.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("libre:setting-changed", {
            detail: { key: "locale", value: next },
          }),
        );
      }
    },
    [setRaw],
  );

  return [locale, set] as const;
}
