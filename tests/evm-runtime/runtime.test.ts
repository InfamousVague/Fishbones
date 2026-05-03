/// EVM-runtime smoke suite. Loads every solidity/EVM lesson from the
/// installed course directory, runs it through `runEvm`, and asserts
/// the test set passes. Lets us validate course fixes without booting
/// the browser app.
///
/// Filter to a subset with `KATA_LESSON_FILTER`:
///   KATA_LESSON_FILTER=permit,merkle npm run -- test:evm
///
/// Or run a single lesson by full id:
///   KATA_LESSON_ID=ch04-...-permit npm run -- test:evm

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, expect } from "vitest";
import { runEvm } from "../../src/runtimes/evm";

interface Lesson {
  id: string;
  kind: string;
  title: string;
  language?: string;
  harness?: string;
  solution?: string;
  starter?: string;
  tests?: string;
  files?: Array<{ name: string; content: string }>;
}

interface Chapter { id: string; lessons: Lesson[]; }
interface Course { id?: string; title: string; chapters: Chapter[]; }

const COURSE_PATH = path.join(
  process.env.KATA_COURSES_DIR ??
    path.join(
      os.homedir(),
      "Library/Application Support/com.mattssoftware.kata/courses",
    ),
  process.env.KATA_COURSE ?? "mastering-ethereum",
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
  describe("evm-runtime smoke", () => {
    test.skip(`no course at ${COURSE_PATH}`, () => {});
  });
} else {
  const evmLessons = course.chapters.flatMap((c) =>
    c.lessons
      .filter(
        (l) =>
          (l.kind === "exercise" || l.kind === "mixed") &&
          (l.language === "solidity" || l.language === "vyper") &&
          l.harness === "evm",
      )
      .map((l) => ({ chapter: c.id, lesson: l })),
  );

  const filtered = evmLessons.filter(({ lesson }) => {
    if (SINGLE) return lesson.id === SINGLE;
    if (FILTER.length === 0) return true;
    return FILTER.some((f) => lesson.id.includes(f));
  });

  describe(`evm-runtime smoke (${filtered.length} lessons)`, () => {
    for (const { lesson } of filtered) {
      test(
        `${lesson.id}`,
        async () => {
          // Build the file list the runtime expects. Most lessons embed
          // the source under `solution`; some carry a `files` array.
          const files = lesson.files?.length
            ? lesson.files
            : [{ name: "Contract.sol", content: lesson.solution ?? "" }];

          const result = await runEvm(files, lesson.tests);

          if (result.error) {
            const compileLog = (result.logs ?? [])
              .filter((l) => l.level === "error")
              .map((l) => l.text)
              .join("\n");
            expect.fail(`runtime error: ${result.error}\n${compileLog}`);
          }

          const tests = result.tests ?? [];
          const failed = tests.filter((t) => !t.passed);
          if (failed.length > 0) {
            const detail = failed
              .map((t) => `  ✗ ${t.name}: ${t.error ?? "(no message)"}`)
              .join("\n");
            expect.fail(
              `${failed.length}/${tests.length} test(s) failed:\n${detail}`,
            );
          }

          if (tests.length === 0) {
            const logs = (result.logs ?? [])
              .map((l) => `[${l.level}] ${l.text}`)
              .join("\n");
            expect.fail(`no tests ran\n${logs}`);
          }
        },
        90_000,
      );
    }
  });
}
