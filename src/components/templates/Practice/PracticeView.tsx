/// Practice route — landing surface for the spaced-review feature.
///
/// Three states owned by this component:
///
///   1. **Deck view** (default): hero with due-counter ring, the
///      dashboard (goal ring / streak / accuracy / activity), the
///      practice-type tiles, a single big primary CTA, daily
///      mini-challenges, recent-misses revisit list, and a collapsed
///      customize panel for tweaking mode / course / kind / length
///      filters. Designed to feel like one tap away from a session —
///      defaults are good, the controls only appear if the learner
///      asks for them.
///
///   2. **Session view**: full-screen runner that owns the queue
///      cursor and grading. Returning from the session lands back
///      in the deck view with refreshed stats.
///
///   3. **Gate**: the deck is strictly harvested from COMPLETED
///      lessons; with fewer than five atoms the body swaps for a
///      "practice unlocks as you learn" panel whose CTA routes to
///      the next unfinished lesson.
///
/// We deliberately keep PracticeView small. The primary tap is the
/// "Start practice" button at the top; everything else is either
/// stats (read-only context) or settings (collapsed).
///
/// Visual language mirrors `<ProfileView>`: same scroll wrapper
/// pattern, same `--color-*` tokens, same color-toned stat tiles
/// and section-title vocabulary.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { dumbbell } from "@base/primitives/icon/icons/dumbbell";
import { hand } from "@base/primitives/icon/icons/hand";
import { clock } from "@base/primitives/icon/icons/clock";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { sliders } from "@base/primitives/icon/icons/sliders";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { chevronUp } from "@base/primitives/icon/icons/chevron-up";
import { brain } from "@base/primitives/icon/icons/brain";
import { listChecks } from "@base/primitives/icon/icons/list-checks";
import { pencil } from "@base/primitives/icon/icons/pencil";
import { puzzle } from "@base/primitives/icon/icons/puzzle";
import { listOrdered } from "@base/primitives/icon/icons/list-ordered";
import { bug } from "@base/primitives/icon/icons/bug";
import { textCursorInput } from "@base/primitives/icon/icons/text-cursor-input";
import { target } from "@base/primitives/icon/icons/target";
import { flame } from "@base/primitives/icon/icons/flame";
import { shuffle } from "@base/primitives/icon/icons/shuffle";
import "@base/primitives/icon/icon.css";
import type { Course } from "@/data/types";
import type { Completion } from "@/hooks/useProgress";
import {
  groupItemsByCourse,
  harvestPracticeItems,
} from "./practiceHarvest";
import {
  buildQueue,
  MODE_BLURBS,
  MODE_LABELS,
  type PracticeMode,
} from "./practiceQueue";
import { loadAllRecords, summariseStats } from "./practiceStore";
import { pickWarmupItems } from "./practiceLadder";
import type { PracticeItem, PracticeRecord, PracticeStats } from "./types";
import PracticeSession from "./PracticeSession";
import PracticeMatch from "./PracticeMatch";
import PracticeDashboard from "./PracticeDashboard";
import PracticeChallenges, {
  usePracticeChallenges,
} from "./PracticeChallenges";
import { grid2x2 } from "@base/primitives/icon/icons/grid-2x2";
import { useT } from "@/i18n/i18n";
import "./PracticeView.css";

