import { transform as sucraseTransform } from "sucrase";
import jsSha3Source from "js-sha3/build/sha3.min.js?raw";
import type { RunResult, LogLine, TestResult } from "./types";

/// In-browser JavaScript / TypeScript runtime.
///
/// User code runs inside a fresh Web Worker so an infinite loop or runaway
/// allocation can't take down the UI (we terminate the worker on timeout).
/// Console methods are proxied so `console.log`, `info`, `warn`, and `error`
/// all surface in the OutputPane instead of the DevTools console.
///
/// When `testCode` is supplied, the worker runs the user code first, captures
/// its `module.exports` into a `userModule`, then injects a tiny Jest-like
/// harness (`test`, `expect`, `require('./user')`) and runs the test file.

const TIMEOUT_MS = 5000;

export async function runJavaScript(code: string, testCode?: string): Promise<RunResult> {
  return runInWorker(code, testCode);
}

export async function runTypeScript(code: string, testCode?: string): Promise<RunResult> {
  const compiledCode = compileTypeScript(code);
  if ("error" in compiledCode) return compiledCode.error;
  const compiledTests = testCode ? compileTypeScript(testCode) : null;
  if (compiledTests && "error" in compiledTests) return compiledTests.error;
  return runInWorker(
    compiledCode.js,
    compiledTests ? compiledTests.js : undefined,
  );
}

/// Run sucrase with the `typescript` transform to strip type annotations,
/// generics, interfaces, enums, and other TS-only syntax. Returns either
/// the compiled JS or a RunResult-shaped error so the caller can surface
/// a friendly "your TypeScript didn't compile" message instead of letting
/// the worker hit `new AsyncFunction(...)` with unstripped TS tokens and
/// die with an opaque `SyntaxError: AsyncFunction@[native code]`.
function compileTypeScript(
  source: string,
): { js: string } | { error: RunResult } {
  try {
    // `disableESTransforms: true` preserves modern ES syntax — we're
    // running in the same webview as the app, so `const`, arrow funcs,
    // async/await, optional chaining, etc. all work natively and don't
    // need down-leveling. We only want TS syntax removed.
    // `imports` transform rewrites ESM `export`/`import` to CommonJS so the
    // code works inside the worker's `new AsyncFunction('module', 'exports', ...)`
    // shell. Challenge-pack TS lessons use `export function` rather than
    // `module.exports`; without this they fail with "Unexpected token 'export'".
    const { code } = sucraseTransform(source, {
      transforms: ["typescript", "imports"],
      disableESTransforms: true,
    });
    return { js: code };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      error: {
        logs: [],
        error: `TypeScript compile error: ${msg}`,
        durationMs: 0,
      },
    };
  }
}

