/// Remote variant of `useAiChat` for the mobile / web targets.
///
/// Same return surface as `useAiChatLocal` (Tauri-IPC → local Ollama),
/// but the transport is plain `fetch` to a user-configured Ollama
/// host — typically a Mac on the user's Tailscale tailnet. The
/// install / setup actions don't apply here (we can't `brew install
/// ollama` on a phone), so they no-op into a failure result the UI
/// can render as "set this up on your Mac" rather than offering a
/// button that wouldn't work.
///
/// Streaming uses Ollama's `stream: true` chat API, which emits one
/// JSON object per line over a chunked-transfer body. We assemble
/// chunks into ChatMessage state the same way the local hook does
/// — the UI doesn't care which transport delivered the tokens.

import { useCallback, useEffect, useRef, useState } from "react";
import { aiHostUrl, readAiHost } from "@/lib/aiHost";
import { DEFAULT_MODEL_ID, isModelInstalled } from "@/lib/ai/models";
import { resolveEffortParams, type AiAgentSettings } from "@/lib/aiAgent/settings";
import type {
  ChatMessage,
  InstallResult,
  InstallStatus,
  ProbeResult,
  UseAiChat,
} from "./useAiChat";

/// Default model — the single source of truth in `lib/ai/models.ts`
/// (which itself mirrors `DEFAULT_MODEL` in `src-tauri/src/ai_chat.rs`).
/// Override per-call once the user picks a different model.
const DEFAULT_MODEL = DEFAULT_MODEL_ID;

/// Probe timeout. The local hook uses 3s in Rust; we match that here
/// so a "host configured but unreachable" state surfaces quickly
/// instead of holding the alert dot for 15s.
const PROBE_TIMEOUT_MS = 3000;

/// Build the failure-shape InstallResult we return when the user
/// hits an install / start / pull button on the mobile UI. The text
/// reads as actionable guidance, not a backend error.
function unsupportedInstallResult(action: string): InstallResult {
  return {
    success: false,
    stdout: "",
    stderr: `${action} isn't available from the phone — run it on the Mac that hosts Ollama, then re-probe via the chat panel's retry button.`,
    duration_ms: 0,
  };
}

