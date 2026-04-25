import { Icon } from "@base/primitives/icon";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import "@base/primitives/icon/icon.css";
import "./LessonNav.css";

interface NeighborLesson {
  id: string;
  title: string;
}

interface Props {
  prev: NeighborLesson | null;
  next: NeighborLesson | null;
  onPrev: () => void;
  onNext: () => void;
  /// Customize the next-button label. For reading-only lessons that aren't yet
  /// marked complete, this becomes something like "Mark read & next →" so the
  /// single button handles both actions.
  nextLabel?: string;
}

/// CSS `text-overflow: ellipsis` only trims at the end, which on a lesson
/// title like "Constructors and the new Keyword" hides the most useful bit —
/// the concept name. Split on the last word (or fall back to character count)
/// so the head can flex-shrink while the tail always stays visible, giving us
/// middle-ellipsis: "Constructors a… Keyword".
function splitForMiddleEllipsis(text: string): { head: string; tail: string } {
  const minTail = 4;
  const maxTail = 16;
  for (let i = text.length - minTail; i >= Math.max(1, text.length - maxTail); i--) {
    const ch = text[i];
    if (ch === " " || ch === "-" || ch === "/" || ch === ":") {
      return { head: text.slice(0, i), tail: text.slice(i) };
    }
  }
  const n = Math.min(8, Math.floor(text.length / 3));
  if (n <= 0) return { head: text, tail: "" };
  return { head: text.slice(0, -n), tail: text.slice(-n) };
}

function MiddleTitle({ text }: { text: string }) {
  const { head, tail } = splitForMiddleEllipsis(text);
  return (
    <span className="fishbones-lesson-nav-title" title={text}>
      <span className="fishbones-lesson-nav-title-head">{head}</span>
      {tail && <span className="fishbones-lesson-nav-title-tail">{tail}</span>}
    </span>
  );
}

/// Prev/Next bar that sits at the end of every lesson. Mirrors Codecademy's
/// linear progression feel — users can advance through a course without
/// opening the sidebar for every step, and reading-only lessons get marked
/// complete as part of pressing Next (see `nextLabel`).
export default function LessonNav({ prev, next, onPrev, onNext, nextLabel }: Props) {
  return (
    <nav className="fishbones-lesson-nav" aria-label="Lesson navigation">
      <button
        type="button"
        className="fishbones-lesson-nav-btn fishbones-lesson-nav-btn--prev"
        onClick={onPrev}
        disabled={!prev}
        title={prev?.title}
      >
        <span className="fishbones-lesson-nav-arrow" aria-hidden>
          <Icon icon={arrowLeft} size="sm" color="currentColor" />
        </span>
        <span className="fishbones-lesson-nav-text">
          <span className="fishbones-lesson-nav-label">previous</span>
          {prev && <MiddleTitle text={prev.title} />}
        </span>
      </button>

      <button
        type="button"
        className="fishbones-lesson-nav-btn fishbones-lesson-nav-btn--next"
        onClick={onNext}
        disabled={!next}
        title={next?.title}
      >
        <span className="fishbones-lesson-nav-text fishbones-lesson-nav-text--right">
          <span className="fishbones-lesson-nav-label">{nextLabel ?? "next"}</span>
          {next && <MiddleTitle text={next.title} />}
        </span>
        <span className="fishbones-lesson-nav-arrow" aria-hidden>
          <Icon icon={arrowRight} size="sm" color="currentColor" />
        </span>
      </button>
    </nav>
  );
}
