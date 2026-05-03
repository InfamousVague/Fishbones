/// Test setup: replace the browser-only Solidity loader with a thin
/// shim around the `solc` npm package. The in-app `loadSolc()` injects
/// a <script> tag and reads `globalThis.Module` — neither works in
/// Node. The replacement keeps the same `(input: string) => string`
/// shape `runEvm` expects so the harness can run unchanged.

import { vi } from "vitest";

vi.mock("../../src/runtimes/solidity", async () => {
  // Lazy require so vitest doesn't try to resolve `solc` at module-load
  // time (it's a CJS package; ESM ↔ CJS interop is finicky inside
  // hoisted vi.mock factories).
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const solc = require("solc");

  return {
    loadSolc: async () => (input: string): string => solc.compile(input),
    buildSolcInput: (files: Array<{ name: string; content?: string }>) => {
      const sources: Record<string, { content: string }> = {};
      for (const f of files) {
        if (/\.sol$/i.test(f.name)) {
          sources[f.name] = { content: f.content ?? "" };
        }
      }
      if (Object.keys(sources).length === 0) {
        sources["Contract.sol"] = { content: files[0]?.content ?? "" };
      }
      return JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          outputSelection: {
            "*": {
              "*": [
                "abi",
                "evm.bytecode.object",
                "evm.deployedBytecode.object",
                "evm.gasEstimates",
              ],
            },
          },
          optimizer: { enabled: false, runs: 200 },
          evmVersion: "cancun",
        },
      });
    },
  };
});

// `evmChainService` is browser-only (it uses Tauri/window). The
// runtime already has a try/catch fallback to ephemeral chain when
// the import fails, so just stub it to throw and let the fallback
// path take over.
vi.mock("../../src/lib/evmChainService", () => {
  return {
    getOrCreateChain: async () => {
      throw new Error("Node smoke test — singleton not used");
    },
  };
});
