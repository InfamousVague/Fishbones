#!/usr/bin/env node
/// Split `src/theme/monaco-themes.ts` (844 lines) into one file per
/// theme constant. Same pattern as the trees / docs / playground
/// templates splitters. Layout:
///
///   src/theme/monaco-themes/index.ts            — assembles + re-exports
///   src/theme/monaco-themes/_core.ts            — shared MonacoThemeName type + MONACO_THEME_BY_APP_THEME
///   src/theme/monaco-themes/<theme>.ts          — one file per theme constant
///
/// The original `src/theme/monaco-themes.ts` becomes a re-export
/// shim so downstream `from "../theme/monaco-themes"` imports keep
/// resolving without churn.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = readFileSync(join(ROOT, "src/theme/monaco-themes.ts"), "utf8");
const OUT_DIR = join(ROOT, "src/theme/monaco-themes");
mkdirSync(OUT_DIR, { recursive: true });

const lines = SRC.split("\n");

const THEMES = [
  { variable: "FISHBONES_DARK", file: "fishbones-dark.ts", id: "fishbones-dark" },
  { variable: "SYNTHWAVE", file: "synthwave.ts", id: "fishbones-synthwave" },
  { variable: "CLAUDE_CODE_DARK", file: "claude-code-dark.ts", id: "fishbones-claude-code-dark" },
  { variable: "AYU_MIRAGE", file: "ayu-mirage.ts", id: "fishbones-ayu-mirage" },
  { variable: "CATPPUCCIN_MOCHA", file: "catppuccin-mocha.ts", id: "fishbones-catppuccin-mocha" },
  { variable: "AYU_DARK", file: "ayu-dark.ts", id: "fishbones-ayu-dark" },
  { variable: "CATPPUCCIN_FRAPPE", file: "catppuccin-frappe.ts", id: "fishbones-catppuccin-frappe" },
  { variable: "CATPPUCCIN_MACCHIATO", file: "catppuccin-macchiato.ts", id: "fishbones-catppuccin-macchiato" },
  { variable: "TOKYO_NIGHT", file: "tokyo-night.ts", id: "fishbones-tokyo-night" },
  { variable: "ROSE_PINE", file: "rose-pine.ts", id: "fishbones-rose-pine" },
  { variable: "UBUNTU_DARK", file: "ubuntu-dark.ts", id: "fishbones-ubuntu-dark" },
  { variable: "ABSENT_CONTRAST", file: "absent-contrast.ts", id: "fishbones-absent-contrast" },
  { variable: "VESPER", file: "vesper.ts", id: "fishbones-vesper" },
  { variable: "WORD", file: "word.ts", id: "fishbones-word" },
];

/// Find the [start, end] line range of a `const NAME: editor.IStandaloneThemeData = {` block.
/// Walks forward until a `};` at column 0 closes it.
function findThemeBlock(name) {
  const re = new RegExp(`^const ${name}: editor\\.IStandaloneThemeData = \\{`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { start = i; break; }
  }
  if (start < 0) throw new Error(`${name} not found`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "};") return { start, end: i };
  }
  throw new Error(`${name} unclosed`);
}

const blocks = THEMES.map((t) => ({ ...t, ...findThemeBlock(t.variable) }));

// Pull leading banner (consecutive `// ` lines) above each decl.
function bannerFor(b) {
  let i = b.start - 1;
  while (i >= 0 && (lines[i].startsWith("// ") || lines[i] === "//")) i--;
  i++;
  return lines.slice(i, b.start).join("\n");
}

// Write one file per theme: imports the type, exports the const.
for (const b of blocks) {
  const banner = bannerFor(b);
  const body = lines.slice(b.start, b.end + 1).join("\n").replace(/^const /, "export const ");
  const out = `/// Auto-split from the original \`src/theme/monaco-themes.ts\` monolith.
/// See \`scripts/split-monaco-themes.mjs\` for the splitter. Each Monaco
/// theme gets its own file; \`./index.ts\` registers them with Monaco.

import type { editor } from "monaco-editor";

${banner}
${body}
`;
  writeFileSync(join(OUT_DIR, b.file), out, "utf8");
  console.log(`wrote ${b.file}`);
}

