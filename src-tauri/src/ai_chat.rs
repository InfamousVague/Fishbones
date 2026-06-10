//! Local AI assistant — streams completions from a user-local Ollama
//! daemon (`http://localhost:11434`). No API keys, no cloud round-trips,
//! no token billing. Model defaults to `qwen2.5-coder:7b` which is
//! purpose-built for code and runs comfortably on Apple Silicon.
//!
//! ## Why Ollama instead of embedded llama.cpp
//!
//! Ollama handles model downloads, quantisation choice, GPU/Metal
//! acceleration, and parallel-request queuing for us. Trading a
//! one-time `brew install ollama` + `ollama pull qwen2.5-coder` step
//! gets us a robust runtime without a multi-day linker-fiddling
//! detour. If we later want a self-contained binary, the command
//! interface defined here (`ai_chat_probe`, `ai_chat_stream`) is the
//! backend seam — swapping the implementation to `llama-cpp-2` is a
//! day's work, not a rewrite.
//!
//! ## Streaming contract
//!
//! `ai_chat_stream` takes the conversation + model name, returns
//! immediately, and emits Tauri events as tokens arrive:
//!
//!   * `ai-chat-chunk:<stream_id>` — `{ token: string }` per chunk.
//!   * `ai-chat-done:<stream_id>`  — `{ token_count, duration_ms }`.
//!   * `ai-chat-error:<stream_id>` — `{ error: string }`.
//!
//! Callers subscribe before invoking the command and unsubscribe on
//! done/error. `stream_id` is a UUID minted on the frontend so
//! concurrent chats (unlikely but cheap to support) don't crosstalk.

use std::collections::HashMap;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const OLLAMA_URL: &str = "http://localhost:11434";

/// Registry of in-flight stream cancellation flags. Keyed by the
/// caller-provided `stream_id`. When a stream starts it registers
/// an `AtomicBool::new(false)`; the stream loop checks the flag on
/// every chunk arrival and bails when set. The `ai_chat_stop`
/// command flips the flag for a given id — the corresponding
/// stream notices on its next iteration (typically within ~50ms
/// since Ollama emits a chunk every few tokens) and returns
/// early.
///
/// The map is global rather than `tauri::State` because the
/// streaming commands already use static helpers (`emit_chunk`,
/// `classify_reqwest_error`); threading state through every
/// function would balloon their signatures for no win. A
/// `Mutex<HashMap>` is fine here — both insert and remove happen
/// once per stream, never on the hot per-chunk path.
static STREAM_FLAGS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Register a fresh cancel flag for `stream_id` and return a clone
/// of the Arc. Caller holds onto the clone for hot-path checks;
/// the map's copy lets `ai_chat_stop` flip the same atomic from
/// a different command invocation.
fn register_cancel_flag(stream_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = STREAM_FLAGS.lock() {
        map.insert(stream_id.to_string(), flag.clone());
    }
    flag
}

/// Drop the cancel flag for `stream_id` from the registry. Called
/// when the stream completes (clean or errored) so the map doesn't
/// leak entries across long sessions.
fn unregister_cancel_flag(stream_id: &str) {
    if let Ok(mut map) = STREAM_FLAGS.lock() {
        map.remove(stream_id);
    }
}

