/// Read-time merge helpers that overlay a locale's translation onto a
/// Course / Chapter / Lesson. Stay PURE (no React, no I/O) so they can
/// be called from any reader, the search index, the audio fetcher, or
/// the offline ingest pipeline without dragging hook state along.
///
/// Merge semantics — every key independently:
///   1. If the requested locale is `en`, return the source unchanged.
///   2. If the source has no `translations[locale]` entry, return source.
///   3. Otherwise, for each translatable key on the entity:
///        - Use the overlay value when present + non-empty.
///        - Fall back to the English source value otherwise.
///
/// This means partial translations (e.g. course title translated but
/// lessons not yet) work seamlessly — no error, no missing-string
/// placeholders. The user just sees a mix of languages while we
/// finish the pipeline run.

import type {
  Course,
  Chapter,
  Lesson,
  ReadingLesson,
  ExerciseLesson,
  MixedLesson,
  QuizLesson,
  QuizQuestion,
} from "./types";
import type {
  Locale,
  CourseTranslation,
  ChapterTranslation,
  LessonTranslation,
} from "./locales";

/// Pull the chosen locale's overlay for `course` and merge it on top
/// of the English source. Recursively applies to chapters + lessons.
/// Returns the same `Course` reference when locale is `en` (no copy)
/// so callers can fast-path identity comparison.
export function localizedCourse(course: Course, locale: Locale): Course {
  if (locale === "en") return course;
  const overlay = course.translations?.[locale];
  // Even if course-level overlay is missing, chapters/lessons may still
  // have their own translations; walk the tree regardless.
  const chapters = course.chapters.map((c) => localizedChapter(c, locale));
  // Skip the spread when nothing changed (no course-level overlay AND
  // no chapter changed) so reference equality stays meaningful.
  const sameChapters = chapters.every((c, i) => c === course.chapters[i]);
  if (!overlay && sameChapters) return course;
  return {
    ...course,
    title: pickString(overlay?.title, course.title),
    description: pickString(overlay?.description, course.description),
    chapters,
  };
}

export function localizedChapter(chapter: Chapter, locale: Locale): Chapter {
  if (locale === "en") return chapter;
  const overlay = chapter.translations?.[locale];
  const lessons = chapter.lessons.map((l) => localizedLesson(l, locale));
  const sameLessons = lessons.every((l, i) => l === chapter.lessons[i]);
  if (!overlay && sameLessons) return chapter;
  return {
    ...chapter,
    title: pickString(overlay?.title, chapter.title),
    lessons,
  };
}

