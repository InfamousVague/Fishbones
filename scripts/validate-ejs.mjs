#!/usr/bin/env node
// Validate the Eloquent JavaScript course the same way the in-app worker
// runs it, but in Node so we can sweep the whole course headlessly.
//
// Mirrors src/runtimes/javascript.ts `runInWorker`:
//   - user code runs inside `new AsyncFunction('module','exports','console', code)`
//   - only console.* surfaces output
//   - tests get a Jest-ish harness with require('./user') → user module.exports
//
// Three checks:
//   1. EXERCISES   — run each solution against its tests; every test must pass.
//                    Also confirm the STARTER compiles (parses + runs without
//                    throwing at load) so the editor seeds with valid code.
//   2. PLAYGROUNDS — extract every ```javascript playground``` fence from lesson
//                    bodies and run it; it must not throw.
//   3. STATIC      — (report-only) run every plain ```javascript``` fence to see
//                    which are already self-contained + runnable (conversion
//                    candidates) vs which reference cross-fence state.
//
// Usage:
//   node scripts/validate-ejs.mjs [path/to/course.json]
//   node scripts/validate-ejs.mjs --json   (machine-readable summary on stdout)
//
// Exit code is non-zero if any EXERCISE or PLAYGROUND check fails, so a loop
// can gate a deploy on a clean sweep.

import { readFileSync } from "node:fs";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const RUN_TIMEOUT_MS = 5000;

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const coursePath =
  args.find((a) => !a.startsWith("--")) ||
  new URL("../.ejs-work/course.json", import.meta.url).pathname;

// ---- worker-faithful console + test harness ------------------------------

