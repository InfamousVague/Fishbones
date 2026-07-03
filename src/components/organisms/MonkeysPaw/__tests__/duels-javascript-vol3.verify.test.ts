/// Monkey's Paw javascript volume 3 content verifier — proves every duel's cheat
/// ladder behaves as designed against REAL node, using a faithful port
/// of the in-app worker harness (`runtimes/javascript.ts`): the
/// implementation runs first as CommonJS (`new AsyncFunction('module',
/// 'exports', 'console', code)`), then the test file runs with the same
/// Jest-like surface (test/it/describe/expect/require/hooks/jest) and
/// `require('./user')` resolving to the implementation's exports.
/// Pass/fail matches `isPassing` with `testsExpected` (no harness
/// error, at least one test ran, every test passed):
///
///   - every cheat runs, PASSES the duel's starter tests (so it can
///     survive round 1 of the story), and FAILS the killer suite (so
///     it is killable),
///   - the reference passes BOTH suites (the fairness oracle).
///
/// Gated behind PAW_VERIFY=1 because it shells out to node ~100 times —
/// too slow for the default `npm test` loop. Run it whenever javascript
/// duel content changes:
///
///   PAW_VERIFY=1 npx vitest run src/components/organisms/MonkeysPaw/__tests__/duels-javascript-vol3.verify.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JAVASCRIPT_DUELS_VOL3 } from "@/components/organisms/MonkeysPaw/duels/javascript-vol3";

