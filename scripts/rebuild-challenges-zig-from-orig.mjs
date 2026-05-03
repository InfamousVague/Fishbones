#!/usr/bin/env node
/// Rebuild `challenges-zig-handwritten.json` from the original
/// LLM-generated source (extracted from git via the `e2083ac` commit's
/// .fishbones archive into `/tmp/zig-orig/course.json`). Replays the
/// fix passes correctly this time:
///
///   1. **Strip `@import("user.zig").X` re-imports.** Tests pulled
///      symbols back in for stand-alone-compilation purposes; after
///      the runtime concatenates `solution + tests`, those imports
///      collide with the user's own `pub const X` declarations.
///
///   2. **Strip duplicate top-level decls** — but only when they're
///      truly at column 0. The previous v2 used `^[ \t]*const X` which
///      caught indented locals too — that's how `const result = ...`
///      and `const allocator = arena.allocator();` got nuked from
///      every test body. The corrected matcher is anchored to
///      `(?:^|\n)(?:pub\s+)?(?:const|var|fn)\s+X\b` with NO leading
///      whitespace allowed, so locals are safe.
///
///   3. **Modernise for Zig 0.16:**
///        - `std.heap.GeneralPurposeAllocator(.{}){}` (with full
///          init / deinit / .allocator() dance) → collapse to
///          `const X = std.heap.page_allocator;` (page_allocator is
///          available in every Zig version we target and skips the
///          ceremony).
///        - `std.testing.allocator` → `std.heap.page_allocator`
///          (testing.allocator only works inside `zig test` proper,
///          which we now use, BUT it leaks-detects so tests that
///          previously "passed" by leaking start failing — we'll
///          want to swap back to testing.allocator once those
///          lessons are individually validated).
///        - `std.ArrayList(T).init(allocator)` → unmanaged form
///          `var list: std.ArrayList(T) = .empty;` with allocator
///          passed to each mutating call.
///
///   4. **Convert to native `test "name" {}` blocks.** Walks each
///      `fn testFoo() !void { body }` declaration in the test source,
///      maps its name through the `// CASES: [...]` comment for a
///      human-readable label, and emits `test "<name>" { body }`. The
///      runtime now dispatches to `zig test` (see
///      src-tauri/src/native_runners.rs::run_zig) so these blocks run
///      directly without any harness synthesis.
///
/// Usage:  node scripts/rebuild-challenges-zig-from-orig.mjs
/// Reads:  /tmp/zig-orig/course.json (extract from git first if missing)
/// Writes: public/starter-courses/challenges-zig-handwritten.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ORIG_PATH = "/tmp/zig-orig/course.json";
const OUT_PATH = join(ROOT, "public", "starter-courses", "challenges-zig-handwritten.json");

if (!existsSync(ORIG_PATH)) {
  console.error(`missing ${ORIG_PATH} — run:`);
  console.error("  mkdir -p /tmp/zig-orig && git show e2083ac:src-tauri/resources/bundled-packs/challenges-zig-handwritten.fishbones > /tmp/zig-orig/pack.fishbones && cd /tmp/zig-orig && unzip -o pack.fishbones");
  process.exit(2);
}

const course = JSON.parse(readFileSync(ORIG_PATH, "utf8"));

const stats = {
  total: 0,
  testsImportStripped: 0,
  duplicateDeclsStripped: 0,
  gpaCollapsed: 0,
  testingAllocatorSwapped: 0,
  arrayListMigrated: 0,
  convertedToNative: 0,
  alreadyNative: 0,
  unconvertible: [],
};

