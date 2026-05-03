import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { check } from "@base/primitives/icon/icons/check";
import { circleX } from "@base/primitives/icon/icons/circle-x";
import { download } from "@base/primitives/icon/icons/download";
import "@base/primitives/icon/icon.css";
import type { Course } from "../../data/types";
import {
  applyFixesToCourse,
  extractFixesFromText,
  promoteCourseToBundled,
  type LessonFixPatch,
} from "../../lib/courseSync";
import { isDesktop } from "../../lib/platform";
import { upload } from "@base/primitives/icon/icons/upload";
import "./FixApplierDialog.css";

interface Props {
  /// Courses the user can pick from (typically the full library).
  courses: Course[];
  /// Pre-selected course id — usually the active tab's course so the
  /// dialog opens already pointed at the same course the verifier
  /// just ran on. Optional; the user can switch via the dropdown.
  initialCourseId?: string;
  onClose: () => void;
  /// Called after a successful apply so the parent can refresh
  /// in-memory course state. Receives the updated course object.
  onApplied?: (course: Course) => void;
}

/// Paste-and-apply UI for the LLM fix-prompt reply. The verify
/// overlay's "Copy fix prompt" → paste into Claude → paste reply
/// here → click Apply. The dialog parses fenced JSON blocks via
/// `extractFixesFromText`, previews which lessons would change,
/// then writes the patched course back to disk.
///
/// Why the live preview instead of just an Apply button: the LLM
/// occasionally typoes a lesson id (e.g. drops a hyphen), and that
/// silently no-ops in a blind apply. The preview shows
/// `notFound` ids in red so the user catches them before
/// committing.
export default function FixApplierDialog({
  courses,
  initialCourseId,
  onClose,
  onApplied,
}: Props) {
  const [courseId, setCourseId] = useState(
    initialCourseId ?? courses[0]?.id ?? "",
  );
  const [pasted, setPasted] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{
    applied: Array<{ id: string; title: string }>;
    notFound: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// Transient feedback after a "Promote to bundled" click. Holds
  /// either the path the file was written to, or an error message.
  const [promoteResult, setPromoteResult] = useState<
    { ok: true; path: string } | { ok: false; error: string } | null
  >(null);

  // Escape closes — same convention as ConfirmDialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeCourse = courses.find((c) => c.id === courseId) ?? null;

  // Reparse on every keystroke. extractFixesFromText is cheap (a few
  // regex sweeps) so debouncing isn't worth the latency penalty for
  // the user's "did it pick up my paste yet" check.
  const parsed: LessonFixPatch[] = useMemo(
    () => (pasted.trim() ? extractFixesFromText(pasted) : []),
    [pasted],
  );

  // Preview which parsed ids match a lesson in the selected course
  // and which don't. Pre-computed so the rows render with the right
  // status without doing the lookup per render.
  const preview = useMemo(() => {
    if (!activeCourse) return { matched: [], notFound: parsed.map((p) => p.id) };
    const lessonsById = new Map<string, string>();
    for (const ch of activeCourse.chapters) {
      for (const l of ch.lessons) lessonsById.set(l.id, l.title);
    }
    const matched: Array<{ id: string; title: string; patch: LessonFixPatch }> = [];
    const notFound: string[] = [];
    for (const p of parsed) {
      const title = lessonsById.get(p.id);
      if (title) matched.push({ id: p.id, title, patch: p });
      else notFound.push(p.id);
    }
    return { matched, notFound };
  }, [activeCourse, parsed]);

  const handleApply = async () => {
    if (!courseId || parsed.length === 0) return;
    setApplying(true);
    setError(null);
    setResult(null);
    try {
      const r = await applyFixesToCourse(courseId, parsed);
      setResult({ applied: r.applied, notFound: r.notFound });
      onApplied?.(r.course);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const downloadCoursePromote = () => {
    // Fallback for the web build (no Tauri command available) or
    // when the user wants to inspect the JSON before committing it.
    // Drops a course.json file the user can manually move into
    // `public/starter-courses/<id>.json`.
    if (!activeCourse) return;
    const blob = new Blob([JSON.stringify(activeCourse, null, 2) + "\n"], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${courseId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /// One-click promote: write the patched course straight into the
  /// repo's `public/starter-courses/<id>.json` via a dev-only
  /// Tauri command. Surfaces the resulting absolute path in a
  /// "saved to ..." chip so the user can confirm + cd to it.
  const promoteToBundled = async () => {
    if (!activeCourse) return;
    setPromoteResult(null);
    try {
      const path = await promoteCourseToBundled(activeCourse);
      setPromoteResult({ ok: true, path });
    } catch (e) {
      setPromoteResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div
      className="fishbones-fixapplier-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="fishbones-fixapplier-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fishbones-fixapplier-title"
      >
        <header className="fishbones-fixapplier-header">
          <h2
            id="fishbones-fixapplier-title"
            className="fishbones-fixapplier-title"
          >
            Apply fix patches
          </h2>
          <button
            className="fishbones-fixapplier-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon icon={xIcon} size="sm" color="currentColor" />
          </button>
        </header>

        <div className="fishbones-fixapplier-body">
          <p className="fishbones-fixapplier-help">
            Paste the LLM's reply to a "Copy fix prompt" export. Each
            fenced JSON block becomes one lesson patch. Patches apply
            to the installed copy of the course; to ship them in the
            bundled starter, click <em>Download updated</em> after
            applying and drop the file into
            <code> public/starter-courses/&lt;id&gt;.json</code>.
          </p>

          <label className="fishbones-fixapplier-label">
            Course
            <select
              className="fishbones-fixapplier-select"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              disabled={applying}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>

          <label className="fishbones-fixapplier-label">
            LLM reply
            <textarea
              className="fishbones-fixapplier-textarea"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder='Paste the model&apos;s JSON reply here. Each ```json { "id": ..., "solution": ..., "tests": ... } ``` block becomes one patch.'
              rows={10}
              spellCheck={false}
              disabled={applying}
            />
          </label>

          {parsed.length > 0 && (
            <div className="fishbones-fixapplier-preview">
              <div className="fishbones-fixapplier-preview-head">
                Parsed {parsed.length} patch{parsed.length === 1 ? "" : "es"}
                {preview.notFound.length > 0 && (
                  <span className="fishbones-fixapplier-warn">
                    · {preview.notFound.length} unknown id
                    {preview.notFound.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <ul className="fishbones-fixapplier-preview-list">
                {preview.matched.map((m) => (
                  <li
                    key={m.id}
                    className="fishbones-fixapplier-preview-row fishbones-fixapplier-preview-row--match"
                  >
                    <Icon icon={check} size="xs" color="currentColor" />
                    <span className="fishbones-fixapplier-preview-title">
                      {m.title}
                    </span>
                    {m.patch.diagnosis && (
                      <span className="fishbones-fixapplier-preview-diag">
                        {m.patch.diagnosis}
                      </span>
                    )}
                  </li>
                ))}
                {preview.notFound.map((id) => (
                  <li
                    key={id}
                    className="fishbones-fixapplier-preview-row fishbones-fixapplier-preview-row--miss"
                  >
                    <Icon icon={circleX} size="xs" color="currentColor" />
                    <span className="fishbones-fixapplier-preview-title">
                      <code>{id}</code> — not in this course
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div className="fishbones-fixapplier-success">
              ✓ Applied {result.applied.length} patch
              {result.applied.length === 1 ? "" : "es"}
              {result.notFound.length > 0
                ? ` · ${result.notFound.length} unknown id${result.notFound.length === 1 ? "" : "s"}`
                : ""}
              .
            </div>
          )}

          {promoteResult?.ok && (
            <div className="fishbones-fixapplier-success">
              ✓ Wrote bundled starter to <code>{promoteResult.path}</code>
            </div>
          )}
          {promoteResult && !promoteResult.ok && (
            <div className="fishbones-fixapplier-error">
              <Icon icon={circleX} size="xs" color="currentColor" />
              <span>Promote failed: {promoteResult.error}</span>
            </div>
          )}

          {error && (
            <div className="fishbones-fixapplier-error">
              <Icon icon={circleX} size="xs" color="currentColor" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="fishbones-fixapplier-footer">
          {result && isDesktop && (
            <button
              className="fishbones-fixapplier-btn"
              onClick={() => void promoteToBundled()}
              title="(Dev only) Write the patched course straight to public/starter-courses/<id>.json"
            >
              <Icon icon={upload} size="xs" color="currentColor" />
              <span>Promote to bundled</span>
            </button>
          )}
          {result && (
            <button
              className="fishbones-fixapplier-btn"
              onClick={downloadCoursePromote}
              title="Download the updated course.json so you can ship the fixes back into the bundled starter"
            >
              <Icon icon={download} size="xs" color="currentColor" />
              <span>Download updated</span>
            </button>
          )}
          <span className="fishbones-fixapplier-spacer" />
          <button
            className="fishbones-fixapplier-btn"
            onClick={onClose}
            disabled={applying}
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              className="fishbones-fixapplier-btn fishbones-fixapplier-btn--primary"
              onClick={handleApply}
              disabled={
                applying || parsed.length === 0 || preview.matched.length === 0
              }
            >
              {applying
                ? "Applying…"
                : `Apply ${preview.matched.length} patch${preview.matched.length === 1 ? "" : "es"}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
