//! Progress sync endpoints.
//!
//! Bidirectional sync semantics:
//! - GET returns every completion the API knows about for this user.
//!   The client merges into its local SQLite (keeping whichever
//!   `completed_at` is newer per (course_id, lesson_id) key).
//! - PUT accepts the full local list and upserts; the SQL helper
//!   already keeps the newer `completed_at` on conflict, so this is
//!   commutative across multiple devices syncing in any order.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;

use super::middleware::UserId;
use crate::db::ProgressRow;
use crate::state::AppState;
use crate::sync_bus::SyncEvent;

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<Vec<ProgressRow>>, StatusCode> {
    state
        .db
        .list_progress(&user_id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct UpsertBody {
    pub rows: Vec<ProgressRow>,
}

pub async fn upsert(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Json(body): Json<UpsertBody>,
) -> Result<StatusCode, StatusCode> {
    if body.rows.len() > 5000 {
        // Cap the bulk size so a single request can't lock the db for
        // minutes. Clients with bigger histories should chunk.
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    state
        .db
        .upsert_progress(&user_id, &body.rows)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Fan out to every other device this user has online. The
    // upsert helper doesn't return the diffed-applied set (progress
    // already merges via SQL `MAX`), so we forward the incoming rows
    // verbatim — receivers idempotently fold them into their local
    // store keyed by (course, lesson) so a no-op echo is harmless.
    if !body.rows.is_empty() {
        state
            .sync_bus
            .publish(&user_id, SyncEvent::Progress { rows: body.rows });
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /progress — wipes every completion row for this
/// user. Triggered by the desktop "Start fresh" Settings action; the
/// client paired wipe (local SQLite / IDB + cached state) runs in
/// parallel so the local + remote views converge to empty on this
/// device.
///
/// Fans out a `progress_cleared` event with the sentinel course id
/// `"*"` (lesson_ids = None), which receivers treat as "clear
/// EVERYTHING". Without the fan-out, a connected sibling device kept
/// its rows and re-filled the server on its next bulk push —
/// resurrecting the account the user just reset.
///
/// Idempotent: rerunning when there are no rows returns 204 cleanly.
pub async fn clear(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .clear_progress(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.sync_bus.publish(
        &user_id,
        SyncEvent::ProgressCleared {
            course_id: "*".to_string(),
            lesson_ids: None,
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Optional body for `DELETE /progress/:course_id`. Empty body (the
/// common case) wipes the whole course; supplying `lesson_ids` narrows
/// the wipe to those specific lessons so the sidebar's chapter-reset
/// + single-lesson "mark incomplete" affordances can share the same
/// endpoint instead of needing a separate route.
#[derive(Deserialize, Default)]
pub struct ClearScopeBody {
    #[serde(default)]
    pub lesson_ids: Option<Vec<String>>,
}

/// `DELETE /progress/:course_id` — per-course / per-lesson wipe.
/// Without this, the desktop "Reset progress" flow only cleared the
/// local SQLite + IDB store, leaving the relay's row intact. The next
/// pull / WS event then echoed the row back and undid the reset.
///
/// Body shape:
///   - empty → wipe every row for (user, course_id)
///   - { "lesson_ids": ["a","b"] } → wipe only those lesson rows
///
/// Fans out a `progress_cleared` SyncEvent to every other live socket
/// the user has open. Receivers drop matching rows from their in-
/// memory state so a sibling device that was mid-pull doesn't push
/// the cleared rows back up on its next debounced flush.
pub async fn clear_course(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Path(course_id): Path<String>,
    body: Option<Json<ClearScopeBody>>,
) -> Result<StatusCode, StatusCode> {
    let scoped_lessons = body.and_then(|Json(b)| b.lesson_ids);

    match &scoped_lessons {
        Some(ids) if !ids.is_empty() => {
            state
                .db
                .clear_progress_lessons(&user_id, &course_id, ids)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        _ => {
            state
                .db
                .clear_progress_course(&user_id, &course_id)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    // Always publish, even when zero rows were removed. The receiving
    // device might still have the in-memory row from a prior push that
    // hasn't been flushed back to its local store yet — the event
    // tells it to drop it, idempotently. Fan-out cost is negligible.
    state.sync_bus.publish(
        &user_id,
        SyncEvent::ProgressCleared {
            course_id,
            lesson_ids: scoped_lessons,
        },
    );

    Ok(StatusCode::NO_CONTENT)
}
