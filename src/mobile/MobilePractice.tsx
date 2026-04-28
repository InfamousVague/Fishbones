/// Mobile Practice tab — a HUB, not a flat card stack.
///
/// Two screens, one component:
///
///   1. Hub. The default surface. A featured "Mixed practice" hero
///      card on top (drills from every language the learner has
///      touched), then a grid of per-language tiles below ("Practice
///      Python", "Practice Rust", …). Each tile shows the language's
///      icon, name, and total drill count. Tapping a tile drills into
///      mode #2.
///
///   2. Deck. The actual card stack for the chosen mode. Has a back
///      arrow to return to the hub, the mode title, a shuffle button,
///      and the `MultiLangDeck` render that segments by language so
///      Shiki picks the right grammar per row.
///
/// Why split the surface this way: the previous flat-list design
/// dropped the learner straight into a randomised deck with a horizontal
/// language pill bar — fine if you want to grind, but it didn't
/// communicate "you can practice JUST Python", and the pill row
/// hid behind a horizontal scroll past 4-5 languages. The hub layout
/// surfaces every option as a first-class tappable area, and the
/// deck-mode header keeps the back path obvious.
///
/// Card pool building (collect every `MicroPuzzleCard` from every
/// course's `MicroPuzzleLesson`s, attach the source language + course
/// title for highlighting + breadcrumbs) is unchanged from the old
/// version — only the surface that picks a sub-pool is new. Stats /
/// XP / completion records aren't touched here; this is a drill
/// surface, not a progression one.

import { useEffect, useMemo, useState } from "react";
import type {
  Course,
  LanguageId,
  MicroPuzzleCard,
  MicroPuzzleLesson,
} from "../data/types";
import { isMicroPuzzle } from "../data/types";
import { Icon } from "@base/primitives/icon";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import { shuffle as shuffleIcon } from "@base/primitives/icon/icons/shuffle";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { sun } from "@base/primitives/icon/icons/sun";
import { chevronLeft } from "@base/primitives/icon/icons/chevron-left";
import LanguageChip from "../components/LanguageChip/LanguageChip";
import MobileMicroPuzzle from "./MobileMicroPuzzle";
import { usePracticeHistory } from "../hooks/usePracticeHistory";
import "./MobilePractice.css";

interface Props {
  courses: Course[];
  /// Completion set keyed `${courseId}:${lessonId}` (same shape the
  /// rest of the mobile UI uses). Drives "covered" language detection
  /// for the Mixed-practice card's "languages you've touched" copy.
  completed: Set<string>;
}

/// One card in the practice deck. Carries the source language so the
/// renderer picks the right Shiki grammar per row, plus the source
/// course title for a small breadcrumb above each card.
interface DeckCard {
  card: MicroPuzzleCard;
  language: LanguageId;
  courseTitle: string;
}

/// What the hub picked.
///   - `mixed` rolls every covered language together (or every
///     language with cards if no completions yet).
///   - `daily` builds a curated 15-card session from the
///     spaced-repetition state — due cards, then concept gaps, then
///     reinforcement. The Daily tile only appears once the learner
///     has any practice history at all.
///   - A `LanguageId` filters to that one language's cards only.
type Mode =
  | { kind: "hub" }
  | { kind: "deck"; filter: "mixed" | "daily" | LanguageId; title: string };

const DECK_SIZE = 15;

const LANG_LABELS: Partial<Record<LanguageId, string>> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  reactnative: "React Native",
  svelte: "Svelte",
  solid: "Solid",
  htmx: "HTMX",
  astro: "Astro",
  bun: "Bun",
  solidity: "Solidity",
  vyper: "Vyper",
  c: "C",
  cpp: "C++",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  swift: "Swift",
  assembly: "Assembly",
  threejs: "Three.js",
};

function labelFor(id: LanguageId): string {
  return LANG_LABELS[id] ?? id;
}

