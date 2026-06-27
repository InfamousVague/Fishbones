/// Concrete tool definitions the Libre AI agent can call.
///
/// Tools are deliberately split into three layers:
///   1. **Read-only navigation** (`list_courses`, `list_completions`,
///      `read_lesson_body`, `search_lessons`) — answer questions
///      about the library. Auto-approved because they can't damage
///      anything.
///   2. **Lesson nav** (`open_lesson`) — mutates the user's view
///      state but is reversible. Auto-approved IF the user explicitly
///      asked for navigation help; gated otherwise.
///   3. **Sandbox project tools** (`create_sandbox_project`,
///      `write_sandbox_file`, `read_sandbox_file`, `list_sandbox_files`,
///      `run_sandbox_project`) — the "mini Claude Code" layer.
///      Some auto, some gated; see each tool's `auto` flag.
///
/// All tools live in a single registry so the system-prompt
/// builder can iterate it once and emit schemas the model
/// understands.
///
/// State injection: tools that need access to live React state
/// (courses, completions, current sandbox project) receive it via
/// the `ToolContext` argument the agent loop passes through. The
/// context is a snapshot of the relevant state at the moment the
/// tool was dispatched — captured fresh each agent turn so the
/// model isn't reading stale data.

import { invoke } from "@tauri-apps/api/core";
import type { Course, Lesson, LanguageId } from "../../data/types";
import type { Completion } from "../../hooks/useProgress";
import { runFiles } from "../../runtimes";
import type { ToolDef } from "./types";
import {
  type AgentScope,
  enforceProject,
  enforceWrite,
} from "./scope";
import { diagnoseRunError } from "../ai/diagnosis";
import {
  dedupeProjectName,
  validateFilePath,
  validateProjectName,
} from "./sandboxValidation";
import {
  analyzeConceptCoverage,
  conceptsForLanguage,
  conceptLangFor,
  findConceptByName,
  lessonsForConcept,
  prerequisiteChain,
} from "../ai/concepts";
import {
  addFact,
  conceptMasteryOf,
  loadMemory,
  recordStruggle,
  removeFact,
  saveMemory,
} from "../ai/memory";

/// State + callbacks the tools execute against. Provided by the
/// host (App.tsx / TrayPanel) when it instantiates the agent so
/// tools can navigate the user's library, read lesson bodies,
/// and drive sandbox project mutations.
export interface ToolContext {
  /// Snapshot of the user's installed courses + lessons.
  courses: readonly Course[];
  /// Set of `${courseId}:${lessonId}` keys the user has finished.
  completed: ReadonlySet<string>;
  /// Per-course history rows; lets tools answer "when did I last
  /// finish a lesson in course X?" questions.
  history: readonly Completion[];
  /// Open a lesson in the main view. Wired by the host to the
  /// existing `libre:open-lesson` flow — same path the
  /// AiChatPanel's libre:// link interception uses.
  openLesson: (courseId: string, lessonId: string) => void;
  /// Open a course (resumes at the user's last lesson or the
  /// first incomplete one). Wired to `openCourseFromLibrary`.
  openCourse: (courseId: string) => void;
  /// Current working scope — which projects + paths the agent is
  /// allowed to modify. Tools that mutate state consult this
  /// before doing anything; reads are unrestricted (the agent
  /// can look at any course / project, it just can't WRITE outside
  /// scope without asking).
  scope: AgentScope;
  /// Mutate the scope from inside scope-management tools
  /// (`set_active_project`, `extend_scope`, `clear_scope`). The
  /// host's `useAgentScope` setter is wired here so the model can
  /// adjust its own working scope mid-conversation when the user
  /// agrees to broaden it.
  updateScope: (next: AgentScope) => void;
  /// The sandbox project the user currently has OPEN in the editor
  /// (the live `useSandboxProjects.activeProject`), or null when the
  /// sandbox isn't initialised. This is the referent for "this
  /// project / this file" — when the model omits `projectId` on a
  /// sandbox tool call, it defaults to this, so "add a function to
  /// this" edits what the user is looking at instead of erroring or
  /// spawning a new project. Kept in sync with the agent's scope
  /// focus by the host (AiAssistant bridges both directions).
  currentSandbox?: {
    projectId: string;
    name: string;
    language: string;
    /// Path of the file the user has focused in the editor, when known.
    activeFilePath?: string;
  } | null;
}

/// Helper: find a lesson by `courseId` + `lessonId`. Returns null
/// when either lookup misses — handlers surface that as a tool
/// error rather than throwing.
function findLesson(
  courses: readonly Course[],
  courseId: string,
  lessonId: string,
): { course: Course; lesson: Lesson } | null {
  const course = courses.find((c) => c.id === courseId);
  if (!course) return null;
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      if (l.id === lessonId) return { course, lesson: l };
    }
  }
  return null;
}

