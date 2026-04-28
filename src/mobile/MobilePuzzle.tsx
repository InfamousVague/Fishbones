/// Mobile puzzle. Two stacks:
///   - Pool (top) — shuffled blocks the user hasn't placed yet.
///   - Stage (bottom) — ordered blocks the user has committed.
/// Tap a pool block → it moves to the bottom of the stage.
/// Tap a staged block → it pops back to the pool.
///
/// Done state: stage matches `solutionOrder`. We compare ids, so
/// distractors that aren't in `solutionOrder` are simply never
/// "correct" if staged. On match, fire onComplete; on mismatch when
/// pool is empty, show "not quite" + reset button.

import { useMemo, useState } from "react";
import type { PuzzleBlock } from "../data/types";
import "./MobilePuzzle.css";

interface Props {
  blocks: PuzzleBlock[];
  solutionOrder: string[];
  prompt?: string;
  /// Optional now — the lesson's bottom Next nav owns "mark complete
  /// + advance". MobilePuzzle just validates the staged order.
  onComplete?: () => void;
  /// Same as above; unused locally but kept on the prop shape so
  /// the dispatch can pass it without a per-kind branch.
  isCompleted?: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MobilePuzzle({
  blocks,
  solutionOrder,
  prompt,
}: Props) {
  // Shuffle once per mount — re-mounting (e.g. via reset) re-shuffles.
  const initialPool = useMemo(() => shuffle(blocks), [blocks]);
  const [pool, setPool] = useState<PuzzleBlock[]>(initialPool);
  const [stage, setStage] = useState<PuzzleBlock[]>([]);
  const [checked, setChecked] = useState<"pending" | "correct" | "wrong">(
    "pending",
  );

  const stageBlock = (b: PuzzleBlock) => {
    if (checked !== "pending") return;
    setPool(pool.filter((p) => p.id !== b.id));
    setStage([...stage, b]);
  };

  const unstageBlock = (b: PuzzleBlock) => {
    if (checked !== "pending") return;
    setStage(stage.filter((s) => s.id !== b.id));
    setPool([...pool, b]);
  };

  const check = () => {
    const ids = stage.map((s) => s.id);
    const matches =
      ids.length === solutionOrder.length &&
      ids.every((id, i) => id === solutionOrder[i]);
    setChecked(matches ? "correct" : "wrong");
    // Don't fire onComplete here — the lesson dispatch's bottom Next
    // owns "mark complete + advance" now (same model as desktop's
    // handleNext). This action only validates; the user reads the
    // "Correct." feedback and taps Next when they're ready.
  };

  const reset = () => {
    setPool(shuffle(blocks));
    setStage([]);
    setChecked("pending");
  };

  return (
    <div className="m-puzzle">
      {prompt && (
        <p className="m-puzzle__prompt">
          {/* Strip markdown from a body if it bled in — keep it terse. */}
          {prompt.length > 240 ? prompt.slice(0, 240) + "…" : prompt}
        </p>
      )}

      <section className="m-puzzle__section" aria-label="Your solution">
        <h3 className="m-puzzle__section-title">Your solution</h3>
        <ol className="m-puzzle__list m-puzzle__list--stage">
          {stage.length === 0 && (
            <li className="m-puzzle__empty">Tap blocks below to add them here.</li>
          )}
          {stage.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="m-puzzle__block m-puzzle__block--staged"
                onClick={() => unstageBlock(b)}
                disabled={checked === "correct"}
              >
                <pre>{b.code}</pre>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="m-puzzle__section" aria-label="Available blocks">
        <h3 className="m-puzzle__section-title">Blocks</h3>
        <ul className="m-puzzle__list">
          {pool.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="m-puzzle__block"
                onClick={() => stageBlock(b)}
                disabled={checked === "correct"}
              >
                <pre>{b.code}</pre>
              </button>
            </li>
          ))}
          {pool.length === 0 && stage.length > 0 && checked === "pending" && (
            <li className="m-puzzle__empty">All blocks placed. Check your solution.</li>
          )}
        </ul>
      </section>

      {checked === "wrong" && (
        <p className="m-puzzle__feedback m-puzzle__feedback--wrong">
          Not quite — tap a block to send it back and try a different order.
        </p>
      )}
      {checked === "correct" && (
        <p className="m-puzzle__feedback m-puzzle__feedback--correct">
          Correct.
        </p>
      )}

      <div className="m-puzzle__actions">
        {/* No more "Next lesson" inline button — once the puzzle reads
            "Correct." the user taps the lesson's bottom Next to mark
            complete + advance. We keep Reset visible after a wrong
            check so the learner can re-stage; we hide it after
            correct because there's nothing to redo. */}
        {checked !== "correct" && (
          <button
            type="button"
            className="m-puzzle__btn m-puzzle__btn--ghost"
            onClick={reset}
            disabled={stage.length === 0}
          >
            Reset
          </button>
        )}
        {checked !== "correct" && (
          <button
            type="button"
            className="m-puzzle__btn m-puzzle__btn--primary"
            onClick={check}
            disabled={stage.length === 0}
          >
            Check
          </button>
        )}
      </div>
    </div>
  );
}
