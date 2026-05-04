/// Auto-split from the original `src/docs/pages.ts` monolith. See
/// `scripts/split-docs.mjs` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in `./index.ts`.

import type { DocsSection } from "../types";

export const keyboard = `Fishbones registers a small set of global keyboard shortcuts. Most are scoped to the workbench when an exercise is active.

## Global

| Shortcut | Action |
|---|---|
| \`Cmd+K\` / \`Ctrl+K\` | Open command palette |
| \`Cmd+,\` / \`Ctrl+,\` | Open settings |
| \`Cmd+\\\\\` / \`Ctrl+\\\\\` | Toggle sidebar |
| \`Cmd+Shift+P\` | Open command palette (alt) |
| \`Esc\` | Dismiss the topmost modal / popover |

## Lesson navigation

| Shortcut | Action |
|---|---|
| \`Cmd+ArrowRight\` | Next lesson |
| \`Cmd+ArrowLeft\` | Previous lesson |
| \`Cmd+M\` | Mark current reading lesson complete |

## Workbench (when editor is focused)

| Shortcut | Action |
|---|---|
| \`Cmd+Enter\` | Run code |
| \`Cmd+Shift+H\` | Show next hint |
| \`Cmd+Shift+R\` | Reset to starter |
| \`Cmd+Shift+S\` | Reveal solution |
| \`Cmd+/\` | Toggle line comment |
| \`Cmd+B\` | Pop out workbench window |

## Phone preview

| Shortcut | Action |
|---|---|
| \`Cmd+Shift+P\` (when phone focused) | Pop out phone window |
| \`Cmd+Shift+R\` | Reload preview without re-fetching runtime |

## Why so few?

Fishbones is mouse-first by design — clicking lessons, selecting courses, dragging the phone — these don't have keyboard equivalents because they don't need them.

The exceptions are the actions you do *frequently inside the editor*: run, hint, reset. Those have keys because hand-to-mouse round-trips while typing are a tax.

## Customization

Shortcuts aren't user-customizable yet. The bindings live in:

- \`src/components/CommandPalette/CommandPalette.tsx\` — \`Cmd+K\`
- \`src/components/Editor/EditorPane.tsx\` — Monaco command bindings
- \`src/App.tsx\` — global bindings

If you fork the app, search for those keybinding registrations and edit in place. A user-configurable shortcut UI is a candidate for a future settings panel.
`;

