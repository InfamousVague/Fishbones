/// Auto-split from the original `src/docs/pages.ts` monolith. See
/// `scripts/split-docs.mjs` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in `./index.ts`.

import type { DocsSection } from "../types";

export const ingestPipeline = `Ingest is how courses are *generated*, not just imported. Three pipelines exist:

1. **PDF ingest** — point at a textbook PDF, get a course
2. **Docs site ingest** — point at a docs URL (like https://bun.com/docs), get a course
3. **Challenge pack** — generate kata-style problem sets per language + difficulty

All three share infrastructure: an LLM proxy, an event-emitting orchestrator, and stats tracking.

## Pipeline shape

Each pipeline is an async function taking a \`config\` and an \`onEvent\` callback:

\`\`\`ts
export async function runIngestPipeline(
  config: IngestConfig,
  onEvent: (e: IngestEvent) => void,
  signal: AbortSignal,
): Promise<Course>;
\`\`\`

\`IngestEvent\` has a structured shape so the UI can render a live progress feed:

\`\`\`ts
type IngestEvent =
  | { kind: 'phase';   label: string }
  | { kind: 'log';     message: string }
  | { kind: 'lesson';  title: string; lessonKind: 'reading' | 'exercise' | 'quiz' }
  | { kind: 'stats';   stats: PipelineStats }
  | { kind: 'error';   message: string };
\`\`\`

The frontend hook (\`useIngestRun\`) accumulates events into a 500-line ring buffer and renders them in \`FloatingIngestPanel\`.

## PDF ingest

\`src/ingest/pipeline.ts\` (1142 lines — the largest single file in the codebase). The phases:

\`\`\`
1. Parse the PDF                  pdfParser.ts → text + page boundaries
2. Detect chapter structure       LLM call: chapters.json
3. For each chapter:
   3a. Extract section text
   3b. Generate lessons (LLM)     lessons.json per chapter
4. Cover image extraction         pdfParser.ts → first decent image
5. Optional enrichment            enrichCourse.ts → glossary + symbols
6. Write course.json + cover.png  invoke('save_course')
\`\`\`

LLM calls go through a single Tauri command: \`invoke('llm_generate', { prompt, model, jsonSchema })\`. The Rust side dispatches to the configured backend (Ollama or Anthropic) and returns the raw text.

> [!NOTE]
> Cost tracking is a per-pipeline \`PipelineStats\` object. Token counts come back from the LLM call; the cost is computed via the model's input/output rates. The pricing table is currently duplicated in 5 ingest files — a high-priority DRY fix (see [DRY findings](docs:dry-findings)).

## Docs site ingest

\`src/ingest/ingestDocsSite.ts\`. The phases:

\`\`\`
1. Fetch the index page              invoke('crawl_docs_site') → page tree
2. Cluster pages into chapters       LLM call: chapter assignments
3. For each chapter:
   3a. Fetch each page's HTML
   3b. Extract main content (HTMLRewriter on Rust side)
   3c. Generate lessons (LLM)
4. Cover image                       crawl head OG image
5. Enrichment + write
\`\`\`

The crawl is breadth-first up to a configurable depth; pages outside the docs subdomain are dropped. The result is the same \`Course\` shape regardless of source.

## Challenge pack generation

\`src/ingest/generateChallengePack.ts\`. Different shape — instead of mining content from a source, this generates fresh kata problems:

\`\`\`
1. For each (language, difficulty) pair:
   1a. Prompt the LLM for N exercise specs
   1b. For each spec: generate starter, solution, tests, hints
2. Validate every exercise actually runs
3. Write course.json with packType: 'challenges'
\`\`\`

Validation runs each generated exercise through the same \`runFiles\` dispatcher used in the live app — passing tests is the gate. Failed exercises get one retry, then a "regen" pass via \`regenExercises.ts\`.

## Enrichment

\`src/ingest/enrichCourse.ts\` is a *post-generation* pass. It walks every reading lesson, identifies meaningful symbols and glossary candidates, and writes them back as the lesson's \`enrichment\` field.

Why a separate pass? It's expensive (one LLM call per lesson) and optional. A course is fully usable without enrichment — the popovers just don't appear.

## Stats and cost

Every pipeline emits \`stats\` events as it goes. The shape:

\`\`\`ts
interface PipelineStats {
  startedAt: number;
  elapsedMs: number;
  apiCalls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  model: string;
  lessonsByKind: Record<LessonKind, number>;
}
\`\`\`

The estimated cost is approximate — Anthropic's actual billing rounds and bills in cents. Within ~5% over a full run.

## Aborting

Every ingest function takes an \`AbortSignal\`. The \`Aborted\` exceptions are typed (\`IngestAborted\`, \`DocsIngestAborted\`, etc.) so callers can distinguish "user cancelled" from "LLM returned garbage" — the former is silent, the latter shows an error.

The exception classes are duplicated across 6 files; consolidating to a single \`createAbortError()\` factory would drop ~30 lines. See [DRY findings](docs:dry-findings) item 8.

## The \`useIngestRun\` hook

The frontend orchestrator lives in \`src/hooks/useIngestRun.ts\` (705 lines). It exposes:

\`\`\`ts
const {
  status,           // 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  events,           // last 500 events for the live feed
  stats,            // current PipelineStats snapshot
  course,           // the in-flight course object
  startPdf,         // start a PDF ingest
  startDocs,        // start a docs-site ingest
  startChallengePack,
  cancel,           // abort the current run
} = useIngestRun();
\`\`\`

Internally it threads the \`AbortSignal\` from a stable \`AbortController\` and accumulates events through a series of state updaters that all share the same 500-event-cap pattern (also DRY-able).
`;

