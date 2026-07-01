/// Lightweight i18n runtime for Libre. Custom (no react-i18next /
/// lingui dep) because:
///   - we don't need lazy-loaded namespaces or pluralisation rules
///     beyond simple `{count}` interpolation; the surface area of
///     a real product library was overkill
///   - skipping the dep keeps the bundle ~30KB lighter
///   - the public API is small enough that swapping to a "real"
///     library later is a few-line refactor at the call sites
///
/// Locale state is owned by the existing `useLocale` hook (see
/// `src/hooks/useLocale.ts`). That hook also drives course-content
/// translation; sharing one source of truth means the user has ONE
/// language setting that flips both the chrome and the lesson prose
/// at the same time.
///
/// Usage:
///
///   // In any component:
///   const t = useT();
///   <h1>{t("library.title")}</h1>
///   <p>{t("library.count", { n: courses.length })}</p>
///
/// Key lookup walks dotted paths through the loaded locale JSON;
/// missing keys fall back to English, then to the literal key.
/// `{name}` placeholders in the value get replaced with the
/// matching `params` entry; unmatched placeholders stay literal so
/// it's obvious during dev which value didn't make it through.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useLocale as useLocaleHook } from "@/hooks/useLocale";
import { type Locale, isRtlLocale } from "@/data/locales";
import enLocale from "@/i18n/locales/en.json";

type Dict = Record<string, unknown>;

/// Dictionary cache. English ships in the main bundle (it's the
/// fallback chain's floor, so it must be synchronously available);
/// the other five locales load on demand via dynamic import the
/// first time a session actually uses them. Previously all six were
/// eagerly bundled (~230 KB of strings the typical English session
/// never reads) — the on-demand load costs one extra fetch on
/// language switch, and the missing-key → English fallback in
/// `useT` keeps the UI readable for the few frames before the
/// dictionary lands.
const loadedDicts: Partial<Record<Locale, Dict>> = {
  en: enLocale as Dict,
};

/// Subscription plumbing so `useT` re-renders when a lazily-loaded
/// dictionary arrives. Version counter + listener set — the minimal
/// useSyncExternalStore-shaped store.
let dictsVersion = 0;
const dictListeners = new Set<() => void>();

function subscribeDicts(cb: () => void): () => void {
  dictListeners.add(cb);
  return () => {
    dictListeners.delete(cb);
  };
}

function getDictsVersion(): number {
  return dictsVersion;
}

const dictsInFlight = new Set<Locale>();

/// Kick off (idempotently) the dynamic import for a locale's
/// dictionary. No-op for English, already-loaded, or in-flight
/// locales. On failure the locale simply keeps falling back to
/// English for the session; the next call retries.
export function ensureLocaleLoaded(locale: Locale): void {
  if (locale === "en" || loadedDicts[locale] || dictsInFlight.has(locale)) {
    return;
  }
  dictsInFlight.add(locale);
  import(`./locales/${locale}.json`)
    .then((mod: { default?: Dict } & Dict) => {
      loadedDicts[locale] = (mod.default ?? mod) as Dict;
      dictsVersion++;
      dictListeners.forEach((cb) => cb());
    })
    .catch(() => {
      // Network/chunk failure — stay on the English fallback. Not
      // marked permanently failed: a later ensure call retries.
    })
    .finally(() => {
      dictsInFlight.delete(locale);
    });
}

/// Drill into a Dict by dotted path. Returns `undefined` if any
/// hop misses; callers handle the fallback chain themselves.
function lookup(dict: Dict, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

/// Interpolate `{name}` placeholders. Anything not in `params`
/// stays as-is so missing-substitution bugs surface visually.
function interpolate(
  value: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m,
  );
}

export type TFunction = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/// Provider — near-no-op compatibility wrapper. The locale state
/// lives in `useLocale` (backed by localStorage + cloud-sync), which
/// is safe to call from any tree depth without a context. The one
/// real job left here: it's mounted at the very root (main.tsx,
/// before the lazy Page chunk), so it kicks off the active locale's
/// dictionary fetch as early as possible — by the time the app
/// paints, a returning non-English user's dictionary is usually
/// already in, keeping the English flash to at most a few frames.
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale] = useLocaleHook();
  useEffect(() => {
    ensureLocaleLoaded(locale);
    // Mirror the whole UI for RTL locales (Arabic / Urdu / Dari). The
    // app's CSS uses logical properties (margin-inline / inset-inline)
    // so most of the layout flips for free; `lang` also helps the
    // browser pick correct fonts + shaping for non-Latin scripts.
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dir = isRtlLocale(locale) ? "rtl" : "ltr";
      root.lang = locale;
    }
  }, [locale]);
  return <>{children}</>;
}

/// Translation function hook. Returns a function whose identity is
/// stable per locale, so passing `t` into a memoised callback's
/// deps list is safe (it only re-fires when the locale itself
/// changes — i.e. the user picked a new language).
export function useT(): TFunction {
  const [locale] = useLocaleHook();
  // Subscribe to dictionary arrivals so components re-render (and
  // re-resolve their strings) the moment a lazily-loaded locale
  // lands. For English / already-loaded locales this never fires.
  useSyncExternalStore(subscribeDicts, getDictsVersion, getDictsVersion);
  // Ensure the active locale's dictionary is (being) loaded. The
  // I18nProvider at the root already kicks this off on mount + on
  // switch, but doing it here too makes any `t()` consumer
  // self-sufficient: when the user picks a new language, every mounted
  // `useT` re-renders (the shared locale store notified them), and this
  // guarantees the target dictionary's dynamic import is in flight so
  // the real strings replace the English fallback as soon as it lands.
  useEffect(() => {
    ensureLocaleLoaded(locale);
  }, [locale]);
  return (key, params) => {
    // While a non-English dictionary is still in flight this resolves
    // undefined and the English fallback below carries the frame.
    const dict = loadedDicts[locale];
    const primary = dict ? lookup(dict, key) : undefined;
    if (primary !== undefined) return interpolate(primary, params);
    // Fall back to English when a key is missing from the current
    // locale — better to show readable English than a raw key path
    // while translations catch up.
    if (locale !== "en") {
      const fallback = lookup(loadedDicts.en as Dict, key);
      if (fallback !== undefined) return interpolate(fallback, params);
    }
    // Last resort: return the key itself so it's obvious in dev
    // which key needs adding.
    return key;
  };
}

/// Direct locale-state hook. Re-exports `useLocale` from the
/// hooks layer in the shape this module previously offered, so
/// existing callers (`const { locale, setLocale } = useLocale()`)
/// keep working without churn. Most new consumers should use
/// `useT` instead and only reach for this when they actually need
/// to read or set the locale.
export function useLocale(): {
  locale: Locale;
  setLocale: (next: Locale) => void;
} {
  const [locale, setLocale] = useLocaleHook();
  return { locale, setLocale };
}

/// Re-exports from the canonical locale module so call sites can
/// import everything language-related from `i18n/i18n` without
/// having to know about the separate `data/locales` module. New
/// language → add it to `data/locales.ts` + drop a `<code>.json`
/// next to this file's locales — the dynamic `ensureLocaleLoaded`
/// import picks it up by filename, no registration needed.
export { SUPPORTED_LOCALES as LOCALES } from "@/data/locales";
export { LOCALE_NAMES, LOCALE_FLAGS } from "@/data/locales";
export type { Locale };