/// Standalone node port of the worker in `runtimes/javascript.ts`:
/// same two-phase execution, same matcher semantics (toEqual via
/// JSON.stringify, toBe via ===, hooks, jest.fn, .not/.resolves/
/// .rejects), same "unhandled rejections don't kill the run" worker
/// behavior. Exits 0 when the suite passes under `isPassing`
/// semantics, 1 when a test fails / none ran, 2 on harness errors.
const RUNNER_SOURCE = `'use strict';
const fs = require('fs');
// Web Worker semantics: an unhandled promise rejection does not
// terminate the run (node's default would kill the process).
process.on('unhandledRejection', () => {});

const code = fs.readFileSync(process.argv[2], 'utf-8');
const testCode = fs.readFileSync(process.argv[3], 'utf-8');

function makeTestHarness(results, userModule) {
  const pending = [];
  function fmt(v) {
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
    return String(v);
  }
  const makeExpect = (actual, negate) => {
    const assert = (cond, msg) => {
      if (negate ? cond : !cond) throw new Error((negate ? 'expected not: ' : '') + msg);
    };
    return {
      toBe(expected) {
        assert(actual === expected, 'expected ' + fmt(expected) + ', got ' + fmt(actual));
      },
      toEqual(expected) {
        assert(JSON.stringify(actual) === JSON.stringify(expected),
          'expected ' + fmt(expected) + ', got ' + fmt(actual));
      },
      toStrictEqual(expected) {
        assert(JSON.stringify(actual) === JSON.stringify(expected),
          'expected ' + fmt(expected) + ', got ' + fmt(actual));
      },
      toBeTruthy() { assert(!!actual, 'expected truthy, got ' + fmt(actual)); },
      toBeFalsy() { assert(!actual, 'expected falsy, got ' + fmt(actual)); },
      toBeGreaterThan(n) { assert(actual > n, 'expected > ' + n + ', got ' + fmt(actual)); },
      toBeGreaterThanOrEqual(n) { assert(actual >= n, 'expected >= ' + n + ', got ' + fmt(actual)); },
      toBeLessThan(n) { assert(actual < n, 'expected < ' + n + ', got ' + fmt(actual)); },
      toBeLessThanOrEqual(n) { assert(actual <= n, 'expected <= ' + n + ', got ' + fmt(actual)); },
      toContain(item) {
        const ok = actual && actual.includes && actual.includes(item);
        assert(!!ok, 'expected ' + fmt(actual) + ' to contain ' + fmt(item));
      },
      toHaveLength(n) {
        const len = actual && actual.length;
        assert(len === n, 'expected length ' + n + ', got ' + fmt(len));
      },
      toHaveProperty(key, value) {
        const has = actual != null && Object.prototype.hasOwnProperty.call(actual, key);
        if (arguments.length < 2) assert(has, 'expected property ' + fmt(key));
        else assert(has && JSON.stringify(actual[key]) === JSON.stringify(value),
          'expected property ' + fmt(key) + ' = ' + fmt(value));
      },
      toBeCloseTo(expected, digits = 2) {
        const tol = Math.pow(10, -digits) / 2;
        assert(Math.abs(actual - expected) <= tol, 'expected ~' + expected + ', got ' + fmt(actual));
      },
      toBeNull() { assert(actual === null, 'expected null, got ' + fmt(actual)); },
      toBeUndefined() { assert(actual === undefined, 'expected undefined, got ' + fmt(actual)); },
      toBeDefined() { assert(actual !== undefined, 'expected defined value'); },
      toBeNaN() { assert(typeof actual === 'number' && actual !== actual, 'expected NaN, got ' + fmt(actual)); },
      toBeInstanceOf(ctor) {
        assert(actual instanceof ctor, 'expected instance of ' + (ctor && ctor.name || 'ctor'));
      },
      toMatch(re) {
        const ok = typeof re === 'string' ? String(actual).includes(re) : re.test(String(actual));
        assert(ok, 'expected ' + fmt(actual) + ' to match ' + fmt(re));
      },
      toThrow(expected) {
        let threw = false, err;
        try { typeof actual === 'function' && actual(); }
        catch (e) { threw = true; err = e; }
        if (expected === undefined) assert(threw, 'expected function to throw');
        else {
          const msg = err && (err.message || String(err)) || '';
          const ok = threw && (expected instanceof RegExp ? expected.test(msg) : msg.includes(expected));
          assert(!!ok, 'expected throw matching ' + fmt(expected) + ', got ' + fmt(err));
        }
      },
    };
  };
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
        if (!err) throw new Error('expected promise to reject');
        if (e !== undefined) {
          const msg = (err && err.message) || String(err);
          const ok = e instanceof RegExp ? e.test(msg) : msg.includes(e);
          if (!ok) throw new Error('expected rejection matching ' + fmt(e) + ', got ' + fmt(err));
        }
      },
    };
    return base;
  };

  const beforeEachFns = [];
  const afterEachFns = [];
  const beforeAllFns = [];
  const afterAllFns = [];
  let beforeAllRan = false;
  const test = (name, fn) => {
    const p = (async () => {
      try {
        if (!beforeAllRan) {
          beforeAllRan = true;
          for (const b of beforeAllFns) await b();
        }
        for (const b of beforeEachFns) await b();
        await fn();
        for (const a of afterEachFns) await a();
        results.push({ name, passed: true });
      } catch (err) {
        results.push({ name, passed: false, error: (err && err.message) || String(err) });
        for (const a of afterEachFns) { try { await a(); } catch {} }
      }
    })();
    pending.push(p);
    return p;
  };
  const describe = async (_name, fn) => { await fn(); };
  const requireShim = (path) => {
    if (path === './user' || path === '../user' || path === 'user')
      return userModule.exports;
    throw new Error('require() does not support ' + fmt(path) + ' in tests');
  };
  const jest = {
    fn: (impl) => {
      let current = impl;
      const calls = [];
      const mockResults = [];
      const mockFn = function (...args) {
        calls.push(args);
        try {
          const r = current ? current.apply(this, args) : undefined;
          mockResults.push({ type: 'return', value: r });
          return r;
        } catch (err) {
          mockResults.push({ type: 'throw', value: err });
          throw err;
        }
      };
      mockFn.mock = { calls, results: mockResults };
      mockFn.mockImplementation = (next) => { current = next; return mockFn; };
      mockFn.mockImplementationOnce = (next) => {
        const prev = current;
        current = (...args) => { current = prev; return next(...args); };
        return mockFn;
      };
      mockFn.mockReturnValue = (v) => { current = () => v; return mockFn; };
      mockFn.mockReturnValueOnce = (v) => mockFn.mockImplementationOnce(() => v);
      mockFn.mockResolvedValue = (v) => { current = () => Promise.resolve(v); return mockFn; };
      mockFn.mockResolvedValueOnce = (v) => mockFn.mockImplementationOnce(() => Promise.resolve(v));
      mockFn.mockRejectedValue = (v) => { current = () => Promise.reject(v); return mockFn; };
      mockFn.mockRejectedValueOnce = (v) => mockFn.mockImplementationOnce(() => Promise.reject(v));
      mockFn.mockClear = () => { calls.length = 0; mockResults.length = 0; return mockFn; };
      mockFn.mockReset = () => { current = undefined; calls.length = 0; mockResults.length = 0; return mockFn; };
      return mockFn;
    },
    spyOn: (obj, key) => {
      const original = obj[key];
      const spy = jest.fn(original && original.bind ? original.bind(obj) : original);
      obj[key] = spy;
      spy.mockRestore = () => { obj[key] = original; };
      return spy;
    },
    useFakeTimers: () => {},
    useRealTimers: () => {},
    clearAllTimers: () => {},
    resetAllMocks: () => {},
    clearAllMocks: () => {},
  };
  const beforeEach = (fn) => beforeEachFns.push(fn);
  const afterEach = (fn) => afterEachFns.push(fn);
  const beforeAll = (fn) => beforeAllFns.push(fn);
  const afterAll = (fn) => afterAllFns.push(fn);

  return {
    test, describe, expect, require: requireShim, pending,
    beforeEach, afterEach, beforeAll, afterAll, jest, afterAllFns,
  };
}

(async () => {
  const tests = [];
  const noop = () => {};
  const fakeConsole = {
    log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop,
  };
  const userModule = { exports: {} };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  try {
    const userFn = new AsyncFunction('module', 'exports', 'console', code);
    await userFn(userModule, userModule.exports, fakeConsole);
  } catch (err) {
    console.log('USER_CODE_ERROR: ' + ((err && (err.stack || err.message)) || String(err)));
    process.exit(2);
  }

  const h = makeTestHarness(tests, userModule);
  try {
    const testFn = new AsyncFunction(
      'test', 'it', 'describe', 'expect', 'require', 'console',
      'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
      'jest', 'global', 'globalThis',
      testCode
    );
    await testFn(
      h.test, h.test, h.describe, h.expect, h.require, fakeConsole,
      h.beforeEach, h.afterEach, h.beforeAll, h.afterAll,
      h.jest, globalThis, globalThis,
    );
    await Promise.allSettled(h.pending);
    for (const a of h.afterAllFns) { try { await a(); } catch {} }
  } catch (err) {
    console.log('TEST_FILE_ERROR: ' + ((err && (err.stack || err.message)) || String(err)));
    process.exit(2);
  }

  // isPassing semantics with testsExpected=true.
  if (tests.length === 0) {
    console.log('NO_TESTS_RAN');
    process.exit(1);
  }
  const failed = tests.filter((t) => !t.passed);
  if (failed.length > 0) {
    for (const f of failed) console.log('FAIL ' + f.name + ' :: ' + f.error);
    process.exit(1);
  }
  process.exit(0);
})();
`;

