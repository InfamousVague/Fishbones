//! SQLite database handle for the Libre API.
//!
//! Single-file SQLite under WAL with foreign keys on. The schema is
//! deliberately small — four tables (`users`, `tokens`, `progress`,
//! `courses`) — and all the per-table queries live in `users.rs`
//! (named that way because every table dangles off `users`; the file
//! holds course/progress/token helpers too).
//!
//! `conn_lock()` is the one path through to the underlying connection;
//! every helper takes the mutex via that method so we never end up
//! with two paths fighting over locking semantics.

mod friends;
mod stats;
mod users;

pub use friends::{
    FriendRequest, FriendSummary, LeaderboardRow, ProfileView, Relation,
};
pub use stats::Stats;
pub use users::{CourseMeta, ProgressRow, SettingRow, SolutionRow, User};

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

pub struct Database {
    conn: Mutex<Connection>,
    /// The id of the "default friend" account (the owner, email
    /// `infamousvaguerat@gmail.com`). Resolved once at startup via
    /// `set_default_friend_id`; every new-user insert path reads it to
    /// wire up a mutual accepted friendship so everyone is friends with
    /// the owner by default. `OnceLock` so it's set exactly once and
    /// read lock-free thereafter; empty until `set_default_friend_id`.
    default_friend_id: OnceLock<String>,
}

impl Database {
    /// Open (or create) the SQLite file at `path`. The parent dir is
    /// created if missing — handy for the default
    /// `/var/lib/libre-api/api.sqlite` location where systemd
    /// only owns the dir, not the file.
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        Ok(Self {
            conn: Mutex::new(conn),
            default_friend_id: OnceLock::new(),
        })
    }

    /// Record the resolved default-friend user id. Called once at
    /// startup after `find_or_create_default_friend`. Idempotent — a
    /// second call is a no-op (the first value wins). New-user insert
    /// paths read this via `default_friend_id()` to seed the mutual
    /// owner friendship.
    pub fn set_default_friend_id(&self, id: &str) {
        let _ = self.default_friend_id.set(id.to_string());
    }

    /// The resolved default-friend user id, if set. `None` before
    /// startup wiring completes (in which case insert paths just skip
    /// the auto-friendship — no panic).
    pub(crate) fn default_friend_id(&self) -> Option<&str> {
        self.default_friend_id.get().map(String::as_str)
    }

    pub fn run_migrations(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(MIGRATIONS)?;
        // Idempotent column add for databases created before
        // `email_verified` existed. `execute_batch` can't carry an
        // unconditional `ALTER TABLE … ADD COLUMN` — SQLite errors with
        // "duplicate column name" on the second boot and aborts the
        // whole batch — so we probe `table_info` and add only when
        // absent. DEFAULT 1 backfills every pre-existing row as
        // verified (grandfathering: no current account gets locked out
        // when this ships).
        let has_col: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'email_verified'")?
            .query_row([], |_| Ok(()))
            .optional()?
            .is_some();
        if !has_col {
            conn.execute_batch(
                "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;",
            )?;
        }
        Ok(())
    }

    /// Lend the connection mutex out to `users.rs`. `pub(crate)` so
    /// the curated API in `users.rs` is the only entry point — handler
    /// code never touches raw SQL.
    pub(crate) fn conn_lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}

/// rusqlite's `query_row` returns `Err(QueryReturnedNoRows)` for the
/// not-found case; we promote that to `Ok(None)` so the call sites
/// can pattern-match cleanly.
pub(crate) trait OptionalExt<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}
impl<T> OptionalExt<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

const MIGRATIONS: &str = r#"
-- Users. Keep email-password, Apple, and Google identity columns side
-- by side so a future "link your Google account to an existing email
-- login" feature is just an UPDATE — no second-table dance.
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE,
    password_hash   TEXT,
    apple_user_id   TEXT UNIQUE,
    google_user_id  TEXT UNIQUE,
    display_name    TEXT,
    -- 1 = email confirmed (clicked the verification link), or the
    -- identity came from a provider that already verified it (Apple /
    -- Google). DEFAULT 1 does double duty: fresh OAuth inserts (which
    -- don't list this column) auto-verify, and the guarded ALTER in
    -- `run_migrations` grandfathers every pre-existing row. Only the
    -- password-signup path opts a new row into 0 — it must confirm
    -- before it can sign in. See `should_seed`/verify-email flow.
    email_verified  INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-device API tokens. Argon2id-hashed so a database leak doesn't
-- leak live bearers. ON DELETE CASCADE sweeps tokens when an account
-- is deleted.
CREATE TABLE IF NOT EXISTS tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    last_used   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-lesson completion records. The composite primary key keeps the
-- upsert idempotent — pushing the same lesson twice from two devices
-- updates the timestamp instead of creating a duplicate row.
CREATE TABLE IF NOT EXISTS progress (
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id     TEXT NOT NULL,
    lesson_id     TEXT NOT NULL,
    completed_at  TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, course_id, lesson_id)
);

