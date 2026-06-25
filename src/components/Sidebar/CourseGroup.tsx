import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import "@base/primitives/icon/icon.css";
import type { Course, Chapter, Lesson } from "../../data/types";
import {
  isChallengePack,
  isExerciseTrack,
  isKoans,
  isLings,
} from "../../data/types";
import LanguageChip from "../LanguageChip/LanguageChip";
import { languageMeta } from "../../lib/languages";
import { ProgressRing } from "../Shared/ProgressRing";
import ChapterTree from "./ChapterTree";
import ChapterGrid from "./ChapterGrid";
import MiniCertBanner from "./MiniCertBanner";
import { useSidebarVariant } from "./variants/useSidebarVariant";
import { useT } from "../../i18n/i18n";

/// Challenge packs / Exercism tracks / koans / *lings — the practice
/// surfaces that ship square illustrated cover art rather than reading
/// as long-form books.
function isPracticePack(course: Course): boolean {
  return (
    isChallengePack(course) ||
    isExerciseTrack(course) ||
    isKoans(course) ||
    isLings(course)
  );
}

/// Sidebar row icon for a practice pack: the programming-language glyph
/// (a language chip), NOT the pack's cover art. Keeps the rail a tidy
/// column of language icons; the illustrated cover stays on the Library
/// shelf where it has room to read. No cover fetch for packs either now.
function PackCoverIcon({ course }: { course: Course }): React.ReactElement {
  return <LanguageChip language={course.language} size="xs" iconOnly />;
}

