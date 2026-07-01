import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { code as codeIcon } from "@base/primitives/icon/icons/code";
import { eye } from "@base/primitives/icon/icons/eye";
import { columns2 } from "@base/primitives/icon/icons/columns-2";
import { smartphone } from "@base/primitives/icon/icons/smartphone";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import "@base/primitives/icon/icon.css";
import { SegmentedControl } from "@base/primitives/segmented-control";
import "@base/primitives/segmented-control/segmented-control.css";
import type { LanguageId } from "@/data/types";
import type { UseSandboxProjectsResult } from "@/hooks/useSandboxProjects";
import { useToolchainStatus } from "@/hooks/useToolchainStatus";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { runFiles, isPassing, type RunResult } from "@/runtimes/index";
import EditorPane from "@/components/organisms/Editor/EditorPane";
import OutputPane from "@/components/organisms/Output/OutputPane";
import EvmDockBanner from "@/components/organisms/ChainDock/EvmDockBanner";
import BitcoinDockBanner from "@/components/organisms/BitcoinChainDock/BitcoinDockBanner";
import { useChainActivity } from "@/hooks/useChainActivity";
import PhoneToggleButton from "@/components/organisms/FloatingPhone/PhoneToggleButton";
import {
  openPhonePopout,
  closePhonePopout,
  makePhonePreviewBus,
  type PhonePreviewMsg,
} from "@/lib/phonePopout";
import Workbench from "@/components/organisms/Workbench/Workbench";
import MissingToolchainBanner from "@/components/molecules/banners/MissingToolchain/MissingToolchainBanner";
import { useT } from "@/i18n/i18n";
import { track } from "@/lib/track";
import "./SandboxView.css";
import { validateFilePath } from "@/lib/aiTools/sandboxValidation";

/// Fire a `libre:ask-ai` event the way LessonReader / QuizView do.
/// AiAssistant is mounted at the app root and listens window-wide, so a
/// plain CustomEvent is enough plumbing — no prop drilling required.
function askAi(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("libre:ask-ai", { detail }));
}

/// A slim banner that appears while the AGENT is writing files into
/// the open project. Listens to the same `libre:agent-file-write`
/// progress events the chat panel's FileWriteChip pills use, so the
/// user can SEE the assistant working in their editor instead of
/// files silently swapping under them. Self-contained — manages its
/// own visibility from the event stream.
function AgentEditingBanner({ projectId }: { projectId: string }) {
  const [editing, setEditing] = useState<{ path: string; done: boolean } | null>(
    null,
  );
  useEffect(() => {
    let clearTimer = 0;
    const onWrite = (ev: Event) => {
      const d = (
        ev as CustomEvent<{ projectId?: string; path?: string; closed?: boolean }>
      ).detail;
      if (!d?.projectId || d.projectId !== projectId || !d.path) return;
      // Render-boundary guard: never show a junk path (the old
      // "tool_call></tool_call>" banner). Real writes always pass.
      if (!validateFilePath(d.path).ok) return;
      window.clearTimeout(clearTimer);
      if (d.closed) {
        setEditing({ path: d.path, done: true });
        clearTimer = window.setTimeout(() => setEditing(null), 1100);
      } else {
        setEditing({ path: d.path, done: false });
      }
    };
    // A new agent run clears any stale banner.
    const onRunStart = () => {
      window.clearTimeout(clearTimer);
      setEditing(null);
    };
    window.addEventListener("libre:agent-file-write", onWrite);
    window.addEventListener("libre:agent-run-start", onRunStart);
    return () => {
      window.removeEventListener("libre:agent-file-write", onWrite);
      window.removeEventListener("libre:agent-run-start", onRunStart);
      window.clearTimeout(clearTimer);
    };
  }, [projectId]);

  if (!editing) return null;
  return (
    <div
      className={
        "libre-sandbox-agent-banner" +
        (editing.done ? " libre-sandbox-agent-banner--done" : "")
      }
      role="status"
      aria-live="polite"
    >
      <span className="libre-sandbox-agent-banner-spark" aria-hidden>
        ✨
      </span>
      {editing.done ? (
        <>AI updated <code>{editing.path}</code></>
      ) : (
        <>AI is editing <code>{editing.path}</code>…</>
      )}
    </div>
  );
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
  <title>Libre Sandbox</title>
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

/// Languages the sandbox offers. The roster matches LanguageId —
/// the picker shows every supported runtime so a user can try anything
/// without hunting for it. Web + Three.js are multi-file templates
/// (HTML + CSS + JS); their starter content lives in `playgroundTemplates.ts`.
const LANGUAGE_OPTIONS: Array<{ id: LanguageId; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "ruby", label: "Ruby" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "dart", label: "Dart" },
  { id: "scala", label: "Scala" },
  { id: "haskell", label: "Haskell" },
  { id: "elixir", label: "Elixir" },
  { id: "lua", label: "Lua" },
  { id: "sql", label: "SQL" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "csharp", label: "C#" },
  { id: "assembly", label: "Assembly" },
  { id: "zig", label: "Zig" },
  { id: "web", label: "Web (HTML + CSS + JS)" },
  { id: "threejs", label: "Three.js" },
  { id: "react", label: "React (JSX + CSS)" },
  { id: "reactnative", label: "React Native" },
  { id: "svelte", label: "Svelte 5" },
  { id: "solid", label: "SolidJS" },
  { id: "htmx", label: "HTMX" },
  { id: "astro", label: "Astro" },
  { id: "bun", label: "Bun" },
  { id: "tauri", label: "Tauri (Rust)" },
  // Smart-contract languages grouped at the bottom — they share
  // the "needs a chain-specific toolchain" mental model.
  { id: "solidity", label: "Solidity" },
  { id: "move", label: "Move (Aptos / Sui)" },
  { id: "cairo", label: "Cairo (StarkNet)" },
  { id: "sway", label: "Sway (Fuel)" },
];

