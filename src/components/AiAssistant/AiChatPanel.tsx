import { useEffect, useRef, useState } from "react";
// useState already imported — used by the panel root + the
// SetupBanner's lastResult log.
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import { Card } from "@base/primitives/card";
import "@base/primitives/card/card.css";
import type {
  ChatMessage,
  ProbeResult,
  InstallStatus,
  InstallResult,
} from "../../hooks/useAiChat";
import { renderMarkdown } from "../Lesson/markdown";
import FishbonesLoader from "../Shared/FishbonesLoader";
import "./AiChatPanel.css";

interface Props {
  open: boolean;
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  probe: ProbeResult | null;
  installStatus: InstallStatus | null;
  setupBusy: boolean;
  onSend: (prompt: string) => void;
  onClose: () => void;
  onReset: () => void;
  onRetryProbe: () => void;
  onInstallOllama: () => Promise<InstallResult>;
  onStartOllama: () => Promise<InstallResult>;
  onPullModel: () => Promise<InstallResult>;
  /// Optional context chip rendered at the top of the panel
  /// ("Helping with: <lesson title>"). Empty hides it.
  contextLabel?: string;
}

/// Slide-in panel docked against the right edge. Header / message
/// scroller / composer. The assistant reply streams token-by-token;
/// the markdown renderer runs on every update which is cheap enough
/// for paragraph-scale responses.
export default function AiChatPanel({
  open,
  messages,
  streaming,
  error,
  probe,
  installStatus,
  setupBusy,
  onSend,
  onClose,
  onReset,
  onRetryProbe,
  onInstallOllama,
  onStartOllama,
  onPullModel,
  contextLabel,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to the tail on new tokens, but only if the user
  // hasn't scrolled up to re-read something. "Near the bottom" =
  // within 80px of the bottom edge, matching the behaviour used by
  // chat clients that share this pattern.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus the input when the panel opens so the user can just type.
  // 120ms matches the panel's 0.22s slide-up animation halfway point —
  // focusing earlier lands on an off-screen input and the keyboard
  // doesn't show on iOS Safari. 30ms (CommandPalette) and 60ms
  // (MobileSearchPalette) are the equivalents for surfaces that
  // animate on a tighter / different curve.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, [open]);

  const canSend = !streaming && draft.trim().length > 0 && probeOk(probe);

  function submit() {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
    // Reset the auto-grown textarea height so the composer
    // collapses back to one line after sending. Without this it
    // stays inflated to whatever the multi-line draft was.
    if (inputRef.current) inputRef.current.style.height = "";
  }

  return (
    <aside
      className={`fishbones-ai-panel ${open ? "is-open" : ""}`}
      role="complementary"
      aria-label="Local assistant"
      aria-hidden={!open}
    >
      <div className="fishbones-ai-panel-header">
        <div className="fishbones-ai-panel-title">
          <span>Ask Fishbones</span>
        </div>
        <div className="fishbones-ai-panel-header-actions">
          {messages.length > 0 && (
            <button
              className="fishbones-ai-panel-reset"
              onClick={onReset}
              disabled={streaming}
              title="Clear this conversation"
            >
              Clear
            </button>
          )}
          <button
            className="fishbones-ai-panel-close"
            onClick={onClose}
            aria-label="Close assistant"
          >
            <Icon icon={xIcon} size="sm" color="currentColor" />
          </button>
        </div>
      </div>

      {contextLabel && (
        <div className="fishbones-ai-panel-context" title={contextLabel}>
          <span className="fishbones-ai-panel-context-label">Context:</span>{" "}
          <span className="fishbones-ai-panel-context-value">{contextLabel}</span>
        </div>
      )}

      {/* First-run / setup banner — only renders when the probe
          flagged a blocker. Takes over the message area until
          resolved so the user knows what's wrong. */}
      {!probeOk(probe) && (
        <SetupBanner
          probe={probe}
          installStatus={installStatus}
          busy={setupBusy}
          onRetry={onRetryProbe}
          onInstallOllama={onInstallOllama}
          onStartOllama={onStartOllama}
          onPullModel={onPullModel}
        />
      )}

      <div className="fishbones-ai-panel-body" ref={scrollerRef}>
        {messages.length === 0 && probeOk(probe) && (
          <EmptyHint onPick={(p) => { setDraft(p); inputRef.current?.focus(); }} />
        )}
        {messages.map((m, i) => (
          <Bubble
            key={i}
            message={m}
            streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
          />
        ))}
        {error && (
          <div className="fishbones-ai-panel-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <form
        className="fishbones-ai-panel-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          className="fishbones-ai-panel-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Auto-grow as the user adds wrapped/multi-line content.
            // We collapse to "auto" first so the next read of
            // scrollHeight reflects the new content, not the
            // previously-locked-in height. CSS clamps the visible
            // height between min-height (one line) and max-height.
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
          }}
          placeholder={
            probeOk(probe)
              ? streaming
                ? "Thinking…"
                : "Ask something…"
              : "Local assistant isn't ready — see above."
          }
          rows={1}
          onKeyDown={(e) => {
            // Enter = send, Shift+Enter = newline. Standard chat UX.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!probeOk(probe)}
        />
        <button
          type="submit"
          className="fishbones-ai-panel-send"
          disabled={!canSend}
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}

function probeOk(probe: ProbeResult | null): boolean {
  return !!probe && probe.reachable && probe.hasDefaultModel;
}

function SetupBanner({
  probe,
  installStatus,
  busy,
  onRetry,
  onInstallOllama,
  onStartOllama,
  onPullModel,
}: {
  probe: ProbeResult | null;
  installStatus: InstallStatus | null;
  busy: boolean;
  onRetry: () => void;
  onInstallOllama: () => Promise<InstallResult>;
  onStartOllama: () => Promise<InstallResult>;
  onPullModel: () => Promise<InstallResult>;
}) {
  // Local copy of the most-recent action's stdout/stderr so the user
  // sees the captured tail of what just ran. Cleared each time a new
  // action fires.
  const [lastResult, setLastResult] = useState<InstallResult | null>(null);
  const wrap = async (fn: () => Promise<InstallResult>) => {
    setLastResult(null);
    try {
      const r = await fn();
      setLastResult(r);
    } catch (e) {
      setLastResult({
        success: false,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        duration_ms: 0,
      });
    }
  };

  if (!probe) {
    return (
      <div className="fishbones-ai-panel-setup">
        <FishbonesLoader label="Probing local assistant" size="sm" />
      </div>
    );
  }

  // Walk the setup ladder top-down. The first true-failing step wins;
  // the user fixes that one, the probe re-runs, and the banner
  // advances to the next step (or disappears entirely).

  // 1. ollama binary missing → install
  if (installStatus && !installStatus.ollamaInstalled) {
    return (
      <div className="fishbones-ai-panel-setup">
        <div className="fishbones-ai-panel-setup-title">
          Install the local assistant
        </div>
        <p>
          Fishbones uses Ollama to run a small coding model on your own
          machine. No API keys, no usage fees — but it has to be
          installed once.
        </p>
        {!installStatus.homebrewInstalled ? (
          <>
            <p className="fishbones-ai-panel-setup-note">
              Homebrew isn't installed yet. Paste this into Terminal,
              then come back:
            </p>
            <pre className="fishbones-ai-panel-setup-cmd">{`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`}</pre>
            <button
              className="fishbones-ai-panel-setup-retry"
              onClick={onRetry}
            >
              I've installed Homebrew
            </button>
          </>
        ) : (
          <>
            <pre className="fishbones-ai-panel-setup-cmd">brew install ollama</pre>
            <button
              className="fishbones-ai-panel-setup-primary"
              onClick={() => void wrap(onInstallOllama)}
              disabled={busy}
            >
              {busy ? "Installing…" : "Install Ollama"}
            </button>
          </>
        )}
        <ResultLog result={lastResult} />
      </div>
    );
  }

  // 2. binary present but daemon unreachable → start
  if (!probe.reachable) {
    return (
      <div className="fishbones-ai-panel-setup">
        <div className="fishbones-ai-panel-setup-title">
          Start the local assistant
        </div>
        <p>
          Ollama is installed but isn't running yet. Fishbones can
          start it as a background service so it stays up across
          restarts.
        </p>
        <pre className="fishbones-ai-panel-setup-cmd">brew services start ollama</pre>
        <button
          className="fishbones-ai-panel-setup-primary"
          onClick={() => void wrap(onStartOllama)}
          disabled={busy}
        >
          {busy ? "Starting…" : "Start Ollama"}
        </button>
        {probe.error && (
          <p className="fishbones-ai-panel-setup-err">{probe.error}</p>
        )}
        <ResultLog result={lastResult} />
        <button className="fishbones-ai-panel-setup-retry" onClick={onRetry}>
          Retry probe
        </button>
      </div>
    );
  }

  // 3. reachable but missing the default model → pull
  return (
    <div className="fishbones-ai-panel-setup">
      <div className="fishbones-ai-panel-setup-title">
        Download the coding model
      </div>
      <p>
        One-time ~4 GB download. You can keep using Fishbones in the
        meantime — the button below kicks off the pull and the panel
        unlocks when it finishes.
      </p>
      <pre className="fishbones-ai-panel-setup-cmd">ollama pull qwen2.5-coder:7b</pre>
      <button
        className="fishbones-ai-panel-setup-primary"
        onClick={() => void wrap(onPullModel)}
        disabled={busy}
      >
        {busy ? "Downloading…" : "Download model"}
      </button>
      <p className="fishbones-ai-panel-setup-note">
        On 16 GB RAM or less, swap the model name to{" "}
        <code>qwen2.5-coder:3b</code> from the Settings panel for a
        faster (slightly weaker) variant.
      </p>
      <ResultLog result={lastResult} />
      <button className="fishbones-ai-panel-setup-retry" onClick={onRetry}>
        Retry probe
      </button>
    </div>
  );
}

/// Captured stdout/stderr tail from the last setup action. Renders
/// inline so a failed install shows its error without the user
/// having to dig through Terminal.
function ResultLog({ result }: { result: InstallResult | null }) {
  if (!result) return null;
  const tail = (result.stderr || result.stdout).trim();
  if (!tail) return null;
  // Keep the last ~12 lines — installer chatter is verbose and the
  // useful info is almost always near the end (errors, "installed
  // to", etc.).
  const lines = tail.split("\n").slice(-12).join("\n");
  return (
    <pre
      className={`fishbones-ai-panel-setup-log ${
        result.success ? "is-ok" : "is-fail"
      }`}
    >
      {lines}
    </pre>
  );
}

function EmptyHint({ onPick }: { onPick: (prompt: string) => void }) {
  const prompts = [
    "Explain this lesson in one paragraph.",
    "I'm stuck — can you give me a nudge?",
    "Walk me through the solution step by step.",
  ];
  return (
    <div className="fishbones-ai-panel-empty">
      <div className="fishbones-ai-panel-empty-title">
        Hi — I'm your local tutor.
      </div>
      <p>
        I run entirely on your machine and know the lesson you're on. Try
        one of these, or ask anything:
      </p>
      <div className="fishbones-ai-panel-empty-chips">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            className="fishbones-ai-panel-empty-chip"
            onClick={() => onPick(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  // Use base's Card primitive for the bubble shell so we inherit its
  // padding tokens, border-radius, and theme-aware variants. User
  // messages = `filled` (right-aligned, soft fill); assistant =
  // `outlined` (left-aligned, transparent face); system = `filled`
  // but visually muted via our own override CSS for the rare leak-
  // through case. Per-message extra class lets our CSS apply the
  // alignment + max-width tweaks the primitive doesn't ship with.
  const variant: "filled" | "outlined" =
    message.role === "user" ? "filled" : "outlined";
  return (
    <Card
      variant={variant}
      padding="sm"
      className={`fishbones-ai-bubble fishbones-ai-bubble--${message.role} ${
        streaming ? "is-streaming" : ""
      }`}
    >
      {message.role === "assistant" ? (
        <AssistantBody content={message.content} streaming={streaming} />
      ) : (
        <div className="fishbones-ai-bubble-text">{message.content}</div>
      )}
    </Card>
  );
}

function AssistantBody({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const [html, setHtml] = useState("");
  // While streaming we render the raw content as a plain preformatted
  // string — markdown-it's block-level parser chokes on half-finished
  // fences / bullets as tokens arrive. Final pass swaps in the real
  // rendered HTML once the stream terminates.
  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    void renderMarkdown(content ?? "").then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [content, streaming]);

  if (streaming) {
    return (
      <div className="fishbones-ai-bubble-stream">
        {content || <span className="fishbones-ai-bubble-caret" />}
      </div>
    );
  }
  if (!html) {
    // Initial mount between "done streaming" and "markdown pass
    // settled" — show the raw text so the transition isn't jumpy.
    return <div className="fishbones-ai-bubble-stream">{content}</div>;
  }
  return (
    <div
      className="fishbones-ai-bubble-markdown"
      // Markdown output comes from our own renderer (trusted) and is
      // already escaped there; dangerously set is intentional.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
