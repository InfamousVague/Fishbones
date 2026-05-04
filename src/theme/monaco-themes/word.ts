/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Word (coastermcgee.word-theme) --------------------------------------
// Sourced from github.com/coastermcgee/vscode-word-theme/blob/master/themes/
// word-color-theme.json. A loving recreation of Microsoft Word 5.5 for DOS:
// deep blue document (#0000aa) for the editor, bright magenta (#ff55ff)
// keywords, cyan (#55ffff) constants, yellow (#ffff55) function names.
// Source paints app chrome in light gray (#aaaaaa) — we keep the editor
// blue but lean into the loud accents on app surfaces too so the theme
// reads as a single deliberate aesthetic instead of two halves.
export const WORD: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "828282", fontStyle: "italic" },
    { token: "keyword", foreground: "ff55ff" },
    { token: "keyword.control", foreground: "ff55ff" },
    { token: "string", foreground: "ffff55" },
    { token: "string.escape", foreground: "55ff55" },
    { token: "number", foreground: "55ffff" },
    { token: "regexp", foreground: "55ff55" },
    { token: "type", foreground: "ffff55" },
    { token: "type.identifier", foreground: "ffff55" },
    { token: "identifier", foreground: "ffffff" },
    { token: "delimiter", foreground: "ffffff" },
    { token: "operator", foreground: "ff55ff" },
    { token: "tag", foreground: "ffff55" },
    { token: "attribute.name", foreground: "ffff55" },
    { token: "attribute.value", foreground: "55ffff" },
    { token: "function", foreground: "ffff55" },
    { token: "variable", foreground: "ffffff" },
    { token: "variable.parameter", foreground: "ffffff" },
    { token: "constant", foreground: "55ffff" },
    { token: "constant.language", foreground: "55ffff" },
  ],
  colors: {
    "editor.background": "#0000aa",
    "editor.foreground": "#ffffff",
    "editor.lineHighlightBackground": "#1a1ac0",
    "editor.lineHighlightBorder": "#1a1ac0",
    "editor.selectionBackground": "#aaaaaa",
    "editor.inactiveSelectionBackground": "#5e5e5e",
    "editorCursor.foreground": "#ffffff",
    "editorLineNumber.foreground": "#7878d0",
    "editorLineNumber.activeForeground": "#ffffff",
    "editorIndentGuide.background": "#1a1ac0",
    "editorIndentGuide.activeBackground": "#5555ff",
    "editorBracketMatch.background": "#5555ff55",
    "editorBracketMatch.border": "#ff55ff",
    "editorGutter.background": "#0000aa",
    "editorWidget.background": "#1a1ac0",
    "editorWidget.border": "#5555ff",
    "editorSuggestWidget.background": "#1a1ac0",
    "editorSuggestWidget.selectedBackground": "#5555ff",
    "scrollbarSlider.background": "#5555ff66",
    "scrollbarSlider.hoverBackground": "#5555ff99",
    "scrollbarSlider.activeBackground": "#ff55ff99",
  },
};
