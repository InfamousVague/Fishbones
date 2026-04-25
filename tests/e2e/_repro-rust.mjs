// Usage: node _repro-rust.mjs <lesson-id>
// Loads course.json, runs the lesson's solution against its tests via runFiles.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const COURSE_PATH =
  "/Users/matt/Library/Application Support/com.mattssoftware.kata/courses/challenges-rust-mo9bapm1/course.json";

const targetId = process.argv[2];
if (!targetId) {
  console.error("usage: node _repro-rust.mjs <lesson-id>");
  process.exit(2);
}

const doc = JSON.parse(readFileSync(COURSE_PATH, "utf8"));
let lesson = null;
for (const ch of doc.chapters) {
  for (const l of ch.lessons) {
    if (l.id === targetId) lesson = l;
  }
}
if (!lesson) {
  console.error("not found:", targetId);
  process.exit(2);
}

console.log(`[run] ${lesson.id} — ${lesson.title}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:1420");
await page.waitForLoadState("domcontentloaded");

const result = await page.evaluate(
  async ({ code, testCode }) => {
    const mod = await import("/src/runtimes/index.ts");
    const res = await mod.runFiles(
      "rust",
      [{ name: "user.rs", language: "rust", content: code }],
      testCode,
    );
    return res;
  },
  { code: lesson.solution, testCode: lesson.tests },
);

console.log(JSON.stringify(result, null, 2));

await browser.close();
