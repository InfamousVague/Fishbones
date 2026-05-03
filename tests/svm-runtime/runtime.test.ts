/// SVM-runtime smoke suite. Walks every Solana lesson with
/// `harness: "svm"` set in course.json, runs its `tests` block against
/// a fresh `buildSvm()` harness, and asserts the test set passes.
///
/// Filter to a subset with `KATA_LESSON_FILTER`:
///   KATA_LESSON_FILTER=transfer npm run test:svm
///
/// Or run a single lesson by full id:
///   KATA_LESSON_ID=ch02-... npm run test:svm

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, expect } from "vitest";
import { buildSvm, LAMPORTS_PER_SOL } from "../../src/runtimes/svm";
// Pre-imported because the AsyncFunction wrapper we run lesson code
// inside has no module-loader context — `await import(...)` from
// inside a `new AsyncFunction(...)` body fails with
// "dynamic import callback was not specified". Inject these as
// globals so lessons can use them without import statements.
import * as solanaKit from "@solana/kit";
import * as systemProgram from "@solana-program/system";

interface Lesson {
  id: string;
  kind: string;
  title: string;
  language?: string;
  harness?: string;
  solution?: string;
  tests?: string;
}

interface Chapter { id: string; lessons: Lesson[]; }
interface Course { id?: string; title: string; chapters: Chapter[]; }

const COURSE_PATH = path.join(
  process.env.KATA_COURSES_DIR ??
    path.join(
      os.homedir(),
      "Library/Application Support/com.mattssoftware.kata/courses",
    ),
  process.env.KATA_COURSE ?? "solana-programs",
  "course.json",
);

const FILTER = (process.env.KATA_LESSON_FILTER ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SINGLE = process.env.KATA_LESSON_ID;

function loadCourse(): Course | null {
  if (!fs.existsSync(COURSE_PATH)) return null;
  return JSON.parse(fs.readFileSync(COURSE_PATH, "utf8")) as Course;
}

const course = loadCourse();

if (!course) {
  describe("svm-runtime smoke", () => {
    test.skip(`no course at ${COURSE_PATH}`, () => {});
  });
} else {
  const svmLessons = course.chapters.flatMap((c) =>
    c.lessons
      .filter((l) => l.kind === "exercise" && l.harness === "svm")
      .map((l) => ({ chapter: c.id, lesson: l })),
  );

  const filtered = svmLessons.filter(({ lesson }) => {
    if (SINGLE) return lesson.id === SINGLE;
    if (FILTER.length === 0) return true;
    return FILTER.some((f) => lesson.id.includes(f));
  });

  describe(`svm-runtime smoke (${filtered.length} lessons)`, () => {
    if (filtered.length === 0) {
      test.skip("no harness:'svm' lessons yet — add one to validate", () => {});
    }

    for (const { lesson } of filtered) {
      test(
        lesson.id,
        async () => {
          // Each lesson gets its own SVM. Scoped state, no leakage.
          const svm = await buildSvm();

          // Mirror the EVM harness's test-collection model: tests
          // call `test('name', body)` to register, harness runs them
          // sequentially after the user code finishes evaluating.
          interface RegTest { name: string; body: () => Promise<void> | void }
          const collected: RegTest[] = [];
          const testFn = (name: string, body: () => Promise<void> | void) => {
            collected.push({ name, body });
          };

          // `expect` mirrors the EVM harness's flavor — toBe / toEqual /
          // toBeGreaterThan(OrEqual) / toThrow / .not chainer. Cribbed
          // verbatim from runtimes/evm.ts so the two languages share
          // assertion shape. Keep this in sync if you extend either.
          const buildExpect = (actual: unknown, negate: boolean) => {
            const fail = (m: string) => {
              throw new Error(negate ? `Expected NOT: ${m}` : m);
            };
            const check = (cond: boolean, m: string) => {
              if (negate ? cond : !cond) fail(m);
            };
            return {
              toBe(e: unknown) {
                check(Object.is(actual, e), `Expected ${stringify(actual)} to be ${stringify(e)}`);
              },
              toEqual(e: unknown) {
                check(JSON.stringify(actual, jsr) === JSON.stringify(e, jsr), `Expected ${stringify(actual)} to equal ${stringify(e)}`);
              },
              toBeDefined() { check(actual !== undefined, "Expected defined"); },
              toBeNull() { check(actual === null, "Expected null"); },
              toBeGreaterThan(n: number | bigint) {
                check((actual as bigint | number) > n, `Expected ${stringify(actual)} > ${stringify(n)}`);
              },
              toBeGreaterThanOrEqual(n: number | bigint) {
                check((actual as bigint | number) >= n, `Expected ${stringify(actual)} >= ${stringify(n)}`);
              },
              toBeLessThan(n: number | bigint) {
                check((actual as bigint | number) < n, `Expected ${stringify(actual)} < ${stringify(n)}`);
              },
              toBeLessThanOrEqual(n: number | bigint) {
                check((actual as bigint | number) <= n, `Expected ${stringify(actual)} <= ${stringify(n)}`);
              },
              toContain(sub: unknown) {
                const ok =
                  (typeof actual === "string" && typeof sub === "string" && actual.includes(sub)) ||
                  (Array.isArray(actual) && actual.some((x) => Object.is(x, sub) || JSON.stringify(x, jsr) === JSON.stringify(sub, jsr)));
                check(ok, `Expected ${stringify(actual)} to contain ${stringify(sub)}`);
              },
            };
          };
          const expectFn = (a: unknown) => {
            const pos = buildExpect(a, false);
            return Object.assign(pos, { not: buildExpect(a, true) });
          };

          // Compile the test code as an async function with our globals
          // injected. Same pattern as the EVM harness.
          const AsyncFunction = Object.getPrototypeOf(async function () {})
            .constructor;
          const fn = new AsyncFunction(
            "svm",
            "expect",
            "test",
            "LAMPORTS_PER_SOL",
            "console",
            "kit",
            "systemProgram",
            lesson.tests ?? "",
          );

          await fn(svm, expectFn, testFn, LAMPORTS_PER_SOL, console, solanaKit, systemProgram);

          // Run collected tests sequentially. Each gets a fresh SVM
          // would be ideal but is expensive — for now they share one.
          // Lessons that need isolation can airdrop fresh signers.
          const failures: { name: string; err: string }[] = [];
          for (const t of collected) {
            try {
              await t.body();
            } catch (e) {
              failures.push({ name: t.name, err: e instanceof Error ? e.message : String(e) });
            }
          }
          if (failures.length > 0) {
            const detail = failures
              .map((f) => `  ✗ ${f.name}: ${f.err}`)
              .join("\n");
            expect.fail(`${failures.length}/${collected.length} test(s) failed:\n${detail}`);
          }
          if (collected.length === 0) {
            expect.fail("no tests ran — does the lesson's `tests` block call `test('...', ...)`?");
          }
        },
        45_000,
      );
    }
  });
}

// ─── helpers ────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (typeof v === "string") return JSON.stringify(v);
  try { return JSON.stringify(v, jsr); } catch { return String(v); }
}
function jsr(_k: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString() + "n";
  if (v instanceof Uint8Array) {
    return "0x" + Array.from(v).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return v;
}
