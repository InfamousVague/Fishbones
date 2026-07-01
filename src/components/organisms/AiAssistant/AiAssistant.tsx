import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AiCharacter from "./AiCharacter";
import AiChatPanel from "./AiChatPanel";
import AiAgentPanel from "./AiAgentPanel";
import { useAiChat, type ChatMessage } from "@/hooks/useAiChat";
import { useAiAgent, type AgentMessage } from "@/hooks/useAiAgent";
import { buildToolRegistry } from "@/lib/aiTools/tools";
import { useAgentScope } from "@/lib/aiTools/scope";
import {
  formatRetrievalBlock,
  searchCourseContent,
} from "@/lib/ai/retrieval";
import { buildMemoryBlock } from "@/lib/ai/memory";
import { buildLinkGuard } from "@/lib/ai/linkGuard";
import { loadSettings, type AiAgentSettings } from "@/lib/aiAgent/settings";
import { buildAgentSystemPrompt } from "@/lib/aiAgent/agentSystemPrompt";
import { streamsFilesLive, emulatedBuildTier } from "@/lib/ai/models";
import {
  ensureToolCapability,
  resolveToolNative,
} from "@/lib/ai/toolCapability";
import {
  buildSelectionAskDisplay,
  buildSelectionAskPrompt,
  selectionAskRoutesToAgent,
  type SandboxSelectionAsk,
} from "./selectionAsk";
import { readAiEnabled } from "@/lib/aiHost";
import TrayHeader from "@/components/organisms/TrayPanel/TrayHeader";
import { useTraySessions } from "@/components/organisms/TrayPanel/useTraySessions";
import { useSandboxStreamWriter } from "@/components/organisms/TrayPanel/useSandboxStreamWriter";
import "@/components/organisms/TrayPanel/TrayPanel.css";
import { track } from "@/lib/track";
import type { Lesson, Course } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";

