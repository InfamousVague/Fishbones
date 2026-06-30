/// Iconography + accent-color maps for the Sandbox surface.
///
/// Two consumers:
///   - `SandboxSidebar` reads `projectIcon(language)` to render a
///     coloured chip next to each project row, so the switcher
///     reads like VSCode's file-icon-themed tab strip rather than
///     a wall of bare project names.
///   - `SandboxFileTree` reads `fileIcon(filename)` so every tree
///     leaf gets an extension-appropriate glyph + accent (e.g. JS
///     yellow, TS blue, Rust orange) — the same visual language
///     learners pattern-match from editors they've used elsewhere.
///
/// We pick from the existing `@base` icon set (Lucide) rather than
/// shipping a VSCode-style icon theme pack — full per-language
/// vector art would double the icon-pack ship size for a feature
/// most users will skim past. Lucide's file-* family covers the
/// rough shape ("braces" for curly-brace languages, "cog" for
/// config, "json" for JSON, etc.) and we add the colour cue on top
/// so the rows still feel "language-specific".

import type { LanguageId } from "@/data/types";
import { fileBraces } from "@base/primitives/icon/icons/file-braces";
import { fileCode2 } from "@base/primitives/icon/icons/file-code-2";
import { fileCode } from "@base/primitives/icon/icons/file-code";
import { fileCog } from "@base/primitives/icon/icons/file-cog";
import { fileJson } from "@base/primitives/icon/icons/file-json";
import { fileText } from "@base/primitives/icon/icons/file-text";
import { fileImage } from "@base/primitives/icon/icons/file-image";
import { fileLock } from "@base/primitives/icon/icons/file-lock";
import { fileTerminal } from "@base/primitives/icon/icons/file-terminal";
import { fileKey } from "@base/primitives/icon/icons/file-key";
import { fileBox } from "@base/primitives/icon/icons/file-box";
import { terminal as terminalIcon } from "@base/primitives/icon/icons/terminal";

export interface IconSpec {
  /// Lucide icon string (passed to <Icon icon={...} />).
  icon: string;
  /// Hex accent colour. Used as inline `color` on the icon so the
  /// glyph picks up a language-themed tint instead of inheriting
  /// the row's text colour.
  color: string;
}

// ── Per-language project chip ─────────────────────────────────────

/// Project-row icon + colour. Pulled out of `fileIcon` so a project
/// labelled "TypeScript" stays visually consistent even if its
/// active file happens to be `package.json`. The colour palette
/// borrows from the VSCode + GitHub language colour map most
/// learners have internalised — TS blue, JS yellow, Rust orange.
export function projectIcon(language: LanguageId): IconSpec {
  switch (language) {
    case "javascript":
      return { icon: fileBraces, color: "#f1d052" };
    case "typescript":
      return { icon: fileCode2, color: "#3a8fd1" };
    case "react":
    case "reactnative":
      return { icon: fileCode2, color: "#61dafb" };
    case "solid":
      return { icon: fileCode2, color: "#2c4f7c" };
    case "svelte":
      return { icon: fileCode2, color: "#ff3e00" };
    case "astro":
      return { icon: fileCode2, color: "#bc52ee" };
    case "htmx":
    case "web":
      return { icon: fileCode, color: "#e44d26" };
    case "threejs":
      return { icon: fileBox, color: "#9aa0a6" };
    case "python":
      return { icon: fileCode, color: "#4b8bbe" };
    case "ruby":
      return { icon: fileCode, color: "#cc342d" };
    case "rust":
      return { icon: fileCog, color: "#dea584" };
    case "go":
      return { icon: fileCode, color: "#00add8" };
    case "swift":
      return { icon: fileCode, color: "#fa7343" };
    case "kotlin":
      return { icon: fileCode, color: "#a97bff" };
    case "java":
      return { icon: fileCode, color: "#b07219" };
    case "csharp":
      return { icon: fileCode, color: "#178600" };
    case "c":
      return { icon: fileCode, color: "#555555" };
    case "cpp":
      return { icon: fileCode, color: "#f34b7d" };
    case "assembly":
      return { icon: fileCog, color: "#6e4c13" };
    case "haskell":
      return { icon: fileCode, color: "#5e5086" };
    case "scala":
      return { icon: fileCode, color: "#c22d40" };
    case "elixir":
      return { icon: fileCode, color: "#6e4a7e" };
    case "lua":
      return { icon: fileCode, color: "#000080" };
    case "sql":
      return { icon: fileCog, color: "#e38c00" };
    case "dart":
      return { icon: fileCode, color: "#00b4ab" };
    case "zig":
      return { icon: fileCog, color: "#ec915c" };
    case "solidity":
    case "vyper":
      return { icon: fileCode, color: "#aa6746" };
    case "move":
    case "cairo":
    case "sway":
      return { icon: fileCode, color: "#9d7cff" };
    case "bun":
      return { icon: fileCode2, color: "#fbf0df" };
    case "tauri":
      return { icon: fileCog, color: "#ffc131" };
    default:
      return { icon: terminalIcon, color: "var(--color-text-tertiary)" };
  }
}

