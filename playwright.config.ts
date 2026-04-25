import { defineConfig, devices } from "@playwright/test";

/// Playwright config for the Fishbones challenge E2E suite.
///
/// The tests mock out the Tauri `invoke` bridge (see
/// `tests/e2e/mock-tauri.ts`) so we can run the full UI against the
/// plain Vite dev server — no `tauri dev`, no native window.
/// In-browser runtimes (JS/TS/Python via Pyodide) work natively; the
/// Rust + Go runtimes hit online sandboxes over real fetches so those
/// also exercise real code execution. Languages that require a
/// local toolchain shell-out (Swift, C/C++, Java, Kotlin, C#,
/// Assembly) live behind `test.skip` stubs in the spec until we wire
/// up the Tauri WebDriver adapter.
export default defineConfig({
  testDir: "./tests/e2e",
  // The spec is a single file with 1 500+ tests. `fullyParallel: true`
  // lets Playwright distribute ANY test across workers — otherwise the
  // default (tests-within-a-file run serially) would make workers > 1
  // pointless here. Tests are already isolated: each creates its own
  // page, each runInPage call uses mkdtempSync for per-run temp dirs,
  // and the Tauri/native bridges are per-page via addInitScript +
  // exposeFunction. So parallel execution is safe.
  fullyParallel: true,
  // Worker count: env var overrides playwright's --workers CLI flag
  // overrides this default. 4 is the sweet spot for 16 GB Apple
  // Silicon — each worker owns a Chromium (~200 MB) plus whichever
  // JVM / rustc / go toolchain that worker's current test spins up
  // (Kotlin / Java JVMs are the heaviest at ~500 MB-1 GB per compile).
  // Push to 6-8 on 32 GB+ machines; drop to 2 on 8 GB or older hosts.
  workers: process.env.FISHBONES_E2E_WORKERS
    ? parseInt(process.env.FISHBONES_E2E_WORKERS, 10)
    : 4,
  // Each challenge takes a few seconds (code compile + test run); the
  // Rust/Go online sandboxes can take 10s on a cold cache. 60s gives
  // plenty of headroom without hiding a genuinely hung test.
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://localhost:1420",
    // Headless by default so the standard `npm run test:e2e` is
    // CI-shaped and quick. `--headed` / `--ui` / `--debug` still work
    // on the CLI and override these defaults. When headed, slowMo
    // kicks in so the browser is actually watchable; headless runs
    // skip that since there's nothing to see.
    headless: true,
    launchOptions: {
      slowMo: process.env.FISHBONES_E2E_SLOW ? 150 : 0,
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Auto-start vite so a single command runs the whole suite. The
  // dev server is cheap enough to spin up per run; if a server is
  // already running on 1420, Playwright reuses it.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
