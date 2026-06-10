/// Pure agent loop.
///
/// `useAiAgent` is now a thin React wrapper around this module —
/// the loop itself is a plain async generator-style function that
/// takes an injected transport + tool registry + callbacks and
/// drives the multi-turn agent conversation. Pulling this out of
/// the hook gives us:
///
///   - Test isolation: scenarios run without a React tree, without
///     a Tauri runtime, without an Ollama daemon. The mock
///     transport scripts each turn; the loop dispatches; we assert
///     on the resulting message log.
///   - Clean separation: the hook handles React state + DOM
///     side-effects; the loop handles the protocol. Each is
///     readable on its own.
///
/// The loop calls back into the host for every interesting event
/// (token streamed, tool call requested, tool result captured,
/// turn complete, run done). The hook implements those callbacks
/// to drive setState; the test harness implements them to record
/// events for assertions.

import {
  extractInlineToolCalls,
  extractXmlToolCalls,
  findExistingProjectId,
  stripInlineToolCallJson,
  synthesizeFromFences,
} from "./streaming";
import { parseConfidence, isLowConfidence } from "./confidence";
import { accumulateUsage, EMPTY_RUN_USAGE, type RunUsage } from "./usage";
import { compactWireMessages } from "../ai/compaction";
import {
  analyzeBuildState,
  buildContinuationNudge,
} from "../ai/buildState";
import type {
  AgentMessage,
  AgentTransport,
  ToolCall,
  ToolDef,
  ToolResult,
} from "./types";

/// Host-supplied hooks the loop calls into for each event.
///
/// All callbacks are optional except `approveToolCall` (which the
/// loop *must* await on for any gated tool). The host either
/// returns "approved" / "denied" directly (auto-approve mode) or
/// awaits user input via a promise that resolves when the chip
/// click fires.
export interface AgentLoopHooks {
  /// User-stop predicate. Polled by the loop between turns + tool
  /// dispatches; when it returns true the loop returns early with
  /// `endedBy: "stopped"`. The host's Stop button sets this flag
  /// AND fires the Rust-side `ai_chat_stop` for the current
  /// stream so an in-flight transport.send aborts immediately
  /// rather than waiting for the model to finish the current turn.
  shouldStop?: () => boolean;
  /// Called BEFORE the loop sends a turn. Useful for the UI to
  /// flip "streaming" state to true / clear the latest tool
  /// timeline.
  onTurnStart?: (turnIndex: number) => void;
  /// Called when each turn finishes (post-tool dispatch).
  onTurnEnd?: (
    turnIndex: number,
    assistant: Extract<AgentMessage, { role: "assistant" }>,
  ) => void;
  /// Called as content tokens stream in for the FINAL turn. The
  /// host typically appends each chunk to a placeholder assistant
  /// message in its message list.
  onChunk?: (chunk: string) => void;
  /// Called at the start of each turn with the active stream id
  /// the transport just minted. The hook saves the id so the
  /// user's Stop button can fire `ai_chat_stop` against it.
  onStreamId?: (streamId: string) => void;
  /// Called when the loop injects an auto-continuation nudge for
  /// an unfinished build. The host appends it to the visible
  /// message log (rendered as a muted system breadcrumb, not a
  /// user bubble).
  onNudge?: (nudge: string) => void;
  /// Approval gate for a gated tool. Returns "approved" or
  /// "denied" — denial appends a tool result the model can read
  /// to decide what to do next.
  approveToolCall: (call: ToolCall, tool: ToolDef) => Promise<"approved" | "denied">;
  /// Called when the loop dispatches a tool call (post-approval).
  onToolStart?: (call: ToolCall) => void;
  /// Called when a tool result lands.
  onToolResult?: (result: ToolResult) => void;
  /// Called once per run, after the loop terminates (cleanly or
  /// via error / cap).
  onRunComplete?: (summary: RunSummary) => void;
  /// Optional clarification handler. The agent calls into the
  /// `request_user_input` tool which itself dispatches this so
  /// the host can render a UI sheet, wait for the user's reply,
  /// and resolve. Implementations should resolve with the user's
  /// answer string; rejection aborts the run.
  requestClarification?: (
    question: string,
    context?: string,
  ) => Promise<string>;
}

