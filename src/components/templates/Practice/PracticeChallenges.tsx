/// Daily mini-challenges strip — three rotating goals ("Perfect 5",
/// "Bug hunter", …) that give a session some texture beyond "clear
/// the due pile".
///
/// Split in two:
///
///   - `usePracticeChallenges(items)` — the TRACKER. Lives at the
///     top of `PracticeView` (which stays mounted while a session
///     runs) so it hears every `libre:practice-graded` event, folds
///     it into the per-day state via the pure `practiceChallenges`
///     module, and persists. If the listener lived inside the strip
///     component it would unmount during sessions and miss every
///     grade — the one moment progress actually happens.
///
///   - `<PracticeChallenges>` — the presentational strip. Renders
///     the three picked challenges with icon, progress "n/target",
///     and a filled check once latched done.
///
/// Kind + language for each grade are derived from the event's item
/// id joined against the live deck (fallback: the id's third segment
/// is the kind — `courseId:lessonId:kind:slug`). The weak set is
/// snapshotted from records at mount, per the challenge's contract:
/// "clear 3 cards that WERE weak when you sat down".

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { award } from "@base/primitives/icon/icons/award";
import { timer } from "@base/primitives/icon/icons/timer";
import { bug } from "@base/primitives/icon/icons/bug";
import { languages } from "@base/primitives/icon/icons/languages";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import type { PracticeItem } from "./types";
import { loadAllRecords } from "./practiceStore";
import {
  CHALLENGE_DEFS,
  challengeDayKey,
  challengeProgress,
  foldGrade,
  loadChallengeState,
  pickDailyChallenges,
  saveChallengeState,
  type ChallengeDayState,
  type ChallengeId,
} from "./practiceChallengeLogic";
import "./PracticeChallenges.css";

const CHALLENGE_ICONS: Record<ChallengeId, string> = {
  perfect5: award,
  speedrun: timer,
  bugHunter: bug,
  polyglot: languages,
  comeback: rotateCcw,
};

// ---------------------------------------------------------------------------
// Tracker hook — call from PracticeView's top level (never unmounts
// while a session runs, so no grade goes unheard).

export function usePracticeChallenges(items: readonly PracticeItem[]): {
  state: ChallengeDayState;
  picked: ChallengeId[];
} {
  const [state, setState] = useState<ChallengeDayState>(() =>
    loadChallengeState(),
  );

  // Weak set snapshot: items whose accuracy had dropped below 60%
  // (with ≥2 attempts) when the view mounted. Snapshotting matters —
  // records update BEFORE the graded event fires, so reading live
  // records inside the handler would see post-answer state.
  const [weakSet] = useState<Set<string>>(() => {
    const weak = new Set<string>();
    loadAllRecords().forEach((rec, id) => {
      if (rec.attempts >= 2 && rec.correct / rec.attempts < 0.6) weak.add(id);
    });
    return weak;
  });

  useEffect(() => {
    const itemsById = new Map(items.map((it) => [it.id, it]));
    function onGraded(ev: Event) {
      const detail = (
        ev as CustomEvent<{ id?: string; correct?: boolean }>
      ).detail;
      // `resetPracticeState` dispatches the same event without a
      // detail — ignore anything that isn't a real grade.
      if (!detail || !detail.id || typeof detail.correct !== "boolean") return;
      const item = itemsById.get(detail.id);
      const grade = {
        correct: detail.correct,
        kind: item?.kind ?? detail.id.split(":")[2],
        language: item?.language,
        isWeak: weakSet.has(detail.id),
        at: Date.now(),
      };
      setState((prev) => {
        const next = foldGrade(prev, grade);
        saveChallengeState(next);
        return next;
      });
    }
    window.addEventListener("libre:practice-graded", onGraded);
    return () => {
      window.removeEventListener("libre:practice-graded", onGraded);
    };
  }, [items, weakSet]);

  const picked = useMemo(
    () => pickDailyChallenges(state.dayKey || challengeDayKey()),
    [state.dayKey],
  );

  return { state, picked };
}

// ---------------------------------------------------------------------------
// Presentational strip.

interface Props {
  state: ChallengeDayState;
  picked: readonly ChallengeId[];
}

export default function PracticeChallenges({ state, picked }: Props) {
  const t = useT();
  return (
    <section className="libre-practice-challenges">
      <div className="libre-practice-section-head">
        <h2 className="libre-practice-section-title">
          {t("practice.challengesTitle")}
        </h2>
      </div>
      <div className="libre-practice-challenge-list" role="list">
        {picked.map((id) => {
          const def = CHALLENGE_DEFS[id];
          const { current, target, done } = challengeProgress(state, id);
          return (
            <div
              key={id}
              className={
                "libre-practice-challenge" +
                (done ? " libre-practice-challenge--done" : "")
              }
              role="listitem"
            >
              <span className="libre-practice-challenge-icon" aria-hidden>
                <Icon
                  icon={done ? checkIcon : CHALLENGE_ICONS[id]}
                  size="base"
                  color="currentColor"
                />
              </span>
              <span className="libre-practice-challenge-text">
                <span className="libre-practice-challenge-title">
                  {t(def.titleKey)}
                </span>
                <span className="libre-practice-challenge-desc">
                  {t(def.descKey)}
                </span>
              </span>
              <span className="libre-practice-challenge-meta">
                {done ? t("practice.challengeDone") : `${current}/${target}`}
              </span>
              <span
                className="libre-practice-challenge-bar"
                aria-hidden
              >
                <span
                  className="libre-practice-challenge-bar-fill"
                  style={{ width: `${(current / target) * 100}%` }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
