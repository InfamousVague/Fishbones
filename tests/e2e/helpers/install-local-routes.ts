/// Playwright route interceptors that redirect the Rust + Go playground
/// POSTs to locally-installed toolchains. Called from the spec's
/// beforeEach so every test page gets the redirect before its first
/// `runFiles` call hits the network.
///
/// The app's runtimes are unchanged: `rust.ts` still does
/// `fetch("https://play.rust-lang.org/execute", ...)`; we just answer
/// from `rustc` + temp files instead of the real endpoint. Same for
/// `go.ts` and `go run`.

import type { Page } from "@playwright/test";
import {
  runRustLocally,
  runGoLocally,
  rustcInstalled,
  goInstalled,
} from "./local-run";

const RUST_URL = "https://play.rust-lang.org/execute";
const GO_URL = "https://play.golang.org/compile";

/// Memoize the once-per-run toolchain probe. `spawnSync("rustc",
/// ["--version"])` is fast but gets called from every test's beforeEach
/// — cache the result so the sweep doesn't re-shell out 1500 times.
let cachedRustc: boolean | null = null;
let cachedGo: boolean | null = null;

export function toolchainStatus(): { rustc: boolean; go: boolean } {
  if (cachedRustc === null) cachedRustc = rustcInstalled();
  if (cachedGo === null) cachedGo = goInstalled();
  return { rustc: cachedRustc, go: cachedGo };
}

export async function installLocalRoutes(page: Page): Promise<void> {
  const { rustc, go } = toolchainStatus();

  if (rustc) {
    await page.route(RUST_URL, async (route) => {
      try {
        const postData = route.request().postData() || "{}";
        const payload = JSON.parse(postData);
        const result = runRustLocally(payload);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
      } catch (err) {
        // Surface local-exec failures in the same shape rust.ts expects
        // so the runtime reports a clean error instead of throwing a
        // parse exception from a mangled response body.
        const msg = err instanceof Error ? err.message : String(err);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            stdout: "",
            stderr: `[e2e local-run] ${msg}`,
          }),
        });
      }
    });
  }

  if (go) {
    await page.route(GO_URL, async (route) => {
      try {
        const postData = route.request().postData() || "";
        const params = new URLSearchParams(postData);
        const body = params.get("body") || "";
        const result = runGoLocally({ body });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            Errors: `[e2e local-run] ${msg}`,
            Events: [],
            Status: 2,
          }),
        });
      }
    });
  }
}
