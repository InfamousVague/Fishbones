//! POST /feedback — public, unauthenticated feedback / bug-report /
//! feature-request intake.
//!
//! The app's in-app feedback modal posts here; we forward each
//! submission to a Notion database via the Notion API, authenticated
//! with a server-side integration token. The token MUST stay on the
//! server — it can read/write the whole workspace the integration is
//! shared into, so it can never ship inside the desktop / web client.
//! That's the entire reason this relay endpoint exists.
//!
//! Config: `NOTION_TOKEN` (integration secret) + `NOTION_DATABASE_ID`
//! (the target database). Either unset → the route returns 503, same
//! "half-configured deploy surfaces a clean status" convention the
//! OAuth routes use. The database id is NOT a secret (it's in the page
//! URL); only the token is.
//!
//! The endpoint is intentionally fire-and-forget for the client: it
//! returns `202 Accepted` once Notion has stored the page, `502` if
//! Notion rejects/errors (so the UI can show "try again"), and `400`
//! for an empty body. A hidden honeypot field drops obvious bots.

use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::state::AppState;

/// Notion caps a single rich-text object's `content` at 2000 chars, so
/// long messages are split across several objects. 1900 leaves head-
/// room and we chunk by `char` (not byte) so a multi-byte codepoint is
/// never sliced down the middle.
const NOTION_RICH_TEXT_LIMIT: usize = 1900;
/// Upper bound on a single message. Generous for prose, low enough that
/// a paste-bomb can't balloon the Notion payload.
const MAX_MESSAGE_CHARS: usize = 5000;
/// Pinned Notion API version. `parent: { database_id }` is valid here;
/// newer versions move to data-source parents.
const NOTION_VERSION: &str = "2022-06-28";

/// Per-IP rate limit for this public, unauthenticated endpoint. Each
/// accepted request drives an authenticated write to a real Notion
/// database, so without a cap a script could flood the board and burn
/// the integration's API quota. A fixed window: at most
/// `FEEDBACK_RL_MAX` requests per `FEEDBACK_RL_WINDOW` from one client
/// IP. Not a hard boundary (IPs are spoofable / shared), but it turns
/// "unlimited" into "a handful per window". Same in-memory `DashMap`
/// shape the OAuth state cache uses.
const FEEDBACK_RL_WINDOW: Duration = Duration::from_secs(300);
const FEEDBACK_RL_MAX: u32 = 5;
/// How long the Notion HTTP call may hang before we give up. Without it
/// a slow/hung api.notion.com would pin the handler task indefinitely;
/// combined with the rate limit above this bounds resource use under a
/// burst. Mirrors the 10s timeout the mailer uses.
const NOTION_TIMEOUT: Duration = Duration::from_secs(10);

/// (count, window-start) keyed by client IP. Process-global; swept
/// lazily on each call so it can't grow without bound.
static FEEDBACK_RL: Lazy<DashMap<String, (u32, Instant)>> = Lazy::new(DashMap::new);

/// Client IP for rate-limit keying. The relay sits behind Caddy (the
/// only proxy — no CDN in front; Caddy terminates TLS directly for
/// api.libre.academy), so the TCP peer is always loopback and we read
/// the real client from `X-Forwarded-For`.
///
/// We take the LAST hop, not the first. Caddy's reverse_proxy APPENDS
/// the immediate peer's IP to the right of any client-supplied
/// `X-Forwarded-For`, so the leftmost entries are attacker-controlled
/// (a client can pre-set `X-Forwarded-For: fake` to rotate the key and
/// bypass the limit) while the rightmost is the value Caddy itself
/// added and can be trusted. Missing header → one shared "unknown"
/// bucket (fail toward limiting, not toward unlimited).
fn feedback_client_key(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next_back())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

/// True when this IP has exceeded its window budget. `retain` fully
/// completes (and releases its shard locks) before we take the per-key
/// `entry`, so the sweep can't self-deadlock against the entry lock.
fn feedback_rate_limited(key: &str) -> bool {
    let now = Instant::now();
    FEEDBACK_RL.retain(|_, (_, start)| now.duration_since(*start) < FEEDBACK_RL_WINDOW);
    let mut entry = FEEDBACK_RL.entry(key.to_string()).or_insert((0, now));
    if now.duration_since(entry.1) >= FEEDBACK_RL_WINDOW {
        *entry = (1, now);
        false
    } else {
        entry.0 += 1;
        entry.0 > FEEDBACK_RL_MAX
    }
}

#[derive(Deserialize)]
pub struct FeedbackRequest {
    /// "bug" | "feature" | "feedback" | "other" (case-insensitive).
    pub kind: String,
    pub message: String,
    /// Optional contact address. Dropped unless it at least looks like
    /// an email so the Notion `email` property never holds junk.
    pub email: Option<String>,
    /// App version string, e.g. "2.4.1" (desktop) — `None` on web.
    pub app_version: Option<String>,
    /// "macOS" | "Windows" | "Linux" | "Web". Anything else is dropped.
    pub platform: Option<String>,
    /// Honeypot — a hidden field the real UI leaves empty. Bots that
    /// fill every input trip it; we answer 202 but drop the submission.
    #[serde(default)]
    pub hp: Option<String>,
}

