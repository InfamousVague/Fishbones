/// Bridge from the browser-side Tauri invoke mock to Node-side shell-outs.
///
/// The mock in `tauri-mock.ts` runs in the PAGE context and has no
/// access to `child_process`. For the seven native-toolchain languages
/// (C / C++ / Java / Kotlin / C# / Assembly / Swift) we use
/// `page.exposeFunction` to install a callable that proxies
/// `invoke("run_c", { code })` into `runCLocally(code)` on the Node
/// side. Same SubprocessResult shape flows back over the wire, so the
/// frontend's `nativeRunners.ts` parses it the same way it would parse
/// a real Tauri response.
///
/// Install order matters: `installNativeBridge(page)` must run BEFORE
/// `page.addInitScript({ content: buildTauriInitScript(...) })` so the
/// bridge function is resolvable when the mock's first `invoke()`
/// fires. The spec's beforeEach calls them in that order.

import type { Page } from "@playwright/test";
import {
  runCLocally,
  runCppLocally,
  runJavaLocally,
  runKotlinLocally,
  runCSharpLocally,
  runAsmLocally,
  runSwiftLocally,
  ccInstalled,
  cppInstalled,
  javacInstalled,
  kotlincInstalled,
  dotnetInstalled,
  asmInstalled,
  swiftInstalled,
  type SubprocessResult,
} from "./local-run";

/// Commands the bridge knows how to handle. Everything else is
/// forwarded back as a "not bridged" launch error so the frontend
/// surfaces a clear message instead of a silent pass.
const BRIDGED_COMMANDS = new Set([
  "run_c",
  "run_cpp",
  "run_java",
  "run_kotlin",
  "run_csharp",
  "run_asm",
  "run_swift",
]);

/// Memoized toolchain availability per bridge session. Probing is
/// cheap but we still hit it 1 000+ times over a full sweep without
/// caching — the `spawnSync` timeout overhead adds up.
let cached: NativeToolchainStatus | null = null;

export interface NativeToolchainStatus {
  c: boolean;
  cpp: boolean;
  java: boolean;
  kotlin: boolean;
  csharp: boolean;
  assembly: boolean;
  swift: boolean;
}

export function nativeToolchainStatus(): NativeToolchainStatus {
  if (cached) return cached;
  cached = {
    c: ccInstalled(),
    cpp: cppInstalled(),
    java: javacInstalled(),
    kotlin: kotlincInstalled(),
    csharp: dotnetInstalled(),
    assembly: asmInstalled(),
    swift: swiftInstalled(),
  };
  return cached;
}

/// Dispatch one bridged command to its Node-side runner. The Tauri
/// `run_<lang>` commands all take `{ code: string }` and return
/// SubprocessResult; we honour that contract exactly.
function execNativeCommand(
  cmd: string,
  args: { code?: string } | undefined,
): SubprocessResult {
  const code = args?.code ?? "";
  switch (cmd) {
    case "run_c":
      return runCLocally(code);
    case "run_cpp":
      return runCppLocally(code);
    case "run_java":
      return runJavaLocally(code);
    case "run_kotlin":
      return runKotlinLocally(code);
    case "run_csharp":
      return runCSharpLocally(code);
    case "run_asm":
      return runAsmLocally(code);
    case "run_swift":
      return runSwiftLocally(code);
    default:
      // Shouldn't happen — the mock pre-filters to BRIDGED_COMMANDS —
      // but belt-and-suspenders is cheap when a mismatch would blow
      // up 1 500 tests in the same way.
      return {
        stdout: "",
        stderr: "",
        success: false,
        duration_ms: 0,
        launch_error: `[e2e bridge] unknown command: ${cmd}`,
      };
  }
}

/// Install the bridge on a Playwright page. Idempotent: `exposeFunction`
/// throws if called twice with the same name, so we guard with a
/// per-page flag.
const INSTALLED = new WeakSet<Page>();

export async function installNativeBridge(page: Page): Promise<void> {
  if (INSTALLED.has(page)) return;
  INSTALLED.add(page);

  // Name is deliberately ugly so it can't collide with any app global.
  await page.exposeFunction(
    "__fishbones_native_exec",
    (cmd: string, args: { code?: string } | undefined): SubprocessResult => {
      if (!BRIDGED_COMMANDS.has(cmd)) {
        return {
          stdout: "",
          stderr: "",
          success: false,
          duration_ms: 0,
          launch_error: `[e2e bridge] command "${cmd}" isn't bridged.`,
        };
      }
      return execNativeCommand(cmd, args);
    },
  );
}

export { BRIDGED_COMMANDS };