export const aiAssistant = `Fishbones has a chat panel — clickable from the floating fish icon, the command palette, or the lesson reader's "Ask Fishbones" badge on a code block. The panel is a normal LLM chat, but with two interesting properties:

1. **Local-first.** The default backend is Ollama running on \`127.0.0.1:11434\`. No data leaves your machine.
2. **Lesson-aware.** When you open the panel from inside a lesson, the conversation is seeded with the lesson title + body + the snippet you clicked.

## Two backends

\`\`\`
┌───────────────────────────────────────┐
│  AI Settings (UI)                     │
│  Backend: ◉ Ollama (local)            │
│            ○ Anthropic (cloud)         │
│  Model:   [llama3.2:3b      ▼]        │
└───────────────────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│  Rust: ai_chat.rs                     │
│   ├── OllamaBackend                   │
│   │     POST /api/chat                │
│   │     stream NDJSON tokens           │
│   └── AnthropicBackend                │
│         POST /v1/messages             │
│         stream SSE tokens              │
└───────────────────────────────────────┘
              │
              ▼
       Tauri events → React UI
\`\`\`

## Local: Ollama

[Ollama](https://ollama.ai) is a single-binary local LLM runner. Fishbones doesn't bundle Ollama — it expects you to install it (one click on the Settings dialog will run \`brew install ollama\` on macOS, similar on Linux).

The backend probe (\`useAiChat::refreshProbe\`) checks:

1. Is Ollama installed? (\`which ollama\` on POSIX, Get-Command on Windows)
2. Is the daemon running? (HTTP HEAD on \`127.0.0.1:11434\`)
3. Are any models available? (\`GET /api/tags\`)
4. Is the configured model among them?

If any of these fail, the AI panel shows a setup banner with the appropriate one-click action: "Install Ollama" → "Start Ollama" → "Pull <model>". \`useAiChat::runSetup\` wraps each action with a re-probe so the UI updates as conditions change.

## Cloud: Anthropic

The cloud backend talks directly to Anthropic's API from Rust. The user supplies an API key in Settings (stored in \`~/.config/fishbones/settings.json\`). Models supported: \`claude-sonnet-4.5\`, \`claude-opus-4.5\`, \`claude-haiku-4.5\` (the pricing table is in \`src/ingest/pricing.ts\` — though as noted in [DRY findings](docs:dry-findings) it's duplicated across 5 ingest files).

> [!WARNING]
> The Anthropic backend uses the API key directly — no OAuth, no proxy. Treat your settings file as a secret. Don't sync it to a public dotfiles repo.

## Streaming

Both backends stream. The pattern:

\`\`\`rust
// Rust side
let mut stream = backend.stream_chat(messages).await?;
while let Some(token) = stream.next().await {
    let token = token?;
    window.emit("ai-chat-token", &token)?;
}
window.emit("ai-chat-done", ())?;
\`\`\`

\`\`\`ts
// JS side
useEffect(() => {
  const unlisten = await listen<string>("ai-chat-token", (e) => {
    setActiveMessage(prev => prev + e.payload);
  });
  return () => unlisten();
}, []);
\`\`\`

The active message is rendered with a blinking caret while streaming. When the \`ai-chat-done\` event lands, the active message is committed to history and the caret disappears.

## Lesson-context seeding

When the panel is opened *from* a lesson, it's pre-seeded with a system message containing:

- The lesson's title and body
- The full course title (so the LLM has framing)
- If launched from a code-block "Ask Fishbones" badge: the specific snippet the user clicked

The seed format:

\`\`\`
[Course: Bun Complete — Lesson: WebSocket compression — perMessageDeflate]

The user is reading this lesson:

> WebSocket frames are uncompressed by default — every byte you ws.send goes
> on the wire as-is. For chatty apps with text payloads...

User question follows.
\`\`\`

This dramatically improves answer quality compared to a blank chat — the LLM has the same context the user does.

## The chat hook

\`useAiChat\` is the most stateful hook in the codebase. It manages:

- Chat history (in memory, not persisted across launches)
- The active streaming message
- Backend probe state (installed / running / model present)
- Setup actions (install, start, pull-model) with re-probe coordination
- Token cap (truncate history if it would push the prompt past the model's window)

The streaming state machine is the trickiest part — see \`src/hooks/useAiChat.ts\` for the implementation.
`;

