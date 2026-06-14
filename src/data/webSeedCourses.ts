/// First-launch seeder for the web build. Fetches the curated starter
/// courses staged at `/starter-courses/manifest.json` (created by
/// `scripts/extract-starter-courses.mjs`) and saves them into IndexedDB
/// via the storage abstraction.
///
/// Runs at most once per device (gated by a `meta.starterCoursesSeeded`
/// flag) so subsequent visits skip the network round-trip and the
/// learner's progress isn't clobbered if they delete a course.
///
/// Desktop-side seeding still goes through `seedCourses` (the static
/// constant in seedCourses.ts, currently empty) — desktop ships its
/// content via `bundled-packs` extracted by Rust on first launch, so
/// this module isn't called in that path.

import { metaGet, metaSet, storage } from "../lib/storage";
import { isWeb } from "../lib/platform";
import type { Course } from "./types";

interface ManifestEntry {
  id: string;
  title: string;
  language: string;
  file: string;
  cover?: string;
  sizeBytes: number;
  packType?: "course" | "challenges" | "track";
  /// "Unlisted" — see Course.hidden + CatalogEntry.hidden. We still
  /// seed the course (so a deep link to `?courseId=…` works without
  /// an extra fetch) but stamp the flag onto the saved Course so
  /// CourseLibrary/Sidebar/Trees skip it in their listings.
  hidden?: boolean;
}

interface Manifest {
  version: number;
  courses: ManifestEntry[];
}

const SEEDED_KEY = "starterCoursesSeeded";
/// Tracks the set of course ids the seeder wrote on its last successful
/// run. On the next seed we diff against the current manifest and
/// delete any ids that were ours-then but aren't ours-now — that's how
/// books removed from PACK_IDS (svelte-5-complete, bun-complete,
/// javascript-crash-course, …) actually disappear from returning
/// visitors' libraries instead of lingering in IndexedDB forever.
/// Stored as a JSON-serialised string[] under this meta key.
const SEEDED_IDS_KEY = "starterCoursesSeededIds";
const MANIFEST_PATH = "/starter-courses/manifest.json";

