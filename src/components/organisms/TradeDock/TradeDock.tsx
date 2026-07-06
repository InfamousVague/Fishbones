/// In-app API tester — Postman-shaped client mounted above lessons
/// that opt into the Trade harness (`harness: "trade"`) or live in
/// the HelloTrade course. Two main panels:
///
///   - **REST**: pick a method, fill the URL / headers / body,
///     hit Send, see status + headers + pretty-printed body.
///   - **WebSocket**: open a connection, send framed messages,
///     watch the stream of inbound messages render inline.
///
/// Plus a **saved-requests sidebar** populated from `presets.ts`,
/// and an **environment panel** for variables like `{{baseUrl}}`
/// and `{{marketDataToken}}` that get substituted into URLs +
/// bodies on send.
///
/// Runs in **mock mode by default** — `mockResponses.ts`
/// recognises every preset URL and returns canned-but-accurate
/// JSON, so the dock works fully offline against the course
/// material. A toggle in the header switches to **live mode**,
/// which lets the request hit the real wire (HelloTrade's staging
/// API). The toggle persists per-app via localStorage so a user
/// who wants to play with the real API keeps it on across
/// lesson navigation.
///
/// Like ChainDock, the dock attaches to a singleton state store
/// so two mount points (banner + popout in the future) see the
/// same history / saved env / connection state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/i18n/i18n";
import { Icon } from "@base/primitives/icon";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { panelLeftClose } from "@base/primitives/icon/icons/panel-left-close";
import { play as playIcon } from "@base/primitives/icon/icons/play";
import { trash } from "@base/primitives/icon/icons/trash";
import { plug } from "@base/primitives/icon/icons/plug";
import { plugZap } from "@base/primitives/icon/icons/plug-zap";
import { send as sendIcon } from "@base/primitives/icon/icons/send";
import { radio } from "@base/primitives/icon/icons/radio";
import { testTube } from "@base/primitives/icon/icons/test-tube";
import { braces } from "@base/primitives/icon/icons/braces";
import "@base/primitives/icon/icon.css";
import {
  ENV_DEFAULTS,
  PRESETS,
  type Preset,
  type PresetMethod,
  type RestPreset,
  type WsPreset,
} from "./presets";
import { mockRest, mockWs, type MockWsFrame } from "./mockResponses";
import "./TradeDock.css";

// ── Singleton store ─────────────────────────────────────────────

const STORAGE_KEYS = {
  liveMode: "libre:tradedock:live-mode",
  env: "libre:tradedock:env",
  history: "libre:tradedock:history",
};

/// Resizable banner height — matches the BitcoinChainDock pattern.
/// Default 200px lines up with ChainDock + SvmDock so the three
/// docks read at the same vertical anchor when a learner pivots
/// between courses. Min 140px so the response panel is still
/// usable; max 720px so a stretched dock doesn't push the lesson
/// body completely off-screen.
const TRADE_DOCK_HEIGHT_KEY = "fb.trade-dock.height";
const TRADE_DOCK_HEIGHT_DEFAULT = 200;
const TRADE_DOCK_HEIGHT_MIN = 140;
const TRADE_DOCK_HEIGHT_MAX = 720;

interface RestHistoryEntry {
  id: string;
  ts: number;
  method: PresetMethod;
  url: string;
  status: number;
  durationMs: number;
}

function readEnv(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.env);
    if (!raw) return { ...ENV_DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...ENV_DEFAULTS, ...parsed };
  } catch {
    return { ...ENV_DEFAULTS };
  }
}

function writeEnv(env: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.env, JSON.stringify(env));
  } catch {
    /* swallow */
  }
}

function readLiveMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.liveMode) === "1";
  } catch {
    return false;
  }
}

function writeLiveMode(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.liveMode, on ? "1" : "0");
  } catch {
    /* swallow */
  }
}

function readHistory(): RestHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RestHistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function writeHistory(rows: RestHistoryEntry[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.history,
      JSON.stringify(rows.slice(0, 30)),
    );
  } catch {
    /* swallow */
  }
}

