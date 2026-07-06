import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { textToCourse } from "@/ingest/pdfParser";
import { track } from "@/lib/track";
import { useT } from "@/i18n/i18n";
import type { Course, LanguageId } from "@/data/types";
import type { StartIngestOpts } from "@/hooks/useIngestRun";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import "./ImportDialog.css";

/// Hand-picked set of valid language ids the detector can return. The
/// backend prompt already constrains this, but we defensively validate
/// on the JS side too — any model can slip a weird value through.
const VALID_LANGUAGES: readonly LanguageId[] = [
  "javascript",
  "typescript",
  "python",
  "rust",
  "swift",
  "go",
  "c",
  "cpp",
  "java",
  "kotlin",
  "csharp",
  "assembly",
];

/// How much of the extracted PDF text to send to the meta-detector. The
/// first 8KB covers the cover page, title page, copyright, preface, and
/// usually a chunk of the ToC — plenty for Claude to identify the book.
const META_EXCERPT_CHARS = 8000;

interface Props {
  onDismiss: () => void;
  /// Kick off the AI-assisted ingest. The dialog auto-dismisses after
  /// handoff so the learner can watch progress in the floating panel and
  /// keep using the app.
  onStartAiIngest: (opts: StartIngestOpts) => void;
  /// Fallback path for when the user opts out of AI structuring. We still
  /// generate a course synchronously (deterministic splitter only) and
  /// save it directly.
  onSavedCourse: (courseId: string) => void;
  /// Optional pre-picked file path. When provided, the dialog skips
  /// the "pick" step + jumps straight to "meta" with the path
  /// loaded. Used by the unified Add Course flow so the user
  /// doesn't have to re-pick a PDF / EPUB they just selected from
  /// the smart picker.
  preselectedPath?: string;
}

interface DetectedMeta {
  title?: string;
  author?: string;
  language?: LanguageId;
}

interface LlmResponseTS {
  text: string;
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
}

