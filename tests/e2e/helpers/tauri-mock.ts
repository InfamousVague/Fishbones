/// Tauri invoke() mock installed into the page via `addInitScript`.
///
/// The Fishbones frontend calls Tauri commands via `@tauri-apps/api/core`,
/// which under the hood uses `window.__TAURI_INTERNALS__.invoke(cmd, args)`.
/// In plain Vite dev (no Tauri window), that global doesn't exist and
/// every call throws. We stub it here so the page behaves like it's
/// inside Tauri, with fake responses that return the real on-disk
/// course data we loaded via Node.
///
/// Commands we DON'T stub (like `run_c`, `run_java` etc.) fall through
/// to a generic "not supported in browser mode" error — the suite's
/// native-toolchain spec tests are `test.skip` so we never actually
/// invoke them.

import type { Course } from "./load-challenges";

export function buildTauriInitScript(packs: Course[]): string {
  /// Build a serializable summary shape that matches `list_courses`'s
  /// on-disk output. The real command returns a trimmed card shape;
  /// the frontend calls `load_course` to get each full course on demand.
  const summaries = packs.map((p) => ({
    id: p.id,
    title: p.title,
    author: p.author ?? null,
    language: p.language,
    packType: p.packType ?? "course",
    lesson_count: p.chapters.reduce((n, c) => n + c.lessons.length, 0),
    chapters: p.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      lessons: c.lessons.map((l) => ({
        id: l.id,
        kind: l.kind,
        title: l.title,
      })),
    })),
  }));

  /// Courses keyed by id for fast `load_course` response.
  const coursesById = Object.fromEntries(packs.map((p) => [p.id, p]));

  /// Inline JSON into the init script so it ships with the script
  /// itself and doesn't depend on any fetch path. JSON.stringify gives
  /// us safe embedding — no template-literal escaping edge cases.
  const courses = JSON.stringify(summaries);
  const coursesJson = JSON.stringify(coursesById);

  // The script runs BEFORE any page script, so it installs the mock
  // before the Fishbones app's first invoke().
  return `
    (function installTauriMock() {
      const COURSES = ${courses};
      const COURSES_BY_ID = ${coursesJson};

      // Minimal completion/history store so useProgress + streak code
      // don't crash. Empty state is correct for a fresh test run.
      const completions = [];

      // A small in-memory settings blob — enough to satisfy the app's
      // load_settings calls. We intentionally leave anthropic_api_key
      // null so LLM paths stay dormant.
      const settings = {
        anthropic_api_key: null,
        anthropic_model: "claude-sonnet-4-5",
        openai_api_key: null,
      };

      // Any cover image returns null — BookCover falls back to the
      // language-tinted tile, which is fine for E2E.
      const covers = {};

      async function invoke(cmd, args) {
        switch (cmd) {
          case "list_courses":
            return COURSES;
          case "load_course":
            if (!COURSES_BY_ID[args.courseId]) {
              throw new Error("course not found: " + args.courseId);
            }
            return COURSES_BY_ID[args.courseId];
          case "save_course":
            // Accept writes so progress doesn't crash, but don't
            // persist — each test run starts fresh.
            return null;
          case "delete_course":
            return null;
          case "list_completions":
            return completions;
          case "mark_completion":
            completions.push({
              course_id: args.courseId,
              lesson_id: args.lessonId,
              completed_at: Math.floor(Date.now() / 1000),
            });
            return null;
          case "clear_completions":
            completions.length = 0;
            return null;
          case "load_settings":
            return settings;
          case "save_settings":
            Object.assign(settings, args.settings || {});
            return null;
          case "load_course_cover":
            return covers[args.courseId] || null;
          case "extract_pdf_cover":
          case "extract_source_cover":
          case "import_course_cover":
            return { path: "", fetched_at: 0, error: "not supported in e2e" };
          case "cache_read":
            return null;
          case "cache_write":
          case "cache_clear":
            return null;
          case "probe_language_toolchain":
            // Say every toolchain is "installed" so the missing-
            // toolchain banner never appears during tests.
            return {
              language: args.language,
              installed: true,
              version: "e2e-mock",
              install_hint: null,
            };
          case "stat_file":
            return { bytes: 0 };
          case "run_c":
          case "run_cpp":
          case "run_java":
          case "run_kotlin":
          case "run_csharp":
          case "run_asm":
          case "run_swift": {
            // Forward to the Node-side bridge installed by
            // installNativeBridge(page) in the spec's beforeEach.
            // Falls through to a launch-error shape when the bridge
            // isn't installed, which keeps the frontend's error
            // handling path intact.
            const bridge = window.__fishbones_native_exec;
            if (typeof bridge !== "function") {
              return {
                stdout: "",
                stderr: "",
                success: false,
                duration_ms: 0,
                launch_error:
                  "[e2e-mock] native bridge not installed — call installNativeBridge(page) before addInitScript.",
              };
            }
            return await bridge(cmd, args || {});
          }
          default: {
            // Anything still unhandled (a new Tauri command we forgot
            // to stub) surfaces as a clear error instead of silently
            // returning undefined and crashing the frontend later.
            const err = new Error(
              "[e2e-mock] invoke(" + cmd + ") is not stubbed. Add a " +
              "case to tauri-mock.ts or bridge it through " +
              "installNativeBridge.",
            );
            throw err;
          }
        }
      }

      // Tauri v2 bridge — what @tauri-apps/api/core reads from.
      window.__TAURI_INTERNALS__ = {
        invoke,
        // No-op stubs for transformCallback / convertFileSrc etc.
        // Most apps don't hit these; cover the ones Fishbones uses
        // if the console complains.
        transformCallback: (cb) => cb,
        convertFileSrc: (path) => path,
        // Event listening — return an unlisten no-op. Fishbones uses
        // "listen" for the workbench cross-window bus; in tests there is
        // only one window so this never fires.
        callback: () => 0,
      };

      // Legacy-v1 shim, in case any code path still uses it.
      window.__TAURI__ = { invoke };
    })();
  `;
}
