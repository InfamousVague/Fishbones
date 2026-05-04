import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LanguageId } from "../../../data/types";
import type { StartIngestOpts } from "../../../hooks/useIngestRun";
import ModalBackdrop from "../../Shared/ModalBackdrop";
import "./BulkImportDialog.css";

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

const META_EXCERPT_CHARS = 8000;

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

/// One row in the bulk list. Starts as "detecting" and flips to "ready"
/// once detection resolves (or "error" if detection failed — in which
/// case the user can still start it with filename-based fallbacks).
interface QueueItem {
  pdfPath: string;
  filename: string;
  status: "detecting" | "ready" | "error";
  error?: string;
  title: string;
  author: string;
  courseId: string;
  language: LanguageId;
}

interface Props {
  onDismiss: () => void;
  /// Queue handoff. Dialog calls this when the user clicks Start, then
  /// dismisses itself. The FloatingIngestPanel drives progress from there.
  onStartQueue: (items: StartIngestOpts[]) => void;
}

/// Overnight-batch import. Pick multiple PDFs, auto-detect metadata for
/// each in parallel, review the list (editable per-row), click Start.
/// The queue runs unattended — one book at a time, failures don't halt
/// the batch, status shown in the FloatingIngestPanel.
export default function BulkImportDialog({ onDismiss, onStartQueue }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Track which rows the user has hand-edited so background detection
  // results don't clobber their typing.
  const editedRef = useRef<Set<string>>(new Set());

  async function pickFiles() {
    setError(null);
    try {
      const picked = await open({
        multiple: true,
        filters: [{ name: "Books", extensions: ["pdf", "epub"] }],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length === 0) return;

      // Seed each row with filename-based defaults so the list is
      // immediately usable, then kick off detection in parallel so the
      // user doesn't wait serially.
      const seeded: QueueItem[] = paths.map((p) => {
        const base = basename(p).replace(/\.(pdf|epub)$/i, "");
        return {
          pdfPath: p,
          filename: basename(p),
          status: "detecting",
          title: toTitle(base),
          author: "",
          courseId: slug(base),
          language: guessLanguage(base) ?? "javascript",
        };
      });
      setItems(seeded);

      // Run detection in parallel across all files. Failures just mark
      // the row as "error" — the user can still start it with the
      // filename-based metadata.
      await Promise.all(
        seeded.map((item) =>
          detectOne(item.pdfPath).then(
            (meta) => applyDetected(item.pdfPath, meta),
            (err) =>
              setItems((prev) =>
                prev.map((r) =>
                  r.pdfPath === item.pdfPath
                    ? {
                        ...r,
                        status: "error",
                        error: err instanceof Error ? err.message : String(err),
                      }
                    : r,
                ),
              ),
          ),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function detectOne(path: string): Promise<DetectedMeta> {
    const extracted = await invoke<{ text: string; error: string | null }>(
      "extract_source_text",
      { path },
    );
    if (extracted.error) throw new Error(extracted.error);
    const excerpt = (extracted.text ?? "").slice(0, META_EXCERPT_CHARS);
    if (!excerpt.trim()) throw new Error("no text extracted");
    const resp = await invoke<LlmResponseTS>("detect_book_meta", { excerpt });
    const meta = parseMetaResponse(resp.text);
    if (!meta) throw new Error("could not parse detection response");
    return meta;
  }

  function applyDetected(pdfPath: string, meta: DetectedMeta) {
    setItems((prev) =>
      prev.map((r) => {
        if (r.pdfPath !== pdfPath) return r;
        const next: QueueItem = { ...r, status: "ready" };
        // Respect user edits — only fill fields the user hasn't touched.
        const editKey = (field: string) => `${pdfPath}::${field}`;
        if (meta.title && !editedRef.current.has(editKey("title"))) {
          next.title = meta.title;
          if (!editedRef.current.has(editKey("courseId"))) {
            next.courseId = slug(meta.title);
          }
        }
        if (meta.author && !editedRef.current.has(editKey("author"))) {
          next.author = meta.author;
        }
        if (
          meta.language &&
          VALID_LANGUAGES.includes(meta.language) &&
          !editedRef.current.has(editKey("language"))
        ) {
          next.language = meta.language;
        }
        return next;
      }),
    );
  }

  function updateField(
    pdfPath: string,
    field: "title" | "author" | "courseId",
    value: string,
  ) {
    editedRef.current.add(`${pdfPath}::${field}`);
    setItems((prev) =>
      prev.map((r) => (r.pdfPath === pdfPath ? { ...r, [field]: value } : r)),
    );
  }

  function updateLanguage(pdfPath: string, language: LanguageId) {
    editedRef.current.add(`${pdfPath}::language`);
    setItems((prev) =>
      prev.map((r) => (r.pdfPath === pdfPath ? { ...r, language } : r)),
    );
  }

  function removeItem(pdfPath: string) {
    setItems((prev) => prev.filter((r) => r.pdfPath !== pdfPath));
  }

  const detecting = items.some((r) => r.status === "detecting");
  const startable =
    items.length > 0 &&
    items.every((r) => r.title.trim().length > 0 && r.courseId.trim().length > 0);

  function handleStart() {
    const opts: StartIngestOpts[] = items.map((r) => ({
      pdfPath: r.pdfPath,
      bookId: r.courseId || slug(r.title),
      title: r.title,
      author: r.author || undefined,
      language: r.language,
    }));
    // Fire-and-forget cover extraction per book. Runs in parallel; each
    // resolves independently, so slow ones don't hold up the queue.
    // Failures are logged via the command's own error field and are
    // non-fatal — the course just gets the fallback tile. Routes
    // through `extract_source_cover` so EPUBs pull the manifest cover
    // and PDFs still shell out to pdftoppm under one call site.
    for (const item of opts) {
      invoke("extract_source_cover", {
        sourcePath: item.pdfPath,
        courseId: item.bookId,
      }).catch(() => {
        /* non-fatal */
      });
    }
    onStartQueue(opts);
    onDismiss();
  }

  return (
    <ModalBackdrop onDismiss={onDismiss} zIndex={110}>
      <div className="fishbones-bulk-panel">
        <div className="fishbones-bulk-header">
          <div>
            <div className="fishbones-bulk-kicker">Bulk import</div>
            <div className="fishbones-bulk-title">
              Queue multiple books
            </div>
          </div>
          <button
            type="button"
            className="fishbones-bulk-close"
            onClick={onDismiss}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="fishbones-bulk-body">
          {items.length === 0 ? (
            <div className="fishbones-bulk-empty">
              <p className="fishbones-bulk-empty-blurb">
                Pick one or more PDFs or EPUBs. We'll auto-detect the title,
                author, and programming language for each, then queue them
                up for unattended processing. Failures in one book don't
                halt the queue — perfect for leaving it running overnight.
              </p>
              <button
                type="button"
                className="fishbones-bulk-primary"
                onClick={pickFiles}
              >
                Choose books…
              </button>
            </div>
          ) : (
            <>
              <div className="fishbones-bulk-summary">
                {items.length} book{items.length === 1 ? "" : "s"}{" "}
                {detecting ? (
                  <span className="fishbones-bulk-summary-hint">
                    · detecting metadata…
                  </span>
                ) : (
                  <span className="fishbones-bulk-summary-hint">
                    · ready to queue
                  </span>
                )}
                <button
                  type="button"
                  className="fishbones-bulk-add"
                  onClick={pickFiles}
                >
                  Add more…
                </button>
              </div>

              <div className="fishbones-bulk-list">
                {items.map((r) => (
                  <div
                    key={r.pdfPath}
                    className={`fishbones-bulk-row fishbones-bulk-row--${r.status}`}
                  >
                    <div className="fishbones-bulk-row-file">
                      <span className="fishbones-bulk-row-filename" title={r.pdfPath}>
                        {r.filename}
                      </span>
                      <span className="fishbones-bulk-row-status">
                        {r.status === "detecting" && (
                          <>
                            <span
                              className="fishbones-bulk-row-spinner"
                              aria-hidden
                            />
                            detecting
                          </>
                        )}
                        {r.status === "ready" && "ready"}
                        {r.status === "error" && (
                          <span className="fishbones-bulk-row-errtag">
                            detect failed
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="fishbones-bulk-row-remove"
                        onClick={() => removeItem(r.pdfPath)}
                        title="Remove from queue"
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </div>
                    <div className="fishbones-bulk-row-grid">
                      <label className="fishbones-bulk-row-field">
                        <span>Title</span>
                        <input
                          className="fishbones-bulk-row-input"
                          value={r.title}
                          onChange={(e) =>
                            updateField(r.pdfPath, "title", e.target.value)
                          }
                        />
                      </label>
                      <label className="fishbones-bulk-row-field">
                        <span>Author</span>
                        <input
                          className="fishbones-bulk-row-input"
                          value={r.author}
                          placeholder="optional"
                          onChange={(e) =>
                            updateField(r.pdfPath, "author", e.target.value)
                          }
                        />
                      </label>
                      <label className="fishbones-bulk-row-field fishbones-bulk-row-field--narrow">
                        <span>Language</span>
                        <select
                          className="fishbones-bulk-row-input fishbones-bulk-row-langselect"
                          value={r.language}
                          onChange={(e) =>
                            updateLanguage(
                              r.pdfPath,
                              e.target.value as LanguageId,
                            )
                          }
                        >
                          {VALID_LANGUAGES.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {error && <div className="fishbones-bulk-error">{error}</div>}
        </div>

        {items.length > 0 && (
          <div className="fishbones-bulk-footer">
            <div className="fishbones-bulk-footer-hint">
              Queue runs one book at a time. A failure is logged and the
              next book starts automatically.
            </div>
            <div className="fishbones-bulk-footer-actions">
              <button
                type="button"
                className="fishbones-bulk-secondary"
                onClick={onDismiss}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fishbones-bulk-primary"
                onClick={handleStart}
                disabled={!startable}
              >
                {detecting
                  ? `Start ${items.length} (detection running…)`
                  : `Start ${items.length} book${items.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

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

/// Best-effort language guess from a filename. Runs before LLM detection so
/// the row seeds with a plausible default (beats "javascript" for every
/// non-JS book). The LLM result overrides this unless the user has already
/// changed the dropdown. Order matters: longer / more specific patterns
/// first so "typescript" wins over "script", "cpp" wins over "c".
function guessLanguage(name: string): LanguageId | null {
  const s = name.toLowerCase();
  if (/\b(arm|x86|x64|risc[-_ ]?v|mips|6502|assembly|asm|instruction[-_ ]?set|computer[-_ ]?organization)\b/.test(s)) return "assembly";
  if (/\btypescript\b|\bts\b/.test(s)) return "typescript";
  if (/\bjavascript\b|\bjs\b|\bnode(?:\.js)?\b|\breact\b/.test(s)) return "javascript";
  if (/\bpython\b/.test(s)) return "python";
  if (/\brust\b/.test(s)) return "rust";
  if (/\bswift\b/.test(s)) return "swift";
  if (/\bgolang\b|\bgo\b/.test(s)) return "go";
  if (/\bkotlin\b/.test(s)) return "kotlin";
  if (/\bc\+\+\b|\bcpp\b/.test(s)) return "cpp";
  if (/\bc#\b|\bcsharp\b|\bdotnet\b|\b\.net\b/.test(s)) return "csharp";
  if (/\bjava\b/.test(s)) return "java";
  if (/\bansi[-_ ]?c\b|\bc[-_ ]?programming\b|\blearn(?:ing)?[-_ ]?c\b/.test(s)) return "c";
  return null;
}
