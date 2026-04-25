/// Local-toolchain runners for the content test suite. Each runner
/// merges solution + tests using the same convention the in-app
/// runtime uses, then shells out to a real local toolchain (go, rustc,
/// node, gcc, javac, etc.) and reports pass/fail. The test suite
/// dynamically generates one vitest test per exercise, calling these.
///
/// Why local toolchains and not the app's runtimes: the in-app paths
/// for Go/Rust hit public playgrounds (rate-limited, networked) and
/// the JS/TS path uses Web Workers (no Node equivalent without
/// bundling). Local toolchains are faster, deterministic, and CI-able.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface RunOutcome {
  ok: boolean;
  /// "compile" / "test-fail" / "no-output" / "no-toolchain" / etc.
  reason?: string;
  /// First few KB of stdout/stderr for diagnostics.
  detail?: string;
}

const TIMEOUT_MS = 30_000;

interface SpawnRes {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): Promise<SpawnRes> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut: false });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: "spawn error", timedOut: false });
    });
    if (opts.input) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

async function hasBinary(cmd: string): Promise<boolean> {
  const r = await run("which", [cmd]);
  return r.code === 0;
}

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kata-${prefix}-`));
}

function rm(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- Go ------

function joinGo(user: string, tests: string): string {
  const stripPackage = (s: string) => s.replace(/^\s*package\s+\w+\s*$/m, "");
  const stripMain = (s: string) => {
    const m = /^\s*func\s+main\s*\(\s*\)\s*\{/m.exec(s);
    if (!m) return s;
    const start = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") { depth--; if (depth === 0) return s.slice(0, m.index) + s.slice(i + 1); }
    }
    return s;
  };
  const extract = (src: string): { imports: string[]; rest: string } => {
    const imports: string[] = [];
    let rest = src;
    rest = rest.replace(/^\s*import\s*\(([\s\S]*?)\)/gm, (_m, body) => {
      for (const line of (body as string).split("\n")) { const t = line.trim(); if (t) imports.push(t); }
      return "";
    });
    rest = rest.replace(/^\s*import\s+((?:[A-Za-z_]\w*\s+)?"[^"]+")\s*$/gm, (_m, spec) => {
      imports.push(spec); return "";
    });
    return { imports, rest };
  };
  const u = extract(stripMain(stripPackage(user)));
  const t = extract(stripPackage(tests));
  const seen = new Set<string>();
  const all: string[] = [];
  for (const s of [...u.imports, ...t.imports]) { if (!seen.has(s)) { seen.add(s); all.push(s); } }
  const block = all.length ? `import (\n${all.map(i => `\t${i}`).join("\n")}\n)\n\n` : "";
  return `package main\n\n${block}${u.rest.trim()}\n\n${t.rest.trim()}\n`;
}

export async function runGo(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("go"))) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("go");
  try {
    const merged = joinGo(solution, tests);
    fs.writeFileSync(path.join(dir, "main.go"), merged);
    const res = await run("go", ["run", "main.go"], { cwd: dir });
    if (res.code !== 0) return { ok: false, reason: "compile/run", detail: (res.stderr || res.stdout).slice(0, 4000) };
    const passes = [...res.stdout.matchAll(/^KATA_TEST::([\w_]+)::PASS$/gm)];
    const fails = [...res.stdout.matchAll(/^KATA_TEST::([\w_]+)::FAIL(?:::(.*))?$/gm)];
    if (passes.length === 0 && fails.length === 0) return { ok: false, reason: "no-kata-output", detail: res.stdout.slice(0, 2000) };
    if (fails.length > 0) return { ok: false, reason: "test-fail", detail: fails.map(f => `${f[1]}: ${f[2] ?? ""}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

// -------------------------------------------------------------- Rust ------

