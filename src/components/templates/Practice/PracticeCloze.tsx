/// Fill-the-Gap (cloze) — one meaningful token is blanked out of the
/// solution and the learner picks what completes it from four
/// same-class candidates. Pure recognition, one tap: the blank is a
/// visually-distinct chip punched into the code, the options are
/// large tap targets below. Correct → the chip fills with the token;
/// wrong → the learner's pick is flagged and the correct option +
/// filled chip are revealed anyway (the reveal IS the teaching).
///
/// Mirrors the spotbug/parsons card contract (committed / result /
/// onResult) so the session runner + SRS drive it uniformly. The
/// option order arrives pre-shuffled (seeded in `makeClozePuzzle`),
/// so re-renders never reshuffle mid-attempt.

import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { useT } from "@/i18n/i18n";
import type { PracticeItem } from "./types";
import "@base/primitives/icon/icon.css";
import "./PracticeCloze.css";

interface Props {
  /// The cloze payload off the harvested `PracticeItem`. `blankStart`
  /// / `blankLen` index into the ORIGINAL text of `lines[blankLine]`.
  cloze: NonNullable<PracticeItem["cloze"]>;
  committed: boolean;
  result?: "correct" | "wrong";
  onResult: (correct: boolean) => void;
}

export default function PracticeCloze({ cloze, committed, onResult }: Props) {
  const t = useT();
  const { lines, blankLine, blankStart, blankLen, answer, options, category } =
    cloze;
  const [picked, setPicked] = useState<string | null>(null);

  function pick(opt: string) {
    if (committed) return;
    setPicked(opt);
    onResult(opt === answer);
  }

  // Split the blanked line around the token (indices are against the
  // original, un-blanked text — the payload ships the full solution).
  const gapLine = lines[blankLine] ?? "";
  const before = gapLine.slice(0, blankStart);
  const after = gapLine.slice(blankStart + blankLen);

  return (
    <div className="libre-cloze">
      <div className="libre-cloze__hint">{t("practice.clozePrompt")}</div>
      <ol className="libre-cloze__list">
        {lines.map((line, i) => (
          <li
            key={i}
            className={"libre-cloze__line" + (i === blankLine ? " is-gap" : "")}
          >
            <span className="libre-cloze__num">{i + 1}</span>
            {i === blankLine ? (
              <code className="libre-cloze__code">
                {before}
                <span
                  className={
                    "libre-cloze__blank" + (committed ? " is-filled" : "")
                  }
                  // Width hints at the hidden token's length — data-
                  // driven, so inline (same convention as Shiki colours).
                  style={{ minWidth: `${Math.max(3, blankLen)}ch` }}
                >
                  {committed ? answer : ""}
                </span>
                {after}
              </code>
            ) : (
              <code className="libre-cloze__code">{line}</code>
            )}
          </li>
        ))}
      </ol>
      <div className="libre-cloze__options">
        {options.map((opt) => {
          const isAnswer = opt === answer;
          const isMissedPick = committed && opt === picked && !isAnswer;
          const klass = [
            "libre-cloze__option",
            committed && isAnswer ? "is-correct" : "",
            isMissedPick ? "is-wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={opt}
              type="button"
              className={klass}
              onClick={() => pick(opt)}
              disabled={committed}
            >
              <code>{opt}</code>
              {committed && isAnswer && (
                <span className="libre-cloze__mark libre-cloze__mark--right">
                  <Icon icon={checkIcon} size="xs" color="currentColor" />
                </span>
              )}
              {isMissedPick && (
                <span className="libre-cloze__mark libre-cloze__mark--miss">
                  <Icon icon={xIcon} size="xs" color="currentColor" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {committed && (
        <div className="libre-cloze__reveal">
          <span className="libre-cloze__reveal-icon" aria-hidden>
            <Icon icon={checkIcon} size="xs" color="currentColor" />
          </span>
          {t("practice.clozeReveal", { answer, category })}
        </div>
      )}
    </div>
  );
}