export default function MobilePractice({ courses, completed }: Props) {
  // Per-device practice history (localStorage-backed). Drives the
  // Daily session's deck building and lets us record attempt
  // outcomes for spaced-repetition scheduling.
  const practiceHistory = usePracticeHistory();
  // -------- card pool (unchanged from the previous design) -----------
  const allCards = useMemo<DeckCard[]>(() => {
    const out: DeckCard[] = [];
    for (const c of courses) {
      for (const ch of c.chapters) {
        for (const lesson of ch.lessons) {
          if (!isMicroPuzzle(lesson)) continue;
          const mp = lesson as MicroPuzzleLesson;
          for (const card of mp.challenges) {
            // Skip degenerate zero-blank "context" cards — they don't
            // exercise anything in practice mode.
            if (!card.blanks || card.blanks.length === 0) continue;
            out.push({ card, language: mp.language, courseTitle: c.title });
          }
        }
      }
    }
    return out;
  }, [courses]);

  // Per-language pool for the hub tiles + the Mixed-card languages
  // breadcrumb. Built once per card-pool change.
  const cardsByLang = useMemo<Map<LanguageId, number>>(() => {
    const m = new Map<LanguageId, number>();
    for (const c of allCards) m.set(c.language, (m.get(c.language) ?? 0) + 1);
    return m;
  }, [allCards]);

  // Languages that actually have cards available — these become the
  // hub tiles. Sorted by drill count descending so the language with
  // the most practice material reads first.
  const availableLangs = useMemo<LanguageId[]>(() => {
    return Array.from(cardsByLang.keys()).sort(
      (a, b) => (cardsByLang.get(b) ?? 0) - (cardsByLang.get(a) ?? 0),
    );
  }, [cardsByLang]);

  // Languages the learner has touched (any completion in a course of
  // that language). Empty on first launch → Mixed falls back to "every
  // language with cards" so the screen still has something to drill.
  const coveredLangs = useMemo<Set<LanguageId>>(() => {
    const out = new Set<LanguageId>();
    for (const c of courses) {
      const hasCompletion = c.chapters.some((ch) =>
        ch.lessons.some((l) => completed.has(`${c.id}:${l.id}`)),
      );
      if (hasCompletion) out.add(c.language);
    }
    return out;
  }, [courses, completed]);

  // -------- mode state ------------------------------------------------
  const [mode, setMode] = useState<Mode>({ kind: "hub" });
  // Bumps every time the user taps Shuffle (or re-enters the same
  // deck). Used as a useMemo dep so the deck re-shuffles per click
  // rather than every parent render.
  const [shuffleNonce, setShuffleNonce] = useState(0);

  // If the active mode is a per-language deck and that language
  // disappears from the pool (courses re-hydrating with different
  // contents), bounce back to the hub rather than rendering an empty
  // deck with no recovery path.
  useEffect(() => {
    if (mode.kind !== "deck") return;
    if (mode.filter === "mixed" || mode.filter === "daily") return;
    if (!availableLangs.includes(mode.filter)) {
      setMode({ kind: "hub" });
    }
  }, [mode, availableLangs]);

  // -------- deck builder ---------------------------------------------
  const deck = useMemo<DeckCard[]>(() => {
    if (mode.kind !== "deck") return [];
    // Daily mode: hand the candidate pool to the practice-history
    // hook and let its scheduler build the session. The pool is
    // every covered card (or all cards on a fresh account) — the
    // hook handles due-vs-unattempted-vs-reinforce mixing.
    if (mode.filter === "daily") {
      const candidatePool = coveredLangs.size > 0
        ? allCards.filter((c) => coveredLangs.has(c.language))
        : allCards;
      return practiceHistory.dailyDeck(candidatePool, DECK_SIZE);
    }
    let pool: DeckCard[];
    if (mode.filter === "mixed") {
      pool = coveredLangs.size > 0
        ? allCards.filter((c) => coveredLangs.has(c.language))
        : allCards;
    } else {
      // Narrow away `"daily"` (handled above) so TS sees a
      // LanguageId here.
      const lang = mode.filter as LanguageId;
      pool = allCards.filter((c) => c.language === lang);
    }
    // Fisher-Yates seeded with shuffleNonce so the same nonce gives
    // the same order — keeps useMemo deterministic across re-renders.
    const out = [...pool];
    let seed = shuffleNonce * 9301 + 49297;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.slice(0, DECK_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, allCards, coveredLangs, shuffleNonce, practiceHistory.byCard]);

  // Stable key for forcing MicroPuzzle remount per shuffle / mode pick.
  const deckKey =
    mode.kind === "deck" ? `${mode.filter}::${shuffleNonce}` : "hub";

  // -------- empty-state branch (no cards anywhere yet) ---------------
  const hasAnyCards = allCards.length > 0;

  // -------- mode handlers --------------------------------------------
  const enterMixed = () => {
    setMode({ kind: "deck", filter: "mixed", title: "Mixed practice" });
    setShuffleNonce((n) => n + 1);
  };
  const enterDaily = () => {
    setMode({ kind: "deck", filter: "daily", title: "Daily session" });
    setShuffleNonce((n) => n + 1);
  };
  const enterLanguage = (lang: LanguageId) => {
    setMode({ kind: "deck", filter: lang, title: `${labelFor(lang)} practice` });
    setShuffleNonce((n) => n + 1);
  };
  const backToHub = () => setMode({ kind: "hub" });

  // Daily tile preview — count of cards due RIGHT NOW. Drives the
  // urgency badge on the Daily hero and the disabled state when
  // there's nothing due (we still let learners click through —
  // they get the "X cards due, plus M unattempted" mix).
  const dueCount = useMemo(
    () => practiceHistory.dueCards(allCards).length,
    [practiceHistory, allCards],
  );
  const totalAttempts = useMemo(
    () =>
      Object.values(practiceHistory.byCard).reduce(
        (acc, s) => acc + s.attempts,
        0,
      ),
    [practiceHistory.byCard],
  );

  // -------- render ---------------------------------------------------
  if (mode.kind === "deck") {
    return (
      <DeckView
        title={mode.title}
        deck={deck}
        deckKey={deckKey}
        onBack={backToHub}
        onShuffle={() => setShuffleNonce((n) => n + 1)}
        onAttempt={practiceHistory.log}
      />
    );
  }

  // Hub render path.
  const mixedPool = coveredLangs.size > 0
    ? allCards.filter((c) => coveredLangs.has(c.language))
    : allCards;
  const mixedSubtitle =
    coveredLangs.size > 0
      ? `${mixedPool.length} drills from ${coveredLangs.size} language${coveredLangs.size === 1 ? "" : "s"} you've touched.`
      : `${mixedPool.length} drills across the catalog. Touch a course to focus this on what you're learning.`;

  return (
    <div className="m-prac">
      <header className="m-prac__head">
        <div className="m-prac__head-text">
          <h1 className="m-prac__title">
            <Icon icon={dumbbell} size="sm" color="currentColor" />
            <span>Practice</span>
          </h1>
          <p className="m-prac__subtitle">
            Pick what to drill — the whole catalog, or a single language.
          </p>
        </div>
      </header>

      {!hasAnyCards && (
        <p className="m-prac__empty">
          No drills available yet. Once a course with micro-puzzles
          finishes loading, the Practice tab will fill in.
        </p>
      )}

      {hasAnyCards && (
        <>
          {/* Daily session hero — the "smart" path. Pulls from the */}
          {/* spaced-repetition state: due cards first, then concept */}
          {/* gaps the learner hasn't seen yet, then gentle */}
          {/* reinforcement of recent hits. We always show this tile */}
          {/* (a fresh account just gets a deck of all-unattempted */}
          {/* cards, which is a great onboarding session). */}
          <button
            type="button"
            className="m-prac__hero m-prac__hero--daily"
            onClick={enterDaily}
            disabled={mixedPool.length === 0}
          >
            <span className="m-prac__hero-glyph" aria-hidden>
              <Icon icon={sun} size="base" color="currentColor" />
            </span>
            <span className="m-prac__hero-body">
              <span className="m-prac__hero-title">Daily session</span>
              <span className="m-prac__hero-sub">
                {totalAttempts === 0
                  ? `15 fresh cards across ${coveredLangs.size > 0 ? "your covered languages" : "the catalog"} to get rolling.`
                  : dueCount > 0
                    ? `${dueCount} card${dueCount === 1 ? "" : "s"} due now, plus new + reinforcement.`
                    : `Review pass — strengthening what you've already nailed.`}
              </span>
            </span>
            <span className="m-prac__hero-count">
              {Math.min(DECK_SIZE, mixedPool.length)}
            </span>
          </button>

          {/* Mixed-practice hero — pure shuffle across the covered */}
          {/* pool. Useful when the learner wants to drill a different */}
          {/* slice than the daily algorithm picks. */}
          <button
            type="button"
            className="m-prac__hero"
            onClick={enterMixed}
            disabled={mixedPool.length === 0}
          >
            <span className="m-prac__hero-glyph" aria-hidden>
              <Icon icon={sparkles} size="base" color="currentColor" />
            </span>
            <span className="m-prac__hero-body">
              <span className="m-prac__hero-title">Mixed practice</span>
              <span className="m-prac__hero-sub">{mixedSubtitle}</span>
            </span>
            <span className="m-prac__hero-count">
              {mixedPool.length}
            </span>
          </button>

          {/* Per-language tiles. Only render the section when there's */}
          {/* more than one language in the pool — for a single-language */}
          {/* learner, "Mixed" + "Practice X" are the same thing and the */}
          {/* extra row is just noise. */}
          {availableLangs.length > 1 && (
            <section className="m-prac__section">
              <h2 className="m-prac__section-title">By language</h2>
              <ul className="m-prac__grid" role="list">
                {availableLangs.map((lang) => (
                  <li key={lang} className="m-prac__cell">
                    <button
                      type="button"
                      className={`m-prac__tile${coveredLangs.has(lang) ? " m-prac__tile--covered" : ""}`}
                      onClick={() => enterLanguage(lang)}
                    >
                      <span className="m-prac__tile-icon" aria-hidden>
                        <LanguageChip
                          language={lang}
                          size="md"
                          iconOnly
                          className="m-prac__tile-chip"
                        />
                      </span>
                      <span className="m-prac__tile-text">
                        <span className="m-prac__tile-title">
                          {labelFor(lang)}
                        </span>
                        <span className="m-prac__tile-meta">
                          {cardsByLang.get(lang) ?? 0} drill
                          {(cardsByLang.get(lang) ?? 0) === 1 ? "" : "s"}
                          {coveredLangs.has(lang) && " · covered"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/// Deck-mode header + card stack. Lives as a separate component
/// because the hub's layout is so different that conditional JSX
/// in one return became unreadable.
function DeckView({
  title,
  deck,
  deckKey,
  onBack,
  onShuffle,
  onAttempt,
}: {
  title: string;
  deck: DeckCard[];
  deckKey: string;
  onBack: () => void;
  onShuffle: () => void;
  onAttempt: (cardId: string, correct: boolean) => void;
}) {
  return (
    <div className="m-prac">
      <header className="m-prac__deck-head">
        <button
          type="button"
          className="m-prac__back"
          onClick={onBack}
          aria-label="Back to practice menu"
        >
          <Icon icon={chevronLeft} size="sm" color="currentColor" />
        </button>
        <h1 className="m-prac__deck-title">{title}</h1>
        <button
          type="button"
          className="m-prac__shuffle"
          onClick={onShuffle}
          aria-label="Shuffle the deck"
          disabled={deck.length === 0}
        >
          <Icon icon={shuffleIcon} size="sm" color="currentColor" />
        </button>
      </header>

      {deck.length === 0 ? (
        <p className="m-prac__empty">
          No drills match this mode. Pop back to the menu and try a
          different language.
        </p>
      ) : (
        <MultiLangDeck deck={deck} keyHint={deckKey} onAttempt={onAttempt} />
      )}
    </div>
  );
}

/// Render a deck that may contain cards from different languages by
/// segmenting consecutive same-language runs. Each segment is its own
/// `<MobileMicroPuzzle>` so Shiki picks the right grammar per card —
/// without this, a Python card surrounded by JS cards would highlight
/// as JS. Each segment remounts on shuffle via the composite key.
function MultiLangDeck({
  deck,
  keyHint,
  onAttempt,
}: {
  deck: DeckCard[];
  keyHint: string;
  onAttempt?: (cardId: string, correct: boolean) => void;
}) {
  const segments = useMemo(() => {
    const out: Array<{
      language: LanguageId;
      cards: MicroPuzzleCard[];
      courseTitles: string[];
    }> = [];
    for (const dc of deck) {
      const last = out[out.length - 1];
      if (last && last.language === dc.language) {
        last.cards.push(dc.card);
        last.courseTitles.push(dc.courseTitle);
      } else {
        out.push({
          language: dc.language,
          cards: [dc.card],
          courseTitles: [dc.courseTitle],
        });
      }
    }
    return out;
  }, [deck]);

  return (
    <div className="m-prac__deck">
      {segments.map((seg, i) => (
        <MobileMicroPuzzle
          key={`${keyHint}::${i}::${seg.language}`}
          challenges={seg.cards}
          language={seg.language}
          prompt={undefined}
          onAttempt={onAttempt}
        />
      ))}
    </div>
  );
}
