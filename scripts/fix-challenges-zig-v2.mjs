#!/usr/bin/env node
/// Round 2 of bulk fixes for `challenges-zig-handwritten.json`. After
/// v1 cleared the `@import("user.zig").X` lines and the
/// GeneralPurposeAllocator / testing.allocator / ArrayList migrations,
/// many tests STILL refused to compile because they ALSO inline the
/// entire solution at the top of the test file.
///
/// Concrete example (`easy-enums-40` after v1):
///   tests starts with the literal `const TrafficLight = enum { ... };`
///   plus `pub fn nextLight(...) TrafficLight { ... }` — the same
///   declarations the solution exports. After concatenation we get
///   `error: duplicate struct member name 'TrafficLight'`.
///
/// The reliable fix: scan the SOLUTION for the names of every top-level
/// declaration it exposes (`pub const X = ...`, `pub fn X(...) ...`,
/// `const X = ...`, `fn X(...)`), then walk the TEST file and strip
/// any top-level block that re-declares any of those same names.
/// "Top-level block" is identified by the keyword + name + balanced
/// braces, so we don't accidentally cut into a function body.
///
/// We also strip stale `const std = @import("std");` / `const
/// Allocator = std.mem.Allocator;` lines from tests when they're
/// already declared in the solution — same compiler error category.
///
/// Usage: node scripts/fix-challenges-zig-v2.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const COURSE_PATH = join(ROOT, "public", "starter-courses", "challenges-zig-handwritten.json");

const course = JSON.parse(readFileSync(COURSE_PATH, "utf8"));

/// Find every top-level declaration name in `code`. Returns names in
/// declaration order.
///
/// Match grammar — what counts as top-level:
///   - line begins (after optional whitespace) with `const`, `var`,
///     `pub const`, `pub var`, `fn`, or `pub fn`
///   - we don't try to parse imports / aliases beyond capturing the
///     name; the strip pass works on the whole declaration block,
///     not on signatures.
function topLevelNames(code) {
  if (!code) return [];
  const names = [];
  const re = /^[ \t]*(?:pub\s+)?(?:const|var|fn)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;
  let m;
  while ((m = re.exec(code)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/// Remove the top-level declaration of `name` from `code`. Walks
/// balanced braces / parens / equals-then-semicolon to find the end of
/// the block. Returns the modified source and a flag indicating
/// whether anything changed. Conservative: if we can't confidently
/// find the end of the block, return the source unchanged.
function stripTopLevelDecl(code, name) {
  if (!code) return { code, changed: false };
  // Locate the start of a `(pub )?(const|var|fn) <name>` line.
  const startRe = new RegExp(
    `^[ \\t]*(?:pub\\s+)?(?:const|var|fn)\\s+${name}\\b`,
    "m",
  );
  const startMatch = startRe.exec(code);
  if (!startMatch) return { code, changed: false };
  const startIdx = startMatch.index;
  // Walk forward to find the end. Three shapes to handle:
  //   1. `const X = something;` (terminated by `;`)
  //   2. `const X = struct/enum/union {...};` (balanced braces, then `;`)
  //   3. `fn X(...) ... { ... }` (balanced braces, no trailing `;`)
  // We walk char-by-char tracking brace depth. If we see a `;` at
  // depth 0 OR a `}` at depth-going-0 followed by optional whitespace
  // and a newline, we stop.
  let i = startIdx;
  let braceDepth = 0;
  let parenDepth = 0;
  let hitOpenBrace = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringQuote = "";
  while (i < code.length) {
    const c = code[i];
    const nextC = code[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && nextC === "/") { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inString) {
      if (c === "\\") { i += 2; continue; }
      if (c === stringQuote) { inString = false; }
      i++;
      continue;
    }
    if (c === "/" && nextC === "/") { inLineComment = true; i += 2; continue; }
    if (c === "/" && nextC === "*") { inBlockComment = true; i += 2; continue; }
    if (c === '"' || c === "'") { inString = true; stringQuote = c; i++; continue; }
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    else if (c === "{") { braceDepth++; hitOpenBrace = true; }
    else if (c === "}") {
      braceDepth--;
      if (braceDepth === 0 && parenDepth === 0 && hitOpenBrace) {
        // Possible end of `fn X() { ... }` OR `const X = struct {...}`.
        // For the const-struct case we still need a trailing `;`. Look
        // ahead — if next non-whitespace is `;` consume it; otherwise
        // assume fn and stop right here.
        let j = i + 1;
        while (j < code.length && (code[j] === " " || code[j] === "\t")) j++;
        if (code[j] === ";") {
          i = j; // include the semicolon
        }
        // Consume trailing newline if present, for clean output.
        let k = i + 1;
        while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;
        if (code[k] === "\n") i = k;
        return { code: code.slice(0, startIdx) + code.slice(i + 1), changed: true };
      }
    } else if (c === ";" && braceDepth === 0 && parenDepth === 0 && !hitOpenBrace) {
      // Plain `const X = ...;` form.
      let k = i + 1;
      while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;
      if (code[k] === "\n") i = k;
      return { code: code.slice(0, startIdx) + code.slice(i + 1), changed: true };
    }
    i++;
  }
  return { code, changed: false };
}

// ── Apply ─────────────────────────────────────────────────────────────

const stats = { total: 0, lessonsChanged: 0, declsStripped: 0 };
const skipped = [];

for (const ch of course.chapters) {
  for (const lesson of ch.lessons) {
    if (lesson.kind !== "exercise" && lesson.kind !== "mixed") continue;
    stats.total++;

    const solutionNames = new Set(topLevelNames(lesson.solution));
    if (solutionNames.size === 0) continue;
    if (!lesson.tests) continue;

    let next = lesson.tests;
    let changedAny = false;
    let attempts = 0;
    // Loop because stripping one decl might surface another at the
    // newly-exposed top of the file. Cap at 20 iterations as a
    // safety net.
    while (attempts++ < 20) {
      const testNames = topLevelNames(next);
      const dupe = testNames.find((n) => solutionNames.has(n));
      if (!dupe) break;
      const { code, changed } = stripTopLevelDecl(next, dupe);
      if (!changed) {
        skipped.push(`${lesson.id} → ${dupe} (couldn't strip)`);
        break;
      }
      next = code;
      changedAny = true;
      stats.declsStripped++;
    }

    if (changedAny) {
      lesson.tests = next;
      stats.lessonsChanged++;
    }
  }
}

writeFileSync(COURSE_PATH, JSON.stringify(course, null, 2) + "\n", "utf8");

console.log("\n[fix-challenges-zig v2] done.");
console.log(`  total exercise lessons: ${stats.total}`);
console.log(`  lessons modified:       ${stats.lessonsChanged}`);
console.log(`  duplicate decls stripped: ${stats.declsStripped}`);
if (skipped.length) {
  console.log(`\n  skipped (manual review):`);
  for (const s of skipped) console.log(`    - ${s}`);
}
