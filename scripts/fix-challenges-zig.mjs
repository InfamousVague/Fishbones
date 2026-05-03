#!/usr/bin/env node
/// Bulk fixer for `challenges-zig-handwritten.json` after the watch-mode
/// verifier surfaced 55/120 lessons failing on Zig 0.16. Three classes of
/// breakage account for almost all failures:
///
///   1. **Markdown autolinker corruption.** Some upstream tool ran the
///      lesson source through a markdown processor that detected
///      domain-shaped tokens like `std.heap.page` and wrapped them in
///      links: `[std.heap.page](http://std.heap.page)_allocator`. The
///      pattern is `\[(X.Y.Z)\]\(https?://X.Y.Z\)Z` → `X.Y.ZZ`.
///
///   2. **Zig 0.15.1 / 0.16 stdlib reshuffles.** Lesson source uses APIs
///      that no longer exist:
///        - `std.heap.GeneralPurposeAllocator(.{}){}` → renamed to
///          `std.heap.DebugAllocator(.{})`.
///        - `std.testing.allocator` → only valid inside `zig test`; we
///          run with `zig run`, so swap to `std.heap.page_allocator`.
///        - `std.ArrayList(T).init(allocator)` → list is unmanaged-by-
///          default now: `var list: std.ArrayList(T) = .empty;` and
///          callers pass the allocator to `.append` / `.deinit`.
///
///   3. **Tests duplicate symbols the user already declares.** Several
///      tests reach for `const Foo = @import("user.zig").Foo;` so
///      they'd compile in isolation. After the runtime concatenates
///      `solution + tests`, both files share scope and the import
///      tries to redeclare what the solution already exports. Strip
///      the `const X = @import("user...").X;` lines.
///
/// What this DOES NOT fix:
///   - Custom allocator vtables (`alloc(ctx, len, ptr_align: u8, ...)`
///     → `Alignment` enum). 6-8 lessons need real rewrites.
///   - `@Type(.{ .Struct = ... })` syntax change (2 lessons).
///   - `comptime { ... return X; }` from a runtime fn (3 lessons).
///   - Per-lesson logic bugs (~5 lessons).
/// Those are flagged in the run summary so we can address them
/// individually.
///
/// Usage:
///   node scripts/fix-challenges-zig.mjs
/// Then re-pack the fishbones archive and re-deploy.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const COURSE_PATH = join(ROOT, "public", "starter-courses", "challenges-zig-handwritten.json");

const course = JSON.parse(readFileSync(COURSE_PATH, "utf8"));

// ── Fix 1: Unmangle markdown autolinker output ────────────────────────
//
// The processor matched dotted identifiers as URLs. Examples:
//   [std.heap.page](http://std.heap.page)_allocator → std.heap.page_allocator
//   [allocator.free](http://allocator.free)(slice)  → allocator.free(slice)
//   [self.free](http://self.free)_list              → self.free_list
//   [std_kata.io](http://std_kata.io).getStdOut()   → std_kata.io.getStdOut()
//
// Pattern: square-bracketed token, then a parenthesised URL, then
// optional underscore-suffix. The underscore-suffix is the giveaway —
// without it we'd risk eating real markdown links the lesson author
// might have written. (Authoring convention is that all real links go
// in the prose `body`, not in code samples, so this is safe.)
const MARKDOWN_LINK_RE = /\[([\w.]+)\]\(https?:\/\/[\w.\-]+\)/g;
function unmangleMarkdown(s) {
  if (!s) return s;
  return s.replace(MARKDOWN_LINK_RE, (_, ident) => ident);
}

// ── Fix 2: Strip duplicate `@import("user…")` declarations ────────────
//
// Tests sometimes pull symbols back in via `const Foo =
// @import("user.zig").Foo;`. After concatenation that's a redeclaration
// of whatever the user's solution already declared with `pub const Foo
// = ...`. Drop those lines outright — the symbol is already in scope.
//
// Cover both `user`, `user.zig`, and `solution.zig` (lessons mix
// conventions).
const USER_IMPORT_RE = /^[ \t]*(?:pub\s+)?const\s+\w+\s*=\s*@import\(\s*"(?:user|user\.zig|solution\.zig|solution)"\s*\)\.\w+\s*;[ \t]*\r?\n/gm;
function stripUserImports(s) {
  if (!s) return s;
  return s.replace(USER_IMPORT_RE, "");
}

// ── Fix 3: Replace `std.testing.allocator` with page_allocator ────────
//
// `std.testing.allocator` errors out at compile time outside `zig test`
// (which we don't use — we run via `zig run` for the harness). Swap to
// `std.heap.page_allocator` which works in any mode and doesn't need
// init/deinit ceremony.
function replaceTestingAllocator(s) {
  if (!s) return s;
  return s.replace(/std\.testing\.allocator\b/g, "std.heap.page_allocator");
}

