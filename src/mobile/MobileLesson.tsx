/// Mobile lesson router. Inspects `lesson.kind` and dispatches to the
/// right specialised view:
///   - reading          → <MobileReader />
///   - quiz             → <MobileQuiz />
///   - exercise / mixed → <BlocksView /> (always — mobile has no
///                                          editor mode)
///
/// The header (back arrow + course title + chapter label) is shared
/// across all three so navigation feels uniform.

import { useEffect, useMemo, useState } from "react";
import type { Course, Lesson } from "@/data/types";
import { isExerciseKind, isQuiz } from "@/data/types";
import { availableLocalesFor, localizedLesson } from "@/data/localize";
import { useBookLocale } from "@/hooks/useBookLocale";
import { useLocale } from "@/i18n/i18n";
import type { Locale } from "@/data/locales";
import MobileReader from "./MobileReader";
import MobileQuiz from "./MobileQuiz";
import MobileOutline from "./MobileOutline";
import BlocksView from "@/components/organisms/Blocks/BlocksView";
import { haptics } from "@/lib/haptics";
import { Icon } from "@base/primitives/icon";
import { chevronLeft } from "@base/primitives/icon/icons/chevron-left";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { listTree } from "@base/primitives/icon/icons/list-tree";
import "./MobileLesson.css";

interface Props {
  course: Course;
  chapterIndex: number;
  lessonIndex: number;
  lesson: Lesson;
  completed: Set<string>;
  onBack: () => void;
  onComplete: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onJump: (chapterIndex: number, lessonIndex: number) => void;
  isCompleted: boolean;
}