// ── Variable substitution ───────────────────────────────────────

/// Replace every `{{varName}}` token in a string with the value
/// from the env map, leaving unknown tokens untouched (they'll be
/// visible in the resolved URL so the user notices a typo).
function substitute(
  s: string,
  env: Record<string, string>,
): string {
  return s.replace(/\{\{([^}]+)\}\}/g, (_match, name: string) => {
    const trimmed = name.trim();
    return env[trimmed] !== undefined ? env[trimmed] : `{{${trimmed}}}`;
  });
}

// ── Component ───────────────────────────────────────────────────

interface Props {
  variant?: "banner" | "popout";
  onClose?: () => void;
}

export function TradeDock({ variant = "banner", onClose }: Props) {
  const t = useT();
  const [tab, setTab] = useState<"rest" | "ws">("rest");
  const [liveMode, setLiveMode] = useState<boolean>(() => readLiveMode());
  const [env, setEnv] = useState<Record<string, string>>(() => readEnv());
  const [envOpen, setEnvOpen] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(
    PRESETS[0]?.id ?? null,
  );

  // Resizable banner height. Persisted across reloads — once a
  // learner picks a comfortable size, every subsequent visit gets
  // it back. Popout mode would be full-window and would ignore
  // this entirely (no popout shipped today).
  const [bannerHeight, setBannerHeight] = useLocalStorageState<number>(
    TRADE_DOCK_HEIGHT_KEY,
    TRADE_DOCK_HEIGHT_DEFAULT,
  );
  // Drag held in a ref so the mousemove closure doesn't cause a
  // re-render every frame; the CSS variable on the root re-applies
  // live via direct DOM mutation while dragging for instant feedback.
  // Same pattern BitcoinChainDock uses.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (variant !== "banner") return;
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startH: bannerHeight };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current || !rootRef.current) return;
        const delta = ev.clientY - dragRef.current.startY;
        const next = Math.max(
          TRADE_DOCK_HEIGHT_MIN,
          Math.min(TRADE_DOCK_HEIGHT_MAX, dragRef.current.startH + delta),
        );
        rootRef.current.style.setProperty(
          "--trade-dock-height",
          `${next}px`,
        );
      };
      const onUp = () => {
        if (!dragRef.current || !rootRef.current) return;
        const live = rootRef.current.style.getPropertyValue(
          "--trade-dock-height",
        );
        const px = parseInt(live, 10);
        if (Number.isFinite(px)) setBannerHeight(px);
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [variant, bannerHeight, setBannerHeight],
  );

  // Inline style only asserts the height in banner mode. Popout
  // mode wants 100% of its window; the CSS rule sets that.
  const rootStyle =
    variant === "banner"
      ? ({
          "--trade-dock-height": `${bannerHeight}px`,
        } as React.CSSProperties)
      : undefined;

  const activePreset = useMemo(
    () => PRESETS.find((p) => p.id === activePresetId) ?? null,
    [activePresetId],
  );

  function applyLive(on: boolean) {
    setLiveMode(on);
    writeLiveMode(on);
  }

  function updateEnv(name: string, value: string) {
    const next = { ...env, [name]: value };
    setEnv(next);
    writeEnv(next);
  }

  // Keep tab in sync with the picked preset's kind so clicking
  // a WebSocket preset auto-switches to the WS panel (and vice
  // versa). Skips when tab matches already to avoid an extra
  // re-render on click.
  useEffect(() => {
    if (!activePreset) return;
    const next = activePreset.kind === "ws" ? "ws" : "rest";
    if (tab !== next) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePresetId]);

  return (
    <div
      ref={rootRef}
      className={"libre-trade-dock libre-trade-dock--" + variant}
      style={rootStyle}
    >
      <header className="libre-trade-dock__header">
        <div className="libre-trade-dock__title">
          <span className="libre-trade-dock__title-icon" aria-hidden>
            <Icon icon={plug} size="sm" color="currentColor" />
          </span>
          <span>{t("tradeDock.apiTester")}</span>
          <span
            className={
              "libre-trade-dock__mode-pill" +
              (liveMode ? " libre-trade-dock__mode-pill--live" : "")
            }
            title={
              liveMode
                ? t("tradeDock.liveModeTitle")
                : t("tradeDock.mockModeTitle")
            }
          >
            {liveMode ? t("tradeDock.live") : t("tradeDock.mock")}
          </span>
        </div>
        <div className="libre-trade-dock__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "rest"}
            className={
              "libre-trade-dock__tab" +
              (tab === "rest" ? " is-active" : "")
            }
            onClick={() => setTab("rest")}
          >
            REST
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ws"}
            className={
              "libre-trade-dock__tab" +
              (tab === "ws" ? " is-active" : "")
            }
            onClick={() => setTab("ws")}
          >
            WebSocket
          </button>
        </div>
        <div className="libre-trade-dock__header-actions">
          <button
            type="button"
            role="switch"
            aria-checked={liveMode}
            className={
              "libre-trade-dock__live-switch" +
              (liveMode ? " is-live" : "")
            }
            onClick={() => applyLive(!liveMode)}
            title={
              liveMode
                ? t("tradeDock.liveSwitchTitle")
                : t("tradeDock.mockSwitchTitle")
            }
          >
            <span className="libre-trade-dock__live-thumb" aria-hidden>
              <Icon
                icon={liveMode ? radio : testTube}
                size="xs"
                color="currentColor"
              />
            </span>
          </button>
          <button
            type="button"
            className="libre-trade-dock__icon-btn"
            onClick={() => setEnvOpen((v) => !v)}
            title={
              envOpen
                ? t("tradeDock.envToggleHide")
                : t("tradeDock.envToggleShow")
            }
            aria-pressed={envOpen}
            aria-label={t("tradeDock.envAria")}
          >
            <Icon icon={braces} size="xs" color="currentColor" />
          </button>
          {variant === "banner" && onClose && (
            <button
              type="button"
              className="libre-trade-dock__icon-btn"
              onClick={onClose}
              title={t("tradeDock.hideDock")}
            >
              <Icon icon={panelLeftClose} size="xs" color="currentColor" />
            </button>
          )}
        </div>
      </header>

      {envOpen && (
        <EnvPanel env={env} onChange={updateEnv} defaults={ENV_DEFAULTS} />
      )}

      <div className="libre-trade-dock__body">
        <PresetsSidebar
          activePresetId={activePresetId}
          onPick={setActivePresetId}
        />
        <div className="libre-trade-dock__main">
          {tab === "rest" ? (
            <RestPanel
              key={activePresetId ?? "blank"}
              preset={activePreset?.kind === "rest" ? activePreset : null}
              env={env}
              liveMode={liveMode}
            />
          ) : (
            <WsPanel
              key={activePresetId ?? "blank"}
              preset={activePreset?.kind === "ws" ? activePreset : null}
              env={env}
              liveMode={liveMode}
            />
          )}
        </div>
      </div>
      {/* Bottom-edge drag handle — same shape as BitcoinChainDock's
          resize affordance. Invisible 6px strip straddling the
          dock's bottom border, ns-resize cursor on hover. Banner
          mode only; popout would manage its own window size. */}
      {variant === "banner" && (
        <div
          className="libre-trade-dock__resize-handle"
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("tradeDock.resizeAria")}
          title={t("tradeDock.resizeTitle")}
        />
      )}
    </div>
  );
}

