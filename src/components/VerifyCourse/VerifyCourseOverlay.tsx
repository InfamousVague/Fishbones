import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { circleCheck } from "@base/primitives/icon/icons/circle-check";
import { circleX } from "@base/primitives/icon/icons/circle-x";
import { circleSlash } from "@base/primitives/icon/icons/circle-slash";
import { loader } from "@base/primitives/icon/icons/loader";
import { bookOpen } from "@base/primitives/icon/icons/book-open";
import { listChecks } from "@base/primitives/icon/icons/list-checks";
import { code } from "@base/primitives/icon/icons/code";
import { copy } from "@base/primitives/icon/icons/copy";
import { download } from "@base/primitives/icon/icons/download";
import { check } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import type { VerifyTarget, LessonVerifyResult } from "../../lib/verify/course";
import { tally } from "../../lib/verify/course";
import {
  formatFixPrompt,
  formatJson,
  suggestExportFilename,
} from "../../lib/verify/export";
import "./VerifyCourseOverlay.css";

/// Floating non-modal panel that reports progress as `verifyCourse`
/// walks every exercise. Sits bottom-right; doesn't block the
/// workbench so the user can keep reading the lesson the verifier
/// is currently running.
///
/// State is fully owned by the parent (App.tsx). This component is
/// dumb — render the snapshot it gets, surface user actions via
/// callbacks. That keeps a single source of truth for the in-flight
/// session and lets the parent persist / cancel / restart cleanly.

export interface VerifySessionView {
  label: string;
  index: number;
  total: number;
  current: VerifyTarget | null;
  results: LessonVerifyResult[];
  done: boolean;
}

const KIND_ICON = {
  exercise: code,
  reading: bookOpen,
  quiz: listChecks,
  other: circleSlash,
} as const;

interface Props {
  session: VerifySessionView | null;
  onCancel: () => void;
  onClose: () => void;
}

