/// "How this was built" — the Build Journal surface.
///
/// When the agent finishes building a project WITH the learner,
/// the build shouldn't vanish into a folder of files. This panel
/// turns the just-built sandbox into a navigable worked example:
/// what each file is for, which programming CONCEPTS the build
/// uses, and exactly which lessons in the learner's installed
/// courses teach each concept — with the ones they haven't learned
/// yet flagged as "new to you" and a one-click "Learn this" link.
///
/// The spine is computed (see `lib/ai/buildJournal.ts`), not
/// generated, so it ALWAYS appears even when the small local model
/// is too terse to narrate the build well. The model's own prose
/// answer renders above in the chat stream; this is the
/// deterministic teaching scaffold beside it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { graduationCap } from "@base/primitives/icon/icons/graduation-cap";
import { bookOpenText } from "@base/primitives/icon/icons/book-open-text";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import type { Course } from "@/data/types";
import type { ToolResult } from "@/lib/aiTools/types";
import { analyzeBuildState } from "@/lib/ai/buildState";
import {
  buildBuildJournal,
  type BuildJournal,
  type JournalFile,
} from "@/lib/ai/buildJournal";
import type { ConceptWithLessons } from "@/lib/ai/concepts";
import { loadProject, isSandboxFsUnavailable } from "@/lib/sandboxFs";
import { useT, type TFunction } from "@/i18n/i18n";

/// Loads the just-built project's files from disk and recomputes
/// the journal whenever the build progresses. Pure data in, journal
/// out — the host only has to render.
///
/// Loading is gated to: panel open, a real projectId, the build has
/// actually written files, and the agent is NOT mid-stream (we wait
/// for a quiet moment so we read settled file contents, not a
/// half-written file). On web (no Tauri) `loadProject` throws the
/// desktop-only sentinel; we swallow it and render nothing — the
/// whole agent-build flow is a desktop surface.
// Stable empty fallbacks. CRITICAL: these are module-level
// constants, not `?? []` / `new Set()` at the call site — a fresh
// `[]` or `new Set()` every render would change the effect's deps
// every render and spin an infinite re-render loop.
const EMPTY_COURSES: readonly Course[] = [];
const EMPTY_COMPLETED: ReadonlySet<string> = new Set<string>();

export function useBuildJournal(opts: {
  open: boolean;
  streaming: boolean;
  timeline: readonly ToolResult[];
  courses?: readonly Course[];
  completed?: ReadonlySet<string>;
  currentCourseId?: string;
}): { journal: BuildJournal | null; loading: boolean } {
  const { open, streaming, timeline, currentCourseId } = opts;
  // Normalise to stable references so the load effect's dep array
  // only changes when the data actually changes.
  const courses = opts.courses ?? EMPTY_COURSES;
  const completed = opts.completed ?? EMPTY_COMPLETED;

  const buildState = useMemo(() => analyzeBuildState(timeline), [timeline]);
  const projectId = buildState.projectId;
  // Only worth loading once at least one file has been written.
  const hasFiles =
    buildState.stage === "writing" ||
    buildState.stage === "ran-failed" ||
    buildState.stage === "complete";

  // A cheap signature of "how far the build has progressed" — the
  // count of write / patch / run results. When this changes (and
  // we're not streaming) we re-read the project so the journal
  // tracks the latest files without recomputing on every render.
  const buildSig = useMemo(() => {
    let n = 0;
    for (const t of timeline) {
      if (
        t.name === "write_sandbox_file" ||
        t.name === "apply_sandbox_patch" ||
        t.name === "run_sandbox_project"
      )
        n++;
    }
    return n;
  }, [timeline]);

  const [journal, setJournal] = useState<BuildJournal | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    // Clear when there's no project to describe (run reset, fresh
    // conversation) so a stale journal doesn't linger.
    if (!projectId || !hasFiles) {
      setJournal(null);
      return;
    }
    // Don't read mid-stream — wait for the agent to pause so we
    // load settled file contents.
    if (!open || streaming) return;

    const reqId = ++reqRef.current;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const project = await loadProject(projectId);
        if (cancelled || reqId !== reqRef.current) return;
        const next = buildBuildJournal({
          timeline,
          files: project.files.map((f) => ({
            path: f.name,
            content: f.content,
            language: f.language,
          })),
          courses,
          completed,
          currentCourseId,
          projectLanguage: project.language,
        });
        setJournal(next.hasContent ? next : null);
      } catch (e) {
        // Desktop-only sentinel on web — render nothing. Any other
        // load error (project deleted mid-run) also just clears.
        if (!isSandboxFsUnavailable(e)) {
          // Non-fatal: the journal is a "nice to have" surface.
          console.debug("build journal load failed", e);
        }
        if (!cancelled && reqId === reqRef.current) setJournal(null);
      } finally {
        if (!cancelled && reqId === reqRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `timeline` is intentionally not a dep — `buildSig` captures
    // the part of it we care about (write/run count) without
    // re-firing on every streamed token append.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    streaming,
    projectId,
    hasFiles,
    buildSig,
    courses,
    completed,
    currentCourseId,
  ]);

  return { journal, loading };
}

