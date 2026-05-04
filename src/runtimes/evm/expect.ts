/// Tiny Jest-compatible `expect` factory used by the EVM test
/// harness. Originally lived inline inside `runEvm` but was already
/// flagged in the source as "re-export from a shared module before
/// merging" — pulling it out lets `solidity.ts` (which has its own
/// near-identical copy today) consume the same matchers next time
/// it gets touched.
///
/// Surface mirrors Jest where it makes sense, plus the EVM-specific
/// niceties:
///   - `bigint`-aware `===` so `expect(1n).toBe(1n)` works.
///   - `Uint8Array` rendered as `0x…` in failure messages.
///   - `expect.any(BigInt)` markers passed through `deepEqual` as
///     wildcards.
///
/// Doesn't import from `@ethereumjs/*` or `viem` — keep this file
/// dependency-free so it can be reused from the future shared
/// runtime-test harness without dragging in 3MB of EVM tooling.

import { stringify } from "./helpers";

const ANY_MARK = Symbol.for("fishbones.expect.any");

interface AnyMarker {
  [ANY_MARK]: unknown;
}

function isAnyMarker(v: unknown): v is AnyMarker {
  return typeof v === "object" && v !== null && ANY_MARK in (v as object);
}

function matchesAny(actual: unknown, ctor: unknown): boolean {
  if (ctor === BigInt) return typeof actual === "bigint";
  if (ctor === Number) return typeof actual === "number";
  if (ctor === String) return typeof actual === "string";
  if (ctor === Boolean) return typeof actual === "boolean";
  if (ctor === Object) return typeof actual === "object" && actual !== null;
  if (ctor === Array) return Array.isArray(actual);
  if (typeof ctor === "function")
    return actual instanceof (ctor as new (...a: unknown[]) => object);
  return false;
}

/// Deep structural equality with `expect.any(...)` wildcard support.
/// Exported because the EVM test harness occasionally needs to match
/// inside log-event `args` records before handing them to a matcher.
export function deepEqual(a: unknown, b: unknown): boolean {
  // `b` (expected) may carry expect.any(...) markers.
  if (isAnyMarker(b)) {
    return matchesAny(a, b[ANY_MARK]);
  }
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "bigint" || typeof b === "bigint") return a === b;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!kb.includes(k)) return false;
      if (
        !deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        return false;
    }
    return true;
  }
  return false;
}

function buildExpect(actual: unknown, negate: boolean) {
  const fail = (msg: string) => {
    throw new Error(negate ? `Expected NOT: ${msg}` : msg);
  };
  const check = (cond: boolean, msg: string) => {
    if (negate ? cond : !cond) fail(msg);
  };
  return {
    toBe(e: unknown) {
      check(
        Object.is(actual, e),
        `Expected ${stringify(actual)} to be ${stringify(e)}`,
      );
    },
    toEqual(e: unknown) {
      check(
        deepEqual(actual, e),
        `Expected ${stringify(actual)} to equal ${stringify(e)}`,
      );
    },
    toContainEqual(e: unknown) {
      check(
        Array.isArray(actual) && actual.some((item) => deepEqual(item, e)),
        `Expected ${stringify(actual)} to contain ${stringify(e)}`,
      );
    },
    toHaveLength(n: number) {
      const len = (actual as { length?: number } | null)?.length;
      check(len === n, `Expected length ${stringify(len)} to be ${n}`);
    },
    toBeDefined() {
      check(actual !== undefined, "Expected value to be defined");
    },
    toBeUndefined() {
      check(
        actual === undefined,
        `Expected ${stringify(actual)} to be undefined`,
      );
    },
    toBeTruthy() {
      check(!!actual, `Expected ${stringify(actual)} to be truthy`);
    },
    toBeFalsy() {
      check(!actual, `Expected ${stringify(actual)} to be falsy`);
    },
    toBeGreaterThan(n: number | bigint) {
      check(
        actual !== undefined &&
          actual !== null &&
          (actual as bigint | number) > n,
        `Expected ${stringify(actual)} > ${stringify(n)}`,
      );
    },
    toBeLessThan(n: number | bigint) {
      check(
        actual !== undefined &&
          actual !== null &&
          (actual as bigint | number) < n,
        `Expected ${stringify(actual)} < ${stringify(n)}`,
      );
    },
    toBeGreaterThanOrEqual(n: number | bigint) {
      check(
        actual !== undefined &&
          actual !== null &&
          (actual as bigint | number) >= n,
        `Expected ${stringify(actual)} >= ${stringify(n)}`,
      );
    },
    toBeLessThanOrEqual(n: number | bigint) {
      check(
        actual !== undefined &&
          actual !== null &&
          (actual as bigint | number) <= n,
        `Expected ${stringify(actual)} <= ${stringify(n)}`,
      );
    },
    toContain(sub: unknown) {
      const isStringMatch =
        typeof actual === "string" &&
        typeof sub === "string" &&
        actual.includes(sub);
      const isArrayMatch =
        Array.isArray(actual) && actual.some((item) => deepEqual(item, sub));
      check(
        isStringMatch || isArrayMatch,
        `Expected ${stringify(actual)} to contain ${stringify(sub)}`,
      );
    },
    toMatch(re: RegExp) {
      check(
        typeof actual === "string" && re.test(actual),
        `Expected ${stringify(actual)} to match ${re}`,
      );
    },
    toThrow(matcher?: string | RegExp) {
      if (typeof actual !== "function") {
        fail("Expected a function for toThrow");
        return;
      }
      let threw = false;
      let err: unknown;
      try {
        (actual as () => unknown)();
      } catch (e) {
        threw = true;
        err = e;
      }
      if (negate) {
        if (threw)
          fail(`Function should not have thrown (got ${stringify(err)})`);
        return;
      }
      if (!threw) fail("Function did not throw");
      if (matcher !== undefined) {
        const msg = err instanceof Error ? err.message : String(err);
        const ok =
          typeof matcher === "string" ? msg.includes(matcher) : matcher.test(msg);
        if (!ok)
          throw new Error(
            `Expected thrown message to match ${matcher}, got: ${msg}`,
          );
      }
    },
  };
}

/// Public Jest-style `expect`. Calling `expect(value)` returns an
/// object with the matcher methods; `.not` flips every check to the
/// negative variant. The static `expect.any(Constructor)` /
/// `expect.anything()` helpers return marker values that `deepEqual`
/// treats as wildcards.
export const expect = Object.assign(
  (actual: unknown) => {
    const positive = buildExpect(actual, false);
    return Object.assign(positive, { not: buildExpect(actual, true) });
  },
  {
    // `expect.any(BigInt)` → marker that deepEqual matches against any bigint, etc.
    any(ctor: unknown) {
      return { [ANY_MARK]: ctor };
    },
    anything() {
      return { [ANY_MARK]: Object };
    },
  },
);
