import type { RunResult, LogLine, TestResult } from "./types";

/// Lua via Fengari (Lua 5.3 VM compiled to plain JavaScript).
///
/// Fengari is ~70KB minified — small enough to load on every Lua run
/// without a worker, no separate WASM blob, no startup cost beyond
/// the dynamic import. The same module-level cached promise pattern
/// used elsewhere in this folder keeps the second run instant.
///
/// Test harness: when `testCode` is supplied, the runtime exposes a
/// minimal `test(name, fn)` + `expect(value)` shim in the global
/// environment before executing the test body. Tests look like:
///
///   test("adds two numbers", function()
///     expect(add(1, 2)).to_equal(3)
///   end)
///
/// The shim mirrors the Pyodide / JavaScript harnesses so a learner
/// switching between languages doesn't have to learn three different
/// assertion vocabularies.

const TIMEOUT_MS = 8000;

type FengariModule = typeof import("fengari");

let fengariPromise: Promise<FengariModule> | null = null;

function getFengari(): Promise<FengariModule> {
  if (fengariPromise) return fengariPromise;
  // Dynamic import so the Fengari VM only ships in the chunk that
  // actually runs Lua. Most learners won't touch Lua, so paying for
  // it on every page load would be wasted bytes.
  fengariPromise = import("fengari");
  return fengariPromise;
}

export async function runLua(code: string, testCode?: string): Promise<RunResult> {
  const start = performance.now();
  const isTest = !!testCode;
  const logs: LogLine[] = [];
  let err: string | undefined;
  const tests: TestResult[] = [];

  try {
    const F = await getFengari();
    const { lua, lualib, lauxlib, to_luastring, to_jsstring } = F;
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    /// Pull a Lua-stack string off the top, converting to a JS string.
    /// Both `lua_tostring` and `luaL_tolstring` can return null when
    /// the value at the index isn't a string and has no `__tostring`
    /// metamethod — we collapse that to "" so the caller's logging /
    /// error path doesn't have to branch on null at every site.
    const popJsString = (idx: number): string => {
      const buf = lua.lua_tostring(L, idx);
      return buf ? to_jsstring(buf) : "";
    };

    // ── print() override ────────────────────────────────────
    // Fengari's default `print` writes to stdout via
    // `process.stdout` shimmed onto an internal buffer. Hooking it
    // ourselves gives us per-call line capture for the LogLine
    // contract — and lets `print(a, b, c)` join with tabs the same
    // way real Lua's `print` does.
    function pushPrint(level: LogLine["level"]) {
      return (state: unknown) => {
        const top = lua.lua_gettop(state);
        const parts: string[] = [];
        for (let i = 1; i <= top; i++) {
          // tostring + jsstring conversion. Numbers, strings, booleans
          // stringify as you'd expect; tables print as their hash
          // address (matching reference Lua) without a __tostring
          // metamethod.
          const tostr = lauxlib.luaL_tolstring(state, i, null);
          parts.push(tostr ? to_jsstring(tostr) : "");
          lua.lua_pop(state, 1);
        }
        logs.push({ level, text: parts.join("\t") });
        return 0;
      };
    }
    lua.lua_pushjsfunction(L, pushPrint("log"));
    lua.lua_setglobal(L, to_luastring("print"));

    // ── Test harness (only when testCode is supplied) ───────
    // Mirrors the JS / Python harnesses — `test(name, fn)` runs the
    // body in a protected call and pushes a TestResult. `expect(v)`
    // returns a thin matcher table with `to_equal` and `to_be`.
    if (isTest) {
      const harnessSrc = `
function test(name, fn)
  local ok, err = pcall(fn)
  __kata_test_result(name, ok, ok and "" or tostring(err))
end

function expect(value)
  local function shallow_eq(a, b)
    if a == b then return true end
    if type(a) ~= 'table' or type(b) ~= 'table' then return false end
    for k, v in pairs(a) do if b[k] ~= v then return false end end
    for k, _ in pairs(b) do if a[k] == nil then return false end end
    return true
  end
  return {
    to_equal = function(expected)
      if not shallow_eq(value, expected) then
        error("expected " .. tostring(expected) .. " but got " .. tostring(value), 2)
      end
    end,
    to_be = function(expected)
      if value ~= expected then
        error("expected " .. tostring(expected) .. " but got " .. tostring(value), 2)
      end
    end,
  }
end
`;
      // __kata_test_result is the JS-side bridge that records a row
      // per assertion. Closes over the `tests` array above.
      lua.lua_pushjsfunction(L, (state: unknown) => {
        const name = to_jsstring(lauxlib.luaL_checklstring(state, 1, null));
        const passed = !!lua.lua_toboolean(state, 2);
        const errMsg = to_jsstring(lauxlib.luaL_optlstring(state, 3, "", null));
        if (passed) {
          tests.push({ name, passed: true });
        } else {
          tests.push({ name, passed: false, error: errMsg });
        }
        return 0;
      });
      lua.lua_setglobal(L, to_luastring("__kata_test_result"));

      // Load the harness first so test/expect are defined when the
      // user code or test body references them.
      const harnessLoad = lauxlib.luaL_loadbuffer(
        L,
        to_luastring(harnessSrc),
        null,
        to_luastring("kata_harness"),
      );
      if (harnessLoad !== lua.LUA_OK) {
        throw new Error(`harness load: ${popJsString(-1)}`);
      }
      if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
        throw new Error(`harness run: ${popJsString(-1)}`);
      }
    }

    // ── User code ───────────────────────────────────────────
    const loadStatus = lauxlib.luaL_loadbuffer(
      L,
      to_luastring(code),
      null,
      to_luastring("user_code"),
    );
    if (loadStatus !== lua.LUA_OK) {
      throw new Error(popJsString(-1));
    }
    const runStatus = lua.lua_pcall(L, 0, 0, 0);
    if (runStatus !== lua.LUA_OK) {
      throw new Error(popJsString(-1));
    }

    // ── Test code (after user code so functions defined above
    //    are visible to test bodies) ─────────────────────────
    if (testCode) {
      const tLoad = lauxlib.luaL_loadbuffer(
        L,
        to_luastring(testCode),
        null,
        to_luastring("user_tests"),
      );
      if (tLoad !== lua.LUA_OK) {
        throw new Error(`tests load: ${popJsString(-1)}`);
      }
      const tRun = lua.lua_pcall(L, 0, 0, 0);
      if (tRun !== lua.LUA_OK) {
        throw new Error(`tests run: ${popJsString(-1)}`);
      }
    }
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const elapsed = performance.now() - start;
  if (elapsed > TIMEOUT_MS) {
    err = err ?? `Lua run exceeded ${TIMEOUT_MS / 1000}s — possible infinite loop`;
  }

  return {
    logs,
    error: err,
    tests: isTest ? tests : undefined,
    durationMs: elapsed,
    testsExpected: isTest,
  };
}