export function useAiChatRemote(
  model?: string,
  /// "Effort" rung — resolved to Ollama options and sent on the
  /// `/api/chat` body so the remote (web / mobile) path respects the
  /// same quality dial as desktop. Signature-parity with
  /// `useAiChatLocal` so the picker in useAiChat.ts typechecks.
  effort?: AiAgentSettings["effort"],
  /// Optional starting messages — kept signature-parity with
  /// `useAiChatLocal`. The remote variant is used on web / mobile
  /// where the tray's session feature doesn't run.
  initialMessages?: ChatMessage[],
): UseAiChat {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? [],
  );
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  /// AbortController for the active stream — lets `reset()` and
  /// component unmount cancel a long completion mid-flight rather
  /// than letting the network read run to its natural end.
  const abortRef = useRef<AbortController | null>(null);

  const refreshProbe = useCallback(async () => {
    const url = aiHostUrl("/api/tags");
    if (!url) {
      setProbe({
        reachable: false,
        models: [],
        hasDefaultModel: false,
        error: "AI host not configured. Set it in Settings.",
      });
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) {
        setProbe({
          reachable: false,
          models: [],
          hasDefaultModel: false,
          error: `Ollama returned ${r.status}`,
        });
        return;
      }
      const body = (await r.json()) as { models?: Array<{ name: string }> };
      const names = (body.models ?? []).map((m) => m.name);
      const wanted = model ?? DEFAULT_MODEL;
      // Tag-aware match (shared with the registry + Rust probe) so a
      // `qwen2.5-coder:7b` config matches a pull stored as
      // `qwen2.5-coder:7b:latest` and vice versa.
      const has = isModelInstalled(wanted, names);
      setProbe({
        reachable: true,
        models: names,
        hasDefaultModel: has,
        error: null,
      });
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? `Timed out talking to ${readAiHost() ?? "the AI host"}. Is the daemon running and reachable on the tailnet?`
          : e instanceof Error
            ? e.message
            : String(e);
      setProbe({
        reachable: false,
        models: [],
        hasDefaultModel: false,
        error: msg,
      });
    } finally {
      window.clearTimeout(t);
    }
  }, [model]);

  useEffect(() => {
    void refreshProbe();
    // Re-probe when the host config changes from another tab / a
    // settings save in this tab. localStorage's `storage` event
    // fires on cross-tab writes; same-tab writes fire a custom
    // event we dispatch from `writeAiHost` consumers (the settings
    // dialog).
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "libre:ai-host") void refreshProbe();
    };
    const onCustom = () => void refreshProbe();
    window.addEventListener("storage", onStorage);
    window.addEventListener("libre:ai-host-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("libre:ai-host-changed", onCustom);
    };
  }, [refreshProbe]);

  const send = useCallback(
    async (prompt: string, systemPrompt?: string, augmented?: string) => {
      const url = aiHostUrl("/api/chat");
      if (!url) {
        setError(
          "AI host isn't configured. Open Settings → Assistant host to set the address of the Mac running Ollama.",
        );
        return;
      }

      // Cancel any prior in-flight stream — clicking send mid-stream
      // means the user wants to start a new turn, not interleave
      // tokens from two completions.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setError(null);
      setStreaming(true);

      // Record the user turn first so the conversation history we
      // send INCLUDES the prompt (Ollama wants the full back-and-forth).
      // `setMessages` returns the previous list synchronously via the
      // updater fn, so we capture it for the request body.
      //
      // `augmented` (when present) is what the LLM receives in place
      // of the displayed text. Same split as the local hook: the
      // chat panel renders `content`; the model receives the
      // augmented version. The wire payload below unwraps it.
      let history: ChatMessage[] = [];
      const userMsg: ChatMessage =
        augmented && augmented.trim() !== prompt.trim()
          ? { role: "user", content: prompt, augmented }
          : { role: "user", content: prompt };
      setMessages((prev) => {
        history = [...prev, userMsg];
        return history;
      });

      // Append a placeholder assistant message we'll fill as tokens
      // arrive. Doing it up front gives the panel a "the model is
      // typing" affordance immediately on send rather than after the
      // first token, which can be ~500ms on a remote Tailscale hop.
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reqMessages: ChatMessage[] = [];
      if (systemPrompt) {
        reqMessages.push({ role: "system", content: systemPrompt });
      }
      // Unwrap any `augmented` payloads before sending to the wire.
      // The model never sees the `augmented` field on the message
      // shape — it gets the augmented text on `content`.
      for (const m of history) {
        reqMessages.push(
          m.role === "user" && m.augmented
            ? { role: m.role, content: m.augmented }
            : m,
        );
      }

      try {
        // Effort knobs go straight into Ollama's `options` block
        // (snake_case, the native /api/chat shape). Omitted when no
        // effort is set so the host model keeps its own defaults.
        const eff = effort ? resolveEffortParams(effort) : null;
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: model ?? DEFAULT_MODEL,
            messages: reqMessages,
            stream: true,
            ...(eff
              ? {
                  options: {
                    temperature: eff.temperature,
                    num_ctx: eff.num_ctx,
                    num_predict: eff.num_predict,
                  },
                }
              : {}),
          }),
          signal: ctrl.signal,
        });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`Ollama returned ${r.status}: ${body.slice(0, 200)}`);
        }
        if (!r.body) throw new Error("Ollama returned an empty body");

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        // Ollama streams one JSON object per LINE, but a chunk may
        // carry a partial line at its tail. Buffer until we see
        // newlines, parse each complete line.
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            nl = buf.indexOf("\n");
            if (!line) continue;
            try {
              const obj = JSON.parse(line) as {
                message?: { content?: string };
                done?: boolean;
                error?: string;
              };
              if (obj.error) {
                throw new Error(obj.error);
              }
              const tok = obj.message?.content;
              if (tok) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (!last || last.role !== "assistant") return prev;
                  const updated: ChatMessage = {
                    role: "assistant",
                    content: last.content + tok,
                  };
                  return [...prev.slice(0, -1), updated];
                });
              }
              if (obj.done) {
                // Drain remaining lines anyway — the loop will exit
                // on the next reader.read() when the body closes.
              }
            } catch (parseErr) {
              // A malformed line is non-fatal — log + continue.
              console.warn(
                "[useAiChatRemote] failed to parse stream line:",
                parseErr instanceof Error ? parseErr.message : parseErr,
              );
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // User-initiated cancel — quietly drop the in-flight
          // assistant message so the UI doesn't show a half-finished
          // "the model is typing" bubble.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          // Replace the empty assistant placeholder with an inline
          // error so the conversation still reads coherently.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content) {
              return [
                ...prev.slice(0, -1),
                { role: "assistant", content: `_Error: ${msg}_` },
              ];
            }
            return prev;
          });
        }
      } finally {
        setStreaming(false);
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [model, effort],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setStreaming(false);
  }, []);

  // Phone install / start / pull — no-ops with actionable error
  // bodies. The chat panel can render the stderr inline; that's
  // good enough for a hint without a custom mobile-only setup card.
  const installStatus: InstallStatus | null = null;
  const setupBusy = false;
  const installOllama = useCallback(
    async () => unsupportedInstallResult("Installing Ollama"),
    [],
  );
  const startOllama = useCallback(
    async () => unsupportedInstallResult("Starting the Ollama daemon"),
    [],
  );
  const pullModel = useCallback(
    async () => unsupportedInstallResult("Pulling a model"),
    [],
  );

  /// Hot-swap conversation log (parity with `useAiChatLocal`).
  /// Aborts any in-flight network read first so the new
  /// conversation starts from a clean slate.
  const loadMessages = useCallback((msgs: ChatMessage[]) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages(msgs);
    setStreaming(false);
    setError(null);
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
