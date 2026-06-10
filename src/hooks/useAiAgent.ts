/// React-side wrapper around the agent loop in `lib/aiAgent/loop.ts`.
///
/// The pure loop module owns the protocol: turn dispatch, tool
/// gating, confidence parsing, retry detection, token accounting.
/// This file's job is to:
///
///   1. Stand up the Tauri transport so the loop has a way to
///      talk to Ollama.
///   2. Bridge the loop's callbacks (onChunk, approveToolCall,
///      requestClarification, …) to React state setters so the
///      panel re-renders.
///   3. Maintain the message log, pending approvals, timeline,
///      and run-usage stats as React state.
///   4. Expose the `send` / `approve` / `deny` / `reset` /
///      `loadMessages` API the existing AiAssistant + TraySurface
///      callers rely on — same shape they had before the
///      refactor, so this is a drop-in replacement.

import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToolApproval, ToolCall, ToolDef, ToolResult } from "../lib/aiTools/types";
import { runAgentLoop } from "../lib/aiAgent/loop";
import { createTauriTransport } from "../lib/aiAgent/transport";
import { EMPTY_RUN_USAGE, type RunUsage } from "../lib/aiAgent/usage";
import {
  loadSettings,
  resolveEffortParams,
  type AiAgentSettings,
} from "../lib/aiAgent/settings";
import {
  deriveConfidenceFromTool,
  estimateTokens,
  parseStreamingConfidence,
} from "../lib/aiAgent/confidence";
import type { AgentMessage as InternalAgentMessage } from "../lib/aiAgent/types";

/// Re-export the message type at this module's path so the
/// existing import sites (`import type { AgentMessage } from
/// "../../hooks/useAiAgent"`) keep working without touching
/// every caller. The shape itself is unchanged across the
/// refactor — augmented user payloads, structured tool calls,
/// confidence + usage on assistant rows.
export type AgentMessage = InternalAgentMessage;

/// One pending approval — a tool call the model proposed that
/// requires user confirmation before the handler runs. Same
/// shape the panel was reading before the refactor.
export interface PendingToolCall {
  call: ToolCall;
  tool: ToolDef;
  approval: ToolApproval;
}

/// One in-flight clarification request — the model called
/// `request_user_input` and we're waiting for the user to type
/// an answer. The panel renders a clarification sheet for each
/// entry; the user's submit resolves the underlying promise so
/// the agent loop can continue.
export interface PendingClarification {
  id: string;
  question: string;
  context?: string;
}

export interface UseAiAgent {
  messages: AgentMessage[];
  streaming: boolean;
  pending: PendingToolCall[];
  /// Pending clarification request (model asked the user a
  /// question via `request_user_input`). At most one is active
  /// at a time — the loop awaits the answer before continuing.
  clarification: PendingClarification | null;
  lastReply: string;
  timeline: ToolResult[];
  error: string | null;
  /// Aggregated token usage across every turn of the current
  /// agent run. Resets to zeros when the user starts a new
  /// conversation via `reset` or `loadMessages`. The token strip
  /// in the agent panel reads this for the HUD.
  ///
  /// Live during streaming: the `completionTokens` field grows
  /// from a chars/4 estimate as content arrives, then snaps to
  /// the exact `eval_count` from Ollama when the turn completes.
  usage: RunUsage;
  /// The agent's self-reported confidence (0..1). Live: updated
  /// in real time as the streaming content surfaces a
  /// `<confidence>N</confidence>` tag (even before the close tag
  /// arrives). null when no run has emitted a tag yet. The
  /// confidence meter in the UI reads this.
  confidence: number | null;
  /// Current settings (auto-approve etc). Reads-through to
  /// localStorage on mount; in-memory only after that. Update
  /// via `updateSettings`.
  settings: AiAgentSettings;
  send: (prompt: string, augmented?: string) => Promise<void>;
  approve: (toolCallId: string) => void;
  deny: (toolCallId: string) => void;
  /// Halt the in-flight agent run. Two effects:
  ///   1. Flips a per-run shouldStop ref the loop polls so future
  ///      turns / tool dispatches abort cleanly.
  ///   2. Fires `ai_chat_stop` against the active stream id so
  ///      the Rust transport's read loop bails on its next chunk
  ///      (typically within ~50-150ms — one Ollama emit
  ///      interval).
  /// No-op when no run is in flight.
  stop: () => void;
  /// Submit the user's answer to an open clarification request.
  answerClarification: (answer: string) => void;
  /// Cancel an open clarification request — the loop reads the
  /// cancellation as a tool error and the model decides whether
  /// to abandon or pivot.
  cancelClarification: () => void;
  reset: () => void;
  loadMessages: (messages: AgentMessage[]) => void;
  updateSettings: (next: AiAgentSettings) => void;
}

