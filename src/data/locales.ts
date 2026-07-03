/// Multi-language translation support for Libre-authored courses.
///
/// Translations are stored INLINE on each course / chapter / lesson under
/// a `translations` field keyed by locale. The reader merges the active
/// locale's strings over the original (English) at render time via
/// `localizedCourse` / `localizedLesson` below. Missing keys fall back
/// to English silently — partial translations are first-class.
///
/// Why inline (vs sidecar `*.ru.json` files):
///   - Course bundles ship as a single JSON; one file per locale would
///     mean fanning out the storage layer and the .libre archive
///     format. Inline keeps every persistence path unchanged.
///   - The translation surface per lesson is small (a few hundred chars
///     of prose). Five extra locales roughly 6× the body weight, but
///     the largest Libre-authored course (HelloTrade, ~96 KB EN)
///     stays under 600 KB even fully translated.
///   - Code, identifiers, and starter/test bodies are NEVER duplicated
///     into translations — only natural-language fields are.
///
/// To add a new locale: extend `SUPPORTED_LOCALES` + `LOCALE_NAMES`,
/// re-run `scripts/translate-course.mjs <courseId> --locales <new>`,
/// and add the country flag to `LOCALE_FLAGS`.

/// Set of all locales the app can switch to. `en` is the source of truth
/// (every Libre-authored lesson is authored in English first); the
/// rest are translation overlays. Adding a locale here without also
/// running the translation pipeline just shows the language in the
/// dropdown and falls back to English everywhere — graceful degradation.
export type Locale =
  | "en"
  | "ru"
  | "es"
  | "fr"
  | "kr"
  | "jp"
  | "hi"
  | "ar"
  | "ur"
  | "tr"
  | "bn"
  | "tl"
  | "fa"
  | "ne"
  | "vi"
  | "id"
  | "sw"
  | "zh";

export const SUPPORTED_LOCALES: readonly Locale[] = [
  // Sorted by our user base (largest country cohorts first): India (hi),
  // Arabic-speaking countries, Pakistan (ur), Turkey, Philippines,
  // Bangladesh, then the rest. English is the source + largest cohort.
  "en",
  "hi",
  "ar",
  "ur",
  "tr",
  "tl",
  "bn",
  "fr",
  "fa",
  "ne",
  "vi",
  "sw",
  "es",
  "id",
  "jp",
  "ru",
  "kr",
  "zh",
] as const;

/// Right-to-left locales. When one of these is active the app sets
/// `dir="rtl"` on <html> (see I18nProvider) so the whole UI mirrors —
/// CSS in the app uses logical properties (margin-inline / inset-inline)
/// so most of the layout flips for free.
export const RTL_LOCALES: readonly Locale[] = ["ar", "ur", "fa"] as const;

export function isRtlLocale(locale: Locale): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

/// Human-facing labels for each locale, in the locale's own language
/// ("Русский" not "Russian"). Picking the endonym means a Russian
/// speaker browsing the dropdown sees "Русский" rather than having
/// to recognise "Russian" — same pattern macOS / iOS use.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  es: "Español",
  fr: "Français",
  kr: "한국어",
  jp: "日本語",
  hi: "हिन्दी",
  ar: "العربية",
  ur: "اردو",
  tr: "Türkçe",
  bn: "বাংলা",
  tl: "Filipino",
  fa: "دری",
  ne: "नेपाली",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  sw: "Kiswahili",
  zh: "中文",
};

/// Country-flag emoji per locale. Region flags are single-codepoint
/// pairs (regional indicator A-Z) and render natively on every modern
/// platform — no SVG asset to ship. We pick the most-recognisable
/// country per language (US for English, Russia for Russian, Spain
/// for Spanish, France for French, South Korea for Korean, Japan for
/// Japanese) rather than trying to decide between Spain/Mexico or
/// US/UK.
export const LOCALE_FLAGS: Record<Locale, string> = {
  en: "🇺🇸",
  ru: "🇷🇺",
  es: "🇪🇸",
  fr: "🇫🇷",
  kr: "🇰🇷",
  jp: "🇯🇵",
  hi: "🇮🇳",
  ar: "🇸🇦",
  ur: "🇵🇰",
  tr: "🇹🇷",
  bn: "🇧🇩",
  tl: "🇵🇭",
  fa: "🇦🇫",
  ne: "🇳🇵",
  vi: "🇻🇳",
  id: "🇮🇩",
  sw: "🇰🇪",
  zh: "🇨🇳",
};

