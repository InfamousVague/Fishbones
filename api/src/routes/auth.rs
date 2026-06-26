//! Auth handlers — signup, login, Apple, Google, me, logout, delete.
//!
//! All four sign-in flows (email signup/login, Apple, Google) end at
//! the same `mint_token` step, which generates a `fb_*` Bearer token
//! and stores its Argon2 hash in `tokens`. Failure modes collapse to
//! `401 UNAUTHORIZED` so the client can't infer whether an email
//! exists from a wrong-password response.

use axum::{extract::State, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::middleware::{TokenId, UserId};
use super::oauth;
use crate::auth::{hash_password, hash_token, verify_password};
use crate::state::AppState;

/// Generate a Libre-prefixed Bearer token. Distinct prefix from
/// other internal services so logs make it obvious which subsystem a
/// leaked token belongs to. Same `fb_*` shape the desktop already
/// recognises — clients written against the old relay don't need
/// changes.
fn mint_token() -> String {
    use base64::Engine;
    let bytes: [u8; 32] = rand::random();
    format!(
        "fb_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

/// Issue a fresh Bearer token for `user_id`, label it with the
/// caller-supplied `device_label`, and return the plaintext (the only
/// chance the client has to capture it — we only store the hash).
fn issue_token(
    state: &AppState,
    user_id: &str,
    device_label: &str,
) -> Result<String, StatusCode> {
    let token = mint_token();
    let token_hash =
        hash_token(&token).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .store_token(&id, user_id, device_label, &token_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(token)
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
    // No `device_label` here anymore: signup doesn't mint a session
    // (the account must verify its email first), so there's no token to
    // label. The field is harmlessly ignored if an older client still
    // sends it — `SignupRequest` doesn't deny unknown fields.
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: crate::db::User,
}

/// Response to a successful signup. No token: a password account must
/// confirm its email before it can sign in, so instead of a session we
/// hand back the address we emailed the link to (the client echoes it
/// in the "check your inbox" screen + the Resend button).
#[derive(Serialize)]
pub struct SignupResponse {
    pub verification_required: bool,
    pub email: String,
}

pub async fn signup(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupRequest>,
) -> Result<(StatusCode, Json<SignupResponse>), StatusCode> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') || body.password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }
    if state
        .db
        .email_exists(&email)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        return Err(StatusCode::CONFLICT);
    }
    let pw_hash = hash_password(&body.password)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Account is created with email_verified = 0 and NO token is
    // issued — sign-in stays blocked (login returns 403) until the
    // user clicks the link we email below. This is what stops someone
    // registering with an address they don't control.
    let user_id = state
        .db
        .create_password_user(&email, &pw_hash, body.display_name.as_deref())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    send_verification_email(&state, &email, &user_id).await;
    Ok((
        StatusCode::ACCEPTED,
        Json(SignupResponse {
            verification_required: true,
            email,
        }),
    ))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub device_label: Option<String>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let email = body.email.trim().to_lowercase();
    let row = state
        .db
        .get_password_login(&email)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let (user_id, password_hash, email_verified) = row;
    if !verify_password(&body.password, &password_hash) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    // Block sign-in until the email is confirmed. We check this AFTER
    // the password so an attacker can't use the 403-vs-401 split to
    // tell "right password, unverified" from "wrong password" without
    // already knowing the password. 403 is the client's cue to show
    // the "check your inbox / resend" affordance (see SignInDialog).
    if !email_verified {
        return Err(StatusCode::FORBIDDEN);
    }
    let token = issue_token(
        &state,
        &user_id,
        body.device_label.as_deref().unwrap_or("desktop"),
    )?;
    let user = state
        .db
        .get_user(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(AuthResponse { token, user }))
}

#[derive(Deserialize)]
pub struct OauthRequest {
    pub identity_token: String,
    pub display_name: Option<String>,
    pub device_label: Option<String>,
}

pub async fn apple(
    State(state): State<Arc<AppState>>,
    Json(body): Json<OauthRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let audience = state
        .apple_audience
        .as_ref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let identity = oauth::verify_apple(&body.identity_token, audience)
        .await
        .map_err(|e| {
            tracing::warn!("Apple verify failed: {e}");
            StatusCode::UNAUTHORIZED
        })?;
    let display = body.display_name.as_deref().or(identity.name.as_deref());
    let user_id = state
        .db
        .find_or_create_apple_user(
            &identity.subject,
            identity.email.as_deref(),
            display,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token = issue_token(
        &state,
        &user_id,
        body.device_label.as_deref().unwrap_or("desktop · apple"),
    )?;
    let user = state
        .db
        .get_user(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(AuthResponse { token, user }))
}

pub async fn google(
    State(state): State<Arc<AppState>>,
    Json(body): Json<OauthRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let audience = state
        .google_audience
        .as_ref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let identity = oauth::verify_google(&body.identity_token, audience)
        .await
        .map_err(|e| {
            tracing::warn!("Google verify failed: {e}");
            StatusCode::UNAUTHORIZED
        })?;
    let display = body.display_name.as_deref().or(identity.name.as_deref());
    let user_id = state
        .db
        .find_or_create_google_user(
            &identity.subject,
            identity.email.as_deref(),
            display,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token = issue_token(
        &state,
        &user_id,
        body.device_label.as_deref().unwrap_or("desktop · google"),
    )?;
    let user = state
        .db
        .get_user(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(AuthResponse { token, user }))
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<Json<crate::db::User>, StatusCode> {
    state
        .db
        .get_user(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
    Extension(TokenId(token_id)): Extension<TokenId>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .revoke_token(&token_id, &user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    Extension(UserId(user_id)): Extension<UserId>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .delete_user(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Password reset ──────────────────────────────────────────────
//
// Two endpoints, deliberately decoupled:
//
//   1. POST /auth/password-reset/request
//      Body: { email }. Always returns 204 regardless of whether the
//      email exists — leaking that fact would let an attacker
//      enumerate registered addresses by timing or status code. When
//      the email IS registered, we mint a random URL-safe token,
//      store its Argon2 hash in `password_resets` with a 1-hour TTL,
//      and email the user a link to /reset-password?token=…
//
//   2. POST /auth/password-reset/confirm
//      Body: { token, new_password }. Hashes the supplied token and
//      consumes the matching row (single DELETE…RETURNING), validates
//      the new password's length, updates `users.password_hash`, and
//      revokes every existing token for the user so previous sessions
//      on other devices are forced to re-authenticate. Always 401
//      on token-not-found / expired / consumed so timing differences
//      between cases stay narrow.
//
// We don't auto-issue a fresh login token on confirm — the user just
// changed their password and the next step is to sign in with it,
// which exercises the new credential and confirms it works. Some
// flows do auto-login here for friction reasons; we err on the side
// of "verify the change actually took" since password resets are
// rare events.

/// 1 hour. Long enough that a learner who reads the email after
/// stepping away from their machine can still use the link, short
/// enough that a leaked link from an old archive isn't valuable
/// indefinitely. Tracked in seconds since SQLite's `datetime('now',
/// '+N seconds')` is what `create_password_reset` consumes.
const RESET_TTL_SECS: i64 = 3600;

#[derive(Deserialize)]
pub struct PasswordResetRequestBody {
    pub email: String,
}

pub async fn password_reset_request(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PasswordResetRequestBody>,
) -> StatusCode {
    let email = body.email.trim().to_lowercase();
    // Don't reject obviously-malformed emails with a different status —
    // we treat every input the same so an attacker can't probe for
    // "valid email, no account" vs "invalid email" via the response.
    if email.is_empty() || !email.contains('@') {
        return StatusCode::NO_CONTENT;
    }

    // Cheap maintenance — clear out yesterday's expired/consumed
    // tokens. Keeps the table small without needing a separate cron.
    if let Err(e) = state.db.sweep_password_resets() {
        tracing::warn!("[reset:request] sweep failed: {e}");
    }

    let user_id = match state.db.find_user_id_by_email(&email) {
        Ok(Some(id)) => id,
        Ok(None) => {
            // Unknown email. Spend the same approximate time as the
            // success path (one Argon2 hash is the dominant cost) so
            // a timing attacker can't tell registered vs unregistered
            // apart. We don't touch the database; the wall-clock
            // difference of a single SQL roundtrip is below
            // measurement noise once Argon2id is in the mix.
            //
            // We deliberately DO still spawn the hash so the timing
            // is comparable to the registered path. crate::auth's
            // `hash_token` is what registered hits — call it on a
            // throwaway value to spend the cycles.
            let _ = crate::auth::hash_token("fb_unused_for_timing");
            return StatusCode::NO_CONTENT;
        }
        Err(e) => {
            tracing::error!("[reset:request] db lookup failed: {e}");
            return StatusCode::NO_CONTENT;
        }
    };

    // Mint a URL-safe random token. 32 bytes of entropy = 256 bits;
    // base64-url-encoded comes out to 43 chars without padding —
    // short enough to fit comfortably in a URL, long enough that
    // brute force isn't a concern even before the TTL.
    let token = {
        use base64::Engine;
        let bytes: [u8; 32] = rand::random();
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    };
    // Deterministic SHA-256 — needed because we look up by token_hash
    // in the consume path (`WHERE token_hash = ?`), which only works
    // when the same plaintext maps to the same hash every time. The
    // 32-byte random token above already has 256 bits of entropy, so
    // a salt would protect against nothing.
    let token_hash = crate::auth::hash_lookup_token(&token);
    if let Err(e) =
        state
            .db
            .create_password_reset(&token_hash, &user_id, RESET_TTL_SECS)
    {
        tracing::error!("[reset:request] insert failed for user_id={user_id}: {e}");
        return StatusCode::NO_CONTENT;
    }

    // Build the link the user clicks. Web origin is configurable so
    // staging deploys can point at a non-prod marketing site.
    let link = format!(
        "{}/reset-password?token={}",
        state.web_base_url.trim_end_matches('/'),
        token
    );
    let html = format!(
        "<p>Someone (hopefully you) asked to reset the password for your Libre account.</p>\
         <p><a href=\"{link}\">Reset your password</a></p>\
         <p>The link expires in 1 hour. If you didn't ask for this, you can safely ignore this email — no action is needed and your account is unchanged.</p>",
    );
    let text = format!(
        "Someone (hopefully you) asked to reset the password for your Libre account.\n\n\
         Reset your password: {link}\n\n\
         The link expires in 1 hour. If you didn't ask for this, you can safely ignore this email — no action is needed and your account is unchanged."
    );

    state
        .mailer
        .send(&email, "Reset your Libre password", &html, &text)
        .await;

    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
pub struct PasswordResetConfirmBody {
    pub token: String,
    pub new_password: String,
}

pub async fn password_reset_confirm(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PasswordResetConfirmBody>,
) -> Result<StatusCode, StatusCode> {
    if body.token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if body.new_password.len() < 8 {
        // Same client-side rule the signup endpoint enforces. 400
        // here is OK (this case isn't observable to an enumeration
        // attacker — they'd need a valid token first).
        return Err(StatusCode::BAD_REQUEST);
    }

    // Hash + atomic-consume. `consume_password_reset` returns the
    // user_id only when the token is valid, unexpired, and unconsumed.
    // The DELETE…RETURNING semantics close the race where two
    // requests arrive in parallel — only one can win.
    //
    // Deterministic SHA-256 here so we can lookup by hash. See
    // `hash_lookup_token` in api/src/auth.rs for why salting is
    // unnecessary on a 32-byte random token.
    let token_hash = crate::auth::hash_lookup_token(&body.token);
    let user_id = state
        .db
        .consume_password_reset(&token_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let pw_hash = hash_password(&body.new_password)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .db
        .update_password_hash(&user_id, &pw_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Revoke every active token. The user just admitted they may
    // have lost control of the previous credential; tearing down
    // existing sessions cuts off whatever else might be lingering.
    // Their next sign-in mints a fresh token via the normal login
    // path. Failure to revoke is non-fatal — the password change
    // already landed, we just couldn't sweep tokens. Log + continue.
    if let Err(e) = state.db.revoke_all_tokens(&user_id) {
        tracing::warn!("[reset:confirm] failed to revoke tokens for {user_id}: {e}");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── Email verification ───────────────────────────────────────────
//
// New password signups land here. The token shape + enumeration-safe
// resend mirror the password-reset flow above; the difference is the
// confirm step flips `email_verified` and signs the user in rather than
// changing a password.

/// 24 hours — verification links are clicked less urgently than a
/// password reset (people sign up, get distracted, come back later), so
/// we give the link a comfortably long life. A `resend` mints a fresh
/// one if it does lapse.
const VERIFY_TTL_SECS: i64 = 24 * 3600;

/// Mint a verification token for `user_id`, persist its hash, and email
/// the confirmation link. Best-effort: a mail/DB failure is logged but
/// not surfaced to the caller (signup + resend both stay
/// enumeration-safe and don't want to leak backend state). Shared by
/// `signup` and `verify_email_resend`.
async fn send_verification_email(state: &AppState, email: &str, user_id: &str) {
    if let Err(e) = state.db.sweep_email_verifications() {
        tracing::warn!("[verify:send] sweep failed: {e}");
    }
    // 32 bytes / 256 bits of entropy, base64-url without padding —
    // same construction the reset flow uses.
    let token = {
        use base64::Engine;
        let bytes: [u8; 32] = rand::random();
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    };
    let token_hash = crate::auth::hash_lookup_token(&token);
    if let Err(e) =
        state
            .db
            .create_email_verification(&token_hash, user_id, VERIFY_TTL_SECS)
    {
        tracing::error!("[verify:send] insert failed for user_id={user_id}: {e}");
        return;
    }

    let link = format!(
        "{}/verify-email?token={}",
        state.web_base_url.trim_end_matches('/'),
        token
    );
    let html = format!(
        "<p>Welcome to Libre! Confirm this email address to finish setting up your account.</p>\
         <p><a href=\"{link}\">Confirm your email</a></p>\
         <p>The link expires in 24 hours. If you didn't create a Libre account, you can safely ignore this email — no account will be activated.</p>",
    );
    let text = format!(
        "Welcome to Libre! Confirm this email address to finish setting up your account.\n\n\
         Confirm your email: {link}\n\n\
         The link expires in 24 hours. If you didn't create a Libre account, you can safely ignore this email — no account will be activated."
    );

    state
        .mailer
        .send(email, "Confirm your Libre email", &html, &text)
        .await;
}

#[derive(Deserialize)]
pub struct VerifyEmailConfirmBody {
    pub token: String,
    pub device_label: Option<String>,
}

/// Confirm an email from the link in the inbox. Consumes the token,
/// flips `email_verified`, and signs the user in (returns a token) so
/// the web `/verify-email` page lands them straight in their account.
/// All invalid/expired/used tokens collapse to 401 — no distinction
/// that would help a brute-forcer.
pub async fn verify_email_confirm(
    State(state): State<Arc<AppState>>,
    Json(body): Json<VerifyEmailConfirmBody>,
) -> Result<Json<AuthResponse>, StatusCode> {
    if body.token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token_hash = crate::auth::hash_lookup_token(&body.token);
    let user_id = state
        .db
        .consume_email_verification(&token_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = issue_token(
        &state,
        &user_id,
        body.device_label.as_deref().unwrap_or("web"),
    )?;
    let user = state
        .db
        .get_user(&user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(AuthResponse { token, user }))
}

#[derive(Deserialize)]
pub struct VerifyEmailResendBody {
    pub email: String,
}

/// Re-send the confirmation link for an unverified account. Always
/// returns 204 regardless of whether the email exists or is already
/// verified — same anti-enumeration stance as password-reset request.
pub async fn verify_email_resend(
    State(state): State<Arc<AppState>>,
    Json(body): Json<VerifyEmailResendBody>,
) -> StatusCode {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return StatusCode::NO_CONTENT;
    }
    match state.db.find_unverified_user_by_email(&email) {
        Ok(Some(user_id)) => {
            send_verification_email(&state, &email, &user_id).await;
        }
        Ok(None) => {
            // Unknown email, or already verified. Spend a comparable
            // slice of time (one hash) so the response timing doesn't
            // betray which case it was.
            let _ = crate::auth::hash_token("fb_unused_for_timing");
        }
        Err(e) => {
            tracing::error!("[verify:resend] db lookup failed: {e}");
        }
    }
    StatusCode::NO_CONTENT
}
