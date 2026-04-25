import { useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { code as codeIcon } from "@base/primitives/icon/icons/code";
import { eye } from "@base/primitives/icon/icons/eye";
import { columns2 } from "@base/primitives/icon/icons/columns-2";
import "@base/primitives/icon/icon.css";
import type { LanguageId } from "../../data/types";
import { usePlaygroundFiles } from "../../hooks/usePlaygroundFiles";
import { useToolchainStatus } from "../../hooks/useToolchainStatus";
import { runFiles, isPassing, type RunResult } from "../../runtimes";
import EditorPane from "../Editor/EditorPane";
import OutputPane from "../Output/OutputPane";
import Workbench from "../Workbench/Workbench";
import MissingToolchainBanner from "../MissingToolchain/MissingToolchainBanner";
import "./PlaygroundView.css";

/// Fire a `fishbones:ask-ai` event the way LessonReader / QuizView do.
/// AiAssistant is mounted at the app root and listens window-wide, so a
/// plain CustomEvent is enough plumbing — no prop drilling required.
function askAi(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("fishbones:ask-ai", { detail }));
}

/// Cheap heuristic: does this JavaScript snippet touch the DOM? The
/// in-browser JS sandbox has no `document` / `window` so any of these
/// patterns will throw on Run. Used by the apply-code handler to auto-
/// route DOM-using output into the Web runtime instead.
function looksLikeDomCode(code: string): boolean {
  return /\b(?:document\.|window\.|addEventListener\s*\(|querySelector|getElementById)\b/.test(
    code,
  );
}

/// Pull every string ID the snippet references from `getElementById('x')`
/// or `querySelector('#x')` so we can synthesize matching HTML elements.
/// Falls back to a small default set when nothing matches — better to
/// over-render a couple of placeholders than to leave the script with
/// no targets.
function referencedDomIds(code: string): string[] {
  const ids = new Set<string>();
  const byIdRe = /getElementById\s*\(\s*['"]([\w-]+)['"]\s*\)/g;
  const querySelectorIdRe = /querySelector(?:All)?\s*\(\s*['"]#([\w-]+)['"]\s*\)/g;
  for (const m of code.matchAll(byIdRe)) ids.add(m[1]);
  for (const m of code.matchAll(querySelectorIdRe)) ids.add(m[1]);
  if (ids.size === 0) ids.add("app");
  return [...ids];
}

/// Build a minimal `index.html` that wires every referenced ID. We
/// guess element type from the id text (`btn`/`button` → `<button>`;
/// `input`/`field` → `<input>`; everything else → `<div>`). The button
/// gets a sensible default label so the rendered page isn't blank
/// before the script has a chance to populate it.
function buildHtmlScaffold(ids: string[]): string {
  const body = ids
    .map((id) => {
      const lower = id.toLowerCase();
      // Words that commonly name a clickable element. We don't have
      // any deeper signal than the id text, so any "verb-y" /
      // "interactable" id ends up as a button — better than rendering
      // a silent div the script's `addEventListener('click')` never
      // fires on.
      if (
        /\b(?:btn|button|click|toggle|submit|trigger|counter|count|action)\b/.test(
          lower,
        )
      ) {
        return `    <button id="${id}">Click me</button>`;
      }
      if (lower.includes("input") || lower.includes("field")) {
        return `    <input id="${id}" />`;
      }
      return `    <div id="${id}"></div>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fishbones Playground</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
${body}
  </main>
  <script src="script.js"></script>
</body>
</html>
`;
}

/// Languages the playground offers. The roster matches LanguageId —
/// the picker shows every supported runtime so a user can try anything
/// without hunting for it. Web + Three.js are multi-file templates
/// (HTML + CSS + JS); their starter content lives in `playgroundTemplates.ts`.
const LANGUAGE_OPTIONS: Array<{ id: LanguageId; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "csharp", label: "C#" },
  { id: "assembly", label: "Assembly" },
  { id: "web", label: "Web (HTML + CSS + JS)" },
  { id: "threejs", label: "Three.js" },
  { id: "react", label: "React (JSX + CSS)" },
  { id: "reactnative", label: "React Native" },
];

/// View layout options for the workbench. `split` (editor + output
/// side by side) is the default; `editor` collapses the output entirely
/// for focused code time; `preview` collapses the editor so the URL
/// card / console fills the pane (useful for reading a long stack
/// trace or stacking the URL card front-and-center). Previews now open
/// in an external browser, so there's no iframe view to device-size.
type ViewMode = "split" | "editor" | "preview";

const VIEW_MODE_OPTIONS: Array<{ id: ViewMode; label: string; icon: string }> = [
  { id: "split", label: "Split", icon: columns2 },
  { id: "editor", label: "Editor", icon: codeIcon },
  { id: "preview", label: "Output", icon: eye },
];

/// jsfiddle-style free-form coding sandbox. No lesson prose, no "mark
/// complete" — just a language picker, editor, and output pane. Code
/// persists per-language in localStorage (see usePlaygroundFiles) so
/// switching Rust → Go → Rust restores what you were working on.
export default function PlaygroundView() {
  const { language, setLanguage, files, setFiles, resetToTemplate } =
    usePlaygroundFiles("javascript");
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  /// Bumped after a successful toolchain install so the probe re-runs
  /// and the banner can disappear. Kept here instead of inside the hook
  /// so the Run button can also trigger a re-probe after a `launch_error`
  /// surfaces a missing tool mid-session.
  const [tcRefresh, setTcRefresh] = useState(0);
  const { status: toolchainStatus } = useToolchainStatus(language, tcRefresh);
  // Default to split — editor + output side-by-side so run results appear
  // immediately without the learner having to switch views.
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  const showEditor = viewMode !== "preview";
  const showOutput = viewMode !== "editor";

  // "Generate from a prompt" mini-form. Toggled by the Generate button
  // in the header; closes itself after submit. We keep the input local
  // here (rather than punting to the chat panel) so the learner stays
  // in the playground's mental model — type the request, get the code,
  // paste it back into the editor.
  const [genOpen, setGenOpen] = useState(false);
  const [genText, setGenText] = useState("");

  // Pending DOM-route: when the apply-code handler decides a JS snippet
  // should run as a Web app, it stashes the html/js payload here and
  // calls setLanguage("web"). A separate effect waits for the language
  // to actually flip (so usePlaygroundFiles has seeded the web template
  // into `files`), then patches index.html + script.js. Doing this with
  // setTimeout raced React state and wrote to the wrong language's
  // storage; the effect-based queue is deterministic.
  const [pendingDomRoute, setPendingDomRoute] = useState<
    { html: string; script: string } | null
  >(null);
  useEffect(() => {
    if (!pendingDomRoute) return;
    if (language !== "web") return;
    setFiles((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((f) => {
        if (f.name === "index.html") return { ...f, content: pendingDomRoute.html };
        if (f.name === "script.js") return { ...f, content: pendingDomRoute.script };
        return f;
      });
    });
    setActiveFileIdx(0);
    setPendingDomRoute(null);
  }, [pendingDomRoute, language, setFiles]);

  function currentSource(): string {
    return files
      .map((f) => (files.length > 1 ? `// ${f.name}\n${f.content}` : f.content))
      .join("\n\n");
  }

  function handleExplain() {
    const code = currentSource().trim();
    if (!code) return;
    askAi({ kind: "explain-step", language, code });
  }

  function handleGenerateSubmit(e: React.FormEvent) {
    e.preventDefault();
    const request = genText.trim();
    if (!request) return;
    askAi({ kind: "generate-code", language, request });
    setGenText("");
    setGenOpen(false);
  }

  // Listen for the AI's `fishbones:apply-code` event — fired by
  // AiAssistant once a generate-code request finishes streaming.
  // Replace the active editor file's contents with the generated
  // source (the model is prompted to emit a single self-contained
  // block, so a wholesale swap is correct). Ignore events whose
  // language doesn't match the active language so a generate-code
  // dispatched from a different surface (lesson editor, popped
  // workbench) doesn't stomp the playground.
  //
  // Special case: when the model returns DOM-using JavaScript
  // (`document.getElementById`, `addEventListener`, etc.) for the
  // plain JS sandbox — which has no DOM and would throw at runtime —
  // auto-route to the Web playground instead. We synthesize a minimal
  // HTML scaffold containing every `id="..."` the JS references and
  // drop the generated code into `script.js`. The result: "make me a
  // counter button" produces a working preview without the learner
  // having to know they should have picked Web.
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ language?: string; code: string }>;
      const detail = ce.detail;
      if (!detail || !detail.code) return;
      if (detail.language && detail.language !== language) return;
      const usesDom =
        (language === "javascript" || language === "typescript") &&
        looksLikeDomCode(detail.code);
      if (usesDom) {
        const ids = referencedDomIds(detail.code);
        const html = buildHtmlScaffold(ids);
        // Queue the patch and flip the language. The effect above
        // applies the patch once the language transition has committed
        // and `files` has been re-seeded with the web template.
        setPendingDomRoute({ html, script: detail.code });
        setLanguage("web");
        setResult(null);
        return;
      }
      setFiles((prev) => {
        if (prev.length === 0) return prev;
        const idx = Math.max(0, Math.min(activeFileIdx, prev.length - 1));
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], content: detail.code };
        return copy;
      });
      setResult(null);
    };
    window.addEventListener("fishbones:apply-code", handler);
    return () => window.removeEventListener("fishbones:apply-code", handler);
  }, [language, activeFileIdx, setFiles, setLanguage]);

  async function handleRun() {
    // Pre-run safety net: if the active JS / TS file uses DOM APIs but
    // the language is set to plain JavaScript / TypeScript (the no-DOM
    // sandbox), auto-route to the Web runtime first. This catches the
    // case where the AI dropped code into the editor before our
    // apply-code auto-route landed, OR the learner pasted DOM code by
    // hand. We bail out of the run after queuing the route — the
    // language-transition effect rebuilds files + the user clicks Run
    // again on the now-correct surface.
    if (language === "javascript" || language === "typescript") {
      const source = files.map((f) => f.content).join("\n");
      if (looksLikeDomCode(source)) {
        const ids = referencedDomIds(source);
        const html = buildHtmlScaffold(ids);
        setPendingDomRoute({ html, script: source });
        setLanguage("web");
        setResult(null);
        return;
      }
    }
    setRunning(true);
    setResult(null);
    try {
      const r = await runFiles(language, files);
      if (!r) {
        setResult({
          logs: [],
          error: `No runtime for language "${language}".`,
          durationMs: 0,
        });
        return;
      }
      setResult(r);
      void isPassing; // silence unused import — the helper is part of
      // the public runtimes surface, we just don't need it for the
      // no-tests playground path.
    } catch (e) {
      setResult({
        logs: [],
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
        durationMs: 0,
      });
    } finally {
      setRunning(false);
    }
  }

  function handleFileChange(index: number, next: string) {
    setFiles((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const copy = prev.slice();
      copy[index] = { ...copy[index], content: next };
      return copy;
    });
  }

  function handleLanguageChange(next: LanguageId) {
    setActiveFileIdx(0);
    setResult(null);
    setLanguage(next);
  }

  const editorNode = (
    <EditorPane
      language={language}
      files={files}
      activeIndex={activeFileIdx}
      onActiveIndexChange={setActiveFileIdx}
      onChange={handleFileChange}
      onRun={handleRun}
      onReset={resetToTemplate}
    />
  );
  const outputNode = (
    <OutputPane result={result} running={running} language={language} />
  );

  return (
    <div className="fishbones-playground">
      {/* Header: language picker on the left, view toggle on the right. */}
      <div className="fishbones-playground-header">
        <label className="fishbones-playground-lang-picker">
          <span className="fishbones-playground-lang-label">Language</span>
          <select
            className="fishbones-playground-lang-select"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as LanguageId)}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="fishbones-playground-spacer" />

        {/* AI helpers — Explain (walks through current editor source
            step-by-step) and Generate (opens an inline prompt where
            the learner describes what they want and the assistant
            emits code in the active language). Both round-trip
            through the existing `fishbones:ask-ai` event bus that
            LessonReader / QuizView already use. */}
        <div className="fishbones-playground-ai" role="group" aria-label="AI helpers">
          <button
            type="button"
            className="fishbones-playground-ai-btn"
            onClick={handleExplain}
            disabled={currentSource().trim().length === 0}
            title="Walk through the editor's code step by step"
          >
            Explain
          </button>
          <button
            type="button"
            className={`fishbones-playground-ai-btn ${
              genOpen ? "fishbones-playground-ai-btn--active" : ""
            }`}
            onClick={() => setGenOpen((v) => !v)}
            aria-expanded={genOpen}
            title="Describe what you want and have the assistant write it"
          >
            Generate
          </button>
        </div>

        <div
          className="fishbones-playground-seg"
          role="group"
          aria-label="View mode"
        >
          {VIEW_MODE_OPTIONS.map((opt) => {
            const active = viewMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`fishbones-playground-seg-btn ${
                  active ? "fishbones-playground-seg-btn--active" : ""
                }`}
                onClick={() => setViewMode(opt.id)}
                title={opt.label}
                aria-pressed={active}
              >
                <Icon icon={opt.icon} size="xs" color="currentColor" />
                <span className="fishbones-playground-seg-label">
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Generate-from-prompt strip. Slides in under the header when
          the learner toggles the "Generate" button — input on the
          left, send on the right, Esc dismisses. Submit dispatches a
          `fishbones:ask-ai` event with `kind: "generate-code"` and
          the AiAssistant takes it from there. */}
      {genOpen && (
        <form
          className="fishbones-playground-generate"
          onSubmit={handleGenerateSubmit}
        >
          <input
            type="text"
            autoFocus
            className="fishbones-playground-generate-input"
            placeholder={`Describe what you want in ${language}…`}
            value={genText}
            onChange={(e) => setGenText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setGenText("");
                setGenOpen(false);
              }
            }}
          />
          <button
            type="submit"
            className="fishbones-playground-generate-submit"
            disabled={genText.trim().length === 0}
          >
            Generate
          </button>
          <button
            type="button"
            className="fishbones-playground-generate-cancel"
            onClick={() => {
              setGenText("");
              setGenOpen(false);
            }}
            aria-label="Cancel"
          >
            ×
          </button>
        </form>
      )}

      {/* Missing-toolchain banner. Only rendered when the Rust probe
          returned installed=false AND the recipe has an install hint
          (i.e. we know how to fix it). Sits above the workbench so it's
          the first thing the learner sees if they just picked Kotlin and
          don't have it yet. Bumping `tcRefresh` after a successful install
          re-runs the probe and clears the banner. */}
      {toolchainStatus &&
        !toolchainStatus.installed &&
        toolchainStatus.install_hint && (
          <MissingToolchainBanner
            status={toolchainStatus}
            onInstalled={() => setTcRefresh((n) => n + 1)}
          />
        )}

      <div className="fishbones-playground-workbench">
        {showEditor && showOutput ? (
          // Classic split — the Workbench card gives us the resize handle
          // and matches what courses use so switching between the two
          // doesn't rearrange muscle memory.
          <Workbench
            storageKey="kata:playground-workbench-split"
            fillWidth
            editor={editorNode}
            output={outputNode}
          />
        ) : showEditor ? (
          // Editor-only: same card chrome as the workbench but without
          // the second column.
          <div className="fishbones-playground-solo">{editorNode}</div>
        ) : (
          <div className="fishbones-playground-solo">{outputNode}</div>
        )}
      </div>
    </div>
  );
}
