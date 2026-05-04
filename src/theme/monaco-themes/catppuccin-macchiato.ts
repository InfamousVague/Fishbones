/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Catppuccin Macchiato ------------------------------------------------
export const CATPPUCCIN_MACCHIATO: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6e738d", fontStyle: "italic" },
    { token: "keyword", foreground: "c6a0f6" },
    { token: "keyword.control", foreground: "c6a0f6" },
    { token: "string", foreground: "a6da95" },
    { token: "string.escape", foreground: "f5bde6" },
    { token: "number", foreground: "f5a97f" },
    { token: "regexp", foreground: "f5bde6" },
    { token: "type", foreground: "eed49f" },
    { token: "type.identifier", foreground: "eed49f" },
    { token: "identifier", foreground: "cad3f5" },
    { token: "delimiter", foreground: "91d7e3" },
    { token: "operator", foreground: "91d7e3" },
    { token: "tag", foreground: "c6a0f6" },
    { token: "attribute.name", foreground: "8bd5ca" },
    { token: "attribute.value", foreground: "a6da95" },
    { token: "function", foreground: "8aadf4" },
    { token: "variable", foreground: "cad3f5" },
    { token: "variable.parameter", foreground: "ee99a0" },
    { token: "constant", foreground: "f5a97f" },
    { token: "constant.language", foreground: "f5a97f" },
  ],
  colors: {
    "editor.background": "#24273a",
    "editor.foreground": "#cad3f5",
    "editor.lineHighlightBackground": "#1e2030",
    "editor.lineHighlightBorder": "#1e2030",
    "editor.selectionBackground": "#5b6078aa",
    "editor.inactiveSelectionBackground": "#494d6466",
    "editorCursor.foreground": "#f4dbd6",
    "editorLineNumber.foreground": "#494d64",
    "editorLineNumber.activeForeground": "#cad3f5",
    "editorIndentGuide.background": "#363a4f",
    "editorIndentGuide.activeBackground": "#5b6078",
    "editorBracketMatch.background": "#494d6477",
    "editorBracketMatch.border": "#8aadf4",
    "editorGutter.background": "#24273a",
    "editorWidget.background": "#1e2030",
    "editorWidget.border": "#363a4f",
    "editorSuggestWidget.background": "#1e2030",
    "editorSuggestWidget.selectedBackground": "#363a4f",
    "scrollbarSlider.background": "#494d6455",
    "scrollbarSlider.hoverBackground": "#494d6488",
    "scrollbarSlider.activeBackground": "#494d64aa",
  },
};
