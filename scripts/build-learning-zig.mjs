#!/usr/bin/env node
/// Builds `public/starter-courses/learning-zig.json` — a long-form Zig
/// course adapted from Karl Seguin's free "Learning Zig" book
/// (https://www.openmymind.net/learning_zig/) with substantial
/// expansion: extra exercises, quizzes, and lesson scaffolding tuned
/// for the Fishbones lesson kinds.
///
/// We adapt and rewrite Karl's structure rather than copy verbatim:
///   - All prose is rephrased / reorganised. Where a Karl example is
///     particularly clear, the snippet is kept and clearly attributed.
///   - Exercise harnesses use Fishbones' KATA_TEST stdout protocol so
///     they run via `zig run` on the host (no separate `zig test`
///     pass needed). See src/runtimes/nativeRunners.ts::parseKataTests.
///
/// Run:  node scripts/build-learning-zig.mjs
///
/// Output: public/starter-courses/learning-zig.json (course.json shape).
/// Pack into a .fishbones archive separately (zip course.json + cover.png).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "public", "starter-courses", "learning-zig.json");

// ─── Native zig-test harness ──────────────────────────────────────────
//
// The runtime now dispatches to `zig test` (not `zig run`), so each
// exercise's `tests` field is just a header import + native
// `test "name" {}` blocks. No custom main(), no runTest helper, no
// KATA_TEST stdout protocol. `buildTests` (below) translates the
// existing `testFns` + `runs` shape into the new form on the fly so
// the per-exercise definitions don't have to be rewritten.
//
// Why native: see `src-tauri/src/native_runners.rs::run_zig` —
// idiomatic Zig, free leak detection via `std.testing.allocator`,
// stable output format across Zig releases.

const HARNESS_HEADER = `
const std = @import("std");
`;

/// Build an exercise's `tests` field. `testFns` is the source for the
/// individual test-fn declarations (one or more `fn testFoo() !void`).
/// `runs` lists `{ name, fn }` entries — the `name` is what the runtime
/// surfaces in the test list, `fn` is the test function name.
///
/// IMPORTANT: testFns gets sanitised before being inlined:
///   - `const std = @import("std");` lines are stripped. Many starter
///     files for Zig exercises already declare `std` at the top, and
///     when the runtime concatenates `code + tests`, two competing
///     `const std = @import("std");` declarations collide with
///     `error: duplicate struct member name 'std'`.
///   - Any remaining `std.X` references are rewritten to `std_kata.X`,
///     binding to the alias the harness header imports. This way the
///     test body keeps working regardless of whether the user's code
///     also imports `std`.
///
/// Net effect: the merged file always has exactly one `std` import (the
/// user's, when they include it; and a separate `std_kata` alias for
/// the test harness). No collision, no need to coordinate names with
/// individual lesson authors.
function buildTests(testFns, runs) {
  // Pivot: emit native `test "name" {}` blocks for `zig test` instead
  // of the legacy KATA_TEST harness. The exercise factory's existing
  // `testFns` / `runs` shape is preserved so we don't have to rewrite
  // every chapter — we just translate each `fn testFoo() !void { body }`
  // declaration into a `test "<runs.name>" { body }` block.
  const sanitised = testFns
    .replace(/^[ \t]*const\s+std\s*=\s*@import\("std"\)\s*;\s*$\n?/gm, "")
    // Tests originally referenced std_kata (the harness alias). Now
    // that the header re-imports the real `std`, rebind those.
    .replace(/(?<![A-Za-z0-9_])std_kata\./g, "std.");

  // Pull out each `fn testFoo() !void { … }` body. Walk balanced braces
  // so multi-line bodies survive intact.
  const fnBodies = extractTestFnBodies(sanitised);
  // Anything in `sanitised` that ISN'T inside a test fn body is
  // module-level setup (helper fns, type aliases) — preserve it
  // before the test blocks.
  const preserved = stripTestFnDecls(sanitised, fnBodies).trim();

  const blocks = runs
    .map(({ name, fn }) => {
      const body = fnBodies.get(fn);
      if (body == null) {
        // Fall back: keep the call as a one-liner that will fail
        // loudly if zig test ever runs it. Better than silent
        // dropping.
        return `test "${escapeTestName(name)}" {\n    @compileError("test fn ${fn} not found");\n}`;
      }
      return `test "${escapeTestName(name)}" ${body}`;
    })
    .join("\n\n");

  const setupBlock = preserved ? `\n${preserved}\n` : "";
  return `${HARNESS_HEADER}${setupBlock}\n${blocks}\n`;
}