// ── Per-extension file leaf ───────────────────────────────────────

/// File-tree leaf icon + colour. Driven off the extension because
/// the same project can hold a mix (e.g. a Web project with
/// index.html / style.css / script.js) and each leaf reads better
/// with its own glyph.
///
/// Special-cases a handful of well-known basenames (`package.json`,
/// `Cargo.toml`, etc.) so the project-config files pick up a
/// distinctive "cog" glyph rather than inheriting the json/toml
/// generic.
export function fileIcon(filename: string): IconSpec {
  const base = filename.split("/").pop() ?? filename;
  const lower = base.toLowerCase();

  // Special-cased basenames — the well-known config files that
  // every learner instantly recognises.
  if (lower === "package.json" || lower === "package-lock.json")
    return { icon: fileCog, color: "#cb3837" };
  if (lower === "cargo.toml" || lower === "cargo.lock")
    return { icon: fileCog, color: "#dea584" };
  if (lower === "go.mod" || lower === "go.sum")
    return { icon: fileCog, color: "#00add8" };
  if (lower === "tsconfig.json")
    return { icon: fileCog, color: "#3a8fd1" };
  if (lower === ".gitignore" || lower === ".gitkeep" || lower === ".gitattributes")
    return { icon: fileCog, color: "#f05033" };
  if (lower === ".env" || lower.startsWith(".env."))
    return { icon: fileKey, color: "#ecd400" };
  if (lower === "readme.md" || lower === "readme")
    return { icon: fileText, color: "#9aa0a6" };
  if (lower === "dockerfile")
    return { icon: fileCog, color: "#2496ed" };

  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return { icon: fileBraces, color: "#f1d052" };
    case "ts":
    case "mts":
    case "cts":
      return { icon: fileCode2, color: "#3a8fd1" };
    case "jsx":
      return { icon: fileBraces, color: "#61dafb" };
    case "tsx":
      return { icon: fileCode2, color: "#61dafb" };
    case "py":
      return { icon: fileCode, color: "#4b8bbe" };
    case "rs":
      return { icon: fileCode, color: "#dea584" };
    case "go":
      return { icon: fileCode, color: "#00add8" };
    case "swift":
      return { icon: fileCode, color: "#fa7343" };
    case "kt":
    case "kts":
      return { icon: fileCode, color: "#a97bff" };
    case "java":
      return { icon: fileCode, color: "#b07219" };
    case "cs":
      return { icon: fileCode, color: "#178600" };
    case "c":
    case "h":
      return { icon: fileCode, color: "#555555" };
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return { icon: fileCode, color: "#f34b7d" };
    case "rb":
      return { icon: fileCode, color: "#cc342d" };
    case "ex":
    case "exs":
      return { icon: fileCode, color: "#6e4a7e" };
    case "lua":
      return { icon: fileCode, color: "#000080" };
    case "hs":
      return { icon: fileCode, color: "#5e5086" };
    case "scala":
      return { icon: fileCode, color: "#c22d40" };
    case "dart":
      return { icon: fileCode, color: "#00b4ab" };
    case "zig":
      return { icon: fileCog, color: "#ec915c" };
    case "sol":
    case "vy":
      return { icon: fileCode, color: "#aa6746" };
    case "svelte":
      return { icon: fileCode2, color: "#ff3e00" };
    case "astro":
      return { icon: fileCode2, color: "#bc52ee" };
    case "html":
    case "htm":
      return { icon: fileCode, color: "#e44d26" };
    case "css":
    case "scss":
    case "sass":
    case "less":
      return { icon: fileCode2, color: "#264de4" };
    case "json":
    case "jsonc":
      return { icon: fileJson, color: "#cb8a2c" };
    case "yml":
    case "yaml":
      return { icon: fileCog, color: "#cb171e" };
    case "toml":
      return { icon: fileCog, color: "#9c4221" };
    case "md":
    case "markdown":
    case "mdx":
      return { icon: fileText, color: "#9aa0a6" };
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return { icon: fileTerminal, color: "#4eaa25" };
    case "sql":
      return { icon: fileCog, color: "#e38c00" };
    case "lock":
      return { icon: fileLock, color: "var(--color-text-tertiary)" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
    case "ico":
      return { icon: fileImage, color: "#8fbf00" };
    case "txt":
      return { icon: fileText, color: "var(--color-text-tertiary)" };
    default:
      return { icon: fileCode2, color: "var(--color-text-secondary)" };
  }
}
