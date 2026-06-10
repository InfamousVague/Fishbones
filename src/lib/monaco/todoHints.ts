/// AI hints for TODO comments — the "help" affordance in the editor.
///
/// Every `TODO` / `FIXME` comment in an exercise file gets a CodeLens
/// above it reading "✨ help". Clicking it asks the local model
/// (Ollama, same host + default model as the AI assistant) for the
/// code that completes that TODO, then surfaces the answer as a
/// GHOST-TEXT inline completion at the spot — press Tab to accept,
/// or just start typing: while what you've typed stays a prefix of
/// the suggestion the ghost text keeps completing ahead of you,
/// IntelliSense-style. Diverge from it and it gets out of your way.
///
/// Wiring shape: ONE set of global providers (CodeLens + inline
/// completions + the lens command), registered on first attach and
/// consulted through a registry of attached editors — Monaco
/// providers are global per language, so per-mount registration
/// would stack duplicates across file tabs / popped workbenches.
/// `attachTodoHints` is called from EditorPane's onMount; it
/// self-detaches when the editor disposes.
///
/// Everything no-ops gracefully when the AI is disabled in settings
/// or no host is configured (the lenses simply don't render), so the
/// feature is invisible rather than broken on machines without
/// Ollama.

import type * as MonacoNS from "monaco-editor";
import { aiHostUrl, readAiEnabled } from "../aiHost";

type Monaco = typeof MonacoNS;
type ICodeEditor = MonacoNS.editor.IStandaloneCodeEditor;
type ITextModel = MonacoNS.editor.ITextModel;

const TODO_RE = /\b(TODO|FIXME)\b/;

/// Endpoint resolution: the configured remote host when the user set
/// one (Settings → AI host, e.g. a Tailscale box), else the local
/// Ollama daemon. `aiHostUrl()` returning null is the NORMAL desktop
/// state — the assistant talks to localhost through the Rust side
/// and never writes the host key — so null must not disable hints.
const LOCAL_OLLAMA = "http://localhost:11434";
function hintEndpoint(path: string): string {
  return aiHostUrl(path) ?? `${LOCAL_OLLAMA}${path}`;
}

/// Same default the AI assistant ships with; overridable via the
/// (undocumented) localStorage key for tinkering without a rebuild.
const HINT_MODEL_KEY = "libre:todo-hint-model";
function hintModel(): string {
  try {
    return localStorage.getItem(HINT_MODEL_KEY) || "qwen2.5-coder:7b";
  } catch {
    return "qwen2.5-coder:7b";
  }
}

interface AttachedEntry {
  editor: ICodeEditor;
  language: string;
  fileName: string;
}

type HintStatus = "loading" | "ready" | "error";
interface HintState {
  status: HintStatus;
  /// The suggested code, fence-stripped. Only set when status=ready.
  text?: string;
}

/// model-uri → attached editor info.
const attached = new Map<string, AttachedEntry>();
/// `${modelUri}#${lineNumber}` → hint state. Line-keyed, so edits
/// that move the TODO invalidate naturally (the lens at the new line
/// starts fresh; stale entries are harmless and tiny).
const hints = new Map<string, HintState>();

let registered = false;
let lensRefresh: MonacoNS.Emitter<MonacoNS.languages.CodeLensProvider> | null =
  null;
let lensProvider: MonacoNS.languages.CodeLensProvider | null = null;

/// Re-render every lens title (Monaco re-queries the provider when
/// its onDidChange event fires with the provider itself).
function fireLensRefresh(): void {
  if (lensRefresh && lensProvider) lensRefresh.fire(lensProvider);
}

function hintKey(model: ITextModel, line: number): string {
  return `${model.uri.toString()}#${line}`;
}

/// Strip a markdown code fence if the model wrapped its reply in one
/// (they often do despite instructions), plus stray leading/trailing
/// blank lines.
function stripFences(reply: string): string {
  let out = reply.trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/m.exec(out);
  if (fence) out = fence[1];
  return out.replace(/^\n+|\n+$/g, "");
}

async function fetchHint(
  entry: AttachedEntry,
  model: ITextModel,
  lineNumber: number,
): Promise<string> {
  const url = hintEndpoint("/api/chat");
  const todoText = model.getLineContent(lineNumber).trim();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: hintModel(),
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a concise coding assistant inside a learn-to-code editor. " +
              "The student clicked 'help' on a TODO comment in their exercise. " +
              "Reply with ONLY the code that completes that TODO — no explanations, " +
              "no markdown fences, do not repeat surrounding existing code. Keep it " +
              "minimal (usually 1-6 lines), correctly indented for where it sits, " +
              "and idiomatic for the language. If the TODO is ambiguous, give the " +
              "most likely small next step rather than a full solution.",
          },
          {
            role: "user",
            content:
              `Language: ${entry.language}\nFile: ${entry.fileName}\n\n` +
              `\`\`\`\n${model.getValue()}\n\`\`\`\n\n` +
              `The TODO on line ${lineNumber}: ${todoText}\n` +
              "Provide only the code for this TODO.",
          },
        ],
        options: { temperature: 0.2, num_predict: 220 },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { message?: { content?: string } };
    const text = stripFences(json.message?.content ?? "");
    if (!text) throw new Error("empty reply");
    return text;
  } finally {
    window.clearTimeout(timer);
  }
}

