#!/usr/bin/env node
/// Split `src/docs/pages.ts` (2232 lines, 18 page constants + a
/// `sections` array + index map) into one file per section. Each
/// section file co-locates its page constants and exports a
/// `SECTION` constant that the new `index.ts` assembles.
///
/// Layout after split:
///   src/docs/pages/index.ts              — assembles sections, exports FISHBONES_DOCS + FISHBONES_DOCS_INDEX
///   src/docs/pages/getting-started.ts    — welcome / installing / firstCourse
///   src/docs/pages/architecture.ts       — archOverview / tauriBackend / reactFrontend
///   src/docs/pages/courses.ts            — courseFormat / bundledPacks
///   src/docs/pages/runtimes.ts           — runtimeLayer / workbench / playgroundDoc / phoneFloating
///   src/docs/pages/subsystems.ts         — ingestPipeline / aiAssistant / progressXp / cloudSync / themeSystem
///   src/docs/pages/reference.ts          — keyboard / dryFindings
///
/// The original `src/docs/pages.ts` becomes a re-export shim so
/// downstream `from "./pages"` imports keep resolving without churn.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = readFileSync(join(ROOT, "src/docs/pages.ts"), "utf8");
const OUT_DIR = join(ROOT, "src/docs/pages");
mkdirSync(OUT_DIR, { recursive: true });

const lines = SRC.split("\n");

/// Page constants in order — names match what the original file
/// declared. Each maps to a section file.
const SECTIONS = [
  {
    id: "getting-started",
    title: "Getting started",
    file: "getting-started.ts",
    pages: [
      { c: "welcome", id: "welcome", title: "Welcome to Fishbones", tagline: "What this app is and what to expect" },
      { c: "installing", id: "installing", title: "Installing", tagline: "Dev setup, building a release" },
      { c: "firstCourse", id: "first-course", title: "Your first course", tagline: "The 5-minute tour" },
    ],
  },
  {
    id: "architecture",
    title: "Architecture",
    file: "architecture.ts",
    pages: [
      { c: "archOverview", id: "overview", title: "Overview", tagline: "The four layers" },
      { c: "tauriBackend", id: "tauri-backend", title: "The Tauri backend", tagline: "Rust commands, sqlite, and the AI proxy" },
      { c: "reactFrontend", id: "react-frontend", title: "The React frontend", tagline: "View state, components, hooks" },
    ],
  },
  {
    id: "courses",
    title: "Course system",
    file: "courses.ts",
    pages: [
      { c: "courseFormat", id: "course-format", title: "The course format", tagline: ".fishbones, course.json, lesson kinds" },
      { c: "bundledPacks", id: "bundled-packs", title: "Bundled packs", tagline: "First-launch seeding + the marker file" },
    ],
  },
  {
    id: "runtimes",
    title: "Runtime layer",
    file: "runtimes.ts",
    pages: [
      { c: "runtimeLayer", id: "runtime-layer", title: "How code runs", tagline: "Dispatcher, sandboxes, native runtimes" },
      { c: "workbench", id: "workbench", title: "The workbench", tagline: "Multi-file editor, run loop, pop-out" },
      { c: "playgroundDoc", id: "playground", title: "The playground", tagline: "Free-form editor sandbox" },
      { c: "phoneFloating", id: "floating-phone", title: "The floating phone", tagline: "React Native + Svelte mobile preview" },
    ],
  },
  {
    id: "subsystems",
    title: "Subsystems",
    file: "subsystems.ts",
    pages: [
      { c: "ingestPipeline", id: "ingest", title: "The ingest pipeline", tagline: "PDF, docs site, challenge pack generation" },
      { c: "aiAssistant", id: "ai-assistant", title: "The AI assistant", tagline: "Ollama and Anthropic backends" },
      { c: "progressXp", id: "progress", title: "Progress, XP, streaks", tagline: "Completion tracking and the daily counter" },
      { c: "cloudSync", id: "cloud-sync", title: "Cloud sync (optional)", tagline: "Cross-machine progress sync" },
      { c: "themeSystem", id: "theme", title: "The theme system", tagline: "CSS variables, Monaco regeneration" },
    ],
  },
  {
    id: "reference",
    title: "Reference",
    file: "reference.ts",
    pages: [
      { c: "keyboard", id: "keybindings", title: "Keyboard shortcuts", tagline: "Every binding in the app" },
      { c: "dryFindings", id: "dry-findings", title: "Refactor opportunities", tagline: "Audit notes — DRY violations and componentization wins" },
    ],
  },
];

