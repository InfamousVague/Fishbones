/// Lightweight, privacy-friendly product analytics — web AND desktop.
///
/// Two transports, picked at build time by `platform.ts`:
///
///   • WEB (`libre.academy/learn`): inject Plausible's hosted script.
///     It reads `window.location`, auto-fires the initial pageview,
///     tracks outbound-link clicks, and installs `window.plausible(...)`
///     for custom events. Same behaviour this module always had.
///
///   • DESKTOP (the Tauri shell): the hosted script is useless here —
///     the WKWebView origin is `tauri://localhost`, so the script would
///     record garbage URLs and Plausible would reject the domain
///     mismatch. Instead we POST directly to Plausible's `/api/event`
///     endpoint with a SYNTHETIC url under `libre.academy/app/*`, so
///     desktop sessions land on their own clean `/app/…` paths in the
///     dashboard, cleanly separable from the marketing site (`/…`) and
///     the web app (`/learn/…`). Every desktop event also carries
///     `platform` + `app_version` props for granular breakdowns.
///
/// Offline-first: the desktop app is designed to work with no network,
/// so a failed/offline send is BUFFERED in localStorage and flushed on
/// reconnect (and on next launch). Nothing blocks the UI; nothing is
/// lost to a flaky connection. (Plausible timestamps on receipt, so
/// events sent from the queue are counted at flush time, not their
/// original moment — fine for funnels/counts, approximate for
/// time-of-day.)
///
/// Consent: OPT-OUT (see `analyticsSettings.ts`). Everything here
/// short-circuits when the user has opted out, in tests, or in
/// auxiliary windows (tray / dock / popout) which are fragments of a
/// session rather than independent surfaces.

import { isWeb, detectOS } from "./platform";
import { readAnalyticsEnabled, ANALYTICS_CHANGED_EVENT } from "./analyticsSettings";

/// Plausible site id — matches the `data-domain` the dashboard uses.
const ANALYTICS_DOMAIN = "libre.academy";

/// Self-hosted Plausible script (web transport). Lives on the
/// `stats.libre.academy` subdomain (see `infra/plausible/`).
const ANALYTICS_SCRIPT =
  "https://stats.libre.academy/js/script.outbound-links.js";

/// Plausible event endpoint (desktop transport + web fallback).
const ANALYTICS_HOST = "https://stats.libre.academy/api/event";

/// Synthetic origin + path prefix for desktop pageviews/events so the
/// dashboard shows clean `/app/…` routes and never a `tauri://` URL.
const DESKTOP_ORIGIN = "https://libre.academy";
const DESKTOP_PATH_PREFIX = "/app";

/// Offline queue. Versioned key so a future schema change can't collide
/// with stale buffered events. Capped so a permanently-offline machine
/// can't grow localStorage without bound; oldest events drop first.
const QUEUE_KEY = "libre.analytics.queue.v1";
const QUEUE_MAX = 500;
/// Drop buffered events older than this on flush — Plausible records at
/// receipt time anyway, so ancient events add noise without value.
const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Props = Record<string, string | number | boolean>;
interface Payload {
  name: string;
  url: string;
  domain: string;
  props?: Props;
  /// Internal only — used for staleness pruning; stripped before send.
  ts?: number;
}

declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props?: Record<string, string | number | boolean> },
    ) => void;
  }
}

let initialised = false;
/// Resolved lazily on desktop via Tauri's `getVersion()`; "" until then
/// (the first event or two may omit `app_version`, which is fine).
let appVersion = "";
/// The current synthetic desktop path, updated on every `trackPageview`
/// so custom events can attach the `url` of the surface they fired on.
let currentPath = DESKTOP_PATH_PREFIX;
let flushing = false;

/// Is this an auxiliary window (tray / dock / popout / phone preview)?
/// These are fragments of the main session, not independent surfaces,
/// so they must never load the script or fire their own pageviews.
function isAuxSurface(): boolean {
  try {
    const p = new URLSearchParams(window.location.search);
    return (
      p.get("phone") === "1" ||
      p.get("tray") === "1" ||
      p.get("popped") === "1" ||
      p.get("evmDock") === "1" ||
      p.get("btcDock") === "1" ||
      p.get("svmDock") === "1"
    );
  } catch {
    return false;
  }
}

