import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AiCharacter from "./AiCharacter";
import AiChatPanel from "./AiChatPanel";
import AiAgentPanel from "./AiAgentPanel";
import { useAiChat, type ChatMessage } from "../../hooks/useAiChat";
import { useAiAgent, type AgentMessage } from "../../hooks/useAiAgent";
import { buildToolRegistry } from "../../lib/aiTools/tools";
import { useAgentScope } from "../../lib/aiTools/scope";
import {
  formatRetrievalBlock,
  searchCourseContent,
} from "../../lib/ai/retrieval";
import { buildContextBlock } from "../../lib/ai/context";
import { buildMemoryBlock } from "../../lib/ai/memory";
import { buildLinkGuard } from "../../lib/ai/linkGuard";
import { readAiEnabled } from "../../lib/aiHost";
import TrayHeader from "../TrayPanel/TrayHeader";
import { useTraySessions } from "../TrayPanel/useTraySessions";
import { useSandboxStreamWriter } from "../TrayPanel/useSandboxStreamWriter";
import "../TrayPanel/TrayPanel.css";
import { track } from "../../lib/track";
import type { Lesson, Course } from "../../data/types";
import type { Completion } from "../../hooks/useProgress";

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
    () => buildSystemPrompt(course ?? null, lesson ?? null, courses ?? []),
    [course, lesson, courses],
  );

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
    [courses, completed, history, agentScope.scope, agentScope.setScope],
  );

  // Agent-mode system prompt. Separate from the chat-mode one
  // because the agent needs to KNOW it has tools and SHOULD USE
  // them (chat mode treats tool calls as a recommendation, not a
  // mandate). Catalog snippet is intentionally NOT in this prompt
  // — the agent's `list_courses` tool returns the same info on
  // demand without bloating every turn's context.
  const agentSystemPrompt = useMemo(
    () =>
      buildAgentSystemPrompt(course ?? null, lesson ?? null),
    [course, lesson],
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
  useSandboxStreamWriter(latestAgentContent);

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
      const targetMode: "chat" | "agent" =
        detail.kind === "generate-code" ? "agent" : "chat";
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
              detail.kind === "generate-code"
            ? "sandbox"
            : detail.kind === "ask"
              ? "tray"
              : panelContext; // "open" — defer to lesson presence
      track.aiOpen(targetMode);
      if (detail.kind === "open") return;
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
  }, [chat, agent, setMode, systemPrompt, panelContext, courses, course]);

  // Pending-generate completion is now handled by the AGENT path
  // — `useSandboxStreamWriter` writes each ```lang:path block into
  // the sandbox as it streams in, and the agent's
  // `create_sandbox_project` tool call (the prompt instructs it to
  // call this FIRST) is what spins up a fresh project with the
  // correct language. When the agent finishes, the project is
  // already populated; no post-stream `libre:apply-code` dispatch
  // needed. We still clear the pendingGenerateRef so subsequent
  // generate-code requests start from a clean slate.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = agent.streaming;
    if (!wasStreaming || agent.streaming) return;
    pendingGenerateRef.current = null;
  }, [agent.streaming]);

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
          void emit("libre:chat-state-sync", {
            messages: chat.messages,
            streaming: chat.streaming,
            error: chat.error,
            probe: chat.probe,
            installStatus: chat.installStatus,
            setupBusy: chat.setupBusy,
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
            void chat.send(prompt, systemPrompt);
          },
        );
        const offReset = await listen("libre:tray-reset", () => {
          chat.reset();
        });
        const offRetry = await listen("libre:tray-retry-probe", () => {
          void chat.refreshProbe();
        });
        const offInstall = await listen("libre:tray-install-ollama", () => {
          void chat.installOllama();
        });
        const offStart = await listen("libre:tray-start-ollama", () => {
          void chat.startOllama();
        });
        const offPull = await listen("libre:tray-pull-model", () => {
          void chat.pullModel();
        });
        if (cancelled) {
          offInit();
          offSend();
          offReset();
          offRetry();
          offInstall();
          offStart();
          offPull();
        } else {
          cleanup = () => {
            offInit();
            offSend();
            offReset();
            offRetry();
            offInstall();
            offStart();
            offPull();
          };
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
  }, [chat, systemPrompt]);

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
              onSend={handleAgentSend}
              onClose={() => setOpen(false)}
              onReset={agent.reset}
              onApprove={agent.approve}
              onDeny={agent.deny}
              onStop={agent.stop}
              onAnswerClarification={agent.answerClarification}
              onCancelClarification={agent.cancelClarification}
              onUpdateSettings={agent.updateSettings}
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