/// What `runAgentLoop` resolves with.
export interface RunSummary {
  /// All messages produced this run (system + user + assistant +
  /// tool rows). Includes the seed messages the caller passed in,
  /// so the host can use this verbatim as the new message log.
  messages: AgentMessage[];
  /// Final tool-call timeline (every tool that ran this run).
  timeline: ToolResult[];
  /// Accumulated usage across every turn.
  usage: RunUsage;
  /// Why the loop ended.
  endedBy:
    | "terminal"
    | "maxTurns"
    | "error"
    | "stuckRetries"
    /// User clicked the Stop button. The active turn's
    /// transport.send rejected (Rust-side cancel) or the loop
    /// checked `hooks.shouldStop()` between turns and bailed.
    /// Distinct from "error" so the UI doesn't paint a red
    /// "something went wrong" banner for a user-initiated halt.
    | "stopped";
  /// Confidence of the FINAL assistant message (the one the user
  /// will read). `null` when the model didn't emit a tag.
  finalConfidence: number | null;
}

export interface AgentLoopOptions {
  /// Pre-existing message log to extend. The loop appends the new
  /// user message + every assistant / tool response it produces.
  initialMessages: AgentMessage[];
  /// System prompt to prepend to every wire payload. The loop
  /// places this at the head of `messages` automatically.
  systemPrompt: string;
  /// Ollama model id.
  model: string;
  /// Registered tools the model can call.
  tools: readonly ToolDef[];
  /// User message to send this run.
  userPrompt: string;
  /// Optional LLM-only alternate payload (Generate flow uses this).
  augmented?: string;
  /// Transport used to round-trip each turn.
  transport: AgentTransport;
  /// Host callbacks.
  hooks: AgentLoopHooks;
  /// Safety cap on turns. Mirrors `AiAgentSettings.maxTurns`. The
  /// loop bails with `endedBy: "maxTurns"` if hit.
  maxTurns: number;
  /// Cap on consecutive-same-call retries. Mirrors the existing
  /// `MAX_SAME_CALL_RETRIES` constant; defaults to 3 if omitted.
  maxSameCallRetries?: number;
  /// Per-call model knobs forwarded to the transport on every
  /// turn — driven by the user's `effort` setting via
  /// `resolveEffortParams(settings.effort)`. Optional: when
  /// omitted, the transport uses its own defaults.
  effortParams?: {
    temperature?: number;
    num_ctx?: number;
    num_predict?: number;
  };
  /// Auto-continuation for unfinished builds. When the model goes
  /// terminal (no tool calls) but the build-state machine says the
  /// build is incomplete (project created but files missing, files
  /// written but never run, or last run failed), the loop injects
  /// a synthetic user nudge and keeps going instead of stopping.
  /// Bounded by `maxNudges` so a hopelessly stuck model can't
  /// loop forever. Default true — this is THE fix for "the agent
  /// wrote one file and asked what to do next".
  autoContinue?: boolean;
  /// Max auto-continuation nudges per run. Default 2.
  maxNudges?: number;
  /// Optional post-processor applied to terminal assistant content
  /// before it's stored (e.g. the libre:// link guard that strips
  /// hallucinated lesson links). Applied AFTER tool-call recovery
  /// and confidence stripping.
  postProcessAssistant?: (content: string) => string;
  /// Mark messages produced this run with a tag the UI can use
  /// to render "new in this run" indicators. Optional — defaults
  /// to undefined (no tagging).
  runId?: string;
}

const DEFAULT_MAX_SAME_CALL_RETRIES = 3;
const DEFAULT_MAX_NUDGES = 2;

