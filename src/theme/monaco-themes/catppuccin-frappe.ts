/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Catppuccin Frappé ----------------------------------------------------
export const CATPPUCCIN_FRAPPE: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "737994", fontStyle: "italic" },
    { token: "keyword", foreground: "ca9ee6" },
    { token: "keyword.control", foreground: "ca9ee6" },
    { token: "string", foreground: "a6d189" },
    { token: "string.escape", foreground: "f4b8e4" },
    { token: "number", foreground: "ef9f76" },
    { token: "regexp", foreground: "f4b8e4" },
    { token: "type", foreground: "e5c890" },
    { token: "type.identifier", foreground: "e5c890" },
    { token: "identifier", foreground: "c6d0f5" },
    { token: "delimiter", foreground: "99d1db" },
    { token: "operator", foreground: "99d1db" },
    { token: "tag", foreground: "ca9ee6" },
    { token: "attribute.name", foreground: "81c8be" },
    { token: "attribute.value", foreground: "a6d189" },
    { token: "function", foreground: "8caaee" },
    { token: "variable", foreground: "c6d0f5" },
    { token: "variable.parameter", foreground: "ea999c" },
    { token: "constant", foreground: "ef9f76" },
    { token: "constant.language", foreground: "ef9f76" },
  ],
  colors: {
    "editor.background": "#303446",
    "editor.foreground": "#c6d0f5",
    "editor.lineHighlightBackground": "#292c3c",
    "editor.lineHighlightBorder": "#292c3c",
    "editor.selectionBackground": "#626880aa",
    "editor.inactiveSelectionBackground": "#51576d66",
    "editorCursor.foreground": "#f2d5cf",
    "editorLineNumber.foreground": "#51576d",
    "editorLineNumber.activeForeground": "#c6d0f5",
    "editorIndentGuide.background": "#414559",
    "editorIndentGuide.activeBackground": "#626880",
    "editorBracketMatch.background": "#51576d77",
    "editorBracketMatch.border": "#8caaee",
    "editorGutter.background": "#303446",
    "editorWidget.background": "#292c3c",
    "editorWidget.border": "#414559",
    "editorSuggestWidget.background": "#292c3c",
    "editorSuggestWidget.selectedBackground": "#414559",
    "scrollbarSlider.background": "#51576d55",
    "scrollbarSlider.hoverBackground": "#51576d88",
    "scrollbarSlider.activeBackground": "#51576daa",
  },
};
