#!/usr/bin/env node
/// Mirror of `src-tauri/src/native_runners.rs::preprocess_zig_source`
/// in JavaScript so we can spot-test lesson sources without rebuilding
/// the desktop app. Strips the user's `pub fn main` / `fn runTest`
/// blocks, then synthesises a fresh main() that uses
/// `_kata_std_.debug.print` (stderr-based, works on every Zig version
/// the runtime supports including 0.16's I/O overhaul).
///
/// Usage:
///   node scripts/run-zig-lesson.mjs <courseFile.json> <lessonId>
///   node scripts/run-zig-lesson.mjs <courseFile.json> --all
///
/// Returns exit 0 when every test PASSes, exit 1 otherwise. Useful in
/// CI and as the "did my fix work?" oracle while iterating on the
/// challenge pack.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [coursePath, lessonArg] = process.argv.slice(2);
if (!coursePath || !lessonArg) {
  console.error("usage: run-zig-lesson.mjs <courseFile.json> <lessonId|--all>");
  process.exit(2);
}

const course = JSON.parse(readFileSync(coursePath, "utf8"));
const lessons = course.chapters.flatMap((ch) => ch.lessons.filter((l) => l.kind === "exercise" || l.kind === "mixed"));

const targets = lessonArg === "--all" ? lessons : lessons.filter((l) => l.id === lessonArg);
if (targets.length === 0) {
  console.error(`no exercise lesson with id "${lessonArg}"`);
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), "fishbones-zig-"));
let totalPass = 0;
let totalFail = 0;
const failures = [];

