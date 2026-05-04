#!/usr/bin/env node
/// Split `src/runtimes/playgroundTemplates.ts` (845 lines) into a
/// folder where each multi-file template (web, react, react-native,
/// threejs) gets its own file and the rest live in a single
/// `single-file.ts` map. Then a thin `index.ts` assembles the
/// `PLAYGROUND_TEMPLATES` Record + exports the helper.
///
/// Layout:
///   src/runtimes/playgroundTemplates/_core.ts          — Template type + templateFiles()
///   src/runtimes/playgroundTemplates/multi-file/web.ts
///   src/runtimes/playgroundTemplates/multi-file/react.ts
///   src/runtimes/playgroundTemplates/multi-file/react-native.ts
///   src/runtimes/playgroundTemplates/multi-file/threejs.ts
///   src/runtimes/playgroundTemplates/single-file.ts    — all single-file template entries
///   src/runtimes/playgroundTemplates/index.ts          — assembles PLAYGROUND_TEMPLATES + helper

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = readFileSync(join(ROOT, "src/runtimes/playgroundTemplates.ts"), "utf8");
const OUT_DIR = join(ROOT, "src/runtimes/playgroundTemplates");
mkdirSync(join(OUT_DIR, "multi-file"), { recursive: true });

const lines = SRC.split("\n");

/// Find the [start, end) line range of a `const NAME = [...]` block.
/// Walks forward until a `];` at column 0 closes it.
function findArrayConst(name) {
  const re = new RegExp(`^const ${name}: WorkbenchFile\\[\\] = \\[`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { start = i; break; }
  }
  if (start < 0) throw new Error(`${name} not found`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "];") return { start, end: i };
  }
  throw new Error(`${name} unclosed`);
}

const MULTI_FILE_TEMPLATES = [
  { variable: "WEB_TEMPLATE_FILES", file: "web.ts", langKey: "web", filename: "index.html", fileLanguage: "html" },
  { variable: "REACT_NATIVE_TEMPLATE_FILES", file: "react-native.ts", langKey: "reactnative", filename: "App.js", fileLanguage: "javascript" },
  { variable: "THREEJS_TEMPLATE_FILES", file: "threejs.ts", langKey: "threejs", filename: "index.html", fileLanguage: "html" },
  { variable: "REACT_TEMPLATE_FILES", file: "react.ts", langKey: "react", filename: "App.jsx", fileLanguage: "javascript" },
];

// Write each multi-file template to its own file.
for (const t of MULTI_FILE_TEMPLATES) {
  const { start, end } = findArrayConst(t.variable);
  // Pull the comment block above the const (consecutive ///-prefixed
  // lines that lead into the decl).
  let bannerStart = start - 1;
  while (bannerStart >= 0 && lines[bannerStart].startsWith("///")) bannerStart--;
  bannerStart++;
  const banner = lines.slice(bannerStart, start).join("\n");
  const body = lines.slice(start, end + 1).join("\n").replace(/^const /, "export const ");
  const out = `/// Auto-split from the original \`src/runtimes/playgroundTemplates.ts\`
/// monolith. See \`scripts/split-playground-templates.mjs\` for the
/// splitter. Each multi-file template gets its own file; single-file
/// templates live together in \`../single-file.ts\`.

import type { WorkbenchFile } from "../../../data/types";

${banner}
${body}
`;
  writeFileSync(join(OUT_DIR, "multi-file", t.file), out, "utf8");
  console.log(`wrote multi-file/${t.file}`);
}

// Find the PLAYGROUND_TEMPLATES record start + end.
const recordStart = lines.findIndex((l) =>
  l.startsWith("export const PLAYGROUND_TEMPLATES:"),
);
if (recordStart < 0) throw new Error("PLAYGROUND_TEMPLATES not found");
let braceDepth = 0;
let recordEnd = -1;
for (let i = recordStart; i < lines.length; i++) {
  for (const c of lines[i]) {
    if (c === "{") braceDepth++;
    else if (c === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        recordEnd = i;
        break;
      }
    }
  }
  if (recordEnd >= 0) break;
}
if (recordEnd < 0) throw new Error("PLAYGROUND_TEMPLATES unclosed");

