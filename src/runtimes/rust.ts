import type { RunResult, LogLine, TestResult } from "./types";

/// Rust via play.rust-lang.org/execute.
///
/// Rust can't be cleanly compiled in-browser for V1 (rustc-as-WASM is huge and
/// slow), so we lean on the public Rust Playground execute endpoint. The
/// service compiles user code with cargo on their infra and returns
/// stdout/stderr. When a lesson has tests, we submit code + test code as a
/// single file with `#[cfg(test)] mod tests { ... }` wrapped around the
/// tests and set `tests: true` to invoke `cargo test`.
///
/// When we later ship a Tauri subprocess fallback (step 9 for swift, same
/// pattern for rust), `runRust` will try local rustc first and fall back to
/// Playground on missing toolchain.

const PLAYGROUND_URL = "https://play.rust-lang.org/execute";
const TIMEOUT_MS = 20000;

interface PlaygroundResponse {
  success: boolean;
  stdout: string;
  stderr: string;
}

export async function runRust(code: string, testCode?: string): Promise<RunResult> {
  const start = performance.now();
  const merged = testCode ? joinCodeAndTests(code, testCode) : code;
  const isTest = !!testCode;

  let body: PlaygroundResponse;
  try {
    const res = await fetchWithTimeout(PLAYGROUND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "stable",
        mode: "debug",
        edition: "2021",
        crateType: "bin",
        tests: isTest,
        code: merged,
        backtrace: false,
      }),
    }, TIMEOUT_MS);
    body = (await res.json()) as PlaygroundResponse;
  } catch (err) {
    return {
      logs: [],
      error:
        err instanceof Error
          ? `Rust Playground request failed: ${err.message}`
          : "Rust Playground request failed",
      durationMs: performance.now() - start,
    };
  }

  const logs: LogLine[] = [];
  if (body.stdout) logs.push({ level: "log", text: body.stdout.trimEnd() });
  if (body.stderr && !isCompileSuccess(body.stderr)) {
    // cargo emits progress like "Compiling playground v0.0.1 ..." to stderr
    // even on success. Only surface stderr lines that look like real errors.
    const filtered = filterCompilerNoise(body.stderr);
    if (filtered) logs.push({ level: "error", text: filtered });
  }

  const tests = isTest ? parseTestResults(body.stdout) : undefined;

  // A compile error means `success: false` with no tests run.
  if (!body.success && (!tests || tests.length === 0)) {
    return {
      logs,
      error: extractCompileError(body.stderr) || "compilation failed",
      durationMs: performance.now() - start,
    };
  }

  return {
    logs,
    tests,
    durationMs: performance.now() - start,
  };
}

/// Merge user code and test code into a single crate source. The user writes
/// ordinary functions at the top level; the test file's #[test] functions
/// go into a `#[cfg(test)] mod kata_tests { ... }` block that imports the
/// parent scope via `use super::*;`.
function joinCodeAndTests(userCode: string, testCode: string): string {
  // Ensure the file has a main() so cargo run / test is happy even if the
  // user's starter didn't include one.
  const mainFallback = /\bfn\s+main\s*\(/.test(userCode) ? "" : "\nfn main() {}\n";
  return `${userCode}${mainFallback}

#[cfg(test)]
mod kata_tests {
    use super::*;
${indent(testCode, 4)}
}
`;
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s.split("\n").map((l) => (l.length ? pad + l : l)).join("\n");
}

/// Parse the cargo test output lines. They look like:
///   test tests::foo ... ok
///   test tests::bar ... FAILED
/// plus a blockish "failures:" section after all tests run listing the
/// assertion message under each name.
function parseTestResults(stdout: string): TestResult[] {
  const lines = stdout.split("\n");
  const results: TestResult[] = [];
  const failureMsgs = new Map<string, string>();

  // Pass 1: test summary lines
  for (const line of lines) {
    const m = /^test\s+([\w:]+)\s+\.\.\.\s+(ok|FAILED|ignored)\b/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/^kata_tests::/, "");
    if (m[2] === "ok") results.push({ name, passed: true });
    else if (m[2] === "FAILED") results.push({ name, passed: false });
    // ignored is skipped
  }

  // Pass 2: failure blocks like
  //   ---- kata_tests::foo stdout ----
  //   thread 'kata_tests::foo' panicked at 'assertion ...'
  for (let i = 0; i < lines.length; i++) {
    const m = /^----\s+([\w:]+)\s+stdout\s+----$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1].replace(/^kata_tests::/, "");
    const msgLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("---- ") && lines[j].trim() !== "") {
      msgLines.push(lines[j]);
      j++;
    }
    failureMsgs.set(name, msgLines.join("\n").trim());
    i = j;
  }

  // Attach messages
  return results.map((r) =>
    r.passed ? r : { ...r, error: failureMsgs.get(r.name) || "test failed" }
  );
}

function isCompileSuccess(stderr: string): boolean {
  return /Finished\b/.test(stderr);
}

function filterCompilerNoise(stderr: string): string {
  return stderr
    .split("\n")
    .filter(
      (l) =>
        !/^\s*Compiling\b/.test(l) &&
        !/^\s*Finished\b/.test(l) &&
        !/^\s*Running\b/.test(l) &&
        l.trim().length > 0
    )
    .join("\n");
}

function extractCompileError(stderr: string): string | undefined {
  // Grab the first `error[EXXXX]:` block, which is usually the most useful.
  const match = /(error(?:\[E\d+\])?:.*?)(?=\n\n|\nwarning:|$)/s.exec(stderr);
  if (match) return match[1].trim();
  // Fallback to anything stderr-y
  const filtered = filterCompilerNoise(stderr);
  return filtered || undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