for (const ch of course.chapters) {
  for (const lesson of ch.lessons) {
    if (lesson.kind !== "exercise" && lesson.kind !== "mixed") continue;
    if (lesson.language !== "zig") continue;
    stats.total++;

    // ── Pass 1: strip `const X = @import("user…").X;` from tests ───
    if (lesson.tests) {
      const before = lesson.tests;
      lesson.tests = lesson.tests.replace(
        /^[ \t]*(?:pub\s+)?const\s+\w+\s*=\s*@import\(\s*"(?:user|user\.zig|solution|solution\.zig)"\s*\)\.\w+\s*;[ \t]*\r?\n/gm,
        "",
      );
      if (before !== lesson.tests) stats.testsImportStripped++;
    }

    // ── Pass 2: strip TRULY top-level duplicates from tests ───────
    // Only column-0 decls in the solution count. Locals inside fn
    // bodies don't collide with anything in the test code.
    if (lesson.tests && lesson.solution) {
      const beforeStrip = lesson.tests;
      lesson.tests = stripTopLevelDuplicates(lesson.solution, lesson.tests);
      if (beforeStrip !== lesson.tests) stats.duplicateDeclsStripped++;
    }

    // ── Pass 3: collapse GPA setup to page_allocator ──────────────
    for (const field of ["solution", "tests"]) {
      if (!lesson[field]) continue;
      const before = lesson[field];
      const collapsed = lesson[field].replace(
        /var\s+(\w+)\s*=\s*std\.heap\.GeneralPurposeAllocator\(\.\{\}\)\{\}\s*;\s*\r?\n\s*defer\s+_\s*=\s*\1\.deinit\(\)\s*;\s*\r?\n\s*const\s+(\w+)\s*=\s*\1\.allocator\(\)\s*;/g,
        (_, _gpa, name) => `const ${name} = std.heap.page_allocator;`,
      );
      // Stray references to the renamed type.
      lesson[field] = collapsed.replace(/std\.heap\.GeneralPurposeAllocator\b/g, "std.heap.DebugAllocator");
      if (before !== lesson[field]) stats.gpaCollapsed++;
    }

    // ── Pass 4: testing.allocator → page_allocator ────────────────
    for (const field of ["solution", "tests"]) {
      if (!lesson[field]) continue;
      const before = lesson[field];
      lesson[field] = lesson[field].replace(/std\.testing\.allocator\b/g, "std.heap.page_allocator");
      if (before !== lesson[field]) stats.testingAllocatorSwapped++;
    }

    // ── Pass 5: ArrayList API migration ───────────────────────────
    for (const field of ["solution", "tests"]) {
      if (!lesson[field]) continue;
      const sibling = field === "solution" ? lesson.tests : lesson.solution;
      const { source, didChange } = migrateArrayList(lesson[field], sibling);
      if (didChange) {
        lesson[field] = source;
        stats.arrayListMigrated++;
      }
    }

    // ── Pass 6: convert tests to native `test "name" {}` blocks ───
    if (lesson.tests) {
      if (/\btest\s+"[^"]+"\s*\{/.test(lesson.tests)) {
        stats.alreadyNative++;
      } else {
        const converted = convertToNativeTests(lesson.tests);
        if (converted == null) {
          stats.unconvertible.push(lesson.id);
        } else {
          lesson.tests = converted;
          stats.convertedToNative++;
        }
      }
    }
  }
}

writeFileSync(OUT_PATH, JSON.stringify(course, null, 2) + "\n", "utf8");

console.log("\n[rebuild-challenges-zig] done.");
console.log(`  total exercise lessons: ${stats.total}`);
console.log(`  test imports stripped:  ${stats.testsImportStripped}`);
console.log(`  duplicate decls strip:  ${stats.duplicateDeclsStripped}`);
console.log(`  GPA → page_allocator:   ${stats.gpaCollapsed}`);
console.log(`  testing.allocator swap: ${stats.testingAllocatorSwapped}`);
console.log(`  ArrayList migrated:     ${stats.arrayListMigrated}`);
console.log(`  converted to native:    ${stats.convertedToNative}`);
console.log(`  already native:         ${stats.alreadyNative}`);
if (stats.unconvertible.length) {
  console.log(`  unconvertible (manual): ${stats.unconvertible.length}`);
  for (const id of stats.unconvertible) console.log(`    - ${id}`);
}
console.log(`\n  output: ${OUT_PATH}`);

// ─── Helpers ──────────────────────────────────────────────────────────

