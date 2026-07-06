/// Parsons puzzle — "order the lines." A gentler way to review a code
/// exercise than retyping it: the reference solution's lines arrive
/// shuffled and the learner reorders them with up/down controls, then
/// checks. Grading compares the reassembled line sequence to the
/// solution (so interchangeable duplicate lines validate in any order).
///
/// Mirrors PracticeBlocks' card contract (committed / result / onResult)
/// so the session runner drives it the same way as every other format.

import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { chevronUp } from "@base/primitives/icon/icons/chevron-up";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import "./PracticeParsons.css";

interface Props {
  /// The solution's lines in their CORRECT order.
  lines: string[];
  /// Stable id — seeds the initial shuffle so a re-render doesn't
  /// reshuffle mid-attempt.
  itemId: string;
  committed: boolean;
  result?: "correct" | "wrong";
  onResult: (correct: boolean) => void;
}

/// FNV-1a hash → stable per-item shuffle seed.
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/// A shuffled permutation of [0..n) that is guaranteed not to be the
/// identity (so the puzzle never opens already-solved).
function shuffledOrder(n: number, seed: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0;
    return s / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (n > 1 && a.every((v, i) => v === i)) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

export default function PracticeParsons({
  lines,
  itemId,
  committed,
  result,
  onResult,
}: Props) {
  const t = useT();
  const [order, setOrder] = useState<number[]>(() =>
    shuffledOrder(lines.length, hashSeed(itemId)),
  );

  function move(pos: number, dir: -1 | 1) {
    if (committed) return;
    const j = pos + dir;
    if (j < 0 || j >= order.length) return;
    setOrder((prev) => {
      const next = prev.slice();
      [next[pos], next[j]] = [next[j], next[pos]];
      return next;
    });
  }

  function check() {
    if (committed) return;
    // Compare the string AT each position to the string that BELONGS
    // there — duplicate/interchangeable lines validate in any order.
    const correct = order.every((lineIdx, pos) => lines[lineIdx] === lines[pos]);
    onResult(correct);
  }

  return (
    <div className="libre-parsons">
      <div className="libre-parsons__hint">
        {t("practice.parsonsHint")}
      </div>
      <ol className="libre-parsons__list">
        {order.map((lineIdx, pos) => {
          const inPlace = committed && lines[lineIdx] === lines[pos];
          const outOfPlace = committed && lines[lineIdx] !== lines[pos];
          const klass = [
            "libre-parsons__line",
            inPlace ? "is-right" : "",
            outOfPlace ? "is-wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={lineIdx} className={klass}>
              <span className="libre-parsons__num">{pos + 1}</span>
              <code className="libre-parsons__code">{lines[lineIdx]}</code>
              {!committed ? (
                <span className="libre-parsons__arrows">
                  <button
                    type="button"
                    onClick={() => move(pos, -1)}
                    disabled={pos === 0}
                    aria-label={t("practice.ariaMoveLineUp")}
                  >
                    <Icon icon={chevronUp} size="xs" color="currentColor" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(pos, 1)}
                    disabled={pos === order.length - 1}
                    aria-label={t("practice.ariaMoveLineDown")}
                  >
                    <Icon icon={chevronDown} size="xs" color="currentColor" />
                  </button>
                </span>
              ) : inPlace ? (
                <span className="libre-parsons__tick">
                  <Icon icon={checkIcon} size="xs" color="currentColor" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {committed && result === "wrong" && (
        <div className="libre-parsons__solution">
          <span className="libre-parsons__solution-label">{t("practice.correctOrder")}</span>
          <ol>
            {lines.map((l, i) => (
              <li key={i}>
                <code>{l}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
      {!committed && (
        <button
          type="button"
          className="libre-parsons__check"
          onClick={check}
        >
          {t("practice.checkOrder")}
        </button>
      )}
    </div>
  );
}
