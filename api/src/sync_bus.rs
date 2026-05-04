//! Per-user broadcast bus for real-time sync.
//!
//! Every authenticated WebSocket client subscribes to a `tokio::sync::
//! broadcast` channel keyed by their user id. When any HTTP write
//! endpoint (progress / solutions / settings) successfully applies
//! a change, it publishes a `SyncEvent` into that user's channel and
//! every connected device receives the JSON payload over its socket.
//!
//! Lifecycle: senders are created lazily on first `subscribe()` and
//! live as long as at least one subscriber holds a `Receiver`. The
//! bus uses `DashMap` (already a dep) so concurrent subscribers /
//! publishers don't serialize through a single mutex.
//!
//! Capacity per channel is bounded; a slow consumer that lags past
//! the buffer just drops events with a `RecvError::Lagged` and the
//! client reconciles by re-issuing a GET on reconnect. This is the
//! right tradeoff for a learner sync: the on-disk DB is the source
//! of truth — the bus is purely a cache-busting signal.

use crate::db::{ProgressRow, SettingRow, SolutionRow};
use dashmap::DashMap;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Cross-device sync event. Tagged on the wire as
/// `{"type":"progress", "rows":[...]}` etc. so the client picks the
/// right reducer without sniffing the shape.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncEvent {
    Progress { rows: Vec<ProgressRow> },
    Solutions { rows: Vec<SolutionRow> },
    Settings { rows: Vec<SettingRow> },
}

/// Per-user broadcast bus. Cheap clones (it's just an `Arc`).
#[derive(Clone, Default)]
pub struct SyncBus {
    inner: Arc<DashMap<String, broadcast::Sender<SyncEvent>>>,
}

impl SyncBus {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
        }
    }

    /// Subscribe a new device to a user's bus. Creates the sender
    /// lazily on the first subscriber. Returns the receiver — the
    /// caller is expected to drive a select loop draining events
    /// onto its WebSocket sink.
    pub fn subscribe(&self, user_id: &str) -> broadcast::Receiver<SyncEvent> {
        let entry = self
            .inner
            .entry(user_id.to_string())
            .or_insert_with(|| broadcast::channel(64).0);
        entry.subscribe()
    }

    /// Publish an event to every device subscribed for this user.
    /// Silently no-ops when the channel has zero subscribers (no
    /// devices online for that user) — `broadcast::Sender::send`
    /// returns Err in that case but it isn't a real failure.
    pub fn publish(&self, user_id: &str, event: SyncEvent) {
        if let Some(tx) = self.inner.get(user_id) {
            let _ = tx.send(event);
        }
    }
}
