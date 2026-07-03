//! Libre API — entry point.
//!
//! Startup sequence:
//!   1. Load .env (best-effort; production deploys that pass env vars
//!      directly via systemd EnvironmentFile aren't broken by a
//!      missing file).
//!   2. Init tracing.
//!   3. Read provider config from env. Empty values are treated as
//!      unset so a half-configured deploy surfaces 503s on the
//!      relevant routes instead of silently failing closed.
//!   4. Open SQLite + run migrations.
//!   5. Build router, bind, serve.
//!
//! Everything but the env loading runs on the tokio runtime; the
//! initial `dotenvy::dotenv()` is sync so its failure mode (file
//! missing) doesn't even surface as a tracing line.

mod alias;
mod auth;
mod db;
mod mailer;
mod routes;
mod state;
mod sync_bus;

use std::path::PathBuf;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

use crate::db::Database;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Best-effort .env loading — walks up from cwd, silently ignores
    // a missing file. Production reads env from systemd's
    // EnvironmentFile=, dev reads it from the .env in this crate.
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("libre_api=info".parse()?),
        )
        .init();

    tracing::info!("Starting Libre API v{}", env!("CARGO_PKG_VERSION"));

    // ── Provider config ─────────────────────────────────────────
    // Empty strings are treated as unset so an env file with a
    // half-edited line (`APPLE_CLIENT_ID=`) doesn't accidentally pass
    // an empty audience into the JWT validator.
    let apple_audience = read_env("APPLE_CLIENT_ID");
    let google_audience = read_env("GOOGLE_CLIENT_ID");

    if apple_audience.is_none() {
        tracing::info!("Apple sign-in disabled (APPLE_CLIENT_ID unset)");
    } else {
        tracing::info!("Apple sign-in enabled");
    }
    if google_audience.is_none() {
        tracing::info!("Google sign-in disabled (GOOGLE_CLIENT_ID unset)");
    } else {
        tracing::info!("Google sign-in enabled");
    }

    let google_client_secret = read_env("GOOGLE_CLIENT_SECRET");
    let apple_team_id = read_env("APPLE_TEAM_ID");
    let apple_key_id = read_env("APPLE_KEY_ID");
    // Apple's .p8 content is multi-line; supporting both an inline
    // env var (for ephemeral container deploys) and a file path (for
    // bind-mounted secret stores) keeps every deploy shape happy.
    let apple_private_key_pem = read_env("APPLE_PRIVATE_KEY_PEM").or_else(|| {
        read_env("APPLE_PRIVATE_KEY_FILE")
            .and_then(|p| std::fs::read_to_string(&p).ok())
    });
    let public_url = read_env("PUBLIC_URL");
    let apple_domain_association_file = read_env("APPLE_DOMAIN_ASSOCIATION_FILE");

    // ── Feedback → Notion ───────────────────────────────────────
    // `POST /feedback` relays in-app feedback to a Notion database. The
    // token is a server-side secret; both must be set for the route to
    // work (it returns 503 otherwise).
    let notion_token = read_env("NOTION_TOKEN");
    let notion_database_id = read_env("NOTION_DATABASE_ID");
    let notion_early_access_database_id = read_env("NOTION_EARLY_ACCESS_DATABASE_ID");
    if notion_token.is_some() && notion_database_id.is_some() {
        tracing::info!("Feedback → Notion enabled");
    } else {
        tracing::info!(
            "Feedback → Notion disabled (NOTION_TOKEN / NOTION_DATABASE_ID unset)"
        );
    }
    if notion_token.is_some() && notion_early_access_database_id.is_some() {
        tracing::info!("Early-access → Notion enabled");
    } else {
        tracing::info!(
            "Early-access → Notion disabled (NOTION_TOKEN / NOTION_EARLY_ACCESS_DATABASE_ID unset)"
        );
    }

    // ── Mailer (SMTP + Resend, log fallback) ────────────────────
    // Both backends are optional and tried in order: SMTP first
    // (self-hosted Postfix or any third-party submission server),
    // then Resend, then a `tracing::warn!` fallback that prints the
    // body so the URL is recoverable from `journalctl -u libre-api`.
    // See api/src/mailer.rs for the full backend-selection logic.
    let smtp_host = read_env("SMTP_HOST");
    let smtp_port = read_env("SMTP_PORT").and_then(|s| s.parse::<u16>().ok());
    let smtp_user = read_env("SMTP_USER");
    let smtp_pass = read_env("SMTP_PASS");
    let smtp_from = read_env("SMTP_FROM");
    let smtp_from_name = read_env("SMTP_FROM_NAME");
    // STARTTLS defaults to true (sane for any external relay). Set
    // SMTP_STARTTLS=false for `localhost:25` plaintext talking to a
    // colocated Postfix — the wire never leaves loopback.
    let smtp_starttls = read_env("SMTP_STARTTLS")
        .map(|v| !matches!(v.to_lowercase().as_str(), "false" | "0" | "no"))
        .unwrap_or(true);
    let resend_api_key = read_env("RESEND_API_KEY");
    let resend_from = read_env("RESEND_FROM");
    let resend_from_name = read_env("RESEND_FROM_NAME");
    let mailer = crate::mailer::Mailer::from_env(
        smtp_host,
        smtp_port,
        smtp_user,
        smtp_pass,
        smtp_from,
        smtp_from_name,
        smtp_starttls,
        resend_api_key,
        resend_from,
        resend_from_name,
    );
    tracing::info!(
        "Mailer: active backend = {} (smtp_configured={}, resend_configured={})",
        mailer.describe_active_backend(),
        mailer.is_smtp_configured(),
        mailer.is_resend_configured(),
    );
    // Where the password-reset email's link points. Defaults to the
    // public marketing site since that's where /reset-password lives.
    let web_base_url = read_env("WEB_BASE_URL")
        .unwrap_or_else(|| "https://libre.academy".to_string());

    let oauth_flow_ready = public_url.is_some()
        && (google_client_secret.is_some() || apple_private_key_pem.is_some());
    if !oauth_flow_ready {
        tracing::info!(
            "Browser-OAuth flow disabled — needs PUBLIC_URL plus a Google client secret and/or Apple .p8 key. Direct id_token endpoints (POST /auth/{{apple,google}}) still work."
        );
    } else {
        tracing::info!("Browser-OAuth flow enabled");
    }

    // ── Database ────────────────────────────────────────────────
    let database_path = read_env("DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/var/lib/libre-api/api.sqlite"));
    let db = Database::open(&database_path)?;
    db.run_migrations()?;
    tracing::info!("Database initialized at {}", database_path.display());

    // ── Default friend (owner) ──────────────────────────────────
    // Everyone is auto-friended to the owner account so a brand-new
    // learner's leaderboard is never empty and they can always see the
    // owner's streak. Resolve (or create) that account by email, stash
    // its id on the DB handle so the new-user insert paths can seed a
    // mutual friendship, then run a one-time idempotent backfill wiring
    // up every pre-existing user. Email/name are overridable via env for
    // non-prod deploys; defaults match the production owner.
    let default_friend_email = read_env("DEFAULT_FRIEND_EMAIL")
        .unwrap_or_else(|| "infamousvaguerat@gmail.com".to_string())
        .trim()
        .to_lowercase();
    let default_friend_name =
        read_env("DEFAULT_FRIEND_NAME").unwrap_or_else(|| "Libre".to_string());
    let default_friend_id =
        db.find_or_create_default_friend(&default_friend_email, &default_friend_name)?;
    db.set_default_friend_id(&default_friend_id);
    match db.backfill_default_friendships(&default_friend_id) {
        Ok(n) => tracing::info!(
            "Default friend ({default_friend_email}) resolved; backfilled friendships for {n} existing user(s)"
        ),
        Err(e) => tracing::warn!("Default-friend backfill failed: {e}"),
    }

    // ── App state ───────────────────────────────────────────────
    let state = Arc::new(AppState {
        db,
        mailer,
        sync_bus: crate::sync_bus::SyncBus::new(),
        web_base_url,
        apple_audience,
        google_audience,
        google_client_secret,
        apple_team_id,
        apple_key_id,
        apple_private_key_pem,
        public_url,
        apple_domain_association_file,
        notion_token,
        notion_database_id,
        notion_early_access_database_id,
    });

    // ── Router ──────────────────────────────────────────────────
    let app = routes::build_router(Arc::clone(&state));

    // ── Bind + serve ────────────────────────────────────────────
    let host = read_env("HOST").unwrap_or_else(|| "127.0.0.1".to_string());
    let port = read_env("PORT")
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(9443);
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Libre API listening on {addr}");

    axum::serve(listener, app).await?;

    Ok(())
}

/// Read an env var; treat empty / whitespace-only values as unset.
/// Centralised here so every config knob applies the same heuristic.
fn read_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty())
}
