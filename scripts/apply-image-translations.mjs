#!/usr/bin/env node
/// Localize image descriptions in a de-duplicated course.
///
/// After `dedupe-course-images.mjs`, every image is `![alt](asset://<hash>
/// "caption")`. The English body carries the canonical alt/caption; each
/// `translations[locale].body` should carry the SAME image with alt +
/// caption translated. This applies a per-locale translation table
/// (keyed by image hash) so every image description is localized —
/// overwriting any that were left in English.
///
/// Usage:
///   node scripts/apply-image-translations.mjs <course.json> <translations.json> [--in-place] [--out <path>]
///
/// translations.json shape: { "<locale>": [ { hash, alt, caption }, … ] }
///
/// The alt's size-class prefix (hero:/wide:/float:/tall:/small:/seal:)
/// MUST already be preserved inside the translated `alt` — this script
/// substitutes verbatim.

import { readFileSync, writeFileSync } from "node:fs";

const [inputArg, transArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!inputArg || !transArg) {
  console.error("usage: apply-image-translations.mjs <course.json> <translations.json> [--in-place] [--out <path>]");
  process.exit(1);
}
const flags = process.argv.slice(2);
const inPlace = flags.includes("--in-place");
const outIdx = flags.indexOf("--out");
const out = outIdx >= 0 ? flags[outIdx + 1] : inPlace ? inputArg : inputArg.replace(/\.json$/, ".localized.json");

const course = JSON.parse(readFileSync(inputArg, "utf8"));
const trans = JSON.parse(readFileSync(transArg, "utf8"));

// locale → hash → { alt, caption }
const table = {};
for (const [loc, entries] of Object.entries(trans)) {
  table[loc] = {};
  for (const e of entries) table[loc][e.hash] = { alt: e.alt ?? "", caption: e.caption ?? "" };
}

/// Markdown image title lives inside "..." — a caption containing a
/// double quote would break the fence. Swap any embedded double quotes
/// for typographic ones so the markdown stays valid.
const safeCaption = (s) => s.replace(/"/g, "”");
/// Alt lives inside [...]; a literal ] would break it.
const safeAlt = (s) => s.replace(/\]/g, ")");

let rewrites = 0;
let missing = 0;

/// Rewrite every `![*](asset://<hash> …)` in a body using the locale's
/// translation for that hash.
function localizeBody(body, loc) {
  const map = table[loc];
  if (!map) return body;
  return body.replace(
    /!\[[^\]]*\]\(asset:\/\/([a-f0-9]+)(?:\s+"[^"]*")?\)/g,
    (full, hash) => {
      const t = map[hash];
      if (!t) {
        missing++;
        return full; // no translation for this image — leave as-is
      }
      rewrites++;
      const cap = t.caption ? ` "${safeCaption(t.caption)}"` : "";
      return `![${safeAlt(t.alt)}](asset://${hash}${cap})`;
    },
  );
}

/// Walk lessons, rewriting each `translations[locale].body`.
function walkLessons(node) {
  if (Array.isArray(node)) {
    node.forEach(walkLessons);
    return;
  }
  if (!node || typeof node !== "object") return;
  const tr = node.translations;
  if (tr && typeof tr === "object") {
    for (const [loc, overlay] of Object.entries(tr)) {
      if (overlay && typeof overlay === "object" && typeof overlay.body === "string") {
        overlay.body = localizeBody(overlay.body, loc);
      }
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "translations" || k === "images") continue;
    walkLessons(v);
  }
}

walkLessons(course);
writeFileSync(out, JSON.stringify(course));

console.log(
  JSON.stringify(
    { input: inputArg, out, localesApplied: Object.keys(table), imageDescriptionsRewritten: rewrites, unmatchedImages: missing },
    null,
    2,
  ),
);
