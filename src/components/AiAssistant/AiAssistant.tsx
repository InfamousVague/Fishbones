import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AiCharacter from "./AiCharacter";
import AiChatPanel from "./AiChatPanel";
import { useAiChat } from "../../hooks/useAiChat";
import type { Lesson, Course } from "../../data/types";

interface Props {
  /// Current lesson the learner is on, or null when they're in the
  /// library / playground / profile view. Fed into the system prompt
  /// so "explain this" / "nudge me" work without the user having to
  /// paste the lesson in by hand.
  lesson?: Lesson | null;
  course?: Course | null;
  /// Bumped (to a fresh `Date.now()`) on every transition from
  /// incomplete → complete. We watch the value, not the count, so a
  /// learner who hits the same lesson twice in a row re-triggers the
  /// celebration loop instead of being stuck on stale state.
  celebrateAt?: number;
}

/// How long Ava holds the happy pose after a lesson completes. Long
/// enough to feel like a real reaction, short enough that she's back
/// to idle by the time the learner clicks "Next lesson".
const CELEBRATE_MS = 3500;

/// Top-level assistant surface: floating character (bottom-right) +
/// slide-in chat panel. Owns the open/closed state, the conversation,
/// and the system-prompt assembly that injects lesson context.
///
/// System-prompt policy: we prepend the active lesson body + (for
/// exercise lessons) the starter and the user's current file set.
/// This is a stage-1 shim — stage 2 swaps it for a real RAG pipeline
/// that retrieves the top-k relevant chunks across the whole library.
export default function AiAssistant({ lesson, course, celebrateAt }: Props) {
  const [open, setOpen] = useState(false);
  const chat = useAiChat();

  // Latch a celebration when the parent bumps `celebrateAt`. We
  // ignore the initial 0 / undefined so the very first mount doesn't
  // misfire — only meaningful timestamps trigger the swap.
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!celebrateAt) return;
    setCelebrating(true);
    const t = window.setTimeout(() => setCelebrating(false), CELEBRATE_MS);
    return () => window.clearTimeout(t);
  }, [celebrateAt]);

  const systemPrompt = useMemo(
    () => buildSystemPrompt(course ?? null, lesson ?? null),
    [course, lesson],
  );

  const contextLabel = useMemo(() => {
    if (!lesson) return undefined;
    if (course) return `${course.title} — ${lesson.title}`;
    return lesson.title;
  }, [lesson, course]);

  const handleSend = useCallback(
    (prompt: string) => {
      void chat.send(prompt, systemPrompt);
    },
    [chat, systemPrompt],
  );

  // Listen for "ask AI" events from the lesson reader, quiz view,
  // and command palette. Dispatchers pack a `kind` discriminator
  // into the event detail:
  //   "code" / "quiz" / "explain-step"
  //                   → open + auto-send a context-aware prompt
  //   "generate-code" → send WITHOUT auto-opening; when the stream
  //                     finishes we extract the fenced block and fire
  //                     `fishbones:apply-code` so the playground can
  //                     drop the code straight into the editor without
  //                     making the learner copy/paste from chat.
  //   "open"          → open the panel only (palette's "Ask Fishbones"
  //                     entry — the user types their own question)
  const pendingGenerateRef = useRef<{ language: string | undefined } | null>(null);
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<AskAiDetail>;
      const detail = ce.detail;
      if (!detail) return;
      // generate-code is the only kind that can stay closed — the
      // result lands in the editor, not in chat. Open everything else
      // so the learner sees what's happening.
      if (detail.kind !== "generate-code") setOpen(true);
      if (detail.kind === "open") return;
      if (detail.kind === "generate-code") {
        pendingGenerateRef.current = { language: detail.language };
      }
      const prompt = formatAskPrompt(detail);
      void chat.send(prompt, systemPrompt);
    };
    window.addEventListener("fishbones:ask-ai", handler);
    return () => window.removeEventListener("fishbones:ask-ai", handler);
  }, [chat, systemPrompt]);

  // Watch for the streaming → idle transition that closes a pending
  // generate-code request. On completion, walk the latest assistant
  // message, extract the first fenced code block, and dispatch
  // `fishbones:apply-code` so the playground (or any future host) can
  // write it into the editor. The model is instructed to return ONLY
  // a fenced block; we still parse defensively in case it adds prose.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = chat.streaming;
    if (!wasStreaming || chat.streaming) return;
    const pending = pendingGenerateRef.current;
    if (!pending) return;
    pendingGenerateRef.current = null;
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const code = extractFencedCode(last.content, pending.language);
    if (!code) return;
    window.dispatchEvent(
      new CustomEvent("fishbones:apply-code", {
        detail: { language: pending.language, code },
      }),
    );
  }, [chat.streaming, chat.messages]);

  // Red dot on the character when Ollama isn't reachable OR the
  // default model isn't pulled. Hidden once the probe succeeds so
  // the idle look stays clean.
  const alert = useMemo(() => {
    if (!chat.probe) return false;
    return !chat.probe.reachable || !chat.probe.hasDefaultModel;
  }, [chat.probe]);

  return (
    <>
      <AiCharacter
        open={open}
        streaming={chat.streaming}
        celebrating={celebrating}
        onClick={() => setOpen((v) => !v)}
        alert={alert}
      />
      <AiChatPanel
        open={open}
        messages={chat.messages}
        streaming={chat.streaming}
        error={chat.error}
        probe={chat.probe}
        installStatus={chat.installStatus}
        setupBusy={chat.setupBusy}
        onSend={handleSend}
        onClose={() => setOpen(false)}
        onReset={chat.reset}
        onRetryProbe={chat.refreshProbe}
        onInstallOllama={chat.installOllama}
        onStartOllama={chat.startOllama}
        onPullModel={chat.pullModel}
        contextLabel={contextLabel}
      />
    </>
  );
}