export const dryFindings = `This page captures the codebase audit performed during the docs-system buildout. Each finding is a concrete refactor opportunity. They're ordered roughly by **payoff per hour of effort**.

## Top 10 refactors, ranked

### 1. \`MODEL_PRICING\` + \`costFor()\` duplicated 5×

The Anthropic / Ollama pricing table is hardcoded in:

- \`src/ingest/pipeline.ts\` lines 88–92
- \`src/ingest/ingestDocsSite.ts\` lines 632–636
- \`src/ingest/generateChallengePack.ts\` lines 146–150
- \`src/ingest/enrichCourse.ts\` lines 56–60
- \`src/ingest/retryLesson.ts\` lines 114–118

\`\`\`ts
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-opus-4-5":   { input: 15, output: 75 },
  "claude-haiku-4-5":  { input: 1, output: 5 },
};
\`\`\`

Same content in every file. When Anthropic updates rates, you fix it in 5 places — and forget one.

**Fix:** Extract to \`src/ingest/pricing.ts\`:

\`\`\`ts
export const MODEL_PRICING = { /* ... */ };

export function costFor(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const m = MODEL_PRICING[model];
  if (!m) return 0;
  return (inputTokens * m.input + outputTokens * m.output) / 1_000_000;
}
\`\`\`

**Effort:** 15 minutes. **Payoff:** 20 lines deleted, single point of change.

### 2. \`LlmResponseTS\` interface duplicated 6×

Same shape in 6 ingest files:

\`\`\`ts
interface LlmResponseTS {
  text: string;
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
}
\`\`\`

**Fix:** One export from \`src/ingest/types.ts\`. **Effort:** 5 minutes. **Payoff:** 30 lines, type drift impossible.

### 3. \`useLocalStorage<T>\` hook missing

Pattern repeated in:

- \`src/hooks/usePlaygroundFiles.ts\` — \`readStored\` + \`writeStored\`
- \`src/hooks/useWorkbenchFiles.ts\` — same
- \`src/hooks/useRecentCourses.ts\` — manual \`loadInitial\`
- \`src/hooks/useFishbonesCloud.ts\` — \`readToken\` / \`writeToken\` / \`readUser\` / \`writeUser\`

Every one of these is a small variation on:

\`\`\`ts
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
function write<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* quota / private mode */ }
}
\`\`\`

**Fix:** Single hook in \`src/hooks/useLocalStorage.ts\`:

\`\`\`ts
export function useLocalStorage<T>(
  key: string,
  initial: T,
  validate?: (v: unknown) => v is T,
): [T, (v: T) => void] { /* ... */ }
\`\`\`

Then retrofit the 4 hooks. **Effort:** 1 hour. **Payoff:** ~120 lines deleted, one place to fix quota / sandboxed-iframe / private-mode quirks.

### 4. \`useDebouncedCallback<T>\` hook missing

Two hooks (\`usePlaygroundFiles\`, \`useWorkbenchFiles\`) reimplement debounced-save with a 400 ms timer + ref tracking + unmount flush:

\`\`\`ts
const latestRef = useRef(value);
latestRef.current = value;

useEffect(() => {
  const handle = setTimeout(() => fn(latestRef.current), delayMs);
  return () => clearTimeout(handle);
}, [value]);

useEffect(() => {
  return () => fn(latestRef.current);   // unmount flush
}, []);
\`\`\`

**Fix:** \`src/hooks/useDebouncedCallback.ts\`. **Effort:** 30 minutes. **Payoff:** 40 lines, prevents unmount-ordering bugs.

### 5. \`useAsync<T>\` hook missing

Pattern in \`useProgress\`, \`useToolchainStatus\`, parts of \`useAiChat\` and \`useCourses\`:

\`\`\`ts
useEffect(() => {
  let cancelled = false;
  setLoading(true);
  invoke<T>("cmd", args)
    .then(data => { if (!cancelled) { setData(data); setLoading(false); } })
    .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
  return () => { cancelled = true; };
}, [deps]);
\`\`\`

**Fix:** \`useAsync(asyncFn, deps)\` returning \`{ data, loading, error }\`. **Effort:** 30 minutes. **Payoff:** 60 lines, fewer cancellation-flag bugs.

### 6. \`CONSOLE_SHIM\` duplicated across 4 runtimes

The "patch console → postMessage to parent" template appears in:

- \`runtimes/web.ts\` lines 23–61
- \`runtimes/react.ts\` lines 213–245
- \`runtimes/reactnative.ts\` lines ~150–190 (embedded)
- (omitted from \`runtimes/svelte.ts\` — relies on parent injection)

**Fix:** Extract to \`src/runtimes/templates/consoleShim.ts\` and import. **Effort:** 30 minutes. **Payoff:** 70 lines, one place to fix console-capture edge cases (e.g. \`console.table\`, structured logs).

### 7. Modal-dialog wrapper component missing

Same JSX skeleton in:

- \`SettingsDialog.tsx\` lines 175–181
- \`CourseSettingsModal.tsx\` lines 230–250
- \`BulkImportDialog.tsx\` lines 230–250
- \`ImportDialog.tsx\`

\`\`\`tsx
<div className="*-backdrop" onClick={onDismiss}>
  <div className="*-panel" onClick={(e) => e.stopPropagation()}>
    <div className="*-header">
      <div className="*-title">{title}</div>
      <button className="*-close" onClick={onDismiss}>×</button>
    </div>
    <div className="*-body">{children}</div>
  </div>
</div>
\`\`\`

**Fix:** \`<ModalDialog title={} onDismiss={}>{children}</ModalDialog>\` in \`src/components/Shared/\`. **Effort:** 1 hour. **Payoff:** Consistent dismiss behavior, accessibility easier to audit (focus trap goes in one place).

### 8. \`languageLabel()\` switch duplicated

\`src/components/Sidebar/Sidebar.tsx\` lines 26–73 has a 50-line switch over \`LanguageId\` returning the display name. The same data is already in \`src/lib/languages.tsx::LANGUAGE_META\`:

\`\`\`ts
LANGUAGE_META.javascript.label;   // "JavaScript"
LANGUAGE_META.rust.label;         // "Rust"
\`\`\`

The Sidebar switch is dead duplication.

**Fix:** Replace with \`languageMeta(lang).label\`. Same fix on \`BookCover.tsx::langGlyph\` (lines 155–202) — the carousel glyph map is also duplicated. **Effort:** 30 minutes. **Payoff:** 100+ lines deleted; one place to add a new language label.

### 9. \`runFiles\` dispatcher → router registry

\`runtimes/index.ts\` lines 119–185 has 67 lines of \`if language === X\` branches mixed with heuristics (\`isWebLesson\`, \`looksLikeReactNative\`, \`looksLikeSvelteKit\`).

**Fix:** Convert to a route table:

\`\`\`ts
interface Route {
  match: (lang: LanguageId, files: WorkbenchFile[]) => boolean;
  run: (language: LanguageId, files: WorkbenchFile[], testCode?: string, assets?: WorkbenchAsset[]) => Promise<RunResult>;
}

const ROUTES: Route[] = [
  { match: l => l === "reactnative", run: (_, f) => runReactNative(f, currentThemeColors()) },
  { match: l => l === "react",       run: (_, f) => runReact(f) },
  { match: l => l === "svelte" && looksLikeSvelteKit(/* ... */), run: ... },
  /* ... */
];

export async function runFiles(language, files, testCode, assets) {
  const route = ROUTES.find(r => r.match(language, files));
  return route ? route.run(language, files, testCode, assets) : runFallback();
}
\`\`\`

**Effort:** 1 hour. **Payoff:** Adding a new runtime is a table-edit, not a branch insert.

### 10. \`pushEvent()\` helper for the 500-event ring buffer

\`useIngestRun.ts\` has the same 5-line pattern at lines 135–139, 233–239, 297–303, 379–385, 556–565, 659–665:

\`\`\`ts
const next = r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
next.push(ev);
return { ...r, events: next };
\`\`\`

**Fix:** One helper. **Effort:** 5 minutes. **Payoff:** Tune the cap in one place; unify the pattern.

## Smaller wins (each <30 min)

| Pattern | Files | LOC saved |
|---|---|---|
| Base64 encoding utility | 3 runtimes | 9 |
| Abort exception factory | 6 ingest files | 30 |
| Settings row component | 4 dialogs | 30 |
| Confirmation-action component | 2 dialogs | 40 |
| Empty-state component | 3 places | small |
| \`pushSidebarMenu\` hook | Sidebar | 100 |
| Filter pill component | CourseLibrary | 30 |

## Larger refactors (longer-term)

### \`buildPreviewHtml\` factory

The 3 web-iframe runtimes (\`react.ts\`, \`reactnative.ts\`, \`svelte.ts\`) each have a \`buildPreviewHtml\` that's 60–80% structural overlap (HTML skeleton, error overlay, console shim, base64-encoded source) and 20–40% language-specific (Babel vs Svelte compiler vs nothing).

A \`PreviewBuilder\` factory accepting per-runtime "phases" would consolidate ~250 lines while keeping the runtime-specific bits clear.

**Effort:** half a day. **Payoff:** Adding a new framework runtime becomes plug-and-play.

### Course-store coalescence

\`useCourses\`, \`useProgress\`, \`useRecentCourses\` each independently fetch from sqlite/localStorage on mount. A unified \`useCourseLibrary()\` could coalesce the three into one IPC round-trip on launch (currently 3+).

**Effort:** half a day. **Payoff:** Faster cold start, single refresh point.

### Ingest \`pipelineUtils\`

Every ingest file redefines \`emit\`, \`checkAbort\`, \`timedInvoke\`, \`callLlm\` with ~80 lines of overlap. A \`createPipelineHelpers(onEvent, signal, stats)\` factory that returns all four would clean up the 5 ingest pipelines.

**Effort:** 1–2 days (good abstraction needed). **Payoff:** ~150 lines deleted; new pipelines are 30% smaller.

## Already clean

These look refactor-able but actually aren't:

- \`languages.tsx\` itself — already data-driven via \`LANGUAGE_META\`. No switch/case to consolidate.
- \`workbenchFiles.ts\` vs \`workbenchSync.ts\` — clean separation (data vs IPC). No overlap.
- \`Sidebar.tsx\` sub-components (\`SidebarNavItem\`, \`CourseGroup\`, \`ChapterBlock\`, \`LessonRow\`) — already extracted properly.
- \`AiChatPanel.tsx\` — internal sub-components already split.

## How to use this list

Each finding is **independent** — you can tackle them in any order. The top 10 are highest payoff per hour; the rest are polish. None of them require architectural changes — they're all "extract this thing that's already a pattern" rather than "rethink this part of the app."

When picking up one, check the actual line numbers (this doc may drift) and re-read the surrounding code before editing — the cited locations may have moved.
`;

export const REFERENCE_SECTION: DocsSection = {
  id: "reference",
  title: "Reference",
  pages: [
    { id: "keybindings", title: "Keyboard shortcuts", tagline: "Every binding in the app", body: keyboard },
    { id: "dry-findings", title: "Refactor opportunities", tagline: "Audit notes — DRY violations and componentization wins", body: dryFindings },
  ],
};
