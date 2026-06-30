import { loadHue } from "./themes";
import { languageMeta } from "@/lib/languages";

// Brand-colour HUE (HSL degrees) per language, derived from each language's
// canonical brand colour (the same palette the Profile language bars use). The
// whole GhostWire tint (accent, white→accent gradients, glows, aurora,
// halftone) is hue-driven, so pointing --gg-hue at a language's brand hue
// recolours the entire app to the language you're learning. Near-neutral
// brands (assembly grey, etc.) get a gentle hue rather than a flat grey.
export const LANGUAGE_HUE: Record<string, number> = {
  javascript: 53, // #f7df1e yellow
  typescript: 211, // #3178c6 blue
  python: 207, // #3776ab blue
  rust: 8, // #ce412b oxblood-orange
  go: 192, // #00add8 cyan
  swift: 16, // #fa7343 orange
  reactnative: 193, // #61dafb cyan
  svelte: 15, // #ff3e00 red-orange
  solid: 214, // #2c4f7c blue
  astro: 22, // #ff5d01 orange
  solidity: 279, // #6b4f7a violet
  vyper: 169, // #3f8a7c teal
  c: 212, // #a8b9cc steel
  cpp: 206, // #00599c blue
  java: 39, // #d9a74a amber
  kotlin: 256, // #7f52ff violet
  csharp: 268, // #5c2d91 purple
  zig: 37, // #f7a41d amber
  threejs: 210, // #cbd5e1 steel
  htmx: 220, // #3a4252 slate
  bun: 36, // #fbf0df cream
  // Other catalog languages (brand-colour hues).
  ruby: 4, // #cc342d red
  lua: 240, // #000080 navy
  dart: 200, // #0175c2 blue
  haskell: 258, // #5e5086 violet
  scala: 1, // #dc322f red
  elixir: 280, // #4b275f purple
  clojure: 220, // #5881d8 blue
  fsharp: 201, // #378bba blue
  ocaml: 24, // #ec6813 orange
  sql: 30, // amber
  assembly: 210, // #6b6b6b grey → gentle steel
};

/// Hue for a language id, or null if we have no brand hue for it.
export function hueForLanguage(lang: string | null | undefined): number | null {
  if (!lang) return null;
  const h = LANGUAGE_HUE[lang.toLowerCase()];
  return typeof h === "number" ? h : null;
}

/// Tint the app to a language's brand hue WITHOUT persisting (it's a contextual
/// tint, not the user's saved preference). Pass null / an unknown language to
/// restore the user's chosen hue. Only visible on the default-dark theme (the
/// only theme that reads --gg-hue).
export function applyLanguageHue(lang: string | null | undefined) {
  const hue = hueForLanguage(lang) ?? loadHue();
  try {
    const root = document.documentElement.style;
    root.setProperty("--gg-hue", String(hue));
    // Exact brand colour of the active language → drives every course-scoped
    // progress bar / ring to the language's real brand colour (the same palette
    // the library cards use). Cleared when no course is active so those bars
    // fall back to the theme's white→accent gradient.
    if (lang) {
      root.setProperty("--gg-course-accent", languageMeta(lang).color);
    } else {
      root.removeProperty("--gg-course-accent");
    }
  } catch {
    /* ignore */
  }
}
