#!/usr/bin/env node
/// One-shot splitter for `src/data/trees.ts`. Reads the monolithic
/// file, slices it at the well-known landmarks (each `const X:
/// SkillTree = {` declaration, plus the helpers / public-export
/// section at the bottom), and writes:
///
///   src/data/trees/index.ts            — public re-exports
///   src/data/trees/_core.ts            — types + layout/lock/icon helpers
///   src/data/trees/foundations.ts      — const FOUNDATIONS = ...
///   src/data/trees/web.ts              — const WEB = ...
///   src/data/trees/smart-contracts.ts  — const SMART_CONTRACTS = ...
///   src/data/trees/systems.ts          — const SYSTEMS = ...
///   src/data/trees/mobile.ts           — const MOBILE = ...
///   src/data/trees/functional.ts       — const FUNCTIONAL = ...
///   src/data/trees/algorithms.ts       — const ALGORITHMS = ...
///
/// The index re-exports the same symbols the old file exposed, so
/// nothing downstream needs to change. After the split, the original
/// `src/data/trees.ts` is replaced by a 1-line re-export shim
/// (`export * from "./trees/index"`) so cross-file imports targeting
/// `../../data/trees` keep resolving.
///
/// Run:  node scripts/split-trees.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = readFileSync(join(ROOT, "src/data/trees.ts"), "utf8");
const OUT_DIR = join(ROOT, "src/data/trees");

const lines = SRC.split("\n");

// Find landmark lines (1-indexed in editor terms; 0-indexed here).
// Each tree definition starts with `const NAME: SkillTree = {` and
// ends at the matching `};` at column 0.
const trees = [
  { name: "FOUNDATIONS", file: "foundations.ts" },
  { name: "WEB", file: "web.ts" },
  { name: "SMART_CONTRACTS", file: "smart-contracts.ts" },
  { name: "SYSTEMS", file: "systems.ts" },
  { name: "MOBILE", file: "mobile.ts" },
  { name: "FUNCTIONAL", file: "functional.ts" },
  { name: "ALGORITHMS", file: "algorithms.ts" },
];

function findTreeBlock(name) {
  // Match the declaration line.
  const declRe = new RegExp(`^const ${name}: SkillTree = \\{`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (declRe.test(lines[i])) { start = i; break; }
  }
  if (start < 0) throw new Error(`tree ${name} not found`);
  // Walk forward looking for the closing `};` at column 0 — the
  // top-level brace match. Track section banners (--- comment
  // banners) above each tree so we can copy them into the new file.
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "};") { end = i; break; }
  }
  if (end < 0) throw new Error(`tree ${name} unclosed`);
  // Pull the section banner from above the decl. Two or three
  // comment lines separated from the decl by an empty line.
  let bannerStart = start - 1;
  while (bannerStart >= 0 && lines[bannerStart].startsWith("//")) bannerStart--;
  bannerStart++;
  return { start, end, bannerStart };
}

const blocks = trees.map((t) => ({ ...t, ...findTreeBlock(t.name) }));

// Helpers section starts after the last tree (the `// ── Public
// exports ──` banner) and runs to EOF.
const TREES_DECL_LINE = lines.findIndex((l) =>
  l.startsWith("export const TREES:"),
);
if (TREES_DECL_LINE < 0) throw new Error("missing `export const TREES`");
// Start of helpers = that decl. End of TREES array = next `];` at col 0.
const TREES_END = lines.findIndex(
  (l, i) => i > TREES_DECL_LINE && l === "];",
);
if (TREES_END < 0) throw new Error("TREES array unclosed");

// Header comment block + types span lines 0 .. (FOUNDATIONS' bannerStart - 1).
const HEADER_END = blocks[0].bannerStart - 1;

// Collect helper section: from after TREES_END through EOF.
const HELPERS_START = TREES_END + 1;

// Write each tree file. Each file imports the type from `_core` and
// exports a single named const matching its existing name.
function header(extraDoc) {
  return [
    "/// Auto-split from the original `src/data/trees.ts` monolith — see",
    "/// `scripts/split-trees.mjs` for the splitter. The shape of the data",
    "/// is unchanged; only the file boundaries moved.",
    extraDoc,
    "",
    "import type { SkillTree } from \"./_core\";",
    "",
  ].filter(Boolean).join("\n");
}

for (const b of blocks) {
  const banner = lines.slice(b.bannerStart, b.start).join("\n");
  const body = lines.slice(b.start, b.end + 1).join("\n");
  const exportedBody = body.replace(/^const /, "export const ");
  const out = `${header(banner)}\n${exportedBody}\n`;
  writeFileSync(join(OUT_DIR, b.file), out, "utf8");
  console.log(`wrote ${b.file} (${(b.end - b.start + 1)} lines)`);
}

// _core.ts: header comment + type defs + helpers/public-exports (without
// the giant tree-array literal in the middle, which we replace with an
// import-and-spread).
const headerBlock = lines.slice(0, HEADER_END + 1).join("\n");
const helpersBlock = lines.slice(HELPERS_START).join("\n");

const coreOut = [
  headerBlock,
  "",
  helpersBlock,
].join("\n");
writeFileSync(join(OUT_DIR, "_core.ts"), coreOut, "utf8");
console.log("wrote _core.ts");

// index.ts: re-exports everything the old trees.ts exposed.
const indexOut = `/// Public surface for skill-tree data.
///
/// The old monolithic \`src/data/trees.ts\` was split into one file
/// per tree (\`foundations.ts\`, \`web.ts\`, ...) with shared types +
/// helpers in \`_core.ts\`. Downstream code imports from
/// \`@app/data/trees\` (or relative equivalents) which resolves to
/// this index — keeping the public API identical to the pre-split
/// monolith.

export * from "./_core";
${blocks.map((b) => `import { ${b.name} } from "./${b.file.replace(".ts", "")}";`).join("\n")}
${blocks.map((b) => `export { ${b.name} };`).join("\n")}

import type { SkillTree } from "./_core";
${blocks.map((b) => "").join("")}
/// Top-level tree list — same shape and order the old monolith
/// exposed. Replaces the inline-defined-and-collected \`TREES\`
/// array that lived at the bottom of trees.ts.
export const TREES: readonly SkillTree[] = [
${blocks.map((b) => `  ${b.name},`).join("\n")}
];
`;
writeFileSync(join(OUT_DIR, "index.ts"), indexOut, "utf8");
console.log("wrote index.ts");

// Replace the original trees.ts with a re-export shim so existing
// imports (`from "../data/trees"`) keep working without churn.
writeFileSync(
  join(ROOT, "src/data/trees.ts"),
  `/// Re-export shim. The data + helpers moved into \`./trees/\` —
/// see \`./trees/index.ts\` for the public surface and the splitter
/// commentary in \`scripts/split-trees.mjs\`.
export * from "./trees/index";
`,
  "utf8",
);
console.log("rewrote trees.ts as re-export shim");
