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

use std::process::Command;
use std::time::Instant;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const OLLAMA_URL: &str = "http://localhost:11434";
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
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
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

    // 120s per-request ceiling. An Apple Silicon laptop at 8-15 tok/s
    // will comfortably finish any kata-hint-sized reply in under 60s;
    // 120 leaves headroom for the 3B→7B model variance on slower
    // machines while still protecting against an Ollama hang that
    // would otherwise leak resources.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("client init: {e}"))?;

    let payload = OllamaChatRequest {
        model: &model,
        messages: &messages,
        stream: true,
    };

    let url = format!("{OLLAMA_URL}/api/chat");
    let resp = client
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
                let msg = format!("stream read: {e}");
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
        "timed out talking to Ollama — is it running? (`ollama serve`)".into()
    } else if e.is_connect() {
        "Ollama isn't reachable on localhost:11434. Start it with `ollama serve` or install via `brew install ollama`.".into()
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
/// would die the moment Fishbones quits.
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
