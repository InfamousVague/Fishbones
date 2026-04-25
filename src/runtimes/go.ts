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
  const merged = testCode ? joinCodeAndTests(code, testCode) : code;
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
  const allImports = dedupeImports([...userImports, ...testImports]);
  const importBlock = allImports.length
    ? `import (\n${allImports.map((i) => `\t${i}`).join("\n")}\n)\n\n`
    : "";
  return `package main\n\n${importBlock}${userRest.trim()}\n\n${testRest.trim()}\n`;
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
