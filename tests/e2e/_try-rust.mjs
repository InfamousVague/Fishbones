// Try an arbitrary Rust solution + tests pair. Args: solution file, tests file (both from /tmp).
import { chromium } from "playwright";
import { readFileSync } from "fs";

const solPath = process.argv[2];
const testsPath = process.argv[3];
if (!solPath || !testsPath) {
  console.error("usage: node _try-rust.mjs <solution.rs> <tests.rs>");
  process.exit(2);
}
const solution = readFileSync(solPath, "utf8");
const tests = readFileSync(testsPath, "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:1420");
await page.waitForLoadState("domcontentloaded");

const result = await page.evaluate(async ({ code, testCode }) => {
  const mod = await import("/src/runtimes/index.ts");
  return await mod.runFiles(
    "rust",
    [{ name: "user.rs", language: "rust", content: code }],
    testCode,
  );
}, { code: solution, testCode: tests });

console.log(JSON.stringify(result, null, 2));
await browser.close();
