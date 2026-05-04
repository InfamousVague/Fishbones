/// Public surface for Monaco theme registration.
///
/// The original monolithic `src/theme/monaco-themes.ts` was split
/// into one file per theme. This index re-exports the same public
/// symbols (`MonacoThemeName`, `MONACO_THEME_BY_APP_THEME`,
/// `registerMonacoThemes`) so downstream code can keep importing
/// from `../theme/monaco-themes` (the shim in monaco-themes.ts
/// forwards).

import type { editor } from "monaco-editor";
import { FISHBONES_DARK } from "./fishbones-dark";
import { SYNTHWAVE } from "./synthwave";
import { CLAUDE_CODE_DARK } from "./claude-code-dark";
import { AYU_MIRAGE } from "./ayu-mirage";
import { CATPPUCCIN_MOCHA } from "./catppuccin-mocha";
import { AYU_DARK } from "./ayu-dark";
import { CATPPUCCIN_FRAPPE } from "./catppuccin-frappe";
import { CATPPUCCIN_MACCHIATO } from "./catppuccin-macchiato";
import { TOKYO_NIGHT } from "./tokyo-night";
import { ROSE_PINE } from "./rose-pine";
import { UBUNTU_DARK } from "./ubuntu-dark";
import { ABSENT_CONTRAST } from "./absent-contrast";
import { VESPER } from "./vesper";
import { WORD } from "./word";

export type { MonacoThemeName } from "./_core";
export { MONACO_THEME_BY_APP_THEME } from "./_core";

/// Register every custom theme on a Monaco instance. Safe to call
/// multiple times — `defineTheme` replaces by name.
export function registerMonacoThemes(monaco: typeof import("monaco-editor")) {
  monaco.editor.defineTheme("fishbones-dark", FISHBONES_DARK as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-synthwave", SYNTHWAVE as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-claude-code-dark", CLAUDE_CODE_DARK as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-ayu-mirage", AYU_MIRAGE as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-catppuccin-mocha", CATPPUCCIN_MOCHA as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-ayu-dark", AYU_DARK as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-catppuccin-frappe", CATPPUCCIN_FRAPPE as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-catppuccin-macchiato", CATPPUCCIN_MACCHIATO as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-tokyo-night", TOKYO_NIGHT as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-rose-pine", ROSE_PINE as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-ubuntu-dark", UBUNTU_DARK as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-absent-contrast", ABSENT_CONTRAST as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-vesper", VESPER as editor.IStandaloneThemeData);
  monaco.editor.defineTheme("fishbones-word", WORD as editor.IStandaloneThemeData);
}