/// Find the [start, end) line range of a `const NAME = \`...\`;`
/// declaration. Walks forward looking for the closing backtick on
/// its own at the start of a line followed by `;`.
function findConstBlock(name) {
  const startRe = new RegExp(`^const ${name} = \\\``);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error(`const ${name} not found`);
  // Walk forward looking for a line that's exactly `\`;` (the
  // canonical pattern this file uses to end every page constant).
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "`;") return { start, end: i };
  }
  throw new Error(`const ${name} unclosed`);
}

// Write each section file.
for (const section of SECTIONS) {
  const blocks = section.pages.map((p) => ({ ...p, ...findConstBlock(p.c) }));
  const body = blocks
    .map((b) => {
      const decl = lines.slice(b.start, b.end + 1).join("\n");
      // Add `export ` prefix.
      return decl.replace(/^const /, "export const ");
    })
    .join("\n\n");

  const out = `/// Auto-split from the original \`src/docs/pages.ts\` monolith. See
/// \`scripts/split-docs.mjs\` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in \`./index.ts\`.

import type { DocsSection } from "../types";

${body}

export const ${section.id.replace(/-/g, "_").toUpperCase()}_SECTION: DocsSection = {
  id: "${section.id}",
  title: "${section.title}",
  pages: [
${section.pages.map((p) => `    { id: "${p.id}", title: "${p.title}", tagline: "${p.tagline}", body: ${p.c} },`).join("\n")}
  ],
};
`;
  writeFileSync(join(OUT_DIR, section.file), out, "utf8");
  console.log(`wrote ${section.file} (${blocks.length} pages)`);
}

// Write index.ts: imports each section, assembles, exports the
// same public symbols the old monolith exposed.
const indexOut = `/// Public surface for documentation pages.
///
/// The original monolithic \`src/docs/pages.ts\` was split into one
/// file per section (\`getting-started.ts\`, \`architecture.ts\`, ...).
/// The shape of \`FISHBONES_DOCS\` and \`FISHBONES_DOCS_INDEX\` is
/// unchanged from the pre-split monolith — downstream code can keep
/// importing from \`../docs/pages\` (the shim in pages.ts forwards).

import type { DocsSection } from "../types";
${SECTIONS.map((s) => `import { ${s.id.replace(/-/g, "_").toUpperCase()}_SECTION } from "./${s.file.replace(".ts", "")}";`).join("\n")}

export const FISHBONES_DOCS: DocsSection[] = [
${SECTIONS.map((s) => `  ${s.id.replace(/-/g, "_").toUpperCase()}_SECTION,`).join("\n")}
];

/// Flat lookup index keyed by page id for routing.
export const FISHBONES_DOCS_INDEX: ReadonlyMap<string, { section: DocsSection; pageIndex: number }> =
  (() => {
    const m = new Map<string, { section: DocsSection; pageIndex: number }>();
    for (const section of FISHBONES_DOCS) {
      section.pages.forEach((p, i) => m.set(p.id, { section, pageIndex: i }));
    }
    return m;
  })();
`;
writeFileSync(join(OUT_DIR, "index.ts"), indexOut, "utf8");
console.log("wrote index.ts");

// Replace the original pages.ts with a re-export shim.
writeFileSync(
  join(ROOT, "src/docs/pages.ts"),
  `/// Re-export shim. The page constants moved into \`./pages/\` —
/// see \`./pages/index.ts\` for the public surface and the splitter
/// commentary in \`scripts/split-docs.mjs\`.
export * from "./pages/index";
`,
  "utf8",
);
console.log("rewrote pages.ts as re-export shim");
