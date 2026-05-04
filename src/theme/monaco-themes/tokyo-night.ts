/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Tokyo Night ---------------------------------------------------------
// Ported from enkia.tokyo-night ("Storm" variant — the dimmer of the two
// upstream darks). Storm-blue base #1a1b26, electric blue #7aa2f7 for
// functions, purple #bb9af7 for keywords, green #9ece6a for strings,
// dim slate #565f89 for comments.
export const TOKYO_NIGHT: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "565f89", fontStyle: "italic" },
    { token: "keyword", foreground: "bb9af7" },
    { token: "keyword.control", foreground: "bb9af7" },
    { token: "string", foreground: "9ece6a" },
    { token: "string.escape", foreground: "b4f9f8" },
    { token: "number", foreground: "ff9e64" },
    { token: "regexp", foreground: "b4f9f8" },
    { token: "type", foreground: "2ac3de" },
    { token: "type.identifier", foreground: "2ac3de" },
    { token: "identifier", foreground: "c0caf5" },
    { token: "delimiter", foreground: "89ddff" },
    { token: "operator", foreground: "89ddff" },
    { token: "tag", foreground: "f7768e" },
    { token: "attribute.name", foreground: "9ece6a" },
    { token: "attribute.value", foreground: "9ece6a" },
    { token: "function", foreground: "7aa2f7" },
    { token: "variable", foreground: "c0caf5" },
    { token: "variable.parameter", foreground: "e0af68" },
    { token: "constant", foreground: "ff9e64" },
    { token: "constant.language", foreground: "ff9e64" },
  ],
  colors: {
    "editor.background": "#1a1b26",
    "editor.foreground": "#c0caf5",
    "editor.lineHighlightBackground": "#16161e",
    "editor.lineHighlightBorder": "#16161e",
    "editor.selectionBackground": "#33467c80",
    "editor.inactiveSelectionBackground": "#33467c40",
    "editorCursor.foreground": "#c0caf5",
    "editorLineNumber.foreground": "#3b4261",
    "editorLineNumber.activeForeground": "#737aa2",
    "editorIndentGuide.background": "#292e42",
    "editorIndentGuide.activeBackground": "#3b4261",
    "editorBracketMatch.background": "#33467c55",
    "editorBracketMatch.border": "#7aa2f7",
    "editorGutter.background": "#1a1b26",
    "editorWidget.background": "#16161e",
    "editorWidget.border": "#292e42",
    "editorSuggestWidget.background": "#16161e",
    "editorSuggestWidget.selectedBackground": "#292e42",
    "scrollbarSlider.background": "#3b426140",
    "scrollbarSlider.hoverBackground": "#3b426160",
    "scrollbarSlider.activeBackground": "#3b426180",
  },
};