// Pull each language entry from the record. Each entry starts with
// `  langName: {` and ends at the matching `},`. We capture them in
// order so single-file.ts can preserve the original ordering.
const recordLines = lines.slice(recordStart + 1, recordEnd);
const entries = []; // { lang, raw }
let i = 0;
while (i < recordLines.length) {
  const m = /^\s\s([a-zA-Z]+):\s*\{/.exec(recordLines[i]);
  if (!m) {
    i++;
    continue;
  }
  const lang = m[1];
  const startLine = i;
  let depth = 1;
  i++;
  while (i < recordLines.length && depth > 0) {
    for (const c of recordLines[i]) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    if (depth === 0) {
      // include trailing comma if present
      let endLine = i;
      if (recordLines[i + 1] === "" || (recordLines[i + 1] && recordLines[i + 1].startsWith("  //"))) {
        // entries are separated by blank lines or comment banners
      }
      const rawBody = recordLines.slice(startLine, endLine + 1).join("\n");
      entries.push({ lang, raw: rawBody });
      i++;
      break;
    }
    i++;
  }
}

// Multi-file langs get their entry shape derived from the import:
const isMultiFile = new Set(MULTI_FILE_TEMPLATES.map((t) => t.langKey));
const singleEntries = entries.filter((e) => !isMultiFile.has(e.lang));
const multiEntriesByLang = new Map(entries.filter((e) => isMultiFile.has(e.lang)).map((e) => [e.lang, e.raw]));

// Write single-file.ts containing all the small one-liner templates
// in their original order.
const singleFileOut = `/// Auto-split from the original \`src/runtimes/playgroundTemplates.ts\`
/// monolith. Holds every single-file template entry — the small
/// "Hello, world!" snippets that the playground reaches for when a
/// learner first opens a language. Multi-file templates (web,
/// react, react-native, threejs) live in \`./multi-file/\`.

import type { Template } from "./_core";

/// Subset of the PLAYGROUND_TEMPLATES record: the languages whose
/// playground starter is a single file. Assembled into the full
/// record in \`./index.ts\`.
export const SINGLE_FILE_TEMPLATES = {
${singleEntries.map((e) => e.raw).join("\n").replace(/^/gm, "")}
} satisfies Record<string, Template>;
`;
writeFileSync(join(OUT_DIR, "single-file.ts"), singleFileOut, "utf8");
console.log("wrote single-file.ts");

// Write _core.ts: the Template interface + the templateFiles helper.
const coreOut = `/// Shared type + helper for playground templates. The
/// monolithic original lived in \`../playgroundTemplates.ts\` —
/// see \`./index.ts\` for the assembled \`PLAYGROUND_TEMPLATES\`
/// record.

import type { FileLanguage, LanguageId, WorkbenchFile } from "../../data/types";

/// One template entry. \`files\` is the multi-file form (web /
/// react / react-native / threejs); single-file templates leave
/// it undefined and \`templateFiles()\` synthesises a single
/// \`WorkbenchFile\` from \`filename\` + \`fileLanguage\` + \`content\`.
export interface Template {
  /// Default workbench filename — e.g. \`main.go\`, \`user.py\`. Matches
  /// the single-file-lesson conventions in
  /// \`src/lib/workbenchFiles.ts\`. Only used by \`templateFiles()\` for
  /// single-file templates.
  filename: string;
  /// Monaco / syntax-highlight language id. Only used by
  /// \`templateFiles()\` for single-file templates.
  fileLanguage: FileLanguage;
  /// Starter content. For multi-file templates (\`files\` is set)
  /// this is used as the LEGACY single-file fallback — new code
  /// paths check \`files\` first.
  content: string;
  /// When set, \`templateFiles()\` returns this multi-file array
  /// instead of synthesising a single file from
  /// \`filename\` + \`content\`. Used by the web + three.js +
  /// react / react-native templates which need
  /// HTML + CSS + JS side-by-side from the first paint.
  files?: WorkbenchFile[];
}

/// Resolve the starter-file set for a playground language. Multi-file
/// templates (web, threejs) return their full file array; single-file
/// templates synthesize one \`WorkbenchFile\` from the template's
/// filename + fileLanguage + content. Cloned so downstream edits can't
/// poison the template singleton.
export function templateFiles(
  templates: Record<LanguageId, Template>,
  language: LanguageId,
): WorkbenchFile[] {
  const t = templates[language];
  if (t.files && t.files.length > 0) {
    return t.files.map((f) => ({ ...f }));
  }
  return [
    {
      name: t.filename,
      language: t.fileLanguage,
      content: t.content,
    },
  ];
}
`;
writeFileSync(join(OUT_DIR, "_core.ts"), coreOut, "utf8");
console.log("wrote _core.ts");

// Index assembles PLAYGROUND_TEMPLATES from the multi-file imports +
// the single-file map, and re-exports the same public symbols the
// monolith did (PLAYGROUND_TEMPLATES + templateFiles).
const indexOut = `/// Public surface for playground templates.
///
/// The original monolithic \`src/runtimes/playgroundTemplates.ts\`
/// was split into:
///   - \`_core.ts\`            — Template type + templateFiles helper
///   - \`single-file.ts\`      — every single-file Hello-world template
///   - \`multi-file/<lang>.ts\` — one file per multi-file template
/// This index re-assembles \`PLAYGROUND_TEMPLATES\` so downstream
/// code can keep importing from \`../playgroundTemplates\`.

import type { LanguageId, WorkbenchFile } from "../../data/types";
import { templateFiles as templateFilesImpl, type Template } from "./_core";
import { SINGLE_FILE_TEMPLATES } from "./single-file";
${MULTI_FILE_TEMPLATES.map((t) => `import { ${t.variable} } from "./multi-file/${t.file.replace(".ts", "")}";`).join("\n")}

export type { Template };

export const PLAYGROUND_TEMPLATES: Record<LanguageId, Template> = {
  ...(SINGLE_FILE_TEMPLATES as Record<LanguageId, Template>),
${MULTI_FILE_TEMPLATES.map((t) => `  ${t.langKey}: {
    filename: "${t.filename}",
    fileLanguage: "${t.fileLanguage}",
    content: ${t.variable}[0].content,
    files: ${t.variable},
  },`).join("\n")}
};

export function templateFiles(language: LanguageId): WorkbenchFile[] {
  return templateFilesImpl(PLAYGROUND_TEMPLATES, language);
}
`;
writeFileSync(join(OUT_DIR, "index.ts"), indexOut, "utf8");
console.log("wrote index.ts");

// Replace original with re-export shim.
writeFileSync(
  join(ROOT, "src/runtimes/playgroundTemplates.ts"),
  `/// Re-export shim. Templates moved into \`./playgroundTemplates/\` —
/// see \`./playgroundTemplates/index.ts\` for the public surface and
/// the splitter commentary in \`scripts/split-playground-templates.mjs\`.
export * from "./playgroundTemplates/index";
`,
  "utf8",
);
console.log("rewrote playgroundTemplates.ts as re-export shim");
