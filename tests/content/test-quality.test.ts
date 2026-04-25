/// Challenge-pack test-quality linter.
///
/// Walks every challenge pack on disk (book courses ignored) and per
/// exercise emits one vitest case that runs language-appropriate
/// static checks on `tests` — catching the "oh yeah it compiles" /
/// "always passes" patterns that slip through LLM generation even
/// when the prompt forbids them.
///
/// Different from `exercises.test.ts` in scope: that spec actually
/// RUNS the code. This one only looks at source — fast (~seconds for
/// 1 500 challenges), zero toolchain deps, runs on any machine
/// regardless of which compilers are installed.
///
/// Intent: a failing case here means the CHALLENGE is weak, not that
/// the learner wrote bad code. Each failure message lists the specific
/// anti-pattern(s) detected so you can regenerate or patch the pack
/// entry.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "vitest";

interface Lesson {
  id: string;
  kind: string;
  title: string;
  language?: string;
  starter?: string;
  solution?: string;
  tests?: string;
  files?: Array<{ name: string; language: string; content: string }>;
  solutionFiles?: Array<{ name: string; language: string; content: string }>;
}

interface Chapter {
  id: string;
  title?: string;
  lessons: Lesson[];
}

interface Course {
  id?: string;
  title: string;
  language?: string;
  packType?: "course" | "challenges";
  chapters: Chapter[];
}

const COURSES_DIR =
  process.env.KATA_COURSES_DIR ??
  path.join(
    os.homedir(),
    "Library/Application Support/com.mattssoftware.kata/courses",
  );