try {
  for (const lesson of targets) {
    // Mirror runtimes/nativeRunners.ts::runZig: when both sides have a
    // top-level `const std = @import("std");` we strip the test side's
    // copy. Zig forbids duplicate top-level names within a file.
    const dedupedTests = dedupeStdImport(lesson.solution || "", lesson.tests || "");
    const merged = `${lesson.solution || ""}\n${dedupedTests}\n`;
    const file = join(tmp, `lesson-${lesson.id.replace(/[^A-Za-z0-9_-]/g, "_")}.zig`);
    writeFileSync(file, merged, "utf8");

    // spawnSync (vs execFileSync) gives us stderr in BOTH the
    // success and failure paths — execFileSync only stashes stderr on
    // the thrown error object, which means we miss the test-result
    // lines (which always come on stderr) when every test passes.
    //
    // Per-lesson timeout: 20s. Some lessons (custom thread-safe pools,
    // pathological allocator implementations) make `zig test` block
    // indefinitely — without a kill-switch a single lesson can hang
    // the whole pack run. SIGKILL'd lessons are reported as failures
    // with "timed out" so the run still produces useful output.
    const r = spawnSync("zig", ["test", file], {
      encoding: "utf8",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const stdout = r.stdout || "";
    let stderr = r.stderr || "";
    const exitCode = r.status ?? -1;
    if (r.signal === "SIGKILL") {
      stderr = (stderr || "") + "\n--- killed: per-lesson 20s timeout ---";
    }

    // Parse `zig test`'s native per-test lines from stderr.
    // Happy path: `1/3 lesson-foo.test.add basic...OK`
    // Edge case: when the test body itself prints to stderr (via
    // std.debug.print), the output appears INLINE between the
    // test header (`N/M slug.test.name...`) and the trailing status,
    // so the regex needs to be willing to skip across lines.
    const tests = parseZigTestStderr(stderr);

    const passed = tests.filter((t) => t.passed).length;
    const failed = tests.filter((t) => !t.passed).length;
    totalPass += passed;
    totalFail += failed;

    if (tests.length === 0 || failed > 0 || exitCode !== 0) {
      failures.push({ id: lesson.id, exitCode, stdout, stderr, tests });
      console.log(`❌ ${lesson.id} — ${passed} pass / ${failed} fail / exit ${exitCode}`);
      if (lessonArg !== "--all") {
        console.log(stderr.slice(0, 1500));
        console.log("--- merged source (head) ---");
        console.log(merged.split("\n").slice(0, 60).join("\n"));
      }
    } else {
      console.log(`✅ ${lesson.id} — ${passed} test(s) PASS`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nTotals: ${totalPass} PASS · ${totalFail} FAIL · ${failures.length} lesson(s) with errors`);
if (failures.length > 0 && lessonArg === "--all") {
  console.log("\nLessons with failures:");
  for (const f of failures) console.log(`  - ${f.id}`);
}
process.exit(totalFail > 0 || failures.length > 0 ? 1 : 0);

/// Walk stderr looking for test headers `<idx>/<total> <slug>.test.<name>...`
/// The trailing status (OK / FAIL / SKIP) MAY be on the same line OR
/// may appear several lines later when the test body itself wrote to
/// stderr via std.debug.print. We track the active test and resolve
/// it on the first OK/FAIL/SKIP token we find.
function parseZigTestStderr(stderr) {
  const tests = [];
  const headerRe = /\d+\/\d+\s+\S+\.test\.(.+?)\.\.\.(.*)$/;
  // Status can appear at end of header line OR alone on a subsequent
  // line (with optional reason in parens for FAIL).
  const trailingStatusRe = /^(OK|FAIL|SKIP)(?:\s+\((.+?)\))?\s*$/;
  let active = null; // { name, accumulator: [] }
  for (const rawLine of stderr.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const headerMatch = headerRe.exec(line);
    if (headerMatch) {
      // Resolve any in-flight test as a SKIP (no terminator
      // observed) — this only happens with malformed output.
      if (active) {
        tests.push({ name: active.name, passed: false, reason: "no status line" });
      }
      const [, name, trailing] = headerMatch;
      const trailMatch = trailingStatusRe.exec(trailing.trim());
      if (trailMatch) {
        const [, status, reason] = trailMatch;
        if (status !== "SKIP") tests.push({ name, passed: status === "OK", reason: reason || "" });
        active = null;
      } else {
        // Header without inline status — wait for the status to land.
        active = { name };
      }
      continue;
    }
    if (!active) continue;
    const trailMatch = trailingStatusRe.exec(line.trim());
    if (trailMatch) {
      const [, status, reason] = trailMatch;
      if (status !== "SKIP") tests.push({ name: active.name, passed: status === "OK", reason: reason || "" });
      active = null;
    }
  }
  if (active) {
    tests.push({ name: active.name, passed: false, reason: "no status line" });
  }
  return tests;
}

function dedupeStdImport(code, tests) {
  const importRe = /^[ \t]*const\s+std\s*=\s*@import\(\s*"std"\s*\)\s*;[ \t]*\r?\n?/m;
  if (!importRe.test(code)) return tests;
  return tests.replace(importRe, "");
}

// ─── Mimics native_runners.rs::preprocess_zig_source ──────────────────

function preprocessZigSource(code) {
  const cases = parseCasesComment(code) || parseRuntestCalls(code) || autoDetectTestFns(code) || [];
  if (cases.length === 0) return code;

  let stripped = stripTopLevelBlock(code, "pub fn main");
  stripped = stripTopLevelBlock(stripped, "fn runTest");

  const lines = [
    "",
    "// ── Kata harness (auto-generated) ──",
    'const _kata_std_ = @import("std");',
    "",
    "pub fn main() void {",
    ...cases.map(([name, fn]) => `    _kataRunTest_("${name.replace(/"/g, '\\"')}", &${fn});`),
    "}",
    "",
    "fn _kataRunTest_(name: []const u8, body_fn: *const fn () anyerror!void) void {",
    "    if (body_fn()) |_| {",
    '        _kata_std_.debug.print("KATA_TEST::{s}::PASS\\n", .{name});',
    "    } else |err| {",
    '        _kata_std_.debug.print("KATA_TEST::{s}::FAIL::{s}\\n", .{ name, @errorName(err) });',
    "    }",
    "}",
  ].join("\n");
  return stripped + lines;
}

function parseCasesComment(code) {
  const idx = code.indexOf("// CASES:");
  if (idx < 0) return null;
  const lineEnd = code.indexOf("\n", idx);
  const slice = code.slice(idx + "// CASES:".length, lineEnd === -1 ? undefined : lineEnd).trim();
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return null;
    return arr.filter((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string");
  } catch {
    return null;
  }
}

function parseRuntestCalls(code) {
  const re = /runTest\s*\(\s*out\s*,\s*"([^"]+)"\s*,\s*&(\w+)/g;
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) out.push([m[1], m[2]]);
  return out.length > 0 ? out : null;
}

function autoDetectTestFns(code) {
  const names = [];
  const re = /(?:^|[\s;}])fn\s+(test\w+)\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names.length > 0 ? names.map((n) => [pascalToSnake(n.slice(4)) || n, n]) : null;
}

function pascalToSnake(s) {
  return s.replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : "_" + c.toLowerCase()));
}

function stripTopLevelBlock(code, prefix) {
  const idx = code.indexOf(prefix);
  if (idx < 0) return code;
  // Walk to opening brace, then balanced match.
  let i = code.indexOf("{", idx);
  if (i < 0) return code;
  let depth = 1;
  i++;
  while (i < code.length && depth > 0) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    i++;
  }
  if (depth !== 0) return code;
  // Trim trailing whitespace + newline for clean output.
  while (i < code.length && (code[i] === " " || code[i] === "\t")) i++;
  if (code[i] === "\n") i++;
  return code.slice(0, idx) + code.slice(i);
}