/// Migration fallback. Versions ≤V5 of this seeder didn't track which
/// ids it wrote, so on the first V6 run we don't know what to prune —
/// `previousIds` reads empty even though IndexedDB likely has stale
/// records. This is the union of every course id the web seed has
/// ever shipped (current PACK_IDS + retired ones), used as a fallback
/// `previousIds` for visitors mid-migration. Custom user-imported
/// packs are never in this list, so the prune step still leaves
/// them alone.
const LEGACY_STARTER_IDS: ReadonlyArray<string> = [
  // Default library curation (V9): just two books + every challenge
  // pack. Slimmed from ~30 books so a fresh visitor sees an
  // opinionated starter set instead of the full catalog. Other
  // books are still importable from the catalog browser; they
  // just don't auto-seed on first launch.
  "the-rust-programming-language",
  "mastering-ethereum",
  // Challenge packs — flat list of increasing-difficulty exercises
  // per language. These render in their own "Challenges" section
  // at the bottom of the library, not mixed with the books above.
  "challenges-javascript-handwritten",
  "challenges-typescript-mo9c9k2o",
  "challenges-python-handwritten",
  "challenges-go-handwritten",
  "challenges-rust-handwritten",
  "challenges-reactnative-handwritten",
  "challenges-ruby-handwritten",
  "challenges-lua-handwritten",
  "challenges-dart-handwritten",
  "challenges-haskell-handwritten",
  "challenges-scala-handwritten",
  "challenges-sql-handwritten",
  "challenges-elixir-handwritten",
  "challenges-zig-handwritten",
  "challenges-move-handwritten",
  "challenges-cairo-handwritten",
  "challenges-sway-handwritten",
  // 2026-06-11: nanoid "— Challenge Pack" duplicates, retired. Go + Rust
  // keep their challenges-{go,rust}-handwritten replacements; TypeScript
  // was dropped per request. Listed so the prune step removes them.
  "challenges-go-mo9kijkd",
  "challenges-rust-mo9bapm1",
  "challenges-typescript-mo9c9k2o",
  // Retired — explicitly listed so they're pruned on migration.
  // V9 dropped a large book set (Eloquent JavaScript, Composing
  // Programs, Python Crash Course, Mastering Bitcoin, Solidity
  // Complete, etc.) — those got moved here so returning visitors
  // who had them seeded in V8 see them removed on next launch.
  // Anything ever in the seed set should stay in this list
  // forever; never trim it. That includes ids that later returned
  // to the active catalog (eloquent-javascript, you-dont-know-js-yet,
  // pro-git, open-data-structures re-published 2026-06-10, …): this
  // is NOT a retire filter — the prune step only deletes ids absent
  // from the current manifest, so a published course is never
  // touched. Un-retiring happens in catalog.ts RETIRED_PACK_IDS
  // (+ its courses.rs mirror), not here.
  "rust-by-example",
  "rust-async-book",
  "rustonomicon",
  "eloquent-javascript",
  "javascript-info",
  "javascript-the-definitive-guide",
  "you-dont-know-js-yet",
  "composing-programs",
  "python-crash-course",
  "learning-go",
  "algorithms-erickson",
  "open-data-structures",
  "crafting-interpreters-js",
  "pro-git",
  "svelte-tutorial",
  "solidjs-fundamentals",
  "htmx-fundamentals",
  "astro-fundamentals",
  "react-native",
  "learning-react-native",
  "fluent-react",
  "tauri-2-fundamentals",
  "interactive-web-development-with-three-js-and-a-frame",
  "mastering-bitcoin",
  "programming-bitcoin",
  "mastering-lightning-network",
  "vyper-fundamentals",
  "solana-programs",
  "viem-ethers",
  "cryptography-fundamentals",
  "bun-complete",
  "bun-fundamentals",
  "svelte-5-complete",
  "javascript-crash-course",
  "challenges-reactnative-visual",
  // V10 — Learning Zig retired in favour of in-house "A to Zig"
  // course. Listed here so returning visitors who had it seeded see
  // it removed on next launch.
  "learning-zig",
  // V16 — The V14 / V15 ingest seeded these under their
  // `<curriculum>` suffix ids. V16 renames to the short slugs
  // (`rustlings` / `ziglings`) to match the `/courses/<slug>`
  // public URLs; including the old ids here prunes them from
  // IndexedDB on the V16 re-seed so visitors don't end up with
  // two copies of each book.
  "rustlings-curriculum",
  "ziglings-curriculum",
];

/// Resolve a starter-courses path to its absolute URL on the CDN.
/// All course content (manifest + per-course JSON + covers) lives at
/// `libre.academy/starter-courses/*` regardless of where the SPA
/// itself is hosted (the web build under `/learn/`, a local dev
/// server, etc.). Using an absolute URL means the seeder works the
/// same on `npm run dev`, the production embed, and any future
/// host — single source of truth.
function starterUrl(path: string): string {
  return `https://libre.academy${path}`;
}

