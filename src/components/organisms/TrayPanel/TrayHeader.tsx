/// AI panel header — colorful, iconified zone that anchors both
/// the menu-bar popover AND the in-app slide-in chat panel. Same
/// chrome for both surfaces so the user gets a consistent
/// vocabulary regardless of where they're talking to the agent.
///
/// Layout (left → right):
///   [mode toggle: chat / agent (icons + label)]
///                     [status dot]   [sessions menu]   [+ new]
///                                                       [× close]
///
/// - Mode toggle uses inline SVG (chat bubble / bolt) so it stays
///   crisp at every DPI and inherits `currentColor` for theme
///   switches.
/// - Status dot lights green when Ollama is reachable + the
///   default model is pulled, amber when the daemon's up but the
///   model is missing, red when nothing's responding. Tooltip
///   surfaces the human-readable state.
/// - Sessions menu is a popover-anchored list of past
///   conversations the user can switch to. Each row shows the
///   name + mode badge + relative timestamp + a delete X.
/// - "+ new" spawns a fresh session in the current mode.
/// - `× close` only renders when `onClose` is provided — the
///   menu-bar popover hides itself on blur, so it doesn't need
///   the affordance; the in-app slide-in panel does.

import { useRef, useState, type ReactNode } from "react";
import type { ProbeResult } from "@/hooks/useAiChat";
import ModelPicker from "@/components/organisms/AiAssistant/ModelPicker";
import { compactModelLabel } from "@/lib/ai/models";
import { EFFORT_OPTIONS, type AiAgentSettings } from "@/lib/aiAgent/settings";
import { useDismiss } from "@/hooks/useDismiss";
import type { TraySession } from "./useTraySessions";

interface Props {
  mode: "chat" | "agent";
  setMode: (mode: "chat" | "agent") => void;
  probe: ProbeResult | null;
  /// Live assistant settings — the header's model + effort dropdowns
  /// read the current selection from here and write changes back via
  /// `onUpdateSettings`. Same object the agent settings sheet edits,
  /// so the two stay in lockstep.
  settings: AiAgentSettings;
  onUpdateSettings: (next: AiAgentSettings) => void;
  sessions: readonly TraySession[];
  activeId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  /// When provided, renders an `×` close button at the right
  /// edge of the header. Used by the in-app slide-in variant of
  /// the AI surface (the tray relies on auto-hide-on-blur for
  /// dismissal and intentionally omits the button).
  onClose?: () => void;
}