/// Assemble the system prompt. Keeps the tone concise, tells the model
/// it's running locally (so it doesn't promise web searches or tool
/// use), and pastes the active lesson body so the user can say
/// "explain this" without copy-pasting. Truncates the body at ~6k
/// chars — Qwen 2.5 Coder has a 32k context but we want to leave room
/// for the conversation + the user's code + the output.
function buildSystemPrompt(course: Course | null, lesson: Lesson | null): string {
  const header = [
    "You are the Fishbones tutor, a local coding assistant running on the learner's own machine via Ollama.",
    "Keep replies tight: 2–4 short paragraphs max, use short code blocks when they help, avoid restating the question.",
    "You have no internet access. Don't claim you can look things up.",
    "When the learner is stuck, prefer a small nudge (one concept, one hint) over a full solution unless they explicitly ask.",
  ].join(" ");

  if (!lesson) {
    return `${header}\n\nThe learner isn't on a specific lesson right now.`;
  }

  const ctx: string[] = [];
  if (course) ctx.push(`Course: ${course.title} (${course.language})`);
  ctx.push(`Lesson: ${lesson.title}`);
  if (lesson.kind) ctx.push(`Kind: ${lesson.kind}`);
  const difficulty = (lesson as { difficulty?: string }).difficulty;
  if (difficulty) ctx.push(`Difficulty: ${difficulty}`);

  const body = truncate(lesson.body ?? "", 6000);
  const starter = (lesson as { starter?: string }).starter;
  const solution = (lesson as { solution?: string }).solution;

  const parts = [
    header,
    "",
    "Active lesson context:",
    ctx.join(" · "),
  ];
  if (body) {
    parts.push("", "Lesson body (markdown):", body);
  }
  if (starter) {
    parts.push("", "Starter code:", "```", truncate(starter, 2000), "```");
  }
  if (solution) {
    // Include the reference solution BUT instruct the model to
    // withhold it unless the learner asks directly. Having it in
    // context means hints can point at the right next step.
    parts.push(
      "",
      "Reference solution (DO NOT volunteer this unless the learner explicitly asks for the solution):",
      "```",
      truncate(solution, 2000),
      "```",
    );
  }
  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[… truncated for length …]`;
}

/// Pull the first fenced code block out of a model reply. We prefer a
/// block whose info string matches `language` when one is provided so
/// a model that wraps an example AND the answer in two blocks (rare,
/// but the prompt asks for one) still gives the playground the right
/// thing. Falls back to "first fenced block" then to "the whole reply
/// stripped" so a stubborn model that ignored the formatting rule
/// still produces something usable.
function extractFencedCode(content: string, language?: string): string | null {
  // Match ```lang\n...\n``` non-greedy. `[\s\S]` keeps it line-tolerant
  // so multi-line bodies aren't truncated by `.` semantics.
  const fence = /```([a-zA-Z0-9_+#-]*)\s*\n([\s\S]*?)```/g;
  const blocks: Array<{ lang: string; code: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    blocks.push({ lang: m[1].toLowerCase(), code: m[2].replace(/\s+$/, "") });
  }
  if (blocks.length === 0) {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (language) {
    const wanted = languageFenceAliases(language);
    const match = blocks.find((b) => wanted.includes(b.lang));
    if (match) return match.code;
  }
  return blocks[0].code;
}

/// One-line description of where each playground language actually
/// runs, so the model doesn't generate DOM-based JS in the no-DOM
/// sandbox or `fmt.Println` Go in a runtime that needs `func main`. Fed
/// into the generate-code prompt — without it the model defaults to
/// "browser HTML" or "Node CLI" assumptions that break on Run.
function playgroundEnvironmentNote(language: string): string {
  switch (language) {
    case "javascript":
      return "Sandboxed JS worker. NO DOM (no `document`, no `window`), NO Node APIs (no `fs`, no `require`). Use `console.log` for output. Plain functions + a top-level call to demonstrate them.";
    case "typescript":
      return "Same sandbox as JavaScript — type-stripped before run. NO DOM, NO Node APIs. `console.log` for output. Avoid `import` statements for libraries; the runtime can't resolve them.";
    case "python":
      return "Pyodide (Python in WASM). Standard library + numpy/pandas available. NO filesystem, NO network. `print(...)` for output.";
    case "rust":
      return "Sandbox via play.rust-lang.org (edition 2021). Use `fn main()` as entry point. `std` available; no external crates. `println!` for output.";
    case "go":
      return "Sandbox via play.golang.org. Single `main` package with `func main()`. Standard library only. `fmt.Println` for output.";
    case "swift":
      return "Online Swift sandbox. Top-level statements OK (script style). `print(...)` for output. No SwiftUI / no UIKit — pure stdlib.";
    case "c":
      return "Local `cc` compiler. Use `int main(void) { ... }`. `printf` for output. POSIX headers OK; no platform-specific APIs.";
    case "cpp":
      return "Local `c++` compiler. Use `int main()`. `std::cout << ...` for output. C++17. No external libs.";
    case "java":
      return "Local `javac` + `java`. Single `public class App { public static void main(String[] args) { ... } }`. `System.out.println` for output.";
    case "kotlin":
      return "Local `kotlinc` compiled to JVM. Use `fun main() { ... }` as entry point (NOT script-style top-level statements). `println(...)` for output.";
    case "csharp":
      return "Local `dotnet script` (.csx). Top-level statements OK. `Console.WriteLine` for output.";
    case "assembly":
      return "Local macOS `as` + `ld`. Exit-with-code via the BSD syscall ABI. No libc.";
    case "web":
      return "Three-file HTML/CSS/JS preview rendered in a real iframe. DOM is available; pick the file you need to populate. The runtime serves the assembled doc at a local URL.";
    case "threejs":
      return "Three.js scene runs in a real iframe with a `<canvas>` and the Three.js library preloaded as `THREE`. Scene mount + animate loop expected.";
    case "react":
      return "React (web) sandbox. Multi-file: `App.jsx` declares a top-level `App` component, `style.css` is inlined globally. React hooks (useState/useEffect/etc.) are in scope — DO NOT write `import React from 'react'`. Render returns JSX; the runtime mounts <App /> via createRoot. No router, no external libs.";
    case "reactnative":
      return "React Native sandbox via Expo Snack-style preview. JSX with components from `react-native` (View, Text, Pressable). NO web DOM.";
    default:
      return "Unknown environment — keep the snippet minimal and use stdout for results.";
  }
}

/// Common fence aliases per language so a model using `js` instead of
/// `javascript` (etc.) still matches. Lower-cased for comparison.
function languageFenceAliases(language: string): string[] {
  switch (language) {
    case "javascript": return ["javascript", "js", "node"];
    case "typescript": return ["typescript", "ts"];
    case "python": return ["python", "py"];
    case "rust": return ["rust", "rs"];
    case "go": return ["go", "golang"];
    case "swift": return ["swift"];
    case "c": return ["c"];
    case "cpp": return ["cpp", "c++", "cxx"];
    case "java": return ["java"];
    case "kotlin": return ["kotlin", "kt"];
    case "csharp": return ["csharp", "c#", "cs"];
    case "assembly": return ["assembly", "asm", "s"];
    case "web": return ["html"];
    case "threejs": return ["javascript", "js"];
    case "reactnative": return ["jsx", "tsx", "javascript"];
    default: return [language.toLowerCase()];
  }
}

/// Payload of `fishbones:ask-ai` custom events. The lesson reader's
/// code-block badges fire `kind: "code"`; the quiz view's question
/// badges fire `kind: "quiz"`. Each carries enough context to build
/// a self-contained prompt.
type AskAiDetail =
  | {
      kind: "code";
      language?: string;
      code: string;
      lessonTitle?: string;
    }
  | {
      kind: "quiz";
      prompt: string;
      lessonTitle?: string;
    }
  | {
      /// Playground "Explain" button — walk through the editor's
      /// current contents step-by-step. Same shape as `kind: "code"`
      /// but with a more thorough prompt because the user picked it
      /// deliberately rather than tapping a code block in passing.
      kind: "explain-step";
      language?: string;
      code: string;
    }
  | {
      /// Playground "Generate" button — produce a new code snippet in
      /// the current language from a natural-language description.
      /// `request` is the learner's sentence ("a fizzbuzz function
      /// that handles negative numbers", etc.).
      kind: "generate-code";
      language?: string;
      request: string;
    }
  | {
      /// "Just open the panel" trigger, used by the command palette
      /// when the learner picks "Ask Fishbones" without anything
      /// specific in mind. No auto-send — they type their own
      /// question.
      kind: "open";
    };

function formatAskPrompt(detail: Exclude<AskAiDetail, { kind: "open" }>): string {
  if (detail.kind === "code") {
    const lang = detail.language || "";
    return [
      "Walk me through this code snippet from the lesson — what does it do, why is it written this way, and where would I expect to use a similar pattern?",
      "",
      "```" + lang,
      detail.code,
      "```",
    ].join("\n");
  }
  if (detail.kind === "explain-step") {
    const lang = detail.language || "";
    const langLabel = lang ? ` (${lang})` : "";
    return [
      `Explain this code${langLabel} step by step.`,
      "Break it into small chunks (a few related lines at most). For each chunk, give me:",
      "1. A one-sentence summary of what it does in plain English.",
      "2. The language-specific mechanic at play — why this syntax, what it evaluates to, where you'd typically use a similar pattern.",
      "End with a short paragraph on the overall behaviour and any subtle gotchas worth flagging.",
      "",
      "```" + lang,
      detail.code,
      "```",
    ].join("\n");
  }
  if (detail.kind === "generate-code") {
    const lang = detail.language || "";
    const langLabel = lang || "the active language";
    return [
      `Write ${langLabel} code that does the following:`,
      "",
      `> ${detail.request.trim()}`,
      "",
      "Output ONLY the code, in a single fenced block tagged with the language. No prose before or after the block — the code will be dropped straight into a sandboxed playground editor and run as-is. Keep it runnable and self-contained: include any imports, a `main` entry where the language requires one, and avoid placeholder TODOs.",
      "",
      "Playground environment for this language:",
      playgroundEnvironmentNote(lang),
    ].join("\n");
  }
  // quiz
  return [
    "Help me think through this quiz question without giving the answer outright. Point at the concept I should be reasoning from.",
    "",
    `> ${detail.prompt}`,
  ].join("\n");
}
