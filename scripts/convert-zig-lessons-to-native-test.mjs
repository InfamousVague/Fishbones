#!/usr/bin/env node
/// Convert every Zig lesson's test code from the legacy
/// `fn testFoo() !void { ... } // CASES: [...]` shape to native
/// `test "foo" { ... }` blocks that `zig test` runs directly.
///
/// Source shape (legacy):
///
///   fn testNormalCase() !void {
///       const result = sumSlice(&[_]i32{1, 2, 3, 4});
///       if (result != 10) return error.WrongAnswer;
///   }
///   // CASES: [["normal case", "testNormalCase"], …]
///
/// Target shape (native):
///
///   test "normal case" {
///       const result = sumSlice(&[_]i32{1, 2, 3, 4});
///       if (result != 10) return error.WrongAnswer;
///   }
///
/// The CASES comment supplies human-readable names; we use those when
/// available and fall back to a snake_cased version of the function
/// name otherwise (e.g. `testNormalCase` → `normal_case`).
///
/// Lessons that already use `test "name" {}` blocks are left alone.
/// The runtime's `runZig` parses `zig test`'s native output format —
/// see `src/runtimes/nativeRunners.ts::parseZigTestOutput` for the
/// regex — so once a lesson is converted it doesn't need any other
/// runtime support.
///
/// Usage:
///   node scripts/convert-zig-lessons-to-native-test.mjs <courseFile.json>
///
/// Idempotent: re-runs are no-ops once a lesson is converted.

import { readFileSync, writeFileSync } from "node:fs";

const coursePath = process.argv[2];
if (!coursePath) {
  console.error("usage: convert-zig-lessons-to-native-test.mjs <courseFile.json>");
  process.exit(2);
}
const course = JSON.parse(readFileSync(coursePath, "utf8"));

const stats = { total: 0, converted: 0, alreadyNative: 0, noTestFns: 0 };

for (const ch of course.chapters) {
  for (const lesson of ch.lessons) {
    if (lesson.kind !== "exercise" && lesson.kind !== "mixed") continue;
    if (!lesson.tests) continue;
    if (lesson.language !== "zig") continue;
    stats.total++;

    if (/\btest\s+"[^"]+"\s*\{/.test(lesson.tests)) {
      stats.alreadyNative++;
      continue;
    }
    const converted = convertLesson(lesson.tests);
    if (converted == null) {
      stats.noTestFns++;
      continue;
    }
    lesson.tests = converted;
    stats.converted++;
  }
}

writeFileSync(coursePath, JSON.stringify(course, null, 2) + "\n", "utf8");
console.log(`[convert-zig-lessons] done.`);
console.log(`  zig exercise lessons: ${stats.total}`);
console.log(`  converted:            ${stats.converted}`);
console.log(`  already native test:  ${stats.alreadyNative}`);
console.log(`  no test fns found:    ${stats.noTestFns}`);
console.log(`  output: ${coursePath}`);

// ─── Conversion logic ────────────────────────────────────────────────

function convertLesson(testsSource) {
  const cases = parseCasesComment(testsSource);
  const fnSpans = findTestFnSpans(testsSource);
  if (fnSpans.length === 0) return null;

  // Map fn name → human-readable display from CASES, fall back to the
  // snake-cased fn name with the leading "test" stripped. Falls back
  // to the raw fn name as the last resort.
  const displayNameOf = (fnName) => {
    const fromCases = cases.find(([, fn]) => fn === fnName);
    if (fromCases) return fromCases[0];
    if (fnName.startsWith("test") && fnName.length > 4) {
      return pascalToSnake(fnName.slice(4));
    }
    return fnName;
  };

  // Build the new source by walking the original byte-by-byte and
  // splicing in `test "..." { … }` blocks where each `fn testFoo() …`
  // declaration starts/ends. Anything outside a fn span is kept
  // verbatim, except the trailing `// CASES:` comment which we drop
  // (the names are baked into the test labels now).
  let out = "";
  let cursor = 0;
  for (const span of fnSpans) {
    out += testsSource.slice(cursor, span.declStart);
    const display = displayNameOf(span.fnName);
    const safeDisplay = display.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const body = testsSource.slice(span.bodyStart, span.bodyEnd); // includes outer braces
    out += `test "${safeDisplay}" ${body}`;
    cursor = span.declEnd;
  }
  out += testsSource.slice(cursor);

  // Drop the `// CASES: [...]` comment (single line).
  out = out.replace(/^[ \t]*\/\/\s*CASES:[^\n]*\r?\n?/m, "");

  // Tidy up double-blank-line runs the splicing might have left.
  out = out.replace(/\n{3,}/g, "\n\n");

  return out;
}

/// Find every top-level `fn testFoo() !void { … }` declaration.
/// Returns spans with byte offsets so the caller can splice in the
/// `test "…" { … }` replacement without touching surrounding text.
function findTestFnSpans(source) {
  const spans = [];
  // Match `(pub )? fn testIdent ( … ) !void {` — capture the name.
  // We don't anchor to ^ because some lessons indent the fn under a
  // chapter-grouping comment; but we DO require the prev char to be
  // a real boundary so we don't match `myfn test...`.
  const declRe = /(?:^|[\s;}])\b(?:pub\s+)?fn\s+(test\w+)\s*\([^)]*\)[\s\w!]*\{/g;
  let m;
  while ((m = declRe.exec(source)) !== null) {
    const fnName = m[1];
    const matchStart = m.index + (source[m.index] === "\n" || /[\s;}]/.test(source[m.index]) ? 1 : 0);
    const declStart = matchStart;
    // Body starts at the matched `{`; walk balanced braces forward.
    const bodyStart = m.index + m[0].length - 1; // position of `{`
    let depth = 0;
    let i = bodyStart;
    let inString = false;
    let stringQuote = "";
    let inLineComment = false;
    let inBlockComment = false;
    while (i < source.length) {
      const c = source[i];
      const nextC = source[i + 1];
      if (inLineComment) {
        if (c === "\n") inLineComment = false;
        i++; continue;
      }
      if (inBlockComment) {
        if (c === "*" && nextC === "/") { inBlockComment = false; i += 2; continue; }
        i++; continue;
      }
      if (inString) {
        if (c === "\\") { i += 2; continue; }
        if (c === stringQuote) { inString = false; }
        i++; continue;
      }
      if (c === "/" && nextC === "/") { inLineComment = true; i += 2; continue; }
      if (c === "/" && nextC === "*") { inBlockComment = true; i += 2; continue; }
      if (c === '"' || c === "'") { inString = true; stringQuote = c; i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    if (depth !== 0) continue; // give up on this span — leave verbatim
    spans.push({ fnName, declStart, declEnd: i, bodyStart, bodyEnd: i });
    declRe.lastIndex = i; // resume past the body
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
    if (!Array.isArray(arr)) return [];
    return arr.filter((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string");
  } catch {
    return [];
  }
}

function pascalToSnake(s) {
  return s.replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : "_" + c.toLowerCase()));
}
