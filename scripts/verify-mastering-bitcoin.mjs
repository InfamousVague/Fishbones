#!/usr/bin/env node
/// Verify every chain-aware lesson in mastering-bitcoin/course.json
/// by running its solution + tests against a fresh chain shell.
///
/// We bypass the full `runBitcoin` runtime dispatcher (its imports
/// chain through extension-less paths that Node's strip-types
/// loader can't resolve without a tsconfig moduleResolution shim);
/// instead we call `buildBitcoinChain()` directly and replicate the
/// same `chain` / `btc` / `expect` / `test` globals the harness
/// would expose at lesson run-time.
///
/// Exits 0 when every chain-aware lesson's solution passes its
/// hidden tests, 1 with detail otherwise.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as btc from "@scure/btc-signer";
import { buildBitcoinChain } from "../src/runtimes/bitcoin/buildChain.ts";

const COURSE = join(
  homedir(),
  "Library/Application Support/com.mattssoftware.kata"
    + "/courses/mastering-bitcoin/course.json",
);

// ── Minimal expect() that mirrors the few matchers the lessons use.
// Mirrors `src/runtimes/evm/expect.ts` at the surface level.
function makeExpect() {
  const expect = (actual) => ({
    toBe(expected) {
      if (actual !== expected && !(Number.isNaN(actual) && Number.isNaN(expected))) {
        throw new Error(`Expected ${stringify(actual)} to be ${stringify(expected)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual, replacer) !== JSON.stringify(expected, replacer)) {
        throw new Error(
          `Expected ${stringify(actual)} to equal ${stringify(expected)}`,
        );
      }
    },
    toBeGreaterThanOrEqual(expected) {
      if (!(actual >= expected)) {
        throw new Error(`Expected ${stringify(actual)} to be >= ${stringify(expected)}`);
      }
    },
    toBeLessThanOrEqual(expected) {
      if (!(actual <= expected)) {
        throw new Error(`Expected ${stringify(actual)} to be <= ${stringify(expected)}`);
      }
    },
    toBeGreaterThan(expected) {
      if (!(actual > expected)) {
        throw new Error(`Expected ${stringify(actual)} to be > ${stringify(expected)}`);
      }
    },
    not: {
      toBe(expected) {
        if (actual === expected) {
          throw new Error(`Expected ${stringify(actual)} not to be ${stringify(expected)}`);
        }
      },
    },
  });
  return expect;
}

function stringify(v) {
  if (typeof v === "bigint") return `${v}n`;
  try {
    return JSON.stringify(v, replacer);
  } catch {
    return String(v);
  }
}
function replacer(_key, value) {
  return typeof value === "bigint" ? value.toString() + "n" : value;
}

async function runLessonTests(solution, testCode) {
  const chain = buildBitcoinChain();
  const expect = makeExpect();
  const tests = [];

  let prev = Promise.resolve();
  const wrappedBody = (body) => async () => {
    const snapId = chain.snapshot();
    try {
      await body();
    } finally {
      try {
        chain.revert(snapId);
      } catch {
        /* swallow */
      }
    }
  };
  const test = (name, body) => {
    const wrapped = wrappedBody(body);
    prev = prev.then(
      async () => {
        try {
          await wrapped();
          tests.push({ name, passed: true });
        } catch (e) {
          tests.push({
            name,
            passed: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
      async () => {
        try {
          await wrapped();
          tests.push({ name, passed: true });
        } catch (e) {
          tests.push({
            name,
            passed: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    );
  };

  const consoleProxy = {
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(
    "chain",
    "btc",
    "expect",
    "test",
    "console",
    `${solution}\n\n${testCode}`,
  );
  let runError = null;
  try {
    await fn(chain, btc, expect, test, consoleProxy);
    await prev;
  } catch (e) {
    runError = e instanceof Error ? e.message : String(e);
  }
  return { tests, runError };
}

const course = JSON.parse(readFileSync(COURSE, "utf8"));

let total = 0;
let passed = 0;
const failures = [];

for (const ch of course.chapters) {
  for (const l of ch.lessons) {
    if (l.harness !== "bitcoin") continue;
    if (l.kind !== "exercise" && l.kind !== "mixed") continue;
    total++;
    const { tests, runError } = await runLessonTests(
      l.solution ?? "",
      l.tests ?? "",
    );
    const failedTests = tests.filter((t) => !t.passed);
    if (runError || failedTests.length > 0) {
      failures.push({ chapter: ch.id, lesson: l.id, runError, failedTests });
      console.log(`✗ [${ch.id}] ${l.id}`);
      if (runError) console.log(`    runtime error: ${runError}`);
      for (const t of failedTests) {
        console.log(`    ✗ ${t.name}\n      ${t.error}`);
      }
    } else {
      passed++;
      console.log(`✓ [${ch.id}] ${l.id} (${tests.length} tests)`);
    }
  }
}

console.log();
console.log(`${passed}/${total} chain-aware lessons passing`);
if (failures.length) {
  process.exit(1);
}