/// Build the agent's tool set for a given host context. Returns
/// a fresh array each call — `ctx` is captured in closures, so
/// re-building per agent turn keeps the tools reading the latest
/// state without prop-drill noise.
export function buildToolRegistry(ctx: ToolContext): ToolDef[] {
  return [
    // ── Read-only navigation ──────────────────────────────────
    {
      name: "list_courses",
      description:
        "List every course the user has installed. Returns id, title, language, lesson count, and completion percentage for each. Call this first when the user asks 'what should I learn' or 'what do I have'.",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        return ctx.courses.map((c) => {
          let total = 0;
          let done = 0;
          for (const ch of c.chapters) {
            for (const l of ch.lessons) {
              total += 1;
              if (ctx.completed.has(`${c.id}:${l.id}`)) done += 1;
            }
          }
          return {
            id: c.id,
            title: c.title,
            language: c.language ?? null,
            lessonCount: total,
            completedCount: done,
            percentComplete: total > 0 ? Math.round((done / total) * 100) : 0,
          };
        });
      },
    },
    {
      name: "list_completions",
      description:
        "Return the user's most recent N lesson completions (default 20), newest first. Each row has courseId, lessonId, courseTitle, lessonTitle, completedAt (unix seconds). Useful for 'where did I leave off?' or 'what have I done recently?' questions.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Max rows to return. Defaults to 20.",
          },
        },
      },
      auto: true,
      async handler(args: { limit?: number }) {
        const limit = Math.min(Math.max(1, args.limit ?? 20), 100);
        // History is in completion order — newest is the tail.
        // Reverse + slice for the model.
        const slice = [...ctx.history].reverse().slice(0, limit);
        return slice.map((row) => {
          const found = findLesson(ctx.courses, row.course_id, row.lesson_id);
          return {
            courseId: row.course_id,
            lessonId: row.lesson_id,
            courseTitle: found?.course.title ?? row.course_id,
            lessonTitle: found?.lesson.title ?? row.lesson_id,
            completedAt: row.completed_at,
          };
        });
      },
    },
    {
      name: "read_lesson_body",
      description:
        "Return the full markdown body of a single lesson plus its kind (reading / quiz / exercise / mixed). Use this when you need to reason about WHAT the lesson covers before recommending it or explaining it.",
      parameters: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "The course id." },
          lessonId: { type: "string", description: "The lesson id." },
        },
        required: ["courseId", "lessonId"],
      },
      auto: true,
      async handler(args: { courseId: string; lessonId: string }) {
        const found = findLesson(ctx.courses, args.courseId, args.lessonId);
        if (!found) {
          return { error: true, message: "Lesson not found." };
        }
        return {
          courseId: args.courseId,
          lessonId: args.lessonId,
          title: found.lesson.title,
          kind: found.lesson.kind,
          body: found.lesson.body ?? "",
        };
      },
    },
    {
      name: "search_lessons",
      description:
        "Fuzzy-match lesson + chapter titles across the user's installed courses. Returns up to `limit` results (default 12), each with courseId, lessonId, courseTitle, lessonTitle, kind. Use this for 'find me lessons about X' queries — much cheaper than reading every lesson body.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to match against lesson + chapter titles.",
          },
          limit: { type: "integer", description: "Max results (default 12)." },
        },
        required: ["query"],
      },
      auto: true,
      async handler(args: { query: string; limit?: number }) {
        const q = args.query.trim().toLowerCase();
        const limit = Math.min(Math.max(1, args.limit ?? 12), 50);
        if (!q) return [];
        const hits: Array<{
          courseId: string;
          lessonId: string;
          courseTitle: string;
          chapterTitle: string;
          lessonTitle: string;
          kind: string;
          score: number;
        }> = [];
        for (const c of ctx.courses) {
          for (const ch of c.chapters) {
            for (const l of ch.lessons) {
              const haystack = `${l.title} ${ch.title}`.toLowerCase();
              if (haystack.includes(q)) {
                // Title-match scores higher than chapter-only
                // match so direct hits surface first.
                const score = l.title.toLowerCase().includes(q) ? 2 : 1;
                hits.push({
                  courseId: c.id,
                  lessonId: l.id,
                  courseTitle: c.title,
                  chapterTitle: ch.title,
                  lessonTitle: l.title,
                  kind: l.kind,
                  score,
                });
              }
            }
          }
        }
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, limit).map(({ score, ...rest }) => {
          void score;
          return rest;
        });
      },
    },

    // ── Tutor tools (concept-grounded, read-only) ─────────────
    //
    // These turn a fuzzy "explain X" / "what should I learn about
    // X" into a STRUCTURED, can't-hallucinate answer: the blurb +
    // prerequisite chain come from the concept engine, the lesson
    // links come from the retrieval scorer over the user's INSTALLED
    // courses (so every libre:// URL is real), and the learned flags
    // come from the completion set. The model narrates around this
    // skeleton instead of inventing it.
    {
      name: "explain_concept",
      description:
        "Look up a programming concept (e.g. 'ownership', 'closures', 'async/await', 'list comprehensions') and get a grounded teaching skeleton: a one-line definition, its difficulty, the prerequisite concepts to understand first, and the lessons in the USER'S installed courses that teach it (with real libre:// links + whether they've already completed each). Use this whenever the learner asks you to explain a concept — narrate around the returned facts; cite the lesson links verbatim; never invent a libre:// URL. Returns { found: false } when there's no structured concept — then answer in plain prose.",
      parameters: {
        type: "object",
        properties: {
          concept: {
            type: "string",
            description:
              "The concept name or id, e.g. 'borrowing', 'rust-borrowing', 'react hooks'.",
          },
          language: {
            type: "string",
            description:
              "Optional language hint ('rust' | 'python' | 'javascript' | 'typescript' | 'react' …) to disambiguate (a Python 'class' vs a Rust question).",
          },
        },
        required: ["concept"],
      },
      auto: true,
      async handler(args: { concept: string; language?: string }) {
        const concept = findConceptByName(args.concept, args.language);
        if (!concept) {
          return {
            found: false,
            message: `No structured concept matches "${args.concept}". Answer in plain prose.`,
          };
        }
        const chain = prerequisiteChain(concept.id)
          .filter((c) => c.id !== concept.id)
          .map((c) => c.label);
        const lessons = lessonsForConcept(ctx.courses, concept, 3).map((l) => ({
          courseId: l.courseId,
          lessonId: l.lessonId,
          courseTitle: l.courseTitle,
          lessonTitle: l.lessonTitle,
          link: l.link,
          completed: ctx.completed.has(`${l.courseId}:${l.lessonId}`),
        }));
        return {
          found: true,
          id: concept.id,
          label: concept.label,
          blurb: concept.blurb,
          difficulty: concept.difficulty,
          prerequisites: chain,
          mastery: conceptMasteryOf(concept.id),
          lessons,
        };
      },
    },
    {
      name: "suggest_lessons",
      description:
        "Build a pedagogically-ordered learning path for a topic or language: detects the relevant concepts, then returns them UNLEARNED-FIRST (hardest first within that), each with its difficulty, a one-line blurb, and the installed-course lessons that teach it (real libre:// links + completed flags). Use for 'what should I learn about X', 'where do I start with Rust', or to suggest next steps after a build. Prefer this over search_lessons when the learner wants a guided sequence, not a raw title match.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "A concept or topic to focus on, e.g. 'iterators', 'ownership and borrowing'. Omit to get a broad path for `language`.",
          },
          language: {
            type: "string",
            description:
              "Language family to draw concepts from ('rust' | 'python' | 'javascript' | 'typescript'). Used when `topic` is broad or omitted.",
          },
          limit: {
            type: "integer",
            description: "Max concepts to return (default 6).",
          },
        },
        required: [],
      },
      auto: true,
      async handler(args: {
        topic?: string;
        language?: string;
        limit?: number;
      }) {
        const limit = Math.min(Math.max(1, args.limit ?? 6), 12);
        // Resolve the concept set: a named topic expands to that
        // concept + its prerequisites; otherwise the language's pool.
        let pool: ReturnType<typeof conceptsForLanguage> = [];
        if (args.topic) {
          const c = findConceptByName(args.topic, args.language);
          if (c) pool = prerequisiteChain(c.id);
        }
        if (pool.length === 0 && args.language) {
          const lang = conceptLangFor(args.language);
          if (lang) pool = conceptsForLanguage(lang);
        }
        if (pool.length === 0) {
          return {
            found: false,
            message:
              "No concepts matched. Pass a `language` (rust/python/javascript/typescript) or a known `topic`.",
          };
        }
        const coverage = analyzeConceptCoverage(pool, ctx.courses, ctx.completed);
        return {
          found: true,
          path: coverage.slice(0, limit).map((c) => ({
            id: c.concept.id,
            label: c.concept.label,
            difficulty: c.concept.difficulty,
            blurb: c.concept.blurb,
            learned: c.learned,
            lessons: c.lessons.slice(0, 2).map((l) => ({
              courseId: l.courseId,
              lessonId: l.lessonId,
              lessonTitle: l.lessonTitle,
              link: l.link,
            })),
          })),
        };
      },
    },

    // ── Lesson nav (state-changing, gated) ────────────────────
    {
      name: "open_lesson",
      description:
        "Navigate the user to a specific lesson. Use this AFTER you've checked with the user or when they explicitly said 'open X' / 'take me to X'. Fires the same flow as clicking a lesson card in the library.",
      parameters: {
        type: "object",
        properties: {
          courseId: { type: "string" },
          lessonId: { type: "string" },
        },
        required: ["courseId", "lessonId"],
      },
      auto: false,
      async handler(args: { courseId: string; lessonId: string }) {
        const found = findLesson(ctx.courses, args.courseId, args.lessonId);
        if (!found) {
          return { error: true, message: "Lesson not found." };
        }
        ctx.openLesson(args.courseId, args.lessonId);
        return {
          ok: true,
          opened: `${found.course.title} — ${found.lesson.title}`,
        };
      },
    },
    {
      name: "open_course",
      description:
        "Open a course at the user's natural resume point (their existing tab if any, else the first uncompleted lesson). Use when the user wants to 'continue' or 'pick up' a course without specifying a lesson.",
      parameters: {
        type: "object",
        properties: { courseId: { type: "string" } },
        required: ["courseId"],
      },
      auto: false,
      async handler(args: { courseId: string }) {
        const c = ctx.courses.find((c) => c.id === args.courseId);
        if (!c) return { error: true, message: "Course not found." };
        ctx.openCourse(args.courseId);
        return { ok: true, opened: c.title };
      },
    },

    // ── Scope management ─────────────────────────────────────
    //
    // These let the model READ and (with user approval) MODIFY
    // its own working scope — which project is the default focus,
    // which projects it's allowed to touch, which paths are
    // writable, and which are read-only. The chip in the agent
    // panel header is the user-facing read-out of the same state.
    {
      name: "get_scope",
      description:
        "Return the agent's current working scope: active project (focus), allowed project ids, allowed path patterns for writes, and read-only paths. Read-only tools always work regardless of scope; write/delete/patch/run tools check the scope before acting. Empty allowedProjectIds means EVERY project is in scope; empty allowedPathPatterns means EVERY path inside allowed projects is writable.",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        return {
          activeProjectId: ctx.scope.activeProjectId,
          allowedProjectIds: Array.from(ctx.scope.allowedProjectIds),
          allowedPathPatterns: ctx.scope.allowedPathPatterns,
          readOnlyPaths: ctx.scope.readOnlyPaths,
        };
      },
    },
    {
      name: "set_active_project",
      description:
        "Set the project the agent should treat as its default focus. Doesn't restrict which projects are touchable — use extend_scope for that. Pass null to clear focus.",
      parameters: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description: "Project id, or empty string to clear focus.",
          },
        },
        required: ["projectId"],
      },
      auto: false,
      async handler(args: { projectId: string }) {
        const next: AgentScope = {
          ...ctx.scope,
          activeProjectId: args.projectId || null,
        };
        ctx.updateScope(next);
        // Make the EDITOR follow the agent's focus too, so "let's
        // switch to project X" moves the user's open project. The
        // sandbox's focus listener is equality-gated, so re-focusing
        // the already-open project is a no-op (no event loop with
        // the host's reverse mirror).
        if (next.activeProjectId) focusSandbox(next.activeProjectId);
        return { ok: true, activeProjectId: next.activeProjectId };
      },
    },
    {
      name: "extend_scope",
      description:
        "Broaden the agent's working scope by adding project ids the agent is allowed to touch and/or path patterns it can write to. Patterns are minimal globs ('src/**', '*.ts', 'package.json'). Use this when the user agrees to give the agent access to new files / projects. Cannot REMOVE scope — for that, ask the user to do it via the UI or call clear_scope to reset.",
      parameters: {
        type: "object",
        properties: {
          projectIds: {
            type: "array",
            description: "Project ids to allow. Empty array → no change.",
            items: { type: "string" },
          },
          pathPatterns: {
            type: "array",
            description: "Glob patterns to allow writes against.",
            items: { type: "string" },
          },
        },
      },
      auto: false,
      async handler(args: {
        projectIds?: string[];
        pathPatterns?: string[];
      }) {
        const nextProjects = new Set(ctx.scope.allowedProjectIds);
        for (const id of args.projectIds ?? []) nextProjects.add(id);
        const nextPatterns = Array.from(
          new Set([
            ...ctx.scope.allowedPathPatterns,
            ...(args.pathPatterns ?? []),
          ]),
        );
        const next: AgentScope = {
          ...ctx.scope,
          allowedProjectIds: nextProjects,
          allowedPathPatterns: nextPatterns,
        };
        ctx.updateScope(next);
        return {
          ok: true,
          allowedProjectIds: Array.from(nextProjects),
          allowedPathPatterns: nextPatterns,
        };
      },
    },
    {
      name: "clear_scope",
      description:
        "Reset the agent's working scope — clears active project, allowed-list, and read-only list. After this every project + path is in scope (the broadest possible state). Useful when the user wants a fresh agent session with no inherited restrictions.",
      parameters: { type: "object", properties: {} },
      auto: false,
      async handler() {
        ctx.updateScope({
          activeProjectId: null,
          allowedProjectIds: new Set(),
          allowedPathPatterns: [],
          readOnlyPaths: [],
        });
        return { ok: true };
      },
    },

    // ── Sandbox project tools (the "mini Claude Code" layer) ─
    //
    // These talk to the Tauri sandbox commands (`sandbox_*` in
    // src-tauri/src/sandbox.rs). They let the agent scaffold,
    // edit, and run real projects on the user's machine.
    {
      name: "list_sandbox_projects",
      description:
        "List the user's existing sandbox projects (id, name, language, file count). Call this before creating a new project to see if a suitable one already exists.",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        try {
          return await invoke("sandbox_list_projects");
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "read_sandbox_file",
      description:
        "Read one file from a sandbox project. Returns the full text content. Use this to inspect existing code before editing.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          path: {
            type: "string",
            description: "Path relative to the project root, e.g. 'src/main.ts'.",
          },
        },
        required: ["projectId", "path"],
      },
      auto: true,
      async handler(args: { projectId: string; path: string }) {
        if (!args.projectId && ctx.currentSandbox?.projectId) {
          args.projectId = ctx.currentSandbox.projectId;
        }
        if (!args.projectId) {
          return {
            error: true,
            message:
              "read_sandbox_file: 'projectId' is required — open a project in the sandbox or pass one (list_sandbox_projects to find ids).",
          };
        }
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as { files: Array<{ name: string; content: string }> };
          const file = project.files.find((f) => f.name === args.path);
          if (!file) {
            return { error: true, message: `File not found: ${args.path}` };
          }
          return { path: args.path, content: file.content };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "list_sandbox_files",
      description:
        "List every file in a sandbox project (path + size in bytes). Use this to understand the project structure before reading specific files.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      auto: true,
      async handler(args: { projectId: string }) {
        if (!args.projectId && ctx.currentSandbox?.projectId) {
          args.projectId = ctx.currentSandbox.projectId;
        }
        if (!args.projectId) {
          return {
            error: true,
            message:
              "list_sandbox_files: 'projectId' is required — open a project in the sandbox or pass one (list_sandbox_projects to find ids).",
          };
        }
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as { files: Array<{ name: string; content: string }> };
          return project.files.map((f) => ({
            path: f.name,
            sizeBytes: f.content.length,
          }));
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "write_sandbox_file",
      description:
        "Write (create or overwrite) one file in a sandbox project. Use this to scaffold or edit code. Surface the user a permission chip before running.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          path: {
            type: "string",
            description: "Path relative to the project root.",
          },
          content: {
            type: "string",
            description: "Full file contents — this OVERWRITES any existing file at the same path.",
          },
        },
        required: ["projectId", "path", "content"],
      },
      auto: false,
      async handler(args: {
        projectId: string;
        path: string;
        content: string;
      }) {
        // Default to the project the user has OPEN when the model
        // omits one — "edit this file" should land in the editor the
        // user is looking at, not error out.
        if (!args.projectId && ctx.currentSandbox?.projectId) {
          args.projectId = ctx.currentSandbox.projectId;
        }
        // Up-front shape validation. Surfaces the same actionable
        // error the agent's retry-detector watches for so a model
        // that forgot a required arg gets a clear "you're missing
        // X" instead of a deserialise error.
        if (!args.projectId) {
          return {
            error: true,
            message:
              "write_sandbox_file: 'projectId' is required. Call create_sandbox_project FIRST to get a projectId, or open a project in the sandbox.",
          };
        }
        if (!args.path) {
          return {
            error: true,
            message:
              "write_sandbox_file: 'path' is required. Pass the project-relative path of the file you want to write, e.g. 'src/App.jsx'.",
          };
        }
        const wPathCheck = validateFilePath(args.path);
        if (!wPathCheck.ok) {
          return {
            error: true,
            message: `write_sandbox_file: ${wPathCheck.reason}`,
          };
        }
        if (typeof args.content !== "string") {
          return {
            error: true,
            message:
              "write_sandbox_file: 'content' is required and must be a string. Pass the FULL contents of the file — partial content overwrites the existing file.",
          };
        }
        // Scope enforcement — bail with a model-readable error
        // before touching disk if the project or path is out of
        // bounds. The model is instructed in the system prompt
        // to react by calling `extend_scope` (and the user-
        // approves it) rather than retrying blindly.
        const denyProject = enforceProject(ctx.scope, args.projectId);
        if (denyProject) return { error: true, message: denyProject };
        const denyWrite = enforceWrite(ctx.scope, args.path);
        if (denyWrite) return { error: true, message: denyWrite };
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as {
            id: string;
            name: string;
            language: string;
            files: Array<{ name: string; content: string; language: string }>;
          };
          // Live-typing save: streams the content into the
          // sandbox editor in chunks so the user watches the
          // file get written instead of just seeing the result
          // pop into place. The refresh + focus events fire on
          // every chunk so the SandboxView re-pulls + scrolls
          // to the right tab as content arrives.
          await liveTypeSave(project, args.path, args.content);
          return { ok: true, path: args.path, bytes: args.content.length };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Project-not-found is the most common failure here —
          // tell the model exactly what to do instead of dumping
          // the raw error.
          if (/not found|no such|enoent/i.test(msg)) {
            return {
              error: true,
              message: `write_sandbox_file: project '${args.projectId}' doesn't exist. Either call list_sandbox_projects to find a valid id, or create_sandbox_project to make a new one.`,
            };
          }
          return { error: true, message: msg };
        }
      },
    },
    {
      name: "delete_sandbox_file",
      description:
        "Delete a single file from a sandbox project. Use sparingly — the user usually wants files updated, not removed. Surface a permission chip before running.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          path: { type: "string", description: "Path relative to the project root." },
        },
        required: ["projectId", "path"],
      },
      auto: false,
      async handler(args: { projectId: string; path: string }) {
        const denyProject = enforceProject(ctx.scope, args.projectId);
        if (denyProject) return { error: true, message: denyProject };
        const denyWrite = enforceWrite(ctx.scope, args.path);
        if (denyWrite) return { error: true, message: denyWrite };
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as {
            id: string;
            name: string;
            language: string;
            files: Array<{ name: string; content: string; language: string }>;
          };
          const before = project.files.length;
          project.files = project.files.filter((f) => f.name !== args.path);
          if (project.files.length === before) {
            return { error: true, message: `File not found: ${args.path}` };
          }
          await invoke("sandbox_save_project", { project });
          notifySandboxRefresh();
          focusSandbox(args.projectId);
          return { ok: true, deleted: args.path };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "apply_sandbox_patch",
      description:
        "Atomically apply a batch of file edits to one sandbox project. Each edit is { path, content, op } where op is 'write' (create or overwrite) or 'delete'. Use this when you need to touch SEVERAL files at once (e.g. scaffolding a project with multiple source files + a config). One permission chip covers the whole patch; clearer for the user than approving N individual writes.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          edits: {
            type: "array",
            description: "Ordered list of file operations to apply.",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                op: {
                  type: "string",
                  enum: ["write", "delete"],
                  description: "'write' to create / overwrite; 'delete' to remove.",
                },
                content: {
                  type: "string",
                  description: "Required when op is 'write'. Ignored for delete.",
                },
              },
              required: ["path", "op"],
            },
          },
        },
        required: ["projectId", "edits"],
      },
      auto: false,
      async handler(args: {
        projectId: string;
        edits: Array<{ path: string; op: "write" | "delete"; content?: string }>;
      }) {
        if (!args.projectId && ctx.currentSandbox?.projectId) {
          args.projectId = ctx.currentSandbox.projectId;
        }
        if (!args.projectId) {
          return {
            error: true,
            message:
              "apply_sandbox_patch: 'projectId' is required. Call create_sandbox_project or list_sandbox_projects first to get a valid id, or open a project in the sandbox.",
          };
        }
        if (!Array.isArray(args.edits) || args.edits.length === 0) {
          return {
            error: true,
            message:
              "apply_sandbox_patch: 'edits' must be a non-empty array. Each entry is { path, op: 'write' | 'delete', content? }.",
          };
        }
        // Validate every edit's shape before doing anything —
        // partial validity should fail fast with a clear message,
        // not write some files and leave the rest broken.
        for (const [i, edit] of args.edits.entries()) {
          if (!edit?.path) {
            return {
              error: true,
              message: `apply_sandbox_patch: edit #${i} is missing 'path'.`,
            };
          }
          // Only enforce the junk-shape check on writes — that's where a
          // bad name CREATES a junk file. A delete is an exact-name match
          // against the existing in-memory file list (no traversal), so
          // gating it would wrongly block removing a legit file whose name
          // predates this validation.
          if (edit.op !== "delete") {
            const pPathCheck = validateFilePath(edit.path);
            if (!pPathCheck.ok) {
              return {
                error: true,
                message: `apply_sandbox_patch: edit #${i} path '${String(
                  edit.path,
                ).slice(0, 40)}' is invalid — ${pPathCheck.reason}`,
              };
            }
          }
          if (edit.op !== "write" && edit.op !== "delete") {
            return {
              error: true,
              message: `apply_sandbox_patch: edit #${i} has invalid 'op' ('${edit.op}'). Must be 'write' or 'delete'.`,
            };
          }
          if (edit.op === "write" && typeof edit.content !== "string") {
            return {
              error: true,
              message: `apply_sandbox_patch: edit #${i} (write to '${edit.path}') is missing 'content' or content is not a string. Pass the FULL file contents — partial content overwrites the existing file.`,
            };
          }
        }
        const denyProject = enforceProject(ctx.scope, args.projectId);
        if (denyProject) return { error: true, message: denyProject };
        // Check every edit's path BEFORE we touch disk so the
        // patch stays atomic. One out-of-scope path aborts the
        // whole batch — same UX as a git apply that fails fast
        // on a conflict.
        for (const edit of args.edits) {
          const denyWrite = enforceWrite(ctx.scope, edit.path);
          if (denyWrite) {
            return {
              error: true,
              message: `${denyWrite} (failed on edit: ${edit.path})`,
            };
          }
        }
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as {
            id: string;
            name: string;
            language: string;
            files: Array<{ name: string; content: string; language: string }>;
          };
          const summary: Array<{ path: string; op: string; ok: boolean }> = [];
          for (const edit of args.edits) {
            if (edit.op === "delete") {
              const before = project.files.length;
              project.files = project.files.filter((f) => f.name !== edit.path);
              summary.push({
                path: edit.path,
                op: "delete",
                ok: project.files.length < before,
              });
            } else {
              const inferred = inferLanguage(edit.path);
              const idx = project.files.findIndex((f) => f.name === edit.path);
              if (idx >= 0) {
                project.files[idx] = {
                  ...project.files[idx],
                  content: edit.content ?? "",
                  language: project.files[idx].language || inferred,
                };
              } else {
                project.files.push({
                  name: edit.path,
                  content: edit.content ?? "",
                  language: inferred,
                });
              }
              summary.push({ path: edit.path, op: "write", ok: true });
            }
          }
          await invoke("sandbox_save_project", { project });
          notifySandboxRefresh();
          // Focus the last written path so the editor pops to
          // whatever the agent most recently touched in the patch.
          const lastWrite = [...args.edits]
            .reverse()
            .find((e) => e.op === "write");
          focusSandbox(args.projectId, lastWrite?.path);
          return { ok: true, applied: summary };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "run_sandbox_project",
      description:
        "Execute a sandbox project. Returns logs, error string (if any), duration in ms, and a previewUrl when the runtime produced one (web / react / threejs / svelte / reactnative). Use this after writing files to verify the project actually runs. CAN take 5-30s for compiled languages (Rust / C++ / Go) — there's no streaming, the result lands all at once when execution finishes.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      auto: false,
      async handler(args: { projectId: string }) {
        if (!args.projectId && ctx.currentSandbox?.projectId) {
          args.projectId = ctx.currentSandbox.projectId;
        }
        if (!args.projectId) {
          return {
            error: true,
            message:
              "run_sandbox_project: 'projectId' is required. Pass the id returned by create_sandbox_project or one from list_sandbox_projects.",
          };
        }
        const deny = enforceProject(ctx.scope, args.projectId);
        if (deny) return { error: true, message: deny };
        // Buffer for postMessage logs that arrive from the
        // preview iframe AFTER the runner returns. These are
        // late-arriving runtime errors that the synchronous
        // `result.logs` channel misses — `SyntaxError`s from
        // Babel, `createRoot is not found` import failures,
        // React render errors, etc. We start listening BEFORE
        // calling runFiles so logs that fire during the run
        // (when the iframe is mid-load) are captured too.
        const lateLogs: Array<{ level: string; text: string }> = [];
        const onPreviewLog = (ev: Event) => {
          const detail = (ev as CustomEvent<{ level?: string; text?: string }>)
            .detail;
          if (!detail?.text) return;
          lateLogs.push({
            level: detail.level ?? "log",
            text: detail.text,
          });
        };
        if (typeof window !== "undefined") {
          window.addEventListener("libre:preview-log", onPreviewLog);
        }
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as {
            id: string;
            name: string;
            language: string;
            files: Array<{ name: string; content: string; language: string }>;
          };
          // Broadcast a run-start event so the agent panel's
          // running tool chip can render a spinner + the sandbox
          // view (when open) can show the same "running…" state.
          // Without this the chip just sits on "running" silently
          // for 5-30s on compiled languages, looking frozen.
          window.dispatchEvent(
            new CustomEvent("libre:agent-run-start", {
              detail: { projectId: project.id, language: project.language },
            }),
          );
          // The runtime's `WorkbenchFile` shape matches the sandbox
          // file shape exactly (name + content + language). Cast is
          // safe — TS just wants the matching nominal type.
          // `runFiles` wants `WorkbenchFile[]` (language typed as
          // the strict `FileLanguage` union); sandbox-loaded
          // files carry `language: string`. Both shapes are
          // structurally compatible — the runtime only reads the
          // language tag — so an unknown-cast is the right escape
          // hatch rather than redeclaring the type bound here.
          const result = await runFiles(
            project.language as LanguageId,
            project.files as unknown as Parameters<typeof runFiles>[1],
            undefined,
            undefined,
            // Use the project id as a stable lessonId so SvelteKit /
            // other long-running runtimes scope per-project.
            `sandbox:${project.id}`,
          );
          // For preview-producing runs, give the iframe a moment
          // to actually load + execute the user's code so any
          // late-arriving runtime errors (`SyntaxError` from
          // Babel, `createRoot is not found`, React render
          // throws) make it into the result the model sees.
          // Without this wait, the model thinks `ok: true` just
          // because `runFiles` resolved with a previewUrl — but
          // the page might be rendering a red error overlay
          // because the import statement failed. 2.5s is enough
          // for esm.sh + vendor bundles to load + Babel to parse
          // the user source on most machines.
          //
          // Skipped for non-preview runs (Python, Rust, CLI):
          // their logs are captured synchronously inside
          // `runFiles` and any errors are already in result.error
          // / result.logs by the time we get here.
          if (result.previewUrl) {
            await new Promise((resolve) => setTimeout(resolve, 2500));
          }
          if (typeof window !== "undefined") {
            window.removeEventListener("libre:preview-log", onPreviewLog);
          }
          // Merge late-arriving logs into the result. Errors
          // promote `ok` to false so the agent's auto-verify
          // loop kicks in and the model patches the code.
          const lateErrors = lateLogs.filter((l) => l.level === "error");
          const mergedLogs = [...result.logs, ...lateLogs];
          const effectiveOk = !result.error && lateErrors.length === 0;
          const effectiveError =
            result.error ??
            (lateErrors.length > 0
              ? `Preview iframe reported runtime error(s):\n${lateErrors
                  .map((l) => l.text)
                  .join("\n")}`
              : null);
          window.dispatchEvent(
            new CustomEvent("libre:agent-run-end", {
              detail: {
                projectId: project.id,
                ok: effectiveOk,
                durationMs: result.durationMs,
                previewUrl: result.previewUrl ?? null,
              },
            }),
          );
          // Truncate logs that get too long — feeding 100KB of
          // output back into the next agent turn wastes context
          // and the model only needs the head + tail to debug.
          const truncatedLogs = mergedLogs.map((l) => ({
            level: l.level,
            text: l.text.length > 4000 ? `${l.text.slice(0, 2000)}\n…[truncated ${l.text.length - 4000} chars]…\n${l.text.slice(-2000)}` : l.text,
          }));
          // Failed runs get a deterministic diagnosis: the error
          // text + error-level logs run through the pattern table
          // and come back with a targeted fix hint (+ file:line
          // when the format carries one). A small local model
          // reading "borrow of moved value" cold often flails;
          // the same model reading the attached hint usually
          // patches correctly on the first try. Also feeds the
          // memory layer's struggle tracking.
          const diagnosis = effectiveOk
            ? null
            : diagnoseRunError(
                [
                  effectiveError ?? "",
                  ...truncatedLogs
                    .filter((l) => l.level === "error")
                    .map((l) => l.text),
                ].join("\n"),
              );
          if (diagnosis) {
            recordStruggle(diagnosis.code);
          }
          return {
            ok: effectiveOk,
            durationMs: result.durationMs,
            logs: truncatedLogs,
            error: effectiveError,
            ...(diagnosis ? { diagnosis } : {}),
            previewUrl: result.previewUrl ?? null,
          };
        } catch (e) {
          if (typeof window !== "undefined") {
            window.removeEventListener("libre:preview-log", onPreviewLog);
          }
          const msg = e instanceof Error ? e.message : String(e);
          window.dispatchEvent(
            new CustomEvent("libre:agent-run-end", {
              detail: { projectId: args.projectId, ok: false, error: msg },
            }),
          );
          if (/not found|no such|enoent/i.test(msg)) {
            return {
              error: true,
              message: `run_sandbox_project: project '${args.projectId}' doesn't exist. List existing projects with list_sandbox_projects or create one with create_sandbox_project.`,
            };
          }
          return { error: true, message: msg };
        }
      },
    },
    // ── Dev server (long-running) ─────────────────────────────
    //
    // Wraps the existing SvelteKit-runner Tauri commands. For
    // Svelte projects the runner gives us a stable `vite dev`
    // process per project that the agent can spin up, ping for
    // its URL, and tear down. For other languages with their own
    // long-running preview models (react-native via expo, etc.)
    // we'd add parallel runners; for now SvelteKit is the one
    // case with a real dev-server primitive on disk.
    {
      name: "start_dev_server",
      description:
        "Start (or restart) the dev server for a sandbox project. Currently supports `svelte` projects (spawns `vite dev`); returns the local URL the agent + user can navigate to. For other languages, prefer `run_sandbox_project`. Idempotent — calling again with the same project restarts cleanly.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      auto: false,
      async handler(args: { projectId: string }) {
        const deny = enforceProject(ctx.scope, args.projectId);
        if (deny) return { error: true, message: deny };
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as {
            id: string;
            name: string;
            language: string;
            files: Array<{ name: string; content: string; language: string }>;
          };
          // Dispatch per language:
          //   - svelte → real `vite dev` via the sveltekit_runner.
          //     Long-running process, HMR, proper file watching.
          //   - web / threejs → one-shot preview through the
          //     `runFiles` web-runtime path. Not a "dev server"
          //     in the long-running sense, but produces a stable
          //     previewUrl + autoreloads on subsequent calls, so
          //     from the agent's point of view it behaves the
          //     same way (call → get URL → hand to user).
          //   - everything else → return a helpful error
          //     pointing at `run_sandbox_project`.
          if (project.language === "svelte") {
            const result = (await invoke("start_sveltekit", {
              lessonId: `sandbox:${project.id}`,
              files: project.files.map((f) => ({
                name: f.name,
                content: f.content,
              })),
            })) as {
              preview_url?: string | null;
              stdout?: string;
              stderr?: string;
            };
            return {
              ok: true,
              language: "svelte",
              previewUrl: result.preview_url ?? null,
              projectId: args.projectId,
            };
          }
          if (project.language === "web" || project.language === "threejs") {
            // The web runtime serves files via a localhost preview
            // server (`serve_web_preview` Tauri command behind the
            // scenes). `runFiles` is the convenient wrapper — same
            // path the sandbox UI uses on Run.
            const result = await runFiles(
              project.language as LanguageId,
              project.files as unknown as Parameters<typeof runFiles>[1],
              undefined,
              undefined,
              `sandbox:${project.id}`,
            );
            return {
              ok: !result.error,
              language: project.language,
              previewUrl: result.previewUrl ?? null,
              projectId: args.projectId,
              error: result.error ?? null,
            };
          }
          return {
            error: true,
            message: `start_dev_server doesn't have a long-running runner for '${project.language}' yet. Use run_sandbox_project for one-shot execution. (Currently supported as a real dev server: svelte. As a one-shot preview: web, threejs.)`,
          };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "stop_dev_server",
      description:
        "Stop the running dev server for a project (if any). Safe to call even when nothing is running.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      auto: true,
      async handler(args: { projectId: string }) {
        try {
          await invoke("stop_sveltekit", {
            lessonId: `sandbox:${args.projectId}`,
          });
          return { ok: true };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "get_dev_server_url",
      description:
        "Return the current preview URL for a project's dev server, or null when nothing is running. Useful for re-fetching a URL after a server has been started.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      auto: true,
      async handler(args: { projectId: string }) {
        try {
          const url = (await invoke("current_sveltekit_url", {
            lessonId: `sandbox:${args.projectId}`,
          })) as string | null;
          return { previewUrl: url };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },
    {
      name: "create_sandbox_project",
      description:
        "Create a new sandbox project. Returns the new project's id, which you MUST pass to subsequent tool calls (write_sandbox_file, apply_sandbox_patch, run_sandbox_project). The project is created with a placeholder starter file you can overwrite later via streaming fenced blocks OR by passing the `files` array now. Use the `files` array when you already know every file's path + content. Use the placeholder + streaming-fence approach when you want the user to watch files appear one at a time.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Display name for the project. Short and descriptive — 'Blackjack', 'Word Counter', 'Fizzbuzz CLI'.",
          },
          language: {
            type: "string",
            description:
              "Language id — one of javascript, typescript, python, ruby, rust, go, swift, dart, scala, haskell, elixir, lua, sql, c, cpp, java, kotlin, csharp, assembly, zig, web, threejs, react, reactnative, svelte, solid, htmx, astro, bun.",
          },
          files: {
            type: "array",
            description:
              "Optional initial files. When provided, the project is created with these files immediately (one save, atomic). Each item is { path, content }. When omitted, the project starts with a single placeholder file the agent can overwrite via streaming fenced blocks OR write_sandbox_file. Prefer this array when the build is short (≤4 files); prefer streaming fenced blocks (omit `files`) when the build is large or you want the user to watch files appear one at a time.",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description:
                    "Project-relative path, e.g. 'src/App.jsx' or 'main.py'. Forward slashes on every platform.",
                },
                content: {
                  type: "string",
                  description: "Full file contents.",
                },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["name", "language"],
      },
      auto: false,
      async handler(args: {
        name: string;
        language: string;
        files?: Array<{ path: string; content: string }>;
      }) {
        try {
          // Validate inputs upfront so the model gets an actionable
          // error rather than a serde deserialise failure deep in
          // the Rust layer.
          if (!args.name || typeof args.name !== "string") {
            return {
              error: true,
              message:
                "create_sandbox_project: 'name' is required and must be a non-empty string.",
            };
          }
          // STRICT name validation — an emulated model can mis-emit a
          // tool-call fragment as the name (e.g. '"create_sandbox_project",
          // "argu…'), which would spawn a junk project. Reject it so the
          // model retries with a real title instead of polluting the panel.
          const nameCheck = validateProjectName(args.name);
          if (!nameCheck.ok) {
            return {
              error: true,
              message: `create_sandbox_project: ${nameCheck.reason}`,
            };
          }
          // Validate every supplied file path the same way — a bad path
          // crashes the editor and usually means leaked tool-call text.
          for (const f of args.files ?? []) {
            const pathCheck = validateFilePath(f?.path);
            if (!pathCheck.ok) {
              return {
                error: true,
                message: `create_sandbox_project: file path '${String(
                  f?.path,
                ).slice(0, 40)}' is invalid — ${pathCheck.reason}`,
              };
            }
          }
          if (!args.language || typeof args.language !== "string") {
            return {
              error: true,
              message:
                "create_sandbox_project: 'language' is required and must be a string (e.g. 'react', 'python', 'typescript').",
            };
          }

          // Project ids: kebab-case slug + 5-char random suffix.
          // Name-clash dedupe: a NEW build whose name collides with a
          // PRIOR project gets a " 2"/" 3" suffix instead of a second
          // identical-looking row. (Per-run dedupe in the loop already
          // stops one build from spawning duplicates.)
          let displayName = args.name;
          try {
            const existing = (await invoke("sandbox_list_projects")) as Array<{
              name?: string;
            }>;
            displayName = dedupeProjectName(
              args.name,
              (existing ?? []).map((p) => p?.name ?? "").filter(Boolean),
            );
          } catch {
            /* list unavailable (web/no disk) — use the name as-is */
          }
          // Matches the shape `useSandboxProjects.makeProject` uses
          // so AI-created projects sit alongside hand-created ones
          // without looking different in the sidebar.
          const id = `${slugify(displayName)}-${randomSuffix()}`;
          const ts = new Date().toISOString();

          // Build the initial file list. Three paths:
          //   1. Caller provided `files` → use them verbatim.
          //   2. Caller omitted `files` → mint a sensible placeholder
          //      per language so the project isn't empty (an empty
          //      file list saves fine, but the sandbox view doesn't
          //      have an "open file" tab to render, which feels
          //      broken). The placeholder doubles as a hint to the
          //      learner about where the entrypoint goes.
          //   3. Caller provided empty `files` array → treat as case 2.
          const userFiles = (args.files ?? []).filter(
            (f) => typeof f?.path === "string" && f.path.trim().length > 0,
          );
          const projectFiles =
            userFiles.length > 0
              ? userFiles.map((f) => ({
                  name: f.path.trim(),
                  language: inferLanguage(f.path),
                  content: f.content ?? "",
                }))
              : [defaultStarterFile(args.language)];

          const project = {
            id,
            name: displayName,
            language: args.language,
            createdAt: ts,
            updatedAt: ts,
            files: projectFiles,
          };
          await invoke("sandbox_save_project", { project });
          notifySandboxRefresh();
          // The agent's stream-to-editor parser
          // (`useSandboxStreamWriter`) latches onto whatever
          // project the most recent `libre:sandbox-focus` event
          // pointed at — fire it here so any fenced ```lang:path
          // blocks the model emits in the FOLLOWING turn flow into
          // this new project. Focusing the first file gives the
          // editor a tab to render.
          focusSandbox(id, projectFiles[0]?.name);
          // Hand the agent enough context to keep going without
          // another tool call: the projectId for subsequent writes,
          // a hint about how to stream files, and the language so
          // the model can pick the right fence-info string.
          return {
            ok: true,
            projectId: id,
            // Report the name the project was actually saved under — a
            // collision with a prior project gets a numeric suffix
            // ("Blackjack 2"), so `displayName` ≠ the requested name.
            name: displayName,
            language: args.language,
            files: projectFiles.map((f) => ({
              path: f.name,
              bytes: f.content.length,
            })),
            // Inline instruction for the model — having a per-turn
            // reminder in the tool result reduces the failure mode
            // where the agent creates the project and then stops,
            // unsure what to do next.
            nextSteps: userFiles.length === 0
              ? `Stream the project's files as markdown code fences in your next reply, each tagged with the file path: \`\`\`${args.language}:src/App.jsx — they will be written into project '${id}' automatically as you type. End with run_sandbox_project(projectId='${id}') to verify.`
              : `${userFiles.length} files written. Call run_sandbox_project(projectId='${id}') to verify the build.`,
          };
        } catch (e) {
          return {
            error: true,
            message: e instanceof Error ? e.message : String(e),
          };
        }
      },
    },
    // ── Project metadata edits ─────────────────────────────────
    //
    // Lets the agent fix mistakes in project metadata without
    // having to delete + recreate. Common case: a learner says
    // "actually make it React" after the agent already created a
    // plain JS project — we want the agent to call this rather
    // than abandoning the partial work and starting over.
    {
      name: "set_sandbox_project_language",
      description:
        "Change the language of an existing sandbox project. Use when you've created a project in the wrong language (e.g. user asked for React but you started with javascript) — switching the language tells the runtime to use the correct sandbox interpreter on the next run. The files stay where they are; only the project's metadata language field changes.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          language: {
            type: "string",
            description:
              "New language id — same vocabulary as create_sandbox_project.",
          },
        },
        required: ["projectId", "language"],
      },
      auto: false,
      async handler(args: { projectId: string; language: string }) {
        if (!args.projectId || !args.language) {
          return {
            error: true,
            message:
              "set_sandbox_project_language: 'projectId' and 'language' are both required.",
          };
        }
        const deny = enforceProject(ctx.scope, args.projectId);
        if (deny) return { error: true, message: deny };
        try {
          const project = (await invoke("sandbox_load_project", {
            id: args.projectId,
          })) as {
            id: string;
            name: string;
            language: string;
            createdAt?: string;
            updatedAt?: string;
            files: Array<{ name: string; content: string; language: string }>;
          };
          const updated = {
            ...project,
            language: args.language,
            updatedAt: new Date().toISOString(),
            // Re-mint createdAt only if it's missing (legacy
            // projects from before the field existed).
            createdAt: project.createdAt ?? new Date().toISOString(),
          };
          await invoke("sandbox_save_project", { project: updated });
          notifySandboxRefresh();
          focusSandbox(args.projectId);
          return {
            ok: true,
            projectId: args.projectId,
            language: args.language,
          };
        } catch (e) {
          return { error: true, message: String(e) };
        }
      },
    },

    // ── Learner memory ───────────────────────────────────────
    //
    // Cross-session persistence. `remember` is auto (writing a
    // note is reversible + visible via recall); the prompt block
    // built from memory is injected by the host into every
    // system prompt, so saved notes shape future sessions
    // without any tool call.
    {
      name: "remember",
      description:
        "Save a durable note about the learner that should shape FUTURE sessions (preferences like 'wants terse answers', goals like 'building a roguelike', recurring confusions like 'mixes up String and &str'). Don't save session-trivia (file names, current task state) — only facts that stay true tomorrow. The note is injected into your system prompt in every later conversation.",
      parameters: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description:
              "The fact to remember, one sentence, under 280 chars.",
          },
        },
        required: ["note"],
      },
      auto: true,
      async handler(args: { note: string }) {
        if (!args.note || !args.note.trim()) {
          return { error: true, message: "remember: 'note' is required." };
        }
        const { memory, added } = addFact(loadMemory(), args.note);
        if (added) saveMemory(memory);
        return {
          ok: true,
          added,
          totalFacts: memory.facts.length,
          message: added
            ? "Saved. This note will appear in your context in future sessions."
            : "An equivalent note already exists — nothing saved.",
        };
      },
    },
    {
      name: "forget",
      description:
        "Delete a previously-saved learner note (by its exact text). Use when the learner corrects you ('actually I prefer detailed answers now') or asks you to forget something.",
      parameters: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Exact text of the note to delete.",
          },
        },
        required: ["note"],
      },
      auto: true,
      async handler(args: { note: string }) {
        const before = loadMemory();
        const after = removeFact(before, args.note ?? "");
        const removed = after.facts.length < before.facts.length;
        if (removed) saveMemory(after);
        return { ok: true, removed };
      },
    },

    // ── Clarification gate ───────────────────────────────────────
    //
    // The agent calls this when its confidence is low OR when the
    // user's request has multiple valid interpretations and
    // proceeding blind would waste a build. The host (useAiAgent
    // → loop.ts → AgentLoopHooks.requestClarification) intercepts
    // the dispatch BEFORE this handler runs and shows a modal
    // sheet with the question; the user's answer becomes the tool
    // result. This handler is a fallback that fires only when the
    // host doesn't implement the clarification path — it returns
    // an explicit "go ahead with your best guess" payload so the
    // model doesn't stall.
    {
      name: "request_user_input",
      description:
        "Pause and ask the user a clarifying question BEFORE you take an action you're unsure about. Use this when: (a) the request is ambiguous and there are multiple reasonable interpretations, (b) you're about to make a destructive change you can't undo (delete files, drop tables), (c) you've hit an error twice in a row and need direction, (d) your confidence in the next step is below 0.5. ALWAYS prefer asking over guessing on irreversible operations. The user's reply comes back as the tool result.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The exact question to show the user. Be specific — 'should I use TypeScript or JavaScript?' beats 'what language?'.",
          },
          context: {
            type: "string",
            description:
              "Optional short explanation of why you're asking. Shown beneath the question so the user understands what triggered it. Keep under 200 chars.",
          },
        },
        required: ["question"],
      },
      // Auto on purpose — the loop intercepts before the handler
      // runs and shows the sheet. The handler is the fallback for
      // hosts without clarification support.
      auto: true,
      async handler(args: { question: string; context?: string }) {
        return {
          ok: false,
          fallback: true,
          message:
            "No interactive host available to answer. Proceed with your best guess and explain your assumptions in your reply.",
          question: args.question,
          context: args.context,
        };
      },
    },
  ];
}

