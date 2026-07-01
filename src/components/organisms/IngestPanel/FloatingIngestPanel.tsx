import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import type { IngestRunState } from "@/hooks/useIngestRun";
import { useInterval } from "@/hooks/useInterval";
import StatsBar from "@/components/organisms/dialogs/ImportDialog/StatsBar";
import "./FloatingIngestPanel.css";

interface Props {
  run: IngestRunState;
  /// Returns true if the run is still running and cancel was fired.
  onCancel: () => void;
  /// Dismiss the panel (only valid from terminal states).
  onDismiss: () => void;
  /// When the run ends successfully, clicking "Open" jumps to the course.
  onOpen: (bookId: string) => void;
}

/// Bottom-right floating progress panel. Replaces the old blocking
/// "running" step inside ImportDialog — the pipeline is detached and keeps
/// going even if the ImportDialog is dismissed, because each lesson saves
/// to disk as it completes (see pipeline.ts). The panel can be collapsed
/// to a compact pill so the learner can keep using the app while waiting
/// for a long ingest to finish.
export default function FloatingIngestPanel({
  run,
  onCancel,
  onDismiss,
  onOpen,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [verbose, setVerbose] = useState(false);
  // Tick every second so elapsed time + "waiting" counter stay fresh.
  const [, tick] = useState(0);
  useInterval(() => tick((n) => n + 1), run.status === "running" ? 1000 : null);

  const lastEventAt =
    run.events.length > 0 ? run.events[run.events.length - 1].timestamp : null;
  const waitingSeconds =
    run.status === "running" && lastEventAt
      ? Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000))
      : 0;

  const isTerminal =
    run.status === "success" ||
    run.status === "error" ||
    run.status === "aborted";

  // Collapsed pill — tiny chip at the bottom-right. Clicks expand the
  // full panel. Shows just status + "N/M lessons" as a glanceable summary.
  if (collapsed) {
    return (
      <button
        className={`libre-floating-pill libre-floating-pill--${run.status}`}
        onClick={() => setCollapsed(false)}
        title="Expand ingest progress"
      >
        <span className="libre-floating-pill-dot" aria-hidden />
        <span className="libre-floating-pill-text">
          {run.queue && run.queue.total > 1 ? (
            <>
              Queue {Math.min(run.queue.currentIndex + 1, run.queue.total)}/
              {run.queue.total}
              {run.stats && run.status === "running" && (
                <>
                  {" · "}
                  {run.stats.lessonsDone}/{run.stats.lessonsTotal || "?"}
                </>
              )}
            </>
          ) : (
            <>
              {run.title.length > 20 ? run.title.slice(0, 20) + "…" : run.title}
              {run.stats && run.status === "running" && (
                <>
                  {" · "}
                  {run.stats.lessonsDone}/{run.stats.lessonsTotal || "?"}
                </>
              )}
            </>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className={`libre-floating-panel libre-floating-panel--${run.status}`}>
      <div className="libre-floating-header">
        <div className="libre-floating-titleblock">
          <span className={`libre-floating-status-dot libre-floating-status-dot--${run.status}`} aria-hidden />
          <span className="libre-floating-title">{run.title || "Ingest"}</span>
          <span className="libre-floating-substatus">
            {run.status === "running" && "running"}
            {run.status === "success" && (
              <>
                <Icon icon={checkIcon} size="xs" color="currentColor" />
                <span>complete</span>
              </>
            )}
            {run.status === "error" && (
              <>
                <Icon icon={xIcon} size="xs" color="currentColor" />
                <span>failed</span>
              </>
            )}
            {run.status === "aborted" && "cancelled"}
          </span>
        </div>
        {run.queue && run.queue.total > 1 && (
          <div className="libre-floating-queue" title="Bulk queue progress">
            <span className="libre-floating-queue-label">Queue</span>
            <span className="libre-floating-queue-counter">
              {Math.min(run.queue.currentIndex + 1, run.queue.total)} / {run.queue.total}
            </span>
            {(run.queue.succeeded > 0 || run.queue.failed > 0) && (
              <span className="libre-floating-queue-stats">
                {run.queue.succeeded > 0 && (
                  <span className="libre-floating-queue-ok">
                    {run.queue.succeeded}
                    <Icon icon={checkIcon} size="xs" color="currentColor" />
                  </span>
                )}
                {run.queue.failed > 0 && (
                  <span className="libre-floating-queue-fail">
                    {run.queue.failed}
                    <Icon icon={xIcon} size="xs" color="currentColor" />
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        <div className="libre-floating-header-actions">
          <button
            className="libre-floating-iconbtn"
            onClick={() => setCollapsed(true)}
            title="Minimize"
            aria-label="Minimize"
          >
            –
          </button>
          {isTerminal && (
            <button
              className="libre-floating-iconbtn"
              onClick={onDismiss}
              title="Dismiss"
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <StatsBar stats={run.stats} />

      <div className="libre-floating-stage">
        {run.status === "running" && (
          <div className="libre-floating-spinner" aria-hidden />
        )}
        <div className="libre-floating-stagebody">
          <div className="libre-floating-stagetext">{run.stage || "Preparing…"}</div>
          {run.detail && (
            <div className="libre-floating-stagedetail">{run.detail}</div>
          )}
          {waitingSeconds >= 3 && run.status === "running" && (
            <div className="libre-floating-waiting">
              still working · {waitingSeconds}s since last event
            </div>
          )}
        </div>
      </div>

      {run.status === "error" && run.error && (
        <div className="libre-floating-error">
          <div className="libre-floating-error-title">Ingest stopped with an error</div>
          <pre className="libre-floating-error-body">{run.error}</pre>
          <p className="libre-floating-error-hint">
            Per-lesson saves committed your progress up to the crash point. The
            partial course is already in your Library.
          </p>
        </div>
      )}

      <div className="libre-floating-controls">
        <label className="libre-floating-verbose">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => setVerbose(e.target.checked)}
          />
          <span>Verbose log</span>
        </label>
        <div className="libre-floating-actions">
          {run.status === "running" && (
            <button className="libre-floating-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          {run.status === "success" && (
            <button
              className="libre-floating-btn libre-floating-btn--primary"
              onClick={() => onOpen(run.bookId)}
            >
              Open course
            </button>
          )}
          {(run.status === "error" || run.status === "aborted") && (
            <button
              className="libre-floating-btn"
              onClick={() => onOpen(run.bookId)}
              title="Open whatever was saved before the pipeline stopped"
            >
              Open partial course
            </button>
          )}
        </div>
      </div>

      {verbose && (
        <div className="libre-floating-log">
          {run.events.length === 0 ? (
            <div className="libre-floating-log-empty">waiting for events…</div>
          ) : (
            run.events.map((e, i) => (
              <div
                key={i}
                className={`libre-floating-log-line libre-floating-log-line--${e.level}`}
              >
                <span className="libre-floating-log-stage">{e.stage}</span>
                {e.chapter !== undefined && (
                  <span className="libre-floating-log-loc">ch{e.chapter}</span>
                )}
                {e.lesson && (
                  <span className="libre-floating-log-loc">{e.lesson}</span>
                )}
                <span className="libre-floating-log-msg">{e.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