interface Props {
  courses: readonly Course[];
  /// `${courseId}:${lessonId}` set — same shape used everywhere
  /// else for completion tracking. Drives the harvester's
  /// "courses the learner has touched" filter.
  completed: Set<string>;
  /// Completion history — accepted for API compatibility with the
  /// hosts (both App and MobileApp pass it). The old empty state
  /// used it for "newly learned" hints; the learned-material gate
  /// derives everything it needs from `courses` + `completed`.
  history?: readonly Completion[];
  /// Forwarded to the session so card feedback can deep-link
  /// back to the originating lesson.
  onOpenLesson?: (courseId: string, lessonId: string) => void;
  /// Open the Monkey's Paw — adversarial test-writing duels. The Paw
  /// lives under Practice as a practice TYPE (its rail chip was
  /// retired); the mode cards at the top of this page route there.
  onMonkeysPaw?: () => void;
  /// Auto-start a review session on mount (the "welcome back" nudge
  /// banner routes here with this set). Skipped when the learned-
  /// material gate isn't met — the page then just shows normally.
  autoStart?: boolean;
  /// Optional scope for the auto-started session: `${courseId}:${lessonId}`
  /// keys (the recent-review chapters' completed lessons — see
  /// recentReview.ts). When set, the session drills ONLY those atoms —
  /// "review what you learned last time", not the whole multi-language
  /// deck. Falls back to the full deck if the scope is too thin.
  autoStartLessonKeys?: ReadonlySet<string>;
  /// Fired when an AUTO-STARTED session exits (finish or leave) — the
  /// host uses it to return the learner to where they were before the
  /// nudge. Manual sessions never fire it.
  onAutoSessionExit?: () => void;
}

const SESSION_LIMITS = [5, 10, 25] as const;

/// The deck is strictly lesson-gated now — with fewer than this many
/// harvested atoms the page shows the "keep learning" gate instead
/// of a deck that would recycle the same two cards forever.
const GATE_MIN_ITEMS = 5;

const KIND_LABEL_KEYS: Record<PracticeItem["kind"], string> = {
  mcq: "practice.kindMcq",
  short: "practice.kindShort",
  blocks: "practice.kindBlocks",
  parsons: "practice.kindParsons",
  spotbug: "practice.kindSpotbug",
  cloze: "practice.clozeTitle",
  rebuild: "practice.rebuildTitle",
};

/// Icon per item kind — shown on the customize kind pills so the
/// vocabulary matches the session cards' headers.
const KIND_ICONS: Record<PracticeItem["kind"], string> = {
  mcq: listChecks,
  short: pencil,
  blocks: puzzle,
  parsons: listOrdered,
  spotbug: bug,
  cloze: textCursorInput,
  rebuild: brain,
};

/// Icon per queue mode — shown on the customize mode pills.
const MODE_ICONS: Record<PracticeMode, string> = {
  smart: sparkles,
  due: target,
  weak: flame,
  recent: clock,
  random: shuffle,
};

