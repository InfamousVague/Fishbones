/// Repro for "a course whose LAST lesson is a reading can never be
/// finished on desktop" — completion for reading-only lessons used
/// to live exclusively inside handleNext's post-navigation path, and
/// both the handler and the nav button bailed when there was no next
/// neighbor. Renders the FULL LessonView on the final reading lesson
/// and asserts the Next slot acts as a "mark read & finish" CTA:
/// enabled, completes on click, navigates nowhere.
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { installMockTauri } from "@/test/mockTauri";

vi.mock("@/i18n/i18n", () => ({
  useT: () => (k: string) => k,
}));
// Monaco can't resolve under vitest and reading lessons never mount
// the editor anyway — stub the module chain like koanCrash does.
vi.mock("@/lib/monaco/setup", () => ({}));
vi.mock("@monaco-editor/react", () => ({ default: () => null }));
vi.mock("@/components/templates/Lesson/InlineSandbox", () => ({ default: () => null }));
// Page-turn foley is irrelevant here; keep the rest of the module
// (settings plumbing etc.) real for any other importer in the tree.
vi.mock("@/lib/sfx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sfx")>()),
  playSound: vi.fn(),
}));

import LessonView from "@/components/templates/Lesson/LessonView";
import type { Course, Lesson } from "@/data/types";
import { findNeighbors } from "@/lessonHelpers";

const reading1: Lesson = {
  id: "reading-1",
  title: "Ownership Basics",
  kind: "reading",
  body: "# Ownership Basics\n\nSome prose.\n",
} as unknown as Lesson;

const readingLast: Lesson = {
  id: "reading-2",
  title: "Where to go next",
  kind: "reading",
  body: "# Where to go next\n\nClosing prose.\n",
} as unknown as Lesson;

const course = {
  id: "rust-book",
  title: "The Rust Programming Language",
  language: "rust",
  chapters: [{ title: "Endgame", lessons: [reading1, readingLast] }],
} as unknown as Course;

function renderLesson(
  lesson: Lesson,
  { isCompleted = false, onComplete = () => {}, onNavigate = (_: string) => {} } = {},
) {
  return render(
    <LessonView
      courseId={course.id}
      courseLanguage={course.language}
      isChallenge={false}
      lesson={lesson}
      neighbors={findNeighbors(course, lesson.id)}
      isCompleted={isCompleted}
      autoAdvanceFireAt={null}
      onComplete={onComplete}
      onNavigate={onNavigate}
    />,
  );
}

function nextButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(
    ".libre-lesson-nav-btn--next",
  );
  expect(btn).not.toBeNull();
  return btn!;
}

describe("final reading lesson — mark read & finish", () => {
  // Mounting LessonView mounts useLessonAudio, whose passive-mount
  // effect calls invoke("load_course_audio_manifest") — same stub
  // the koanCrash repro installs.
  beforeEach(async () => {
    await installMockTauri({
      load_course_audio_manifest: () => null,
    });
  });

  it("keeps the Next slot clickable and completes without navigating", () => {
    const onComplete = vi.fn();
    const onNavigate = vi.fn();
    const { container } = renderLesson(readingLast, { onComplete, onNavigate });

    const btn = nextButton(container);
    expect(btn.disabled).toBe(false);
    // CTA mode: holographic styling + the finish label (mocked t()
    // returns the key).
    expect(btn.className).toContain("libre-lesson-nav-btn--cta");
    expect(btn.textContent).toContain("lessonNav.markReadFinish");

    fireEvent.click(btn);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("disables the Next slot once the final reading is completed", () => {
    const onComplete = vi.fn();
    const { container } = renderLesson(readingLast, {
      isCompleted: true,
      onComplete,
    });

    const btn = nextButton(container);
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("still completes AND navigates on a non-final reading (regression)", () => {
    const onComplete = vi.fn();
    const onNavigate = vi.fn();
    const { container } = renderLesson(reading1, { onComplete, onNavigate });

    const btn = nextButton(container);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("lessonNav.markReadNext");

    fireEvent.click(btn);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("reading-2");
  });
});