/// Master gate. False in tests, without a DOM, or when the user has
/// opted out. Read on every call so a mid-session opt-out takes effect
/// immediately.
function analyticsActive(): boolean {
  if (import.meta.env.MODE === "test") return false;
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  return readAnalyticsEnabled();
}

/// `platform` prop value — "web" or "desktop-<os>" so the dashboard can
/// split usage by build + OS.
function platformTag(): string {
  return isWeb ? "web" : `desktop-${detectOS()}`;
}

/// Props attached to every event (both transports): what built it, on
/// which OS, at which version, in which locale.
function commonProps(): Props {
  const base: Props = { platform: platformTag() };
  if (appVersion) base.app_version = appVersion;
  try {
    if (navigator.language) base.locale = navigator.language;
  } catch {
    /* ignore */
  }
  return base;
}

// ─── offline queue ───────────────────────────────────────────────────
function readQueue(): Payload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeQueue(q: Payload[]): void {
  try {
    // Keep only the newest QUEUE_MAX so a long offline stretch can't
    // blow the localStorage quota.
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
  } catch {
    /* quota / blocked — drop silently, analytics never breaks the app */
  }
}
function clearQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}
function enqueue(p: Payload): void {
  const q = readQueue();
  q.push({ ...p, ts: Date.now() });
  writeQueue(q);
}

/// POST a payload now, or buffer it if offline / on failure.
function postOrQueue(p: Payload): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueue(p);
    return;
  }
  send(p).then((ok) => {
    if (!ok) enqueue(p);
  });
}