/// Drive one user-message → terminal-reply agent run. Returns
/// when the model writes a text-only reply (or we hit a safety
/// cap). All state lives in the returned `RunSummary` — caller
/// is free to discard it or feed it back as `initialMessages` on
/// the next call.
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<RunSummary> {
  const {
    initialMessages,
    systemPrompt,
    model,
    tools,
    userPrompt,
    augmented,
    transport,
    hooks,
    maxTurns,
    maxSameCallRetries = DEFAULT_MAX_SAME_CALL_RETRIES,
    effortParams,
    autoContinue = true,
    maxNudges = DEFAULT_MAX_NUDGES,
    postProcessAssistant,
  } = options;

  const toolMap = new Map<string, ToolDef>();
  for (const t of tools) toolMap.set(t.name, t);

  const trimmedPrompt = userPrompt.trim();
  const trimmedAugmented =
    augmented !== undefined ? augmented.trim() : undefined;
  const userMsg: AgentMessage = {
    role: "user",
    content: trimmedPrompt,
    ...(trimmedAugmented && trimmedAugmented !== trimmedPrompt
      ? { augmented: trimmedAugmented }
      : {}),
  };

  // Seed the conversation with: system + filtered history (drop any
  // pre-existing system messages — the caller-provided one wins) +
  // the new user prompt.
  let conversation: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...initialMessages.filter((m) => m.role !== "system"),
    userMsg,
  ];
  const timeline: ToolResult[] = [];
  let usage = EMPTY_RUN_USAGE;
  let lastCallSignature: string | null = null;
  let consecutiveSameCount = 0;
  let nudgesUsed = 0;
  let endedBy: RunSummary["endedBy"] = "maxTurns";
  let finalConfidence: number | null = null;

  for (let turnIdx = 0; turnIdx < maxTurns; turnIdx++) {
    // User-initiated stop checks. We poll the predicate at every
    // natural pause point in the loop so a Stop click takes
    // effect within one Ollama chunk (Rust-side cancel) or
    // immediately between turns (loop-side check).
    if (hooks.shouldStop?.()) {
      endedBy = "stopped";
      break;
    }
    hooks.onTurnStart?.(turnIdx);
    let response;
    try {
      response = await transport.send({
        model,
        // Compaction keeps the payload small as agent runs grow:
        // old tool results truncate, ancient rows drop, while the
        // system prompt (KV-cache prefix) + the live request stay
        // verbatim. Smaller prompts = faster prompt-eval on local
        // models = snappier turns.
        messages: compactWireMessages(toWireMessages(conversation)),
        tools: tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        onChunk: hooks.onChunk,
        onStreamId: hooks.onStreamId,
        // Per-call model knobs from the user's "effort" setting —
        // forwarded through unchanged. The Tauri transport reads
        // these off the request body and stuffs them into the
        // Ollama call's `options` block.
        temperature: effortParams?.temperature,
        num_ctx: effortParams?.num_ctx,
        num_predict: effortParams?.num_predict,
      });
    } catch (err) {
      // Transport failure. Two flavours:
      //   1. User-initiated stop — Rust side returned
      //      "Stopped by user." after the cancel flag flipped.
      //      Detect via `hooks.shouldStop()` (host set the flag
      //      before firing ai_chat_stop) and exit cleanly with
      //      `endedBy: "stopped"`.
      //   2. Real transport failure — surface as a synthetic
      //      assistant message + endedBy: "error".
      if (hooks.shouldStop?.()) {
        endedBy = "stopped";
        break;
      }
      endedBy = "error";
      const errMsg =
        err instanceof Error ? err.message : String(err);
      const errAssistant: AgentMessage = {
        role: "assistant",
        content: `(transport error: ${errMsg})`,
      };
      conversation = [...conversation, errAssistant];
      hooks.onTurnEnd?.(turnIdx, errAssistant as Extract<
        AgentMessage,
        { role: "assistant" }
      >);
      break;
    }

    if (response.usage) {
      usage = accumulateUsage(usage, response.usage);
    }

    // Parse the assistant content for inline tool calls (smaller
    // models emit them as JSON instead of via the structured
    // channel) + the confidence tag.
    //
    // Four layers of recovery, applied in priority order:
    //
    //   1. Structured `tool_calls` from the transport — preferred
    //      path, used by models that respect Ollama's tools API.
    //   2. Inline JSON in content (fenced or bare) — recovery for
    //      models that ignore the structured channel but at least
    //      emit a tool-call-shaped JSON object.
    //   3. XML-tag wrapped tool calls — Hermes / Qwen / NousResearch
    //      checkpoints sometimes emit `<function-name>X</function-name>
    //      <arguments>{...}</arguments>` or `<tool_call>{...}</tool_call>`
    //      instead of JSON or via the structured channel. Pure-text
    //      XML survives all of the prior layers (no { at top level,
    //      no fence-and-path) so we get a dedicated extractor.
    //   4. Fence-to-tool synthesis — last-resort recovery for
    //      models that DUMP CODE in `\`\`\`lang:path` fences with
    //      no tool calls at all. We synthesise create / write
    //      calls so the build still lands in the sandbox. Without
    //      this layer, the worst-behaved models would just chat
    //      a wall of code at the user and never touch disk —
    //      exactly the "AI dumped code into a message and nothing
    //      happened in the sandbox" failure the user reported.
    const rawContent = response.content ?? "";
    const inlineToolCalls = !response.toolCalls?.length
      ? extractInlineToolCalls(rawContent, tools)
      : undefined;
    let toolCalls =
      response.toolCalls?.length ? response.toolCalls : inlineToolCalls;

    // ALWAYS strip inline tool-call JSON, regardless of whether
    // the tool calls came from the structured channel, the
    // inline-JSON extractor, or further down the recovery chain.
    // Models that emit a structured tool call frequently ALSO
    // echo the same `{"name": "X", "arguments": {…}}` payload
    // inside a markdown fence in their prose ("Step 1: …
    // ```json\n{...}\n```"). Without an unconditional strip the
    // echoed copy stays in the bubble and the user reads it as
    // "the AI is just dumping JSON at me" — exactly the failure
    // mode the bug report describes.
    let stripped = stripInlineToolCallJson(rawContent);

    // Layer 3: XML-tag tool calls. Only fires when layers 1 and 2
    // produced nothing. The extractor returns the calls AND the
    // content with the XML spans removed so the chat bubble
    // doesn't show the raw `<function-name>...</function-name>`
    // mess after dispatch.
    if (!toolCalls || toolCalls.length === 0) {
      const xml = extractXmlToolCalls(stripped, tools);
      if (xml && xml.toolCalls.length > 0) {
        toolCalls = xml.toolCalls;
        stripped = xml.cleaned;
      }
    }

    let fenceCleaned: string | null = null;
    if (!toolCalls || toolCalls.length === 0) {
      const existingProjectId = findExistingProjectId(
        conversation
          .filter(
            (m): m is Extract<AgentMessage, { role: "tool" }> =>
              m.role === "tool",
          )
          .map((m) => ({ name: m.name, content: m.content })),
      );
      const recovery = synthesizeFromFences(stripped, tools, {
        existingProjectId,
        userPromptHint: userPrompt,
      });
      if (recovery && recovery.toolCalls.length > 0) {
        toolCalls = recovery.toolCalls;
        fenceCleaned = recovery.cleanedContent;
      }
    }
    if (fenceCleaned !== null) stripped = fenceCleaned;
    const conf = parseConfidence(stripped);

    const assistant: Extract<AgentMessage, { role: "assistant" }> = {
      role: "assistant",
      content: postProcessAssistant
        ? postProcessAssistant(conf.cleaned)
        : conf.cleaned,
      rawContent,
      toolCalls,
      confidence: conf.confidence,
      ...(response.usage ? { usage: response.usage } : {}),
    };
    conversation = [...conversation, assistant];
    hooks.onTurnEnd?.(turnIdx, assistant);
    finalConfidence = conf.confidence;

    // Terminal: no tool calls — the model thinks it's done.
    if (!toolCalls || toolCalls.length === 0) {
      // Auto-continuation. Before accepting the terminal turn,
      // fold the timeline into the build-state machine: if the
      // model started a build but didn't finish it (created with
      // no files / wrote files but never ran / last run failed),
      // inject a synthetic user nudge and keep looping instead of
      // stopping. Bounded by maxNudges; suppressed entirely when
      // the user clicked Stop.
      if (autoContinue && nudgesUsed < maxNudges && !hooks.shouldStop?.()) {
        const state = analyzeBuildState(timeline);
        const nudge = buildContinuationNudge(state);
        if (nudge) {
          nudgesUsed += 1;
          const nudgeMsg: AgentMessage = {
            role: "user",
            content: nudge,
            isNudge: true,
          };
          conversation = [...conversation, nudgeMsg];
          hooks.onNudge?.(nudge);
          continue;
        }
      }
      endedBy = "terminal";
      break;
    }

    // Otherwise: dispatch the turn's tool calls, append results,
    // loop.
    //
    // Fast path — PARALLEL dispatch. When every call in the batch
    // is auto-approved AND read-only-safe (not the clarification
    // tool, not elevated by low confidence) the calls have no
    // ordering dependency: the model emitted them together, none
    // gates on user input, and the registry's auto tools are
    // reads (list/search/read) by design. Dispatching them
    // concurrently turns N sequential IPC round-trips into one
    // wall-clock wait on the slowest. Mutating/gated calls keep
    // the sequential path so approval chips appear one at a time
    // and writes never race each other.
    let stuckThisTurn = false;
    const lowConf = isLowConfidence(assistant.confidence ?? null);
    const canParallelize =
      toolCalls.length > 1 &&
      !lowConf &&
      toolCalls.every((c) => {
        if (c.name === "request_user_input") return false;
        const t = toolMap.get(c.name);
        return t?.auto === true;
      });

    // Repeat-call bookkeeping runs over the batch in order either
    // way, so the stuck-retry detector sees the same sequence the
    // model emitted regardless of dispatch strategy.
    const plans: Array<{ call: ToolCall; halt: ToolResult | null }> = [];
    for (const call of toolCalls) {
      const sig = `${call.name}|${normaliseArgs(call.arguments)}`;
      if (sig === lastCallSignature) {
        consecutiveSameCount += 1;
      } else {
        consecutiveSameCount = 0;
        lastCallSignature = sig;
      }
      if (consecutiveSameCount >= maxSameCallRetries) {
        plans.push({
          call,
          halt: {
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              error: true,
              message: `Stop repeating ${call.name} with identical arguments — you've called it ${consecutiveSameCount} times in a row and it failed each time. Either: (a) inspect the previous error and change your arguments, (b) call a DIFFERENT tool first to fix the underlying issue, or (c) request user input via request_user_input.`,
            }),
            ok: false,
          },
        });
        stuckThisTurn = true;
      } else {
        plans.push({ call, halt: null });
      }
    }

    let results: ToolResult[];
    if (canParallelize && !stuckThisTurn) {
      results = await Promise.all(
        plans.map((p) =>
          dispatchOneToolCall(
            p.call,
            toolMap,
            hooks,
            assistant.confidence ?? null,
          ),
        ),
      );
    } else {
      results = [];
      for (const p of plans) {
        results.push(
          p.halt ??
            (await dispatchOneToolCall(
              p.call,
              toolMap,
              hooks,
              assistant.confidence ?? null,
            )),
        );
      }
    }

    for (const result of results) {
      timeline.push(result);
      hooks.onToolResult?.(result);
      const toolMsg: AgentMessage = {
        role: "tool",
        toolCallId: result.toolCallId,
        name: result.name,
        content: result.content,
      };
      conversation = [...conversation, toolMsg];
    }
    if (stuckThisTurn) {
      endedBy = "stuckRetries";
      // Continue the loop one more time so the model gets the
      // strong "stop" message and can write a final reply.
      // Resetting the counter prevents the SAME signature from
      // tripping again on the next turn.
      consecutiveSameCount = 0;
    }
  }

  const summary: RunSummary = {
    messages: conversation,
    timeline,
    usage,
    endedBy,
    finalConfidence,
  };
  hooks.onRunComplete?.(summary);
  return summary;
}

