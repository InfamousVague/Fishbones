/// Agent-mode chat panel — a sibling to `AiChatPanel` that
/// renders the tool-using conversation produced by `useAiAgent`.
///
/// Visual differences from the chat panel:
///   - Messages render inline with tool-call chips between them
///     (one chip per tool execution, showing the tool name + the
///     OK / FAIL outcome + a one-line preview of the result).
///   - Pending tool calls (the model proposed one that needs the
///     user's go-ahead) render as approve / deny chips above the
///     composer until resolved.
///   - The composer is the same shape as the chat panel's — a
///     textarea + Send button — so muscle memory transfers.
///
/// Both panels share the `.libre-ai-panel` root class so the
/// CSS positioning + glass treatment + header chrome are
/// identical. Agent-specific bits live under
/// `.libre-ai-panel--agent` modifiers in AiChatPanel.css.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { check } from "@base/primitives/icon/icons/check";
import { hammer } from "@base/primitives/icon/icons/hammer";
import { fileEdit } from "@base/primitives/icon/icons/file-edit";
import "@base/primitives/icon/icon.css";
import { Card } from "@base/primitives/card";
import "@base/primitives/card/card.css";
import { ChatBar } from "@base/primitives/chat-bar";
import "@base/primitives/chat-bar/chat-bar.css";
import { AssistantMessage } from "./AssistantMessage";
import { useBubbleInteractions } from "./useBubbleInteractions";
import "./AssistantMessage.css";
import type {
  AgentMessage,
  PendingClarification,
  PendingToolCall,
} from "@/hooks/useAiAgent";
import type { ToolCall, ToolResult } from "@/lib/aiTools/types";
import type { AgentScope } from "@/lib/aiTools/scope";
import {
  classifyConfidence,
} from "@/lib/aiAgent/confidence";
import {
  formatDuration,
  formatTokens,
  type RunUsage,
} from "@/lib/aiAgent/usage";
import {
  type AiAgentSettings,
} from "@/lib/aiAgent/settings";
import { PAIR_MODES, DEFAULT_PAIR_MODE } from "@/lib/aiAgent/pairMode";
import type { Course } from "@/data/types";
import { BuildJournalPanel, useBuildJournal } from "./BuildJournalPanel";
import { EarnTheDiffTray, useRewindChallenge } from "./EarnTheDiffTray";
import { visibleQuickActions } from "./quickActions";
import { validateFilePath } from "@/lib/aiTools/sandboxValidation";
import {
  conceptMasteryOf,
  loadMemory,
  recordRewindOutcomeIn,
  saveMemory,
} from "@/lib/ai/memory";
import { conceptForDiagnosis } from "@/lib/ai/concepts";
import { track } from "@/lib/track";
import { useT } from "@/i18n/i18n";
import "./AiChatPanel.css";
import "./AiAgentHud.css";
import "./BuildJournalPanel.css";
import "./EarnTheDiffTray.css";

interface Props {
  open: boolean;
  messages: AgentMessage[];
  streaming: boolean;
  pending: PendingToolCall[];
  timeline: ToolResult[];
  error: string | null;
  /// Agent working scope. Drives the chip in the header; null
  /// means "no scope restrictions" (full library access).
  scope?: AgentScope;
  /// Aggregated token usage / wall time across this run. Surfaced
  /// in the HUD strip beneath the header.
  usage?: RunUsage;
  /// Latest assistant confidence value (0..1). Drives the
  /// confidence meter in the HUD. null = no rating yet.
  confidence?: number | null;
  /// Pending clarification request (model called
  /// `request_user_input`). When non-null the panel renders a
  /// modal sheet with the question.
  clarification?: PendingClarification | null;
  /// Current settings — auto-approve, etc. Drives the gear button
  /// state in the header.
  settings?: AiAgentSettings;
  /// Installed courses + the learner's completed set — feed the
  /// Build Journal ("How this was built") so it can link the
  /// concepts the agent just used to lessons that teach them and
  /// flag the ones the learner hasn't studied yet.
  courses?: readonly Course[];
  completed?: ReadonlySet<string>;
  /// The course the learner is currently studying — biases the
  /// journal's lesson links toward it on near-ties.
  currentCourseId?: string;
  /// The sandbox project the user has open — drives the composer
  /// quick-actions (Explain / Fix the error / Add comments) which
  /// act on the open project via the project-aware agent.
  currentSandbox?: {
    projectId: string;
    name: string;
    language: string;
    activeFilePath?: string;
  } | null;
  onSend: (prompt: string) => void;
  onClose: () => void;
  onReset: () => void;
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string) => void;
  /// Halt the in-flight agent run. Wired by the host to
  /// `useAiAgent.stop()` — flips the loop's shouldStop flag AND
  /// fires the Rust-side `ai_chat_stop` so the active Ollama
  /// stream aborts on its next chunk. The HUD renders a Stop
  /// button while `streaming` is true.
  onStop?: () => void;
  onAnswerClarification?: (answer: string) => void;
  onCancelClarification?: () => void;
  onUpdateSettings?: (next: AiAgentSettings) => void;
  /// Reset scope from the header chip. Called when the user clicks
  /// the "clear scope" action; lets the user start fresh without
  /// going to settings.
  onClearScope?: () => void;
}

