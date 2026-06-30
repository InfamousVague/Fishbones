import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  resolveEffortParams,
  type AiAgentSettings,
} from "@/lib/aiAgent/settings";

/// Chat-with-local-LLM hook. Talks to the Rust `ai_chat_stream` command
/// which in turn streams from the user's Ollama daemon. The hook owns
/// the conversation state + token-streaming plumbing; the UI just
/// renders `messages` and calls `send()`.
///
/// Streaming contract: `ai_chat_stream` returns immediately after
/// dispatching the request, then fires:
///   * `ai-chat-chunk:<stream_id>` — one per generated token.
///   * `ai-chat-done:<stream_id>`  — terminator with stats.
///   * `ai-chat-error:<stream_id>` — one-shot error carrier.
///
/// Each `send()` mints a fresh stream id so concurrent sends (rare,
/// but the character can fire a side-chat from a quiz hint while the
/// main convo is streaming) don't crosstalk.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /// Optional LLM-only payload that replaces `content` when the
  /// message is shipped to the model. Used by callers that
  /// bolster the user's wording with framing the user shouldn't
  /// have to see in their own bubble — the lesson reader's "ask
  /// about this code" / "walk me through this quiz" flows, the
  /// quiz view's hint button, etc. The chat panel always renders
  /// `content`; the `send()` path unwraps `augmented` (when
  /// present) into the wire-format `content` so the LLM receives
  /// the framed version.
  augmented?: string;
}

export interface ProbeResult {
  reachable: boolean;
  models: string[];
  hasDefaultModel: boolean;
  error: string | null;
}

export interface InstallStatus {
  ollamaInstalled: boolean;
  homebrewInstalled: boolean;
}

