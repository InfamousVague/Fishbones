import { useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { check } from "@base/primitives/icon/icons/check";
import { circleX } from "@base/primitives/icon/icons/circle-x";
import { download } from "@base/primitives/icon/icons/download";
import "@base/primitives/icon/icon.css";
import type { Course } from "@/data/types";
import {
  applyFixesToCourse,
  extractFixesFromText,
  promoteCourseToBundled,
  type LessonFixPatch,
} from "@/lib/courseSync";
import { isDesktop } from "@/lib/platform";
import { useT } from "@/i18n/i18n";
import { upload } from "@base/primitives/icon/icons/upload";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
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
  const t = useT();
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
    <ModalBackdrop onDismiss={onClose} zIndex={9100}>
      <div
        className="libre-fixapplier-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-fixapplier-title"
      >
        <header className="libre-fixapplier-header">
          <h2
            id="libre-fixapplier-title"
            className="libre-fixapplier-title"
          >
            {t("import.fixTitle")}
          </h2>
          <button
            className="libre-fixapplier-icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icon icon={xIcon} size="sm" color="currentColor" />
          </button>
        </header>

        <div className="libre-fixapplier-body">
          <p className="libre-fixapplier-help">
            {t("import.fixHelp")}
          </p>

          <label className="libre-fixapplier-label">
            {t("import.courseLabel")}
            <select
              className="libre-fixapplier-select"
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

          <label className="libre-fixapplier-label">
            {t("import.llmReplyLabel")}
            <textarea
              className="libre-fixapplier-textarea"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={t("import.pastePlaceholder")}
              rows={10}
              spellCheck={false}
              disabled={applying}
            />
          </label>

          {parsed.length > 0 && (
            <div className="libre-fixapplier-preview">
              <div className="libre-fixapplier-preview-head">
                {t(
                  parsed.length === 1
                    ? "import.parsedN"
                    : "import.parsedNPlural",
                  { count: parsed.length },
                )}
                {preview.notFound.length > 0 && (
                  <span className="libre-fixapplier-warn">
                    ·{" "}
                    {t(
                      preview.notFound.length === 1
                        ? "import.unknownIdsN"
                        : "import.unknownIdsNPlural",
                      { count: preview.notFound.length },
                    )}
                  </span>
                )}
              </div>
              <ul className="libre-fixapplier-preview-list">
                {preview.matched.map((m) => (
                  <li
                    key={m.id}
                    className="libre-fixapplier-preview-row libre-fixapplier-preview-row--match"
                  >
                    <Icon icon={check} size="xs" color="currentColor" />
                    <span className="libre-fixapplier-preview-title">
                      {m.title}
                    </span>
                    {m.patch.diagnosis && (
                      <span className="libre-fixapplier-preview-diag">
                        {m.patch.diagnosis}
                      </span>
                    )}
                  </li>
                ))}
                {preview.notFound.map((id) => (
                  <li
                    key={id}
                    className="libre-fixapplier-preview-row libre-fixapplier-preview-row--miss"
                  >
                    <Icon icon={circleX} size="xs" color="currentColor" />
                    <span className="libre-fixapplier-preview-title">
                      <code>{id}</code> {t("import.notInCourse")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div className="libre-fixapplier-success">
              {t(
                result.applied.length === 1
                  ? "import.appliedN"
                  : "import.appliedNPlural",
                { count: result.applied.length },
              )}
              {result.notFound.length > 0
                ? ` · ${t(
                    result.notFound.length === 1
                      ? "import.unknownIdsN"
                      : "import.unknownIdsNPlural",
                    { count: result.notFound.length },
                  )}`
                : ""}
              .
            </div>
          )}

          {promoteResult?.ok && (
            <div className="libre-fixapplier-success">
              {t("import.wroteBundled")} <code>{promoteResult.path}</code>
            </div>
          )}
          {promoteResult && !promoteResult.ok && (
            <div className="libre-fixapplier-error">
              <Icon icon={circleX} size="xs" color="currentColor" />
              <span>
                {t("import.promoteFailed", { error: promoteResult.error })}
              </span>
            </div>
          )}

          {error && (
            <div className="libre-fixapplier-error">
              <Icon icon={circleX} size="xs" color="currentColor" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="libre-fixapplier-footer">
          {result && isDesktop && (
            <button
              className="libre-fixapplier-btn"
              onClick={() => void promoteToBundled()}
              title={t("import.promoteToBundledTooltip")}
            >
              <Icon icon={upload} size="xs" color="currentColor" />
              <span>{t("import.promoteToBundled")}</span>
            </button>
          )}
          {result && (
            <button
              className="libre-fixapplier-btn"
              onClick={downloadCoursePromote}
              title={t("import.downloadUpdatedTooltip")}
            >
              <Icon icon={download} size="xs" color="currentColor" />
              <span>{t("import.downloadUpdated")}</span>
            </button>
          )}
          <span className="libre-fixapplier-spacer" />
          <button
            className="libre-fixapplier-btn"
            onClick={onClose}
            disabled={applying}
          >
            {result ? t("common.close") : t("common.cancel")}
          </button>
          {!result && (
            <button
              className="libre-fixapplier-btn libre-fixapplier-btn--primary"
              onClick={handleApply}
              disabled={
                applying || parsed.length === 0 || preview.matched.length === 0
              }
            >
              {applying
                ? t("import.applying")
                : t(
                    preview.matched.length === 1
                      ? "import.applyN"
                      : "import.applyNPlural",
                    { count: preview.matched.length },
                  )}
            </button>
          )}
        </footer>
      </div>
    </ModalBackdrop>
  );
}
