# Kata

A desktop app for learning to code through books and guided exercises.
Mac + Windows V1 (Tauri). Phone + Watch companions planned for later.

## What it is

Kata turns technical books into interactive courses. You read prose, you try code,
the editor runs it, unit tests grade it, you level up. Multi-language out of the
gate (JavaScript, TypeScript, Python, Rust, Swift) so a learner can work through
*The Rust Programming Language* one week and SICP the next.

Content is ingested with LLM assistance: take a book (legally owned), feed it to
a pipeline that structures chapters into lessons with inline code blocks and
scaffolded exercises with hidden tests.

## Decisions locked in

| Area | Choice |
|---|---|
| **Name** | Kata |
| **Platforms V1** | Mac + Windows (Tauri) |
| **Platforms later** | iPhone, Apple Watch companions |
| **Languages V1** | JavaScript / TypeScript, Python, Rust, Swift |
| **Execution** | Hybrid — in-browser sandboxes first (Pyodide, Web Workers, WASM), Tauri subprocess fallback for local toolchains |
| **Content ingest** | LLM-assisted pipeline (book → structured JSON course) |
| **Lesson format** | Mix of book-like reading + optional exercise mode on the same content |
| **Progress** | Chapter completion **+** streak days **+** XP / levels / badges **+** mastery tracking |
| **Multi-course** | Tabs across the top with a "browse more" view — not every course needs to be in a tab |
| **Evaluator** | Unit-test style |
| **Account / sync** | Server on mattssoftware.com with OAuth |
| **Editor** | Monaco (VS Code's editor) |
| **Syntax highlighting (reading)** | Shiki (already in `@mattmattmattmatt/base`) |
| **Layout** | Course sidebar + vertical split editor/output (not rigid 3-panel Codecademy) |
| **Authoring V1** | Consumer only. Full in-app authoring planned later. |

## Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Kata                                          streak:7  xp:420      [acct]│
├─────────────────┬─────────────────────────────────────────────────────────┤
│ ▸ Rust Book     │  ◇ Tabs: [Rust Book] [SICP]  [+ browse]                 │
│   Ch 4 · Owner..│ ┌─────────────────────────────────────────────────────┐ │
│   ● Ch 5        │ │  Lesson: Structs and Ownership                      │ │
│                 │ │                                                     │ │
│ ▸ SICP          │ │  A struct groups related data...                    │ │
│   Ch 1 · Proced.│ │                                                     │ │
│   ● Ch 2 · Abs  │ │  ┌─────────────────────────────────────────────────┐│ │
│                 │ │  │ struct User { name: String, age: u32 }          ││ │
│ [+ browse books]│ │  └─────────────────────────────────────────────────┘│ │
│                 │ ├─────────────────────────────────────────────────────┤ │
│ settings        │ │  Editor  [run] [reset]              Output / tests  │ │
│                 │ │  ┌───────────────────────┬───────────────────────┐ │ │
│                 │ │  │                       │                       │ │ │
│                 │ │  │  (Monaco)             │  ✓ test_user_new     │ │ │
│                 │ │  │                       │  ✓ test_user_age     │ │ │
│                 │ │  │                       │  ✗ test_user_display │ │ │
│                 │ │  └───────────────────────┴───────────────────────┘ │ │
│                 │ └─────────────────────────────────────────────────────┘ │
└─────────────────┴─────────────────────────────────────────────────────────┘
```

Left: course list + current TOC. Top of content pane: tabs for currently-open
courses plus a `+` that opens the library/browse view. Content pane is split
horizontally (reading on top, editor/output on bottom) and each lesson decides
how much of the vertical space each region gets. Exercise lessons bias toward
the editor; reading-heavy lessons hide the editor.

## Tech stack

Mirrors Stash exactly, minus what we don't need:

- **Shell**: Tauri 2
- **Frontend**: React 19 + Vite + TypeScript
- **UI kit**: `@mattmattmattmatt/base` (local file link) — monochrome glass look, Shiki included
- **Editor**: `monaco-editor` + `@monaco-editor/react`
- **Router**: Tanstack Router (ships with base)
- **i18n**: i18next + react-i18next (future-proofing)
- **State**: React + context (upgrade later if needed)
- **Testing**: Vitest + Playwright
- **Backend**: Rust Tauri commands for filesystem, subprocess runs, SQLite
- **Storage**: SQLite on disk for progress/notes; courses as structured JSON in app support dir
- **Sync backend**: New relay on mattssoftware.com with OAuth (details TBD in §Server)

## Project layout

```
kata/
├── src/                      # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── Sidebar/          # course list, TOC, browse button
│   │   ├── TabBar/           # course tabs across top of content pane
│   │   ├── Lesson/           # reading view (Markdown + Shiki)
│   │   ├── Editor/           # Monaco wrapper
│   │   ├── Output/           # runtime output + test results
│   │   └── Library/          # browse/add-course view
│   ├── pages/                # route views
│   ├── contexts/             # auth, course state
│   ├── hooks/                # useCourse, useRunCode, etc.
│   ├── runtimes/             # per-language in-browser runners
│   │   ├── javascript.ts
│   │   ├── python-pyodide.ts
│   │   ├── rust-wasm.ts
│   │   └── swift-stub.ts
│   ├── data/                 # course format types, seed courses
│   ├── i18n/
│   └── utils/
├── src-tauri/                # Rust Tauri backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/         # run_subprocess, course_fs, progress_db
│   │   └── db.rs             # SQLite progress tracking
│   ├── Cargo.toml
│   └── tauri.conf.json
├── courses/                  # checked-in starter courses (format: JSON + MD files)
│   └── example/
├── ingest/                   # LLM book-to-course pipeline (Node script)
│   └── README.md
├── package.json
├── vite.config.ts
├── PLAN.md
└── README.md
```

## Course format (JSON + Markdown hybrid)

```
courses/rust-book/
├── course.json              # metadata: title, language, chapters list
├── chapters/
│   ├── 01-getting-started/
│   │   ├── chapter.json     # title, lessons list
│   │   └── lessons/
│   │       ├── 01-installing.md         # pure reading lesson
│   │       └── 02-hello-world/          # exercise lesson
│   │           ├── lesson.md            # prose + reference code
│   │           ├── starter.rs           # code user opens with
│   │           ├── solution.rs          # hidden
│   │           └── tests.rs             # hidden
```

`lesson.md` front-matter declares lesson kind (`reading` | `exercise` | `mixed`)
and ties it to starter/solution/test files.

## Build order

1. **Scaffold** — Tauri + React + base + Monaco hello world ✓
2. **Three-pane layout** — sidebar / tabbar / content (reading + editor + output split) with mock course data
3. **Shiki reading view** — markdown renderer with syntax highlighted code blocks
4. **Monaco editor** — dropped into the bottom-left of the content pane, language switching
5. **JS/TS runtime** — run user code in a sandboxed web worker, show output
6. **Test harness** — run hidden test file against user code, show pass/fail
7. **Python via Pyodide** — second language, same harness
8. **Rust via WASM compile** — compile-to-wasm toolchain in a worker
9. **Swift** — subprocess fallback via Tauri (requires installed toolchain)
10. **Progress SQLite** — track completion, streaks, XP per course
11. **Course library / browse view** — scan `courses/` dir, show cards
12. **Ingest pipeline** — separate Node script: LLM-assisted book → course JSON
13. **Relay + auth** — mattssoftware.com OAuth server for cross-device sync
14. **Phone / Watch companions** — review + quiz (future)
15. **In-app authoring** — course creation UI (future)
