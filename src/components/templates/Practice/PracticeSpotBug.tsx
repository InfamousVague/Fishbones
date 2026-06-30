/// Spot-the-Bug — pure recognition, one tap. A solution with exactly
/// one line mutated into a subtle bug (flipped comparison, inverted
/// boolean, swapped logical operator). The learner taps the line they
/// think is wrong; on reveal, the real bug line is highlighted and the
/// correct line is shown. One of the gentlest formats — no typing, no
/// blank screen, a guaranteed tap target.
///
/// Mirrors the blocks/parsons card contract (committed / result /
/// onResult) so the session runner + SRS drive it uniformly.

import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import "./PracticeSpotBug.css";

interface Props {
  /// Lines WITH the bug applied (one differs from the original).
  lines: string[];
  /// Index of the buggy line — the correct tap.
  bugLine: number;
  /// The correct (pre-mutation) text of the buggy line.
  original: string;
  /// Short bug-class label, e.g. "comparison operator".
  category: string;
  committed: boolean;
  result?: "correct" | "wrong";
  onResult: (correct: boolean) => void;
}

export default function PracticeSpotBug({
  lines,
  bugLine,
  original,
  category,
  committed,
  onResult,
}: Props) {
  const [tapped, setTapped] = useState<number | null>(null);

  function tap(i: number) {
    if (committed) return;
    setTapped(i);
    onResult(i === bugLine);
  }

  return (
    <div className="libre-spotbug">
      <div className="libre-spotbug__hint">
        One line has a bug — tap the line you think is wrong.
      </div>
      <ol className="libre-spotbug__list">
        {lines.map((line, i) => {
          const isBug = committed && i === bugLine;
          const isMissedPick = committed && i === tapped && i !== bugLine;
          const klass = [
            "libre-spotbug__line",
            isBug ? "is-bug" : "",
            isMissedPick ? "is-miss" : "",
            !committed && i === tapped ? "is-tapped" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={i}>
              <button
                type="button"
                className={klass}
                onClick={() => tap(i)}
                disabled={committed}
              >
                <span className="libre-spotbug__num">{i + 1}</span>
                <code className="libre-spotbug__code">{line}</code>
                {isBug && (
                  <span className="libre-spotbug__mark libre-spotbug__mark--bug">
                    <Icon icon={xIcon} size="xs" color="currentColor" />
                  </span>
                )}
                {isMissedPick && (
                  <span className="libre-spotbug__mark libre-spotbug__mark--miss">
                    <Icon icon={xIcon} size="xs" color="currentColor" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {committed && (
        <div className="libre-spotbug__reveal">
          <span className="libre-spotbug__cat">
            <Icon icon={checkIcon} size="xs" color="currentColor" /> {category}
          </span>
          <div className="libre-spotbug__fix">
            <span className="libre-spotbug__fix-label">Should be</span>
            <code>{original}</code>
          </div>
        </div>
      )}
    </div>
  );
}