/// Broadcast that the sandbox project list has changed so
/// `useSandboxProjects` can re-pull from disk. Without this the
/// hook's in-memory state stays stale and the user doesn't see
/// the agent's writes until they navigate away + back to the
/// sandbox.
function notifySandboxRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("libre:sandbox-refresh"));
}

/// Request the app navigate to the sandbox view + activate the
/// given project (and optionally focus a specific file inside
/// it). App.tsx listens, switches the main view, and forwards
/// to the sandbox; the sandbox view in turn calls
/// `setActiveProjectId` + `setActiveFileIdx` so the user lands
/// staring at the file the agent is editing.
function focusSandbox(projectId: string, path?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("libre:sandbox-focus", {
      detail: { projectId, path },
    }),
  );
}

/// Sleep helper for the file-write pill animation frames.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/// Emit a file-write progress event for the chat panel's
/// FileWriteChip pill. In-memory + cheap (no disk, no editor
/// re-pull) — this is how we keep the "agent is writing X" feedback
/// WITHOUT the disk-thrash that the old per-chunk save loop caused.
function emitFileWrite(
  projectId: string,
  path: string,
  language: string,
  bytes: number,
  closed: boolean,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("libre:agent-file-write", {
      detail: { projectId, path, language, bytes, closed },
    }),
  );
}

