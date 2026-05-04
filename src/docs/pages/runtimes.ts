/// Auto-split from the original `src/docs/pages.ts` monolith. See
/// `scripts/split-docs.mjs` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in `./index.ts`.

import type { DocsSection } from "../types";

export const runtimeLayer = `Code execution is the heart of Fishbones. Every lesson with code runs *somewhere* — in an iframe, a Web Worker, a child process, or a hosted compiler proxy. The runtime layer is the dispatcher.

## The dispatch contract

\`src/runtimes/index.ts\` exports two entry points:

\`\`\`ts
// Single-source dispatch — used by lessons whose runnable code is one string
export async function runCode(
  language: LanguageId,
  code: string,
  testCode?: string,
): Promise<RunResult>;

// Multi-file dispatch — used by the workbench
export async function runFiles(
  language: LanguageId,
  files: WorkbenchFile[],
  testCode?: string,
  assets?: WorkbenchAsset[],
): Promise<RunResult>;
\`\`\`

\`runFiles\` picks the right per-language runtime, handing it the file array verbatim. \`runCode\` is the older single-string flavor — for native languages, it's still the path used.

## RunResult — the universal return shape

\`\`\`ts
export interface RunResult {
  logs: LogLine[];                 // console.log / println / printf output
  testResults?: TestResult[];      // when testCode is provided
  error?: string;                  // top-level runtime error
  durationMs: number;
  artifact?: ArtifactPayload;      // optional iframe URL for visual lessons
}

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

export function isPassing(r: RunResult): boolean {
  // No tests + no error = "ran cleanly"; tests = "all green"
}
\`\`\`

Every runtime — whether it's an iframe, a worker, or a Rust proxy — returns this shape. The output pane and grading logic only know about \`RunResult\`.

## In-browser sandboxes

The browser-only languages (anything that can be evaluated client-side without a toolchain on disk):

| Language | Runtime file | How it runs |
|---|---|---|
| \`javascript\` | \`runtimes/javascript.ts\` | Web Worker with eval'd source |
| \`typescript\` | \`runtimes/javascript.ts\` (typescript path) | Babel-transpile then JS worker |
| \`python\` | \`runtimes/python.ts\` | Pyodide (CPython compiled to WASM) |
| \`web\` / \`threejs\` | \`runtimes/web.ts\` | iframe with concatenated HTML/CSS/JS |
| \`react\` | \`runtimes/react.ts\` | iframe with React + Babel + the user's JSX |
| \`reactnative\` | \`runtimes/reactnative.ts\` | iframe with react-native-web + AppRegistry |
| \`svelte\` | \`runtimes/svelte.ts\` | iframe with the official Svelte 5 compiler ESM bundle |
| \`solid\` | routed → \`runReact\` | JSX evaluator covers Solid syntax |
| \`htmx\` / \`astro\` | routed → \`runWeb\` | Plain HTML serving |
| \`bun\` | routed → \`runJavaScript\` | JS sandbox handles syntax-level Bun lessons |
| \`tauri\` | routed → \`runRust\` | Rust toolchain proxy |

## Native runtimes

Anything requiring a real compiler runs out of process. \`runtimes/nativeRunners.ts\` and the per-language files (\`rust.ts\`, \`go.ts\`, \`swift.ts\`) wrap a single Tauri command:

\`\`\`ts
// src/runtimes/rust.ts
export async function runRust(code: string, testCode?: string): Promise<RunResult> {
  const out = await invoke<NativeRunResult>("run_native_code", {
    language: "rust",
    code,
    testCode,
  });
  return adaptToRunResult(out);
}
\`\`\`

\`run_native_code\` on the Rust side:

1. Writes the user's code to a tempdir
2. Spawns the toolchain (\`rustc\`, \`go run\`, etc.)
3. Captures stdout / stderr / exit code
4. Optionally compiles + runs the test harness against the user's module
5. Returns the result

Native runtimes need the toolchain installed locally. The toolchain probe (see [Tauri backend](docs:tauri-backend)) tells the UI when to show a "missing toolchain" banner.

## The web runtime, in detail

\`runtimes/web.ts\` builds an iframe that runs the user's HTML/CSS/JS. It also injects a console shim so logs flow back to the parent page:

\`\`\`ts
// Console patching template (lives at the top of the iframe)
const CONSOLE_SHIM = \`<script>
  ['log', 'warn', 'error', 'info', 'debug'].forEach((level) => {
    const orig = console[level];
    console[level] = (...args) => {
      window.parent.postMessage({
        __fishbones: true, kind: 'console', level, args
      }, '*');
      orig.apply(console, args);
    };
  });
  window.addEventListener('error', (e) => {
    window.parent.postMessage({ __fishbones: true, kind: 'error', message: e.message }, '*');
  });
</script>\`;
\`\`\`

The parent page listens on \`message\`, filters \`__fishbones === true\`, and pushes log lines into the \`RunResult\`.

For lessons with tests, the runtime also injects a tiny \`window.test()\` / \`window.expect()\` harness that runs the test code AFTER the user's code, capturing pass/fail.

## The React Native runtime

\`runtimes/reactnative.ts\` is the most involved. It builds an iframe with:

- \`react-native-web\` (RN components rendered as web components)
- A boot stage tracker (so we can show "Compiling...", "Mounting...", "Crashed" in the floating phone)
- Babel-in-browser to transpile JSX
- An AppRegistry shim that picks up the user's \`App\` export and mounts it
- An error overlay that paints over the phone screen if any phase throws
- Theme tokens read from the parent page's CSS variables (so the phone preview matches your theme)

The output appears inside the **floating phone** — see [Floating phone](docs:floating-phone).

## The Svelte 5 runtime

\`runtimes/svelte.ts\` compiles \`.svelte\` source in the browser:

1. Imports the Svelte 5 compiler from esm.sh
2. Calls \`compile(source, { generate: 'client' })\` — produces a JS module
3. Rewrites bare-spec imports (\`from "svelte"\`) to fully-qualified esm.sh URLs
4. Wraps the resulting JS in a Blob URL and dynamic-imports it
5. Mounts via \`mount(Component, { target })\` from the Svelte 5 runtime

All in the browser. No server-side build step. The same approach scales to SvelteKit (the \`runSvelteKit\` variant adds page-loader stubs).

## Adding a new language

The boilerplate to add a new language:

1. Add the id to \`LanguageId\` in \`src/data/types.ts\`
2. Add metadata (label, color, icon) to \`src/lib/languages.tsx\` \`LANGUAGE_META\`
3. Add a default file (filename + Monaco language) to \`LANG_DEFAULTS\` in \`src/lib/workbenchFiles.ts\`
4. Add a playground starter template to \`src/runtimes/playgroundTemplates.ts\`
5. **If it's a new runtime**, add a file under \`src/runtimes/\` exporting \`runX(...)\`. Wire into the dispatcher in \`runtimes/index.ts\`. **If it's a syntactic variant of an existing runtime** (like \`solid\` → \`react\`), just add a route in \`runFiles\` and skip building the runtime.
6. Switch cases — Sidebar.tsx, BookCover.tsx, PlaygroundView.tsx, etc. each have switches over \`LanguageId\` that need a new case.
`;

