/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Ayu Dark -------------------------------------------------------------
export const AYU_DARK: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "acb6bf8c", fontStyle: "italic" },
    { token: "keyword", foreground: "ff8f40" },
    { token: "keyword.control", foreground: "ff8f40" },
    { token: "string", foreground: "aad94c" },
    { token: "string.escape", foreground: "95e6cb" },
    { token: "number", foreground: "d2a6ff" },
    { token: "regexp", foreground: "95e6cb" },
    { token: "type", foreground: "59c2ff" },
    { token: "type.identifier", foreground: "59c2ff" },
    { token: "identifier", foreground: "bfbdb6" },
    { token: "delimiter", foreground: "f29668" },
    { token: "operator", foreground: "f29668" },
    { token: "tag", foreground: "39bae6" },
    { token: "attribute.name", foreground: "ffb454" },
    { token: "attribute.value", foreground: "aad94c" },
    { token: "function", foreground: "ffb454" },
    { token: "variable", foreground: "bfbdb6" },
    { token: "variable.parameter", foreground: "ffb454" },
    { token: "constant", foreground: "d2a6ff" },
    { token: "constant.language", foreground: "39bae6" },
  ],
  colors: {
    "editor.background": "#0b0e14",
    "editor.foreground": "#bfbdb6",
    "editor.lineHighlightBackground": "#131721",
    "editor.lineHighlightBorder": "#131721",
    "editor.selectionBackground": "#409fff4d",
    "editor.inactiveSelectionBackground": "#409fff22",
    "editorCursor.foreground": "#e6b450",
    "editorLineNumber.foreground": "#2d3640",
    "editorLineNumber.activeForeground": "#787b80",
    "editorIndentGuide.background": "#1b212a",
    "editorIndentGuide.activeBackground": "#2d3640",
    "editorBracketMatch.background": "#409fff22",
    "editorBracketMatch.border": "#e6b450",
    "editorGutter.background": "#0b0e14",
    "editorWidget.background": "#0d1017",
    "editorWidget.border": "#1b212a",
    "editorSuggestWidget.background": "#0d1017",
    "editorSuggestWidget.selectedBackground": "#151a22",
    "scrollbarSlider.background": "#bfbdb622",
    "scrollbarSlider.hoverBackground": "#bfbdb644",
    "scrollbarSlider.activeBackground": "#bfbdb666",
  },
};
