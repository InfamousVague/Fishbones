/// Auto-split from the original `src/docs/pages.ts` monolith. See
/// `scripts/split-docs.mjs` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in `./index.ts`.

import type { DocsSection } from "../types";

export const welcome = `Fishbones is an offline-first **interactive coding course platform** that runs as a desktop app. The shell is **Tauri 2** (Rust backend + a system webview), the frontend is **React + TypeScript**, and the entire learning surface — courses, lessons, code execution, AI chat — happens locally on your machine.

The app's three goals, in priority order:

1. **Run real code, instantly.** Every supported language has an in-browser sandbox or a native toolchain probe. No "click here to start a hosted REPL" — the editor runs your code.
2. **Stay offline.** Once a course is downloaded, every lesson, hint, solution, and test runs without a network round-trip. The AI assistant defaults to **local Ollama**; the cloud path (Anthropic) is opt-in.
3. **Bring your own content.** Courses ship as portable \`.fishbones\` archives. You can import PDFs, scrape docs sites, generate challenge packs, or hand-author markdown — all from inside the app.

## What's in the box

\`\`\`
┌──────────────────────────────────────────────────────────────────┐
│  Tauri shell (window, menus, FS, command channel)                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  React frontend                                          │    │
│  │  ┌────────────────────────────────────────────────────┐  │    │
│  │  │  Sidebar  │  Main pane  │  Workbench (Monaco)     │  │    │
│  │  │  Library  │  Lesson     │  Editor + Run + Tests   │  │    │
│  │  │  Docs     │  Quiz       │  Floating phone preview │  │    │
│  │  │  Profile  │  Playground │  AI chat panel          │  │    │
│  │  └────────────────────────────────────────────────────┘  │    │
│  │  src/runtimes/  — in-browser sandboxes (web/react/svelte) │    │
│  │  src/ingest/    — LLM-driven course generation pipeline   │    │
│  └──────────────────────────────────────────────────────────┘    │
│  src-tauri/  — Rust commands: courses, completions, AI proxy,    │
│                ingest harness, toolchain probes, file ops         │
└──────────────────────────────────────────────────────────────────┘
\`\`\`

## How to read these docs

The left sidebar groups pages into sections. Each page is self-contained — no required reading order — but the sections are roughly stacked by abstraction level: getting started → core concepts → subsystems → reference.

If you're new, start with **Architecture overview** then **The course format**. If you've used Fishbones before and want to understand a specific piece, skip straight to its page.

Code samples are real, not pseudocode. File paths are relative to the project root. When something is opinionated, the doc says *why*.
`;

export const installing = `Fishbones runs on macOS, Linux, and Windows. The dev workflow is the standard Tauri loop.

## Prerequisites

- **Node 20+** (or Bun 1.1+)
- **Rust 1.78+** (with the default toolchain)
- **Platform-specific webview deps** — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

\`\`\`bash
# Clone
git clone <your-fork-url> Fishbones
cd Fishbones

# Install JS deps
bun install   # or: npm install
\`\`\`

## Running in dev mode

Two terminals during development — one for Vite, one for Tauri:

\`\`\`bash
# Terminal 1 — frontend hot-reload server
bun run dev

# Terminal 2 — Tauri shell (auto-attaches to the Vite server)
bun run tauri:dev
\`\`\`

Or one-shot via the combined script:

\`\`\`bash
bun run tauri:dev
\`\`\`

The Tauri shell injects a global \`window.__TAURI_INTERNALS__\` that lets the React side call Rust commands via \`invoke('cmd_name', args)\`. That's the only IPC surface — no REST, no WebSockets, no Electron-style \`ipcRenderer\` (Tauri's design is closer to a function call).

## Building a release

\`\`\`bash
bun run tauri:build
\`\`\`

Output lands in \`src-tauri/target/release/bundle/\` — a \`.dmg\` on macOS, an \`AppImage\`/\`.deb\` on Linux, an \`.msi\` on Windows. Each bundle includes the bundled \`.fishbones\` archives in \`Resources/resources/bundled-packs/\`, which seed into the user's courses directory on first launch (see [Bundled packs](docs:bundled-packs)).

> [!NOTE]
> The first build downloads the Rust dependency tree (~400 MB) and compiles the WebKit / WebView2 wrapper. Expect 5–10 min on a fast machine. Subsequent builds are incremental.

## Toolchains for native runtimes

Several courses (Rust, Go, Swift, Python, Java) need the corresponding toolchain installed locally. Fishbones probes for them on launch and shows a banner in the playground if missing:

\`\`\`bash
bun run setup:toolchains
\`\`\`

This runs \`scripts/setup-e2e-toolchains.sh\` — installs every native toolchain Fishbones can drive. It's idempotent; re-running it just confirms each tool is on PATH.

## Tests

\`\`\`bash
bun test                   # unit + component tests (Vitest)
bun run test:content        # validates every bundled-pack archive parses
bun run test:e2e           # Playwright end-to-end (drives the running shell)
\`\`\`

The e2e suite needs the toolchain setup script first.
`;

