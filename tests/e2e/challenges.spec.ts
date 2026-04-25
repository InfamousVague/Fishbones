/// Challenge-pack E2E suite.
///
/// Walks EVERY challenge pack on disk (ignores book courses, per the
/// user's ask), and for each exercise asserts:
///
///   1. Running the STARTER code fails (or at least doesn't pass).
///   2. Running the SOLUTION code passes.
///
/// We drive the runtime directly via `page.evaluate` + dynamic import
/// of `/src/runtimes/index.ts`, instead of clicking through the
/// sidebar + editor + run button for each lesson. Both paths exercise
/// the SAME runtime code (Web Worker for JS/TS, Pyodide for Python,
/// online sandbox fetches for Rust/Go) — the shortcut just skips the
/// UI theatre so 1 540 challenges finish in minutes rather than hours.
/// Running with `npx playwright test --ui` still gives you the live
/// test-list ticker for watching.
///
/// Native-toolchain languages (Swift, C, C++, Java, Kotlin, C#,
/// Assembly) need Tauri's `run_*` invoke commands, which don't work
/// against plain Vite. Those get marked `test.skip(true, …)` with a
/// clearly-labelled reason so they show up in the listing rather than
/// silently disappearing.

import { test, expect } from "@playwright/test";
import {
  loadChallengePacks,
  filterLanguages,
  listExercises,
  BROWSER_RUNNABLE_LANGUAGES,
  NATIVE_TOOLCHAIN_LANGUAGES,
  type Course,
  type Lesson,
  type WorkbenchFile,
} from "./helpers/load-challenges";
import { buildTauriInitScript } from "./helpers/tauri-mock";
import { installLocalRoutes, toolchainStatus } from "./helpers/install-local-routes";
import {
  installNativeBridge,
  nativeToolchainStatus,
} from "./helpers/native-bridge";

// Load once at module-import time so Playwright's test-list UI shows
// every pack + lesson before the run starts.
const allPacks = filterLanguages(loadChallengePacks());

// Note: we intentionally do NOT use `test.describe.configure({ mode:
// "serial" })` here. Serial mode at file scope treats EVERY test as
// one group, so a single failure skips the rest of the 1 500+ tests
// — the opposite of what we want for a "validate every challenge"
// sweep. We rely on `workers: 1` + `fullyParallel: false` in
// playwright.config.ts for sequential execution without fail-fast
// semantics.

// The Tauri mock is only used when a test navigates to "/"; we don't
// need it for the headless `runFiles` calls, but installing it
// unconditionally keeps the app happy if any module-load side effect
// ends up touching `invoke()`.
test.beforeEach(async ({ page }) => {
  // Bridge install goes FIRST — tauri-mock's addInitScript runs before
  // any app code, and the moment the app fires `invoke("run_c", ...)`
  // the mock reaches for `window.__fishbones_native_exec` which must
  // already be exposed by that point.
  await installNativeBridge(page);
  await page.addInitScript({ content: buildTauriInitScript(allPacks) });
  // Intercept play.rust-lang.org + play.golang.org and run locally via
  // the user's installed rustc/go. Free of rate limits + network
  // latency; adds only the rustc compile time (~300ms/run cold).
  // Falls through to real playground fetches when a toolchain isn't
  // installed (see install-local-routes.ts).
  await installLocalRoutes(page);
});

// One-time banner so the reporter shows which toolchains we're using.
test.beforeAll(() => {
  const { rustc, go } = toolchainStatus();
  const native = nativeToolchainStatus();
  // eslint-disable-next-line no-console
  console.log(
    `[e2e] rustc=${rustc ? "local" : "remote"} · ` +
      `go=${go ? "local" : "remote"} · ` +
      `c=${native.c ? "local" : "skip"} · ` +
      `cpp=${native.cpp ? "local" : "skip"} · ` +
      `java=${native.java ? "local" : "skip"} · ` +
      `kotlin=${native.kotlin ? "local" : "skip"} · ` +
      `csharp=${native.csharp ? "local" : "skip"} · ` +
      `assembly=${native.assembly ? "local" : "skip"} · ` +
      `swift=${native.swift ? "local" : "skip"}`,
  );
});

/// Build the starter file array the way the app does in
/// `deriveStarterFiles` — multi-file when `files` is populated,
/// single-file fallback otherwise.
function starterFiles(lesson: Lesson): WorkbenchFile[] {
  if (lesson.files && lesson.files.length > 0) {
    return lesson.files.map((f) => ({ ...f }));
  }
  if (!lesson.starter) return [];
  return [
    {
      name: filenameFor(lesson.language ?? "plaintext"),
      language: monacoLanguageFor(lesson.language ?? "plaintext"),
      content: lesson.starter,
    },
  ];
}

function solutionFiles(lesson: Lesson): WorkbenchFile[] {
  if (lesson.solutionFiles && lesson.solutionFiles.length > 0) {
    return lesson.solutionFiles.map((f) => ({ ...f }));
  }
  if (!lesson.solution) return [];
  return [
    {
      name: filenameFor(lesson.language ?? "plaintext"),
      language: monacoLanguageFor(lesson.language ?? "plaintext"),
      content: lesson.solution,
    },
  ];
}

function filenameFor(lang: string): string {
  switch (lang) {
    case "javascript": return "user.js";
    case "typescript": return "user.ts";
    case "python": return "user.py";
    case "rust": return "user.rs";
    case "go": return "main.go";
    case "swift": return "user.swift";
    case "c": return "main.c";
    case "cpp": return "main.cpp";
    case "java": return "Main.java";
    case "kotlin": return "Main.kt";
    case "csharp": return "Program.cs";
    case "assembly": return "main.s";
    default: return "user.txt";
  }
}

