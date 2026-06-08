#!/usr/bin/env node
// Compile-driven fixer for `rust playground` fences in the TRPL course.
//
// WHY: the inline "Run" sandbox compiles each `rust playground` fence as a
// standalone binary via `rustc --edition 2021 -C opt-level=0` (see
// src-tauri/src/native_runners.rs::run_rust). A fence that opens with bare
// statements (`let x = ...;`, `println!(...)`) has no `fn main`, so rustc
// rejects it ("`let` cannot be used for global variables"). A fence that is
// only item definitions with no `fn main` fails with "main function not found".
//
// Unlike the older heuristic wrapper (scripts/fix-trpl-playground-wrap.mjs,
// which guessed from the first token and patched the INSTALLED app copy), this
// one is ground-truth: it actually compiles every fence with the same flags the
// app uses, wraps only the ones that DON'T compile, and keeps a wrap only if it
// makes the fence compile. Rust allows items (fn/struct/enum/impl/use) nested
// inside `fn main`, so a single `fn main { ...original... }` wrap is safe for
// statements, definitions, or a mix.
//
// Usage:
//   node scripts/fix-trpl-playground-compile.mjs <course.json>   # fix in place
//   node scripts/fix-trpl-playground-compile.mjs <course.json> --check  # report only
//
// Idempotent: an already-compiling fence (incl. ones with `fn main`) is left
// untouched. Run it after any re-extract — but the durable fix is to bake the
// fixed course.json back into the .academy so re-extract starts from green.

import { readFileSync, writeFileSync, mkdtempSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const coursePath = process.argv[2];
const checkOnly = process.argv.includes("--check");
if (!coursePath) {
  console.error("usage: fix-trpl-playground-compile.mjs <course.json> [--check]");
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), "trpl-pg-"));
let counter = 0;

function compile(code) {
  return new Promise((resolve) => {
    const src = join(tmp, `f${counter++}.rs`);
    const out = src.replace(/\.rs$/, ".out");
    wf(src, code);
    execFile(
      "rustc",
      ["--edition", "2021", "-C", "opt-level=0", "-o", out, src],
      { timeout: 30000 },
      (err, _stdout, stderr) => resolve({ ok: !err, stderr: stderr || "" }),
    );
  });
}

function indent(code, n) {
  const pad = " ".repeat(n);
  return code
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

function wrapInMain(code) {
  return `fn main() {\n${indent(code.replace(/\n+$/, ""), 4)}\n}`;
}

// simple concurrency pool
async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const course = JSON.parse(readFileSync(coursePath, "utf8"));
const lessons = course.chapters.flatMap((ch) => ch.lessons || []);

// Collect every rust playground fence.
const fenceRe = /```rust[^\n]*\bplayground\b[^\n]*\n([\s\S]*?)```/g;
const targets = []; // {lesson, full, code}
for (const l of lessons) {
  const body = l.body || "";
  let m;
  while ((m = fenceRe.exec(body)) !== null) {
    targets.push({ lesson: l, full: m[0], code: m[1] });
  }
}

console.log(`Found ${targets.length} rust playground fences across ${lessons.length} lessons. Compiling…`);

const results = await mapPool(targets, 6, async (t) => {
  const first = await compile(t.code);
  if (first.ok) return { t, status: "ok" };
  if (/fn\s+main\s*\(/.test(t.code)) {
    return { t, status: "broken-has-main", err: firstError(first.stderr) };
  }
  const wrapped = wrapInMain(t.code);
  const second = await compile(wrapped);
  if (second.ok) return { t, status: "fixed", wrapped };
  return { t, status: "broken-after-wrap", err: firstError(second.stderr) };
});

function firstError(stderr) {
  const line = stderr.split("\n").find((l) => /error/i.test(l));
  return (line || stderr.split("\n")[0] || "").trim().slice(0, 140);
}

const ok = results.filter((r) => r.status === "ok");
const fixed = results.filter((r) => r.status === "fixed");
const brokenMain = results.filter((r) => r.status === "broken-has-main");
const brokenWrap = results.filter((r) => r.status === "broken-after-wrap");

console.log(`\n  already-compiling : ${ok.length}`);
console.log(`  fixed by fn main  : ${fixed.length}`);
console.log(`  still broken      : ${brokenMain.length + brokenWrap.length}`);

for (const r of [...brokenMain, ...brokenWrap]) {
  console.log(`    ✗ ${r.t.lesson.id} [${r.status}] ${r.err}`);
}

if (!checkOnly && fixed.length) {
  // Apply each wrap by replacing the exact fence text. Rebuild the fence with
  // the SAME info string and wrapped code.
  for (const r of fixed) {
    const info = r.t.full.match(/```([^\n]*)\n/)[1];
    const newFence = "```" + info + "\n" + r.wrapped + "\n```";
    r.t.lesson.body = r.t.lesson.body.replace(r.t.full, newFence);
  }
  writeFileSync(coursePath, JSON.stringify(course, null, 2));
  console.log(`\n✓ wrote ${fixed.length} fixed fence(s) → ${coursePath}`);
  console.log("  fixed lessons: " + [...new Set(fixed.map((r) => r.t.lesson.id))].join(", "));
} else if (checkOnly) {
  console.log("\n(check-only: no changes written)");
} else {
  console.log("\nNothing to fix.");
}

process.exit(brokenMain.length + brokenWrap.length > 0 ? 1 : 0);