export default function MobileLesson({
  course,
  chapterIndex,
  lessonIndex,
  lesson: rawLesson,
  completed,
  onBack,
  onComplete,
  onPrev,
  onNext,
  onJump,
  isCompleted,
}: Props) {
  const chapter = course.chapters[chapterIndex];
  const [outlineOpen, setOutlineOpen] = useState(false);

  // Translate the lesson BEFORE any downstream view sees it — the
  // same resolution the desktop LessonView runs: the learner's
  // explicit per-book pick (useBookLocale, synced from desktop),
  // else the app locale when this book actually ships it, else
  // English. Mobile previously skipped this entirely, so a Hindi
  // user reading a translated book still got raw English prose.
  // Identity-stable for `en` / books without overlays, so the
  // downstream memo/key behavior is unchanged for untranslated books.
  const { locale } = useLocale();
  const [bookLocaleSel] = useBookLocale(course.id);
  const availableLocales = useMemo(() => availableLocalesFor(course), [course]);
  const readingLocale: Locale =
    bookLocaleSel && availableLocales.includes(bookLocaleSel)
      ? bookLocaleSel
      : availableLocales.includes(locale)
        ? locale
        : "en";
  const lesson = useMemo(
    () => localizedLesson(rawLesson, readingLocale),
    [rawLesson, readingLocale],
  );

  // Reset the page scroll on every lesson change. Without this,
  // navigating from a long reading lesson to a short one keeps the
  // user mid-paragraph in the new lesson — they have to scroll up
  // to see the title and the start of the prose. Mobile uses the
  // document as the scroll container (see useLessonReadCursor's
  // `document.scrollingElement` reference) so window.scrollTo
  // hits the right element. `behavior: "instant"` because a
  // smooth-scroll on every nav feels sluggish; the user wanted to
  // GO somewhere, not watch the page rewind.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [lesson.id]);

  // Where in the course are we, in 1-indexed flat position? Drives the
  // header progress chip ("Lesson 7 of 56").
  let lessonNumber = 0;
  let totalLessons = 0;
  for (let ci = 0; ci < course.chapters.length; ci++) {
    for (let li = 0; li < course.chapters[ci].lessons.length; li++) {
      totalLessons += 1;
      if (ci < chapterIndex || (ci === chapterIndex && li <= lessonIndex)) {
        lessonNumber = totalLessons;
      }
    }
  }

  return (
    <div className="m-lesson">
      <header className="m-lesson__head">
        <button
          type="button"
          className="m-lesson__back"
          onClick={onBack}
          aria-label="Back to library"
        >
          <Icon icon={chevronLeft} size="lg" />
        </button>
        <div className="m-lesson__head-text">
          <span className="m-lesson__crumb">{course.title}</span>
          <span className="m-lesson__chapter">{chapter?.title}</span>
        </div>
        <button
          type="button"
          className="m-lesson__outline-btn"
          onClick={() => setOutlineOpen(true)}
          aria-label="Open course outline"
        >
          <Icon icon={listTree} size="lg" />
          <span className="m-lesson__outline-position">
            {lessonNumber}/{totalLessons}
          </span>
        </button>
      </header>

      <h1 className="m-lesson__title">{lesson.title}</h1>

      {/*
        Each interactive sub-component takes `key={lesson.id}` so React
        remounts it when the parent navigates to a new lesson — without
        this, useState-driven local state (staged blocks, picked chips,
        check-result flag) leaks across lesson boundaries and the next
        lesson opens already showing the previous lesson's "correct"
        state. Reading + Quiz already self-contain their state per
        lesson, but the puzzle / cloze / synthesised-exercise paths
        were holding stale data that read as "auto-complete the moment
        you arrive". Keying off lesson.id costs nothing on first
        render and fixes the leak.
      */}
      <div className="m-lesson__body">
        {isQuiz(lesson) && (
          <MobileQuiz key={lesson.id} lesson={lesson} onComplete={onComplete} />
        )}
        {isExerciseKind(lesson) && (
          // Mobile is always blocks-only — typing on a 6" screen is
          // brutal, so the editor mode never renders here. Lessons
          // without authored blocks data render an in-place note
          // (BlocksView shows the "not authored yet" message); the
          // generator pipeline will fill them in.
          <BlocksView key={lesson.id} lesson={lesson} onComplete={onComplete} />
        )}
        {lesson.kind === "reading" && (
          <MobileReader
            key={lesson.id}
            courseId={course.id}
            lessonId={lesson.id}
            body={lesson.body}
            onContinue={onComplete}
          />
        )}
      </div>

      {(onPrev || onNext) && (
        <nav className="m-lesson__nav" aria-label="Lesson navigation">
          <button
            type="button"
            className="m-lesson__nav-btn"
            // Light impact on backward navigation — the buzz
            // signals "going back to the previous beat" without
            // the success-pattern the Next button uses on
            // completion. Plain `onNext` (when already complete)
            // gets the same light impact below.
            onClick={onPrev ? () => { void haptics.light(); onPrev(); } : undefined}
            disabled={!onPrev}
          >
            <Icon icon={chevronLeft} size="base" />
            <span>Previous</span>
          </button>
          {/*
            Next behaves like the desktop's `handleNext`: if the lesson
            isn't yet complete, this is the "I'm done — mark it and
            advance" action; if it's already complete, it's a plain
            navigation step. `onComplete` already does both
            markCompleted + goNext on mobile, so the wiring collapses
            to a single onClick. No more inline "mark complete" /
            "next lesson" buttons inside puzzle / cloze / reader —
            this row owns advancement across every kind.

            Haptic split: the "I just finished this" tap gets the
            full success notification pattern (handled inside
            `onComplete` itself in MobileApp). The "already
            complete, just navigating forward" tap gets a plain
            light impact so the user knows the button registered
            without celebrating a non-event.
          */}
          <button
            type="button"
            className="m-lesson__nav-btn m-lesson__nav-btn--next"
            onClick={() => {
              if (isCompleted) {
                void haptics.light();
                onNext?.();
              } else {
                onComplete();
              }
            }}
            disabled={!onNext}
          >
            <span>Next</span>
            <Icon icon={chevronRight} size="base" />
          </button>
        </nav>
      )}

      {outlineOpen && (
        <MobileOutline
          course={course}
          activeChapter={chapterIndex}
          activeLesson={lessonIndex}
          completed={completed}
          onJump={onJump}
          onClose={() => setOutlineOpen(false)}
        />
      )}
    </div>
  );
}
