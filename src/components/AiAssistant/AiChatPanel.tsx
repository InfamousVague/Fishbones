import { useEffect, useRef, useState } from "react";
// useState already imported — used by the panel root + the
// SetupBanner's lastResult log.
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import { Card } from "@base/primitives/card";
import "@base/primitives/card/card.css";
import { ChatBar } from "@base/primitives/chat-bar";
import "@base/primitives/chat-bar/chat-bar.css";
import "@base/primitives/card/card.css";
import type {
  ChatMessage,
  ProbeResult,
  InstallStatus,
  InstallResult,
} from "../../hooks/useAiChat";
import { AssistantMessage } from "./AssistantMessage";
import { useBubbleInteractions } from "./useBubbleInteractions";
import LibreLoader from "../Shared/LibreLoader";
import { useT } from "../../i18n/i18n";
import { findModelMeta } from "../../lib/ai/models";
import "./AiChatPanel.css";
import "./AssistantMessage.css";

interface Props {
  open: boolean;
  /// The Ollama model the chat is configured to use — drives the
  /// setup banner's pull command + size hint so it matches what the
  /// header dropdown actually selected (not a hardcoded default).
  model: string;
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
  model,
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
  const t = useT();
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // See `AiAgentPanel` for the rationale: base-ui's `TextArea`
  // primitive doesn't forward outer refs to its inner element,
  // so we keep a wrapper-div ref and resolve the textarea via
  // querySelector on every render. `inputRef.current` stays
  // current with the actual `<textarea>` for the focus calls
  // below.
  const inputHostRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    inputRef.current = inputHostRef.current?.querySelector("textarea") ?? null;
  });

  // Auto-scroll to the tail on new tokens, but only if the user
  // hasn't scrolled up to re-read something. "Near the bottom" =
  // within 80px of the bottom edge, matching the behaviour used by
  // chat clients that share this pattern.
  //
  // We use a MutationObserver instead of a `[messages]` dep array
  // because the async markdown render in the assistant bubble
  // (raw text → HTML swap after `renderMarkdown` resolves) grows
  // the bubble height AFTER React's effect tick has settled — a
  // dep-array effect doesn't fire for that, so the user ends up
  // scrolled up by a few lines mid-message. Observing every DOM
  // mutation inside the scroller (with rAF batching to coalesce a
  // burst of streaming tokens) catches the post-render expansion
  // too. The scroll listener tracks "did the user scroll away"
  // so our own programmatic scrolls don't accidentally lock the
  // flag on.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let userScrolledAway = false;
    const onScroll = () => {
      userScrolledAway =
        el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    let rafId = 0;
    const stickToBottom = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!userScrolledAway) el.scrollTop = el.scrollHeight;
      });
    };
    const mo = new MutationObserver(stickToBottom);
    mo.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    stickToBottom();
    return () => {
      mo.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

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

  // Submit handler used to live here as a function; the new
  // `ChatBar` primitive owns trim + enter-key + disabled-while-
  // sending logic, so we inline the send call in its `onSubmit`
  // below. Keeping `canSend` because the placeholder + disabled
  // gate still consume it.

  // Link interception (libre:// deep links + external URLs) AND
  // code-block copy buttons, delegated on the scroller. Shared with
  // the agent panel so the two can't drift — see useBubbleInteractions.
  useBubbleInteractions(scrollerRef);

  return (
    <aside
      className={`libre-ai-panel ${open ? "is-open" : ""}`}
      role="complementary"
      aria-label={t("ai.panelAria")}
      aria-hidden={!open}
    >
      <div className="libre-ai-panel-header">
        <div className="libre-ai-panel-title">
          <span>{t("ai.askLibre")}</span>
        </div>
        <div className="libre-ai-panel-header-actions">
          {messages.length > 0 && (
            <button
              className="libre-ai-panel-reset"
              onClick={onReset}
              disabled={streaming}
              title={t("ai.clearConversation")}
            >
              {t("ai.clear")}
            </button>
          )}
          <button
            className="libre-ai-panel-close"
            onClick={onClose}
            aria-label={t("ai.closeAssistant")}
          >
            <Icon icon={xIcon} size="sm" color="currentColor" />
          </button>
        </div>
      </div>

      {contextLabel && (
        <div className="libre-ai-panel-context" title={contextLabel}>
          <span className="libre-ai-panel-context-label">{t("ai.context")}</span>{" "}
          <span className="libre-ai-panel-context-value">{contextLabel}</span>
        </div>
      )}

      {/* First-run / setup banner — only renders when the probe
          flagged a blocker. Takes over the message area until
          resolved so the user knows what's wrong. */}
      {!probeOk(probe) && (
        <SetupBanner
          model={model}
          probe={probe}
          installStatus={installStatus}
          busy={setupBusy}
          onRetry={onRetryProbe}
          onInstallOllama={onInstallOllama}
          onStartOllama={onStartOllama}
          onPullModel={onPullModel}
        />
      )}

      <div className="libre-ai-panel-body" ref={scrollerRef}>
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
          <div className="libre-ai-panel-error" role="alert">
            {error}
          </div>
        )}
      </div>

      {/* ChatBar from base-ui composes the auto-grow textarea +
          send button + sending-state spinner. The panel's wrapper
          ref stays attached to the host div so the focus-on-open
          effects above can still resolve the underlying textarea
          via querySelector. */}
      <div ref={inputHostRef} className="libre-ai-panel-composer">
        <ChatBar
          size="sm"
          variant="filled"
          shape="default"
          className="libre-ai-panel-input"
          value={draft}
          onChange={setDraft}
          onSubmit={(text) => {
            if (!canSend) return;
            onSend(text);
            setDraft("");
          }}
          placeholder={
            probeOk(probe)
              ? streaming
                ? t("ai.thinking")
                : t("ai.askSomething")
              : t("ai.notReady")
          }
          sending={streaming}
          disabled={!probeOk(probe)}
        />
      </div>
    </aside>
  );
}

