/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Ubuntu Dark ---------------------------------------------------------
// Approximates ThiagoLcioBittencourt.ubuntuvscode "Ubuntu Color VSCode
// Dark Highlight". Aubergine background #2c001e is the canonical
// Ubuntu desktop colour; orange #e95420 is the brand accent
// (terminal prompts, focus rings). Token mapping is a "vs-dark
// re-skin" — close enough that any language reads naturally without
// a per-grammar tuning pass.
export const UBUNTU_DARK: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "9d8593", fontStyle: "italic" },
    { token: "keyword", foreground: "e95420" },           // orange
    { token: "keyword.control", foreground: "e95420" },
    { token: "string", foreground: "87a556" },            // muted green
    { token: "string.escape", foreground: "f7c37b" },
    { token: "number", foreground: "f7c37b" },
    { token: "regexp", foreground: "f7c37b" },
    { token: "type", foreground: "5e9bd1" },
    { token: "type.identifier", foreground: "5e9bd1" },
    { token: "identifier", foreground: "f9f4f0" },
    { token: "delimiter", foreground: "d4b3c8" },
    { token: "operator", foreground: "e95420" },
    { token: "tag", foreground: "e95420" },
    { token: "attribute.name", foreground: "ad7fa8" },
    { token: "attribute.value", foreground: "87a556" },
    { token: "function", foreground: "f0c674" },
    { token: "variable", foreground: "f9f4f0" },
    { token: "variable.parameter", foreground: "ad7fa8" },
    { token: "constant", foreground: "f7c37b" },
    { token: "constant.language", foreground: "e95420" },
  ],
  colors: {
    "editor.background": "#2c001e",
    "editor.foreground": "#f9f4f0",
    "editor.lineHighlightBackground": "#220016",
    "editor.lineHighlightBorder": "#220016",
    "editor.selectionBackground": "#5d2a4488",
    "editor.inactiveSelectionBackground": "#5d2a4444",
    "editorCursor.foreground": "#e95420",
    "editorLineNumber.foreground": "#5d3a4d",
    "editorLineNumber.activeForeground": "#d4b3c8",
    "editorIndentGuide.background": "#3d0a2a",
    "editorIndentGuide.activeBackground": "#5d3a4d",
    "editorBracketMatch.background": "#5d2a4477",
    "editorBracketMatch.border": "#e95420",
    "editorGutter.background": "#2c001e",
    "editorWidget.background": "#220016",
    "editorWidget.border": "#3d0a2a",
    "editorSuggestWidget.background": "#220016",
    "editorSuggestWidget.selectedBackground": "#3d0a2a",
    "scrollbarSlider.background": "#5d3a4d40",
    "scrollbarSlider.hoverBackground": "#5d3a4d60",
    "scrollbarSlider.activeBackground": "#5d3a4d80",
  },
};
