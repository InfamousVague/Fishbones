/// Daily mini-challenges — the pure logic behind `<PracticeChallenges>`.
///
/// (Named `practiceChallengeLogic` rather than `practiceChallenges`
/// because macOS's case-insensitive filesystem makes that name
/// collide with `PracticeChallenges.tsx` on extensionless imports —
/// tsc resolves `./PracticeChallenges` to the wrong file.)
///
/// Five challenge definitions exist; THREE are active on any given
/// local day, picked deterministically from a hash of the day key so
/// every device/profile sees the same rotation without any server.
///
/// Progress is tracked by folding `libre:practice-graded` events
/// (dispatched by `practiceStore.gradeAttempt`) into a small per-day
/// counter blob. The blob persists to localStorage under a
/// profile-scoped key so a mid-day reload doesn't lose progress, and
/// resets naturally when the stored `dayKey` stops matching today.
///
/// Everything in here is pure except the two tiny load/save helpers
/// at the bottom — the fold, the day picking, and the progress math
/// are all deterministic functions so they can be unit-tested without
/// a DOM. The React side (`PracticeChallenges.tsx`) owns the event
/// listener and item-id → kind/language resolution.

import { profileKey } from "@/lib/profileStore";

// ---------------------------------------------------------------------------
// Definitions.

export type ChallengeId =
  | "perfect5"
  | "speedrun"
  | "bugHunter"
  | "polyglot"
  | "comeback";

export interface ChallengeDef {
  id: ChallengeId;
  /// i18n keys — resolved by the component via `useT()`.
  titleKey: string;
  descKey: string;
  /// Progress denominator ("3 of 5"-style).
  target: number;
}

export const CHALLENGE_DEFS: Record<ChallengeId, ChallengeDef> = {
  perfect5: {
    id: "perfect5",
    titleKey: "practice.challengePerfect5",
    descKey: "practice.challengePerfect5Desc",
    target: 5,
  },
  speedrun: {
    id: "speedrun",
    titleKey: "practice.challengeSpeedrun",
    descKey: "practice.challengeSpeedrunDesc",
    target: 5,
  },
  bugHunter: {
    id: "bugHunter",
    titleKey: "practice.challengeBugHunter",
    descKey: "practice.challengeBugHunterDesc",
    target: 3,
  },
  polyglot: {
    id: "polyglot",
    titleKey: "practice.challengePolyglot",
    descKey: "practice.challengePolyglotDesc",
    target: 2,
  },
  comeback: {
    id: "comeback",
    titleKey: "practice.challengeComeback",
    descKey: "practice.challengeComebackDesc",
    target: 3,
  },
};

export const ALL_CHALLENGE_IDS: readonly ChallengeId[] = [
  "perfect5",
  "speedrun",
  "bugHunter",
  "polyglot",
  "comeback",
];

/// Sliding window for the speedrun challenge — "5 cards graded
/// within any 90 second window today".
export const SPEEDRUN_WINDOW_MS = 90_000;

/// How many active challenges per day.
export const DAILY_CHALLENGE_COUNT = 3;

/// Keep at most this many grade timestamps in the persisted state.
/// Only the ones inside the speedrun window ever matter, so a small
/// cap bounds storage without changing results.
const STAMP_CAP = 50;

// ---------------------------------------------------------------------------
// Day key + deterministic daily pick.

/// Local-calendar day key ("YYYY-MM-DD") — the exact same shape the
/// practice store uses for its day log, so both roll over together
/// at local midnight.
export function challengeDayKey(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/// Pick today's active challenges: a seeded shuffle of the full
/// list, take the first N. Deterministic for a given dayKey.
export function pickDailyChallenges(
  dayKey: string,
  count: number = DAILY_CHALLENGE_COUNT,
): ChallengeId[] {
  const ids = ALL_CHALLENGE_IDS.slice();
  const rand = mulberry32(fnv1a(dayKey));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(count, ids.length));
}

// ---------------------------------------------------------------------------
// Per-day state + event folding.

/// One graded attempt, normalised for the fold. The component
/// derives `kind` / `language` from the item id + the live deck and
/// `isWeak` from the record map snapshotted at mount.
export interface ChallengeGrade {
  correct: boolean;
  /// PracticeItem kind ("mcq" | "spotbug" | …) when derivable.
  kind?: string;
  /// Course language id ("python", "javascript", …) when known.
  language?: string;
  /// Was this item in the weak set (accuracy < 60%, ≥2 attempts)
  /// when the surface mounted?
  isWeak?: boolean;
  /// Epoch ms of the grade.
  at: number;
}

