/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Ayu Mirage -----------------------------------------------------------
// Ported from ayu-theme/vscode-ayu. Mirage's signature is warm orange
// (#FFA759) for keywords over the dusty #1F2430 base, with soft teal-cyan
// (#95E6CB) punctuation and a green (#BAE67E) for strings.
export const AYU_MIRAGE: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "5c6773", fontStyle: "italic" },
    { token: "keyword", foreground: "ffa759" },
    { token: "keyword.control", foreground: "ffa759" },
    { token: "string", foreground: "bae67e" },
    { token: "string.escape", foreground: "95e6cb" },
    { token: "number", foreground: "d4bfff" },
    { token: "regexp", foreground: "95e6cb" },
    { token: "type", foreground: "73d0ff" },
    { token: "type.identifier", foreground: "73d0ff" },
    { token: "identifier", foreground: "cbccc6" },
    { token: "delimiter", foreground: "95e6cb" },
    { token: "operator", foreground: "f29e74" },
    { token: "tag", foreground: "5ccfe6" },
    { token: "attribute.name", foreground: "ffd580" },
    { token: "attribute.value", foreground: "bae67e" },
    { token: "function", foreground: "ffd580" },
    { token: "variable", foreground: "cbccc6" },
    { token: "variable.parameter", foreground: "ffd580" },
    { token: "constant", foreground: "d4bfff" },
    { token: "constant.language", foreground: "5ccfe6" },
  ],
  colors: {
    "editor.background": "#1f2430",
    "editor.foreground": "#cbccc6",
    "editor.lineHighlightBackground": "#191e2a",
    "editor.lineHighlightBorder": "#191e2a",
    "editor.selectionBackground": "#33415580",
    "editor.inactiveSelectionBackground": "#33415540",
    "editorCursor.foreground": "#ffcc66",
    "editorLineNumber.foreground": "#3d4658",
    "editorLineNumber.activeForeground": "#8a9199",
    "editorIndentGuide.background": "#2d3340",
    "editorIndentGuide.activeBackground": "#4b5262",
    "editorBracketMatch.background": "#33415555",
    "editorBracketMatch.border": "#ffcc66",
    "editorGutter.background": "#1f2430",
    "editorWidget.background": "#191e2a",
    "editorWidget.border": "#2d3340",
    "editorSuggestWidget.background": "#191e2a",
    "editorSuggestWidget.selectedBackground": "#33415580",
    "scrollbarSlider.background": "#8a919930",
    "scrollbarSlider.hoverBackground": "#8a919950",
    "scrollbarSlider.activeBackground": "#8a919970",
  },
};
