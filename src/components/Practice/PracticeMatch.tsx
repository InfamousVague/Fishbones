/// Match Pairs — a fast, low-stakes recognition game built entirely
/// from harvested `mcq` atoms. Each atom contributes two tiles: its
/// prompt and its correct answer. The learner taps a prompt then its
/// answer; a correct pair locks green and grades that atom into the
/// SRS (recognition is a legitimate review signal), a wrong pair
/// flashes and resets the combo — never penalised.
///
/// Why a separate surface instead of a session card: the board IS the
/// session. It reviews several atoms at once, feels like a game rather
/// than a quiz, and is one of the gentlest formats in the app — pure
/// pairing, no typing, no blank-screen failure. It reuses `gradeAttempt`
/// (SRS) and `fireXpBurst` (reward) so progress still counts.

import { useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { flame } from "@base/primitives/icon/icons/flame";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import type { PracticeItem } from "./types";
import { gradeAttempt } from "./practiceStore";
import { fireXpBurst } from "../Shared/XpBurst";
import { comboMultiplier, xpForCorrect } from "./practiceLadder";
import "./PracticeMatch.css";

interface Tile {
  tileId: string;
  itemId: string;
  role: "q" | "a";
  text: string;
}

interface Props {
  /// mcq atoms to build the board from (6-ish). Non-mcq items are
  /// ignored defensively.
  items: PracticeItem[];
  onExit: () => void;
}

/// Build the shuffled tile list once. Two tiles per atom (prompt +
/// correct option), interleaved and shuffled so a prompt is never
/// adjacent to its answer.
function buildTiles(items: PracticeItem[], seed: number): Tile[] {
  const tiles: Tile[] = [];
  for (const it of items) {
    const q = it.question;
    if (!q || q.kind !== "mcq") continue;
    const answer = q.options[q.correctIndex];
    if (answer == null) continue;
    tiles.push({ tileId: `${it.id}:q`, itemId: it.id, role: "q", text: q.prompt });
    tiles.push({ tileId: `${it.id}:a`, itemId: it.id, role: "a", text: answer });
  }
  // Fisher-Yates with a small LCG so a re-render doesn't reshuffle.
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0;
    return s / 4294967296;
  };
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export default function PracticeMatch({ items, onExit }: Props) {
  const startedAt = useRef<number>(Date.now());
  const seed = useRef<number>(Date.now());
  const itemById = useMemo(() => {
    const m = new Map<string, PracticeItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);
  const tiles = useMemo(() => buildTiles(items, seed.current), [items]);
  const totalPairs = tiles.length / 2;

  const [selected, setSelected] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [wrong, setWrong] = useState<[string, string] | null>(null);
  const [combo, setCombo] = useState(0);
  const [moves, setMoves] = useState(0);
  const [score, setScore] = useState(0);
  const locked = wrong !== null;
  const done = matched.size >= totalPairs && totalPairs > 0;

  function tap(tile: Tile) {
    if (locked || done) return;
    if (matched.has(tile.itemId)) return;
    if (selected === null) {
      setSelected(tile.tileId);
      return;
    }
    if (selected === tile.tileId) {
      setSelected(null);
      return;
    }
    const first = tiles.find((t) => t.tileId === selected);
    if (!first) {
      setSelected(tile.tileId);
      return;
    }
    setMoves((m) => m + 1);
    const isPair = first.itemId === tile.itemId && first.role !== tile.role;
    if (isPair) {
      const newCombo = combo + 1;
      setCombo(newCombo);
      const gain = xpForCorrect(newCombo, itemById.get(tile.itemId)?.difficulty);
      setScore((s) => s + gain);
      fireXpBurst(gain);
      const item = itemById.get(tile.itemId);
      if (item) gradeAttempt(item, true);
      setMatched((prev) => {
        const next = new Set(prev);
        next.add(tile.itemId);
        return next;
      });
      setSelected(null);
    } else {
      setCombo(0);
      setWrong([selected, tile.tileId]);
      window.setTimeout(() => {
        setWrong(null);
        setSelected(null);
      }, 650);
    }
  }

  if (totalPairs === 0) {
    return (
      <div className="libre-match libre-match--empty">
        <div className="libre-match__scroll">
          <div className="libre-match__inner">
            <h2>Not enough quiz cards yet.</h2>
            <p>
              Match Pairs needs a few multiple-choice questions from courses
              you've started. Finish a lesson or two and come back.
            </p>
            <button className="libre-match__exit" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const minutes = (Date.now() - startedAt.current) / 60000;
  const accuracy =
    moves === 0 ? 100 : Math.round((totalPairs / Math.max(totalPairs, moves)) * 100);

  return (
    <div className="libre-match">
      <div className="libre-match__scroll">
        <div className="libre-match__inner">
          <header className="libre-match__header">
            <button
              type="button"
              className="libre-match__back"
              onClick={onExit}
              aria-label="Back to practice"
            >
              <Icon icon={arrowLeft} size="xs" color="currentColor" />
              <span>Back</span>
            </button>
            <div className="libre-match__progress">
              Match Pairs · {matched.size}/{totalPairs}
            </div>
            <div className="libre-match__hud">
              {combo >= 2 && (
                <span
                  className={
                    "libre-match__combo" +
                    (comboMultiplier(combo) > 1 ? " is-hot" : "")
                  }
                >
                  <Icon icon={flame} size="xs" color="currentColor" />
                  {combo}
                </span>
              )}
              <span className="libre-match__score">{score} XP</span>
            </div>
          </header>

          {done ? (
            <div className="libre-match__done">
              <div className="libre-match__done-big">{totalPairs} pairs</div>
              <div className="libre-match__done-sub">
                {score} XP · {accuracy}% clean ·{" "}
                {Math.max(1, Math.round(minutes))} min
              </div>
              <button
                type="button"
                className="libre-match__exit"
                onClick={onExit}
              >
                Back to practice
              </button>
            </div>
          ) : (
            <div className="libre-match__grid" role="grid">
              {tiles.map((t) => {
                const isMatched = matched.has(t.itemId);
                const isSelected = selected === t.tileId;
                const isWrong = wrong != null && wrong.includes(t.tileId);
                const klass = [
                  "libre-match__tile",
                  `libre-match__tile--${t.role}`,
                  isMatched ? "is-matched" : "",
                  isSelected ? "is-selected" : "",
                  isWrong ? "is-wrong" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={t.tileId}
                    type="button"
                    className={klass}
                    onClick={() => tap(t)}
                    disabled={isMatched}
                  >
                    {isMatched ? (
                      <Icon icon={checkIcon} size="sm" color="currentColor" />
                    ) : (
                      <span className="libre-match__tile-text">{t.text}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
