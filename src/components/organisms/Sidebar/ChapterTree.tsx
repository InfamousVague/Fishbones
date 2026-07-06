import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import "@base/primitives/icon/icon.css";
import type { Chapter, Lesson } from "@/data/types";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { ProgressRing } from "@/components/atoms/ProgressRing/ProgressRing";
import { iconForKind } from "./labels";
import { useT } from "@/i18n/i18n";

/// Section separator used by importer scripts that want their chapter
/// titles auto-grouped in the sidebar — e.g. the Svelte tutorial emits
/// `Basic Svelte · Introduction`, `Basic Svelte · Reactivity`,
/// `Advanced Svelte · Snippets`, etc. Consecutive chapters that share
/// the same prefix collapse into one disclosure-toggle section.
///
/// Importers that don't use the separator just get the existing flat
/// `Chapter → Lesson` tree — no migration needed.
const SECTION_SEPARATOR = " · ";

/// One node in the chapter-level tree. Either a single un-grouped
/// chapter (the legacy course shape — most courses look like this) or
/// a section containing 1+ chapters that all share the same "X · "
/// prefix. The section variant carries a `displayTitle` per chapter
/// (the suffix after the separator) so the nested ChapterBlock doesn't
/// repeat the section label inside its own header.
type ChapterTreeNode =
  | { kind: "flat"; chapter: Chapter }
  | {
      kind: "section";
      label: string;
      entries: { chapter: Chapter; displayTitle: string }[];
    };

/// Walk a course's chapter list and merge consecutive `X · Y` titles
/// into sections. Order is preserved — we never reorder chapters, just
/// group adjacent ones. Anything without the separator (or with a
/// different prefix from its neighbours) stays as a flat node.
function groupChaptersBySection(chapters: Chapter[]): ChapterTreeNode[] {
  const nodes: ChapterTreeNode[] = [];
  let current: { label: string; entries: { chapter: Chapter; displayTitle: string }[] } | null =
    null;

  const flushSection = () => {
    if (current) {
      nodes.push({ kind: "section", label: current.label, entries: current.entries });
      current = null;
    }
  };

  for (const chapter of chapters) {
    const idx = chapter.title.indexOf(SECTION_SEPARATOR);
    if (idx === -1) {
      // No separator → flat node. Close any open section first so
      // we don't accidentally fold this chapter into the previous
      // group.
      flushSection();
      nodes.push({ kind: "flat", chapter });
      continue;
    }
    const label = chapter.title.slice(0, idx);
    const displayTitle = chapter.title.slice(idx + SECTION_SEPARATOR.length);
    if (current && current.label === label) {
      current.entries.push({ chapter, displayTitle });
    } else {
      flushSection();
      current = { label, entries: [{ chapter, displayTitle }] };
    }
  }
  flushSection();
  return nodes;
}

/// Renders a course's chapters with optional section grouping. Used by
/// both the active and the compact (inactive) course branches so the
/// disclosure tree looks identical regardless of which card the user
/// is interacting with. When a course has zero chapters with the
/// `X · Y` separator (the common case for PDF-imported books) this
/// degrades to a plain list of ChapterBlocks — visually indistinct
/// from the pre-grouping behaviour.
export default function ChapterTree({
  chapters,
  courseId,
  activeLessonId,
  completed,
  onSelectLesson,
  onChapterContextMenu,
  onLessonContextMenu,
}: {
  chapters: Chapter[];
  courseId: string;
  activeLessonId?: string;
  completed: Set<string>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  onChapterContextMenu?: (chapter: Chapter, e: React.MouseEvent) => void;
  onLessonContextMenu?: (
    lesson: Lesson,
    isCompleted: boolean,
    e: React.MouseEvent,
  ) => void;
}) {
  const tree = useMemo(() => groupChaptersBySection(chapters), [chapters]);

  return (
    <>
      {tree.map((node, i) => {
        if (node.kind === "flat") {
          return (
            <ChapterBlock
              // Several imported books (e.g. Select Star SQL) ship
              // chapters without ids despite the Chapter type claiming
              // `id: string` — `key={undefined}` counts as keyless to
              // React. Chapters never reorder within a course, so the
              // index fallback is stable.
              key={node.chapter.id ?? `${courseId}:chapter:${i}`}
              chapter={node.chapter}
              courseId={courseId}
              activeLessonId={activeLessonId}
              completed={completed}
              onSelectLesson={onSelectLesson}
              onChapterContextMenu={onChapterContextMenu}
              onLessonContextMenu={onLessonContextMenu}
            />
          );
        }
        return (
          <SectionGroup
            // Index in the key because two sections sharing a label
            // can theoretically appear if a course interleaves
            // groups (e.g. Basic … Advanced … Basic). Real courses
            // don't, but indexing the key removes the foot-gun.
            key={`${courseId}:section:${i}:${node.label}`}
            label={node.label}
            entries={node.entries}
            courseId={courseId}
            activeLessonId={activeLessonId}
            completed={completed}
            onSelectLesson={onSelectLesson}
            onChapterContextMenu={onChapterContextMenu}
            onLessonContextMenu={onLessonContextMenu}
          />
        );
      })}
    </>
  );
}