/// Lens click handler — fetch (or refresh) the hint for a TODO line,
/// then park the cursor at the insertion point and pop the ghost text.
async function requestHint(uriStr: string, lineNumber: number): Promise<void> {
  const entry = attached.get(uriStr);
  if (!entry) return;
  const model = entry.editor.getModel();
  if (!model || model.uri.toString() !== uriStr) return;
  const key = hintKey(model, lineNumber);
  if (hints.get(key)?.status === "loading") return;
  hints.set(key, { status: "loading" });
  fireLensRefresh();
  try {
    const text = await fetchHint(entry, model, lineNumber);
    hints.set(key, { status: "ready", text });
  } catch {
    hints.set(key, { status: "error" });
  }
  fireLensRefresh();
  const state = hints.get(key);
  if (state?.status !== "ready") return;
  // Park the cursor where the code goes — the line below the TODO if
  // it's empty, else the end of the TODO line — and trigger the
  // inline suggestion so the ghost text shows immediately.
  const below = lineNumber + 1;
  const belowEmpty =
    below <= model.getLineCount() && model.getLineContent(below).trim() === "";
  const target = belowEmpty
    ? { lineNumber: below, column: model.getLineMaxColumn(below) }
    : { lineNumber, column: model.getLineMaxColumn(lineNumber) };
  entry.editor.setPosition(target);
  entry.editor.focus();
  entry.editor.trigger("libre-todo-hint", "editor.action.inlineSuggest.trigger", {});
}

/// Find the TODO line a cursor position is "answering" — the nearest
/// TODO at or up to 4 lines above the cursor with a ready hint.
function readyHintFor(
  model: ITextModel,
  lineNumber: number,
): { todoLine: number; text: string } | null {
  for (let l = lineNumber; l >= Math.max(1, lineNumber - 4); l--) {
    if (!TODO_RE.test(model.getLineContent(l))) continue;
    const state = hints.get(hintKey(model, l));
    if (state?.status === "ready" && state.text) {
      return { todoLine: l, text: state.text };
    }
    return null; // nearest TODO has no ready hint — don't look past it
  }
  return null;
}

function registerProviders(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  const refresh = new monaco.Emitter<MonacoNS.languages.CodeLensProvider>();
  lensRefresh = refresh;

  monaco.editor.registerCommand(
    "libre.todoHint",
    (_accessor, uriStr: string, lineNumber: number) => {
      void requestHint(uriStr, lineNumber);
    },
  );

  lensProvider = {
    onDidChange: refresh.event,
    provideCodeLenses(model) {
      const uriStr = model.uri.toString();
      if (!attached.has(uriStr)) return { lenses: [], dispose() {} };
      // Gate on the user's AI toggle only — see hintEndpoint() for
      // why a missing host must NOT hide the lenses on desktop.
      if (!readAiEnabled()) return { lenses: [], dispose() {} };
      const lenses: MonacoNS.languages.CodeLens[] = [];
      const lineCount = model.getLineCount();
      for (let line = 1; line <= lineCount; line++) {
        if (!TODO_RE.test(model.getLineContent(line))) continue;
        const state = hints.get(hintKey(model, line));
        const title =
          state?.status === "loading"
            ? "✨ thinking…"
            : state?.status === "ready"
              ? "✨ hint ready — Tab to accept · click for a fresh one"
              : state?.status === "error"
                ? "✨ AI unreachable — click to retry"
                : "✨ help";
        lenses.push({
          range: new monaco.Range(line, 1, line, 1),
          command: {
            id: "libre.todoHint",
            title,
            arguments: [uriStr, line],
          },
        });
      }
      return { lenses, dispose() {} };
    },
  };
  monaco.languages.registerCodeLensProvider("*", lensProvider);

  monaco.languages.registerInlineCompletionsProvider("*", {
    provideInlineCompletions(model, position) {
      if (!attached.has(model.uri.toString())) return { items: [] };
      const hit = readyHintFor(model, position.lineNumber);
      if (!hit) return { items: [] };
      // Don't ghost ON the TODO comment line itself — only at/below
      // the insertion point.
      if (position.lineNumber === hit.todoLine) return { items: [] };
      const typed = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      // IntelliSense behaviour: keep suggesting while what the user
      // typed is still a prefix of the hint; bail once they diverge.
      if (
        typed.trim().length > 0 &&
        !hit.text.trimStart().startsWith(typed.trimStart())
      ) {
        return { items: [] };
      }
      return {
        items: [
          {
            insertText: hit.text,
            // Replace from the line start through the cursor so the
            // accepted hint swallows what was typed (it's a prefix of
            // the hint) instead of doubling it.
            range: new monaco.Range(
              position.lineNumber,
              1,
              position.lineNumber,
              position.column,
            ),
          },
        ],
      };
    },
    freeInlineCompletions() {},
  });
}

/// Attach the TODO-hint system to an editor. Call from onMount; the
/// returned disposable (also wired to the editor's own dispose)
/// removes it from the registry.
export function attachTodoHints(
  monaco: Monaco,
  editor: ICodeEditor,
  meta: { language: string; fileName: string },
): MonacoNS.IDisposable {
  registerProviders(monaco);
  const model = editor.getModel();
  if (!model) return { dispose() {} };
  const uriStr = model.uri.toString();
  attached.set(uriStr, { editor, language: meta.language, fileName: meta.fileName });
  fireLensRefresh();
  const detach = () => {
    if (attached.get(uriStr)?.editor === editor) attached.delete(uriStr);
  };
  const sub = editor.onDidDispose(detach);
  return {
    dispose() {
      sub.dispose();
      detach();
    },
  };
}
