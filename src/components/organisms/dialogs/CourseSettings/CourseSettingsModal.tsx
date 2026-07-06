import { useMemo, useState } from "react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useT } from "@/i18n/i18n";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "@/data/types";
import type { ReleaseStatus } from "@/components/templates/Library/BookCover";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import "./CourseSettingsModal.css";

/// Editable fields in the "Course details" section. Each is optional
/// in the patch — the parent handler writes only the supplied keys
/// back to course.json. `releaseStatus: null` clears the field
/// (treated as "Unreviewed" by `releaseStatusFor`); a string value
/// promotes/demotes to that tier.
export interface CourseMetadataPatch {
  title?: string;
  author?: string | null;
  releaseStatus?: ReleaseStatus | null;
}

/// Editorial-tier options for the release-status select. Order
/// matches the library's Status sort (top → bottom): verified first,
/// then final polish, next up, then unreviewed. Labels are i18n KEYS
/// (this is a plain module-level const — the component resolves them
/// through `t()` at render time).
const RELEASE_OPTIONS: Array<{ value: ReleaseStatus; labelKey: string }> = [
  { value: "VERIFIED", labelKey: "library.courseSettings.releaseOptionVerified" },
  { value: "BETA", labelKey: "library.courseSettings.releaseOptionBeta" },
  { value: "ALPHA", labelKey: "library.courseSettings.releaseOptionAlpha" },
  { value: "UNREVIEWED", labelKey: "library.courseSettings.releaseOptionUnreviewed" },
];

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
  /// Persist editorial metadata (title, author, release status). The
  /// patch carries only the fields the user actually changed — see
  /// `CourseMetadataPatch`. Same load → mutate → save → refresh
  /// pattern as `onChangeLanguage`. Optional so the modal stays
  /// usable in preview / test contexts.
  onChangeMetadata?: (patch: CourseMetadataPatch) => Promise<void>;
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
  onChangeMetadata,
}: Props) {
  const t = useT();
  // ────────── Editable metadata (title / author / releaseStatus) ──
  // Staged in local state so the user can edit freely and only the
  // diff against `course` gets written on Save. We keep title/author
  // as strings (empty string = "clear") and releaseStatus as the
  // typed enum. The Save button is disabled when the staged values
  // match the current course values verbatim.
  const currentReleaseStatus: ReleaseStatus =
    course.releaseStatus === "ALPHA" || course.releaseStatus === "BETA"
      ? course.releaseStatus
      : "UNREVIEWED";
  const [pendingTitle, setPendingTitle] = useState<string>(course.title ?? "");
  const [pendingAuthor, setPendingAuthor] = useState<string>(course.author ?? "");
  const [pendingReleaseStatus, setPendingReleaseStatus] =
    useState<ReleaseStatus>(currentReleaseStatus);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataSaved, setMetadataSaved] = useState(false);

  // ────────── Share link ─────────────────────────────────────────
  // Public URL anyone can paste into a browser. `libre.academy/install`
  // routes to the catalog detail page if the course is a known
  // bundled pack; otherwise it falls through to a generic install
  // hint that points the recipient at the desktop app's "Import
  // archive" flow. The URL is intentionally extension-agnostic — the
  // server resolves to `.academy` (or legacy `.libre`) by id.
  const shareUrl = `https://libre.academy/install?course=${encodeURIComponent(course.id)}`;
  const { copied: shareCopied, copy: copyShare } = useCopyToClipboard();
  async function copyShareLink() {
    const ok = await copyShare(shareUrl);
    if (!ok) {
      // Clipboard API can fail in non-HTTPS contexts or when the
      // tab isn't focused. Fall back to a manual prompt so the user
      // can still grab the URL.
      window.prompt(t("library.courseSettings.copyLinkPrompt"), shareUrl);
    }
  }

  // Has the user actually changed anything? Strict-equal compare
  // against the current course; whitespace differences count as
  // edits intentionally so a user "tightening" trailing spaces gets
  // a Save button. Empty title falls back to the existing title
  // (we don't allow saving a blank title — the library would
  // render "Untitled" and the user would lose the original).
  const titleChanged = pendingTitle.trim() !== (course.title ?? "");
  const authorChanged = pendingAuthor !== (course.author ?? "");
  const statusChanged = pendingReleaseStatus !== currentReleaseStatus;
  const metadataDirty = titleChanged || authorChanged || statusChanged;
  const titleValid = pendingTitle.trim().length > 0;

  async function commitMetadataChange() {
    if (!onChangeMetadata) return;
    if (!metadataDirty) return;
    if (!titleValid) {
      setMetadataError(t("library.courseSettings.errTitleEmpty"));
      return;
    }
    const patch: CourseMetadataPatch = {};
    if (titleChanged) patch.title = pendingTitle.trim();
    if (authorChanged) patch.author = pendingAuthor.trim() === "" ? null : pendingAuthor.trim();
    if (statusChanged) patch.releaseStatus = pendingReleaseStatus;
    setMetadataError(null);
    setMetadataSaved(false);
    setSavingMetadata(true);
    try {
      await onChangeMetadata(patch);
      setMetadataSaved(true);
      // Auto-clear the saved indicator after a beat so it doesn't
      // linger if the user makes another edit later.
      window.setTimeout(() => setMetadataSaved(false), 2200);
    } catch (e) {
      setMetadataError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMetadata(false);
    }
  }
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
    <ModalBackdrop onDismiss={onDismiss} zIndex={120}>
      <div className="libre-coursesettings-panel">
        <div className="libre-coursesettings-header">
          <div className="libre-coursesettings-titleblock">
            <div className="libre-coursesettings-title">
              {t("library.courseSettings.title")}
            </div>
            <div className="libre-coursesettings-course">{course.title}</div>
            {course.author && (
              <div className="libre-coursesettings-author">
                {t("library.courseSettings.byAuthor", { author: course.author })}
              </div>
            )}
          </div>
          <button
            className="libre-coursesettings-close"
            onClick={onDismiss}
            aria-label={t("common.close")}
          >
            <Icon icon={xIcon} size="xs" color="currentColor" />
          </button>
        </div>

        <div className="libre-coursesettings-body">
          <section>
            <div className="libre-coursesettings-section">
              {t("library.courseSettings.atAGlance")}
            </div>
            <div className="libre-coursesettings-stats">
              <div>
                <div className="libre-coursesettings-stat-value">
                  {course.chapters.length}
                </div>
                <div className="libre-coursesettings-stat-label">
                  {t("library.courseSettings.statChapters")}
                </div>
              </div>
              <div>
                <div className="libre-coursesettings-stat-value">{stats.lessons}</div>
                <div className="libre-coursesettings-stat-label">
                  {t("library.courseSettings.statLessons")}
                </div>
              </div>
              <div>
                <div className="libre-coursesettings-stat-value">{stats.exercises}</div>
                <div className="libre-coursesettings-stat-label">
                  {t("library.courseSettings.statExercises")}
                </div>
              </div>
              <div>
                <div className="libre-coursesettings-stat-value">{stats.readings}</div>
                <div className="libre-coursesettings-stat-label">
                  {t("library.courseSettings.statReadings")}
                </div>
              </div>
            </div>
          </section>

          {/* Course details — title / author / release-status. All three
              flow through one Save button so the round-trip to the
              course.json on disk is a single load → mutate → save →
              refresh. The button is disabled until something actually
              changes so accidental edits don't trigger a write. */}
          {onChangeMetadata && (
            <section>
              <div className="libre-coursesettings-section">
                {t("library.courseSettings.detailsSection")}
              </div>
              <div className="libre-coursesettings-row libre-coursesettings-row--column">
                <div className="libre-coursesettings-row-text">
                  <div className="libre-coursesettings-row-label">
                    {t("library.courseSettings.detailsLabel")}
                  </div>
                  <div className="libre-coursesettings-row-hint">
                    {t("library.courseSettings.detailsSectionHint")}
                  </div>
                </div>
                <div className="libre-coursesettings-meta-fields">
                  <label className="libre-coursesettings-meta-field">
                    <span className="libre-coursesettings-meta-field-label">
                      {t("library.courseSettings.fieldTitle")}
                    </span>
                    <input
                      type="text"
                      className="libre-coursesettings-meta-input"
                      value={pendingTitle}
                      onChange={(e) => setPendingTitle(e.target.value)}
                      disabled={savingMetadata}
                      placeholder={t("library.courseSettings.fieldTitlePlaceholder")}
                      aria-label={t("library.courseSettings.fieldTitlePlaceholder")}
                    />
                  </label>
                  <label className="libre-coursesettings-meta-field">
                    <span className="libre-coursesettings-meta-field-label">
                      {t("library.courseSettings.fieldAuthor")}
                    </span>
                    <input
                      type="text"
                      className="libre-coursesettings-meta-input"
                      value={pendingAuthor}
                      onChange={(e) => setPendingAuthor(e.target.value)}
                      disabled={savingMetadata}
                      placeholder={t("library.courseSettings.fieldAuthorPlaceholder")}
                      aria-label={t("library.courseSettings.fieldAuthorAria")}
                    />
                  </label>
                  <label className="libre-coursesettings-meta-field">
                    <span className="libre-coursesettings-meta-field-label">
                      {t("library.courseSettings.fieldReleaseStatus")}
                    </span>
                    <select
                      className="libre-coursesettings-meta-input"
                      value={pendingReleaseStatus}
                      onChange={(e) =>
                        setPendingReleaseStatus(e.target.value as ReleaseStatus)
                      }
                      disabled={savingMetadata}
                      aria-label={t("library.courseSettings.fieldReleaseStatus")}
                    >
                      {RELEASE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {metadataError && (
                  <div className="libre-coursesettings-row-error">
                    {metadataError}
                  </div>
                )}
                <div className="libre-coursesettings-meta-actions">
                  {metadataSaved && !metadataDirty && (
                    <span
                      className="libre-coursesettings-meta-saved"
                      role="status"
                    >
                      {t("settings.savedLabel")}
                    </span>
                  )}
                  <button
                    type="button"
                    className="libre-coursesettings-btn libre-coursesettings-btn--primary"
                    onClick={commitMetadataChange}
                    disabled={!metadataDirty || !titleValid || savingMetadata}
                  >
                    {savingMetadata ? t("settings.saving") : t("settings.save")}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="libre-coursesettings-section">
              {t("library.courseSettings.regenerateSection")}
            </div>
            <div className="libre-coursesettings-row">
              <div className="libre-coursesettings-row-text">
                <div className="libre-coursesettings-row-label">
                  {t("library.courseSettings.regenerateLabel")}
                </div>
                <div className="libre-coursesettings-row-hint">
                  {t("library.courseSettings.regenerateSectionHint", {
                    count: stats.exercises,
                  })}
                </div>
              </div>
              <button
                className="libre-coursesettings-btn libre-coursesettings-btn--primary"
                onClick={() => {
                  onRegenerateExercises();
                  onDismiss();
                }}
                disabled={stats.exercises === 0}
              >
                {t("library.courseSettings.regenerate")}
              </button>
            </div>
          </section>

          {onChangeLanguage && (
            <section>
              <div className="libre-coursesettings-section">
                {t("library.courseSettings.languageSection")}
              </div>
              <div className="libre-coursesettings-row">
                <div className="libre-coursesettings-row-text">
                  <div className="libre-coursesettings-row-label">
                    {t("library.courseSettings.languageLabel")}
                  </div>
                  <div className="libre-coursesettings-row-hint">
                    {t("library.courseSettings.languageSectionHint", {
                      language: labelFor(course.language),
                    })}
                  </div>
                  {languageError && (
                    <div className="libre-coursesettings-row-error">
                      {languageError}
                    </div>
                  )}
                </div>
                <div className="libre-coursesettings-lang-controls">
                  <select
                    className="libre-coursesettings-lang-select"
                    value={pendingLanguage}
                    onChange={(e) =>
                      setPendingLanguage(e.target.value as LanguageId)
                    }
                    disabled={savingLanguage}
                    aria-label={t("library.courseSettings.languageSection")}
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="libre-coursesettings-btn libre-coursesettings-btn--primary"
                    onClick={commitLanguageChange}
                    disabled={
                      savingLanguage || pendingLanguage === course.language
                    }
                  >
                    {savingLanguage ? t("settings.saving") : t("settings.save")}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="libre-coursesettings-section">
              {t("library.courseSettings.enrichSection")}
            </div>
            <div className="libre-coursesettings-row">
              <div className="libre-coursesettings-row-text">
                <div className="libre-coursesettings-row-label">
                  {t("library.courseSettings.enrichLabel")}
                </div>
                <div className="libre-coursesettings-row-hint">
                  {t(
                    enrichRemaining === 1
                      ? "library.courseSettings.enrichSectionHint"
                      : "library.courseSettings.enrichSectionHintPlural",
                    { count: enrichRemaining },
                  )}
                  {stats.enriched > 0 && (
                    <>
                      {" "}
                      {t("library.courseSettings.alreadyEnriched", {
                        count: stats.enriched,
                        total: stats.enrichable,
                      })}
                    </>
                  )}
                </div>
              </div>
              <button
                className="libre-coursesettings-btn libre-coursesettings-btn--primary"
                onClick={() => {
                  onEnrichLessons();
                  onDismiss();
                }}
                disabled={enrichRemaining === 0}
              >
                {enrichRemaining === 0
                  ? t("library.courseSettings.allEnriched")
                  : t("library.courseSettings.enrich")}
              </button>
            </div>
          </section>

          {onCoverRefreshed && (
            <section>
              <div className="libre-coursesettings-section">
                {t("library.courseSettings.appearanceSection")}
              </div>
              <div className="libre-coursesettings-row">
                <div className="libre-coursesettings-row-text">
                  <div className="libre-coursesettings-row-label">
                    {t("library.courseSettings.fetchCover")}
                  </div>
                  <div className="libre-coursesettings-row-hint">
                    {t("library.courseSettings.fetchCoverHint")}
                  </div>
                </div>
                <button
                  className="libre-coursesettings-btn"
                  onClick={fetchCoverFromPdf}
                  disabled={coverFetching || coverGenerating}
                  type="button"
                >
                  {coverFetching
                    ? t("library.courseSettings.fetching")
                    : t("library.courseSettings.chooseBook")}
                </button>
              </div>
              <div className="libre-coursesettings-row">
                <div className="libre-coursesettings-row-text">
                  <div className="libre-coursesettings-row-label">
                    {t("library.courseSettings.importImage")}
                  </div>
                  <div className="libre-coursesettings-row-hint">
                    {t("library.courseSettings.importImageHint")}
                  </div>
                </div>
                <button
                  className="libre-coursesettings-btn"
                  onClick={importCoverImage}
                  disabled={coverFetching || coverGenerating}
                  type="button"
                >
                  {coverFetching
                    ? t("library.courseSettings.importing")
                    : t("library.courseSettings.chooseImage")}
                </button>
              </div>
              <div className="libre-coursesettings-row">
                <div className="libre-coursesettings-row-text">
                  <div className="libre-coursesettings-row-label">
                    {t("library.courseSettings.generateAi")}
                  </div>
                  <div className="libre-coursesettings-row-hint">
                    {t("library.courseSettings.generateAiHint")}
                  </div>
                </div>
                <button
                  className="libre-coursesettings-btn libre-coursesettings-btn--primary"
                  onClick={generateCoverWithAi}
                  disabled={coverFetching || coverGenerating}
                  type="button"
                >
                  {coverGenerating
                    ? t("library.courseSettings.generating")
                    : t("library.courseSettings.generate")}
                </button>
              </div>
              {coverError && (
                <div className="libre-coursesettings-row-error">
                  {coverError}
                </div>
              )}
            </section>
          )}

          <section>
            <div className="libre-coursesettings-section">
              {t("library.courseSettings.share")}
            </div>
            <div className="libre-coursesettings-row">
              <div className="libre-coursesettings-row-text">
                <div className="libre-coursesettings-row-label">
                  {t("library.courseSettings.copyShareLink")}
                </div>
                <div className="libre-coursesettings-row-hint">
                  {t("library.courseSettings.copyShareLinkHint")}
                </div>
              </div>
              <button
                className="libre-coursesettings-btn"
                onClick={() => {
                  void copyShareLink();
                }}
                aria-label={t("library.courseSettings.copyShareLinkAria")}
              >
                {shareCopied
                  ? t("library.courseSettings.copied")
                  : t("library.courseSettings.copyLink")}
              </button>
            </div>
            <div className="libre-coursesettings-row">
              <div className="libre-coursesettings-row-text">
                <div className="libre-coursesettings-row-label">
                  {t("library.courseSettings.exportAcademy")}
                </div>
                <div className="libre-coursesettings-row-hint">
                  {t("library.courseSettings.exportAcademyHint")}
                </div>
              </div>
              <button
                className="libre-coursesettings-btn"
                onClick={() => {
                  onExport();
                  onDismiss();
                }}
              >
                {t("library.courseSettings.export")}
              </button>
            </div>
          </section>

          <section>
            <div className="libre-coursesettings-section libre-coursesettings-section--danger">
              {t("library.courseSettings.dangerZone")}
            </div>
            <div className="libre-coursesettings-row">
              <div className="libre-coursesettings-row-text">
                <div className="libre-coursesettings-row-label">
                  {t("library.courseSettings.deleteCourse")}
                </div>
                <div className="libre-coursesettings-row-hint">
                  {t("library.courseSettings.deleteCourseHint")}
                </div>
              </div>
              <button
                className="libre-coursesettings-btn libre-coursesettings-btn--danger"
                onClick={() => {
                  onDelete();
                  onDismiss();
                }}
              >
                {t("library.courseSettings.delete")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/// Fall back to the raw id when the language isn't in the roster so we
/// never render `undefined` in the banner. A missing entry means the
/// LanguageId grew and we forgot to update `LANGUAGE_OPTIONS` — the
/// raw id tells the reader exactly what to add.
function labelFor(id: LanguageId): string {
  return LANGUAGE_OPTIONS.find((opt) => opt.id === id)?.label ?? id;
}