/// Apply a file write to a sandbox project.
///
/// REWRITTEN (Iter 2, non-destructive co-editing): the old version
/// sliced the content into up to 30 chunks and, per chunk, saved the
/// WHOLE project to disk + fired a full `libre:sandbox-refresh`
/// (re-pull) + a `libre:sandbox-focus` (editor jump) with a 45ms
/// sleep. That was ~30 disk writes + 30 reconcile re-pulls + 30
/// focus events for ONE file write — the documented jitter, and the
/// amplifier of buffer-clobbering (every re-pull could overwrite the
/// user's unsaved edits). Now: one disk save, one refresh, one focus.
/// The "agent is writing" feedback is driven by a few cheap in-memory
/// progress events for the chat pill instead of disk round-trips.
async function liveTypeSave(
  project: {
    id: string;
    name: string;
    language: string;
    files: Array<{ name: string; content: string; language: string }>;
  },
  path: string,
  fullContent: string,
): Promise<void> {
  const inferred = inferLanguage(path);
  let idx = project.files.findIndex((f) => f.name === path);
  if (idx < 0) {
    project.files.push({ name: path, content: "", language: inferred });
    idx = project.files.length - 1;
  }
  project.files[idx] = {
    ...project.files[idx],
    content: fullContent,
    language: project.files[idx].language || inferred,
  };

  const len = fullContent.length;
  // Cheap pill animation: a handful of byte-growth frames so the
  // chat shows the write filling in. No disk, no editor re-pull.
  const frames = len < 160 ? 1 : Math.min(6, Math.max(2, Math.ceil(len / 400)));
  for (let i = 1; i <= frames; i++) {
    const shown = i === frames ? len : Math.round((len * i) / frames);
    emitFileWrite(project.id, path, inferred, shown, false);
    if (i < frames) await sleep(40);
  }

  // The single source of truth lands in ONE save.
  await invoke("sandbox_save_project", { project });
  emitFileWrite(project.id, path, inferred, len, true);
  notifySandboxRefresh();
  focusSandbox(project.id, path);
}

