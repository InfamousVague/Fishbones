/// Auto-split from the original `src/docs/pages.ts` monolith. See
/// `scripts/split-docs.mjs` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in `./index.ts`.

import type { DocsSection } from "../types";

export const archOverview = `Fishbones has four layers. Each one has a single responsibility and talks to the next via a narrow, typed surface.

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│  Layer 4 — UI (React components)                              │
│             src/components/* + src/App.tsx                    │
│                          ▲                                    │
│                          │  hooks consume state               │
├──────────────────────────────────────────────────────────────┤
│  Layer 3 — State + Domain logic                               │
│             src/hooks/*  +  src/lib/*  +  src/data/*          │
│                          ▲                                    │
│                          │  invoke('cmd_name', args)           │
├──────────────────────────────────────────────────────────────┤
│  Layer 2 — Tauri command bridge                               │
│             src-tauri/src/*.rs                                 │
│             courses, completions, ai, ingest, files,           │
│             toolchain probe, llm proxy                          │
│                          ▲                                    │
│                          │  std::process / sqlite / fs         │
├──────────────────────────────────────────────────────────────┤
│  Layer 1 — Operating system                                   │
│             FS, network, subprocesses, GPU, audio              │
└──────────────────────────────────────────────────────────────┘
\`\`\`

## Layer 1 — OS

Tauri opens one or more webviews (\`WKWebView\` on macOS, \`WebKitGTK\` on Linux, \`WebView2\` on Windows) and exposes the OS to Rust. Everything below the webview is "normal" Rust — \`std::fs\`, \`reqwest\`, \`rusqlite\` (sqlite for completions/recents/stats), \`std::process::Command\` for spawning toolchains.

> [!NOTE]
> Tauri's WebView is **not** Chromium. WebKit and WebView2 have minor differences from Chrome (mostly around CSS / font rendering / experimental APIs). Fishbones tests on all three — the few divergences live in feature-detected branches, not browser-sniffing.

## Layer 2 — Tauri commands

Rust functions tagged \`#[tauri::command]\` are callable from the frontend via \`invoke('command_name', argsObject)\`. These are the only inputs the frontend can give to Rust — no shared memory, no foreign function calls. The full command surface lives in \`src-tauri/src/\`:

- \`courses.rs\` — read/write course archives, list installed courses, hydrate course bodies
- \`completions.rs\` — track lesson completions and timestamps in sqlite
- \`ai_chat.rs\` — proxy to local Ollama or Anthropic API; streams tokens back via Tauri events
- \`ingest.rs\` — orchestrates the LLM-driven course generation pipeline
- \`toolchain.rs\` — probes for installed compilers/runtimes (rustc, go, python3, etc.)
- \`stats.rs\` — XP, streak, daily aggregates
- \`fs_ops.rs\` — file picker, archive open/save, drag-drop

Each command takes typed arguments (Serde-deserialized from JSON) and returns either a typed value or an error. The error surfaces as a thrown \`Error\` on the JS side.

## Layer 3 — State + domain logic

Domain types live in \`src/data/types.ts\` — \`Course\`, \`Chapter\`, \`Lesson\` (a discriminated union over \`kind\`), \`WorkbenchFile\`, \`LanguageId\`, \`FileLanguage\`, etc. Both the Rust side and the TypeScript side serialize to the same JSON shape so a course written by Rust is readable by TS without a translation step.

Hooks in \`src/hooks/\` orchestrate state:

- \`useCourses\` — loads installed courses, exposes \`refresh()\` to re-scan
- \`useProgress\` — sqlite completion history, mark-complete mutations
- \`useRecentCourses\` — local-storage-backed "last opened at" timestamps
- \`useWorkbenchFiles\` / \`usePlaygroundFiles\` — multi-file editor state with debounced persistence
- \`useAiChat\` — chat history, streaming-message state, backend probe + setup flows
- \`useIngestRun\` — runs a course-generation pipeline, surfacing events to the UI
- \`useStreakAndXp\` / \`useToolchainStatus\` / \`useFishbonesCloud\` — supporting state

\`src/lib/\` contains pure utilities — file helpers, language metadata, Monaco wiring, cross-window message buses.

## Layer 4 — UI

The component tree is rooted at \`App.tsx\`. \`App\` owns the *outermost* state (which view is showing, which course is open, which lesson is selected, which dialogs are open) and feeds it down via props. There's no global store (no Redux, no Zustand) — the hooks colocate the state with the data, and components receive only what they need.

The main pane renders one of:

- **Library** — course catalog
- **Playground** — free-form editor sandbox
- **Profile** — XP / streak / progress dashboard
- **Docs** — these pages
- **Lesson view** — the actual learning surface (reading / exercise / quiz / mixed)
- **Empty state** — "pick a lesson"

The sidebar is global — present in every view. The top bar is global. Dialogs (settings, import, AI chat) are portaled overlays.

## How a learner action becomes a state change

Real example: clicking **Run** in an exercise lesson.

1. \`Workbench\` (component) → onClick handler in \`EditorPane\`
2. \`EditorPane\` calls \`onRun(files)\` — passed in by parent
3. Parent (App tree) calls \`runFiles(language, files, testCode)\` from \`src/runtimes/index.ts\`
4. \`runFiles\` dispatches to the right runtime — \`runWeb\`, \`runReact\`, \`runJavaScript\`, etc.
5. The runtime evaluates the code in an iframe / Web Worker / Rust subprocess
6. Returns a \`RunResult\` — logs, test results, error, durationMs
7. \`OutputPane\` renders the result. If passing, parent calls \`markComplete(courseId, lessonId)\`
8. \`markComplete\` invokes \`mark_completion\` Tauri command (writes to sqlite)
9. \`useProgress\` re-fetches completions; sidebar lights up the new green dot

The whole loop is plain function calls — no event bus, no observable. Easy to trace, easy to test.
`;

