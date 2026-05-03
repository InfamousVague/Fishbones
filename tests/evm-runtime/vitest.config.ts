/// Vitest config for the EVM-runtime smoke suite. Runs `runEvm` on
/// real lessons end-to-end so we can validate harness fixes without
/// booting the browser app. Mocks `loadSolc` to use the npm `solc`
/// package (Node-side) since the in-app loader needs `document`.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/evm-runtime/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // One thread — chain singleton + nonce cache are global state.
    poolOptions: { threads: { maxThreads: 1, minThreads: 1 } },
    setupFiles: ["./tests/evm-runtime/setup.ts"],
  },
});
