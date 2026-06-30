/// Sync debug panel — surfaces the cloud-sync internals so a
/// learner who suspects local + server have drifted can:
///
///   - See the relay URL the app is talking to and the live sync
///     status (idle / syncing / live / error).
///   - Read a side-by-side count: completions / solutions / settings
///     local vs. server, plus the diff (rows local-only, rows
///     server-only).
///   - Inspect the first dozen rows in each "missing" bucket so a
///     drift problem reads as actual lesson titles, not just a
///     number.
///   - Force a full pull from the server (overwrites local with
///     cloud's authoritative timestamps via the earliest-wins
///     merge), or push every local row to the server (useful when
///     the client has data the server has lost).
///
/// Used by both the desktop Settings dialog and the mobile Settings
/// screen — the panel is platform-agnostic and only needs the cloud
/// + realtime hook handles passed in. Renders inside whatever
/// container the host gives it.

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { refreshCw } from "@base/primitives/icon/icons/refresh-cw";
import { cloudUpload } from "@base/primitives/icon/icons/cloud-upload";
import { cloudDownload } from "@base/primitives/icon/icons/cloud-download";
import "@base/primitives/icon/icon.css";
import type {
  ProgressRow,
  UseLibreCloud,
} from "@/hooks/useLibreCloud";
import type { Completion } from "@/hooks/useProgress";
import type { RealtimeSyncHandle } from "@/hooks/useRealtimeSync";
import { isoToUnixSeconds, unixSecondsToIso } from "@/lib/timestamps";
import { isLibraryMarkerRow } from "@/lib/librarySync";
import "./SyncDebugPanel.css";

interface Props {
  cloud: UseLibreCloud;
  realtime: RealtimeSyncHandle;
  /// Local completion history. Source of truth for the "local"
  /// column of the diff. The host hook (App or MobileApp) already
  /// owns this state; we just read.
  history: readonly Completion[];
  /// Callback to format a (courseId, lessonId) into a human-readable
  /// "Course Title · Lesson Title" string. Optional — when missing,
  /// the diff list shows raw IDs. Wired by the host since SyncDebugPanel
  /// doesn't import course state directly.
  describeLesson?: (courseId: string, lessonId: string) => string;
  /// When true, this panel is being composed inside another pane's
  /// SettingsPage wrapper (the combined Data & storage pane). The
  /// panel only renders its content body; its own outermost
  /// section / title strip is suppressed so the parent owns the
  /// page-level title. The data flow + table chrome stays
  /// identical either way — the flag only gates the outer header.
  embedded?: boolean;
}

interface ServerSnapshot {
  progress: ProgressRow[];
  fetchedAt: number;
  /// Per-endpoint availability. Some relay deployments only ship the
  /// `/progress` route — `solutions` and `settings` 404 on
  /// older / staging relays. We track these separately so the panel
  /// can display "Progress: live · Settings: unavailable" rather
  /// than flagging the whole sync as broken.
  solutionsStatus: "ok" | "unavailable" | "error";
  settingsStatus: "ok" | "unavailable" | "error";
  solutionsError?: string;
  settingsError?: string;
}

