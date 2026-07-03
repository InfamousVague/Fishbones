//! Friends endpoints — stats push, friend list, requests, accept/remove.
//!
//! Every handler here is mounted on the authed router, so `UserId` is
//! always present in extensions (the bearer-token middleware injected
//! it). Errors map to plain status codes — nothing here leaks backend
//! state in a body.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;

use super::middleware::UserId;
use crate::db::{FriendRequest, FriendSummary, Relation, Stats};
use crate::state::AppState;

// ── PUT /me/stats ─────────────────────────────────────────────────

/// Upsert the caller's denormalized stats snapshot. The whole record is
/// client-computed and pushed wholesale; we just store it. 204 on
/// success.
pub async fn put_stats(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Json(stats): Json<Stats>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .upsert_stats(&user_id, &stats)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /me/stats — read back the caller's own stored snapshot. Companion
/// to `put_stats`; lets a freshly-installed device pull the last stats
/// the server saw before the local recompute finishes. Returns all-zeros
/// (never 404) when the caller has never pushed.
pub async fn get_my_stats(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<Stats>, StatusCode> {
    state
        .db
        .get_stats(&user_id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

// ── GET /friends ──────────────────────────────────────────────────

/// The caller's accepted friends (including the seeded owner) with each
/// friend's latest stats.
pub async fn list_friends(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<Vec<FriendSummary>>, StatusCode> {
    state
        .db
        .list_accepted_with_stats(&user_id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

// ── POST /friends/add ─────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddFriendBody {
    pub email: String,
}

/// Send a friend request to the account with `email`. Resolves the
/// target by email, then creates a pending `caller → target` edge.
///
///   201 — request created — OR an anti-enumeration no-op: an unknown
///         email or a self-add returns the same 201 and creates nothing,
///         so a caller can't probe which emails have accounts
///   400 — malformed email (empty / no `@`)
///   409 — already related (pending or accepted, either direction)
pub async fn add_friend(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Json(body): Json<AddFriendBody>,
) -> Result<StatusCode, StatusCode> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(StatusCode::BAD_REQUEST);
    }
    // ANTI-ENUMERATION: an email that resolves to no account returns the
    // SAME 201 a real request does (and creates nothing), so an
    // authenticated caller can't probe which emails have Libre accounts
    // by diffing 404-vs-201. Mirrors the enumeration-safe posture of the
    // password-reset / verify-email endpoints. A self-add is likewise a
    // silent no-op 201 (you already know your own email; keep the
    // response shape uniform).
    let target_id = match state
        .db
        .find_user_id_by_email(&email)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        Some(id) if id != user_id => id,
        _ => return Ok(StatusCode::CREATED),
    };
    // Pre-flight the relationship so an already-related pair 409s without
    // touching the table; `add_request` re-checks under the lock to close
    // the race, so this is a cheap fast-path, not the sole guard.
    if state
        .db
        .relation_of(&user_id, &target_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        != Relation::None
    {
        return Err(StatusCode::CONFLICT);
    }
    let existing = state
        .db
        .add_request(&user_id, &target_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    match existing {
        // No prior edge — `add_request` inserted the pending row.
        Relation::None => Ok(StatusCode::CREATED),
        // A row appeared between our pre-flight and the locked insert
        // (concurrent request); report the conflict.
        _ => Err(StatusCode::CONFLICT),
    }
}

// ── GET /friends/requests ─────────────────────────────────────────

/// Pending requests INCOMING to the caller.
pub async fn list_requests(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<Vec<FriendRequest>>, StatusCode> {
    state
        .db
        .list_incoming_requests(&user_id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

// ── POST /friends/:id/accept ──────────────────────────────────────

/// Accept the pending request that `:id` sent to the caller. Marks both
/// directed edges accepted. 404 when there's no pending request from
/// that user.
pub async fn accept_friend(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Path(from_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let accepted = state
        .db
        .accept_request(&user_id, &from_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if accepted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

// ── DELETE /friends/:id ───────────────────────────────────────────

/// Remove a friend / reject / cancel — drops every edge between the
/// caller and `:id` in both directions. Idempotent: 204 even if there
/// was nothing to remove.
pub async fn remove_friend(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Path(other_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .remove_friend(&user_id, &other_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /users/:id/profile ────────────────────────────────────────

/// A viewer-relative profile for `:id`. Email is only populated when
/// the viewer is the subject or an accepted friend; `is_friend` /
/// `friend_request_pending` reflect the caller's relationship. 404 for
/// an unknown user id.
pub async fn get_profile(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Path(subject_id): Path<String>,
) -> Result<Json<crate::db::ProfileView>, StatusCode> {
    state
        .db
        .profile(&subject_id, &user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}
