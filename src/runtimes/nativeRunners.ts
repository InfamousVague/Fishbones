import { invoke } from "@tauri-apps/api/core";
import type { LogLine, RunResult, TestResult } from "./types";

/// Shared wrapper for the 6 shell-out runners in the Rust backend
/// (C / C++ / Java / Kotlin / C# / Assembly). Each one returns the
/// same `SubprocessResult` shape as `run_swift`, so the conversion to
/// `RunResult` is identical — swift, these six, and any future
/// native-toolchain language can all route through the same code path
/// instead of copy-pasting 40 lines per language.

interface RawResult {
  stdout: string;
  stderr: string;
  success: boolean;
  duration_ms: number;
  launch_error: string | null;
}

/// Dispatch to a Rust subprocess runner and normalise its result.
///
/// `toolchainLabel` identifies the shell-out binary in user-facing
/// error messages ("cc exited with a non-zero status") so the learner
/// knows which toolchain is complaining. `language` is the canonical
/// `LanguageId` string (`"java"`, `"kotlin"`, etc.) — we tag the
/// RunResult with it when the Rust side reports a `launch_error`, so
/// OutputPane can render the missing-toolchain banner with the right
/// install recipe instead of a wall of red stderr.
async function runNative(
  command: string,
  code: string,
  toolchainLabel: string,
  language: string,
  testCode?: string,
): Promise<RunResult> {
  // Concatenate solution + tests when tests are present — challenge
  // packs for C/C++/Java/Kotlin/C# ship a separate `tests` field that
  // defines a main() emitting `KATA_TEST::name::PASS|FAIL` lines we
  // parse below. The Rust backend doesn't know about that split; it
  // just compiles whatever source blob we hand it.
  const merged = testCode ? `${code}\n${testCode}\n` : code;
  const raw = await invoke<RawResult>(command, { code: merged });

  if (raw.launch_error) {
    // Toolchain couldn't start (not on PATH, permission issue, or the
    // macOS stub `java` that sends people to java.com). Surface the
    // hint from the Rust side directly AND flag the language so
    // OutputPane can render the MissingToolchainBanner inline —
    // otherwise the learner sees "Unable to locate a Java Runtime"
    // and has no install button to click.
    return {
      logs: [],
      error: raw.launch_error,
      durationMs: raw.duration_ms,
      testsExpected: testCode !== undefined,
      missingToolchainLanguage: language,
    };
  }

  // `isLessonRun` distinguishes exercise lessons (which always pass a
  // `testCode` — even if empty string for run-only convention) from
  // pure playground runs (where testCode is undefined). Only lesson
  // runs get a synthetic "passed" result on success, so the playground
  // doesn't accidentally render pass pills for code that has no tests.
  const isLessonRun = testCode !== undefined;

  let tests: TestResult[] | undefined = undefined;
  if (isLessonRun) {
    // Parse KATA_TEST::name::PASS / FAIL lines from BOTH streams.
    // Most languages emit on stdout (puts/println/printf), but Zig's
    // synthesized harness uses `std.debug.print` which writes to
    // stderr because Zig 0.16 removed `std.io.getStdOut()` and the
    // newer `std.fs.File.stdout()` writer pattern is verbose enough
    // that going through `std.debug.print` is materially simpler.
    // Scanning both streams is harmless for the other languages —
    // their stderr never carries KATA_TEST lines, so the parser
    // returns an empty list from that side and we get the same
    // behaviour as before.
    tests = parseKataTests(raw.stdout);
    if (tests.length === 0) {
      tests = parseKataTests(raw.stderr);
    }
    if (tests.length === 0) {
      // Run-only convention: lesson with empty tests passes iff the
      // program exited cleanly. Synthesize a single result so (a) the
      // OutputPane renders a visible "passed" pill instead of a blank
      // body, and (b) `isPassing()` correctly flips this to complete.
      tests = raw.success
        ? [{ name: "program exited cleanly", passed: true }]
        : [
            {
              name: "program exited cleanly",
              passed: false,
              error:
                raw.stderr.trim().slice(0, 500) ||
                "non-zero exit — see logs",
            },
          ];
    }
  }

  // Strip KATA_TEST lines from BOTH visible streams so the user sees
  // only their own prints, not the test protocol. (Zig pumps the
  // protocol on stderr — see the comment above — so we have to filter
  // there too or the learner sees the whole KATA_TEST::name::PASS
  // ledger in their warnings panel.)
  const stripKata = (s: string) =>
    s.split("\n").filter((l) => !/^KATA_TEST::/.test(l)).join("\n").replace(/\n+$/, "");
  const displayStdout = isLessonRun
    ? stripKata(raw.stdout)
    : raw.stdout.replace(/\n+$/, "");
  const displayStderr = isLessonRun ? stripKata(raw.stderr) : raw.stderr;

  const logs: LogLine[] = [];
  if (displayStdout) logs.push({ level: "log", text: displayStdout });
  if (displayStderr && !raw.success) {
    // Non-zero exit usually means a compile-time or runtime error on
    // stderr — fold it into the log stream as an "error" so it renders
    // in the red tint in OutputPane.
    logs.push({ level: "error", text: displayStderr.trimEnd() });
  } else if (displayStderr) {
    // Warnings or informational notes — compiler may emit these on a
    // successful build (e.g. `-Wall` diagnostics on clean C). Render
    // as warn so they're visible but don't scream failure.
    logs.push({ level: "warn", text: displayStderr.trimEnd() });
  }

  // When we have any captured output (stderr, stdout) the user gets the
  // real diagnostic in the logs. A generic "<tool> exited with a non-zero
  // status" summary line on TOP of that is just noise — prefer silence
  // and let the actual compiler message speak for itself. Only show the
  // summary when the logs AND tests are both empty (rare but possible:
  // the toolchain crashed with no output).
  const haveUsefulLogs = logs.length > 0;
  const haveTests = tests && tests.length > 0;
  return {
    logs,
    tests,
    error: raw.success
      ? undefined
      : haveUsefulLogs || haveTests
        ? undefined
        : `${toolchainLabel} exited with a non-zero status (no output captured)`,
    durationMs: raw.duration_ms,
    testsExpected: isLessonRun,
  };
}