export default function AiAgentPanel({
  open,
  messages,
  streaming,
  pending,
  timeline,
  error,
  scope,
  usage,
  confidence,
  clarification,
  settings,
  courses,
  completed,
  currentCourseId,
  currentSandbox,
  onSend,
  onClose,
  onReset,
  onApprove,
  onDeny,
  onStop,
  onAnswerClarification,
  onCancelClarification,
  onUpdateSettings,
  onClearScope,
}: Props) {
  // Settings sheet open/closed. Auto-approve + confidence visibility
  // controls live inside it; the gear button in the header toggles.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = useT();
  const [draft, setDraft] = useState("");
  // Per-file streaming progress, populated by the
  // `libre:agent-file-write` event the stream writer fires as
  // ```lang:path fenced blocks land in the sandbox. The agent
  // panel renders these as inline pills so the user sees per-file
  // progress without context-switching to the sandbox view.
  //
  // The map keys are `projectId:path` so files from different
  // projects (rare, but possible if the agent creates multiple
  // sandboxes in one run) stay disjoint. We surface them in
  // insertion order — newest at the bottom, matching the chat
  // stream's chronology.
  const [fileWrites, setFileWrites] = useState<
    Array<{
      key: string;
      projectId: string;
      path: string;
      bytes: number;
      closed: boolean;
      language: string;
    }>
  >([]);
  useEffect(() => {
    const onWrite = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          projectId?: string;
          path?: string;
          bytes?: number;
          closed?: boolean;
          language?: string;
        }>
      ).detail;
      if (!detail?.projectId || !detail.path) return;
      // Render-boundary guard — never show a junk-path file-write chip.
      if (!validateFilePath(detail.path).ok) return;
      const key = `${detail.projectId}:${detail.path}`;
      setFileWrites((prev) => {
        const idx = prev.findIndex((f) => f.key === key);
        if (idx < 0) {
          return [
            ...prev,
            {
              key,
              projectId: detail.projectId!,
              path: detail.path!,
              bytes: detail.bytes ?? 0,
              closed: !!detail.closed,
              language: detail.language ?? "plain",
            },
          ];
        }
        // Update in place — bytes growing, possibly flipping to
        // closed. Keep the chip's position stable in the list
        // so the UI doesn't jump.
        const next = prev.slice();
        next[idx] = {
          ...next[idx],
          bytes: detail.bytes ?? next[idx].bytes,
          closed: detail.closed || next[idx].closed,
          language: detail.language ?? next[idx].language,
        };
        return next;
      });
    };
    window.addEventListener("libre:agent-file-write", onWrite);
    return () => window.removeEventListener("libre:agent-file-write", onWrite);
  }, []);
  // Reset the file-write pills when the user clears the agent run
  // — otherwise stale chips from the previous run linger above
  // the new conversation.
  useEffect(() => {
    if (messages.length === 0) setFileWrites([]);
  }, [messages.length]);

  // Live console output streaming in from the preview iframe.
  // The web / react / threejs / reactnative runtimes inject a
  // postMessage shim into their HTML that forwards every
  // `console.*` call to the parent window; the sandbox's
  // OutputPane re-broadcasts each one as a `libre:preview-log`
  // CustomEvent so the agent panel can also see them. Logs
  // accumulate per-run and reset whenever a new run starts so
  // stale errors from a previous attempt don't bleed into the
  // current view.
  const [previewLogs, setPreviewLogs] = useState<
    Array<{ level: "log" | "info" | "warn" | "error"; text: string }>
  >([]);
  useEffect(() => {
    const onLog = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{ level?: string; text?: string }>
      ).detail;
      if (!detail) return;
      const level = (
        ["log", "info", "warn", "error"].includes(detail.level ?? "")
          ? detail.level
          : "log"
      ) as "log" | "info" | "warn" | "error";
      setPreviewLogs((prev) => [
        ...prev,
        { level, text: detail.text ?? "" },
      ]);
    };
    window.addEventListener("libre:preview-log", onLog);
    return () => window.removeEventListener("libre:preview-log", onLog);
  }, []);
  // Reset live preview logs on every new agent run-start so a
  // previous build's errors don't show under the current run.
  useEffect(() => {
    const onRunStart = () => setPreviewLogs([]);
    window.addEventListener("libre:agent-run-start", onRunStart);
    return () =>
      window.removeEventListener("libre:agent-run-start", onRunStart);
  }, []);

  // Live status of an in-flight `run_sandbox_project` call. The
  // tool fires `libre:agent-run-start` / `libre:agent-run-end`
  // events around its actual execution; the panel reads them to
  // show a "running tests…" line in the message stream so the
  // user sees that something IS happening while the run can take
  // 5-30s on compiled languages. `null` means no run is active.
  const [runStatus, setRunStatus] = useState<{
    projectId: string;
    language?: string;
    startedAt: number;
  } | null>(null);
  useEffect(() => {
    const onStart = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{ projectId?: string; language?: string }>
      ).detail;
      if (!detail?.projectId) return;
      setRunStatus({
        projectId: detail.projectId,
        language: detail.language,
        startedAt: Date.now(),
      });
    };
    const onEnd = () => setRunStatus(null);
    window.addEventListener("libre:agent-run-start", onStart);
    window.addEventListener("libre:agent-run-end", onEnd);
    return () => {
      window.removeEventListener("libre:agent-run-start", onStart);
      window.removeEventListener("libre:agent-run-end", onEnd);
    };
  }, []);

  // Tool-call timeline drawer toggle. Closed by default; opening
  // reveals a side panel listing every tool call from this agent
  // run with full args + result JSON for debugging.
  const [timelineOpen, setTimelineOpen] = useState(false);
  // Live-preview pane toggle. Auto-opens when a tool returns a
  // previewUrl; can be collapsed manually via the close button on
  // the preview header.
  const [previewOpen, setPreviewOpen] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Delegate libre:// link clicks, external links, and code-block
  // copy buttons for every assistant bubble in the scroller.
  useBubbleInteractions(scrollerRef);
  // The base-ui `TextArea` primitive wraps its `<textarea>` in a
  // `.textarea-wrapper` div and does NOT forward the outer
  // `ref` prop to the inner element. We attach the ref to a
  // wrapper div around the primitive and query down for the
  // textarea when we need to focus it / read its element. Less
  // ergonomic than `ref` forwarding but works without forking
  // the primitive.
  const inputHostRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    inputRef.current = inputHostRef.current?.querySelector("textarea") ?? null;
  });

  // Walk the timeline for the most recent previewUrl. Tools like
  // `run_sandbox_project` / `start_dev_server` / `get_dev_server_url`
  // include the URL in their JSON result; we parse + cache the
  // latest one so the preview iframe always shows whatever the
  // agent most recently surfaced.
  const latestPreview = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (!entry.ok) continue;
      try {
        const parsed = JSON.parse(entry.content) as { previewUrl?: string | null };
        if (parsed.previewUrl) {
          return { url: parsed.previewUrl, fromTool: entry.name };
        }
      } catch {
        /* not JSON or no preview URL */
      }
    }
    return null;
  }, [timeline]);

  // Walk the timeline for the most recent `run_sandbox_project`
  // result. Surfaces the run's logs + error + duration so the
  // agent panel can render a console view alongside (or instead
  // of) the preview iframe. CLI-style runs (Python, Rust, Go)
  // never produce a previewUrl — the console is the ONLY
  // post-run surface; without it the user can't see what their
  // code printed without opening the timeline drawer.
  //
  // For preview-producing runs (React, Three.js, etc.), we ALSO
  // merge in any live `libre:preview-log` events that came
  // through after the tool returned. Without that, the agent's
  // console would only show the snapshot of logs captured at
  // run-time — but React errors like "createRoot not found"
  // fire AFTER the runner's tinyHttp server hands off the URL,
  // so they only appear via the postMessage shim. Merging both
  // is what makes "the AI sees runtime errors and fixes them"
  // actually work end-to-end.
  const latestRun = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (entry.name !== "run_sandbox_project") continue;
      try {
        const parsed = JSON.parse(entry.content) as {
          ok?: boolean;
          durationMs?: number;
          logs?: Array<{ level: string; text: string }>;
          error?: string | null;
          previewUrl?: string | null;
        };
        const baseLogs = parsed.logs ?? [];
        // Only attach live preview logs when this run was the
        // one that emitted them — distinguished by `hasPreview`
        // (a CLI run never has matching postMessage logs because
        // there's no iframe).
        const hasPreview = !!parsed.previewUrl;
        const mergedLogs = hasPreview
          ? [...baseLogs, ...previewLogs]
          : baseLogs;
        // If a postMessage `error`-level entry surfaced AFTER the
        // run completed, treat the run as effectively failed even
        // if the runtime returned `ok: true`. This is how the
        // agent's auto-verify loop catches "the runner thought it
        // succeeded but the iframe is showing a red error overlay"
        // failures like a SyntaxError from Babel that fires post-
        // hand-off.
        const liveErrors = previewLogs.filter((l) => l.level === "error");
        const effectiveOk =
          hasPreview && liveErrors.length > 0 ? false : (parsed.ok ?? entry.ok);
        const effectiveError =
          parsed.error ??
          (hasPreview && liveErrors.length > 0
            ? liveErrors.map((l) => l.text).join("\n")
            : null);
        return {
          ok: effectiveOk,
          durationMs: parsed.durationMs ?? 0,
          logs: mergedLogs,
          error: effectiveError,
          hasPreview,
        };
      } catch {
        /* not JSON, skip */
      }
    }
    return null;
  }, [timeline, previewLogs]);

  // Auto-open the preview pane when a new URL lands. User can still
  // close it manually after the fact.
  useEffect(() => {
    if (latestPreview) setPreviewOpen(true);
  }, [latestPreview?.url]);
  // Auto-open the console when a new run completes — even if
  // there's a preview, the logs are usually still interesting
  // (warnings, console.log diagnostics). User can collapse it
  // manually.
  const [consoleOpen, setConsoleOpen] = useState(true);
  useEffect(() => {
    if (latestRun) setConsoleOpen(true);
  }, [latestRun?.durationMs]);

  // Build Journal — the deterministic "How this was built" worked
  // example. Computed from the just-built sandbox's files + the
  // run timeline (loaded from disk when the agent pauses). Auto-
  // opens once a teachable build exists; collapsible thereafter.
  const { journal: buildJournal } = useBuildJournal({
    open,
    streaming,
    timeline,
    courses,
    completed,
    currentCourseId,
  });
  const [journalOpen, setJournalOpen] = useState(true);
  // Re-open the journal whenever a fresh teachable build lands so
  // the learning path resurfaces after each completed build.
  useEffect(() => {
    if (buildJournal) setJournalOpen(true);
  }, [buildJournal?.projectId, buildJournal?.files.length]);

  // "Earn the Diff" — the one post-build rewind challenge. Computed
  // deterministically (no model picks the line); fires once per
  // completed build in a teaching mode. `rewindDoneSig` records the
  // build signature the learner already answered/skipped so it
  // doesn't re-appear for the same build.
  const { challenge: rewindChallenge, signature: rewindSig } =
    useRewindChallenge({
      open,
      streaming,
      timeline,
      pairMode: settings?.pairMode ?? DEFAULT_PAIR_MODE,
      courses,
      completed,
      currentCourseId,
      // Suppress the challenge for concepts the learner has already
      // earned the diff on enough times.
      conceptMastery: (id) => conceptMasteryOf(id),
    });
  const [rewindDoneSig, setRewindDoneSig] = useState<string | null>(null);
  const showRewind =
    !!rewindChallenge && rewindSig !== null && rewindSig !== rewindDoneSig;
  const endRewind = (resolved?: { passed: boolean; conceptId: string }) => {
    setRewindDoneSig(rewindSig);
    if (resolved) {
      // Bump per-concept mastery on a pass (and ease the matching
      // struggle counters) so the gate stops re-quizzing what the
      // learner has shown they know.
      saveMemory(
        recordRewindOutcomeIn(
          loadMemory(),
          resolved.conceptId,
          resolved.passed,
          (code) => conceptForDiagnosis(code)?.id,
        ),
      );
    }
  };

  // Auto-scroll the message list to follow the agent. The
  // previous implementation watched the messages/timeline/pending
  // dependency tuple, which fired on every React state setter
  // but MISSED two cases that visibly drift the scroll off-tail
  // mid-message:
  //
  //   1. `AssistantMarkdownBubble`'s async markdown render. The
  //      bubble first paints the raw streaming text, then
  //      `renderMarkdown` resolves and the bubble swaps in
  //      formatted HTML — usually TALLER than the raw text.
  //      That swap happens inside its OWN effect; the agent
  //      panel's outer state doesn't change, so the dep-array
  //      scroll handler doesn't fire and the user ends up
  //      scrolled up by a few lines.
  //   2. Internal panel state (`fileWrites`, `previewLogs`,
  //      `runStatus`) that's appended to the body but isn't in
  //      the dep tuple at all — every file-write chip or live
  //      preview log added DOM height without a scroll follow.
  //
  // A MutationObserver on the scroller's subtree catches both
  // (text mutations + node additions/removals + attribute
  // flips), batched through rAF so a burst of streaming-token
  // mutations coalesces into one scroll-per-frame.
  //
  // Near-bottom-only: if the user has scrolled up to re-read
  // something, we don't yank them back. The scroll listener
  // tracks "did the user scroll away" so a sequence of
  // PROGRAMMATIC scrollTop writes (each of which also fires a
  // scroll event with distance 0) doesn't accidentally lock the
  // flag on.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Tracks whether the user has manually scrolled up. Reset
    // whenever the user scrolls back near the bottom (or when our
    // own auto-scroll fires, which also lands at distance 0).
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
    // Initial paint — when the panel mounts with pre-existing
    // messages (loaded from a saved session), start at the tail
    // rather than at the top.
    stickToBottom();
    return () => {
      mo.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, [open]);

  // Send is handled inline by the `ChatBar`'s `onSubmit` below —
  // the primitive owns trim + enter-key + disabled-while-sending
  // logic, so the panel doesn't need a separate `submit()` helper
  // anymore.

  return (
    <aside
      className={`libre-ai-panel libre-ai-panel--agent ${open ? "is-open" : ""}`}
      role="complementary"
      aria-label="Agent mode"
      aria-hidden={!open}
    >
      <div className="libre-ai-panel-header">
        <div className="libre-ai-panel-title">
          <span>Agent</span>
          {settings?.autoApprove && (
            <span
              className="libre-ai-panel-auto-badge"
              title="Auto-approve is on — tools run without confirmation"
            >
              auto
            </span>
          )}
        </div>
        <div className="libre-ai-panel-header-actions">
          {settings && onUpdateSettings && (
            <button
              type="button"
              className={
                "libre-ai-panel-reset" + (settingsOpen ? " is-active" : "")
              }
              onClick={() => setSettingsOpen((v) => !v)}
              title="Agent settings"
              aria-pressed={settingsOpen}
            >
              ⚙
            </button>
          )}
          {timeline.length > 0 && (
            <button
              type="button"
              className={
                "libre-ai-panel-reset" +
                (timelineOpen ? " is-active" : "")
              }
              onClick={() => setTimelineOpen((v) => !v)}
              title="Show tool-call timeline"
            >
              Tools · {timeline.length}
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              className="libre-ai-panel-reset"
              onClick={onReset}
              disabled={streaming}
              title="Clear this agent run"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="libre-ai-panel-close"
            onClick={onClose}
            aria-label="Close agent"
          >
            <Icon icon={xIcon} size="sm" color="currentColor" />
          </button>
        </div>
      </div>

      {/* HUD strip — confidence meter + token counter + run duration.
          Only rendered when the run has actually produced something
          (turns > 0 OR confidence is set). Shown beneath the header
          so it's always visible while the run is in flight. The
          individual readouts respect the settings.show* flags so
          the user can turn each off independently. */}
      {settings && (usage || confidence !== undefined) && (
        <AgentHud
          confidence={confidence ?? null}
          usage={usage}
          showTokens={settings.showTokens}
          showConfidence={settings.showConfidence}
          streaming={streaming}
          onStop={streaming ? onStop : undefined}
        />
      )}

      {/* Scope chip. Renders only when scope HAS restrictions —
          the "no restrictions" default state is the implicit one
          and doesn't need a header row eating vertical space. */}
      {scope && hasScopeRestrictions(scope) && (
        <ScopeChip scope={scope} onClear={onClearScope} />
      )}

      <div className="libre-ai-panel-body" ref={scrollerRef}>
        {messages.length === 0 && (
          <EmptyAgentHint
            onPick={(p) => {
              setDraft(p);
              inputRef.current?.focus();
            }}
          />
        )}
        {messages.map((m, i) => (
          <AgentRow
            key={i}
            message={m}
            timeline={timeline}
            // Suppress the inline "thinking…" breadcrumb on the
            // last empty-assistant message — it now renders as a
            // pinned bottom banner above the composer instead.
            // Earlier message rows (mid-conversation empty
            // assistants from a previous turn) still render their
            // inline breadcrumb so the chat history retains its
            // visual rhythm. Notion issue #a37bed6308faed33.
            suppressEmptyThinking={i === messages.length - 1}
            streaming={streaming && i === messages.length - 1}
          />
        ))}
        {/* Per-file streaming progress. Sits between the assistant
            message bubbles and the pending tool chips so the user
            can read the chips as "the agent is currently writing
            files into your sandbox". Each chip pulses while
            content is still arriving, then flips to a green check
            once the closing fence lands. Hidden when no files
            have been written this run. */}
        {fileWrites.length > 0 && (
          <div
            className="libre-ai-file-chip-stack"
            aria-live="polite"
            aria-label="Files being written to sandbox"
          >
            {fileWrites.map((f) => (
              <FileWriteChip
                key={f.key}
                file={f}
                onOpen={() =>
                  window.dispatchEvent(
                    new CustomEvent("libre:sandbox-focus", {
                      detail: { projectId: f.projectId, path: f.path },
                    }),
                  )
                }
              />
            ))}
          </div>
        )}
        {pending.map((p) => (
          <PendingToolChip
            key={p.call.id}
            pending={p}
            onApprove={() => {
              // User accepted the agent's proposed action/diff —
              // this is the moment the suggestion gets applied.
              track.aiApply("agent");
              onApprove(p.call.id);
            }}
            onDeny={() => onDeny(p.call.id)}
          />
        ))}
        {/* Long-running execution indicator. The `run_sandbox_project`
            tool can take 5-30s for compiled languages; without this
            the user sees the running chip and nothing else for the
            duration. The label updates the elapsed seconds via a
            ticking timer so it actively reads as "alive, still
            running" rather than "frozen". */}
        {runStatus && (
          <RunStatusBanner
            projectId={runStatus.projectId}
            language={runStatus.language}
            startedAt={runStatus.startedAt}
          />
        )}
        {error && (
          <div className="libre-ai-panel-error" role="alert">
            {error}
          </div>
        )}
      </div>

      {/* Live preview pane. Surfaces the most recent
          previewUrl from the tool-call timeline as an inline
          iframe — collapsible so the user can shove it out of
          the way when they want the full chat scrollback.
          Outside the body's scroll region so it stays pinned
          while messages stream in above. */}
      {latestPreview && previewOpen && (
        <div className="libre-ai-panel-preview">
          <div className="libre-ai-panel-preview-head">
            <span className="libre-ai-panel-preview-title">
              Preview · {latestPreview.fromTool}
            </span>
            <a
              href={latestPreview.url}
              target="_blank"
              rel="noreferrer"
              className="libre-ai-panel-preview-open"
              title="Open in browser"
            >
              ↗
            </a>
            <button
              type="button"
              className="libre-ai-panel-preview-close"
              onClick={() => setPreviewOpen(false)}
              aria-label="Hide preview"
            >
              <Icon icon={xIcon} size="xs" color="currentColor" />
            </button>
          </div>
          <iframe
            className="libre-ai-panel-preview-frame"
            src={latestPreview.url}
            title="Agent preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
      )}
      {latestPreview && !previewOpen && (
        <button
          type="button"
          className="libre-ai-panel-preview-restore"
          onClick={() => setPreviewOpen(true)}
        >
          Show preview ({latestPreview.fromTool})
        </button>
      )}

      {/* Console pane. Renders the latest `run_sandbox_project`
          result's logs + error + duration. Always available when
          the agent has actually run something — preview-producing
          runs (React, Three.js) get BOTH the iframe above AND the
          console here so the user can see console.log output
          alongside the rendered UI; CLI-style runs (Python, Rust,
          Go, CLI tools) get only the console — there's no
          iframe to render. Collapsible via the × button. */}
      {latestRun && consoleOpen && (
        <ConsolePane
          run={latestRun}
          onClose={() => setConsoleOpen(false)}
        />
      )}
      {latestRun && !consoleOpen && (
        <button
          type="button"
          className="libre-ai-panel-preview-restore"
          onClick={() => setConsoleOpen(true)}
        >
          Show console ({latestRun.logs.length} log
          {latestRun.logs.length === 1 ? "" : "s"}
          {latestRun.error ? " · errored" : ""})
        </button>
      )}

      {/* Earn the Diff — the one post-build rewind challenge.
          Appears after a teaching-mode build goes green; the learner
          predicts the load-bearing line before the reveal. Sits
          above the passive Build Journal because it's an active
          invitation, not a summary. */}
      {showRewind && (
        <EarnTheDiffTray
          challenge={rewindChallenge}
          onResolved={(passed, conceptId) =>
            endRewind({ passed, conceptId })
          }
          onDismiss={() => endRewind()}
        />
      )}

      {/* Build Journal — "How this was built". The teaching half
          of the brief: once the agent has actually built something,
          this explains what each file does and links every concept
          it used to lessons that teach it, flagging the ones the
          learner hasn't studied yet. Computed deterministically so
          it appears even when the small local model narrates
          poorly. Collapsible like the console. */}
      {buildJournal && journalOpen && (
        <BuildJournalPanel
          journal={buildJournal}
          onClose={() => setJournalOpen(false)}
        />
      )}
      {buildJournal && !journalOpen && (
        <button
          type="button"
          className="libre-ai-panel-preview-restore"
          onClick={() => setJournalOpen(true)}
        >
          Show how this was built ({buildJournal.concepts.length} concept
          {buildJournal.concepts.length === 1 ? "" : "s"}
          {buildJournal.newToYou.length > 0
            ? ` · ${buildJournal.newToYou.length} new`
            : ""}
          )
        </button>
      )}

      {/* Timeline drawer. Slides up from the bottom of the
          panel (above the composer); collapsible via the header
          toggle. Lists every timeline entry with full JSON
          payloads for debugging — the inline tool-result chips
          show a truncated preview; the drawer is for "wait, what
          did the agent ACTUALLY do?" inspection. */}
      {timelineOpen && (
        <TimelineDrawer
          timeline={timeline}
          onClose={() => setTimelineOpen(false)}
        />
      )}

      {/* Settings sheet — covers the panel body so the user
          can focus on the controls. Closed by default; opened
          via the gear button in the header. */}
      {settingsOpen && settings && onUpdateSettings && (
        <SettingsSheet
          settings={settings}
          onUpdate={onUpdateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Clarification sheet — the agent called request_user_input
          and the loop is paused awaiting the user's answer. Floats
          over the composer with a textarea + submit button. */}
      {clarification && onAnswerClarification && onCancelClarification && (
        <ClarificationSheet
          clarification={clarification}
          onAnswer={onAnswerClarification}
          onCancel={onCancelClarification}
        />
      )}

      {/* Thinking banner — pinned to the bottom of the panel
          (above the composer) whenever the agent is mid-turn.
          Replaces the inline `libre-ai-agent-breadcrumb` that
          used to sit at the tail of the message stream and
          scroll out of view as the scrollback grew. Notion
          issue #a37bed6308faed33 ("thinking dots should be
          bottom justified, pinned to UI in a bottom banner not
          a message inline"). The label is derived from the same
          empty-assistant placeholder logic as before — if the
          last message has tool calls the banner reads "running
          <tool>…", otherwise plain "thinking". The dots and the
          banner self-hide once streaming stops AND the last
          message picks up content. */}
      <ThinkingBanner streaming={streaming} messages={messages} />

      {/* Quick-actions — one-click co-creation prompts that act on the
          OPEN sandbox project via the project-aware agent. Only the
          relevant ones show (Fix the error appears after a failed run;
          Explain/Add tests/Add comments appear when a project/file is
          open). Hidden while streaming so they don't fire mid-turn. */}
      {!streaming &&
        (() => {
          const actions = visibleQuickActions({
            projectName: currentSandbox?.name,
            openFile: currentSandbox?.activeFilePath,
            lastError: latestRun?.error ?? null,
          });
          if (actions.length === 0) return null;
          return (
            <div className="libre-ai-quick-actions" role="group" aria-label="Quick actions">
              {actions.map((a) => {
                const ctx = {
                  projectName: currentSandbox?.name,
                  openFile: currentSandbox?.activeFilePath,
                  lastError: latestRun?.error ?? null,
                };
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={
                      "libre-ai-quick-action" +
                      (a.id === "fix-error" ? " libre-ai-quick-action--alert" : "")
                    }
                    onClick={() => onSend(a.prompt(ctx))}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          );
        })()}

      {/* ChatBar from base-ui: composes auto-resizing textarea +
          send button + sending-state spinner into one primitive
          we can drop in here. Replaces the hand-rolled `<textarea>
          + <button Send>` pair the panel was using before. */}
      <div ref={inputHostRef} className="libre-ai-panel-composer">
        <ChatBar
          size="sm"
          variant="filled"
          shape="default"
          className="libre-ai-panel-input"
          placeholder={t("ai.askSomething")}
          value={draft}
          onChange={setDraft}
          onSubmit={(text) => {
            // The ChatBar gives us the trimmed text directly;
            // we just thread it through the existing onSend path
            // (which sends + clears the draft state).
            if (streaming) return;
            onSend(text);
            setDraft("");
          }}
          sending={streaming}
          disabled={false}
        />
      </div>
    </aside>
  );
}

/// Pinned bottom banner that announces the agent's "thinking"
/// state. Renders above the composer with the dots + label
/// bottom-justified to the row. Self-hides when there's nothing
/// to announce (no streaming AND the last message has visible
/// content). Earlier behaviour was an inline breadcrumb in the
/// message stream that scrolled off-screen as the conversation
/// grew. Notion issue #a37bed6308faed33.
function ThinkingBanner({
  streaming,
  messages,
}: {
  streaming: boolean;
  messages: readonly AgentMessage[];
}) {
  // Find the most recent empty-assistant placeholder — same
  // detection AgentRow uses, lifted into the banner so we can
  // surface the right "running X / thinking" label.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const isEmpty =
    lastAssistant !== undefined &&
    (!lastAssistant.content || lastAssistant.content.trim().length === 0);
  // Show banner when streaming is active, OR when the tail
  // message is an empty assistant (which can persist briefly
  // post-stream while content arrives).
  if (!streaming && !isEmpty) return null;
  const toolCalls = (lastAssistant?.toolCalls ?? []) as ToolCall[];
  const label =
    toolCalls.length > 0
      ? `running ${toolCalls.length === 1 ? toolCalls[0].name : `${toolCalls.length} tools`}…`
      : "thinking";
  return (
    <div className="libre-ai-thinking-banner" aria-live="polite">
      <Icon icon={hammer} size="xs" color="currentColor" />
      <span className="libre-ai-thinking-banner__label">{label}</span>
      <span className="libre-ai-thinking-banner__dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

/// One row in the message stream — handles every AgentMessage
/// variant: user prompts, assistant text, and `tool`-role results
/// (rendered as compact result chips with the corresponding
/// timeline entry's status colour).
function AgentRow({
  message,
  timeline,
  suppressEmptyThinking = false,
  streaming = false,
}: {
  message: AgentMessage;
  timeline: ToolResult[];
  /// When true and `message` is an empty assistant placeholder
  /// (no content yet, or a tool-call-only turn), return null so
  /// the inline breadcrumb stays out of the message stream.
  /// `AiAgentPanel` renders a pinned bottom banner for the
  /// current thinking state instead — see Notion issue
  /// #a37bed6308faed33.
  suppressEmptyThinking?: boolean;
  /// This row is the one actively streaming — drives the bubble's
  /// mid-stream sanitizing (trailing unterminated-tag removal).
  streaming?: boolean;
}) {
  if (message.role === "system") return null;
  if (message.role === "user") {
    // Loop-injected auto-continue nudges are NOT learner words —
    // render them as a muted breadcrumb ("auto-continuing the
    // build…") instead of a user bubble so the transcript never
    // puts text in the learner's mouth.
    if (message.isNudge) {
      return (
        <div
          className="libre-ai-agent-breadcrumb libre-ai-agent-breadcrumb--nudge"
          title={message.content}
        >
          <Icon icon={hammer} size="xs" color="currentColor" />
          <span>auto-continuing — the build isn't finished yet</span>
        </div>
      );
    }
    // base-ui `Card` (filled variant) for the user bubble —
    // same primitive `AiChatPanel` uses, so chat-mode and
    // agent-mode messages render with identical chrome. The
    // existing `.libre-ai-bubble--user.card` rule in
    // `AiChatPanel.css` styles alignment + max-width.
    return (
      <Card
        variant="filled"
        padding="sm"
        className="libre-ai-bubble libre-ai-bubble--user"
      >
        <div className="libre-ai-bubble-text">{message.content}</div>
      </Card>
    );
  }
  if (message.role === "assistant") {
    // Empty assistant messages — either the model is still
    // emitting its first token (streamed turn just started) or
    // it's a pure tool-call turn that won't produce visible
    // text at all. Either way we want a "the agent is working"
    // affordance instead of a blank card so the user knows the
    // request hasn't silently dropped on the floor.
    const isEmptyAssistant =
      !message.content || message.content.trim().length === 0;
    // CRITICAL: when an assistant message has tool calls AND
    // residual prose content, render ONLY the breadcrumb (drop
    // the prose). Smaller models like to chat verbose "Step 1:
    // create a project. Step 2: write files." preambles around
    // their tool calls — we want the user to see the tool chip,
    // not the textbook. The prose, if any, surfaces in the
    // FINAL terminal turn (no more tool calls) where we show
    // the bubble normally.
    const hasToolCalls = !!message.toolCalls && message.toolCalls.length > 0;
    // Are ALL of this turn's tool calls done (have results in
    // the timeline)? If so, render the breadcrumb in its DONE
    // state — a check icon, no animated dots, past-tense label.
    // The prior implementation kept the "..." dots animating
    // forever for completed turns, which made it look like the
    // agent was still working on a tool that had finished
    // minutes ago. Notion-style "this step is complete" check
    // mark is the right visual.
    const allToolCallsDone =
      hasToolCalls &&
      message.toolCalls!.every((tc) =>
        timeline.some((t) => t.toolCallId === tc.id),
      );
    if (isEmptyAssistant || hasToolCalls) {
      if (suppressEmptyThinking) return null;
      const label = hasToolCalls
        ? message.toolCalls!.length === 1
          ? message.toolCalls![0].name
          : `${message.toolCalls!.length} tools`
        : "thinking";
      const verb = allToolCallsDone
        ? hasToolCalls
          ? "ran"
          : label
        : hasToolCalls
          ? `running ${label}…`
          : label;
      return (
        <div
          className={
            "libre-ai-agent-breadcrumb" +
            (allToolCallsDone ? " libre-ai-agent-breadcrumb--done" : "")
          }
          aria-live="polite"
        >
          <Icon
            icon={allToolCallsDone ? check : hammer}
            size="xs"
            color="currentColor"
          />
          <span>
            {allToolCallsDone && hasToolCalls
              ? `ran ${label}`
              : verb}
          </span>
          {!allToolCallsDone && (
            <span className="libre-ai-agent-breadcrumb-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      );
    }
    return (
      <Card
        variant="outlined"
        padding="sm"
        className="libre-ai-bubble libre-ai-bubble--assistant"
      >
        <AssistantMessage content={message.content} agentMode streaming={streaming} />
      </Card>
    );
  }
  // role === "tool" — look up the matching timeline entry for
  // status colour + truncated result preview.
  const entry = timeline.find((t) => t.toolCallId === message.toolCallId);
  return (
    <ToolResultChip
      name={message.name}
      ok={entry?.ok ?? true}
      content={message.content}
    />
  );
}

function ToolResultChip({
  name,
  ok,
  content,
}: {
  name: string;
  ok: boolean;
  content: string;
}) {
  // Render the human-readable bit instead of the raw JSON
  // envelope. Failed tool results follow the convention
  // `{"error":true,"message":"...detail..."}` — surfacing the
  // `message` is what tells the user (and the agent's
  // next-turn context) what actually went wrong. Successful
  // results show a compact JSON preview.
  //
  // Errors render as expandable cards: the chip preview shows
  // a one-line summary, click to expand the full message + the
  // raw JSON for debugging.
  const errorMessage = ok ? null : extractErrorMessage(content);
  const successPreview =
    content.length > 120 ? `${content.slice(0, 120)}…` : content;
  const [expanded, setExpanded] = useState(false);
  const previewText =
    errorMessage !== null
      ? errorMessage.length > 200
        ? `${errorMessage.slice(0, 200)}…`
        : errorMessage
      : successPreview;
  return (
    <div
      className={
        "libre-ai-tool-chip" +
        (ok ? " libre-ai-tool-chip--ok" : " libre-ai-tool-chip--fail") +
        (expanded ? " libre-ai-tool-chip--expanded" : "")
      }
      onClick={errorMessage !== null ? () => setExpanded((v) => !v) : undefined}
      onKeyDown={
        errorMessage !== null
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpanded((v) => !v);
              }
            }
          : undefined
      }
      role={errorMessage !== null ? "button" : undefined}
      tabIndex={errorMessage !== null ? 0 : undefined}
      title={errorMessage !== null ? "Click to expand error" : undefined}
    >
      <span className="libre-ai-tool-chip-icon" aria-hidden>
        <Icon
          icon={ok ? check : xIcon}
          size="xs"
          color="currentColor"
          weight="bold"
        />
      </span>
      <span className="libre-ai-tool-chip-name">{name}</span>
      <span className="libre-ai-tool-chip-preview">{previewText}</span>
      {expanded && errorMessage !== null && (
        <pre className="libre-ai-tool-chip-detail">{content}</pre>
      )}
    </div>
  );
}

/// Pull a readable error string out of a tool-result JSON envelope.
/// Returns null when the content doesn't look like an error
/// result (either it's not JSON, or it's missing the `error` flag).
/// We're permissive about the shape — some tools return
/// `{ ok: false, error: "..." }` (a string) and others return
/// `{ error: true, message: "..." }`. Both surface as readable
/// text for the chip.
function extractErrorMessage(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as {
      error?: unknown;
      ok?: unknown;
      message?: unknown;
    };
    if (parsed === null || typeof parsed !== "object") return null;
    if (parsed.error !== true && parsed.ok !== false) return null;
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
    return "Tool returned an error (no message provided).";
  } catch {
    return null;
  }
}

/// Console output from the latest `run_sandbox_project` call.
/// Sits alongside the preview iframe (or on its own for CLI
/// runs that have no preview surface). Renders the logs with
/// per-level color coding + the run duration + an error block
/// when the run failed.
///
/// Why duplicate the OutputPane logic instead of mounting the
/// OutputPane primitive directly: the agent panel has different
/// chrome (frosted backdrop, narrower column, no tabs) and the
/// logs come from a tool-result JSON not a live `RunResult`
/// object. Re-rendering the simple list of {level, text} rows
/// is a few lines of JSX; trying to coerce the existing
/// component would mean threading a fake-`RunResult` shape that
/// drift-risks future changes to that type.
function ConsolePane({
  run,
  onClose,
}: {
  run: {
    ok: boolean;
    durationMs: number;
    logs: Array<{ level: string; text: string }>;
    error: string | null;
    hasPreview: boolean;
  };
  onClose: () => void;
}) {
  return (
    <div
      className={
        "libre-ai-panel-console" +
        (run.ok ? "" : " libre-ai-panel-console--errored")
      }
      role="region"
      aria-label="Run output"
    >
      <div className="libre-ai-panel-console-head">
        <span className="libre-ai-panel-console-title">
          Console{run.hasPreview ? " · alongside preview" : ""}
        </span>
        <span className="libre-ai-panel-console-meta">
          {run.ok ? "ok" : "fail"} · {run.durationMs.toFixed(0)}ms
        </span>
        <button
          type="button"
          className="libre-ai-panel-preview-close"
          onClick={onClose}
          aria-label="Hide console"
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
      <div className="libre-ai-panel-console-body">
        {run.logs.length === 0 && !run.error && (
          <div className="libre-ai-panel-console-empty">
            no output — the run produced no console writes.
          </div>
        )}
        {run.logs.map((log, i) => (
          <div
            key={i}
            className={
              "libre-ai-panel-console-line " +
              `libre-ai-panel-console-line--${log.level}`
            }
          >
            <pre className="libre-ai-panel-console-text">{log.text}</pre>
          </div>
        ))}
        {run.error && (
          <div className="libre-ai-panel-console-error">
            <div className="libre-ai-panel-console-error-label">error</div>
            <pre className="libre-ai-panel-console-error-text">{run.error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

/// Live-elapsed banner shown while `run_sandbox_project` is in
/// flight. Native runners (rust / c++ / kotlin) can take 10-30
/// seconds to compile + execute; the user needs a visible "yes
/// I'm working" signal beyond the static tool chip spinner.
function RunStatusBanner({
  projectId,
  language,
  startedAt,
}: {
  projectId: string;
  language?: string;
  startedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const elapsedLabel =
    elapsedSec < 60
      ? `${elapsedSec}s`
      : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;
  // Per-language "what's happening" copy. Most languages compile
  // before they run; the label nudges the user toward the right
  // mental model so a 20s wait reads as "compiling, normal" not
  // "frozen, broken".
  const phaseLabel = (() => {
    switch (language) {
      case "rust":
        return `cargo build + run · ${elapsedLabel}`;
      case "go":
        return `go run · ${elapsedLabel}`;
      case "cpp":
      case "c":
        return `compile + execute · ${elapsedLabel}`;
      case "kotlin":
      case "java":
        return `compile to JVM + run · ${elapsedLabel}`;
      case "swift":
        return `swiftc + run · ${elapsedLabel}`;
      case "csharp":
        return `dotnet script · ${elapsedLabel}`;
      case "svelte":
      case "astro":
        return `vite dev · ${elapsedLabel}`;
      case "react":
      case "reactnative":
      case "solid":
        return `bundling + preview · ${elapsedLabel}`;
      default:
        return `running · ${elapsedLabel}`;
    }
  })();
  return (
    <div className="libre-ai-run-banner" role="status" aria-live="polite">
      <span className="libre-ai-run-banner-spinner" aria-hidden />
      <span className="libre-ai-run-banner-text">
        <strong>{projectId}</strong> — {phaseLabel}
      </span>
    </div>
  );
}

/// Compact pill showing one file the agent is currently writing
/// or has finished writing to the sandbox. Source-of-truth is the
/// `libre:agent-file-write` event stream from
/// `useSandboxStreamWriter`; the pill flips from a pulsing
/// orange "writing…" state to a solid green "done" state once
/// the model's closing fence arrives.
function FileWriteChip({
  file,
  onOpen,
}: {
  file: {
    path: string;
    bytes: number;
    closed: boolean;
    language: string;
  };
  /// Jump the sandbox editor to this file (switches to the sandbox
  /// view if needed). Makes the agent's writes navigable.
  onOpen?: () => void;
}) {
  // Three states:
  //   - writing   — fence still open, content arriving
  //   - empty     — fence closed but `bytes === 0`. Previously this
  //                 flipped to "done" (green) and the user couldn't
  //                 tell the file had no content (Notion issue
  //                 #90f0f8a7043015b8 — "All incorrectly go green
  //                 and no data was streamed to the sandbox").
  //                 Now renders with the same "writing" tone so the
  //                 visual is honest: no data, no green.
  //   - done      — fence closed AND bytes > 0. Green check.
  const variant = !file.closed
    ? "writing"
    : file.bytes === 0
      ? "empty"
      : "done";
  const title = `${file.path} · ${file.bytes} bytes · ${file.language}${
    variant === "empty" ? " (no content streamed)" : ""
  }${onOpen ? " — click to open in the editor" : ""}`;
  const inner = (
    <>
      <span className="libre-ai-file-chip-icon" aria-hidden>
        <Icon
          icon={variant === "done" ? check : fileEdit}
          size="xs"
          color="currentColor"
          weight="bold"
        />
      </span>
      <span className="libre-ai-file-chip-path">{file.path}</span>
      <span className="libre-ai-file-chip-bytes">
        {formatBytes(file.bytes)}
      </span>
    </>
  );
  const className = `libre-ai-file-chip libre-ai-file-chip--${variant}${
    onOpen ? " libre-ai-file-chip--clickable" : ""
  }`;
  if (onOpen) {
    return (
      <button type="button" className={className} title={title} onClick={onOpen}>
        {inner}
      </button>
    );
  }
  return (
    <div className={className} title={title}>
      {inner}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function PendingToolChip({
  pending,
  onApprove,
  onDeny,
}: {
  pending: PendingToolCall;
  onApprove: () => void;
  onDeny: () => void;
}): ReactNode {
  // Parse the args to render a short preview — "open lesson X in Y"
  // is much more useful than the raw `{courseId:"...",lessonId:"..."}`.
  let argsPreview = pending.call.arguments;
  try {
    const parsed = JSON.parse(pending.call.arguments);
    argsPreview = JSON.stringify(parsed);
  } catch {
    /* leave as raw */
  }
  if (argsPreview.length > 100) {
    argsPreview = `${argsPreview.slice(0, 100)}…`;
  }
  const isRunning = pending.approval.kind === "running";
  const isApproved = pending.approval.kind === "approved";
  const isDenied = pending.approval.kind === "denied";
  return (
    <div
      className={
        "libre-ai-tool-chip libre-ai-tool-chip--pending" +
        (isApproved ? " libre-ai-tool-chip--ok" : "") +
        (isRunning ? " libre-ai-tool-chip--running" : "") +
        (isDenied ? " libre-ai-tool-chip--fail" : "")
      }
    >
      <span
        className={
          "libre-ai-tool-chip-icon" +
          (isRunning ? " libre-ai-tool-chip-icon--spin" : "")
        }
        aria-hidden
      >
        <Icon icon={hammer} size="xs" color="currentColor" weight="bold" />
      </span>
      <span className="libre-ai-tool-chip-name">{pending.tool.name}</span>
      <span className="libre-ai-tool-chip-preview">{argsPreview}</span>
      {isRunning && (
        <span className="libre-ai-tool-chip-status" aria-live="polite">
          running…
        </span>
      )}
      {pending.approval.kind === "pending" && (
        <span className="libre-ai-tool-chip-actions">
          <button
            type="button"
            className="libre-ai-tool-chip-btn libre-ai-tool-chip-btn--ok"
            onClick={onApprove}
          >
            Allow
          </button>
          <button
            type="button"
            className="libre-ai-tool-chip-btn libre-ai-tool-chip-btn--deny"
            onClick={onDeny}
          >
            Deny
          </button>
        </span>
      )}
    </div>
  );
}

/// Does the scope carry ANY restrictions worth showing? Empty
/// allow-lists + empty deny-list + no active project = no chip
/// needed.
function hasScopeRestrictions(scope: AgentScope): boolean {
  return (
    !!scope.activeProjectId ||
    scope.allowedProjectIds.size > 0 ||
    scope.allowedPathPatterns.length > 0 ||
    scope.readOnlyPaths.length > 0
  );
}

function ScopeChip({
  scope,
  onClear,
}: {
  scope: AgentScope;
  onClear?: () => void;
}) {
  const parts: string[] = [];
  if (scope.activeProjectId) parts.push(`focus: ${scope.activeProjectId}`);
  if (scope.allowedProjectIds.size > 0)
    parts.push(`${scope.allowedProjectIds.size} project(s)`);
  if (scope.allowedPathPatterns.length > 0)
    parts.push(`${scope.allowedPathPatterns.length} path pattern(s)`);
  if (scope.readOnlyPaths.length > 0)
    parts.push(`${scope.readOnlyPaths.length} read-only`);
  return (
    <div className="libre-ai-panel-scope" title={parts.join(" · ")}>
      <Icon icon={hammer} size="xs" color="currentColor" weight="bold" />
      <span className="libre-ai-panel-scope-text">
        Scope: {parts.join(" · ")}
      </span>
      {onClear && (
        <button
          type="button"
          className="libre-ai-panel-scope-clear"
          onClick={onClear}
          aria-label="Clear agent scope"
        >
          clear
        </button>
      )}
    </div>
  );
}

function TimelineDrawer({
  timeline,
  onClose,
}: {
  timeline: ToolResult[];
  onClose: () => void;
}) {
  return (
    <div className="libre-ai-panel-drawer" role="dialog" aria-label="Tool call timeline">
      <div className="libre-ai-panel-drawer-head">
        <span>Tool calls · {timeline.length}</span>
        <button
          type="button"
          className="libre-ai-panel-drawer-close"
          onClick={onClose}
          aria-label="Close timeline"
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
      <div className="libre-ai-panel-drawer-body">
        {timeline.length === 0 ? (
          <div className="libre-ai-panel-drawer-empty">
            No tool calls yet in this run.
          </div>
        ) : (
          timeline.map((entry, i) => (
            <details key={i} className="libre-ai-panel-drawer-entry">
              <summary
                className={
                  "libre-ai-panel-drawer-entry-head" +
                  (entry.ok
                    ? " is-ok"
                    : " is-fail")
                }
              >
                <span className="libre-ai-panel-drawer-entry-name">
                  {entry.name}
                </span>
                <span className="libre-ai-panel-drawer-entry-status">
                  {entry.ok ? "ok" : "fail"}
                </span>
              </summary>
              <pre className="libre-ai-panel-drawer-entry-body">
                {prettyJson(entry.content)}
              </pre>
            </details>
          ))
        )}
      </div>
    </div>
  );
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/// HUD strip beneath the header. Renders the confidence meter
/// + token counter + run duration + (during streaming) a Stop
/// button. The individual readouts respect the settings.show*
/// flags so the user can turn each off independently from the
/// settings sheet.
///
/// Live duration ticker: while streaming, an interval timer
/// re-renders the duration field every 250ms by adding the
/// elapsed wall time to the completed-turns baseline. The HUD
/// reads "5.2s · 3 turns" and the seconds actually tick up
/// instead of jumping by N at turn boundaries.
function AgentHud({
  confidence,
  usage,
  showTokens,
  showConfidence,
  streaming,
  onStop,
}: {
  confidence: number | null;
  usage?: RunUsage;
  showTokens: boolean;
  showConfidence: boolean;
  streaming: boolean;
  onStop?: () => void;
}) {
  // Both readouts hidden AND no Stop button? Skip the strip
  // entirely so it doesn't eat vertical space.
  if (!showTokens && !showConfidence && !onStop) return null;
  // Live duration ticker. We capture the time the streaming
  // STARTED (or rather, the time the HUD first saw streaming
  // flip true) and recompute the elapsed window every 250ms
  // until it flips false. The completed-turns baseline (from
  // `usage.durationMs`) plus this elapsed window is what we
  // display.
  const streamStartedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (streaming) {
      if (streamStartedAt.current === null) {
        streamStartedAt.current = Date.now();
      }
      setNow(Date.now());
      const id = window.setInterval(() => setNow(Date.now()), 250);
      return () => window.clearInterval(id);
    } else {
      streamStartedAt.current = null;
      return undefined;
    }
  }, [streaming]);
  const liveDurationMs =
    streaming && streamStartedAt.current !== null
      ? now - streamStartedAt.current
      : 0;
  const totalDurationMs = (usage?.durationMs ?? 0) + liveDurationMs;
  // Nothing to show YET (run just started, no usage / no
  // confidence) AND not streaming? Render nothing.
  const empty =
    (!usage || usage.turns === 0) && confidence === null && !streaming;
  if (empty) return null;
  const bucket = classifyConfidence(confidence);
  return (
    <div
      className="libre-ai-hud"
      role="status"
      aria-label="Agent run telemetry"
    >
      {showConfidence && (
        <div
          className={`libre-ai-hud-confidence libre-ai-hud-confidence--${bucket}`}
          title={
            confidence === null
              ? "No confidence rating yet"
              : `Model confidence: ${Math.round((confidence ?? 0) * 100)}%`
          }
        >
          <span className="libre-ai-hud-confidence-label">conf</span>
          <span className="libre-ai-hud-confidence-bar">
            <span
              className="libre-ai-hud-confidence-fill"
              style={{
                width:
                  confidence === null
                    ? "0%"
                    : `${Math.round((confidence ?? 0) * 100)}%`,
              }}
            />
          </span>
          <span className="libre-ai-hud-confidence-value">
            {confidence === null
              ? "—"
              : `${Math.round((confidence ?? 0) * 100)}%`}
          </span>
        </div>
      )}
      {showTokens && (
        <div className="libre-ai-hud-tokens" title="Tokens this run">
          <span className="libre-ai-hud-tokens-label">tok</span>
          <span className="libre-ai-hud-tokens-value">
            {usage
              ? `${formatTokens(usage.promptTokens)} ↑ · ${formatTokens(
                  usage.completionTokens,
                )} ↓`
              : "—"}
          </span>
          {totalDurationMs > 0 && (
            <span className="libre-ai-hud-tokens-duration">
              {formatDuration(totalDurationMs)}
            </span>
          )}
          {usage && usage.turns > 0 && (
            <span className="libre-ai-hud-tokens-turns">
              {usage.turns} turn{usage.turns === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
      {onStop && (
        <button
          type="button"
          className="libre-ai-hud-stop"
          onClick={onStop}
          title="Stop the agent (⌘.)"
          aria-label="Stop agent"
        >
          <span className="libre-ai-hud-stop-icon" aria-hidden>
            ■
          </span>
          <span className="libre-ai-hud-stop-label">stop</span>
        </button>
      )}
    </div>
  );
}

/// Settings sheet. Renders the user-tunable knobs the agent loop
/// reads on every turn: auto-approve, low-confidence pause,
/// max turns, HUD visibility flags. Saves through the
/// `onUpdate` callback (which the host wires to localStorage via
/// the settings module).
function SettingsSheet({
  settings,
  onUpdate,
  onClose,
}: {
  settings: AiAgentSettings;
  onUpdate: (next: AiAgentSettings) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof AiAgentSettings>(
    key: K,
    value: AiAgentSettings[K],
  ) => onUpdate({ ...settings, [key]: value });
  return (
    <div
      className="libre-ai-panel-settings-sheet"
      role="dialog"
      aria-label="Agent settings"
    >
      <div className="libre-ai-panel-settings-head">
        <span>Agent settings</span>
        <button
          type="button"
          className="libre-ai-panel-drawer-close"
          onClick={onClose}
          aria-label="Close settings"
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
      <div className="libre-ai-panel-settings-body">
        {/* Model + effort moved to the panel HEADER dropdowns (one
            click away in either mode), so they're not duplicated
            here. A pointer keeps anyone hunting for them oriented. */}
        <p className="libre-ai-panel-settings-pointer">
            Model &amp; effort live in the header dropdowns above.
        </p>

        {/* Co-working mode — the headline of the settings sheet. A
            segmented dial from hands-off to hands-on, with the active
            mode's blurb spelled out beneath so the choice is
            self-explanatory. Shapes the agent prompt + gates the
            Earn-the-Diff rewind. */}
        <div className="libre-ai-pairmode">
          <div className="libre-ai-pairmode-head">
            <div className="libre-ai-panel-setting-label">Co-working mode</div>
            <div className="libre-ai-panel-setting-hint">
              How closely you build alongside the agent.
            </div>
          </div>
          <div
            className="libre-ai-pairmode-seg"
            role="radiogroup"
            aria-label="Co-working mode"
          >
            {PAIR_MODES.map((m) => {
              const active = settings.pairMode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    "libre-ai-pairmode-opt" + (active ? " is-active" : "")
                  }
                  onClick={() => set("pairMode", m.value)}
                  title={m.blurb}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="libre-ai-pairmode-blurb">
            {PAIR_MODES.find((m) => m.value === settings.pairMode)?.blurb}
          </p>
        </div>

        <SettingRow
          label="Auto-approve tool calls"
          hint="Tools run without the approve / deny chip. Low-confidence calls still pause unless you turn off the next setting."
        >
          <input
            type="checkbox"
            checked={settings.autoApprove}
            onChange={(e) => set("autoApprove", e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          label="Pause on low confidence"
          hint="Even with auto-approve on, gate tool calls when the model rated its own confidence below 50%."
        >
          <input
            type="checkbox"
            checked={settings.pauseOnLowConfidence}
            onChange={(e) => set("pauseOnLowConfidence", e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          label="Show confidence meter"
          hint="The colored meter in the HUD strip beneath the header."
        >
          <input
            type="checkbox"
            checked={settings.showConfidence}
            onChange={(e) => set("showConfidence", e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          label="Show token usage"
          hint="Input / output token counts + run duration in the HUD."
        >
          <input
            type="checkbox"
            checked={settings.showTokens}
            onChange={(e) => set("showTokens", e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          label="Max turns per run"
          hint="Safety cap. The loop bails after this many agent turns. Higher = more complex builds, longer worst-case stalls."
        >
          <input
            type="number"
            min={1}
            max={50}
            value={settings.maxTurns}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) set("maxTurns", n);
            }}
          />
        </SettingRow>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="libre-ai-panel-setting-row">
      <div className="libre-ai-panel-setting-text">
        <div className="libre-ai-panel-setting-label">{label}</div>
        {hint && (
          <div className="libre-ai-panel-setting-hint">{hint}</div>
        )}
      </div>
      <div className="libre-ai-panel-setting-control">{children}</div>
    </label>
  );
}

/// Clarification sheet. The agent called `request_user_input` and
/// the run is paused. We render the question + optional context
/// over the composer and resolve the loop's promise via the
/// `onAnswer` callback when the user submits.
function ClarificationSheet({
  clarification,
  onAnswer,
  onCancel,
}: {
  clarification: PendingClarification;
  onAnswer: (answer: string) => void;
  onCancel: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const submit = () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
    setAnswer("");
  };
  return (
    <div
      className="libre-ai-panel-clarification"
      role="dialog"
      aria-label="Agent question"
    >
      <div className="libre-ai-panel-clarification-head">
        <span className="libre-ai-panel-clarification-tag">agent asks</span>
        <button
          type="button"
          className="libre-ai-panel-drawer-close"
          onClick={onCancel}
          aria-label="Cancel question"
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>
      <div className="libre-ai-panel-clarification-question">
        {clarification.question}
      </div>
      {clarification.context && (
        <div className="libre-ai-panel-clarification-context">
          {clarification.context}
        </div>
      )}
      <textarea
        className="libre-ai-panel-clarification-input"
        placeholder="Type your answer…"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        rows={3}
        autoFocus
      />
      <div className="libre-ai-panel-clarification-actions">
        <button
          type="button"
          className="libre-ai-tool-chip-btn libre-ai-tool-chip-btn--deny"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="libre-ai-tool-chip-btn libre-ai-tool-chip-btn--ok"
          onClick={submit}
          disabled={!answer.trim()}
        >
          Send (⌘↵)
        </button>
      </div>
    </div>
  );
}

function EmptyAgentHint({
  onPick,
}: {
  onPick: (prompt: string) => void;
}) {
  const prompts = [
    "Build me a blackjack game in React.",
    "Make a fizzbuzz CLI in Python.",
    "Scaffold a Three.js scene with a spinning cube.",
    "Find lessons about pattern matching and open the first one.",
    "What should I work on next?",
  ];
  return (
    <div className="libre-ai-panel-empty">
      <div className="libre-ai-panel-empty-title">
        Agent mode — I can build + open things
      </div>
      <p>
        Ask me to scaffold a project, find a lesson, or pick what to learn
        next. I'll show what I want to do and wait for your OK before
        making changes. Files stream into your sandbox in real time as I
        write them.
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