/// Bump this whenever the seed format changes meaningfully — adding
/// new courses, swapping cover URLs, expanding metadata fields, etc.
/// `seedWebStarterCourses` re-runs when the persisted version differs
/// from this constant. Without it, returning visitors with a previous
/// seed in IndexedDB would never pick up new books or new covers.
///
/// V2 → V3: cover artwork was promised in V2 but the CI runner that
/// produced the V2 manifest didn't have ImageMagick, so the cover
/// field shipped empty for every course. Visitors who seeded against
/// that broken V2 manifest now have Course records with
/// `coverFetchedAt: undefined`, and the library shows the
/// language-tinted fallback instead of artwork. Bumping to V3 forces
/// those records to refresh against the current (fixed) manifest.
///
/// V4 — adds 147 micropuzzle drills (792 cards) across 11 tutorial
/// courses. Existing IndexedDB seeds get re-fetched so academy
/// visitors see the drills inline without a manual reset.
///
/// V5 — fixes the missing-cover bug for the dozen books whose
/// course.id differed from their .libre pack-filename slug.
/// extract-starter-courses now mirrors the JPEG under the in-zip
/// course id, but visitors whose browsers cached the prior broken
/// 200-HTML response still see the language-tinted glyph until the
/// img URL changes. Bumping the seed forces fresh `coverFetchedAt`
/// stamps, and `useCourseCover` now appends them as `?v=<n>` —
/// the new URL bypasses the stale cache on the next visit.
///
/// V6 — drops books that were removed from PACK_IDS in earlier
/// updates but lingered in returning visitors' IndexedDB because
/// the seeder only ever WROTE records, never deleted them
/// (svelte-5-complete, bun-complete, javascript-crash-course,
/// challenges-reactnative-visual, …). The seeder now diffs against
/// `starterCoursesSeededIds` and removes ids it previously wrote
/// that aren't in the current manifest. Custom packs the user
/// imported themselves are unaffected — only ids we know we
/// seeded ourselves get the chop.
///
/// V7 — adds `bun-fundamentals` to the legacy prune list. It was
/// in the very first PACK_IDS revision (alongside bun-complete) and
/// got missed when V6 shipped, so V1-era seeds still showed it.
/// V8 — 2026 language expansion: 11 new challenge packs (ruby, lua,
/// dart, haskell, scala, sql, elixir, zig, move, cairo, sway), all
/// bulk-generated via the in-app Claude pipeline. Returning visitors
/// get the new packs on next page load.
///
/// V9 — Library curation: trimmed default seed to The Rust
/// Programming Language + Mastering Ethereum + the 17 challenge
/// packs. The other ~25 books are still available via the catalog
/// browser but no longer auto-seed on first visit. Returning
/// visitors who had the V8 seed get the dropped books removed
/// (they're in the retired list now) on next launch.
///
/// V10 — Catalog cleanup: retired Learning Zig (replaced by the
/// in-house "A to Zig" course) plus eight other books removed
/// 2026-05-07 (eloquent-javascript, modern-javascript-tutorial,
/// you-don-t-know-js-yet, python-crash-course,
/// crafting-interpreters-javascript, learning-react-native,
/// fluent-react, three-js-and-a-frame). All nine are listed in
/// LEGACY_STARTER_IDS so the prune step actually removes them
/// from returning visitors' IndexedDB.
///
/// V11 — Re-seed for blocks restoration. The deployed
/// `/learn/starter-courses/<id>.json` files now carry blocks data
/// (the build:web → blocks:apply chain bakes them in on every
/// build), but returning visitors whose IndexedDB was seeded from
/// V10 have blocks-free copies — every exercise on web mobile shows
/// "this exercise hasn't been authored for blocks mode yet" because
/// `lesson.blocks` is undefined in the cached records. Bumping
/// forces a fresh fetch of the deployed JSONs so existing visitors
/// pick up the blocks payloads without an IndexedDB reset.
///
/// V12 — Hellotrade unhide. The manifest's `hidden: true` flag was
/// stamped onto the IDB record at seed time (see the `hidden:` line
/// in the loop below). Returning visitors who seeded under V11 still
/// have `hidden: true` on the cached record and thus on
/// `course.hidden` at runtime — Library + Discover both filter it
/// out. Bumping forces a re-fetch of the manifest (which no longer
/// carries the flag) and overwrites the record with the
/// undefined-hidden version, surfacing the course in Discover from
/// the next page load.
///
/// V13 — Catalog cleanup. Dropped 16 dead-archive book ids from
/// ALL_PACK_IDS (rust-by-example, the-async-book-rust, composing-
/// programs, algorithms-erickson, open-data-structures, pro-git,
/// learning-svelte, solidjs-fundamentals, htmx-fundamentals,
/// astro-fundamentals, react-native, tauri-2-fundamentals,
/// mastering-lightning-network, vyper-fundamentals-pythonic-smart-
/// contracts, viem-and-ethers-js, cryptography-fundamentals-hashes-
/// to-zk) plus emptied REMOTE_CATALOG_FALLBACK. Returning visitors
/// have these IDB-cached from V12 — bumping forces a re-seed pass
/// whose `currentIds` set excludes the dropped books, and the
/// existing prune step removes the orphaned IDB rows.
///
/// V14 — Rustlings + Ziglings ingest. Imported the upstream
/// Rustlings (94 exercises) and Ziglings (116 exercises) curricula
/// as two new starter courses (`rustlings-curriculum` /
/// `ziglings-curriculum`), each shipped with a custom cover JPEG
/// from the docs/cover-prompts.md style sheet. Bumping so returning
/// visitors re-fetch the manifest and pick up the two new entries
/// + their covers without waiting for the next seed-altering change.
///
/// V15 — Rustlings + Ziglings unit tests. The V14 ingest left
/// every exercise's `tests` field empty, which on the Zig runner
/// meant the workbench never lit up a pass pill — `runZig`'s
/// legacy harness only synthesises a "program exited cleanly"
/// result when KATA_TEST markers are absent, and the run-mode
/// fallback returns an empty test list. Rustlings inherited the
/// same gap. V15 fills `tests` for every exercise: Rustlings
/// hoists the upstream `#[cfg(test)] mod tests { ... }` block
/// into the lesson tests (52 exercises) with a synthetic
/// `rustlings_compiles` fallback for compile-only ones (42
/// exercises); Ziglings synthesises a `test "<name> — <expected
/// output>" { ... }` block per file that gates on compilation
/// and surfaces the expected stdout in the test title so the
/// learner has a visible target to eyeball their Run output
/// against. Bumping so returning visitors re-fetch.
///
/// V16 — Rustlings + Ziglings rename. Slug-renamed
/// `rustlings-curriculum` → `rustlings` and `ziglings-curriculum`
/// → `ziglings` to match the public URL slugs at
/// `libre.academy/courses/rustlings` + `/courses/ziglings`. The
/// old ids were added to `LEGACY_STARTER_IDS` above so the
/// V16 re-seed pass prunes the IDB rows that the V14/V15 seed
/// wrote, before installing the renamed copies. Without this
/// step, returning visitors would end up with both ids — a
/// "Rustlings curriculum" entry next to the new "Rustlings"
/// entry in their library.
///
/// V17 — Verification + content fixes:
///   • Rustlings `intro1`: solution now mirrors the upstream
///     starter verbatim (the canonical "no edit needed" lesson)
///     so the cargo test compile produces meaningful output
///     instead of the trivial empty-main the importer emitted.
///   • Rustlings `hashmaps3`: the test-suite's `RESULTS`
///     const was a multi-line string literal; the runtime's
///     `indent(testCode, 4)` was prepending 4 spaces to every
///     continuation line and silently corrupting the string
///     contents (team-name keys like "France" became
///     "    France"). Single-line `\n`-escaped literal sidesteps
///     the indenter entirely.
///   • Rustlings `smart-pointers3`: starter ships
///     `#![forbid(unused_imports)]`; `forbid` overrules `allow`,
///     so the wrapper's `#[allow(unused_imports)] use super::*;`
///     couldn't suppress the lint on the compile-only test.
///     Fixed by having the test reference `main` via the glob,
///     making the import genuinely used.
///   • Ziglings: re-imported with a fuzz-locating unified-diff
///     applier. The upstream patches were generated against an
///     older starter snapshot with line offsets shifted ±1 in
///     places; the naive splice was mis-positioning hunks and
///     corrupting solutions (most visibly `050_no_value`'s
///     duplicated `const Err` + missing closing `}`). All 116
///     Ziglings lessons now verify cleanly under `zig test`.
/// Bumping so returning web visitors re-fetch the manifest and
/// pick up the corrected course bodies.
///
/// V18 — Rustlings runtime fix (no content change, but the
/// in-app web bundle ships a fixed `joinCodeAndTests`). Two
/// regressions surfaced after V17:
///   • `smart-pointers3` was still failing with E0453
///     ("allow(unused_imports) incompatible with previous
///     forbid") because the test-code wrapper carried
///     `#[allow(unused_imports)] use super::*;` — `forbid`
///     overrules `allow`, so the annotation itself errored
///     before the unused-import check ever ran. Fixed by
///     dropping the `#[allow]` outright and making the
///     compile-only test template reference `main` so the
///     import is genuinely used.
///   • The test-wrapper's `indent(testCode, 4)` call was
///     prepending 4 spaces to every line of the test code,
///     including continuation lines INSIDE multi-line string
///     literals — corrupting `hashmaps3`'s `const RESULTS = "…"`
///     so half the team-name keys had leading spaces baked in.
///     Retired `indent()`; Rust doesn't care about indentation,
///     and the per-line space prefix had no upside to weigh
///     against the string-literal corruption.
/// Manifest bumps so returning visitors re-fetch.
///
/// V19 — Golings ingest. New starter course `golings` (43
/// exercises across 13 chapters: variables, functions, if,
/// switch, primitive_types, arrays, slices, maps, range,
/// structs, anonymous_functions, generics, concurrent),
/// ported from mauricioabreu/golings with hand-crafted Go
/// solutions + KATA_TEST harnesses. All 43 lessons verify
/// green under the headless native Go runner. Bumping so
/// returning web visitors pick up the new entry + cover
/// without waiting for the next seed-altering change.
///
/// V20 — Exercism Python track ingest. New starter course
/// `exercism-python` (146 lessons across two chapters:
/// Concepts + Practice), mirrored from github.com/exercism/python
/// (MIT-licensed). Each lesson preserves the upstream
/// introduction + instructions + hints; tests are
/// auto-translated from unittest.TestCase shape into the
/// kata_test DSL via a discovery runner appended at import
/// time. Verified 144/146 lessons green in local CPython
/// (remaining 2 are local Python-version artefacts that pass
/// under Pyodide's 3.11+). New `packType: "track"` discriminator
/// renders the lesson in the dedicated Tracks section between
/// Books and Challenges. First of six planned Exercism tracks;
/// TypeScript / Go / Rust / Elixir / Haskell follow in V21+.
///
/// V21 — Exercism full track expansion. Adds 17 more language
/// tracks alongside Python: JavaScript (158), TypeScript (106),
/// Rust (109), Go (165), Swift (116), Ruby (120), Elixir (168),
/// Haskell (111), Lua (120), Dart (78), Scala (95), C (84),
/// C++ (100), Java (158), Kotlin (88), C# (178), Zig (98). All
/// 18 tracks mirror github.com/exercism/<lang> under MIT;
/// per-language processors in scripts/import-exercism-track.mjs
/// translate test code so it runs against Libre's runtime where
/// possible (Python's unittest → kata_test, Jest globals stripped
/// + module paths rewritten for JS/TS, Rust's #[cfg(test)] mod
/// kata_tests wrap with use-statement stripping + #[ignore]
/// removal). Native-runner languages (Ruby, Elixir, Haskell,
/// Scala, Dart, Kotlin, Java, C, C++, C#, Zig, Swift, Lua)
/// ship the upstream tests verbatim — they render in the
/// workbench so learners can read them; `Run` works on desktop
/// builds with the native toolchain installed, and falls back
/// to the desktop-upsell on web. Adds ~2200 new exercises to
/// the catalog in one shot.
///
/// V22 — Track cards swap from the language-icon hero treatment
/// to the dense `CourseCard` layout that books use in grid view
/// (title + author + progress bar + lesson-count meta). Removes
/// the custom `TrackCard` component + its CSS — tracks now look
/// like the same info-dense tiles books do, surfaced consistently
/// across shelf and grid view modes. No content change, just a
/// visual refresh; bump forces returning visitors to pick up the
/// new bundle.
///
/// V23 — Rustlings hints. Every one of the 94 Rustlings exercises
/// now ships ≥2 progressive hints (was: 6 lessons with placeholder
/// "No hints this time" strings, 88 with empty hint arrays). The
/// first hint is a soft concept reminder pulled from the lesson
/// body (or a chapter-keyed Rust-specific pointer when the body
/// doesn't have a per-lesson concept paragraph), and subsequent
/// hints are the upstream rust-lang/rustlings `info.toml` hints
/// split into progressive steps where the original author already
/// segmented them with "Hint 1:" / "Hint 2:" markers OR by
/// paragraph break. Distribution: 33 lessons with 2 hints, 30 with
/// 3, 17 with 4, and a long tail up to 10 (iterators2). Manifest
/// bumped to v12 + rustlings.json sizeBytes updated; bump forces
/// returning visitors to re-fetch the augmented course body.
///
/// V24 — TRPL `rand` API migration. The guessing-game chapter +
/// "External Packages and Nested Paths" lesson taught the `rand`
/// 0.8 surface (`use rand::Rng;` + `rand::thread_rng().gen_range(R)`).
/// The Rust playground ships a recent enough toolchain that the
/// 0.8 API errors out with `cannot find function thread_rng in
/// crate rand` — 0.9 dropped both `thread_rng` and the `Rng::
/// gen_range` method in favour of the free function `rand::random_
/// range(R)`. Migrated all 9 affected lessons across bodies,
/// starters, solutions, and tests; NOTE callouts rewritten to
/// flag the historical form so learners reading other guides
/// aren't confused. Verified the headline exercise compiles +
/// tests pass on play.rust-lang.org. Bumping so returning visitors
/// re-fetch the corrected lesson bodies.
///
/// V25 — TRPL playground-block wrap. 30 `rust playground` fences
/// across 22 lessons opened with bare `let` / statement-level code
/// at the top of the block (e.g. `let input = "not-a-number"; …`
/// in "Handling Invalid Input with match on Result"). Reading
/// rendered fine, but clicking Run forwarded the snippet to
/// play.rust-lang.org as-is and Rust's grammar rejected it with
/// "expected item, found keyword `let`" — the playground compiles
/// at file scope, not function scope. Wrapped each broken block
/// in `fn main() { … }` with 4-space indented body. Verified the
/// headline example ("handling-invalid-input-gracefully") compiles
/// + runs on the playground after the fix. Bumping so returning
/// visitors re-fetch.
///
/// V26 — Ten new open-source courses: 4 *lings (swiftlings,
/// haskellings, exlings, cplings) and 6 koans (python-koans,
/// kotlin-koans, clojure-koans, javascript-koans, java-koans,
/// fsharp-koans). All under permissive licenses (MIT / Apache-2.0
/// / BSD-3 / EPL-1.0 for clojure-koans). 393 new lessons across
/// 10 new courses. Two new LanguageId entries (`clojure`,
/// `fsharp`) added to support the new languages — Monaco aliases
/// to scheme / native fsharp grammar; no Libre runtime yet, so
/// Run buttons on those two courses fall through to the
/// desktop-coming-soon banner the same way move / cairo / sway
/// did pre-runtime. Bumping so returning visitors re-fetch the
/// manifest + pick up the new entries.
///
/// V27 — Tracks → Challenges rename + Koans relocation.
///   • The dedicated "Tracks" page (Exercism tracks + in-house
///     challenge packs) is renamed to "Challenges" because the
///     existing concept of "Tracks" is being held in reserve for
///     a new feature that will land later. Visible label, nav-rail
///     icon (train-track → crossed swords), page header, search
///     placeholder, and tour-step copy all updated.
///   • Internal state value `view === "tracks"` → `"challenges"`,
///     callback prop `onTracks` → `onChallenges`, component +
///     directory + CSS class names all renamed in lockstep so the
///     `"tracks"` identifier is genuinely free for the new
///     feature's later use.
///   • The 6 koans courses (python/kotlin/clojure/javascript/java
///     /fsharp) move from `packType: "course"` to a new `packType
///     : "koans"`. The Challenges page picks them up via a new
///     `isKoans` predicate and renders them in their own
///     "Koans" grid section between Exercism tracks and in-house
///     challenges; the Library strips them from the books shelf
///     and the mobile library shows them under the existing
///     Challenges shelf. Manifest re-fetch needed so returning
///     visitors pick up the retagged packType + new page label.
///
/// V28 — *lings relocation. The seven rustlings-style courses
/// (rustlings, ziglings, golings, swiftlings, haskellings,
/// exlings, cplings) move from `packType: "course"` (regular
/// Library book) to a new `packType: "lings"`. They now render
/// on the dedicated Challenges page in their own "*lings"
/// labelled grid section (between Exercism tracks and Koans) and
/// are stripped from the Library + mobile-library book shelves
/// the same way tracks / challenges / koans already are.
/// `isLings` predicate added to data/types.ts; ChallengesView's
/// filter, sort (kindRank track→lings→koans→challenges), hyper-
/// carousel round-robin, and four-section grid all updated.
/// Manifest re-fetch needed so returning visitors pick up the
/// retagged packType + see the *lings on the Challenges page
/// instead of the Library.
///
/// V29 — Select Star SQL ingest. New `sql` book course
/// `select-star-sql` (29 lessons across 3 deathrow chapters +
/// frontmatter; 21 auto-graded SQL exercises) ported from
/// selectstarsql.com (prose CC-BY-SA 4.0 © Zi Chong Kao, dataset
/// CC0). Each exercise inlines a compact 553-row `executions`
/// seed (last_statement truncated to 60 chars) so it runs + grades
/// live in the browser via the existing sql.js runtime, matching
/// the challenges-sql-handwritten lesson shape. Expected outputs
/// were captured against a canonical DB built from the exact
/// shipped seed (verified 21/21 grading through real sql.js).
/// `packType: "course"` → regular Library (it's a book, not a
/// challenges/lings/koans pack). Bumping so returning visitors
/// pick up the new course + cover.
///
/// V30 — retired the nanoid "— Challenge Pack" duplicate packs
/// (challenges-{go,rust,typescript}-*); the prune step removes them.
/// V31 — baked per-lesson art into the-rustonomicon (20) and
/// rust-async-book (22); bump forces returning visitors to re-fetch
/// the now-illustrated course JSONs (the seeder never refreshes an
/// already-cached course otherwise).
/// V32 — baked the first 97 per-lesson images into
/// the-rust-programming-language (120/168 total; remainder pending art).
/// V33 — reflowed Rust-track figures: short exercise lessons downsized
/// to the `small` float class so images no longer tower over a few
/// lines of prose. Bump re-fetches the adjusted lesson bodies.
/// V34 — baked 10 more TRPL images (module-splitting + the vector
/// chapter); the-rust-programming-language now 130/168.
/// V35 — TRPL `create-package-exercise` now ships a real two-file
/// reference solution (src/lib.rs + src/main.rs) instead of collapsing
/// the package to one inline-module file; bump re-fetches the lesson.
const SEED_VERSION = 35;