/// Find ONLY truly column-0 declarations. The previous v2 used
/// `^[ \t]*…` which caught indented locals — exactly the bug that
/// stripped `const result = …;` and `const allocator = arena.allocator();`
/// from every test body. The fixed pattern requires no leading
/// whitespace, so it can only match decls that start at the very left
/// margin of a line.
function topLevelNamesStrict(code) {
  if (!code) return [];
  const out = [];
  const re = /(?:^|\n)(?:pub\s+)?(?:const|var|fn)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

function stripTopLevelDuplicates(solution, tests) {
  const solNames = new Set(topLevelNamesStrict(solution));
  if (solNames.size === 0) return tests;
  let next = tests;
  let attempts = 0;
  while (attempts++ < 30) {
    const testNames = topLevelNamesStrict(next);
    const dupe = testNames.find((n) => solNames.has(n));
    if (!dupe) break;
    const stripped = stripTopLevelDeclByName(next, dupe);
    if (stripped === next) break;
    next = stripped;
  }
  return next;
}

function stripTopLevelDeclByName(code, name) {
  // Find the column-0 occurrence of `(pub )?(const|var|fn) <name>`.
  const re = new RegExp(`(?:^|\\n)((?:pub\\s+)?(?:const|var|fn)\\s+${name}\\b)`, "");
  const m = re.exec(code);
  if (!m) return code;
  const declStart = m.index + (code[m.index] === "\n" ? 1 : 0);
  const end = findEndOfTopLevelBlock(code, declStart);
  if (end == null) return code;
  // Eat trailing newline for clean output.
  let cleanup = end;
  while (cleanup < code.length && (code[cleanup] === " " || code[cleanup] === "\t")) cleanup++;
  if (code[cleanup] === "\n") cleanup++;
  return code.slice(0, declStart) + code.slice(cleanup);
}

/// Walk forward from `start` (which points at a top-level decl
/// keyword) and return the byte position just past the end of the
/// declaration. Handles three forms:
///   const X = expr;               → terminated by `;` at depth 0
///   const X = struct { ... };     → balanced `{...}` then `;`
///   fn X(...) ... { ... }         → balanced `{...}`
function findEndOfTopLevelBlock(code, start) {
  let i = start;
  let braceDepth = 0;
  let parenDepth = 0;
  let hitOpenBrace = false;
  let inLine = false;
  let inBlock = false;
  let inStr = false;
  let strQ = "";
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (inLine) { if (c === "\n") inLine = false; i++; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) {
      if (c === "\\") { i += 2; continue; }
      if (c === strQ) inStr = false;
      i++; continue;
    }
    if (c === "/" && n === "/") { inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'") { inStr = true; strQ = c; i++; continue; }
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    else if (c === "{") { braceDepth++; hitOpenBrace = true; }
    else if (c === "}") {
      braceDepth--;
      if (braceDepth === 0 && parenDepth === 0 && hitOpenBrace) {
        // After a `}` at depth 0, look ahead for an optional `;`.
        let j = i + 1;
        while (j < code.length && (code[j] === " " || code[j] === "\t")) j++;
        if (code[j] === ";") return j + 1;
        return i + 1;
      }
    } else if (c === ";" && braceDepth === 0 && parenDepth === 0 && !hitOpenBrace) {
      return i + 1;
    }
    i++;
  }
  return null;
}

/// Migrate ArrayList from managed (.init(allocator)) to unmanaged
/// (.empty + per-call allocator). Same logic as fix-challenges-zig.mjs
/// v1 — see that file for the heuristics. Returns
/// `{ source, didChange }`.
function migrateArrayList(source, contextSource) {
  if (!source) return { source, didChange: false };
  const allocName = inferAllocatorName(source) ?? inferAllocatorName(contextSource ?? "");
  if (!allocName) return { source, didChange: false };
  let next = source;
  let didChange = false;
  next = next.replace(
    /var\s+(\w+)\s*=\s*std\.ArrayList\(([^)]+)\)\.init\(([^)]+)\)\s*;/g,
    (_match, name, T) => {
      didChange = true;
      return `var ${name}: std.ArrayList(${T}) = .empty;`;
    },
  );
  const declaredLists = [...next.matchAll(/var\s+(\w+)\s*:\s*std\.ArrayList\(/g)].map((m) => m[1]);
  for (const listName of declaredLists) {
    const before = next;
    next = next.replace(new RegExp(`(?<![A-Za-z0-9_])${listName}\\.deinit\\(\\)`, "g"), `${listName}.deinit(${allocName})`);
    if (next !== before) didChange = true;
    const beforeApp = next;
    next = next.replace(new RegExp(`(?<![A-Za-z0-9_])${listName}\\.append\\((?!\\s*${allocName}\\b)([^()]*)\\)`, "g"), (_m, args) => `${listName}.append(${allocName}, ${args})`);
    if (next !== beforeApp) didChange = true;
    const beforeTos = next;
    next = next.replace(new RegExp(`(?<![A-Za-z0-9_])${listName}\\.toOwnedSlice\\(\\)`, "g"), `${listName}.toOwnedSlice(${allocName})`);
    if (next !== beforeTos) didChange = true;
  }
  return { source: next, didChange };
}

function inferAllocatorName(source) {
  if (!source) return null;
  if (/\((?:[^)]*,\s*)?(allocator|alloc)\s*:\s*(?:std\.mem\.)?Allocator\b/.test(source)) {
    return /\b(allocator)\s*:/.test(source) ? "allocator" : "alloc";
  }
  const localMatch = /const\s+(allocator|alloc)\s*=\s*(?:std\.heap\.[\w_]+|\w+\.allocator\(\))\s*;/.exec(source);
  if (localMatch) return localMatch[1];
  return null;
}