export const workbench = `The workbench is the right half of an exercise lesson. It owns the code, the tests, and the run loop.

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│  EditorPane                                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  user.js  test.js  helpers.js                        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │   Monaco editor                                      │   │
│  │                                                      │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  [Hint] [Reset] [Reveal solution]               [Run ▶]     │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  OutputPane                                                  │
│  > log "hello"                                                │
│  ✓ test 1 passed                                              │
│  ✗ test 2 failed: expected 5, got 4                           │
└──────────────────────────────────────────────────────────────┘
\`\`\`

## Multi-file by default

Internally every workbench is a list of \`WorkbenchFile\`:

\`\`\`ts
interface WorkbenchFile {
  name: string;             // tab label; also the filename at runtime
  language: FileLanguage;   // Monaco mode for this file
  content: string;
  readOnly?: boolean;       // greyed-out tab; can't be edited
}
\`\`\`

Single-string lessons (the legacy \`starter\` field on \`ExerciseLesson\`) are converted to a one-element file array on the way in:

\`\`\`ts
// src/lib/workbenchFiles.ts
export function deriveStarterFiles(lesson: ExerciseLesson): WorkbenchFile[] {
  if (lesson.files && lesson.files.length > 0) {
    return lesson.files.map(f => ({ ...f }));
  }
  // Fallback: synthesize a single file from \`lesson.starter\`
  const def = LANG_DEFAULTS[lesson.language] ?? { name: "user.txt", language: "plaintext" };
  return [{
    name: def.name,
    language: def.language,
    content: lesson.starter ?? "",
  }];
}
\`\`\`

\`LANG_DEFAULTS\` maps each \`LanguageId\` to a default filename + Monaco language. This is also what fixed the syntax-highlighting bug for the Bun course — see the [DRY findings](docs:dry-findings) page.

## State + persistence

\`useWorkbenchFiles(lesson)\` is the hook that owns the editor state for a lesson.

\`\`\`ts
const { files, setFiles, reset, isPristine } = useWorkbenchFiles(lesson);
\`\`\`

It:

1. Hydrates from \`localStorage\` keyed on \`workbench:files:<courseId>:<lessonId>\` if present, otherwise from \`deriveStarterFiles(lesson)\`.
2. Debounces persistence — saves to localStorage 400 ms after the last edit, plus a final save on unmount.
3. Exposes \`reset()\` — restores starter, clears localStorage entry.

The pattern is duplicated in \`usePlaygroundFiles\` (which keys by \`playground:files:<language>\` instead of by lesson). Both should compose around a single \`useLocalStorage\` + \`useDebouncedCallback\` — see [DRY findings](docs:dry-findings) item 1 + 2.

## Monaco wiring

Monaco is loaded via \`@monaco-editor/react\`. Bun-specific (and other custom) language wiring happens once at app boot:

\`\`\`ts
// src/lib/monaco/setup.ts
import * as monaco from "monaco-editor";
import svelteGrammar from "./svelte";

export function setupMonaco() {
  monaco.languages.register({ id: "svelte" });
  monaco.languages.setMonarchTokensProvider("svelte", svelteGrammar);

  // Theme regeneration based on the active app theme. Light app
  // themes (ayu-light, catppuccin-latte) intentionally point at
  // the dark Monaco theme — see MONACO_THEME_BY_APP_THEME.
  monaco.editor.defineTheme("fishbones-dark", FISHBONES_DARK_THEME);
  monaco.editor.defineTheme("fishbones-ayu-mirage", AYU_MIRAGE_THEME);
}
\`\`\`

The themes are generated from the same color tokens the rest of the app uses — see [Theme system](docs:theme).

## Run flow

\`\`\`
[Run] click
  ↓
EditorPane.onRun(files)
  ↓
parent: runFiles(language, files, testCode, assets)
  ↓
runtimes/index.ts dispatches to per-language runtime
  ↓
RunResult (logs + testResults + error)
  ↓
OutputPane renders
  ↓
if isPassing(result):
  markComplete(courseId, lessonId)   →  invoke('mark_completion')
  awardXp(...)
  bumpStreak(...)
\`\`\`

## Reveal solution

The **Solution** button calls \`deriveSolutionFiles(lesson)\` (analogous to \`deriveStarterFiles\`) and \`setFiles(solutionFiles)\`. The lesson is NOT auto-marked complete on reveal — the learner still has to run the code (which then passes trivially) to get credit. This is intentional: it makes "I revealed the solution" visible in the completion timestamp pattern (you can see when you'd looked something up vs. solved it cold).

## Pop-out

The header has a "pop out" button. Clicking it opens a dedicated Tauri window containing only the workbench. The two windows stay in sync via a \`makeBus\` helper in \`src/lib/workbenchSync.ts\` that picks the right channel:

- **In Tauri** — \`@tauri-apps/api/event\` (window-to-window events)
- **In a browser dev environment** — \`BroadcastChannel\` (no Tauri available)

\`\`\`ts
// Message shape
type WorkbenchMsg =
  | { kind: 'files'; files: WorkbenchFile[] }
  | { kind: 'run-result'; result: RunResult };
\`\`\`

Each window emits on its bus when files change; the other window listens and replaces its state. The same pattern (a separate bus, same shape) powers the floating phone pop-out — \`src/lib/phonePopout.ts\` is essentially a parallel implementation that should consolidate. See [DRY findings](docs:dry-findings).
`;

