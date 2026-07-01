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
    Extension(UserId(_user_id)): Extension<UserId>,
    Query(q): Query<GlobalQuery>,
) -> Result<Json<Vec<LeaderboardRow>>, StatusCode> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);
    state
        .db
        .leaderboard_global(limit, offset)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