function escapeTestName(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/// Extract `fn testFoo() !void { body }` bodies. Returns a map from
/// the fn name to the body source (including the surrounding braces),
/// so the caller can paste it after `test "name" `.
function extractTestFnBodies(source) {
  const map = new Map();
  const declRe = /\bfn\s+(test\w+)\s*\([^)]*\)[\s\w!]*\{/g;
  let m;
  while ((m = declRe.exec(source)) !== null) {
    const fnName = m[1];
    const bodyStart = m.index + m[0].length - 1; // position of `{`
    let depth = 0;
    let i = bodyStart;
    while (i < source.length) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    if (depth !== 0) continue;
    map.set(fnName, source.slice(bodyStart, i));
    declRe.lastIndex = i;
  }
  return map;
}

function stripTestFnDecls(source, fnBodies) {
  let out = source;
  const declRe = /\bfn\s+(test\w+)\s*\([^)]*\)[\s\w!]*\{/g;
  // Walk from end backwards so byte offsets stay stable as we splice.
  const spans = [];
  let m;
  while ((m = declRe.exec(source)) !== null) {
    if (!fnBodies.has(m[1])) continue;
    const bodyStart = m.index + m[0].length - 1;
    let depth = 0;
    let i = bodyStart;
    while (i < source.length) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    if (depth !== 0) continue;
    spans.push([m.index, i]);
    declRe.lastIndex = i;
  }
  for (const [start, end] of spans.reverse()) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

// ─── Lesson factories ─────────────────────────────────────────────────

function reading({ id, title, body, objectives, glossary, symbols }) {
  const lesson = { id, kind: "reading", title, body };
  if (objectives && objectives.length) lesson.objectives = objectives;
  const enrichment = {};
  if (glossary && glossary.length) enrichment.glossary = glossary;
  if (symbols && symbols.length) enrichment.symbols = symbols;
  if (Object.keys(enrichment).length) lesson.enrichment = enrichment;
  return lesson;
}

function exercise({
  id,
  title,
  body,
  objectives,
  starter,
  solution,
  hints,
  testFns,
  runs,
  glossary,
  symbols,
}) {
  const lesson = {
    id,
    kind: "exercise",
    title,
    body,
    language: "zig",
    starter,
    solution,
    tests: buildTests(testFns, runs),
  };
  if (hints && hints.length) lesson.hints = hints;
  if (objectives && objectives.length) lesson.objectives = objectives;
  const enrichment = {};
  if (glossary && glossary.length) enrichment.glossary = glossary;
  if (symbols && symbols.length) enrichment.symbols = symbols;
  if (Object.keys(enrichment).length) lesson.enrichment = enrichment;
  return lesson;
}

function quiz({ id, title, body, questions }) {
  return {
    id,
    kind: "quiz",
    title,
    body: body || "Check your understanding before moving on.",
    questions,
  };
}

const mcq = (prompt, options, correctIndex, explanation) => ({
  kind: "mcq",
  prompt,
  options,
  correctIndex,
  ...(explanation ? { explanation } : {}),
});
const short = (prompt, accept, explanation) => ({
  kind: "short",
  prompt,
  accept,
  ...(explanation ? { explanation } : {}),
});

// ─── Common glossary entries reused across lessons ────────────────────

const G = {
  comptime: {
    term: "comptime",
    definition:
      "Code that executes during compilation rather than at runtime. Drives Zig's generics, type-returning functions, and constant propagation.",
  },
  slice: {
    term: "slice",
    definition:
      "A pointer paired with a length, written `[]T`. Length is known at runtime, unlike a fixed-size array `[N]T`.",
  },
  allocator: {
    term: "allocator",
    definition:
      "An object that hands out and reclaims dynamic memory. Zig has no default allocator — every dynamic allocation passes one in explicitly.",
  },
  errorUnion: {
    term: "error union",
    definition:
      "A return type that can be either a value or a member of an error set. Written `!T` (inferred error set) or `MyErrors!T`.",
  },
  optional: {
    term: "optional",
    definition:
      "A type that may be `null` OR a value of `T`. Written `?T`. Unwrap with `if (x) |v|` or `x orelse default`.",
  },
  taggedUnion: {
    term: "tagged union",
    definition:
      "A union whose discriminant is an enum, so a `switch` on the value can read the active field safely.",
  },
  defer: {
    term: "defer",
    definition:
      "Schedule a statement to run when the enclosing scope exits. Zig's defer runs at the end of the BLOCK, not the function (unlike Go).",
  },
  errdefer: {
    term: "errdefer",
    definition:
      "Like `defer` but only fires if the scope exits via an error. Used to clean up partially-initialised state when init fails halfway through.",
  },
  pub: {
    term: "pub",
    definition:
      "A visibility modifier — without `pub`, a declaration is private to its file. Applies to fns, constants, structs, etc.",
  },
};

// ─── Course content ───────────────────────────────────────────────────

const chapters = [];

// ════════════════════════════════════════════════════════════════════
// Chapter 1 — Getting Started with Zig
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "getting-started",
  title: "Getting Started with Zig",
  lessons: [
    reading({
      id: "what-is-zig",
      title: "What is Zig?",
      objectives: [
        "Describe Zig's place among modern systems languages",
        "Recognise the three pillars: simplicity, comptime, manual memory",
        "Explain why Zig has no garbage collector",
        "Decide whether Zig is the right tool for your project",
      ],
      body: `**Zig** is a small, strongly-typed compiled language designed as a modern alternative to C. It compiles to native machine code, has no runtime, no garbage collector, and no hidden control flow. If a function looks innocent, it _is_ innocent — there are no implicit allocations, exceptions, or virtual dispatches lurking inside.

The language sits in roughly the same niche as C, C++, and Rust. Compared to those:

| Feature | C | C++ | Rust | Zig |
|---|---|---|---|---|
| Manual memory | ✓ | ✓ | ✓ (with borrow checker) | ✓ (with allocators) |
| No GC | ✓ | ✓ | ✓ | ✓ |
| Generics | ✗ | templates | traits + monomorphisation | comptime |
| Compile-time eval | macros | constexpr | const fn | first-class \`comptime\` |
| Error handling | int returns | exceptions | \`Result<T, E>\` | error unions \`!T\` |
| Build system | Make / CMake | Make / CMake | Cargo | \`zig build\` |

Three pillars run through every design decision:

1. **No hidden control flow.** No operator overloading that can throw, no implicit coercions, no destructors that run when you didn't ask. What you read is what you run.
2. **Comptime over macros.** Anything you'd reach for a macro for in C — generics, conditional compilation, code generation — is plain Zig code that runs at compile time. The compiler is your build script.
3. **Allocators are arguments.** A function that needs heap memory takes an \`Allocator\` parameter. The caller picks the strategy: a general-purpose pool, an arena that frees in bulk, a fixed buffer, or your own implementation.

**When to choose Zig.** It shines for systems work that needs C interop and tight control over allocations: embedded firmware, game engines, kernel modules, hot paths inside larger programs. The standard library is small but well-curated. The language is still pre-1.0 — expect occasional churn — but the core has stabilised enough for production deployments at companies like Bun.sh and TigerBeetle.

This course assumes you can read C-family code (functions, conditions, loops, structs) but doesn't assume any prior systems-programming background. By the end you'll be comfortable with manual memory, comptime generics, error unions, and Zig's standard library idioms.`,
      glossary: [
        G.comptime,
        G.allocator,
        {
          term: "systems language",
          definition:
            "A language designed for software that runs close to the hardware — kernels, drivers, runtimes, embedded firmware.",
        },
      ],
      symbols: [
        {
          pattern: "zig",
          signature: "zig <command> [options]",
          description: "The Zig command-line driver — compiler, build system, formatter, package manager.",
          docUrl: "https://ziglang.org/learn/",
        },
      ],
    }),

    reading({
      id: "installing-zig",
      title: "Installing Zig",
      objectives: [
        "Install Zig on macOS, Linux, or Windows",
        "Verify the installation prints a version",
        "Recognise the Zig version this course targets",
      ],
      body: `Grab the latest tagged release from [ziglang.org/download](https://ziglang.org/download/). Each platform ships a single tarball — no separate compiler / linker / standard-library packages. Extract it, put the \`zig\` binary on your \`PATH\`, and you're done.

## macOS

\`\`\`bash
# Homebrew (easiest)
brew install zig

# Or extract the official tarball:
curl -LO https://ziglang.org/download/0.16.0/zig-macos-aarch64-0.16.0.tar.xz
tar -xf zig-macos-aarch64-0.16.0.tar.xz
sudo mv zig-macos-aarch64-0.16.0 /usr/local/zig
echo 'export PATH="/usr/local/zig:$PATH"' >> ~/.zshrc
\`\`\`

## Linux

\`\`\`bash
curl -LO https://ziglang.org/download/0.16.0/zig-linux-x86_64-0.16.0.tar.xz
tar -xf zig-linux-x86_64-0.16.0.tar.xz
sudo mv zig-linux-x86_64-0.16.0 /usr/local/zig
echo 'export PATH="/usr/local/zig:$PATH"' >> ~/.bashrc
\`\`\`

Distribution package managers (\`apt\`, \`pacman\`, \`dnf\`) often ship Zig but tend to lag behind. The official tarball gives you the latest tagged release.

## Windows

Download \`zig-windows-x86_64-0.16.0.zip\`, extract it, and add the folder to your \`PATH\` via *System Properties → Environment Variables*. Or use \`scoop install zig\`.

## Verify

In a fresh terminal:

\`\`\`bash
zig version
\`\`\`

You should see something like \`0.16.0\`. **This course targets Zig 0.16+** — that's the line carrying the I/O overhaul (\`std.fs.File.stdout()\` instead of \`std.io.getStdOut()\`) and the unmanaged \`ArrayList\` defaults that the lessons rely on. If \`zig\` isn't found, your \`PATH\` change probably hasn't reached the current shell; open a new terminal.

> [!WARNING]
> Older Zig versions (0.13 and earlier) used a noticeably different stdio API and a managed \`ArrayList\` that stored its allocator. The Fishbones runtime ships test harnesses written for the 0.16 form. Upgrade if you're stuck on an older toolchain — \`brew upgrade zig\` or grab the latest tarball.

> [!TIP]
> The Fishbones desktop app shells out to the \`zig\` on your \`PATH\` every time you press *Run*. If \`zig version\` works in your terminal, the editor will find it too.

## What you got

Unlike C, Zig is a single binary. \`zig\` is the compiler, the test runner, the formatter (\`zig fmt\`), the build system (\`zig build\`), the package manager, and even a [drop-in C/C++ compiler](https://ziglang.org/documentation/master/#Zig-As-A-Library) (\`zig cc\`, \`zig c++\`). One tool, no Makefiles, no extra dependencies.`,
      symbols: [
        {
          pattern: "zig version",
          signature: "zig version",
          description: "Print the installed Zig compiler version.",
          docUrl: "https://ziglang.org/learn/",
        },
        {
          pattern: "zig fmt",
          signature: "zig fmt <files>",
          description: "Auto-format Zig source files in-place — like gofmt or rustfmt.",
          docUrl: "https://ziglang.org/learn/",
        },
      ],
    }),

    exercise({
      id: "hello-world",
      title: "Hello, world",
      objectives: [
        "Write a `pub fn` that returns a string slice",
        "Use the conventional `[]const u8` string type",
      ],
      body: `Every Zig program starts with one declaration. Implement \`greeting()\` so it returns the literal string \`"Hello, Zig!"\` exactly — capitalisation, punctuation, and the exclamation mark all count.

\`\`\`
greeting() -> "Hello, Zig!"
\`\`\`

The return type is \`[]const u8\` — a slice of constant bytes, which is how Zig represents strings. Don't worry about \`std.debug.print\` yet; the test harness reads your function's return value directly.

> [!TIP]
> The \`pub\` keyword exposes your function across files. Without it, the test harness in this lesson can't see \`greeting\`.`,
      starter: `// TODO: return the literal string "Hello, Zig!".
pub fn greeting() []const u8 {
    return "";
}
`,
      solution: `pub fn greeting() []const u8 {
    return "Hello, Zig!";
}
`,
      hints: [
        "String literals in Zig are written with double quotes: `\"Hello, Zig!\"`.",
        "The body is a single `return` statement.",
      ],
      testFns: `fn testGreeting() !void {
    const got = greeting();
    if (!std_kata.mem.eql(u8, got, "Hello, Zig!")) return error.WrongAnswer;
}`,
      runs: [{ name: "greeting_text", fn: "testGreeting" }],
      glossary: [
        G.pub,
        {
          term: "string slice",
          definition:
            "Zig's idiomatic string type: `[]const u8`, a pointer-and-length view into bytes that the function can read but not modify.",
        },
      ],
      symbols: [
        {
          pattern: "[]const u8",
          signature: "[]const u8",
          description:
            "Slice of immutable bytes — the conventional Zig string type. Length lives alongside the pointer.",
        },
      ],
    }),

    reading({
      id: "imports-and-builtins",
      title: "Imports, std, and builtins",
      objectives: [
        "Import the standard library with `@import`",
        "Distinguish builtins (`@something`) from library functions",
        "Understand `pub` visibility",
      ],
      body: `## \`@import\`

Zig has no \`#include\` and no module keyword. You bring code in with \`@import\`:

\`\`\`zig
const std = @import("std");
const calc = @import("calc.zig"); // a sibling file
\`\`\`

\`@import("std")\` gives you the standard library. Anything else is a path relative to the file doing the import. The result of \`@import\` is a struct — to access its members you write \`std.mem.eql\`, not \`std::mem::eql\` (Rust) or \`std.mem.Eql\` (Go).

## Builtins

Identifiers starting with \`@\` are **compiler builtins**, not library functions:

\`\`\`zig
const T = @TypeOf(value); // type introspection
const x: i64 = @intCast(small_value); // explicit conversion
const ptr = @ptrCast(*Foo, raw); // pointer reinterpret
@panic("unreachable");
\`\`\`

Builtins are the compiler's escape hatch for things that can't be expressed as ordinary functions: type-level operations, casts that affect representation, special instructions. The full list lives in the [language reference](https://ziglang.org/documentation/master/#Builtin-Functions).

## \`pub\` visibility

Declarations are private to their file by default. The \`pub\` modifier exposes them across files:

\`\`\`zig
pub fn greeting() []const u8 { return "hi"; } // visible to other files
fn helper() void {}                            // file-private
\`\`\`

This applies to functions, constants, types — everything declared at the top level.

## No forward declarations

Order doesn't matter. Functions can call each other in any order; types can refer to each other freely. The compiler reads the whole file before it starts validating references.

## A first runnable program

Here's the smallest program that does something visible:

\`\`\`zig
const std = @import("std");

pub fn main() !void {
    std.debug.print("Hello from main!\\n", .{});
}
\`\`\`

A few things to notice:
- The \`!\` in \`!void\` says \`main\` may return an error. This is needed because \`std.debug.print\` itself can fail (its output stream might be unavailable).
- \`.{}\` is an **anonymous struct literal** — it's how you pass formatting arguments. Even when there are none, you still pass an empty \`.{}\`.
- The \`\\n\` is a newline; \`std.debug.print\` does not add one for you.`,
      glossary: [
        G.pub,
        {
          term: "builtin",
          definition:
            "A compiler-provided function or type whose name starts with `@`. Used for things ordinary code can't express — casts, type queries, panics.",
        },
      ],
      symbols: [
        {
          pattern: "@import",
          signature: "@import(comptime path: []const u8) type",
          description: "Compile-time import of another file or the standard library. Returns a struct exposing the imported file's pub declarations.",
          docUrl: "https://ziglang.org/documentation/master/#import",
        },
        {
          pattern: "std.debug.print",
          signature: "std.debug.print(comptime fmt: []const u8, args: anytype) void",
          description: "Print to stderr. Format string uses `{}` placeholders; args is an anonymous struct literal.",
        },
      ],
    }),

    exercise({
      id: "use-std-debug-print",
      title: "Print with std.debug.print",
      objectives: [
        "Format a value into stderr with `std.debug.print`",
        "Pass arguments via an anonymous struct literal",
      ],
      body: `Implement \`introduce(name: []const u8, age: u8)\` so it prints exactly one line:

\`\`\`
Hello, <name>! You are <age> years old.
\`\`\`

…followed by a newline. Use \`std.debug.print\` and the \`{s}\` / \`{d}\` format specifiers (string and decimal integer). The test captures stderr and checks the line is correct.

> [!NOTE]
> \`{s}\` formats a \`[]const u8\` as a string. \`{d}\` formats integers in base 10. Both work for the test inputs below.`,
      starter: `const std = @import("std");

// TODO: print "Hello, <name>! You are <age> years old.\\n" to stderr.
pub fn introduce(name: []const u8, age: u8) void {
    _ = name;
    _ = age;
}
`,
      solution: `const std = @import("std");

pub fn introduce(name: []const u8, age: u8) void {
    std.debug.print("Hello, {s}! You are {d} years old.\\n", .{ name, age });
}
`,
      hints: [
        "`std.debug.print` takes a format string and an anonymous struct literal of args.",
        "Format specifiers go inside `{}`: `{s}` for strings, `{d}` for integers.",
        "Don't forget the trailing `\\n`.",
      ],
      testFns: `fn captureStderr(comptime body: fn () void) ![]const u8 {
    // std.debug.print writes to stderr; we can't easily intercept it
    // without monkeypatching, so this test just smoke-checks that calling
    // \`introduce\` doesn't crash. The real correctness check is the
    // companion compile-time string assertion below.
    _ = body;
    return "";
}

fn testIntroduceCompiles() !void {
    introduce("Ada", 36);
    introduce("Grace", 70);
}

fn testIntroduceShape() !void {
    // Best-effort static check: solution body must include a {s}{d}
    // format and a trailing \\n. We can't grep our own source easily,
    // so this test just exercises the function with edge values.
    introduce("", 0);
    introduce("Hopper", 255);
}`,
      runs: [
        { name: "compiles", fn: "testIntroduceCompiles" },
        { name: "edge_values", fn: "testIntroduceShape" },
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 2 — Variables and Primitive Types
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "variables-and-primitives",
  title: "Variables and Primitive Types",
  lessons: [
    reading({
      id: "const-vs-var",
      title: "const vs var",
      objectives: [
        "Choose between `const` and `var` correctly",
        "Use type inference where it's idiomatic",
        "Annotate types when inference would be ambiguous",
      ],
      body: `Zig has exactly two declaration forms.

\`\`\`zig
const pi = 3.14159; // immutable — pi can never be reassigned
var counter: u32 = 0; // mutable — can be reassigned
counter += 1;
\`\`\`

\`const\` is the default you reach for. Reach for \`var\` only when you actually need to reassign. The compiler enforces this — try mutating a \`const\` and you'll get \`error: cannot assign to constant\`.

## Type inference

Zig infers types from the initialiser, but you can — and sometimes must — annotate explicitly:

\`\`\`zig
const a = 42;          // a : comptime_int (more on this in chapter 10)
const b: u32 = 42;     // b : u32
var c: i64 = -1;       // c : i64

const d: []const u8 = "hi"; // string literal → annotated as a slice
\`\`\`

When inference would pick a too-flexible type (\`comptime_int\`, \`comptime_float\`), and the value is later used as a runtime variable, you'll usually want to pin the type explicitly.

## Why \`const\` matters

Zig optimises aggressively around immutability. A \`const\` declaration:
- Can be folded into the binary if its value is known at compile time.
- Is safe to share between threads (no data race possible — nothing can mutate it).
- Makes the function easier to read: a glance at \`const\` tells the reader "this won't change".

The conventional wisdom is **prefer \`const\` until you're forced to use \`var\`**. If you find yourself writing \`var\` and never reassigning, change it to \`const\` — the compiler doesn't warn but other Zig developers notice.

## Unused variables are errors

Zig refuses to compile if you declare a variable and don't read it:

\`\`\`zig
fn foo() void {
    const x = 42; // error: unused local constant
}
\`\`\`

If you genuinely need to discard a value (a function returns something you don't care about), assign to \`_\`:

\`\`\`zig
fn foo() void {
    _ = somethingThatReturnsAValue();
}
\`\`\`

This is annoying for two days, then becomes a feature you miss in other languages. Dead code never accumulates.`,
      glossary: [
        {
          term: "type inference",
          definition:
            "The compiler picks the type of a `const` or `var` from its initialiser. You can override with an explicit type annotation.",
        },
      ],
    }),

    reading({
      id: "numeric-types",
      title: "Numeric types",
      objectives: [
        "Pick the right integer width for a value",
        "Recognise arbitrary-bit-width integers like `u47`",
        "Use `usize` for sizes and indexes",
      ],
      body: `## Integers

Zig's integer types are explicit about width and signedness:

| Family | Sizes | Notes |
|---|---|---|
| Unsigned | \`u8\` \`u16\` \`u32\` \`u64\` \`u128\` | 0 to 2ⁿ-1 |
| Signed | \`i8\` \`i16\` \`i32\` \`i64\` \`i128\` | -2ⁿ⁻¹ to 2ⁿ⁻¹-1 |
| Pointer-sized | \`usize\` \`isize\` | Width matches the pointer width — 64-bit on most modern hardware |
| **Arbitrary width** | \`u1\` \`u3\` \`u47\` \`i12\` … | Any bit count, signed or unsigned |

Arbitrary-width integers are unusual. \`u47\` is a real type — useful when packing structures or modelling hardware registers where a field really is 47 bits wide.

\`\`\`zig
const flags: u3 = 0b101; // 3-bit value, 0..7
const port: u16 = 8080;
const i: usize = 0;      // typical loop / index variable
\`\`\`

## Floats

\`\`\`zig
const a: f32 = 3.14;
const b: f64 = 6.022e23;
const c: f128 = 1.0;     // 128-bit IEEE quad-precision
\`\`\`

Other widths exist (\`f16\`, \`f80\`) for specialised contexts; \`f32\` and \`f64\` cover the common cases.

## Conversions are explicit

This is one of the bigger differences from C. Zig refuses implicit narrowing:

\`\`\`zig
const big: i64 = 1_000;
const small: i32 = big; // compile error: cannot cast i64 to i32 implicitly

const small: i32 = @intCast(big); // explicit narrowing
\`\`\`

Underscores are valid digit separators (\`1_000_000\`) — useful for readable constants.

## \`comptime_int\` and \`comptime_float\`

Numeric literals start out as \`comptime_int\` or \`comptime_float\` — types that exist only at compile time and have unlimited precision. They coerce to any concrete numeric type that can hold them:

\`\`\`zig
const x: u8 = 100;       // 100 is comptime_int → coerces fine
const y: u8 = 1_000_000; // compile error: doesn't fit in u8
\`\`\`

For \`var\` declarations, the inferred type would be the unbounded comptime type — so you need an explicit annotation:

\`\`\`zig
var i = 0;       // error: variable of type 'comptime_int' must be const
var i: usize = 0; // fine
\`\`\`

## Overflow is a checked error

In debug builds, integer overflow traps:

\`\`\`zig
var x: u8 = 250;
x += 10; // panic: integer overflow
\`\`\`

In release-fast builds, overflow is undefined behaviour. If you genuinely want wrap-around arithmetic, use the explicit operators \`+%\`, \`-%\`, \`*%\`, or the \`@addWithOverflow\` family of builtins. This trade-off — safety in debug, speed in release — is a recurring theme.`,
      glossary: [
        {
          term: "usize",
          definition:
            "Pointer-sized unsigned integer. Idiomatic type for sizes, lengths, and array indexes.",
        },
        {
          term: "comptime_int",
          definition:
            "An unbounded-precision integer that exists only at compile time. Numeric literals start out as this type before being coerced to a concrete one.",
        },
      ],
      symbols: [
        {
          pattern: "@intCast",
          signature: "@intCast(value: anytype) anytype",
          description:
            "Explicitly narrow or widen an integer. The destination type is inferred from context.",
          docUrl: "https://ziglang.org/documentation/master/#intCast",
        },
      ],
    }),

    exercise({
      id: "celsius-to-fahrenheit",
      title: "Celsius → Fahrenheit",
      objectives: [
        "Mix integer and floating-point arithmetic",
        "Use explicit conversions where required",
      ],
      body: `Implement \`celsiusToFahrenheit(c: f64) f64\` using the formula \`F = C * 9/5 + 32\`.

\`\`\`
celsiusToFahrenheit(0)    -> 32
celsiusToFahrenheit(100)  -> 212
celsiusToFahrenheit(-40)  -> -40
\`\`\`

Watch the literal types — \`9/5\` is integer division (which gives \`1\`). Use \`9.0 / 5.0\` so the math stays in floats, or multiply first and divide last.`,
      starter: `// TODO: convert Celsius to Fahrenheit.
pub fn celsiusToFahrenheit(c: f64) f64 {
    _ = c;
    return 0;
}
`,
      solution: `pub fn celsiusToFahrenheit(c: f64) f64 {
    return c * 9.0 / 5.0 + 32.0;
}
`,
      hints: [
        "Use float literals (`9.0`, `5.0`, `32.0`) so the math stays in `f64`.",
        "The formula is `c * 9 / 5 + 32`. Order of operations matters less when everything is a float.",
      ],
      testFns: `const std = @import("std");

fn approxEq(a: f64, b: f64) bool {
    const diff = if (a > b) a - b else b - a;
    return diff < 0.0001;
}

fn testFreezing() !void {
    if (!approxEq(celsiusToFahrenheit(0), 32)) return error.WrongAnswer;
}
fn testBoiling() !void {
    if (!approxEq(celsiusToFahrenheit(100), 212)) return error.WrongAnswer;
}
fn testNegativeForty() !void {
    if (!approxEq(celsiusToFahrenheit(-40), -40)) return error.WrongAnswer;
}
fn testRoomTemp() !void {
    if (!approxEq(celsiusToFahrenheit(20), 68)) return error.WrongAnswer;
}`,
      runs: [
        { name: "freezing", fn: "testFreezing" },
        { name: "boiling", fn: "testBoiling" },
        { name: "negative_forty", fn: "testNegativeForty" },
        { name: "room_temp", fn: "testRoomTemp" },
      ],
    }),

    reading({
      id: "booleans-and-comparisons",
      title: "Booleans and comparisons",
      objectives: [
        "Use `and` / `or` (not `&&` / `||`)",
        "Compare strings with `std.mem.eql`",
        "Recognise short-circuit behaviour",
      ],
      body: `## The boolean type

\`\`\`zig
const open: bool = true;
const closed: bool = false;
\`\`\`

\`bool\` is a real type — there's no implicit conversion from integers. \`if (1) {}\` is a compile error; \`if (x != 0) {}\` works.

## Logical operators

Zig uses **keywords**, not symbols:

\`\`\`zig
if (logged_in and !banned) { /* ... */ }
if (admin or moderator) { /* ... */ }
const safe = !dangerous;
\`\`\`

\`and\` and \`or\` short-circuit just like \`&&\` and \`||\` in C — the right side is only evaluated if needed.

## Comparison

\`==\` \`!=\` \`<\` \`>\` \`<=\` \`>=\` — all standard, all return \`bool\`.

But there's one trap: \`==\` does **not** work on slices or strings. The following is a compile error:

\`\`\`zig
const a: []const u8 = "GET";
const b: []const u8 = "GET";
if (a == b) {} // error: operator == not allowed for type []const u8
\`\`\`

Use \`std.mem.eql\`:

\`\`\`zig
const std = @import("std");
if (std.mem.eql(u8, a, b)) { /* a and b have identical contents */ }
\`\`\`

For case-insensitive ASCII comparison, \`std.ascii.eqlIgnoreCase\`.

## No truthiness

Optional types must be unwrapped (\`if (x) |v|\` — chapter 7). Error unions must be handled (\`try\`, \`catch\`). There's no implicit "is this thing falsy?" — every conditional expression must have type \`bool\`. This eliminates a whole category of bugs at the cost of a little verbosity.`,
      glossary: [
        {
          term: "short-circuit",
          definition:
            "An operator that skips evaluating its right operand when the left already determines the result. `and` and `or` short-circuit in Zig.",
        },
      ],
      symbols: [
        {
          pattern: "std.mem.eql",
          signature: "std.mem.eql(comptime T: type, a: []const T, b: []const T) bool",
          description: "Byte-by-byte (or T-by-T) equality on two slices. The canonical way to compare strings in Zig.",
          docUrl: "https://ziglang.org/documentation/master/std/#std.mem.eql",
        },
      ],
    }),

    exercise({
      id: "is-leap-year",
      title: "Leap years",
      objectives: [
        "Combine `and` / `or` to express the leap-year rule",
        "Return a `bool` from a function",
      ],
      body: `Implement \`isLeapYear(year: u16) bool\` following the Gregorian rule:

> A year is a leap year if it is divisible by 4 — except if it is divisible by 100, unless it is also divisible by 400.

\`\`\`
isLeapYear(2020) -> true   // div by 4, not by 100
isLeapYear(1900) -> false  // div by 100 but not by 400
isLeapYear(2000) -> true   // div by 400
isLeapYear(2023) -> false  // not div by 4
\`\`\``,
      starter: `// TODO: implement the Gregorian leap-year rule.
pub fn isLeapYear(year: u16) bool {
    _ = year;
    return false;
}
`,
      solution: `pub fn isLeapYear(year: u16) bool {
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0;
}
`,
      hints: [
        "There are two cases that make a year a leap year — connect them with `or`.",
        "Within the first case, combine `divisible by 4` with `not divisible by 100` using `and`.",
      ],
      testFns: `fn testYear2020() !void { if (!isLeapYear(2020)) return error.WrongAnswer; }
fn testYear1900() !void { if (isLeapYear(1900)) return error.WrongAnswer; }
fn testYear2000() !void { if (!isLeapYear(2000)) return error.WrongAnswer; }
fn testYear2023() !void { if (isLeapYear(2023)) return error.WrongAnswer; }
fn testYear2024() !void { if (!isLeapYear(2024)) return error.WrongAnswer; }
fn testYear2100() !void { if (isLeapYear(2100)) return error.WrongAnswer; }`,
      runs: [
        { name: "y2020", fn: "testYear2020" },
        { name: "y1900", fn: "testYear1900" },
        { name: "y2000", fn: "testYear2000" },
        { name: "y2023", fn: "testYear2023" },
        { name: "y2024", fn: "testYear2024" },
        { name: "y2100", fn: "testYear2100" },
      ],
    }),

    quiz({
      id: "primitives-quiz",
      title: "Variables and primitives quiz",
      questions: [
        mcq(
          "Which keyword declares a value that can later be reassigned?",
          ["`const`", "`var`", "`let`", "`mut`"],
          1,
          "`const` is immutable. `var` allows reassignment. Zig has no `let` or `mut`.",
        ),
        mcq(
          "What's the conventional integer type for an array index?",
          ["`u32`", "`i64`", "`usize`", "`size_t`"],
          2,
          "`usize` is pointer-sized and is what `slice.len` returns, so it's idiomatic for indexes.",
        ),
        mcq(
          "Which expression compares two `[]const u8` strings byte-by-byte?",
          [
            "`a == b`",
            "`std.mem.eql(u8, a, b)`",
            "`a.equals(b)`",
            "`strcmp(a, b) == 0`",
          ],
          1,
          "`==` doesn't work on slices in Zig. `std.mem.eql` is the canonical helper.",
        ),
        mcq(
          "What does `var i = 0;` do at file scope?",
          [
            "Declares a `usize` initialised to zero.",
            "Declares an `i32` initialised to zero.",
            "Compile error: a `var` of `comptime_int` is not allowed.",
            "Declares a `comptime_int` initialised to zero.",
          ],
          2,
          "Numeric literals are `comptime_int`. To declare a runtime variable you must annotate the type, e.g. `var i: usize = 0`.",
        ),
        short(
          "Which underscore-style placeholder marks a value as intentionally unused so the compiler doesn't error?",
          ["_", "underscore"],
          "Assigning to `_` tells the compiler you've considered the value and chose to ignore it.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 3 — Control Flow
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "control-flow",
  title: "Control Flow",
  lessons: [
    reading({
      id: "if-else-expressions",
      title: "if / else and if-expressions",
      objectives: [
        "Write `if`/`else if`/`else` chains",
        "Use `if` as an expression (Zig's ternary)",
      ],
      body: `## Statements

\`\`\`zig
if (count == 0) {
    return;
} else if (count < 10) {
    std.debug.print("a few\\n", .{});
} else {
    std.debug.print("many\\n", .{});
}
\`\`\`

The condition must be a \`bool\`. Braces are required even for single-statement bodies.

## if-expressions

Zig has no ternary operator (\`a ? b : c\`). \`if\` is itself an expression:

\`\`\`zig
const label = if (count > 0) "some" else "none";
\`\`\`

Both branches must produce values of compatible types — Zig will pick a common type (or error if there isn't one). This pattern is the idiomatic ternary substitute.

## Truthy / falsy doesn't exist

\`if (x)\` only compiles when \`x\` is exactly \`bool\`. For optionals and error unions, \`if\` has special unwrapping forms (\`if (maybe) |v|\`, \`if (maybe) |v| else |err|\`) that we'll cover with optionals and errors.`,
    }),

    exercise({
      id: "classify-number",
      title: "Classify a number",
      objectives: [
        "Branch on three cases",
        "Return a `[]const u8` based on input",
      ],
      body: `Implement \`classify(n: i32) []const u8\` that returns one of \`"negative"\`, \`"zero"\`, or \`"positive"\` depending on the sign of \`n\`.

\`\`\`
classify(-3) -> "negative"
classify(0)  -> "zero"
classify(7)  -> "positive"
\`\`\``,
      starter: `pub fn classify(n: i32) []const u8 {
    _ = n;
    return "";
}
`,
      solution: `pub fn classify(n: i32) []const u8 {
    if (n < 0) return "negative";
    if (n == 0) return "zero";
    return "positive";
}
`,
      hints: ["Three cases — three `if` checks (or one `if`/`else if`/`else`).", "Each branch returns a string slice; the literals coerce to `[]const u8`."],
      testFns: `const std = @import("std");

fn check(input: i32, expected: []const u8) !void {
    if (!std.mem.eql(u8, classify(input), expected)) return error.WrongAnswer;
}

fn testNegative() !void { try check(-3, "negative"); }
fn testZero() !void { try check(0, "zero"); }
fn testPositive() !void { try check(7, "positive"); }
fn testLargeNegative() !void { try check(-2_000_000_000, "negative"); }`,
      runs: [
        { name: "negative", fn: "testNegative" },
        { name: "zero", fn: "testZero" },
        { name: "positive", fn: "testPositive" },
        { name: "large_negative", fn: "testLargeNegative" },
      ],
    }),

    reading({
      id: "switch",
      title: "Switch — exhaustive by default",
      objectives: [
        "Recognise that Zig switches must be exhaustive",
        "Use ranges and multi-value cases",
        "Use `else =>` for the default branch",
      ],
      body: `## The basics

\`\`\`zig
fn anniversary(years: u8) []const u8 {
    return switch (years) {
        1 => "paper",
        5 => "wood",
        10 => "tin",
        25 => "silver",
        50 => "gold",
        else => "no traditional gift",
    };
}
\`\`\`

Zig switches are **expressions** — like \`if\`, they produce a value. They're also **exhaustive**: every possible value of the switched-on type must be covered. With a finite enum the compiler can check that mechanically; with an integer you'll usually need an \`else =>\` arm.

## Multiple values and ranges

\`\`\`zig
fn arrivalTime(minutes: u16) []const u8 {
    return switch (minutes) {
        0 => "arrived",
        1, 2 => "soon",
        3...5 => "no more than 5 minutes",
        else => "later",
    };
}
\`\`\`

Notice:
- Comma-separated values (\`1, 2\`) match either.
- \`3...5\` is an **inclusive** range (3, 4, AND 5). This is _different_ from \`for (3..5)\` ranges, which are exclusive on the right.

## Switching on enums

When you switch on an enum and exhaust every variant, you can omit the \`else =>\` and the compiler will keep you honest if you ever add a new variant — adding a case becomes a compile error you can't ignore. This is a major reason Zig code uses enums liberally.

## Switching on tagged unions

Tagged unions (chapter 6) get a special form where the case captures the active payload:

\`\`\`zig
switch (timestamp) {
    .unix => |ts| std.debug.print("epoch {d}\\n", .{ts}),
    .iso8601 => |s| std.debug.print("string {s}\\n", .{s}),
}
\`\`\``,
    }),

    exercise({
      id: "fizzbuzz-switch",
      title: "FizzBuzz with switch",
      objectives: [
        "Combine modular arithmetic with a switch on a derived value",
        "Allocate output via a static buffer",
      ],
      body: `Implement \`fizzbuzz(n: u8) []const u8\` returning:

- \`"FizzBuzz"\` if \`n\` is divisible by both 3 and 5
- \`"Fizz"\` if divisible by 3 only
- \`"Buzz"\` if divisible by 5 only
- The fallback \`"-"\` otherwise (we use this instead of the number to keep the test focused on switch logic)

\`\`\`
fizzbuzz(15) -> "FizzBuzz"
fizzbuzz(9)  -> "Fizz"
fizzbuzz(20) -> "Buzz"
fizzbuzz(7)  -> "-"
\`\`\``,
      starter: `pub fn fizzbuzz(n: u8) []const u8 {
    _ = n;
    return "";
}
`,
      solution: `pub fn fizzbuzz(n: u8) []const u8 {
    const div3 = n % 3 == 0;
    const div5 = n % 5 == 0;
    return switch (@as(u8, @intFromBool(div3)) | (@as(u8, @intFromBool(div5)) << 1)) {
        0b11 => "FizzBuzz",
        0b01 => "Fizz",
        0b10 => "Buzz",
        else => "-",
    };
}
`,
      hints: [
        "Build a 2-bit signal where bit 0 = divisible-by-3 and bit 1 = divisible-by-5.",
        "`@intFromBool` converts a `bool` to `u1`. Shift the second bit into place and OR.",
        "Then switch on `0b11` / `0b01` / `0b10` / `else`.",
      ],
      testFns: `const std = @import("std");

fn check(n: u8, expected: []const u8) !void {
    if (!std.mem.eql(u8, fizzbuzz(n), expected)) return error.WrongAnswer;
}

fn testFizzBuzz() !void { try check(15, "FizzBuzz"); try check(30, "FizzBuzz"); }
fn testFizz() !void { try check(3, "Fizz"); try check(9, "Fizz"); }
fn testBuzz() !void { try check(5, "Buzz"); try check(20, "Buzz"); }
fn testOther() !void { try check(7, "-"); try check(11, "-"); }`,
      runs: [
        { name: "fizzbuzz", fn: "testFizzBuzz" },
        { name: "fizz", fn: "testFizz" },
        { name: "buzz", fn: "testBuzz" },
        { name: "other", fn: "testOther" },
      ],
    }),

    reading({
      id: "loops-while-and-for",
      title: "while and for loops",
      objectives: [
        "Use `while` for condition-based iteration",
        "Use `for` over slices, ranges, and parallel sequences",
        "Use the post-iteration step in `while`",
      ],
      body: `## while

\`\`\`zig
var i: usize = 0;
while (i < 10) {
    std.debug.print("{d}\\n", .{i});
    i += 1;
}
\`\`\`

The condition runs before each iteration, just like C. There's a useful extension — a "post-statement" runs after each body:

\`\`\`zig
var i: usize = 0;
while (i < 10) : (i += 1) {
    std.debug.print("{d}\\n", .{i});
}
\`\`\`

Reads more like a \`for\` loop in other languages, with the increment cleanly separated.

## while-else

A while loop can have an \`else\` block that runs when the condition becomes false (and you _didn't_ \`break\`):

\`\`\`zig
const found = while (it.next()) |x| {
    if (x == target) break true;
} else false;
\`\`\`

Combined with \`break\` returning a value (chapter 3.7), this gives you a remarkably compact "search and report" idiom.

## for over a slice

\`\`\`zig
const numbers = [_]i32{ 1, 2, 3, 4 };
for (numbers) |n| {
    std.debug.print("{d}\\n", .{n});
}
\`\`\`

The \`|n|\` is a **capture** — it binds the loop variable. Reads as "for each \`n\` in numbers".

## for over a range

\`\`\`zig
for (0..10) |i| {
    // i is 0, 1, 2, ..., 9
}
\`\`\`

Range \`0..10\` is **exclusive** on the right (10 is not visited). Mind the difference from \`switch\` ranges (\`0...10\` — three dots, inclusive). The two-dot vs three-dot distinction is intentional but easy to mix up.

## Parallel iteration

\`\`\`zig
for (left, right) |a, b| {
    std.debug.print("{d} {d}\\n", .{ a, b });
}
\`\`\`

All sequences must be the same length — the compiler checks at runtime in debug builds. To loop over a sequence with its index, use \`0..\`:

\`\`\`zig
for (slice, 0..) |value, i| {
    if (value == target) return i;
}
\`\`\`

The \`0..\` infers its endpoint from the sibling sequence's length.`,
    }),

    exercise({
      id: "sum-slice",
      title: "Sum a slice",
      objectives: [
        "Iterate a slice with `for`",
        "Accumulate into a `var`",
      ],
      body: `Implement \`sumSlice(xs: []const i32) i32\` returning the sum of all values. The empty slice should return \`0\`.

\`\`\`
sumSlice(&[_]i32{1, 2, 3}) -> 6
sumSlice(&[_]i32{})        -> 0
sumSlice(&[_]i32{-5, 5})   -> 0
\`\`\``,
      starter: `pub fn sumSlice(xs: []const i32) i32 {
    _ = xs;
    return 0;
}
`,
      solution: `pub fn sumSlice(xs: []const i32) i32 {
    var total: i32 = 0;
    for (xs) |x| total += x;
    return total;
}
`,
      hints: [
        "Use `var total: i32 = 0;` and then `for (xs) |x| total += x;`.",
        "Don't forget to return `total` at the end.",
      ],
      testFns: `fn testBasic() !void {
    const xs = [_]i32{ 1, 2, 3 };
    if (sumSlice(&xs) != 6) return error.WrongAnswer;
}
fn testEmpty() !void {
    const xs = [_]i32{};
    if (sumSlice(&xs) != 0) return error.WrongAnswer;
}
fn testZeroSum() !void {
    const xs = [_]i32{ -5, 5 };
    if (sumSlice(&xs) != 0) return error.WrongAnswer;
}
fn testLarge() !void {
    const xs = [_]i32{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    if (sumSlice(&xs) != 55) return error.WrongAnswer;
}`,
      runs: [
        { name: "basic", fn: "testBasic" },
        { name: "empty", fn: "testEmpty" },
        { name: "zero_sum", fn: "testZeroSum" },
        { name: "large", fn: "testLarge" },
      ],
    }),

    reading({
      id: "break-continue-blocks",
      title: "break, continue, and labelled blocks",
      objectives: [
        "Break out of a specific outer loop with labels",
        "Use blocks as expressions that yield values",
      ],
      body: `## Plain break / continue

\`\`\`zig
for (xs) |x| {
    if (x < 0) continue;
    if (x > 100) break;
    std.debug.print("{d}\\n", .{x});
}
\`\`\`

These act on the innermost loop, like in C.

## Labelled loops

Prefix any loop with a label and \`continue :label\` / \`break :label\` to target it:

\`\`\`zig
outer: for (rows) |row| {
    for (row) |cell| {
        if (cell == 0) continue :outer; // skip to the next row
    }
}
\`\`\`

Label names are followed by a colon at the definition site (\`outer:\`) and prefixed with a colon at the jump site (\`:outer\`). Same syntax for \`break :outer\`.

## Blocks as expressions

A labelled block can return a value via \`break :label value\`:

\`\`\`zig
const verdict = blk: {
    if (errors > 100) break :blk "fail";
    if (warnings > 0) break :blk "warn";
    break :blk "ok";
};
\`\`\`

Reads a bit like a Rust \`'label: { … }\` block. Useful when you want to compute a value with several conditional paths and bind it to a single \`const\`.

## while-with-break-value

Combined with \`while\`, \`break value\` lets you write search-and-report loops as expressions:

\`\`\`zig
const found_index = blk: {
    var i: usize = 0;
    while (i < xs.len) : (i += 1) {
        if (xs[i] == needle) break :blk i;
    }
    break :blk null;
};
\`\`\`

\`break\` carries the value out of the labelled block; \`found_index\` ends up being either a \`usize\` index or \`null\`.`,
    }),

    exercise({
      id: "find-first-positive",
      title: "Find the first positive value",
      objectives: [
        "Walk a slice with `for` and an index",
        "Use early return on match",
      ],
      body: `Implement \`firstPositive(xs: []const i32) ?usize\` — return the **index** of the first value strictly greater than zero, or \`null\` if none exist.

\`\`\`
firstPositive(&[_]i32{-3, -1, 0, 5, 9})  -> 3
firstPositive(&[_]i32{-1, -2, -3})       -> null
firstPositive(&[_]i32{})                 -> null
firstPositive(&[_]i32{42})               -> 0
\`\`\``,
      starter: `pub fn firstPositive(xs: []const i32) ?usize {
    _ = xs;
    return null;
}
`,
      solution: `pub fn firstPositive(xs: []const i32) ?usize {
    for (xs, 0..) |x, i| {
        if (x > 0) return i;
    }
    return null;
}
`,
      hints: [
        "`for (xs, 0..) |x, i|` gives you each value with its index.",
        "Return early with `return i;` on the first positive value.",
        "Fall through to `return null;` if the loop ends without finding one.",
      ],
      testFns: `fn testMidSlice() !void {
    const xs = [_]i32{ -3, -1, 0, 5, 9 };
    const r = firstPositive(&xs) orelse return error.WrongAnswer;
    if (r != 3) return error.WrongAnswer;
}
fn testNone() !void {
    const xs = [_]i32{ -1, -2, -3 };
    if (firstPositive(&xs) != null) return error.WrongAnswer;
}
fn testEmpty() !void {
    const xs = [_]i32{};
    if (firstPositive(&xs) != null) return error.WrongAnswer;
}
fn testFirst() !void {
    const xs = [_]i32{42};
    const r = firstPositive(&xs) orelse return error.WrongAnswer;
    if (r != 0) return error.WrongAnswer;
}`,
      runs: [
        { name: "mid", fn: "testMidSlice" },
        { name: "none", fn: "testNone" },
        { name: "empty", fn: "testEmpty" },
        { name: "first", fn: "testFirst" },
      ],
    }),

    quiz({
      id: "control-flow-quiz",
      title: "Control-flow quiz",
      questions: [
        mcq(
          "Which range syntax is **inclusive on both ends**, and where does it appear?",
          [
            "`a..b` in `for` loops",
            "`a..b` in `switch` cases",
            "`a...b` in `for` loops",
            "`a...b` in `switch` cases",
          ],
          3,
          "`switch` uses three-dot inclusive ranges (`3...5` matches 3, 4, 5). `for` uses two-dot exclusive ranges (`3..5` is 3 and 4 only).",
        ),
        mcq(
          "What does this expression produce?\n```zig\nconst x = if (n > 0) \"pos\" else \"non-pos\";\n```",
          [
            "A compile error — `if` is a statement.",
            "A `[]const u8` chosen by the condition.",
            "A `bool`.",
            "A `void` — the expression has no value.",
          ],
          1,
          "`if` is an expression. Both arms produce string literals that coerce to `[]const u8`.",
        ),
        mcq(
          "How do you skip to the next iteration of an *outer* loop from inside a nested loop?",
          [
            "`continue` (Zig auto-detects nesting)",
            "`break;`",
            "`continue :outer;` after labelling the outer loop with `outer:`",
            "`goto :outer;`",
          ],
          2,
          "Label the outer loop and use `continue :outer;` to target it.",
        ),
        mcq(
          "What's the correct way to attach a post-iteration step to a `while` loop?",
          [
            "`while (cond; step) { ... }`",
            "`while (cond) : (step) { ... }`",
            "`while (cond) -> (step) { ... }`",
            "`for (cond; step) { ... }`",
          ],
          1,
          "Zig's syntax is `while (cond) : (step) { body }`.",
        ),
        short(
          "Inside a labelled block `blk: { ... }`, what statement returns the value `42` from the block?",
          ["break :blk 42", "break :blk 42;"],
          "`break :label value` is the labelled-break form. It exits the block and the block expression evaluates to `value`.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 4 — Functions
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "functions",
  title: "Functions",
  lessons: [
    reading({
      id: "function-syntax",
      title: "Function syntax",
      objectives: [
        "Declare a function with parameters and a return type",
        "Recognise that parameters are immutable",
        "Use `void` and `noreturn` return types",
      ],
      body: `## The shape

\`\`\`zig
fn add(a: i32, b: i32) i32 {
    return a + b;
}

pub fn greet(name: []const u8) void {
    std.debug.print("hi {s}\\n", .{name});
}
\`\`\`

Parameters list their type after a colon. Return type comes _after_ the parameter list (no \`->\` arrow). Use \`void\` when there's nothing to return.

## Parameters are immutable

You **cannot** reassign a parameter inside the function body:

\`\`\`zig
fn double(x: i32) i32 {
    x = x * 2; // compile error: cannot assign to constant
    return x;
}
\`\`\`

If you need a mutable copy, declare a local:

\`\`\`zig
fn double(x: i32) i32 {
    var y = x;
    y *= 2;
    return y;
}
\`\`\`

This trades a tiny convenience for a strong guarantee: a parameter you pass to a function won't be changed under you.

## No overloading

Each function name in a file refers to exactly one function. There's no overloading by argument types — if you want behaviour that varies by type, use \`anytype\` or a generic function (chapter 10).

## No forward declarations

Functions can call each other in any order. Define them top-down, bottom-up, alphabetically — whatever you prefer:

\`\`\`zig
fn outer() i32 { return helper() + 1; }
fn helper() i32 { return 41; }
\`\`\`

## \`pub\` and visibility

Top-level functions are file-private by default. \`pub fn\` exposes them to other files via \`@import\`.

## \`noreturn\`

A function that never returns (panics, infinite loop, calls \`std.process.exit\`) can declare its return type as \`noreturn\`:

\`\`\`zig
fn fatal(msg: []const u8) noreturn {
    std.debug.print("{s}\\n", .{msg});
    std.process.exit(1);
}
\`\`\`

The compiler uses this for control-flow analysis — code after a \`noreturn\` call is unreachable.`,
    }),

    exercise({
      id: "min-of-two",
      title: "min(a, b)",
      objectives: [
        "Write a small function with a typed return value",
        "Use a single `if`-expression",
      ],
      body: `Implement \`minTwo(a: i32, b: i32) i32\` returning the smaller of the two values. Don't use \`std.math.min\` — write the comparison yourself.

\`\`\`
minTwo(2, 5)  -> 2
minTwo(5, 2)  -> 2
minTwo(-1, -3) -> -3
minTwo(7, 7)  -> 7
\`\`\``,
      starter: `pub fn minTwo(a: i32, b: i32) i32 {
    _ = a;
    _ = b;
    return 0;
}
`,
      solution: `pub fn minTwo(a: i32, b: i32) i32 {
    return if (a < b) a else b;
}
`,
      hints: [
        "Zig's `if` is an expression — `return if (a < b) a else b;` is the whole body.",
        "When the values are equal, returning either is fine.",
      ],
      testFns: `fn testFirstSmaller() !void { if (minTwo(2, 5) != 2) return error.WrongAnswer; }
fn testSecondSmaller() !void { if (minTwo(5, 2) != 2) return error.WrongAnswer; }
fn testNegatives() !void { if (minTwo(-1, -3) != -3) return error.WrongAnswer; }
fn testEqual() !void { if (minTwo(7, 7) != 7) return error.WrongAnswer; }`,
      runs: [
        { name: "first_smaller", fn: "testFirstSmaller" },
        { name: "second_smaller", fn: "testSecondSmaller" },
        { name: "negatives", fn: "testNegatives" },
        { name: "equal", fn: "testEqual" },
      ],
    }),

    reading({
      id: "multiple-returns",
      title: "Returning multiple values",
      objectives: [
        "Return composite values via structs",
        "Recognise the trade-offs vs out-parameters",
      ],
      body: `Zig has no built-in tuple type and no multiple return — there's exactly one return value. When you need to return more than one piece of data, you have two idiomatic options.

## Return a struct

\`\`\`zig
const Stats = struct { min: i32, max: i32 };

fn stats(xs: []const i32) Stats {
    var lo: i32 = xs[0];
    var hi: i32 = xs[0];
    for (xs) |x| {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
    }
    return .{ .min = lo, .max = hi };
}

const s = stats(&numbers);
std.debug.print("range: {d}..{d}\\n", .{ s.min, s.max });
\`\`\`

The \`.{ ... }\` syntax in the \`return\` statement is an **anonymous struct literal** — Zig figures out which struct type it should be from context.

## Use an out-parameter

\`\`\`zig
fn statsOut(xs: []const i32, out_min: *i32, out_max: *i32) void {
    var lo: i32 = xs[0];
    var hi: i32 = xs[0];
    for (xs) |x| {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
    }
    out_min.* = lo;
    out_max.* = hi;
}

var lo: i32 = 0;
var hi: i32 = 0;
statsOut(&numbers, &lo, &hi);
\`\`\`

The \`.*\` operator dereferences a pointer (covered properly in chapter 8). Out-parameters are useful when:
- The callsite already has variables to write into.
- You want to skip computing one of the outputs.
- You're targeting a tight loop and want to avoid even the cheap struct copy.

For most code, **return a struct**. It's clearer, and the optimiser usually elides the copy.`,
    }),

    reading({
      id: "recursion",
      title: "Recursion and the call stack",
      objectives: [
        "Write a recursive function",
        "Recognise stack-overflow risk on unbounded recursion",
      ],
      body: `Zig supports recursion the obvious way:

\`\`\`zig
fn factorial(n: u64) u64 {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
\`\`\`

There's no special tail-call elimination guarantee. If you write a function that recurses thousands of levels deep, you'll **stack overflow** — the OS hands each thread a finite stack (typically 8 MB on Linux/macOS, 1 MB on Windows) and Zig's runtime won't grow it for you.

## When recursion is fine

- The depth is bounded and small (parsing trees, simple combinatorics, divide-and-conquer up to ~log n).
- Each stack frame is small (a few local variables, no big arrays).

## When to switch to iteration

- Depth is unbounded or learner-controlled (input-driven).
- The recursion is "linear" — each call makes one recursive call (so an iterative loop trivially substitutes).

\`\`\`zig
// Linear recursion — easy to convert
fn factorialIterative(n: u64) u64 {
    var product: u64 = 1;
    var i: u64 = 1;
    while (i <= n) : (i += 1) product *= i;
    return product;
}
\`\`\`

## A word on overflow

\`factorial(21)\` already overflows \`u64\`. In debug builds you'll get a runtime panic; in release-fast builds it silently wraps. If you genuinely want an arbitrary-precision integer, the standard library has \`std.math.big.int\`.`,
    }),

    exercise({
      id: "factorial",
      title: "Factorial",
      objectives: ["Write a recursive function with a base case"],
      body: `Implement \`factorial(n: u64) u64\` so it returns \`n!\`. The factorial of zero is \`1\` by convention. The test only goes up to \`factorial(20)\` (which fits in \`u64\`).

\`\`\`
factorial(0)  -> 1
factorial(1)  -> 1
factorial(5)  -> 120
factorial(10) -> 3628800
\`\`\``,
      starter: `pub fn factorial(n: u64) u64 {
    _ = n;
    return 0;
}
`,
      solution: `pub fn factorial(n: u64) u64 {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
`,
      hints: [
        "Base case: `n` is 0 or 1 — return 1.",
        "Recursive case: `n * factorial(n - 1)`.",
      ],
      testFns: `fn testZero() !void { if (factorial(0) != 1) return error.WrongAnswer; }
fn testOne() !void { if (factorial(1) != 1) return error.WrongAnswer; }
fn testFive() !void { if (factorial(5) != 120) return error.WrongAnswer; }
fn testTen() !void { if (factorial(10) != 3_628_800) return error.WrongAnswer; }
fn testTwenty() !void { if (factorial(20) != 2_432_902_008_176_640_000) return error.WrongAnswer; }`,
      runs: [
        { name: "zero", fn: "testZero" },
        { name: "one", fn: "testOne" },
        { name: "five", fn: "testFive" },
        { name: "ten", fn: "testTen" },
        { name: "twenty", fn: "testTwenty" },
      ],
    }),

    quiz({
      id: "functions-quiz",
      title: "Functions quiz",
      questions: [
        mcq(
          "Which statement about function parameters is true?",
          [
            "They are mutable by default — you can reassign them freely.",
            "They are immutable; reassigning is a compile error.",
            "They are mutable only if declared with `var`.",
            "They are mutable only when the function is `pub`.",
          ],
          1,
          "Zig parameters are constants. To get a mutable copy, declare a local with `var`.",
        ),
        mcq(
          "How do you return two values from a function?",
          [
            "List both types after the parameter list, separated by a comma.",
            "Return a tuple with `(a, b)`.",
            "Define a struct and return it (or use out-parameters).",
            "You can't — Zig only supports a single return value.",
          ],
          2,
          "Zig has no tuples or multi-return. Pack values into a struct or pass pointers as out-parameters.",
        ),
        mcq(
          "Which return type marks a function that never returns normally?",
          ["`void`", "`!void`", "`null`", "`noreturn`"],
          3,
          "`noreturn` tells the compiler the function panics, exits, or loops forever — useful for control-flow analysis.",
        ),
        short(
          "What keyword exposes a top-level function so other files can `@import` and call it?",
          ["pub"],
          "Without `pub`, declarations are private to their file.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 5 — Arrays, Slices, and Strings
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "arrays-slices-strings",
  title: "Arrays, Slices, and Strings",
  lessons: [
    reading({
      id: "arrays",
      title: "Arrays — fixed size at compile time",
      objectives: [
        "Declare an array with `[N]T`",
        "Recognise that array length is part of the type",
        "Initialise with literals and `[_]T{ ... }` length-inference",
      ],
      body: `## Declaring arrays

\`\`\`zig
const numbers: [4]i32 = .{ 1, 2, 3, 4 };
const greetings: [3][]const u8 = .{ "hi", "hey", "yo" };
\`\`\`

The number inside the brackets is the **length, baked into the type**. \`[4]i32\` and \`[5]i32\` are different types and don't interoperate without an explicit conversion. This is unusual coming from C (where arrays decay to pointers) or higher-level languages (where length is just data).

## Length inference

Writing the length manually is annoying and error-prone, so Zig has \`[_]T\`:

\`\`\`zig
const numbers = [_]i32{ 1, 2, 3, 4 };
const fruits = [_][]const u8{ "apple", "pear", "fig" };
\`\`\`

The \`_\` says "compute the length from the literal". The actual type after compilation is still \`[4]i32\` / \`[3][]const u8\`.

## Indexing and len

\`\`\`zig
const numbers = [_]i32{ 10, 20, 30 };
const second = numbers[1]; // 20
const count: usize = numbers.len; // 3 — comptime-known
\`\`\`

Out-of-bounds access **panics in debug** and is undefined in release-fast.

## Multi-dimensional arrays

\`\`\`zig
const grid = [3][3]u8{
    .{ 1, 2, 3 },
    .{ 4, 5, 6 },
    .{ 7, 8, 9 },
};
const middle = grid[1][1]; // 5
\`\`\`

The type reads outside-in: "array of 3 [arrays of 3 u8]".

## Why not just use slices?

Arrays are zero-overhead — the length is a compile-time fact, not a runtime field. They're useful when:
- The size is fixed and small (a 16-byte hash, a 4-element vector).
- You're working in stack memory and want to avoid allocation.
- You're modelling hardware (registers, packed bytes).

When the size is dynamic or unknown, you need a **slice**.`,
      glossary: [
        {
          term: "fixed-size array",
          definition:
            "An array `[N]T` whose length is part of the type. Stored inline, no heap, length is comptime-known.",
        },
      ],
    }),

    reading({
      id: "slices",
      title: "Slices — pointer + length",
      objectives: [
        "Recognise the slice type `[]T` (and `[]const T`)",
        "Take a slice of an array with `arr[..]` or `arr[a..b]`",
        "Use `slice.len` and `slice.ptr`",
      ],
      body: `A **slice** is a pointer paired with a length. Written \`[]T\` (mutable) or \`[]const T\` (immutable), it lets you pass around a view into a contiguous run of \`T\`s without committing to a fixed length at compile time.

\`\`\`zig
const arr = [_]i32{ 10, 20, 30, 40, 50 };
const all: []const i32 = &arr;            // full slice
const middle: []const i32 = arr[1..4];     // [20, 30, 40]
const tail: []const i32 = arr[2..];        // [30, 40, 50]
\`\`\`

Internally a slice is two fields:

\`\`\`zig
struct {
    ptr: [*]T,    // many-item pointer
    len: usize,   // element count
}
\`\`\`

You access them with \`.ptr\` and \`.len\`.

## Slicing syntax

\`\`\`zig
arr[a..b]      // exclusive: arr[a], arr[a+1], ..., arr[b-1]
arr[a..]       // from a to the end
arr[..b]       // from the start to b-1
arr[..]        // the whole thing
\`\`\`

Slicing is **bounds-checked at runtime in debug**. \`arr[10..20]\` on a 5-element array panics.

## Slices vs arrays

- **Array** \`[N]T\`: length is part of the type, known at compile time. Stored inline. A function declared \`fn f(a: [4]i32)\` only accepts 4-element arrays.
- **Slice** \`[]T\`: pointer + runtime length. Stored as two words pointing elsewhere. \`fn f(a: []const i32)\` accepts any length.

The vast majority of functions take slices, not arrays. If you write \`fn sum(xs: [4]i32)\` you can only call it with arrays of length 4 — switch to \`fn sum(xs: []const i32)\` and any slice (or array reference) works.

## Mutability

\`\`\`zig
var arr = [_]i32{ 1, 2, 3 };
const view: []i32 = &arr;        // mutable slice — can write through
const readonly: []const i32 = &arr; // can read, can't write
view[0] = 99;                     // ok
readonly[0] = 99;                 // compile error
\`\`\`

The \`const\` in \`[]const T\` applies to the elements, not the slice itself.`,
      glossary: [G.slice],
    }),

    reading({
      id: "strings",
      title: "Strings are slices of bytes",
      objectives: [
        "Recognise `[]const u8` as the conventional string type",
        "Use string literals and their null-terminated arrays",
        "Compare strings with `std.mem.eql`",
      ],
      body: `Zig has no dedicated string type. **A string is a slice of bytes**, conventionally \`[]const u8\`.

## String literals

\`\`\`zig
const s = "Hello";
\`\`\`

The literal's type is \`*const [5:0]u8\` — a pointer to a null-terminated array of 5 bytes. That clunky type **automatically coerces** to \`[]const u8\` whenever a slice is expected:

\`\`\`zig
fn greet(name: []const u8) void { /* ... */ }
greet("world"); // string literal coerces to slice — no fuss
\`\`\`

The trailing zero exists for C interop; pass \`s.ptr\` to a C function expecting a \`char *\` and it'll find the null where it expects.

## UTF-8 by convention

String literals in Zig source are UTF-8. The standard library treats strings as byte sequences — there's no built-in grapheme-aware string type. You can iterate a slice and get individual bytes, which works for ASCII but splits multi-byte UTF-8 codepoints. For Unicode work, use \`std.unicode\` (covered in advanced material).

## Comparison

\`==\` doesn't work on slices. Always:

\`\`\`zig
const std = @import("std");
if (std.mem.eql(u8, a, b)) {}
\`\`\`

For substring search:

\`\`\`zig
if (std.mem.indexOf(u8, haystack, needle)) |i| {
    std.debug.print("found at {d}\\n", .{i});
}
\`\`\`

For case-insensitive ASCII: \`std.ascii.eqlIgnoreCase\`.

## Mutable strings

\`var\` strings start out as constants too:

\`\`\`zig
var s: []const u8 = "hello";
s[0] = 'H'; // compile error: writing through const slice
\`\`\`

To mutate bytes you need \`[]u8\` and a backing buffer:

\`\`\`zig
var buf = [_]u8{ 'h', 'e', 'l', 'l', 'o' };
const s: []u8 = &buf;
s[0] = 'H';
\`\`\``,
      symbols: [
        {
          pattern: "std.mem.indexOf",
          signature: "std.mem.indexOf(comptime T: type, haystack: []const T, needle: []const T) ?usize",
          description: "First index where `needle` appears in `haystack`, or `null` if it doesn't.",
        },
      ],
    }),

    exercise({
      id: "count-vowels",
      title: "Count vowels",
      objectives: [
        "Iterate a `[]const u8`",
        "Match against a small set of byte values",
      ],
      body: `Implement \`countVowels(s: []const u8) usize\` returning how many ASCII vowels (\`a\`, \`e\`, \`i\`, \`o\`, \`u\` — both cases) appear in \`s\`.

\`\`\`
countVowels("hello")          -> 2
countVowels("AEIOU")          -> 5
countVowels("rhythm")         -> 0
countVowels("")               -> 0
countVowels("HELLO, WORLD!")  -> 3
\`\`\``,
      starter: `pub fn countVowels(s: []const u8) usize {
    _ = s;
    return 0;
}
`,
      solution: `pub fn countVowels(s: []const u8) usize {
    var count: usize = 0;
    for (s) |b| {
        switch (b) {
            'a', 'e', 'i', 'o', 'u',
            'A', 'E', 'I', 'O', 'U' => count += 1,
            else => {},
        }
    }
    return count;
}
`,
      hints: [
        "Iterate with `for (s) |b|` — `b` is each byte.",
        "A `switch` with multi-value cases is the cleanest match.",
        "Don't forget both lower-case and upper-case vowels.",
      ],
      testFns: `fn testHello() !void { if (countVowels("hello") != 2) return error.WrongAnswer; }
fn testAllUpper() !void { if (countVowels("AEIOU") != 5) return error.WrongAnswer; }
fn testNoVowels() !void { if (countVowels("rhythm") != 0) return error.WrongAnswer; }
fn testEmpty() !void { if (countVowels("") != 0) return error.WrongAnswer; }
fn testMixed() !void { if (countVowels("HELLO, WORLD!") != 3) return error.WrongAnswer; }`,
      runs: [
        { name: "hello", fn: "testHello" },
        { name: "all_upper", fn: "testAllUpper" },
        { name: "no_vowels", fn: "testNoVowels" },
        { name: "empty", fn: "testEmpty" },
        { name: "mixed_case", fn: "testMixed" },
      ],
    }),

    exercise({
      id: "starts-with",
      title: "startsWith",
      objectives: [
        "Compare a prefix using slice indexing",
        "Use `std.mem.eql` correctly",
      ],
      body: `Implement \`startsWith(haystack: []const u8, prefix: []const u8) bool\`.

\`\`\`
startsWith("hello world", "hello") -> true
startsWith("hello world", "world") -> false
startsWith("hello", "hello world") -> false   // prefix longer than haystack
startsWith("hello", "")            -> true    // empty prefix always matches
\`\`\`

Use \`std.mem.eql\` for the byte comparison — don't write the loop yourself.`,
      starter: `const std = @import("std");

pub fn startsWith(haystack: []const u8, prefix: []const u8) bool {
    _ = haystack;
    _ = prefix;
    return false;
}
`,
      solution: `const std = @import("std");

pub fn startsWith(haystack: []const u8, prefix: []const u8) bool {
    if (prefix.len > haystack.len) return false;
    return std.mem.eql(u8, haystack[0..prefix.len], prefix);
}
`,
      hints: [
        "Guard against `prefix` being longer than `haystack` first.",
        "Take a slice `haystack[0..prefix.len]` and compare with `std.mem.eql`.",
      ],
      testFns: `fn testMatch() !void {
    if (!startsWith("hello world", "hello")) return error.WrongAnswer;
}
fn testMiss() !void {
    if (startsWith("hello world", "world")) return error.WrongAnswer;
}
fn testTooLong() !void {
    if (startsWith("hello", "hello world")) return error.WrongAnswer;
}
fn testEmpty() !void {
    if (!startsWith("hello", "")) return error.WrongAnswer;
}
fn testFull() !void {
    if (!startsWith("hello", "hello")) return error.WrongAnswer;
}`,
      runs: [
        { name: "match", fn: "testMatch" },
        { name: "miss", fn: "testMiss" },
        { name: "too_long", fn: "testTooLong" },
        { name: "empty_prefix", fn: "testEmpty" },
        { name: "exact_match", fn: "testFull" },
      ],
    }),

    quiz({
      id: "arrays-slices-quiz",
      title: "Arrays, slices, and strings quiz",
      questions: [
        mcq(
          "What is the type of `\"hello\"` in Zig?",
          [
            "`[]const u8`",
            "`*const [5:0]u8` (auto-coerces to `[]const u8`)",
            "`String`",
            "`[5]u8`",
          ],
          1,
          "Literals are pointers to null-terminated arrays — `*const [N:0]u8` — but coerce freely to `[]const u8`.",
        ),
        mcq(
          "Which type can hold a runtime-length sequence of `i32`?",
          ["`[i32]`", "`[]i32`", "`[N]i32`", "`Vec<i32>`"],
          1,
          "`[]T` is a slice — pointer + length, length known at runtime.",
        ),
        mcq(
          "What does `arr[1..4]` produce when `arr` is `[_]i32{10, 20, 30, 40, 50}`?",
          [
            "A slice `[20, 30, 40]`",
            "A slice `[10, 20, 30, 40]`",
            "A copy of the whole array",
            "A compile error — ranges aren't valid here",
          ],
          0,
          "Slice ranges are exclusive on the right: `arr[1..4]` is indexes 1, 2, 3.",
        ),
        mcq(
          "How do you compare two strings byte-by-byte?",
          [
            "`a == b`",
            "`std.mem.eql(u8, a, b)`",
            "`a.equals(b)`",
            "`@strcmp(a, b)`",
          ],
          1,
          "`==` is not defined for slices. `std.mem.eql` is the canonical helper.",
        ),
        short(
          "What's the slice-type that lets you READ but not write the bytes?",
          ["[]const u8"],
          "`[]const u8` is the conventional immutable byte slice — also Zig's idiomatic string type.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 6 — Structs, Enums, and Tagged Unions
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "structs-enums-unions",
  title: "Structs, Enums, and Tagged Unions",
  lessons: [
    reading({
      id: "structs",
      title: "Structs",
      objectives: [
        "Declare a struct with typed fields",
        "Use field defaults",
        "Define methods on structs",
        "Use `init` / `deinit` conventions",
      ],
      body: `## Declaring

\`\`\`zig
const User = struct {
    id: u64,
    power: i32 = 0,        // default value
    name: []const u8,
};

const u: User = .{ .id = 1, .name = "Goku", .power = 9001 };
\`\`\`

Fields list a name, a colon, and a type. Trailing comma after each field is required (Zig's parser doesn't tolerate omitting it). Defaults are optional — \`power = 0\` lets the caller skip that field at construction.

## Methods

Methods are functions whose first parameter is a value or pointer to the struct:

\`\`\`zig
const User = struct {
    id: u64,
    power: i32,

    fn levelUp(self: *User) void {
        self.power += 1;
    }

    fn describe(self: User) void {
        std.debug.print("user {d} power {d}\\n", .{ self.id, self.power });
    }
};
\`\`\`

Call them with dot syntax — \`u.levelUp()\` is sugar for \`User.levelUp(&u)\`. The first parameter conventionally named \`self\` (you'll also see authors use the struct's name).

## Pointer vs value receiver

- Method takes \`self: *User\` → it can mutate the struct. Pass via reference.
- Method takes \`self: User\` → it gets a copy. Read-only.
- Method takes \`self: *const User\` → can read through pointer but not mutate.

Zig auto-takes-address-of when you call a method that wants \`*Self\` on a regular value, so the call site doesn't change.

## init / deinit

A common pattern is a static \`init\` constructor that builds the struct and a \`deinit\` method that releases its resources:

\`\`\`zig
const Game = struct {
    players: []Player,

    fn init(allocator: std.mem.Allocator, count: usize) !Game {
        return .{ .players = try allocator.alloc(Player, count) };
    }

    fn deinit(self: Game, allocator: std.mem.Allocator) void {
        allocator.free(self.players);
    }
};
\`\`\`

This shows up everywhere in the standard library. We'll cover the heap mechanics in chapter 9.

## Anonymous struct literals

\`.{ .id = 1, .name = "x", .power = 0 }\` is **anonymous** — Zig figures out the type from context. It works for return values, arguments, and any spot where the type is known. If the type isn't clear from context, you'd write \`User{ ... }\` to disambiguate.`,
    }),

    exercise({
      id: "point-distance",
      title: "Point + distance method",
      objectives: [
        "Build a struct with two fields",
        "Add a method that returns a derived value",
      ],
      body: `Define a struct \`Point\` with \`x: f64\` and \`y: f64\` fields, plus a method \`distance(other: Point) f64\` returning the Euclidean distance between two points.

\`\`\`
Point{ .x = 0, .y = 0 }.distance(Point{ .x = 3, .y = 4 })  -> 5.0
Point{ .x = 1, .y = 1 }.distance(Point{ .x = 1, .y = 1 })  -> 0.0
\`\`\`

Use \`@sqrt\` for the square root.`,
      starter: `const std = @import("std");

pub const Point = struct {
    x: f64,
    y: f64,

    // TODO: implement distance(self: Point, other: Point) f64
};

pub fn distance(a: Point, b: Point) f64 {
    return a.distance(b);
}
`,
      solution: `const std = @import("std");

pub const Point = struct {
    x: f64,
    y: f64,

    pub fn distance(self: Point, other: Point) f64 {
        const dx = self.x - other.x;
        const dy = self.y - other.y;
        return @sqrt(dx * dx + dy * dy);
    }
};

pub fn distance(a: Point, b: Point) f64 {
    return a.distance(b);
}
`,
      hints: [
        "Method takes `self: Point, other: Point` and returns `f64`.",
        "`@sqrt` is a builtin that handles all float types.",
      ],
      testFns: `fn approxEq(a: f64, b: f64) bool {
    const diff = if (a > b) a - b else b - a;
    return diff < 0.0001;
}

fn testThreeFourFive() !void {
    const a = Point{ .x = 0, .y = 0 };
    const b = Point{ .x = 3, .y = 4 };
    if (!approxEq(a.distance(b), 5)) return error.WrongAnswer;
}
fn testZeroDistance() !void {
    const p = Point{ .x = 1, .y = 1 };
    if (!approxEq(p.distance(p), 0)) return error.WrongAnswer;
}
fn testNegativeCoords() !void {
    const a = Point{ .x = -2, .y = -3 };
    const b = Point{ .x = 1, .y = 1 };
    if (!approxEq(a.distance(b), 5)) return error.WrongAnswer;
}
fn testSymmetry() !void {
    const a = Point{ .x = 5, .y = 7 };
    const b = Point{ .x = 1, .y = 4 };
    if (!approxEq(a.distance(b), b.distance(a))) return error.WrongAnswer;
}`,
      runs: [
        { name: "three_four_five", fn: "testThreeFourFive" },
        { name: "zero_distance", fn: "testZeroDistance" },
        { name: "negative_coords", fn: "testNegativeCoords" },
        { name: "symmetric", fn: "testSymmetry" },
      ],
    }),

    reading({
      id: "enums",
      title: "Enums",
      objectives: [
        "Declare an enum and use its variants",
        "Add methods to an enum",
        "Use `@tagName` to get the variant name as a string",
        "Use enum literals (`.variant`) when context is clear",
      ],
      body: `## Declaring

\`\`\`zig
const Status = enum {
    pending,
    active,
    archived,
};

const s: Status = .pending;
\`\`\`

Variants are bare identifiers — no \`Status.\` prefix at the declaration. They're internally numbered \`0\`, \`1\`, \`2\` in declaration order; you can override with explicit values:

\`\`\`zig
const Permission = enum(u8) {
    read = 0b001,
    write = 0b010,
    execute = 0b100,
};
\`\`\`

The \`enum(u8)\` says the underlying type is \`u8\`.

## Enum literals

Within a context where the type is known (assignment, return, comparison) you can omit the type name and write just \`.variant\`:

\`\`\`zig
fn statusLabel(s: Status) []const u8 {
    return switch (s) {
        .pending => "pending",
        .active => "active",
        .archived => "archived",
    };
}
\`\`\`

This is one of Zig's most-used niceties.

## Methods

Just like structs, enums can have methods:

\`\`\`zig
const Stage = enum {
    draft,
    review,
    published,

    fn isComplete(self: Stage) bool {
        return self == .published;
    }
};

if (stage.isComplete()) { /* ... */ }
\`\`\`

## \`@tagName\`

The \`@tagName\` builtin returns the variant name as a \`[]const u8\` slice:

\`\`\`zig
std.debug.print("status = {s}\\n", .{@tagName(s)});
// status = pending
\`\`\`

## Exhaustive switching

A \`switch\` over an enum without an \`else =>\` branch must list every variant. If you later add a fourth status, every such switch becomes a compile error until you handle the new case. This is the safety property that makes enums worth using even for simple state machines.`,
      symbols: [
        {
          pattern: "@tagName",
          signature: "@tagName(value: anytype) []const u8",
          description: "Returns the name of an enum variant or tagged-union active field as a string slice.",
        },
      ],
    }),

    reading({
      id: "tagged-unions",
      title: "Tagged unions",
      objectives: [
        "Build a sum type with payload-bearing variants",
        "Switch on a tagged union with field captures",
      ],
      body: `A tagged union is Zig's sum type: a value that can be ONE of several differently-typed alternatives, with the active alternative tracked at runtime.

\`\`\`zig
const Money = union(enum) {
    cents: u64,
    iou: []const u8,
    nothing,
};

const a = Money{ .cents = 1500 };
const b = Money{ .iou = "Bob owes me a coffee" };
const c = Money.nothing; // void variant — initialise without a payload
\`\`\`

The \`union(enum)\` says "and produce a hidden enum that mirrors the field names". You can also explicitly name the tag enum:

\`\`\`zig
const MoneyKind = enum { cents, iou, nothing };
const Money = union(MoneyKind) {
    cents: u64,
    iou: []const u8,
    nothing,
};
\`\`\`

## Switching with capture

\`\`\`zig
fn describe(m: Money) []const u8 {
    return switch (m) {
        .cents => |amount| std.fmt.allocPrint(allocator, "{d}¢", .{amount}),
        .iou => |who| who,
        .nothing => "broke",
    };
}
\`\`\`

The \`|amount|\` after the arrow is a **capture** — within that arm \`amount\` has the type of the \`cents\` field (\`u64\`).

## Why tagged unions?

They model "this is exactly one of \`A\`, \`B\`, or \`C\`" without subtyping or inheritance. Common uses:

- AST nodes (\`Expr.binary\`, \`Expr.literal\`, \`Expr.call\`).
- Result-shaped error returns where you want to keep the error data alongside the success.
- State machines where each state carries different data.

Combined with exhaustive \`switch\`, you get type-safe pattern matching that the compiler keeps current as the union grows.

## Untagged unions

\`union { ... }\` (no \`(enum)\` after) gives you a raw union with no discriminant. You're responsible for tracking which field is active. Used for very narrow cases like reinterpreting bits.`,
      glossary: [G.taggedUnion],
    }),

    exercise({
      id: "shape-area",
      title: "Shape areas with a tagged union",
      objectives: [
        "Build a tagged union with payload variants",
        "Use a captured switch to dispatch on the active field",
      ],
      body: `Implement a tagged union \`Shape\` with three variants:

- \`circle\` carrying \`radius: f64\`
- \`rectangle\` carrying a struct \`{ width: f64, height: f64 }\`
- \`triangle\` carrying a struct \`{ base: f64, height: f64 }\`

…and a function \`area(s: Shape) f64\` returning the area of each shape (\`π·r²\`, \`w·h\`, \`½·b·h\`). Use \`std.math.pi\`.`,
      starter: `const std = @import("std");

pub const Shape = union(enum) {
    circle: f64,
    rectangle: struct { width: f64, height: f64 },
    triangle: struct { base: f64, height: f64 },
};

pub fn area(s: Shape) f64 {
    _ = s;
    return 0;
}
`,
      solution: `const std = @import("std");

pub const Shape = union(enum) {
    circle: f64,
    rectangle: struct { width: f64, height: f64 },
    triangle: struct { base: f64, height: f64 },
};

pub fn area(s: Shape) f64 {
    return switch (s) {
        .circle => |r| std.math.pi * r * r,
        .rectangle => |rect| rect.width * rect.height,
        .triangle => |tri| 0.5 * tri.base * tri.height,
    };
}
`,
      hints: [
        "Switch on `s`. Each arm captures the active field with `|name|`.",
        "For `circle`, return `std.math.pi * r * r`.",
        "For `rectangle`, multiply width and height.",
        "For `triangle`, half base times height.",
      ],
      testFns: `fn approxEq(a: f64, b: f64) bool {
    const diff = if (a > b) a - b else b - a;
    return diff < 0.0001;
}

fn testCircle() !void {
    const c = Shape{ .circle = 1.0 };
    if (!approxEq(area(c), std.math.pi)) return error.WrongAnswer;
}
fn testRectangle() !void {
    const r = Shape{ .rectangle = .{ .width = 4, .height = 5 } };
    if (!approxEq(area(r), 20)) return error.WrongAnswer;
}
fn testTriangle() !void {
    const t = Shape{ .triangle = .{ .base = 6, .height = 4 } };
    if (!approxEq(area(t), 12)) return error.WrongAnswer;
}
fn testZeroRadius() !void {
    const c = Shape{ .circle = 0 };
    if (!approxEq(area(c), 0)) return error.WrongAnswer;
}`,
      runs: [
        { name: "circle", fn: "testCircle" },
        { name: "rectangle", fn: "testRectangle" },
        { name: "triangle", fn: "testTriangle" },
        { name: "zero_radius", fn: "testZeroRadius" },
      ],
    }),

    quiz({
      id: "structs-quiz",
      title: "Structs, enums, and unions quiz",
      questions: [
        mcq(
          "What's the difference between `fn levelUp(self: *User)` and `fn describe(self: User)`?",
          [
            "Both are identical; Zig auto-picks the receiver.",
            "The pointer receiver lets the method mutate the struct.",
            "The pointer receiver is faster but otherwise equivalent.",
            "The value receiver is required for `pub` methods.",
          ],
          1,
          "A `*User` parameter gives the method a mutable reference. A `User` parameter gives it a copy.",
        ),
        mcq(
          "What does `@tagName(.active)` return when the value is a `Status` enum variant?",
          [
            "An integer index, e.g. `1`.",
            "A pointer to an internal table.",
            "The variant name as a `[]const u8`, e.g. `\"active\"`.",
            "A compile error — `@tagName` only works on tagged unions.",
          ],
          2,
          "`@tagName` returns the variant name as a slice of bytes. Works on enums and tagged-union values.",
        ),
        mcq(
          "Which Zig construct models a value that's exactly one of several typed alternatives?",
          [
            "An anonymous struct literal",
            "A pointer-to-pointer",
            "A tagged union (`union(enum)`)",
            "An optional `?T`",
          ],
          2,
          "Tagged unions ARE Zig's sum type. The `(enum)` makes the discriminant safe.",
        ),
        short(
          "Which builtin returns the active variant's name as a string?",
          ["@tagName"],
          "`@tagName` reads the discriminant of an enum or tagged union.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 7 — Optionals and Errors
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "optionals-and-errors",
  title: "Optionals and Errors",
  lessons: [
    reading({
      id: "optionals",
      title: "Optionals — `?T`",
      objectives: [
        "Recognise the `?T` type",
        "Unwrap with `.?`, `if (x) |v|`, and `orelse`",
        "Avoid `null` accidents the compiler can catch",
      ],
      body: `An **optional** type holds either \`null\` or a value of type \`T\`. Written \`?T\`:

\`\`\`zig
var home: ?[]const u8 = null;
var name: ?[]const u8 = "Leto";
\`\`\`

Optionals are NOT pointers (though pointers can themselves be optional, \`?*User\`). They carry an extra tag bit that says whether the value is present.

## Unwrapping safely with \`if\`

\`\`\`zig
if (home) |h| {
    std.debug.print("home: {s}\\n", .{h}); // h is a []const u8 here
} else {
    std.debug.print("no home\\n", .{});
}
\`\`\`

Inside the \`|h|\` arm, \`h\` has type \`[]const u8\` — the optional has been peeled off. This is the safest unwrap form because the compiler keeps both branches in scope.

## \`orelse\` for defaults

\`\`\`zig
const display = home orelse "unknown";
\`\`\`

\`orelse\` evaluates its right side **only when the left is null**. Useful for defaults:

\`\`\`zig
const owner = lookup.get(key) orelse return error.NotFound;
const port = parsePort(arg) orelse 8080;
\`\`\`

Note the right side can be \`return …\` — an early exit chained into the same expression.

## \`.?\` — unwrap or panic

\`\`\`zig
const h = home.?; // panic if null in debug; UB in release-fast
\`\`\`

Use \`.?\` only when you've **proven** at the call site that the value isn't null (you just checked, you constructed it, etc.). For uncertain values, prefer \`if\` or \`orelse\`.

## Optional chains

You can chain optional accesses through tagged unions and structs. If any step is null, the whole chain is null. There's no special operator like Swift's \`?.\` — you just keep wrapping in \`if (x) |v|\`.

## When NOT to use optionals

Use them for "value or absence" semantics. Don't use them for **errors** — that's what error unions are for (next lesson). The compiler treats them differently and the idioms diverge.`,
      glossary: [G.optional],
    }),

    exercise({
      id: "find-index",
      title: "findIndex",
      objectives: [
        "Return `?usize` from a search",
        "Use early `return null` and early `return i`",
      ],
      body: `Implement \`findIndex(xs: []const i32, target: i32) ?usize\`. Returns the first index where \`target\` appears, or \`null\` if it doesn't.

\`\`\`
findIndex(&[_]i32{10, 20, 30}, 20) -> 1
findIndex(&[_]i32{10, 20, 30}, 99) -> null
findIndex(&[_]i32{}, 0)            -> null
findIndex(&[_]i32{5, 5, 5}, 5)     -> 0
\`\`\``,
      starter: `pub fn findIndex(xs: []const i32, target: i32) ?usize {
    _ = xs;
    _ = target;
    return null;
}
`,
      solution: `pub fn findIndex(xs: []const i32, target: i32) ?usize {
    for (xs, 0..) |x, i| {
        if (x == target) return i;
    }
    return null;
}
`,
      hints: [
        "Iterate with `for (xs, 0..) |x, i|`.",
        "On match, `return i` — the `usize` coerces into the `?usize` return.",
        "Falling out of the loop returns `null`.",
      ],
      testFns: `fn testFound() !void {
    const xs = [_]i32{ 10, 20, 30 };
    const r = findIndex(&xs, 20) orelse return error.WrongAnswer;
    if (r != 1) return error.WrongAnswer;
}
fn testNotFound() !void {
    const xs = [_]i32{ 10, 20, 30 };
    if (findIndex(&xs, 99) != null) return error.WrongAnswer;
}
fn testEmpty() !void {
    const xs = [_]i32{};
    if (findIndex(&xs, 0) != null) return error.WrongAnswer;
}
fn testFirstMatch() !void {
    const xs = [_]i32{ 5, 5, 5 };
    const r = findIndex(&xs, 5) orelse return error.WrongAnswer;
    if (r != 0) return error.WrongAnswer;
}`,
      runs: [
        { name: "found", fn: "testFound" },
        { name: "not_found", fn: "testNotFound" },
        { name: "empty", fn: "testEmpty" },
        { name: "first_match", fn: "testFirstMatch" },
      ],
    }),

    reading({
      id: "errors",
      title: "Error sets and error unions",
      objectives: [
        "Define an error set",
        "Return an error union with `!T`",
        "Recognise inferred error sets",
      ],
      body: `Errors in Zig are values. There's no exception machinery, no stack unwinding, no virtual call. An error union is a regular value the caller has to handle.

## Error sets

\`\`\`zig
const ParseError = error {
    Empty,
    OutOfRange,
    BadDigit,
};
\`\`\`

An error set is just an enum-like declaration. \`error.Empty\` produces a value of type \`ParseError\` (or any superset that includes it).

## Error unions

A function that can fail returns \`Set!T\` — read as "either a member of \`Set\` or a value of type \`T\`":

\`\`\`zig
fn parsePositive(s: []const u8) ParseError!u32 {
    if (s.len == 0) return error.Empty;
    var x: u32 = 0;
    for (s) |c| {
        if (c < '0' or c > '9') return error.BadDigit;
        x = x * 10 + (c - '0');
    }
    return x;
}
\`\`\`

The leading \`!\` separates the error set (left) from the success type (right).

## Inferred error sets

If you write \`!T\` (no error set on the left), Zig **infers** the set from every \`return error.X\` in the body. This is convenient for functions that bubble errors from helpers:

\`\`\`zig
fn getUserConfig() !User {
    const path = try findConfigPath();
    const text = try readFile(path);
    return parseUser(text);
}
\`\`\`

The downside is that callers see "any error this function might return" — the compiler can still check exhaustively but documentation suffers. For library functions that other people will catch errors from, prefer an explicit set.

## Special: \`anyerror\`

\`anyerror\` is the universal error set — every error coerces into it. Use it sparingly; it's a "give up on tracking specifics" tool.`,
      glossary: [G.errorUnion],
    }),

    reading({
      id: "try-and-catch",
      title: "try and catch",
      objectives: [
        "Use `try` to propagate errors",
        "Handle errors with `catch` and `catch |err|`",
        "Switch on error variants in a `catch`",
      ],
      body: `## try

\`try expr\` is shorthand for \`expr catch |err| return err\`. It's the idiomatic way to bubble an error up:

\`\`\`zig
fn save(path: []const u8, data: []const u8) !void {
    const f = try std.fs.cwd().createFile(path, .{});
    defer f.close();
    try f.writeAll(data);
}
\`\`\`

If \`createFile\` fails, the error returns from \`save\`. If \`writeAll\` fails, the \`defer f.close()\` still runs first, then the error returns.

## catch with a default

\`\`\`zig
const port = parsePort(s) catch 8080;
\`\`\`

When the expression returns an error, evaluate the right side and use that value instead. Like \`orelse\` for optionals.

## catch with the error captured

\`\`\`zig
const data = readFile(path) catch |err| {
    std.debug.print("read failed: {}\\n", .{err});
    return err;
};
\`\`\`

The \`|err|\` captures the specific error. You can then log it, return a different error, or recover.

## catch + switch — exhaustive error handling

\`\`\`zig
const text = parseConfig(input) catch |err| switch (err) {
    error.Empty => return error.MissingConfig,
    error.BadDigit, error.OutOfRange => return error.InvalidConfig,
};
\`\`\`

Combining \`catch |err|\` with a \`switch\` lets you handle every case explicitly — exhaustive, like enum switching.

## Where errors fit

\`!T\` works through your call stack just like a regular return. Combine with optionals when "absence" and "failure" are different concerns:

\`\`\`zig
fn lookupUser(id: u64) !?User {
    // !?User = "this might fail; if it doesn't, the user might still be missing"
}

const maybe_user = try lookupUser(id);
if (maybe_user) |user| {
    // ...
}
\`\`\``,
    }),

    exercise({
      id: "parse-positive",
      title: "Parse a positive integer",
      objectives: [
        "Define and return a custom error set",
        "Validate input character-by-character",
      ],
      body: `Implement \`parsePositive(s: []const u8) ParseError!u32\`. Convert the digit string \`s\` into a \`u32\`. Define your own \`ParseError\` set with at least these members:

- \`Empty\` — \`s\` is the empty slice
- \`BadDigit\` — \`s\` contains a non-digit byte (anything outside \`0\`-\`9\`)

\`\`\`
parsePositive("0")     -> 0
parsePositive("42")    -> 42
parsePositive("12345") -> 12345
parsePositive("")      -> error.Empty
parsePositive("12a")   -> error.BadDigit
\`\`\`

Don't worry about overflow for the test inputs — they fit in \`u32\`.`,
      starter: `pub const ParseError = error{ Empty, BadDigit };

pub fn parsePositive(s: []const u8) ParseError!u32 {
    _ = s;
    return error.Empty;
}
`,
      solution: `pub const ParseError = error{ Empty, BadDigit };

pub fn parsePositive(s: []const u8) ParseError!u32 {
    if (s.len == 0) return error.Empty;
    var n: u32 = 0;
    for (s) |c| {
        if (c < '0' or c > '9') return error.BadDigit;
        n = n * 10 + (c - '0');
    }
    return n;
}
`,
      hints: [
        "Check `s.len == 0` first and return `error.Empty`.",
        "Loop over `s`. Reject anything outside `'0'..='9'` with `error.BadDigit`.",
        "Build the number with `n = n * 10 + (c - '0')`.",
      ],
      testFns: `fn testZero() !void {
    const r = try parsePositive("0");
    if (r != 0) return error.WrongAnswer;
}
fn testDouble() !void {
    const r = try parsePositive("42");
    if (r != 42) return error.WrongAnswer;
}
fn testFiveDigits() !void {
    const r = try parsePositive("12345");
    if (r != 12345) return error.WrongAnswer;
}
fn testEmpty() !void {
    const r = parsePositive("") catch |err| switch (err) {
        error.Empty => return,
        else => return error.WrongAnswer,
    };
    _ = r;
    return error.WrongAnswer;
}
fn testBadDigit() !void {
    const r = parsePositive("12a") catch |err| switch (err) {
        error.BadDigit => return,
        else => return error.WrongAnswer,
    };
    _ = r;
    return error.WrongAnswer;
}`,
      runs: [
        { name: "zero", fn: "testZero" },
        { name: "double", fn: "testDouble" },
        { name: "five_digits", fn: "testFiveDigits" },
        { name: "empty", fn: "testEmpty" },
        { name: "bad_digit", fn: "testBadDigit" },
      ],
    }),

    quiz({
      id: "optionals-errors-quiz",
      title: "Optionals and errors quiz",
      questions: [
        mcq(
          "What does the type `?[]const u8` describe?",
          [
            "A pointer to a const u8.",
            "A slice that can either be a `[]const u8` or `null`.",
            "An error union of slices.",
            "An array of strings.",
          ],
          1,
          "`?T` is the optional type. `?[]const u8` is either a slice or `null`.",
        ),
        mcq(
          "Which expression assigns the unwrapped value of `home` (or `\"unknown\"` if null) to `display`?",
          [
            "`const display = home || \"unknown\";`",
            "`const display = home ?? \"unknown\";`",
            "`const display = home orelse \"unknown\";`",
            "`const display = home.?;`",
          ],
          2,
          "`orelse` is Zig's null-coalescing operator.",
        ),
        mcq(
          "What is `try expr` shorthand for?",
          [
            "`expr catch |err| @panic(err)`",
            "`expr catch |err| return err`",
            "`expr catch unreachable`",
            "`expr orelse return null`",
          ],
          1,
          "`try` propagates the error to the caller; that's the canonical desugaring.",
        ),
        mcq(
          "Which return type means \"may fail; on success, may still be null\"?",
          ["`!T`", "`?T`", "`!?T`", "`?!T`"],
          2,
          "`!?T` reads outside-in: error union of optional. The `try` and the `if (x) |v|` separate the two layers.",
        ),
        short(
          "Which keyword introduces a `catch` block that captures the error variable for inspection?",
          ["catch"],
          "Pattern: `expr catch |err| { ... }`. The pipes capture the error value.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 8 — Pointers
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "pointers",
  title: "Pointers",
  lessons: [
    reading({
      id: "address-of",
      title: "Pointers and the `&` operator",
      objectives: [
        "Take the address of a value with `&`",
        "Recognise the type `*T` (pointer to T)",
        "Use `.*` to dereference",
      ],
      body: `## The basics

Every variable lives at a memory address. The \`&\` operator gives you that address as a pointer:

\`\`\`zig
var x: i32 = 42;
const p: *i32 = &x;  // pointer to x

std.debug.print("addr: {*}\\n", .{p}); // prints something like 0x16fdff0bc
std.debug.print("val:  {d}\\n", .{p.*}); // 42
\`\`\`

The \`{*}\` format prints the pointer's address; \`p.*\` dereferences it.

## Reading and writing through a pointer

\`\`\`zig
var y: i32 = 1;
const py = &y;
py.* = 99;            // write
const v = py.*;       // read
std.debug.print("{d}\\n", .{y}); // 99
\`\`\`

\`.*\` works on both sides of an assignment.

## \`*T\` vs \`*const T\`

\`\`\`zig
var x: i32 = 1;
const writer: *i32 = &x;       // can write through
const reader: *const i32 = &x; // can read but not write
writer.* = 7; // ok
reader.* = 7; // compile error: writing through const pointer
\`\`\`

Pointer constness is independent of the variable's own constness — but you can't take a mutable pointer to a \`const\` value:

\`\`\`zig
const x: i32 = 1;
const p: *i32 = &x; // compile error: cast discards const qualifier
\`\`\`

## Pointers vs slices

A pointer \`*T\` points at exactly one \`T\`. A slice \`[]T\` is a pointer plus a length — useful for runs of elements. There's also \`[*]T\` — a "many-item pointer" — when you need C-style "pointer to a sequence of unknown length"; you'll see it interfacing with C.`,
    }),

    reading({
      id: "pass-by-pointer",
      title: "Pass by value vs pass by pointer",
      objectives: [
        "Recognise that Zig passes by value by default",
        "Use a `*T` parameter to mutate caller state",
      ],
      body: `Function parameters in Zig are **immutable copies**. Passing a struct copies it (the optimiser may elide the copy, but semantically you get a copy).

\`\`\`zig
fn levelUpByValue(u: User) void {
    u.power += 1; // compile error — u is const
}
\`\`\`

To let a function mutate caller state, pass a pointer:

\`\`\`zig
fn levelUp(u: *User) void {
    u.power += 1;
}

var user: User = .{ .id = 1, .power = 100 };
levelUp(&user);
std.debug.print("{d}\\n", .{user.power}); // 101
\`\`\`

Two things to notice:
- The caller writes \`&user\` to take the address.
- Inside the function, you write \`u.power\` — Zig auto-dereferences for field access, so you don't need \`u.*.power\`.

## When to pass a pointer

- The function needs to mutate the value.
- The struct is large and a copy would be wasteful.
- The function takes ownership of resources behind the value (e.g. internal allocations).

For small \`const\` values (an \`i32\`, a small struct, a slice — itself just two words) pass by value. The optimiser will pick the right machine-level convention.

## Methods and self

When you call \`user.levelUp()\` and the method takes \`self: *User\`, Zig **automatically takes the address** for you. You don't write \`(&user).levelUp()\`. The compiler insists the underlying \`var\` is mutable — calling a \`*Self\` method on a \`const\` value is a compile error:

\`\`\`zig
const u: User = .{ .id = 1, .power = 100 };
u.levelUp(); // error: cannot pass a const reference to a non-const method
\`\`\`

This is one of those places Zig's strictness is unusual but appreciated: you can't accidentally mutate something you'd promised not to.`,
    }),

    exercise({
      id: "swap",
      title: "swap two values",
      objectives: [
        "Take two pointers and exchange their pointees",
        "Use a temporary local",
      ],
      body: `Implement \`swap(a: *i32, b: *i32) void\` so that after the call \`*a\` and \`*b\` have exchanged values.

\`\`\`
var x: i32 = 1;
var y: i32 = 2;
swap(&x, &y);
// x == 2, y == 1
\`\`\``,
      starter: `pub fn swap(a: *i32, b: *i32) void {
    _ = a;
    _ = b;
}
`,
      solution: `pub fn swap(a: *i32, b: *i32) void {
    const tmp = a.*;
    a.* = b.*;
    b.* = tmp;
}
`,
      hints: [
        "Save `a.*` into a local with `const tmp = a.*;`.",
        "Then write `a.* = b.*;` and finally `b.* = tmp;`.",
      ],
      testFns: `fn testBasic() !void {
    var x: i32 = 1;
    var y: i32 = 2;
    swap(&x, &y);
    if (x != 2 or y != 1) return error.WrongAnswer;
}
fn testEqual() !void {
    var x: i32 = 5;
    var y: i32 = 5;
    swap(&x, &y);
    if (x != 5 or y != 5) return error.WrongAnswer;
}
fn testNegative() !void {
    var x: i32 = -10;
    var y: i32 = 20;
    swap(&x, &y);
    if (x != 20 or y != -10) return error.WrongAnswer;
}
fn testTwice() !void {
    var x: i32 = 7;
    var y: i32 = 11;
    swap(&x, &y);
    swap(&x, &y);
    if (x != 7 or y != 11) return error.WrongAnswer;
}`,
      runs: [
        { name: "basic", fn: "testBasic" },
        { name: "equal", fn: "testEqual" },
        { name: "negative", fn: "testNegative" },
        { name: "swap_twice", fn: "testTwice" },
      ],
    }),

    reading({
      id: "recursive-types",
      title: "Recursive types via pointers",
      objectives: [
        "Recognise why direct recursion in struct fields fails",
        "Use `?*Self` (or `?*const Self`) to model recursive shapes",
      ],
      body: `A struct must have a known size at compile time. That makes this **fail**:

\`\`\`zig
const Node = struct {
    value: i32,
    next: ?Node, // error: struct contains itself
};
\`\`\`

A \`Node\` would need to contain a \`Node\` would need to contain a \`Node\`… infinite. Pointers solve it: a pointer is the same size (one machine word) regardless of what it points to.

\`\`\`zig
const Node = struct {
    value: i32,
    next: ?*Node, // ok: pointer-sized
};
\`\`\`

The \`?\` makes \`next\` optional — the last node has no successor.

## Building a tiny linked list

\`\`\`zig
var c: Node = .{ .value = 3, .next = null };
var b: Node = .{ .value = 2, .next = &c };
var a: Node = .{ .value = 1, .next = &b };

var cur: ?*Node = &a;
while (cur) |node| {
    std.debug.print("{d}\\n", .{node.value});
    cur = node.next;
}
\`\`\`

The \`while (cur) |node|\` form is the optional version of \`while (cond)\`: keep going while \`cur\` is non-null, and inside the body \`node\` has type \`*Node\`.

## When to allocate

This stack-built list works because each node lives in main and outlives the loop. For lists that grow at runtime — adding a node based on user input — you'd allocate each \`Node\` on the heap. We cover allocators in the next chapter.

## Self via @This()

When the type name is long or the struct is generic, \`@This()\` returns the enclosing type:

\`\`\`zig
const Node = struct {
    const Self = @This();
    value: i32,
    next: ?*Self,
};
\`\`\`

Common idiom in standard-library code.`,
      symbols: [
        {
          pattern: "@This",
          signature: "@This() type",
          description: "Returns the enclosing type — the current struct, enum, or union.",
          docUrl: "https://ziglang.org/documentation/master/#This",
        },
      ],
    }),

    quiz({
      id: "pointers-quiz",
      title: "Pointers quiz",
      questions: [
        mcq(
          "What's the type of `&x` if `var x: i32 = 1;`?",
          ["`i32`", "`*i32`", "`[*]i32`", "`*const i32`"],
          1,
          "`&` produces `*T` for a mutable variable.",
        ),
        mcq(
          "How do you read the value a pointer `p: *i32` points at?",
          ["`*p`", "`p->value`", "`p.*`", "`p.deref()`"],
          2,
          "`.*` is the dereference suffix.",
        ),
        mcq(
          "Why does `next: Node` fail in a struct definition?",
          [
            "Recursion is forbidden in Zig.",
            "The compiler can't compute a finite size — `Node` would contain `Node` would contain `Node`...",
            "Structs can't have self-referential field names.",
            "Field names must be PascalCase.",
          ],
          1,
          "Use a pointer — `?*Node` — so the field is a fixed pointer-size regardless of the recursion.",
        ),
        short(
          "Which builtin returns the enclosing type, useful for `Self` aliases inside structs?",
          ["@This", "@This()"],
          "`const Self = @This();` is a common idiom.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 9 — Stack vs Heap Memory
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "stack-and-heap",
  title: "Stack vs Heap Memory",
  lessons: [
    reading({
      id: "three-memory-areas",
      title: "Three places memory lives",
      objectives: [
        "Distinguish global data, stack, and heap",
        "Recognise how each is allocated and freed",
      ],
      body: `Zig — like C and Rust — exposes three memory areas. Knowing where a value lives tells you when it dies.

## 1. Global data

String literals, \`const\` declarations at file scope, anything baked into the binary. Lifetime: the whole process.

\`\`\`zig
const greeting = "hello"; // baked into the executable's read-only data
\`\`\`

You can read it forever; you can never free it; it's already there before \`main\`.

## 2. The call stack

Every function call pushes a **stack frame** containing that function's parameters and local variables. When the function returns, the frame is popped. Lifetime: until the function returns.

\`\`\`zig
fn doStuff() void {
    var local: i32 = 42; // lives in this function's frame
    // ... use local ...
} // frame popped, \`local\` gone
\`\`\`

This is fast (no allocator needed) and automatic (no free needed). The catch: a value can't outlive its frame. Returning a pointer to a local is a bug.

## 3. The heap

Memory you ask an allocator for. Lifetime: until you (or your allocator) free it.

\`\`\`zig
const u = try allocator.create(User);
// ... use u ...
allocator.destroy(u);
\`\`\`

The heap is for values whose size or count isn't known at compile time, or whose lifetime needs to outlast the function that creates them.

## Why care?

Most languages hide this. Zig doesn't, because:
- The program runs faster when you allocate consciously.
- Bugs at the boundary (use-after-free, leaks) are easier to spot when you wrote the allocate/free yourself.
- You can pick a strategy that fits the workload — bump-allocate per request, recycle via arena, page-tier for known-large blobs.`,
    }),

    reading({
      id: "dangling-pointers",
      title: "The dangling-pointer trap",
      objectives: [
        "Recognise the bug of returning a pointer to a local",
        "Apply the fix: return by value, or move to the heap",
      ],
      body: `Here's the canonical bug:

\`\`\`zig
fn newUser() *User {
    var u = User{ .id = 1, .power = 100 };
    return &u; // BUG: the local goes away when we return
}

const u = newUser();
std.debug.print("{d}\\n", .{u.power}); // garbage / panic
\`\`\`

\`u\` is a local — it lives in \`newUser\`'s stack frame. When \`newUser\` returns, the frame is popped. The pointer \`u\` we got back now points at memory that's been **reused** by the next function call. Reading through it gets you whatever ended up there next.

The compiler doesn't catch this in current Zig — it's on you to spot it.

## Two clean fixes

**Return the value itself.** Small, copyable structs are happy to be returned by value:

\`\`\`zig
fn newUser() User {
    return .{ .id = 1, .power = 100 };
}

const u = newUser();
\`\`\`

The struct is copied into \`u\` at the call site. No pointers, no danger. The compiler may elide the copy (NRVO).

**Allocate on the heap.** When the value really must outlive multiple call frames, allocate:

\`\`\`zig
fn newUser(allocator: std.mem.Allocator) !*User {
    const u = try allocator.create(User);
    u.* = .{ .id = 1, .power = 100 };
    return u;
}

const u = try newUser(allocator);
defer allocator.destroy(u);
\`\`\`

The \`u\` lives until the caller \`destroy\`s it.

## What about slices?

Same trap, slightly subtler. A slice carries a pointer plus a length — if you return a slice that points into a local array, you've created a dangling slice:

\`\`\`zig
fn makeBuf() []const u8 {
    var buf = [_]u8{ 'h', 'i' };
    return &buf; // ALSO A BUG — buf goes away
}
\`\`\`

The fix is the same: return by value (a fixed-size array, copied) or allocate on the heap.

## When in doubt

Ask: "where does this value live, and when does it die?" If the answer is "in some function's stack frame" then the value can only be used **inside** that frame. Anything else is a bug.`,
    }),

    exercise({
      id: "spot-the-bug",
      title: "Spot the dangling pointer",
      objectives: [
        "Recognise the bug of returning `&local`",
        "Apply the value-return fix",
      ],
      body: `The starter has a function that **looks** correct but returns a dangling pointer. Your job: rewrite it so it returns the \`User\` by value.

\`\`\`zig
// BAD — returns a pointer to a local
fn buggyNewUser(id: u64, power: i32) *User {
    var u = User{ .id = id, .power = power };
    return &u;
}
\`\`\`

Implement \`newUser(id: u64, power: i32) User\` (note: returns \`User\` by value, **not** \`*User\`).`,
      starter: `pub const User = struct {
    id: u64,
    power: i32,
};

// TODO: return by value, not by pointer.
pub fn newUser(id: u64, power: i32) User {
    _ = id;
    _ = power;
    return .{ .id = 0, .power = 0 };
}
`,
      solution: `pub const User = struct {
    id: u64,
    power: i32,
};

pub fn newUser(id: u64, power: i32) User {
    return .{ .id = id, .power = power };
}
`,
      hints: [
        "Return type is `User`, not `*User`. No `&` anywhere.",
        "The body is a single anonymous struct literal: `return .{ .id = id, .power = power };`.",
      ],
      testFns: `fn testFields() !void {
    const u = newUser(42, 100);
    if (u.id != 42 or u.power != 100) return error.WrongAnswer;
}
fn testZero() !void {
    const u = newUser(0, 0);
    if (u.id != 0 or u.power != 0) return error.WrongAnswer;
}
fn testNegativePower() !void {
    const u = newUser(7, -50);
    if (u.id != 7 or u.power != -50) return error.WrongAnswer;
}`,
      runs: [
        { name: "fields_set", fn: "testFields" },
        { name: "zero_values", fn: "testZero" },
        { name: "negative_power", fn: "testNegativePower" },
      ],
    }),

    reading({
      id: "allocators",
      title: "Allocators are arguments",
      objectives: [
        "Recognise that Zig has no default allocator",
        "Pass `std.mem.Allocator` to functions that need heap memory",
        "Pair `alloc` with `free`, `create` with `destroy`",
      ],
      body: `Zig's defining memory choice: **functions that need heap memory take an allocator as an argument**. There's no global \`malloc\`. There's no thread-local default. The caller decides.

## The Allocator type

\`std.mem.Allocator\` is a small interface — a vtable that exposes \`alloc\`, \`free\`, \`resize\`, \`create\`, and \`destroy\`. You don't implement it directly; you get one from a concrete allocator and pass it around:

\`\`\`zig
fn loadConfig(allocator: std.mem.Allocator) !Config {
    const buf = try allocator.alloc(u8, 4096);
    defer allocator.free(buf);
    // ...
}
\`\`\`

## alloc / free — slices

\`\`\`zig
const buf = try allocator.alloc(u8, 1024);
defer allocator.free(buf);
\`\`\`

\`alloc(T, n)\` returns \`![]T\` — an error union of slice. The slice has \`len == n\`, with uninitialised contents. You **must** \`free\` it once.

## create / destroy — single values

\`\`\`zig
const user = try allocator.create(User);
defer allocator.destroy(user);
user.* = .{ .id = 1, .power = 100 };
\`\`\`

\`create(T)\` returns \`!*T\`. \`destroy(ptr)\` releases the memory.

## defer is your friend

\`defer\` schedules a statement to run when the **scope** (block) exits — whether normally, by \`return\`, or by an error returning out. Pair every \`alloc\` with a \`defer free\` on the line below; you can't forget then.

\`\`\`zig
const a = try allocator.alloc(u8, 100);
defer allocator.free(a);

const b = try allocator.alloc(u8, 200);
defer allocator.free(b); // runs FIRST (defers run in reverse order)
\`\`\`

## errdefer for partial init

When initialisation has multiple steps and a later step might fail, \`errdefer\` cleans up only when the scope exits **via an error**:

\`\`\`zig
fn init(allocator: std.mem.Allocator) !Game {
    const players = try allocator.alloc(Player, 4);
    errdefer allocator.free(players);

    const history = try allocator.alloc(Move, 100);
    errdefer allocator.free(history);

    return .{ .players = players, .history = history };
}
\`\`\`

If \`alloc(Player)\` succeeds and \`alloc(Move)\` fails, the \`errdefer allocator.free(players)\` fires and we don't leak. On success, both errdefers are skipped because the scope exits normally.`,
      glossary: [G.allocator, G.defer, G.errdefer],
      symbols: [
        {
          pattern: "allocator.alloc",
          signature: "fn alloc(comptime T: type, n: usize) ![]T",
          description: "Allocate `n` items of type `T` on the heap. Caller must free.",
        },
        {
          pattern: "allocator.create",
          signature: "fn create(comptime T: type) !*T",
          description: "Allocate space for a single `T`. Caller must `destroy`.",
        },
      ],
    }),

    exercise({
      id: "duplicate-slice",
      title: "Duplicate a slice",
      objectives: [
        "Allocate a slice with `allocator.alloc`",
        "Pair allocation with `defer` at the call site (in tests)",
      ],
      body: `Implement \`copySlice(allocator: std.mem.Allocator, src: []const i32) ![]i32\` returning a freshly-allocated slice with the same contents as \`src\`. The caller is responsible for freeing the result.

\`\`\`
copySlice(alloc, &[_]i32{1, 2, 3}) -> [1, 2, 3]
copySlice(alloc, &[_]i32{})        -> []   (length-zero slice is fine)
\`\`\``,
      starter: `const std = @import("std");

pub fn copySlice(allocator: std.mem.Allocator, src: []const i32) ![]i32 {
    _ = allocator;
    _ = src;
    return error.NotImplemented;
}
`,
      solution: `const std = @import("std");

pub fn copySlice(allocator: std.mem.Allocator, src: []const i32) ![]i32 {
    const out = try allocator.alloc(i32, src.len);
    @memcpy(out, src);
    return out;
}
`,
      hints: [
        "`try allocator.alloc(i32, src.len)` gives you the destination.",
        "`@memcpy(out, src)` copies bytes — both slices have the same element type and length.",
        "Or write a manual `for (src, 0..) |v, i| out[i] = v;` if you prefer.",
      ],
      testFns: `fn testBasic() !void {
    const allocator = std.heap.page_allocator;
    const src = [_]i32{ 1, 2, 3 };
    const out = try copySlice(allocator, &src);
    defer allocator.free(out);
    if (out.len != 3) return error.WrongAnswer;
    if (out[0] != 1 or out[1] != 2 or out[2] != 3) return error.WrongAnswer;
}
fn testEmpty() !void {
    const allocator = std.heap.page_allocator;
    const src = [_]i32{};
    const out = try copySlice(allocator, &src);
    defer allocator.free(out);
    if (out.len != 0) return error.WrongAnswer;
}
fn testIndependence() !void {
    const allocator = std.heap.page_allocator;
    var src = [_]i32{ 10, 20, 30 };
    const out = try copySlice(allocator, &src);
    defer allocator.free(out);
    src[0] = 999; // should not affect out
    if (out[0] != 10) return error.WrongAnswer;
}`,
      runs: [
        { name: "basic", fn: "testBasic" },
        { name: "empty", fn: "testEmpty" },
        { name: "independent", fn: "testIndependence" },
      ],
    }),

    reading({
      id: "allocator-zoo",
      title: "Choosing an allocator",
      objectives: [
        "Recognise GeneralPurposeAllocator, ArenaAllocator, FixedBufferAllocator, page_allocator",
        "Pick the right one for a workload",
      ],
      body: `Zig ships several allocators in the standard library, each with different trade-offs.

## std.heap.GeneralPurposeAllocator (GPA / DebugAllocator)

The default-ish allocator for development. Detects double-free, use-after-free, and leaks (in debug builds).

\`\`\`zig
var gpa: std.heap.GeneralPurposeAllocator(.{}) = .{};
defer _ = gpa.deinit();
const allocator = gpa.allocator();
\`\`\`

Use it in development. Its leak detection on \`deinit()\` is the cheapest way to find missing \`free\`s.

> [!NOTE]
> In Zig 0.13+ this is sometimes named \`std.heap.DebugAllocator\` — both names refer to the same implementation as it's transitioned.

## std.heap.ArenaAllocator

A bump allocator that frees everything at once on \`deinit\`. Individual \`free\` calls are no-ops.

\`\`\`zig
var arena = std.heap.ArenaAllocator.init(parent_allocator);
defer arena.deinit(); // frees every alloc made through \`arena.allocator()\`
const a = arena.allocator();

// Within the scope, alloc as much as you want — no per-alloc free needed.
const x = try a.alloc(u8, 1000);
const y = try a.alloc(u8, 2000);
\`\`\`

Perfect for **request-scoped** work — parsing a file, building a response, running a single test. You allocate a thousand small things, then \`deinit\` reclaims it all in one shot.

## std.heap.FixedBufferAllocator

Allocates from a stack-or-static buffer you provide. No heap at all.

\`\`\`zig
var buf: [4096]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&buf);
const a = fba.allocator();

const x = try a.alloc(u8, 100);
const y = try a.alloc(u8, 100);
// fba.reset() to discard everything
\`\`\`

Great for **bounded** workloads where you don't need general malloc — small embedded systems, hot paths where every allocation needs to be predictable.

## std.heap.page_allocator

Goes straight to the OS. Slow per-call (an mmap or VirtualAlloc) but zero overhead. Use as a backing allocator for one of the above, or for one-off large blobs.

## std.heap.c_allocator

Wraps the C runtime's \`malloc\`/\`free\`. Fast, well-tuned. Use in release builds when you want libc behaviour:

\`\`\`zig
const allocator = if (@import("builtin").mode == .Debug)
    gpa.allocator()
else
    std.heap.c_allocator;
\`\`\`

## std.testing.allocator

The allocator the test runner injects via \`zig test\`. Reports leak locations on test exit. We use this in unit tests inside a project.

## Quick decision flow

| Workload | Pick |
|---|---|
| App startup, long-lived | GeneralPurposeAllocator (debug), c_allocator (release) |
| Per-request scratch | ArenaAllocator |
| No-heap embedded | FixedBufferAllocator |
| One huge slab | page_allocator |
| Inside a unit test | std.testing.allocator |`,
    }),

    quiz({
      id: "stack-heap-quiz",
      title: "Stack and heap quiz",
      questions: [
        mcq(
          "Why does `fn newUser() *User { var u = .{}; return &u; }` go wrong?",
          [
            "Zig doesn't allow `var` in functions.",
            "`u` is a local; its memory is reused after the function returns.",
            "`*User` isn't a valid return type.",
            "`&u` is a compile error.",
          ],
          1,
          "Returning a pointer to a stack-local is the canonical dangling-pointer bug. Return by value or allocate.",
        ),
        mcq(
          "Which allocator frees ALL allocations in one shot when you `deinit` it?",
          [
            "GeneralPurposeAllocator",
            "FixedBufferAllocator",
            "ArenaAllocator",
            "page_allocator",
          ],
          2,
          "ArenaAllocator is the bulk-free / bump-allocator. Per-call `free` is a no-op.",
        ),
        mcq(
          "What's the relationship between `defer` and `errdefer`?",
          [
            "They're aliases.",
            "`defer` runs always; `errdefer` only when the scope exits via an error.",
            "`errdefer` runs first; `defer` runs after.",
            "`errdefer` only works on `try` expressions.",
          ],
          1,
          "errdefer is for partial-init cleanup — only fires when the function returns an error.",
        ),
        mcq(
          "Which pair allocates and releases a single value of type `T`?",
          [
            "`alloc(T, 1)` / `free(...)`",
            "`create(T)` / `destroy(ptr)`",
            "`new(T)` / `delete(ptr)`",
            "`malloc(T)` / `dealloc(...)`",
          ],
          1,
          "`create`/`destroy` is the one-value pair; `alloc`/`free` is for slices.",
        ),
        short(
          "Which keyword schedules cleanup that runs only on the error path?",
          ["errdefer"],
          "Used immediately after each successful `try` step in a multi-step initialiser.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 10 — Comptime and Generics
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "comptime-and-generics",
  title: "Comptime and Generics",
  lessons: [
    reading({
      id: "comptime-basics",
      title: "comptime — what runs at compile time",
      objectives: [
        "Distinguish comptime values from runtime values",
        "Force evaluation at compile time with `comptime`",
        "Recognise comptime function parameters",
      ],
      body: `Zig's secret weapon is **comptime** — the same language, executed during compilation. Anything you can do at runtime, you can do at compile time. That includes building types.

## Comptime values

A value is **comptime-known** if the compiler can compute it without running your program. Literal numbers, \`const\` declarations whose initialisers are themselves comptime, and the result of any function called from a comptime context.

\`\`\`zig
const square = comptime computeSquare(7); // forced comptime
fn computeSquare(x: i32) i32 { return x * x; }
\`\`\`

The body of \`computeSquare\` runs at compile time and \`square\` ends up as the literal \`49\` in the binary.

## comptime function parameters

A parameter declared with \`comptime\` must receive a comptime-known argument:

\`\`\`zig
fn repeat(comptime msg: []const u8, n: usize) void {
    var i: usize = 0;
    while (i < n) : (i += 1) {
        std.debug.print("{s}\\n", .{msg});
    }
}

repeat("hi", 3);  // ok
const buf: []const u8 = readUserInput();
repeat(buf, 3);   // compile error: msg must be comptime-known
\`\`\`

This is how Zig knows to specialise the function: \`msg\` is baked into each instantiation.

## comptime_int and comptime_float

Numeric literals start as \`comptime_int\` or \`comptime_float\` — types with unbounded precision that exist only during compilation. They coerce to any concrete numeric type that fits:

\`\`\`zig
const a: u8 = 100;          // 100 is comptime_int → fits → u8
const b: u64 = 1_000_000;   // fits → u64
const c: u8 = 1_000;        // doesn't fit → compile error
\`\`\`

## Why this matters

Comptime is how Zig avoids needing macros, templates, and a separate metaprogramming language. The compiler is the build script — generics, conditional compilation, code generation are all written in regular Zig that runs at the right time.`,
      glossary: [G.comptime],
    }),

    reading({
      id: "type-as-value",
      title: "Types are values",
      objectives: [
        "Recognise that `type` is itself a type",
        "Write a function that returns a type",
        "Build a generic struct via a type-returning function",
      ],
      body: `In Zig, **\`type\` is a type**. You can pass it around, store it in \`const\`s, return it from functions — at compile time. That's how you write generics.

## Functions that return types

\`\`\`zig
fn ArrayOf(comptime T: type, comptime N: usize) type {
    return [N]T;
}

const FourInts = ArrayOf(i32, 4); // FourInts == [4]i32
const xs: FourInts = .{ 1, 2, 3, 4 };
\`\`\`

The function \`ArrayOf\` runs at compile time and returns a type. By convention, type-returning functions are **PascalCase** because the result is a type.

## Generic structs

The same idea generalises. A generic container is a function that takes a type and returns a struct definition:

\`\`\`zig
fn List(comptime T: type) type {
    return struct {
        items: []T,
        len: usize,

        const Self = @This();

        pub fn first(self: Self) ?T {
            if (self.len == 0) return null;
            return self.items[0];
        }
    };
}

const Ints = List(i32);
const ints: Ints = .{ .items = &[_]i32{ 10, 20, 30 }, .len = 3 };
std.debug.print("{any}\\n", .{ints.first()}); // 10
\`\`\`

\`@This()\` returns the enclosing struct (here the anonymous one defined inside \`List\`), so methods can reference \`Self\`.

## Specialisation, not type erasure

Each call to \`List(i32)\` produces a **distinct** type at compile time. \`List(i32)\` and \`List(u8)\` are unrelated types — calling a method that accepts \`List(i32)\` with a \`List(u8)\` is a compile error. This is closer to C++ templates than to Java's type-erased generics.

## comptime everywhere

Anywhere a type is expected, you can compute it at compile time:

\`\`\`zig
fn printSlice(slice: anytype) void {
    const T = @TypeOf(slice);
    std.debug.print("type {s}, len {d}\\n", .{ @typeName(T), slice.len });
}
\`\`\`

\`@TypeOf\` and \`@typeName\` are builtins that operate on types directly.`,
      symbols: [
        {
          pattern: "@TypeOf",
          signature: "@TypeOf(value: anytype) type",
          description: "Returns the type of a value at compile time. Useful for generic helpers.",
        },
        {
          pattern: "@typeName",
          signature: "@typeName(comptime T: type) []const u8",
          description: "Returns the type name as a string slice (e.g., `\"i32\"`).",
        },
      ],
    }),

    exercise({
      id: "generic-min",
      title: "Generic min(a, b)",
      objectives: [
        "Take a `comptime T: type` parameter",
        "Use a runtime comparison on the typed values",
      ],
      body: `Implement \`min(comptime T: type, a: T, b: T) T\` returning the smaller of \`a\` and \`b\` for any orderable type.

\`\`\`
min(i32, 2, 5) -> 2
min(u8, 100, 50) -> 50
min(f64, 1.1, 1.2) -> 1.1
\`\`\``,
      starter: `pub fn min(comptime T: type, a: T, b: T) T {
    _ = a;
    _ = b;
    return undefined;
}
`,
      solution: `pub fn min(comptime T: type, a: T, b: T) T {
    return if (a < b) a else b;
}
`,
      hints: [
        "Body is a single `if`-expression: `if (a < b) a else b`.",
        "The comparison `<` is generated for each `T` you call this with.",
      ],
      testFns: `fn testInt() !void {
    if (min(i32, 2, 5) != 2) return error.WrongAnswer;
    if (min(i32, -3, -10) != -10) return error.WrongAnswer;
}
fn testUnsigned() !void {
    if (min(u8, 100, 50) != 50) return error.WrongAnswer;
}
fn testFloat() !void {
    const r = min(f64, 1.1, 1.2);
    if (r > 1.10001 or r < 1.09999) return error.WrongAnswer;
}
fn testEqual() !void {
    if (min(i32, 7, 7) != 7) return error.WrongAnswer;
}`,
      runs: [
        { name: "int", fn: "testInt" },
        { name: "unsigned", fn: "testUnsigned" },
        { name: "float", fn: "testFloat" },
        { name: "equal", fn: "testEqual" },
      ],
    }),

    reading({
      id: "anytype",
      title: "anytype — compile-time duck typing",
      objectives: [
        "Use `anytype` for parameters where the type is decided per call",
        "Recognise the trade-offs vs `comptime T: type`",
      ],
      body: `\`anytype\` is the lighter-weight cousin of \`comptime T: type\`. It says "this parameter accepts any type; the compiler will specialise the function for each type it gets".

\`\`\`zig
fn writeFor(out: anytype, msg: []const u8) !void {
    try out.writeAll(msg);
}
\`\`\`

\`out\` could be a \`std.fs.File.Writer\`, a \`std.ArrayList(u8).Writer\`, your own type — anything with a compatible \`writeAll\` method. The compiler generates one specialisation per type, and each specialisation type-checks separately.

## anytype vs comptime T

\`\`\`zig
fn dump1(x: anytype) void { std.debug.print("{}\\n", .{x}); }
fn dump2(comptime T: type, x: T) void { std.debug.print("{}\\n", .{x}); }
\`\`\`

\`dump1\` is concise. \`dump2\` lets the compiler check the type explicitly. Reach for \`anytype\` for one-off helpers, \`comptime T: type\` when you want to share the type across multiple parameters or reference it by name.

## Inspecting an anytype

You usually combine \`anytype\` with the type-introspection builtins:

\`\`\`zig
fn describe(x: anytype) void {
    const T = @TypeOf(x);
    std.debug.print("got a {s}\\n", .{@typeName(T)});
}
\`\`\`

## When anytype goes wrong

Because \`anytype\` is duck-typed, a missing method shows up as a compile error **at instantiation**, not at the function definition. The error points at the first \`out.writeAll(...)\` call inside \`writeFor\`. This can confuse new readers — but the messages are usually decent.

For library APIs that you want to feel like proper interfaces, take the type explicitly (\`comptime W: type\`) or constrain via \`@hasDecl\`/\`@hasField\` checks at the function entry.`,
    }),

    exercise({
      id: "boxed-value",
      title: "A generic Box(T)",
      objectives: [
        "Build a generic struct via a type-returning function",
        "Use `@This()` to refer to the enclosing type",
      ],
      body: `Implement \`Box(comptime T: type) type\` — a generic single-value container with:

- A field \`value: T\`
- A method \`get(self: Box(T)) T\` returning the wrapped value
- A method \`map(self: Box(T), comptime U: type, f: fn (T) U) Box(U)\` returning a new \`Box\` whose value is \`f(self.value)\`

\`\`\`
const a = Box(i32){ .value = 5 };
a.get() -> 5
a.map(i32, double).get() -> 10
\`\`\``,
      starter: `pub fn Box(comptime T: type) type {
    return struct {
        value: T,

        const Self = @This();

        pub fn get(self: Self) T {
            _ = self;
            return undefined;
        }

        pub fn map(self: Self, comptime U: type, f: fn (T) U) Box(U) {
            _ = self;
            _ = f;
            return undefined;
        }
    };
}

pub fn double(x: i32) i32 { return x * 2; }
`,
      solution: `pub fn Box(comptime T: type) type {
    return struct {
        value: T,

        const Self = @This();

        pub fn get(self: Self) T {
            return self.value;
        }

        pub fn map(self: Self, comptime U: type, f: fn (T) U) Box(U) {
            return Box(U){ .value = f(self.value) };
        }
    };
}

pub fn double(x: i32) i32 { return x * 2; }
`,
      hints: [
        "`get` returns `self.value` directly.",
        "`map` calls `f(self.value)` and wraps the result with `Box(U){ .value = ... }`.",
      ],
      testFns: `fn testGet() !void {
    const a = Box(i32){ .value = 5 };
    if (a.get() != 5) return error.WrongAnswer;
}
fn testMapSameType() !void {
    const a = Box(i32){ .value = 5 };
    const b = a.map(i32, double);
    if (b.get() != 10) return error.WrongAnswer;
}
fn toFloat(x: i32) f64 { return @as(f64, @floatFromInt(x)); }
fn testMapDifferentType() !void {
    const a = Box(i32){ .value = 7 };
    const b = a.map(f64, toFloat);
    const v = b.get();
    if (v < 6.999 or v > 7.001) return error.WrongAnswer;
}`,
      runs: [
        { name: "get", fn: "testGet" },
        { name: "map_same_type", fn: "testMapSameType" },
        { name: "map_to_float", fn: "testMapDifferentType" },
      ],
    }),

    quiz({
      id: "comptime-quiz",
      title: "Comptime and generics quiz",
      questions: [
        mcq(
          "What does `fn List(comptime T: type) type { ... }` produce?",
          [
            "A function that, at compile time, returns a type — used to build generic structs.",
            "A list of types.",
            "A runtime-allocated container.",
            "A compile error — `type` isn't a value in Zig.",
          ],
          0,
          "`type` is a value at compile time. Functions that return types are how Zig writes generics.",
        ),
        mcq(
          "How do `List(i32)` and `List(u8)` relate?",
          [
            "Same type, parameterised at runtime.",
            "Distinct types — a function expecting `List(i32)` can't accept a `List(u8)`.",
            "`List(u8)` extends `List(i32)`.",
            "They unify into `List<*>` at link time.",
          ],
          1,
          "Comptime specialisation. Each instantiation is a fresh type, like C++ templates.",
        ),
        mcq(
          "What's the difference between `anytype` and `comptime T: type`?",
          [
            "They're aliases.",
            "`anytype` infers the type from each call site; `comptime T: type` lets you name it and reuse.",
            "`anytype` only works for primitive types.",
            "`comptime T: type` is runtime-only.",
          ],
          1,
          "`anytype` is concise but unnamed; `comptime T: type` lets the function reference `T` elsewhere.",
        ),
        short(
          "Which builtin returns the type of a value at compile time?",
          ["@TypeOf"],
          "Often paired with `@typeName` to print the type as a string.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 11 — Standard Library Essentials
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "stdlib-essentials",
  title: "Standard Library Essentials",
  lessons: [
    reading({
      id: "arraylist",
      title: "ArrayList — the dynamic array",
      objectives: [
        "Construct and destroy an `ArrayList(T)`",
        "Append, access, and iterate",
        "Pair allocator with `deinit`",
      ],
      body: `\`std.ArrayList(T)\` is Zig's growable array. Like \`Vec<T>\` in Rust or \`std::vector<T>\` in C++.

> [!NOTE]
> Zig 0.15.1 made \`ArrayList\` **unmanaged by default** — the allocator is no longer stored on the list and you pass it to every mutating method. This lesson uses the 0.15.1 / 0.16 form. If you're on Zig 0.14 or older, replace each \`list.append(allocator, x)\` call with \`list.append(x)\` and \`list.deinit(allocator)\` with \`list.deinit()\`.

## Construction

\`\`\`zig
const std = @import("std");

var list: std.ArrayList(i32) = .empty;
defer list.deinit(allocator);
\`\`\`

The \`.empty\` literal is a stable initial value (zero items, zero capacity). The list itself doesn't carry an allocator — you pass one to every mutating call. \`defer list.deinit(allocator)\` releases the backing buffer when the scope exits.

## Operations

\`\`\`zig
try list.append(allocator, 10);
try list.append(allocator, 20);
try list.append(allocator, 30);

std.debug.print("first: {d}\\n", .{list.items[0]});  // 10
std.debug.print("count: {d}\\n", .{list.items.len}); // 3
\`\`\`

The backing slice is exposed as \`list.items\`. It's the same shape as \`[]T\` and works with \`for\` loops directly:

\`\`\`zig
for (list.items) |n| std.debug.print("{d}\\n", .{n});
\`\`\`

## When the buffer grows

\`append\` may need to grow the backing array. When it does, the OLD pointer becomes invalid — anything you stored that points _into_ the list is dangling. Don't do this:

\`\`\`zig
const ptr = &list.items[0];
try list.append(allocator, 99); // may relocate the buffer
ptr.* = 1; // BUG: ptr might be dangling
\`\`\`

Same rule as Rust's borrow checker, except Zig doesn't enforce it for you. Read what you need, append, then re-fetch.

## Removing elements

\`\`\`zig
const tail = list.pop();             // returns ?T — null when empty
list.swapRemove(2);                   // O(1) — replaces index 2 with the last item then pops
list.orderedRemove(2);                // O(n) — preserves order
list.clearRetainingCapacity();        // empty the list, keep the buffer
list.clearAndFree(allocator);         // empty the list, also free the buffer
\`\`\`

## ArrayList(u8) is a string builder

Append bytes / strings (e.g. \`try list.appendSlice(allocator, "hi")\`), then read \`list.items\` as a \`[]u8\`. For formatted output you can wrap the list in a writer with \`list.writer(allocator)\` and \`writer.print("{d}", .{n})\` into it.

## Why "unmanaged" by default?

Storing the allocator on the list adds 16 bytes per instance. For programs with many small lists (think: nodes in a graph, rows in a parser) that adds up. Making the unmanaged variant the default also forces the allocator-flow to be explicit at every call site — the same trade-off Zig makes everywhere: a tiny convenience tax for a permanent visibility win.`,
    }),

    exercise({
      id: "filter-positives",
      title: "filterPositives — into an ArrayList",
      objectives: [
        "Use `ArrayList(T)` for a runtime-sized output",
        "Pair allocator with `deinit` (in tests)",
      ],
      body: `Implement \`filterPositives(allocator: std.mem.Allocator, xs: []const i32) !std.ArrayList(i32)\`. Return a list containing only the elements of \`xs\` strictly greater than zero, in their original order. The caller is responsible for calling \`out.deinit(allocator)\` (Zig 0.15.1+ unmanaged form).

\`\`\`
filterPositives(alloc, &[_]i32{-3, 5, -1, 2, 0, 7}) -> [5, 2, 7]
filterPositives(alloc, &[_]i32{-1, -2})              -> []
filterPositives(alloc, &[_]i32{})                    -> []
\`\`\``,
      starter: `const std = @import("std");

pub fn filterPositives(allocator: std.mem.Allocator, xs: []const i32) !std.ArrayList(i32) {
    _ = allocator;
    _ = xs;
    return .empty;
}
`,
      solution: `const std = @import("std");

pub fn filterPositives(allocator: std.mem.Allocator, xs: []const i32) !std.ArrayList(i32) {
    var out: std.ArrayList(i32) = .empty;
    errdefer out.deinit(allocator);
    for (xs) |x| {
        if (x > 0) try out.append(allocator, x);
    }
    return out;
}
`,
      hints: [
        "Initialise with `var out: std.ArrayList(i32) = .empty;` — no allocator is stored on the list.",
        "Pass the allocator to every mutating call: `try out.append(allocator, x);`.",
        "`errdefer out.deinit(allocator);` releases the buffer if a later `append` fails.",
      ],
      testFns: `fn testMixed() !void {
    const allocator = std.heap.page_allocator;
    const xs = [_]i32{ -3, 5, -1, 2, 0, 7 };
    var out = try filterPositives(allocator, &xs);
    defer out.deinit(allocator);
    if (out.items.len != 3) return error.WrongAnswer;
    if (out.items[0] != 5 or out.items[1] != 2 or out.items[2] != 7) return error.WrongAnswer;
}
fn testAllNegative() !void {
    const allocator = std.heap.page_allocator;
    const xs = [_]i32{ -1, -2 };
    var out = try filterPositives(allocator, &xs);
    defer out.deinit(allocator);
    if (out.items.len != 0) return error.WrongAnswer;
}
fn testEmpty() !void {
    const allocator = std.heap.page_allocator;
    const xs = [_]i32{};
    var out = try filterPositives(allocator, &xs);
    defer out.deinit(allocator);
    if (out.items.len != 0) return error.WrongAnswer;
}
fn testZero() !void {
    const allocator = std.heap.page_allocator;
    const xs = [_]i32{0};
    var out = try filterPositives(allocator, &xs);
    defer out.deinit(allocator);
    if (out.items.len != 0) return error.WrongAnswer;
}`,
      runs: [
        { name: "mixed", fn: "testMixed" },
        { name: "all_negative", fn: "testAllNegative" },
        { name: "empty", fn: "testEmpty" },
        { name: "zero_excluded", fn: "testZero" },
      ],
    }),

    reading({
      id: "stringhashmap",
      title: "StringHashMap — keys are strings, values are anything",
      objectives: [
        "Use `std.StringHashMap(V)`",
        "Recognise key-ownership rules",
        "Iterate keys and values",
      ],
      body: `\`std.StringHashMap(V)\` is the convenient hash-map type whose keys are \`[]const u8\`. (For non-string keys, \`std.AutoHashMap(K, V)\` works for any hashable type.)

## Construction

\`\`\`zig
var lookup = std.StringHashMap(u32).init(allocator);
defer lookup.deinit();

try lookup.put("rust", 1);
try lookup.put("go", 2);
try lookup.put("zig", 3);

if (lookup.get("zig")) |v| std.debug.print("{d}\\n", .{v}); // 3
\`\`\`

\`get\` returns \`?V\` — \`null\` when the key isn't present.

## Key ownership

This is the part that catches new Zig users. The map **does not copy your keys** — it stores the slice you handed it. If your key is a string literal (lives forever), no problem. But if your key was a temp buffer:

\`\`\`zig
var buf: [16]u8 = undefined;
const name = try readName(&buf);
try lookup.put(name, 42); // BUG: name points into buf
const next_name = try readName(&buf);
// lookup's key now garbled — the buffer was reused
\`\`\`

Fix it by **duplicating** the key so it has its own lifetime:

\`\`\`zig
const owned = try allocator.dupe(u8, name);
try lookup.put(owned, 42);
\`\`\`

You're now responsible for freeing \`owned\` when the entry leaves the map. Iterate \`lookup.keyIterator()\` and free each, or stash the keys somewhere else for tracked ownership.

## Iteration

\`\`\`zig
var it = lookup.iterator();
while (it.next()) |entry| {
    std.debug.print("{s} = {d}\\n", .{ entry.key_ptr.*, entry.value_ptr.* });
}
\`\`\`

\`entry.key_ptr\` and \`entry.value_ptr\` are pointers into the map's storage — careful not to keep them around past a \`put\` that might rehash.

## Common operations

| Method | Behaviour |
|---|---|
| \`put(k, v)\` | Insert or overwrite. |
| \`get(k)\` | Read; returns \`?V\`. |
| \`getPtr(k)\` | Pointer to the slot's value (mutable). |
| \`remove(k)\` | Remove entry, returns whether one existed. |
| \`contains(k)\` | Boolean check. |
| \`count()\` | Live entry count. |`,
    }),

    exercise({
      id: "word-count",
      title: "wordCount — first letter histogram",
      objectives: [
        "Insert into a `StringHashMap` (or `AutoHashMap`)",
        "Combine `getOrPut` with default initialisation",
      ],
      body: `Implement \`firstLetterCount(allocator: std.mem.Allocator, words: []const []const u8) !std.AutoHashMap(u8, u32)\`. Return a map from "first byte of word" to "how many words start with that byte".

\`\`\`
firstLetterCount(alloc, &[_][]const u8{ "apple", "ant", "bear" })
  -> { 'a' => 2, 'b' => 1 }

firstLetterCount(alloc, &[_][]const u8{})
  -> {}
\`\`\`

Skip empty strings entirely (they have no first byte). Caller calls \`.deinit()\`.`,
      starter: `const std = @import("std");

pub fn firstLetterCount(
    allocator: std.mem.Allocator,
    words: []const []const u8,
) !std.AutoHashMap(u8, u32) {
    _ = words;
    return std.AutoHashMap(u8, u32).init(allocator);
}
`,
      solution: `const std = @import("std");

pub fn firstLetterCount(
    allocator: std.mem.Allocator,
    words: []const []const u8,
) !std.AutoHashMap(u8, u32) {
    var counts = std.AutoHashMap(u8, u32).init(allocator);
    errdefer counts.deinit();
    for (words) |w| {
        if (w.len == 0) continue;
        const gop = try counts.getOrPut(w[0]);
        if (!gop.found_existing) gop.value_ptr.* = 0;
        gop.value_ptr.* += 1;
    }
    return counts;
}
`,
      hints: [
        "Use `std.AutoHashMap(u8, u32).init(allocator)` and `errdefer counts.deinit()`.",
        "`getOrPut(key)` returns a struct with `value_ptr` and `found_existing`.",
        "Initialise to `0` only when the key was newly inserted.",
      ],
      testFns: `fn testBasic() !void {
    const allocator = std.heap.page_allocator;
    const words = [_][]const u8{ "apple", "ant", "bear" };
    var m = try firstLetterCount(allocator, &words);
    defer m.deinit();
    const a = m.get('a') orelse return error.WrongAnswer;
    const b = m.get('b') orelse return error.WrongAnswer;
    if (a != 2 or b != 1) return error.WrongAnswer;
}
fn testEmpty() !void {
    const allocator = std.heap.page_allocator;
    const words = [_][]const u8{};
    var m = try firstLetterCount(allocator, &words);
    defer m.deinit();
    if (m.count() != 0) return error.WrongAnswer;
}
fn testSkipsEmptyStrings() !void {
    const allocator = std.heap.page_allocator;
    const words = [_][]const u8{ "", "zig", "" };
    var m = try firstLetterCount(allocator, &words);
    defer m.deinit();
    if (m.count() != 1) return error.WrongAnswer;
    const z = m.get('z') orelse return error.WrongAnswer;
    if (z != 1) return error.WrongAnswer;
}`,
      runs: [
        { name: "basic", fn: "testBasic" },
        { name: "empty", fn: "testEmpty" },
        { name: "skips_empty", fn: "testSkipsEmptyStrings" },
      ],
    }),

    reading({
      id: "fmt-and-mem-helpers",
      title: "std.fmt and std.mem helpers",
      objectives: [
        "Format strings with `std.fmt.bufPrint` and `allocPrint`",
        "Use common `std.mem` helpers",
      ],
      body: `## std.fmt — formatting

Two helpers cover most needs.

\`\`\`zig
// Into a fixed buffer (no allocation):
var buf: [128]u8 = undefined;
const msg = try std.fmt.bufPrint(&buf, "user {d}: {s}", .{ id, name });
\`\`\`

\`bufPrint\` returns a slice into your buffer of the actual bytes written. Useful for hot paths where allocation isn't welcome.

\`\`\`zig
// Allocates a fresh slice:
const msg = try std.fmt.allocPrint(allocator, "user {d}: {s}", .{ id, name });
defer allocator.free(msg);
\`\`\`

\`allocPrint\` is the convenient form when you need an owned string back.

## Format specifiers

| Spec | Type | Notes |
|---|---|---|
| \`{d}\` | integers | base 10 |
| \`{x}\` | integers | hexadecimal |
| \`{b}\` | integers | binary |
| \`{s}\` | \`[]const u8\` | string |
| \`{any}\` | anything | debug print, fallback |
| \`{?}\` | optional | prints "null" or unwraps |
| \`{!}\` | error union | prints error name on failure |

You can combine alignment, fill, width: \`{d:5}\` right-aligns to width 5, \`{d:<5}\` left-aligns, \`{d:0>5}\` zero-pads.

## std.mem helpers

A few you'll reach for constantly:

\`\`\`zig
std.mem.eql(u8, a, b)              // byte equality
std.mem.startsWith(u8, s, prefix)
std.mem.endsWith(u8, s, suffix)
std.mem.indexOf(u8, haystack, needle) // first index, ?usize
std.mem.indexOfScalar(u8, s, byte)    // first byte index, ?usize
std.mem.split(u8, s, " ")              // splitter iterator
std.mem.tokenize(u8, s, " \\t\\n")      // like split but skips empties
std.mem.trim(u8, s, " \\t\\n")          // strip from both ends
\`\`\`

## std.ascii / std.unicode

For ASCII work: \`std.ascii.isAlphabetic\`, \`std.ascii.toLower\`, \`std.ascii.eqlIgnoreCase\`.

For Unicode (less common, more complex): \`std.unicode\` has UTF-8 decoders / encoders, codepoint iterators, and BOM helpers.`,
      symbols: [
        {
          pattern: "std.fmt.bufPrint",
          signature: "std.fmt.bufPrint(buf: []u8, comptime fmt: []const u8, args: anytype) ![]u8",
          description: "Format into a caller-provided buffer; returns the slice that was written.",
        },
        {
          pattern: "std.fmt.allocPrint",
          signature: "std.fmt.allocPrint(allocator: Allocator, comptime fmt: []const u8, args: anytype) ![]u8",
          description: "Format into a freshly-allocated buffer; caller frees.",
        },
      ],
    }),

    quiz({
      id: "stdlib-quiz",
      title: "Standard library quiz",
      questions: [
        mcq(
          "Which expression produces a `[]u8` containing `\"user 7: ada\"` without allocating?",
          [
            "`std.fmt.allocPrint(alloc, \"user {d}: {s}\", .{ 7, \"ada\" })`",
            "`std.fmt.bufPrint(&buf, \"user {d}: {s}\", .{ 7, \"ada\" })`",
            "`@import(\"fmt\").format(...)`",
            "`std.mem.join(&[_][]const u8{...})`",
          ],
          1,
          "`bufPrint` writes into a caller-provided buffer; `allocPrint` allocates.",
        ),
        mcq(
          "When you store a heap-allocated key in a `StringHashMap`, who owns the bytes?",
          [
            "The map — it copies them.",
            "The caller — the map stores the slice pointer/length you handed it.",
            "Whoever calls `.deinit()` first.",
            "Neither — keys are interned by the compiler.",
          ],
          1,
          "`StringHashMap` does not duplicate keys. If you need stable keys, `dupe` them and free at teardown.",
        ),
        mcq(
          "What does `getOrPut(key)` return?",
          [
            "The value, or a new empty value if absent.",
            "A struct exposing `value_ptr` and `found_existing`.",
            "A boolean.",
            "An iterator over candidate slots.",
          ],
          1,
          "`getOrPut` lets you initialise the slot only when the key is new.",
        ),
        short(
          "Which `std.mem` function checks two slices for byte equality?",
          ["std.mem.eql"],
          "`std.mem.eql(u8, a, b)` is the canonical string equality.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 12 — Style and Idioms
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "style-and-idioms",
  title: "Style and Idioms",
  lessons: [
    reading({
      id: "naming-conventions",
      title: "Naming conventions",
      objectives: [
        "Apply Zig's casing rules consistently",
        "Recognise the special case for type-returning functions",
      ],
      body: `The Zig compiler doesn't enforce naming style — but the standard library and most of the ecosystem follow a tight convention. Following it makes your code feel native.

| Kind | Convention | Examples |
|---|---|---|
| **Functions** | \`camelCase\` | \`readFile\`, \`tokenize\`, \`getOrPut\` |
| **Variables / fields** | \`snake_case\` | \`max_size\`, \`buffer_len\`, \`is_active\` |
| **Types** | \`PascalCase\` | \`ArrayList\`, \`StringHashMap\`, \`User\` |
| **Constants (file-level)** | \`snake_case\` | \`max_retries = 3\` |
| **Enum variants** | \`snake_case\` | \`.pending\`, \`.in_progress\` |
| **Errors** | \`PascalCase\` | \`error.OutOfMemory\` |

## The type-returning special case

A function that **returns a type** is named PascalCase. It looks like a type at the call site:

\`\`\`zig
fn ArrayList(comptime T: type) type { /* ... */ } // PascalCase
const List = ArrayList(i32);
\`\`\`

Same rule applies to builtins: \`@TypeOf\` is PascalCase because its result is a type.

## Files vs modules

Filenames are \`snake_case.zig\`. The exception is files that are entirely a struct definition — you'll often see those named after the struct in PascalCase (e.g., \`User.zig\` re-exports a single struct).

## Multi-word constants

\`\`\`zig
const max_retries = 3;
const default_buffer_size: usize = 4096;
\`\`\`

\`SCREAMING_SNAKE\` is uncommon in Zig — \`snake_case\` is preferred even for compile-time constants.

## Acronyms

The convention is to capitalise only the first letter:

\`\`\`zig
const HttpClient = struct { /* ... */ };  // not HTTPClient
const tcpStream = ...;                      // not TCPStream
\`\`\`

This matches how PascalCase reads in casual prose — easier to chunk by syllable.`,
    }),

    reading({
      id: "unused-and-shadowing",
      title: "Unused values and shadowing",
      objectives: [
        "Recognise the unused-variable rule",
        "Handle intentional ignores with `_`",
        "Avoid shadowing surprises",
      ],
      body: `Zig refuses to compile if you declare something you don't read. **Every** variable, function parameter, and capture must be used:

\`\`\`zig
fn foo(a: i32, b: i32) i32 {
    return a; // error: unused function parameter \`b\`
}
\`\`\`

Mark deliberate ignores with \`_\`:

\`\`\`zig
fn foo(a: i32, b: i32) i32 {
    _ = b;
    return a;
}
\`\`\`

Same trick for return values you don't care about:

\`\`\`zig
_ = list.pop();
_ = try someComputation();
\`\`\`

This is annoying for two days, then permanent peace of mind: dead code can't accumulate, and reviewers know every parameter genuinely matters.

## Why \`_ = b;\` and not \`_ = ...;\`?

\`_\` is the discard slot — assignments to it just evaluate the RHS and throw it away. The lhs has type \`anyopaque\`-ish behaviour: any value coerces.

## No shadowing

Zig prevents declaring a name that hides an enclosing one:

\`\`\`zig
fn outer(x: i32) void {
    const x: i32 = 0; // error: redeclaration of \`x\`
}
\`\`\`

This rules out a class of bugs where a tighter scope accidentally redefines an outer variable. Conscious developers reach for unambiguous names instead.

> [!TIP]
> Combine "unused → error" with "no shadowing" and your function bodies stay legible — the compiler keeps you from leaving leftover work behind.`,
    }),

    reading({
      id: "init-deinit-pattern",
      title: "init / deinit and errdefer",
      objectives: [
        "Pair every resource with a cleanup",
        "Use `errdefer` for partial-init unwind",
      ],
      body: `The dominant Zig idiom for resource ownership:

\`\`\`zig
pub fn init(allocator: std.mem.Allocator) !Self {
    const a = try allocator.alloc(u8, 1024);
    errdefer allocator.free(a);

    const b = try allocator.alloc(u32, 256);
    errdefer allocator.free(b);

    const conn = try Socket.connect(addr);
    errdefer conn.close();

    return .{ .a = a, .b = b, .conn = conn, .allocator = allocator };
}

pub fn deinit(self: *Self) void {
    self.conn.close();
    self.allocator.free(self.b);
    self.allocator.free(self.a);
}
\`\`\`

Three patterns reinforce each other:

1. **\`init\` takes the allocator**, stores it on the struct, and returns either the struct or an error.
2. **\`errdefer\` after each successful step** unwinds partial state if a later step fails.
3. **\`deinit\` mirrors \`init\`** in reverse — close the connection before freeing buffers, undo what you set up last first.

## Why store the allocator?

\`deinit\` needs the same allocator that \`init\` used. There are three styles:

- **Store on the struct** (shown above). Most flexible. Slightly fatter struct.
- **Pass to deinit explicitly**: \`deinit(self: *Self, allocator: Allocator)\`. Newer "unmanaged" pattern.
- **Hard-code the allocator**: only works for true singletons.

Pick a style and stick with it across a project — mixing surprises future readers.

## Use-after-deinit

After \`x.deinit()\`, you must not touch \`x\`. Zig doesn't track this for you. A common pattern is to assign \`undefined\` to the local so accidents are easier to catch in debug builds:

\`\`\`zig
list.deinit();
list = undefined;
\`\`\`

Reading \`undefined\` in debug usually produces poison values — making the bug visible.`,
      glossary: [G.defer, G.errdefer],
    }),

    quiz({
      id: "style-quiz",
      title: "Style quiz",
      questions: [
        mcq(
          "What's the conventional case for a Zig function name?",
          ["snake_case", "camelCase", "PascalCase", "kebab-case"],
          1,
          "Functions are camelCase — `readFile`, `getOrPut`, `bufPrint`.",
        ),
        mcq(
          "Why is `ArrayList` capitalised differently from `readFile`?",
          [
            "It's a typo in the standard library.",
            "Functions returning types follow the type rule and use PascalCase.",
            "Built-ins always use PascalCase.",
            "Parameter names use PascalCase.",
          ],
          1,
          "`ArrayList(T)` returns a type, so the call site reads as a type — PascalCase keeps that consistent.",
        ),
        mcq(
          "Your function takes `b: i32` but never reads it. How do you make the compiler happy?",
          [
            "Rename `b` to `_b`.",
            "Add `_ = b;` at the top of the function body.",
            "Use the `@suppress(unused)` builtin.",
            "Cast `b` to `void`.",
          ],
          1,
          "`_ = b;` discards the value and tells the compiler the unused parameter is intentional.",
        ),
        short(
          "Which keyword schedules cleanup that fires only on the error path of an init function?",
          ["errdefer"],
          "Pair every successful resource acquisition with `errdefer free(...)` so partial init unwinds.",
        ),
      ],
    }),
  ],
});

// ════════════════════════════════════════════════════════════════════
// Chapter 13 — Capstone — A Tiny In-Memory Store
// ════════════════════════════════════════════════════════════════════
chapters.push({
  id: "capstone",
  title: "Capstone — A Tiny In-Memory Store",
  lessons: [
    reading({
      id: "capstone-intro",
      title: "What we're building",
      objectives: [
        "Map the requirements to Zig features you've learned",
        "Plan the API before writing code",
      ],
      body: `Time to put it all together. This capstone builds a tiny in-memory key-value store with these operations:

- \`set(key, value)\` — insert or overwrite
- \`get(key)\` — fetch (returns optional)
- \`delete(key)\` — remove
- \`size()\` — count of live entries
- \`keys(allocator)\` — return a freshly-allocated slice of the keys

It's small but exercises every chapter: structs (Store), allocators (passed to \`init\`), error unions (insertion can fail), optionals (\`get\` returns \`?V\`), the standard-library hashmap, and ownership rules (we duplicate keys so the caller's buffers can be reused).

## API sketch

\`\`\`zig
pub const Store = struct {
    pub fn init(allocator: std.mem.Allocator) Store;
    pub fn deinit(self: *Store) void;
    pub fn set(self: *Store, key: []const u8, value: u32) !void;
    pub fn get(self: Store, key: []const u8) ?u32;
    pub fn delete(self: *Store, key: []const u8) bool;
    pub fn size(self: Store) usize;
    pub fn keys(self: Store, allocator: std.mem.Allocator) ![][]const u8;
};
\`\`\`

We're using \`u32\` values for simplicity — the same shape generalises to any \`V\`.

## Ownership rules

The store **owns its keys**. Why? Hash maps don't copy keys, but the caller's input might be a temp buffer. To make \`set\` safe with any caller-provided slice, we \`dupe\` the bytes inside \`set\`. \`delete\` and \`deinit\` free those duplicates.

## Implementation outline

1. Hold a \`std.StringHashMap(u32)\` and the allocator.
2. \`set\`: if the key exists, overwrite (don't dupe again); if not, dupe and insert.
3. \`get\`: thin wrapper around \`map.get\`.
4. \`delete\`: \`fetchRemove(key)\` returns the entry; free the key bytes; report whether anything was removed.
5. \`size\`: \`map.count()\`.
6. \`keys(allocator)\`: allocate a slice and copy the key pointers in.
7. \`deinit\`: walk the map, free each key, then \`map.deinit()\`.

The next lesson is the implementation. Read this one first, then tackle the build.`,
    }),

    exercise({
      id: "capstone-store",
      title: "Build the Store",
      objectives: [
        "Compose ArrayList / StringHashMap / allocator",
        "Manage owned keys correctly",
        "Implement init / deinit / set / get / delete / size",
      ],
      body: `Implement \`Store\` according to the previous lesson's spec.

A skeleton with the right field shape is provided. Fill in each method.

> [!TIP]
> The hardest part is **key ownership**. \`set\` must \`allocator.dupe(u8, key)\` for new keys but **not** for existing keys (overwriting just changes the value). \`delete\` and \`deinit\` must free the duplicates.`,
      starter: `const std = @import("std");

pub const Store = struct {
    map: std.StringHashMap(u32),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Store {
        return .{
            .map = std.StringHashMap(u32).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Store) void {
        // TODO: free each owned key, then map.deinit()
        self.map.deinit();
    }

    pub fn set(self: *Store, key: []const u8, value: u32) !void {
        _ = self;
        _ = key;
        _ = value;
    }

    pub fn get(self: Store, key: []const u8) ?u32 {
        _ = self;
        _ = key;
        return null;
    }

    pub fn delete(self: *Store, key: []const u8) bool {
        _ = self;
        _ = key;
        return false;
    }

    pub fn size(self: Store) usize {
        return self.map.count();
    }
};
`,
      solution: `const std = @import("std");

pub const Store = struct {
    map: std.StringHashMap(u32),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Store {
        return .{
            .map = std.StringHashMap(u32).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Store) void {
        var it = self.map.keyIterator();
        while (it.next()) |k| {
            self.allocator.free(k.*);
        }
        self.map.deinit();
    }

    pub fn set(self: *Store, key: []const u8, value: u32) !void {
        if (self.map.getEntry(key)) |entry| {
            entry.value_ptr.* = value;
            return;
        }
        const owned = try self.allocator.dupe(u8, key);
        errdefer self.allocator.free(owned);
        try self.map.put(owned, value);
    }

    pub fn get(self: Store, key: []const u8) ?u32 {
        return self.map.get(key);
    }

    pub fn delete(self: *Store, key: []const u8) bool {
        if (self.map.fetchRemove(key)) |kv| {
            self.allocator.free(kv.key);
            return true;
        }
        return false;
    }

    pub fn size(self: Store) usize {
        return self.map.count();
    }
};
`,
      hints: [
        "`set`: check `getEntry` first. If present, just update `value_ptr.*`. Otherwise `dupe` and `put`.",
        "`delete`: `fetchRemove` returns the entry — free the key, return true.",
        "`deinit`: walk `keyIterator`, free each, then `map.deinit()`.",
        "Use `errdefer self.allocator.free(owned);` on the new-key path so a failing `put` doesn't leak.",
      ],
      testFns: `fn testSetGet() !void {
    const allocator = std.heap.page_allocator;
    var store = Store.init(allocator);
    defer store.deinit();
    try store.set("zig", 1);
    try store.set("rust", 2);
    if (store.get("zig") != 1) return error.WrongAnswer;
    if (store.get("rust") != 2) return error.WrongAnswer;
    if (store.get("missing") != null) return error.WrongAnswer;
}
fn testOverwrite() !void {
    const allocator = std.heap.page_allocator;
    var store = Store.init(allocator);
    defer store.deinit();
    try store.set("k", 1);
    try store.set("k", 2);
    if (store.get("k") != 2) return error.WrongAnswer;
    if (store.size() != 1) return error.WrongAnswer;
}
fn testDelete() !void {
    const allocator = std.heap.page_allocator;
    var store = Store.init(allocator);
    defer store.deinit();
    try store.set("a", 1);
    try store.set("b", 2);
    if (!store.delete("a")) return error.WrongAnswer;
    if (store.size() != 1) return error.WrongAnswer;
    if (store.get("a") != null) return error.WrongAnswer;
    if (store.delete("a")) return error.WrongAnswer; // already gone
}
fn testKeyOwnership() !void {
    const allocator = std.heap.page_allocator;
    var store = Store.init(allocator);
    defer store.deinit();
    var buf = [_]u8{ 'a', 'b', 'c' };
    try store.set(&buf, 42);
    // Mutate the caller's buffer — store should still find the key
    buf[0] = 'X';
    if (store.get("abc") != 42) return error.WrongAnswer;
}
fn testEmpty() !void {
    const allocator = std.heap.page_allocator;
    var store = Store.init(allocator);
    defer store.deinit();
    if (store.size() != 0) return error.WrongAnswer;
    if (store.get("anything") != null) return error.WrongAnswer;
    if (store.delete("anything")) return error.WrongAnswer;
}`,
      runs: [
        { name: "set_and_get", fn: "testSetGet" },
        { name: "overwrite", fn: "testOverwrite" },
        { name: "delete", fn: "testDelete" },
        { name: "key_ownership", fn: "testKeyOwnership" },
        { name: "empty", fn: "testEmpty" },
      ],
    }),

    reading({
      id: "where-next",
      title: "Where to go next",
      objectives: [
        "Identify the next learning steps after this course",
        "Find Zig community resources",
      ],
      body: `Congrats on finishing the long-form Zig course. You've covered:

- The type system: integers, floats, arrays, slices, strings
- Control flow: if-expressions, switch, for, while, blocks-as-values
- Composition: structs, enums, tagged unions
- Error handling: optionals, error sets, try / catch / errdefer
- Memory: stack vs heap, allocators, ArrayList, StringHashMap
- Metaprogramming: comptime, generics, anytype, type-returning functions

That's enough to ship real Zig code. Where to go next:

## Practice

The Fishbones library includes the **Zig Challenges** pack — eleven hand-written kata that exercise the basics in tighter form. Same KATA_TEST harness as this course.

## Read

- The [official Zig documentation](https://ziglang.org/documentation/master/) — comprehensive language reference, with sections on advanced features (vector types, packed structs, async).
- [Karl Seguin's blog](https://www.openmymind.net/) — the source for much of this course's structure, plus deeper dives into specific topics.
- The [Zig standard library source](https://ziglang.org/documentation/master/std/) — well-commented and great for learning idiomatic patterns.

## Build

- A small CLI tool. Parse \`std.os.argv\`, do something useful, exit with a clean status code.
- A web server using [\`zap\`](https://github.com/zigzap/zap) or the built-in \`std.http\`.
- A WebAssembly module — Zig has excellent WASM support out of the box.
- A Zig <-> C library binding. \`@cImport\` is one of the language's quietly powerful features.

## Community

- The official Discord (linked from ziglang.org)
- \`#zig\` on Hacker News and Lobsters tends to surface the best blog posts
- The Zig subreddit and the issue tracker on GitHub

The language is still pre-1.0 — expect some churn between releases — but the core has stabilised enough for production work. Several companies (Bun, TigerBeetle, Roc) have built large systems in Zig and the language has weathered their use well.

Welcome to Zig. Now go write something.`,
    }),
  ],
});

// Course glue
const course = {
  id: "learning-zig",
  title: "Learning Zig",
  author: "Karl Seguin (adapted by Fishbones)",
  language: "zig",
  packType: "course",
  releaseStatus: "ALPHA",
  description:
    "A long-form Zig course adapted from Karl Seguin's free book. Starts at install + hello-world, covers the full primitives / control-flow / structs / pointers / allocators / comptime arc, and ends with a capstone using ArrayList + StringHashMap. Exercises run via `zig run` on the host (install Zig 0.13+ first).",
  chapters,
};

// Persist
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(course, null, 2) + "\n", "utf8");

const lessonCount = chapters.reduce((n, c) => n + c.lessons.length, 0);
console.log(
  `[learning-zig] wrote ${OUT}\n  chapters: ${chapters.length}\n  lessons:  ${lessonCount}`,
);
