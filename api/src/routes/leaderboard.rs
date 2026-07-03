//! Leaderboard endpoints — friends + global rankings.
//!
//! Both handlers return the same flat `LeaderboardRow` shape (rank +
//! user id + display name + inlined stat counters). Mounted on the
//! authed router, so `UserId` is always present.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;

use super::middleware::UserId;
use crate::db::LeaderboardRow;
use crate::state::AppState;

// ── GET /leaderboard/friends?metric=xp|streak|lessons ─────────────

#[derive(Deserialize)]
pub struct FriendsQuery {
    /// One of `xp` (default), `streak`, `lessons`. Anything else falls
    /// back to XP inside the DB layer's whitelist map.
    pub metric: Option<String>,
}

/// Rank the caller + their accepted friends by the chosen metric,
/// descending. Defaults to XP when `metric` is absent or unrecognized.
pub async fn friends(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Query(q): Query<FriendsQuery>,
) -> Result<Json<Vec<LeaderboardRow>>, StatusCode> {
    let metric = q.metric.as_deref().unwrap_or("xp");
    state
        .db
        .leaderboard_friends(&user_id, metric)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

// ── GET /leaderboard/global?limit&offset ──────────────────────────

#[derive(Deserialize)]
pub struct GlobalQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Default page size for the global board when the client doesn't
/// specify one.
const DEFAULT_LIMIT: i64 = 50;
/// Hard cap so a client can't ask for the entire table in one request.
const MAX_LIMIT: i64 = 200;

/// Global top users by total XP, paginated. `limit` is clamped to
/// [1, 200]; `offset` floors at 0. Ranks are absolute (offset-aware).
pub async fn global(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Query(q): Query<GlobalQuery>,
) -> Result<Json<Vec<LeaderboardRow>>, StatusCode> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);
    let mut rows = state
        .db
        .leaderboard_global(limit, offset)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Pin the caller's OWN row onto the first page when they're not
    // already in it — so a signed-in learner always sees their row +
    // chosen name even when ranked below the top-N cut. Only on
    // offset 0 (the "self" row belongs with the head of the board,
    // not repeated on every paginated slice).
    if offset == 0 && !rows.iter().any(|r| r.user_id == user_id) {
        if let Ok(Some(self_row)) = state.db.leaderboard_self_row(&user_id) {
            rows.push(self_row);
        }
    }
    Ok(Json(rows))
}

// ── GET/PUT /leaderboard/name — the caller's public leaderboard identity ──

#[derive(serde::Serialize)]
pub struct NameResponse {
    /// What the global board currently shows for this user — the claimed
    /// name, or the deterministic pseudonym when unclaimed.
    pub name: String,
    pub claimed: bool,
}

/// The viewer's own leaderboard identity. Drives the "claim your spot"
/// prompt: `claimed: false` → the client offers the claim flow.
pub async fn get_name(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<NameResponse>, StatusCode> {
    state
        .db
        .leaderboard_name(&user_id)
        .map(|(name, claimed)| Json(NameResponse { name, claimed }))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct SetNameBody {
    pub name: String,
}

#[derive(serde::Serialize)]
pub struct NameError {
    /// One of `invalid_length` | `invalid_chars` | `profanity` —
    /// mirrored by the client's validator for instant feedback.
    pub error: &'static str,
}

/// Claim / update the leaderboard name. Server-side validation is the
/// enforcement layer (the client mirrors it only for UX): 3–24 chars,
/// [A-Za-z0-9 _-], no leading/trailing space, basic profanity filter.
pub async fn set_name(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Json(body): Json<SetNameBody>,
) -> Result<StatusCode, (StatusCode, Json<NameError>)> {
    if let Err(code) = crate::alias::validate_name(&body.name) {
        return Err((StatusCode::BAD_REQUEST, Json(NameError { error: code })));
    }
    match state.db.set_leaderboard_name(&user_id, &body.name) {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        // Name already claimed by another account (case-insensitive) —
        // 409 so the UI can prompt for a different handle.
        Ok(false) => Err((StatusCode::CONFLICT, Json(NameError { error: "name_taken" }))),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(NameError { error: "internal" }),
        )),
    }
}
