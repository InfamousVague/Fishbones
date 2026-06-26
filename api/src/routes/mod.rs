//! Top-level router.
//!
//! Every product endpoint mounts at the bare root — the host itself
//! (`api.libre.academy`) is already scoped to this product, so adding
//! a `/libre/` path prefix would be redundant. Public endpoints
//! (signup, login, OAuth start/callback, public course feed) and
//! protected endpoints (everything that needs a bearer token) are
//! defined as inner routers and merged-mounted once. `/health` and
//! Apple's `.well-known` file are uptime/domain-verification paths
//! that have always lived at the root.
//!
//! Endpoint summary:
//!   POST   /auth/signup                    — email + password
//!   POST   /auth/login                     — email + password
//!   POST   /auth/password-reset/request    — email link
//!   POST   /auth/password-reset/confirm    — token + new password
//!   POST   /auth/apple                     — Apple identity_token
//!   POST   /auth/google                    — Google id_token
//!   GET    /auth/google/start              — browser OAuth
//!   GET    /auth/google/callback           — provider redirect
//!   GET    /auth/apple/start               — browser OAuth
//!   POST   /auth/apple/callback            — provider form_post
//!   GET    /auth/apple/callback            —   (also tolerated)
//!   GET    /me                             — current user
//!   POST   /auth/logout                    — revoke this device
//!   DELETE /auth/account                   — delete account
//!   GET    /progress                       — full dump
//!   PUT    /progress                       — bulk upsert
//!   DELETE /progress                       — wipe (Reset account)
//!   GET    /solutions                      — full dump
//!   PUT    /solutions                      — bulk upsert (LWW)
//!   GET    /settings                       — full dump
//!   PUT    /settings                       — bulk upsert (LWW)
//!   GET    /sync/ws?token=…                — realtime fan-out
//!   POST   /courses                        — upload .libre
//!   GET    /courses                        — own courses
//!   GET    /courses/public                 — public feed
//!   GET    /courses/:id                    — download archive
//!   DELETE /courses/:id                    — delete
//!   GET    /health                         — liveness
//!   GET    /.well-known/apple-developer-domain-association.txt

mod auth;
mod courses;
mod middleware;
mod oauth;
mod oauth_flow;
mod progress;
mod sync;
mod well_known;

pub use middleware::auth_middleware;

use axum::{
    middleware as axum_middleware,
    routing::{delete, get, post},
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::state::AppState;

/// Build the full router. CORS is permissive — Caddy is the only thing
/// in front of us and the desktop / web clients cross-origin against
/// this server, so blocking origins here would just create false
/// negatives.
pub fn build_router(state: Arc<AppState>) -> Router {
    // Public + protected route groups defined ONCE under a relative
    // prefix-less layout (`/auth/signup`, `/me`, `/progress` etc.),
    // then merged into the root router. The host itself
    // (`api.libre.academy`) already namespaces these to this product,
    // so adding a `/libre` path prefix would just repeat the host.
    //
    // The /health route + /.well-known/apple-developer-domain-
    // association.txt also live at the literal root — `/health` is
    // the uptime monitor's path and Apple fetches the well-known
    // path verbatim.
    let public_endpoints = || {
        Router::new()
            .route("/auth/signup", post(auth::signup))
            .route("/auth/login", post(auth::login))
            // Password-reset request + confirm. Both endpoints are
            // unauthenticated — the request endpoint is gated by email
            // ownership (you only get the token if you can read the
            // inbox), the confirm endpoint by possession of that token.
            // The request handler always returns 204 regardless of
            // whether the email is registered, to avoid enumeration.
            .route(
                "/auth/password-reset/request",
                post(auth::password_reset_request),
            )
            .route(
                "/auth/password-reset/confirm",
                post(auth::password_reset_confirm),
            )
            // Email verification. `confirm` consumes the link from the
            // signup email (and signs the user in); `resend` re-mints a
            // link for an unverified account. Both unauthenticated and
            // enumeration-safe, mirroring the password-reset pair above.
            .route(
                "/auth/verify-email/confirm",
                post(auth::verify_email_confirm),
            )
            .route(
                "/auth/verify-email/resend",
                post(auth::verify_email_resend),
            )
            // Direct id_token paths — clients call these when they have a
            // native-SDK token in hand.
            .route("/auth/apple", post(auth::apple))
            .route("/auth/google", post(auth::google))
            // Browser-OAuth start endpoints. Desktop opens these in the
            // system browser; the `start` redirects to the provider, the
            // provider redirects back to `callback`, and the callback
            // redirects into `libre://oauth/done?token=…`.
            .route("/auth/google/start", get(oauth_flow::google_start))
            .route(
                "/auth/google/callback",
                get(oauth_flow::google_callback),
            )
            .route("/auth/apple/start", get(oauth_flow::apple_start))
            // Apple uses `response_mode=form_post`; tolerate GET too for
            // dev-mode hand-built URLs.
            .route(
                "/auth/apple/callback",
                post(oauth_flow::apple_callback_post).get(oauth_flow::apple_callback_get),
            )
            .route("/courses/public", get(courses::list_public))
            // Real-time sync WebSocket. Auth lives in the `?token=…`
            // query param (browsers can't set headers on a WS upgrade)
            // so this route stays in the public group; the handler
            // verifies the bearer before completing the upgrade.
            .route("/sync/ws", get(sync::ws_upgrade))
    };

    let protected_endpoints = || {
        Router::new()
            .route("/me", get(auth::me))
            .route("/auth/logout", post(auth::logout))
            .route("/auth/account", delete(auth::delete_account))
            .route(
                "/progress",
                get(progress::list)
                    .put(progress::upsert)
                    .delete(progress::clear),
            )
            // Per-course / per-lesson wipe. Body is optional; empty
            // body = whole course, `{ "lesson_ids": [...] }` = scoped.
            // Fans out a `progress_cleared` SyncEvent so other live
            // sockets converge to the reset state.
            .route("/progress/:course_id", delete(progress::clear_course))
            .route(
                "/solutions",
                get(sync::list_solutions).put(sync::upsert_solutions),
            )
            .route(
                "/settings",
                get(sync::list_settings).put(sync::upsert_settings),
            )
            .route(
                "/courses",
                get(courses::list_mine).post(courses::upload),
            )
            .route(
                "/courses/:id",
                get(courses::download).delete(courses::delete_course),
            )
            .route_layer(axum_middleware::from_fn_with_state(
                state.clone(),
                auth_middleware,
            ))
    };

    let root = Router::new()
        .route("/health", get(health_check))
        .route(
            "/.well-known/apple-developer-domain-association.txt",
            get(well_known::apple_domain_association),
        );

    root
        .merge(public_endpoints())
        .merge(protected_endpoints())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// GET /health — public liveness endpoint. Same shape as Tap's so any
/// existing uptime-monitor wiring keeps working.
async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "relay": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
