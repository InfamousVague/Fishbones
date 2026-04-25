import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "../../data/types";
import "./CourseSettingsModal.css";

/// Human-readable labels for every `LanguageId`. Rendered in the
/// language-fix dropdown below; order matches the Playground's picker so
/// learners see a consistent roster across the app.
const LANGUAGE_OPTIONS: Array<{ id: LanguageId; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "csharp", label: "C#" },
  { id: "assembly", label: "Assembly" },
  { id: "web", label: "Web (HTML + CSS + JS)" },
  { id: "threejs", label: "Three.js" },
  { id: "reactnative", label: "React Native" },
];

interface Props {
  course: Course;
  onDismiss: () => void;
  onExport: () => void;
  onDelete: () => void;
  onRegenerateExercises: () => void;
  onEnrichLessons: () => void;
  /// Fires after a fresh cover PNG lands on disk. Parent uses it to
  /// bump `course.coverFetchedAt` in the JSON so the library cache-
  /// busts its in-memory blob URL and re-renders with the new art.
  /// Optional — omit the row entirely when not provided.
  onCoverRefreshed?: (coverFetchedAt: number) => void;
  /// Persist a new `language` on the course. Fires when the user
  /// picks from the "Course language" dropdown and clicks Save.
  /// Parent handler re-loads the course JSON, sets the language,
  /// writes back, and refreshes the in-memory course list. Optional
  /// so this component stays usable in preview / test contexts.
  onChangeLanguage?: (language: LanguageId) => Promise<void>;
}

interface CoverResult {
  path: string;
  fetched_at: number;
  error: string | null;
}

/// Same shape as CoverResult — the AI generator's Tauri command was
/// designed to be drop-in compatible so the UI handler paths can be
/// interchangeable between PDF-source and AI-generated covers.
type CoverGenResult = CoverResult;

