/// Monkey's Paw — duel content.
///
/// A duel is a spec the learner must pin down by writing TESTS ONLY.
/// The Paw (the genie) answers each summon with the laziest
/// implementation in its ladder that still passes the learner's
/// current test suite. The learner wins when their suite (a) kills
/// every cheat in the ladder and (b) passes the hidden reference
/// solution — the dual oracle that makes the duel fair: tests that
/// demand the impossible are rejected by the reference, tests that
/// demand too little are exploited by a cheat.
///
/// Content rules (enforced by `scripts/verify-paw-duels.sh` /
/// `engine.verify.test.ts` against real rustc):
///   - every cheat COMPILES and PASSES the duel's starter tests
///     (so the ladder tells a coherent story from round 1), and
///   - every cheat FAILS the killer suite (proof each cheat is
///     killable), and
///   - the reference passes BOTH suites.
///
/// Code shape matches `runtimes/rust.ts::joinCodeAndTests`: the
/// implementation is top-level Rust; tests are bare `#[test]` fns that
/// the runtime wraps in `#[cfg(test)] mod kata_tests { use super::*; … }`.

export interface PawCheat {
  id: string;
  /// Short villain-card name shown on the slain-cheats ledger.
  title: string;
  /// The Paw's in-character gloat when this cheat survives a summon.
  monologue: string;
  /// What defeating this cheat teaches — surfaced as a "lesson learned"
  /// chip after the duel.
  lesson: string;
  code: string;
}

/// Languages a duel can be fought in. Each maps to a runtime runner
/// (see MonkeysPawView's RUNNERS) and a test idiom the duel's suites
/// are written in.
export type PawLanguage = "rust" | "go" | "javascript" | "python";

/// Five-tier ladder, super easy → super hard. The finer-grained
/// `rank` (1-10) orders duels within and across tiers.
export type PawDifficulty =
  | "novice"
  | "apprentice"
  | "journeyman"
  | "master"
  | "grandmaster";

export interface PawDuel {
  id: string;
  title: string;
  /// The wish, in deliberately human (and therefore ambiguous) words.
  /// Edge-case decisions live in `clauses` below.
  wish: string;
  /// The precise contract clauses the learner must enforce. Shown in
  /// the spec card — the duel is about TRANSLATING these into tests,
  /// not guessing them.
  clauses: string[];
  /// Signature (in the duel's language) the Paw must implement
  /// (read-only, keeps the duel type-honest so cheats can't lie
  /// through their own types).
  signature: string;
  conceptTags: string[];
  difficulty: PawDifficulty;
  /// Which language this duel is fought in — picks the runtime and
  /// the test idiom.
  language: PawLanguage;
  /// 1 (super easy) … 10 (super hard). Orders the browse ladder;
  /// roughly two ranks per difficulty tier.
  rank: number;
  /// Pre-filled contents of the learner's test file.
  starterTests: string;
  /// Ladder, laziest first. Each summon grants the first cheat that
  /// PASSES the learner's current suite.
  cheats: PawCheat[];
  /// Hidden reference implementation — the fairness oracle.
  reference: string;
  /// A complete winning suite. Never shown in the UI; used by the
  /// content verifier to prove the duel is winnable, and as the
  /// source of post-victory "clauses you might have missed" hints.
  killerTests: string;
}

// ─── Catalog aggregation ─────────────────────────────────────────
//
// Duel content lives in one file per language under ./duels/. Each
// language ships a 10-duel ladder (rank 1 super easy → rank 10 super
// hard). The content rules at the top of this file are enforced per
// language by __tests__/duels.verify.test.ts against the REAL
// toolchain (rustc / go / node / python3), gated behind PAW_VERIFY=1.

import { RUST_DUELS } from "./duels/rust";
import { GO_DUELS } from "./duels/go";
import { JAVASCRIPT_DUELS } from "./duels/javascript";
import { PYTHON_DUELS } from "./duels/python";
import { RUST_DUELS_VOL2 } from "./duels/rust-vol2";
import { RUST_DUELS_VOL3 } from "./duels/rust-vol3";
import { GO_DUELS_VOL2 } from "./duels/go-vol2";
import { GO_DUELS_VOL3 } from "./duels/go-vol3";
import { JAVASCRIPT_DUELS_VOL2 } from "./duels/javascript-vol2";
import { JAVASCRIPT_DUELS_VOL3 } from "./duels/javascript-vol3";
import { PYTHON_DUELS_VOL2 } from "./duels/python-vol2";
import { PYTHON_DUELS_VOL3 } from "./duels/python-vol3";

export { RUST_DUELS, GO_DUELS, JAVASCRIPT_DUELS, PYTHON_DUELS };

/// Every duel in the catalog, all languages, sorted by rank so a
/// flat render is already a difficulty ladder. Volumes 2 and 3 grew
/// each language's ladder from 10 to 30 duels (three per rank).
export const ALL_DUELS: readonly PawDuel[] = [
  ...RUST_DUELS,
  ...RUST_DUELS_VOL2,
  ...RUST_DUELS_VOL3,
  ...GO_DUELS,
  ...GO_DUELS_VOL2,
  ...GO_DUELS_VOL3,
  ...JAVASCRIPT_DUELS,
  ...JAVASCRIPT_DUELS_VOL2,
  ...JAVASCRIPT_DUELS_VOL3,
  ...PYTHON_DUELS,
  ...PYTHON_DUELS_VOL2,
  ...PYTHON_DUELS_VOL3,
].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

/// Browse metadata per language — display order, label, and the id
/// prefix duel authors use. The view builds its language tabs off
/// this list so adding a fifth language is one entry + one duels
/// file.
export const PAW_LANGUAGES: ReadonlyArray<{
  id: PawLanguage;
  label: string;
}> = [
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
];

export function duelsForLanguage(lang: PawLanguage): PawDuel[] {
  return ALL_DUELS.filter((d) => d.language === lang);
}

export function findDuel(id: string | null | undefined): PawDuel | undefined {
  return id ? ALL_DUELS.find((d) => d.id === id) : undefined;
}
