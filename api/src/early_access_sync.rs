//! Background poller: mirror the early-access Notion list onto accounts.
//!
//! Users join early access by submitting their email on the marketing
//! site (`POST /early-access` → a row in a Notion database). This task
//! periodically reads that database and flips the `early_access` flag on
//! for any matching account, so the app can show a "Supporter" badge.
//!
//! It's a pull, not a push: someone can join the list before they ever
//! create an account, and vice-versa — the next poll reconciles whoever
//! now matches. Granting is idempotent (`grant_early_access` skips rows
//! already flagged), so a re-poll of the whole list is cheap.
//!
//! Config (shared with the write route): `NOTION_TOKEN` +
//! `NOTION_EARLY_ACCESS_DATABASE_ID`. Poll cadence is
//! `EARLY_ACCESS_POLL_MINUTES` (default 15). Both env absent → the task
//! is never spawned (see `main.rs`).

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use crate::state::AppState;

/// Pinned Notion API version — matches the write route.
const NOTION_VERSION: &str = "2022-06-28";
/// How long a single Notion request may hang before we give up on it.
const NOTION_TIMEOUT: Duration = Duration::from_secs(20);
/// Notion caps `page_size` at 100.
const PAGE_SIZE: u32 = 100;
/// Safety cap on pagination so a misconfigured/huge database can't spin
/// the poller forever. 100 pages × 100 rows = 10k signups per pass.
const MAX_PAGES: u32 = 100;

/// Spawned once at startup when the Notion early-access config is
/// present. Runs an initial sync shortly after boot (so a fresh deploy
/// reconciles quickly), then every `EARLY_ACCESS_POLL_MINUTES`.
pub async fn poll_loop(state: Arc<AppState>, token: String, database_id: String) {
    let minutes: u64 = std::env::var("EARLY_ACCESS_POLL_MINUTES")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&m| m >= 1)
        .unwrap_or(15);
    let period = Duration::from_secs(minutes * 60);
    tracing::info!("Early-access poller started (every {minutes} min)");

    // A short initial delay lets the server finish binding + serving
    // before the first (network-bound) reconciliation runs.
    tokio::time::sleep(Duration::from_secs(10)).await;
    let mut ticker = tokio::time::interval(period);
    loop {
        ticker.tick().await;
        match sync_once(&state, &token, &database_id).await {
            Ok(0) => tracing::debug!("Early-access poll: no new supporters"),
            Ok(n) => tracing::info!("Early-access poll: granted {n} new supporter(s)"),
            Err(e) => tracing::warn!("Early-access poll failed: {e}"),
        }
    }
}

/// One reconciliation pass: page through the Notion database, collect
/// every signup email, and grant the flag to matching accounts. Returns
/// the number of NEWLY granted supporters.
async fn sync_once(
    state: &Arc<AppState>,
    token: &str,
    database_id: &str,
) -> anyhow::Result<usize> {
    let client = reqwest::Client::new();
    let url = format!("https://api.notion.com/v1/databases/{database_id}/query");

    let mut emails: Vec<String> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0u32;

    loop {
        pages += 1;
        if pages > MAX_PAGES {
            tracing::warn!("Early-access poll hit MAX_PAGES ({MAX_PAGES}); truncating");
            break;
        }
        let body = match &cursor {
            Some(c) => json!({ "page_size": PAGE_SIZE, "start_cursor": c }),
            None => json!({ "page_size": PAGE_SIZE }),
        };
        let resp = client
            .post(&url)
            .bearer_auth(token)
            .header("Notion-Version", NOTION_VERSION)
            .json(&body)
            .timeout(NOTION_TIMEOUT)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Notion query {status}: {detail} \
                 (if 404/unauthorized, share the database with the integration)"
            );
        }
        let page: NotionQueryResponse = resp.json().await?;
        for row in &page.results {
            if let Some(email) = extract_email(row) {
                emails.push(email);
            }
        }
        if page.has_more {
            cursor = page.next_cursor;
            if cursor.is_none() {
                break; // defensive: has_more with no cursor — stop.
            }
        } else {
            break;
        }
    }

    tracing::debug!("Early-access poll: {} email(s) on the list", emails.len());
    state.db.grant_early_access(&emails)
}

/// Pull the signup email out of a Notion page. The write route stores it
/// as the `Email` TITLE property; we read the title's plain text. Falls
/// back to any `email`-typed property (so a manually-restructured
/// database with a proper Email column still works), and finally to any
/// property literally named "Email". Returns a normalized (trimmed,
/// lowercased) address, or None if the row has no usable email.
fn extract_email(page: &NotionPage) -> Option<String> {
    let props = page.properties.as_object()?;

    // Preferred: the `Email` title property the write route creates.
    let from_title = props
        .get("Email")
        .and_then(|p| p.get("title"))
        .and_then(title_plain_text);

    // Fallbacks: a real `email`-typed property, or any prop named Email.
    let from_email_type = props.values().find_map(|p| {
        p.get("email").and_then(|v| v.as_str()).map(str::to_string)
    });

    let raw = from_title.or(from_email_type)?;
    let norm = raw.trim().to_lowercase();
    if norm.is_empty() || !norm.contains('@') {
        None
    } else {
        Some(norm)
    }
}

/// Concatenate the `plain_text` of a Notion rich-text/title array.
fn title_plain_text(title: &serde_json::Value) -> Option<String> {
    let arr = title.as_array()?;
    let mut s = String::new();
    for part in arr {
        if let Some(t) = part.get("plain_text").and_then(|v| v.as_str()) {
            s.push_str(t);
        } else if let Some(t) = part
            .get("text")
            .and_then(|t| t.get("content"))
            .and_then(|v| v.as_str())
        {
            s.push_str(t);
        }
    }
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[derive(serde::Deserialize)]
struct NotionQueryResponse {
    results: Vec<NotionPage>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(serde::Deserialize)]
struct NotionPage {
    /// Untyped so we tolerate whatever property shapes the database has.
    #[serde(default)]
    properties: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(props: serde_json::Value) -> NotionPage {
        NotionPage { properties: props }
    }

    #[test]
    fn extracts_email_from_title_property() {
        let p = page(json!({
            "Email": { "title": [{ "plain_text": "Jane@Example.com  " }] },
            "Source": { "select": { "name": "website" } }
        }));
        assert_eq!(extract_email(&p).as_deref(), Some("jane@example.com"));
    }

    #[test]
    fn extracts_email_from_email_typed_property() {
        let p = page(json!({
            "Contact": { "email": "foo@bar.io" }
        }));
        assert_eq!(extract_email(&p).as_deref(), Some("foo@bar.io"));
    }

    #[test]
    fn rejects_rows_without_a_usable_email() {
        assert_eq!(extract_email(&page(json!({ "Email": { "title": [] } }))), None);
        assert_eq!(
            extract_email(&page(json!({ "Email": { "title": [{ "plain_text": "not-an-email" }] } }))),
            None
        );
        assert_eq!(extract_email(&page(json!({}))), None);
    }
}
