/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Catppuccin Mocha ----------------------------------------------------
// Ported from catppuccin/vscode (Mocha flavor). Canonical palette naming
// where tokens reference the theme's "named" colors (mauve/lavender/peach
// /etc). Catppuccin is designed to be soothing — all colors are pastel,
// no harsh contrasts. See https://github.com/catppuccin/catppuccin.
export const CATPPUCCIN_MOCHA: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6c7086", fontStyle: "italic" }, // overlay0
    { token: "keyword", foreground: "cba6f7" }, // mauve
    { token: "keyword.control", foreground: "cba6f7" },
    { token: "string", foreground: "a6e3a1" }, // green
    { token: "string.escape", foreground: "f5c2e7" }, // pink
    { token: "number", foreground: "fab387" }, // peach
    { token: "regexp", foreground: "f5c2e7" },
    { token: "type", foreground: "f9e2af" }, // yellow
    { token: "type.identifier", foreground: "f9e2af" },
    { token: "identifier", foreground: "cdd6f4" }, // text
    { token: "delimiter", foreground: "89dceb" }, // sky
    { token: "operator", foreground: "89dceb" },
    { token: "tag", foreground: "cba6f7" },
    { token: "attribute.name", foreground: "94e2d5" }, // teal
    { token: "attribute.value", foreground: "a6e3a1" },
    { token: "function", foreground: "89b4fa" }, // blue
    { token: "variable", foreground: "cdd6f4" },
    { token: "variable.parameter", foreground: "eba0ac" }, // maroon
    { token: "constant", foreground: "fab387" },
    { token: "constant.language", foreground: "fab387" },
  ],
  colors: {
    "editor.background": "#1e1e2e",      // base
    "editor.foreground": "#cdd6f4",      // text
    "editor.lineHighlightBackground": "#181825", // mantle
    "editor.lineHighlightBorder": "#181825",
    "editor.selectionBackground": "#585b7055",   // surface2 at ~35%
    "editor.inactiveSelectionBackground": "#45475a55",
    "editorCursor.foreground": "#f5e0dc",        // rosewater
    "editorLineNumber.foreground": "#45475a",    // surface1
    "editorLineNumber.activeForeground": "#cdd6f4",
    "editorIndentGuide.background": "#313244",   // surface0
    "editorIndentGuide.activeBackground": "#585b70",
    "editorBracketMatch.background": "#45475a77",
    "editorBracketMatch.border": "#89b4fa",
    "editorGutter.background": "#1e1e2e",
    "editorWidget.background": "#181825",
    "editorWidget.border": "#313244",
    "editorSuggestWidget.background": "#181825",
    "editorSuggestWidget.selectedBackground": "#313244",
    "scrollbarSlider.background": "#585b7040",
    "scrollbarSlider.hoverBackground": "#585b7060",
    "scrollbarSlider.activeBackground": "#585b7080",
  },
};
