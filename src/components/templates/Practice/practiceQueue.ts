/// Mode-aware queue builder for Practice sessions.
///
/// Given the deck (`PracticeItem[]`) and the learner's review
/// state (`Map<id, PracticeRecord>`), pick the next N items to
/// play based on the chosen mode + filter constraints. Pure;
/// caller persists nothing.
///
/// Modes — the user-facing mental models:
///
///   - **Smart mix** (default): a weighted draw that biases due
///     items + weak items to the front, with a small dose of
///     unseen items mixed in. The "right thing for daily review"
///     button.
///
///   - **Due now**: only items past their `dueAt`. Strict —
///     returns at most as many items as are due. When the deck
///     is empty the view shows a celebratory "You're all caught
///     up" empty state.
///
///   - **Weak spots**: items where the learner's accuracy has
///     dropped below 60% over at least 2 attempts. Sorted
///     worst-first so they land back to back.
///
///   - **Recent**: items the learner has touched in the last 7
///     days, FIFO by lastSeen. Lets the learner re-cement what
///     they just learned without waiting for the SM-2 timer.
///
///   - **Random**: uniform draw, ignores all state. The
///     "shuffle" button — for when the learner just wants
///     variety, not optimisation.
///
/// All queues are deterministic for a given seed so a re-render
/// of the queue preview doesn't shuffle items mid-scan. The
/// session start grabs `Date.now()` as the seed so consecutive
/// sessions actually vary; the queue preview uses a stable seed
/// per filter signature so the displayed list doesn't churn.

import type { PracticeItem, PracticeRecord } from "./types";

export type PracticeMode = "smart" | "due" | "weak" | "recent" | "random";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BuildQueueOptions {
  /// Maximum number of items to return.
  limit: number;
  /// Optional course-id allowlist. When non-empty, only items
  /// from one of these courses qualify.
  courseIds?: ReadonlySet<string>;
  /// Optional kind allowlist. When non-empty, only items whose
  /// kind is in the set qualify. Lets the user say "blocks only".
  kinds?: ReadonlySet<PracticeItem["kind"]>;
  /// Deterministic seed for tie-breaking and the random mode.
  /// Caller passes `Date.now()` for variability.
  seed: number;
  /// Current epoch ms. Threaded so tests can be deterministic
  /// without mocking the clock.
  now: number;
}

/// Build the queue for a session.
export function buildQueue(
  mode: PracticeMode,
  items: readonly PracticeItem[],
  records: ReadonlyMap<string, PracticeRecord>,
  opts: BuildQueueOptions,
): PracticeItem[] {
  const filtered = items.filter((it) => {
    if (opts.courseIds && opts.courseIds.size > 0 && !opts.courseIds.has(it.courseId)) return false;
    if (opts.kinds && opts.kinds.size > 0 && !opts.kinds.has(it.kind)) return false;
    return true;
  });
  switch (mode) {
    case "due":
      return takeDue(filtered, records, opts);
    case "weak":
      return takeWeak(filtered, records, opts);
    case "recent":
      return takeRecent(filtered, records, opts);
    case "random":
      return takeRandom(filtered, opts);
    case "smart":
    default:
      return takeSmartMix(filtered, records, opts);
  }
}

// ---------------------------------------------------------------------------
// Mode implementations.

