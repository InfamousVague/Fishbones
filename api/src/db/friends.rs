//! Friendship + leaderboard + profile query helpers.
//!
//! Friendships are stored as two directed rows per relationship in the
//! `friends` table (see the schema in `mod.rs`): a request from A to B
//! is a single row `(A, B, 'pending')`; accepting it sets that row to
//! 'accepted' AND inserts/updates the reverse row `(B, A, 'accepted')`,
//! so "list MY accepted friends" is one indexed `WHERE user_id = ?1
//! AND status = 'accepted'` scan.
//!
//! Every learner is auto-friended to the "default friend" (the owner
//! account, email `infamousvaguerat@gmail.com`) so they can always see
//! the owner's streak on their leaderboard. That wiring lives in
//! `seed_default_friendship` (called from each new-user insert path in
//! `users.rs`) plus the one-time `backfill_default_friendships` run at
//! startup.

use rusqlite::params;
use serde::Serialize;

use super::stats::Stats;
use super::{Database, OptionalExt};

/// One accepted friend, with their latest stats snapshot. Backs
/// `GET /friends`.
#[derive(Debug, Clone, Serialize)]
pub struct FriendSummary {
    pub id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub stats: Stats,
}

/// An incoming pending friend request. Backs `GET /friends/requests`.
#[derive(Debug, Clone, Serialize)]
pub struct FriendRequest {
    pub id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

/// One leaderboard entry. Flat (stats inlined, not nested) to match the
/// API contract for `GET /leaderboard/*`.
#[derive(Debug, Clone, Serialize)]
pub struct LeaderboardRow {
    pub rank: i64,
    pub user_id: String,
    pub display_name: Option<String>,
    pub total_xp: i64,
    pub current_streak_days: i64,
    pub longest_streak_days: i64,
    pub lessons_completed: i64,
    pub level: i64,
}

/// A public-ish profile view. `email` is only populated when the
/// viewer is the subject or an accepted friend (the handler enforces
/// that; this struct just carries whatever the handler decides to
/// expose). Backs `GET /users/:id/profile`.
#[derive(Debug, Clone, Serialize)]
pub struct ProfileView {
    pub id: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub created_at: String,
    pub stats: Stats,
    pub is_friend: bool,
    pub friend_request_pending: bool,
}

/// The directed relationship state between two users, from the
/// perspective of `relation_of(a, b)` — i.e. how `a` relates to `b`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Relation {
    /// No edge in either direction.
    None,
    /// `a` sent `b` a request that's still pending.
    OutgoingPending,
    /// `b` sent `a` a request that's still pending.
    IncomingPending,
    /// Mutually accepted.
    Accepted,
}

impl Database {
    // Every leaderboard / friend query below LEFT JOINs `stats` so a
    // user with no pushed stats still appears (as all-zeros) rather than
    // being dropped by an inner join; COALESCE turns the NULLs from the
    // miss into 0. Email lookups reuse `find_user_id_by_email` from
    // `users.rs` — no duplicate helper here.

    /// Create a PENDING friend request `from_id → to_id`. Returns the
    /// pre-existing relation so the handler can map it to the right
    /// status code (409 already-related, etc.). Idempotent: if a row
    /// already exists in either direction we DON'T overwrite it —
    /// re-requesting an existing/accepted relationship is a no-op that
    /// reports the current state.
    pub fn add_request(&self, from_id: &str, to_id: &str) -> anyhow::Result<Relation> {
        let conn = self.conn_lock();
        let existing = relation_inner(&conn, from_id, to_id)?;
        if existing == Relation::None {
            conn.execute(
                "INSERT INTO friends (user_id, friend_id, status, created_at) \
                 VALUES (?1, ?2, 'pending', datetime('now')) \
                 ON CONFLICT(user_id, friend_id) DO NOTHING",
                params![from_id, to_id],
            )?;
        }
        Ok(existing)
    }