function probeOk(probe: ProbeResult | null): boolean {
  return !!probe && probe.reachable && probe.hasDefaultModel;
}

function SetupBanner({
  model,
  probe,
  installStatus,
  busy,
  onRetry,
  onInstallOllama,
  onStartOllama,
  onPullModel,
}: {
  model: string;
  probe: ProbeResult | null;
  installStatus: InstallStatus | null;
  busy: boolean;
  onRetry: () => void;
  onInstallOllama: () => Promise<InstallResult>;
  onStartOllama: () => Promise<InstallResult>;
  onPullModel: () => Promise<InstallResult>;
}) {
  const t = useT();
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
      <div className="libre-ai-panel-setup">
        <LibreLoader label={t("ai.probing")} size="sm" />
      </div>
    );
  }

  // Walk the setup ladder top-down. The first true-failing step wins;
  // the user fixes that one, the probe re-runs, and the banner
  // advances to the next step (or disappears entirely).

  // 1. ollama binary missing → install
  if (installStatus && !installStatus.ollamaInstalled) {
    return (
      <div className="libre-ai-panel-setup">
        <div className="libre-ai-panel-setup-title">
          Install the local assistant
        </div>
        <p>
          Libre uses Ollama to run a small coding model on your own
          machine. No API keys, no usage fees — but it has to be
          installed once.
        </p>
        {!installStatus.homebrewInstalled ? (
          <>
            <p className="libre-ai-panel-setup-note">
              Homebrew isn't installed yet. Paste this into Terminal,
              then come back:
            </p>
            <pre className="libre-ai-panel-setup-cmd">{`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`}</pre>
            <button
              className="libre-ai-panel-setup-retry"
              onClick={onRetry}
            >
              I've installed Homebrew
            </button>
          </>
        ) : (
          <>
            <pre className="libre-ai-panel-setup-cmd">brew install ollama</pre>
            <button
              className="libre-ai-panel-setup-primary"
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
      <div className="libre-ai-panel-setup">
        <div className="libre-ai-panel-setup-title">
          Start the local assistant
        </div>
        <p>
          Ollama is installed but isn't running yet. Libre can
          start it as a background service so it stays up across
          restarts.
        </p>
        <pre className="libre-ai-panel-setup-cmd">brew services start ollama</pre>
        <button
          className="libre-ai-panel-setup-primary"
          onClick={() => void wrap(onStartOllama)}
          disabled={busy}
        >
          {busy ? "Starting…" : "Start Ollama"}
        </button>
        {probe.error && (
          <p className="libre-ai-panel-setup-err">{probe.error}</p>
        )}
        <ResultLog result={lastResult} />
        <button className="libre-ai-panel-setup-retry" onClick={onRetry}>
          Retry probe
        </button>
      </div>
    );
  }

  // 3. reachable but missing the SELECTED model → pull it. Command +
  // size come from the model the header dropdown actually chose, not
  // a hardcoded default (a custom tag falls back to a generic size).
  const meta = findModelMeta(model);
  const sizeStr = meta ? `~${meta.sizeGb} GB` : "a few GB";
  return (
    <div className="libre-ai-panel-setup">
      <div className="libre-ai-panel-setup-title">
        Download {meta ? meta.label : model}
      </div>
      <p>
        One-time {sizeStr} download. You can keep using Libre in the
        meantime — the button below kicks off the pull and the panel
        unlocks when it finishes.
      </p>
      <pre className="libre-ai-panel-setup-cmd">ollama pull {model}</pre>
      <button
        className="libre-ai-panel-setup-primary"
        onClick={() => void wrap(onPullModel)}
        disabled={busy}
      >
        {busy ? "Downloading…" : "Download model"}
      </button>
      <p className="libre-ai-panel-setup-note">
        Want something lighter? Pick a smaller model from the{" "}
        <strong>model dropdown</strong> in the panel header (e.g.{" "}
        <code>qwen2.5-coder:3b</code>) for a faster, lower-RAM variant.
      </p>
      <ResultLog result={lastResult} />
      <button className="libre-ai-panel-setup-retry" onClick={onRetry}>
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
      className={`libre-ai-panel-setup-log ${
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
    <div className="libre-ai-panel-empty">
      <div className="libre-ai-panel-empty-title">
        Hi — I'm your local tutor.
      </div>
      <p>
        I run entirely on your machine and know the lesson you're on. Try
        one of these, or ask anything:
      </p>
      <div className="libre-ai-panel-empty-chips">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            className="libre-ai-panel-empty-chip"
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
      className={`libre-ai-bubble libre-ai-bubble--${message.role} ${
        streaming ? "is-streaming" : ""
      }`}
    >
      {message.role === "assistant" ? (
        <AssistantMessage content={message.content} streaming={streaming} />
      ) : (
        <div className="libre-ai-bubble-text">{message.content}</div>
      )}
    </Card>
  );
}
