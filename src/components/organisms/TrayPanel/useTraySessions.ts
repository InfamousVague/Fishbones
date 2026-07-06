/// Multi-session storage for the macOS menu-bar popover.
///
/// The tray maintains a list of past conversations, each with a
/// fresh chat hook keyed by its session id. Switching sessions
/// remounts the chat surface via React's `key` prop, which the
/// hook reads as `initialMessages` to repopulate state. Storage
/// is localStorage scoped to a single key — small enough to fit
/// (one session is typically <2KB of message text); the cap below
/// keeps the total under a few hundred KB even with chatty users.
///
/// Session shape is intentionally tiny — id, name, mode, the
/// message log, and a `updatedAt` timestamp for "recent first"
/// ordering. No metadata about the active session is stored on
/// the session itself; the `activeId` is in its own key so a
/// rename / message-append doesn't have to re-walk the array
/// to flip a flag.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/hooks/useAiChat";
import type { AgentMessage } from "@/hooks/useAiAgent";

/// Union of message shapes the tray persists. A session stores
/// whichever variant matches its `mode`: chat sessions hold
/// `ChatMessage` rows, agent sessions hold `AgentMessage` rows
/// (which can include tool-call and tool-result entries). The
/// consumer (`TraySurface`) narrows by mode when threading the
/// log into the appropriate hook.
export type TrayMessage = ChatMessage | AgentMessage;

export interface TraySession {
  id: string;
  /// Display name. Auto-derived from the first user message
  /// (first ~30 chars) the first time a session gets one;
  /// otherwise "New chat" with a sequence number.
  name: string;
  /// Which surface this session belongs to — chat vs agent.
  /// Switching mode swaps to the most-recently-used session of
  /// that mode (or creates one if none).
  mode: "chat" | "agent";
  messages: TrayMessage[];
  updatedAt: number;
}

/// Number of sessions to keep. Past this point we evict the
/// oldest (LRU by `updatedAt`) — prevents localStorage from
/// growing unbounded if the user never explicitly trims.
const MAX_SESSIONS = 20;

const STORAGE_KEY = "libre:tray-sessions";
const ACTIVE_KEY = "libre:tray-active-session";

interface TraySessionsState {
  sessions: TraySession[];
  activeId: string | null;
}

function loadStored(): TraySessionsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const sessions: TraySession[] = raw ? JSON.parse(raw) : [];
    const activeId = localStorage.getItem(ACTIVE_KEY);
    return { sessions, activeId };
  } catch {
    return { sessions: [], activeId: null };
  }
}

function persist(state: TraySessionsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
    if (state.activeId) {
      localStorage.setItem(ACTIVE_KEY, state.activeId);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    /* private-mode / storage full — drop silently */
  }
}

/// `crypto.randomUUID` is in WKWebView since 2022 + every modern
/// browser, but we still fall back to a timestamp-based id in case
/// the runtime is somehow missing it (older WKWebView in jailed
/// contexts). Collision risk in the fallback is trivial — the tray
/// keeps a handful of sessions, not millions.
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/// Default session names are stored as i18n KEYS (this module is a
/// plain hook with no `t()` access at creation time) — the sessions
/// menu resolves them via `t()` at render, and user-derived names
/// pass through `t()`'s missing-key fallback untouched.
const NEW_AGENT_NAME_KEY = "ai.newAgentTaskName";
const NEW_CHAT_NAME_KEY = "ai.newChatName";

function deriveName(messages: TrayMessage[], mode: "chat" | "agent"): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) {
    const text = firstUser.content.trim().replace(/\s+/g, " ");
    if (text.length > 0) {
      return text.length > 36 ? text.slice(0, 33) + "…" : text;
    }
  }
  return mode === "agent" ? NEW_AGENT_NAME_KEY : NEW_CHAT_NAME_KEY;
}

export interface UseTraySessions {
  /// All sessions, freshest first.
  sessions: TraySession[];
  /// Currently active session — never null in practice; the hook
  /// auto-creates one if storage is empty.
  active: TraySession;
  /// Switch to an existing session. The chat surface remounts via
  /// `key={active.id}` so the hook reads the new session's
  /// `messages` as initial state.
  selectSession: (id: string) => void;
  /// Spin up a fresh empty session for the given mode and activate
  /// it. The previous session stays in the list until evicted by
  /// LRU at MAX_SESSIONS.
  newSession: (mode: "chat" | "agent") => void;
  /// Drop a session from the list. If the active session is
  /// deleted, the next-most-recent of the same mode becomes
  /// active (or a brand new one if none).
  deleteSession: (id: string) => void;
  /// Update the active session's stored snapshot. Called by the
  /// tray whenever the chat hook's messages change so the
  /// session's name + log stay in sync.
  syncActive: (messages: TrayMessage[]) => void;
  /// Switch modes while preserving sessions. Picks the most
  /// recent session of the target mode, or creates one.
  setMode: (mode: "chat" | "agent") => void;
}