/// Per-course settings modal. Opened from the sidebar's right-click
/// context menu via "Course settings…" — gathers all the
/// course-scoped maintenance actions (regenerate content, export, delete)
/// in one place instead of scattering them across the context menu.
export default function CourseSettingsModal({
  course,
  onDismiss,
  onExport,
  onDelete,
  onRegenerateExercises,
  onEnrichLessons,
  onCoverRefreshed,
  onChangeLanguage,
}: Props) {
  // Cover fetch state — "fetching" while pdftoppm is shelling out,
  // error string if the command failed. Cleared on success (the library
  // re-renders with the new art via onCoverRefreshed).
  const [coverFetching, setCoverFetching] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  // Separate in-flight flag for the AI generator so the two actions
  // don't stomp each other's "loading" state. Error is shared — only
  // one can fail at a time.
  const [coverGenerating, setCoverGenerating] = useState(false);

  // Language-fix state. Staged until the user clicks Save so a rogue
  // dropdown click doesn't rewrite the course JSON every keystroke.
  const [pendingLanguage, setPendingLanguage] = useState<LanguageId>(
    course.language,
  );
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);

  async function commitLanguageChange() {
    if (!onChangeLanguage) return;
    if (pendingLanguage === course.language) return;
    setLanguageError(null);
    setSavingLanguage(true);
    try {
      await onChangeLanguage(pendingLanguage);
    } catch (e) {
      setLanguageError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLanguage(false);
    }
  }

  async function fetchCoverFromPdf() {
    setCoverError(null);
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Book", extensions: ["pdf", "epub"] }],
      });
      if (typeof picked !== "string") return; // user cancelled
      setCoverFetching(true);
      const result = await invoke<CoverResult>("extract_source_cover", {
        sourcePath: picked,
        courseId: course.id,
      });
      if (result.error) {
        setCoverError(result.error);
        return;
      }
      onCoverRefreshed?.(result.fetched_at);
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setCoverFetching(false);
    }
  }

  /// Import a user-picked image as the cover. Rust decodes and
  /// re-encodes as PNG so `load_course_cover` doesn't have to sniff
  /// formats. Shares the same error slot + refresh hook as the other
  /// cover flows.
  async function importCoverImage() {
    setCoverError(null);
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [
          { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (typeof picked !== "string") return;
      setCoverFetching(true);
      const result = await invoke<CoverResult>("import_course_cover", {
        imagePath: picked,
        courseId: course.id,
      });
      if (result.error) {
        setCoverError(result.error);
        return;
      }
      onCoverRefreshed?.(result.fetched_at);
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setCoverFetching(false);
    }
  }

  /// Generate a fresh cover using OpenAI's gpt-image-1. Shares the
  /// coverError slot with `fetchCoverFromPdf` so the UI only renders one
  /// error at a time. The heavy lifting (prompt construction, OpenAI
  /// call, PNG decode + write, coverFetchedAt stamp) lives in the Rust
  /// `generate_cover_art` command — we just dispatch + handle the
  /// returned shape.
  async function generateCoverWithAi() {
    setCoverError(null);
    setCoverGenerating(true);
    try {
      const result = await invoke<CoverGenResult>("generate_cover_art", {
        params: {
          course_id: course.id,
          title: course.title,
          author: course.author ?? null,
          language: course.language,
        },
      });
      if (result.error) {
        setCoverError(result.error);
        return;
      }
      onCoverRefreshed?.(result.fetched_at);
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setCoverGenerating(false);
    }
  }

  const stats = useMemo(() => {
    let lessons = 0;
    let exercises = 0;
    let quizzes = 0;
    let readings = 0;
    // "Enrichable" = any non-quiz lesson, since enrichment targets prose.
    // "Enriched" = already has both objectives + enrichment set.
    let enrichable = 0;
    let enriched = 0;
    for (const ch of course.chapters) {
      for (const l of ch.lessons) {
        lessons++;
        if (l.kind === "exercise" || l.kind === "mixed") exercises++;
        else if (l.kind === "quiz") quizzes++;
        else readings++;
        // Enrichment tracking — quizzes never enrich, anything else does.
        // "Enriched" requires BOTH fields present so we don't miscount a
        // lesson that only got one field through.
        if (l.kind !== "quiz") {
          enrichable++;
          if (
            Array.isArray(l.objectives) &&
            l.objectives.length > 0 &&
            l.enrichment
          ) {
            enriched++;
          }
        }
      }
    }
    return { lessons, exercises, quizzes, readings, enrichable, enriched };
  }, [course]);

  const enrichRemaining = stats.enrichable - stats.enriched;

  return (
    <div className="fishbones-coursesettings-backdrop" onClick={onDismiss}>
      <div
        className="fishbones-coursesettings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fishbones-coursesettings-header">
          <div className="fishbones-coursesettings-titleblock">
            <div className="fishbones-coursesettings-title">Course settings</div>
            <div className="fishbones-coursesettings-course">{course.title}</div>
            {course.author && (
              <div className="fishbones-coursesettings-author">by {course.author}</div>
            )}
          </div>
          <button
            className="fishbones-coursesettings-close"
            onClick={onDismiss}
            aria-label="Close"
          >
            <Icon icon={xIcon} size="xs" color="currentColor" />
          </button>
        </div>

        <div className="fishbones-coursesettings-body">
          <section>
            <div className="fishbones-coursesettings-section">At a glance</div>
            <div className="fishbones-coursesettings-stats">
              <div>
                <div className="fishbones-coursesettings-stat-value">
                  {course.chapters.length}
                </div>
                <div className="fishbones-coursesettings-stat-label">chapters</div>
              </div>
              <div>
                <div className="fishbones-coursesettings-stat-value">{stats.lessons}</div>
                <div className="fishbones-coursesettings-stat-label">lessons</div>
              </div>
              <div>
                <div className="fishbones-coursesettings-stat-value">{stats.exercises}</div>
                <div className="fishbones-coursesettings-stat-label">exercises</div>
              </div>
              <div>
                <div className="fishbones-coursesettings-stat-value">{stats.readings}</div>
                <div className="fishbones-coursesettings-stat-label">readings</div>
              </div>
            </div>
          </section>

          <section>
            <div className="fishbones-coursesettings-section">Regenerate content</div>
            <div className="fishbones-coursesettings-row">
              <div className="fishbones-coursesettings-row-text">
                <div className="fishbones-coursesettings-row-label">
                  Regenerate exercises
                </div>
                <div className="fishbones-coursesettings-row-hint">
                  Re-run the AI generation for all {stats.exercises} exercise
                  lessons using the latest prompt. Readings and quizzes are
                  untouched. Progress shows in the floating panel and each
                  lesson saves as it completes — safe to cancel midway.
                </div>
              </div>
              <button
                className="fishbones-coursesettings-btn fishbones-coursesettings-btn--primary"
                onClick={() => {
                  onRegenerateExercises();
                  onDismiss();
                }}
                disabled={stats.exercises === 0}
              >
                Regenerate
              </button>
            </div>
          </section>

          {onChangeLanguage && (
            <section>
              <div className="fishbones-coursesettings-section">
                Course language
              </div>
              <div className="fishbones-coursesettings-row">
                <div className="fishbones-coursesettings-row-text">
                  <div className="fishbones-coursesettings-row-label">
                    Fix the course's language
                  </div>
                  <div className="fishbones-coursesettings-row-hint">
                    Currently set to{" "}
                    <code>{labelFor(course.language)}</code>. LLM-generated
                    courses from docs sites sometimes land with the wrong
                    language — switching here re-dispatches Run and the
                    lesson view to the right runtime. Lesson-level
                    <code>language</code> fields are left untouched; only
                    the course's top-level tag changes.
                  </div>
                  {languageError && (
                    <div className="fishbones-coursesettings-row-error">
                      {languageError}
                    </div>
                  )}
                </div>
                <div className="fishbones-coursesettings-lang-controls">
                  <select
                    className="fishbones-coursesettings-lang-select"
                    value={pendingLanguage}
                    onChange={(e) =>
                      setPendingLanguage(e.target.value as LanguageId)
                    }
                    disabled={savingLanguage}
                    aria-label="Course language"
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="fishbones-coursesettings-btn fishbones-coursesettings-btn--primary"
                    onClick={commitLanguageChange}
                    disabled={
                      savingLanguage || pendingLanguage === course.language
                    }
                  >
                    {savingLanguage ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="fishbones-coursesettings-section">
              Reading experience
            </div>
            <div className="fishbones-coursesettings-row">
              <div className="fishbones-coursesettings-row-text">
                <div className="fishbones-coursesettings-row-label">
                  Enrich lessons
                </div>
                <div className="fishbones-coursesettings-row-hint">
                  Generate learning objectives, glossary terms, and inline
                  symbol doc-links for {enrichRemaining} lesson
                  {enrichRemaining === 1 ? "" : "s"} that don't have them yet.
                  Much cheaper than regenerating — only the new reading-aid
                  fields are produced, the existing body / starter / solution
                  / tests are untouched. Safe to cancel midway: it resumes
                  where it left off on the next run.
                  {stats.enriched > 0 && (
                    <>
                      {" "}
                      ({stats.enriched} of {stats.enrichable} already enriched.)
                    </>
                  )}
                </div>
              </div>
              <button
                className="fishbones-coursesettings-btn fishbones-coursesettings-btn--primary"
                onClick={() => {
                  onEnrichLessons();
                  onDismiss();
                }}
                disabled={enrichRemaining === 0}
              >
                {enrichRemaining === 0 ? "All enriched" : "Enrich"}
              </button>
            </div>
          </section>

          {onCoverRefreshed && (
            <section>
              <div className="fishbones-coursesettings-section">Appearance</div>
              <div className="fishbones-coursesettings-row">
                <div className="fishbones-coursesettings-row-text">
                  <div className="fishbones-coursesettings-row-label">
                    Fetch cover artwork
                  </div>
                  <div className="fishbones-coursesettings-row-hint">
                    Point Fishbones at a PDF or EPUB (the original book,
                    or a single-page cover image saved as PDF) and we'll
                    pull the cover art for the shelf. Useful when the
                    original ingest didn't grab a cover, or if you want
                    to re-extract from a higher-resolution source.
                  </div>
                </div>
                <button
                  className="fishbones-coursesettings-btn"
                  onClick={fetchCoverFromPdf}
                  disabled={coverFetching || coverGenerating}
                  type="button"
                >
                  {coverFetching ? "Fetching…" : "Choose book…"}
                </button>
              </div>
              <div className="fishbones-coursesettings-row">
                <div className="fishbones-coursesettings-row-text">
                  <div className="fishbones-coursesettings-row-label">
                    Import image file
                  </div>
                  <div className="fishbones-coursesettings-row-hint">
                    Use any PNG, JPEG, WebP, or GIF from disk as the cover.
                    Best for custom art or when the PDF's first page isn't
                    the cover you want.
                  </div>
                </div>
                <button
                  className="fishbones-coursesettings-btn"
                  onClick={importCoverImage}
                  disabled={coverFetching || coverGenerating}
                  type="button"
                >
                  {coverFetching ? "Importing…" : "Choose image…"}
                </button>
              </div>
              <div className="fishbones-coursesettings-row">
                <div className="fishbones-coursesettings-row-text">
                  <div className="fishbones-coursesettings-row-label">
                    Generate artwork with AI
                  </div>
                  <div className="fishbones-coursesettings-row-hint">
                    Ask <code>gpt-image-1</code> for a fresh cover in the
                    library's shared editorial style — abstract geometric,
                    no typography, cohesive across every book on the
                    shelf. Takes 5–20 seconds and costs ~$0.04 per
                    generation. Requires an OpenAI API key in{" "}
                    <strong>Settings → AI</strong>.
                  </div>
                </div>
                <button
                  className="fishbones-coursesettings-btn fishbones-coursesettings-btn--primary"
                  onClick={generateCoverWithAi}
                  disabled={coverFetching || coverGenerating}
                  type="button"
                >
                  {coverGenerating ? "Generating…" : "Generate"}
                </button>
              </div>
              {coverError && (
                <div className="fishbones-coursesettings-row-error">
                  {coverError}
                </div>
              )}
            </section>
          )}

          <section>
            <div className="fishbones-coursesettings-section">Share</div>
            <div className="fishbones-coursesettings-row">
              <div className="fishbones-coursesettings-row-text">
                <div className="fishbones-coursesettings-row-label">Export as .fishbones</div>
                <div className="fishbones-coursesettings-row-hint">
                  Save the course as a portable `.fishbones` archive. Anyone
                  with Fishbones can import it.
                </div>
              </div>
              <button
                className="fishbones-coursesettings-btn"
                onClick={() => {
                  onExport();
                  onDismiss();
                }}
              >
                Export…
              </button>
            </div>
          </section>

          <section>
            <div className="fishbones-coursesettings-section fishbones-coursesettings-section--danger">
              Danger zone
            </div>
            <div className="fishbones-coursesettings-row">
              <div className="fishbones-coursesettings-row-text">
                <div className="fishbones-coursesettings-row-label">Delete course</div>
                <div className="fishbones-coursesettings-row-hint">
                  Removes the course, all lesson progress, and the ingest
                  cache from disk. Can't be undone.
                </div>
              </div>
              <button
                className="fishbones-coursesettings-btn fishbones-coursesettings-btn--danger"
                onClick={() => {
                  onDelete();
                  onDismiss();
                }}
              >
                Delete…
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/// Fall back to the raw id when the language isn't in the roster so we
/// never render `undefined` in the banner. A missing entry means the
/// LanguageId grew and we forgot to update `LANGUAGE_OPTIONS` — the
/// raw id tells the reader exactly what to add.
function labelFor(id: LanguageId): string {
  return LANGUAGE_OPTIONS.find((opt) => opt.id === id)?.label ?? id;
}