interface Props {
  /// Current lesson the learner is on, or null when they're in the
  /// library / playground / profile view. Fed into the system prompt
  /// so "explain this" / "nudge me" work without the user having to
  /// paste the lesson in by hand.
  lesson?: Lesson | null;
  course?: Course | null;
  /// Every installed course. Used to build the catalog snippet in
  /// the system prompt so the model can suggest courses + lessons
  /// (e.g. "I want to learn Rust") with clickable libre:// links
  /// that the AiChatPanel intercepts and routes to in-app
  /// navigation. Also threaded through the agent's tool context
  /// so tool handlers like `list_courses` / `search_lessons` can
  /// answer without re-querying.
  courses?: readonly Course[];
  /// Lesson-completion history. Powers the agent's
  /// `list_completions` tool ("when did I last touch course X?").
  /// Optional — when omitted the tool returns an empty list.
  history?: readonly Completion[];
  /// User-completion set (`${courseId}:${lessonId}`). Threaded
  /// through the agent's tool context so tools can compute
  /// per-course progress without re-walking history.
  completed?: ReadonlySet<string>;
  /// Bumped (to a fresh `Date.now()`) on every transition from
  /// incomplete → complete. We watch the value, not the count, so a
  /// learner who hits the same lesson twice in a row re-triggers the
  /// celebration loop instead of being stuck on stale state.
  celebrateAt?: number;
  /// The sandbox project the user currently has OPEN in the editor
  /// (derived from `useSandboxProjects.activeProject`). Threaded into
  /// the agent's tool context + system prompt so "edit this / add to
  /// this project" targets what the learner is actually looking at,
  /// and so the agent's focus stays in sync with the editor. Null
  /// when the sandbox hasn't initialised.
  currentSandbox?: {
    projectId: string;
    name: string;
    language: string;
    activeFilePath?: string;
  } | null;
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
export default function AiAssistant({
  lesson,
  course,
  courses,
  history,
  completed,
  celebrateAt,
  currentSandbox,
}: Props) {
  const [open, setOpen] = useState(false);

  // Shared session store with the menu-bar tray — typing in
  // either surface appends to the same conversation list, and
  // both surfaces show the same recency-sorted dropdown. The
  // current `mode` (chat vs agent) is whichever the active
  // session is on; switching modes via the header swaps the
  // active session to the most recent one of that mode (or
  // spawns a fresh one).
  const sessions = useTraySessions();
  const mode = sessions.active.mode;
  const setMode = sessions.setMode;
  // Click-outside-to-close. While the panel is open, listen for
  // mousedown anywhere on the document — if the click landed
  // outside both the panel itself AND the floating orb (which has
  // its own toggle handler that would otherwise be cancelled out
  // by the close-on-outside-click here), close the panel.
  // mousedown rather than click so dialogs that mount on click
  // don't briefly see the AI panel still open beneath them.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      // Click landed inside the AI panel — keep open.
      if (target.closest(".libre-ai-panel")) return;
      // Click landed inside the AI shell wrapper (header / sessions
      // dropdown / mode toggle) — keep open. The dropdown menu sits
      // outside `.libre-ai-panel` so we need a second match.
      if (target.closest(".libre-ai-host")) return;
      // Click landed on the orb — its onClick will toggle. Don't
      // race it from here; the toggle handles the close itself.
      if (target.closest(".libre-ai-character")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);
  // Track the enable toggle as React state so flipping it in
  // Settings re-renders this component. We re-read from
  // localStorage in response to the custom event the
  // `writeAiEnabled` helper dispatches — same channel the AI host
  // field uses, since both inputs feed the same downstream state.
  const [enabled, setEnabled] = useState<boolean>(() => readAiEnabled());
  useEffect(() => {
    const update = () => setEnabled(readAiEnabled());
    window.addEventListener("libre:ai-host-changed", update);
    // Cross-tab toggles arrive as `storage` events.
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "libre:ai-assistant-enabled") update();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("libre:ai-host-changed", update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  // Selected local Ollama model. Source of truth for the CHAT hook
  // (the agent reads settings.model internally). Initialised from
  // the persisted agent settings so chat + agent always run the
  // same model; kept in sync when the settings sheet's model picker
  // changes it (see the onUpdateSettings wrapper passed to the
  // panel below). Threading it into useAiChat is what makes the
  // picker actually swap which model the tutor chat talks to.
  const [localModel, setLocalModel] = useState(() => loadSettings().model);
  // Daemon-aware tool tier for the SELECTED model. Seeded from the
  // static registry guess, then refined by the async capability probe
  // (ensureToolCapability) — e.g. a deepseek the user's Ollama gives a
  // native tool template flips to native and gets the structured
  // channel. Drives the emulated-prompt + live-stream decisions so
  // both react when the probe lands.
  const [toolNative, setToolNative] = useState(() =>
    resolveToolNative(localModel),
  );
  useEffect(() => {
    setToolNative(resolveToolNative(localModel));
    let live = true;
    void ensureToolCapability(localModel).then(() => {
      if (live) setToolNative(resolveToolNative(localModel));
    });
    return () => {
      live = false;
    };
  }, [localModel]);
  // Effort rung mirrored out of the agent settings the same way as
  // the model, so the CHAT hook applies the same Fast/…/Ultra dial
  // the header dropdown sets (the agent reads settings.effort
  // internally). Kept in sync via the onUpdateSettings wrapper below.
  const [localEffort, setLocalEffort] = useState(() => loadSettings().effort);
  // Co-working mode mirrored out of agent settings so the agent
  // system prompt (built below, BEFORE the agent hook exists) can
  // shape itself per mode. Kept in sync via onUpdateSettings.
  const [localPairMode, setLocalPairMode] = useState(
    () => loadSettings().pairMode,
  );
  const chat = useAiChat(localModel, localEffort);

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
    () => buildSystemPrompt(course ?? null, lesson ?? null, courses ?? []),
    [course, lesson, courses],
  );

  // Live refs for the tray-forwarder effect below. `useAiChat` returns
  // a fresh object every render (no useMemo), so depending on `chat`
  // directly would re-run the listener-registration effect on every
  // render — tearing down + re-subscribing 7 Tauri listeners token-by-
  // token during streaming, which races Tauri's internal registry and
  // throws `listeners[eventId].handlerId` from unlisten. Registering
  // once and reading the latest values through refs avoids the churn.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;

  // Agent working scope — persisted across sessions so the user's
  // "you can only touch project X" instruction survives a reload.
  // The agent itself can extend / refocus its scope via the
  // `extend_scope` / `set_active_project` tools (with user
  // approval); the host surface (the scope chip we render in
  // the panel header) also offers manual edits.
  const agentScope = useAgentScope();

  // Agent-mode tool set. Built fresh whenever the underlying
  // state changes so tool handlers close over the latest courses
  // + completion data + scope.
  const agentTools = useMemo(
    () =>
      buildToolRegistry({
        courses: courses ?? [],
        completed: completed ?? new Set<string>(),
        history: history ?? [],
        scope: agentScope.scope,
        updateScope: agentScope.setScope,
        currentSandbox: currentSandbox ?? null,
        // Tools dispatch through the same in-window CustomEvents
        // the libre:// link interception uses. App.tsx already
        // listens for these and routes to selectLesson /
        // openCourseFromLibrary.
        openLesson: (cid, lid) =>
          window.dispatchEvent(
            new CustomEvent("libre:open-lesson", {
              detail: { courseId: cid, lessonId: lid },
            }),
          ),
        openCourse: (cid) =>
          window.dispatchEvent(
            new CustomEvent("libre:open-course", {
              detail: { courseId: cid },
            }),
          ),
      }),
    [
      courses,
      completed,
      history,
      agentScope.scope,
      agentScope.setScope,
      currentSandbox,
    ],
  );

  // Keep the agent's scope focus in lock-step with the project the
  // user has OPEN in the sandbox. One source of truth: the editor's
  // active project. Equality-gated so this never fights the reverse
  // direction (set_active_project → libre:sandbox-focus → editor
  // switch → here), which would otherwise loop.
  useEffect(() => {
    const openId = currentSandbox?.projectId ?? null;
    if (openId && openId !== agentScope.scope.activeProjectId) {
      agentScope.setActiveProject(openId);
    }
  }, [currentSandbox?.projectId, agentScope.scope.activeProjectId, agentScope.setActiveProject]);

  // Agent-mode system prompt. Separate from the chat-mode one
  // because the agent needs to KNOW it has tools and SHOULD USE
  // them (chat mode treats tool calls as a recommendation, not a
  // mandate). Catalog snippet is intentionally NOT in this prompt
  // — the agent's `list_courses` tool returns the same info on
  // demand without bloating every turn's context.
  const agentSystemPrompt = useMemo(
    () =>
      buildAgentSystemPrompt(course ?? null, lesson ?? null, localPairMode, {
        // Emulated-tier models don't get Ollama's native tool
        // template (the loop strips wire tools to avoid a 400), so
        // the prompt has to teach them the text tool-call format +
        // list the available tools. Native models (incl. ones the
        // daemon probe upgraded to native) get the structured channel
        // and need neither.
        emulatedToolNames: toolNative
          ? undefined
          : agentTools.map((t) => t.name),
        // Tier the emulated instructions: weak models lean on plain
        // fenced files, strong ones get the full <tool_call> protocol.
        emulatedTier: emulatedBuildTier(localModel),
        currentSandbox: currentSandbox ?? null,
      }),
    [
      course,
      lesson,
      localPairMode,
      localModel,
      toolNative,
      agentTools,
      currentSandbox,
    ],
  );

  // libre:// link guard — strips hallucinated lesson/course deep
  // links from agent output. Rebuilt only when the installed
  // course set changes.
  const linkGuard = useMemo(
    () => buildLinkGuard(courses ?? []),
    [courses],
  );
  const agent = useAiAgent({
    systemPrompt: agentSystemPrompt,
    tools: agentTools,
    postProcessAssistant: linkGuard,
  });

  // Single settings-update entry point shared by BOTH the header
  // dropdowns and the agent settings sheet. Persists + applies to
  // the agent (its settingsRef updates so the next agent turn uses
  // the new values), AND mirrors `model` + `effort` into
  // AiAssistant's local state so the CHAT hook re-probes / re-applies
  // them too. One funnel means the header and the sheet can't drift.
  const handleUpdateSettings = useCallback(
    (next: AiAgentSettings) => {
      agent.updateSettings(next);
      setLocalModel((cur) => (next.model !== cur ? next.model : cur));
      setLocalEffort((cur) => (next.effort !== cur ? next.effort : cur));
      setLocalPairMode((cur) =>
        next.pairMode !== cur ? next.pairMode : cur,
      );
    },
    [agent],
  );

  // ── Stream-to-file parser (in-app parity with the tray) ─────
  //
  // Watches the latest assistant message and writes any
  // ` ```lang:path ` fenced blocks into the active sandbox
  // project as the model types. Same hook the menu-bar tray
  // uses — the in-app variant just runs it against THIS
  // window's chat hook so building from inside the app feels
  // identical to building from the menu-bar popover.
  const latestAgentContent = useMemo(() => {
    for (let i = agent.messages.length - 1; i >= 0; i--) {
      const m = agent.messages[i];
      if (m.role === "assistant") return m.content ?? "";
    }
    return "";
  }, [agent.messages]);
  // Live char-by-char streaming into the editor is reserved for STRONG
  // builders — native models and capable coders (streamsFilesLive),
  // plus any model the daemon probe upgraded to native. WEAK emulated
  // models (e.g. gemma3:4b) skip the live writer; their files land
  // post-turn through the loop's validated fence synthesis, which is
  // safer against their noisier token streams (the live writer parses
  // mid-stream, before recovery/validation runs). ("Auto by model
  // strength.")
  //
  // LATCHED: freeze the flag for the duration of a run so a mid-build
  // model switch can't flip the writer and truncate half-written files.
  const liveGate = streamsFilesLive(localModel) || toolNative;
  const writerEnabledRef = useRef(true);
  useEffect(() => {
    if (!agent.streaming) writerEnabledRef.current = liveGate;
  }, [agent.streaming, liveGate]);
  const writerEnabled = agent.streaming ? writerEnabledRef.current : liveGate;
  useSandboxStreamWriter(latestAgentContent, writerEnabled);

  // ── Session ↔ hook bridge ────────────────────────────────────
  //
  // Whichever hook matches the active session's mode is the live
  // one — its messages get mirrored back to the session store,
  // and when the user picks a different session in the dropdown
  // we hot-swap the hook's messages via `loadMessages` so the
  // panel re-renders the saved log without unmounting.
  //
  // Sync direction: hook → store. Fires whenever the live hook's
  // message list changes (user sends → chunks arrive → assistant
  // bubble grows → effect re-runs → store snapshot updates).
  // syncActive itself skips a write when the content is unchanged
  // so this isn't noisy during streaming.
  const lastLoadedRef = useRef<{
    sessionId: string;
    mode: "chat" | "agent";
  } | null>(null);
  useEffect(() => {
    if (mode !== "chat") return;
    sessions.syncActive(chat.messages);
  }, [chat.messages, mode, sessions]);
  useEffect(() => {
    if (mode !== "agent") return;
    sessions.syncActive(agent.messages);
  }, [agent.messages, mode, sessions]);

  // Sync direction: store → hook. When the user picks a different
  // session (or the mode swap promoted a different session to
  // active), load the saved messages into the matching hook so
  // the panel reflects the chosen conversation. Skip the case
  // where the live hook is already showing this session (no-op
  // load avoids a needless setState).
  useEffect(() => {
    const id = sessions.active.id;
    const last = lastLoadedRef.current;
    if (last && last.sessionId === id && last.mode === mode) return;
    lastLoadedRef.current = { sessionId: id, mode };
    if (mode === "chat") {
      chat.loadMessages(sessions.active.messages as ChatMessage[]);
    } else {
      agent.loadMessages(sessions.active.messages as AgentMessage[]);
    }
    // Intentionally omit chat / agent from deps — `loadMessages`
    // is stable per-hook + we DON'T want this effect re-firing on
    // every chat.messages update (the hook→store effect handles
    // that direction). eslint-disable just for the cross-direction
    // safety.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.active.id, mode]);

  const contextLabel = useMemo(() => {
    if (!lesson) return undefined;
    if (course) return `${course.title} — ${lesson.title}`;
    return lesson.title;
  }, [lesson, course]);

  /// Plausible context for ai.* events when the user is interacting
  /// with the floating panel directly (typed prompt, orb click).
  /// "lesson" when a lesson is mounted; "free" everywhere else
  /// (library, profile, etc.). The sandbox and tray surfaces fire
  /// through their own paths below and pass their own context.
  const panelContext: "lesson" | "free" = lesson ? "lesson" : "free";

  const handleSend = useCallback(
    (prompt: string) => {
      track.aiSend({ mode: "chat", context: panelContext });
      void chat.send(prompt, systemPrompt);
    },
    [chat, systemPrompt, panelContext],
  );

  const handleAgentSend = useCallback(
    (prompt: string) => {
      // Emulated models build too: the loop recovers their text /
      // fenced output into validated tool calls (synthesizeFromFences
      // + extractXmlToolCalls), and the live stream-writer is gated by
      // model strength (streamsFilesLive) so weak models land files
      // post-turn instead of spraying junk mid-stream.
      track.aiSend({ mode: "agent", context: panelContext });
      void agent.send(prompt);
    },
    [agent, panelContext],
  );

  // Listen for "ask AI" events from the lesson reader, quiz view,
  // command palette, and sandbox toolbar. Dispatchers pack a `kind`
  // discriminator into the event detail:
  //   "code" / "quiz" / "explain-step" / "ask"
  //                   → open + auto-send a context-aware prompt to
  //                     the CHAT hook (no tool use needed; the
  //                     learner is just asking a question).
  //   "generate-code" → open + auto-send to the AGENT hook so the
  //                     model can `create_sandbox_project` (new
  //                     project, correct language), then stream
  //                     each file as ```lang:path fenced blocks
  //                     that `useSandboxStreamWriter` writes into
  //                     the editor live. The agent panel renders
  //                     the streaming reply + tool-approval chips
  //                     while files appear in the sandbox in
  //                     real-time.
  //   "open"          → open the panel only (palette's "Ask Libre"
  //                     entry — the user types their own question)
  const pendingGenerateRef = useRef<{ language: string | undefined } | null>(null);
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<AskAiDetail>;
      const detail = ce.detail;
      if (!detail) return;
      // generate-code routes to AGENT mode so it can spin up a new
      // project, pick the right language, and stream files into
      // the editor as it works. Every other kind goes to CHAT mode
      // (the conversational tutor surface) so the streaming reply
      // is the answer itself, not a tool-orchestration log.
      // Agent-routed kinds use the tool-calling surface (they build
      // or EDIT files); everything else is the conversational tutor.
      const isAgentRouted =
        detail.kind === "generate-code" ||
        (detail.kind === "sandbox-selection" &&
          selectionAskRoutesToAgent(detail.action));
      const targetMode: "chat" | "agent" = isAgentRouted ? "agent" : "chat";
      setMode(targetMode);
      // Open the Ask Libre modal for every dispatched event so the
      // learner has a signal that the model is working — agent
      // mode shows the tool-call timeline + streaming text, chat
      // mode shows the streaming reply. Both make the "something
      // is happening" affordance obvious.
      setOpen(true);
      // Plausible: `ai.open` for the surface that dispatched this
      // event, then `ai.send` once we know which hook receives it.
      // Context is derived from `detail.kind` since the dispatcher
      // (lesson reader / quiz / sandbox / tray / palette) is the
      // most reliable source of truth — the global `lesson` prop
      // can be stale during a route transition.
      const askContext: "lesson" | "sandbox" | "tray" | "free" =
        detail.kind === "code" ||
        detail.kind === "quiz" ||
        detail.kind === "selection"
          ? "lesson"
          : detail.kind === "explain-step" ||
              detail.kind === "generate-code" ||
              detail.kind === "sandbox-selection"
            ? "sandbox"
            : detail.kind === "ask"
              ? "tray"
              : panelContext; // "open" — defer to lesson presence
      track.aiOpen(targetMode);
      if (detail.kind === "open") return;
      // Emulated models (gemma/deepseek) build via the loop's text /
      // fence recovery — no longer blocked here. The build pipeline
      // validates every recovered path + rejects tool-call payloads,
      // and the live writer is gated by model strength downstream.
      if (detail.kind === "generate-code") {
        pendingGenerateRef.current = { language: detail.language };
        // Hand the prompt off to the agent. The agent's system
        // prompt instructs it to call `create_sandbox_project`
        // first when building from scratch, then stream files
        // as fenced blocks — which `useSandboxStreamWriter` is
        // already watching for.
        //
        // Pass BOTH the user's original wording AND the bolstered
        // workflow-framing prompt. The chat panel renders the
        // first ("Build a blackjack game in React"); the LLM
        // receives the second (the multi-paragraph "Build this
        // from scratch in the sandbox: …" brief). Without this
        // split the chat shows the entire system-prompt-looking
        // payload as the user's first bubble, which reads as
        // confusing chrome.
        const augmented = formatAskPrompt(detail);
        const displayed = detail.request.trim();
        track.aiSend({ mode: "agent", context: askContext });
        void agent.send(displayed, augmented);
        return;
      }
      // Agent-routed selection edit ("improve"/"comment" this code).
      // The agent edits the OPEN project in place (Iter 1 defaulting +
      // Iter 2 non-destructive merge make this safe).
      if (
        detail.kind === "sandbox-selection" &&
        selectionAskRoutesToAgent(detail.action)
      ) {
        track.aiSend({ mode: "agent", context: askContext });
        void agent.send(formatAskDisplay(detail), formatAskPrompt(detail));
        return;
      }
      // Chat-routed kinds (code, explain-step, quiz, ask,
      // selection): same displayed-vs-augmented split. The chat
      // panel renders the user's intent in plain terms; the LLM
      // receives the workflow-framed payload from
      // `formatAskPrompt` — plus, for natural-language kinds,
      // retrieval grounding: the top lessons from the learner's
      // installed courses that match the question, with
      // clickable libre:// links. A question about borrowing
      // asked from a Rustlings exercise pulls the Rust Book's
      // "References and Borrowing" lesson into the prompt so the
      // answer can cite the material the learner already has.
      const groundingQuery =
        detail.kind === "selection"
          ? detail.text
          : detail.kind === "sandbox-selection"
            ? detail.selectedText
            : detail.kind === "quiz" || detail.kind === "ask"
              ? detail.prompt
              : null;
      const grounding =
        groundingQuery && courses && courses.length > 0
          ? formatRetrievalBlock(
              searchCourseContent(courses, groundingQuery, 3, {
                // Same-course affinity: a question asked from
                // inside Rustlings prefers Rustlings material on
                // near-ties. `course` can be stale during a route
                // transition but a mild boost can't mislead.
                currentCourseId:
                  detail.kind === "selection"
                    ? detail.courseId
                    : course?.id,
              }),
            )
          : "";
      const augmented =
        formatAskPrompt(detail) + (grounding ? `\n\n${grounding}` : "");
      const displayed = formatAskDisplay(detail);
      track.aiSend({ mode: "chat", context: askContext });
      void chat.send(displayed, systemPrompt, augmented);
    };
    window.addEventListener("libre:ask-ai", handler);
    return () => window.removeEventListener("libre:ask-ai", handler);
  }, [chat, agent, setMode, systemPrompt, panelContext, courses, course, localModel]);

  // Pending-generate completion is now handled by the AGENT path
  // — `useSandboxStreamWriter` writes each ```lang:path block into
  // the sandbox as it streams in, and the agent's
  // `create_sandbox_project` tool call (the prompt instructs it to
  // call this FIRST) is what spins up a fresh project with the
  // correct language. When the agent finishes, the project is
  // already populated; no post-stream `libre:apply-code` dispatch
  // needed. We still clear the pendingGenerateRef so subsequent
  // generate-code requests start from a clean slate.
  // Live ref to the agent's error state so the streaming→done
  // transition effect below can read the freshest value to derive
  // `ok` WITHOUT re-firing the effect every time `error` changes
  // mid-run (which would mis-count a single run as multiple results).
  const agentErrorRef = useRef(agent.error);
  agentErrorRef.current = agent.error;
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = agent.streaming;
    if (!wasStreaming || agent.streaming) return;
    pendingGenerateRef.current = null;
    // Agent run just finished streaming — record the outcome.
    // `ok=false` when the run surfaced an error (thrown transport
    // error / max-turns). User-initiated stops that don't set an
    // error read as ok=true.
    track.aiResult({ mode: "agent", ok: agentErrorRef.current == null });
  }, [agent.streaming]);

  // Chat-hook counterpart: fire `ai.result` on the chat stream's
  // streaming→done transition. `ok=false` when the send set an
  // error (transport failure / Ollama unreachable / mid-stream
  // error event). Same ref pattern so `chat.error` changes don't
  // themselves re-trigger the effect.
  const chatErrorRef = useRef(chat.error);
  chatErrorRef.current = chat.error;
  const wasChatStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = wasChatStreamingRef.current;
    wasChatStreamingRef.current = chat.streaming;
    if (!wasStreaming || chat.streaming) return;
    track.aiResult({ mode: "chat", ok: chatErrorRef.current == null });
  }, [chat.streaming]);

  // Red dot on the character when Ollama isn't reachable OR the
  // default model isn't pulled. Hidden once the probe succeeds so
  // the idle look stays clean.
  const alert = useMemo(() => {
    if (!chat.probe) return false;
    return !chat.probe.reachable || !chat.probe.hasDefaultModel;
  }, [chat.probe]);

  // ── Menu-bar (tray) bridge ──────────────────────────────────────
  //
  // The macOS menu-bar popover (`TrayPanel`) is a separate
  // WebviewWindow that mirrors THIS conversation. Two halves:
  //   1. Broadcast: any time the chat state changes, emit
  //      `libre:chat-state-sync` with the full snapshot so the
  //      tray re-renders against the latest messages / streaming
  //      flag / probe / etc.
  //   2. Forwarders: listen for tray-side actions (send / reset /
  //      install / probe) and call the local hook methods.
  //      Returns are reflected via the next broadcast.
  // Disabled in non-Tauri contexts (web preview / tests) — the
  // dynamic import would just fail silently there anyway.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ emit }) => {
      if (cancelled) return;
      void emit("libre:chat-state-sync", {
        messages: chat.messages,
        streaming: chat.streaming,
        error: chat.error,
        probe: chat.probe,
        installStatus: chat.installStatus,
        setupBusy: chat.setupBusy,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    chat.messages,
    chat.streaming,
    chat.error,
    chat.probe,
    chat.installStatus,
    chat.setupBusy,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { listen, emit } = await import("@tauri-apps/api/event");
        // Initial-state re-broadcast in response to a tray-init
        // ping. The standing broadcast effect above keeps things in
        // sync once a tray exists; init handles the cold-open case
        // where the tray window mounted AFTER the most recent state
        // change.
        const offInit = await listen("libre:tray-init", () => {
          const c = chatRef.current;
          void emit("libre:chat-state-sync", {
            messages: c.messages,
            streaming: c.streaming,
            error: c.error,
            probe: c.probe,
            installStatus: c.installStatus,
            setupBusy: c.setupBusy,
          });
        });
        // Forwarders for every action the tray's AiChatPanel can
        // emit. Each translates to the matching hook call so the
        // tray surface stays a pure mirror — no second copy of the
        // chat state lives in the popout.
        const offSend = await listen<{ prompt: string }>(
          "libre:tray-send",
          (event) => {
            const prompt = event.payload?.prompt?.trim();
            if (!prompt) return;
            setOpen(true);
            // Tray popout forwarded a user-typed prompt into the
            // main-window chat hook. Surface both `ai.open` (the
            // panel just became visible because of this event) and
            // `ai.send` (a prompt is actually being submitted), tagged
            // with `context: "tray"` so the dashboard can split
            // tray-driven usage from in-app usage.
            track.aiOpen("chat");
            track.aiSend({ mode: "chat", context: "tray" });
            void chatRef.current.send(prompt, systemPromptRef.current);
          },
        );
        const offReset = await listen("libre:tray-reset", () => {
          chatRef.current.reset();
        });
        const offRetry = await listen("libre:tray-retry-probe", () => {
          void chatRef.current.refreshProbe();
        });
        const offInstall = await listen("libre:tray-install-ollama", () => {
          void chatRef.current.installOllama();
        });
        const offStart = await listen("libre:tray-start-ollama", () => {
          void chatRef.current.startOllama();
        });
        const offPull = await listen("libre:tray-pull-model", () => {
          void chatRef.current.pullModel();
        });
        // Tauri's `unlisten` throws if the internal registry entry is
        // already gone (double-teardown / unmount race). Sound is
        // decorative; a stale unlisten must never surface as an
        // unhandled rejection, so swallow per-handler.
        const offAll = [
          offInit,
          offSend,
          offReset,
          offRetry,
          offInstall,
          offStart,
          offPull,
        ];
        const teardown = () => {
          for (const off of offAll) {
            try {
              off();
            } catch {
              /* already unregistered — ignore */
            }
          }
        };
        if (cancelled) {
          teardown();
        } else {
          cleanup = teardown;
        }
      } catch {
        /* Tauri event plugin unavailable — tray is desktop-only,
           this is a benign no-op everywhere else. */
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // Register the tray listeners ONCE for the component's lifetime.
    // Handlers read live state through chatRef / systemPromptRef, so
    // they never go stale despite the empty dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disabled-by-default gate. The user explicitly opts in via
  // Settings → AI & API → "Enable AI assistant". Until that toggle
  // is on, NOTHING AI-related renders — no orb, no panel, no probes.
  // We intentionally hide the entire experience rather than showing
  // a greyed-out orb because a noisy "click here to set up the
  // thing you didn't ask for" affordance was the explicit complaint
  // that prompted this gate.
  if (!enabled) return null;

  return (
    <>
      <AiCharacter
        open={open}
        streaming={chat.streaming || agent.streaming}
        celebrating={celebrating}
        onClick={() =>
          setOpen((v) => {
            // Only fire `ai.open` on the closed → open transition.
            // Toggling closed is a separate UX action; if we ever
            // need a counter for that we'd add `ai.close` rather
            // than overloading the same event name.
            if (!v) track.aiOpen(mode);
            return !v;
          })
        }
        alert={alert}
      />
      {open && (
        <div
          className="libre-ai-host libre-ai-host--floating"
          data-tray-mode={mode}
        >
          <TrayHeader
            mode={mode}
            setMode={setMode}
            probe={chat.probe}
            settings={agent.settings}
            onUpdateSettings={handleUpdateSettings}
            sessions={sessions.sessions}
            activeId={sessions.active.id}
            onSelectSession={sessions.selectSession}
            onNewSession={() => sessions.newSession(mode)}
            onDeleteSession={sessions.deleteSession}
            onClose={() => setOpen(false)}
          />
          {mode === "chat" ? (
            <AiChatPanel
              open={open}
              model={localModel}
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
          ) : (
            <AiAgentPanel
              open={open}
              messages={agent.messages}
              streaming={agent.streaming}
              pending={agent.pending}
              timeline={agent.timeline}
              error={agent.error}
              scope={agentScope.scope}
              usage={agent.usage}
              confidence={agent.confidence}
              clarification={agent.clarification}
              settings={agent.settings}
              courses={courses}
              completed={completed}
              currentCourseId={course?.id}
              currentSandbox={currentSandbox}
              onSend={handleAgentSend}
              onClose={() => setOpen(false)}
              onReset={agent.reset}
              onApprove={agent.approve}
              onDeny={agent.deny}
              onStop={agent.stop}
              onAnswerClarification={agent.answerClarification}
              onCancelClarification={agent.cancelClarification}
              onUpdateSettings={handleUpdateSettings}
              onClearScope={agentScope.clear}
            />
          )}
        </div>
      )}
    </>
  );
}

/// Assemble the system prompt. Keeps the tone concise, tells the model
/// it's running locally (so it doesn't promise web searches or tool
/// use), and pastes the active lesson body so the user can say
/// "explain this" without copy-pasting. Truncates the body at ~6k
/// chars — Qwen 2.5 Coder has a 32k context but we want to leave room
/// for the conversation + the user's code + the output.
function buildSystemPrompt(
  course: Course | null,
  lesson: Lesson | null,
  allCourses: readonly Course[] = [],
): string {
  const header = [
    "You are the Libre tutor, a local coding assistant running on the learner's own machine via Ollama.",
    "Keep replies tight: 2–4 short paragraphs max, use short code blocks when they help, avoid restating the question.",
    "You have no internet access. Don't claim you can look things up.",
    "When the learner is stuck, prefer a small nudge (one concept, one hint) over a full solution unless they explicitly ask.",
    "When the learner asks what to learn / where to start / which course covers X, RECOMMEND specific courses and lessons from the catalog below. Format each recommendation as a markdown link using the libre:// URL given in the catalog — e.g. `[Course Name](libre://course/<id>)` or `[Lesson Title](libre://lesson/<courseId>/<lessonId>)`. Clicking those links opens the course / lesson directly. Never invent a libre:// URL — only use ones that appear verbatim in the catalog below.",
  ].join(" ");

  // Installed-catalog snippet — gives the model enough context to
  // make specific recommendations with clickable libre:// links.
  // Capped at the first 12 courses + first 6 lessons per course to
  // keep the prompt under the model's context window; the
  // truncation is a heuristic, not a hard limit, but covers the
  // typical user's library.
  const catalogLines: string[] = [];
  for (const c of allCourses.slice(0, 12)) {
    const langSuffix = c.language ? ` (${c.language})` : "";
    catalogLines.push(`- [${c.title}](libre://course/${c.id})${langSuffix}`);
    const sample = c.chapters
      .flatMap((ch) => ch.lessons)
      .slice(0, 6);
    for (const l of sample) {
      catalogLines.push(
        `  - [${l.title}](libre://lesson/${c.id}/${l.id})`,
      );
    }
  }
  const catalog =
    catalogLines.length > 0
      ? `\n\nAvailable courses (use these libre:// URLs verbatim when recommending):\n${catalogLines.join("\n")}`
      : "";

  if (!lesson) {
    return `${header}\n\nThe learner isn't on a specific lesson right now.${catalog}`;
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
  // Cross-session learner memory: notes the agent saved in earlier
  // sessions + auto-tracked recurring struggles. Empty string when
  // the learner is new — section omitted entirely.
  const memoryBlock = buildMemoryBlock();
  if (memoryBlock) parts.push("", memoryBlock);
  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[… truncated for length …]`;
}


/// Pull the first fenced code block out of a model reply. We prefer a
// `extractFencedCode`, `playgroundEnvironmentNote`, and
// `languageFenceAliases` lived here when `generate-code` was routed
// through the CHAT hook — we'd wait for streaming to end, pull the
// first fenced block out of the reply, and dispatch
// `libre:apply-code` to drop the code into the editor.
//
// generate-code now routes through the AGENT (see the dispatch
// handler above): the agent's `create_sandbox_project` tool spins
// up a fresh project, and `useSandboxStreamWriter` parses the
// agent's streaming ```lang:path fenced blocks straight into
// sandbox files as they're typed. No post-stream extraction or
// per-language environment hint is needed — the agent's own system
// prompt carries the runtime conventions for every supported
// language. The helpers were removed when the chat path retired.

/// Payload of `libre:ask-ai` custom events. The lesson reader's
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
      /// Inline Ask AI — the learner selected text in the lesson
      /// reader and clicked the floating chip. `text` is the
      /// selection (pre-capped by the popover); the lesson
      /// coordinates let the prompt attribute the passage and the
      /// retrieval layer pull related material.
      kind: "selection";
      text: string;
      courseId?: string;
      lessonId?: string;
      lessonTitle?: string;
    }
  | {
      /// "Just open the panel" trigger, used by the command palette
      /// when the learner picks "Ask Libre" without anything
      /// specific in mind. No auto-send — they type their own
      /// question.
      kind: "open";
    }
  | {
      /// Free-form question, sent verbatim. Used by the macOS
      /// menu-bar tray popover (`TrayPanel.tsx`) — the learner
      /// types their question into the popover's input, the tray
      /// hands it off to the main window via a Tauri event, the
      /// main App listener translates that to a `kind: "ask"`
      /// CustomEvent, and we send the prompt as-is (no special
      /// framing — the user already wrote what they meant).
      kind: "ask";
      prompt: string;
    }
  /// In-sandbox "Ask AI about this selection" — the editor's Monaco
  /// actions fire this. `explain` routes to chat; `improve`/`comment`
  /// route to the agent (they edit the open project in place). See
  /// `selectionAsk.ts`.
  | SandboxSelectionAsk;

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
    // Agent-routed. Route by INTENT, not by a hard "always fork"
    // rule: if the request is an edit/extension of the project the
    // user already has open (see the "# Open sandbox project"
    // section of your system prompt), edit it in place; only spin up
    // a NEW project for a genuinely separate build. The `lang` hint
    // is the sandbox's current selection at Generate time, NOT a
    // constraint — the user's wording ("in React", "a CLI in Rust")
    // trumps it.
    const langHint = lang
      ? `For a NEW build, the sandbox is currently set to \`${lang}\`, but the request may call for a different language — pick whichever best matches the wording (React for UI, Python for scripts, Rust for performance, etc.) and pass it to \`create_sandbox_project\`.`
      : "For a NEW build, pick whichever language best matches the wording (React for UI, Python for scripts, Rust for performance, etc.).";
    return [
      "Work on this in the sandbox:",
      "",
      `> ${detail.request.trim()}`,
      "",
      "FIRST decide intent:",
      "- If this ADDS TO / CHANGES / FIXES the project the user already has open (see '# Open sandbox project' in your system prompt), edit it IN PLACE: read the relevant file(s) with `read_sandbox_file`/`list_sandbox_files`, then `write_sandbox_file` / `apply_sandbox_patch` against that same projectId. Do NOT create a new project for an edit.",
      "- If it's a genuinely NEW, separate build, call `create_sandbox_project` FIRST with a descriptive name + language; the user gets focused into the new project.",
      "- If you're genuinely UNSURE which, prefer creating a NEW project — it's the safer default and never risks overwriting the user's existing work.",
      "",
      langHint,
      "",
      "Then: stream each file as a ```lang:path fenced block (the editor writes them in real time as you type), and call `run_sandbox_project` at the end to verify it runs. If it errors, read the error, patch with `apply_sandbox_patch`, and run again.",
      "",
      "Keep the code runnable, self-contained, and complete — no `TODO` placeholders.",
    ].join("\n");
  }
  if (detail.kind === "ask") {
    // Free-form question. Send it verbatim — the user already
    // phrased what they meant.
    return detail.prompt;
  }
  if (detail.kind === "selection") {
    const where = detail.lessonTitle
      ? ` from the lesson "${detail.lessonTitle}"`
      : "";
    return [
      `I selected this passage${where} — explain it in plain terms.`,
      "Unpack the concept it describes, why it matters, and give one tiny concrete example if that helps. If the passage uses a term of art, define it.",
      "Keep it tight: a few short paragraphs at most, anchored to THIS passage (not a general lecture on the topic).",
      "",
      "> " + detail.text.trim().replace(/\n/g, "\n> "),
    ].join("\n");
  }
  if (detail.kind === "sandbox-selection") {
    return buildSelectionAskPrompt(detail);
  }
  // quiz
  return [
    "Help me think through this quiz question without giving the answer outright. Point at the concept I should be reasoning from.",
    "",
    `> ${detail.prompt}`,
  ].join("\n");
}