/// Open a lesson via the same in-window CustomEvent the AI's
/// libre:// link interception and the catalog use. App.tsx listens
/// and routes to the lesson reader.
function openLesson(courseId: string, lessonId: string) {
  window.dispatchEvent(
    new CustomEvent("libre:open-lesson", {
      detail: { courseId, lessonId },
    }),
  );
}

/// Map a journal file's canonical-English `purpose` to its
/// localized label. The engine keeps English (its tests +
/// `readingRank` key off the values); the panel owns translation.
function purposeLabel(t: TFunction, file: JournalFile): string {
  switch (file.purpose) {
    case "Styles":
      return t("ai.fileRoleStyles");
    case "Page shell":
      return t("ai.fileRolePageShell");
    case "Config":
      return t("ai.fileRoleConfig");
    case "Entry point":
      return t("ai.fileRoleEntryPoint");
    case "Component":
      return t("ai.fileRoleComponent");
    case "Logic module":
      return t("ai.fileRoleLogicModule");
    case "Tests":
      return t("ai.fileRoleTests");
    case "Source file":
      return t("ai.fileRoleSourceFallback");
    default:
      // "{Language} source" — rebuild from the file's language.
      return file.language
        ? t("ai.fileRoleSource", {
            language:
              file.language[0].toUpperCase() + file.language.slice(1),
          })
        : file.purpose;
  }
}

/// Difficulty dots (1–3). A tiny, language-neutral signal of how
/// deep a concept is so the learner can triage what to study first.
function DifficultyDots({ level }: { level: 1 | 2 | 3 }) {
  const t = useT();
  return (
    <span
      className="libre-bj-diff"
      aria-label={t("ai.bjDifficulty", { level })}
      title={t("ai.bjDifficultyShort", { level })}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={
            "libre-bj-diff-dot" + (i <= level ? " libre-bj-diff-dot--on" : "")
          }
        />
      ))}
    </span>
  );
}