export interface InstallResult {
  success: boolean;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface UseAiChat {
  messages: ChatMessage[];
  streaming: boolean;
  /// Transient error from the last send(). Cleared on next send().
  error: string | null;
  /// Send a new user message into the chat.
  ///
  /// `prompt` is what the chat panel renders in the user's
  /// bubble — typically what the user typed verbatim.
  /// `systemPrompt` is an optional one-shot system prefix.
  /// `augmented` (optional) is an alternate payload sent to the
  /// LLM in place of `prompt`. Used by callers that bolster the
  /// user's wording with framing the user shouldn't have to read
  /// — e.g. lesson reader's "Explain this code" button
  /// pre-wraps the snippet in workflow instructions for the
  /// model. When omitted, the LLM sees `prompt` verbatim.
  send: (
    prompt: string,
    systemPrompt?: string,
    augmented?: string,
  ) => Promise<void>;
  reset: () => void;
  /// Probes the Ollama daemon. Useful for the first-run banner; the
  /// hook also calls it automatically on mount so `probe` in state is
  /// populated without the UI wiring its own effect.
  probe: ProbeResult | null;
  refreshProbe: () => Promise<void>;
  /// Whether the `ollama` binary is on PATH at all. Drives whether
  /// the setup banner shows "Install Ollama" (binary missing) vs
  /// "Start Ollama" (binary present but daemon not reachable).
  installStatus: InstallStatus | null;
  /// Setup actions. Each returns the captured InstallResult so the
  /// panel can render success/failure inline. After each completes
  /// the hook re-runs the probe + status check so the banner
  /// transitions to the next step automatically.
  installOllama: () => Promise<InstallResult>;
  startOllama: () => Promise<InstallResult>;
  pullModel: () => Promise<InstallResult>;
  /// True while one of the install actions above is in flight. Lets
  /// the banner disable the buttons + render a spinner without each
  /// caller maintaining its own state.
  setupBusy: boolean;
  /// Swap the message log to a previously-saved snapshot — used by
  /// the session picker to load a different conversation into the
  /// SAME hook instance (no remount). Aborts any in-flight stream
  /// first so the new conversation starts from a clean state.
  loadMessages: (messages: ChatMessage[]) => void;
}

/// Map serialized event name → random-but-cheap id that makes
/// concurrent sends safe. Incremented on every send.
let nextStreamId = 1;

/// Local hook — Tauri-IPC path that streams from the user's
/// localhost Ollama daemon. Renamed from the original `useAiChat`
/// so the new top-level export below can pick between this and the
/// remote variant at module load.
export function useAiChatLocal(
  model?: string,
  /// "Effort" rung — fast / balanced / thorough / ultra. Resolved to
  /// Ollama sampling/context knobs and forwarded with every send so
  /// chat respects the same quality dial as the agent loop. Omitting
  /// it keeps Ollama's own defaults (pre-effort behaviour).
  effort?: AiAgentSettings["effort"],
  /// Optional starting messages — used by the tray to restore a
  /// previously-saved session when the user switches between
  /// stored chats. State initialization only runs once per mount;
  /// remount via React `key={sessionId}` to swap conversations.
  initialMessages?: ChatMessage[],
): UseAiChat {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? [],
  );
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);

  const refreshProbe = useCallback(async () => {
    // Run both checks in parallel — the install-status probe is
    // filesystem-only and finishes in milliseconds; the daemon
    // probe has a 3s timeout when Ollama isn't reachable. Awaiting
    // them sequentially would gate the fast result on the slow one.
    const probeReq = invoke<{
      reachable: boolean;
      models: string[];
      has_default_model: boolean;
      error: string | null;
    }>("ai_chat_probe", { modelHint: model ?? null });
    const statusReq = invoke<{
      ollama_installed: boolean;
      homebrew_installed: boolean;
    }>("ai_chat_install_status");
    try {
      const raw = await probeReq;
      setProbe({
        reachable: raw.reachable,
        models: raw.models,
        hasDefaultModel: raw.has_default_model,
        error: raw.error,
      });
    } catch (e) {
      setProbe({
        reachable: false,
        models: [],
        hasDefaultModel: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      const s = await statusReq;
      setInstallStatus({
        ollamaInstalled: s.ollama_installed,
        homebrewInstalled: s.homebrew_installed,
      });
    } catch {
      setInstallStatus({ ollamaInstalled: false, homebrewInstalled: false });
    }
  }, [model]);

  useEffect(() => {
    void refreshProbe();
  }, [refreshProbe]);

  const runSetup = useCallback(
    async (cmd: string, args?: Record<string, unknown>): Promise<InstallResult> => {
      setSetupBusy(true);
      try {
        const r = await invoke<InstallResult>(cmd, args ?? {});
        // Re-probe after each setup step so the banner advances
        // to the next missing piece (or disappears if everything
        // resolved). Errors during the action are returned to the
        // caller — they're rendered inline beneath the button.
        await refreshProbe();
        return r;
      } finally {
        setSetupBusy(false);
      }
    },
    [refreshProbe],
  );

  const installOllama = useCallback(
    () => runSetup("ai_chat_install_ollama"),
    [runSetup],
  );
  const startOllama = useCallback(
    () => runSetup("ai_chat_start_ollama"),
    [runSetup],
  );
  const pullModel = useCallback(
    () => runSetup("ai_chat_pull_model", { model: model ?? null }),
    [runSetup, model],
  );

  // Keep the live stream's unlisten fns reachable so `reset()` can
  // cancel a mid-flight reply cleanly. The ref holds the cleanup
  // function produced by the latest `send` call; nulled after each
  // stream completes.
  const activeUnlistenRef = useRef<(() => void) | null>(null);

  const reset = useCallback(() => {
    activeUnlistenRef.current?.();
    activeUnlistenRef.current = null;
    setMessages([]);
    setStreaming(false);
    setError(null);
  }, []);

  /// Hot-swap the conversation log. Cancels any active stream
  /// (so a half-rendered assistant chunk doesn't carry over into
  /// the loaded conversation), clears error state, replaces the
  /// messages. Used by the in-app session picker; the tray's
  /// session picker uses a key-driven remount instead.
  const loadMessages = useCallback((msgs: ChatMessage[]) => {
    activeUnlistenRef.current?.();
    activeUnlistenRef.current = null;
    setMessages(msgs);
    setStreaming(false);
    setError(null);
  }, []);

  const send = useCallback(
    async (prompt: string, systemPrompt?: string, augmented?: string) => {
      if (streaming) return; // caller should gate; defensive
      setError(null);

      const streamId = `c${nextStreamId++}`;
      // The user message in STATE carries `content` (what the
      // chat panel shows) AND optionally `augmented` (what the
      // LLM receives). The wire-format payload below unwraps
      // `augmented` so the model never sees the `augmented`
      // field directly — it just sees the framed text on
      // `content`. Subsequent turns reading the conversation
      // history pull from state and re-unwrap, so the model's
      // view of the conversation stays consistent across turns.
      const userMsg: ChatMessage =
        augmented && augmented.trim() !== prompt.trim()
          ? { role: "user", content: prompt, augmented }
          : { role: "user", content: prompt };
      // Snapshot for the IPC payload BEFORE setState — React batches
      // state updates, so `messages` inside the closure is the stale
      // value. We pass the full history explicitly.
      const systemPart: ChatMessage[] = systemPrompt
        ? [{ role: "system", content: systemPrompt }]
        : [];
      const outbound = [...systemPart, ...messages, userMsg].map((m) =>
        m.role === "user" && m.augmented
          ? { role: m.role, content: m.augmented }
          : { role: m.role, content: m.content },
      );
      setMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
      setStreaming(true);

      let unChunk: UnlistenFn | undefined;
      let unDone: UnlistenFn | undefined;
      let unErr: UnlistenFn | undefined;

      const cleanup = () => {
        unChunk?.();
        unDone?.();
        unErr?.();
        activeUnlistenRef.current = null;
      };

      try {
        unChunk = await listen<{ token: string }>(
          `ai-chat-chunk:${streamId}`,
          (ev) => {
            setMessages((m) => {
              // Append to the last assistant message. Copy-on-write
              // so React sees a new array + new object.
              const next = m.slice();
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + ev.payload.token,
                };
              }
              return next;
            });
          },
        );
        unDone = await listen(`ai-chat-done:${streamId}`, () => {
          setStreaming(false);
          cleanup();
        });
        unErr = await listen<{ error: string }>(
          `ai-chat-error:${streamId}`,
          (ev) => {
            setError(ev.payload.error);
            setStreaming(false);
            // Drop the pending empty assistant bubble — otherwise the
            // UI leaves a stranded placeholder.
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last && last.role === "assistant" && last.content === "") {
                return m.slice(0, -1);
              }
              return m;
            });
            cleanup();
          },
        );

        activeUnlistenRef.current = cleanup;

        // Resolve the effort rung to Ollama knobs. Tauri snake_cases
        // the JS keys, so `numCtx` → `num_ctx` on the Rust command.
        // `undefined` keys are dropped from the IPC payload, leaving
        // Ollama on its defaults when no effort is set.
        const eff = effort ? resolveEffortParams(effort) : null;
        await invoke("ai_chat_stream", {
          streamId,
          messages: outbound,
          model: model ?? null,
          temperature: eff?.temperature,
          numCtx: eff?.num_ctx,
          numPredict: eff?.num_predict,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStreaming(false);
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last && last.role === "assistant" && last.content === "") {
            return m.slice(0, -1);
          }
          return m;
        });
        cleanup();
      }
    },
    [messages, model, streaming, effort],
  );

  // Best-effort cleanup on unmount so a long-running stream doesn't
  // leave listeners registered on the Tauri side.
  useEffect(() => {
    return () => {
      activeUnlistenRef.current?.();
    };
  }, []);

  return {
    messages,
    streaming,
    error,
    send,
    reset,
    probe,
    refreshProbe,
    installStatus,
    installOllama,
    startOllama,
    pullModel,
    setupBusy,
    loadMessages,
  };
}

/// Picked at module load — same hook for the entire React tree's
/// lifetime. We can't conditionally call hooks per render (rules of
/// hooks), but assigning the chosen implementation to a const ONCE
/// at import time and re-exporting it preserves call-order
/// stability: every render of every consumer goes through the same
/// hook function, just one that was selected ahead of time.
///
/// Mobile (`window.innerWidth < 768`) and the web target have no
/// localhost Ollama to talk to — iOS won't let you run a daemon,
/// and the web build runs in a normal browser tab without Tauri
/// IPC at all. Both fall through to the remote hook which talks to
/// a user-configured Ollama HTTP host (typically a Mac on the
/// user's Tailscale tailnet — see `src/lib/aiHost.ts`).
//
// We import inside the picker so the local hook's `@tauri-apps/api`
// imports don't load on the web bundle (Vite's tree-shake handles
// the dead branch, but importing at the top is what creates the
// initial load — we want zero Tauri code in dist-web's main chunk).
import { useAiChatRemote } from "./useAiChatRemote";
import { isMobile, isWeb } from "@/lib/platform";

const pickedHook: typeof useAiChatLocal = (isMobile || isWeb)
  ? useAiChatRemote
  : useAiChatLocal;

export const useAiChat = pickedHook;
