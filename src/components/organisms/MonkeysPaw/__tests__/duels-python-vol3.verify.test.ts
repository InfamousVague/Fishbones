/// Monkey's Paw python volume 3 content verifier — proves every duel's
/// cheat ladder behaves as designed against the REAL local python3,
/// using the same code/tests merge the in-app runtime uses
/// (`runtimes/python.ts`): user code is exec'd as an importable module
/// named `user`, then the test file runs in a namespace with the
/// `test`/`expect` harness in scope (also importable as `kata_test`).
///
///   - every cheat runs, PASSES the duel's starter tests (so it can
///     survive round 1 of the story), and FAILS the killer suite (so
///     it is killable),
///   - the reference passes BOTH suites (the fairness oracle).
///
/// Gated behind PAW_VERIFY=1 to keep the default `npm test` loop fast.
/// Run it whenever python volume 3 duel content changes:
///
///   PAW_VERIFY=1 npx vitest run src/components/organisms/MonkeysPaw/__tests__/duels-python-vol3.verify.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PYTHON_DUELS_VOL3 } from "@/components/organisms/MonkeysPaw/duels/python-vol3";

const PYTHON = existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3";

/// Mirror of the harness embedded in `runtimes/python.ts` (the Pyodide
/// worker): same `user` module exec, same `kata_test` module, same
/// `test`/`expect` semantics (any exception inside a test body marks it
/// failed; a test-file-level exception aborts the suite). Exit codes:
///   0 = all tests passed, 1 = >=1 test failed,
///   2 = user code failed to exec (≈ compile error),
///   3 = test file itself raised, 4 = suite registered no tests.
const RUNNER = `
import sys, types, json

with open(sys.argv[1], encoding="utf-8") as f:
    _USER_CODE = f.read()
with open(sys.argv[2], encoding="utf-8") as f:
    _TEST_CODE = f.read()

results = []

class _Expectation:
    def __init__(self, actual):
        self.actual = actual
    def to_be(self, expected):
        if self.actual != expected:
            raise AssertionError(f"expected {expected!r}, got {self.actual!r}")
    def to_equal(self, expected):
        if self.actual != expected:
            raise AssertionError(f"expected {expected!r}, got {self.actual!r}")
    def to_be_truthy(self):
        if not self.actual:
            raise AssertionError(f"expected truthy, got {self.actual!r}")
    def to_be_falsy(self):
        if self.actual:
            raise AssertionError(f"expected falsy, got {self.actual!r}")
    def to_be_greater_than(self, n):
        if not (self.actual > n):
            raise AssertionError(f"expected > {n}, got {self.actual!r}")
    def to_be_less_than(self, n):
        if not (self.actual < n):
            raise AssertionError(f"expected < {n}, got {self.actual!r}")
    def to_contain(self, item):
        if item not in self.actual:
            raise AssertionError(f"expected {self.actual!r} to contain {item!r}")
    def to_be_none(self):
        if self.actual is not None:
            raise AssertionError(f"expected None, got {self.actual!r}")
    def to_be_close_to(self, expected, digits=2):
        tol = 10 ** (-digits) / 2
        if abs(self.actual - expected) > tol:
            raise AssertionError(f"expected ~{expected}, got {self.actual!r}")

def expect(actual):
    return _Expectation(actual)

def test(name, fn=None):
    def run(inner_fn):
        try:
            inner_fn()
            results.append({"name": name, "passed": True})
        except AssertionError as e:
            results.append({"name": name, "passed": False, "error": str(e)})
        except Exception as e:
            results.append({"name": name, "passed": False, "error": f"{type(e).__name__}: {e}"})
    if fn is not None:
        run(fn)
        return
    return run

try:
    _user_mod = types.ModuleType("user")
    exec(compile(_USER_CODE, "user.py", "exec"), _user_mod.__dict__)
    sys.modules["user"] = _user_mod
except Exception as e:
    print(f"USER_CODE_ERROR: {type(e).__name__}: {e}")
    sys.exit(2)

kata_test = types.ModuleType("kata_test")
kata_test.test = test
kata_test.expect = expect
sys.modules["kata_test"] = kata_test

try:
    exec(compile(_TEST_CODE, "tests.py", "exec"), {"test": test, "expect": expect, "__name__": "__tests__"})
except Exception as e:
    print(f"TEST_FILE_ERROR: {type(e).__name__}: {e}")
    sys.exit(3)

if not results:
    print("NO_TESTS")
    sys.exit(4)

failed = [r for r in results if not r["passed"]]
if failed:
    print(json.dumps(failed))
    sys.exit(1)
sys.exit(0)
`;

/// Run `code` + `tests` through the runtime-equivalent harness.
/// Returns true when every registered test passed. Throws (instead of
/// returning false) on authoring bugs: user code that won't exec, or a
/// suite that registers zero tests.
function suitePasses(code: string, tests: string, label: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "paw-verify-py3-"));
  try {
    const runnerPath = join(dir, "runner.py");
    const userPath = join(dir, "user_code.py");
    const testsPath = join(dir, "tests_code.py");
    writeFileSync(runnerPath, RUNNER, "utf-8");
    writeFileSync(userPath, code, "utf-8");
    writeFileSync(testsPath, tests, "utf-8");
    try {
      execFileSync(PYTHON, [runnerPath, userPath, testsPath], {
        stdio: "pipe",
        timeout: 30_000,
      });
      return true;
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
      const out = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
      if (e.status === 2) {
        throw new Error(`[${label}] user code failed to RUN:\n${out.slice(0, 2000)}`);
      }
      if (e.status === 4) {
        throw new Error(`[${label}] suite registered NO tests:\n${out.slice(0, 2000)}`);
      }
      // status 1 (failing tests) or 3 (test file raised, e.g. a missing
      // symbol on `from user import …`) both mean the suite rejects
      // this implementation.
      return false;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!process.env.PAW_VERIFY)("Monkey's Paw python duels (vol 3)", () => {
  it("ships the full rank 1..10 ladder", () => {
    expect(PYTHON_DUELS_VOL3.map((d) => d.rank).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  for (const duel of PYTHON_DUELS_VOL3) {
    it(
      `${duel.id} — ladder is coherent and winnable`,
      { timeout: 300_000 },
      () => {
        // Fairness oracle: the reference passes both suites.
        expect(
          suitePasses(duel.reference, duel.starterTests, `${duel.id}/reference vs starter`),
          `${duel.id}: reference must pass the starter tests`,
        ).toBe(true);
        expect(
          suitePasses(duel.reference, duel.killerTests, `${duel.id}/reference vs killer`),
          `${duel.id}: reference must pass the killer suite (duel must be winnable)`,
        ).toBe(true);

        for (const cheat of duel.cheats) {
          expect(
            suitePasses(cheat.code, duel.starterTests, `${duel.id}/${cheat.id} vs starter`),
            `${duel.id}: cheat "${cheat.id}" must PASS the starter tests (or it can never appear)`,
          ).toBe(true);
          expect(
            suitePasses(cheat.code, duel.killerTests, `${duel.id}/${cheat.id} vs killer`),
            `${duel.id}: cheat "${cheat.id}" must FAIL the killer suite (or the duel is unwinnable)`,
          ).toBe(false);
        }
      },
    );
  }
});
