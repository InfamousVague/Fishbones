/// Mobile quiz. One question per screen, big tap targets, advance with
/// "Next" after the user picks. Supports both MCQ and short-answer
/// (the only two QuizQuestion shapes we ship). When the user reaches
/// the last question and taps Continue, calls `onComplete`.

import { useState } from "react";
import type { QuizLesson, QuizQuestion } from "../data/types";
import "./MobileQuiz.css";

interface Props {
  lesson: QuizLesson;
  /// Retained for prop-shape compatibility — see comment on the
  /// component. The dispatch passes it; we don't fire it.
  onComplete?: () => void;
}

// onComplete prop is retained on the type but no longer fired here —
// the lesson's bottom Next nav owns "mark complete + advance" across
// every kind, same as desktop's handleNext. Within-quiz nav (between
// questions) stays local.
export default function MobileQuiz({ lesson }: Props) {
  const [idx, setIdx] = useState(0);
  // Per-question state. Stored in a Map so the user can swipe back and
  // see what they answered without losing it.
  const [picks, setPicks] = useState<Record<number, number | string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const q: QuizQuestion = lesson.questions[idx];
  const isLast = idx === lesson.questions.length - 1;
  const reveal = revealed[idx] === true;
  const pick = picks[idx];

  const commit = (value: number | string) => {
    setPicks({ ...picks, [idx]: value });
    setRevealed({ ...revealed, [idx]: true });
  };

  const next = () => {
    // Within-quiz navigation only — we step through questions but
    // never fire `onComplete` from the last "Finish" press. The
    // lesson's bottom Next nav owns "mark complete + advance"
    // across every kind, same as desktop's handleNext. The user
    // sees their final answer's reveal + explanation and taps Next
    // to leave the quiz.
    if (!isLast) setIdx(idx + 1);
  };

  const back = () => {
    if (idx > 0) setIdx(idx - 1);
  };

  return (
    <div className="m-quiz">
      <div className="m-quiz__progress" aria-hidden>
        Question {idx + 1} of {lesson.questions.length}
      </div>

      <p className="m-quiz__prompt">{q.prompt}</p>

      {q.kind === "mcq" && (
        <div className="m-quiz__choices" role="radiogroup">
          {q.options.map((opt, i) => {
            const isCorrect = i === q.correctIndex;
            const isPicked = pick === i;
            const cls = [
              "m-quiz__choice",
              reveal && isCorrect ? "m-quiz__choice--correct" : "",
              reveal && isPicked && !isCorrect ? "m-quiz__choice--wrong" : "",
              !reveal && isPicked ? "m-quiz__choice--picked" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={i}
                type="button"
                className={cls}
                onClick={() => !reveal && commit(i)}
                disabled={reveal}
                role="radio"
                aria-checked={isPicked}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "short" && (
        <ShortAnswer
          accept={q.accept}
          revealed={reveal}
          value={typeof pick === "string" ? pick : ""}
          onCommit={(v) => commit(v)}
        />
      )}

      {reveal && q.explanation && (
        <p className="m-quiz__explanation">{q.explanation}</p>
      )}

      <div className="m-quiz__actions">
        {idx > 0 && (
          <button type="button" className="m-quiz__btn m-quiz__btn--ghost" onClick={back}>
            Back
          </button>
        )}
        {/* No "Finish" — on the last question, the within-quiz nav
            disappears once revealed and the learner uses the
            lesson-level Next at the bottom of the screen. */}
        {!isLast && (
          <button
            type="button"
            className="m-quiz__btn m-quiz__btn--primary"
            onClick={next}
            disabled={!reveal}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

interface ShortProps {
  accept: string[];
  value: string;
  revealed: boolean;
  onCommit: (v: string) => void;
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/[.,!?;:]+$/g, "");
}

function ShortAnswer({ accept, value, revealed, onCommit }: ShortProps) {
  const [draft, setDraft] = useState(value);
  const correct =
    revealed && accept.some((a) => normalise(a) === normalise(value));
  return (
    <div className="m-quiz__short">
      <input
        className={`m-quiz__short-input${
          revealed ? (correct ? " m-quiz__short-input--correct" : " m-quiz__short-input--wrong") : ""
        }`}
        type="text"
        value={revealed ? value : draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={revealed}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Type your answer"
      />
      {!revealed && (
        <button
          type="button"
          className="m-quiz__short-submit"
          onClick={() => onCommit(draft)}
          disabled={draft.trim() === ""}
        >
          Check
        </button>
      )}
    </div>
  );
}
