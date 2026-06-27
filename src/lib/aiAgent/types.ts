/// Public types for the agent module.
///
/// Tool-related types live in `lib/aiTools/types.ts` (older
/// location, predates this module); re-exported here so consumers
/// can pull everything from one place.

export type {
  ToolCall,
  ToolDef,
  ToolResult,
  ToolApproval,
  ToolSchema,
  ToolParamSchema,
} from "../aiTools/types";

import type { ToolCall } from "../aiTools/types";
import type { TurnUsage } from "./usage";

/// One turn of agent / model conversation.
///
/// `system`: prepended to every wire payload, owns prompting +
///   workflow framing. Stored at most once in the messages array.
///
/// `user`: what the user typed. `augmented` holds an alternate
///   payload sent to the LLM in place of `content` when callers
///   bolster the user's wording with framing the user shouldn't
///   see in their bubble (the Generate flow does this).
///
/// `assistant`: model output. `content` is the visible text after
///   confidence / tool-call JSON stripping; `rawContent` is the
///   pre-strip text the agent loop retains for debugging; both
///   `toolCalls` (structured channel) and `confidence` (parsed
///   inline tag) hang off the same row so the UI can render
///   everything correlated.
///
/// `tool`: result of a tool call dispatched in response to the
///   model's `toolCalls`. The wire payload uses `toolCallId` +
///   `name` so the model can correlate.
///
/// `clarification`: the host injected a `request_user_input`
///   pause, the user answered, and the answer is now in the
///   conversation as if the user wrote it directly. Distinguished
///   from a normal `user` message so the UI can render it with a
///   "(clarification)" affordance instead of a bare bubble.
export type AgentMessage =
  | { role: "system"; content: string }
  | {
      role: "user";
      content: string;
      /// Optional alternate payload for the wire — see hook comments.
      augmented?: string;
      /// True when this user message is the answer to a model-
      /// initiated clarification request. UI renders it slightly
      /// differently so the thread reads as "model asked, user
      /// answered" rather than "user spontaneously typed this".
      isClarification?: boolean;
      /// True when the LOOP injected this message (auto-continue
      /// nudge for an unfinished build) — the learner never typed
      /// it. UI renders it as a muted system breadcrumb instead of
      /// a user bubble so the conversation doesn't show words in
      /// the learner's mouth.
      isNudge?: boolean;
      /// True for purely-informational host breadcrumbs (e.g. the
      /// "this model has no native tools, switched to compatibility
      /// mode" note). Rendered like a nudge, but — unlike a nudge —
      /// it is NEVER serialized to the model on a later turn
      /// (`toWireMessages` drops it). It's UI chrome, not context;
      /// re-sending it would read to the model as a stray user
      /// instruction.
      isSystemNote?: boolean;
    }
  | {
      role: "assistant";
      content: string;
      /// Original assistant content BEFORE we stripped the
      /// confidence tag + inline tool-call JSON. Kept around so
      /// the timeline / debug drawer can show what the model
      /// literally said.
      rawContent?: string;
      toolCalls?: ToolCall[];
      /// Confidence in [0, 1] when the model emitted a tag.
      confidence?: number | null;
      /// Per-turn token usage + duration as reported by Ollama.
      usage?: TurnUsage;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/// Transport interface used by the loop. The Tauri transport in
/// `transport.ts` wraps `ai_chat_agent_turn` + the chunk listener;
/// tests provide a scripted version via `installMockTauri`.
///
/// The transport is responsible for ONE round-trip: send the
/// conversation + tools, return what the model wrote back. The
/// agent loop drives multi-turn behaviour by calling this in a
/// loop until the model stops emitting tool calls.
export interface AgentTransport {
  /// Send one turn and resolve when the model has finished.
  ///
  /// `onChunk` (when provided) is called for each streamed token
  /// so the UI can render the assistant message progressively.
  /// Without it the transport falls back to non-streaming mode.
  send: (req: AgentTurnRequest) => Promise<AgentTurnResponse>;
}

export interface AgentTurnRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_call_id?: string;
  }>;
  tools: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
  /// Stream tokens via this callback when provided. Each invocation
  /// receives the next chunk; the cumulative string is the assistant
  /// content so far. The final `AgentTurnResponse` still carries the
  /// full content for tools / debug.
  onChunk?: (chunk: string) => void;
  /// Fired once at the start of each turn with the Rust-side
  /// stream id the transport just minted. Lets the host (the
  /// React hook) save it for later cancellation via
  /// `ai_chat_stop`. Optional — the loop itself doesn't use it.
  onStreamId?: (streamId: string) => void;
  /// Per-call model knobs derived from the user's `effort` setting
  /// (Notion issue #93e0c544cf11a200). Optional — older transports
  /// (mock, test) can ignore these and the production Ollama
  /// transport falls back to its own defaults when the field is
  /// absent. Defined as flat properties (rather than a nested
  /// `options:` block) so the Tauri command can pick them up
  /// without a schema migration.
  temperature?: number;
  num_ctx?: number;
  num_predict?: number;
}

export interface AgentTurnResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TurnUsage;
}