/// Split `s` into Notion rich-text objects, each within the 2000-char
/// per-object limit.
fn rich_text(s: &str) -> Vec<Value> {
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return vec![];
    }
    chars
        .chunks(NOTION_RICH_TEXT_LIMIT)
        .map(|c| json!({ "text": { "content": c.iter().collect::<String>() } }))
        .collect()
}

/// Map the wire `kind` to the exact Notion select option name.
fn notion_type(kind: &str) -> &'static str {
    match kind.trim().to_lowercase().as_str() {
        "bug" => "Bug",
        "feature" | "feature request" | "feature_request" => "Feature Request",
        "feedback" => "Feedback",
        _ => "Other",
    }
}

/// Normalise a client-supplied platform to one of the Notion select
/// options, or `None` if it doesn't match (so we never create a stray
/// option on the database).
fn notion_platform(p: &str) -> Option<&'static str> {
    match p.trim().to_lowercase().as_str() {
        "macos" | "mac" | "darwin" => Some("macOS"),
        "windows" | "win" => Some("Windows"),
        "linux" => Some("Linux"),
        "web" => Some("Web"),
        _ => None,
    }
}

/// A short title for the Notion page — the first line of the message,
/// trimmed to ~80 chars, since Notion shows the title as the row label.
fn summarize(message: &str, fallback: &str) -> String {
    let first = message.lines().next().unwrap_or("").trim();
    let base = if first.is_empty() { message.trim() } else { first };
    let mut s: String = base.chars().take(80).collect();
    if base.chars().count() > 80 {
        s.push('…');
    }
    if s.trim().is_empty() {
        fallback.to_string()
    } else {
        s
    }
}

pub async fn submit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<FeedbackRequest>,
) -> Result<StatusCode, StatusCode> {
    // Per-IP rate limit FIRST — before any work — so a scripted flood is
    // rejected cheaply and can't drive Notion writes. Counts every
    // request (honeypot + invalid included), which is what we want for
    // flood protection; the window is generous enough that normal use
    // (a submission or two) never trips it.
    let rl_key = feedback_client_key(&headers);
    if feedback_rate_limited(&rl_key) {
        tracing::warn!("Feedback rate limit exceeded for {rl_key}");
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // Config gate — both env vars required, else this deploy can't reach
    // Notion. 503 mirrors the OAuth routes' "not configured" behaviour.
    let (token, database_id) = match (&state.notion_token, &state.notion_database_id) {
        (Some(t), Some(d)) => (t, d),
        _ => {
            tracing::warn!(
                "POST /feedback received but NOTION_TOKEN / NOTION_DATABASE_ID is unset"
            );
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
    };

    // Honeypot: a real client leaves `hp` empty. Anything in it is a
    // bot — answer success so it doesn't retry, but never touch Notion.
    if body.hp.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
        tracing::info!("Feedback honeypot tripped — dropping submission");
        return Ok(StatusCode::ACCEPTED);
    }

    let message = body.message.trim();
    if message.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let kind = notion_type(&body.kind);
    let summary = summarize(message, kind);

    let email = body
        .email
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty() && e.contains('@') && e.len() <= 320)
        .map(str::to_string);
    let app_version = body
        .app_version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(40).collect::<String>());
    let platform = body.platform.as_deref().and_then(notion_platform);

    // Build the Notion page properties. Optional fields are only added
    // when present so we never write empty values or stray options.
    let mut properties = serde_json::Map::new();
    properties.insert(
        "Summary".into(),
        json!({ "title": [{ "text": { "content": summary } }] }),
    );
    properties.insert("Type".into(), json!({ "select": { "name": kind } }));
    properties.insert("Message".into(), json!({ "rich_text": rich_text(message) }));
    if let Some(v) = &app_version {
        properties.insert("App Version".into(), json!({ "rich_text": rich_text(v) }));
    }
    if let Some(p) = platform {
        properties.insert("Platform".into(), json!({ "select": { "name": p } }));
    }
    if let Some(e) = &email {
        properties.insert("Email".into(), json!({ "email": e }));
    }

    let payload = json!({
        "parent": { "database_id": database_id },
        "properties": properties,
    });

    let res = reqwest::Client::new()
        .post("https://api.notion.com/v1/pages")
        .bearer_auth(token)
        .header("Notion-Version", NOTION_VERSION)
        .json(&payload)
        .timeout(NOTION_TIMEOUT)
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            tracing::info!("Feedback ({kind}) stored in Notion");
            Ok(StatusCode::ACCEPTED)
        }
        Ok(r) => {
            let status = r.status();
            let detail = r.text().await.unwrap_or_default();
            // 404 here almost always means the integration wasn't added
            // to the database's Connections — call that out explicitly.
            tracing::error!(
                "Notion rejected feedback ({status}): {detail} \
                 (if 404/unauthorized, share the database with the integration)"
            );
            Err(StatusCode::BAD_GATEWAY)
        }
        Err(e) => {
            tracing::error!("Notion request failed: {e}");
            Err(StatusCode::BAD_GATEWAY)
        }
    }
}