/// Merge the per-locale overlay onto a single Lesson, dispatching on
/// `kind` so exercise hints + quiz questions get translated too.
/// Identity-returns the source when `locale === "en"` or no overlay
/// exists, so the React reader can use `===` to skip re-renders.
export function localizedLesson(lesson: Lesson, locale: Locale): Lesson {
  if (locale === "en") return lesson;
  const overlay = lesson.translations?.[locale];
  if (!overlay) return lesson;

  const base = {
    ...lesson,
    title: pickString(overlay.title, lesson.title),
    body: pickString(overlay.body, lesson.body),
    objectives: pickArray(overlay.objectives, lesson.objectives),
  };

  switch (lesson.kind) {
    case "reading":
      return base as ReadingLesson;
    case "exercise":
      return {
        ...(base as ExerciseLesson),
        // Hints overlay: pad with English when overlay is shorter than
        // the source so the "show next hint" button doesn't run out
        // before the source list does. Empty/whitespace overlay entries
        // also fall back to the English hint at that index.
        hints: mergeHintList(overlay.hints, lesson.hints),
      };
    case "mixed":
      return {
        ...(base as MixedLesson),
        hints: mergeHintList(overlay.hints, lesson.hints),
      };
    case "quiz":
      return {
        ...(base as QuizLesson),
        questions: mergeQuestionList(overlay.questions, lesson.questions),
      };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function pickString(overlay: string | undefined, source: string): string;
function pickString(
  overlay: string | undefined,
  source: string | undefined,
): string | undefined;
function pickString(
  overlay: string | undefined,
  source: string | undefined,
): string | undefined {
  if (overlay && overlay.trim().length > 0) return overlay;
  return source;
}

/// Per-element fallback for arrays of strings (objectives, hints).
/// `overlay[i]` wins when present + non-empty, otherwise `source[i]`.
/// Output length matches `source.length` exactly so callers don't have
/// to reason about overlay-shorter-than-source.
function pickArray(
  overlay: string[] | undefined,
  source: string[] | undefined,
): string[] | undefined {
  if (!source) return source;
  if (!overlay || overlay.length === 0) return source;
  return source.map((s, i) => {
    const o = overlay[i];
    return o && o.trim().length > 0 ? o : s;
  });
}

function mergeHintList(
  overlay: string[] | undefined,
  source: string[] | undefined,
): string[] | undefined {
  return pickArray(overlay, source);
}

function mergeQuestionList(
  overlay:
    | { prompt?: string; options?: string[]; explanation?: string }[]
    | undefined,
  source: QuizQuestion[],
): QuizQuestion[] {
  if (!overlay || overlay.length === 0) return source;
  return source.map((q, i) => {
    const o = overlay[i];
    if (!o) return q;
    if (q.kind === "mcq") {
      return {
        ...q,
        prompt: pickString(o.prompt, q.prompt),
        options: pickArray(o.options, q.options) ?? q.options,
        explanation: pickString(o.explanation, q.explanation),
      };
    }
    // short-answer: don't translate `accept[]` (matching is normalised
    // + case-insensitive — translating accepted answers would break
    // grading silently). Only the prompt + explanation get the overlay.
    return {
      ...q,
      prompt: pickString(o.prompt, q.prompt),
      explanation: pickString(o.explanation, q.explanation),
    };
  });
}

/// Helper for the catalog UI: which locales does this course have at
/// least one translated lesson in? Drives the "available languages"
/// chips on the course detail page. Returns locales in the order
/// they're declared in `SUPPORTED_LOCALES`, EN first.
export function availableLocalesFor(course: Course): Locale[] {
  const found = new Set<Locale>(["en"]);
  if (course.translations) {
    for (const k of Object.keys(course.translations)) found.add(k as Locale);
  }
  for (const ch of course.chapters) {
    if (ch.translations)
      for (const k of Object.keys(ch.translations)) found.add(k as Locale);
    for (const l of ch.lessons) {
      if (l.translations)
        for (const k of Object.keys(l.translations)) found.add(k as Locale);
    }
  }
  return Array.from(found);
}

/// Drop every `translations` overlay whose locale isn't in `keep`, at the
/// course / chapter / lesson level, returning a filtered COPY. English is
/// the authoring base (never an overlay key), so it's always implicitly
/// kept; passing "en" in `keep` is harmless. An overlay that ends up empty
/// is removed entirely (set back to `undefined`) so `availableLocalesFor`
/// on the result reports exactly `keep`. Used at install time to persist
/// only the languages the learner chose to download.
export function stripCourseToLocales(course: Course, keep: Locale[]): Course {
  const keepSet = new Set<string>(keep);
  return {
    ...course,
    translations: filterOverlay(course.translations, keepSet),
    chapters: course.chapters.map((ch) => ({
      ...ch,
      translations: filterOverlay(ch.translations, keepSet),
      lessons: ch.lessons.map((l) => ({
        ...l,
        translations: filterOverlay(l.translations, keepSet),
      })),
    })),
  };
}

/// Keep only the entries whose locale key is in `keepSet`; return
/// `undefined` when nothing survives so the field disappears from the
/// serialised course rather than lingering as an empty object. Preserves
/// the caller's overlay type.
function filterOverlay<O extends Partial<Record<string, unknown>>>(
  overlay: O | undefined,
  keepSet: Set<string>,
): O | undefined {
  if (!overlay) return undefined;
  const out = {} as O;
  let kept = 0;
  for (const loc of Object.keys(overlay)) {
    if (keepSet.has(loc)) {
      (out as Record<string, unknown>)[loc] = (
        overlay as Record<string, unknown>
      )[loc];
      kept += 1;
    }
  }
  return kept > 0 ? out : undefined;
}

/// A per-locale download overlay: just the translated slices for ONE locale,
/// keyed by id, carved out of a course so it can be shipped and fetched
/// separately from the English base (`<id>.<locale>.json`). Lessons are keyed
/// `chapterId/lessonId` because bare lesson slugs can repeat across chapters.
/// Round-trips with `applyLocaleOverlay`.
export interface LocaleOverlay {
  locale: Locale;
  course?: CourseTranslation;
  chapters: Record<string, ChapterTranslation>;
  lessons: Record<string, LessonTranslation>;
}

/// Carve the `locale` slice out of a fully-translated course into a
/// standalone overlay (used by the extract pipeline to emit sidecar files).
export function extractLocaleOverlay(
  course: Course,
  locale: Locale,
): LocaleOverlay {
  const ov: LocaleOverlay = { locale, chapters: {}, lessons: {} };
  // `translations` is keyed by non-EN locales; index through a widened view
  // so a `Locale` (which nominally includes "en") is accepted.
  const at = <T>(m: Partial<Record<string, T>> | undefined): T | undefined =>
    m ? (m as Record<string, T>)[locale] : undefined;
  const c = at<CourseTranslation>(course.translations);
  if (c) ov.course = c;
  for (const ch of course.chapters) {
    const chT = at<ChapterTranslation>(ch.translations);
    if (chT) ov.chapters[ch.id] = chT;
    for (const l of ch.lessons) {
      const lT = at<LessonTranslation>(l.translations);
      if (lT) ov.lessons[`${ch.id}/${l.id}`] = lT;
    }
  }
  return ov;
}

/// Re-attach an overlay's `locale` slice onto a (typically English-only)
/// course, returning a merged copy — the inverse of `extractLocaleOverlay`.
/// Used at install/seed time to reconstruct the inline `translations` shape
/// the reader expects from the base download + the fetched overlays.
export function applyLocaleOverlay(
  course: Course,
  overlay: LocaleOverlay,
): Course {
  const loc = overlay.locale;
  const merge = <T>(
    existing: Partial<Record<string, T>> | undefined,
    value: T | undefined,
  ): Partial<Record<string, T>> | undefined => {
    if (!value) return existing;
    return { ...(existing ?? {}), [loc]: value } as Partial<Record<string, T>>;
  };
  return {
    ...course,
    translations: merge(course.translations, overlay.course),
    chapters: course.chapters.map((ch) => {
      const chOv = overlay.chapters[ch.id];
      const lessons = ch.lessons.map((l) => {
        const lOv = overlay.lessons[`${ch.id}/${l.id}`];
        return lOv ? { ...l, translations: merge(l.translations, lOv) } : l;
      });
      if (!chOv && lessons.every((l, i) => l === ch.lessons[i])) return ch;
      return { ...ch, translations: merge(ch.translations, chOv), lessons };
    }),
  };
}
