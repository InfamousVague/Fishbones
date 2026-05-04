/// Auto-split from the original `src/theme/monaco-themes.ts` monolith.
/// See `scripts/split-monaco-themes.mjs` for the splitter. Each Monaco
/// theme gets its own file; `./index.ts` registers them with Monaco.

import type { editor } from "monaco-editor";

// ---- Absent Contrast (Daylerees Rainglow) --------------------------------
// Sourced from the Rainglow VS Code extension at
// github.com/rainglow/vscode/blob/master/themes/absent-contrast.json. Token
// rules + workbench colours map straight from that JSON; what changes here
// is the Monaco token-name shape (string / keyword / etc.) since Monaco
// doesn't speak TextMate scopes natively. Signature: deep slate base
// (#0e1114) with cool teal (#228a96) keywords, sage (#6ba77f) for class
// + support tokens, and a soft mint (#addbbc) for strings.
export const ABSENT_CONTRAST: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "44515e", fontStyle: "italic" },
    { token: "keyword", foreground: "228a96" },
    { token: "keyword.control", foreground: "228a96" },
    { token: "string", foreground: "addbbc" },
    { token: "string.escape", foreground: "61bcc6" },
    { token: "number", foreground: "61bcc6" },
    { token: "regexp", foreground: "addbbc" },
    { token: "type", foreground: "6ba77f" },
    { token: "type.identifier", foreground: "6ba77f" },
    { token: "identifier", foreground: "aeb9c4" },
    { token: "delimiter", foreground: "aeb9c4" },
    { token: "operator", foreground: "228a96" },
    { token: "tag", foreground: "228a96" },
    { token: "attribute.name", foreground: "6ba77f" },
    { token: "attribute.value", foreground: "addbbc" },
    { token: "function", foreground: "e6eaef" },
    { token: "variable", foreground: "bed0e2" },
    { token: "variable.parameter", foreground: "bed0e2" },
    { token: "constant", foreground: "6ba77f" },
    { token: "constant.language", foreground: "6ba77f" },
  ],
  colors: {
    "editor.background": "#0e1114",
    "editor.foreground": "#aeb9c4",
    "editor.lineHighlightBackground": "#14191d",
    "editor.lineHighlightBorder": "#14191d",
    "editor.selectionBackground": "#228a9655",
    "editor.inactiveSelectionBackground": "#228a9622",
    "editorCursor.foreground": "#ffffff",
    "editorLineNumber.foreground": "#384450",
    "editorLineNumber.activeForeground": "#aeb9c4",
    "editorIndentGuide.background": "#232a32",
    "editorIndentGuide.activeBackground": "#384450",
    "editorBracketMatch.background": "#228a9644",
    "editorBracketMatch.border": "#6ba77f",
    "editorGutter.background": "#0a0c0e",
    "editorWidget.background": "#181e23",
    "editorWidget.border": "#2d3741",
    "editorSuggestWidget.background": "#181e23",
    "editorSuggestWidget.selectedBackground": "#384450",
    "scrollbarSlider.background": "#384450aa",
    "scrollbarSlider.hoverBackground": "#228a9655",
    "scrollbarSlider.activeBackground": "#228a96aa",
  },
};
