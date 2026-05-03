/// Vitest config for the SVM-runtime smoke suite. Same pattern as
/// tests/evm-runtime/: builds a real runtime per test, runs the
/// lesson's harness:"svm" tests against it, asserts they pass.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/svm-runtime/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Single-threaded — litesvm is a global Rust handle and tests
    // mutate shared state. Mirrors the EVM smoke runner.
    poolOptions: { threads: { maxThreads: 1, minThreads: 1 } },
  },
});
