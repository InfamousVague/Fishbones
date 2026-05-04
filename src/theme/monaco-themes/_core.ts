/// Shared types + mapping for Monaco themes. The per-theme
/// constants live alongside in `./<theme>.ts` files; `./index.ts`
/// registers them with Monaco. See the splitter at
/// `scripts/split-monaco-themes.mjs`.

import type { ThemeName } from "../themes";

export type MonacoThemeName =
  | "vs"
  | "vs-dark"
  | "fishbones-dark"
  | "fishbones-synthwave"
  | "fishbones-claude-code-dark"
  | "fishbones-ayu-mirage"
  | "fishbones-ayu-dark"
  | "fishbones-catppuccin-frappe"
  | "fishbones-catppuccin-macchiato"
  | "fishbones-catppuccin-mocha"
  | "fishbones-tokyo-night"
  | "fishbones-rose-pine"
  | "fishbones-ubuntu-dark"
  | "fishbones-absent-contrast"
  | "fishbones-vesper"
  | "fishbones-word";

/// Map each app theme to the Monaco theme name we want the editor to load.
/// The light app themes (ayu-light, catppuccin-latte) intentionally pair
/// with the DARK Monaco theme — light syntax-highlighting palettes wash
/// out next to the app's chrome, while a dark editor frames the code as a
/// distinct surface. See the matching note on `monacoTheme` in themes.ts.
export const MONACO_THEME_BY_APP_THEME: Record<ThemeName, MonacoThemeName> = {
  "default-dark": "fishbones-dark",
  synthwave: "fishbones-synthwave",
  "claude-code-dark": "fishbones-claude-code-dark",
  "ayu-light": "fishbones-dark",
  "ayu-mirage": "fishbones-ayu-mirage",
  "ayu-dark": "fishbones-ayu-dark",
  "catppuccin-latte": "fishbones-dark",
  "catppuccin-frappe": "fishbones-catppuccin-frappe",
  "catppuccin-macchiato": "fishbones-catppuccin-macchiato",
  "catppuccin-mocha": "fishbones-catppuccin-mocha",
  "tokyo-night": "fishbones-tokyo-night",
  "rose-pine": "fishbones-rose-pine",
  "ubuntu-dark": "fishbones-ubuntu-dark",
  "absent-contrast": "fishbones-absent-contrast",
  vesper: "fishbones-vesper",
  word: "fishbones-word",
};
