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
///
/// Resilience notes (added after the verifier surfaced systemic failures):
///   - The Playground occasionally returns 200 with an *error envelope*
///     (`{error: "..."}`) instead of the usual `{success, stdout, stderr}`
///     shape. Every accessor below treats the fields as optional and falls
///     back to `""` so a missing `stdout` can't crash `parseTestResults`.
///   - Network blips are common on the desktop build (CORS preflight
///     races, sleeping radio waking). We retry the fetch ONCE after a
///     short backoff. One retry is the right ceiling — the Playground
///     itself is slow enough that more retries would balloon a verify
///     run, and a second consecutive fail almost always means the
///     service is genuinely down.
///   - Anything that escapes the request/parse pipeline gets caught at
///     the top level and folded into a `RunResult` with `error: ...`.
///     Throwing past `runRust` puts the raw stack trace into the
///     workbench's error pane, which was the original "parseTestResults
///     @ rust.ts:69" symptom.

const PLAYGROUND_URL = "https://play.rust-lang.org/execute";
const TIMEOUT_MS = 20_000;
const RETRY_BACKOFF_MS = 500;

interface PlaygroundResponse {
  /// All three are optional because the Playground sometimes
  /// returns a `{ error: "..." }`-shaped envelope on overload /
  /// rate-limit / transient errors with no `success` field at all.
  success?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export async function runRust(code: string, testCode?: string): Promise<RunResult> {
  const start = performance.now();
  const isTest = !!testCode;

  // Top-level guard. Anything that makes it out of the inner pipeline
  // — JSON parse error, surprise property access on a malformed body,
  // runtime exception inside parseTestResults — gets folded into a
  // structured RunResult instead of bubbling up as a raw stack trace.
  // The "parseTestResults@rust.ts:69" failures the verifier surfaced
  // were exactly this: a path that threw past runRust and dumped its
  // stack into the workbench error pane.
  try {
    const merged = testCode ? joinCodeAndTests(code, testCode) : code;
    const body = await fetchPlaygroundWithRetry(merged, isTest);
    return buildResult(body, isTest, start);
  } catch (err) {
    return {
      logs: [],
      error: friendlyErrorMessage(err),
      durationMs: performance.now() - start,
      testsExpected: isTest,
    };
  }
}

/// Format a thrown error into a one-line, learner-readable string.
/// We strip the stack so the workbench output doesn't show the
/// internal call site (`parseTestResults@rust.ts:69`) — that's
/// noise to the user and useless to the LLM in a fix-prompt
/// export.
function friendlyErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "Rust Playground request timed out";
    return `Rust Playground error: ${err.message}`;
  }
  return "Rust Playground error";
}

async function fetchPlaygroundWithRetry(
  merged: string,
  isTest: boolean,
): Promise<PlaygroundResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(
        PLAYGROUND_URL,
        {
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
        },
        TIMEOUT_MS,
      );
      // Some failure modes (502, rate limit overlay) return non-JSON
      // bodies. Catch the parse error so we can still retry.
      const body = (await res.json()) as PlaygroundResponse;
      return body;
    } catch (err) {
      lastErr = err;
      // Last attempt — re-throw so the outer try/catch can fold it
      // into a RunResult.
      if (attempt === 1) break;
      await delay(RETRY_BACKOFF_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function buildResult(
  body: PlaygroundResponse,
  isTest: boolean,
  start: number,
): RunResult {
  // Defensive everywhere: the Playground envelope is optional all
  // the way down. Treat missing fields as empty strings so we can't
  // trigger TypeErrors on .split / .test / .replace calls below.
  const stdout = body.stdout ?? "";
  const stderr = body.stderr ?? "";

  const logs: LogLine[] = [];
  if (stdout) logs.push({ level: "log", text: stdout.trimEnd() });
  if (stderr && !isCompileSuccess(stderr)) {
    // cargo emits progress like "Compiling playground v0.0.1 ..." to stderr
    // even on success. Only surface stderr lines that look like real errors.
    const filtered = filterCompilerNoise(stderr);
    if (filtered) logs.push({ level: "error", text: filtered });
  }

  // Error-envelope short-circuit: if the Playground returned
  // `{error: "..."}` with no stdout/stderr, surface the message
  // directly. Without this branch the user sees a misleading
  // "compilation failed" with empty logs.
  if (body.error && !stdout && !stderr) {
    return {
      logs,
      error: `Rust Playground: ${body.error}`,
      durationMs: performance.now() - start,
      testsExpected: isTest,
    };
  }

  const tests = isTest ? parseTestResults(stdout) : undefined;

  // A compile error means `success: false` with no tests run. We
  // also enter this branch when `success` itself is missing — a
  // malformed envelope shouldn't masquerade as a successful run.
  if (body.success !== true && (!tests || tests.length === 0)) {
    return {
      logs,
      error: extractCompileError(stderr) || "compilation failed",
      durationMs: performance.now() - start,
      testsExpected: isTest,
    };
  }

  return {
    logs,
    tests,
    durationMs: performance.now() - start,
    testsExpected: isTest,
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
///
/// `stdout` is `string | undefined | null` defensively — the Playground
/// sometimes returns an envelope without it, and a `.split` call on
/// undefined was the original "parseTestResults crashed" symptom.
function parseTestResults(stdout: string | undefined | null): TestResult[] {
  if (!stdout) return [];
  const lines = stdout.split("\n");
  const results: TestResult[] = [];
  const failureMsgs = new Map<string, string>();

  // Pass 1: test summary lines. The optional ` - should panic`
  // suffix appears between the test name and `... STATUS` for
  // tests annotated `#[should_panic]`. Without it the regex would
  // skip those tests entirely → empty `results` → the lesson
  // looked failed-with-no-tests even though every test passed.
  for (const line of lines) {
    const m = /^test\s+([\w:]+)(?:\s+-\s+should\s+panic)?\s+\.\.\.\s+(ok|FAILED|ignored)\b/.exec(line);
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

function isCompileSuccess(stderr: string | undefined | null): boolean {
  if (!stderr) return false;
  return /Finished\b/.test(stderr);
}

function filterCompilerNoise(stderr: string | undefined | null): string {
  if (!stderr) return "";
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

function extractCompileError(stderr: string | undefined | null): string | undefined {
  if (!stderr) return undefined;
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