export const tauriBackend = `The Rust side is small and stratified. It exposes ~30 commands across 8 modules. Each module is a thin wrapper over a system resource — sqlite, the filesystem, an HTTP client, a child process.

## Module map

\`\`\`
src-tauri/src/
├── main.rs                     # the tauri::Builder + command registry
├── courses.rs                  # course archives: open, save, list, seed
├── completions.rs              # sqlite-backed completion tracking
├── ai_chat.rs                  # ollama / anthropic proxy + streaming
├── ingest.rs                   # LLM-driven course generation pipeline
├── toolchain.rs                # probe rustc / go / python3 / etc.
├── stats.rs                    # XP, streak, daily aggregates
├── fs_ops.rs                   # native file picker, drag-drop, archive read
└── settings.rs                 # ~/.config/fishbones/settings.json
\`\`\`

## How a command is exposed

\`\`\`rust
// src-tauri/src/completions.rs

#[tauri::command]
pub async fn list_completions(app: tauri::AppHandle) -> Result<Vec<Completion>, String> {
    let conn = open_db(&app).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT course_id, lesson_id, completed_at FROM completions ORDER BY completed_at DESC")
        .map_err(|e| e.to_string())?;
    // ...
    Ok(rows)
}
\`\`\`

Then registered in \`main.rs\`:

\`\`\`rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            completions::list_completions,
            completions::mark_completion,
            // ... ~30 more
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
\`\`\`

The frontend calls it via:

\`\`\`ts
import { invoke } from "@tauri-apps/api/core";

const completions = await invoke<Completion[]>("list_completions");
\`\`\`

> [!TIP]
> Type the return value at the call site (\`invoke<Completion[]>\`). Tauri doesn't auto-generate TypeScript types from Rust — type drift is a real risk. \`src/data/types.ts\` is the single source of truth; both sides deserialize against it.

## SQLite is the persistence layer

Completions, recents, stats, daily aggregates — all sqlite. The DB lives at \`<app-data>/fishbones.sqlite\`. The schema is created idempotently at startup (no separate migration step yet — the schema is small enough that \`CREATE TABLE IF NOT EXISTS\` suffices).

\`\`\`sql
-- completions: one row per (course, lesson) the user has finished
CREATE TABLE IF NOT EXISTS completions (
    course_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, lesson_id)
);

-- daily_xp: aggregated XP per UTC day
CREATE TABLE IF NOT EXISTS daily_xp (
    day TEXT PRIMARY KEY,
    xp INTEGER NOT NULL DEFAULT 0
);
\`\`\`

The Rust crate is \`rusqlite\` with the \`bundled\` feature so we ship our own libsqlite3 — no host-OS sqlite version drift.

## Course storage on disk

Courses live as **directories**, not bundles, on disk. The bundle is just the wire format:

\`\`\`
<app-data>/courses/
├── javascript-crash-course/
│   ├── course.json
│   └── cover.png         (optional)
├── bun-complete/
│   └── course.json
└── seeded-packs.json     (marker — see Bundled packs)
\`\`\`

\`course.json\` is the canonical course shape (\`Course\` from \`data/types.ts\`). Importing a \`.fishbones\` archive unzips it into a directory; exporting zips the directory back.

## The AI proxy

\`ai_chat.rs\` knows two backends:

- **Ollama** — local; talks HTTP to \`http://127.0.0.1:11434\` (default)
- **Anthropic** — cloud; talks HTTP to \`https://api.anthropic.com\` with the user's API key

The frontend never sees raw HTTP — it calls \`ai_chat_send\` with a message + context, and Rust streams completion tokens back via \`tauri::Window::emit\` events. The streaming is a Tauri event channel, not a return value, so the UI can render tokens as they arrive.

\`\`\`rust
// Pseudocode of the streaming pattern
#[tauri::command]
pub async fn ai_chat_send(window: Window, msg: String) -> Result<(), String> {
    let mut stream = backend.stream(msg).await?;
    while let Some(token) = stream.next().await {
        window.emit("ai-chat-token", token?)?;
    }
    window.emit("ai-chat-done", ())?;
    Ok(())
}
\`\`\`

On the JS side, \`useAiChat\` listens for those events and appends to the active message buffer.

## The toolchain probe

\`toolchain.rs\` runs \`<tool> --version\` for each language Fishbones can drive natively (Rust, Go, Swift, Python, Java, etc.). The result is cached for 5 minutes so we don't pay the spawn cost on every component re-render.

\`\`\`rust
#[tauri::command]
pub async fn probe_language_toolchain(language: String) -> Result<ToolchainStatus, String> {
    // ... spawns the binary's --version, parses, returns ToolchainStatus
}
\`\`\`

The frontend calls this from \`useToolchainStatus\` and renders a banner if the tool is missing — with a one-click "install" button on supported platforms (rustup-init, brew, etc.).
`;