/// Slugify a project name for use as the id. Matches the
/// behaviour the SandboxView's "new project" flow uses so AI-
/// created projects sit alongside hand-created ones without
/// looking different.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/// 5-char random alnum suffix. Enough entropy to avoid collisions
/// across the dozen-ish projects a typical user holds.
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/// Sensible empty-but-runnable starter per language. Used when
/// `create_sandbox_project` is called without an explicit `files`
/// array — the project needs at least one file so the sandbox
/// editor has something to render in its tab strip. The starter
/// content is a TODO placeholder + a `// agent will write here`
/// marker so the user can read what's about to happen even before
/// the model's stream starts.
///
/// Path layout matches what each language's runtime expects:
/// React + Solid need `src/App.{jsx,tsx}`, Svelte needs `App.svelte`,
/// Python wants `main.py`, etc. The path also doubles as the focus
/// target — `focusSandbox()` is called with it so the editor pops
/// open the right tab the moment the project is created.
function defaultStarterFile(language: string): {
  name: string;
  language: string;
  content: string;
} {
  const todo = "// agent is about to write here…\n";
  const pyTodo = "# agent is about to write here…\n";
  const cTodo = "/* agent is about to write here… */\n";
  switch (language) {
    case "react":
      return {
        name: "src/App.jsx",
        language: "javascript",
        content: `${todo}export default function App() {\n  return <div>Loading…</div>;\n}\n`,
      };
    case "reactnative":
      return {
        name: "App.jsx",
        language: "javascript",
        content: `${todo}import { View, Text } from "react-native";\n\nexport default function App() {\n  return <View><Text>Loading…</Text></View>;\n}\n`,
      };
    case "solid":
      return {
        name: "src/App.jsx",
        language: "javascript",
        content: `${todo}export default function App() {\n  return <div>Loading…</div>;\n}\n`,
      };
    case "svelte":
      return {
        name: "src/routes/+page.svelte",
        language: "svelte",
        content: `<!-- agent is about to write here… -->\n<h1>Loading…</h1>\n`,
      };
    case "web":
      return {
        name: "index.html",
        language: "html",
        content: `<!-- agent is about to write here… -->\n<!doctype html>\n<html><body><h1>Loading…</h1></body></html>\n`,
      };
    case "threejs":
      return {
        name: "scene.js",
        language: "javascript",
        content: `${todo}// THREE is preloaded.\nconst scene = new THREE.Scene();\n`,
      };
    case "htmx":
      return {
        name: "index.html",
        language: "html",
        content: `<!-- agent is about to write here… -->\n<!doctype html>\n<html><body><h1>Loading…</h1></body></html>\n`,
      };
    case "astro":
      return {
        name: "src/pages/index.astro",
        language: "astro",
        content: `---\n// agent is about to write here…\n---\n<h1>Loading…</h1>\n`,
      };
    case "typescript":
      return {
        name: "main.ts",
        language: "typescript",
        content: `${todo}console.log("Hello from TypeScript");\n`,
      };
    case "javascript":
    case "bun":
      return {
        name: "main.js",
        language: "javascript",
        content: `${todo}console.log("Hello from JavaScript");\n`,
      };
    case "python":
      return {
        name: "main.py",
        language: "python",
        content: `${pyTodo}print("Hello from Python")\n`,
      };
    case "ruby":
      return {
        name: "main.rb",
        language: "ruby",
        content: `${pyTodo}puts "Hello from Ruby"\n`,
      };
    case "rust":
      return {
        name: "main.rs",
        language: "rust",
        content: `${cTodo}fn main() {\n    println!("Hello from Rust");\n}\n`,
      };
    case "go":
      return {
        name: "main.go",
        language: "go",
        content: `${cTodo}package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello from Go")\n}\n`,
      };
    case "swift":
      return {
        name: "main.swift",
        language: "swift",
        content: `${todo}print("Hello from Swift")\n`,
      };
    case "kotlin":
      return {
        name: "Main.kt",
        language: "kotlin",
        content: `${todo}fun main() {\n    println("Hello from Kotlin")\n}\n`,
      };
    case "java":
      return {
        name: "App.java",
        language: "java",
        content: `${cTodo}public class App {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java");\n    }\n}\n`,
      };
    case "csharp":
      return {
        name: "main.csx",
        language: "csharp",
        content: `${todo}Console.WriteLine("Hello from C#");\n`,
      };
    case "c":
      return {
        name: "main.c",
        language: "c",
        content: `${cTodo}#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C\\n");\n    return 0;\n}\n`,
      };
    case "cpp":
      return {
        name: "main.cpp",
        language: "cpp",
        content: `${cTodo}#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++" << std::endl;\n    return 0;\n}\n`,
      };
    case "zig":
      return {
        name: "main.zig",
        language: "zig",
        content: `${cTodo}const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello from Zig\\n", .{});\n}\n`,
      };
    case "lua":
      return {
        name: "main.lua",
        language: "lua",
        content: `-- agent is about to write here…\nprint("Hello from Lua")\n`,
      };
    case "dart":
      return {
        name: "main.dart",
        language: "dart",
        content: `${cTodo}void main() {\n  print("Hello from Dart");\n}\n`,
      };
    case "elixir":
      return {
        name: "main.exs",
        language: "elixir",
        content: `# agent is about to write here…\nIO.puts("Hello from Elixir")\n`,
      };
    case "haskell":
      return {
        name: "Main.hs",
        language: "haskell",
        content: `-- agent is about to write here…\nmain :: IO ()\nmain = putStrLn "Hello from Haskell"\n`,
      };
    case "scala":
      return {
        name: "Main.scala",
        language: "scala",
        content: `${cTodo}@main def app() = println("Hello from Scala")\n`,
      };
    case "sql":
      return {
        name: "query.sql",
        language: "sql",
        content: `-- agent is about to write here…\nSELECT 'Hello from SQL';\n`,
      };
    case "assembly":
      return {
        name: "main.s",
        language: "assembly",
        content: `# agent is about to write here…\n.global _start\n_start:\n    mov $60, %rax\n    mov $0, %rdi\n    syscall\n`,
      };
    default:
      // Unknown language — fall back to a generic text file so the
      // save still succeeds. The model can overwrite this with the
      // real entrypoint via streamed fenced blocks.
      return {
        name: "main.txt",
        language: "plain",
        content: `agent is about to write here…\n`,
      };
  }
}

/// Filename → language id. Covers the languages the sandbox can
/// actually run; everything else falls through to "plain". This
/// mirrors the helper in `lib/playgroundTemplates.ts` but kept
/// local so this module stays self-contained.
function inferLanguage(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    case ".rb":
      return "ruby";
    case ".swift":
      return "swift";
    case ".kt":
    case ".kts":
      return "kotlin";
    case ".java":
      return "java";
    case ".cs":
      return "csharp";
    case ".c":
    case ".h":
      return "c";
    case ".cpp":
    case ".cc":
    case ".hpp":
      return "cpp";
    case ".zig":
      return "zig";
    case ".lua":
      return "lua";
    case ".dart":
      return "dart";
    case ".scala":
      return "scala";
    case ".hs":
      return "haskell";
    case ".ex":
    case ".exs":
      return "elixir";
    case ".html":
    case ".htm":
      return "html";
    case ".css":
      return "css";
    case ".svelte":
      return "svelte";
    case ".json":
      return "json";
    case ".md":
    case ".markdown":
      return "markdown";
    default:
      return "plain";
  }
}