/// Stop an active stream. The frontend calls this when the user
/// clicks the panel's "Stop" button. The corresponding stream's
/// loop checks the flag on every chunk and bails — typical
/// latency from click to actual stop is one Ollama chunk
/// (≈50-150ms).
#[tauri::command]
pub async fn ai_chat_stop(stream_id: String) -> Result<(), String> {
    if let Ok(map) = STREAM_FLAGS.lock() {
        if let Some(flag) = map.get(&stream_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}
const DEFAULT_MODEL: &str = "qwen2.5-coder:7b";

#[derive(Debug, Serialize)]
pub struct ProbeResult {
    /// True if `GET /api/tags` responded successfully.
    pub reachable: bool,
    /// Names of every model Ollama has locally. Empty when `reachable`
    /// is true but no pulls have happened yet.
    pub models: Vec<String>,
    /// True if DEFAULT_MODEL (or `model_hint`) is among `models`. Drives
    /// the "install Ollama / pull model" banner in the UI.
    pub has_default_model: bool,
    /// Populated when `reachable` is false; one-line reason for the UI
    /// to surface ("connection refused" / "timeout" / etc.).
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<TagModel>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    name: String,
}

/// Probe the local Ollama daemon. Lets the frontend decide whether to
/// render the chat pane or a "Set up the local assistant" banner.
#[tauri::command]
pub async fn ai_chat_probe(model_hint: Option<String>) -> ProbeResult {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ProbeResult {
                reachable: false,
                models: vec![],
                has_default_model: false,
                error: Some(format!("client init: {e}")),
            };
        }
    };
    let url = format!("{OLLAMA_URL}/api/tags");
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => match r.json::<TagsResponse>().await {
            Ok(tags) => {
                let models: Vec<String> = tags.models.into_iter().map(|m| m.name).collect();
                let wanted = model_hint.as_deref().unwrap_or(DEFAULT_MODEL);
                // `ollama pull X` stores a model as `X:latest` when no
                // tag is specified; the frontend might pass the bare
                // name either way. Accept a prefix match so both
                // `qwen2.5-coder` and `qwen2.5-coder:7b` resolve.
                let has = models
                    .iter()
                    .any(|m| m == wanted || m.starts_with(&format!("{wanted}:")) || wanted.starts_with(m.as_str()));
                ProbeResult {
                    reachable: true,
                    models,
                    has_default_model: has,
                    error: None,
                }
            }
            Err(e) => ProbeResult {
                reachable: true,
                models: vec![],
                has_default_model: false,
                error: Some(format!("parse tags response: {e}")),
            },
        },
        Ok(r) => ProbeResult {
            reachable: false,
            models: vec![],
            has_default_model: false,
            error: Some(format!("ollama returned {}", r.status())),
        },
        Err(e) => ProbeResult {
            reachable: false,
            models: vec![],
            has_default_model: false,
            error: Some(classify_reqwest_error(&e)),
        },
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Tool-use additions, only present on certain message kinds.
    /// `tool_call_id` + `name` are required when `role == "tool"`
    /// so Ollama can correlate the result with the call it
    /// answered. `tool_calls` is what the assistant emits when it
    /// wants to invoke one or more tools instead of (or alongside)
    /// writing free-form text. All three fields stay `None` /
    /// untouched for ordinary `user` / `assistant` text rows so
    /// the legacy `ai_chat_stream` path serialises the same JSON
    /// it always did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallSpec>>,
}

/// How long Ollama keeps the model loaded in memory after a
/// request completes. The default is a 5-minute idle unload — too
/// short for an agent run where the user reads the reply, thinks,
/// and asks a follow-up 10 minutes later: the next turn would pay
/// the full multi-second model-load cost again. 30m keeps the
/// model warm across a whole study session while still releasing
/// RAM if the user walks away.
const OLLAMA_KEEP_ALIVE: &str = "30m";

/// Shared HTTP client for every Ollama call. reqwest's `Client`
/// holds a connection pool — building a fresh one per command (the
/// previous pattern) threw the pool away every call, so every turn
/// paid a new TCP handshake to localhost. One static client means
/// turn N+1 reuses turn N's connection. The timeout strategy
/// matches what the per-call builders used: connect_timeout for
/// fail-fast on a dead daemon, read_timeout as a per-read idle
/// window that a healthy token stream never trips.
static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("reqwest client init")
});

/// Per-request model options forwarded from the frontend's
/// "effort" setting (fast / balanced / thorough →
/// temperature + context window + output budget). Serialised into
/// Ollama's `options` block. All fields optional so older callers
/// that omit them keep the model's own defaults.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct ModelOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i64>,
}

impl ModelOptions {
    fn is_empty(&self) -> bool {
        self.temperature.is_none() && self.num_ctx.is_none() && self.num_predict.is_none()
    }
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    /// Keep the model resident between calls — see OLLAMA_KEEP_ALIVE.
    keep_alive: &'a str,
}

/// Outbound request shape for the agent-turn (non-streaming)
/// command. Adds the `tools` parameter that the streaming variant
/// doesn't need. Tools are OpenAI-compatible (name + JSON-schema
/// parameter object) — Ollama's `/api/chat` endpoint accepts the
/// same shape verbatim when the underlying model supports tool
/// calling (Qwen 2.5 Coder, Llama 3.x, Hermes 3, etc.).
#[derive(Debug, Serialize)]
struct OllamaAgentRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<&'a serde_json::Value>,
    /// Keep the model resident between calls — see OLLAMA_KEEP_ALIVE.
    keep_alive: &'a str,
    /// Effort-derived sampling/context knobs. Omitted entirely
    /// when the frontend didn't send any (None → Ollama defaults).
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<&'a ModelOptions>,
}