/// Convert the in-memory AgentMessage list to the wire format the
/// transport expects. Three responsibilities:
///   1. Unwrap `augmented` onto `content` for user messages that
///      carry it (the LLM sees the framed text, the UI shows the
///      bare prompt).
///   2. Map `tool`-role rows to the OpenAI/Ollama shape (name +
///      tool_call_id).
///   3. Drop any extra fields the transport doesn't accept.
function toWireMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === "user") {
      return {
        role: "user" as const,
        content: m.augmented ?? m.content,
      };
    }
    if (m.role === "assistant") {
      // Send the stripped content so the model doesn't see its
      // own confidence tags echoed back (it would re-emit them
      // in escalating loops). Tool calls get re-emitted on the
      // wire only when the model wants to keep working — by the
      // time we re-send conversation, the prior turn's tool calls
      // are already resolved into tool-role rows below.
      return { role: "assistant" as const, content: m.content };
    }
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        content: m.content,
        name: m.name,
        tool_call_id: m.toolCallId,
      };
    }
    return { role: "system" as const, content: m.content };
  });
}

/// Dispatch one tool call: gate through approval (if not auto),
/// parse args, run the handler, wrap the result.
async function dispatchOneToolCall(
  call: ToolCall,
  toolMap: Map<string, ToolDef>,
  hooks: AgentLoopHooks,
  confidence: number | null,
): Promise<ToolResult> {
  const tool = toolMap.get(call.name);
  if (!tool) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: true,
        message: `Unknown tool: ${call.name}`,
      }),
      ok: false,
    };
  }

  // Permission gate. Auto tools skip the chip path entirely.
  // Auto tools STILL elevate to gated when the model reports low
  // confidence (so a "I'm only 30% sure but I'll go ahead and
  // delete this file" pattern can't slip through). The host's
  // approveToolCall is responsible for actually rendering the
  // chip + awaiting user input — the loop just decides whether
  // to call it.
  //
  // Decision matrix:
  //   tool.auto=true,  confidence>=0.5  →  no gate (fast path)
  //   tool.auto=true,  confidence<0.5   →  GATE (elevated)
  //   tool.auto=false, confidence anything →  GATE
  //   request_user_input → never gates (special-cased below;
  //     the clarification IS the user's gate)
  const lowConf = isLowConfidence(confidence);
  const gated =
    call.name !== "request_user_input" && (tool.auto !== true || lowConf);
  if (gated) {
    const decision = await hooks.approveToolCall(call, tool);
    if (decision === "denied") {
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({
          error: true,
          message:
            "User denied this tool call. Ask the user how to proceed or pivot to a different approach.",
        }),
        ok: false,
      };
    }
  }

  hooks.onToolStart?.(call);

  // Special-case the clarification tool — its semantics are
  // "pause and ask the user a question, then continue with the
  // answer as the tool result." The hooks layer carries the
  // actual UI implementation.
  if (call.name === "request_user_input") {
    return await dispatchClarification(call, hooks);
  }

  let args: unknown = {};
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    try {
      args = looseJsonParse(call.arguments);
    } catch {
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({
          error: true,
          message: "Could not parse tool arguments as JSON.",
          raw: call.arguments,
        }),
        ok: false,
      };
    }
  }

  try {
    // The eslint disable here matches the source ToolDef definition
    // which intentionally accepts `any` for handler args.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.handler(args as any);
    const content =
      typeof result === "string" ? result : JSON.stringify(result);
    // A handler "failed" when EITHER:
    //   - it returned `{ error: true, ... }` — the machine-readable
    //     convention the smaller helpers use.
    //   - it returned `{ ok: false, ... }` — what richer tools
    //     (`run_sandbox_project`) use to signal a soft failure
    //     that's worth surfacing with a red chip but where the
    //     content payload (error message, logs) is the actually
    //     useful data the model reads.
    // Either signal flips the chip to fail in the UI.
    const obj =
      typeof result === "object" && result !== null
        ? (result as { error?: unknown; ok?: unknown })
        : null;
    const isStructuredError =
      !!obj && (obj.error === true || obj.ok === false);
    return {
      toolCallId: call.id,
      name: call.name,
      content,
      ok: !isStructuredError,
    };
  } catch (e) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: true,
        message: e instanceof Error ? e.message : String(e),
      }),
      ok: false,
    };
  }
}