export default function CourseGroup({
  course,
  isActiveCourse,
  activeLessonId,
  completed,
  onSelectLesson,
  onContextMenu,
  onChapterContextMenu,
  onLessonContextMenu,
  onCertificates,
}: {
  course: Course;
  isActiveCourse: boolean;
  activeLessonId?: string;
  completed: Set<string>;
  onSelectLesson: (courseId: string, lessonId: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /// Right-click on a chapter row. CourseGroup just forwards to the
  /// sidebar parent which owns the menu state.
  onChapterContextMenu?: (chapter: Chapter, e: React.MouseEvent) => void;
  /// Right-click on a lesson row. The `isCompleted` flag lets the parent
  /// decide whether to show a menu at all (V1: only for completed lessons).
  onLessonContextMenu?: (
    lesson: Lesson,
    isCompleted: boolean,
    e: React.MouseEvent,
  ) => void;
  /// Forwarded to MiniCertBanner — clicking the banner switches the
  /// main view to the certificates page. Optional; without it the
  /// banner is non-interactive.
  onCertificates?: () => void;
}) {
  const t = useT();
  // The active course is always expanded — the learner is working inside
  // it and needs its tree visible. Inactive courses default collapsed;
  // clicking the row expands them inline so the learner can peek
  // without switching focus.
  const [expanded, setExpanded] = useState(isActiveCourse);

  // Sidebar layout choice (Settings → Theme → "Sidebar layout").
  // Only affects rendering of the ACTIVE course's chapter list —
  // inactive courses (peeked-into via the row chevron) always use
  // ChapterTree because the grid format only makes sense for the
  // course the learner is actively working through. The choice
  // lives in localStorage and is reactively read here, so flipping
  // the radio in Settings instantly re-renders this card.
  const [sidebarVariant] = useSidebarVariant();

  const totalLessons = course.chapters.reduce((n, ch) => n + ch.lessons.length, 0);
  const doneLessons = course.chapters.reduce(
    (n, ch) => n + ch.lessons.filter((l) => completed.has(`${course.id}:${l.id}`)).length,
    0
  );
  const pct = totalLessons > 0 ? doneLessons / totalLessons : 0;

  // Active course: mini certificate banner at the top (preview of
  // the artefact the learner is working toward), then the chapter
  // tree below. The previous treatment was a generic "course
  // header card" with a progress ring; the cert-style banner gives
  // the same progress signal but frames the learner's session as
  // "you're working on the cert" rather than "you're in a course",
  // which matches the way the certificates page treats completed
  // courses. Auto-collapse logic in ChapterBlock / SectionGroup
  // already keeps the tree focused on the active lesson — no
  // changes here. The right-click context menu (export / delete /
  // settings / reset) hangs off the banner now since the old
  // course-header card is gone; behaviour is identical.
  if (isActiveCourse) {
    return (
      <div
        className="libre__course libre__course--active"
        onContextMenu={onContextMenu}
      >
        <MiniCertBanner
          course={course}
          doneLessons={doneLessons}
          totalLessons={totalLessons}
          onClick={onCertificates}
          completed={completed}
        />
        <div
          className="libre__course-body"
          // Scope the course-accent var to THIS course's language brand colour so
          // its chapter/section completion rings + bars match it — otherwise they
          // inherit the globally-active course's accent (e.g. a Rust tab tints an
          // expanded TypeScript course's rings red). Only affects elements that
          // read var(--gg-course-accent) (rings/bars), not the text colour.
          style={{
            ["--gg-course-accent" as string]: languageMeta(course.language).color,
          }}
        >
          {sidebarVariant === "grid" ? (
            <ChapterGrid
              chapters={course.chapters}
              courseId={course.id}
              activeLessonId={activeLessonId}
              completed={completed}
              onSelectLesson={onSelectLesson}
              onChapterContextMenu={onChapterContextMenu}
              onLessonContextMenu={onLessonContextMenu}
            />
          ) : (
            <ChapterTree
              chapters={course.chapters}
              courseId={course.id}
              activeLessonId={activeLessonId}
              completed={completed}
              onSelectLesson={onSelectLesson}
              onChapterContextMenu={onChapterContextMenu}
              onLessonContextMenu={onLessonContextMenu}
            />
          )}
        </div>
      </div>
    );
  }

  // Inactive course: compact single-line row that matches the top nav
  // item pattern (caret + chip + label + tiny ring). Clicking the row
  // expands inline so the learner can peek at the chapter list without
  // changing focus — selecting a lesson inside still promotes it to
  // active via `onSelectLesson`, at which point the next render treats
  // it as active and shows the full card. The ring replaces the bare
  // "x/y" text so progress reads as a glance-able visual.
  return (
    <div className="libre__course libre__course--compact">
      <button
        className="libre__course-row"
        onClick={() => setExpanded(!expanded)}
        onContextMenu={onContextMenu}
      >
        <span className="libre__course-row-caret" aria-hidden>
          <Icon
            icon={expanded ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        {isPracticePack(course) ? (
          <PackCoverIcon course={course} />
        ) : (
          <LanguageChip language={course.language} size="xs" iconOnly />
        )}
        <span className="libre__course-name">{course.title}</span>
        <span
          className="libre__course-row-ring"
          title={t("sidebar.lessonsCompleteTitle", { done: doneLessons, total: totalLessons })}
        >
          <ProgressRing
            progress={pct}
            size={18}
            stroke={2}
            label=""
            color={languageMeta(course.language).color}
          />
        </span>
      </button>

      {expanded && (
        <div
          className="libre__course-body"
          // Scope the course-accent var to THIS course's language brand colour so
          // its chapter/section completion rings + bars match it — otherwise they
          // inherit the globally-active course's accent (e.g. a Rust tab tints an
          // expanded TypeScript course's rings red). Only affects elements that
          // read var(--gg-course-accent) (rings/bars), not the text colour.
          style={{
            ["--gg-course-accent" as string]: languageMeta(course.language).color,
          }}
        >
          {/* Same disclosure tree as the active branch — section
              grouping needs to behave identically whether the user is
              peeking at an in-progress course or working in the
              current one. ChapterTree degrades to a plain chapter
              list for courses without `X · Y` titles, so this is
              safe for legacy / PDF-imported books too. */}
          <ChapterTree
            chapters={course.chapters}
            courseId={course.id}
            activeLessonId={undefined}
            completed={completed}
            onSelectLesson={onSelectLesson}
            onChapterContextMenu={onChapterContextMenu}
            onLessonContextMenu={onLessonContextMenu}
          />
        </div>
      )}
    </div>
  );
}
