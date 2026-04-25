# Challenge-pack E2E suite

Walks every challenge pack on disk and, per exercise, asserts:

1. **Starter fails** — running starter code doesn't pass the tests.
2. **Solution passes** — revealing + running the reference solution does.

Book-style courses (`packType !== "challenges"`) are ignored.

## Running

```bash
# Watch tests live in Playwright's UI mode (recommended for the first run):
npm run test:e2e:ui

# Headless, full report:
npm run test:e2e

# One-at-a-time step debugger:
npm run test:e2e:debug
```

Vite is auto-started by Playwright (see `playwright.config.ts`). If a dev
server is already running on `localhost:1420`, the suite reuses it.

## Scoping the run

Full runs touch ~1540 exercises across all on-disk packs (~100 min wall-
clock). For a quick smoke test or live-watch demo, scope down:

```bash
# Only JavaScript + Python, 3 challenges per pack:
FISHBONES_E2E_LANGS=javascript,python \
FISHBONES_E2E_LIMIT=3 \
npm run test:e2e:ui

# Point at a different courses dir (for CI or a stash of fixtures):
FISHBONES_COURSES_DIR=/tmp/fake-courses \
npm run test:e2e
```

Available env vars:

| Var | Effect |
|---|---|
| `FISHBONES_E2E_LANGS` | Comma-sep list — only these languages run. Default: all. |
| `FISHBONES_E2E_LIMIT` | Max exercises per pack. Default: unlimited. |
| `FISHBONES_COURSES_DIR` | Override the courses dir. Default: `~/Library/Application Support/com.mattssoftware.kata/courses`. |

## Architecture

The suite runs against the plain Vite dev server (no `tauri dev`, no
native window). A thin invoke-mock (`helpers/tauri-mock.ts`) stubs the
Tauri `__TAURI_INTERNALS__.invoke` bridge and feeds the real on-disk
course data to the app. For each exercise, the test calls the app's real
`runFiles` function via `page.evaluate` + a dynamic import of
`/src/runtimes/index.ts`. That gives us:

- **JavaScript / TypeScript**: real Web Worker + sucrase transform.
- **Python**: real Pyodide in-browser.
- **Rust / Go**: real `fetch` to play.rust-lang.org / play.golang.org.

These five languages actually execute the starter + solution and compare
results to the expected pass/fail.

## Native-toolchain languages (skipped)

`swift`, `c`, `cpp`, `java`, `kotlin`, `csharp`, `assembly` shell out to
local toolchains via Tauri `invoke("run_c")` etc. Playwright-against-
Vite can't reach those commands, so each of those packs surfaces as one
`test.skip` marker with a clear reason. Three ways to unblock them:

1. **Wire `tauri-driver`** (the official Tauri WebDriver adapter) and
   point this suite at the real Tauri window instead of Vite. Each
   language then flips into `BROWSER_RUNNABLE_LANGUAGES` in
   `helpers/load-challenges.ts`.
2. **Build an HTTP sidecar** — a tiny Node/Express server that exposes
   the same `run_c` / `run_java` / etc. semantics by shelling out
   locally, then extend the invoke-mock to POST to it.
3. **Accept the scope gap**: content tests in `tests/content/` cover
   those separately and don't need UI driving.

## Failing tests

Each assertion message includes the pack title, chapter, lesson, tests
count, and runtime error — enough to reproduce the failure locally by
opening the same lesson in the app. The HTML report
(`playwright-report/index.html` after a run) shows screenshots + traces
of failing runs.