// ── Fix 4: GeneralPurposeAllocator → DebugAllocator (or page) ─────────
//
// Zig 0.15.1 renamed the type. The full setup pattern is:
//   var gpa = std.heap.GeneralPurposeAllocator(.{}){};
//   defer _ = gpa.deinit();
//   const allocator = gpa.allocator();
// We collapse the whole 3-line dance to one line using page_allocator.
// page_allocator costs an mmap per request but the test harness only
// runs once per lesson — durability beats throughput.
const GPA_BLOCK_RE = /var\s+(\w+)\s*=\s*std\.heap\.GeneralPurposeAllocator\(\.\{\}\)\{\}\s*;\s*\r?\n\s*defer\s+_\s*=\s*\1\.deinit\(\)\s*;\s*\r?\n\s*const\s+(\w+)\s*=\s*\1\.allocator\(\)\s*;/g;
function replaceGpaBlock(s) {
  if (!s) return s;
  let next = s.replace(GPA_BLOCK_RE, (_, _gpa, name) => `const ${name} = std.heap.page_allocator;`);
  // Also catch any stray reference to the old name on its own (e.g.
  // when authors only used the type, not the full setup).
  next = next.replace(/std\.heap\.GeneralPurposeAllocator\b/g, "std.heap.DebugAllocator");
  return next;
}

// ── Fix 5: ArrayList unmanaged-default migration ──────────────────────
//
// Pre-0.15: `std.ArrayList(T).init(allocator)` returned a list that
// stored the allocator. `list.append(item)`, `list.deinit()`.
// Post-0.15: list is a value `.empty`, methods take the allocator
// explicitly: `list.append(allocator, item)`, `list.deinit(allocator)`.
//
// This is more aggressive than the others — we touch lots of patterns:
//   - declaration: `var list = std.ArrayList(T).init(alloc);` →
//     `var list: std.ArrayList(T) = .empty;`
//   - deinit: `list.deinit();` → `list.deinit(<alloc>);` (we look up
//     the allocator from a same-scope `const alloc = ...` line).
//   - append: `list.append(item);` → `list.append(alloc, item);`
//
// Because the rewrite needs the allocator name in scope, we operate
// per-lesson. If we can't safely identify the allocator (no obvious
// `const X = ... .allocator()` or page_allocator declaration), we
// SKIP the lesson and surface it in the report — better to keep the
// original (broken on 0.16) than risk a wrong rewrite that also
// breaks on older Zig.
function migrateArrayList(source, contextSource) {
  if (!source) return { source, didChange: false };
  // Find a same-scope allocator name. We accept anything spelled
  // `const X = ...page_allocator;`, `const X = arena.allocator();`,
  // `const X = pool.allocator();`, or a function param literally
  // named `allocator`. The function-param case covers the bulk of the
  // failing lessons because they're all variations on
  // `pub fn foo(allocator: std.mem.Allocator, ...)`.
  const allocName = inferAllocatorName(source) ?? inferAllocatorName(contextSource ?? "");
  if (!allocName) return { source, didChange: false };

  let next = source;
  let didChange = false;

  // Replace `var X = std.ArrayList(T).init(<alloc>);` with the new
  // `var X: std.ArrayList(T) = .empty;` form. The allocator is dropped
  // here because subsequent calls take it explicitly.
  next = next.replace(
    /var\s+(\w+)\s*=\s*std\.ArrayList\(([^)]+)\)\.init\(([^)]+)\)\s*;/g,
    (_match, name, T) => {
      didChange = true;
      return `var ${name}: std.ArrayList(${T}) = .empty;`;
    },
  );

  // Replace `<list>.deinit();` with `<list>.deinit(<alloc>);` — only
  // when the list was declared in this source via `var X: std.ArrayList…
  // = .empty;` (so we don't accidentally rewrite calls into HashMaps
  // or other types whose deinit() takes no allocator).
  const declaredLists = [...next.matchAll(/var\s+(\w+)\s*:\s*std\.ArrayList\(/g)].map((m) => m[1]);
  for (const listName of declaredLists) {
    const deinitRe = new RegExp(`(?<![A-Za-z0-9_])${listName}\\.deinit\\(\\)`, "g");
    const before = next;
    next = next.replace(deinitRe, `${listName}.deinit(${allocName})`);
    if (next !== before) didChange = true;
    // Same for append: `list.append(item)` → `list.append(alloc, item)`.
    // Defensive: only touch single-arg append calls; don't double-prefix.
    const appendRe = new RegExp(`(?<![A-Za-z0-9_])${listName}\\.append\\((?!\\s*${allocName}\\b)([^()]*)\\)`, "g");
    const beforeApp = next;
    next = next.replace(appendRe, (_m, args) => `${listName}.append(${allocName}, ${args})`);
    if (next !== beforeApp) didChange = true;
    // toOwnedSlice is similar.
    const tosRe = new RegExp(`(?<![A-Za-z0-9_])${listName}\\.toOwnedSlice\\(\\)`, "g");
    const beforeTos = next;
    next = next.replace(tosRe, `${listName}.toOwnedSlice(${allocName})`);
    if (next !== beforeTos) didChange = true;
  }

  return { source: next, didChange };
}