export const progressXp = `Fishbones tracks progress with three structures, each with a different lifecycle:

| Structure | Lives in | Lifecycle |
|---|---|---|
| **Completions** | sqlite (\`completions\`) | Permanent — one row per (course, lesson) finished |
| **Daily XP** | sqlite (\`daily_xp\`) | Permanent — aggregated per UTC day |
| **Streak** | derived | Computed at read time from \`daily_xp\` |

## Completions

When you pass a lesson, \`mark_completion\` writes a row:

\`\`\`sql
INSERT OR REPLACE INTO completions (course_id, lesson_id, completed_at)
VALUES (?, ?, strftime('%s', 'now'));
\`\`\`

The frontend re-reads completions whenever the sidebar / library renders — \`useProgress::list_completions\`. The result populates the green dots on lesson rows and the chapter \`x / y\` counters.

## XP

Each lesson awards XP on completion:

| Lesson kind | XP |
|---|---|
| Reading | 5 |
| Quiz | 10 |
| Exercise | 20 |
| Mixed | 25 |

XP is added to the **current UTC day's row** in \`daily_xp\`:

\`\`\`sql
INSERT INTO daily_xp (day, xp)
VALUES (strftime('%Y-%m-%d', 'now'), ?)
ON CONFLICT(day) DO UPDATE SET xp = xp + excluded.xp;
\`\`\`

Lifetime XP = sum of all daily rows. Today's XP = the today row.

> [!NOTE]
> XP is **not** awarded for re-completing a lesson you'd already finished. The completion row is a primary key — re-completion is a no-op on the completions table. The XP grant logic checks "was this completion new?" and skips the daily_xp bump if not.

## Streak

The streak is computed, not stored:

\`\`\`ts
function streakLength(dailyXpRows: { day: string; xp: number }[]): number {
  // Walk backward from today; count consecutive days with xp > 0.
  // The streak breaks the moment we hit a day with no XP.
}
\`\`\`

The result is shown as the flame emoji + count in the top-right corner of the app:

\`\`\`
🔥 12      ← 12-day streak
\`\`\`

Click it for a calendar view in the **Profile** page — each day cell colored by XP earned.

## Why UTC, not local?

Streak math doesn't work cleanly with timezone shifts. UTC means the day boundary is fixed everywhere; "complete a lesson before midnight" is well-defined globally. The downside: in some timezones (e.g. Pacific) the rollover happens at 4 PM local, which can feel weird. We accept the trade-off — most users in any one location adapt quickly.

## The Profile page

\`src/components/Profile/ProfileView.tsx\` aggregates everything:

- Total XP (lifetime)
- Today's XP
- Streak (current + longest)
- Calendar heatmap of the past year
- Per-language progress bars (% of available lessons completed)
- "Generate challenge pack" CTA — opens the challenge-pack ingest dialog

It's a read-mostly view — it triggers a fresh \`list_completions\` and \`list_daily_xp\` on mount and renders.
`;

