/// Separate vitest config for the content suite. Runs in node (not
/// jsdom — these tests shell out to compilers) and doesn't load the
/// app's React setup file. Kept distinct from the main vite.config.ts
/// `test` block so `npm test` and `npm run test:content` can target
/// different worlds without conflict.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/content/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Concurrency: spawning compilers per test gets I/O-heavy fast.
    // Cap at 4 so a 500-exercise course doesn't fork-bomb the laptop.
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
  },
});