export const reactFrontend = `The frontend is a single-page React app, built with Vite, served from \`/\` by the Tauri shell. There's no routing library — the app uses a \`view\` state machine in \`App.tsx\`.

## Entry point

\`\`\`tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
\`\`\`

\`App.tsx\` is the one file with global state — every other component is a leaf or near-leaf with prop-driven rendering.

## State machine: which view is showing

\`\`\`tsx
const [view, setView] = useState<
  "courses" | "profile" | "playground" | "library" | "docs"
>("courses");
\`\`\`

The render tree picks the main-pane component:

\`\`\`tsx
{view === "profile"    ? <ProfileView />
: view === "playground" ? <PlaygroundView />
: view === "docs"       ? <DocsView />
: view === "library"    ? <CourseLibrary />
: courses.length === 0  ? <WelcomePrompt />
: openTabs.length === 0 ? <CourseLibrary inline />
: activeLesson          ? <LessonView />
                        : <EmptyPickALesson />}
\`\`\`

The \`view\` is set by sidebar nav clicks. Selecting a lesson resets \`view\` to \`"courses"\` so the lesson view actually shows up — otherwise clicking a sidebar lesson while on Settings would do nothing visible.

## The component tree

\`\`\`
<App>
  <TopBar/>                         — global; streak chip, profile menu, sign-in
  <main>
    <Sidebar/>                      — global; course tree, primary nav, carousel
    <main-pane>                     — the view-switched area above
      <LessonView>                  — when a lesson is open
        <LessonReader/>             — markdown body w/ enrichment + popovers
        <Workbench>                 — exercise lessons only
          <EditorPane/>             — Monaco + tabs + run button
          <OutputPane/>             — console + test results
          <PhonePopout/>            — RN / Svelte mobile preview window
        </Workbench>
        <QuizView/>                 — quiz lessons
      </LessonView>
    </main-pane>
  </main>
  <Dialogs/>                        — settings, import, AI chat (portaled)
  <CommandPalette/>                 — Cmd+K
  <AiAssistant/>                    — floating chat button + panel
</App>
\`\`\`

## Component conventions

- **One component per directory.** Each component lives in \`src/components/<Name>/<Name>.tsx\` with a sibling \`<Name>.css\`.
- **Props are typed inline** — no separate \`<Name>.types.ts\`.
- **CSS class names use the \`fishbones__\` BEM-style prefix** to avoid collision with library-provided classes (the icon library, for instance).
- **No global stores.** State lives in hooks; data flows down as props, callbacks flow up.

## Hooks colocate state with data

Every meaningful piece of state has a hook in \`src/hooks/\`. Hooks own:

- The data structure
- The persistence layer (sqlite via Tauri, localStorage, or in-memory)
- The mutators
- Any debouncing / cancellation / re-fetch logic

\`useCourses()\` is the canonical example:

\`\`\`ts
export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await invoke<Course[]>("list_courses");
    setCourses(list);
    setLoaded(true);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { courses, loaded, refresh };
}
\`\`\`

A consumer doesn't know whether the data came from sqlite, localStorage, or a fetch — they just call the hook.

## Theme

Three themes — \`light\`, \`dark\`, \`system\` (which follows OS-level preference). Each writes a \`data-theme\` attribute on the document root which CSS variables key off:

\`\`\`css
[data-theme="dark"] {
  --color-bg-primary: #0b0b10;
  --color-text-primary: #f5f5f7;
  /* ... */
}

[data-theme="light"] {
  --color-bg-primary: #ffffff;
  --color-text-primary: #15151c;
  /* ... */
}
\`\`\`

Components reference the variables, not the hex values. Adding a new theme is editing one CSS file (\`src/theme/themes.css\`). Monaco's editor theme is regenerated to match — see [Theme system](docs:theme).
`;

export const ARCHITECTURE_SECTION: DocsSection = {
  id: "architecture",
  title: "Architecture",
  pages: [
    { id: "overview", title: "Overview", tagline: "The four layers", body: archOverview },
    { id: "tauri-backend", title: "The Tauri backend", tagline: "Rust commands, sqlite, and the AI proxy", body: tauriBackend },
    { id: "react-frontend", title: "The React frontend", tagline: "View state, components, hooks", body: reactFrontend },
  ],
};
