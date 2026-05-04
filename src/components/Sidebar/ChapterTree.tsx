import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import "@base/primitives/icon/icon.css";
import type { Chapter, Lesson } from "../../data/types";
import { useLocalStorageState } from "../../hooks/useLocalStorageState";
import { ProgressRing } from "../Shared/ProgressRing";
import { iconForKind } from "./labels";

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
              key={node.chapter.id}
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
  const containsActiveLesson = activeLessonId
    ? entries.some(({ chapter }) =>
        chapter.lessons.some((l) => l.id === activeLessonId),
      )
    : false;

  const storageKey = `fishbones:section-open:${courseId}:${label}`;
  // The whole point of the grouping is to fold a 30-chapter outline
  // into a few digestible rows; default closed.
  const [open, setOpen] = useLocalStorageState<boolean>(storageKey, false, {
    serialize: (v) => (v ? "1" : "0"),
    deserialize: (raw) => raw === "1",
  });

  // If the user navigates to a lesson inside this section AFTER the
  // group rendered closed, force it open so the active row is
  // reachable without an extra click. The setter writes through to
  // localStorage — minor, but keeps "I'm here, leave it open" sticky
  // for next session too.
  useEffect(() => {
    if (containsActiveLesson) setOpen(true);
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
      className={`fishbones__section ${
        open ? "fishbones__section--open" : "fishbones__section--closed"
      }`}
    >
      <button
        type="button"
        className="fishbones__section-title"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="fishbones__section-caret" aria-hidden>
          <Icon
            icon={open ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        <span className="fishbones__section-title-text">{label}</span>
        <span
          className="fishbones__section-ring"
          title={`${doneLessons}/${totalLessons} lessons complete`}
        >
          <ProgressRing progress={pct} size={16} stroke={2} label="" />
        </span>
      </button>
      {open && (
        <div className="fishbones__section-children">
          {entries.map(({ chapter, displayTitle }) => (
            <ChapterBlock
              key={chapter.id}
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
  const done = chapter.lessons.filter((l) => completed.has(`${courseId}:${l.id}`)).length;
  const total = chapter.lessons.length;
  const pct = total > 0 ? done / total : 0;

  // A chapter is open by default if it contains the currently-active
  // lesson — that's the one the learner is working in, so the lesson
  // tree should be visible without an extra click. Other chapters stay
  // collapsed to their header row so the active card doesn't sprawl.
  // Once the user manually toggles a chapter open, it stays open for
  // the session (state is local).
  const containsActiveLesson = activeLessonId
    ? chapter.lessons.some((l) => l.id === activeLessonId)
    : false;
  const [open, setOpen] = useState(containsActiveLesson);

  return (
    <div
      className={`fishbones__chapter ${
        open ? "fishbones__chapter--open" : "fishbones__chapter--closed"
      }`}
    >
      <button
        type="button"
        className="fishbones__chapter-title"
        onClick={() => setOpen(!open)}
        onContextMenu={
          onChapterContextMenu
            ? (e) => onChapterContextMenu(chapter, e)
            : undefined
        }
        aria-expanded={open}
      >
        <span className="fishbones__chapter-caret" aria-hidden>
          <Icon
            icon={open ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        <span className="fishbones__chapter-title-text">
          {displayTitle ?? chapter.title}
        </span>
        <span
          className="fishbones__chapter-ring"
          title={`${done}/${total} lessons complete`}
        >
          <ProgressRing progress={pct} size={16} stroke={2} label="" />
        </span>
      </button>
      {open && (
        <div className="fishbones__chapter-lessons">
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
      className={`fishbones__nav-item fishbones__lesson-item fishbones__lesson-item--${lesson.kind} ${
        isActive ? "fishbones__nav-item--active" : ""
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
      <span className="fishbones__lesson-name">{lesson.title}</span>
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
  const diffClass = difficulty ? ` fishbones__lesson-status--diff-${difficulty}` : "";
  return (
    <span
      className={`fishbones__lesson-status fishbones__lesson-status--${state} fishbones__lesson-status--${kind}${diffClass}`}
      aria-hidden
    >
      <Icon icon={iconForKind(kind)} size="xs" color="currentColor" />
    </span>
  );
}
