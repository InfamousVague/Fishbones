/// Local toolchain execution for Rust + Go test runs.
///
/// The app's `rust.ts` and `go.ts` runtimes talk to the public
/// playgrounds (`play.rust-lang.org`, `play.golang.org`) because
/// compiling those languages in-browser isn't viable. That's fine in
/// production — but for the Playwright sweep (1 500+ challenges each
/// in Rust/Go) we'd either burn hours on network round-trips or
/// saturate rate limits.
///
/// `install-local-routes.ts` uses `page.route()` to intercept the
/// playground URLs and forward to the helpers here, which shell out
/// to the user's locally-installed `rustc` and `go`. Responses come
/// back in exactly the same shape the remote playgrounds produce, so
/// `rust.ts` / `go.ts` parsing code is unchanged.
///
/// Toolchain detection lives here too (`rustcInstalled`, `goInstalled`)
/// so the route installer can skip the intercept — and fall back to
/// real playground fetches — when the local binary is missing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/// Prepend well-known Homebrew + openjdk/kotlin prefixes to PATH so
/// toolchain probes and runners see them without requiring the user
/// to hand-edit their shell rc. Apple ships `/usr/bin/javac` as a
/// stub that errors until a real JDK exists; if the user brew-
/// installed openjdk (the setup script's happy path), the real
/// javac lives at /opt/homebrew/opt/openjdk/bin/javac and takes
/// precedence once we prepend that dir. Idempotent — we skip paths
/// that are already on PATH or don't exist on disk.
(function augmentPathOnce() {
  const extras = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/opt/homebrew/opt/openjdk/bin",
    "/usr/local/opt/openjdk/bin",
    "/opt/homebrew/opt/kotlin/bin",
    "/usr/local/opt/kotlin/bin",
    `${process.env.HOME ?? ""}/.cargo/bin`,
    `${process.env.HOME ?? ""}/.dotnet/tools`,
  ];
  const current = (process.env.PATH ?? "").split(":");
  const toPrepend = extras.filter(
    (p) => p && existsSync(p) && !current.includes(p),
  );
  if (toPrepend.length > 0) {
    process.env.PATH = [...toPrepend, ...current].join(":");
  }
})();

// ---------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------

/// Payload matches the body `rust.ts` POSTs to play.rust-lang.org.
/// We only care about `code` + `tests` + `edition`; the rest of the
/// fields the real playground uses (`channel`, `mode`, `crateType`,
/// `backtrace`) have no direct rustc equivalent and would just be
/// cosmetic tweaks if we tried to honour them.
export interface RustPlaygroundRequest {
  code: string;
  tests?: boolean;
  edition?: string;
}

/// Matches `PlaygroundResponse` in `src/runtimes/rust.ts`. `success`
/// is true iff compile succeeded AND the run exited 0 (test binary
/// exits non-zero when any test fails).
export interface RustPlaygroundResponse {
  success: boolean;
  stdout: string;
  stderr: string;
}