/// Import wizard — much simpler than the old blocking-progress version.
/// Two steps:
///   1. "pick"  — file picker
///   2. "meta"  — metadata + AI toggle → click Import, the dialog closes,
///                the floating panel takes over (AI path) or a synchronous
///                deterministic split runs and saves (non-AI path).
///
/// Metadata auto-detection fires as soon as a PDF is picked: we extract
/// the PDF text once, slice the first 8KB, and ask Claude for the title,
/// author, and primary language. Results auto-fill the form unless the
/// learner has already typed into a field (we respect manual edits).
export default function ImportDialog({
  onDismiss,
  onStartAiIngest,
  onSavedCourse,
  preselectedPath,
}: Props) {
  const t = useT();
  const [step, setStep] = useState<"pick" | "meta">("pick");
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [courseId, setCourseId] = useState("");
  // Language is no longer user-facing — removed from the form. It's set
  // by auto-detection and defaults to "javascript" when detection hasn't
  // produced anything (unconfigured API key, detection error, etc.).
  const [language, setLanguage] = useState<LanguageId>("javascript");
  const [useAi, setUseAi] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Track which fields the learner has hand-edited. Auto-detection
  // results only overwrite fields that are still showing the
  // filename-derived default. Without these refs, the detection
  // callback would clobber typing mid-flight.
  const titleEditedRef = useRef(false);
  const authorEditedRef = useRef(false);
  const courseIdEditedRef = useRef(false);

  /// Shared post-pick logic — called from both `pickFile` (the
  /// in-dialog picker button) AND the `preselectedPath` useEffect
  /// below (the unified Add Course flow). Sets the path + derives
  /// filename-based defaults + jumps to the metadata step + kicks
  /// off background AI detection.
  function acceptPath(picked: string) {
    setError(null);
    setDetectionError(null);
    setPdfPath(picked);
    const base = basename(picked).replace(/\.(pdf|epub)$/i, "");
    titleEditedRef.current = false;
    authorEditedRef.current = false;
    courseIdEditedRef.current = false;
    setTitle(toTitle(base));
    setCourseId(slug(base));
    setAuthor("");
    setStep("meta");
    detectMeta(picked).catch(() => {
      /* handled inside detectMeta */
    });
  }

  async function pickFile() {
    setError(null);
    setDetectionError(null);
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Books", extensions: ["pdf", "epub"] }],
      });
      if (typeof picked !== "string") return;
      acceptPath(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Pre-pick: when the parent (the unified Add Course flow)
  // already opened its own picker and chose a PDF/EPUB, jump
  // straight to the metadata step instead of asking the user to
  // re-pick. Fires once per `preselectedPath` value change.
  useEffect(() => {
    if (preselectedPath) acceptPath(preselectedPath);
    // acceptPath is stable enough to omit (it closes over setters
    // that React guarantees stable identity for); listing it here
    // would just thrash the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedPath]);

  async function detectMeta(path: string) {
    setDetecting(true);
    setDetectionError(null);
    try {
      const extracted = await invoke<{ text: string; error: string | null }>(
        "extract_source_text",
        { path },
      );
      if (extracted.error) throw new Error(extracted.error);
      const excerpt = (extracted.text ?? "").slice(0, META_EXCERPT_CHARS);
      if (!excerpt.trim()) {
        throw new Error("no text extracted from book");
      }
      const resp = await invoke<LlmResponseTS>("detect_book_meta", {
        excerpt,
      });
      const meta = parseMetaResponse(resp.text);
      if (!meta) throw new Error("could not parse detection response");
      applyDetectedMeta(meta);
    } catch (e) {
      // Non-fatal — detection is best-effort. Show a hint and leave the
      // filename-based defaults in place. Most likely cause: no API
      // key configured in Settings.
      const msg = e instanceof Error ? e.message : String(e);
      setDetectionError(msg);
    } finally {
      setDetecting(false);
    }
  }

  function applyDetectedMeta(meta: DetectedMeta) {
    if (meta.title && !titleEditedRef.current) {
      setTitle(meta.title);
      // Also update courseId if the learner hasn't touched it — the
      // slug should track the real title, not the filename.
      if (!courseIdEditedRef.current) {
        setCourseId(slug(meta.title));
      }
    }
    if (meta.author && !authorEditedRef.current) {
      setAuthor(meta.author);
    }
    if (meta.language && VALID_LANGUAGES.includes(meta.language)) {
      // Language has no user-facing edit affordance any more, so we
      // always overwrite — the detected value is authoritative.
      setLanguage(meta.language);
    }
  }

  async function runImport() {
    if (!pdfPath) return;
    setError(null);
    const finalId = courseId || slug(title);

    // Fire-and-forget the cover extraction. It's independent of the
    // ingest — we just need the course folder to exist by the time the
    // command reaches Rust (`extract_source_cover` calls
    // `create_dir_all` itself, so it's safe to run before the first
    // `save_course`). Errors here are non-fatal: the import proceeds,
    // just without a cover, and the user can always re-point via
    // Course Settings. Routes through `extract_source_cover` so EPUB
    // covers (bundled in the manifest) and PDF covers (rendered via
    // pdftoppm) flow through one entry point.
    invoke("extract_source_cover", {
      sourcePath: pdfPath,
      courseId: finalId,
    }).catch(() => {
      /* non-fatal */
    });

    if (useAi) {
      // Hand off to the floating panel. The ingest runs detached; dialog
      // closes immediately so the learner can do other things.
      onStartAiIngest({
        pdfPath,
        bookId: finalId,
        title,
        author: author || undefined,
        language,
      });
      onDismiss();
      return;
    }

    // Deterministic-only path: runs synchronously right here. It's quick
    // (no LLM calls) so blocking is fine.
    //
    // `kind` is the source format (pdf vs epub) — the picker only
    // accepts those two extensions. The AI path above hands off to a
    // detached ingest that resolves elsewhere, so this synchronous
    // branch is the only ingest that actually resolves in-dialog; it
    // fires `course.import` with the real success/failure outcome.
    const kind: "pdf" | "epub" = /\.epub$/i.test(pdfPath) ? "epub" : "pdf";
    setRunning(true);
    try {
      const res = await invoke<{ text: string; error: string | null }>(
        "extract_source_text",
        { path: pdfPath },
      );
      if (res.error) throw new Error(res.error);
      const course: Course = textToCourse(res.text, {
        courseId: finalId,
        title,
        author: author || undefined,
        language,
      });
      // Bump coverFetchedAt so the library knows to look for the cover
      // that extract_pdf_cover is (or will be) writing alongside.
      course.coverFetchedAt = Date.now();
      await invoke("save_course", { courseId: finalId, body: course });
      track.courseImport({ kind, ok: true });
      onSavedCourse(finalId);
      onDismiss();
    } catch (e) {
      track.courseImport({ kind, ok: false });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <ModalBackdrop onDismiss={onDismiss}>
      <div className="libre-import-panel">
        <div className="libre-import-header">
          <span className="libre-import-title">{t("import.bookTitle")}</span>
          <button className="libre-import-close" onClick={onDismiss}>×</button>
        </div>

        <div className="libre-import-body">
          {step === "pick" && (
            <>
              <p className="libre-import-blurb">
                {t("import.bookBlurb")}
              </p>
              <button className="libre-import-primary" onClick={pickFile}>
                {t("import.chooseBook")}
              </button>
            </>
          )}

          {step === "meta" && (
            <>
              <Field label={/\.epub$/i.test(pdfPath ?? "") ? "EPUB" : "PDF"}>
                <code className="libre-import-path">{pdfPath}</code>
              </Field>

              {detecting && (
                <div className="libre-import-detecting">
                  <span className="libre-import-detecting-spinner" aria-hidden />
                  {t("import.detecting")}
                </div>
              )}
              {detectionError && !detecting && (
                <div className="libre-import-detecting libre-import-detecting--error">
                  {t("import.detectFailed")}
                  {detectionError.includes("api_key") ||
                  detectionError.includes("401") ? (
                    <> {t("import.checkKey")}</>
                  ) : null}
                </div>
              )}

              <Field label={t("import.titleLabel")}>
                <input
                  className="libre-import-input"
                  value={title}
                  onChange={(e) => {
                    titleEditedRef.current = true;
                    setTitle(e.target.value);
                  }}
                  placeholder={t("import.titlePlaceholder")}
                />
              </Field>
              <Field label={t("import.authorLabel")}>
                <input
                  className="libre-import-input"
                  value={author}
                  onChange={(e) => {
                    authorEditedRef.current = true;
                    setAuthor(e.target.value);
                  }}
                  placeholder={
                    detecting
                      ? t("import.detectingPlaceholder")
                      : t("import.optionalPlaceholder")
                  }
                />
              </Field>
              <Field label={t("import.courseIdLabel")}>
                <input
                  className="libre-import-input"
                  value={courseId}
                  onChange={(e) => {
                    courseIdEditedRef.current = true;
                    setCourseId(e.target.value);
                  }}
                  placeholder={t("import.slugPlaceholder")}
                />
              </Field>

              <label className="libre-import-checkbox">
                <input
                  type="checkbox"
                  checked={useAi}
                  onChange={(e) => setUseAi(e.target.checked)}
                />
                <div>
                  <div>{t("import.useAiLabel")}</div>
                  <div className="libre-import-hint">
                    {t("import.useAiHint")}
                  </div>
                </div>
              </label>

              <div className="libre-import-actions">
                <button
                  className="libre-import-secondary"
                  onClick={() => setStep("pick")}
                  disabled={running}
                >
                  {t("common.back")}
                </button>
                <button
                  className="libre-import-primary"
                  onClick={runImport}
                  disabled={!title || !courseId || running}
                >
                  {running ? t("import.extracting") : t("import.import")}
                </button>
              </div>
            </>
          )}

          {error && <div className="libre-import-error">{error}</div>}
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="libre-import-field">
      <span className="libre-import-label">{label}</span>
      {children}
    </label>
  );
}

/// Parse the detection LLM response. Matches the tolerant pattern used
/// elsewhere in the ingest path — direct parse, then fenced-block slice,
/// then braces-substring fallback. The response is supposed to be
/// raw JSON per the system prompt, but models occasionally wrap it.
function parseMetaResponse(raw: string): DetectedMeta | null {
  const attempt = (s: string): DetectedMeta | null => {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      const out: DetectedMeta = {};
      if (typeof obj.title === "string" && obj.title.trim()) {
        out.title = obj.title.trim();
      }
      if (typeof obj.author === "string" && obj.author.trim()) {
        out.author = obj.author.trim();
      }
      if (typeof obj.language === "string") {
        const lang = obj.language.trim().toLowerCase();
        if (VALID_LANGUAGES.includes(lang as LanguageId)) {
          out.language = lang as LanguageId;
        }
      }
      return Object.keys(out).length > 0 ? out : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(raw);
  if (direct) return direct;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const fenced = attempt(fence[1]);
    if (fenced) return fenced;
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return attempt(raw.slice(first, last + 1));
  }
  return null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function slug(s: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "course";
}

function toTitle(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
