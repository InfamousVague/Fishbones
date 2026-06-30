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
import { compactWireMessages } from "@/lib/ai/compaction";
import {
  analyzeBuildState,
  buildContinuationNudge,
  looksLikeBuildRequest,
} from "@/lib/ai/buildState";
import { resolveToolNative } from "@/lib/ai/toolCapability";
import { emulatedBuildTier } from "@/lib/ai/models";
import { findOrphans } from "./importGraph";
import type {
  AgentMessage,
  AgentTransport,
  ToolCall,
  ToolDef,
  ToolResult,
} from "./types";

/// True when an Ollama transport error means "this model can't use
/// the native tools API" — the 400 it returns for a model with no
/// tool template (e.g. `deepseek-coder-v2:16b does not support
/// tools`). Drives the loop's one-shot fallback to the emulated
/// (prompt + text-parse) tool path. Matched on the stable substring
/// Ollama emits rather than the HTTP code so a future wording tweak
/// that keeps the phrase still trips it.
export function isToolsUnsupportedError(message: string): boolean {
  // Match the stable phrase Ollama emits today, plus a few plausible
  // wordings, so a future version tweak (or another OpenAI-compatible
  // backend) that keeps the gist still trips the fallback instead of
  // hard-failing the run.
  return /does not support tools|tools?\s+(?:are\s+)?not\s+supported|no\s+tools?\s+template/i.test(
    message,
  );
}

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
  /// Called once per run if the model turns out not to support
  /// Ollama's native tools API (the loop caught the 400 and is
  /// retrying this turn with wire tools stripped, falling back to
  /// the emulated prompt+parse path). The host surfaces a one-time
  /// breadcrumb so the user understands why the agent quietly
  /// switched modes instead of erroring out.
  onToolsUnsupported?: (model: string) => void;
  /// Called when the loop auto-removes orphan files (created this run
  /// but imported by nothing) from a freshly-built project. Lets the
  /// host surface a "removed N unused files" breadcrumb.
  onOrphanPruned?: (paths: string[]) => void;
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
  /// Auto-remove orphan files (created this run, imported by nothing)
  /// from a project the run freshly CREATED — the deterministic fix
  /// for "the agent creates un-needed files". Only prunes files this
  /// run wrote, only when the project was created this run (so the
  /// file set is complete and reachability can't be misjudged against
  /// unseen pre-existing files), and the import graph deliberately
  /// under-prunes. Default true.
  pruneOrphans?: boolean;
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
    pruneOrphans = true,
    postProcessAssistant,
  } = options;

  const toolMap = new Map<string, ToolDef>();
  for (const t of tools) toolMap.set(t.name, t);

  const trimmedPrompt = userPrompt.trim();
  const trimmedAugmented =
    augmented !== undefined ? augmented.trim() : undefined;
  // Whether THIS run is a build request — used to push a model that
  // only preambled (idle, no project) to actually emit the create
  // call, without nagging plain Q&A turns. True when the prompt reads
  // build-y AND the agent actually has the project-creation tool.
  const buildExpected =
    tools.some((t) => t.name === "create_sandbox_project") &&
    (looksLikeBuildRequest(trimmedPrompt) ||
      (trimmedAugmented ? looksLikeBuildRequest(trimmedAugmented) : false));
  // WEAK emulated models build via the fence-first protocol (no
  // reliable tool-call channel) — their nudges must speak fences, not
  // tool calls, to match the prompt they were given.
  const fenceFirst =
    !resolveToolNative(model) && emulatedBuildTier(model) === "weak";
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
  // Flips true for the rest of the run once we learn (via the
  // registry tier OR a caught 400) that this model can't use the
  // native tools API — from then on every turn ships zero wire
  // tools and relies on the emulated text-parse recovery.
  let forceEmulated = false;
  // Anti-churn: weak models (and occasionally strong ones) get stuck
  // re-writing the SAME files turn after turn without adding anything
  // new — the "stuck editing files it doesn't use" failure. We track
  // how many distinct files have been written; a turn that does write
  // work but grows that count by ZERO (all re-writes), while NOT in a
  // legitimate fix-the-failed-run state, is a no-progress turn. Two in
  // a row ends the build — it's done or wedged, either way more turns
  // just burn time.
  let prevFilesWritten = 0;
  let stagnantWriteTurns = 0;
  // path → latest content for every file written THIS run, rebuilt
  // from successful tool-call arguments. Feeds the orphan-prune on
  // terminal (we never touch files this run didn't write).
  const runFiles = new Map<string, string>();

  /// Remove orphan files (created this run, imported by nothing) from
  /// a project the run freshly created. Conservative by construction:
  /// only fires when a create happened this run (so `runFiles` is the
  /// COMPLETE file set), only deletes files this run wrote, and the
  /// import graph under-prunes. A best-effort cleanup — failures are
  /// swallowed.
  const pruneOrphanFiles = async (): Promise<void> => {
    if (!pruneOrphans) return;
    const st = analyzeBuildState(timeline);
    if (!st.projectId || runFiles.size === 0) return;
    const orphans = findOrphans(Object.fromEntries(runFiles));
    if (orphans.length === 0) return;
    const delTool =
      toolMap.get("delete_sandbox_file") ?? toolMap.get("apply_sandbox_patch");
    if (!delTool) return;
    const pruned: string[] = [];
    for (const path of orphans) {
      try {
        const args =
          delTool.name === "apply_sandbox_patch"
            ? { projectId: st.projectId, edits: [{ path, op: "delete" }] }
            : { projectId: st.projectId, path };
        await delTool.handler(args);
        runFiles.delete(path);
        pruned.push(path);
        timeline.push({
          toolCallId: `prune_${path}`,
          name: delTool.name,
          ok: true,
          content: JSON.stringify({
            ok: true,
            pruned: path,
            reason: "removed unused file — nothing imports it",
          }),
        });
      } catch {
        /* best-effort cleanup */
      }
    }
    if (pruned.length) hooks.onOrphanPruned?.(pruned);
  };

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
    // Wire tool schemas, sent on the structured `tool_calls`
    // channel. ONLY for models that ship an Ollama tool template —
    // emulated models (and any model that 400s "does not support
    // tools", handled below) get an EMPTY list so Ollama doesn't
    // reject the request, and reconstruct tool calls from text via
    // the recovery layer instead. Without this gate, picking a model
    // like deepseek-coder-v2:16b hard-fails every agent turn.
    const wireToolDefs = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    const turnReq = {
      model,
      // Compaction keeps the payload small as agent runs grow:
      // old tool results truncate, ancient rows drop, while the
      // system prompt (KV-cache prefix) + the live request stay
      // verbatim. Smaller prompts = faster prompt-eval on local
      // models = snappier turns.
      messages: compactWireMessages(toWireMessages(conversation)),
      onChunk: hooks.onChunk,
      onStreamId: hooks.onStreamId,
      // Per-call model knobs from the user's "effort" setting —
      // forwarded through unchanged. The Tauri transport reads
      // these off the request body and stuffs them into the
      // Ollama call's `options` block.
      temperature: effortParams?.temperature,
      num_ctx: effortParams?.num_ctx,
      num_predict: effortParams?.num_predict,
    };
    // Daemon-aware: a model the user's Ollama reports as tool-capable
    // (probed + cached by the UI on model change) uses the structured
    // channel even if the static registry tier says "emulated". Cold
    // cache falls back to the static tier; the 400-fallback below
    // still self-heals an over-optimistic native guess.
    const useWireTools = resolveToolNative(model) && !forceEmulated;
    try {
      try {
        response = await transport.send({
          ...turnReq,
          tools: useWireTools ? wireToolDefs : [],
        });
      } catch (innerErr) {
        // Self-heal the "model has no tool template" 400. This
        // catches CUSTOM models not in the registry (where we
        // optimistically sent wire tools) as well as any registry
        // gap. Strip wire tools for the rest of the run and retry
        // THIS turn once via the emulated path. A 400 fails before
        // any tokens stream, so the retry can't double-emit content.
        const innerMsg =
          innerErr instanceof Error ? innerErr.message : String(innerErr);
        if (!forceEmulated && useWireTools && isToolsUnsupportedError(innerMsg)) {
          forceEmulated = true;
          hooks.onToolsUnsupported?.(model);
          response = await transport.send({ ...turnReq, tools: [] });
        } else {
          throw innerErr;
        }
      }
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
        const nudge = buildContinuationNudge(state, { buildExpected, fenceFirst });
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
      await pruneOrphanFiles();
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
    // Per-RUN project dedupe: one build = one project. The junk-
    // project flood came from auto-continuation nudges re-firing
    // create_sandbox_project every turn. If a project already exists
    // this run (prior turn) OR was created earlier in THIS batch,
    // rewrite a further create into a no-op that points the model at
    // the existing project instead of spawning a duplicate. Scoped to
    // this run's timeline, so a deliberate "now build a second app" in
    // a NEW run is unaffected.
    const runProjectId = findExistingProjectId(
      timeline.map((t) => ({ name: t.name, content: t.content })),
    );
    let sawCreateThisBatch = false;
    const plans: Array<{ call: ToolCall; halt: ToolResult | null }> = [];
    for (const call of toolCalls) {
      // Signature bookkeeping runs FIRST — before the create-dedupe
      // short-circuit — so a model that spams create_sandbox_project
      // every turn (and gets politely deduped each time) still counts
      // toward the stuck threshold and eventually trips the hard break
      // below, instead of spinning until maxNudges.
      const sig = `${call.name}|${normaliseArgs(call.arguments)}`;
      if (sig === lastCallSignature) {
        consecutiveSameCount += 1;
      } else {
        consecutiveSameCount = 0;
        lastCallSignature = sig;
      }

      const isDupeCreate =
        call.name === "create_sandbox_project" &&
        (runProjectId || sawCreateThisBatch);
      if (call.name === "create_sandbox_project") sawCreateThisBatch = true;

      // Hard stuck-break takes precedence over the polite dedupe — a
      // create repeated past the threshold is no longer "harmless
      // duplicate", it's a wedged model.
      if (consecutiveSameCount >= maxSameCallRetries) {
        plans.push({
          call,
          halt: {
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              error: true,
              message: `Stop repeating ${call.name} with identical arguments — you've called it ${consecutiveSameCount} times in a row with no progress. Either: (a) inspect the previous error and change your arguments, (b) call a DIFFERENT tool first to fix the underlying issue, or (c) request user input via request_user_input.`,
            }),
            ok: false,
          },
        });
        stuckThisTurn = true;
        continue;
      }

      // Per-RUN project dedupe: one build = one project. The junk-
      // project flood came from auto-continuation nudges re-firing
      // create_sandbox_project every turn. If a project already exists
      // this run (prior turn) OR was created earlier in THIS batch,
      // rewrite a further create into a no-op that points the model at
      // the existing project instead of spawning a duplicate.
      if (isDupeCreate) {
        plans.push({
          call,
          halt: {
            toolCallId: call.id,
            name: call.name,
            ok: true,
            content: JSON.stringify(
              runProjectId
                ? {
                    ok: true,
                    projectId: runProjectId,
                    deduped: true,
                    message: `This build already has a project (${runProjectId}). Write files into it with write_sandbox_file — do NOT create another project.`,
                  }
                : {
                    ok: true,
                    deduped: true,
                    message:
                      "You already created a project this turn. Write files into it with write_sandbox_file — do NOT create another project.",
                  },
            ),
          },
        });
        continue;
      }

      plans.push({ call, halt: null });
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

    // Track file CONTENT written this run (for the orphan-prune on
    // terminal), reconstructed from the SUCCESSFUL calls' arguments.
    for (let i = 0; i < plans.length; i++) {
      if (results[i]?.ok) applyCallToRunFiles(runFiles, plans[i].call);
    }

    if (stuckThisTurn) {
      endedBy = "stuckRetries";
      // Continue the loop one more time so the model gets the
      // strong "stop" message and can write a final reply.
      // Resetting the counter prevents the SAME signature from
      // tripping again on the next turn.
      consecutiveSameCount = 0;
    }

    // Anti-churn breaker. Did this turn do file-write work, and did it
    // grow the set of distinct files written? If it wrote but added
    // NOTHING new (re-writing the same files) — and isn't legitimately
    // fixing a failed run — it's spinning. Two such turns in a row and
    // we stop. (A failed run is a valid reason to re-edit a file, so
    // the fix-loop is exempt.)
    {
      // Only WRITE/PATCH count as potential churn — a create call (even
      // an empty one) is a one-time start, not a re-write, so it never
      // trips the breaker on its own.
      const didWriteWork = results.some(
        (r) =>
          r.ok &&
          (r.name === "write_sandbox_file" || r.name === "apply_sandbox_patch"),
      );
      const postState = analyzeBuildState(timeline);
      const grew = postState.filesWritten.length > prevFilesWritten;
      prevFilesWritten = postState.filesWritten.length;
      if (didWriteWork && !grew && postState.stage !== "ran-failed") {
        stagnantWriteTurns += 1;
        if (stagnantWriteTurns >= 2) {
          endedBy = "terminal";
          await pruneOrphanFiles();
          break;
        }
      } else {
        stagnantWriteTurns = 0;
      }
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
///   4. Drop UI-only host breadcrumbs (`isSystemNote`) entirely —
///      they're chrome for the human, never context for the model.
/// Fold one successful tool call into the run's file map (path →
/// latest content), mirroring what create/write/patch did to the
/// project. Used to reconstruct the project file set for orphan
/// pruning without reading from disk.
function applyCallToRunFiles(runFiles: Map<string, string>, call: ToolCall): void {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments) as Record<string, unknown>;
  } catch {
    return;
  }
  if (call.name === "create_sandbox_project" && Array.isArray(args.files)) {
    for (const f of args.files as Array<{ path?: unknown; content?: unknown }>) {
      if (typeof f?.path === "string") runFiles.set(f.path, String(f.content ?? ""));
    }
  } else if (call.name === "write_sandbox_file" && typeof args.path === "string") {
    runFiles.set(args.path, String(args.content ?? ""));
  } else if (call.name === "apply_sandbox_patch" && Array.isArray(args.edits)) {
    for (const e of args.edits as Array<{ path?: unknown; op?: unknown; content?: unknown }>) {
      if (typeof e?.path !== "string") continue;
      if (e.op === "delete") runFiles.delete(e.path);
      else runFiles.set(e.path, String(e.content ?? ""));
    }
  }
}

function toWireMessages(messages: AgentMessage[]) {
  return messages
    .filter((m) => !(m.role === "user" && m.isSystemNote))
    .map((m) => {
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