/// Low-level POST. Resolves `true` on a 2xx, `false` otherwise — never
/// rejects, so callers can decide to queue without a try/catch.
function send(p: Payload): Promise<boolean> {
  const body = JSON.stringify({
    name: p.name,
    url: p.url,
    domain: p.domain,
    ...(p.props ? { props: p.props } : {}),
  });
  return fetch(ANALYTICS_HOST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then((r) => r.ok)
    .catch(() => false);
}

/// Flush buffered events. Guarded against re-entrancy and no-ops when
/// offline or opted-out. Failures are re-buffered; stale events are
/// pruned.
function flushQueue(): void {
  if (flushing || !analyticsActive()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const q = readQueue();
  if (!q.length) return;
  flushing = true;
  const now = Date.now();
  const fresh = q.filter((p) => !p.ts || now - p.ts < QUEUE_MAX_AGE_MS);
  // Optimistically clear; any that fail (or events enqueued mid-flush)
  // are merged back below.
  clearQueue();
  const failed: Payload[] = [];
  Promise.allSettled(
    fresh.map((p) => send(p).then((ok) => (ok ? undefined : failed.push(p)))),
  ).finally(() => {
    if (failed.length) writeQueue([...readQueue(), ...failed]);
    flushing = false;
  });
}

/// Opt-out flips clear the buffer; opt-ins resume flushing.
function onSettingChange(): void {
  if (!readAnalyticsEnabled()) clearQueue();
  else flushQueue();
}

// ─── web transport (hosted script) ───────────────────────────────────
function injectScript(): void {
  const script = document.createElement("script");
  script.defer = true;
  script.src = ANALYTICS_SCRIPT;
  script.setAttribute("data-domain", ANALYTICS_DOMAIN);
  document.head.appendChild(script);

  // Queue stub so events fired before the script lands still flush once
  // the real `window.plausible` installs (Plausible's documented pattern).
  if (!window.plausible) {
    interface PlausibleStub {
      (event: string, options?: { props?: Props }): void;
      q?: unknown[];
    }
    const stub: PlausibleStub = (...args) => {
      stub.q = stub.q || [];
      stub.q.push(args);
    };
    window.plausible = stub;
  }
}

// ─── desktop transport (direct POST) ─────────────────────────────────
function resolveAppVersion(): void {
  void import("@tauri-apps/api/app")
    .then((m) => m.getVersion())
    .then((v) => {
      if (v) appVersion = v;
    })
    .catch(() => {
      /* leave "" — events just omit app_version */
    });
}

/// Normalise a caller-supplied view descriptor into a `/app/…` path.
/// Accepts either a bare view name ("library") or an already-prefixed
/// path ("/app/lesson"); always returns a clean, prefixed path.
function normalisePath(descriptor?: string): string {
  if (!descriptor) return DESKTOP_PATH_PREFIX;
  let d = descriptor.trim();
  if (!d.startsWith("/")) d = `/${d}`;
  if (!d.startsWith(DESKTOP_PATH_PREFIX)) d = `${DESKTOP_PATH_PREFIX}${d}`;
  // Collapse accidental double slashes.
  return d.replace(/\/{2,}/g, "/");
}

// ─── public API ──────────────────────────────────────────────────────

/// Initialise analytics once, from `main.tsx` after the page picker.
/// No-op when opted out, in tests, or in auxiliary windows. Picks the
/// web (script) or desktop (direct POST) transport by build target, then
/// wires the offline-flush + settings-change listeners.
export function init(): void {
  if (initialised) return;
  if (!analyticsActive()) {
    // Still listen for an opt-IN later so we can start without a reload.
    try {
      window.addEventListener(ANALYTICS_CHANGED_EVENT, onOptInBoot);
    } catch {
      /* ignore */
    }
    return;
  }
  if (isAuxSurface()) return;
  initialised = true;

  if (isWeb) {
    injectScript();
  } else {
    resolveAppVersion();
  }

  // Reconnect + settings listeners. Flush anything buffered from a
  // previous offline session on boot.
  try {
    window.addEventListener("online", flushQueue);
    window.addEventListener(ANALYTICS_CHANGED_EVENT, onSettingChange);
  } catch {
    /* ignore */
  }
  flushQueue();
}

/// If the user opts IN after boot (analytics were off at launch), run
/// the real init now. One-shot — `init()` re-guards on `initialised`.
function onOptInBoot(): void {
  if (readAnalyticsEnabled()) {
    try {
      window.removeEventListener(ANALYTICS_CHANGED_EVENT, onOptInBoot);
    } catch {
      /* ignore */
    }
    init();
  }
}

/// Track a pageview. On web the hosted script reads `location`; pass
/// nothing. On desktop pass the current view descriptor (e.g. "library",
/// "lesson", "sandbox") — it becomes the `/app/…` path AND the base URL
/// that subsequent custom events attach to.
export function trackPageview(view?: string): void {
  if (!initialised || !analyticsActive()) return;
  try {
    if (isWeb) {
      window.plausible?.("pageview");
      return;
    }
    currentPath = normalisePath(view);
    postOrQueue({
      name: "pageview",
      url: DESKTOP_ORIGIN + currentPath,
      domain: ANALYTICS_DOMAIN,
      props: commonProps(),
    });
  } catch {
    /* analytics never fails the host app */
  }
}

/// Track a custom event. `props` carries the structured payload; keep it
/// small (Plausible caps custom-event props at 30/event). Common props
/// (`platform`, `app_version`, `locale`) are merged in automatically.
export function trackEvent(name: string, props?: Props): void {
  if (!initialised || !analyticsActive()) return;
  try {
    const merged: Props = { ...commonProps(), ...(props ?? {}) };
    if (isWeb) {
      if (window.plausible) {
        window.plausible(name, { props: merged });
        return;
      }
      postOrQueue({
        name,
        url: window.location.href,
        domain: ANALYTICS_DOMAIN,
        props: merged,
      });
      return;
    }
    postOrQueue({
      name,
      url: DESKTOP_ORIGIN + currentPath,
      domain: ANALYTICS_DOMAIN,
      props: merged,
    });
  } catch {
    /* swallow */
  }
}
