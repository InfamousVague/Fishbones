import type { RunResult, LogLine, TestResult } from "./types";

/// Go via play.golang.org/compile.
///
/// Same approach as rust.ts — we lean on a public playground because
/// compiling Go in-browser isn't viable. The compile endpoint takes a
/// single-source URL-encoded form body and returns JSON with stdout,
/// stderr, and a compile-error field.
///
/// TEST HARNESS
/// ------------
/// The Go Playground's compile endpoint doesn't expose `go test` directly,
/// so we use a structured-stdout convention instead:
///
///   Each test prints ONE of these lines, exactly:
///     KATA_TEST::<name>::PASS
///     KATA_TEST::<name>::FAIL::<single-line reason>
///
/// The challenge-pack generator is told to emit test code containing a
/// `main()` that runs each check and prints those lines. The runtime
/// parses them out of stdout to build TestResult[]. Any other stdout is
/// preserved as a `log`-level line so the learner can still `fmt.Println`
/// debug prints — parsing only consumes lines matching the exact pattern.

const PLAYGROUND_URL = "https://play.golang.org/compile";
const TIMEOUT_MS = 20000;

interface PlaygroundEvent {
  Message: string;
  Kind: "stdout" | "stderr";
  Delay: number;
}

interface PlaygroundResponse {
  Errors?: string;
  Events?: PlaygroundEvent[];
  Status?: number;
  IsTest?: boolean;
  TestsFailed?: number;
}

export async function runGo(code: string, testCode?: string): Promise<RunResult> {
  const start = performance.now();
  // When the lesson has no tests, the user's solution still has to
  // compile + link as `package main`. If they didn't write a
  // `func main() {}`, the Go linker errors with
  // `runtime.main_main·f: function main is undeclared`. Add an
  // empty fallback so compile-only solutions just work — it parallels
  // the same fallback in the Rust runtime.
  const codeForRun = testCode ? code : ensureMain(code);
  const merged = testCode ? joinCodeAndTests(code, testCode) : codeForRun;
  const isTest = !!testCode;

  let body: PlaygroundResponse;
  try {
    const form = new URLSearchParams({
      body: merged,
      version: "2",
    });
    const res = await fetchWithTimeout(
      PLAYGROUND_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      TIMEOUT_MS,
    );
    body = (await res.json()) as PlaygroundResponse;
  } catch (err) {
    return {
      logs: [],
      error:
        err instanceof Error
          ? `Go Playground request failed: ${err.message}`
          : "Go Playground request failed",
      durationMs: performance.now() - start,
      testsExpected: isTest,
    };
  }

  // Compile error surfaces directly in `Errors` — no events, no stdout.
  if (body.Errors && body.Errors.trim().length > 0) {
    return {
      logs: [],
      error: body.Errors.trim(),
      durationMs: performance.now() - start,
      testsExpected: isTest,
    };
  }

  const events = body.Events ?? [];
  const stdout = events
    .filter((e) => e.Kind === "stdout")
    .map((e) => e.Message)
    .join("");
  const stderr = events
    .filter((e) => e.Kind === "stderr")
    .map((e) => e.Message)
    .join("");

  const tests = isTest ? parseTestResults(stdout) : undefined;

  // Strip KATA_TEST lines from the log view — they're protocol, not output.
  // Anything the learner printed themselves still shows up.
  const displayStdout = isTest
    ? stdout
        .split("\n")
        .filter((l) => !/^KATA_TEST::/.test(l))
        .join("\n")
        .trim()
    : stdout.trimEnd();

  const logs: LogLine[] = [];
  if (displayStdout) logs.push({ level: "log", text: displayStdout });
  if (stderr) logs.push({ level: "error", text: stderr.trimEnd() });

  return {
    logs,
    tests,
    durationMs: performance.now() - start,
    testsExpected: isTest,
  };
}

/// Merge user code and test code into a single Go source. Both may declare
/// `package main` — we strip duplicates. The test file is expected to
/// provide its own `func main()`; user code is helper / top-level
/// declarations only. This matches the challenge-pack test contract.
///
/// Imports from both files are extracted and merged into a single top-level
/// block. Without this, the test file's `import` block lands *after* user
/// function declarations in the concatenated source and the compiler rejects
/// it with "imports must appear before other declarations".
function joinCodeAndTests(userCode: string, testCode: string): string {
  const stripPackage = (s: string) =>
    s.replace(/^\s*package\s+\w+\s*$/m, "");
  const { imports: userImports, rest: userRest } = extractImports(stripMain(stripPackage(userCode)));
  const { imports: testImports, rest: testRest } = extractImports(stripPackage(testCode));
  // Auto-derive imports from usage. LLM-generated tests routinely
  // call `fmt.Errorf` / `strings.Contains` / `errors.New` etc.
  // without declaring `import "fmt"` etc. — usually because the
  // import block lived inside a Rust-style preamble that we
  // stripped earlier. Detect symbol usage and add the matching
  // standard-library import. Dedupe takes care of overlaps.
  const allUsed = `${userRest}\n${testRest}`;
  const autoImports = inferStdlibImports(allUsed, [...userImports, ...testImports]);
  const allImports = dedupeImports([...userImports, ...testImports, ...autoImports]);
  const importBlock = allImports.length
    ? `import (\n${allImports.map((i) => `\t${i}`).join("\n")}\n)\n\n`
    : "";
  return `package main\n\n${importBlock}${userRest.trim()}\n\n${testRest.trim()}\n`;
}

