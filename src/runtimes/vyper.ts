import type { WorkbenchFile } from "../data/types";
import type { RunResult, LogLine } from "./types";

/// Vyper runtime — three implementation strategies, in order of
/// preference. The exported `runVyper` tries them in order and falls
/// back when one isn't available on the current platform.
///
/// ## Strategy A — Pyodide + micropip (browser + desktop, preferred)
///
/// We already ship Pyodide for the Python lessons. Vyper 0.4.x is
/// pure-Python (no C extensions on the hot path), so:
///
///   import micropip
///   await micropip.install("vyper==0.4.0")
///   from vyper import compile_code
///   bytecode = compile_code(source, ["bytecode"])
///   abi = compile_code(source, ["abi"])
///
/// Wrap the result in the same shape solc returns
/// (`{contracts: {[file]: {[name]: {abi, evm: {bytecode: {object}}}}}}`)
/// so the EVM runtime in `evm.ts` consumes Vyper output **without
/// modification** — that's the single design choice that makes
/// "expand Vyper" tractable.
///
/// First-run cost: one-time micropip install (~5 MB Vyper wheel +
/// transitive deps). Subsequent runs are instant; we cache the
/// `compile_code` callable in module-level state like solidity.ts
/// caches `solidity_compile`.
///
/// ## Strategy B — Tauri sidecar `vyper` binary (desktop fallback)
///
/// If micropip refuses to install (network, wheel rebuild needed,
/// etc.), shell out to a vendored `vyper` binary in
/// `src-tauri/resources/bin/vyper-<platform>`. Same shape conversion.
/// Adds ~30 MB to the desktop installer; only included if Strategy A
/// proves unreliable.
///
/// ## Strategy C — Remote compile service (last resort)
///
/// POST to a `/compile/vyper` endpoint on api.mattssoftware.com.
/// Real backend; rate-limited; only used when both A and B fail. Not
/// implemented in the POC — flagged for the design discussion.
///
/// ---
///
/// This file is the POC sketch. Wiring (Pyodide bootstrap, error
/// surfacing, test harness re-use from `evm.ts`) is straightforward
/// once we accept the "Vyper output → solc-shaped object → EVM
/// runtime" pipeline.

import { runEvm } from "./evm";

/// Lazy Pyodide handle. We reuse the same Pyodide worker the Python
/// runtime spins up rather than booting a second one — see
/// `python.ts` for the singleton pattern. POC stub: real impl reaches
/// into the existing `getPyodide()` helper.
async function compileVyper(_files: WorkbenchFile[]): Promise<{
  contracts: Record<
    string,
    Record<string, { abi: unknown[]; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>
  >;
  errors?: Array<{ severity: "error" | "warning"; message: string; formattedMessage?: string }>;
}> {
  // POC: the actual Pyodide call goes here. Pseudocode:
  //
  //   const py = await getPyodide();
  //   await py.runPythonAsync(`
  //     import micropip
  //     await micropip.install("vyper==0.4.0")
  //     from vyper import compile_code
  //   `);
  //   const out = py.runPython(`
  //     compile_code(${JSON.stringify(source)}, ['bytecode', 'bytecode_runtime', 'abi'])
  //   `);
  //
  // Then map `out` into the solc-shaped object below.
  throw new Error(
    "Vyper compile not yet wired — see docs/evm-solana-runtime-design.md for the Pyodide bootstrap path.",
  );
}

export async function runVyper(
  files: WorkbenchFile[],
  testCode?: string,
  opts?: { harness?: "evm" | "solana" },
): Promise<RunResult> {
  const started = Date.now();
  const logs: LogLine[] = [];

  let compiled;
  try {
    compiled = await compileVyper(files);
  } catch (e) {
    return {
      logs: [
        {
          level: "error",
          text: `Vyper compile failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      error: "Vyper compile failed",
      durationMs: Date.now() - started,
    };
  }

  // Path A: harness === "evm" — hand the compiled artifacts off to
  // the EVM runtime, which deploys + calls them through @ethereumjs/vm.
  // Path B: no harness — same "compile and inspect" behaviour as the
  // legacy solidity runtime, useful for early Vyper lessons that
  // teach syntax before contract semantics.
  if (opts?.harness === "evm" && testCode) {
    // The EVM runtime expects `WorkbenchFile[]` so it can re-compile
    // via solc. Since we've already compiled with Vyper, we'd need a
    // small variant entry point that accepts a pre-compiled artifact
    // bundle directly. POC simplification: pass the compiled object
    // through a side channel. Real impl: refactor `runEvm` to take an
    // optional `precompiled` parameter so this re-routes cleanly.
    return runEvm(files, testCode);
  }

  logs.push({
    level: "log",
    text: `✓ Compiled ${
      Object.values(compiled.contracts).reduce(
        (n, m) => n + Object.keys(m).length,
        0,
      )
    } Vyper contract(s).`,
  });
  return { logs, durationMs: Date.now() - started };
}
