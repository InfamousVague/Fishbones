import { useState } from "react";
import { useTimeout } from "@/hooks/useTimeout";
import { useT } from "@/i18n/i18n";
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
import type { VerifyTarget, LessonVerifyResult } from "@/lib/verify/course";
import { tally } from "@/lib/verify/course";
import {
  formatFixPrompt,
  formatJson,
  suggestExportFilename,
} from "@/lib/verify/export";
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
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /// Short-lived "Copied!" / "Saved!" feedback shown next to the
  /// export buttons. Keyed by button id so two buttons don't trip
  /// each other's flash. Cleared after ~1.5s (see the useTimeout below).
  const [flash, setFlash] = useState<{ key: string; label: string } | null>(
    null,
  );

  // Clear the export-button flash ~1.5s after it appears. Keyed on the
  // current flash so each new flash restarts the timer, and the prior
  // timer is torn down before it can clear a newer flash.
  //
  // MUST stay above the `!session` early return: hooks have to run in
  // the same order on every render, and this component mounts with
  // session === null before a verify run starts — a hook below the
  // early return appears "new" on the first non-null render and React
  // throws "Rendered more hooks than during the previous render"
  // (crashed the app when Verify this course was clicked).
  useTimeout(() => setFlash(null), flash ? 1500 : null);

  if (!session) return null;

  const courseId = session.results[0]?.target.courseId;
  const exportOpts = { label: session.label, courseId };

  const showFeedback = (key: string, label: string) => {
    setFlash({ key, label });
  };

  const copyAsPrompt = async () => {
    const md = formatFixPrompt(session.results, exportOpts);
    try {
      await navigator.clipboard.writeText(md);
      showFeedback("prompt", t("library.verify.copied"));
    } catch {
      // Some browsers / restrictive contexts (Tauri webviews
      // without clipboard permission) reject writeText. Fall back
      // to a trigger-download so the user still gets the report.
      downloadBlob(md, suggestExportFilename(exportOpts, "md"), "text/markdown");
      showFeedback("prompt", t("library.verify.savedClipboardBlocked"));
    }
  };

  const copyAsJson = async () => {
    const json = formatJson(session.results, exportOpts);
    try {
      await navigator.clipboard.writeText(json);
      showFeedback("json", t("library.verify.copied"));
    } catch {
      downloadBlob(
        json,
        suggestExportFilename(exportOpts, "json"),
        "application/json",
      );
      showFeedback("json", t("library.verify.savedClipboardBlocked"));
    }
  };

  const downloadReport = () => {
    const md = formatFixPrompt(session.results, exportOpts);
    downloadBlob(md, suggestExportFilename(exportOpts, "md"), "text/markdown");
    showFeedback("download", t("library.verify.saved"));
  };

  const counts = tally(session.results);
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
      className="libre-verify-overlay"
      role="region"
      aria-label={t("library.verify.regionAria")}
    >
      <div className="libre-verify-header">
        <div className="libre-verify-title-block">
          <div className="libre-verify-title">{session.label}</div>
          <div className="libre-verify-subtitle">
            {session.done
              ? t(
                  session.total === 1
                    ? "library.verify.done"
                    : "library.verify.donePlural",
                  { count: session.total },
                )
              : session.current
                ? t("library.verify.running", {
                    lessonTitle: session.current.lesson.title,
                  })
                : t("library.verify.starting")}
          </div>
        </div>
        <button
          className="libre-verify-icon-btn"
          onClick={session.done ? onClose : onCancel}
          aria-label={
            session.done
              ? t("common.close")
              : t("library.verify.cancelVerification")
          }
          title={session.done ? t("common.close") : t("common.cancel")}
        >
          <Icon icon={xIcon} />
        </button>
      </div>

      <div className="libre-verify-progress">
        <div className="libre-verify-progress-bar" aria-hidden="true">
          <div
            className="libre-verify-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="libre-verify-progress-text">
          {session.index} / {session.total}
        </div>
      </div>

      <div className="libre-verify-tally">
        <span className="libre-verify-pill libre-verify-pill--pass">
          <Icon icon={circleCheck} />
          {counts.passed}
        </span>
        <span className="libre-verify-pill libre-verify-pill--fail">
          <Icon icon={circleX} />
          {counts.failed}
        </span>
        <span className="libre-verify-pill libre-verify-pill--skip">
          <Icon icon={circleSlash} />
          {counts.skipped}
        </span>
      </div>

      <div className="libre-verify-list" role="list">
        {session.results.length === 0 && !session.done && (
          <div className="libre-verify-empty">
            <Icon icon={loader} />
            <span>{t("library.verify.waitingFirst")}</span>
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
          // Localised name for the lesson kind. "other" has no key —
          // it's an internal bucket that only shows up as a skip; the
          // raw kind string keeps it debuggable.
          const kindLabel =
            r.target.kind === "exercise"
              ? t("library.verify.kindExercise")
              : r.target.kind === "reading"
                ? t("library.verify.kindReading")
                : r.target.kind === "quiz"
                  ? t("library.verify.kindQuiz")
                  : r.target.kind;
          return (
            <div
              key={id}
              className={`libre-verify-row libre-verify-row--${status}`}
              role="listitem"
            >
              <button
                className="libre-verify-row-summary"
                onClick={() => status === "fail" && toggleExpanded(id)}
                aria-expanded={isExpanded}
                aria-disabled={status !== "fail"}
              >
                <span className="libre-verify-row-icon" aria-hidden="true">
                  {status === "pass" && <Icon icon={circleCheck} />}
                  {status === "fail" && <Icon icon={circleX} />}
                  {status === "skip" && <Icon icon={circleSlash} />}
                </span>
                <span
                  className="libre-verify-row-kind"
                  aria-label={kindLabel}
                  title={kindLabel}
                >
                  <Icon icon={kindIcon} />
                </span>
                <span className="libre-verify-row-title">
                  {r.target.lesson.title}
                </span>
                <span className="libre-verify-row-meta">
                  {r.skipped
                    ? r.skipReason ?? t("library.verify.skipped")
                    : `${(r.durationMs / 1000).toFixed(2)}s`}
                </span>
              </button>
              {isExpanded && status === "fail" && (
                <div className="libre-verify-row-detail">
                  {r.result?.error && (
                    <div className="libre-verify-row-error">
                      <strong>{t("library.verify.errorLabel")}</strong>{" "}
                      {r.result.error}
                    </div>
                  )}
                  {(r.result?.tests ?? []).filter((t) => !t.passed).map((t, i) => (
                    <div className="libre-verify-row-error" key={i}>
                      <strong>{t.name}:</strong> {t.error}
                    </div>
                  ))}
                  {(r.result?.logs ?? [])
                    .filter((l) => l.level === "error")
                    .slice(0, 5)
                    .map((l, i) => (
                      <pre className="libre-verify-row-log" key={i}>
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
        <div className="libre-verify-footer">
          <button
            className="libre-verify-btn libre-verify-btn--primary"
            onClick={copyAsPrompt}
            title={t("library.verify.tooltipFixPrompt")}
          >
            <Icon icon={flash?.key === "prompt" ? check : copy} />
            <span>
              {flash?.key === "prompt"
                ? flash.label
                : t("library.verify.copyFixPrompt")}
            </span>
          </button>
          <button
            className="libre-verify-btn"
            onClick={copyAsJson}
            title={t("library.verify.tooltipJson")}
          >
            <Icon icon={flash?.key === "json" ? check : copy} />
            <span>{flash?.key === "json" ? flash.label : "JSON"}</span>
          </button>
          <button
            className="libre-verify-btn"
            onClick={downloadReport}
            title={t("library.verify.tooltipDownload")}
          >
            <Icon icon={flash?.key === "download" ? check : download} />
            <span>
              {flash?.key === "download" ? flash.label : t("common.save")}
            </span>
          </button>
          <span className="libre-verify-footer-spacer" />
          <button className="libre-verify-btn" onClick={onClose}>
            {t("common.close")}
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
