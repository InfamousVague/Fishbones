//! Real-time sync endpoints.
//!
//! Three HTTP write paths (progress / solutions / settings) plus a
//! WebSocket fan-out that mirrors writes to every other connected
//! device for the same user. Payloads are JSON; conflict resolution
//! is last-writer-wins by `updated_at` per (course, lesson) or
//! (user, key).
//!
//! Auth on the WebSocket: browsers can't set headers when calling
//! `new WebSocket(url)`, so the token rides as a `?token=…` query
//! parameter. We verify it inside the upgrade handler before
//! upgrading the connection. This is fine because TLS protects the
//! query string in transit, and the relay doesn't log query strings
//! by default (Caddy logs status lines, not full URIs).

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

use super::middleware::UserId;
use crate::db::{SettingRow, SolutionRow};
use crate::state::AppState;
use crate::sync_bus::SyncEvent;

// ── Solutions ─────────────────────────────────────────────────

pub async fn list_solutions(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<Vec<SolutionRow>>, StatusCode> {
    state
        .db
        .list_solutions(&user_id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct UpsertSolutionsBody {
    pub rows: Vec<SolutionRow>,
}

pub async fn upsert_solutions(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Json(body): Json<UpsertSolutionsBody>,
) -> Result<StatusCode, StatusCode> {
    if body.rows.len() > 5000 {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let applied = state
        .db
        .upsert_solutions(&user_id, &body.rows)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !applied.is_empty() {
        state
            .sync_bus
            .publish(&user_id, SyncEvent::Solutions { rows: applied });
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── Settings ──────────────────────────────────────────────────

pub async fn list_settings(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<Vec<SettingRow>>, StatusCode> {
    state
        .db
        .list_settings(&user_id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct UpsertSettingsBody {
    pub rows: Vec<SettingRow>,
}

pub async fn upsert_settings(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Json(body): Json<UpsertSettingsBody>,
) -> Result<StatusCode, StatusCode> {
    if body.rows.len() > 1000 {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let applied = state
        .db
        .upsert_settings(&user_id, &body.rows)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !applied.is_empty() {
        state
            .sync_bus
            .publish(&user_id, SyncEvent::Settings { rows: applied });
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── WebSocket ─────────────────────────────────────────────────

/// Query string for the WS upgrade. Only `token` is consumed; we
/// allow extra params so a future client (e.g. one that wants to
/// resume from a sequence number) can pass them without breaking
/// the strict parser.
#[derive(Deserialize)]
pub struct WsAuth {
    pub token: String,
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(auth): Query<WsAuth>,
) -> impl IntoResponse {
    let user_id = match state.db.verify_bearer(&auth.token) {
        Ok(Some(uid)) => uid,
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
        .into_response()
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, user_id: String) {
    let (mut sink, mut stream) = socket.split();
    let mut rx = state.sync_bus.subscribe(&user_id);

    // Send a small hello so the client knows the auth+subscribe
    // succeeded before its first event arrives. Useful for the
    // client's "reconnect once we get a hello" backoff.
    let _ = sink
        .send(Message::Text(
            serde_json::json!({"type": "hello"}).to_string(),
        ))
        .await;

    let mut ping_interval = tokio::time::interval(Duration::from_secs(25));
    ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Skip the first immediate tick; we just sent hello.
    ping_interval.tick().await;

    loop {
        tokio::select! {
            // Drain broadcast events to the client
            event = rx.recv() => {
                match event {
                    Ok(ev) => {
                        let payload = match serde_json::to_string(&ev) {
                            Ok(p) => p,
                            Err(_) => continue,
                        };
                        if sink.send(Message::Text(payload)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Tell the client to re-pull. Cheaper than
                        // shipping every backlogged event when a slow
                        // network falls behind the buffer.
                        let _ = sink
                            .send(Message::Text(
                                serde_json::json!({"type": "resync"}).to_string(),
                            ))
                            .await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            // Periodic ping so idle proxies don't hang up. Caddy's
            // default reverse-proxy idle timeout is 60s — we ping
            // every 25 with plenty of headroom.
            _ = ping_interval.tick() => {
                if sink.send(Message::Ping(vec![])).await.is_err() {
                    break;
                }
            }
            // Read inbound — pong or close. We don't accept client-
            // pushed edits over the WS (use the HTTP endpoints); the
            // socket is purely a server→client channel.
            inbound = stream.next() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(p))) => {
                        let _ = sink.send(Message::Pong(p)).await;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