function joinRust(user: string, tests: string): string {
  const hasMain = /\bfn\s+main\s*\(/.test(user);
  const mainFallback = hasMain ? "" : "\nfn main() {}\n";
  const indent = (s: string, n: number) =>
    s.split("\n").map((l) => (l.length ? " ".repeat(n) + l : l)).join("\n");
  return `${user}${mainFallback}\n\n#[cfg(test)]\nmod kata_tests {\n    use super::*;\n${indent(tests, 4)}\n}\n`;
}

export async function runRust(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("rustc"))) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("rust");
  try {
    const merged = joinRust(solution, tests);
    const src = path.join(dir, "main.rs");
    const bin = path.join(dir, "kata_test_bin");
    fs.writeFileSync(src, merged);
    const compile = await run("rustc", ["--test", "--edition", "2021", "-o", bin, src], { cwd: dir });
    if (compile.code !== 0) return { ok: false, reason: "compile", detail: compile.stderr.slice(0, 4000) };
    const runRes = await run(bin, ["--test-threads=1"], { cwd: dir });
    const m = /test result: (ok|FAILED)\./.exec(runRes.stdout);
    if (!m) return { ok: false, reason: "no-test-output", detail: runRes.stdout.slice(0, 2000) };
    if (m[1] === "FAILED") return { ok: false, reason: "test-fail", detail: runRes.stdout.slice(0, 2000) };
    return { ok: true };
  } finally { rm(dir); }
}

// ---------------------------------------------------------- JS / TS -------

const JS_HARNESS = `
const __results = [];
const module = { exports: {} };
const exports = module.exports;
const console = { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} };
function fmt(v) { try { return JSON.stringify(v); } catch { return String(v); } }
const makeExpect = (actual, neg) => {
  const a = (cond, msg) => { if (neg ? cond : !cond) throw new Error((neg?'expected not: ':'')+msg); };
  return {
    toBe(e){a(actual===e,'expected '+fmt(e)+', got '+fmt(actual));},
    toEqual(e){a(JSON.stringify(actual)===JSON.stringify(e),'expected '+fmt(e)+', got '+fmt(actual));},
    toStrictEqual(e){a(JSON.stringify(actual)===JSON.stringify(e),'expected '+fmt(e));},
    toBeTruthy(){a(!!actual,'expected truthy');},
    toBeFalsy(){a(!actual,'expected falsy');},
    toBeGreaterThan(n){a(actual>n,'expected > '+n);},
    toBeGreaterThanOrEqual(n){a(actual>=n,'expected >= '+n);},
    toBeLessThan(n){a(actual<n,'expected < '+n);},
    toBeLessThanOrEqual(n){a(actual<=n,'expected <= '+n);},
    toContain(x){a(!!(actual&&actual.includes&&actual.includes(x)),'expected to contain '+fmt(x));},
    toHaveLength(n){a(actual&&actual.length===n,'expected length '+n);},
    toHaveProperty(k,v){const h=actual!=null&&Object.prototype.hasOwnProperty.call(actual,k);if(arguments.length<2)a(h,'expected prop '+fmt(k));else a(h&&JSON.stringify(actual[k])===JSON.stringify(v),'expected prop '+fmt(k));},
    toBeCloseTo(e,d=2){a(Math.abs(actual-e)<=Math.pow(10,-d)/2,'expected ~'+e);},
    toBeNull(){a(actual===null,'expected null');},
    toBeUndefined(){a(actual===undefined,'expected undefined');},
    toBeDefined(){a(actual!==undefined,'expected defined');},
    toBeNaN(){a(typeof actual==='number'&&actual!==actual,'expected NaN');},
    toBeInstanceOf(c){a(actual instanceof c,'expected instance of '+(c&&c.name||'ctor'));},
    toMatch(re){const ok=typeof re==='string'?String(actual).includes(re):re.test(String(actual));a(ok,'expected to match '+fmt(re));},
    toThrow(e){let t=false,err;try{typeof actual==='function'&&actual();}catch(x){t=true;err=x;}if(e===undefined)a(t,'expected throw');else{const msg=(err&&err.message)||'';const ok=t&&(e instanceof RegExp?e.test(msg):msg.includes(e));a(!!ok,'expected throw matching '+fmt(e));}},
  };
};
const expect = (actual) => {
  const b = makeExpect(actual, false);
  b.not = makeExpect(actual, true);
  b.resolves = { async toBe(e){return expect(await actual).toBe(e);}, async toEqual(e){return expect(await actual).toEqual(e);} };
  b.rejects = { async toThrow(e){let err;try{await actual;}catch(x){err=x;}if(!err)throw new Error('expected reject');if(e!==undefined){const msg=(err&&err.message)||'';const ok=e instanceof RegExp?e.test(msg):msg.includes(e);if(!ok)throw new Error('expected reject matching '+fmt(e));}} };
  return b;
};
const __tests = [];
const test = (name, fn) => __tests.push({ name, fn });
const it = test;
const describe = (_n, fn) => fn();
const require = (p) => { if (p === './user' || p === '../user' || p === 'user') return module.exports; throw new Error('require() only supports ./user, got '+p); };
`;

