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
///
/// Reactivity model: the locale lives in a single module-level store
/// (not a per-instance `useState`), exposed to React via
/// `useSyncExternalStore`. Every `useLocale()` / `useT()` consumer
/// subscribes to the SAME store, so `setLocale(next)` re-renders the
/// whole app at once — no reload needed. (The previous implementation
/// backed each hook instance with its own `useLocalStorageState`
/// state, so `setLocale` only updated the caller's copy and left every
/// other subscriber showing the old language until a reload re-read
/// localStorage.)

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/data/locales";

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

/// Read the persisted locale synchronously from localStorage, falling
/// back to the detected default. Defensive against corrupt / removed
/// locale codes (an older install, or a bad cloud-sync payload) — an
/// unrecognised value falls back rather than rendering garbage.
function readStoredLocale(): Locale {
  if (typeof localStorage === "undefined") return defaultLocale();
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw == null) return defaultLocale();
    // Values are written with JSON.stringify (see useLocalStorageState,
    // the previous backing store) so a persisted locale is a quoted
    // string like `"es"`. Parse it, but also accept a bare unquoted
    // code for forward/backward compatibility.
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* not JSON — treat the raw string as the value */
    }
    return isLocale(parsed) ? parsed : defaultLocale();
  } catch {
    // Private-browsing throw etc. — fall back to the detected default.
    return defaultLocale();
  }
}

/// The single source of truth for the active locale, shared across
/// every hook instance. Initialised lazily from localStorage on first
/// read so the very first render already reflects the persisted choice.
let currentLocale: Locale | null = null;

/// Subscriber set — every mounted `useLocale` / `useT` consumer adds
/// its React re-render callback here. `setLocale` notifies all of them
/// so the whole app re-renders together on a language switch.
const localeListeners = new Set<() => void>();

function getLocaleSnapshot(): Locale {
  if (currentLocale == null) currentLocale = readStoredLocale();
  return currentLocale;
}

/// Server snapshot for SSR / non-browser: no persistence, just the
/// detected default. Kept identity-stable per session (cachedDefault)
/// so `useSyncExternalStore` doesn't loop.
function getLocaleServerSnapshot(): Locale {
  return defaultLocale();
}

function subscribeLocale(cb: () => void): () => void {
  localeListeners.add(cb);
  return () => {
    localeListeners.delete(cb);
  };
}

function notifyLocaleListeners(): void {
  localeListeners.forEach((cb) => cb());
}

/// Persist + broadcast a locale change. Writes localStorage, updates
/// the in-memory store, and notifies every subscriber so the app
/// re-renders in the new language immediately. Exported so imperative
/// (non-React) callers — e.g. an inbound cloud-sync handler applying a
/// remote locale change — can drive the same store.
export function setStoredLocale(next: Locale): void {
  if (!isLocale(next)) return;
  if (typeof localStorage !== "undefined") {
    try {
      // Match the JSON encoding the previous backing store used, so a
      // value written here reads back identically after a reload.
      localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota / private-browsing — drop the persistence but still flip
      // the in-memory locale so the UI updates for this session.
    }
  }
  if (currentLocale === next) return;
  currentLocale = next;
  notifyLocaleListeners();
}

export function useLocale(): readonly [Locale, (next: Locale) => void] {
  const locale = useSyncExternalStore(
    subscribeLocale,
    getLocaleSnapshot,
    getLocaleServerSnapshot,
  );

  // Mirror the active locale onto a `<html>`-level data attribute so
  // CSS / non-React surfaces (the inline preloader in index.html, the
  // print stylesheet) can react to it without subscribing to React
  // state. This is the same pattern `applyTheme` uses.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-locale", locale);
  }, [locale]);

  const set = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setStoredLocale(next);
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
  }, []);

  return [locale, set] as const;
}