export const playgroundDoc = `The playground is a free-form code editor — no lesson, no tests, just a Monaco pane that runs whatever you type.

## What you can do

- Pick a language from a dropdown
- Get a starter template loaded
- Edit, run, see output
- Switch languages — your last buffer per language is remembered

It's "open the editor, hack on something" — useful for noodling on syntax, testing a snippet from Stack Overflow, or sketching out something before turning it into a lesson.

## The state model

\`usePlaygroundFiles(language)\` is the equivalent of \`useWorkbenchFiles\` but keyed by *language* instead of by lesson. Each language has its own buffer:

\`\`\`ts
// localStorage key
\`playground:files:javascript\`
\`playground:files:rust\`
\`playground:files:python\`
\`\`\`

Switching languages swaps the visible buffer but keeps the others on disk. You can be mid-experiment in five languages simultaneously.

## Templates

\`src/runtimes/playgroundTemplates.ts\` is the registry of starter content per language. Each entry is either a single file or a multi-file array:

\`\`\`ts
// Single-file
javascript: {
  filename: "user.js",
  fileLanguage: "javascript",
  content: \`console.log("Hello, world!");\\n\`,
},

// Multi-file
web: {
  filename: "index.html",
  fileLanguage: "html",
  content: WEB_TEMPLATE_FILES[0].content,
  files: WEB_TEMPLATE_FILES,
},
\`\`\`

When you switch to a language for the first time (no localStorage entry yet), the template is loaded. After that, your edits persist.

## Run loop

Same as the workbench — \`runFiles(language, files)\` from \`src/runtimes/index.ts\`. The playground doesn't pass a \`testCode\`, so the result has logs / errors but no test rows.

## Cmd+Enter

Cmd+Enter (Ctrl+Enter on Linux/Windows) is the run shortcut — registered as a Monaco keybinding. The same shortcut works in workbench exercises.

## Why it's a separate view

You could imagine the playground being a *special lesson*. It's not, because:

- It has no lesson body
- It has no completion semantics
- The state lives by language, not by lesson id
- The dropdown is a UI affordance, not a lesson field

Keeping it separate also makes the dispatcher cleaner — the lesson view doesn't have a "no lesson" branch.
`;

