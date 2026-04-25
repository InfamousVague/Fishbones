import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:1420");
await page.waitForLoadState("domcontentloaded");

const SOLUTION = `function deepFreeze<T>(obj: T, seen: WeakSet<object> = new WeakSet()): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (seen.has(obj)) {
    return obj;
  }
  seen.add(obj);
  const propNames = Object.getOwnPropertyNames(obj) as (keyof T)[];
  for (const name of propNames) {
    const value = obj[name];
    if (value !== null && typeof value === 'object') {
      deepFreeze(value, seen);
    }
  }
  return Object.freeze(obj);
}
module.exports = { deepFreeze };
`;

const TESTS = `const { deepFreeze } = require('./user');

test('freezes top-level properties', () => {
  const obj = { a: 1, b: 2 };
  const frozen = deepFreeze(obj);
  frozen.a = 999;
  expect(frozen.a).toBe(1);
  expect(Object.isFrozen(frozen)).toBe(true);
});

test('handles null and primitives gracefully', () => {
  expect(deepFreeze(null)).toBe(null);
  expect(deepFreeze(42)).toBe(42);
  expect(deepFreeze('hello')).toBe('hello');
});`;

const result = await page.evaluate(async ({ code, testCode }) => {
  const mod = await import("/src/runtimes/index.ts");
  const res = await mod.runFiles(
    "typescript",
    [{ name: "user.ts", language: "typescript", content: code }],
    testCode,
  );
  return res;
}, { code: SOLUTION, testCode: TESTS });

console.log(JSON.stringify(result, null, 2));

await browser.close();