function takeDue(
  items: readonly PracticeItem[],
  records: ReadonlyMap<string, PracticeRecord>,
  opts: BuildQueueOptions,
): PracticeItem[] {
  const due: Array<{ item: PracticeItem; dueAt: number }> = [];
  for (const item of items) {
    const rec = records.get(item.id);
    if (!rec) continue;
    if (rec.dueAt <= opts.now) due.push({ item, dueAt: rec.dueAt });
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  return due.slice(0, opts.limit).map((d) => d.item);
}

function takeWeak(
  items: readonly PracticeItem[],
  records: ReadonlyMap<string, PracticeRecord>,
  opts: BuildQueueOptions,
): PracticeItem[] {
  const weak: Array<{ item: PracticeItem; ratio: number }> = [];
  for (const item of items) {
    const rec = records.get(item.id);
    if (!rec || rec.attempts < 2) continue;
    const ratio = rec.correct / rec.attempts;
    if (ratio >= 0.6) continue;
    weak.push({ item, ratio });
  }
  weak.sort((a, b) => a.ratio - b.ratio);
  return weak.slice(0, opts.limit).map((w) => w.item);
}

function takeRecent(
  items: readonly PracticeItem[],
  records: ReadonlyMap<string, PracticeRecord>,
  opts: BuildQueueOptions,
): PracticeItem[] {
  const cutoff = opts.now - WEEK_MS;
  const recent: Array<{ item: PracticeItem; lastSeen: number }> = [];
  for (const item of items) {
    const rec = records.get(item.id);
    if (!rec) continue;
    if (rec.lastSeen < cutoff) continue;
    recent.push({ item, lastSeen: rec.lastSeen });
  }
  recent.sort((a, b) => b.lastSeen - a.lastSeen);
  return recent.slice(0, opts.limit).map((r) => r.item);
}

function takeRandom(
  items: readonly PracticeItem[],
  opts: BuildQueueOptions,
): PracticeItem[] {
  const arr = items.slice();
  shuffleInPlace(arr, opts.seed);
  return arr.slice(0, opts.limit);
}

/// Smart-mix: weighted random sample. Each item gets a weight:
///   - due:    +3.0 (very past-due → +6.0 capped)
///   - weak:   +2.0 (accuracy < 60% with at least 2 attempts)
///   - never seen: +1.0 (encourages exploration)
///   - everything else: +0.2 (still sampleable, just rare)
///
/// We then take a weighted shuffle: repeatedly pick a random
/// item by weight, remove it from the pool, and append to the
/// queue. This is O(n²) worst case but n is bounded by item
/// count which is small (a few hundred even for power users) —
/// no need for the alias-method version.
function takeSmartMix(
  items: readonly PracticeItem[],
  records: ReadonlyMap<string, PracticeRecord>,
  opts: BuildQueueOptions,
): PracticeItem[] {
  if (items.length === 0) return [];

  const weights = items.map((item) => {
    const rec = records.get(item.id);
    if (!rec) return 1.0;
    let w = 0.2;
    if (rec.dueAt <= opts.now) {
      const overdueDays = Math.max(
        0,
        (opts.now - rec.dueAt) / (24 * 60 * 60 * 1000),
      );
      w += 3.0 + Math.min(3.0, overdueDays * 0.5);
    }
    if (rec.attempts >= 2 && rec.correct / rec.attempts < 0.6) {
      w += 2.0;
    }
    return w;
  });

  const pool = items.map((item, i) => ({ item, weight: weights[i] }));
  const out: PracticeItem[] = [];
  const rand = mulberry32(opts.seed >>> 0);
  while (out.length < opts.limit && pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    if (total <= 0) break;
    let pick = rand() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      pick -= pool[idx].weight;
      if (pick <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PRNG helpers.

function shuffleInPlace<T>(arr: T[], seed: number): void {
  const rand = mulberry32(seed >>> 0);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
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

/// Human-readable label for each mode. Used by the mode pill row
/// AND the session header so the language stays consistent.
export const MODE_LABELS: Record<PracticeMode, string> = {
  smart: "Smart mix",
  due: "Due now",
  weak: "Weak spots",
  recent: "Recent",
  random: "Shuffle",
};

/// One-liner explainer for each mode. Shown under the mode pill
/// when it's selected — gives the learner confidence about what
/// they're about to drill.
export const MODE_BLURBS: Record<PracticeMode, string> = {
  smart:
    "Weighted draw that prioritises items due for review and weak spots, with a sprinkle of unseen content.",
  due: "Only items past their next-review date. Empty when you're all caught up.",
  weak: "Items where your accuracy has dropped below 60%. Sorted worst-first.",
  recent: "Things you've seen in the last week. Cement what you just learned.",
  random: "Uniform shuffle across the entire deck. For when you just want variety.",
};
