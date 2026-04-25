import { useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import type { IngestRunState } from "../../hooks/useIngestRun";
import StatsBar from "../ImportDialog/StatsBar";
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
  useEffect(() => {
    if (run.status !== "running") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run.status]);

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
        className={`fishbones-floating-pill fishbones-floating-pill--${run.status}`}
        onClick={() => setCollapsed(false)}
        title="Expand ingest progress"
      >
        <span className="fishbones-floating-pill-dot" aria-hidden />
        <span className="fishbones-floating-pill-text">
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
    <div className={`fishbones-floating-panel fishbones-floating-panel--${run.status}`}>
      <div className="fishbones-floating-header">
        <div className="fishbones-floating-titleblock">
          <span className={`fishbones-floating-status-dot fishbones-floating-status-dot--${run.status}`} aria-hidden />
          <span className="fishbones-floating-title">{run.title || "Ingest"}</span>
          <span className="fishbones-floating-substatus">
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
          <div className="fishbones-floating-queue" title="Bulk queue progress">
            <span className="fishbones-floating-queue-label">Queue</span>
            <span className="fishbones-floating-queue-counter">
              {Math.min(run.queue.currentIndex + 1, run.queue.total)} / {run.queue.total}
            </span>
            {(run.queue.succeeded > 0 || run.queue.failed > 0) && (
              <span className="fishbones-floating-queue-stats">
                {run.queue.succeeded > 0 && (
                  <span className="fishbones-floating-queue-ok">
                    {run.queue.succeeded}
                    <Icon icon={checkIcon} size="xs" color="currentColor" />
                  </span>
                )}
                {run.queue.failed > 0 && (
                  <span className="fishbones-floating-queue-fail">
                    {run.queue.failed}
                    <Icon icon={xIcon} size="xs" color="currentColor" />
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        <div className="fishbones-floating-header-actions">
          <button
            className="fishbones-floating-iconbtn"
            onClick={() => setCollapsed(true)}
            title="Minimize"
            aria-label="Minimize"
          >
            –
          </button>
          {isTerminal && (
            <button
              className="fishbones-floating-iconbtn"
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

      <div className="fishbones-floating-stage">
        {run.status === "running" && (
          <div className="fishbones-floating-spinner" aria-hidden />
        )}
        <div className="fishbones-floating-stagebody">
          <div className="fishbones-floating-stagetext">{run.stage || "Preparing…"}</div>
          {run.detail && (
            <div className="fishbones-floating-stagedetail">{run.detail}</div>
          )}
          {waitingSeconds >= 3 && run.status === "running" && (
            <div className="fishbones-floating-waiting">
              still working · {waitingSeconds}s since last event
            </div>
          )}
        </div>
      </div>

      {run.status === "error" && run.error && (
        <div className="fishbones-floating-error">
          <div className="fishbones-floating-error-title">Ingest stopped with an error</div>
          <pre className="fishbones-floating-error-body">{run.error}</pre>
          <p className="fishbones-floating-error-hint">
            Per-lesson saves committed your progress up to the crash point. The
            partial course is already in your Library.
          </p>
        </div>
      )}

      <div className="fishbones-floating-controls">
        <label className="fishbones-floating-verbose">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => setVerbose(e.target.checked)}
          />
          <span>Verbose log</span>
        </label>
        <div className="fishbones-floating-actions">
          {run.status === "running" && (
            <button className="fishbones-floating-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          {run.status === "success" && (
            <button
              className="fishbones-floating-btn fishbones-floating-btn--primary"
              onClick={() => onOpen(run.bookId)}
            >
              Open course
            </button>
          )}
          {(run.status === "error" || run.status === "aborted") && (
            <button
              className="fishbones-floating-btn"
              onClick={() => onOpen(run.bookId)}
              title="Open whatever was saved before the pipeline stopped"
            >
              Open partial course
            </button>
          )}
        </div>
      </div>

      {verbose && (
        <div className="fishbones-floating-log">
          {run.events.length === 0 ? (
            <div className="fishbones-floating-log-empty">waiting for events…</div>
          ) : (
            run.events.map((e, i) => (
              <div
                key={i}
                className={`fishbones-floating-log-line fishbones-floating-log-line--${e.level}`}
              >
                <span className="fishbones-floating-log-stage">{e.stage}</span>
                {e.chapter !== undefined && (
                  <span className="fishbones-floating-log-loc">ch{e.chapter}</span>
                )}
                {e.lesson && (
                  <span className="fishbones-floating-log-loc">{e.lesson}</span>
                )}
                <span className="fishbones-floating-log-msg">{e.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