function monacoLanguageFor(lang: string): string {
  // The runtime dispatcher only needs the primary lang match; these
  // strings just need to be valid Monaco ids so the file passes
  // `assembleRunnable`'s language filter.
  if (lang === "reactnative") return "javascript";
  return lang;
}

/// Dispatch a single run through the app's real `runFiles` entry point.
/// Imports the module fresh each call so browser caching across runs
/// doesn't capture stale closures (it won't — the module is idempotent
/// — but defensive reset is cheap and this keeps the mental model
/// simple).
async function runInPage(
  page: import("@playwright/test").Page,
  args: {
    language: string;
    files: WorkbenchFile[];
    tests: string | undefined;
  },
): Promise<{ passing: boolean; error: string | null; testCount: number }> {
  return await page.evaluate(async (payload) => {
    const mod = await import("/src/runtimes/index.ts");
    const result = await mod.runFiles(
      payload.language as never,
      payload.files as never,
      payload.tests,
    );
    return {
      passing: mod.isPassing(result),
      error: result.error ?? null,
      testCount: result.tests?.length ?? 0,
    };
  }, args);
}

// --------------------------------------------------------------------
// The actual tests. Generated once per (pack, chapter, lesson) tuple.
// --------------------------------------------------------------------

/// Native-toolchain languages are "runnable" when the corresponding
/// binary is installed on the host — the native-bridge forwards
/// `invoke("run_c", ...)` to `cc` / `javac` / etc. We probe once here
/// at module load; each language that answers yes becomes a first-
/// class test describe block. Languages whose toolchain isn't
/// installed still render as a skipped describe so the coverage gap
/// stays visible.
const nativeInstalled = nativeToolchainStatus();
const LOCAL_NATIVE_RUNNABLE: Record<string, boolean> = {
  c: nativeInstalled.c,
  cpp: nativeInstalled.cpp,
  java: nativeInstalled.java,
  kotlin: nativeInstalled.kotlin,
  csharp: nativeInstalled.csharp,
  assembly: nativeInstalled.assembly,
  swift: nativeInstalled.swift,
};

for (const pack of allPacks) {
  const lang = pack.language;
  const native = NATIVE_TOOLCHAIN_LANGUAGES.has(lang);
  const browserRunnable = BROWSER_RUNNABLE_LANGUAGES.has(lang);
  const nativeRunnable = native && LOCAL_NATIVE_RUNNABLE[lang] === true;
  const runnable = browserRunnable || nativeRunnable;
  const exercises = listExercises(pack);

  test.describe(`${pack.title} (${lang}, ${exercises.length} exercises)`, () => {
    if (native && !nativeRunnable) {
      // Tauri-backend language whose toolchain isn't installed on
      // THIS machine. Render a single skip marker so the pack still
      // appears in the reporter — install the toolchain and rerun.
      test(`skipped — ${lang} toolchain not installed (${exercises.length} challenges)`, async () => {
        test.skip(
          true,
          `${lang} challenges shell out to the local toolchain via the ` +
            `Playwright native-bridge. Install the compiler (see the ` +
            `Missing Toolchain banner in the app for the exact command) ` +
            `and rerun — no code change needed.`,
        );
      });
      return;
    }

    if (!runnable) {
      test(`skipped — ${lang} is not in BROWSER_RUNNABLE_LANGUAGES`, async () => {
        test.skip(true, `Add to BROWSER_RUNNABLE_LANGUAGES in load-challenges.ts to enable.`);
      });
      return;
    }

    // Shared page per pack. We navigate once to load the app, then
    // each test re-uses the same page for its runtime calls.
    // Pyodide (~30 MB) caches across lessons after the first.
    test.beforeAll(async ({ browser }) => {
      void browser; // silence unused — beforeAll just needs to fire
    });

    for (const { chapter, lesson } of exercises) {
      const label = `${chapter.title} / ${lesson.title}`;
      const starter = starterFiles(lesson);
      const solution = solutionFiles(lesson);
      const tests = lesson.tests;
      const diff = lesson.difficulty ? ` [${lesson.difficulty}]` : "";
      // Lesson id guarantees a unique test title even when an LLM-
      // generated pack lands two exercises with identical titles
      // within the same chapter (Playwright requires unique titles
      // per describe block and errors out hard otherwise).
      const uniqueTitle = `${label}${diff} · ${lesson.id}`;

      test(uniqueTitle, async ({ page }) => {
        // Navigate lazily — a fresh page per test avoids Pyodide /
        // Monaco state leaking between challenges.
        await page.goto("/");

        if (starter.length === 0) {
          test.skip(true, "no starter — can't assert fail-as-expected");
          return;
        }
        if (solution.length === 0) {
          test.skip(true, "no solution — can't assert pass-as-expected");
          return;
        }
        if (tests === undefined || tests.trim() === "") {
          test.skip(
            true,
            "run-only challenge (empty tests) — fail-as-expected isn't meaningful",
          );
          return;
        }

        const starterRun = await runInPage(page, {
          language: lesson.language ?? pack.language,
          files: starter,
          tests,
        });
        // Starter should not pass. It's allowed to "error" (e.g.
        // `todo!()` panicking in Rust) or to fail tests — both count
        // as "not passing".
        expect(
          starterRun.passing,
          `starter reported passing for "${label}" — expected fail. ` +
            `(tests=${starterRun.testCount}, error=${starterRun.error ?? "none"})`,
        ).toBe(false);

        const solutionRun = await runInPage(page, {
          language: lesson.language ?? pack.language,
          files: solution,
          tests,
        });
        expect(
          solutionRun.passing,
          `solution reported NOT passing for "${label}". ` +
            `(tests=${solutionRun.testCount}, error=${solutionRun.error ?? "none"})`,
        ).toBe(true);
      });
    }
  });
}