function inferAllocatorName(source) {
  if (!source) return null;
  // 1. function parameter literally named `allocator` or `alloc`.
  if (/\((?:[^)]*,\s*)?(allocator|alloc)\s*:\s*(?:std\.mem\.)?Allocator\b/.test(source)) {
    return /\bAllocator\b/.test(source) && /\b(allocator)\s*:/.test(source)
      ? "allocator"
      : "alloc";
  }
  // 2. Local `const allocator = ...page_allocator;` or `.allocator()`.
  const localMatch = /const\s+(allocator|alloc)\s*=\s*(?:std\.heap\.[\w_]+|\w+\.allocator\(\))\s*;/.exec(source);
  if (localMatch) return localMatch[1];
  return null;
}

// ── Apply fixes ───────────────────────────────────────────────────────

const stats = {
  total: 0,
  changed: 0,
  markdownUnmangle: 0,
  userImportStrip: 0,
  testingAllocator: 0,
  gpaBlock: 0,
  arrayList: 0,
};

const arrayListSkipped = [];

for (const ch of course.chapters) {
  for (const lesson of ch.lessons) {
    if (lesson.kind !== "exercise" && lesson.kind !== "mixed") continue;
    stats.total++;

    const before = JSON.stringify({ s: lesson.starter, sol: lesson.solution, t: lesson.tests });

    // Apply mechanical transforms across all three text fields. Order
    // matters slightly: unmangle first (so subsequent regexes see real
    // syntax), then test-import strip (so we don't try to migrate
    // ArrayList in a soon-to-be-removed line), then GPA collapse, then
    // testing-allocator swap, then ArrayList API.
    for (const field of ["starter", "solution", "tests"]) {
      const original = lesson[field];
      if (!original) continue;
      let next = original;
      const u = unmangleMarkdown(next);
      if (u !== next) { stats.markdownUnmangle++; next = u; }
      if (field === "tests") {
        const stripped = stripUserImports(next);
        if (stripped !== next) { stats.userImportStrip++; next = stripped; }
      }
      const t = replaceTestingAllocator(next);
      if (t !== next) { stats.testingAllocator++; next = t; }
      const g = replaceGpaBlock(next);
      if (g !== next) { stats.gpaBlock++; next = g; }
      lesson[field] = next;
    }

    // ArrayList migration runs separately — it needs both the
    // current source AND the sibling source for context (tests need
    // to see the solution's allocator-named param to know what to
    // pass through).
    for (const field of ["solution", "tests"]) {
      if (!lesson[field]) continue;
      const sibling = field === "solution" ? lesson.tests : lesson.solution;
      const { source: migrated, didChange } = migrateArrayList(lesson[field], sibling);
      if (didChange) {
        stats.arrayList++;
        lesson[field] = migrated;
      } else if (/std\.ArrayList\([^)]+\)\.init\(/.test(lesson[field])) {
        // Source still uses the old API but we couldn't safely migrate
        // — flag it so we know to look at it manually.
        arrayListSkipped.push(`${lesson.id}#${field}`);
      }
    }

    const after = JSON.stringify({ s: lesson.starter, sol: lesson.solution, t: lesson.tests });
    if (before !== after) stats.changed++;
  }
}

writeFileSync(COURSE_PATH, JSON.stringify(course, null, 2) + "\n", "utf8");

console.log("\n[fix-challenges-zig] done.");
console.log(`  total exercise lessons: ${stats.total}`);
console.log(`  lessons changed:        ${stats.changed}`);
console.log(`  ── per-fix counts (fields touched, not lessons) ──`);
console.log(`  markdown unmangle:      ${stats.markdownUnmangle}`);
console.log(`  user-import strip:      ${stats.userImportStrip}`);
console.log(`  testing allocator swap: ${stats.testingAllocator}`);
console.log(`  GPA → page_allocator:   ${stats.gpaBlock}`);
console.log(`  ArrayList migration:    ${stats.arrayList}`);
if (arrayListSkipped.length) {
  console.log(`\n  ArrayList lessons SKIPPED (couldn't infer allocator name):`);
  for (const s of arrayListSkipped) console.log(`    - ${s}`);
}
console.log(`\n  output: ${COURSE_PATH}`);