/// Companion to `formatAskPrompt` — what to render in the user's
/// chat bubble. The bolstered LLM payload would look like chrome
/// dumped into the conversation; the user wants to see THEIR
/// intent (the code they tapped, the quiz question, the sentence
/// they typed). Each kind gets a short, recognisable version of
/// the action they invoked. The full payload still goes to the
/// model via the `augmented` field on the message.
function formatAskDisplay(
  detail: Exclude<AskAiDetail, { kind: "open" }>,
): string {
  if (detail.kind === "code") {
    const lang = detail.language || "";
    return [
      "Walk me through this snippet.",
      "",
      "```" + lang,
      detail.code,
      "```",
    ].join("\n");
  }
  if (detail.kind === "explain-step") {
    const lang = detail.language || "";
    return [
      "Explain this code step by step.",
      "",
      "```" + lang,
      detail.code,
      "```",
    ].join("\n");
  }
  if (detail.kind === "generate-code") {
    // generate-code goes through the agent path which has its
    // own displayed/augmented split at the call site — this
    // branch is here for completeness (formatAskDisplay's type
    // covers every non-`open` AskAiDetail variant) but doesn't
    // get reached in practice.
    return detail.request.trim();
  }
  if (detail.kind === "ask") {
    return detail.prompt;
  }
  if (detail.kind === "selection") {
    // Show the passage the learner picked, quoted, under a short
    // intent line — mirrors what they did ("I highlighted this").
    return [
      "Explain this passage:",
      "",
      "> " + detail.text.trim().replace(/\n/g, "\n> "),
    ].join("\n");
  }
  if (detail.kind === "sandbox-selection") {
    return buildSelectionAskDisplay(detail);
  }
  // quiz
  return detail.prompt;
}