/// View layout options for the workbench. `split` (editor + output
/// side by side) is the default; `editor` collapses the output entirely
/// for focused code time; `preview` collapses the editor so the URL
/// card / console fills the pane (useful for reading a long stack
/// trace or stacking the URL card front-and-center). `phone` wraps the
/// output pane in an iPhone-shaped chrome (PhoneFrame) — only available
/// for the React Native and Swift languages, where a device frame is
/// the right mental model.
type ViewMode = "split" | "editor" | "preview" | "phone";

/// View-mode options. Labels are i18n KEYS (resolved at render
/// time) rather than literal strings so the segmented toggle
/// switches its tab labels when the locale changes.
const VIEW_MODE_OPTIONS: Array<{
  id: ViewMode;
  labelKey: string;
  icon: string;
}> = [
  { id: "split", labelKey: "sandbox.viewSplit", icon: columns2 },
  { id: "editor", labelKey: "sandbox.viewEditor", icon: codeIcon },
  { id: "preview", labelKey: "sandbox.viewPreview", icon: eye },
  { id: "phone", labelKey: "sandbox.viewPhone", icon: smartphone },
];

/// Languages where the "Phone simulator" view mode makes sense. Other
/// languages drop the option entirely from the segmented control — a
/// terminal language being shown inside a device frame is more
/// confusing than helpful.
const PHONE_VIEW_LANGUAGES = new Set<LanguageId>(["reactnative", "swift"]);

/// jsfiddle-style free-form coding sandbox. No lesson prose, no "mark
/// complete" — just a language picker, editor, and output pane. Each
/// "project" carries its own file list + language so a user can keep
/// multiple workspaces side-by-side; the active project's state is
/// persisted to localStorage (see useSandboxProjects).
///
/// The hook call lives in App.tsx so the Sandbox's sidebar slot —
/// the project switcher + file tree, mounted as a sibling of
/// `<main>` when the sandbox view is active — reads from the same
/// state this view writes to. SandboxView takes the hook result as
/// a single `projects` prop instead of instantiating the hook
/// locally.
interface SandboxViewProps {
  projects: UseSandboxProjectsResult;
}

