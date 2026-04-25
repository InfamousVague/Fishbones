/// Dynamic content tests. Walks every course's exercise lessons and
/// emits one vitest case per exercise that:
///   1. solution + tests should PASS
///   2. broken solution + tests should FAIL
///
/// Lessons whose language has no local toolchain installed get a
/// `.skip()` so the suite stays green on lean CI machines while still
/// exercising what it can.
///
/// Course discovery: by default scans the user's installed-courses
/// directory (`~/Library/Application Support/com.mattssoftware.kata/courses`).
/// Override with KATA_COURSES_DIR to point at a fixture set in CI.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, expect } from "vitest";
import { runForLanguage, breakSolution } from "./runners";

const COURSES_DIR =
  process.env.KATA_COURSES_DIR ??
  path.join(os.homedir(), "Library/Application Support/com.mattssoftware.kata/courses");

interface Lesson {
  id: string;
  kind: string;
  title: string;
  language?: string;
  solution?: string;
  tests?: string;
}

interface Chapter { id: string; lessons: Lesson[]; }
interface Course { id?: string; title: string; chapters: Chapter[]; }

function loadCourses(): Array<{ dir: string; course: Course }> {
  if (!fs.existsSync(COURSES_DIR)) return [];
  const out: Array<{ dir: string; course: Course }> = [];
  for (const d of fs.readdirSync(COURSES_DIR).sort()) {
    const p = path.join(COURSES_DIR, d, "course.json");
    if (!fs.existsSync(p)) continue;
    try {
      const course = JSON.parse(fs.readFileSync(p, "utf8")) as Course;
      out.push({ dir: d, course });
    } catch { /* skip malformed */ }
  }
  return out;
}

const ALL_COURSES = loadCourses();

if (ALL_COURSES.length === 0) {
  describe("content", () => {
    test.skip("no courses found at " + COURSES_DIR, () => { /* nothing to run */ });
  });
}

// Optional language filter — useful when iterating on one language at
// a time. Set KATA_LANG=go to run only Go exercises.
const LANG_FILTER = process.env.KATA_LANG || null;

// Skip the fail-path mutation tests by default — they roughly double
// the run time. Set KATA_FAIL_PATH=1 to enable.
const RUN_FAIL_PATH = !!process.env.KATA_FAIL_PATH;

for (const { dir, course } of ALL_COURSES) {
  describe(`course: ${dir}`, () => {
    for (const chapter of course.chapters) {
      for (const lesson of chapter.lessons) {
        if (lesson.kind !== "exercise") continue;
        if (!lesson.language || !lesson.solution) continue;
        // `tests` may legitimately be empty for run-only languages
        // (assembly, swift) — the runner falls back to "exit 0 = pass".
        if (LANG_FILTER && lesson.language !== LANG_FILTER) continue;

        const label = `[${lesson.language}] ${lesson.id}`;

        test(`${label} — solution passes`, async () => {
          const r = await runForLanguage(
            lesson.language!,
            lesson.solution!,
            lesson.tests!,
          );
          if (r.reason === "no-toolchain") {
            // Toolchain not on PATH — skip without failing the run.
            return;
          }
          expect.soft(r.ok, `failed: ${r.reason}\n${r.detail ?? ""}`).toBe(true);
        }, 60_000);

        if (RUN_FAIL_PATH) {
          test(`${label} — broken solution fails`, async () => {
            const r = await runForLanguage(
              lesson.language!,
              breakSolution(lesson.language!, lesson.solution!),
              lesson.tests!,
            );
            if (r.reason === "no-toolchain") return;
            // We expect EITHER compile-error OR test-failure — both
            // count as "the suite caught the bug."
            expect.soft(r.ok, `broken solution unexpectedly passed`).toBe(false);
          }, 60_000);
        }
      }
    }
  });
}
