/// The learner's default set of languages to download with a book — English
/// plus whichever translations they want by default. Drives (a) the
/// pre-selection in the install language picker and (b) which locale overlays
/// the bulk web seed fetches for auto-installed books.
///
/// English is always included (the authoring base). Persisted to localStorage
/// and exposed to non-React callers (the seeder runs before React mounts) via
/// `getDownloadLocales`. Reactivity mirrors `useLocale`: a single module store
/// behind `useSyncExternalStore`, so the Settings toggle and any consumer stay
/// in sync without a reload.

import { useCallback, useSyncExternalStore } from "react";
import { detectLocale, isLocale, type Locale } from "@/data/locales";

const KEY = "libre:download-locales";
const SERVER_SNAPSHOT: Locale[] = ["en"];
const listeners = new Set<() => void>();
let current: Locale[] | null = null;

/// English + the browser-detected locale, as the first-run default so a
/// Spanish-speaking visitor auto-gets Spanish where a book offers it.
function firstRunDefault(): Locale[] {
  const d = detectLocale();
  return d === "en" ? ["en"] : ["en", d];
}

function read(): Locale[] {
  if (typeof localStorage === "undefined") return firstRunDefault();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return firstRunDefault();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const locs = parsed.filter(isLocale);
      return locs.includes("en") ? locs : ["en", ...locs];
    }
  } catch {
    /* corrupt value — fall back */
  }
  return ["en"];
}

function snapshot(): Locale[] {
  if (current == null) current = read();
  return current;
}

/// Imperative read for non-React callers (webSeedCourses).
export function getDownloadLocales(): Locale[] {
  return snapshot();
}

export function setDownloadLocales(next: Locale[]): void {
  const withEn = next.includes("en") ? next : ["en", ...next];
  const deduped = [...new Set(withEn)].filter(isLocale);
  if (
    current &&
    current.length === deduped.length &&
    current.every((l, i) => l === deduped[i])
  ) {
    return; // unchanged — don't churn subscribers
  }
  current = deduped;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(deduped));
    } catch {
      /* quota / private mode — keep the in-memory value */
    }
  }
  listeners.forEach((cb) => cb());
}

export function useDownloadLocales(): readonly [
  Locale[],
  (next: Locale[]) => void,
] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    snapshot,
    () => SERVER_SNAPSHOT,
  );
  const set = useCallback((next: Locale[]) => setDownloadLocales(next), []);
  return [value, set] as const;
}
