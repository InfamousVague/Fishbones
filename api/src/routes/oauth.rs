//! OAuth identity-token verifiers (Apple + Google).
//!
//! Both flows are the same idea — the client gets an `id_token` JWT
//! from the provider's native SDK, hands it to us, and we verify it by:
//!   1. Decoding the header to find the `kid`
//!   2. Fetching the provider's JWKS
//!   3. Verifying the signature against the matching key
//!   4. Confirming `iss` and `aud` claims
//!   5. Pulling out `sub` (provider-stable user id), `email`, `name`
//!
//! We use `jsonwebtoken` for the signature work — it understands
//! RSA + JWKS natively, so we don't have to roll our own RSA verify.

use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct OauthIdentity {
    /// Provider-stable user id (`sub` claim). Apple's `sub` is opaque;
    /// Google's `sub` is a numeric string.
    pub subject: String,
    pub email: Option<String>,
    pub name: Option<String>,
    /// Whether the PROVIDER asserts it has verified `email`. Gates
    /// auto-linking this identity onto an existing same-email account
    /// in `db::find_or_create_{google,apple}_user` — linking on an
    /// unverified address would be an account-takeover vector. Apple
    /// only returns verified / Apple-relay addresses so it's always
    /// true there; for Google we honor the `email_verified` claim.
    pub email_verified: bool,
}

#[derive(Debug, Deserialize)]
struct AppleClaims {
    sub: String,
    email: Option<String>,
    #[allow(dead_code)]
    iss: String,
}

#[derive(Debug, Deserialize)]
struct GoogleClaims {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    /// Google sends this as a JSON boolean. We also tolerate a
    /// stringified "true"/"false"/"1"/"0". Any other value OR type
    /// (number, array, object, null, missing) → None, which callers
    /// treat as NOT verified (fail closed) — see `de_opt_bool`.
    #[serde(default, deserialize_with = "de_opt_bool")]
    email_verified: Option<bool>,
    #[allow(dead_code)]
    iss: String,
}

/// Deserialize an optional boolean a provider might encode as a real
/// JSON bool OR a "true"/"false"/"1"/"0" string. Any other value OR
/// type — number, array, object, null, missing — maps to `None` rather
/// than erroring, so a novel `email_verified` representation can never
/// hard-fail an otherwise-valid, signature-verified token. Callers
/// treat `None` as NOT verified, so this is fail-closed.
fn de_opt_bool<'de, D>(d: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde_json::Value;
    Ok(match Option::<Value>::deserialize(d)? {
        Some(Value::Bool(b)) => Some(b),
        Some(Value::String(s)) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    })
}

const APPLE_JWKS_URL: &str = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER: &str = "https://appleid.apple.com";
const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS: &[&str] = &["accounts.google.com", "https://accounts.google.com"];

/// Cached JWKS fetch. Apple + Google rotate keys infrequently; refetch
/// every 6 hours so a key rollover during normal operation doesn't
/// brick auth between deploys. One mutex per provider keyed on the
/// JWKS URL so stale lookups don't pile up under load.
struct JwksCache {
    jwks: Option<JwkSet>,
    fetched_at: Option<Instant>,
}

impl JwksCache {
    const fn empty() -> Self {
        Self { jwks: None, fetched_at: None }
    }
    fn is_fresh(&self) -> bool {
        match self.fetched_at {
            Some(t) => t.elapsed() < Duration::from_secs(6 * 3600),
            None => false,
        }
    }
}

static APPLE_JWKS: Lazy<Mutex<JwksCache>> = Lazy::new(|| Mutex::new(JwksCache::empty()));
static GOOGLE_JWKS: Lazy<Mutex<JwksCache>> = Lazy::new(|| Mutex::new(JwksCache::empty()));

async fn fetch_jwks(cache: &Mutex<JwksCache>, url: &str) -> anyhow::Result<JwkSet> {
    {
        let guard = cache.lock().await;
        if guard.is_fresh() {
            if let Some(j) = &guard.jwks {
                return Ok(j.clone());
            }
        }
    }
    let res: JwkSet = reqwest::Client::new()
        .get(url)
        .send()
        .await?
        .json()
        .await?;
    let mut guard = cache.lock().await;
    guard.jwks = Some(res.clone());
    guard.fetched_at = Some(Instant::now());
    Ok(res)
}

/// Verify an Apple `id_token`. Audience is the Service ID configured
/// in the relay's environment as `APPLE_CLIENT_ID` (e.g.
/// `com.mattssoftware.libre.signin`).
pub async fn verify_apple(token: &str, audience: &str) -> anyhow::Result<OauthIdentity> {
    let header = decode_header(token)?;
    let kid = header
        .kid
        .ok_or_else(|| anyhow::anyhow!("Apple token missing 'kid' header"))?;

    let jwks = fetch_jwks(&APPLE_JWKS, APPLE_JWKS_URL).await?;
    let key = jwks
        .find(&kid)
        .ok_or_else(|| anyhow::anyhow!("No matching Apple JWK for kid {}", kid))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[APPLE_ISSUER]);
    validation.set_audience(&[audience]);
    let data = decode::<AppleClaims>(token, &DecodingKey::from_jwk(key)?, &validation)?;

    Ok(OauthIdentity {
        subject: data.claims.sub,
        email: data.claims.email,
        name: None,
        // Apple only ever returns an address it has verified (or an
        // Apple-owned private-relay address), so the email is always
        // provider-verified.
        email_verified: true,
    })
}

/// Verify a Google `id_token`. Audience is the Web/iOS client id
/// (`GOOGLE_CLIENT_ID`).
pub async fn verify_google(token: &str, audience: &str) -> anyhow::Result<OauthIdentity> {
    let header = decode_header(token)?;
    let kid = header
        .kid
        .ok_or_else(|| anyhow::anyhow!("Google token missing 'kid' header"))?;

    let jwks = fetch_jwks(&GOOGLE_JWKS, GOOGLE_JWKS_URL).await?;
    let key = jwks
        .find(&kid)
        .ok_or_else(|| anyhow::anyhow!("No matching Google JWK for kid {}", kid))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(GOOGLE_ISSUERS);
    validation.set_audience(&[audience]);
    let data = decode::<GoogleClaims>(token, &DecodingKey::from_jwk(key)?, &validation)?;

    Ok(OauthIdentity {
        subject: data.claims.sub,
        email: data.claims.email,
        name: data.claims.name,
        email_verified: data.claims.email_verified.unwrap_or(false),
    })
}