-- Course archives. Stores the `.libre` zip blob inline so the
-- API can be a single binary + db file with no separate object
-- store. Cap enforced at the API layer (~50 MB) to keep the SQLite
-- page count reasonable.
CREATE TABLE IF NOT EXISTS courses (
    id            TEXT PRIMARY KEY,
    course_slug   TEXT NOT NULL,
    owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    language      TEXT,
    visibility    TEXT NOT NULL DEFAULT 'private',
    archive_blob  BLOB NOT NULL,
    archive_size  INTEGER NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_courses_owner
    ON courses(owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_visibility
    ON courses(visibility, updated_at);

-- Password-reset tokens. We store a hash of the random URL-safe token
-- so a database leak doesn't yield live reset links — same posture as
-- the `tokens` table. `expires_at` is a wall-clock string we compare
-- via SQLite's `datetime('now')` so we don't need a clock skew check
-- in Rust. ON DELETE CASCADE sweeps a user's open reset requests when
-- the account is deleted.
--
-- `consumed_at` (NULL until consumed) lets us delete the row on use
-- but keep an audit trail for a short window if we ever want one.
-- For now we just hard-DELETE on consumption; the column is reserved
-- in the schema so a future change doesn't need a migration.
CREATE TABLE IF NOT EXISTS password_resets (
    token_hash    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    TEXT NOT NULL,
    consumed_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user
    ON password_resets(user_id);

-- Email-confirmation tokens for new password signups. Same shape as
-- password_resets: a single-use, TTL-bounded, SHA-256-hashed token the
-- user clicks from their inbox to prove they own the address before the
-- account can sign in. ON DELETE CASCADE clears tokens if the pending
-- account is deleted.
CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    TEXT NOT NULL,
    consumed_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user
    ON email_verifications(user_id);

-- Per-lesson solution snapshots. Stores the learner's last-saved
-- code for each lesson in plain text; conflict resolution is
-- last-writer-wins via `updated_at`. We don't version history here
-- (no diff log) — the marketing claim is "your code follows you
-- across devices," not "every keystroke replicated."
CREATE TABLE IF NOT EXISTS solutions (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL,
    lesson_id   TEXT NOT NULL,
    -- The active file's content. Solidity / Rust / etc. — single
    -- blob to keep the row format stable; a multi-file lesson packs
    -- its files into a serialized JSON wrapper before write.
    content     TEXT NOT NULL,
    language    TEXT,
    -- Source-of-truth timestamp from the WRITING device, ISO 8601.
    -- Used in the conflict resolver: only overwrite if incoming
    -- `updated_at` is strictly newer.
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, course_id, lesson_id)
);

-- User settings. Free-form key/value table — value is JSON-encoded
-- so a setting can hold a scalar, an object, or a small array
-- without schema churn. Per (user, key) primary key keeps it
-- idempotent across devices.
CREATE TABLE IF NOT EXISTS settings (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);

-- Denormalized, client-pushed gamification stats. One row per user,
-- upserted wholesale by `PUT /me/stats` — the client is the source of
-- truth for XP / streaks / lesson counts (they're computed locally
-- from progress + habit data), so the server just stores the latest
-- snapshot for leaderboard + friend-card display. All counters are
-- non-negative integers defaulting to 0 so a friend with no row yet
-- still renders as all-zeros. Indexes back the two leaderboard
-- orderings (global-by-XP, friends-by-streak).
CREATE TABLE IF NOT EXISTS stats (
    user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp              INTEGER NOT NULL DEFAULT 0,
    current_streak_days   INTEGER NOT NULL DEFAULT 0,
    longest_streak_days   INTEGER NOT NULL DEFAULT 0,
    lessons_completed     INTEGER NOT NULL DEFAULT 0,
    level                 INTEGER NOT NULL DEFAULT 0,
    updated_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_stats_total_xp
    ON stats(total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_stats_current_streak
    ON stats(current_streak_days DESC);

-- Friendships. Stored as two directed rows per relationship so a
-- lookup for "who are MY friends" is a single `WHERE user_id = ?`
-- index scan without an OR across two columns. `status` is 'pending'
-- (a request the `user_id` sent to `friend_id`, awaiting acceptance)
-- or 'accepted' (mutual — both directed rows carry 'accepted'). The
-- composite PK keeps each directed edge unique and makes the add /
-- accept upserts idempotent. Both FKs cascade so deleting an account
-- sweeps every edge touching it.
CREATE TABLE IF NOT EXISTS friends (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_status
    ON friends(user_id, status);
"#;