export function runRustLocally(payload: RustPlaygroundRequest): RustPlaygroundResponse {
  const dir = mkdtempSync(join(tmpdir(), "fishbones-rust-"));
  try {
    const src = join(dir, "main.rs");
    const bin = join(dir, "bin");
    writeFileSync(src, payload.code);

    const edition = payload.edition || "2021";
    // `--test` builds libtest's harness into the binary. When `tests`
    // is false we produce a normal bin — rustc needs a `main()` for
    // that path; `joinCodeAndTests` in rust.ts already guarantees one.
    const compileArgs = payload.tests
      ? ["--test", "--edition", edition, src, "-o", bin]
      : ["--edition", edition, src, "-o", bin];

    const compile = spawnSync("rustc", compileArgs, {
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (compile.status !== 0) {
      // Compile error. Match the playground's shape — stderr holds
      // the real rustc output, stdout stays empty.
      return {
        success: false,
        stdout: compile.stdout || "",
        stderr: compile.stderr || compile.error?.message || "rustc failed",
      };
    }

    // Single-threaded test execution matches the playground's default
    // and keeps parseTestResults' line-by-line parsing deterministic.
    const runArgs = payload.tests ? ["--test-threads=1"] : [];
    const run = spawnSync(bin, runArgs, {
      encoding: "utf-8",
      timeout: 15_000,
    });

    return {
      // Non-zero run status = some test failed. `rust.ts` handles that
      // case specifically: it still parses `tests` from stdout and
      // only flags a blanket error when no tests were parsed (i.e.
      // genuine crash). So we faithfully report success=false for
      // failed test runs; the parser does the rest.
      success: run.status === 0,
      stdout: run.stdout || "",
      stderr: run.stderr || "",
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function rustcInstalled(): boolean {
  try {
    const r = spawnSync("rustc", ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------

/// Go's playground request is form-encoded with a single `body` field
/// containing the full Go source (user code + test code merged by
/// `joinCodeAndTests` in go.ts).
export interface GoPlaygroundRequest {
  body: string;
}

/// Matches `PlaygroundResponse` in `src/runtimes/go.ts`. The playground
/// normally separates compile from run: compile errors land in
/// `Errors`, runtime output becomes `Events`. We reproduce that split
/// by sniffing stderr for Go's file-location diagnostic prefix
/// (`./main.go:LINE:COL:`).
export interface GoPlaygroundResponse {
  Errors: string;
  Events: Array<{ Message: string; Kind: "stdout" | "stderr"; Delay: number }>;
  Status: number;
}

export function runGoLocally(payload: GoPlaygroundRequest): GoPlaygroundResponse {
  const dir = mkdtempSync(join(tmpdir(), "fishbones-go-"));
  try {
    const src = join(dir, "main.go");
    writeFileSync(src, payload.body);

    const result = spawnSync("go", ["run", src], {
      encoding: "utf-8",
      timeout: 30_000,
      // Disable Go module downloads over the network — local shell
      // runs can fall prey to `go run` trying to fetch deps. The
      // challenge packs are stdlib-only so GOFLAGS=-mod=mod keeps us
      // offline. GOCACHE uses the user's default; we don't isolate
      // it because warm cache is faster for the sweep.
      env: {
        ...process.env,
        GOFLAGS: "-mod=mod",
      },
    });

    const stderr = result.stderr || "";
    // Compile errors match the pattern `./path:LINE:COL:` anywhere
    // in stderr. Runtime panics DON'T match — they start with
    // "panic:" at column 0. That's the right boundary to reproduce
    // the playground's split between Errors (compile) and Events
    // (runtime).
    const looksLikeCompileError =
      /^\.\/[\w./-]+:\d+:\d+:/m.test(stderr) ||
      /^[\w./-]+:\d+:\d+:\s+(syntax error|error:|undefined:)/m.test(stderr);

    if (result.status !== 0 && looksLikeCompileError) {
      return {
        Errors: stderr,
        Events: [],
        Status: 2,
      };
    }

    const events: GoPlaygroundResponse["Events"] = [];
    if (result.stdout)
      events.push({ Message: result.stdout, Kind: "stdout", Delay: 0 });
    if (stderr) events.push({ Message: stderr, Kind: "stderr", Delay: 0 });

    return {
      Errors: "",
      Events: events,
      Status: result.status ?? 0,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function goInstalled(): boolean {
  try {
    const r = spawnSync("go", ["version"], {
      encoding: "utf-8",
      timeout: 5_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Native-toolchain languages (C, C++, Java, Kotlin, C#, Asm, Swift)
//
// In production these ship through Tauri `run_<lang>` commands that
// shell out (see src-tauri/src/native_runners.rs). In the Playwright
// suite we replicate each command here and expose them over
// `page.exposeFunction` — the Tauri-mock then forwards `invoke("run_c",
// ...)` to the real compiler without needing the Tauri backend running.
//
// Every helper returns the same `SubprocessResult` shape the Rust
// side emits (stdout / stderr / success / duration_ms / launch_error)
// — serde's snake_case serialization lines up with TS's expected field
// names, so `nativeRunners.ts` reads the result unchanged.
// ---------------------------------------------------------------------

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  success: boolean;
  duration_ms: number;
  launch_error: string | null;
}

/// Build the "toolchain not installed" error shape. Mirrors
/// `native_runners::launch_failure` in Rust so the frontend's hint
/// copy stays useful.
function launchFailure(
  toolchain: string,
  hint: string,
  err: NodeJS.ErrnoException,
  start: number,
): SubprocessResult {
  const msg =
    err.code === "ENOENT"
      ? `${toolchain} not found on PATH — ${hint}`
      : `failed to launch ${toolchain}: ${err.message}`;
  return {
    stdout: "",
    stderr: "",
    success: false,
    duration_ms: Date.now() - start,
    launch_error: msg,
  };
}

/// Spawn a subprocess, returning a result with the captured output.
/// `error` on the spawn-sync result maps to `launch_error`; non-zero
/// exits keep going with success=false so the caller's stderr-parsing
/// path still runs.
function runCmd(
  bin: string,
  args: string[],
  start: number,
  hintOnMissing: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): SubprocessResult {
  const r = spawnSync(bin, args, {
    encoding: "utf-8",
    timeout: opts.timeoutMs ?? 30_000,
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  if (r.error) {
    return launchFailure(bin, hintOnMissing, r.error as NodeJS.ErrnoException, start);
  }
  return {
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    success: r.status === 0,
    duration_ms: Date.now() - start,
    launch_error: null,
  };
}

/// Compile step + run step, short-circuiting on compile failure.
/// Exactly `compile_then_run` in Rust. On successful compile we run
/// the produced binary; on failure we return the compile output as
/// the final result.
function compileThenRun(
  compileBin: string,
  compileArgs: string[],
  runBin: string,
  runArgs: string[],
  start: number,
  hintOnMissing: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SubprocessResult {
  const compile = spawnSync(compileBin, compileArgs, {
    encoding: "utf-8",
    timeout: 60_000,
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  if (compile.error) {
    return launchFailure(
      compileBin,
      hintOnMissing,
      compile.error as NodeJS.ErrnoException,
      start,
    );
  }
  if (compile.status !== 0) {
    return {
      stdout: compile.stdout || "",
      stderr: compile.stderr || "",
      success: false,
      duration_ms: Date.now() - start,
      launch_error: null,
    };
  }
  return runCmd(runBin, runArgs, start, hintOnMissing, {
    cwd: opts.cwd,
    env: opts.env,
  });
}

// ---- C --------------------------------------------------------------

export function runCLocally(code: string): SubprocessResult {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "fishbones-c-"));
  try {
    const src = join(dir, "main.c");
    const bin = join(dir, "bin");
    writeFileSync(src, code);
    return compileThenRun(
      "cc",
      ["-O0", "-o", bin, src],
      bin,
      [],
      start,
      "install Xcode Command Line Tools (`xcode-select --install`) or a system C compiler.",
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---- C++ ------------------------------------------------------------

export function runCppLocally(code: string): SubprocessResult {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "fishbones-cpp-"));
  try {
    const src = join(dir, "main.cpp");
    const bin = join(dir, "bin");
    writeFileSync(src, code);
    return compileThenRun(
      "c++",
      ["-O0", "-std=c++17", "-o", bin, src],
      bin,
      [],
      start,
      "install Xcode Command Line Tools (`xcode-select --install`) or a system C++ compiler.",
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---- Java -----------------------------------------------------------

/// Mirror `extract_java_class_name` in native_runners.rs: find the
/// first `public class X` / `class X` and use that as the filename.
/// Falls back to `App` when nothing matches.
function extractJavaClassName(code: string): string {
  for (const token of ["public class ", "public final class ", "class "]) {
    const idx = code.indexOf(token);
    if (idx === -1) continue;
    const rest = code.slice(idx + token.length);
    const match = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (match) return match[0];
  }
  return "App";
}

export function runJavaLocally(code: string): SubprocessResult {
  const start = Date.now();
  const className = extractJavaClassName(code);
  const dir = mkdtempSync(join(tmpdir(), "fishbones-java-"));
  try {
    const src = join(dir, `${className}.java`);
    writeFileSync(src, code);
    return compileThenRun(
      "javac",
      [src],
      "java",
      ["-cp", dir, className],
      start,
      "install a JDK (`brew install openjdk` on macOS) and make sure `javac` + `java` are on PATH.",
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---- Kotlin ---------------------------------------------------------

export function runKotlinLocally(code: string): SubprocessResult {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "fishbones-kotlin-"));
  try {
    // App mode (matches `native_runners::run_kotlin` after the fix):
    // compile to a self-contained jar + `java -jar`. Script mode would
    // let top-level statements run but doesn't invoke `fun main()`,
    // which is exactly what the challenge packs' test harness relies on.
    const src = join(dir, "Main.kt");
    const jar = join(dir, "main.jar");
    writeFileSync(src, code);
    return compileThenRun(
      "kotlinc",
      ["-include-runtime", "-d", jar, src],
      "java",
      ["-jar", jar],
      start,
      "install Kotlin (`brew install kotlin` on macOS) and a JDK (`brew install openjdk`).",
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---- C# -------------------------------------------------------------

export function runCSharpLocally(code: string): SubprocessResult {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "fishbones-csharp-"));
  try {
    const src = join(dir, "main.csx");
    writeFileSync(src, code);
    // `dotnet script` is the community `dotnet-script` global tool. If
    // it isn't installed dotnet itself prints an instructive error
    // which we pass through as stderr — matches the production
    // behaviour in native_runners::run_csharp.
    return runCmd(
      "dotnet",
      ["script", src],
      start,
      "install the .NET SDK (`brew install --cask dotnet-sdk` on macOS), then `dotnet tool install -g dotnet-script`.",
      { timeoutMs: 60_000 },
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---- Assembly -------------------------------------------------------

/// Platform-aware linker flags — macOS needs `-lSystem` + `-syslibroot`
/// pointing at the Xcode SDK; Linux just needs the object file. We
/// mirror `run_asm` in native_runners.rs, calling `xcrun` on macOS to
/// resolve the SDK path at runtime.
export function runAsmLocally(code: string): SubprocessResult {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "fishbones-asm-"));
  try {
    const src = join(dir, "main.s");
    const obj = join(dir, "main.o");
    const bin = join(dir, "bin");
    writeFileSync(src, code);

    const asm = spawnSync("as", ["-o", obj, src], {
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (asm.error) {
      return launchFailure(
        "as",
        "install a system assembler (Xcode Command Line Tools on macOS, `binutils` on Linux).",
        asm.error as NodeJS.ErrnoException,
        start,
      );
    }
    if (asm.status !== 0) {
      const raw = asm.stderr || "";
      const body = raw.trim()
        ? raw
        : "assembler produced no output. If you're on an Intel Mac, the default template uses arm64 syscalls — rewrite it for x86_64 or switch hosts.";
      return {
        stdout: asm.stdout || "",
        stderr: `as (assemble) failed: ${asm.status ?? "?"}\n${body}`,
        success: false,
        duration_ms: Date.now() - start,
        launch_error: null,
      };
    }

    const linkArgs = ["-o", bin, obj];
    if (process.platform === "darwin") {
      linkArgs.push("-lSystem");
      const sdk = spawnSync("xcrun", ["-sdk", "macosx", "--show-sdk-path"], {
        encoding: "utf-8",
        timeout: 5_000,
      });
      if (sdk.status === 0) {
        const sdkPath = (sdk.stdout || "").trim();
        if (sdkPath) {
          linkArgs.push("-syslibroot", sdkPath);
        }
      }
    }
    const link = spawnSync("ld", linkArgs, {
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (link.error) {
      return launchFailure(
        "ld",
        "install the linker (Xcode Command Line Tools on macOS, `binutils` on Linux).",
        link.error as NodeJS.ErrnoException,
        start,
      );
    }
    if (link.status !== 0) {
      const raw = link.stderr || "";
      const body = raw.trim()
        ? raw
        : "linker produced no output. Check that your entry symbol matches the platform (`_main` on macOS, `_start` on Linux).";
      return {
        stdout: link.stdout || "",
        stderr: `ld (link) failed: ${link.status ?? "?"}\n${body}`,
        success: false,
        duration_ms: Date.now() - start,
        launch_error: null,
      };
    }

    return runCmd(bin, [], start, "built but couldn't execute — check the binary's permissions.");
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---- Swift ----------------------------------------------------------

export function runSwiftLocally(code: string): SubprocessResult {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "fishbones-swift-"));
  try {
    const src = join(dir, "main.swift");
    writeFileSync(src, code);
    return runCmd(
      "swift",
      [src],
      start,
      "install Xcode Command Line Tools (`xcode-select --install`).",
      { timeoutMs: 60_000 },
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------
// Toolchain probes
// ---------------------------------------------------------------------

function probe(bin: string, args: string[], timeoutMs = 5_000): boolean {
  try {
    const r = spawnSync(bin, args, { encoding: "utf-8", timeout: timeoutMs });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function ccInstalled(): boolean {
  return probe("cc", ["--version"]);
}
export function cppInstalled(): boolean {
  return probe("c++", ["--version"]);
}
export function javacInstalled(): boolean {
  return probe("javac", ["-version"]) && probe("java", ["-version"]);
}
export function kotlincInstalled(): boolean {
  // kotlinc starts a JVM for `-version`, which regularly takes 6-7s on
  // macOS — well past the default 5s probe timeout. A miss here flips
  // the whole Kotlin pack to "skipped" at spec-load time, so bump the
  // window enough that a cold JVM still reports cleanly.
  return probe("kotlinc", ["-version"], 15_000);
}
export function dotnetInstalled(): boolean {
  return probe("dotnet", ["--version"]);
}
export function asmInstalled(): boolean {
  // `as --version` is fine on both GNU (binutils) and Apple cctools.
  // `ld --version` works on GNU ld but Apple's ld rejects it with
  // "unknown options: --version" and exits non-zero. Apple ld accepts
  // `-v` (which prints a banner like `@(#)PROGRAM:ld PROJECT:ld-1266.8`
  // and exits 0). Try `-v` first since we ship on macOS; fall back
  // to `--version` for Linux hosts.
  if (!probe("as", ["--version"])) return false;
  return probe("ld", ["-v"]) || probe("ld", ["--version"]);
}
export function swiftInstalled(): boolean {
  return probe("swift", ["--version"]);
}