function formatArg(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function makeConsole(logs) {
  const make = (level) => (...a) =>
    logs.push({ level, text: a.map(formatArg).join(" ") });
  return {
    log: make("log"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    debug: make("log"),
    trace: make("log"),
  };
}

function fmt(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// Mirror of the worker's expect(), trimmed to the matchers our tests use but
// kept behaviourally identical for those.
function makeExpect(actual, negate) {
  const assert = (cond, msg) => {
    if (negate ? cond : !cond)
      throw new Error((negate ? "expected not: " : "") + msg);
  };
  return {
    toBe(e) { assert(actual === e, "expected " + fmt(e) + ", got " + fmt(actual)); },
    toEqual(e) { assert(JSON.stringify(actual) === JSON.stringify(e), "expected " + fmt(e) + ", got " + fmt(actual)); },
    toStrictEqual(e) { assert(JSON.stringify(actual) === JSON.stringify(e), "expected " + fmt(e) + ", got " + fmt(actual)); },
    toBeTruthy() { assert(!!actual, "expected truthy, got " + fmt(actual)); },
    toBeFalsy() { assert(!actual, "expected falsy, got " + fmt(actual)); },
    toBeGreaterThan(n) { assert(actual > n, "expected > " + n + ", got " + fmt(actual)); },
    toBeGreaterThanOrEqual(n) { assert(actual >= n, "expected >= " + n + ", got " + fmt(actual)); },
    toBeLessThan(n) { assert(actual < n, "expected < " + n + ", got " + fmt(actual)); },
    toBeLessThanOrEqual(n) { assert(actual <= n, "expected <= " + n + ", got " + fmt(actual)); },
    toContain(item) { const ok = actual && actual.includes && actual.includes(item); assert(!!ok, "expected " + fmt(actual) + " to contain " + fmt(item)); },
    toHaveLength(n) { const len = actual && actual.length; assert(len === n, "expected length " + n + ", got " + fmt(len)); },
    toHaveProperty(key, value) {
      const has = actual != null && Object.prototype.hasOwnProperty.call(actual, key);
      if (arguments.length < 2) assert(has, "expected property " + fmt(key));
      else assert(has && JSON.stringify(actual[key]) === JSON.stringify(value), "expected property " + fmt(key) + " = " + fmt(value));
    },
    toBeCloseTo(e, digits = 2) { const tol = Math.pow(10, -digits) / 2; assert(Math.abs(actual - e) <= tol, "expected ~" + e + ", got " + fmt(actual)); },
    toBeNull() { assert(actual === null, "expected null, got " + fmt(actual)); },
    toBeUndefined() { assert(actual === undefined, "expected undefined, got " + fmt(actual)); },
    toBeDefined() { assert(actual !== undefined, "expected defined value"); },
    toBeNaN() { assert(typeof actual === "number" && actual !== actual, "expected NaN, got " + fmt(actual)); },
    toBeInstanceOf(ctor) { assert(actual instanceof ctor, "expected instance of " + ((ctor && ctor.name) || "ctor")); },
    toMatch(re) { const ok = typeof re === "string" ? String(actual).includes(re) : re.test(String(actual)); assert(ok, "expected " + fmt(actual) + " to match " + fmt(re)); },
    toThrow(expected) {
      let threw = false, err;
      try { typeof actual === "function" && actual(); } catch (e) { threw = true; err = e; }
      if (expected === undefined) assert(threw, "expected function to throw");
      else {
        const msg = (err && (err.message || String(err))) || "";
        const ok = threw && (expected instanceof RegExp ? expected.test(msg) : msg.includes(expected));
        assert(!!ok, "expected throw matching " + fmt(expected) + ", got " + fmt(err));
      }
    },
  };
}

function makeExpectRoot() {
  const expect = (actual) => {
    const base = makeExpect(actual, false);
    base.not = makeExpect(actual, true);
    base.resolves = {
      async toBe(e) { return expect(await actual).toBe(e); },
      async toEqual(e) { return expect(await actual).toEqual(e); },
    };
    base.rejects = {
      async toThrow(e) {
        let err;
        try { await actual; } catch (x) { err = x; }
        if (!err) throw new Error("expected promise to reject");
        if (e !== undefined) {
          const msg = (err && err.message) || String(err);
          const ok = e instanceof RegExp ? e.test(msg) : msg.includes(e);
          if (!ok) throw new Error("expected rejection matching " + fmt(e));
        }
      },
    };
    return base;
  };
  return expect;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// Run a single self-contained snippet (playground or static fence).
async function runSnippet(code) {
  const logs = [];
  const con = makeConsole(logs);
  const mod = { exports: {} };
  try {
    const fn = new AsyncFunction("module", "exports", "console", code);
    await withTimeout(Promise.resolve(fn(mod, mod.exports, con)), RUN_TIMEOUT_MS, "snippet");
    return { ok: true, logs };
  } catch (err) {
    return { ok: false, error: (err && (err.message || String(err))) || String(err), logs };
  }
}

// Run a solution+tests pair the way the workbench does.
async function runExercise(solution, testsSrc) {
  const logs = [];
  const con = makeConsole(logs);
  const userModule = { exports: {} };
  // 1. load user/solution code
  try {
    const userFn = new AsyncFunction("module", "exports", "console", solution);
    await withTimeout(Promise.resolve(userFn(userModule, userModule.exports, con)), RUN_TIMEOUT_MS, "solution load");
  } catch (err) {
    return { loadError: (err && (err.message || String(err))) || String(err), tests: [] };
  }
  // 2. run tests
  const results = [];
  const pending = [];
  const expect = makeExpectRoot();
  const test = (name, fn) => {
    const p = (async () => {
      try { await fn(); results.push({ name, passed: true }); }
      catch (err) { results.push({ name, passed: false, error: (err && err.message) || String(err) }); }
    })();
    pending.push(p);
    return p;
  };
  const describe = async (_n, fn) => { await fn(); };
  const require = (path) => {
    if (path === "./user" || path === "../user" || path === "user") return userModule.exports;
    throw new Error("require() does not support " + fmt(path));
  };
  const noop = () => {};
  try {
    const testFn = new AsyncFunction(
      "test", "it", "describe", "expect", "require", "console",
      "beforeEach", "afterEach", "beforeAll", "afterAll", "jest", "global", "globalThis",
      testsSrc,
    );
    await withTimeout(
      Promise.resolve(testFn(test, test, describe, expect, require, con, noop, noop, noop, noop, {}, globalThis, globalThis)),
      RUN_TIMEOUT_MS, "tests",
    );
    await withTimeout(Promise.allSettled(pending), RUN_TIMEOUT_MS, "test settle");
  } catch (err) {
    return { testFileError: (err && (err.message || String(err))) || String(err), tests: results };
  }
  return { tests: results };
}

// ---- fence extraction -----------------------------------------------------

function extractFences(body) {
  const out = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(body || "")) !== null) {
    const info = m[1].trim().split(/\s+/);
    out.push({ lang: info[0] || "", playground: info.slice(1).includes("playground"), code: m[2] });
  }
  return out;
}

// ---- main -----------------------------------------------------------------

async function main() {
  const course = JSON.parse(readFileSync(coursePath, "utf8"));
  const lessons = course.chapters.flatMap((ch) => (ch.lessons || []).map((l) => ({ chapter: ch.title, ...l })));

  const report = { exercises: [], playgrounds: [], staticFences: { runnable: 0, throws: 0, total: 0, throwing: [] } };

  // 1. EXERCISES
  for (const l of lessons) {
    if (l.kind !== "exercise" && l.kind !== "mixed") continue;
    if (!l.solution || !l.tests) {
      report.exercises.push({ id: l.id, status: "MISSING", detail: !l.solution ? "no solution" : "no tests" });
      continue;
    }
    const r = await runExercise(l.solution, l.tests);
    if (r.loadError) report.exercises.push({ id: l.id, status: "LOAD_ERROR", detail: r.loadError });
    else if (r.testFileError) report.exercises.push({ id: l.id, status: "TEST_FILE_ERROR", detail: r.testFileError, tests: r.tests });
    else {
      const failed = r.tests.filter((t) => !t.passed);
      report.exercises.push({
        id: l.id,
        status: r.tests.length === 0 ? "NO_TESTS_RAN" : failed.length ? "FAIL" : "PASS",
        passed: r.tests.length - failed.length,
        total: r.tests.length,
        failures: failed,
      });
    }
  }

  // 2 & 3. FENCES
  for (const l of lessons) {
    for (const f of extractFences(l.body)) {
      if (f.lang !== "javascript" && f.lang !== "js") continue;
      if (f.playground) {
        const r = await runSnippet(f.code);
        report.playgrounds.push({ id: l.id, ok: r.ok, error: r.error, logCount: r.logs.length });
      } else {
        report.staticFences.total++;
        const r = await runSnippet(f.code);
        if (r.ok) report.staticFences.runnable++;
        else { report.staticFences.throws++; report.staticFences.throwing.push({ id: l.id, error: r.error }); }
      }
    }
  }

  if (jsonOut) {
    process.stdout.write(JSON.stringify(report, null, 2));
    const bad = report.exercises.filter((e) => e.status !== "PASS").length + report.playgrounds.filter((p) => !p.ok).length;
    process.exit(bad ? 1 : 0);
  }

  // human summary
  const exPass = report.exercises.filter((e) => e.status === "PASS").length;
  const exBad = report.exercises.filter((e) => e.status !== "PASS");
  console.log(`\n=== EXERCISES: ${exPass}/${report.exercises.length} fully pass ===`);
  for (const e of exBad) {
    console.log(`  ✗ ${e.id} [${e.status}] ${e.detail || ""}`);
    for (const f of e.failures || []) console.log(`      - ${f.name}: ${f.error}`);
  }

  const pgOk = report.playgrounds.filter((p) => p.ok).length;
  console.log(`\n=== PLAYGROUND fences: ${pgOk}/${report.playgrounds.length} run clean ===`);
  for (const p of report.playgrounds.filter((p) => !p.ok)) console.log(`  ✗ ${p.id}: ${p.error}`);

  console.log(`\n=== STATIC js fences: ${report.staticFences.runnable}/${report.staticFences.total} would run clean (conversion candidates) ===`);
  console.log(`    ${report.staticFences.throws} reference cross-fence state or are intentionally-erroring (keep static or wrap)`);

  const bad = exBad.length + report.playgrounds.filter((p) => !p.ok).length;
  console.log(`\n${bad === 0 ? "✓ ALL GREEN" : "✗ " + bad + " blocking issue(s)"}\n`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