/// Run `code` + `tests` through the ported harness in a scratch dir.
/// pass=true ⇔ exit 0 (every registered test passed, at least one ran).
function suiteRun(
  code: string,
  tests: string,
): { pass: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "paw-js-verify-"));
  try {
    writeFileSync(join(dir, "user.js"), code, "utf-8");
    writeFileSync(join(dir, "tests.js"), tests, "utf-8");
    writeFileSync(join(dir, "runner.cjs"), RUNNER_SOURCE, "utf-8");
    try {
      const out = execFileSync(
        process.execPath,
        ["runner.cjs", "user.js", "tests.js"],
        { cwd: dir, stdio: "pipe", timeout: 15_000 },
      );
      return { pass: true, output: out.toString() };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const output = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
      return { pass: false, output: output.slice(0, 2000) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!process.env.PAW_VERIFY)("Monkey's Paw javascript duels (volume 3)", () => {
  it("ships a complete rank 1–10 ladder", () => {
    expect(JAVASCRIPT_DUELS_VOL3).toHaveLength(10);
    const ranks = [...JAVASCRIPT_DUELS_VOL3].map((d) => d.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const duel of JAVASCRIPT_DUELS_VOL3) {
      expect(duel.language).toBe("javascript");
      expect(duel.id.startsWith("paw-javascript-")).toBe(true);
      expect(duel.cheats.length).toBeGreaterThanOrEqual(3);
      expect(duel.cheats.length).toBeLessThanOrEqual(5);
    }
  });

  for (const duel of JAVASCRIPT_DUELS_VOL3) {
    it(
      `${duel.id} — ladder is coherent and winnable`,
      { timeout: 300_000 },
      () => {
        // Fairness oracle: the reference passes both suites.
        const refStarter = suiteRun(duel.reference, duel.starterTests);
        expect(
          refStarter.pass,
          `${duel.id}: reference must pass the starter tests\n${refStarter.output}`,
        ).toBe(true);
        const refKiller = suiteRun(duel.reference, duel.killerTests);
        expect(
          refKiller.pass,
          `${duel.id}: reference must pass the killer suite (duel must be winnable)\n${refKiller.output}`,
        ).toBe(true);

        for (const cheat of duel.cheats) {
          const vsStarter = suiteRun(cheat.code, duel.starterTests);
          expect(
            vsStarter.pass,
            `${duel.id}: cheat "${cheat.id}" must PASS the starter tests (or it can never appear)\n${vsStarter.output}`,
          ).toBe(true);
          const vsKiller = suiteRun(cheat.code, duel.killerTests);
          expect(
            vsKiller.pass,
            `${duel.id}: cheat "${cheat.id}" must FAIL the killer suite (or the duel is unwinnable)`,
          ).toBe(false);
        }
      },
    );
  }
});