export function useTraySessions(): UseTraySessions {
  const [state, setState] = useState<TraySessionsState>(() => {
    const stored = loadStored();
    if (stored.sessions.length === 0) {
      // Cold start — seed with one default agent session so the
      // first paint has something to attach to.
      const seed: TraySession = {
        id: newId(),
        name: NEW_AGENT_NAME_KEY,
        mode: "agent",
        messages: [],
        updatedAt: Date.now(),
      };
      return { sessions: [seed], activeId: seed.id };
    }
    // If activeId points at a missing session (cleared via dev
    // tools etc.), fall back to the most-recently-updated entry.
    const activeId =
      stored.activeId && stored.sessions.some((s) => s.id === stored.activeId)
        ? stored.activeId
        : [...stored.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    return { sessions: stored.sessions, activeId };
  });

  useEffect(() => {
    persist(state);
  }, [state]);

  const active = useMemo(() => {
    const found = state.sessions.find((s) => s.id === state.activeId);
    // Active is guaranteed to exist by the initializer + the
    // deleteSession logic, but TS doesn't know that — return a
    // safe fallback. In practice this branch never fires.
    return (
      found ?? {
        id: "missing",
        name: NEW_CHAT_NAME_KEY,
        mode: "agent" as const,
        messages: [] as TrayMessage[],
        updatedAt: Date.now(),
      }
    );
  }, [state]);

  const selectSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const newSession = useCallback((mode: "chat" | "agent") => {
    setState((prev) => {
      const fresh: TraySession = {
        id: newId(),
        name: mode === "agent" ? NEW_AGENT_NAME_KEY : NEW_CHAT_NAME_KEY,
        mode,
        messages: [],
        updatedAt: Date.now(),
      };
      const next = [fresh, ...prev.sessions].slice(0, MAX_SESSIONS);
      return { sessions: next, activeId: fresh.id };
    });
  }, []);

  const deleteSession = useCallback((id: string) => {
    setState((prev) => {
      const next = prev.sessions.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh: TraySession = {
          id: newId(),
          name: NEW_AGENT_NAME_KEY,
          mode: "agent",
          messages: [],
          updatedAt: Date.now(),
        };
        return { sessions: [fresh], activeId: fresh.id };
      }
      let activeId = prev.activeId;
      if (activeId === id) {
        // Pick the freshest session of the same mode the deleted
        // session belonged to. Falls through to the freshest of
        // any mode if none match.
        const deletedMode = prev.sessions.find((s) => s.id === id)?.mode;
        const sameMode = next
          .filter((s) => s.mode === deletedMode)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        activeId = (sameMode[0] ?? next[0]).id;
      }
      return { sessions: next, activeId };
    });
  }, []);

  const syncActive = useCallback((messages: TrayMessage[]) => {
    setState((prev) => {
      const idx = prev.sessions.findIndex((s) => s.id === prev.activeId);
      if (idx === -1) return prev;
      const current = prev.sessions[idx];
      // Skip the write when nothing changed — avoids re-renders +
      // localStorage churn while the user is just idling on the
      // panel with the same conversation visible.
      if (current.messages === messages || messagesEqual(current.messages, messages)) {
        return prev;
      }
      const updated: TraySession = {
        ...current,
        messages,
        name:
          current.name === NEW_CHAT_NAME_KEY ||
          current.name === NEW_AGENT_NAME_KEY ||
          // Legacy sessions persisted before the defaults moved to
          // i18n keys stored the literal English names.
          current.name === "New chat" ||
          current.name === "New agent task"
            ? deriveName(messages, current.mode)
            : current.name,
        updatedAt: Date.now(),
      };
      const next = prev.sessions.slice();
      next[idx] = updated;
      // Promote freshly-updated session to the top of the list so
      // the dropdown reads in recency order without re-sorting at
      // render time.
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ...prev, sessions: next };
    });
  }, []);

  const setMode = useCallback((mode: "chat" | "agent") => {
    setState((prev) => {
      const current = prev.sessions.find((s) => s.id === prev.activeId);
      if (current && current.mode === mode) return prev;
      const target = prev.sessions
        .filter((s) => s.mode === mode)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (target) {
        return { ...prev, activeId: target.id };
      }
      // No existing session of that mode — create one.
      const fresh: TraySession = {
        id: newId(),
        name: mode === "agent" ? NEW_AGENT_NAME_KEY : NEW_CHAT_NAME_KEY,
        mode,
        messages: [],
        updatedAt: Date.now(),
      };
      const next = [fresh, ...prev.sessions].slice(0, MAX_SESSIONS);
      return { sessions: next, activeId: fresh.id };
    });
  }, []);

  return { sessions: state.sessions, active, selectSession, newSession, deleteSession, syncActive, setMode };
}

/// Shallow equality check for two message arrays — same length +
/// same role/content at every index. Lets `syncActive` skip the
/// state-update when the chat hook fires a re-render with the
/// same message log (common during streaming when the assistant
/// chunk arrived but other state didn't).
function messagesEqual(a: TrayMessage[], b: TrayMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai.role !== bi.role) return false;
    // `tool` rows don't carry a `content` for comparison purposes
    // — match by role + toolCallId for those, and by content for
    // everything else. Good enough for the "did anything change
    // since the last save" check this function backs.
    if (ai.role === "tool" || bi.role === "tool") {
      if (ai.role !== "tool" || bi.role !== "tool") return false;
      if (ai.toolCallId !== bi.toolCallId) return false;
      if (ai.content !== bi.content) return false;
      continue;
    }
    if (ai.content !== bi.content) return false;
  }
  return true;
}
