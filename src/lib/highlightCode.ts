/// Syntax-highlight a snippet to HTML using the same Shiki setup the lesson
/// reader uses for fenced code blocks, so highlighted code looks identical
/// wherever it appears (lesson prose, the "view test" reveal, etc.).
///
/// Dual-theme output (`defaultColor: false`) emits `--shiki-light` /
/// `--shiki-dark` CSS variables per token; the resolution rules live in
/// `LessonReader.css` scoped to `.libre-code-block .shiki` (bundled globally
/// by Vite), so callers should wrap the returned HTML in a `.libre-code-block`
/// element to pick up both the container chrome and the theme-aware colors.
///
/// Returns "" on failure so callers can fall back to plain `<pre>` text.

import { codeToHtml } from "shiki";

const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;

/// Map our internal language ids to Shiki grammar ids. Mirrors the small
/// remap table in `markdown.ts` for the languages that differ; everything
/// else passes through (Shiki's defaults match common names).
function shikiLang(lang: string): string {
  switch (lang.toLowerCase()) {
    case "reactnative":
      return "tsx";
    case "threejs":
      return "javascript";
    case "vyper":
      return "python";
    case "bun":
      return "typescript";
    case "assembly":
      return "asm";
    case "sway":
      return "rust";
    default:
      return lang;
  }
}

export async function highlightCode(
  code: string,
  lang = "javascript",
): Promise<string> {
  try {
    return await codeToHtml(code, {
      lang: shikiLang(lang),
      themes: SHIKI_THEMES,
      defaultColor: false,
    });
  } catch {
    return "";
  }
}