export function useAiAgent(params: {
  systemPrompt: string;
  tools: readonly ToolDef[];
  model?: string;
  initialMessages?: AgentMessage[];
  /// Optional per-turn assistant-content post-processor (e.g. the
  /// libre:// link guard that strips hallucinated lesson links).
  /// Runs in the loop after tool-call recovery + confidence
  /// stripping, before the message is stored or rendered.
  postProcessAssistant?: (content: string) => string;
}): UseAiAgent {
  const { systemPrompt, tools, model, initialMessages, postProcessAssistant } =
    params;
  const [messages, setMessages] = useState<AgentMessage[]>(
    () => initialMessages ?? [],
  );
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState<PendingToolCall[]>([]);
  const [clarification, setClarification] =
    useState<PendingClarification | null>(null);
  const [timeline, setTimeline] = useState<ToolResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<RunUsage>(EMPTY_RUN_USAGE);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [settings, setSettings] = useState<AiAgentSettings>(() =>
    loadSettings(),
  );

  // Read-through ref so the loop's callbacks (which are closed
  // over at run-start) always see the latest settings even if
  // the user flips auto-approve mid-run.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Approval resolver bag — same shape as before the refactor.
  // Each entry maps tool call id → resolver of the inner promise
  // the loop is awaiting.
  const approvalResolversRef = useRef<
    Map<string, (decision: "approved" | "denied") => void>
  >(new Map());
  const clarificationResolverRef = useRef<{
    resolve: (answer: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  // User-stop coordination. `stoppedRef` is read by the loop's
  // `hooks.shouldStop()` predicate; flipping it makes the loop
  // bail at its next pause point. `activeStreamIdRef` is the
  // current Rust-side stream id — `stop()` fires `ai_chat_stop`
  // with this id so an in-flight `bytes_stream().next().await`
  // aborts on its next chunk. Both reset to default on every
  // fresh send.
  const stoppedRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);

  // Singleton Tauri transport. Building one per render would
  // allocate fresh closures with no benefit; it's stateless
  // anyway.
  const transport = useMemo(() => createTauriTransport(), []);

  const approve = useCallback((toolCallId: string) => {
    const fn = approvalResolversRef.current.get(toolCallId);
    if (fn) fn("approved");
  }, []);
  const deny = useCallback((toolCallId: string) => {
    const fn = approvalResolversRef.current.get(toolCallId);
    if (fn) fn("denied");
  }, []);

  /// Halt the in-flight agent run. Sets the stop flag (the loop
  /// polls this between turns) AND fires the Rust-side
  /// `ai_chat_stop` so a mid-stream `bytes_stream().next()` bail
  /// happens on the next Ollama chunk. No-op when no run is in
  /// flight.
  const stop = useCallback(() => {
    stoppedRef.current = true;
    const sid = activeStreamIdRef.current;
    if (sid) {
      // Fire-and-forget — the Rust side might return an error
      // (e.g. if the stream already completed between our state
      // check and the IPC roundtrip), and we don't care: the
      // loop's `shouldStop` poll handles the close anyway.
      void invoke("ai_chat_stop", { streamId: sid }).catch(() => {});
    }
  }, []);

  const answerClarification = useCallback((answer: string) => {
    const r = clarificationResolverRef.current;
    if (!r) return;
    r.resolve(answer);
    clarificationResolverRef.current = null;
    setClarification(null);
  }, []);
  const cancelClarification = useCallback(() => {
    const r = clarificationResolverRef.current;
    if (!r) return;
    r.reject(new Error("User cancelled clarification."));
    clarificationResolverRef.current = null;
    setClarification(null);
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setPending([]);
    setClarification(null);
    setTimeline([]);
    setError(null);
    setUsage(EMPTY_RUN_USAGE);
    setConfidence(null);
    approvalResolversRef.current.clear();
    clarificationResolverRef.current = null;
    stoppedRef.current = false;
    activeStreamIdRef.current = null;
  }, []);

  const loadMessages = useCallback((msgs: AgentMessage[]) => {
    setMessages(msgs);
    setPending([]);
    setClarification(null);
    setTimeline([]);
    setError(null);
    setUsage(EMPTY_RUN_USAGE);
    setConfidence(null);
    approvalResolversRef.current.clear();
    clarificationResolverRef.current = null;
    stoppedRef.current = false;
    activeStreamIdRef.current = null;
  }, []);

  const updateSettings = useCallback((next: AiAgentSettings) => {
    setSettings(next);
    // Fire-and-forget save; lib/aiAgent/settings.ts handles
    // localStorage quota / disabled-storage failures internally.
    void Promise.resolve().then(async () => {
      const { saveSettings } = await import("../lib/aiAgent/settings");
      saveSettings(next);
    });
  }, []);

  const send = useCallback(
    async (prompt: string, augmented?: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setTimeline([]);
      setStreaming(true);
      setUsage(EMPTY_RUN_USAGE);
      // Don't reset confidence here — we want the conversation-wide
      // confidence to persist across runs so the HUD bar doesn't
      // flash empty at the start of every new prompt. The current
      // value stays until a fresh `<confidence>N</confidence>` tag
      // arrives in this run's streaming content. The hook's
      // `reset()` / `loadMessages()` paths DO clear it (those are
      // explicit "new conversation" actions).

      // Fresh user-stop coordination for this run. The Rust-side
      // stream id is set inside onChunk (the Tauri transport mints
      // it before the first chunk fires). Without resetting these
      // here a prior run's "stopped" state would leak into the new
      // run and the loop would bail before doing anything.
      stoppedRef.current = false;
      activeStreamIdRef.current = null;

      // Live-stream accumulator. We track the running content of
      // the IN-FLIGHT turn so onChunk can derive a real-time
      // confidence value + token estimate from the partial
      // content. Resets between turns via onTurnStart.
      let liveContent = "";
      // Tokens reported on completed turns. Live tokens (estimated
      // from the in-flight content) get ADDED to this baseline on
      // every chunk so the HUD shows growing numbers without
      // double-counting when the canonical usage lands.
      let completedPromptTokens = 0;
      let completedCompletionTokens = 0;
      let completedDurationMs = 0;
      let completedTurns = 0;

      // Synthesise the assistant placeholder ahead of the loop so
      // chunk events have something to land in. The loop's
      // onTurnEnd callback will overwrite it with the canonical
      // assistant message (including tool calls + confidence) on
      // the same turn — this placeholder is just for the streaming
      // text to accrete into.
      const newUserMsg: AgentMessage = {
        role: "user",
        content: trimmed,
        ...(augmented && augmented.trim() !== trimmed
          ? { augmented: augmented.trim() }
          : {}),
      };
      setMessages((prev) => [
        ...prev,
        newUserMsg,
        { role: "assistant", content: "" },
      ]);

      // Streaming chunk handler — append to the trailing
      // placeholder AND surface real-time HUD updates:
      //   - Tokens: estimated from the cumulative live content
      //     (chars/4) added to the prior-turn baseline.
      //   - Confidence: parsed from any `<confidence>N` tag that
      //     has streamed in so far (even unclosed).
      //   - Duration: ticked by the panel's RunStatusBanner /
      //     HUD interval, not here.
      const onChunk = (chunk: string) => {
        liveContent += chunk;
        setMessages((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === "assistant") {
              const next = [...prev];
              next[i] = {
                ...prev[i],
                content: (prev[i] as Extract<
                  AgentMessage,
                  { role: "assistant" }
                >).content + chunk,
              };
              return next;
            }
          }
          return prev;
        });
        // Real-time confidence.
        const liveConf = parseStreamingConfidence(liveContent);
        if (liveConf !== null) setConfidence(liveConf);
        // Real-time token estimate. We add the live estimate to
        // the prior-turn completed baseline so multi-turn runs
        // don't reset to zero between turns.
        const liveTokens = estimateTokens(liveContent);
        setUsage({
          turns: completedTurns,
          promptTokens: completedPromptTokens,
          completionTokens: completedCompletionTokens + liveTokens,
          durationMs: completedDurationMs,
        });
      };

      try {
        await runAgentLoop({
          initialMessages: messages,
          systemPrompt,
          model: model ?? "qwen2.5-coder:7b",
          tools,
          userPrompt: trimmed,
          augmented,
          transport,
          maxTurns: settingsRef.current.maxTurns,
          postProcessAssistant,
          // Forward the user's `effort` rung as concrete model
          // params. `resolveEffortParams` maps fast/balanced/
          // thorough → temperature + num_ctx + num_predict.
          effortParams: resolveEffortParams(settingsRef.current.effort),
          hooks: {
            shouldStop: () => stoppedRef.current,
            onStreamId: (sid) => {
              // Save the Rust-side stream id so `stop()` can
              // target the right `bytes_stream().next()` to bail.
              activeStreamIdRef.current = sid;
            },
            onNudge: (nudge) => {
              // Auto-continuation: the loop injected a synthetic
              // user message because the model stopped with an
              // unfinished build. Mirror it into the visible log
              // tagged isNudge so the panel renders it as a muted
              // "auto-continue" breadcrumb, not a learner bubble.
              setMessages((prev) => [
                ...prev,
                { role: "user", content: nudge, isNudge: true },
              ]);
            },
            onTurnStart: (idx) => {
              // Each new turn starts a fresh live-content window
              // so the next chunk's token estimate counts the
              // NEW turn's content (not turn N-1's text that's
              // already finalised into completedCompletionTokens).
              liveContent = "";
              // For turn 0 the placeholder was already added
              // before runAgentLoop started (we needed something
              // to render between "user clicked send" and the
              // first chunk landing). For turn 1+, append a
              // fresh placeholder so the next turn's onChunk
              // events have a clean target — otherwise tokens
              // for turn 2 would accrete into turn 1's already-
              // finalised assistant message.
              if (idx === 0) return;
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "" },
              ]);
            },
            onChunk,
            onTurnEnd: (_idx, assistant) => {
              // Each turn has its own placeholder (turn 0's was
              // added before runAgentLoop ran; turn 1+ was
              // added by onTurnStart). Either way, the latest
              // assistant message in the log IS the placeholder
              // for THIS turn — overwrite it with the canonical
              // assistant row carrying tool calls + cleaned
              // content + confidence + usage.
              setMessages((prev) => {
                for (let i = prev.length - 1; i >= 0; i--) {
                  if (prev[i].role === "assistant") {
                    const next = [...prev];
                    next[i] = assistant;
                    return next;
                  }
                }
                return [...prev, assistant];
              });
              // Only update confidence when this turn actually
              // emitted a tag. Setting it to null on every
              // tag-less turn would clobber the conversation-
              // wide running value the HUD bar shows — confidence
              // is meant to be sticky across turns, not
              // per-turn-zeroed.
              if (
                assistant.confidence !== undefined &&
                assistant.confidence !== null
              ) {
                setConfidence(assistant.confidence);
              }
              if (assistant.usage) {
                // Promote this turn's live estimate to the
                // canonical figures. We update both the closure-
                // scope baseline (so future onChunk ticks count
                // ON TOP of completed turns) AND the React state
                // (so the HUD shows the exact eval_count, not
                // the chars/4 estimate).
                completedPromptTokens += assistant.usage.promptTokens ?? 0;
                completedCompletionTokens +=
                  assistant.usage.completionTokens ?? 0;
                completedDurationMs += assistant.usage.durationMs ?? 0;
                completedTurns += 1;
                setUsage({
                  turns: completedTurns,
                  promptTokens: completedPromptTokens,
                  completionTokens: completedCompletionTokens,
                  durationMs: completedDurationMs,
                });
              }
            },
            approveToolCall: async (call, tool) => {
              // Auto-approve fast path: skip the chip entirely.
              // The `pauseOnLowConfidence` setting overrides — if
              // the model reports < 0.5 we still gate. We pass
              // confidence via the loop's hook signature though;
              // the loop ALSO does its own low-confidence check
              // and elevates auto tools to gated when triggered,
              // so we don't double-implement that logic here.
              if (settingsRef.current.autoApprove) {
                return "approved";
              }
              return new Promise<"approved" | "denied">((resolve) => {
                approvalResolversRef.current.set(call.id, (decision) => {
                  approvalResolversRef.current.delete(call.id);
                  setPending((prev) =>
                    prev.map((p) =>
                      p.call.id === call.id
                        ? { ...p, approval: { kind: decision } }
                        : p,
                    ),
                  );
                  if (decision === "denied") {
                    window.setTimeout(() => {
                      setPending((prev) =>
                        prev.filter((p) => p.call.id !== call.id),
                      );
                    }, 350);
                  }
                  resolve(decision);
                });
                setPending((prev) => [
                  ...prev,
                  { call, tool, approval: { kind: "pending" } },
                ]);
              });
            },
            onToolStart: (call) => {
              setPending((prev) =>
                prev.map((p) =>
                  p.call.id === call.id
                    ? { ...p, approval: { kind: "running" } }
                    : p,
                ),
              );
            },
            onToolResult: (result) => {
              setTimeline((prev) => [...prev, result]);
              setMessages((prev) => [
                ...prev,
                {
                  role: "tool",
                  toolCallId: result.toolCallId,
                  name: result.name,
                  content: result.content,
                },
              ]);
              // Heuristic confidence update. The model often
              // skips the `<confidence>` tag so the HUD meter
              // never moves unless we derive a value from
              // observed tool outcomes. Each success nudges the
              // bar up; each failure pulls it down. A
              // self-reported tag (parsed in onChunk /
              // onTurnEnd) will overwrite this heuristic value
              // when it lands.
              setConfidence((prev) =>
                deriveConfidenceFromTool(prev, result.ok),
              );
              window.setTimeout(() => {
                setPending((prev) =>
                  prev.filter((p) => p.call.id !== result.toolCallId),
                );
              }, 250);
            },
            requestClarification: async (question, context) => {
              const id = `clar_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}`;
              setClarification({ id, question, context });
              return new Promise<string>((resolve, reject) => {
                clarificationResolverRef.current = { resolve, reject };
              });
            },
            onRunComplete: (summary) => {
              setUsage(summary.usage);
              if (summary.finalConfidence !== null) {
                setConfidence(summary.finalConfidence);
              }
              if (summary.endedBy === "maxTurns") {
                setError(
                  "Agent hit the maximum turn limit. Increase it in settings if you need more, or rephrase.",
                );
              }
            },
          },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStreaming(false);
        // Drop the cancellation refs so the next `stop()` (or a
        // stray click after the run completes) doesn't target a
        // dead stream id or a stale flag.
        activeStreamIdRef.current = null;
        stoppedRef.current = false;
      }
    },
    [systemPrompt, messages, streaming, model, tools, transport],
  );

  const lastReply = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.content) return m.content;
    }
    return "";
  }, [messages]);

  return {
    messages,
    streaming,
    pending,
    clarification,
    lastReply,
    timeline,
    error,
    usage,
    confidence,
    settings,
    send,
    approve,
    deny,
    stop,
    answerClarification,
    cancelClarification,
    reset,
    loadMessages,
    updateSettings,
  };
}

// `mergeTurnUsage` (the inline fold of a single turn's usage into the
// running total) was retired here in favour of `accumulateUsage` from
// `lib/aiAgent/usage.ts`. Removed because the duplicate left a dead
// function that tripped TS6133 on the prod web build.
