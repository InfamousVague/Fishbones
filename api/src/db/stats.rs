//! Gamification-stats query helpers.
//!
//! The `stats` table holds a single denormalized, client-pushed
//! snapshot per user (XP, streaks, lesson count, level). The client
//! computes these locally and pushes the whole record via
//! `PUT /me/stats`; the server never derives them, it just stores the
//! latest for leaderboard + friend-card rendering. See `friends.rs`
//! for the queries that JOIN this table.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::{Database, OptionalExt};

/// The denormalized stats record. All counters are non-negative
/// integers; the client sends every field on each push (wholesale
/// upsert, not a delta). Missing rows read back as all-zeros so a
/// brand-new friend still renders.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Stats {
    pub total_xp: i64,
    pub current_streak_days: i64,
    pub longest_streak_days: i64,
    pub lessons_completed: i64,
    pub level: i64,
}

impl Database {
    /// Upsert the caller's stats snapshot. Idempotent — pushing the
    /// same record twice is a no-op beyond bumping `updated_at`. The
    /// composite of ON CONFLICT + wholesale column replace means the
    /// last writer wins, which matches the client-as-source-of-truth
    /// model (there's no per-field merge to do; the client already
    /// reconciled from its local progress + habit data).
    pub fn upsert_stats(&self, user_id: &str, s: &Stats) -> anyhow::Result<()> {
        let conn = self.conn_lock();
        conn.execute(
            "INSERT INTO stats \
                 (user_id, total_xp, current_streak_days, longest_streak_days, \
                  lessons_completed, level, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now')) \
             ON CONFLICT(user_id) DO UPDATE SET \
                 total_xp = excluded.total_xp, \
                 current_streak_days = excluded.current_streak_days, \
                 longest_streak_days = excluded.longest_streak_days, \
                 lessons_completed = excluded.lessons_completed, \
                 level = excluded.level, \
                 updated_at = excluded.updated_at",
            params![
                user_id,
                s.total_xp,
                s.current_streak_days,
                s.longest_streak_days,
                s.lessons_completed,
                s.level,
            ],
        )?;
        Ok(())
    }

    /// Fetch a user's stats. Returns `Stats::default()` (all-zeros)
    /// when no row exists yet so callers never have to special-case a
    /// friend who hasn't pushed stats.
    pub fn get_stats(&self, user_id: &str) -> anyhow::Result<Stats> {
        let conn = self.conn_lock();
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
}