export default function SyncDebugPanel({
  cloud,
  realtime,
  history,
  describeLesson,
  embedded,
}: Props) {
  // `embedded` is a layout-only signal; we just stash it for the
  // render output below so the JSX can branch its wrapper element.
  // No behavioural changes — the panel's data fetching, diff
  // computation, and pull/push handlers are identical between
  // standalone and embedded modes.
  void embedded;
  const [server, setServer] = useState<ServerSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  /// One-shot snapshot fetch — reads each endpoint independently
  /// (allSettled) so a 404 on solutions or settings doesn't black-
  /// hole the progress count. The status of the auxiliary endpoints
  /// is surfaced separately, so the user sees "Progress works,
  /// Settings unavailable" instead of one big red error.
  const refreshSnapshot = useCallback(async () => {
    if (!cloud.signedIn) return;
    setLoadingSnapshot(true);
    setSnapshotError(null);
    const [progressR, solutionsR, settingsR] = await Promise.allSettled([
      cloud.pullProgress(),
      cloud.pullSolutions(),
      cloud.pullSettings(),
    ]);
    const classify = (
      r: PromiseSettledResult<unknown>,
    ): { status: "ok" | "unavailable" | "error"; error?: string } => {
      if (r.status === "fulfilled") return { status: "ok" };
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      // Treat 404 as "endpoint unavailable" — it's a relay
      // deployment fact, not a sync failure. Other errors stay red.
      if (/\(404\)/.test(msg) || /404/.test(msg)) {
        return { status: "unavailable", error: msg };
      }
      return { status: "error", error: msg };
    };
    if (progressR.status === "fulfilled") {
      const sols = classify(solutionsR);
      const sets = classify(settingsR);
      setServer({
        progress: progressR.value,
        fetchedAt: Date.now(),
        solutionsStatus: sols.status,
        settingsStatus: sets.status,
        solutionsError: sols.error,
        settingsError: sets.error,
      });
    } else {
      // Even progress failed — that's a real problem.
      const msg =
        progressR.reason instanceof Error
          ? progressR.reason.message
          : String(progressR.reason);
      setSnapshotError(msg);
    }
    setLoadingSnapshot(false);
  }, [cloud]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  // Auto-clear action messages after a few seconds so they don't
  // linger past their relevance.
  useEffect(() => {
    if (!actionMsg) return;
    const t = window.setTimeout(() => setActionMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [actionMsg]);

  const onPull = async () => {
    setPulling(true);
    setActionMsg(null);
    try {
      await realtime.resync();
      setActionMsg("Pulled. Local should now match server.");
      await refreshSnapshot();
    } catch (e) {
      setActionMsg(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPulling(false);
    }
  };

  const onPushAll = async () => {
    if (history.length === 0) {
      setActionMsg("Nothing local to push.");
      return;
    }
    setPushing(true);
    setActionMsg(null);
    try {
      const rows: ProgressRow[] = history.map((h) => ({
        course_id: h.course_id,
        lesson_id: h.lesson_id,
        completed_at: unixSecondsToIso(h.completed_at),
      }));
      await cloud.pushProgress(rows);
      setActionMsg(
        `Pushed ${rows.length} completion${rows.length === 1 ? "" : "s"} to the server.`,
      );
      await refreshSnapshot();
    } catch (e) {
      setActionMsg(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPushing(false);
    }
  };

  // Split server rows into (a) real completions and (b) library
  // markers. Markers ride the `/progress` endpoint as
  // sentinel rows — they encode "desktop has this course
  // installed" so mobile can converge its visible library list
  // without a working `/settings` endpoint. They're not
  // real completions, so they MUST be excluded from the diff /
  // count math (otherwise the in-sync banner says "3293 completions
  // match" when ~11 of those are actually library markers, and
  // localOnly would always show those 11 because desktop's local
  // `history` doesn't include markers).
  const serverReal = (server?.progress ?? []).filter(
    (r) => !isLibraryMarkerRow(r),
  );
  const serverLibraryMarkers = (server?.progress ?? []).filter((r) =>
    isLibraryMarkerRow(r),
  );

  // Diff calc — KEYS present on one side but not the other.
  // Timestamp drift used to be a third bucket here, but several
  // relay deployments rewrite `completed_at` to server-side `now()`
  // on push (regardless of the supplied timestamp), so a freshly-
  // pushed batch instantly looks "drifted" even though the
  // completions themselves are perfectly synced. That made the
  // panel scream "drift!" forever even after the user pushed
  // exactly what was already there. We now compute drift purely
  // for an informational footer; the in-sync gate only checks
  // key membership, which is what the user actually cares about
  // ("does the relay know about every lesson I've completed?").
  const localKeys = new Set(
    history.map((h) => `${h.course_id}:${h.lesson_id}`),
  );
  const serverKeys = new Set(
    serverReal.map((r) => `${r.course_id}:${r.lesson_id}`),
  );
  const localOnly = history.filter(
    (h) => !serverKeys.has(`${h.course_id}:${h.lesson_id}`),
  );
  const serverOnly = serverReal.filter(
    (r) => !localKeys.has(`${r.course_id}:${r.lesson_id}`),
  );
  // Big-drift rows (>30 days difference) — surfaced as an
  // informational footer so the user has a heads-up if the relay
  // really IS rewriting timestamps to massively wrong values, but
  // doesn't gate the in-sync flag.
  const bigDrift = history
    .map((h) => {
      const key = `${h.course_id}:${h.lesson_id}`;
      const srv = serverReal.find(
        (r) => `${r.course_id}:${r.lesson_id}` === key,
      );
      if (!srv) return null;
      const srvSec = isoToUnixSeconds(srv.completed_at);
      if (srvSec === null) return null;
      const diffSec = Math.abs(h.completed_at - srvSec);
      if (diffSec < 60 * 60 * 24 * 30) return null;
      return { key, course_id: h.course_id, lesson_id: h.lesson_id, localSec: h.completed_at, serverSec: srvSec, diffSec };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const inSync =
    !loadingSnapshot &&
    !snapshotError &&
    server !== null &&
    localOnly.length === 0 &&
    serverOnly.length === 0;

  const totalPending =
    realtime.pendingPushCount.progress +
    realtime.pendingPushCount.solutions +
    realtime.pendingPushCount.settings;

  return (
    <section
      className={
        "libre-sync-debug" +
        (embedded ? " libre-sync-debug--embedded" : "")
      }
    >
      {/* Skip the panel's own title strip when nested under
          another pane's SettingsPage — the parent header already
          covers "this is the sync surface". Standalone mode keeps
          the h3 so the panel reads as self-contained if it ever
          gets rendered outside the combined Data & storage pane. */}
      {!embedded && (
        <div className="libre-sync-debug__head">
          <h3 className="libre-settings-section">Sync</h3>
          <p className="libre-settings-blurb">
            Live status of the cross-device sync bus. Use the actions
            below if your devices look out of sync.
          </p>
        </div>
      )}

      {!cloud.signedIn ? (
        <div className="libre-sync-debug__signed-out">
          Sign in above to see sync status.
        </div>
      ) : (
        <>
          <div className="libre-sync-debug__status">
            <div className="libre-sync-debug__status-row">
              <span className="libre-sync-debug__label">Connection</span>
              <StatusBadge status={realtime.status} error={realtime.error} />
            </div>
            <div className="libre-sync-debug__status-row">
              <span className="libre-sync-debug__label">Relay</span>
              <code className="libre-sync-debug__url">{cloud.relayUrl}</code>
            </div>
            <div className="libre-sync-debug__status-row">
              <span className="libre-sync-debug__label">Pending push</span>
              <span className="libre-sync-debug__value">
                {totalPending === 0 ? (
                  "—"
                ) : (
                  <>
                    {realtime.pendingPushCount.progress} progress ·{" "}
                    {realtime.pendingPushCount.solutions} solutions ·{" "}
                    {realtime.pendingPushCount.settings} settings
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="libre-sync-debug__counts">
            <CountTile
              label="On this device"
              count={history.length}
              tone="local"
            />
            <CountTile
              label="On the server"
              count={server === null ? null : serverReal.length}
              tone="server"
              loading={loadingSnapshot}
              error={snapshotError}
            />
            <CountTile
              label="Diff"
              count={
                server === null ? null : localOnly.length + serverOnly.length
              }
              tone={inSync ? "ok" : "drift"}
              loading={loadingSnapshot}
            />
          </div>

          {server !== null && (
            <FeatureStatusRow
              server={server}
              libraryCount={serverLibraryMarkers.length}
            />
          )}

          {inSync && server !== null && (
            <div className="libre-sync-debug__inline-ok">
              In sync. {history.length} completion
              {history.length === 1 ? "" : "s"}
              {serverLibraryMarkers.length > 0 ? (
                <>
                  {" "}and {serverLibraryMarkers.length} library book
                  {serverLibraryMarkers.length === 1 ? "" : "s"}
                </>
              ) : null}{" "}
              match the server.
            </div>
          )}

          {server !== null && !inSync && (
            <div className="libre-sync-debug__diff">
              {localOnly.length > 0 && (
                <DiffSection
                  title={`On device but not on server (${localOnly.length})`}
                  rows={localOnly.slice(0, 10).map((h) => ({
                    key: `${h.course_id}:${h.lesson_id}`,
                    label:
                      describeLesson?.(h.course_id, h.lesson_id) ??
                      `${h.course_id} · ${h.lesson_id}`,
                    sub: `Local time ${shortDate(h.completed_at)}`,
                  }))}
                  more={Math.max(0, localOnly.length - 10)}
                  cta="Push all to server"
                  ctaTone="primary"
                  onCta={onPushAll}
                  ctaLoading={pushing}
                />
              )}
              {serverOnly.length > 0 && (
                <DiffSection
                  title={`On server but not on device (${serverOnly.length})`}
                  rows={serverOnly.slice(0, 10).map((r) => ({
                    key: `${r.course_id}:${r.lesson_id}`,
                    label:
                      describeLesson?.(r.course_id, r.lesson_id) ??
                      `${r.course_id} · ${r.lesson_id}`,
                    sub: `Server time ${r.completed_at.replace("T", " ").replace(/\..+$/, "")}`,
                  }))}
                  more={Math.max(0, serverOnly.length - 10)}
                  cta="Pull from server"
                  ctaTone="primary"
                  onCta={onPull}
                  ctaLoading={pulling}
                />
              )}
            </div>
          )}

          {bigDrift.length > 0 && (
            <div className="libre-sync-debug__drift-note">
              <strong>{bigDrift.length}</strong> row
              {bigDrift.length === 1 ? "" : "s"} have completion times
              that differ between device and server by more than 30 days.
              Most likely the relay rewrote the timestamp on push;
              completions themselves still match. Pulling from server
              will adopt the relay's time as the source of truth.
            </div>
          )}

          <div className="libre-sync-debug__actions">
            <button
              type="button"
              className="libre-sync-debug__action"
              onClick={onPull}
              disabled={pulling}
            >
              <Icon icon={cloudDownload} size="xs" color="currentColor" />
              {pulling ? "Pulling…" : "Pull from server"}
            </button>
            <button
              type="button"
              className="libre-sync-debug__action"
              onClick={onPushAll}
              disabled={pushing || history.length === 0}
            >
              <Icon icon={cloudUpload} size="xs" color="currentColor" />
              {pushing ? "Pushing…" : "Push all to server"}
            </button>
            <button
              type="button"
              className="libre-sync-debug__action"
              onClick={refreshSnapshot}
              disabled={loadingSnapshot}
            >
              <Icon icon={refreshCw} size="xs" color="currentColor" />
              {loadingSnapshot ? "Checking…" : "Refresh diff"}
            </button>
          </div>

          {actionMsg && <div className="libre-sync-debug__msg">{actionMsg}</div>}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/// User-facing sync status pills. The relay's three routes
/// (`progress`, `solutions`, `settings`) don't map 1:1 to what
/// learners think about — they think "is my progress synced?",
/// "is my library synced?", "are my saved solutions synced?".
/// We translate route availability into those concepts:
///
///   - **Progress** — driven by `/progress`. Always
///     required; if it's down everything else is too.
///   - **Library** — driven by `/progress` (we encode
///     marker rows there to work around 404s on `/settings`). So
///     "Library: live" reflects "the relay holds N marker rows".
///     "Library: empty" means desktop hasn't published its
///     installed list yet (or has zero books).
///   - **Solutions** — driven by `/solutions`, which
///     several deployments don't have. When unavailable we show
///     a quiet "server doesn't support yet" pill rather than a
///     scary error, because nothing the user does is blocked by
///     it (workbench files persist locally; cross-device echo
///     just doesn't happen).
///
/// We deliberately drop the "Settings" pill — it was pure
/// infrastructure (legacy library-allowlist channel) and the
/// marker pipeline above replaces it. Surfacing a separate
/// "Settings" indicator just confused the user without telling
/// them anything actionable.
function FeatureStatusRow({
  server,
  libraryCount,
}: {
  server: ServerSnapshot;
  libraryCount: number;
}) {
  // Library is "live" if any markers came down. Zero markers but a
  // working progress endpoint reads as "no library published yet"
  // — desktop hasn't pushed any (e.g. the user only ever signs in
  // on mobile, or first launch on desktop hasn't completed).
  const libraryStatus: "ok" | "empty" =
    libraryCount > 0 ? "ok" : "empty";

  return (
    <div className="libre-sync-debug__endpoints">
      <FeaturePill name="Progress" status="ok" detail="live" />
      <FeaturePill
        name="Library"
        status={libraryStatus}
        detail={
          libraryStatus === "ok"
            ? `${libraryCount} book${libraryCount === 1 ? "" : "s"}`
            : "no devices have published yet"
        }
      />
      <FeaturePill
        name="Solutions"
        status={server.solutionsStatus === "ok" ? "ok" : "muted"}
        detail={
          server.solutionsStatus === "ok"
            ? "live"
            : "server-side feature not deployed"
        }
        title={server.solutionsError}
      />
    </div>
  );
}

/// Three visual states:
///   - ok     → green-tinted pill, live
///   - empty  → neutral pill, "no data yet"
///   - muted  → gray pill, "feature unavailable but not failing"
function FeaturePill({
  name,
  status,
  detail,
  title,
}: {
  name: string;
  status: "ok" | "empty" | "muted";
  detail: string;
  title?: string;
}) {
  return (
    <span
      className={`libre-sync-debug__endpoint libre-sync-debug__endpoint--${status}`}
      title={title}
    >
      <span className="libre-sync-debug__endpoint-name">{name}</span>
      <span className="libre-sync-debug__endpoint-state">{detail}</span>
    </span>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: RealtimeSyncHandle["status"];
  error: string | null;
}) {
  const label =
    status === "live"
      ? "Live"
      : status === "syncing"
        ? "Syncing…"
        : status === "error"
          ? "Error"
          : "Idle";
  return (
    <span
      className={`libre-sync-debug__badge libre-sync-debug__badge--${status}`}
      title={error ?? undefined}
    >
      <span className="libre-sync-debug__dot" aria-hidden />
      {label}
      {status === "error" && error && (
        <span className="libre-sync-debug__badge-err">— {error}</span>
      )}
    </span>
  );
}

function CountTile({
  label,
  count,
  tone,
  loading,
  error,
}: {
  label: string;
  count: number | null;
  tone: "local" | "server" | "ok" | "drift";
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div className={`libre-sync-debug__tile libre-sync-debug__tile--${tone}`}>
      <span className="libre-sync-debug__tile-value">
        {error ? "—" : loading && count === null ? "…" : count ?? "—"}
      </span>
      <span className="libre-sync-debug__tile-label">{label}</span>
      {error && <span className="libre-sync-debug__tile-err">{error}</span>}
    </div>
  );
}

function DiffSection({
  title,
  rows,
  more,
  cta,
  ctaTone,
  onCta,
  ctaLoading,
}: {
  title: string;
  rows: Array<{ key: string; label: string; sub: string }>;
  more: number;
  cta?: string;
  ctaTone?: "primary" | "neutral";
  onCta?: () => void;
  ctaLoading?: boolean;
}) {
  return (
    <div className="libre-sync-debug__diff-section">
      <div className="libre-sync-debug__diff-head">
        <span className="libre-sync-debug__diff-title">{title}</span>
        {cta && onCta && (
          <button
            type="button"
            className={
              "libre-sync-debug__diff-cta" +
              (ctaTone === "primary" ? " is-primary" : "")
            }
            onClick={onCta}
            disabled={ctaLoading}
          >
            {ctaLoading ? "…" : cta}
          </button>
        )}
      </div>
      <ul className="libre-sync-debug__diff-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="libre-sync-debug__diff-label">{r.label}</span>
            <span className="libre-sync-debug__diff-sub">{r.sub}</span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <span className="libre-sync-debug__diff-more">… and {more} more</span>
      )}
    </div>
  );
}

function shortDate(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return "—";
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