// ── Env panel ───────────────────────────────────────────────────

function EnvPanel({
  env,
  onChange,
  defaults,
}: {
  env: Record<string, string>;
  onChange: (name: string, value: string) => void;
  defaults: Record<string, string>;
}) {
  const t = useT();
  const keys = Object.keys({ ...defaults, ...env });
  return (
    <div className="libre-trade-dock__env">
      <span
        className="libre-trade-dock__env-hint"
        // The string carries a <code> tag — same pattern as
        // library.dropSub.
        dangerouslySetInnerHTML={{ __html: t("tradeDock.envHint") }}
      />
      <div className="libre-trade-dock__env-grid">
        {keys.map((k) => (
          <label key={k} className="libre-trade-dock__env-row">
            <span className="libre-trade-dock__env-label">{k}</span>
            <input
              className="libre-trade-dock__env-input"
              value={env[k] ?? ""}
              onChange={(e) => onChange(k, e.target.value)}
              spellCheck={false}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Presets sidebar ─────────────────────────────────────────────

function PresetsSidebar({
  activePresetId,
  onPick,
}: {
  activePresetId: string | null;
  onPick: (id: string) => void;
}) {
  const t = useT();
  // Group presets by category in the order they appear (keeps the
  // logical "market data → account → ws-market → ws-trading"
  // ordering from the presets file).
  const groups = useMemo(() => {
    const seen = new Map<string, Preset[]>();
    for (const p of PRESETS) {
      const arr = seen.get(p.category) ?? [];
      arr.push(p);
      seen.set(p.category, arr);
    }
    return Array.from(seen.entries());
  }, []);

  return (
    <aside
      className="libre-trade-dock__sidebar"
      aria-label={t("tradeDock.savedRequests")}
    >
      {groups.map(([cat, items]) => (
        <section key={cat} className="libre-trade-dock__group">
          <h4 className="libre-trade-dock__group-title">{t(cat)}</h4>
          <ul className="libre-trade-dock__preset-list">
            {items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={
                    "libre-trade-dock__preset" +
                    (activePresetId === p.id ? " is-active" : "")
                  }
                  onClick={() => onPick(p.id)}
                  title={t(p.description)}
                >
                  <span
                    className={
                      "libre-trade-dock__preset-method " +
                      (p.kind === "rest"
                        ? "libre-trade-dock__preset-method--" +
                          p.method.toLowerCase()
                        : "libre-trade-dock__preset-method--ws")
                    }
                  >
                    {p.kind === "rest" ? p.method : "WS"}
                  </span>
                  <span className="libre-trade-dock__preset-label">
                    {t(p.label)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

// ── REST panel ──────────────────────────────────────────────────

interface RestState {
  loading: boolean;
  status?: number;
  statusText?: string;
  durationMs?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  errorMessage?: string;
  /// Distinguishes mock vs live so the response panel can label
  /// its source — useful when teaching the difference.
  source?: "mock" | "live";
}

function RestPanel({
  preset,
  env,
  liveMode,
}: {
  preset: RestPreset | null;
  env: Record<string, string>;
  liveMode: boolean;
}) {
  const t = useT();
  // Form state seeded from the preset; user edits are local.
  const [method, setMethod] = useState<PresetMethod>(
    preset?.method ?? "GET",
  );
  const [url, setUrl] = useState(preset?.url ?? "");
  const [headers, setHeaders] = useState(
    formatHeaders(preset?.headers ?? {}),
  );
  const [body, setBody] = useState(preset?.body ?? "");
  const [state, setState] = useState<RestState>({ loading: false });

  // Reset form whenever the preset changes (we use `key=` upstream
  // to remount, but be explicit for the case where presets are
  // swapped without a remount).
  useEffect(() => {
    if (!preset) return;
    setMethod(preset.method);
    setUrl(preset.url);
    setHeaders(formatHeaders(preset.headers ?? {}));
    setBody(preset.body ?? "");
    setState({ loading: false });
  }, [preset]);

  const resolvedUrl = useMemo(() => substitute(url, env), [url, env]);
  const resolvedBody = useMemo(
    () => (body ? substitute(body, env) : null),
    [body, env],
  );

  async function send() {
    setState({ loading: true });
    const startedAt = performance.now();
    const parsedHeaders = parseHeaders(headers);
    if (liveMode) {
      // Route through the Rust `proxy_http` command instead of
      // `fetch()`. The webview's origin (`http://localhost:1420`
      // in dev, `tauri://localhost` in prod) is never going to be
      // whitelisted by third-party APIs' `Access-Control-Allow-Origin`,
      // so a direct browser-side fetch dies on CORS. The Rust side
      // makes the request server-style via reqwest — no CORS — and
      // hands the raw response back. See
      // `src-tauri/src/http_proxy.rs` for the command.
      try {
        const r = await invoke<{
          status: number;
          statusText: string;
          headers: Record<string, string>;
          body: string;
        }>("proxy_http", {
          req: {
            method,
            url: resolvedUrl,
            headers: parsedHeaders,
            body:
              method === "GET" || method === "DELETE"
                ? null
                : resolvedBody ?? null,
          },
        });
        setState({
          loading: false,
          status: r.status,
          statusText: r.statusText,
          durationMs: Math.round(performance.now() - startedAt),
          responseHeaders: r.headers,
          responseBody: tryFormatJson(r.body),
          source: "live",
        });
      } catch (e) {
        setState({
          loading: false,
          errorMessage: e instanceof Error ? e.message : String(e),
          source: "live",
        });
      }
      return;
    }
    // Mock mode
    const mock = mockRest(resolvedUrl, method, resolvedBody);
    if (mock) {
      // Simulate latency so the loading state is visible.
      await new Promise((res) => setTimeout(res, mock.latencyMs));
      setState({
        loading: false,
        status: mock.status,
        statusText: mock.statusText,
        durationMs: Math.round(performance.now() - startedAt),
        responseHeaders: mock.headers,
        responseBody: mock.body,
        source: "mock",
      });
    } else {
      await new Promise((res) => setTimeout(res, 60));
      setState({
        loading: false,
        status: 0,
        statusText: t("tradeDock.mockNotAvailable"),
        durationMs: Math.round(performance.now() - startedAt),
        responseBody: JSON.stringify(
          {
            note: t("tradeDock.mockUnknownUrlNote"),
            url: resolvedUrl,
            method,
          },
          null,
          2,
        ),
        source: "mock",
      });
    }
  }

  return (
    <div className="libre-trade-dock__rest">
      <div className="libre-trade-dock__url-row">
        <select
          className="libre-trade-dock__method"
          value={method}
          onChange={(e) => setMethod(e.target.value as PresetMethod)}
        >
          {(["GET", "POST", "PUT", "DELETE", "PATCH"] as PresetMethod[]).map(
            (m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ),
          )}
        </select>
        <input
          className="libre-trade-dock__url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          placeholder={t("tradeDock.urlPlaceholder")}
        />
        <button
          type="button"
          className="libre-trade-dock__send"
          onClick={() => void send()}
          disabled={state.loading || !url.trim()}
        >
          <Icon icon={sendIcon} size="xs" color="currentColor" />
          {state.loading ? t("tradeDock.sending") : t("tradeDock.send")}
        </button>
      </div>

      {resolvedUrl !== url && (
        <div className="libre-trade-dock__resolved">
          → <code>{resolvedUrl}</code>
        </div>
      )}

      <details className="libre-trade-dock__section">
        <summary>{t("tradeDock.headers")}</summary>
        <textarea
          className="libre-trade-dock__textarea"
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          spellCheck={false}
          placeholder={'Content-Type: application/json\nAuthorization: Bearer …'}
          rows={3}
        />
      </details>

      <details
        className="libre-trade-dock__section"
        open={method !== "GET" && method !== "DELETE"}
      >
        <summary>{t("tradeDock.body")}</summary>
        <textarea
          className="libre-trade-dock__textarea libre-trade-dock__textarea--mono"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          placeholder={t("tradeDock.bodyPlaceholder")}
          rows={8}
        />
      </details>

      <div className="libre-trade-dock__response">
        <div className="libre-trade-dock__response-head">
          <span>{t("tradeDock.response")}</span>
          {state.status !== undefined && (
            <span
              className={
                "libre-trade-dock__status libre-trade-dock__status--" +
                statusTone(state.status)
              }
            >
              {state.status} {state.statusText}
            </span>
          )}
          {state.durationMs !== undefined && (
            <span className="libre-trade-dock__duration">
              {state.durationMs} ms
            </span>
          )}
          {state.source && (
            <span
              className={
                "libre-trade-dock__source libre-trade-dock__source--" + state.source
              }
            >
              {state.source}
            </span>
          )}
        </div>
        {state.errorMessage ? (
          <pre className="libre-trade-dock__response-body libre-trade-dock__response-body--error">
            {state.errorMessage}
          </pre>
        ) : state.responseBody ? (
          <pre className="libre-trade-dock__response-body">
            {state.responseBody}
          </pre>
        ) : (
          <div className="libre-trade-dock__response-empty">
            {t("tradeDock.responseEmpty")}
          </div>
        )}
      </div>
    </div>
  );
}

// ── WebSocket panel ─────────────────────────────────────────────

interface WsMessage {
  id: string;
  ts: number;
  direction: "in" | "out";
  payload: string;
}

/// Connection-status words → i18n keys. The map holds keys (not
/// strings) so the component resolves them through `t()`.
const WS_STATUS_KEYS = {
  idle: "tradeDock.wsStatusIdle",
  connecting: "tradeDock.wsStatusConnecting",
  open: "tradeDock.wsStatusOpen",
  closing: "tradeDock.wsStatusClosing",
  closed: "tradeDock.wsStatusClosed",
  error: "tradeDock.wsStatusError",
} as const;

function WsPanel({
  preset,
  env,
  liveMode,
}: {
  preset: WsPreset | null;
  env: Record<string, string>;
  liveMode: boolean;
}) {
  const t = useT();
  const [wsUrl, setWsUrl] = useState(preset?.wsUrl ?? "");
  const [outDraft, setOutDraft] = useState(
    preset?.wsMessages?.[0] ?? "",
  );
  const [status, setStatus] = useState<
    "idle" | "connecting" | "open" | "closing" | "closed" | "error"
  >("idle");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const mockTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!preset) return;
    setWsUrl(preset.wsUrl);
    setOutDraft(preset.wsMessages?.[0] ?? "");
    setMessages([]);
    setStatus("idle");
  }, [preset]);

  // Tear down any open socket on unmount.
  useEffect(() => {
    return () => {
      const sock = socketRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try {
          sock.close();
        } catch {
          /* swallow */
        }
      }
      socketRef.current = null;
      for (const t of mockTimersRef.current) window.clearTimeout(t);
      mockTimersRef.current = [];
    };
  }, []);

  function pushMessage(m: Omit<WsMessage, "id" | "ts">) {
    setMessages((prev) => [
      ...prev,
      { ...m, id: Math.random().toString(36).slice(2), ts: Date.now() },
    ]);
  }

  const resolvedUrl = useMemo(
    () => substitute(wsUrl, env),
    [wsUrl, env],
  );

  function connect() {
    if (status === "connecting" || status === "open") return;
    setMessages([]);
    setStatus("connecting");
    if (liveMode) {
      try {
        const sock = new WebSocket(resolvedUrl);
        socketRef.current = sock;
        sock.onopen = () => setStatus("open");
        sock.onmessage = (ev) => {
          pushMessage({ direction: "in", payload: String(ev.data) });
        };
        sock.onerror = () => setStatus("error");
        sock.onclose = () => {
          setStatus("closed");
          socketRef.current = null;
        };
      } catch (e) {
        setStatus("error");
        pushMessage({
          direction: "in",
          payload: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    // Mock mode: fake an "open", auto-send the preset's messages,
    // schedule the canned response frames.
    setStatus("open");
    const auto: string[] = preset?.wsMessages ?? [];
    for (const m of auto) {
      pushMessage({ direction: "out", payload: m });
    }
    const frames: MockWsFrame[] = mockWs(resolvedUrl, auto);
    for (const f of frames) {
      const t = window.setTimeout(() => {
        pushMessage({ direction: f.direction, payload: f.payload });
      }, f.delayMs);
      mockTimersRef.current.push(t);
    }
  }

  function sendDraft() {
    if (!outDraft.trim()) return;
    if (liveMode) {
      const sock = socketRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      sock.send(outDraft);
      pushMessage({ direction: "out", payload: outDraft });
      return;
    }
    pushMessage({ direction: "out", payload: outDraft });
    const frames = mockWs(resolvedUrl, [outDraft]);
    for (const f of frames) {
      const t = window.setTimeout(() => {
        pushMessage({ direction: f.direction, payload: f.payload });
      }, f.delayMs);
      mockTimersRef.current.push(t);
    }
  }

  function disconnect() {
    const sock = socketRef.current;
    if (sock) {
      try {
        sock.close();
      } catch {
        /* swallow */
      }
    }
    for (const t of mockTimersRef.current) window.clearTimeout(t);
    mockTimersRef.current = [];
    socketRef.current = null;
    setStatus("closed");
  }

  return (
    <div className="libre-trade-dock__ws">
      <div className="libre-trade-dock__url-row">
        <input
          className="libre-trade-dock__url"
          value={wsUrl}
          onChange={(e) => setWsUrl(e.target.value)}
          spellCheck={false}
          placeholder="wss://…"
        />
        {status === "open" || status === "connecting" ? (
          <button
            type="button"
            className="libre-trade-dock__send libre-trade-dock__send--danger"
            onClick={disconnect}
          >
            {t("tradeDock.disconnect")}
          </button>
        ) : (
          <button
            type="button"
            className="libre-trade-dock__send"
            onClick={connect}
            disabled={!wsUrl.trim()}
          >
            <Icon icon={plugZap} size="xs" color="currentColor" />
            {t("tradeDock.connect")}
          </button>
        )}
      </div>

      {resolvedUrl !== wsUrl && (
        <div className="libre-trade-dock__resolved">
          → <code>{resolvedUrl}</code>
        </div>
      )}

      <div className="libre-trade-dock__ws-status-row">
        <span
          className={
            "libre-trade-dock__ws-status libre-trade-dock__ws-status--" + status
          }
        >
          {t(WS_STATUS_KEYS[status])}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            className="libre-trade-dock__icon-btn"
            onClick={() => setMessages([])}
            title={t("tradeDock.clearStream")}
          >
            <Icon icon={trash} size="xs" color="currentColor" />
          </button>
        )}
      </div>

      <div className="libre-trade-dock__ws-stream" aria-live="polite">
        {messages.length === 0 ? (
          <div className="libre-trade-dock__response-empty">
            {status === "open"
              ? t("tradeDock.wsConnectedEmpty")
              : t("tradeDock.wsIdleEmpty")}
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                "libre-trade-dock__ws-msg libre-trade-dock__ws-msg--" + m.direction
              }
            >
              <div className="libre-trade-dock__ws-msg-meta">
                <span className="libre-trade-dock__ws-msg-arrow">
                  {m.direction === "in" ? "←" : "→"}
                </span>
                <span className="libre-trade-dock__ws-msg-time">
                  {fmtTime(m.ts)}
                </span>
              </div>
              <pre className="libre-trade-dock__ws-msg-body">{m.payload}</pre>
            </div>
          ))
        )}
      </div>

      <div className="libre-trade-dock__ws-send">
        <textarea
          className="libre-trade-dock__textarea libre-trade-dock__textarea--mono"
          value={outDraft}
          onChange={(e) => setOutDraft(e.target.value)}
          spellCheck={false}
          placeholder='{"type":"subscribe","channel":"…"}'
          rows={4}
        />
        <button
          type="button"
          className="libre-trade-dock__send"
          onClick={sendDraft}
          disabled={status !== "open" || !outDraft.trim()}
        >
          <Icon icon={playIcon} size="xs" color="currentColor" />
          {t("tradeDock.sendFrame")}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function formatHeaders(h: Record<string, string>): string {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function parseHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function tryFormatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function statusTone(s: number): "ok" | "warn" | "err" | "neutral" {
  if (s === 0) return "neutral";
  if (s >= 200 && s < 300) return "ok";
  if (s >= 300 && s < 400) return "warn";
  return "err";
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

// Re-export the kept-history hooks if a future popup wants them.
// Currently unused; left here to keep the singleton API surface
// in one place.
export { readHistory, writeHistory };
export type { RestHistoryEntry };
