//! Per-table query helpers attached to the `Database` handle.
//!
//! Named `users.rs` because every other table dangles off `users` —
//! tokens, progress, and courses all FK to it. Splitting into one
//! file per table is overkill at this size; if any table grows past
//! a hundred lines we'll split it out.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::{Database, OptionalExt};

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub has_password: bool,
    pub apple_linked: bool,
    pub google_linked: bool,
    /// Whether the email address has been confirmed. Always true for
    /// Apple/Google identities (the provider verified it) and for
    /// accounts that predate the verification feature; false for a
    /// password signup that hasn't clicked its confirmation link yet.
    pub email_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressRow {
    pub course_id: String,
    pub lesson_id: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolutionRow {
    pub course_id: String,
    pub lesson_id: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingRow {
    pub key: String,
    /// JSON-encoded value. Carried over the wire as a string and
    /// re-parsed by callers on either side — keeps the schema stable
    /// regardless of what the setting actually holds.
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CourseMeta {
    pub id: String,
    pub course_slug: String,
    pub owner_id: String,
    pub owner_display_name: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub visibility: String,
    pub archive_size: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    // ── Users ────────────────────────────────────────────────

    /// Create or fetch a user by Apple `sub`. Email gets updated when
    /// present so a user who initially signed in without disclosing
    /// their email can later upgrade.
    pub fn find_or_create_apple_user(
        &self,
        apple_user_id: &str,
        email: Option<&str>,
        display_name: Option<&str>,
        email_verified: bool,
    ) -> anyhow::Result<String> {
        // Normalize to the password path's storage form (trim + lowercase)
        // so the by-email link lookup hits an existing email+password row
        // instead of inserting a duplicate. Exact-string match (no alias
        // canonicalization); empty-after-trim collapses to None.
        let email_norm = email.map(|e| e.trim().to_lowercase()).filter(|e| !e.is_empty());
        let email = email_norm.as_deref();
        let conn = self.conn_lock();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE apple_user_id = ?1",
                params![apple_user_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            if let Some(e) = email {
                conn.execute(
                    "UPDATE users SET email = COALESCE(email, ?2), updated_at = datetime('now') WHERE id = ?1",
                    params![id, e],
                )?;
            }
            return Ok(id);
        }
        // No row carries this Apple subject yet. Before inserting a
        // fresh user, try to LINK this identity onto an existing
        // account with the same email (one created via email+password,
        // or whose provider `sub` changed when the OAuth client moved
        // Google Cloud projects) — otherwise the `users.email` UNIQUE
        // constraint makes OAuth sign-in impossible for that person and
        // the callback dies with `db_error`. We only auto-link when the
        // provider asserts the email is verified: linking on an
        // unverified address would let anyone able to mint a token for
        // an arbitrary `email` claim seize a password account they
        // don't own. Apple only returns verified / relay addresses so
        // this is effectively always true for Apple, but we still gate.
        if email_verified {
            if let Some(e) = email {
                let by_email: Option<(String, bool)> = conn
                    .query_row(
                        "SELECT id, email_verified FROM users WHERE email = ?1",
                        params![e],
                        |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
                    )
                    .optional()?;
                if let Some((id, was_verified)) = by_email {
                    if was_verified {
                        // Trusted existing account — keep the password,
                        // just attach the Apple identity.
                        conn.execute(
                            "UPDATE users SET apple_user_id = ?2, \
                             display_name = COALESCE(display_name, ?3), \
                             updated_at = datetime('now') WHERE id = ?1",
                            params![id, apple_user_id, display_name],
                        )?;
                    } else {
                        // Unverified existing row — reclaim it for the
                        // Apple-proven owner and wipe the unproven
                        // password (see the Google path for the full
                        // pre-hijacking rationale).
                        conn.execute(
                            "UPDATE users SET apple_user_id = ?2, \
                             display_name = COALESCE(display_name, ?3), \
                             password_hash = NULL, email_verified = 1, \
                             updated_at = datetime('now') WHERE id = ?1",
                            params![id, apple_user_id, display_name],
                        )?;
                    }
                    return Ok(id);
                }
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO users (id, email, apple_user_id, display_name) VALUES (?1, ?2, ?3, ?4)",
            params![id, email, apple_user_id, display_name],
        )?;
        // Drop the connection lock before seeding the owner friendship —
        // `seed_default_friendship` re-acquires `conn_lock()`, and the
        // plain `std::sync::Mutex` isn't reentrant, so holding it here
        // would deadlock.
        drop(conn);
        self.seed_default_friendship(&id)?;
        Ok(id)
    }

    pub fn find_or_create_google_user(
        &self,
        google_user_id: &str,
        email: Option<&str>,
        display_name: Option<&str>,
        email_verified: bool,
    ) -> anyhow::Result<String> {
        // Normalize to the password path's storage form (auth.rs trims +
        // lowercases every email it writes) so the by-email link lookup
        // below actually hits an existing email+password row instead of
        // missing it and inserting a duplicate/orphan account. Email
        // matching here is intentionally exact-string (no Gmail dot/plus
        // canonicalization). Empty-after-trim collapses to None.
        let email_norm = email.map(|e| e.trim().to_lowercase()).filter(|e| !e.is_empty());
        let email = email_norm.as_deref();
        let conn = self.conn_lock();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE google_user_id = ?1",
                params![google_user_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            if let Some(e) = email {
                conn.execute(
                    "UPDATE users SET email = COALESCE(email, ?2), updated_at = datetime('now') WHERE id = ?1",
                    params![id, e],
                )?;
            }
            return Ok(id);
        }
        // No row carries this Google subject yet. Before inserting a
        // fresh user, try to LINK this identity onto an existing
        // account with the same email (one created via email+password,
        // or whose Google `sub` changed because the OAuth client moved
        // to a new Google Cloud project) — otherwise the `users.email`
        // UNIQUE constraint makes Google sign-in impossible for that
        // person and the callback dies with `db_error`. We only
        // auto-link when Google asserts the email is verified: linking
        // on an unverified address would let anyone able to mint a token
        // for an arbitrary `email` claim seize a password account they
        // don't own.
        if email_verified {
            if let Some(e) = email {
                let by_email: Option<(String, bool)> = conn
                    .query_row(
                        "SELECT id, email_verified FROM users WHERE email = ?1",
                        params![e],
                        |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
                    )
                    .optional()?;
                if let Some((id, was_verified)) = by_email {
                    if was_verified {
                        // Trusted existing account — the email owner
                        // proved inbox control at signup (or it's a
                        // prior OAuth row). Attach this provider
                        // identity; keep their existing password.
                        conn.execute(
                            "UPDATE users SET google_user_id = ?2, \
                             display_name = COALESCE(display_name, ?3), \
                             updated_at = datetime('now') WHERE id = ?1",
                            params![id, google_user_id, display_name],
                        )?;
                    } else {
                        // The existing row's email was never verified —
                        // it may be a squatter who pre-registered this
                        // email with a password they know (account
                        // pre-hijacking). Google has now proven the
                        // current signer owns the inbox, so reclaim the
                        // row for them: attach the identity, mark it
                        // verified, and WIPE the unproven password so
                        // the squatter's credentials stop working.
                        conn.execute(
                            "UPDATE users SET google_user_id = ?2, \
                             display_name = COALESCE(display_name, ?3), \
                             password_hash = NULL, email_verified = 1, \
                             updated_at = datetime('now') WHERE id = ?1",
                            params![id, google_user_id, display_name],
                        )?;
                    }
                    return Ok(id);
                }
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO users (id, email, google_user_id, display_name) VALUES (?1, ?2, ?3, ?4)",
            params![id, email, google_user_id, display_name],
        )?;
        // See the Apple path: drop the lock before seeding so the
        // non-reentrant connection mutex doesn't deadlock.
        drop(conn);
        self.seed_default_friendship(&id)?;
        Ok(id)
    }

    pub fn create_password_user(
        &self,
        email: &str,
        password_hash: &str,
        display_name: Option<&str>,
    ) -> anyhow::Result<String> {
        let conn = self.conn_lock();
        let id = uuid::Uuid::new_v4().to_string();
        // email_verified = 0 explicitly: a password signup must click
        // the confirmation link before it can sign in. This is the only
        // insert path that opts out of the column's DEFAULT 1 — OAuth
        // identities and pre-existing rows stay auto-verified.
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, email_verified) VALUES (?1, ?2, ?3, ?4, 0)",
            params![id, email, password_hash, display_name],
        )?;
        // See the Apple path: drop the lock before seeding so the
        // non-reentrant connection mutex doesn't deadlock.
        drop(conn);
        self.seed_default_friendship(&id)?;
        Ok(id)
    }

    /// Returns (user_id, password_hash, email_verified) when an email is
    /// registered with a password. Used by the login endpoint to verify
    /// the password AND gate sign-in on a confirmed email before issuing
    /// a token.
    pub fn get_password_login(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<(String, String, bool)>> {
        let conn = self.conn_lock();
        let row: Option<(String, String, bool)> = conn
            .query_row(
                "SELECT id, password_hash, email_verified FROM users WHERE email = ?1 AND password_hash IS NOT NULL",
                params![email],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        Ok(row)
    }

    /// Look up a user_id from an email. Returns `None` for unknown
    /// emails so the caller can decide how to surface the result —
    /// the password-reset request endpoint deliberately responds 204
    /// regardless of existence to avoid email enumeration.
    pub fn find_user_id_by_email(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<String>> {
        let conn = self.conn_lock();
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE email = ?1",
                params![email],
                |r| r.get(0),
            )
            .optional()?;
        Ok(id)
    }

    /// Replace the password hash on an existing user. Used by the
    /// password-reset confirm endpoint after a token has been validated.
    /// Bumps `updated_at` so the audit trail picks it up.
    pub fn update_password_hash(
        &self,
        user_id: &str,
        new_password_hash: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "UPDATE users SET password_hash = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![user_id, new_password_hash],
        )?;
        Ok(())
    }

    /// Insert a fresh password-reset entry. The caller hashes the
    /// random plaintext token before passing the hash here — we never
    /// store the plaintext, mirroring the `tokens` table posture.
    /// `ttl_secs` is added to the current timestamp via SQLite's
    /// `datetime` arithmetic so the expiry is server-clock-relative.
    pub fn create_password_reset(
        &self,
        token_hash: &str,
        user_id: &str,
        ttl_secs: i64,
    ) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "INSERT INTO password_resets (token_hash, user_id, expires_at) \
             VALUES (?1, ?2, datetime('now', ?3))",
            params![token_hash, user_id, format!("+{ttl_secs} seconds")],
        )?;
        Ok(())
    }

    /// Atomically consume a reset token: returns the associated user
    /// id when the hash matches a row that's not yet expired AND not
    /// already consumed, then DELETEs the row so the same token
    /// can't be reused. Returns `None` for any failure mode (unknown,
    /// expired, already-consumed) so the handler can collapse all of
    /// them to a single user-facing "link is invalid or expired"
    /// message — leaking which specific case is unhelpful and gives
    /// brute-forcers a side channel.
    pub fn consume_password_reset(
        &self,
        token_hash: &str,
    ) -> anyhow::Result<Option<String>> {
        let conn = self.conn_lock();
        // Single statement DELETE…RETURNING keeps the lookup +
        // invalidation atomic. The `expires_at >= now` filter rejects
        // stale tokens; `consumed_at IS NULL` rejects double-spends
        // (defensive — we DELETE on consume, but a race-window or a
        // future feature might keep the row around).
        let user_id: Option<String> = conn
            .query_row(
                "DELETE FROM password_resets \
                 WHERE token_hash = ?1 \
                   AND consumed_at IS NULL \
                   AND expires_at >= datetime('now') \
                 RETURNING user_id",
                params![token_hash],
                |r| r.get(0),
            )
            .optional()?;
        Ok(user_id)
    }

    /// Sweep expired or consumed reset rows. Cheap to run periodically
    /// (no index scan — `expires_at` comparison + a single DELETE).
    /// Currently invoked from the request handler so each new request
    /// pays a small cleanup tax and the table doesn't accumulate dead
    /// rows over time.
    pub fn sweep_password_resets(&self) -> anyhow::Result<usize> {
        let conn = self.conn_lock();
        let n = conn.execute(
            "DELETE FROM password_resets \
             WHERE expires_at < datetime('now') OR consumed_at IS NOT NULL",
            params![],
        )?;
        Ok(n)
    }

    /// Revoke every active token for a user. Used after a password
    /// reset — the user's previous sessions on other devices should
    /// be forced to re-authenticate, both as a security measure and
    /// so a stolen credential is fully cut off.
    pub fn revoke_all_tokens(&self, user_id: &str) -> anyhow::Result<usize> {
        let conn = self.conn_lock();
        let n = conn.execute(
            "DELETE FROM tokens WHERE user_id = ?1",
            params![user_id],
        )?;
        Ok(n)
    }

    // ── Email verification ───────────────────────────────────
    //
    // Same single-use / TTL-bounded / hash-by-lookup shape as the
    // password-reset helpers above. The only behavioural difference is
    // `consume_email_verification` flips `users.email_verified = 1` as
    // part of consuming the token, so confirming the link both spends
    // the token and unlocks the account in one atomic step.

    pub fn create_email_verification(
        &self,
        token_hash: &str,
        user_id: &str,
        ttl_secs: i64,
    ) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "INSERT INTO email_verifications (token_hash, user_id, expires_at) \
             VALUES (?1, ?2, datetime('now', ?3))",
            params![token_hash, user_id, format!("+{ttl_secs} seconds")],
        )?;
        Ok(())
    }

    /// Atomically consume a verification token and mark the owning user
    /// verified. Returns the user id on success; `None` for unknown /
    /// expired / already-consumed tokens (collapsed so the handler
    /// can't leak which case it was). The DELETE…RETURNING + UPDATE run
    /// under the same connection lock so a token can't be redeemed
    /// twice.
    pub fn consume_email_verification(
        &self,
        token_hash: &str,
    ) -> anyhow::Result<Option<String>> {
        let conn = self.conn_lock();
        let user_id: Option<String> = conn
            .query_row(
                "DELETE FROM email_verifications \
                 WHERE token_hash = ?1 \
                   AND consumed_at IS NULL \
                   AND expires_at >= datetime('now') \
                 RETURNING user_id",
                params![token_hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(uid) = &user_id {
            conn.execute(
                "UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?1",
                params![uid],
            )?;
        }
        Ok(user_id)
    }

    /// Sweep expired / consumed verification rows. Called from the
    /// request handlers so the table self-prunes without a cron.
    pub fn sweep_email_verifications(&self) -> anyhow::Result<usize> {
        let conn = self.conn_lock();
        let n = conn.execute(
            "DELETE FROM email_verifications \
             WHERE expires_at < datetime('now') OR consumed_at IS NOT NULL",
            params![],
        )?;
        Ok(n)
    }

    /// Look up (user_id, email_verified) for an unverified-resend
    /// request. Returns `None` for unknown emails so the handler stays
    /// enumeration-safe (always 204 regardless).
    pub fn find_unverified_user_by_email(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<String>> {
        let conn = self.conn_lock();
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE email = ?1 AND email_verified = 0",
                params![email],
                |r| r.get(0),
            )
            .optional()?;
        Ok(id)
    }

    pub fn email_exists(&self, email: &str) -> anyhow::Result<bool> {
        let conn = self.conn_lock();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE email = ?1",
            params![email],
            |r| r.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn get_user(&self, user_id: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn_lock();
        let row = conn
            .query_row(
                "SELECT id, email, display_name, password_hash IS NOT NULL, apple_user_id IS NOT NULL, google_user_id IS NOT NULL, email_verified FROM users WHERE id = ?1",
                params![user_id],
                |r| {
                    Ok(User {
                        id: r.get(0)?,
                        email: r.get(1)?,
                        display_name: r.get(2)?,
                        has_password: r.get(3)?,
                        apple_linked: r.get(4)?,
                        google_linked: r.get(5)?,
                        email_verified: r.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn delete_user(&self, user_id: &str) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        // ON DELETE CASCADE on tokens + progress + courses handles the rest.
        conn.execute(
            "DELETE FROM users WHERE id = ?1",
            params![user_id],
        )?;
        Ok(())
    }

    // ── Tokens ───────────────────────────────────────────────

    pub fn store_token(
        &self,
        id: &str,
        user_id: &str,
        label: &str,
        token_hash: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "INSERT INTO tokens (id, user_id, label, token_hash) VALUES (?1, ?2, ?3, ?4)",
            params![id, user_id, label, token_hash],
        )?;
        Ok(())
    }

    /// Return every (token_id, user_id, hash) row so the auth
    /// middleware can verify a Bearer token by comparing it against
    /// each stored Argon2 hash.
    pub fn all_token_hashes(
        &self,
    ) -> anyhow::Result<Vec<(String, String, String)>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, token_hash FROM tokens",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn update_token_last_used(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "UPDATE tokens SET last_used = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn revoke_token(&self, id: &str, user_id: &str) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "DELETE FROM tokens WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(())
    }

    // ── Progress ─────────────────────────────────────────────

    pub fn list_progress(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<ProgressRow>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT course_id, lesson_id, completed_at FROM progress WHERE user_id = ?1 ORDER BY completed_at DESC"
        )?;
        let rows = stmt
            .query_map(params![user_id], |row| {
                Ok(ProgressRow {
                    course_id: row.get(0)?,
                    lesson_id: row.get(1)?,
                    completed_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Wipe every progress row for `user_id`. Used by the "Start
    /// fresh" Settings action — the matching client call is
    /// `DELETE /progress`. Returns the number of rows
    /// removed (for logging / response payload).
    pub fn clear_progress(&self, user_id: &str) -> anyhow::Result<usize> {
        let conn = self.conn_lock();
        let n = conn.execute(
            "DELETE FROM progress WHERE user_id = ?1",
            params![user_id],
        )?;
        Ok(n)
    }

    /// Wipe every progress row for `user_id` in a single course.
    /// Backs `DELETE /progress/:course_id` — the per-course "Reset
    /// progress" affordance in the desktop sidebar / Challenges
    /// page. Without this, the client's local reset gets undone on
    /// the next pull because the relay still has the rows and
    /// happily echoes them back.
    pub fn clear_progress_course(
        &self,
        user_id: &str,
        course_id: &str,
    ) -> anyhow::Result<usize> {
        let conn = self.conn_lock();
        let n = conn.execute(
            "DELETE FROM progress WHERE user_id = ?1 AND course_id = ?2",
            params![user_id, course_id],
        )?;
        Ok(n)
    }

    /// Wipe specific lesson rows for `user_id` in a course. Covers
    /// the per-lesson "mark incomplete" sidebar action and the
    /// per-chapter "Reset chapter" action; both pass the exact
    /// lesson_id list to wipe. Wrapped in one transaction so a
    /// connection blip can't leave half-cleared state.
    pub fn clear_progress_lessons(
        &self,
        user_id: &str,
        course_id: &str,
        lesson_ids: &[String],
    ) -> anyhow::Result<usize> {
        if lesson_ids.is_empty() {
            return Ok(0);
        }
        let conn = self.conn_lock();
        let tx = conn.unchecked_transaction()?;
        let mut total = 0usize;
        for lid in lesson_ids {
            total += tx.execute(
                "DELETE FROM progress \
                 WHERE user_id = ?1 AND course_id = ?2 AND lesson_id = ?3",
                params![user_id, course_id, lid],
            )?;
        }
        tx.commit()?;
        Ok(total)
    }

    /// Bulk upsert. Newer `completed_at` wins on conflict so two
    /// devices that finish the same lesson on different days don't
    /// undo each other's progress on sync.
    pub fn upsert_progress(
        &self,
        user_id: &str,
        rows: &[ProgressRow],
    ) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        let tx = conn.unchecked_transaction()?;
        for r in rows {
            tx.execute(
                "INSERT INTO progress (user_id, course_id, lesson_id, completed_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, datetime('now'))
                 ON CONFLICT(user_id, course_id, lesson_id) DO UPDATE
                 SET completed_at = MAX(excluded.completed_at, progress.completed_at),
                     updated_at = datetime('now')",
                params![user_id, r.course_id, r.lesson_id, r.completed_at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ── Solutions ────────────────────────────────────────────

    pub fn list_solutions(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<SolutionRow>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT course_id, lesson_id, content, language, updated_at \
             FROM solutions WHERE user_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map(params![user_id], |row| {
                Ok(SolutionRow {
                    course_id: row.get(0)?,
                    lesson_id: row.get(1)?,
                    content: row.get(2)?,
                    language: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Bulk upsert solutions. Newer `updated_at` wins per (course,
    /// lesson) so a stale device pushing back later can't clobber a
    /// fresher edit from another machine. Returns the rows that
    /// actually changed (incoming row beat the existing one) so the
    /// caller can broadcast only the deltas — keeps the WS payload
    /// small even when a client pushes its full local set.
    pub fn upsert_solutions(
        &self,
        user_id: &str,
        rows: &[SolutionRow],
    ) -> anyhow::Result<Vec<SolutionRow>> {
        let conn = self.conn_lock();
        let tx = conn.unchecked_transaction()?;
        let mut applied: Vec<SolutionRow> = Vec::new();
        for r in rows {
            let n = tx.execute(
                "INSERT INTO solutions (user_id, course_id, lesson_id, content, language, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT(user_id, course_id, lesson_id) DO UPDATE \
                 SET content = excluded.content, \
                     language = excluded.language, \
                     updated_at = excluded.updated_at \
                 WHERE excluded.updated_at > solutions.updated_at",
                params![
                    user_id,
                    r.course_id,
                    r.lesson_id,
                    r.content,
                    r.language,
                    r.updated_at
                ],
            )?;
            if n > 0 {
                applied.push(r.clone());
            }
        }
        tx.commit()?;
        Ok(applied)
    }

    // ── Settings ─────────────────────────────────────────────

    pub fn list_settings(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<SettingRow>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT key, value, updated_at FROM settings WHERE user_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![user_id], |row| {
                Ok(SettingRow {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Same conflict semantics as `upsert_solutions`: newer
    /// `updated_at` wins, returns only the rows that changed.
    pub fn upsert_settings(
        &self,
        user_id: &str,
        rows: &[SettingRow],
    ) -> anyhow::Result<Vec<SettingRow>> {
        let conn = self.conn_lock();
        let tx = conn.unchecked_transaction()?;
        let mut applied: Vec<SettingRow> = Vec::new();
        for r in rows {
            let n = tx.execute(
                "INSERT INTO settings (user_id, key, value, updated_at) \
                 VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(user_id, key) DO UPDATE \
                 SET value = excluded.value, \
                     updated_at = excluded.updated_at \
                 WHERE excluded.updated_at > settings.updated_at",
                params![user_id, r.key, r.value, r.updated_at],
            )?;
            if n > 0 {
                applied.push(r.clone());
            }
        }
        tx.commit()?;
        Ok(applied)
    }

    /// Verify a Bearer token directly (no per-request middleware) and
    /// return the resulting user id. Used by the WebSocket upgrade
    /// handler, which can't go through the standard middleware
    /// because browsers don't let JS set headers on `new WebSocket()`
    /// — the token rides as a query param instead.
    pub fn verify_bearer(&self, token: &str) -> anyhow::Result<Option<String>> {
        let hashes = self.all_token_hashes()?;
        for (id, user_id, hash) in hashes {
            if crate::auth::verify_token(token, &hash) {
                let _ = self.update_token_last_used(&id);
                return Ok(Some(user_id));
            }
        }
        Ok(None)
    }

    // ── Courses ──────────────────────────────────────────────

    pub fn create_course(
        &self,
        owner_id: &str,
        course_slug: &str,
        title: &str,
        description: Option<&str>,
        language: Option<&str>,
        visibility: &str,
        archive_blob: &[u8],
    ) -> anyhow::Result<String> {
        let conn = self.conn_lock();
        let id = uuid::Uuid::new_v4().to_string();
        let size = archive_blob.len() as i64;
        conn.execute(
            "INSERT INTO courses (id, course_slug, owner_id, title, description, language, visibility, archive_blob, archive_size) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, course_slug, owner_id, title, description, language, visibility, archive_blob, size],
        )?;
        Ok(id)
    }

    pub fn list_user_courses(
        &self,
        owner_id: &str,
    ) -> anyhow::Result<Vec<CourseMeta>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.course_slug, c.owner_id, u.display_name, c.title, c.description, c.language, c.visibility, c.archive_size, c.created_at, c.updated_at
             FROM courses c
             LEFT JOIN users u ON u.id = c.owner_id
             WHERE c.owner_id = ?1
             ORDER BY c.updated_at DESC"
        )?;
        let rows = stmt
            .query_map(params![owner_id], course_meta_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_public_courses(
        &self,
        limit: i64,
    ) -> anyhow::Result<Vec<CourseMeta>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.course_slug, c.owner_id, u.display_name, c.title, c.description, c.language, c.visibility, c.archive_size, c.created_at, c.updated_at
             FROM courses c
             LEFT JOIN users u ON u.id = c.owner_id
             WHERE c.visibility = 'public'
             ORDER BY c.updated_at DESC
             LIMIT ?1"
        )?;
        let rows = stmt
            .query_map(params![limit], course_meta_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Returns the full archive blob + meta. Owner can fetch their own
    /// private courses; anyone can fetch a public/unlisted one by id.
    pub fn get_course(
        &self,
        course_id: &str,
        viewer_id: Option<&str>,
    ) -> anyhow::Result<Option<(CourseMeta, Vec<u8>)>> {
        let conn = self.conn_lock();
        let row = conn
            .query_row(
                "SELECT c.id, c.course_slug, c.owner_id, u.display_name, c.title, c.description, c.language, c.visibility, c.archive_size, c.created_at, c.updated_at, c.archive_blob
                 FROM courses c
                 LEFT JOIN users u ON u.id = c.owner_id
                 WHERE c.id = ?1",
                params![course_id],
                |row| {
                    Ok((
                        CourseMeta {
                            id: row.get(0)?,
                            course_slug: row.get(1)?,
                            owner_id: row.get(2)?,
                            owner_display_name: row.get(3)?,
                            title: row.get(4)?,
                            description: row.get(5)?,
                            language: row.get(6)?,
                            visibility: row.get(7)?,
                            archive_size: row.get(8)?,
                            created_at: row.get(9)?,
                            updated_at: row.get(10)?,
                        },
                        row.get::<_, Vec<u8>>(11)?,
                    ))
                },
            )
            .optional()?;
        match row {
            Some((meta, blob)) => {
                if meta.visibility == "private" && viewer_id != Some(&meta.owner_id) {
                    Ok(None)
                } else {
                    Ok(Some((meta, blob)))
                }
            }
            None => Ok(None),
        }
    }

    pub fn delete_course(
        &self,
        course_id: &str,
        owner_id: &str,
    ) -> anyhow::Result<bool> {
        let conn = self.conn_lock();
        let n = conn.execute(
            "DELETE FROM courses WHERE id = ?1 AND owner_id = ?2",
            params![course_id, owner_id],
        )?;
        Ok(n > 0)
    }
}

fn course_meta_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<CourseMeta> {
    Ok(CourseMeta {
        id: row.get(0)?,
        course_slug: row.get(1)?,
        owner_id: row.get(2)?,
        owner_display_name: row.get(3)?,
        title: row.get(4)?,
        description: row.get(5)?,
        language: row.get(6)?,
        visibility: row.get(7)?,
        archive_size: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}