    /// Accept a pending request that `from_id` sent to `me`. Marks the
    /// forward row accepted and inserts/updates the reverse row so both
    /// directed edges read 'accepted'. Returns true when a pending
    /// request actually existed (so the handler can 404 otherwise).
    /// Wrapped in a transaction so we never leave a half-accepted
    /// (one-directional) relationship.
    pub fn accept_request(&self, me: &str, from_id: &str) -> anyhow::Result<bool> {
        let conn = self.conn_lock();
        let tx = conn.unchecked_transaction()?;
        // The pending edge points from the requester to me.
        let updated = tx.execute(
            "UPDATE friends SET status = 'accepted' \
             WHERE user_id = ?1 AND friend_id = ?2 AND status = 'pending'",
            params![from_id, me],
        )?;
        if updated == 0 {
            // No pending request from that user — nothing to accept.
            tx.rollback()?;
            return Ok(false);
        }
        // Insert (or upgrade) the reverse edge so the friendship is
        // mutual and shows up in BOTH users' `GET /friends`.
        tx.execute(
            "INSERT INTO friends (user_id, friend_id, status, created_at) \
             VALUES (?1, ?2, 'accepted', datetime('now')) \
             ON CONFLICT(user_id, friend_id) DO UPDATE SET status = 'accepted'",
            params![me, from_id],
        )?;
        tx.commit()?;
        Ok(true)
    }