/// Tool-call payload the assistant emits. The `function.arguments`
/// field is a JSON-encoded STRING (matching the OpenAI shape) —
/// the frontend parses it before dispatching to the tool handler.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolCallSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub function: ToolFunctionCall,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolFunctionCall {
    pub name: String,
    /// Some Ollama builds return `arguments` as a JSON object,
    /// others as a JSON-encoded string. We deserialise it as a
    /// `serde_json::Value` and stringify on the way out so the
    /// frontend always receives the OpenAI-style string form.
    pub arguments: serde_json::Value,
}

/// Non-streaming agent-turn response. `tool_calls` is `None` on
/// terminal turns where the model is just writing text; it's
/// populated when the model decided to invoke tools instead.
///
/// `usage` carries token counts + duration when Ollama reported
/// them (every modern Ollama build does, going back to ~2024). The
/// frontend's token-strip reads these to render run totals; older
/// daemons that omit the field just show a "—" instead.
#[derive(Debug, Serialize)]
pub struct AgentTurnResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallSpec>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TurnUsage>,
}

/// Token-usage telemetry for one turn. Field names are
/// serde-renamed to snake_case so the JS wrapper can read them
/// without a translation layer.
#[derive(Debug, Serialize, Default)]
pub struct TurnUsage {
    /// Input tokens — `prompt_eval_count` from Ollama's final
    /// done-line. None on builds that don't report it.
    pub prompt_tokens: Option<u64>,
    /// Output tokens — `eval_count`.
    pub completion_tokens: Option<u64>,
    /// Total wall-clock duration of this request in milliseconds.
    /// Sourced from Ollama's `total_duration` (nanoseconds) divided
    /// by 1e6, falling back to our own `Instant` timer when the
    /// field is missing.
    pub total_duration_ms: Option<u64>,
}

/// One Ollama agent response (non-streaming /api/chat with
/// `stream: false`). Mirrors the `OllamaChatChunk` shape used by
/// streaming chat but with `message` always present.
///
/// Includes the usage fields Ollama emits on the final response:
/// `prompt_eval_count`, `eval_count`, `total_duration`. These map
/// to our `TurnUsage` shape after a divide on the duration.
#[derive(Debug, Deserialize)]
struct OllamaAgentChunk {
    message: OllamaAgentMessage,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    total_duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaAgentMessage {
    #[serde(default)]
    content: String,
    #[serde(default)]
    tool_calls: Option<Vec<ToolCallSpec>>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatChunk {
    message: Option<OllamaChatChunkMessage>,
    done: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaChatChunkMessage {
    content: String,
}

/// Fire a streaming chat request at Ollama. Returns immediately; the
/// frontend subscribes to `ai-chat-chunk:<stream_id>` / `ai-chat-done`
/// / `ai-chat-error` events to assemble the reply and display tokens
/// as they arrive.
#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    stream_id: String,
    messages: Vec<ChatMessage>,
    model: Option<String>,
) -> Result<(), String> {
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let start = Instant::now();

    // For a STREAMING request, `reqwest::ClientBuilder::timeout` is
    // a footgun: it caps the TOTAL request duration including all
    // streamed reads, so a multi-thousand-token completion that
    // legitimately takes 3-5 minutes on a 7B model gets killed
    // mid-stream with a confusing "error decoding response body"
    // message. We use `connect_timeout` (TCP handshake only) +
    // `read_timeout` (per-read idle window) instead, which fails
    // fast on a hung daemon while letting a healthy generation
    // run to completion.
    //
    // Shared pooled client (see HTTP) — connection reuse across
    // turns instead of a per-call TCP handshake.
    let payload = OllamaChatRequest {
        model: &model,
        messages: &messages,
        stream: true,
        keep_alive: OLLAMA_KEEP_ALIVE,
    };

    let url = format!("{OLLAMA_URL}/api/chat");
    let resp = HTTP
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| classify_reqwest_error(&e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("ollama returned {status}: {}", body.trim());
        emit_error(&app, &stream_id, &msg);
        return Err(msg);
    }

    // Ollama streams NDJSON — one JSON object per line. Each non-final
    // chunk carries an incremental token in `message.content`; the
    // terminator has `done: true` and no content. We accumulate bytes
    // across chunks because reqwest doesn't guarantee line-aligned
    // delivery.
    let mut token_count: u32 = 0;
    let mut buffer = String::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                // Same classify pattern as the agent path — clear
                // user-facing message instead of the raw reqwest
                // string ("error decoding response body" etc.).
                let msg = classify_reqwest_error(&e);
                emit_error(&app, &stream_id, &msg);
                return Err(msg);
            }
        };
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // Drain whole lines. Any tail bytes after the final newline
        // stay in the buffer for the next iteration.
        loop {
            let Some(nl) = buffer.find('\n') else { break };
            let line = buffer[..nl].trim_end_matches('\r').to_string();
            buffer.drain(..=nl);
            if line.trim().is_empty() {
                continue;
            }
            let parsed: OllamaChatChunk = match serde_json::from_str(&line) {
                Ok(p) => p,
                Err(e) => {
                    // Malformed line — surface and abort; partial
                    // state from a bad stream is worse than a clean
                    // error the user can see.
                    let msg = format!("parse chunk: {e} (line: {})", truncate(&line, 120));
                    emit_error(&app, &stream_id, &msg);
                    return Err(msg);
                }
            };
            if let Some(msg) = parsed.message {
                if !msg.content.is_empty() {
                    token_count += 1;
                    emit_chunk(&app, &stream_id, &msg.content);
                }
            }
            if parsed.done {
                emit_done(&app, &stream_id, token_count, start.elapsed().as_millis() as u64);
                return Ok(());
            }
        }
    }

    // Stream ended without a `done: true` marker — rare, but handle it
    // as a clean close so the UI doesn't hang on a phantom stream.
    emit_done(&app, &stream_id, token_count, start.elapsed().as_millis() as u64);
    Ok(())
}