/// Same KATA_TEST stdout protocol that `go.ts` and the test-suite
/// runners parse. One line per test: `KATA_TEST::<name>::PASS` or
/// `KATA_TEST::<name>::FAIL::<one-line reason>`.
function parseKataTests(stdout: string): TestResult[] {
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

export function runC(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_c", code, "cc", "c", testCode);
}

export function runCpp(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_cpp", code, "c++", "cpp", testCode);
}

export function runJava(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_java", code, "javac/java", "java", testCode);
}

export function runKotlin(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_kotlin", code, "kotlinc", "kotlin", testCode);
}

export function runCSharp(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_csharp", code, "dotnet script", "csharp", testCode);
}

export function runAssembly(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_asm", code, "as/ld", "assembly", testCode);
}

// ── 2026 expansion: simple-CLI runners ────────────────────────────
// Single-binary languages — `ruby <file>`, `elixir <file>`, etc. The
// Rust side (native_runners.rs::simple_run_one_file) just writes a
// temp file and execs the binary; SubprocessResult shape is identical
// to the C/Java/etc. runners above so the same `runNative` wrapper
// handles output capture, KATA_TEST parsing, and missing-toolchain
// banner routing for free.
//
// Web build: `runtimes/index.ts`'s isWeb gate short-circuits these
// to the desktop-upsell banner before the IPC even fires, so the
// frontend never has to handle Tauri-not-available errors here.

export function runRuby(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_ruby", code, "ruby", "ruby", testCode);
}

export function runElixir(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_elixir", code, "elixir", "elixir", testCode);
}

export function runHaskell(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_haskell", code, "runghc", "haskell", testCode);
}

export function runScala(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_scala", code, "scala-cli", "scala", testCode);
}

export function runDart(code: string, testCode?: string): Promise<RunResult> {
  return runNative("run_dart", code, "dart", "dart", testCode);
}

/// Zig is the only language whose runtime takes a different shape from
/// the generic KATA_TEST stdout protocol every other native runner
/// uses. The Rust side dispatches to `zig test` (not `zig run`); zig's
/// own test runner emits one line per `test "name" {}` block on
/// stderr in a stable format we parse below.
///
/// Why diverge? See `native_runners.rs::run_zig` — TL;DR: idiomatic
/// Zig tests, free leak detection via `std.testing.allocator`, and no
/// bespoke harness to keep current with each Zig release.
///
/// The `runNative` plumbing is bypassed because:
///   - We don't want the KATA_TEST::name parsing (zig test uses its
///     own format).
///   - We don't want the "synthesize a 'program exited cleanly' pass
///     when no tests parse" fallback — a `zig test` file with no
///     `test {}` blocks is a misconfigured lesson, not a smoke test.
///   - The "merged via runNative" stdout/stderr bookkeeping doesn't
///     match what zig test produces (separate test-result lines plus
///     leak reports plus the standard "N passed; M failed" footer).
export async function runZig(code: string, testCode?: string): Promise<RunResult> {
  const start = performance.now();
  // Dedupe std import — the user's solution and our test header both
  // declare `const std = @import("std");`. Zig's "no duplicate top-
  // level names" rule means the merged file errors with `duplicate
  // struct member name 'std'` unless we strip one of them. The user's
  // import is the source of truth (we don't know if they need extras
  // bound from std), so we strip from the test side.
  const dedupedTests = dedupeZigStdImport(code, testCode);
  const merged = dedupedTests ? `${code}\n${dedupedTests}\n` : code;
  const raw = await invoke<{
    stdout: string;
    stderr: string;
    success: boolean;
    duration_ms: number;
    launch_error: string | null;
  }>("run_zig", { code: merged });

  if (raw.launch_error) {
    return {
      logs: [],
      error: raw.launch_error,
      durationMs: raw.duration_ms,
      testsExpected: testCode !== undefined,
      missingToolchainLanguage: "zig",
    };
  }

  const isLessonRun = testCode !== undefined;
  const tests = isLessonRun ? parseZigTestOutput(raw.stderr) : undefined;

  // Build the visible log stream. Strip the per-test result lines and
  // the "N passed; M skipped; K failed." footer — the test pills
  // already convey that information. Keep stderr noise that points at
  // compile errors / panic stacks / leak reports so the learner can
  // see what went wrong.
  const visibleStderr = isLessonRun
    ? stripZigTestProtocol(raw.stderr)
    : raw.stderr.replace(/\n+$/, "");
  const visibleStdout = raw.stdout.replace(/\n+$/, "");

  const logs: LogLine[] = [];
  if (visibleStdout) logs.push({ level: "log", text: visibleStdout });
  if (visibleStderr && !raw.success) {
    logs.push({ level: "error", text: visibleStderr.trimEnd() });
  } else if (visibleStderr) {
    logs.push({ level: "warn", text: visibleStderr.trimEnd() });
  }

  return {
    logs,
    tests,
    durationMs: performance.now() - start,
    testsExpected: isLessonRun,
  };
}

/// Drop a leading `const std = @import("std");` from `testCode` when
/// the user's `code` already declares it. Zig forbids two top-level
/// declarations with the same name within a file; this is the only
/// duplicate we can mechanically resolve since `std` is the canonical
/// well-known name.
function dedupeZigStdImport(code: string, testCode?: string): string | undefined {
  if (testCode == null) return testCode;
  const importRe = /^[ \t]*const\s+std\s*=\s*@import\(\s*"std"\s*\)\s*;[ \t]*\r?\n?/m;
  if (!importRe.test(code)) return testCode;
  return testCode.replace(importRe, "");
}

/// Parse the per-test lines `zig test` writes to stderr. Each test
/// emits exactly one line in the format:
///
///   1/3 mySlug.test.add basic...OK
///   2/3 mySlug.test.add negatives...FAIL (TestUnexpectedResult)
///
/// The slug is the temp filename (random; we ignore it). The test
/// name is everything between `.test.` and `...`. The status is
/// `OK`, `FAIL`, or `SKIP`; FAIL may include a parenthesised reason.
///
/// Leak reports (from `std.testing.allocator`) come on separate
/// lines after the `OK` summary — we surface them by retroactively
/// flipping affected tests to FAIL (the `0x... in test.<name>` line
/// in the leak trace tells us which test owns the leak).
function parseZigTestOutput(stderr: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = stderr.split("\n");
  // Header line shape: `<idx>/<total> <slug>.test.<name>...<trailing>`
  // The trailing portion MAY be the status (`OK` / `FAIL [(reason)]`)
  // OR may be empty / contain stdout the test body printed inline. In
  // the latter case the actual status lands on a later line with no
  // header — so we track an "active" test until we see its terminator.
  const headerRe = /\d+\/\d+\s+\S+\.test\.(.+?)\.\.\.(.*)$/;
  const statusRe = /^(OK|FAIL|SKIP)(?:\s+\((.+?)\))?\s*$/;
  let active: { name: string } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const header = headerRe.exec(line);
    if (header) {
      // Flush any unresolved previous header as a failure — this only
      // hits malformed output, but failing closed beats silent drop.
      if (active) results.push({ name: active.name, passed: false, error: "no status line" });
      const [, name, trailing] = header;
      const inline = statusRe.exec(trailing.trim());
      if (inline) {
        const [, status, reason] = inline;
        if (status === "OK") results.push({ name, passed: true });
        else if (status === "FAIL") results.push({ name, passed: false, error: reason || "test failed" });
        active = null;
      } else {
        active = { name };
      }
      continue;
    }
    if (!active) continue;
    const standalone = statusRe.exec(line.trim());
    if (!standalone) continue;
    const [, status, reason] = standalone;
    if (status === "OK") results.push({ name: active.name, passed: true });
    else if (status === "FAIL") results.push({ name: active.name, passed: false, error: reason || "test failed" });
    active = null;
  }
  if (active) results.push({ name: active.name, passed: false, error: "no status line" });
  // Walk leak trace lines and demote any matching test from PASS to
  // FAIL. Format: `0xADDR in test.<name> (test)`.
  const leakOwnerRe = /0x[0-9a-fA-F]+ in test\.(.+?) \(test\)/;
  let sawLeakHeader = false;
  for (const line of lines) {
    if (/\[DebugAllocator\] \(err\): memory address .* leaked/.test(line)) {
      sawLeakHeader = true;
      continue;
    }
    if (!sawLeakHeader) continue;
    const m = leakOwnerRe.exec(line);
    if (!m) continue;
    const owner = m[1];
    const idx = results.findIndex((r) => r.name === owner && r.passed);
    if (idx >= 0) {
      results[idx] = { name: owner, passed: false, error: "leaked memory" };
    }
    sawLeakHeader = false;
  }
  return results;
}

/// Drop the per-test result lines, the leak-report block, and the
/// final `N passed; M skipped; K failed.` summary from stderr so the
/// log pane only shows real diagnostic output. Leaves compile errors,
/// panic stacks, and `error:` lines intact since those are the
/// signal the learner needs.
function stripZigTestProtocol(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => {
      if (/^\s*\d+\/\d+\s+\S+\.test\..+\.\.\.(OK|FAIL|SKIP)/.test(line)) return false;
      if (/^\d+ passed; \d+ skipped; \d+ failed\.$/.test(line)) return false;
      if (/^All \d+ tests passed\.$/.test(line)) return false;
      if (/^error: the following test command failed/.test(line)) return false;
      if (/^\/.*?\.cache\/zig\/o\/[a-f0-9]+\/test/.test(line)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n+$/, "");
}