export const phoneFloating = `Some lessons render to a phone-shaped frame instead of an inline iframe — specifically, React Native and Svelte mobile lessons. Why? Because:

- React Native components (\`<View>\`, \`<Text>\`, \`<ScrollView>\`) are designed for a phone-sized viewport. Showing them at desktop width looks wrong.
- The mental model "this code becomes a mobile app" is only meaningful when the preview *looks like a phone*.
- Touch interactions (long-press, swipe) make more sense in a portrait frame.

## What it looks like

A floating, draggable, resizable phone-shaped pane that sits on top of the workbench. The phone has a status bar, a notch, a home bar — visual cues that this is a mobile preview, not just a small browser.

## How it's wired

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│  src/runtimes/reactnative.ts                                 │
│   - Builds the iframe HTML                                   │
│   - Includes react-native-web + Babel + AppRegistry shim     │
│   - Reads CSS theme tokens from the parent's :root            │
│                       │                                      │
│                       ▼                                      │
│  PreviewKind: 'reactnative' on the RunResult                 │
│                       │                                      │
│                       ▼                                      │
│  src/components/PhonePopout/PhonePopoutView.tsx              │
│   - Renders the iframe inside a phone bezel                  │
│   - Lives in its own popout window (lib/phonePopout.ts)      │
│   - Main editor pushes preview URLs over a window-bus        │
│                                                              │
│  src/components/PhoneFrame/PhoneFrame.tsx                    │
│   - The bezel SVG + status bar + home bar                    │
└──────────────────────────────────────────────────────────────┘
\`\`\`

## Boot stages

The React Native runtime tracks compile/mount stages so the user sees what's happening:

\`\`\`ts
type BootStage =
  | 'loading-runtime'   // Babel + react-native-web bundle download
  | 'compiling'         // user JSX → JS
  | 'mounting'          // AppRegistry.runApplication
  | 'running'           // success — iframe shows the app
  | 'crashed';          // any phase threw
\`\`\`

Each stage transitions paint a different overlay:

- \`loading-runtime\` — full-phone shimmer with "Setting up React Native..."
- \`compiling\` — same shimmer, "Compiling your code..."
- \`crashed\` — red overlay with the error + stack

When \`running\`, the user's app is visible and the overlay is gone.

## Dev tools panel

\`src/components/Output/ReactNativeDevTools.tsx\` adds a small drawer to the floating phone:

- Toggle dark mode (writes a different theme token set into the iframe)
- Resize buttons for common phone sizes (iPhone 14, Pixel 7, iPhone SE)
- Reload (re-runs the user's code without re-fetching the runtime bundle)
- Console — the iframe's console output mirrored into the panel

## Pop out

Just like the workbench, the floating phone has a pop-out button. \`src/lib/phonePopout.ts\` opens a dedicated Tauri window containing only the phone. The two stay in sync via a Tauri-event bus (or BroadcastChannel in dev).

The phonePopout and workbenchSync helpers are nearly identical — both wrap "is this Tauri or a browser?" + a message bus. Consolidating them into one \`makePopoutBus\` helper is a moderate-payoff refactor. See [DRY findings](docs:dry-findings) item 9.

## Theme integration

The preview iframe reads the parent page's CSS variables on boot and copies them into its own \`:root\`:

\`\`\`ts
function currentThemeColors(): ReactNativePreviewTheme {
  if (typeof document === "undefined") return undefined;
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bgPrimary:   get("--color-bg-primary"),
    bgSecondary: get("--color-bg-secondary"),
    textPrimary: get("--color-text-primary"),
    // ...
  };
}
\`\`\`

When the user switches the app theme, the next \`runFiles\` call picks up the new palette. The phone preview matches without a manual refresh.
`;

export const RUNTIMES_SECTION: DocsSection = {
  id: "runtimes",
  title: "Runtime layer",
  pages: [
    { id: "runtime-layer", title: "How code runs", tagline: "Dispatcher, sandboxes, native runtimes", body: runtimeLayer },
    { id: "workbench", title: "The workbench", tagline: "Multi-file editor, run loop, pop-out", body: workbench },
    { id: "playground", title: "The playground", tagline: "Free-form editor sandbox", body: playgroundDoc },
    { id: "floating-phone", title: "The floating phone", tagline: "React Native + Svelte mobile preview", body: phoneFloating },
  ],
};