    /// Remove a friendship / reject a request in BOTH directions. Used
    /// by `DELETE /friends/:id` for un-friending an accepted friend,
    /// rejecting an incoming request, and cancelling an outgoing one —
    /// all collapse to "drop every edge between these two users".
    /// Idempotent: deleting a non-existent relationship returns 204.
    pub fn remove_friend(&self, a: &str, b: &str) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "DELETE FROM friends \
             WHERE (user_id = ?1 AND friend_id = ?2) \
                OR (user_id = ?2 AND friend_id = ?1)",
            params![a, b],
        )?;
        Ok(())
    }

    /// The relationship state between `me` and `other`, from `me`'s
    /// perspective. Used both by `add_request` (for the status code)
    /// and by the profile endpoint (for `is_friend` /
    /// `friend_request_pending`).
    pub fn relation_of(&self, me: &str, other: &str) -> anyhow::Result<Relation> {
        let conn = self.conn_lock();
        relation_inner(&conn, me, other)
    }

    /// List the caller's ACCEPTED friends with their stats. Backs
    /// `GET /friends`. Ordered by display name then id for a stable
    /// client render. The owner (default friend) shows up here for
    /// everyone by virtue of the seeded mutual friendship.
    pub fn list_accepted_with_stats(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<FriendSummary>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT u.id, u.email, u.display_name, \
                    COALESCE(s.total_xp, 0), \
                    COALESCE(s.current_streak_days, 0), \
                    COALESCE(s.longest_streak_days, 0), \
                    COALESCE(s.lessons_completed, 0), \
                    COALESCE(s.level, 0) \
             FROM friends f \
             JOIN users u ON u.id = f.friend_id \
             LEFT JOIN stats s ON s.user_id = f.friend_id \
             WHERE f.user_id = ?1 AND f.status = 'accepted' \
             ORDER BY u.display_name IS NULL, u.display_name, u.id",
        )?;
        let rows = stmt
            .query_map(params![user_id], |r| {
                Ok(FriendSummary {
                    id: r.get(0)?,
                    email: r.get(1)?,
                    display_name: r.get(2)?,
                    stats: Stats {
                        total_xp: r.get(3)?,
                        current_streak_days: r.get(4)?,
                        longest_streak_days: r.get(5)?,
                        lessons_completed: r.get(6)?,
                        level: r.get(7)?,
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// List pending requests INCOMING to the caller (rows where someone
    /// else is `user_id` and the caller is `friend_id`, status
    /// 'pending'). Backs `GET /friends/requests`.
    pub fn list_incoming_requests(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<FriendRequest>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT u.id, u.email, u.display_name \
             FROM friends f \
             JOIN users u ON u.id = f.user_id \
             WHERE f.friend_id = ?1 AND f.status = 'pending' \
             ORDER BY f.created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![user_id], |r| {
                Ok(FriendRequest {
                    id: r.get(0)?,
                    email: r.get(1)?,
                    display_name: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Friends leaderboard: the caller plus their accepted friends,
    /// ranked by `metric` (xp | streak | lessons) descending. Backs
    /// `GET /leaderboard/friends`. The metric string is mapped to a
    /// fixed column name here (never interpolated raw) so there's no
    /// injection surface.
    pub fn leaderboard_friends(
        &self,
        user_id: &str,
        metric: &str,
    ) -> anyhow::Result<Vec<LeaderboardRow>> {
        let order_col = metric_column(metric);
        let conn = self.conn_lock();
        // Candidate set = caller ∪ accepted friends. UNION dedups the
        // caller if they somehow appear as their own friend.
        let sql = format!(
            "SELECT u.id, u.display_name, \
                    COALESCE(s.total_xp, 0), \
                    COALESCE(s.current_streak_days, 0), \
                    COALESCE(s.longest_streak_days, 0), \
                    COALESCE(s.lessons_completed, 0), \
                    COALESCE(s.level, 0) \
             FROM users u \
             LEFT JOIN stats s ON s.user_id = u.id \
             WHERE u.id = ?1 \
                OR u.id IN ( \
                    SELECT friend_id FROM friends \
                    WHERE user_id = ?1 AND status = 'accepted' \
                ) \
             ORDER BY {order_col} DESC, u.id ASC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![user_id], leaderboard_row_from)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rank(rows))
    }

    /// Global leaderboard: every user ordered by total XP descending,
    /// paginated by `limit`/`offset`. Backs `GET /leaderboard/global`.
    /// Rank is absolute (offset-aware) so page 2 continues the numbering
    /// from page 1.
    pub fn leaderboard_global(
        &self,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<LeaderboardRow>> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT u.id, u.display_name, \
                    COALESCE(s.total_xp, 0), \
                    COALESCE(s.current_streak_days, 0), \
                    COALESCE(s.longest_streak_days, 0), \
                    COALESCE(s.lessons_completed, 0), \
                    COALESCE(s.level, 0) \
             FROM users u \
             LEFT JOIN stats s ON s.user_id = u.id \
             ORDER BY COALESCE(s.total_xp, 0) DESC, u.id ASC \
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt
            .query_map(params![limit, offset], leaderboard_row_from)?
            .collect::<Result<Vec<_>, _>>()?;
        // Offset-aware absolute ranking: first row on page N is
        // `offset + 1`, not 1.
        let ranked = rows
            .into_iter()
            .enumerate()
            .map(|(i, mut row)| {
                row.rank = offset + i as i64 + 1;
                row
            })
            .collect();
        Ok(ranked)
    }

    /// Fetch the raw profile fields + stats for a user, plus the
    /// viewer-relative flags. The handler decides whether to null out
    /// the email; this returns everything and lets the caller redact.
    /// `None` when the user id doesn't exist.
    pub fn profile(
        &self,
        subject_id: &str,
        viewer_id: &str,
    ) -> anyhow::Result<Option<ProfileView>> {
        let conn = self.conn_lock();
        let base = conn
            .query_row(
                "SELECT id, display_name, email, created_at FROM users WHERE id = ?1",
                params![subject_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        // Nullable read: legacy rows may carry NULL (or,
                        // post-migration, '') created_at — a missing
                        // member-since date must never 500 the profile.
                        r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    ))
                },
            )
            .optional()?;
        let (id, display_name, email, created_at) = match base {
            Some(v) => v,
            None => return Ok(None),
        };
        let relation = relation_inner(&conn, viewer_id, subject_id)?;
        let is_self = viewer_id == subject_id;
        let is_friend = relation == Relation::Accepted;
        // "pending" from the viewer's POV covers a request in either
        // direction that hasn't been accepted yet.
        let friend_request_pending = matches!(
            relation,
            Relation::OutgoingPending | Relation::IncomingPending
        );
        let stats = get_stats_inner(&conn, subject_id)?;
        // Email is private: only the user themselves or an accepted
        // friend gets to see it.
        let email_out = if is_self || is_friend { email } else { None };
        Ok(Some(ProfileView {
            id,
            display_name,
            email: email_out,
            created_at,
            stats,
            is_friend,
            friend_request_pending,
        }))
    }

    // ── Default-friend seeding + backfill ─────────────────────────

    /// Find (or create) the owner account by email and return its id.
    /// Called once at startup. The row is minimal — just id + email +
    /// display name — because the owner may never have signed in
    /// through the normal auth flow; the friendship graph still needs a
    /// concrete user row to point at. Idempotent via the `users.email`
    /// UNIQUE constraint + an INSERT-then-select fallback.
    pub fn find_or_create_default_friend(
        &self,
        email: &str,
        display_name: &str,
    ) -> anyhow::Result<String> {
        let conn = self.conn_lock();
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM users WHERE email = ?1",
                params![email],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        // email_verified defaults to 1 (owner account is trusted). No
        // password / provider identity — the row exists purely as a
        // friendship anchor; if the owner later signs in with Google
        // the existing find_or_create_google_user by-email link path
        // attaches the identity onto this same row.
        conn.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?1, ?2, ?3) \
             ON CONFLICT(email) DO NOTHING",
            params![id, email, display_name],
        )?;
        // Re-read in case a concurrent boot / ON CONFLICT kept an
        // existing row instead of our insert.
        let resolved = conn.query_row(
            "SELECT id FROM users WHERE email = ?1",
            params![email],
            |r| r.get::<_, String>(0),
        )?;
        Ok(resolved)
    }

    /// Seed the mutual accepted friendship between a freshly-created
    /// user and the default friend (owner). Called from each of the
    /// three new-user insert paths in `users.rs`. No-op when the
    /// default friend id isn't set yet (pre-startup) or when the new
    /// user IS the default friend. Uses INSERT OR IGNORE both
    /// directions so a re-run can't duplicate or error.
    pub(crate) fn seed_default_friendship(&self, new_user_id: &str) -> anyhow::Result<()> {
        let owner = match self.default_friend_id() {
            Some(o) => o.to_string(),
            None => return Ok(()),
        };
        if owner == new_user_id {
            return Ok(());
        }
        let conn = self.conn_lock();
        insert_mutual_accepted(&conn, &owner, new_user_id)?;
        Ok(())
    }

    /// One-time startup backfill: make every existing user a mutual
    /// accepted friend of the owner. Cheap and idempotent (INSERT OR
    /// IGNORE), so it's safe to run on every boot — after the first
    /// run it inserts nothing. Skips the owner's own row. Returns the
    /// count of users processed for the startup log.
    pub fn backfill_default_friendships(&self, owner_id: &str) -> anyhow::Result<usize> {
        let conn = self.conn_lock();
        let tx = conn.unchecked_transaction()?;
        let ids: Vec<String> = {
            let mut stmt =
                tx.prepare("SELECT id FROM users WHERE id != ?1")?;
            let rows = stmt
                .query_map(params![owner_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        for uid in &ids {
            insert_mutual_accepted(&tx, owner_id, uid)?;
        }
        tx.commit()?;
        Ok(ids.len())
    }
}

/// Map the public metric string to a whitelisted column name. Anything
/// unrecognized (incl. the default/empty case) falls back to XP. This
/// is the ONLY place a metric name reaches SQL, and it can only ever
/// yield one of three constant strings — no injection surface.
fn metric_column(metric: &str) -> &'static str {
    match metric {
        "streak" => "COALESCE(s.current_streak_days, 0)",
        "lessons" => "COALESCE(s.lessons_completed, 0)",
        _ => "COALESCE(s.total_xp, 0)",
    }
}

/// Row mapper shared by the two leaderboard queries. Leaves `rank = 0`;
/// the caller assigns ranks after ordering.
fn leaderboard_row_from(r: &rusqlite::Row<'_>) -> rusqlite::Result<LeaderboardRow> {
    Ok(LeaderboardRow {
        rank: 0,
        user_id: r.get(0)?,
        display_name: r.get(1)?,
        total_xp: r.get(2)?,
        current_streak_days: r.get(3)?,
        longest_streak_days: r.get(4)?,
        lessons_completed: r.get(5)?,
        level: r.get(6)?,
    })
}

/// Assign 1-based ranks to an already-ordered row list (friends
/// leaderboard). The global leaderboard does its own offset-aware
/// numbering.
fn rank(rows: Vec<LeaderboardRow>) -> Vec<LeaderboardRow> {
    rows.into_iter()
        .enumerate()
        .map(|(i, mut row)| {
            row.rank = i as i64 + 1;
            row
        })
        .collect()
}

/// Compute the directed relation of `a` → `b` on an already-held
/// connection. Shared by `relation_of`, `add_request`, and `profile`
/// so the pending-direction logic lives in exactly one place.
fn relation_inner(
    conn: &rusqlite::Connection,
    a: &str,
    b: &str,
) -> anyhow::Result<Relation> {
    // Forward edge: a → b.
    let forward: Option<String> = conn
        .query_row(
            "SELECT status FROM friends WHERE user_id = ?1 AND friend_id = ?2",
            params![a, b],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(status) = forward.as_deref() {
        if status == "accepted" {
            return Ok(Relation::Accepted);
        }
        // A pending forward edge means `a` sent the request.
        return Ok(Relation::OutgoingPending);
    }
    // No forward edge — check the reverse (b → a) for an incoming
    // pending request. (An accepted reverse edge would have a matching
    // accepted forward edge, handled above, so here it can only be
    // pending.)
    let reverse: Option<String> = conn
        .query_row(
            "SELECT status FROM friends WHERE user_id = ?1 AND friend_id = ?2",
            params![b, a],
            |r| r.get(0),
        )
        .optional()?;
    match reverse.as_deref() {
        Some("accepted") => Ok(Relation::Accepted),
        Some(_) => Ok(Relation::IncomingPending),
        None => Ok(Relation::None),
    }
}

/// Read a user's stats on an already-held connection, defaulting to
/// all-zeros. Mirror of `Database::get_stats` for the in-transaction /
/// shared-lock call sites in this module.
fn get_stats_inner(
    conn: &rusqlite::Connection,
    user_id: &str,
) -> anyhow::Result<Stats> {
    let row = conn
        .query_row(
            "SELECT total_xp, current_streak_days, longest_streak_days, \
                    lessons_completed, level \
             FROM stats WHERE user_id = ?1",
            params![user_id],
            |r| {
                Ok(Stats {
                    total_xp: r.get(0)?,
                    current_streak_days: r.get(1)?,
                    longest_streak_days: r.get(2)?,
                    lessons_completed: r.get(3)?,
                    level: r.get(4)?,
                })
            },
        )
        .optional()?;
    Ok(row.unwrap_or_default())
}

/// Insert both directed accepted edges for a friendship. INSERT OR
/// IGNORE so an existing edge (in either direction, any status) is left
/// untouched — we never downgrade an already-established relationship,
/// and re-running is a clean no-op. Works on either a `Connection` or a
/// `Transaction` via the `Deref` both expose to `execute`.
fn insert_mutual_accepted(
    conn: &rusqlite::Connection,
    a: &str,
    b: &str,
) -> anyhow::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) \
         VALUES (?1, ?2, 'accepted', datetime('now'))",
        params![a, b],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) \
         VALUES (?1, ?2, 'accepted', datetime('now'))",
        params![b, a],
    )?;
    Ok(())
}