export const cloudSync = `Fishbones is **offline-first** but offers optional cloud sync via a paired backend (\`fishbones-api\`). Sign-in is a one-time setup; once paired, completions and stats sync across machines.

## What syncs

- Completions (\`completions\` table)
- Daily XP rows (\`daily_xp\` table)
- Recent-courses timestamps

What does **not** sync:

- Course archives themselves (those live on disk; you import them per machine)
- Workbench drafts (your in-progress code; lives only in localStorage)
- AI chat history (in-memory only)
- Settings (per-machine)

The rationale: course archives can be huge (hundreds of MB if a course has video), and they're already portable via the bundle format. Sync is for *progress*, not *content*.

## Backend

The \`fishbones-api\` repo (sibling to \`kata\`) is a lightweight Bun.serve API. Endpoints:

\`\`\`
POST /auth/sign-in       { email, password }    → { token, user }
POST /auth/sign-out      Bearer token            → 204
GET  /sync/state         Bearer token            → { completions, dailyXp, recents }
POST /sync/upsert        Bearer token + body     → 204
\`\`\`

The schema is a thin mirror of the local sqlite tables, plus a \`user_id\` foreign key.

## The sync flow

\`useFishbonesCloud\` runs a sync pass every ~60 seconds while signed in (and on Tauri window-focus events):

1. \`GET /sync/state\` — fetch the server's view
2. \`local_completions\` ⊆ \`server_completions\` ? upsert anything we have that server doesn't
3. \`server_completions\` ⊆ \`local_completions\` ? insert anything server has that we don't
4. Same for \`daily_xp\` and recents

Conflicts (same row, different completed_at): server timestamp wins. The server gets the *first* completion timestamp; if you finish a lesson on machine A then re-complete on machine B, machine B's timestamp is dropped on the next sync.

## Sign-in UI

\`\`\`
Settings → Sign in
   ┌─────────────────────────┐
   │  Email     [          ] │
   │  Password  [          ] │
   │            [ Sign in  ] │
   │  ─────── or ────────    │
   │  [ Sign up ]            │
   └─────────────────────────┘
\`\`\`

\`SignInDialog\` calls the backend, stores the token + user in localStorage, and triggers a first sync. Subsequent launches read the token and proceed.

> [!WARNING]
> The token is stored in localStorage in plaintext. This is acceptable for a desktop app where the local user is implicitly trusted (the OS account boundary is the security model). It would NOT be acceptable for a browser app.

## First-launch prompt

If the user hasn't signed in (or out), the app shows a **FirstLaunchPrompt** modal once: "Sign in to sync progress, or skip." Either choice persists — there's no nag.

## Hooks

\`useFishbonesCloud\` exposes:

\`\`\`ts
const {
  user,                  // current user or null
  signedIn,              // boolean
  loading,
  error,
  signIn,                // (email, password) => Promise<void>
  signUp,
  signOut,
  syncNow,               // force an immediate sync
  lastSyncedAt,
} = useFishbonesCloud();
\`\`\`

It's the most network-aware hook in the app. The implementation handles offline gracefully — if the server is unreachable, syncs are queued and retry on the next interval. Local writes never block on network.

## Privacy

Everything that syncs is **progress metadata** — lesson ids, course ids, timestamps, XP amounts. No code snippets, no chat history, no file content. The backend never sees what you wrote in an exercise.
`;