/// Run the web seed if it hasn't run yet OR if the persisted
/// `SEED_VERSION` is older than the current build's. Idempotent +
/// safe to call during the bootloader race; only the first caller
/// does work for a given version.
///
/// Returns the number of courses written so callers can log it.
export async function seedWebStarterCourses(): Promise<number> {
  if (!isWeb) return 0;

  // The flag transitioned from boolean → number with v2 — accept
  // either shape on read so v1 installs roll forward without losing
  // their progress.
  const seeded = await metaGet<boolean | number>(SEEDED_KEY);
  const seededVersion =
    typeof seeded === "number" ? seeded : seeded === true ? 1 : 0;
  if (seededVersion >= SEED_VERSION) return 0;

  let manifest: Manifest;
  try {
    const url = starterUrl(MANIFEST_PATH);
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    manifest = (await res.json()) as Manifest;
  } catch (err) {
    // Don't write the seeded flag — next visit retries. Marketing
    // landing page might be reachable without the starter pack
    // staging step, in which case we degrade to "no courses" cleanly
    // and the empty-state CTA invites the learner to install the
    // desktop app.
    console.warn(
      "[seedWebStarterCourses] failed to fetch manifest:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }

  // Snapshot the ids we previously seeded so we can prune anything
  // that's been removed from the current manifest. Without this
  // step, books we drop from PACK_IDS hang around in IndexedDB
  // forever — the seeder only writes, never deletes. Custom packs
  // the user imported themselves aren't in this list, so they're
  // not at risk of being clobbered.
  //
  // Migration: pre-V6 seeds didn't track this, so the meta key reads
  // empty for returning visitors who'd benefit most from cleanup.
  // Fall back to LEGACY_STARTER_IDS in that case so the first V6
  // run still prunes retired books.
  const previousIdsRaw = await metaGet<string>(SEEDED_IDS_KEY);
  const previousIds: string[] = (() => {
    if (!previousIdsRaw) return [...LEGACY_STARTER_IDS];
    try {
      const parsed = JSON.parse(previousIdsRaw);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
    } catch {
      return [...LEGACY_STARTER_IDS];
    }
  })();
  const currentIds = new Set(manifest.courses.map((e) => e.id));

  let written = 0;
  for (const entry of manifest.courses) {
    try {
      const url = starterUrl(`/starter-courses/${entry.file}`);
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) {
        console.warn(
          `[seedWebStarterCourses] HTTP ${res.status} for ${entry.id}, skipping`,
        );
        continue;
      }
      const course = (await res.json()) as Course;
      // Force the id we got from the manifest in case the JSON's
      // own id field disagrees (would point at a desktop-style
      // path-derived id rather than the slug). Never seen in
      // practice but cheap insurance.
      //
      // Also stamp `coverFetchedAt` ONLY when the manifest entry
      // has a `cover` field — `useCourseCover` keys off that
      // truthy value to decide whether to render the static
      // `/starter-courses/<id>.jpg` URL or fall back to the
      // language-tinted glyph. Setting Date.now() means the cover
      // re-fetches once whenever the manifest is reseeded; it's
      // not a problem because the resized JPEG is small + cached
      // by the browser.
      const record: Course = {
        ...course,
        id: entry.id,
        coverFetchedAt: entry.cover ? Date.now() : undefined,
        // Threaded from the manifest so the course is queryable by
        // direct link (`?courseId=…`) but stays out of the catalog
        // and library listings. Only set when the manifest opts in;
        // otherwise we leave the field undefined so the rest of the
        // app can do strict `course.hidden === true` checks.
        hidden: entry.hidden ? true : undefined,
      };
      await storage.saveCourse(entry.id, record);
      written += 1;
    } catch (err) {
      console.warn(
        `[seedWebStarterCourses] failed for ${entry.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Prune previously-seeded courses that aren't in the current
  // manifest. We only touch ids we know we wrote ourselves — the
  // intersection of `previousIds` (last seed's set) and "not in
  // currentIds". User-imported packs aren't in `previousIds` so
  // they're safe.
  let removed = 0;
  for (const id of previousIds) {
    if (currentIds.has(id)) continue;
    try {
      await storage.deleteCourse(id);
      removed += 1;
    } catch (err) {
      console.warn(
        `[seedWebStarterCourses] failed to prune removed course ${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Mark as seeded at the current SEED_VERSION even on partial
  // failure — we don't want to re-fetch the same broken pack on
  // every boot. The user can wipe their IndexedDB to retry from a
  // clean slate if needed. Storing the version (instead of just
  // `true`) lets us re-seed when the pack list / cover treatment
  // changes in a future build.
  await metaSet(SEEDED_KEY, SEED_VERSION);
  await metaSet(SEEDED_IDS_KEY, JSON.stringify(Array.from(currentIds)));

  // eslint-disable-next-line no-console
  console.log(
    `[seedWebStarterCourses] saved ${written}/${manifest.courses.length} starter courses` +
      (removed > 0 ? ` (pruned ${removed} no-longer-shipped)` : ""),
  );
  return written;
}