/// Add a minimal `func main() {}` if the source doesn't already
/// declare one. `package main` requires a main function to link;
/// without this fallback, lessons whose solution is purely
/// helper-function declarations fail with
/// `runtime.main_main·f: function main is undeclared`.
function ensureMain(src: string): string {
  if (/\bfunc\s+main\s*\(\s*\)/.test(src)) return src;
  return `${src.trimEnd()}\n\nfunc main() {}\n`;
}

/// Stdlib package usage detector. Each entry is { import-spec,
/// regex-that-matches-symbol-use }. We add the import only if
/// (a) the regex hits the source AND (b) it isn't already imported
/// (to avoid `imported and not used` errors when the user already
/// declared it). Conservative — only the packages we've actually
/// seen LLM-generated tests reach for. Easy to extend.
const STDLIB_PROBES: Array<{ spec: string; re: RegExp }> = [
  { spec: '"fmt"', re: /\bfmt\.\w/ },
  { spec: '"errors"', re: /\berrors\.\w/ },
  { spec: '"strings"', re: /\bstrings\.\w/ },
  { spec: '"strconv"', re: /\bstrconv\.\w/ },
  { spec: '"testing"', re: /\btesting\.\w/ },
  { spec: '"io"', re: /\bio\.\w/ },
  { spec: '"os"', re: /\bos\.\w/ },
  { spec: '"bytes"', re: /\bbytes\.\w/ },
  { spec: '"context"', re: /\bcontext\.\w/ },
  { spec: '"time"', re: /\btime\.\w/ },
  { spec: '"sync"', re: /\bsync\.\w/ },
  { spec: '"sync/atomic"', re: /\batomic\.\w/ },
  { spec: '"path/filepath"', re: /\bfilepath\.\w/ },
  { spec: '"compress/gzip"', re: /\bgzip\.\w/ },
  { spec: '"encoding/json"', re: /\bjson\.\w/ },
  { spec: '"net/http"', re: /\bhttp\.\w/ },
  { spec: '"net/http/httptest"', re: /\bhttptest\.\w/ },
  { spec: '"unsafe"', re: /\bunsafe\.\w/ },
  { spec: '"reflect"', re: /\breflect\.\w/ },
];

function inferStdlibImports(code: string, existing: string[]): string[] {
  const have = new Set(existing.map((i) => i.trim()));
  const out: string[] = [];
  for (const probe of STDLIB_PROBES) {
    if (have.has(probe.spec)) continue;
    if (probe.re.test(code)) out.push(probe.spec);
  }
  return out;
}

/// Remove the top-level `func main() { ... }` block from a Go source. Used
/// when merging with tests — the test file is the authority on `main()` and
/// any user-provided `main()` would collide at link time. We find the
/// opening brace and walk to the matching closing brace, respecting nested
/// braces, so function bodies of any complexity are removed cleanly.
function stripMain(src: string): string {
  const re = /^\s*func\s+main\s*\(\s*\)\s*\{/m;
  const m = re.exec(src);
  if (!m) return src;
  const start = m.index + m[0].length - 1; // position of opening `{`
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(0, m.index) + src.slice(i + 1);
    }
  }
  return src; // unmatched braces — give up, let the compiler report it
}

/// Pull every `import "x"` and `import ( ... )` block out of a Go source,
/// returning the list of import specs (each a `"path"` or `alias "path"`
/// string) plus the remaining source with the import statements removed.
function extractImports(src: string): { imports: string[]; rest: string } {
  const imports: string[] = [];
  let rest = src;
  // Block form: `import ( ... )` — possibly multiline.
  rest = rest.replace(/^\s*import\s*\(([\s\S]*?)\)/gm, (_m, body: string) => {
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (t) imports.push(t);
    }
    return "";
  });
  // Single form: `import "path"` or `import alias "path"`.
  rest = rest.replace(/^\s*import\s+((?:[A-Za-z_][\w]*\s+)?"[^"]+")\s*$/gm, (_m, spec) => {
    imports.push(spec);
    return "";
  });
  return { imports, rest };
}

function dedupeImports(specs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of specs) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/// Pull TestResult[] out of the stdout stream. Lines look like
/// `KATA_TEST::test_reverse_basic::PASS` or
/// `KATA_TEST::test_reverse_basic::FAIL::expected "olleh", got "hello"`.
function parseTestResults(stdout: string): TestResult[] {
  const results: TestResult[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^KATA_TEST::([\w-]+)::(PASS|FAIL)(?:::(.*))?$/.exec(line);
    if (!m) continue;
    if (m[2] === "PASS") {
      results.push({ name: m[1], passed: true });
    } else {
      results.push({ name: m[1], passed: false, error: m[3] || "test failed" });
    }
  }
  return results;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
