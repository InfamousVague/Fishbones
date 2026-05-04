/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Vesper (raunofreiberg.vesper) ---------------------------------------
// Sourced from github.com/raunofreiberg/vesper/blob/main/themes/
// Vesper-dark-color-theme.json. Monochrome dark with a single warm peach
// (#FFC799) accent for keywords/functions/numbers and a mint (#99FFE4)
// for strings — Rauno's calling card. Body uses the JSON's #A0A0A0 mid-
// gray as `text-secondary` and pure white for `text-primary` so titles
// + active items still pop against the muted code-comment grey.
export const VESPER: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8b8b8b", fontStyle: "italic" },
    { token: "keyword", foreground: "a0a0a0" },
    { token: "keyword.control", foreground: "a0a0a0" },
    { token: "string", foreground: "99ffe4" },
    { token: "string.escape", foreground: "a0a0a0" },
    { token: "number", foreground: "ffc799" },
    { token: "regexp", foreground: "a0a0a0" },
    { token: "type", foreground: "ffc799" },
    { token: "type.identifier", foreground: "ffc799" },
    { token: "identifier", foreground: "ffffff" },
    { token: "delimiter", foreground: "a0a0a0" },
    { token: "operator", foreground: "a0a0a0" },
    { token: "tag", foreground: "ffc799" },
    { token: "attribute.name", foreground: "a0a0a0" },
    { token: "attribute.value", foreground: "99ffe4" },
    { token: "function", foreground: "ffc799" },
    { token: "variable", foreground: "ffffff" },
    { token: "variable.parameter", foreground: "ffffff" },
    { token: "constant", foreground: "ffc799" },
    { token: "constant.language", foreground: "ffc799" },
  ],
  colors: {
    "editor.background": "#101010",
    "editor.foreground": "#ffffff",
    "editor.lineHighlightBackground": "#161616",
    "editor.lineHighlightBorder": "#161616",
    "editor.selectionBackground": "#ffffff25",
    "editor.inactiveSelectionBackground": "#ffffff15",
    "editorCursor.foreground": "#ffc799",
    "editorLineNumber.foreground": "#505050",
    "editorLineNumber.activeForeground": "#a0a0a0",
    "editorIndentGuide.background": "#1c1c1c",
    "editorIndentGuide.activeBackground": "#343434",
    "editorBracketMatch.background": "#23232377",
    "editorBracketMatch.border": "#ffc799",
    "editorGutter.background": "#101010",
    "editorWidget.background": "#161616",
    "editorWidget.border": "#282828",
    "editorSuggestWidget.background": "#161616",
    "editorSuggestWidget.selectedBackground": "#232323",
    "scrollbarSlider.background": "#34343480",
    "scrollbarSlider.hoverBackground": "#343434",
    "scrollbarSlider.activeBackground": "#ffc79966",
  },
};