export default function VerifyCourseOverlay({ session, onCancel, onClose }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /// Short-lived "Copied!" / "Saved!" feedback shown next to the
  /// export buttons. Keyed by button id so two buttons don't trip
  /// each other's flash. Cleared after ~1.5s by setTimeout.
  const [flash, setFlash] = useState<{ key: string; label: string } | null>(
    null,
  );

  if (!session) return null;

  const courseId = session.results[0]?.target.courseId;
  const exportOpts = { label: session.label, courseId };

  const showFeedback = (key: string, label: string) => {
    setFlash({ key, label });
    setTimeout(
      () => setFlash((f) => (f && f.key === key ? null : f)),
      1500,
    );
  };

  const copyAsPrompt = async () => {
    const md = formatFixPrompt(session.results, exportOpts);
    try {
      await navigator.clipboard.writeText(md);
      showFeedback("prompt", "Copied!");
    } catch {
      // Some browsers / restrictive contexts (Tauri webviews
      // without clipboard permission) reject writeText. Fall back
      // to a trigger-download so the user still gets the report.
      downloadBlob(md, suggestExportFilename(exportOpts, "md"), "text/markdown");
      showFeedback("prompt", "Saved (clipboard blocked)");
    }
  };

  const copyAsJson = async () => {
    const json = formatJson(session.results, exportOpts);
    try {
      await navigator.clipboard.writeText(json);
      showFeedback("json", "Copied!");
    } catch {
      downloadBlob(
        json,
        suggestExportFilename(exportOpts, "json"),
        "application/json",
      );
      showFeedback("json", "Saved (clipboard blocked)");
    }
  };

  const downloadReport = () => {
    const md = formatFixPrompt(session.results, exportOpts);
    downloadBlob(md, suggestExportFilename(exportOpts, "md"), "text/markdown");
    showFeedback("download", "Saved");
  };

  const t = tally(session.results);
  const pct =
    session.total === 0 ? 0 : Math.round((session.index / session.total) * 100);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="fishbones-verify-overlay"
      role="region"
      aria-label="Course verification"
    >
      <div className="fishbones-verify-header">
        <div className="fishbones-verify-title-block">
          <div className="fishbones-verify-title">{session.label}</div>
          <div className="fishbones-verify-subtitle">
            {session.done
              ? `Done · ${session.total} lesson${session.total === 1 ? "" : "s"}`
              : session.current
                ? `Running: ${session.current.lesson.title}`
                : "Starting…"}
          </div>
        </div>
        <button
          className="fishbones-verify-icon-btn"
          onClick={session.done ? onClose : onCancel}
          aria-label={session.done ? "Close" : "Cancel verification"}
          title={session.done ? "Close" : "Cancel"}
        >
          <Icon icon={xIcon} />
        </button>
      </div>

      <div className="fishbones-verify-progress">
        <div className="fishbones-verify-progress-bar" aria-hidden="true">
          <div
            className="fishbones-verify-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="fishbones-verify-progress-text">
          {session.index} / {session.total}
        </div>
      </div>

      <div className="fishbones-verify-tally">
        <span className="fishbones-verify-pill fishbones-verify-pill--pass">
          <Icon icon={circleCheck} />
          {t.passed}
        </span>
        <span className="fishbones-verify-pill fishbones-verify-pill--fail">
          <Icon icon={circleX} />
          {t.failed}
        </span>
        <span className="fishbones-verify-pill fishbones-verify-pill--skip">
          <Icon icon={circleSlash} />
          {t.skipped}
        </span>
      </div>

      <div className="fishbones-verify-list" role="list">
        {session.results.length === 0 && !session.done && (
          <div className="fishbones-verify-empty">
            <Icon icon={loader} />
            <span>Waiting for the first lesson…</span>
          </div>
        )}
        {session.results.map((r) => {
          const id = `${r.target.courseId}:${r.target.lesson.id}`;
          const isExpanded = expanded.has(id);
          const status: "pass" | "fail" | "skip" = r.skipped
            ? "skip"
            : r.passed
              ? "pass"
              : "fail";
          const kindIcon = KIND_ICON[r.target.kind];
          return (
            <div
              key={id}
              className={`fishbones-verify-row fishbones-verify-row--${status}`}
              role="listitem"
            >
              <button
                className="fishbones-verify-row-summary"
                onClick={() => status === "fail" && toggleExpanded(id)}
                aria-expanded={isExpanded}
                aria-disabled={status !== "fail"}
              >
                <span className="fishbones-verify-row-icon" aria-hidden="true">
                  {status === "pass" && <Icon icon={circleCheck} />}
                  {status === "fail" && <Icon icon={circleX} />}
                  {status === "skip" && <Icon icon={circleSlash} />}
                </span>
                <span
                  className="fishbones-verify-row-kind"
                  aria-label={r.target.kind}
                  title={r.target.kind}
                >
                  <Icon icon={kindIcon} />
                </span>
                <span className="fishbones-verify-row-title">
                  {r.target.lesson.title}
                </span>
                <span className="fishbones-verify-row-meta">
                  {r.skipped
                    ? r.skipReason ?? "skipped"
                    : `${(r.durationMs / 1000).toFixed(2)}s`}
                </span>
              </button>
              {isExpanded && status === "fail" && (
                <div className="fishbones-verify-row-detail">
                  {r.result?.error && (
                    <div className="fishbones-verify-row-error">
                      <strong>Error:</strong> {r.result.error}
                    </div>
                  )}
                  {(r.result?.tests ?? []).filter((t) => !t.passed).map((t, i) => (
                    <div className="fishbones-verify-row-error" key={i}>
                      <strong>{t.name}:</strong> {t.error}
                    </div>
                  ))}
                  {(r.result?.logs ?? [])
                    .filter((l) => l.level === "error")
                    .slice(0, 5)
                    .map((l, i) => (
                      <pre className="fishbones-verify-row-log" key={i}>
                        {l.text}
                      </pre>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {session.done && (
        <div className="fishbones-verify-footer">
          <button
            className="fishbones-verify-btn fishbones-verify-btn--primary"
            onClick={copyAsPrompt}
            title="Copy a Markdown 'fix-me' prompt for Claude / ChatGPT"
          >
            <Icon icon={flash?.key === "prompt" ? check : copy} />
            <span>{flash?.key === "prompt" ? flash.label : "Copy fix prompt"}</span>
          </button>
          <button
            className="fishbones-verify-btn"
            onClick={copyAsJson}
            title="Copy results as JSON"
          >
            <Icon icon={flash?.key === "json" ? check : copy} />
            <span>{flash?.key === "json" ? flash.label : "JSON"}</span>
          </button>
          <button
            className="fishbones-verify-btn"
            onClick={downloadReport}
            title="Download the Markdown report as a file"
          >
            <Icon icon={flash?.key === "download" ? check : download} />
            <span>{flash?.key === "download" ? flash.label : "Save"}</span>
          </button>
          <span className="fishbones-verify-footer-spacer" />
          <button className="fishbones-verify-btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/// Trigger a browser download of `text` as a file named `filename`.
/// Works in both Tauri's webview and the static web build — we
/// don't reach for the Tauri save-dialog plugin because the
/// browser fallback gets the same outcome with one less code path
/// to maintain.
function downloadBlob(text: string, filename: string, mime: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // The anchor doesn't have to live in the DOM to be clicked
  // programmatically in modern browsers, but appending + removing
  // is the bullet-proof path across every WebView we ship to.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