/// One agent turn — non-streaming. Returns the assistant message
/// (content + optional tool_calls) so the frontend `useAiAgent`
/// loop can dispatch tools and re-enter for another turn.
///
/// Why non-streaming for tool-using turns:
///   - The model's tool_calls payload only lands once the response
///     is complete; streaming would just delay parsing without any
///     UX win on the intermediate calls.
///   - The frontend re-renders the tool-call timeline + chips
///     between turns. Streaming tokens during a tool-using turn
///     would conflict with that handoff.
/// The FINAL turn (where the model is producing the text reply,
/// no more tool calls) can still be streamed via the existing
/// `ai_chat_stream` command if the caller wants progressive
/// rendering — the agent hook currently waits for the full reply
/// for simplicity, but the seam is there.
#[tauri::command]
pub async fn ai_chat_agent_turn(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    model: Option<String>,
    // `stream_id`: when provided, the command streams content
    // tokens via `ai-chat-chunk:<stream_id>` events as Ollama
    // produces them (same channel `ai_chat_stream` uses) AND
    // returns the fully-assembled response + tool_calls when
    // done. Lets the frontend render the final terminal turn's
    // tokens progressively without losing the structured
    // tool_calls parse — they only land on the final chunk
    // anyway, so nothing is sacrificed.
    // When None, the command runs in legacy non-streaming mode:
    // single `stream: false` POST, returns the full response in
    // one go. Useful when the caller doesn't want token events
    // (e.g. agent intermediate turns that are pure tool-call
    // negotiations with no user-visible text).
    stream_id: Option<String>,
    // Effort-derived model knobs (temperature / num_ctx /
    // num_predict). The frontend's "effort" setting maps to these;
    // they were previously sent by the TS transport but silently
    // dropped here because the command never declared the params.
    // Tauri's camelCase↔snake_case conversion means the TS side
    // sends `temperature`/`numCtx`/`numPredict` — declare each as
    // its own optional param and assemble the options block.
    temperature: Option<f64>,
    num_ctx: Option<u32>,
    num_predict: Option<i64>,
) -> Result<AgentTurnResponse, String> {
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());

    // Shared pooled client (see HTTP): connection reuse across
    // agent turns. The per-read 60s idle window + 5s connect
    // timeout strategy lives on the static builder.
    let options = ModelOptions {
        temperature,
        num_ctx,
        num_predict,
    };
    let options_ref = if options.is_empty() {
        None
    } else {
        Some(&options)
    };

    let streaming = stream_id.is_some();
    let payload = OllamaAgentRequest {
        model: &model,
        messages: &messages,
        stream: streaming,
        tools: tools.as_ref(),
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: options_ref,
    };

    let response = HTTP
        .post(format!("{OLLAMA_URL}/api/chat"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| classify_reqwest_error(&e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ollama returned {status}: {body}"));
    }

    // Non-streaming fast path. One JSON parse, return.
    if !streaming {
        let started = Instant::now();
        let parsed: OllamaAgentChunk = response
            .json()
            .await
            .map_err(|e| format!("failed to parse ollama response: {e}"))?;
        let usage = TurnUsage {
            prompt_tokens: parsed.prompt_eval_count,
            completion_tokens: parsed.eval_count,
            total_duration_ms: parsed
                .total_duration
                .map(|ns| ns / 1_000_000)
                .or_else(|| Some(started.elapsed().as_millis() as u64)),
        };
        return Ok(AgentTurnResponse {
            content: parsed.message.content,
            tool_calls: parsed.message.tool_calls,
            usage: Some(usage),
        });
    }

    // Streaming path. Ollama emits one JSON object per line; each
    // carries a `message` with incremental `content` and a `done`
    // flag. We assemble the full content + bubble tool_calls from
    // whatever line carries them (always the final non-empty one
    // in practice). Tokens are forwarded via the existing chat-
    // chunk event channel so the frontend's chat-stream listener
    // works verbatim.
    let stream_id = stream_id.unwrap();
    let cancel_flag = register_cancel_flag(&stream_id);
    let started = Instant::now();
    let mut content_acc = String::new();
    let mut final_tool_calls: Option<Vec<ToolCallSpec>> = None;
    let mut prompt_tokens: Option<u64> = None;
    let mut completion_tokens: Option<u64> = None;
    let mut total_duration_ms: Option<u64> = None;
    let mut byte_stream = response.bytes_stream();
    let mut buffer = Vec::new();
    while let Some(chunk_res) = byte_stream.next().await {
        // User-requested cancel — checked on every chunk so the
        // bail latency is at most one Ollama emit interval (a few
        // tens of ms). We drop the stream by returning Err; the
        // tauri command resolves on the frontend with the same
        // error path it uses for transport errors, and the agent
        // loop's hooks.shouldStop branch swallows it as a clean
        // user-initiated stop rather than a real failure.
        if cancel_flag.load(Ordering::Relaxed) {
            unregister_cancel_flag(&stream_id);
            let msg = "Stopped by user.".to_string();
            emit_error(&app, &stream_id, &msg);
            return Err(msg);
        }
        let chunk = match chunk_res {
            Ok(c) => c,
            Err(e) => {
                // Classify the error so the user sees a meaningful
                // message (stalled daemon vs. network blip vs.
                // decoding failure) instead of the raw reqwest
                // string. Also fire the chunk-channel's error event
                // so any UI listener can render an inline error
                // rather than just hanging on a half-streamed
                // response.
                unregister_cancel_flag(&stream_id);
                let msg = classify_reqwest_error(&e);
                emit_error(&app, &stream_id, &msg);
                return Err(msg);
            }
        };
        buffer.extend_from_slice(&chunk);
        // Split on newlines; keep any trailing partial line in the
        // buffer for the next iteration.
        while let Some(nl) = buffer.iter().position(|&b| b == b'\n') {
            let line = buffer.drain(..=nl).collect::<Vec<u8>>();
            let line = &line[..line.len().saturating_sub(1)];
            if line.is_empty() {
                continue;
            }
            let parsed: OllamaAgentStreamChunk = match serde_json::from_slice(line) {
                Ok(v) => v,
                Err(_) => continue, // Defensive: skip malformed lines.
            };
            if let Some(msg) = parsed.message {
                if !msg.content.is_empty() {
                    emit_chunk(&app, &stream_id, &msg.content);
                    content_acc.push_str(&msg.content);
                }
                if let Some(tc) = msg.tool_calls {
                    if !tc.is_empty() {
                        final_tool_calls = Some(tc);
                    }
                }
            }
            // Usage fields only appear on the done-line in
            // Ollama's protocol, but we hoist into our scoped
            // locals on every line that carries them so we don't
            // miss the figures if the daemon re-orders future
            // protocol versions.
            if let Some(p) = parsed.prompt_eval_count {
                prompt_tokens = Some(p);
            }
            if let Some(e) = parsed.eval_count {
                completion_tokens = Some(e);
            }
            if let Some(d) = parsed.total_duration {
                total_duration_ms = Some(d / 1_000_000);
            }
            if parsed.done {
                let usage = TurnUsage {
                    prompt_tokens,
                    completion_tokens,
                    total_duration_ms: total_duration_ms
                        .or_else(|| Some(started.elapsed().as_millis() as u64)),
                };
                emit_done(
                    &app,
                    &stream_id,
                    completion_tokens.unwrap_or(0) as u32,
                    started.elapsed().as_millis() as u64,
                );
                unregister_cancel_flag(&stream_id);
                return Ok(AgentTurnResponse {
                    content: content_acc,
                    tool_calls: final_tool_calls,
                    usage: Some(usage),
                });
            }
        }
    }

    // Stream ended without a `done: true` line — return what we
    // have rather than erroring.
    let usage = TurnUsage {
        prompt_tokens,
        completion_tokens,
        total_duration_ms: total_duration_ms
            .or_else(|| Some(started.elapsed().as_millis() as u64)),
    };
    emit_done(
        &app,
        &stream_id,
        completion_tokens.unwrap_or(0) as u32,
        started.elapsed().as_millis() as u64,
    );
    unregister_cancel_flag(&stream_id);
    Ok(AgentTurnResponse {
        content: content_acc,
        tool_calls: final_tool_calls,
        usage: Some(usage),
    })
}

/// Streaming-variant chunk. `message` may be missing on the final
/// done-line. `done` flips true on the terminator. The terminator
/// chunk also carries the usage fields — `prompt_eval_count` /
/// `eval_count` / `total_duration` — so the streaming path can
/// build a `TurnUsage` the same way the non-streaming path does.
#[derive(Debug, Deserialize)]
struct OllamaAgentStreamChunk {
    message: Option<OllamaAgentMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    total_duration: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct ChunkPayload<'a> {
    token: &'a str,
}

#[derive(Debug, Serialize, Clone)]
struct DonePayload {
    token_count: u32,
    duration_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
struct ErrorPayload<'a> {
    error: &'a str,
}

fn emit_chunk(app: &AppHandle, stream_id: &str, token: &str) {
    let _ = app.emit(&format!("ai-chat-chunk:{stream_id}"), ChunkPayload { token });
}

fn emit_done(app: &AppHandle, stream_id: &str, token_count: u32, duration_ms: u64) {
    let _ = app.emit(
        &format!("ai-chat-done:{stream_id}"),
        DonePayload {
            token_count,
            duration_ms,
        },
    );
}

fn emit_error(app: &AppHandle, stream_id: &str, error: &str) {
    let _ = app.emit(&format!("ai-chat-error:{stream_id}"), ErrorPayload { error });
}

fn classify_reqwest_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        // With our read_timeout strategy this means Ollama produced
        // no tokens for the full window — usually because the daemon
        // hung mid-generation. The previous wording ("timed out talking
        // to Ollama") was confusing when the daemon WAS responding but
        // had stalled. Differentiate so the user knows what to do.
        "Ollama stalled — no tokens for 60s. The model may have crashed; check `ollama ps` and try again, or pull a smaller/different model.".into()
    } else if e.is_connect() {
        "Ollama isn't reachable on localhost:11434. Start it with `ollama serve` or install via `brew install ollama`.".into()
    } else if e.is_request() {
        format!("Ollama request failed: {e}")
    } else if e.is_body() || e.is_decode() {
        // The "error decoding response body" the user hit. With the
        // read_timeout fix this should be much rarer, but if Ollama
        // sends a malformed chunk or the connection is severed we
        // still want a clear message.
        format!(
            "Lost connection to Ollama mid-response. The daemon may have crashed or run out of memory. \
             Check the Ollama logs (`tail -f /tmp/ollama.log`) and try again. Detail: {e}"
        )
    } else {
        format!("request failed: {e}")
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

// ---- Install / start / pull commands ---------------------------------------
//
// Mirrors the language-toolchain install pattern in `toolchain.rs`: the
// frontend renders the appropriate setup button based on which check
// fails, then invokes one of these commands to actually do the thing.
// Each command returns a uniform `InstallResult` so the panel can show
// stdout/stderr the same way regardless of which step ran.

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct OllamaInstallStatus {
    /// `ollama` binary is on PATH (regardless of whether the daemon is
    /// running). When false the install button is the next action.
    pub ollama_installed: bool,
    /// Homebrew is on PATH. We need it to run `brew install ollama`;
    /// when missing we surface a link to brew.sh instead of a button.
    pub homebrew_installed: bool,
}

#[tauri::command]
pub async fn ai_chat_install_status() -> OllamaInstallStatus {
    OllamaInstallStatus {
        ollama_installed: which_binary("ollama").is_some(),
        homebrew_installed: which_binary("brew").is_some(),
    }
}

/// `brew install ollama`. Mirrors `install_language_toolchain` —
/// captures stdout/stderr, returns timing. Synchronous (we await
/// `wait_with_output`) so the UI can render a final status when it
/// resolves; the button stays in a "Installing…" state in the
/// meantime. brew install is typically 30-90s on a warm machine.
#[tauri::command]
pub async fn ai_chat_install_ollama() -> Result<InstallResult, String> {
    if which_binary("brew").is_none() {
        return Err(
            "Homebrew isn't installed. Visit https://brew.sh, paste the install one-liner into Terminal, then come back and click Install again."
                .into(),
        );
    }
    run_capture("brew install ollama")
}

/// `brew services start ollama`. Backgrounds the daemon under
/// launchd so it survives reboots and shell-window-close. We prefer
/// this over `ollama serve` because a foreground `ollama serve`
/// would die the moment Libre quits.
#[tauri::command]
pub async fn ai_chat_start_ollama() -> Result<InstallResult, String> {
    if which_binary("brew").is_some() {
        return run_capture("brew services start ollama");
    }
    // No brew? Fall back to spawning `ollama serve` detached. The
    // process will still die when the user logs out, but at least
    // it'll work for the rest of this session — better than refusing
    // outright.
    if which_binary("ollama").is_none() {
        return Err("ollama binary isn't installed yet — install it first.".into());
    }
    let start = Instant::now();
    let spawn = Command::new("sh")
        .arg("-c")
        .arg("nohup ollama serve > /tmp/ollama.log 2>&1 &")
        .env("PATH", broadened_path())
        .spawn();
    match spawn {
        Ok(_) => Ok(InstallResult {
            success: true,
            stdout: "started in background — log: /tmp/ollama.log".into(),
            stderr: String::new(),
            duration_ms: start.elapsed().as_millis() as u64,
        }),
        Err(e) => Err(format!("failed to start ollama: {e}")),
    }
}

/// `ollama pull <model>`. Pulls the default coding model unless the
/// caller specifies otherwise. ~4GB download for the 7B; the UI
/// renders a "this is going to take a few minutes" hint before
/// firing this command.
#[tauri::command]
pub async fn ai_chat_pull_model(model: Option<String>) -> Result<InstallResult, String> {
    if which_binary("ollama").is_none() {
        return Err("ollama binary isn't installed yet — install it first.".into());
    }
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    // Defensive: refuse anything with shell metacharacters in the
    // model name. The frontend never sends one but a hostile model
    // string slipping in would otherwise let `sh -c` execute
    // arbitrary commands.
    if model
        .chars()
        .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/')))
    {
        return Err(format!("invalid model name: {model}"));
    }
    run_capture(&format!("ollama pull {model}"))
}

/// Run `sh -c "<cmd>"` with a broadened PATH and return captured
/// stdout/stderr. Same behavior `toolchain::install_language_toolchain`
/// has for non-sudo recipes — we don't need sudo for any of the AI
/// install paths so the password plumbing is omitted.
fn run_capture(cmd: &str) -> Result<InstallResult, String> {
    let start = Instant::now();
    let output = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .env("PATH", broadened_path())
        .output()
        .map_err(|e| format!("failed to run installer: {e}"))?;
    Ok(InstallResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

/// Look for a binary on PATH, with the same Homebrew-prefix fallbacks
/// `toolchain.rs` uses. Inlined rather than re-exporting from there
/// because the install module's needs are tiny and we don't want a
/// circular-reach across modules just for a 10-line helper.
fn which_binary(name: &str) -> Option<String> {
    for dir in broadened_path().split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = std::path::Path::new(dir).join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

/// PATH that includes `/opt/homebrew/bin` and friends. macOS Tauri
/// apps launched from Finder inherit a trimmed PATH that doesn't
/// include brew's prefix, which means `which ollama` returns None
/// even when ollama is correctly installed.
fn broadened_path() -> String {
    let extras = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
    ];
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = current.split(':').map(str::to_string).collect();
    for e in extras {
        if !parts.iter().any(|p| p == e) {
            parts.push(e.to_string());
        }
    }
    parts.join(":")
}
