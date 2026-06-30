import type { Course, Lesson } from "@/data/types";

export interface Neighbors {
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

/// Flatten all chapters into a linear lesson list and return the siblings of
/// the given lessonId. Returning null at the ends lets the nav disable the
/// Prev/Next buttons without additional branching in the view.
export function findNeighbors(course: Course, lessonId: string): Neighbors {
  const flat: Array<{ id: string; title: string }> = [];
  for (const ch of course.chapters) {
    for (const l of ch.lessons) flat.push({ id: l.id, title: l.title });
  }
  const idx = flat.findIndex((x) => x.id === lessonId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "course";
}

export function findLesson(course: Course | null, lessonId: string | undefined): Lesson | null {
  if (!course || !lessonId) return null;
  for (const ch of course.chapters) {
    const found = ch.lessons.find((l) => l.id === lessonId);
    if (found) return found;
  }
  return null;
}

/// Coding lessons are exercise + mixed (both have a runnable test
/// suite). Reading + quiz are not — the dock would just be noise
/// above the prose / multiple-choice.
function isCodingLesson(lesson: Lesson): boolean {
  return lesson.kind === "exercise" || lesson.kind === "mixed";
}

/// Show the ChainDock when the lesson is a CODING lesson (exercise
/// or mixed) AND any of:
///   - it opts into the EVM harness directly
///   - it's a Solidity / Vyper lesson (legacy compile-only path)
///   - the course it lives in contains any EVM-harness lesson
///   - the chain has live activity (a previous run left state)
///
/// Show the ChainDock (EVM) when:
///   - the lesson explicitly opts into the EVM harness
///     (`harness: "evm"`), OR
///   - the lesson is written in Solidity or Vyper (smart-contract
///     languages always benefit from the chain context), OR
///   - the parent course is an Ethereum-flavoured CHALLENGE PACK
///     (`packType === "challenges"` AND the course id mentions
///     ethereum / evm / solidity / vyper) and the lesson is a
///     coding lesson.
///
/// We DON'T trigger on:
///   - Plain JS / prose lessons inside the `mastering-ethereum` book.
///     The book has 95+ exercises but only ~21 are chain-aware; the
///     rest are JS / cryptography / off-chain math that don't deploy
///     anything — the dock would be silent chrome on those.
///   - "course has any EVM lesson" or "chain had prior activity".
///     Both were too broad — same sticky-dock problem the BTC dock
///     had: once any past run left state, the dock followed the user
///     across every coding lesson everywhere.
///
/// Reading + quiz lessons are still excluded everywhere.
export function shouldShowEvmDock(
  lesson: Lesson,
  course: Course,
  // `_opts` retained for API compatibility with the legacy
  // `hasActivity` signal, but no longer drives the decision.
  _opts?: { hasActivity?: boolean },
): boolean {
  if (!isCodingLesson(lesson)) return false;
  if ("harness" in lesson && lesson.harness === "evm") return true;
  if ("language" in lesson) {
    const lang = (lesson as { language?: string }).language;
    if (lang === "solidity" || lang === "vyper") return true;
  }
  if (
    course.packType === "challenges" &&
    /ethereum|evm|solidity|vyper/i.test(course.id)
  ) {
    return true;
  }
  return false;
}

/// Show the BitcoinChainDock when:
///   - the lesson explicitly opts into the Bitcoin harness
///     (`harness: "bitcoin"`), OR
///   - the parent course is a Bitcoin-flavoured CHALLENGE PACK
///     (`packType === "challenges"` AND the course id mentions
///     bitcoin) and the lesson is a coding lesson.
///
/// We DON'T trigger on:
///   - Plain JS / prose lessons inside the `mastering-bitcoin` book.
///     These are reading material with toy snippets, not chain-aware
///     work — the dock would just be silent chrome.
///   - "course has any bitcoin lesson" or "chain had prior activity".
///     Both were too broad — once the chain had any state from a
///     past run, the dock followed the user across every coding
///     lesson in every course, which is what the user reported as
///     "showing all over the place".
///
/// Reading + quiz lessons are still excluded everywhere.
export function shouldShowBitcoinDock(
  lesson: Lesson,
  course: Course,
  // `_opts` retained for API compatibility with the legacy
  // `hasActivity` signal, but no longer drives the decision.
  _opts?: { hasActivity?: boolean },
): boolean {
  if (!isCodingLesson(lesson)) return false;
  if ("harness" in lesson && lesson.harness === "bitcoin") return true;
  if (
    course.packType === "challenges" &&
    /bitcoin/i.test(course.id)
  ) {
    return true;
  }
  return false;
}

// `courseHasEvmHarness` was removed alongside the `hasActivity`
// fallback — the dock is now strictly per-lesson + per-EVM-challenge-
// pack. Same rationale as the BTC dock below: a single chain-aware
// lesson buried in a 95-lesson book shouldn't drag the dock onto
// the other 70+ pure-JS prose lessons.

// `courseHasBitcoinHarness` was removed when `shouldShowBitcoinDock`
// dropped its course-wide fallback (it triggered on every coding
// lesson inside `mastering-bitcoin`, which is a book of mostly-prose
// lessons that don't deploy / mine anything). The dock is now
// strictly per-lesson + per-bitcoin-challenge-pack.

/// Show the SvmDock when:
///   - the lesson explicitly opts into the Solana harness
///     (`harness: "solana"`), OR
///   - the parent course is a Solana-flavoured CHALLENGE PACK
///     (`packType === "challenges"` AND the course id mentions
///     solana / svm) and the lesson is a coding lesson.
///
/// Same tightened pattern the EVM and BTC docks adopted: no sticky
/// activity flag, no "course has any solana lesson" fallback. A
/// single chain-aware lesson buried in a multi-topic book shouldn't
/// drag the dock onto every other coding lesson in that book.
///
/// LiteSVM is desktop-only (Rust napi addon), so callers should
/// gate on the desktop-build flag too — this helper only answers
/// "should the dock render IF we can run it", not "is the runtime
/// available". The web build's "this lesson needs the desktop app"
/// path catches Solana lessons before any of the dock UI mounts.
export function shouldShowSvmDock(
  lesson: Lesson,
  course: Course,
  // `_opts` retained for parity with the EVM/BTC helpers (and a
  // future hasActivity signal) but no longer drives the decision.
  _opts?: { hasActivity?: boolean },
): boolean {
  if (!isCodingLesson(lesson)) return false;
  if ("harness" in lesson && lesson.harness === "solana") return true;
  if (
    course.packType === "challenges" &&
    /solana|svm/i.test(course.id)
  ) {
    return true;
  }
  return false;
}

/// Show the TradeDock (Postman-like REST + WebSocket client) when:
///   - the lesson explicitly opts into the Trade harness
///     (`harness: "trade"`), OR
///   - the lesson is a coding lesson AND the parent course id
///     matches the HelloTrade-flavoured prefix (`hellotrade*` /
///     `*-hello-trade-*`). The dock is API-tester chrome and only
///     makes sense above lessons that ARE about hitting an API,
///     so unlike the chain docks we DON'T fall back to "any
///     coding lesson in the course" — a non-API exercise inside
///     the same book (e.g. a closure-revisit drill) shouldn't
///     drag the request panel onto its surface.
///
/// Reading + quiz lessons stay excluded — the dock is interactive
/// and would be silent chrome above a prose page.
export function shouldShowTradeDock(
  lesson: Lesson,
  course: Course,
  // `_opts` retained for parity with the chain-dock helpers.
  _opts?: { hasActivity?: boolean },
): boolean {
  // Unlike the chain docks (which are chrome around the code
  // editor — pointless above prose), the TradeDock IS its own
  // editor: an interactive HTTP/WS client with a presets sidebar.
  // It works above ANY lesson in the HelloTrade course (including
  // reading + quiz lessons), so we don't gate on `isCodingLesson`.
  if ("harness" in lesson && lesson.harness === "trade") return true;
  if (/^hello-?trade(-|$)/i.test(course.id)) return true;
  return false;
}
