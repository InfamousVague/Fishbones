/// One-card-at-a-time runner for a Practice session.
///
/// Owns the queue cursor, per-card committed state, and the
/// end-of-session summary. The `<PracticeView>` shell builds the
/// queue and hands it in; the session is otherwise self-contained.
///
/// Card lifecycle:
///   1. Mount — show the prompt + answer affordance.
///   2. Learner answers → call `gradeAttempt`, transition to
///      "committed" state, show explanation + Next button.
///   3. Click Next → advance the cursor.
///   4. Cursor past the end → show summary (got X/Y right, time
///      taken, deck breakdown, "Practice again" / "Back to deck").
///
/// We deliberately DON'T auto-advance after a correct answer —
/// the explanation and the "you got it!" feedback are part of the
/// learning, not a delay to skip. Correct cards reveal Next on
/// the same affordance the wrong cards do.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import { flame } from "@base/primitives/icon/icons/flame";
import "@base/primitives/icon/icon.css";
import {
  type QuizQuestion,
  normalizeAnswer,
} from "@/data/types";
import type { PracticeItem } from "./types";
import type { PracticeMode } from "./practiceQueue";
import { MODE_LABELS } from "./practiceQueue";
import { gradeAttempt } from "./practiceStore";
import { formatDueIn } from "./practiceSchedule";
import { comboMultiplier, xpForCorrect, warmupAnswerText } from "./practiceLadder";
import { fireXpBurst } from "@/components/atoms/XpBurst/XpBurst";
import PracticeBlocks from "./PracticeBlocks";
import PracticeParsons from "./PracticeParsons";
import PracticeSpotBug from "./PracticeSpotBug";
import PracticeCloze from "./PracticeCloze";
import PracticeRebuild from "./PracticeRebuild";
import "./PracticeSession.css";

interface Props {
  /// Pre-built queue of items to play. Length determines the
  /// session card count.
  queue: PracticeItem[];
  /// Optional zero-stakes warm-up lap played BEFORE the graded
  /// queue: recognition cards (prompt + revealed answer + one tap)
  /// that prime the concepts about to resurface. Empty/omitted →
  /// the session starts straight on the graded queue.
  warmup?: PracticeItem[];
  /// Mode label shown in the session header. Doesn't affect
  /// behaviour — purely cosmetic context for the learner.
  mode: PracticeMode;
  /// Click "Open lesson" on a card → forwarded here so the App
  /// can switch to the lesson reader. Optional: when omitted,
  /// the link doesn't render.
  onOpenLesson?: (courseId: string, lessonId: string) => void;
  /// Click Back / Done → return to the deck view.
  onExit: () => void;
}

type CardOutcome =
  | { status: "open" }
  | { status: "correct"; nextDueMs: number }
  | { status: "wrong"; nextDueMs: number };

