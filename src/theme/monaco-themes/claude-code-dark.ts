/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Claude Code Dark -----------------------------------------------------
// Warm terracotta accents against deep brown. Anthropic-flavored.
export const CLAUDE_CODE_DARK: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8a7560", fontStyle: "italic" },
    { token: "keyword", foreground: "d97757" },
    { token: "keyword.control", foreground: "e6c097" },
    { token: "string", foreground: "b5a285" },
    { token: "string.escape", foreground: "d97757" },
    { token: "number", foreground: "c49268" },
    { token: "regexp", foreground: "d97757" },
    { token: "type", foreground: "e6c097" },
    { token: "type.identifier", foreground: "e6c097" },
    { token: "identifier", foreground: "f5ebdc" },
    { token: "delimiter", foreground: "c9b299" },
    { token: "operator", foreground: "d97757" },
    { token: "tag", foreground: "d97757" },
    { token: "attribute.name", foreground: "e6c097" },
    { token: "attribute.value", foreground: "b5a285" },
    { token: "function", foreground: "e8a978" },
    { token: "variable", foreground: "f5ebdc" },
    { token: "variable.parameter", foreground: "c9b299" },
    { token: "constant", foreground: "c49268" },
    { token: "constant.language", foreground: "d97757" },
  ],
  colors: {
    "editor.background": "#14110d",
    "editor.foreground": "#f5ebdc",
    "editor.lineHighlightBackground": "#1c1814",
    "editor.lineHighlightBorder": "#1c1814",
    "editor.selectionBackground": "#d9775744",
    "editor.inactiveSelectionBackground": "#d9775722",
    "editorCursor.foreground": "#d97757",
    "editorLineNumber.foreground": "#5a4a3a",
    "editorLineNumber.activeForeground": "#d97757",
    "editorIndentGuide.background": "#241f18",
    "editorIndentGuide.activeBackground": "#3e3428",
    "editorBracketMatch.background": "#d9775733",
    "editorBracketMatch.border": "#d97757",
    "editorGutter.background": "#14110d",
    "editorWidget.background": "#1c1814",
    "editorWidget.border": "#d9775733",
    "editorSuggestWidget.background": "#1c1814",
    "editorSuggestWidget.selectedBackground": "#d9775733",
    "scrollbarSlider.background": "#d9775722",
    "scrollbarSlider.hoverBackground": "#d9775744",
    "scrollbarSlider.activeBackground": "#d9775766",
  },
};