/// Disclosure-toggle wrapper around a contiguous run of chapters that
/// share an `X · ` prefix. Header reads the section label (e.g. "Basic
/// Svelte"); body renders nested ChapterBlocks with their suffix-only
/// `displayTitle` so the same word doesn't repeat in every chapter row.
///
/// Open state persists in localStorage keyed by `(courseId, label)` so
/// a user who expands "Advanced Svelte" once doesn't have to re-expand
/// it next session. Sections that contain the active lesson auto-open
/// regardless of the stored value — the user is working there, the
/// path to their lesson should be visible.
function SectionGroup({
  label,
  entries,
  courseId,
  activeLessonId,
  completed,
  onSelectLesson,
  onChapterContextMenu,
  onLessonContextMenu,
}: {
  label: string;
  entries: { chapter: Chapter; displayTitle: string }[];
  courseId: string;
  activeLessonId?: string;
  completed: Set<string>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  onChapterContextMenu?: (chapter: Chapter, e: React.MouseEvent) => void;
  onLessonContextMenu?: (
    lesson: Lesson,
    isCompleted: boolean,
    e: React.MouseEvent,
  ) => void;
}) {
  const t = useT();
  const containsActiveLesson = activeLessonId
    ? entries.some(({ chapter }) =>
        chapter.lessons.some((l) => l.id === activeLessonId),
      )
    : false;

  const storageKey = `libre:section-open:${courseId}:${label}`;
  // The whole point of the grouping is to fold a 30-chapter outline
  // into a few digestible rows; default closed.
  const [open, setOpen] = useLocalStorageState<boolean>(storageKey, false, {
    serialize: (v) => (v ? "1" : "0"),
    deserialize: (raw) => raw === "1",
  });

  // Auto-sync the section's open state to whether it contains the
  // active lesson. Two effects in one:
  //   - Expand when the learner navigates INTO a chapter in this
  //     section (was previously the only direction handled).
  //   - Collapse when the learner navigates OUT of this section to
  //     a different one — keeps the tree focused on where they are
  //     instead of accumulating expanded sections as they roam.
  // The setter writes through to localStorage, so the closed
  // state survives a refresh too. Manual toggles via the header
  // button still work between navigations — the next nav just
  // resyncs to the canonical "is this where the learner is?"
  // truth.
  useEffect(() => {
    setOpen(containsActiveLesson);
  }, [containsActiveLesson, setOpen]);

  const toggle = () => setOpen((prev) => !prev);

  // Aggregate completion across every chapter in the group so the
  // header ring reads as a single "X / Y" the same way a chapter
  // header does — gives the learner one-glance progress for the
  // whole section.
  let totalLessons = 0;
  let doneLessons = 0;
  for (const { chapter } of entries) {
    for (const lesson of chapter.lessons) {
      totalLessons += 1;
      if (completed.has(`${courseId}:${lesson.id}`)) doneLessons += 1;
    }
  }
  const pct = totalLessons > 0 ? doneLessons / totalLessons : 0;

  return (
    <div
      className={`libre__section ${
        open ? "libre__section--open" : "libre__section--closed"
      }`}
    >
      <button
        type="button"
        className="libre__section-title"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="libre__section-caret" aria-hidden>
          <Icon
            icon={open ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        <span className="libre__section-title-text">{label}</span>
        <span
          className="libre__section-ring"
          title={t("sidebar.lessonsCompleteTitle", {
            done: doneLessons,
            total: totalLessons,
          })}
        >
          <ProgressRing progress={pct} size={16} stroke={2} label="" />
        </span>
      </button>
      {open && (
        <div className="libre__section-children">
          {entries.map(({ chapter, displayTitle }, i) => (
            <ChapterBlock
              // Same id-less-chapter fallback as the flat branch above.
              key={chapter.id ?? `${courseId}:${label}:${i}`}
              chapter={chapter}
              displayTitle={displayTitle}
              courseId={courseId}
              activeLessonId={activeLessonId}
              completed={completed}
              onSelectLesson={onSelectLesson}
              onChapterContextMenu={onChapterContextMenu}
              onLessonContextMenu={onLessonContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChapterBlock({
  chapter,
  displayTitle,
  courseId,
  activeLessonId,
  completed,
  onSelectLesson,
  onChapterContextMenu,
  onLessonContextMenu,
}: {
  chapter: Chapter;
  /// Override for the title text. Set by SectionGroup so chapters
  /// nested inside a "Basic Svelte" group show only the suffix
  /// ("Introduction") rather than repeating "Basic Svelte · " in
  /// every row. Falls back to `chapter.title` for the flat / legacy
  /// case where there's no enclosing section.
  displayTitle?: string;
  courseId: string;
  activeLessonId?: string;
  completed: Set<string>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  onChapterContextMenu?: (chapter: Chapter, e: React.MouseEvent) => void;
  onLessonContextMenu?: (
    lesson: Lesson,
    isCompleted: boolean,
    e: React.MouseEvent,
  ) => void;
}) {
  const t = useT();
  const done = chapter.lessons.filter((l) => completed.has(`${courseId}:${l.id}`)).length;
  const total = chapter.lessons.length;
  const pct = total > 0 ? done / total : 0;

  // A chapter is open exactly when it contains the currently-active
  // lesson. Auto-syncs on every navigation so:
  //   - Moving INTO a chapter expands it (so the active lesson row
  //     is visible without an extra click)
  //   - Moving OUT of a chapter collapses it (so the tree stays
  //     focused on where the learner is, not where they've been)
  // Manual toggles between navigations still work — the useEffect
  // below only fires when `containsActiveLesson` actually changes
  // (i.e. on real navigation events).
  const containsActiveLesson = activeLessonId
    ? chapter.lessons.some((l) => l.id === activeLessonId)
    : false;
  const [open, setOpen] = useState(containsActiveLesson);
  useEffect(() => {
    setOpen(containsActiveLesson);
  }, [containsActiveLesson]);

  return (
    <div
      className={`libre__chapter ${
        open ? "libre__chapter--open" : "libre__chapter--closed"
      }`}
    >
      <button
        type="button"
        className="libre__chapter-title"
        onClick={() => setOpen(!open)}
        onContextMenu={
          onChapterContextMenu
            ? (e) => onChapterContextMenu(chapter, e)
            : undefined
        }
        aria-expanded={open}
      >
        <span className="libre__chapter-caret" aria-hidden>
          <Icon
            icon={open ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        <span className="libre__chapter-title-text">
          {displayTitle ?? chapter.title}
        </span>
        <span
          className="libre__chapter-ring"
          title={t("sidebar.lessonsCompleteTitle", { done, total })}
        >
          <ProgressRing progress={pct} size={16} stroke={2} label="" />
        </span>
      </button>
      {open && (
        <div className="libre__chapter-lessons">
          {chapter.lessons.map((lesson) => {
            const isCompleted = completed.has(`${courseId}:${lesson.id}`);
            return (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                isCompleted={isCompleted}
                isActive={lesson.id === activeLessonId}
                onSelect={() => onSelectLesson(courseId, lesson.id)}
                onContextMenu={
                  onLessonContextMenu
                    ? (e) => onLessonContextMenu(lesson, isCompleted, e)
                    : undefined
                }
                difficulty={
                  lesson.kind === "exercise" || lesson.kind === "mixed"
                    ? lesson.difficulty
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function LessonRow({
  lesson,
  isCompleted,
  isActive,
  onSelect,
  onContextMenu,
  difficulty,
}: {
  lesson: Lesson;
  isCompleted: boolean;
  isActive: boolean;
  onSelect: () => void;
  /// Right-click handler. Optional so callers that don't care (no reset
  /// support wired up) get the original behaviour with no menu.
  onContextMenu?: (e: React.MouseEvent) => void;
  /// Only present for challenge-pack exercise rows. Drives a colored dot
  /// (easy → green, medium → amber, hard → red) that replaces the default
  /// kind-based accent so a pack reads as ramp-up, not as ordered lessons.
  difficulty?: "easy" | "medium" | "hard";
}) {
  return (
    <button
      className={`libre__nav-item libre__lesson-item libre__lesson-item--${lesson.kind} ${
        isActive ? "libre__nav-item--active" : ""
      }`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <LessonStatusIcon
        kind={lesson.kind}
        completed={isCompleted}
        active={isActive}
        difficulty={difficulty}
      />
      <span className="libre__lesson-name">{lesson.title}</span>
    </button>
  );
}

/// Single icon slot to the left of the lesson title. The same kind-glyph
/// (book / code / help-circle) is rendered across every state — only the
/// circle around it changes:
///   - pending: hollow ring, icon is a barely-visible dim gray
///   - active: hollow ring brightened, icon slightly more visible + halo
///   - done:  filled white circle with a black icon inside (inverted)
/// Keeping the glyph persistent means a completed lesson still advertises
/// what it was (reading vs exercise vs quiz), just styled differently.
///
/// When `difficulty` is set (challenge-pack lessons), we ALSO add a
/// `--diff-*` modifier so CSS can tint the pending/active ring to the
/// difficulty color (green/amber/red). Completed state still inverts to
/// the filled white disc — once you've solved it, difficulty is history.
function LessonStatusIcon({
  kind,
  completed,
  active,
  difficulty,
}: {
  kind: Lesson["kind"];
  completed: boolean;
  active: boolean;
  difficulty?: "easy" | "medium" | "hard";
}) {
  const state = completed ? "done" : active ? "active" : "pending";
  const diffClass = difficulty ? ` libre__lesson-status--diff-${difficulty}` : "";
  return (
    <span
      className={`libre__lesson-status libre__lesson-status--${state} libre__lesson-status--${kind}${diffClass}`}
      aria-hidden
    >
      <Icon icon={iconForKind(kind)} size="xs" color="currentColor" />
    </span>
  );
}
