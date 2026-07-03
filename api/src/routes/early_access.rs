//! POST /early-access — public, unauthenticated email capture for the
//! marketing site's "Join early access updates" section.
//!
//! Mirrors `feedback.rs`: we forward each email to a Notion database via
//! the Notion API, authenticated with the same server-side integration
//! token (which can never ship inside a client). This uses a SEPARATE
//! database from feedback — a contact list, not bug reports — so it has
//! its own id env var.
//!
//! Config: `NOTION_TOKEN` (shared with feedback) + a distinct
//! `NOTION_EARLY_ACCESS_DATABASE_ID`. Either unset → 503, same
//! "half-configured deploy surfaces a clean status" convention.
//!
//! Responses: `202 Accepted` once Notion stored the row, `400` for a
//! malformed email, `429` when rate-limited, `502` if Notion errors,
//! `503` when unconfigured. A hidden honeypot field drops obvious bots.
//! This is NOT a newsletter subscription — the site copy makes that
//! explicit; we only file the address for a later, single opt-in email.

use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::{json, Map};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::state::AppState;

/// Pinned Notion API version — `parent: { database_id }` is valid here.
const NOTION_VERSION: &str = "2022-06-28";
/// How long the Notion HTTP call may hang before we give up.
const NOTION_TIMEOUT: Duration = Duration::from_secs(10);
/// Max accepted address length (RFC 5321 caps at 320).
const MAX_EMAIL_LEN: usize = 320;

/// Per-IP rate limit — each accepted request drives an authenticated
/// Notion write, so cap floods. Fixed window, same shape as feedback.
const EARLY_RL_WINDOW: Duration = Duration::from_secs(300);
const EARLY_RL_MAX: u32 = 5;

static EARLY_RL: Lazy<DashMap<String, (u32, Instant)>> = Lazy::new(DashMap::new);

/// Client IP for rate-limit keying. Behind Caddy (the only proxy), so we
/// take the LAST `X-Forwarded-For` hop — the value Caddy appended and can
/// be trusted — not the leftmost, which a client can spoof. Missing
/// header → one shared "unknown" bucket (fail toward limiting).
fn client_key(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next_back())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn rate_limited(key: &str) -> bool {
    let now = Instant::now();
    EARLY_RL.retain(|_, (_, start)| now.duration_since(*start) < EARLY_RL_WINDOW);
    let mut entry = EARLY_RL.entry(key.to_string()).or_insert((0, now));
    if now.duration_since(entry.1) >= EARLY_RL_WINDOW {
        *entry = (1, now);
        false
    } else {
        entry.0 += 1;
        entry.0 > EARLY_RL_MAX
    }
}

/// Minimal, permissive email shape check — one `@`, a `.` after it, no
/// spaces, sane length. Deliverability is verified later by actually
/// emailing the address, not by a regex.
fn looks_like_email(e: &str) -> bool {
    if e.is_empty() || e.len() > MAX_EMAIL_LEN || e.contains(char::is_whitespace) {
        return false;
    }
    match e.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty() && domain.contains('.') && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        None => false,
    }
}

#[derive(Deserialize)]
pub struct EarlyAccessRequest {
    pub email: String,
    /// Where the signup came from, e.g. "website". Sanitised + capped.
    #[serde(default)]
    pub source: Option<String>,
    /// Honeypot — the real UI leaves this empty. Filled → drop as a bot.
    #[serde(default)]
    pub hp: Option<String>,
}

pub async fn submit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<EarlyAccessRequest>,
) -> Result<StatusCode, StatusCode> {
    // Rate limit FIRST so a scripted flood is rejected cheaply.
    let rl_key = client_key(&headers);
    if rate_limited(&rl_key) {
        tracing::warn!("Early-access rate limit exceeded for {rl_key}");
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // Config gate — token + the dedicated database id both required.
    let (token, database_id) =
        match (&state.notion_token, &state.notion_early_access_database_id) {
            (Some(t), Some(d)) => (t, d),
            _ => {
                tracing::warn!(
                    "POST /early-access received but NOTION_TOKEN / \
                     NOTION_EARLY_ACCESS_DATABASE_ID is unset"
                );
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        };

    // Honeypot — answer success so the bot doesn't retry, never write.
    if body.hp.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
        tracing::info!("Early-access honeypot tripped — dropping submission");
        return Ok(StatusCode::ACCEPTED);
    }

    let email = body.email.trim().to_lowercase();
    if !looks_like_email(&email) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let source = body
        .source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 40)
        .unwrap_or("website")
        .to_string();

    // Notion page: title = the email (the row label + searchable), plus a
    // Source tag and a "New" status for outreach triage. Signup date comes
    // free from Notion's created-time system property.
    let mut properties = Map::new();
    properties.insert(
        "Email".into(),
        json!({ "title": [{ "text": { "content": email } }] }),
    );
    properties.insert("Source".into(), json!({ "select": { "name": source } }));
    properties.insert("Status".into(), json!({ "select": { "name": "New" } }));

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
            tracing::info!("Early-access signup stored in Notion ({source})");
            Ok(StatusCode::ACCEPTED)
        }
        Ok(r) => {
            let status = r.status();
            let detail = r.text().await.unwrap_or_default();
            tracing::error!(
                "Notion rejected early-access ({status}): {detail} \
                 (if 404/unauthorized, share the database with the integration)"
            );
            Err(StatusCode::BAD_GATEWAY)
        }
        Err(e) => {
            tracing::error!("Notion early-access request failed: {e}");
            Err(StatusCode::BAD_GATEWAY)
        }
    }
}
