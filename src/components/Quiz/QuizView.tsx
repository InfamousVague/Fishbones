import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import type { QuizLesson, QuizQuestion } from "../../data/types";
import { normalizeAnswer } from "../../data/types";
import "./QuizView.css";

interface Props {
  lesson: QuizLesson;
  onComplete: () => void;
}

type QuestionState =
  | { status: "unanswered" }
  | { status: "correct" }
  | { status: "wrong" };

/// Renders a checkpoint quiz. Each question can be answered independently;
/// the lesson counts as complete only when every question is correct. Wrong
/// answers reveal the explanation and allow retry. No scoring — concept
/// retention is the point, not hitting a number.
export default function QuizView({ lesson, onComplete }: Props) {
  const [state, setState] = useState<QuestionState[]>(() =>
    lesson.questions.map(() => ({ status: "unanswered" })),
  );

  const allCorrect = state.every((s) => s.status === "correct");

  function setQuestionState(index: number, next: QuestionState) {
    setState((prev) => {
      const copy = prev.slice();
      copy[index] = next;
      const done = copy.every((s) => s.status === "correct");
      if (done && !allCorrect) {
        // All green — bubble completion up. Fire in a microtask so the state
        // update commits first.
        queueMicrotask(onComplete);
      }
      return copy;
    });
  }

  return (
    <div className="fishbones-quiz">
      <div className="fishbones-quiz-progress">
        {lesson.questions.map((_, i) => (
          <span
            key={i}
            className={`fishbones-quiz-pip fishbones-quiz-pip--${state[i].status}`}
            aria-hidden
          />
        ))}
        <span className="fishbones-quiz-progress-label">
          {state.filter((s) => s.status === "correct").length} / {lesson.questions.length}
        </span>
      </div>

      {lesson.questions.map((q, i) => (
        <QuestionCard
          key={i}
          index={i}
          question={q}
          state={state[i]}
          onResult={(status) => setQuestionState(i, { status })}
        />
      ))}

      {allCorrect && (
        <div className="fishbones-quiz-done">nice — checkpoint cleared</div>
      )}
    </div>
  );
}

function QuestionCard({
  index,
  question,
  state,
  onResult,
}: {
  index: number;
  question: QuizQuestion;
  state: QuestionState;
  onResult: (status: "correct" | "wrong") => void;
}) {
  // "Ask Fishbones" badge — fires the same `fishbones:ask-ai` event
  // the lesson reader's code-block badges use, with `kind: "quiz"`
  // so the AiAssistant builds a hint-not-answer prompt for the
  // local LLM.
  function askAi() {
    window.dispatchEvent(
      new CustomEvent("fishbones:ask-ai", {
        detail: { kind: "quiz", prompt: question.prompt },
      }),
    );
  }
  return (
    <div className={`fishbones-quiz-card fishbones-quiz-card--${state.status}`}>
      <div className="fishbones-quiz-num">{index + 1}</div>
      <div className="fishbones-quiz-q-body">
        <div className="fishbones-quiz-prompt-row">
          <div className="fishbones-quiz-prompt">{question.prompt}</div>
          <button
            type="button"
            className="fishbones-quiz-ask"
            onClick={askAi}
            title="Discuss this question with the local assistant"
            aria-label="Ask Fishbones for a hint"
          >
            ?
          </button>
        </div>
        {question.kind === "mcq" ? (
          <McqAnswer question={question} state={state} onResult={onResult} />
        ) : (
          <ShortAnswer question={question} state={state} onResult={onResult} />
        )}
        {state.status !== "unanswered" && question.explanation && (
          <div className="fishbones-quiz-explanation">{question.explanation}</div>
        )}
      </div>
    </div>
  );
}

function McqAnswer({
  question,
  state,
  onResult,
}: {
  question: Extract<QuizQuestion, { kind: "mcq" }>;
  state: QuestionState;
  onResult: (status: "correct" | "wrong") => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const committed = state.status !== "unanswered";

  function submit(i: number) {
    if (committed) return;
    setPicked(i);
    onResult(i === question.correctIndex ? "correct" : "wrong");
  }

  return (
    <div className="fishbones-quiz-options">
      {question.options.map((opt, i) => {
        const isPicked = i === picked;
        const isCorrect = i === question.correctIndex;
        const classes = [
          "fishbones-quiz-option",
          committed && isCorrect ? "fishbones-quiz-option--correct" : "",
          committed && isPicked && !isCorrect ? "fishbones-quiz-option--wrong" : "",
        ].join(" ");
        return (
          <button
            key={i}
            className={classes}
            onClick={() => submit(i)}
            disabled={committed && state.status === "correct"}
          >
            <span className="fishbones-quiz-option-letter">{String.fromCharCode(65 + i)}</span>
            <span>{opt}</span>
          </button>
        );
      })}
    </div>
  );
}

function ShortAnswer({
  question,
  state,
  onResult,
}: {
  question: Extract<QuizQuestion, { kind: "short" }>;
  state: QuestionState;
  onResult: (status: "correct" | "wrong") => void;
}) {
  const [value, setValue] = useState("");
  const committed = state.status === "correct";

  function submit() {
    if (committed) return;
    const normalized = normalizeAnswer(value);
    const ok = question.accept.some((a) => normalizeAnswer(a) === normalized);
    onResult(ok ? "correct" : "wrong");
  }

  return (
    <div className="fishbones-quiz-short">
      <input
        className="fishbones-quiz-short-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="type your answer"
        disabled={committed}
      />
      <button
        className="fishbones-quiz-short-submit"
        onClick={submit}
        disabled={committed || !value.trim()}
      >
        {committed ? (
          <Icon icon={check} size="xs" color="currentColor" />
        ) : (
          "check"
        )}
      </button>
    </div>
  );
}