// _core.ts: MonacoThemeName type + MONACO_THEME_BY_APP_THEME mapping.
// Find the lines that declare these.
const typeDeclStart = lines.findIndex((l) => l.startsWith("export type MonacoThemeName"));
const typeDeclEnd = (() => {
  for (let i = typeDeclStart; i < lines.length; i++) {
    if (lines[i].endsWith(";") && !lines[i].includes("|")) return i;
  }
  throw new Error("MonacoThemeName decl unclosed");
})();
const mapDeclStart = lines.findIndex((l) => l.startsWith("export const MONACO_THEME_BY_APP_THEME"));
let depth = 0;
let mapDeclEnd = -1;
for (let i = mapDeclStart; i < lines.length; i++) {
  for (const c of lines[i]) {
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { mapDeclEnd = i; break; }
    }
  }
  if (mapDeclEnd >= 0) break;
}

const typeBlock = lines.slice(typeDeclStart, typeDeclEnd + 1).join("\n");
// Banner immediately above the map decl.
let mapBannerStart = mapDeclStart - 1;
while (mapBannerStart >= 0 && (lines[mapBannerStart].startsWith("/// ") || lines[mapBannerStart] === "///")) mapBannerStart--;
mapBannerStart++;
const mapBanner = lines.slice(mapBannerStart, mapDeclStart).join("\n");
const mapBlock = lines.slice(mapDeclStart, mapDeclEnd + 1).join("\n");

const coreOut = `/// Shared types + mapping for Monaco themes. The per-theme
/// constants live alongside in \`./<theme>.ts\` files; \`./index.ts\`
/// registers them with Monaco. See the splitter at
/// \`scripts/split-monaco-themes.mjs\`.

import type { ThemeName } from "../themes";

${typeBlock}

${mapBanner}
${mapBlock}
`;
writeFileSync(join(OUT_DIR, "_core.ts"), coreOut, "utf8");
console.log("wrote _core.ts");

// index.ts: re-exports + registration.
const indexOut = `/// Public surface for Monaco theme registration.
///
/// The original monolithic \`src/theme/monaco-themes.ts\` was split
/// into one file per theme. This index re-exports the same public
/// symbols (\`MonacoThemeName\`, \`MONACO_THEME_BY_APP_THEME\`,
/// \`registerMonacoThemes\`) so downstream code can keep importing
/// from \`../theme/monaco-themes\` (the shim in monaco-themes.ts
/// forwards).

import type { editor } from "monaco-editor";
${blocks.map((b) => `import { ${b.variable} } from "./${b.file.replace(".ts", "")}";`).join("\n")}

export type { MonacoThemeName } from "./_core";
export { MONACO_THEME_BY_APP_THEME } from "./_core";

/// Register every custom theme on a Monaco instance. Safe to call
/// multiple times — \`defineTheme\` replaces by name.
export function registerMonacoThemes(monaco: typeof import("monaco-editor")) {
${blocks
  .map((b) => `  monaco.editor.defineTheme("${b.id}", ${b.variable} as editor.IStandaloneThemeData);`)
  .join("\n")}
}
`;
writeFileSync(join(OUT_DIR, "index.ts"), indexOut, "utf8");
console.log("wrote index.ts");

// Replace original with re-export shim.
writeFileSync(
  join(ROOT, "src/theme/monaco-themes.ts"),
  `/// Re-export shim. The theme constants moved into \`./monaco-themes/\`
/// — see \`./monaco-themes/index.ts\` for the public surface and the
/// splitter commentary in \`scripts/split-monaco-themes.mjs\`.
export * from "./monaco-themes/index";
`,
  "utf8",
);
console.log("rewrote monaco-themes.ts as re-export shim");
