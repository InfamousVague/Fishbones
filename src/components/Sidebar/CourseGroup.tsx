import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import "@base/primitives/icon/icon.css";
import type { Course, Chapter, Lesson } from "../../data/types";
import LanguageChip from "../LanguageChip/LanguageChip";
import { ProgressRing } from "../Shared/ProgressRing";
import ChapterTree from "./ChapterTree";

export default function CourseGroup({
  course,
  isActiveCourse,
  activeLessonId,
  completed,
  onSelectLesson,
  onContextMenu,
  onChapterContextMenu,
  onLessonContextMenu,
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
}) {
  // The active course is always expanded — the learner is working inside
  // it and needs its tree visible. Inactive courses default collapsed;
  // clicking the row expands them inline so the learner can peek
  // without switching focus.
  const [expanded, setExpanded] = useState(isActiveCourse);

  const totalLessons = course.chapters.reduce((n, ch) => n + ch.lessons.length, 0);
  const doneLessons = course.chapters.reduce(
    (n, ch) => n + ch.lessons.filter((l) => completed.has(`${course.id}:${l.id}`)).length,
    0
  );
  const pct = totalLessons > 0 ? doneLessons / totalLessons : 0;

  // Active course: full card with circular progress ring, always
  // expanded. The elevated surface + ring treatment advertises "this is
  // the course you're in" unambiguously. Inside, only the chapter that
  // contains the active lesson is open by default — other chapters are
  // collapsed to their header row so the tree doesn't dominate.
  if (isActiveCourse) {
    return (
      <div className="fishbones__course fishbones__course--active">
        <div
          className="fishbones__course-card fishbones__course-card--expanded fishbones__course-card--active"
          onContextMenu={onContextMenu}
        >
          <div className="fishbones__course-title fishbones__course-title--static">
            <span className="fishbones__course-active-dot" aria-hidden />
            <LanguageChip language={course.language} size="xs" iconOnly />
            <span className="fishbones__course-name">{course.title}</span>
            <span
              className="fishbones__course-ring"
              title={`${doneLessons}/${totalLessons} lessons complete`}
            >
              <ProgressRing
                progress={pct}
                size={28}
                stroke={2.5}
                label={`${Math.round(pct * 100)}%`}
              />
            </span>
          </div>
        </div>

        <div className="fishbones__course-body">
          <ChapterTree
            chapters={course.chapters}
            courseId={course.id}
            activeLessonId={activeLessonId}
            completed={completed}
            onSelectLesson={onSelectLesson}
            onChapterContextMenu={onChapterContextMenu}
            onLessonContextMenu={onLessonContextMenu}
          />
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
    <div className="fishbones__course fishbones__course--compact">
      <button
        className="fishbones__course-row"
        onClick={() => setExpanded(!expanded)}
        onContextMenu={onContextMenu}
      >
        <span className="fishbones__course-row-caret" aria-hidden>
          <Icon
            icon={expanded ? chevronDown : chevronRight}
            size="xs"
            color="currentColor"
            weight="bold"
          />
        </span>
        <LanguageChip language={course.language} size="xs" iconOnly />
        <span className="fishbones__course-name">{course.title}</span>
        <span
          className="fishbones__course-row-ring"
          title={`${doneLessons}/${totalLessons} lessons complete`}
        >
          <ProgressRing progress={pct} size={18} stroke={2} label="" />
        </span>
      </button>

      {expanded && (
        <div className="fishbones__course-body">
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