export default function PracticeSession({
  queue,
  warmup,
  mode,
  onOpenLesson,
  onExit,
}: Props) {
  const startedAt = useRef<number>(Date.now());
  const [cursor, setCursor] = useState(0);
  // One outcome per queue index. Built lazily as the learner plays.
  const [outcomes, setOutcomes] = useState<CardOutcome[]>(() =>
    queue.map(() => ({ status: "open" as const })),
  );

  // ----- Warm-up lap (zero-stakes recognition before the graded queue) -----
  const warmupItems = warmup ?? [];
  const [phase, setPhase] = useState<"warmup" | "main">(
    warmupItems.length > 0 ? "warmup" : "main",
  );
  const [warmupCursor, setWarmupCursor] = useState(0);

  // ----- In-session reward state (combo → multiplier → XP burst) -----
  // Combo is the run of consecutive correct cards; it scales the XP
  // burst and the on-screen pill. A miss resets it to 0 but never
  // costs XP or touches the SRS streak — pure upside.
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);

  const current = queue[cursor];
  const cardOutcome = outcomes[cursor];
  const isDone = cursor >= queue.length;

  function commitOutcome(correct: boolean) {
    if (!current) return;
    if (cardOutcome?.status !== "open") return;
    const rec = gradeAttempt(current, correct);
    const nextDueMs = Math.max(0, rec.dueAt - Date.now());
    if (correct) {
      const newCombo = combo + 1;
      setCombo(newCombo);
      setBestCombo((b) => Math.max(b, newCombo));
      const gain = xpForCorrect(newCombo, current.difficulty);
      setSessionXp((x) => x + gain);
      fireXpBurst(gain);
    } else {
      setCombo(0);
    }
    setOutcomes((prev) => {
      const next = prev.slice();
      next[cursor] = correct
        ? { status: "correct", nextDueMs }
        : { status: "wrong", nextDueMs };
      return next;
    });
  }

  function finishWarmup() {
    setPhase("main");
  }
  function advanceWarmup() {
    setWarmupCursor((c) => {
      const next = c + 1;
      if (next >= warmupItems.length) {
        setPhase("main");
        return c;
      }
      return next;
    });
  }

  function advance() {
    setCursor((c) => c + 1);
  }

  // Keyboard: Enter advances on a committed card; Esc exits.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.key === "Enter") {
        if (cardOutcome && cardOutcome.status !== "open") {
          e.preventDefault();
          advance();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardOutcome, onExit]);

  // ----- Render -----

  if (phase === "warmup" && warmupItems.length > 0) {
    return (
      <WarmupLap
        items={warmupItems}
        cursor={warmupCursor}
        onNext={advanceWarmup}
        onSkip={finishWarmup}
        onExit={onExit}
      />
    );
  }

  if (queue.length === 0) {
    return (
      <div className="libre-practice-session libre-practice-session--empty">
        <div className="libre-practice-session__scroll">
          <div className="libre-practice-session__inner">
            <div className="libre-practice-session__empty-icon" aria-hidden>
              <Icon icon={dumbbell} size="lg" color="currentColor" />
            </div>
            <h2>No items to practice in this slice.</h2>
            <p>
              Try a different mode, widen the course filter, or come back when
              more items are due.
            </p>
            <button className="libre-practice-session__exit" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="libre-practice-session">
        <div className="libre-practice-session__scroll">
          <SessionSummary
            queue={queue}
            outcomes={outcomes}
            elapsedMs={Date.now() - startedAt.current}
            sessionXp={sessionXp}
            bestCombo={bestCombo}
            onExit={onExit}
            onOpenLesson={onOpenLesson}
          />
        </div>
      </div>
    );
  }

  const correctCount = outcomes.filter((o) => o.status === "correct").length;
  const wrongCount = outcomes.filter((o) => o.status === "wrong").length;

  return (
    <div className="libre-practice-session">
      <div className="libre-practice-session__scroll">
        <div className="libre-practice-session__inner">
          <header className="libre-practice-session__header">
            <button
              type="button"
              className="libre-practice-session__back"
              onClick={onExit}
              aria-label="Back to practice deck"
            >
              <Icon icon={arrowLeft} size="xs" color="currentColor" />
              <span>Back</span>
            </button>
            <div className="libre-practice-session__progress">
              <div className="libre-practice-session__pip-row">
                {queue.map((_, i) => (
                  <span
                    key={i}
                    className={
                      "libre-practice-session__pip" +
                      (i === cursor ? " is-current" : "") +
                      (outcomes[i].status === "correct"
                        ? " is-correct"
                        : outcomes[i].status === "wrong"
                          ? " is-wrong"
                          : "")
                    }
                    aria-hidden
                  />
                ))}
              </div>
              <div className="libre-practice-session__progress-label">
                {cursor + 1} / {queue.length} · {MODE_LABELS[mode]}
              </div>
            </div>
            <div className="libre-practice-session__score">
              {combo >= 2 && (
                <span
                  className={
                    "libre-practice-session__combo" +
                    (comboMultiplier(combo) > 1 ? " is-hot" : "")
                  }
                  aria-label={`${combo} correct in a row`}
                >
                  <Icon icon={flame} size="xs" color="currentColor" />
                  <span className="libre-practice-session__combo-n">{combo}</span>
                  {comboMultiplier(combo) > 1 && (
                    <span className="libre-practice-session__combo-mult">
                      {comboMultiplier(combo)}×
                    </span>
                  )}
                </span>
              )}
              <span className="libre-practice-session__score-correct">
                <Icon icon={checkIcon} size="xs" color="currentColor" />{" "}
                {correctCount}
              </span>
              <span className="libre-practice-session__score-wrong">
                <Icon icon={xIcon} size="xs" color="currentColor" />{" "}
                {wrongCount}
              </span>
            </div>
          </header>

          <main className="libre-practice-session__card">
            <div className="libre-practice-session__card-meta">
              <span className="libre-practice-session__course">
                {current.courseTitle}
              </span>
              <span className="libre-practice-session__sep">·</span>
              <span className="libre-practice-session__lesson">
                {current.lessonTitle}
              </span>
              {current.language && (
                <span className="libre-practice-session__lang">
                  {current.language}
                </span>
              )}
            </div>

            {current.kind === "spotbug" && current.spotbug ? (
              <PracticeSpotBug
                key={current.id}
                lines={current.spotbug.lines}
                bugLine={current.spotbug.bugLine}
                original={current.spotbug.original}
                category={current.spotbug.category}
                committed={cardOutcome?.status !== "open"}
                result={
                  cardOutcome?.status === "correct"
                    ? "correct"
                    : cardOutcome?.status === "wrong"
                      ? "wrong"
                      : undefined
                }
                onResult={commitOutcome}
              />
            ) : current.kind === "parsons" && current.parsons ? (
              <PracticeParsons
                key={current.id}
                lines={current.parsons.lines}
                itemId={current.id}
                committed={cardOutcome?.status !== "open"}
                result={
                  cardOutcome?.status === "correct"
                    ? "correct"
                    : cardOutcome?.status === "wrong"
                      ? "wrong"
                      : undefined
                }
                onResult={commitOutcome}
              />
            ) : current.kind === "cloze" && current.cloze ? (
              <PracticeCloze
                key={current.id}
                cloze={current.cloze}
                language={current.language}
                committed={cardOutcome?.status !== "open"}
                result={
                  cardOutcome?.status === "correct"
                    ? "correct"
                    : cardOutcome?.status === "wrong"
                      ? "wrong"
                      : undefined
                }
                onResult={commitOutcome}
              />
            ) : current.kind === "rebuild" && current.rebuild ? (
              <PracticeRebuild
                key={current.id}
                rebuild={current.rebuild}
                itemId={current.id}
                committed={cardOutcome?.status !== "open"}
                result={
                  cardOutcome?.status === "correct"
                    ? "correct"
                    : cardOutcome?.status === "wrong"
                      ? "wrong"
                      : undefined
                }
                onResult={commitOutcome}
              />
            ) : current.kind === "blocks" && current.blocks ? (
              <PracticeBlocks
                key={current.id}
                blocks={current.blocks}
                language={current.language}
                itemId={current.id}
                committed={cardOutcome?.status !== "open"}
                result={
                  cardOutcome?.status === "correct"
                    ? "correct"
                    : cardOutcome?.status === "wrong"
                      ? "wrong"
                      : undefined
                }
                onResult={commitOutcome}
              />
            ) : current.question ? (
              <QuizCard
                key={current.id}
                question={current.question}
                committed={cardOutcome?.status !== "open"}
                onResult={commitOutcome}
              />
            ) : (
              <div className="libre-practice-session__card-error">
                This item couldn't be loaded.
              </div>
            )}

            {cardOutcome && cardOutcome.status !== "open" && (
              <CardFeedback
                outcome={cardOutcome}
                item={current}
                onAdvance={advance}
                onOpenLesson={onOpenLesson}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuizCard — renders MCQ or short-answer.

function QuizCard({
  question,
  committed,
  onResult,
}: {
  question: QuizQuestion;
  committed: boolean;
  onResult: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [shortValue, setShortValue] = useState("");

  function submitMcq(i: number) {
    if (committed) return;
    if (question.kind !== "mcq") return;
    setPicked(i);
    onResult(i === question.correctIndex);
  }

  function submitShort() {
    if (committed) return;
    if (question.kind !== "short") return;
    if (!shortValue.trim()) return;
    const normalized = normalizeAnswer(shortValue);
    const ok = question.accept.some((a) => normalizeAnswer(a) === normalized);
    onResult(ok);
  }

  return (
    <div className="libre-practice-quiz">
      <div className="libre-practice-quiz__prompt">{question.prompt}</div>
      {question.kind === "mcq" ? (
        <div className="libre-practice-quiz__options">
          {question.options.map((opt, i) => {
            const isPicked = i === picked;
            const isCorrect = i === question.correctIndex;
            const klass = [
              "libre-practice-quiz__option",
              committed && isCorrect ? "is-correct" : "",
              committed && isPicked && !isCorrect ? "is-wrong" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={i}
                type="button"
                className={klass}
                onClick={() => submitMcq(i)}
                disabled={committed}
              >
                <span className="libre-practice-quiz__option-letter">
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="libre-practice-quiz__short">
          <input
            type="text"
            className="libre-practice-quiz__short-input"
            value={shortValue}
            onChange={(e) => setShortValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitShort();
            }}
            placeholder="type your answer"
            disabled={committed}
            autoFocus
          />
          <button
            type="button"
            className="libre-practice-quiz__short-submit"
            onClick={submitShort}
            disabled={committed || !shortValue.trim()}
          >
            Check
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardFeedback — shown beneath the card after grading. Holds Next.

function CardFeedback({
  outcome,
  item,
  onAdvance,
  onOpenLesson,
}: {
  outcome: Exclude<CardOutcome, { status: "open" }>;
  item: PracticeItem;
  onAdvance: () => void;
  onOpenLesson?: (courseId: string, lessonId: string) => void;
}) {
  const explanation =
    item.question?.kind === "mcq" || item.question?.kind === "short"
      ? item.question.explanation
      : undefined;
  return (
    <div
      className={
        "libre-practice-feedback" +
        (outcome.status === "correct"
          ? " libre-practice-feedback--correct"
          : " libre-practice-feedback--wrong")
      }
    >
      <div className="libre-practice-feedback__verdict">
        {outcome.status === "correct" ? (
          <>
            <Icon icon={checkIcon} size="sm" color="currentColor" />
            <span>Correct — back in your queue {formatDueIn(outcome.nextDueMs)}</span>
          </>
        ) : (
          <>
            <Icon icon={xIcon} size="sm" color="currentColor" />
            <span>Not quite — you'll see this one again {formatDueIn(outcome.nextDueMs)}</span>
          </>
        )}
      </div>
      {explanation && (
        <div className="libre-practice-feedback__explain">{explanation}</div>
      )}
      <div className="libre-practice-feedback__actions">
        {onOpenLesson && (
          <button
            type="button"
            className="libre-practice-feedback__lesson-link"
            onClick={() => onOpenLesson(item.courseId, item.lessonId)}
          >
            Open original lesson →
          </button>
        )}
        <button
          type="button"
          className="libre-practice-feedback__next"
          onClick={onAdvance}
          autoFocus
        >
          Next
          <Icon icon={arrowRight} size="xs" color="currentColor" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionSummary — end-of-queue recap.

function SessionSummary({
  queue,
  outcomes,
  elapsedMs,
  sessionXp,
  bestCombo,
  onExit,
  onOpenLesson,
}: {
  queue: PracticeItem[];
  outcomes: CardOutcome[];
  elapsedMs: number;
  sessionXp: number;
  bestCombo: number;
  onExit: () => void;
  onOpenLesson?: (courseId: string, lessonId: string) => void;
}) {
  const correct = outcomes.filter((o) => o.status === "correct").length;
  const total = queue.length;
  const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100);
  const wrongItems = useMemo(
    () =>
      queue
        .map((item, i) => ({ item, outcome: outcomes[i] }))
        .filter((p) => p.outcome.status === "wrong"),
    [queue, outcomes],
  );
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));

  return (
    <div className="libre-practice-summary">
      <div className="libre-practice-summary__hero">
        <div className="libre-practice-summary__big">
          {correct}/{total}
        </div>
        <div className="libre-practice-summary__caption">
          {accuracy >= 90
            ? "Strong session — that's the rhythm."
            : accuracy >= 70
              ? "Solid. The misses come back tomorrow."
              : "Some friction here. The deck remembers — those'll cycle back soon."}
        </div>
        <div className="libre-practice-summary__sub">
          {accuracy}% accuracy · {minutes} min
        </div>
        {sessionXp > 0 && (
          <div className="libre-practice-summary__reward">
            <span className="libre-practice-summary__reward-xp">
              +{sessionXp} XP
            </span>
            {bestCombo >= 3 && (
              <span className="libre-practice-summary__reward-combo">
                <Icon icon={flame} size="xs" color="currentColor" /> best run{" "}
                {bestCombo}
              </span>
            )}
          </div>
        )}
      </div>

      {wrongItems.length > 0 && (
        <section className="libre-practice-summary__missed">
          <h3>Items to revisit</h3>
          <ul>
            {wrongItems.map(({ item }) => (
              <li key={item.id}>
                <div className="libre-practice-summary__missed-meta">
                  <span className="libre-practice-summary__missed-course">
                    {item.courseTitle}
                  </span>
                  <span className="libre-practice-summary__missed-sep">·</span>
                  <span>{item.lessonTitle}</span>
                </div>
                {onOpenLesson && (
                  <button
                    type="button"
                    onClick={() => onOpenLesson(item.courseId, item.lessonId)}
                  >
                    Open lesson →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="libre-practice-summary__actions">
        <button
          type="button"
          className="libre-practice-summary__exit"
          onClick={onExit}
        >
          Back to deck
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WarmupLap — the zero-stakes opener. Prompt + the answer already shown,
// one "Got it" tap. No grading, no SRS write, no streak risk — it just
// primes the concepts about to resurface so the first graded card feels
// familiar. Directly answers "the first 60 seconds are too hard."

function WarmupLap({
  items,
  cursor,
  onNext,
  onSkip,
  onExit,
}: {
  items: PracticeItem[];
  cursor: number;
  onNext: () => void;
  onSkip: () => void;
  onExit: () => void;
}) {
  const item = items[cursor];
  if (!item) return null;
  const prompt = item.question?.prompt ?? item.lessonTitle;
  const answer = warmupAnswerText(item);
  return (
    <div className="libre-practice-session libre-practice-warmup">
      <div className="libre-practice-session__scroll">
        <div className="libre-practice-session__inner">
          <header className="libre-practice-session__header">
            <button
              type="button"
              className="libre-practice-session__back"
              onClick={onExit}
              aria-label="Back to practice deck"
            >
              <Icon icon={arrowLeft} size="xs" color="currentColor" />
              <span>Back</span>
            </button>
            <div className="libre-practice-warmup__bar" aria-hidden>
              {items.map((_, i) => (
                <span
                  key={i}
                  className={
                    "libre-practice-warmup__seg" + (i <= cursor ? " is-on" : "")
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="libre-practice-warmup__skip"
              onClick={onSkip}
            >
              Skip warm-up
            </button>
          </header>

          <main className="libre-practice-session__card libre-practice-warmup__card">
            <div className="libre-practice-warmup__tag">
              <Icon icon={flame} size="xs" color="currentColor" />
              Warm-up · no stakes
            </div>
            <div className="libre-practice-warmup__meta">
              {item.courseTitle} · {item.lessonTitle}
            </div>
            <div className="libre-practice-warmup__prompt">{prompt}</div>
            {answer && (
              <div className="libre-practice-warmup__answer">
                <span className="libre-practice-warmup__answer-label">
                  Answer
                </span>
                <span className="libre-practice-warmup__answer-text">
                  {answer}
                </span>
              </div>
            )}
            <button
              type="button"
              className="libre-practice-warmup__got"
              onClick={onNext}
              autoFocus
            >
              Got it
              <Icon icon={arrowRight} size="xs" color="currentColor" />
            </button>
          </main>
        </div>
      </div>
    </div>
  );
}