export default function SandboxView({ projects }: SandboxViewProps) {
  const t = useT();
  const {
    activeProject,
    setActiveProjectId,
    setActiveLanguage,
    files,
    setFiles,
    resetToTemplate,
    activeFileIdx,
    setActiveFileIdx,
  } = projects;

  /// AI-agent focus bridge. The agent tools fire
  /// `libre:sandbox-focus` after they create / write / patch a
  /// project; we listen here, switch the active project to the
  /// one the agent is working on, and (when a path is supplied)
  /// move the editor's focus to that file. Combined with the
  /// `libre:sandbox-refresh` listener in `useSandboxProjects`,
  /// this is how the user sees the agent's work happen in
  /// real time instead of having to navigate to the project
  /// manually.
  useEffect(() => {
    const onFocus = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        projectId?: string;
        path?: string;
      }>).detail;
      if (!detail?.projectId) return;
      if (detail.projectId !== activeProject.id) {
        setActiveProjectId(detail.projectId);
      }
      if (detail.path) {
        // Active file resolution: walk the active project's file
        // list for the matching name. If the refresh hasn't
        // landed yet (the agent's last save fired refresh +
        // focus in quick succession), the file may not yet be
        // in `projects.projects` — re-try once on the next tick
        // so the file index lookup hits the freshly-pulled
        // listing instead of the stale snapshot.
        const tryFocus = () => {
          const target = projects.projects.find(
            (p) => p.id === detail.projectId,
          );
          if (!target) return false;
          const idx = target.files.findIndex((f) => f.name === detail.path);
          if (idx >= 0) {
            setActiveFileIdx(idx);
            return true;
          }
          return false;
        };
        if (!tryFocus()) {
          window.setTimeout(tryFocus, 60);
        }
      }
    };
    window.addEventListener("libre:sandbox-focus", onFocus);
    return () => window.removeEventListener("libre:sandbox-focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject.id, projects.projects]);
  // Inside the view body we treat the active project's language as
  // "the language" — this is how every consumer of the old hook
  // shape read it. The setter is `setActiveLanguage` because we
  // also need to re-seed file content when the picker changes.
  const language = activeProject.language;
  const setLanguage = setActiveLanguage;
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);

  // Analytics: the free-play sandbox was opened. Fires once per mount
  // with the active project's language (mirrors how LessonView fires
  // `lesson.start` on mount), so the dashboard can see sandbox usage
  // and which languages people reach for. Language switches WITHIN a
  // session are captured by `setting.change`-style flows elsewhere,
  // not re-reported here, to keep this an "opened" signal.
  useEffect(() => {
    track.sandboxOpen(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /// Watch the in-process chains. The dock banners self-mount above
  /// the sandbox header whenever either chain has txs / blocks
  /// past genesis. Lets a learner experiment with `runFiles({...})`
  /// using the bitcoin or evm harness and immediately see balances
  /// + recent txs without leaving the sandbox. Both gate to false
  /// on a fresh chain so the sandbox stays uncluttered.
  const chainActivity = useChainActivity();
  /// Bumped after a successful toolchain install so the probe re-runs
  /// and the banner can disappear. Kept here instead of inside the hook
  /// so the Run button can also trigger a re-probe after a `launch_error`
  /// surfaces a missing tool mid-session.
  const [tcRefresh, setTcRefresh] = useState(0);
  const { status: toolchainStatus } = useToolchainStatus(language, tcRefresh);
  // Default to split — editor + output side-by-side so run results appear
  // immediately without the learner having to switch views.
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  // Floating phone preference: persisted so the user's "I want the
  // popout" intent sticks across reloads. The actual popout window
  // lives in `lib/phonePopout.ts`; only the persistence is owned
  // here, so the current value goes unread (the hook handles the
  // write-through on every set).
  const [, setFloatingPhoneOpen] = useLocalStorageState<boolean>(
    "libre:floating-phone-open",
    true,
  );

  // Phone popout scope keyed on the active language so RN and Swift
  // each have their own popout window + bus channel — a learner can
  // flip between languages without one popout's content overwriting
  // the other.
  // Scope each project's phone popout to its id (not just language)
  // — that way a user with two RN projects open in sequence doesn't
  // see project A's preview when they pop the simulator while
  // viewing project B.
  const phoneScope = `sandbox:${activeProject.id}`;
  // Cache the most recent state pushed to the popout. The popout
  // asks for a re-emit via `request-state` when it mounts — without
  // a cache the popout sits stuck on the empty placeholder if it
  // opens AFTER the most recent run already finished. See the
  // matching pattern in LessonView for the full rationale.
  const lastPhoneStateRef = useRef<PhonePreviewMsg | null>(null);
  const phoneBus = useMemo(() => {
    if (!PHONE_VIEW_LANGUAGES.has(language)) return null;
    const raw = makePhonePreviewBus(phoneScope);
    return {
      listen: raw.listen,
      emit: (msg: PhonePreviewMsg) => {
        if (msg.type !== "request-state") {
          lastPhoneStateRef.current = msg;
        }
        raw.emit(msg);
      },
    };
  }, [language, phoneScope]);

  // Reply to the popout's `request-state` handshake with the most
  // recent cached message so a fresh popout doesn't sit on the
  // empty placeholder. Mirrors LessonView's reply logic.
  useEffect(() => {
    if (!phoneBus) return;
    const unlisten = phoneBus.listen((msg: PhonePreviewMsg) => {
      if (msg.type !== "request-state") return;
      const cached = lastPhoneStateRef.current;
      if (cached) phoneBus.emit(cached);
    });
    return unlisten;
  }, [phoneBus]);
  // Close the popout when the user navigates away from a phone-
  // eligible language so we don't leave a stale RN simulator open
  // while they're editing Python. We re-open on the next Run for
  // the new language anyway.
  useEffect(() => {
    return () => {
      if (PHONE_VIEW_LANGUAGES.has(language)) {
        void closePhonePopout(phoneScope);
      }
    };
  }, [language, phoneScope]);

  // Auto-flip the view mode when the user switches to / away from a
  // phone-friendly language. Two distinct nudges:
  //   1. Picking RN/Swift while still on the default `split` view →
  //      jump straight into `phone` so the chrome is visible without
  //      having to discover the segmented control.
  //   2. Picking a non-phone language while in `phone` → fall back to
  //      `split` because the phone option gets hidden underneath them
  //      and we'd otherwise leave the user staring at an empty pane.
  // Once the user manually picks a different mode after a language
  // change, we stop nudging — the effect's dependencies only fire on
  // language transitions so a manual `setViewMode("split")` while on
  // RN sticks.
  useEffect(() => {
    if (PHONE_VIEW_LANGUAGES.has(language)) {
      if (viewMode === "split") setViewMode("phone");
    } else {
      if (viewMode === "phone") setViewMode("split");
    }
    // Intentionally only depend on `language` — we don't want to
    // re-fire when the user manually flips the view mode, only when
    // the language transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Filter the segmented-control options so the "Phone" pill only
  // appears when the active language can use it. Avoids a dead pill
  // for Python / Rust / etc. Memoised so the sliding-pill layout
  // effect (which lists this in its deps) only re-runs when the
  // option set actually changes, not on every render.
  const visibleViewModeOptions = useMemo(
    () =>
      VIEW_MODE_OPTIONS.filter(
        (opt) => opt.id !== "phone" || PHONE_VIEW_LANGUAGES.has(language),
      ),
    [language],
  );

  const showEditor = viewMode !== "preview";
  const showOutput = viewMode !== "editor";

  // The view-mode segmented control is the Base `<SegmentedControl>`
  // (size lg); it owns its own sliding indicator, so the old
  // measure-and-position-a-pill layout effect was removed.
  // Phone-eligible language in either `phone` or `split` view → render
  // the floating-phone modal over a full-width editor instead of the
  // old fixed right-pane phone stage. `editor` / `preview` view modes
  // are explicit user requests to hide the simulator, so we don't
  // override them by floating one in.
  const useFloatingPhone =
    PHONE_VIEW_LANGUAGES.has(language) &&
    (viewMode === "phone" || viewMode === "split");

  // "Generate from a prompt" mini-form. Toggled by the Generate button
  // in the header; closes itself after submit. We keep the input local
  // here (rather than punting to the chat panel) so the learner stays
  // in the sandbox's mental model — type the request, get the code,
  // paste it back into the editor.
  const [genOpen, setGenOpen] = useState(false);
  const [genText, setGenText] = useState("");

  // Pending DOM-route: when the apply-code handler decides a JS snippet
  // should run as a Web app, it stashes the html/js payload here and
  // calls setLanguage("web"). A separate effect waits for the language
  // to actually flip (so useSandboxProjects has seeded the web template
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

  // Legacy `libre:apply-code` listener — used to receive the final
  // fenced-block payload that the CHAT-routed generate-code path
  // emitted on stream completion. The sandbox's Generate button
  // now routes through the AGENT path instead (see AiAssistant.tsx
  // dispatch handler), which calls `create_sandbox_project` to spin
  // up a fresh project + streams files via the
  // `useSandboxStreamWriter` parser writing ```lang:path fenced
  // blocks straight into the new project's files. So this listener
  // is effectively dormant for the sandbox's own Generate flow.
  //
  // Kept wired in case a future surface (e.g. an external script
  // or a different in-app affordance) needs to dispatch a one-shot
  // "drop this code into the active editor" event without going
  // through the agent. The DOM auto-route below is the only piece
  // of behaviour that depends on this — it catches a model that
  // returns `document.getElementById(...)` JS for the no-DOM plain-
  // JS sandbox and synthesises an HTML scaffold + flips the
  // sandbox to the `web` language so the snippet works.
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
    window.addEventListener("libre:apply-code", handler);
    return () => window.removeEventListener("libre:apply-code", handler);
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
    // Auto-pop the phone simulator open on every Run for a phone-
    // eligible language. The popout window opens (or focuses, if
    // already open); we also push a `running` marker so the popout
    // shows a "running…" placeholder while the runtime works.
    if (PHONE_VIEW_LANGUAGES.has(language)) {
      setFloatingPhoneOpen(true);
      void openPhonePopout(phoneScope, `Sandbox · ${activeProject.name}`);
      phoneBus?.emit({ type: "running" });
    }
    try {
      const r = await runFiles(language, files);
      if (!r) {
        const msg = `No runtime for language "${language}".`;
        setResult({
          logs: [],
          error: msg,
          durationMs: 0,
        });
        // Analytics: a sandbox run that couldn't resolve a runtime is
        // still a run the user attempted — record it as a failure.
        track.sandboxRun({ language, ok: false });
        if (PHONE_VIEW_LANGUAGES.has(language)) {
          phoneBus?.emit({ type: "console", logs: [], error: msg });
        }
        return;
      }
      setResult(r);
      // Analytics: one `sandbox.run` per completed run. `ok` reflects
      // whether the runtime returned without an error (the sandbox has
      // no tests, so there's no pass/fail beyond "did it run cleanly").
      track.sandboxRun({ language, ok: !r.error });
      // Push the run outcome to the popped phone simulator. RN's
      // self-hosted preview URL drives an iframe in the popout;
      // Swift (and any RN run that didn't yield a previewUrl)
      // renders its captured stdout/stderr in a console panel.
      if (PHONE_VIEW_LANGUAGES.has(language)) {
        if (language === "reactnative" && r.previewUrl) {
          phoneBus?.emit({ type: "preview", url: r.previewUrl });
        } else {
          phoneBus?.emit({
            type: "console",
            logs: r.logs ?? [],
            error: r.error,
          });
        }
      }
      void isPassing; // silence unused import — the helper is part of
      // the public runtimes surface, we just don't need it for the
      // no-tests sandbox path.
    } catch (e) {
      const errMsg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      setResult({
        logs: [],
        error: errMsg,
        durationMs: 0,
      });
      // Analytics: a thrown error from the runtime chain is a failed run.
      track.sandboxRun({ language, ok: false });
      if (PHONE_VIEW_LANGUAGES.has(language)) {
        phoneBus?.emit({ type: "console", logs: [], error: errMsg });
      }
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
      // Enable the "✨ … with AI" right-click actions — the sandbox is
      // where co-creation happens (they edit the open project).
      aiSelectionActions
    />
  );
  const outputNode = (
    <OutputPane result={result} running={running} language={language} />
  );

  // Build the body of the phone "screen" based on the active language.
  // RN gets the live preview iframe (same URL the OutputPane card opens
  // externally — embedded inline here so it reads as a device render);
  // Swift gets a console-style log dump because the Swift runner only
  // emits stdout/stderr. Anything else (the language picker is gated
  // upstream so this is defensive) shows a placeholder.
  return (
    <div className="libre-sandbox">
      {/* Chain docks (EVM + Bitcoin). Each gates on its own
          activity flag — they stay hidden on a fresh sandbox and
          slide in above the header once the learner runs code that
          touches the singleton chain. */}
      {chainActivity.evm && <EvmDockBanner />}
      {chainActivity.bitcoin && <BitcoinDockBanner />}
      {/* "✨ AI is editing X" — surfaces the agent's live writes into
          THIS project so co-creation is legible: the user sees the
          assistant working in their editor, not silent file swaps. */}
      <AgentEditingBanner projectId={activeProject.id} />
      {/* Header: language picker on the left, view toggle on the right.
          Eyebrow "LANGUAGE" label removed — the select's own caret
          + visible chip is enough affordance, and the label was
          adding visual weight on a row already dense with controls.
          Accessible name still attached via `aria-label` on the
          select. */}
      <div className="libre-sandbox-header">
        <label className="libre-sandbox-lang-picker">
          <select
            className="libre-sandbox-lang-select"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as LanguageId)}
            aria-label={t("sandbox.language")}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="libre-sandbox-spacer" />

        {/* AI helpers — Explain (walks through current editor source
            step-by-step) and Generate (opens an inline prompt where
            the learner describes what they want and the assistant
            emits code in the active language). Both round-trip
            through the existing `libre:ask-ai` event bus that
            LessonReader / QuizView already use. */}
        <div className="libre-sandbox-ai" role="group" aria-label={t("sandbox.ariaHelpers")}>
          <button
            type="button"
            className="libre-sandbox-ai-btn"
            onClick={handleExplain}
            disabled={currentSource().trim().length === 0}
            title={t("sandbox.explainTooltip")}
          >
            <Icon icon={sparkles} size="sm" color="currentColor" />
            {t("sandbox.explain")}
          </button>
          <button
            type="button"
            className={`libre-sandbox-ai-btn ${
              genOpen ? "libre-sandbox-ai-btn--active" : ""
            }`}
            onClick={() => setGenOpen((v) => !v)}
            aria-expanded={genOpen}
            title={t("sandbox.generateTooltip")}
          >
            <Icon icon={sparkles} size="sm" color="currentColor" />
            {t("sandbox.generate")}
          </button>
        </div>

        <SegmentedControl
          size="lg"
          className="libre-sandbox-seg"
          ariaLabel={t("sandbox.viewMode")}
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
          options={visibleViewModeOptions.map((opt) => ({
            value: opt.id,
            title: t(opt.labelKey),
            label: (
              <>
                <Icon icon={opt.icon} size="sm" color="currentColor" />
                <span className="libre-sandbox-seg-label">
                  {t(opt.labelKey)}
                </span>
              </>
            ),
          }))}
        />
      </div>

      {/* Generate-from-prompt strip. Slides in under the header when
          the learner toggles the "Generate" button — input on the
          left, send on the right, Esc dismisses. Submit dispatches a
          `libre:ask-ai` event with `kind: "generate-code"` and
          the AiAssistant takes it from there. */}
      {genOpen && (
        <form
          className="libre-sandbox-generate"
          onSubmit={handleGenerateSubmit}
        >
          <input
            type="text"
            autoFocus
            className="libre-sandbox-generate-input"
            placeholder={t("sandbox.generatePlaceholder", { language })}
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
            className="libre-sandbox-generate-submit"
            disabled={genText.trim().length === 0}
          >
            {t("sandbox.generate")}
          </button>
          <button
            type="button"
            className="libre-sandbox-generate-cancel"
            onClick={() => {
              setGenText("");
              setGenOpen(false);
            }}
            aria-label={t("sandbox.cancelGenerate")}
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

      <div className="libre-sandbox-workbench">
        {useFloatingPhone ? (
          // Floating-phone path: the editor takes the full pane width
          // and the phone simulator overlays as a draggable modal
          // (rendered below at the sandbox root). This replaces
          // the old fixed right-pane phone stage for `phone` + `split`
          // views on RN/Swift. `outputNode` isn't shown here because
          // the floating phone IS the output surface — the user can
          // still flip viewMode to `preview` to get the textual
          // logs/error pane.
          <div className="libre-sandbox-solo">{editorNode}</div>
        ) : showEditor && showOutput ? (
          // Classic split — the Workbench card gives us the resize handle
          // and matches what courses use so switching between the two
          // doesn't rearrange muscle memory.
          <Workbench
            storageKey="libre:playground-workbench-split"
            fillWidth
            editor={editorNode}
            output={outputNode}
          />
        ) : showEditor ? (
          // Editor-only: same card chrome as the workbench but without
          // the second column.
          <div className="libre-sandbox-solo">{editorNode}</div>
        ) : (
          <div className="libre-sandbox-solo">{outputNode}</div>
        )}
      </div>

      {/* Phone simulator popout toggle. The simulator itself lives
          in a separate OS window (opened via `openPhonePopout`); the
          button below offers the user a way to focus / re-open it.
          We always render the toggle while we're on a phone-
          eligible language because there's no reliable cross-
          platform Tauri signal for "the user closed the popout
          window OS-style", so the cheapest correct UX is "always
          offer to re-open / focus". `openPhonePopout` is idempotent
          — re-opening an already-open window just focuses it. */}
      {useFloatingPhone && (
        <PhoneToggleButton
          onShow={() => {
            setFloatingPhoneOpen(true);
            void openPhonePopout(phoneScope, `Sandbox · ${activeProject.name}`);
            // Replay the latest result into a fresh popout so the
            // window doesn't open empty after a Run already produced
            // output. Mirrors the logic in handleRun() so the bus
            // payload format stays identical.
            if (result) {
              if (language === "reactnative" && result.previewUrl) {
                phoneBus?.emit({ type: "preview", url: result.previewUrl });
              } else {
                phoneBus?.emit({
                  type: "console",
                  logs: result.logs ?? [],
                  error: result.error,
                });
              }
            }
          }}
        />
      )}
    </div>
  );
}