function loadCourses(): Array<{ dir: string; course: Course }> {
  if (!fs.existsSync(COURSES_DIR)) return [];
  const out: Array<{ dir: string; course: Course }> = [];
  for (const d of fs.readdirSync(COURSES_DIR).sort()) {
    const p = path.join(COURSES_DIR, d, "course.json");
    if (!fs.existsSync(p)) continue;
    try {
      const course = JSON.parse(fs.readFileSync(p, "utf8")) as Course;
      out.push({ dir: d, course });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

const ALL_COURSES = loadCourses();
const LANG_FILTER = process.env.KATA_LANG || null;

// --------------------------------------------------------------------
// Per-language static validators. Each returns a list of issue
// strings; empty list = clean.
// --------------------------------------------------------------------

/// Every validator receives the full test body, the solution body, and
/// the starter body. Some checks (e.g. "starter differs from solution")
/// need all three.
interface LintInputs {
  tests: string;
  solution: string;
  starter: string;
}

/// Rules common to every language: tests exist, starter differs from
/// solution (otherwise "pass solution" and "fail starter" can't be
/// distinguished by any test), tests reference an identifier that
/// exists in the solution.
function lintUniversal(i: LintInputs): string[] {
  const out: string[] = [];
  if (!i.tests.trim()) {
    out.push("tests body is empty");
    return out;
  }
  if (i.starter.trim() === i.solution.trim()) {
    out.push(
      "starter and solution are identical — 'starter fails' cannot be distinguished from 'solution passes'",
    );
  }
  return out;
}

/// JS / TS validator — fishbones runtime uses a Jest-like harness:
/// `test("name", () => { ... })` / `expect(x).toBe(y)` etc., with the
/// user's exports loaded via `require('./user')`.
function lintJsTs(i: LintInputs): string[] {
  const out = lintUniversal(i);
  const { tests } = i;

  const testCalls = (tests.match(/\b(?:test|it)\s*\(/g) || []).length;
  if (testCalls < 3) {
    out.push(`only ${testCalls} test()/it() calls — need ≥ 3 (normal / edge / error)`);
  }

  const expectCalls = (tests.match(/\bexpect\s*\(/g) || []).length;
  if (expectCalls < 3) {
    out.push(`only ${expectCalls} expect() calls — need ≥ 3 real assertions`);
  }

  // "Structural only" detection — tests that ONLY check typeof/
  // toBeDefined/truthy without ever comparing a concrete value.
  // Use a substring check for the matcher method rather than a
  // full expect(...).toBe(...) regex, because `expect(fn([1,2]))`
  // has unbalanced parens by classical regex standards — the naive
  // `[^)]*` misses it and we'd false-flag legit assertions.
  const CONCRETE_MATCHERS = [
    ".toBe(",
    ".toEqual(",
    ".toStrictEqual(",
    ".toContain(",
    ".toBeCloseTo(",
    ".toMatch(",
    ".toBeGreaterThan",
    ".toBeLessThan",
    ".toHaveLength(",
    ".toHaveProperty(",
    ".toThrow(",
  ];
  const hasConcreteAssertion = CONCRETE_MATCHERS.some((m) => tests.includes(m));
  if (!hasConcreteAssertion && expectCalls > 0) {
    out.push(
      "no concrete-value assertions (toBe / toEqual / toContain / etc.) — " +
        "looks like structural-only checks that always pass",
    );
  }

  // "Trust the structure" — only typeof === 'function' / toBeDefined /
  // toBeTruthy on the user's export. Flag when THAT pattern is the
  // dominant one.
  const weakOnlyPatterns = [
    /expect\s*\(\s*typeof\s+\w+\s*\)\s*\.\s*toBe\s*\(\s*["']function["']\s*\)/g,
    /expect\s*\([^)]+\)\s*\.\s*toBeDefined\s*\(\s*\)/g,
    /expect\s*\([^)]+\)\s*\.\s*toBeTruthy\s*\(\s*\)/g,
  ];
  const weakCount = weakOnlyPatterns.reduce(
    (n, p) => n + (tests.match(p)?.length ?? 0),
    0,
  );
  if (weakCount > 0 && weakCount >= expectCalls * 0.6) {
    out.push(
      `${weakCount}/${expectCalls} assertions are structural-only ` +
        `(typeof === 'function' / toBeDefined / toBeTruthy) — the starter ` +
        `will likely pass these without implementing the real behaviour`,
    );
  }

  return out;
}

/// Python validator — harness uses `@test('name')` decorators on
/// short-named functions, with `expect(x).to_be(y)` / `to_equal` /
/// `to_contain` assertions. Functions don't need a `test_` prefix
/// because the decorator does the registration.
function lintPython(i: LintInputs): string[] {
  const out = lintUniversal(i);
  const { tests } = i;

  const testDecorators = (tests.match(/@test\s*\(/g) || []).length;
  if (testDecorators < 3) {
    out.push(`only ${testDecorators} @test(...) decorators — need ≥ 3`);
  }

  const expectCalls = (tests.match(/\bexpect\s*\(/g) || []).length;
  if (expectCalls < 3) {
    out.push(`only ${expectCalls} expect() calls — need ≥ 3`);
  }

  // Substring check — same rationale as the JS/TS validator: nested
  // parens inside the expect argument (e.g. `expect(fn([1,2]))`) break
  // the classical `expect(...).to_X(...)` regex, and we'd rather
  // miss a real structural-only test than false-flag every one.
  const PY_MATCHERS = [
    ".to_be(",
    ".to_equal(",
    ".to_contain(",
    ".to_be_close_to(",
    ".to_match(",
    ".to_raise(",
  ];
  const hasConcrete = PY_MATCHERS.some((m) => tests.includes(m));
  if (!hasConcrete && expectCalls > 0) {
    out.push("no concrete-value assertions — looks structural-only");
  }

  if (!/\bfrom\s+user\s+import\b/.test(tests)) {
    out.push("tests don't `from user import` — probably not exercising the learner's code");
  }

  return out;
}

/// Rust validator — harness wraps tests in `#[cfg(test)] mod tests`.
/// We expect raw `#[test]` fns with assert_eq / assert_ne / assert
/// macros inside each.
function lintRust(i: LintInputs): string[] {
  const out = lintUniversal(i);
  const { tests } = i;

  const testAttrs = (tests.match(/#\[test\]/g) || []).length;
  if (testAttrs < 3) {
    out.push(`only ${testAttrs} #[test] functions — need ≥ 3`);
  }

  const asserts =
    (tests.match(/\bassert(?:_eq|_ne)?\s*!\s*\(/g) || []).length;
  if (asserts < 3) {
    out.push(`only ${asserts} assert*! macros — need ≥ 3 real assertions`);
  }

  // Tests that do `let _ = foo(...);` with no assertion after are
  // execution-only — they pass as long as foo compiles.
  const execOnly = (tests.match(/let\s+_\s*=\s*\w+\s*\([^)]*\);\s*\}/g) || []).length;
  if (execOnly > 0) {
    out.push(
      `${execOnly} 'let _ = fn(...)' pattern(s) with no assertion after — compile-only`,
    );
  }

  return out;
}

/// Go validator — we use a stdout-protocol harness where tests are
/// `func kataTest_X() error` returning nil on pass, a non-nil error on
/// fail, driven by a main() that iterates and prints KATA_TEST:: lines.
function lintGo(i: LintInputs): string[] {
  const out = lintUniversal(i);
  const { tests } = i;

  const kataFns =
    (tests.match(/func\s+kataTest_\w+\s*\(\s*\)\s*error/g) || []).length;
  if (kataFns < 3) {
    out.push(`only ${kataFns} kataTest_* fns — need ≥ 3`);
  }

  // Each kataTest function MUST have at least one way to return a
  // non-nil error — either `return fmt.Errorf(...)`, `return
  // errors.New(...)`, or `return err` inside a conditional branch.
  // A fn whose ONLY return statement is `return nil` always passes
  // regardless of what the learner wrote.
  const erroringFns =
    (tests.match(
      /func\s+kataTest_\w+\s*\(\s*\)\s*error\s*\{[\s\S]*?return\s+(?:fmt\.Errorf|errors\.New|err\b)/g,
    ) || []).length;
  if (erroringFns < kataFns) {
    out.push(
      `${kataFns - erroringFns} kataTest_* fn(s) never return an error — always pass`,
    );
  }

  // No main() means no KATA_TEST output — the runtime sees 0 tests
  // and our e2e test wrongly interprets that as "passing".
  if (!/\bfunc\s+main\s*\(\s*\)/.test(tests)) {
    out.push("tests file has no `func main()` — no KATA_TEST output will emit");
  }

  // Starter returning nil channels / zero values is a known trap for
  // concurrency exercises (reading from a nil channel blocks forever,
  // tests hang, runtime reports 0 tests parsed). Flag if starter is
  // just a `return nil`.
  if (/\breturn\s+nil\s*$/m.test(i.starter) && /\bchan\b/.test(i.starter)) {
    out.push(
      "starter returns a nil channel — reads will block forever and the sandbox reports 0 tests",
    );
  }

  return out;
}

/// Shared KATA_TEST-protocol validator for compiled native languages
/// (C, C++, Java, Kotlin, C#). These rely on printf-ing
/// `KATA_TEST::<name>::PASS|FAIL` lines. Different languages spell
/// the helper names differently — we count test sites via the
/// language-specific pattern passed in.
function lintKataProtocol(
  i: LintInputs,
  lang: string,
  opts: {
    /// Regex matching a per-test-case emission site (either a helper
    /// function definition OR an inline RunTest(...) call, depending
    /// on the language). Must be ≥ 3 for the pack to be considered
    /// non-weak.
    testSites: RegExp;
    /// Human label for the site concept — used in the error message.
    siteLabel: string;
  },
): string[] {
  const out = lintUniversal(i);
  const { tests } = i;

  if (!tests.includes("KATA_TEST::")) {
    out.push(
      `tests file never emits a KATA_TEST:: marker — no results will parse (${lang})`,
    );
  }
  const sites = (tests.match(opts.testSites) || []).length;
  if (sites < 3) {
    out.push(`only ${sites} ${opts.siteLabel} — need ≥ 3 (${lang})`);
  }

  // Conditional PASS|FAIL emission — covers the per-language syntaxes:
  //   C, C++, Java, C#: ternary  `? "PASS" : "FAIL"`
  //   Kotlin:           if-expr  `if (...) "PASS" else "FAIL"`
  //   Any lang:         both strings mentioned somewhere near each other
  //                     in an expression (substring proxy).
  // A tests file that hard-codes PASS with no FAIL path always passes
  // regardless of the user function's behaviour, so we flag only when
  // NEITHER string appears at all, OR when one appears without the other.
  const mentionsPass = /"PASS"/.test(tests);
  const mentionsFail = /"FAIL"/.test(tests);
  if (tests.includes("KATA_TEST::") && (!mentionsPass || !mentionsFail)) {
    out.push(
      `no conditional PASS/FAIL emission — tests mention ${
        mentionsPass && !mentionsFail
          ? '"PASS" but never "FAIL"'
          : !mentionsPass && mentionsFail
            ? '"FAIL" but never "PASS"'
            : "neither PASS nor FAIL literal"
      } — the starter will always appear to pass (${lang})`,
    );
  }
  return out;
}

/// C / C++ — `static int kata_test_name()` returning 0 on success /
/// 1 on failure, main() prints KATA_TEST:: lines based on return.
function lintC(i: LintInputs): string[] {
  return lintKataProtocol(i, "c", {
    testSites: /\bkata_test_\w+\s*\(\s*(?:void)?\s*\)/g,
    siteLabel: "kata_test_* fn(s)",
  });
}
function lintCpp(i: LintInputs): string[] {
  return lintKataProtocol(i, "cpp", {
    testSites: /\bkata_test_\w+\s*\(\s*(?:void)?\s*\)/g,
    siteLabel: "kata_test_* fn(s)",
  });
}

/// Java — camelCase `static int kataTestName()` or similar.
function lintJava(i: LintInputs): string[] {
  return lintKataProtocol(i, "java", {
    testSites: /\bkataTest\w+\s*\(\s*\)/g,
    siteLabel: "kataTest* method(s)",
  });
}

/// Kotlin — `fun kataTestName(): Boolean = ...`.
function lintKotlin(i: LintInputs): string[] {
  return lintKataProtocol(i, "kotlin", {
    testSites: /\bfun\s+kataTest\w+\s*\(\s*\)/g,
    siteLabel: "fun kataTest* declaration(s)",
  });
}

/// C# — pattern is different: a local `RunTest("name", () => expr)`
/// helper is called per case. Count RunTest invocations.
function lintCSharp(i: LintInputs): string[] {
  return lintKataProtocol(i, "csharp", {
    testSites: /\bRunTest\s*\(\s*"[^"]+"/g,
    siteLabel: "RunTest(...) invocations",
  });
}

/// Swift — uses `precondition(expr, "name")` assertions that abort
/// on failure. No KATA_TEST protocol. Count preconditions; a pack
/// that ships one or zero is suspect.
function lintSwift(i: LintInputs): string[] {
  const out = lintUniversal(i);
  const { tests } = i;
  if (!tests.trim()) {
    // Run-only is fine for Swift; other-runtimes synthesize a single
    // "program exited cleanly" result. Only flag if the pack declared
    // tests but they're effectively empty.
    return out;
  }
  const preconds = (tests.match(/\bprecondition\s*\(/g) || []).length;
  if (preconds < 3) {
    out.push(
      `only ${preconds} precondition(...) assertion(s) — need ≥ 3 (swift)`,
    );
  }
  return out;
}

/// Assembly — the tests file is a hand-written .s that emits "PASS" /
/// "FAIL" strings based on cmp + b.eq branches. Too syntax-specific
/// to AST-parse reliably; coarse sanity checks instead.
function lintAssembly(i: LintInputs): string[] {
  const out = lintUniversal(i);
  const { tests } = i;
  if (!tests.trim()) return out;
  // A pack with tests should at minimum branch on a comparison — that
  // is, `cmp ... / b.eq ...` or the x86_64 equivalent — and have a
  // failure path (write "FAIL").
  if (!/\b(?:cmp|test)\b/i.test(tests)) {
    out.push("tests have no cmp/test instructions — can't compare results (assembly)");
  }
  if (!/FAIL|fail/.test(tests)) {
    out.push("tests never emit a FAIL path — can only print success (assembly)");
  }
  return out;
}

function dispatch(language: string, i: LintInputs): string[] {
  switch (language) {
    case "javascript":
    case "typescript":
      return lintJsTs(i);
    case "python":
      return lintPython(i);
    case "rust":
      return lintRust(i);
    case "go":
      return lintGo(i);
    case "c":
      return lintC(i);
    case "cpp":
      return lintCpp(i);
    case "java":
      return lintJava(i);
    case "kotlin":
      return lintKotlin(i);
    case "csharp":
      return lintCSharp(i);
    case "swift":
      return lintSwift(i);
    case "assembly":
      return lintAssembly(i);
    default:
      return [`unknown language: ${language}`];
  }
}

/// Combine starter/solution (single-file OR multi-file) into one blob
/// each so the validators can grep without worrying about file layout.
function collateStarter(l: Lesson): string {
  if (l.files && l.files.length > 0) {
    return l.files.map((f) => f.content).join("\n\n");
  }
  return l.starter ?? "";
}
function collateSolution(l: Lesson): string {
  if (l.solutionFiles && l.solutionFiles.length > 0) {
    return l.solutionFiles.map((f) => f.content).join("\n\n");
  }
  return l.solution ?? "";
}

// --------------------------------------------------------------------
// Test generation
// --------------------------------------------------------------------

if (ALL_COURSES.length === 0) {
  describe("challenge-test-quality", () => {
    test.skip("no courses found at " + COURSES_DIR, () => {});
  });
}

for (const { course, dir } of ALL_COURSES) {
  if (course.packType !== "challenges") continue;
  if (LANG_FILTER && course.language !== LANG_FILTER) continue;

  describe(`${course.title} (${dir})`, () => {
    for (const ch of course.chapters) {
      for (const l of ch.lessons) {
        if (l.kind !== "exercise" && l.kind !== "mixed") continue;
        const lang = l.language ?? course.language ?? "unknown";
        const label = `${ch.title ?? "chapter"} / ${l.title} · ${l.id}`;
        test(label, () => {
          const inputs: LintInputs = {
            tests: l.tests ?? "",
            starter: collateStarter(l),
            solution: collateSolution(l),
          };
          const issues = dispatch(lang, inputs);
          if (issues.length > 0) {
            throw new Error(
              "Weak tests detected — regenerate or patch:\n" +
                issues.map((s) => "  • " + s).join("\n"),
            );
          }
        });
      }
    }
  });
}