export default function TrayHeader({
  mode,
  setMode,
  probe,
  settings,
  onUpdateSettings,
  sessions,
  activeId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onClose,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismissal for the sessions menu. Captures on
  // pointerdown so a synchronous click that opens the menu can't
  // immediately re-close it via the same event firing on the
  // document. No Escape handling here (matches the original).
  useDismiss(menuRef, () => setMenuOpen(false), {
    enabled: menuOpen,
    escape: false,
  });

  const status = computeStatus(probe);

  return (
    <>
    <div className="libre-tray-header">
      <div className="libre-tray-header-mode" role="tablist" aria-label="Assistant mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          className={
            "libre-tray-header-mode-btn" +
            (mode === "chat" ? " is-active" : "")
          }
          onClick={() => setMode("chat")}
          title="Chat — streaming Q&A"
        >
          <ChatBubbleIcon />
          <span>Chat</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "agent"}
          className={
            "libre-tray-header-mode-btn" +
            (mode === "agent" ? " is-active" : "")
          }
          onClick={() => setMode("agent")}
          title="Agent — tools that act on your behalf"
        >
          <BoltIcon />
          <span>Agent</span>
        </button>
      </div>

      <div className="libre-tray-header-spacer" />

      <button
        type="button"
        className={`libre-tray-header-status libre-tray-header-status--${status.tone}`}
        title={status.label}
        aria-label={`Ollama ${status.label}`}
      >
        <span className="libre-tray-header-status-dot" aria-hidden />
      </button>

      <div className="libre-tray-header-sessions" ref={menuRef}>
        <button
          type="button"
          className="libre-tray-header-sessions-trigger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={`${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
        >
          <HistoryIcon />
          <span className="libre-tray-header-sessions-count">
            {sessions.length}
          </span>
        </button>
        {menuOpen && (
          <div className="libre-tray-header-sessions-menu" role="menu">
            <div className="libre-tray-header-sessions-menu-title">
              Sessions
            </div>
            {sessions.length === 0 ? (
              <div className="libre-tray-header-sessions-menu-empty">
                No saved sessions.
              </div>
            ) : (
              <ul className="libre-tray-header-sessions-list">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className={
                      "libre-tray-header-sessions-row" +
                      (s.id === activeId ? " is-active" : "")
                    }
                  >
                    <button
                      type="button"
                      className="libre-tray-header-sessions-row-pick"
                      onClick={() => {
                        onSelectSession(s.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span
                        className={`libre-tray-header-sessions-mode libre-tray-header-sessions-mode--${s.mode}`}
                        aria-hidden
                      >
                        {s.mode === "agent" ? <BoltIcon /> : <ChatBubbleIcon />}
                      </span>
                      <span className="libre-tray-header-sessions-name">
                        {s.name}
                      </span>
                      <span className="libre-tray-header-sessions-time">
                        {relativeTime(s.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="libre-tray-header-sessions-row-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      title="Delete session"
                      aria-label="Delete session"
                    >
                      <XIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="libre-tray-header-new"
        onClick={onNewSession}
        title="New session"
        aria-label="New session"
      >
        <PlusIcon />
      </button>

      {onClose && (
        <button
          type="button"
          className="libre-tray-header-close"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          <XIcon />
        </button>
      )}
    </div>

    {/* Quick-settings strip — model + effort dropdowns, surfaced
        from the (otherwise buried) agent settings sheet so they're
        one click away in EITHER mode. Both write through
        onUpdateSettings, which the host funnels into the agent AND
        the chat hook. */}
    <div className="libre-tray-subheader" aria-label="Assistant quick settings">
      <ModelHeaderDropdown
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />
      <EffortHeaderDropdown
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </div>
    </>
  );
}

// ── Header quick-settings dropdowns ─────────────────────────────
// Two compact popover dropdowns living in the subheader strip:
// the model selector (wraps the full ModelPicker so pulls work
// straight from the header) and the effort dial. Both share a tiny
// popover shell with click-outside + Escape dismissal.

interface DropdownProps {
  settings: AiAgentSettings;
  onUpdateSettings: (next: AiAgentSettings) => void;
}

/// Shared dropdown shell. `renderPanel` receives a `close` fn so the
/// panel content can dismiss the popover after committing a choice
/// (model "Use" / effort pick) while staying open during slow work
/// (a model pull, which doesn't call close until it auto-selects).
function HeaderDropdown({
  triggerIcon,
  triggerLabel,
  triggerTitle,
  ariaLabel,
  panelClassName,
  renderPanel,
}: {
  triggerIcon: ReactNode;
  triggerLabel: string;
  triggerTitle: string;
  ariaLabel: string;
  panelClassName?: string;
  renderPanel: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape dismissal for the popover panel.
  useDismiss(ref, () => setOpen(false), { enabled: open });

  return (
    <div className="libre-tray-dd" ref={ref}>
      <button
        type="button"
        className={"libre-tray-dd-trigger" + (open ? " is-open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerTitle}
      >
        <span className="libre-tray-dd-icon" aria-hidden>
          {triggerIcon}
        </span>
        <span className="libre-tray-dd-label">{triggerLabel}</span>
        <span className="libre-tray-dd-caret" aria-hidden>
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div
          className={"libre-tray-dd-panel " + (panelClassName ?? "")}
          role="menu"
          aria-label={ariaLabel}
        >
          {renderPanel(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ModelHeaderDropdown({ settings, onUpdateSettings }: DropdownProps) {
  return (
    <HeaderDropdown
      triggerIcon={<CpuIcon />}
      triggerLabel={compactModelLabel(settings.model)}
      triggerTitle={`Assistant model — ${settings.model}`}
      ariaLabel="Assistant model"
      panelClassName="libre-tray-dd-panel--model"
      renderPanel={(close) => (
        <ModelPicker
          currentModel={settings.model}
          onSelect={(id) => {
            onUpdateSettings({ ...settings, model: id });
            close();
          }}
        />
      )}
    />
  );
}

function EffortHeaderDropdown({ settings, onUpdateSettings }: DropdownProps) {
  const current =
    EFFORT_OPTIONS.find((o) => o.value === settings.effort) ?? EFFORT_OPTIONS[1];
  return (
    <HeaderDropdown
      triggerIcon={<GaugeIcon />}
      triggerLabel={current.label}
      triggerTitle={`Effort — ${current.label}: ${current.blurb}`}
      ariaLabel="Effort level"
      panelClassName="libre-tray-dd-panel--effort"
      renderPanel={(close) => (
        <ul className="libre-tray-effort-list" role="none">
          {EFFORT_OPTIONS.map((o) => (
            <li key={o.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={o.value === settings.effort}
                className={
                  "libre-tray-effort-item" +
                  (o.value === settings.effort ? " is-active" : "")
                }
                onClick={() => {
                  onUpdateSettings({ ...settings, effort: o.value });
                  close();
                }}
              >
                <span className="libre-tray-effort-name">
                  {o.label}
                  {o.value === "ultra" && (
                    <span className="libre-tray-effort-max">MAX</span>
                  )}
                </span>
                <span className="libre-tray-effort-blurb">{o.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    />
  );
}

interface StatusInfo {
  tone: "ok" | "warn" | "bad";
  label: string;
}

function computeStatus(probe: ProbeResult | null): StatusInfo {
  if (!probe) return { tone: "warn", label: "Probing…" };
  if (!probe.reachable) return { tone: "bad", label: "Ollama unreachable" };
  if (!probe.hasDefaultModel) {
    return { tone: "warn", label: "Default model not pulled" };
  }
  return { tone: "ok", label: "Ready" };
}

/// One-grain relative-time formatter. Hard-coded English labels —
/// matches the rest of the tray UI which isn't i18n-aware. Keeps
/// the implementation tiny (no `Intl.RelativeTimeFormat` overhead
/// for a label that's at most 4 chars wide).
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w`;
  const mo = Math.floor(day / 30);
  return `${mo}mo`;
}

// ── Inline SVG icons ────────────────────────────────────────────
// Single 16×16 path each, stroked via `currentColor` so they
// inherit the button's text color (which changes on active /
// hover). Inline saves an asset import + lets CSS recolor them
// per state without per-icon SVG sprites.

function ChatBubbleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 4.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7l-3 2.5V10.5H5a2 2 0 0 1-2-2v-4Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 1.5 3.5 9h4l-1 5.5L13 7h-4l1-5.5Z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3a5 5 0 1 1-4.6 7" />
      <path d="M3 5.5V3H5.5" />
      <path d="M8 5.5v3l2 1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6.5 8 10.5 12 6.5" />
    </svg>
  );
}

/// Model selector glyph — a little CPU/chip outline.
function CpuIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" />
      <path d="M6.5 6.5h3v3h-3z" />
      <path d="M6 2.5v2M10 2.5v2M6 11.5v2M10 11.5v2M2.5 6h2M2.5 10h2M11.5 6h2M11.5 10h2" />
    </svg>
  );
}

/// Effort dial glyph — a gauge with a needle.
function GaugeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 11a5.5 5.5 0 0 1 11 0" />
      <path d="M8 11 10.5 6.5" />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