/// The persisted per-day blob. All counters are monotonic within a
/// day; `done` latches completion so a later miss can never undo a
/// finished challenge.
export interface ChallengeDayState {
  dayKey: string;
  /// Current consecutive-correct run (resets on a miss).
  run: number;
  /// Best consecutive-correct run today.
  bestRun: number;
  /// Recent grade timestamps (bounded by STAMP_CAP).
  stamps: number[];
  /// Max grades observed inside any SPEEDRUN_WINDOW_MS window.
  bestBurst: number;
  /// Correct spot-the-bug cards today.
  bugs: number;
  /// Distinct course languages with at least one correct today.
  langs: string[];
  /// Correct answers on weak-set items today.
  weakHits: number;
  /// Completion latches.
  done: Partial<Record<ChallengeId, boolean>>;
}

export function emptyDayState(dayKey: string): ChallengeDayState {
  return {
    dayKey,
    run: 0,
    bestRun: 0,
    stamps: [],
    bestBurst: 0,
    bugs: 0,
    langs: [],
    weakHits: 0,
    done: {},
  };
}

/// Fold one graded attempt into the day state. Pure — returns a new
/// object, never mutates the input. If the grade lands on a
/// different local day than `state.dayKey`, the fold restarts from
/// an empty state for the new day first.
export function foldGrade(
  state: ChallengeDayState,
  grade: ChallengeGrade,
): ChallengeDayState {
  const day = challengeDayKey(grade.at);
  const base = state.dayKey === day ? state : emptyDayState(day);

  const stamps = [...base.stamps, grade.at].slice(-STAMP_CAP);
  const burst = stamps.filter(
    (s) => s <= grade.at && grade.at - s <= SPEEDRUN_WINDOW_MS,
  ).length;

  const run = grade.correct ? base.run + 1 : 0;
  const langs =
    grade.correct && grade.language && !base.langs.includes(grade.language)
      ? [...base.langs, grade.language]
      : base.langs;

  const next: ChallengeDayState = {
    dayKey: day,
    run,
    bestRun: Math.max(base.bestRun, run),
    stamps,
    bestBurst: Math.max(base.bestBurst, burst),
    bugs: base.bugs + (grade.correct && grade.kind === "spotbug" ? 1 : 0),
    langs,
    weakHits: base.weakHits + (grade.correct && grade.isWeak ? 1 : 0),
    done: { ...base.done },
  };

  for (const id of ALL_CHALLENGE_IDS) {
    if (rawProgress(next, id) >= CHALLENGE_DEFS[id].target) {
      next.done[id] = true;
    }
  }
  return next;
}

/// Raw (unlatched) counter for a challenge.
function rawProgress(state: ChallengeDayState, id: ChallengeId): number {
  switch (id) {
    case "perfect5":
      return state.bestRun;
    case "speedrun":
      return state.bestBurst;
    case "bugHunter":
      return state.bugs;
    case "polyglot":
      return state.langs.length;
    case "comeback":
      return state.weakHits;
  }
}

/// Display progress for one challenge: `current` is capped at
/// `target`, and a latched `done` always reports full progress.
export function challengeProgress(
  state: ChallengeDayState,
  id: ChallengeId,
): { current: number; target: number; done: boolean } {
  const target = CHALLENGE_DEFS[id].target;
  const done = state.done[id] === true;
  const current = done ? target : Math.min(rawProgress(state, id), target);
  return { current, target, done };
}

// ---------------------------------------------------------------------------
// Persistence — profile-scoped localStorage, same conventions as
// practiceStore (best-effort, corrupt payloads fall back to empty).

const CHALLENGES_KEY = profileKey("libre:practice:challenges:v1");

export function loadChallengeState(
  now: number = Date.now(),
): ChallengeDayState {
  const today = challengeDayKey(now);
  try {
    const raw = localStorage.getItem(CHALLENGES_KEY);
    if (!raw) return emptyDayState(today);
    const parsed = JSON.parse(raw) as unknown;
    if (!looksLikeDayState(parsed)) return emptyDayState(today);
    // Yesterday's blob → fresh start for the new day.
    if (parsed.dayKey !== today) return emptyDayState(today);
    return parsed;
  } catch {
    return emptyDayState(today);
  }
}

export function saveChallengeState(state: ChallengeDayState): void {
  try {
    localStorage.setItem(CHALLENGES_KEY, JSON.stringify(state));
  } catch {
    /* localStorage full / private mode — drop the write */
  }
}

function looksLikeDayState(v: unknown): v is ChallengeDayState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.dayKey === "string" &&
    typeof s.run === "number" &&
    typeof s.bestRun === "number" &&
    Array.isArray(s.stamps) &&
    typeof s.bestBurst === "number" &&
    typeof s.bugs === "number" &&
    Array.isArray(s.langs) &&
    typeof s.weakHits === "number" &&
    !!s.done &&
    typeof s.done === "object"
  );
}

// ---------------------------------------------------------------------------
// PRNG helpers (same family the queue builder uses — FNV-1a seed +
// mulberry32 stream — duplicated here to keep this module dependency-
// free and independently testable).

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
