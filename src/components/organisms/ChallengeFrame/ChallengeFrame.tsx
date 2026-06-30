/// Challenge-pack banner. Sits above the workbench on any lesson
/// whose parent course has `packType: "challenges"` — the same slot
/// the EVM / Bitcoin chain docks use, but visually quieter (no live
/// chain state, no widgets, just the "you're inside a challenge"
/// affordance).
///
/// Why this exists: challenge packs and books rendered identically
/// in the lesson view, so a learner deep inside a Rust Challenges
/// session had no immediate cue that they were in a different
/// reading mode (no chapter prose, only-exercise pacing, drilled
/// per-difficulty). The frame surfaces:
///
///   - pack name (e.g. "Rust Challenges")
///   - difficulty tier pill (Easy / Medium / Hard) tinted to match
///     the Library's difficulty colours
///   - topic chip (when the lesson carries one — e.g. "ownership")
///   - position indicator: "12 of 40 · Easy" so the learner sees
///     how far they are through the current tier
///
/// Pure presentational — no chain state, no async. Renders
/// `null` when the parent course isn't a challenge pack so the
/// caller can mount it unconditionally.
///
/// Wired in `App.tsx` next to the EVM/BTC dock banners.

import type { Course, Lesson } from "@/data/types";
import { isChallengePack } from "@/data/types";
import { Icon } from "@base/primitives/icon";
import { swords } from "@base/primitives/icon/icons/swords";
import "@base/primitives/icon/icon.css";
import "./ChallengeFrame.css";

interface Props {
  course: Course;
  lesson: Lesson;
}

/// Difficulty → label + accent class. Mirrors the Library's
/// difficulty-dot palette so a learner who tints a card "Easy" green
/// in the Library sees the same green when they open the lesson.
const DIFFICULTY_META: Record<string, { label: string; cls: string }> = {
  easy: { label: "Easy", cls: "libre-challenge-frame__pill--easy" },
  medium: { label: "Medium", cls: "libre-challenge-frame__pill--medium" },
  hard: { label: "Hard", cls: "libre-challenge-frame__pill--hard" },
};

export default function ChallengeFrame({ course, lesson }: Props) {
  if (!isChallengePack(course)) return null;

  // Position within the current difficulty tier — find the chapter
  // this lesson belongs to and compute "N of M". The chapters of a
  // challenge pack ARE the difficulty tiers (Easy / Medium / Hard),
  // so chapter-relative position is what the learner cares about.
  const tierChapter = course.chapters.find((ch) =>
    ch.lessons.some((l) => l.id === lesson.id),
  );
  const tierIndex = tierChapter
    ? tierChapter.lessons.findIndex((l) => l.id === lesson.id)
    : -1;
  const tierTotal = tierChapter ? tierChapter.lessons.length : 0;

  // `difficulty` lives on the lesson but for a challenge pack the
  // chapter title usually carries the canonical tier name too. Read
  // the lesson first, fall back to inferring from the chapter title.
  const lessonDifficulty =
    "difficulty" in lesson ? (lesson as { difficulty?: string }).difficulty : undefined;
  const inferredDifficulty = (() => {
    if (!tierChapter) return undefined;
    const t = tierChapter.title.toLowerCase();
    if (t.includes("easy")) return "easy";
    if (t.includes("medium")) return "medium";
    if (t.includes("hard")) return "hard";
    return undefined;
  })();
  const difficulty = (lessonDifficulty ?? inferredDifficulty)?.toLowerCase();
  const diffMeta = difficulty ? DIFFICULTY_META[difficulty] : undefined;

  // Topic tag — only present on some challenge lessons. When set
  // it's a snake_case identifier (e.g. "ownership", "borrow_check"),
  // which we titleize for display.
  const topic =
    "topic" in lesson
      ? (lesson as { topic?: string }).topic
      : undefined;
  const topicLabel = topic
    ? topic
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : undefined;

  return (
    <div
      className="libre-challenge-frame"
      role="complementary"
      aria-label={`${course.title} — challenge ${tierIndex + 1} of ${tierTotal}`}
    >
      <div className="libre-challenge-frame__lead">
        <span className="libre-challenge-frame__icon" aria-hidden>
          <Icon icon={swords} size="xs" color="currentColor" />
        </span>
        <span className="libre-challenge-frame__title">{course.title}</span>
      </div>
      <div className="libre-challenge-frame__meta">
        {topicLabel && (
          <span className="libre-challenge-frame__topic" title={topic}>
            {topicLabel}
          </span>
        )}
        {diffMeta && (
          <span
            className={`libre-challenge-frame__pill ${diffMeta.cls}`}
            title={`Difficulty tier — ${diffMeta.label}`}
          >
            {diffMeta.label}
          </span>
        )}
        {tierIndex >= 0 && tierTotal > 0 && (
          <span className="libre-challenge-frame__position">
            {tierIndex + 1} of {tierTotal}
          </span>
        )}
      </div>
    </div>
  );
}
