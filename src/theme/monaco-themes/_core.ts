/// Shared types + mapping for Monaco themes. The per-theme
/// constants live alongside in `./<theme>.ts` files; `./index.ts`
/// registers them with Monaco. See the splitter at
/// `scripts/split-monaco-themes.mjs`.

import type { ThemeName } from "../themes";

export type MonacoThemeName =
  | "vs"
  | "vs-dark"
  | "libre-dark"
  | "libre-light"
  | "libre-synthwave"
  | "libre-claude-code-dark"
  | "libre-ayu-mirage"
  | "libre-ayu-dark"
  | "libre-catppuccin-frappe"
  | "libre-catppuccin-macchiato"
  | "libre-catppuccin-mocha"
  | "libre-tokyo-night"
  | "libre-rose-pine"
  | "libre-ubuntu-dark"
  | "libre-absent-contrast"
  | "libre-vesper"
  | "libre-word";

/// Map each app theme to the Monaco theme name we want the editor to load.
/// Light app themes pair with the `libre-light` Monaco theme — earlier
/// versions paired them with `libre-dark` on the theory that a dark
/// editor frames code as a "distinct surface" but the actual lived
/// experience was an inverted mismatch (white app chrome + black
/// editor inside it) that read as broken rather than intentional.
/// `libre-light` is the inverted-twin of `libre-dark` (same monochrome-
/// glass + warm amber accent brief on a paper-white surface) so the
/// editor disappears into the page in both modes.
export const MONACO_THEME_BY_APP_THEME: Record<ThemeName, MonacoThemeName> = {
  "default-dark": "libre-dark",
  // The image themes recolour the app chrome + halftone via CSS, but the editor
  // surface is made transparent (ghostwire.css) so each theme's own background
  // shows through — so every image theme reuses the shared, well-tuned dark
  // syntax palette rather than a bespoke Monaco theme.
  "retro-pulp": "libre-dark",
  "raygun-gothic": "libre-dark",
  "alien-invasion": "libre-dark",
  "robot-menace": "libre-dark",
  "time-warp": "libre-dark",
  "lost-world": "libre-dark",
  "cold-war-spy": "libre-dark",
  "psychedelic-voyage": "libre-dark",
};
