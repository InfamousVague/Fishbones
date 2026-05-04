/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Rosé Pine -----------------------------------------------------------
// From mvllow.rose-pine. Named-color palette: love (#eb6f92, red-pink),
// gold (#f6c177), rose (#ebbcba), pine (#31748f, dim teal), foam
// (#9ccfd8), iris (#c4a7e7, soft purple). Comments use muted #6e6a86;
// secondary text uses subtle #908caa.
export const ROSE_PINE: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6e6a86", fontStyle: "italic" },
    { token: "keyword", foreground: "31748f" },        // pine
    { token: "keyword.control", foreground: "31748f" },
    { token: "string", foreground: "f6c177" },          // gold
    { token: "string.escape", foreground: "ebbcba" },   // rose
    { token: "number", foreground: "ebbcba" },
    { token: "regexp", foreground: "f6c177" },
    { token: "type", foreground: "9ccfd8" },            // foam
    { token: "type.identifier", foreground: "9ccfd8" },
    { token: "identifier", foreground: "e0def4" },
    { token: "delimiter", foreground: "908caa" },
    { token: "operator", foreground: "31748f" },
    { token: "tag", foreground: "eb6f92" },             // love
    { token: "attribute.name", foreground: "9ccfd8" },
    { token: "attribute.value", foreground: "f6c177" },
    { token: "function", foreground: "ebbcba" },        // rose
    { token: "variable", foreground: "e0def4" },
    { token: "variable.parameter", foreground: "c4a7e7" }, // iris
    { token: "constant", foreground: "ebbcba" },
    { token: "constant.language", foreground: "eb6f92" },
  ],
  colors: {
    "editor.background": "#191724",
    "editor.foreground": "#e0def4",
    "editor.lineHighlightBackground": "#1f1d2e",
    "editor.lineHighlightBorder": "#1f1d2e",
    "editor.selectionBackground": "#403d5266",
    "editor.inactiveSelectionBackground": "#26233a",
    "editorCursor.foreground": "#ebbcba",
    "editorLineNumber.foreground": "#403d52",
    "editorLineNumber.activeForeground": "#908caa",
    "editorIndentGuide.background": "#26233a",
    "editorIndentGuide.activeBackground": "#403d52",
    "editorBracketMatch.background": "#403d5277",
    "editorBracketMatch.border": "#ebbcba",
    "editorGutter.background": "#191724",
    "editorWidget.background": "#1f1d2e",
    "editorWidget.border": "#26233a",
    "editorSuggestWidget.background": "#1f1d2e",
    "editorSuggestWidget.selectedBackground": "#26233a",
    "scrollbarSlider.background": "#403d5240",
    "scrollbarSlider.hoverBackground": "#403d5260",
    "scrollbarSlider.activeBackground": "#403d5280",
  },
};