function convertToNativeTests(testsSource) {
  const cases = parseCasesComment(testsSource);
  const fnSpans = findTestFnSpans(testsSource);
  if (fnSpans.length === 0) return null;
  const displayNameOf = (fnName) => {
    const fromCases = cases.find(([, fn]) => fn === fnName);
    if (fromCases) return fromCases[0];
    if (fnName.startsWith("test") && fnName.length > 4) return pascalToSnake(fnName.slice(4));
    return fnName;
  };
  let out = "";
  let cursor = 0;
  for (const span of fnSpans) {
    out += testsSource.slice(cursor, span.declStart);
    const display = displayNameOf(span.fnName).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const body = testsSource.slice(span.bodyStart, span.bodyEnd);
    out += `test "${display}" ${body}`;
    cursor = span.declEnd;
  }
  out += testsSource.slice(cursor);
  out = out.replace(/^[ \t]*\/\/\s*CASES:[^\n]*\r?\n?/m, "");

  // Strip orphan harness leftovers from the original 5 hand-written
  // lessons (hello / add / reverse_string / is_palindrome / sum_array).
  // Their old test source ended with:
  //   fn runTest(out: anytype, name: []const u8, body_fn: ...) !void {...}
  //   pub fn main() !void { runTest(out, "...", &testFoo) catch {}; ... }
  // After the conversion above wraps `fn testFoo()` into `test "foo" {}`,
  // the `runTest` and `main` blocks reference fn names (`testFoo`,
  // `out`) that no longer exist. They're both dead AND a compile
  // error. Strip them entirely.
  out = stripTopLevelByName(out, "runTest");
  out = stripTopLevelByName(out, "main");

  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

/// Strip a top-level `fn <name>(...) ... { ... }` block (with
/// optional `pub` prefix). Walks balanced braces so multi-line bodies
/// are removed cleanly. Used to evict orphan `pub fn main` and
/// `fn runTest` helpers left behind after `fn testFoo()` declarations
/// got rewritten into `test "foo" {}` blocks.
function stripTopLevelByName(code, name) {
  const re = new RegExp(`(?:^|\\n)([ \\t]*)(?:pub\\s+)?fn\\s+${name}\\s*\\(`, "");
  const m = re.exec(code);
  if (!m) return code;
  const declStart = m.index + (code[m.index] === "\n" ? 1 : 0);
  // Find the opening `{` after the signature, then walk balanced braces.
  let i = code.indexOf("{", declStart);
  if (i < 0) return code;
  let depth = 1;
  i++;
  while (i < code.length && depth > 0) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  if (depth !== 0) return code;
  // Eat one trailing newline for clean output.
  while (i < code.length && (code[i] === " " || code[i] === "\t")) i++;
  if (code[i] === "\n") i++;
  return code.slice(0, declStart) + code.slice(i);
}

function findTestFnSpans(source) {
  const spans = [];
  const declRe = /(?:^|[\s;}])\b(?:pub\s+)?fn\s+(test\w+)\s*\([^)]*\)[\s\w!]*\{/g;
  let m;
  while ((m = declRe.exec(source)) !== null) {
    const fnName = m[1];
    const matchStart = m.index + (source[m.index] === "\n" || /[\s;}]/.test(source[m.index]) ? 1 : 0);
    const declStart = matchStart;
    const bodyStart = m.index + m[0].length - 1;
    let depth = 0, i = bodyStart;
    let inStr = false, strQ = "", inLine = false, inBlock = false;
    while (i < source.length) {
      const c = source[i];
      const n = source[i + 1];
      if (inLine) { if (c === "\n") inLine = false; i++; continue; }
      if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i += 2; continue; } i++; continue; }
      if (inStr) {
        if (c === "\\") { i += 2; continue; }
        if (c === strQ) inStr = false;
        i++; continue;
      }
      if (c === "/" && n === "/") { inLine = true; i += 2; continue; }
      if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
      if (c === '"' || c === "'") { inStr = true; strQ = c; i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    if (depth !== 0) continue;
    spans.push({ fnName, declStart, declEnd: i, bodyStart, bodyEnd: i });
    declRe.lastIndex = i;
  }
  return spans;
}

function parseCasesComment(source) {
  const idx = source.indexOf("// CASES:");
  if (idx < 0) return [];
  const lineEnd = source.indexOf("\n", idx);
  const slice = source.slice(idx + "// CASES:".length, lineEnd === -1 ? undefined : lineEnd).trim();
  try {
    const arr = JSON.parse(slice);
    return arr.filter((p) => Array.isArray(p) && p.length === 2);
  } catch {
    return [];
  }
}

function pascalToSnake(s) {
  return s.replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : "_" + c.toLowerCase()));
}