/// System prompt for AGENT mode. Different shape from the chat-mode
/// prompt because the agent has tools — we explicitly tell it to USE
/// them rather than recite info it could have looked up. The model
/// also gets a short refresher of the active course / lesson when
/// one is loaded, since "I'm stuck" is still a valid agent prompt
/// even though the agent isn't primarily a tutor surface.
///
/// The prompt is built up in SECTIONS rather than one run-on
/// paragraph: smaller open-weights models (Qwen 2.5 Coder, Llama
/// 3.1, etc.) follow instructions far better when each rule has its
/// own bullet point and the workflow steps are numbered. The
/// previous "single space-joined string" version produced a model
/// that frequently skipped `create_sandbox_project` (because the
/// instruction was buried mid-paragraph) and dumped raw JSON
/// arguments into the chat instead of using the tool channel.
function buildAgentSystemPrompt(
  course: Course | null,
  lesson: Lesson | null,
): string {
  const sections: string[] = [];

  sections.push(
    [
      "# You are the Libre agent",
      "",
      "A local AI coding assistant running on the learner's machine via Ollama. You have TOOLS for navigating courses, reading/writing sandbox project files, running projects, and managing dev servers. Always USE the tools when the user wants real data or real changes — never invent file paths or pretend to have read something you haven't.",
      "",
      "**CRITICAL — TOOL USE IS NOT OPTIONAL.** When the user asks you to build, create, modify, or run anything, your reply MUST invoke the appropriate tool. Replies that dump code in markdown fences without calling `create_sandbox_project` / `write_sandbox_file` are WRONG and will be auto-converted to synthetic tool calls by the runtime — but you should produce them correctly the first time. The runtime auto-recovery is a safety net, not a target. If you find yourself writing `\\`\\`\\`jsx:src/App.jsx` followed by code in your reply WITHOUT having first emitted a `create_sandbox_project` tool call, STOP and emit the tool call instead.",
      "",
      "**ZERO PREAMBLE.** When the user asks for something buildable, your FIRST non-thinking output is the tool call. Specifically BANNED openers (will be auto-stripped from the visible chat anyway, so don't waste tokens on them):",
      "- 'Sure! / Of course! / Absolutely!'",
      "- 'I'll guide you through… / Let me walk you through…'",
      "- 'We'll start by… / First, let's…'",
      "- Numbered or bulleted plans BEFORE you've called any tools ('Step 1: create a project. Step 2: write App.jsx. …')",
      "- Lists of files you 'will' create ahead of creating them.",
      "- Restating the user's request back to them.",
      "",
      "If the request is unambiguous, the SHORTEST correct reply is one tool call with no surrounding text. The chat UI hides any prose you emit alongside a tool call anyway — only the LAST assistant turn (no tool calls, just a 1-2 sentence wrap-up) gets a visible bubble.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Workflow: building a new project",
      "",
      "When the user asks you to build something from scratch (e.g. 'build me a blackjack game in React', 'make a fizzbuzz CLI in Python'):",
      "",
      "**ACT FIRST, EXPLAIN AFTER.** Your very first action MUST be a `create_sandbox_project` tool call. NO preamble like 'I'll build you a tic-tac-toe game with the following structure: …'. NO numbered lists describing what you're going to do. NO confirmation requests. Just call the tool. The approval chip the user clicks is your prose. If you find yourself typing 'first I'll create…', stop, delete it, and emit the tool call instead.",
      "",
      "1. **`create_sandbox_project`** — pick a sensible `name` + `language` based on the user's wording. The tool returns a `projectId` you'll use in every subsequent call. **STRONGLY PREFER** passing the FULL `files` array NOW with EVERY file the build needs — one tool call, one approval chip, the whole project lands atomically. Only omit `files` if the build genuinely needs > 6 files where streaming makes the UX better. The returned `projectId` is what you pass to every subsequent file-write or run call.",
      "",
      "   **THE NUMBER ONE MISTAKE TO AVOID**: creating the project with a single placeholder file (no `files` array) and then STOPPING. That's incomplete — the project has a `Loading…` div and nothing else. Every build needs at minimum the file layout listed under 'File organization' below. If you ran `create_sandbox_project` and your next instinct is to ask the user a question or write a summary instead of immediately writing the rest of the files, STOP and emit the next tool call instead.",
      "",
      "   **Concrete required file counts:**",
      "   - **React**: at minimum `src/App.jsx` (the actual game/app, NOT a Loading placeholder) plus `src/style.css`. A real build also has `src/components/<Name>.jsx` per component and `src/lib/<name>.js` for pure logic. NEVER stop after writing a single `App.jsx` that just returns `<div>Loading…</div>` — that's the placeholder, not the finished build.",
      "   - **Web (HTML+CSS+JS)**: `index.html`, `main.js`, `style.css` at minimum.",
      "   - **Three.js**: `scene.js`, `style.css`, plus geometry/material files.",
      "   - **Python**: `main.py` + the module files (e.g. `fizzbuzz.py`).",
      "   - **Rust**: `main.rs` + the logic modules (e.g. `src/counter.rs`).",
      "",
      "   **The Libre sandbox does NOT need `package.json`** — React, ReactDOM, hooks, etc. are provided by the sandbox runtime via vendored bundles. Just `import { useState } from 'react'` and it works. Same for other languages: their runtimes are already wired up. Don't waste a tool call writing a package.json.",
      "",
      "2. **Stream EVERY file in ONE reply** (only when you omitted `files` in step 1). For each file, emit a markdown fenced code block whose info string carries BOTH the language AND the file path, separated by a colon:",
      "",
      "   ```jsx:src/App.jsx",
      "   import { useState } from 'react';",
      "   export default function App() {",
      "     // …",
      "   }",
      "   ```",
      "",
      "   **ONE REPLY, ALL FILES.** When the build needs 4 files, emit 4 fenced blocks back-to-back in the SAME assistant reply. Do NOT write one file then stop and wait. Do NOT promise 'I'll add the other files next' — the user is watching files appear in real time; they need them all to land in this turn so the run-verify step has the complete build to work with.",
      "",
      "   **CRITICAL fence format**: the `<lang>:<path>` info string is REQUIRED. The user's editor parses this exact `\\`\\`\\`<lang>:<path>` shape to know which file each block belongs to. Without it (e.g. bare `\\`\\`\\`jsx` or `\\`\\`\\``), the system writes to the project's currently-focused file as a fallback — works for single-file builds but breaks multi-file ones. ALWAYS include the `:<path>` portion.",
      "",
      "   **DO NOT** wrap a tool-call payload (`{\"name\": ..., \"arguments\": ...}`) inside a fenced code block — EVER. Tool calls go through the structured `tool_calls` channel, never inside a fence. Putting a tool call inside ```jsx:src/App.jsx will OVERWRITE that file with the tool-call JSON. The system has guards that refuse to write tool-call-shaped content into files, but you should never produce that shape in the first place.",
      "",
      "   Forward slashes only. One block per file. Do NOT split a single file's content across multiple code fences — the parser writes each fence as the COMPLETE current contents of that file. A second fence for the same path overwrites the first.",
      "",
      "3. **`run_sandbox_project`** — pass the `projectId`. Returns logs + any error + optionally a previewUrl. **YOU MUST call this after every build, no exceptions.** A build isn't done until it runs cleanly.",
      "",
      "4. **The auto-verify loop.** If the run returns `{ ok: false, error: ... }`:",
      "    a. Read the error carefully — every error has a file:line reference or a clear cause.",
      "    b. Call `read_sandbox_file` on the offending file if you don't have its current content in your context already.",
      "    c. Call `apply_sandbox_patch` with the minimal fix.",
      "    d. Call `run_sandbox_project` AGAIN. Repeat until the run returns `{ ok: true }`.",
      "    Common run errors and their fixes:",
      "    - `ReferenceError: X is not defined` → you used an identifier you didn't define / import. Add the import or define X.",
      "    - `SyntaxError: Unexpected token` → a typo, missing bracket, or wrong fence boundary. Re-read the file.",
      "    - `Cannot find module 'X'` → you wrote an `import X from 'X'` for a package the sandbox doesn't ship. For React: DO NOT import 'react' — hooks are global. Remove the import.",
      "    - `TypeError: Cannot read property X of undefined` → a state value is undefined on first render. Add a guard or initialise state.",
      "    Keep iterating until the run is green. Don't give up after 1 attempt — 3-5 fix cycles is normal for a non-trivial build. The loop's safety cap (20 turns) gives you plenty of room to fix multiple issues.",
      "",
      "5. **Declare done.** Once `run_sandbox_project` returns `{ ok: true }`, write a SHORT (1-2 sentence) summary of what you built. Mention the file layout if there are 3+ files so the user knows where to read what.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Workflow: editing an existing project",
      "",
      "When the user asks you to modify code in a project that already exists:",
      "",
      "1. **`list_sandbox_projects`** to find the project id (only when the user didn't already tell you which project).",
      "2. **`list_sandbox_files`** to see the project structure.",
      "3. **`read_sandbox_file`** for each file you'll touch — never edit blind.",
      "4. **`apply_sandbox_patch`** to make all the changes in one approval chip. Use single `write_sandbox_file` calls only for trivial one-file tweaks.",
      "5. **`run_sandbox_project`** to verify the edit didn't break anything.",
    ].join("\n"),
  );

  sections.push(
    [
      "# File organization — favor SMALL FILES, ONE CONCERN EACH",
      "",
      "STRONG default: split builds into multiple small files. Even for a 100-line project, prefer 3-5 files of 20-30 lines each over one monolithic file. The user is here to learn; well-factored code reads as a tour of separation-of-concerns, not a wall of unbroken text.",
      "",
      "Concrete rules:",
      "",
      "- **One component per file** (React / Solid / Svelte). `App.jsx` mounts components, doesn't define them. Each meaningful component goes in `src/components/<Name>.jsx`.",
      "- **Logic separate from UI**. Pure functions (deck shuffling, score calculation, validation rules, formatters) go in `src/lib/<name>.js`. Components import them. Easier to read, easier to test, and the user sees how a real codebase factors business logic from rendering.",
      "- **Constants in their own module**. Card suits, color palettes, level thresholds, API endpoints — they all go in `src/lib/constants.js` (or split further by domain) instead of being inlined into the file that happens to use them first.",
      "- **Styles per component when they're scoped**. For React: `src/components/Card.css` next to `src/components/Card.jsx`. For Svelte: `<style>` inside the `.svelte` file. For HTML+CSS+JS sandbox: keep `index.html` skeletal and put rules in `style.css`.",
      "- **Index re-exports** only when there are 4+ siblings. Don't write `src/components/index.js` for a 2-component project — premature abstraction.",
      "- **Tests next to their target** when the project ships them. `src/lib/deck.js` ↔ `src/lib/deck.test.js`.",
      "",
      "Concrete shapes by example:",
      "",
      "- **'Build a blackjack game in React'** → `src/App.jsx` (mounts), `src/components/Hand.jsx`, `src/components/Card.jsx`, `src/components/Controls.jsx`, `src/lib/deck.js`, `src/lib/score.js`, `src/components/App.css`. NOT one 400-line `App.jsx`.",
      "- **'Make a fizzbuzz CLI in Python'** → `main.py` (entrypoint), `fizzbuzz.py` (the pure function). Two files at minimum even for the simplest case.",
      "- **'Three.js scene with a spinning cube'** → `scene.js` (setup + animation loop), `cube.js` (geometry + materials), `style.css`. Keep mounts thin, factor geometry.",
      "- **'Word counter in Rust'** → `main.rs` (CLI surface) + `src/counter.rs` (pure logic). Even one-file scripts split when there's a non-trivial pure function.",
      "",
      "The ONLY time to put everything in one file: explicitly one-shot scripts under ~25 lines where splitting would feel like ceremony (e.g. 'one-liner regex script'). Default to splitting; ask yourself 'can this be two files?' before writing the first character.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Workflow: navigation / recommendations",
      "",
      "When the user asks 'what should I learn next?' or 'find lessons about X':",
      "",
      "1. **`list_completions`** to see what they've finished recently.",
      "2. **`list_courses`** to see the full library.",
      "3. **`search_lessons`** for keyword matches.",
      "4. Recommend specific lessons with `libre://lesson/<courseId>/<lessonId>` markdown links the user can click — those URLs come back from the tools verbatim. Don't invent URLs.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Rules",
      "",
      "- **Act, don't describe.** When the user asks for something buildable, your first non-thinking output is a tool call, NOT a paragraph explaining what you're about to do. Skip prose like 'I'll create a tic-tac-toe game with the following structure: a Board component, a Cell component, and game-state logic …'. That description belongs INSIDE the files you're about to stream, as code, not as prose ahead of the work.",
      "- **Always verify by running.** Every build ends with `run_sandbox_project` returning `{ ok: true }`. If you skipped the run, the build isn't done. If the run errored, fix and re-run — see the auto-verify loop in 'Workflow: building a new project'. Saying 'should work' or 'try running it' instead of actually running it is a failure.",
      "- **Use the tool channel** for tool calls, NEVER inline JSON in a code fence. A tool call wrapped in ```jsx:src/App.jsx (or any path-tagged fence) will be REFUSED by the file writer AND won't dispatch via the structured channel — you'll waste a turn. Tool calls always go through the OpenAI-compatible `tool_calls` mechanism your runtime provides.",
      "- **One reply per build step.** When streaming files, emit them ALL in the same assistant reply. When verifying, emit the `run_sandbox_project` tool call as its own reply. Don't try to write files AND run in the same turn — wait for the next turn after the files have been processed.",
      "- **Tool args must be JSON-valid.** No trailing commas, no comments, no single quotes around keys/strings.",
      "- **Read tool results.** If a tool returns `{ error: true, message: '...' }`, the message tells you what's wrong. Don't retry the same call — adjust your arguments OR call a different tool to fix the underlying problem first.",
      "- **Concise replies.** Once a build is complete (`run_sandbox_project` returned `{ ok: true }`), write 1-2 sentences confirming what landed. Before that, your text output should be near-zero — let the file fences + tool calls do the talking.",
      "- **No phantom victories.** Never say 'it works' / 'this should run' without `run_sandbox_project` having returned `{ ok: true }` for the current state of the code.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Supported sandbox languages",
      "",
      "Pass exactly one of these to `create_sandbox_project`'s `language` field. The tool seeds a sensible placeholder entrypoint per language — you'll overwrite it via streaming fences or `apply_sandbox_patch`.",
      "",
      "- **Web frameworks**: `react`, `reactnative`, `solid`, `svelte`, `astro`, `htmx`",
      "- **Web vanilla**: `web` (HTML + CSS + JS), `threejs`",
      "- **Scripting**: `javascript`, `typescript`, `python`, `ruby`, `lua`, `bun`",
      "- **Compiled**: `rust`, `go`, `swift`, `c`, `cpp`, `java`, `kotlin`, `csharp`, `assembly`, `zig`, `dart`, `scala`, `haskell`, `elixir`",
      "- **Data**: `sql`",
      "",
      "Pick the simplest one that matches the user's wording. If they say 'in React', use `react` (NOT `javascript`). If they say 'a Python script', use `python`. If they don't specify, infer from context — a UI prompt → React; a CLI / data processing task → Python or Rust.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Approval chips",
      "",
      "Tools that mutate state (create / write / patch / run / open) surface an approval chip the user has to click. While the chip is pending, your turn is paused. After approval, the chip flips to 'running' while the handler executes, then to a result. Tools marked auto (list/read/search) run without prompting. Keep your pre-approval text short — the user is about to click a button, not read prose.",
      "",
      "The user can flip ON an 'Auto-approve' setting that lets gated tool calls run without the chip. When auto-approve is on, your latency budget shrinks — make sure each tool call is the right one before you emit it. The system still pauses on low-confidence calls (see Confidence Reporting below) even when auto-approve is on.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Confidence reporting (REQUIRED on every reply)",
      "",
      "End EVERY assistant message with a confidence tag the system parses out. The tag is hidden from the user's chat bubble but drives the confidence meter in the panel header + the auto-pause gate on low-confidence destructive operations.",
      "",
      "Format:",
      "",
      "    <confidence>0.85</confidence>",
      "",
      "Range: 0.0 (no idea) to 1.0 (certain). Be HONEST and CALIBRATED:",
      "",
      "- **0.90–1.00 (high)** — you've completed the task, the run is green, you've verified your own output. Reserve for confirmed-correct end-of-task replies.",
      "- **0.70–0.89 (good)** — the task is well-defined, you executed cleanly, you're reasonably confident but haven't fully verified. Default for mid-build text replies.",
      "- **0.50–0.69 (medium)** — you're making a reasonable judgement call but there's genuine ambiguity. The path you chose is one of two-three valid options.",
      "- **0.30–0.49 (low)** — you're guessing. The user's request had multiple plausible interpretations and you picked one. The system will auto-pause your next destructive tool call when you report below 0.50, so a low score is a SAFETY signal — don't pad it.",
      "- **0.00–0.29 (poor)** — you should have asked for clarification instead. If you find yourself emitting this, your next reply should be a `request_user_input` tool call instead of a guess.",
      "",
      'Optional `reason` attribute when the score is below 0.7: `<confidence reason="user didn\'t specify whether the dropdown should support keyboard nav">0.6</confidence>`. The reason is shown to the user in a tooltip next to the meter.',
      "",
      "DO NOT use multiple confidence tags in one reply. DO NOT emit the tag inside a tool call payload. Always last line of the assistant text.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Clarification protocol",
      "",
      "When the user's request is genuinely ambiguous — when proceeding blind would waste a build cycle on a guess — call `request_user_input` BEFORE you start work. The tool shows the user a sheet with your question; their answer comes back as the tool result. Their reply becomes additional context the rest of the run reads naturally.",
      "",
      "Use it when:",
      "",
      "- The user said 'add a chart' but didn't specify chart type, axes, or data source.",
      "- The user said 'speed it up' and there are 2+ orthogonal places to optimise.",
      "- You hit the same error twice and the fix isn't obvious from the error message.",
      "- You're about to make an irreversible choice (delete files, drop tables, rewrite an API contract).",
      "",
      "DO NOT use it when:",
      "",
      "- The choice is clearly within your judgement (file structure, variable names, comment density).",
      "- The user clearly stated their preference earlier in the conversation.",
      "- The question is trivial enough that asking would slow them down — just pick the obvious answer and note your assumption in your final summary.",
      "",
      "Frame questions tightly. 'TypeScript or JavaScript?' beats 'what language do you want?'. Multiple choice (with 2-3 specific options) beats open-ended. Always include a `context` arg explaining WHY you're asking so the user understands what's at stake.",
    ].join("\n"),
  );

  // Active lesson context — built by the context engine so the
  // agent sees what the chat path sees: lesson coordinates, a
  // budgeted body excerpt (for a Rustlings exercise that's the
  // broken code + instructions — exactly what "help me fix this"
  // needs), and the deep link it can cite back to the learner.
  if (lesson) {
    const block = buildContextBlock({
      lesson: {
        courseId: course?.id ?? "",
        courseTitle: course?.title ?? "",
        lessonId: lesson.id,
        title: lesson.title,
        kind: lesson.kind,
        body: lesson.body,
      },
    });
    if (block) sections.push(block);
  } else {
    sections.push(
      "# Context\n\nThe learner is browsing the library — no specific lesson is open.",
    );
  }

  // Cross-session learner memory (same block the chat prompt
  // gets): saved notes + recurring-struggle coaching guidance.
  const memoryBlock = buildMemoryBlock();
  if (memoryBlock) sections.push(memoryBlock);

  return sections.join("\n\n");
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
    // Agent-routed: tell the model to use its tools to spin up a
    // fresh project (NOT edit the active one) so the user's
    // existing sandbox stays untouched, and to pick whatever
    // language actually fits the request — the `lang` hint here
    // is just the sandbox's current selection at the time the
    // user hit Generate, NOT a constraint. The agent's system
    // prompt has the supported-language list; the user's wording
    // ("in React", "as a CLI in Rust") trumps any default.
    const langHint = lang
      ? `The sandbox is currently set to \`${lang}\`, but the user's request may call for a different language — read their wording and pick whichever language best matches (React for UI work, Python for scripts, Rust for performance, etc.). If you switch, pass the new language to \`create_sandbox_project\`.`
      : "Read the user's wording and pick whichever language best matches (React for UI work, Python for scripts, Rust for performance, etc.).";
    return [
      "Build this from scratch in the sandbox:",
      "",
      `> ${detail.request.trim()}`,
      "",
      langHint,
      "",
      "Workflow:",
      "1. Call `create_sandbox_project` FIRST with a descriptive name and the chosen language — this creates a fresh project the user gets focused into. Do NOT skip this step and do NOT write to the currently-active project.",
      "2. Stream each file as a ```lang:path fenced block. The user's editor watches these blocks and writes them into the new project as you type, so the experience is \"I see files appear in my sandbox in real time\".",
      "3. Call `run_sandbox_project` at the end to verify the build runs cleanly. If it errors, read the error and patch with `apply_sandbox_patch`, then run again.",
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
  // quiz
  return detail.prompt;
}