function FileRow({ file }: { file: JournalFile }) {
  const t = useT();
  // Show at most three concept chips per file — enough to signal
  // "this file is where closures + iterators live" without turning
  // the row into a wall of tags.
  const chips = file.concepts.slice(0, 3);
  const extra = file.concepts.length - chips.length;
  return (
    <div className="libre-bj-file">
      <div className="libre-bj-file-head">
        <code className="libre-bj-file-path">{file.path}</code>
        <span className="libre-bj-file-purpose">{purposeLabel(t, file)}</span>
      </div>
      {chips.length > 0 && (
        <div className="libre-bj-file-chips">
          {chips.map((c) => (
            <span key={c.id} className="libre-bj-chip">
              {t(`practice.concepts.${c.id}.label`)}
            </span>
          ))}
          {extra > 0 && (
            <span className="libre-bj-chip libre-bj-chip--more">
              +{extra}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ConceptRow({ entry }: { entry: ConceptWithLessons }) {
  const t = useT();
  const { concept, learned, lessons } = entry;
  // Cap the lesson links — the first one or two are the strongest
  // matches from the retrieval scorer; more becomes noise.
  const links = lessons.slice(0, 2);
  return (
    <div
      className={
        "libre-bj-concept" + (learned ? "" : " libre-bj-concept--new")
      }
    >
      <div className="libre-bj-concept-head">
        <span className="libre-bj-concept-label">
          {t(`practice.concepts.${concept.id}.label`)}
        </span>
        {!learned && (
          <span className="libre-bj-new-tag">
            <Icon icon={sparkles} size="xs" color="currentColor" />
            {t("ai.bjNewToYou")}
          </span>
        )}
        <DifficultyDots level={concept.difficulty} />
      </div>
      <p className="libre-bj-concept-blurb">
        {t(`practice.concepts.${concept.id}.blurb`)}
      </p>
      {links.length > 0 ? (
        <div className="libre-bj-concept-links">
          {links.map((l) => (
            <button
              key={l.link}
              type="button"
              className="libre-bj-learn"
              onClick={() => openLesson(l.courseId, l.lessonId)}
              title={t("ai.bjOpenLessonTitle", {
                lesson: l.lessonTitle,
                course: l.courseTitle,
              })}
            >
              <Icon icon={bookOpenText} size="xs" color="currentColor" />
              <span className="libre-bj-learn-text">{l.lessonTitle}</span>
              <Icon icon={arrowRight} size="xs" color="currentColor" />
            </button>
          ))}
        </div>
      ) : (
        <div className="libre-bj-concept-nolesson">
          {t("ai.bjNoLesson")}
        </div>
      )}
    </div>
  );
}

/// The collapsible "How this was built" panel. Mounts beneath the
/// console when the agent has built something teachable.
export function BuildJournalPanel({
  journal,
  onClose,
}: {
  journal: BuildJournal;
  onClose: () => void;
}) {
  // Concepts are pre-sorted unlearned-first by
  // `analyzeConceptCoverage`; surface the new-to-you ones up top so
  // the learning path leads with what to study next.
  const t = useT();
  const newCount = journal.newToYou.length;
  return (
    <div className="libre-bj" role="region" aria-label={t("ai.bjTitle")}>
      <div className="libre-bj-head">
        <Icon icon={graduationCap} size="sm" color="currentColor" />
        <span className="libre-bj-title">{t("ai.bjTitle")}</span>
        <span className="libre-bj-meta">
          {t(
            journal.files.length === 1 ? "ai.bjMetaFiles" : "ai.bjMetaFilesPlural",
            { files: journal.files.length },
          )}{" "}
          ·{" "}
          {t(
            journal.concepts.length === 1
              ? "ai.bjMetaConcepts"
              : "ai.bjMetaConceptsPlural",
            { concepts: journal.concepts.length },
          )}
          {newCount > 0 ? ` · ${t("ai.bjMetaNew", { newCount })}` : ""}
        </span>
        <button
          type="button"
          className="libre-ai-panel-preview-close"
          onClick={onClose}
          aria-label={t("ai.bjHide")}
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>

      <div className="libre-bj-body">
        <div className="libre-bj-section-label">{t("ai.bjFilesLabel")}</div>
        <div className="libre-bj-files">
          {journal.files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </div>

        <div className="libre-bj-section-label">
          {t("ai.bjTeachesLabel")}
          {newCount > 0 && (
            <span className="libre-bj-section-hint">
              {t(
                newCount === 1 ? "ai.bjNewConcepts" : "ai.bjNewConceptsPlural",
                { newCount },
              )}
            </span>
          )}
        </div>
        <div className="libre-bj-concepts">
          {journal.concepts.map((c) => (
            <ConceptRow key={c.concept.id} entry={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