/// Used by the script + the runtime to send "translate INTO X" prompts.
/// Distinct from `LOCALE_NAMES` (endonyms) because the AI translator
/// understands "Russian" better than "Русский" in a system prompt.
export const LOCALE_ENGLISH_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  kr: "Korean",
  jp: "Japanese",
  hi: "Hindi",
  ar: "Arabic",
  ur: "Urdu",
  tr: "Turkish",
  bn: "Bengali",
  tl: "Filipino (Tagalog)",
  fa: "Dari (Persian)",
  ne: "Nepali",
  vi: "Vietnamese",
  id: "Indonesian",
  sw: "Swahili",
  zh: "Chinese (Simplified)",
};

/// Shape of the per-locale translation overlay attached to a Course.
/// All fields optional so partial translations don't have to fill
/// in chapter titles to translate a single lesson.
export interface CourseTranslation {
  title?: string;
  description?: string;
}

/// Shape of the per-locale overlay attached to a Chapter.
export interface ChapterTranslation {
  title?: string;
}

/// Shape of the per-locale overlay attached to any Lesson kind.
/// `body` is markdown — code fences inside MUST be preserved by the
/// translation step (the script enforces this with an explicit
/// "do not translate code" instruction). `hints` covers
/// ExerciseLesson; `questions` covers QuizLesson — when the lesson
/// kind doesn't have those fields, the translator simply omits them.
export interface LessonTranslation {
  title?: string;
  body?: string;
  objectives?: string[];
  /// Per-hint translations for ExerciseLesson. Length should match
  /// the original `hints[]`; if it's shorter, missing entries fall
  /// back to the English hint at that index.
  hints?: string[];
  /// Per-question translations for QuizLesson. Each entry mirrors
  /// the original question's prompt + options + explanation; `accept`
  /// (short-answer accepted-strings) is intentionally not translated
  /// — accepted-answer matching is normalised + case-insensitive,
  /// translating accepted answers risks breaking grading.
  questions?: LessonQuestionTranslation[];
}

export interface LessonQuestionTranslation {
  prompt?: string;
  options?: string[];
  explanation?: string;
}

/// Map keyed by the non-EN locale; `en` is implicit (it's the
/// authoring source). Using `Exclude<Locale, "en">` makes it a type
/// error to write `translations.en = {...}` — there's nothing to
/// override there.
export type TranslationOverlay<T> = Partial<Record<Exclude<Locale, "en">, T>>;

/// Map a browser-reported language code (`navigator.language`) onto
/// one of the supported locales. Strips region (`en-GB` → `en`),
/// normalises Korean (`ko` → `kr` to match our locale slug), and
/// Japanese (`ja` → `jp`). Falls back to English when the language
/// has no Libre translation yet.
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const raw = (navigator.language || "en").toLowerCase().split("-")[0];
  switch (raw) {
    case "ru":
      return "ru";
    case "es":
      return "es";
    case "fr":
      return "fr";
    case "ko":
      return "kr";
    case "ja":
      return "jp";
    case "hi":
      return "hi";
    case "ar":
      return "ar";
    case "ur":
      return "ur";
    case "tr":
      return "tr";
    case "bn":
      return "bn";
    case "tl":
    case "fil":
      return "tl";
    case "fa":
    case "prs": // Dari (Afghan Persian)
      return "fa";
    case "ne":
      return "ne";
    case "vi":
      return "vi";
    case "id":
    case "in": // legacy Indonesian code
      return "id";
    case "sw":
      return "sw";
    case "zh":
      return "zh";
    default:
      return "en";
  }
}

/// Persistence key shared by the React `useLocale` hook + the cloud
/// `useLibreCloud.pushSettings` channel. Keep both touch points
/// using this constant so a rename only happens in one place.
export const LOCALE_STORAGE_KEY = "libre:locale";

/// Whether `value` is one of the supported locales. Used to validate
/// inbound cloud-sync payloads + previously-persisted localStorage
/// values (so an older install that wrote a now-removed locale falls
/// back to the default rather than throwing).
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