export default function PracticeView({
  courses,
  completed,
  onOpenLesson,
  onMonkeysPaw,
  autoStart,
  autoStartLessonKeys,
  onAutoSessionExit,
}: Props) {
  const t = useT();
  // Harvest is cheap; rerun whenever the inputs change so author
  // edits / new completions take effect without a refresh.
  const items = useMemo(
    () => harvestPracticeItems(courses, completed),
    [courses, completed],
  );

  // Records reload on a custom event the store dispatches after
  // each grade — that lets the session's grading update the deck
  // header live without prop drilling.
  const [records, setRecords] = useState<Map<string, PracticeRecord>>(() =>
    loadAllRecords(),
  );
  useEffect(() => {
    function refresh() {
      setRecords(loadAllRecords());
    }
    window.addEventListener("libre:practice-graded", refresh);
    return () => {
      window.removeEventListener("libre:practice-graded", refresh);
    };
  }, []);

  const stats: PracticeStats = useMemo(
    () => summariseStats(items, records),
    [items, records],
  );

  const courseGroups = useMemo(() => groupItemsByCourse(items), [items]);

  // Daily mini-challenges tracker. Lives HERE (not inside the strip
  // component) because PracticeView stays mounted while a session
  // runs — the strip itself unmounts, and grades only happen during
  // sessions.
  const challenges = usePracticeChallenges(items);

  // Per-kind deck counts — drive the kind pills (hidden at 0) and
  // the first-class cloze / rebuild tiles (disabled at 0).
  const kindCounts = useMemo(() => {
    const counts = new Map<PracticeItem["kind"], number>();
    for (const it of items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
    return counts;
  }, [items]);

  // First not-yet-completed lesson, in course order — the gate's
  // "Browse courses" CTA target. Practice's only navigation
  // affordance is `onOpenLesson`, so the CTA reuses it to drop the
  // learner into the next thing to learn.
  const nextLesson = useMemo(() => {
    for (const course of courses) {
      for (const chapter of course.chapters) {
        for (const lesson of chapter.lessons) {
          if (!completed.has(`${course.id}:${lesson.id}`)) {
            return { courseId: course.id, lessonId: lesson.id };
          }
        }
      }
    }
    return null;
  }, [courses, completed]);

  // ----- Filter state (everything below the hero is "advanced"
  // and sits behind the Customize toggle by default). -----
  const [mode, setMode] = useState<PracticeMode>("smart");
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedKinds, setSelectedKinds] = useState<
    Set<PracticeItem["kind"]>
  >(() => new Set());
  const [sessionLength, setSessionLength] = useState<number>(10);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // Deck preview — count of cards that would actually be played.
  const previewSeed = hashSig(
    mode +
      ":" +
      Array.from(selectedCourses).sort().join(",") +
      ":" +
      Array.from(selectedKinds).sort().join(","),
  );
  const previewQueue = useMemo(
    () =>
      buildQueue(mode, items, records, {
        limit: sessionLength,
        courseIds: selectedCourses,
        kinds: selectedKinds,
        seed: previewSeed,
        now: Date.now(),
      }),
    [mode, items, records, sessionLength, selectedCourses, selectedKinds, previewSeed],
  );

  // Recent misses to revisit. Walk every record, find ones the
  // learner failed (most recent first), join against items so we
  // can show course + lesson titles, cap to 6.
  const recentMisses = useMemo(() => {
    const itemsById = new Map(items.map((it) => [it.id, it]));
    const misses: Array<{ item: PracticeItem; rec: PracticeRecord }> = [];
    records.forEach((rec) => {
      const item = itemsById.get(rec.id);
      if (!item) return;
      // "Missed recently" = last attempt was a miss → streak === 0
      // AND attempts > correct (i.e. at least one wrong).
      if (rec.streak !== 0) return;
      if (rec.attempts <= rec.correct) return;
      misses.push({ item, rec });
    });
    misses.sort((a, b) => b.rec.lastSeen - a.rec.lastSeen);
    return misses.slice(0, 6);
  }, [items, records]);

  // ----- Session state -----
  const [activeQueue, setActiveQueue] = useState<PracticeItem[] | null>(null);
  const [activeWarmup, setActiveWarmup] = useState<PracticeItem[]>([]);
  const [activeMatch, setActiveMatch] = useState<PracticeItem[] | null>(null);

  // Match Pairs draws from mcq atoms only (prompt ↔ correct option).
  const mcqItems = useMemo(() => items.filter((i) => i.kind === "mcq"), [items]);

  function startMatch() {
    // Up to 6 pairs, biasing toward due/recently-seen for review value,
    // shuffled so the board varies between plays.
    const pool = mcqItems.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor((Date.now() * (i + 7)) % (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setActiveMatch(pool.slice(0, 6));
  }

  // ── Nudge auto-start ──────────────────────────────────────────
  // When the "welcome back" banner routed here with `autoStart`, kick a
  // review session as soon as the harvested deck is ready. One-shot per
  // mount (ref), and only past the learned-material gate — a learner
  // without enough atoms just sees the normal page.
  const [wasAutoStarted, setWasAutoStarted] = useState(false);
  const autoStartFired = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartFired.current) return;
    if (items.length < GATE_MIN_ITEMS) return;
    autoStartFired.current = true;
    setWasAutoStarted(true);
    // Scoped nudge ("review what you learned last time"): drill only
    // the recent chapters' atoms. Smart mode, no stale customize
    // filters — this is the tailored on-ramp, not a saved session.
    // Thin scopes (course uninstalled since the scope was computed)
    // fall back to the ordinary full-deck session.
    const scoped = autoStartLessonKeys
      ? items.filter((i) =>
          autoStartLessonKeys.has(`${i.courseId}:${i.lessonId}`),
        )
      : null;
    if (scoped && scoped.length >= 3) {
      const queue = buildQueue("smart", scoped, records, {
        limit: Math.min(sessionLength, 10),
        seed: Date.now(),
        now: Date.now(),
      });
      if (queue.length > 0) {
        setActiveWarmup([]);
        setActiveQueue(queue);
        return;
      }
    }
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, items]);

  function startSession() {
    const queue = buildQueue(mode, items, records, {
      limit: sessionLength,
      courseIds: selectedCourses,
      kinds: selectedKinds,
      seed: Date.now(),
      now: Date.now(),
    });
    // Gentle on-ramp: open with recently-seen recognition cards that
    // prime the queue's concepts. Drop any atom already in the graded
    // queue so the same card isn't revealed then immediately tested.
    const queueIds = new Set(queue.map((q) => q.id));
    const warmup = pickWarmupItems(items, records).filter(
      (w) => !queueIds.has(w.id),
    );
    setActiveWarmup(warmup);
    setActiveQueue(queue);
  }

  /// Start a session drilled down to ONE kind — the first-class
  /// cloze / rebuild tiles route here. No warmup: a kind drill is a
  /// deliberate rep, not the daily review on-ramp.
  function startKindSession(kind: PracticeItem["kind"]) {
    const queue = buildQueue("smart", items, records, {
      limit: sessionLength,
      kinds: new Set([kind]),
      seed: Date.now(),
      now: Date.now(),
    });
    if (queue.length === 0) return;
    setActiveWarmup([]);
    setActiveQueue(queue);
  }

  if (activeQueue) {
    return (
      <PracticeSession
        queue={activeQueue}
        warmup={activeWarmup}
        mode={mode}
        onOpenLesson={onOpenLesson}
        onExit={() => {
          setActiveQueue(null);
          // An auto-started (nudge-initiated) session hands control back
          // to the host on exit so the learner lands where they were.
          if (wasAutoStarted) {
            setWasAutoStarted(false);
            onAutoSessionExit?.();
          }
        }}
      />
    );
  }

  if (activeMatch) {
    return (
      <PracticeMatch items={activeMatch} onExit={() => setActiveMatch(null)} />
    );
  }

  // Practice types — the page is the umbrella for every way to drill.
  // Built once and rendered in BOTH the main view and the gate: the
  // Monkey's Paw doesn't depend on having review cards, so it must
  // stay reachable before the learner's first completion. Tiles whose
  // kind has zero harvested items render disabled (same affordance
  // Match Pairs already used).
  const clozeCount = kindCounts.get("cloze") ?? 0;
  const rebuildCount = kindCounts.get("rebuild") ?? 0;
  const practiceTypesSection = (
    <div className="libre-practice-types" role="list">
      <div
        className="libre-practice-type libre-practice-type--active"
        role="listitem"
      >
        <span className="libre-practice-type-icon" aria-hidden>
          <Icon icon={dumbbell} size="lg" color="currentColor" />
        </span>
        <span className="libre-practice-type-text">
          <span className="libre-practice-type-title">Review deck</span>
          <span className="libre-practice-type-desc">
            Spaced repetition over everything you've learned — quizzes
            and puzzles resurface right before you'd forget them.
          </span>
        </span>
        <span className="libre-practice-type-meta">
          {stats.dueCount > 0 ? `${stats.dueCount} due` : "Up to date"}
        </span>
      </div>
      {onMonkeysPaw && (
        <button
          type="button"
          className="libre-practice-type"
          role="listitem"
          onClick={onMonkeysPaw}
        >
          <span className="libre-practice-type-icon" aria-hidden>
            <Icon icon={hand} size="lg" color="currentColor" />
          </span>
          <span className="libre-practice-type-text">
            <span className="libre-practice-type-title">
              The Monkey's Paw
            </span>
            <span className="libre-practice-type-desc">
              Adversarial duels — you write only the tests, the Paw writes
              the laziest code that passes them.
            </span>
          </span>
          <span className="libre-practice-type-meta libre-practice-type-meta--go">
            Open →
          </span>
        </button>
      )}
      <button
        type="button"
        className="libre-practice-type"
        role="listitem"
        onClick={startMatch}
        disabled={mcqItems.length < 4}
      >
        <span className="libre-practice-type-icon" aria-hidden>
          <Icon icon={grid2x2} size="lg" color="currentColor" />
        </span>
        <span className="libre-practice-type-text">
          <span className="libre-practice-type-title">Match Pairs</span>
          <span className="libre-practice-type-desc">
            A fast pairing game — tap a question, then its answer. No
            typing, no streak risk; the gentlest way to drill.
          </span>
        </span>
        <span className="libre-practice-type-meta libre-practice-type-meta--go">
          {mcqItems.length >= 4 ? "Play →" : "Need more cards"}
        </span>
      </button>
      <button
        type="button"
        className="libre-practice-type"
        role="listitem"
        onClick={() => startKindSession("cloze")}
        disabled={clozeCount === 0}
      >
        <span className="libre-practice-type-icon" aria-hidden>
          <Icon icon={textCursorInput} size="lg" color="currentColor" />
        </span>
        <span className="libre-practice-type-text">
          <span className="libre-practice-type-title">
            {t("practice.clozeTitle")}
          </span>
          <span className="libre-practice-type-desc">
            {t("practice.clozeDesc")}
          </span>
        </span>
        <span className="libre-practice-type-meta libre-practice-type-meta--go">
          {clozeCount > 0 ? "Play →" : "Need more cards"}
        </span>
      </button>
      <button
        type="button"
        className="libre-practice-type"
        role="listitem"
        onClick={() => startKindSession("rebuild")}
        disabled={rebuildCount === 0}
      >
        <span className="libre-practice-type-icon" aria-hidden>
          <Icon icon={brain} size="lg" color="currentColor" />
        </span>
        <span className="libre-practice-type-text">
          <span className="libre-practice-type-title">
            {t("practice.rebuildTitle")}
          </span>
          <span className="libre-practice-type-desc">
            {t("practice.rebuildDesc")}
          </span>
        </span>
        <span className="libre-practice-type-meta libre-practice-type-meta--go">
          {rebuildCount > 0 ? "Play →" : "Need more cards"}
        </span>
      </button>
    </div>
  );

  // ----- Render: learned-material gate -----
  // The deck is strictly lesson-gated; below GATE_MIN_ITEMS the page
  // swaps the whole deck body for a friendly "keep learning" panel.
  // The practice-type tiles stay above it so the Monkey's Paw (which
  // needs no cards) remains reachable from day zero.
  if (items.length < GATE_MIN_ITEMS) {
    const openNext = () => {
      if (onOpenLesson && nextLesson) {
        onOpenLesson(nextLesson.courseId, nextLesson.lessonId);
        return;
      }
      // Fallback: the same global navigation event the AI panel's
      // libre:// links use — App.tsx routes it to the course view.
      const courseId = courses[0]?.id;
      if (courseId) {
        window.dispatchEvent(
          new CustomEvent("libre:open-course", { detail: { courseId } }),
        );
      }
    };
    const canBrowse = (onOpenLesson && nextLesson != null) || courses.length > 0;
    const gatePct = Math.round(
      (Math.min(items.length, GATE_MIN_ITEMS) / GATE_MIN_ITEMS) * 100,
    );
    return (
      <div className="libre-practice">
        <div className="libre-practice-scroll">
          <div className="libre-practice-inner libre-practice-inner--empty">
            {practiceTypesSection}
            <div className="libre-practice-empty-icon" aria-hidden>
              <Icon icon={dumbbell} size="xl" color="currentColor" />
            </div>
            <h1 className="libre-practice-hero-title">
              {t("practice.gateTitle")}
            </h1>
            <p className="libre-practice-empty-blurb">
              {t("practice.gateBody")}
            </p>
            <div className="libre-practice-gate-progress">
              <span
                className="libre-practice-gate-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={GATE_MIN_ITEMS}
                aria-valuenow={Math.min(items.length, GATE_MIN_ITEMS)}
              >
                <span
                  className="libre-practice-gate-bar-fill"
                  style={{ width: `${gatePct}%` }}
                />
              </span>
              <span className="libre-practice-gate-count">
                {t("practice.gateProgress", {
                  count: items.length,
                  needed: GATE_MIN_ITEMS,
                })}
              </span>
            </div>
            {canBrowse && (
              <button
                type="button"
                className="libre-practice-cta-button libre-practice-gate-cta"
                onClick={openNext}
              >
                {t("practice.gateCta")}
                <Icon icon={sparkles} size="sm" color="currentColor" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const heroSub =
    stats.dueCount > 0
      ? `${stats.dueCount} card${stats.dueCount === 1 ? "" : "s"} due · spaced review across your books`
      : `${items.length} card${items.length === 1 ? "" : "s"} in deck · spaced review across your books`;

  return (
    <div className="libre-practice">
      <div className="libre-practice-scroll">
        <div className="libre-practice-inner">
          {/* Hero — title + subtitle + due-counter ring. Same shape
              as ProfileView so a learner moving between the two
              feels they're inside the same app. */}
          <section
            className="libre-practice-hero"
            aria-label={t("practice.ariaOverview")}
          >
            <div className="libre-practice-hero-text">
              <h1 className="libre-practice-hero-title">{t("practice.title")}</h1>
              <p className="libre-practice-hero-sub">{heroSub}</p>
            </div>
            <DueRing
              due={stats.dueCount}
              total={Math.max(items.length, 1)}
              correctToday={stats.correctToday}
              attemptsToday={stats.attemptsToday}
            />
          </section>

          {/* Dashboard — daily goal ring, streak, accuracy, activity
              sparkline + deck-shape numbers. Absorbs the old plain
              stats strip. */}
          <PracticeDashboard items={items} records={records} stats={stats} />

          {practiceTypesSection}

          {/* Primary CTA — one tap to start a session. The button
              IS the page. Customize lives below; default settings
              ("Smart mix · 10 cards") are good enough that most
              sessions never touch the panel. */}
          <section className="libre-practice-cta">
            <div className="libre-practice-cta-meta">
              <span className="libre-practice-cta-label">{t("practice.upNext")}</span>
              <span className="libre-practice-cta-title">
                {previewQueue.length > 0 ? (
                  <>
                    {previewQueue.length === 1
                      ? t("practice.cardCount", { count: previewQueue.length })
                      : t("practice.cardCountPlural", { count: previewQueue.length })}{" "}
                    · {MODE_LABELS[mode]}
                  </>
                ) : (
                  t("practice.nothingQueued")
                )}
              </span>
              <span className="libre-practice-cta-hint">
                {MODE_BLURBS[mode]}
              </span>
            </div>
            <button
              type="button"
              className="libre-practice-cta-button"
              onClick={startSession}
              disabled={previewQueue.length === 0}
            >
              {t("practice.start")}
              <Icon icon={dumbbell} size="sm" color="currentColor" />
            </button>
          </section>

          {/* Daily mini-challenges — three rotating goals. The
              TRACKER hook lives at the top of this component so it
              keeps listening while a session runs; this strip is
              display-only. */}
          <PracticeChallenges
            state={challenges.state}
            picked={challenges.picked}
          />

          {/* Recent misses — soft prompt to revisit lessons where
              the learner just got something wrong. Quietly absent
              when the learner is on a hot streak (no recent
              misses). */}
          {recentMisses.length > 0 && (
            <section className="libre-practice-section">
              <div className="libre-practice-section-head">
                <h2 className="libre-practice-section-title">
                  {t("practice.toRevisit")}
                </h2>
                <span className="libre-practice-section-sub">
                  {t("practice.recentlyMissed")}
                </span>
              </div>
              <ul className="libre-practice-misses">
                {recentMisses.map(({ item, rec }) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="libre-practice-miss-row"
                      onClick={() => onOpenLesson?.(item.courseId, item.lessonId)}
                      disabled={!onOpenLesson}
                    >
                      <span
                        className={`libre-practice-miss-kind libre-practice-miss-kind--${item.kind}`}
                        aria-hidden
                      />
                      <span className="libre-practice-miss-body">
                        <span className="libre-practice-miss-lesson">
                          {item.lessonTitle}
                        </span>
                        <span className="libre-practice-miss-course">
                          {item.courseTitle}
                        </span>
                      </span>
                      <span className="libre-practice-miss-meta">
                        {rec.correct}/{rec.attempts}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Customize — collapsed by default. The page is meant
              to feel "one tap away from practice" out of the box;
              the panel is for the learner who wants to drill a
              specific course or weak-spots only. */}
          <section className="libre-practice-section">
            <button
              type="button"
              className="libre-practice-customize-toggle"
              onClick={() => setCustomizeOpen((v) => !v)}
              aria-expanded={customizeOpen}
            >
              <Icon icon={sliders} size="sm" color="currentColor" />
              <span>{t("practice.customize")}</span>
              <span className="libre-practice-customize-summary">
                {summariseFilters(
                  mode,
                  selectedCourses,
                  selectedKinds,
                  sessionLength,
                  courseGroups.length,
                  t,
                )}
              </span>
              <Icon
                icon={customizeOpen ? chevronUp : chevronDown}
                size="xs"
                color="currentColor"
              />
            </button>

            {customizeOpen && (
              <div className="libre-practice-customize">
                <CustomizeRow label={t("practice.customizeMode")}>
                  {(Object.keys(MODE_LABELS) as PracticeMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={
                        "libre-practice-pill" +
                        (mode === m ? " is-active" : "")
                      }
                      onClick={() => setMode(m)}
                    >
                      <Icon
                        icon={MODE_ICONS[m]}
                        size="xs"
                        color="currentColor"
                      />
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </CustomizeRow>

                <CustomizeRow label={t("practice.customizeLength")}>
                  {SESSION_LIMITS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={
                        "libre-practice-pill" +
                        (sessionLength === n ? " is-active" : "")
                      }
                      onClick={() => setSessionLength(n)}
                    >
                      {n}
                    </button>
                  ))}
                </CustomizeRow>

                {courseGroups.length > 1 && (
                  <CustomizeRow
                    label={t("practice.customizeCourses")}
                    onClear={
                      selectedCourses.size > 0
                        ? () => setSelectedCourses(new Set())
                        : undefined
                    }
                  >
                    {courseGroups.map((g) => {
                      const active = selectedCourses.has(g.courseId);
                      return (
                        <button
                          key={g.courseId}
                          type="button"
                          className={
                            "libre-practice-pill" +
                            (active ? " is-active" : "")
                          }
                          onClick={() => {
                            setSelectedCourses((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.courseId))
                                next.delete(g.courseId);
                              else next.add(g.courseId);
                              return next;
                            });
                          }}
                        >
                          {g.courseTitle}
                          <span className="libre-practice-pill-count">
                            {g.count}
                          </span>
                        </button>
                      );
                    })}
                  </CustomizeRow>
                )}

                <CustomizeRow
                  label={t("practice.customizeKinds")}
                  onClear={
                    selectedKinds.size > 0
                      ? () => setSelectedKinds(new Set())
                      : undefined
                  }
                >
                  {(
                    Object.keys(KIND_LABEL_KEYS) as PracticeItem["kind"][]
                  ).map((k) => {
                    const count = kindCounts.get(k) ?? 0;
                    if (count === 0) return null;
                    const active = selectedKinds.has(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        className={
                          "libre-practice-pill" +
                          (active ? " is-active" : "")
                        }
                        onClick={() => {
                          setSelectedKinds((prev) => {
                            const next = new Set(prev);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          });
                        }}
                      >
                        <Icon
                          icon={KIND_ICONS[k]}
                          size="xs"
                          color="currentColor"
                        />
                        {t(KIND_LABEL_KEYS[k])}
                        <span className="libre-practice-pill-count">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </CustomizeRow>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CustomizeRow — labelled chip cluster used inside the customize panel.

function CustomizeRow({
  label,
  onClear,
  children,
}: {
  label: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="libre-practice-customize-row">
      <span className="libre-practice-customize-row-label">
        {label}
        {onClear && (
          <button
            type="button"
            className="libre-practice-customize-clear"
            onClick={onClear}
          >
            {t("practice.customizeClear")}
          </button>
        )}
      </span>
      <div className="libre-practice-customize-pills">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DueRing — circular gauge for "due / total" + today's accuracy.
// Visual sibling of ProfileView's RingGauge but tuned for the Practice
// page's narrative ("how much do you owe the deck right now").

function DueRing({
  due,
  total,
  correctToday,
  attemptsToday,
}: {
  due: number;
  total: number;
  correctToday: number;
  attemptsToday: number;
}) {
  const t = useT();
  const pct = total > 0 ? Math.min(due / total, 1) : 0;
  const r = 42;
  const c = Math.round(2 * Math.PI * r * 100) / 100;
  const offset = c * (1 - pct);
  const accuracy =
    attemptsToday > 0 ? Math.round((correctToday / attemptsToday) * 100) : 0;
  return (
    <div className="libre-practice-ring libre-practice-ring--due">
      <svg
        viewBox="0 0 100 100"
        className="libre-practice-ring-svg"
        aria-hidden
      >
        <circle
          className="libre-practice-ring-track"
          cx="50"
          cy="50"
          r={r}
          fill="none"
        />
        <circle
          className="libre-practice-ring-fill"
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="libre-practice-ring-body">
        <span className="libre-practice-ring-icon" aria-hidden>
          <Icon icon={dumbbell} size="lg" color="currentColor" />
        </span>
        <span className="libre-practice-ring-value">{due}</span>
        <span className="libre-practice-ring-label">
          {attemptsToday > 0 ? t("practice.todayPct", { pct: accuracy }) : t("practice.due")}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers.

function summariseFilters(
  mode: PracticeMode,
  selectedCourses: Set<string>,
  selectedKinds: Set<PracticeItem["kind"]>,
  sessionLength: number,
  courseCount: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const cardsLabel =
    sessionLength === 1
      ? t("practice.cardCount", { count: sessionLength })
      : t("practice.cardCountPlural", { count: sessionLength });
  const parts: string[] = [MODE_LABELS[mode], cardsLabel];
  if (selectedCourses.size > 0 && selectedCourses.size < courseCount) {
    parts.push(
      `${selectedCourses.size} course${selectedCourses.size === 1 ? "" : "s"}`,
    );
  }
  if (selectedKinds.size > 0) {
    parts.push(
      Array.from(selectedKinds)
        .map((k) => t(KIND_LABEL_KEYS[k]).toLowerCase())
        .join(", "),
    );
  }
  return parts.join(" · ");
}

function hashSig(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
