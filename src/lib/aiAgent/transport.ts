/// Tauri transport for the agent loop.
///
/// Wraps the Rust `ai_chat_agent_turn` command + the chunk-event
/// channel into the `AgentTransport` shape the loop expects. The
/// loop calls `send(request)` once per turn; this transport:
///   1. Mints a stream id.
///   2. Subscribes to `ai-chat-chunk:<id>` if the caller passed an
///      `onChunk` callback (so the UI sees tokens stream in).
///   3. Invokes the Tauri command with the conversation + tools.
///   4. Resolves with the final assembled response, including
///      usage stats the Rust side reads off Ollama's NDJSON
///      terminator line.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentTransport,
  AgentTurnRequest,
  AgentTurnResponse,
  ToolCall,
} from "./types";
import type { TurnUsage } from "./usage";

/// Build a transport bound to a given Ollama model. The model id
/// is captured in the closure so the loop doesn't have to plumb
/// it through every request.
export function createTauriTransport(): AgentTransport {
  return {
    async send(req: AgentTurnRequest): Promise<AgentTurnResponse> {
      const streamId = req.onChunk
        ? `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : undefined;
      // Hand the stream id back to the host so it can be used as
      // the cancellation target. The hook saves this in a ref and
      // fires `ai_chat_stop` with the same id when the user clicks
      // Stop — Rust's STREAM_FLAGS registry keys on it.
      if (streamId) req.onStreamId?.(streamId);
      let unlistenChunk: UnlistenFn | undefined;
      let unlistenDone: UnlistenFn | undefined;
      try {
        if (streamId && req.onChunk) {
          unlistenChunk = await listen<{ token: string }>(
            `ai-chat-chunk:${streamId}`,
            (ev) => {
              req.onChunk?.(ev.payload.token);
            },
          );
          unlistenDone = await listen<void>(
            `ai-chat-done:${streamId}`,
            () => {
              // The invoke result is what we await on; the done
              // event is informational.
            },
          );
        }
        const payload: Record<string, unknown> = {
          model: req.model,
          messages: req.messages,
        };
        // Only attach `tools` when there's at least one. The loop
        // strips wire tools for emulated models (sending `[]`);
        // omitting the key entirely means Ollama's request body has
        // NO `tools` field, so a model with no tool template won't
        // 400 on an empty-but-present array.
        if (req.tools && req.tools.length > 0) payload.tools = req.tools;
        if (streamId) payload.streamId = streamId;
        // Effort-derived model knobs. Tauri 2 matches JS camelCase
        // args to Rust snake_case params, so `numCtx` lands on the
        // command's `num_ctx`. Omitted keys keep Ollama's defaults.
        if (req.temperature !== undefined) payload.temperature = req.temperature;
        if (req.num_ctx !== undefined) payload.numCtx = req.num_ctx;
        if (req.num_predict !== undefined) payload.numPredict = req.num_predict;
        const raw = (await invoke("ai_chat_agent_turn", payload)) as {
          content: string;
          tool_calls?: Array<{
            id?: string;
            function: { name: string; arguments: string };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_duration_ms?: number;
          };
        };
        const toolCalls: ToolCall[] | undefined = raw.tool_calls?.map(
          (tc, i) => ({
            id: tc.id ?? `call_${Date.now()}_${i}`,
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
          }),
        );
        const usage: TurnUsage | undefined = raw.usage
          ? {
              promptTokens: raw.usage.prompt_tokens ?? null,
              completionTokens: raw.usage.completion_tokens ?? null,
              durationMs: raw.usage.total_duration_ms ?? null,
            }
          : undefined;
        return {
          content: raw.content ?? "",
          toolCalls,
          usage,
        };
      } finally {
        unlistenChunk?.();
        unlistenDone?.();
      }
    },
  };
}
