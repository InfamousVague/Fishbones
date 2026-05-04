/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Synesthesia Synthwave ------------------------------------------------
// Hot magenta + cyan accents against deep violet. Loud — lean into it.
export const SYNTHWAVE: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8c7a98", fontStyle: "italic" },
    { token: "keyword", foreground: "ff7edb", fontStyle: "bold" },
    { token: "keyword.control", foreground: "ff7edb" },
    { token: "string", foreground: "ff8b39" },
    { token: "string.escape", foreground: "36f9f6" },
    { token: "number", foreground: "f97e72" },
    { token: "regexp", foreground: "36f9f6" },
    { token: "type", foreground: "fede5d" },
    { token: "type.identifier", foreground: "fede5d" },
    { token: "identifier", foreground: "f9f1ff" },
    { token: "delimiter", foreground: "c9a5d8" },
    { token: "operator", foreground: "ff7edb" },
    { token: "tag", foreground: "ff7edb" },
    { token: "attribute.name", foreground: "fede5d" },
    { token: "attribute.value", foreground: "ff8b39" },
    { token: "function", foreground: "36f9f6" },
    { token: "variable", foreground: "f9f1ff" },
    { token: "variable.parameter", foreground: "fe4450" },
    { token: "constant", foreground: "f97e72" },
    { token: "constant.language", foreground: "ff7edb" },
  ],
  colors: {
    "editor.background": "#1a1427",
    "editor.foreground": "#f9f1ff",
    "editor.lineHighlightBackground": "#241b2f",
    "editor.lineHighlightBorder": "#241b2f",
    "editor.selectionBackground": "#ff7edb44",
    "editor.inactiveSelectionBackground": "#ff7edb22",
    "editorCursor.foreground": "#ff7edb",
    "editorLineNumber.foreground": "#5c4768",
    "editorLineNumber.activeForeground": "#ff7edb",
    "editorIndentGuide.background": "#2a2137",
    "editorIndentGuide.activeBackground": "#4a3a5c",
    "editorBracketMatch.background": "#ff7edb33",
    "editorBracketMatch.border": "#ff7edb",
    "editorGutter.background": "#1a1427",
    "editorWidget.background": "#241b2f",
    "editorWidget.border": "#ff7edb33",
    "editorSuggestWidget.background": "#241b2f",
    "editorSuggestWidget.selectedBackground": "#ff7edb33",
    "scrollbarSlider.background": "#ff7edb22",
    "scrollbarSlider.hoverBackground": "#ff7edb44",
    "scrollbarSlider.activeBackground": "#ff7edb66",
  },
};