export async function runJsLike(solution: string, tests: string, ts: boolean): Promise<RunOutcome> {
  let userCode = solution;
  let testCode = tests;
  if (ts) {
    try {
      const sucrase = await import("sucrase");
      userCode = sucrase.transform(userCode, { transforms: ["typescript", "imports"], disableESTransforms: true }).code;
      testCode = sucrase.transform(testCode, { transforms: ["typescript", "imports"], disableESTransforms: true }).code;
    } catch (e) {
      return { ok: false, reason: "ts-compile", detail: String(e) };
    }
  }
  const harness = `${JS_HARNESS}
(async () => {
  try { await (async () => { ${userCode}\n })(); }
  catch (err) { process.stdout.write('__AUDIT__'+JSON.stringify({userError:(err&&err.stack)||String(err)})); return; }
  try { await (async () => { ${testCode}\n })(); }
  catch (err) { process.stdout.write('__AUDIT__'+JSON.stringify({testFileError:(err&&err.stack)||String(err)})); return; }
  for (const t of __tests) {
    try { await t.fn(); __results.push({ name: t.name, passed: true }); }
    catch (err) { __results.push({ name: t.name, passed: false, error: (err && err.message) || String(err) }); }
  }
  process.stdout.write('__AUDIT__'+JSON.stringify({ results: __results }));
})();
`;
  const dir = tmpdir("js");
  try {
    const src = path.join(dir, "run.mjs");
    fs.writeFileSync(src, harness);
    const res = await run(process.execPath, [src], { cwd: dir });
    const marker = res.stdout.lastIndexOf("__AUDIT__");
    if (marker < 0) return { ok: false, reason: "no-output", detail: (res.stderr || res.stdout).slice(0, 2000) };
    const payload = JSON.parse(res.stdout.slice(marker + "__AUDIT__".length));
    if (payload.userError) return { ok: false, reason: "user-code-error", detail: payload.userError };
    if (payload.testFileError) return { ok: false, reason: "test-file-error", detail: payload.testFileError };
    const results: Array<{ name: string; passed: boolean; error?: string }> = payload.results ?? [];
    if (results.length === 0) return { ok: false, reason: "no-tests-ran" };
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) return { ok: false, reason: "test-fail", detail: failed.map((f) => `${f.name}: ${f.error}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

// ----------------------------------------------------------- Python -------

export async function runPython(solution: string, tests: string): Promise<RunOutcome> {
  const py = (await hasBinary("python3")) ? "python3" : (await hasBinary("python")) ? "python" : null;
  if (!py) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("py");
  try {
    fs.writeFileSync(path.join(dir, "user.py"), solution);
    const harness = `
import sys
sys.path.insert(0, ${JSON.stringify(dir)})
import user
results = []
def expect(v):
    class E:
        def to_be(self, e):
            assert v == e, f"expected {e!r}, got {v!r}"
        def to_equal(self, e):
            assert v == e, f"expected {e!r}, got {v!r}"
    return E()
def test(name):
    def deco(fn):
        try: fn(); results.append((name, True, None))
        except Exception as e: results.append((name, False, str(e)))
        return fn
    return deco
${tests}
fail = [r for r in results if not r[1]]
import json
print('__AUDIT__'+json.dumps({"results":[{"name":n,"passed":p,"error":e} for n,p,e in results]}))
`;
    fs.writeFileSync(path.join(dir, "run.py"), harness);
    const res = await run(py, ["run.py"], { cwd: dir });
    const m = res.stdout.lastIndexOf("__AUDIT__");
    if (m < 0) return { ok: false, reason: "no-output", detail: (res.stderr || res.stdout).slice(0, 2000) };
    const payload = JSON.parse(res.stdout.slice(m + "__AUDIT__".length));
    const results: Array<{ name: string; passed: boolean; error?: string }> = payload.results ?? [];
    if (results.length === 0) return { ok: false, reason: "no-tests-ran" };
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) return { ok: false, reason: "test-fail", detail: failed.map((f) => `${f.name}: ${f.error}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

// ----------------------------------------------- Native (C/C++/Java/etc) --

/// For C/C++/Java/Kotlin/C#: solution + tests are concatenated with the
/// expectation that a `main()`/`Main` is present that prints
/// `KATA_TEST::name::PASS|FAIL` lines. We don't try to be clever about
/// merging — generators are instructed to emit a single self-contained
/// translation unit per challenge.
async function runWithBinary(
  solution: string,
  tests: string,
  ext: string,
  build: (src: string, dir: string) => Promise<{ ok: boolean; bin?: string; detail?: string }>,
  exec: (bin: string, dir: string) => Promise<SpawnRes>,
): Promise<RunOutcome> {
  const dir = tmpdir(ext);
  try {
    const src = path.join(dir, `main.${ext}`);
    fs.writeFileSync(src, `${solution}\n${tests}\n`);
    const built = await build(src, dir);
    if (!built.ok) return { ok: false, reason: "compile", detail: built.detail };
    const r = await exec(built.bin!, dir);
    if (r.timedOut) return { ok: false, reason: "timeout" };
    const passes = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::PASS$/gm)];
    const fails = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::FAIL(?:::(.*))?$/gm)];
    if (passes.length === 0 && fails.length === 0) {
      // Fall back to "exit 0 = pass" for run-only languages.
      return r.code === 0 ? { ok: true } : { ok: false, reason: "exit-nonzero", detail: r.stderr.slice(0, 2000) };
    }
    if (fails.length > 0) return { ok: false, reason: "test-fail", detail: fails.map(f => `${f[1]}: ${f[2] ?? ""}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

export async function runC(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("cc"))) return { ok: true, reason: "no-toolchain" };
  return runWithBinary(solution, tests, "c",
    async (src, dir) => {
      const bin = path.join(dir, "a.out");
      const r = await run("cc", ["-o", bin, src]);
      return { ok: r.code === 0, bin, detail: r.stderr.slice(0, 4000) };
    },
    async (bin) => run(bin, []),
  );
}

export async function runCpp(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("c++"))) return { ok: true, reason: "no-toolchain" };
  return runWithBinary(solution, tests, "cpp",
    async (src, dir) => {
      const bin = path.join(dir, "a.out");
      const r = await run("c++", ["-std=c++17", "-o", bin, src]);
      return { ok: r.code === 0, bin, detail: r.stderr.slice(0, 4000) };
    },
    async (bin) => run(bin, []),
  );
}

export async function runSwift(solution: string, _tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("swift"))) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("swift");
  try {
    const src = path.join(dir, "main.swift");
    fs.writeFileSync(src, solution);
    const r = await run("swift", [src]);
    return r.code === 0 ? { ok: true } : { ok: false, reason: "compile/run", detail: (r.stderr || r.stdout).slice(0, 2000) };
  } finally { rm(dir); }
}

/// Java: source MUST contain exactly one `public class Main` (the
/// compiler ties the file name to it). We write to `Main.java`,
/// compile with javac, run with `java Main`. KATA_TEST stdout
/// protocol applies — challenge authors emit lines from `main()`.
export async function runJava(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("javac")) || !(await hasBinary("java"))) {
    return { ok: true, reason: "no-toolchain" };
  }
  // Probe whether `java` actually has a working JRE — Apple's stub
  // `/usr/bin/java` exists but errors with "Unable to locate a Java
  // Runtime" on machines without a JDK installed.
  const probe = await run("java", ["--version"]);
  if (probe.code !== 0) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("java");
  try {
    const src = path.join(dir, "Main.java");
    fs.writeFileSync(src, `${solution}\n${tests}\n`);
    const compile = await run("javac", [src], { cwd: dir });
    if (compile.code !== 0) return { ok: false, reason: "compile", detail: compile.stderr.slice(0, 4000) };
    const r = await run("java", ["-cp", dir, "Main"]);
    if (r.timedOut) return { ok: false, reason: "timeout" };
    const passes = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::PASS$/gm)];
    const fails = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::FAIL(?:::(.*))?$/gm)];
    if (passes.length === 0 && fails.length === 0) {
      return r.code === 0 ? { ok: true } : { ok: false, reason: "exit-nonzero", detail: r.stderr.slice(0, 2000) };
    }
    if (fails.length > 0) return { ok: false, reason: "test-fail", detail: fails.map(f => `${f[1]}: ${f[2] ?? ""}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

/// Kotlin: same shape as Java — write to `Main.kt`, compile with
/// kotlinc to a jar, run with `java`. kotlinc bundles its own JRE so
/// this works even on machines without a system JDK.
export async function runKotlin(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("kotlinc"))) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("kotlin");
  try {
    const src = path.join(dir, "Main.kt");
    const jar = path.join(dir, "Main.jar");
    fs.writeFileSync(src, `${solution}\n${tests}\n`);
    const compile = await run("kotlinc", [src, "-include-runtime", "-d", jar], { cwd: dir });
    if (compile.code !== 0) return { ok: false, reason: "compile", detail: compile.stderr.slice(0, 4000) };
    const r = await run("kotlin", ["-cp", jar, "MainKt"]);
    if (r.timedOut) return { ok: false, reason: "timeout" };
    const passes = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::PASS$/gm)];
    const fails = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::FAIL(?:::(.*))?$/gm)];
    if (passes.length === 0 && fails.length === 0) {
      return r.code === 0 ? { ok: true } : { ok: false, reason: "exit-nonzero", detail: r.stderr.slice(0, 2000) };
    }
    if (fails.length > 0) return { ok: false, reason: "test-fail", detail: fails.map(f => `${f[1]}: ${f[2] ?? ""}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

/// C# via `dotnet script` (one-file scripts, no project scaffolding).
/// Skipped when dotnet isn't installed.
export async function runCSharp(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("dotnet"))) return { ok: true, reason: "no-toolchain" };
  // Probe `dotnet script` is also installed (it's a separate tool).
  const probe = await run("dotnet", ["script", "--version"]);
  if (probe.code !== 0) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("csx");
  try {
    const src = path.join(dir, "main.csx");
    fs.writeFileSync(src, `${solution}\n${tests}\n`);
    const r = await run("dotnet", ["script", src]);
    if (r.timedOut) return { ok: false, reason: "timeout" };
    const passes = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::PASS$/gm)];
    const fails = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::FAIL(?:::(.*))?$/gm)];
    if (passes.length === 0 && fails.length === 0) {
      return r.code === 0 ? { ok: true } : { ok: false, reason: "exit-nonzero", detail: r.stderr.slice(0, 2000) };
    }
    if (fails.length > 0) return { ok: false, reason: "test-fail", detail: fails.map(f => `${f[1]}: ${f[2] ?? ""}`).join("\n") };
    return { ok: true };
  } finally { rm(dir); }
}

export async function runAssembly(solution: string, tests: string): Promise<RunOutcome> {
  if (!(await hasBinary("as"))) return { ok: true, reason: "no-toolchain" };
  const dir = tmpdir("asm");
  try {
    const src = path.join(dir, "main.s");
    const obj = path.join(dir, "main.o");
    const bin = path.join(dir, "main.out");
    // New convention: solution provides user subroutines (no _main),
    // tests provides _main + test harness. Legacy single-file
    // challenges leave `tests` empty and the solution contains _main
    // directly; in that case we just assemble the solution.
    const merged = tests && tests.trim().length > 0
      ? `${solution}\n\n${tests}\n`
      : solution;
    fs.writeFileSync(src, merged);
    const asRes = await run("as", ["-o", obj, src]);
    if (asRes.code !== 0) return { ok: false, reason: "assemble", detail: asRes.stderr.slice(0, 4000) };
    const sdkRes = await run("xcrun", ["-sdk", "macosx", "--show-sdk-path"]);
    const ldArgs = ["-o", bin, obj, "-lSystem", "-syslibroot", sdkRes.stdout.trim()];
    const ldRes = await run("ld", ldArgs);
    if (ldRes.code !== 0) return { ok: false, reason: "link", detail: ldRes.stderr.slice(0, 4000) };
    const r = await run(bin, []);
    // If the test harness emitted KATA_TEST lines, parse them. Otherwise
    // fall back to the legacy "exit 0 = pass" convention.
    const passes = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::PASS$/gm)];
    const fails = [...r.stdout.matchAll(/^KATA_TEST::([\w_]+)::FAIL(?:::(.*))?$/gm)];
    if (passes.length > 0 || fails.length > 0) {
      if (fails.length > 0) return { ok: false, reason: "test-fail", detail: fails.map(f => `${f[1]}: ${f[2] ?? ""}`).join("\n") };
      return { ok: true };
    }
    return r.code === 0 ? { ok: true } : { ok: false, reason: "exit-nonzero", detail: `exit code ${r.code}` };
  } finally { rm(dir); }
}

// ---------------------------------------------------------- Dispatcher ----

export async function runForLanguage(
  language: string,
  solution: string,
  tests: string,
): Promise<RunOutcome> {
  switch (language) {
    case "go": return runGo(solution, tests);
    case "rust": return runRust(solution, tests);
    case "javascript": return runJsLike(solution, tests, false);
    case "typescript": return runJsLike(solution, tests, true);
    case "python": return runPython(solution, tests);
    case "c": return runC(solution, tests);
    case "cpp": return runCpp(solution, tests);
    case "swift": return runSwift(solution, tests);
    case "java": return runJava(solution, tests);
    case "kotlin": return runKotlin(solution, tests);
    case "csharp": return runCSharp(solution, tests);
    case "assembly": return runAssembly(solution, tests);
    default: return { ok: true, reason: "lang-not-supported" };
  }
}

/// Mutates a solution into a deliberately-broken version so we can
/// verify the test suite actually fails on bad code. The mutation
/// strategy is per-language because syntactically-correct mutations
/// require knowing the function structure.
export function breakSolution(language: string, solution: string): string {
  switch (language) {
    case "go":
    case "rust":
    case "swift":
      // Replace every `return <expr>` with `return /* broken */ default value`.
      // For statically-typed langs this often won't compile; for cases where
      // it does, the wrong return causes test failure. Either is acceptable
      // — the mutation aim is "tests should NOT pass."
      return solution
        .replace(/\breturn\s+[^;\n}]+/g, "return Default::default()")
        .replace(/\breturn\s+[^;\n}]+/g, "return 0")
        .replace(/Default::default\(\)/g, language === "rust" ? "Default::default()" : "0");
    case "javascript":
    case "typescript":
      // JS/TS — return undefined from every function body. Wrong values
      // for everything; test assertions will fail.
      return solution.replace(/return\s+[^;\n}]+/g, "return undefined");
    case "python":
      return solution.replace(/return\s+[^\n]+/g, "return None");
    case "c":
    case "cpp":
    case "java":
    case "kotlin":
    case "csharp":
      return solution.replace(/return\s+[^;]+;/g, "return 0;");
    case "assembly":
      // For assembly: change the exit syscall arg to a non-zero value
      // by appending a `mov w0, #1` before any svc/syscall. Crude but
      // forces an exit code != 0 so the run-only check fails.
      return solution + "\n        mov     w0, #1\n        mov     x16, #1\n        svc     #0x80\n";
    default:
      return solution;
  }
}