export const themeSystem = `Three themes — \`light\`, \`dark\`, \`system\`. Picking \`system\` follows the OS-level preference via \`prefers-color-scheme\`. The default is system.

## CSS variable architecture

Themes are CSS-only. \`src/theme/themes.css\` defines a \`[data-theme="dark"]\` rule and a \`[data-theme="light"]\` rule, each setting a complete palette of \`--color-*\` variables:

\`\`\`css
/* src/theme/themes.css */

:root {
  /* Spacing, type, radii — theme-independent */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --radius-sm: 4px;
  --radius-md: 8px;
}

[data-theme="dark"] {
  --color-bg-primary: #0b0b10;
  --color-bg-secondary: #15151c;
  --color-bg-tertiary: #1f1f28;
  --color-text-primary: #f5f5f7;
  --color-text-secondary: #a4a4ad;
  --color-text-tertiary: #71717a;
  --color-border-default: rgba(255, 255, 255, 0.08);
  --color-accent: #ffb86c;
  /* ... ~40 more tokens */
}

[data-theme="light"] {
  --color-bg-primary: #ffffff;
  --color-text-primary: #15151c;
  /* ... */
}
\`\`\`

Components consume the variables, never the hex values:

\`\`\`css
.fishbones__lesson-reader {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
}
\`\`\`

## Setting the active theme

\`useActiveTheme()\` is the hook:

\`\`\`ts
const { theme, setTheme } = useActiveTheme();
\`\`\`

Internally:

1. \`theme\` is the user's *preference* — \`'light' | 'dark' | 'system'\`. Persisted in localStorage.
2. The hook resolves \`'system'\` to \`'light'\` or \`'dark'\` based on \`window.matchMedia('(prefers-color-scheme: dark)')\`.
3. Sets \`document.documentElement.dataset.theme = 'dark' | 'light'\` so the CSS rules apply.
4. Listens for system preference changes and re-applies when on \`'system'\`.

## Monaco theme regeneration

Monaco doesn't know about CSS variables. Its theme is a plain JS object with hardcoded colors. Fishbones generates one Monaco theme per app theme, deriving the colors from the same palette:

\`\`\`ts
// src/theme/monaco-themes.ts (excerpt)

export const FISHBONES_DARK_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment',   foreground: 'a4a4ad', fontStyle: 'italic' },
    { token: 'keyword',   foreground: 'ffb86c' },
    { token: 'string',    foreground: '8be9fd' },
    { token: 'number',    foreground: 'bd93f9' },
    { token: 'type',      foreground: '50fa7b' },
    // ... ~80 token rules
  ],
  colors: {
    'editor.background':  '#15151c',
    'editor.foreground':  '#f5f5f7',
    // ... ~30 chrome colors
  },
};
\`\`\`

The Monaco theme switches whenever the app theme switches:

\`\`\`ts
// src/lib/monaco/setup.ts
useEffect(() => {
  monaco.editor.setTheme(MONACO_THEME_BY_APP_THEME[activeTheme]);
}, [activeTheme]);
\`\`\`

## Adding a new theme

1. Append a \`[data-theme="solarized"]\` rule to \`themes.css\` with the full \`--color-*\` set.
2. Add a Monaco theme to \`monaco-themes.ts\`.
3. Append \`'solarized'\` to the \`ThemeName\` union in \`src/theme/themes.ts\`.
4. Add a chip to the Settings dialog's theme picker.

That's it. No component changes — every component already reads from variables.

## Color palette philosophy

Fishbones uses a small, restrained palette per theme — about 8 background tones, 5 text tones, 4 accent colors. Code highlighting (Shiki + Monaco) gets a wider palette. The CSS variables enforce the "small palette" — components can't reach for an arbitrary hex.

The reference palette is documented at the top of \`themes.css\` for designers tweaking colors:

\`\`\`css
/*
 * DARK THEME PALETTE
 *
 * Backgrounds (low contrast → high contrast)
 *   --color-bg-primary    #0b0b10  the chrome
 *   --color-bg-secondary  #15151c  panels, cards
 *   --color-bg-tertiary   #1f1f28  elevated surfaces
 *
 * Text (high readability → low)
 *   --color-text-primary   #f5f5f7  body
 *   --color-text-secondary #a4a4ad  secondary
 *   --color-text-tertiary  #71717a  hints, captions
 *
 * Accents
 *   --color-accent         #ffb86c  primary CTA
 *   --color-success        #50fa7b  passing tests, complete dots
 *   --color-warning        #f1fa8c  warnings
 *   --color-error          #ff5555  failing tests, errors
 */
\`\`\`
`;

export const SUBSYSTEMS_SECTION: DocsSection = {
  id: "subsystems",
  title: "Subsystems",
  pages: [
    { id: "ingest", title: "The ingest pipeline", tagline: "PDF, docs site, challenge pack generation", body: ingestPipeline },
    { id: "ai-assistant", title: "The AI assistant", tagline: "Ollama and Anthropic backends", body: aiAssistant },
    { id: "progress", title: "Progress, XP, streaks", tagline: "Completion tracking and the daily counter", body: progressXp },
    { id: "cloud-sync", title: "Cloud sync (optional)", tagline: "Cross-machine progress sync", body: cloudSync },
    { id: "theme", title: "The theme system", tagline: "CSS variables, Monaco regeneration", body: themeSystem },
  ],
};