/// The model wants to ask the user a question. The hooks layer
/// owns the actual UI implementation (typically a modal sheet).
/// Synthesised result feeds the answer back as the tool result so
/// the model can read it like any other tool output.
async function dispatchClarification(
  call: ToolCall,
  hooks: AgentLoopHooks,
): Promise<ToolResult> {
  let parsed: { question?: string; context?: string };
  try {
    parsed = JSON.parse(call.arguments || "{}");
  } catch {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: true,
        message: "Invalid arguments for request_user_input.",
      }),
      ok: false,
    };
  }
  const question = parsed.question?.trim();
  if (!question) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: true,
        message: "request_user_input requires a non-empty `question`.",
      }),
      ok: false,
    };
  }
  if (!hooks.requestClarification) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: true,
        message:
          "Host doesn't support user clarification. Proceed with your best guess and explain your assumptions.",
      }),
      ok: false,
    };
  }
  try {
    const answer = await hooks.requestClarification(
      question,
      parsed.context,
    );
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ ok: true, answer }),
      ok: true,
    };
  } catch (e) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: true,
        message:
          e instanceof Error
            ? `User cancelled clarification: ${e.message}`
            : "User cancelled clarification.",
      }),
      ok: false,
    };
  }
}

/// Normalise an args string for repeat-call detection. Parses as
/// JSON and re-serialises with sorted keys so cosmetic differences
/// (whitespace, key order) don't hide that two calls are
/// functionally identical.
export function normaliseArgs(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return canonicalize(parsed);
  } catch {
    return raw.trim();
  }
}

function canonicalize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return `[${v.map(canonicalize).join(",")}]`;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",")}}`;
}

function looseJsonParse(s: string): unknown {
  const cleaned = s.replace(/,(\s*[}\]])/g, "$1").replace(/'/g, '"');
  return JSON.parse(cleaned);
}