export const firstCourse = `The Library is the entry point — it lists every course on disk, including the ones bundled with the app. On first launch, Fishbones extracts the bundled \`.fishbones\` archives into your data dir and Library opens with them already populated.

## Pick a course

Click any cover. The course's first lesson opens in the main pane and the sidebar tree expands to show every chapter and lesson.

The cover bar across the top of the sidebar is the **course carousel** — your recently-opened courses. Clicking one switches the sidebar tree to that course. The active course is the one whose tree is showing; the active *lesson* (highlighted) is whichever lesson the main pane is rendering.

## The three lesson kinds

Every lesson is one of three things:

1. **Reading** — a prose explanation rendered as styled markdown, with code blocks (Shiki-highlighted), callouts, and optional inline-sandbox playgrounds for live code experiments.
2. **Exercise** — a Monaco editor with starter code, a test suite, hints, and a reveal-solution affordance. Hitting **Run** executes the code in an in-browser sandbox (or via a Rust subprocess for native languages) and grades it against the tests.
3. **Quiz** — multiple-choice questions with explanations.

The fourth kind, **mixed**, is a reading lesson that has an exercise sub-section. Less common but useful when the prose and the practice are tightly coupled.

## The workbench

For exercise lessons, the right half of the screen is the **workbench** — Monaco + run controls + console output + (sometimes) a phone preview. The toolbar:

- **Hint** — surfaces the next hint. Hints are progressive — most lessons have 3, each more revealing than the last.
- **Reset** — restores the starter code (only enabled when you've changed it).
- **Solution** — reveals the reference answer.
- **Run** — executes your code against the test suite. Pass/fail lands in the output pane below.

When you pass, Fishbones marks the lesson complete and updates your XP / streak counters. The next lesson is one click away — or auto-advance via the bottom-right "Next" button.

## Settings to know about

\`Cmd+,\` (or **Settings** in the sidebar) opens the settings dialog. The few settings actually worth touching:

- **Theme** — light / dark / system (defaults to system)
- **AI assistant** — local (Ollama) or cloud (Anthropic) backend
- **Sign in** — enables cloud sync of progress and stats across machines
- **Clear courses / cache** — destructive but useful when something gets wedged

## Pop out

The workbench has a **pop-out** button (top-right of the editor pane). It opens the editor + console + phone preview as a separate Tauri window, leaving the lesson body taking the full main pane. Useful on multi-monitor setups: one screen for prose, the other for code.

The two windows stay synchronized — typing in either updates both — via Tauri events under the hood. See [Cross-window sync](docs:cross-window-sync).
`;

export const GETTING_STARTED_SECTION: DocsSection = {
  id: "getting-started",
  title: "Getting started",
  pages: [
    { id: "welcome", title: "Welcome to Fishbones", tagline: "What this app is and what to expect", body: welcome },
    { id: "installing", title: "Installing", tagline: "Dev setup, building a release", body: installing },
    { id: "first-course", title: "Your first course", tagline: "The 5-minute tour", body: firstCourse },
  ],
};