function runInWorker(code: string, testCode: string | undefined): Promise<RunResult> {
  // Inline js-sha3 so `require('js-sha3')` works inside the worker.
  // We expose the resolved exports via `__jsSha3` for the shim below.
  // The library is a UMD bundle that walks `module`/`globalThis` to
  // attach its API; binding `module.exports = {}` and running it under
  // a freshly-named scope captures whatever it tried to export.
  const jsSha3Inline = `
    const __jsSha3 = (() => {
      const module = { exports: {} };
      ${jsSha3Source}
      return module.exports;
    })();
  `;
  // Minimal Buffer polyfill so the few Node-style \`Buffer.from(...)\`
  // patterns that ingest-generated tests use (utf8 + hex encodings,
  // \`.toString('hex')\`) work inside the worker without pulling the
  // full \`buffer\` package in.
  const bufferShim = `
    class __Buf extends Uint8Array {
      static from(input, encoding) {
        if (input instanceof Uint8Array) return new __Buf(input);
        if (Array.isArray(input)) return new __Buf(input);
        if (typeof input === 'string') {
          if (encoding === 'hex') {
            const clean = input.replace(/^0x/, '');
            const out = new Uint8Array(clean.length / 2);
            for (let i = 0; i < out.length; i++) {
              out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
            }
            return new __Buf(out);
          }
          // Default to utf8 (matches Node).
          return new __Buf(new TextEncoder().encode(input));
        }
        throw new Error('Buffer.from: unsupported input');
      }
      static concat(parts) {
        let n = 0;
        for (const p of parts) n += p.length;
        const out = new Uint8Array(n);
        let off = 0;
        for (const p of parts) { out.set(p, off); off += p.length; }
        return new __Buf(out);
      }
      toString(encoding) {
        if (encoding === 'hex' || encoding === undefined) {
          let s = '';
          for (const b of this) s += b.toString(16).padStart(2, '0');
          return s;
        }
        if (encoding === 'utf8' || encoding === 'utf-8') {
          return new TextDecoder().decode(this);
        }
        return Uint8Array.prototype.toString.call(this);
      }
    }
    self.Buffer = __Buf;
  `;
  const workerSource = `
    ${bufferShim}
    ${jsSha3Inline}
    self.onmessage = async (e) => {
      const logs = [];
      const tests = [];
      const makeLogger = (level) => (...args) => {
        logs.push({ level, text: args.map(formatArg).join(' ') });
      };
      function formatArg(v) {
        if (v === null) return 'null';
        if (v === undefined) return 'undefined';
        if (typeof v === 'string') return v;
        if (typeof v === 'object') {
          try { return JSON.stringify(v, null, 2); } catch { return String(v); }
        }
        return String(v);
      }
      self.console = {
        log:   makeLogger('log'),
        info:  makeLogger('info'),
        warn:  makeLogger('warn'),
        error: makeLogger('error'),
        debug: makeLogger('log'),
        trace: makeLogger('log'),
      };

      // CommonJS shim — captures the user's exports so the test file can
      // \`require('./user')\` below.
      const userModule = { exports: {} };
      const userExports = userModule.exports;

      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const start = performanceNow();

      const testsExpected = !!e.data.testCode;

      try {
        const userFn = new AsyncFunction('module', 'exports', 'console', e.data.code);
        await userFn(userModule, userExports, self.console);
      } catch (err) {
        self.postMessage({
          logs,
          error: formatError(err),
          durationMs: performanceNow() - start,
          testsExpected,
        });
        return;
      }

      // ---- Test phase (optional) ----
      if (e.data.testCode) {
        const testHarness = makeTestHarness(tests, userModule);
        try {
          const testFn = new AsyncFunction(
            'test', 'it', 'describe', 'expect', 'require', 'console',
            'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
            'jest', 'global', 'globalThis',
            e.data.testCode
          );
          await testFn(
            testHarness.test,
            testHarness.test,       // alias 'it' → 'test'
            testHarness.describe,
            testHarness.expect,
            testHarness.require,
            self.console,
            testHarness.beforeEach,
            testHarness.afterEach,
            testHarness.beforeAll,
            testHarness.afterAll,
            testHarness.jest,
            self,                    // 'global' alias — Jest tests mutate
            self,                    // 'globalThis' — same thing, newer name
          );
          // Test files register tests via fire-and-forget \`test(...)\`
          // calls (no await in the file body). Each call kicks off an
          // IIFE tracked in testHarness.pending. Wait for every one to
          // settle before we post — otherwise the worker returns
          // tests=[] while result pushes are still queued in the
          // microtask backlog, and the e2e reporter sees "passed with
          // 0 tests" for any async test whose fn has an \`await\` inside.
          await Promise.allSettled(testHarness.pending);
          // Drain afterAll hooks once every test has settled. Swallow
          // errors — a crashing teardown shouldn't clobber otherwise-
          // valid test results.
          for (const a of testHarness.afterAllFns || []) { try { await a(); } catch {} }
        } catch (err) {
          // A thrown error in the test file itself (not a failing assertion)
          self.postMessage({
            logs,
            tests,
            error: 'test file error: ' + formatError(err),
            durationMs: performanceNow() - start,
            testsExpected,
          });
          return;
        }
      }

      self.postMessage({
        logs,
        tests,
        durationMs: performanceNow() - start,
        testsExpected,
      });

      // ---- Helpers defined inside the worker source ----
      function performanceNow() {
        return (typeof performance !== 'undefined' ? performance.now() : Date.now());
      }

      function formatError(err) {
        return (err && (err.stack || err.message)) || String(err);
      }

      function makeTestHarness(results, userModule) {
        // Every \`test(...)\` call fires off an IIFE that awaits the user
        // fn and pushes a PASS/FAIL entry. We collect those IIFE
        // promises so the worker can await them before it posts —
        // the test file never \`await\`s them itself (Jest-style
        // fire-and-forget), and without this tracking the worker
        // would post before any async-test result is collected. See
        // the \`await Promise.allSettled(testHarness.pending)\` call
        // site above.
        const pending = [];
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

        // \`test\` is deliberately NOT async — it kicks off the body in
        // an IIFE and registers that promise in \`pending\` so the
        // worker can await every test before posting. See the
        // \`pending\` array above and the call site.
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
              // Still run afterEach hooks on failure so they can
              // tear down shared state. Jest does the same; skipping
              // them leaks mocks between tests.
              for (const a of afterEachFns) { try { await a(); } catch {} }
            }
          })();
          pending.push(p);
          return p;
        };

        const describe = async (_name, fn) => { await fn(); };

        const require = (path) => {
          if (path === './user' || path === '../user' || path === 'user')
            return userModule.exports;
          if (path === 'js-sha3') return __jsSha3;
          throw new Error("require() does not support " + fmt(path) + " in tests");
        };

        // Minimal Jest-compatible \`jest.fn\` shim. Tracks calls + results
        // with the subset of the Jest mock surface that generated tests
        // actually use (.mock.calls/.mock.results, mockImplementation,
        // mockReturnValue, mockResolvedValue, mockRejectedValue,
        // mockClear, mockReset). Enough for the "mock fetch / mock
        // document" patterns the ingest pipeline emits without pulling
        // in all of Jest.
        const jest = {
          fn: (impl) => {
            let current = impl;
            const calls = [];
            const results = [];
            const mockFn = function (...args) {
              calls.push(args);
              try {
                const r = current ? current.apply(this, args) : undefined;
                results.push({ type: 'return', value: r });
                return r;
              } catch (err) {
                results.push({ type: 'throw', value: err });
                throw err;
              }
            };
            mockFn.mock = { calls, results };
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
            mockFn.mockClear = () => { calls.length = 0; results.length = 0; return mockFn; };
            mockFn.mockReset = () => { current = undefined; calls.length = 0; results.length = 0; return mockFn; };
            return mockFn;
          },
          spyOn: (obj, key) => {
            const original = obj[key];
            const spy = jest.fn(original && original.bind ? original.bind(obj) : original);
            obj[key] = spy;
            spy.mockRestore = () => { obj[key] = original; };
            return spy;
          },
          // Timers / modules aren't implemented — most generated tests
          // don't use them, and faking them properly would need a full
          // module resolver. Calls become no-ops so a test that
          // \`jest.useFakeTimers()\` as setup doesn't crash outright.
          useFakeTimers: () => {},
          useRealTimers: () => {},
          clearAllTimers: () => {},
          resetAllMocks: () => {},
          clearAllMocks: () => {},
        };

        // Minimal lifecycle hook shims. We run the \`beforeEach\` /
        // \`afterEach\` arrays around each registered \`test\` body;
        // \`beforeAll\` / \`afterAll\` run synchronously at registration
        // time + after all tests settle via an outer promise. Generated
        // test files use these sparingly, but having them defined means
        // a test file that calls \`beforeEach(() => ...)\` no longer
        // blows up with "beforeEach is not defined" before the first
        // test ever runs.
        const beforeEachFns = [];
        const afterEachFns = [];
        const beforeAllFns = [];
        const afterAllFns = [];
        const beforeEach = (fn) => beforeEachFns.push(fn);
        const afterEach = (fn) => afterEachFns.push(fn);
        const beforeAll = (fn) => beforeAllFns.push(fn);
        const afterAll = (fn) => afterAllFns.push(fn);

        function fmt(v) {
          if (typeof v === 'string') return JSON.stringify(v);
          if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
          return String(v);
        }

        return {
          test, describe, expect, require, pending,
          beforeEach, afterEach, beforeAll, afterAll,
          jest,
          // Exposed so the outer worker code can run final teardown
          // after every test has settled. Internal — tests don't see it.
          afterAllFns,
        };
      }
    };
  `;

  const blob = new Blob([workerSource], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  return new Promise<RunResult>((resolve) => {
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve({
        logs: [] as LogLine[],
        tests: [] as TestResult[],
        error: `execution timed out after ${TIMEOUT_MS}ms`,
        durationMs: TIMEOUT_MS,
        testsExpected: !!testCode,
      });
    }, TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent<RunResult>) => {
      clearTimeout(timeout);
      cleanup();
      resolve(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timeout);
      cleanup();
      // `e.message` is sometimes empty when the worker throws from a
      // `new Function` / `new AsyncFunction` parse failure (the browser
      // surfaces it as "AsyncFunction@[native code]" instead of a real
      // message). Falling back to filename + line/col gives the learner
      // at least a pointer to where the problem lives.
      const locHint =
        e.filename || e.lineno
          ? ` (${e.filename ?? "worker"}:${e.lineno ?? "?"}:${e.colno ?? "?"})`
          : "";
      resolve({
        logs: [] as LogLine[],
        error:
          (e.message && e.message.trim())
            ? e.message
            : `worker crashed — likely a syntax error in your code${locHint}`,
        durationMs: 0,
        testsExpected: !!testCode,
      });
    };

    worker.postMessage({ code, testCode });
  });
}

