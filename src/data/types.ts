/// Canonical course format. A course is a collection of chapters; each chapter
/// has one or more lessons. A lesson is either reading-only or contains an
/// exercise with a starter file, hidden solution, and hidden test file.
///
/// On disk this is a mix of JSON (structure) and Markdown (prose). At runtime
/// we load everything into these types.

export type LanguageId =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "swift"
  | "go"
  | "web"
  | "threejs"
  | "react"
  | "reactnative"
  | "svelte"
  | "solid"
  | "htmx"
  | "astro"
  | "bun"
  | "tauri"
  | "c"
  | "cpp"
  | "java"
  | "kotlin"
  | "csharp"
  | "assembly"
  | "solidity"
  | "vyper"
  // ── Phase: 2026 language expansion ───────────────────────────
  // Browser-native runtimes (no toolchain on host): Lua via
  // Fengari, SQL via sql.js. Both run in the same `runCode`
  // path as JS / Python.
  | "lua"
  | "sql"
  // Sandbox-proxy runtimes: shell out to a public free playground
  // service over HTTPS. Same shape as Rust (play.rust-lang.org)
  // and Go (play.golang.org). DartPad / Scastie / play-haskell are
  // the targets — see runtimes/<lang>.ts for the exact endpoint.
  | "dart"
  | "haskell"
  | "scala"
  // Native-toolchain runtimes (host has the compiler / VM, we shell
  // out via Tauri). Ruby ships with macOS / most Linux distros;
  // Elixir installs via brew or asdf. Web build short-circuits to
  // a desktop-upsell banner.
  | "ruby"
  | "elixir"
  // Zig — native subprocess runner. Compiles + runs the user's code via
  // `zig run` on the host. macOS / Linux / Windows all install via the
  // official tarball; web build upsells to desktop.
  | "zig"
  // Smart-contract languages on alternative chains. Move (Aptos /
  // Sui), Cairo (StarkNet), Sway (Fuel). All three need the chain's
  // native toolchain on the host; web build upsells to desktop.
  | "move"
  | "cairo"
  | "sway"
  // Functional / JVM-adjacent languages added for the koans ingest.
  // Clojure runs via `clojure -M` on hosts with the CLI tools; F#
  // runs via `dotnet fsi`. Neither has a Libre runtime wired up yet
  // — the dispatch in `runtimes/index.ts` falls through to the
  // desktop-coming-soon banner so the koans lessons render as
  // exercises with read-only Run. Monaco / Shiki handle the syntax
  // highlighting natively (no custom grammar needed). Wire up
  // native runners separately when adding `run_clojure` /
  // `run_fsharp` Tauri commands.
  | "clojure"
  | "fsharp";

/// Difficulty tier for challenge-pack exercises. Courses' exercises don't
/// set this — it's specific to the kata-style challenge packs that group
/// problems by how hard they are. Optional on both exercise kinds so
/// existing course lessons deserialize without a migration.
export type Difficulty = "easy" | "medium" | "hard";

/// A file in an exercise's workbench. Multi-file exercises list their files
/// here (e.g. index.html + style.css + script.js, or lib.rs + main.rs). For
/// legacy single-file exercises we synthesize one of these at runtime from
/// the `starter` field so the workbench UI always deals in file arrays.
///
/// `fileLanguage` is broader than the lesson's primary `language` because
/// individual files can be HTML or CSS even in a "javascript" lesson (web
/// projects). The primary language is still what picks the runtime.
/// Monaco language id for a single file in a workbench. Kept separate
/// from `LanguageId` (the lesson's PRIMARY language) because per-file
/// languages are narrower — you never have a single file whose language
/// is "web" or "threejs"; those are meta-languages that describe how
/// the lesson as a whole is run. A file inside a `web` lesson has its
/// own `"html"` / `"css"` / `"javascript"` language.
export type FileLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "swift"
  | "go"
  | "c"
  | "cpp"
  | "java"
  | "kotlin"
  | "csharp"
  | "assembly"
  | "solidity"
  | "vyper"
  | "lua"
  | "sql"
  | "dart"
  | "haskell"
  | "scala"
  | "ruby"
  | "elixir"
  | "zig"
  // Move / Cairo / Sway don't have native Monaco syntax — Monaco
  // falls back to plaintext rendering, which is fine for v1. We
  // keep the LanguageId entries in FileLanguage so a workbench
  // file reading `language: "move"` typechecks; future improvement
  // is registering a TextMate grammar to upgrade highlighting.
  | "move"
  | "cairo"
  | "sway"
  // Same story as the LanguageId additions above — koans-only
  // additions, Monaco + Shiki have built-in syntax support.
  | "clojure"
  | "fsharp"
  | "html"
  | "css"
  | "json"
  | "svelte"
  | "markdown"
  | "plaintext";

export interface WorkbenchFile {
  /// Filename including extension — used by the UI as the tab label and by
  /// the test runner when the harness imports relative to the user module.
  name: string;
  /// Monaco language id for syntax highlighting. Also drives how we
  /// concatenate the file when running (e.g. CSS isn't executable JS, so
  /// it's ignored when building the JS test bundle).
  language: FileLanguage;
  /// Starter content shown when the exercise first opens, or current
  /// content in solutionFiles.
  content: string;
  /// When true, the user can't edit this file — useful for a reference
  /// library they should use but not modify. Still shown in tabs so the
  /// learner can read it.
  readOnly?: boolean;
}

/// Binary assets (images, textures, models, audio) that travel
/// alongside a workbench's files. Lives outside `WorkbenchFile` because
/// the content is base64-encoded — keeping files and assets in
/// separate arrays lets the Monaco tab bar ignore the binaries and the
/// runtime serve them via blob URLs / data URLs without parsing as
/// text. Referenced from HTML / CSS / JS via `/assets/<name>` paths,
/// which the web runtime rewrites at assembly time.
export interface WorkbenchAsset {
  /// Filename including extension (e.g. "hero.png", "ground.glb").
  /// Lives under the virtual `/assets/` prefix at runtime.
  name: string;
  /// MIME type for the data URL wrapper. Inferred from the extension
  /// at import time; stored so the runtime doesn't have to sniff.
  mimeType: string;
  /// Base64-encoded payload (no `data:` prefix). Kept as a string so
  /// it survives JSON serialization of the course / playground state.
  base64: string;
}

export interface Course {
  id: string;
  title: string;
  author?: string;
  description?: string;
  language: LanguageId;
  chapters: Chapter[];
  /// Per-locale overlays for the course-level strings (`title`,
  /// `description`). Keyed by non-EN locale (English is the source).
  /// Missing locale or missing key → reader falls back to English.
  /// See `src/data/locales.ts` for the `Locale` enum + the
  /// `localizedCourse` helper that merges overlays at read time.
  translations?: import("./locales").TranslationOverlay<
    import("./locales").CourseTranslation
  >;
  /// Classification for the library / sidebar / profile views.
  /// All three packType variants share the same on-disk shape
  /// (chapters → lessons), so persistence + progress tracking +
  /// the lesson reader treat them identically; the flag only
  /// affects how the catalog GROUPS and displays them.
  ///
  ///   - "course" (or missing) — book-derived linear curricula.
  ///     Chapter-major prose. Default for everything imported
  ///     before this field existed.
  ///   - "challenges" — kata-style packs. Chapters are
  ///     difficulty tiers, lessons carry `topic` tags. Sibling
  ///     packs for the same language are deduped by canonical
  ///     `-handwritten` suffix.
  ///   - "track" — language curriculums in the Exercism mould
  ///     (concept exercises in prerequisite order + practice
  ///     exercises). Distinct library section between Books and
  ///     Challenges; card layout uses the language icon as the
  ///     visual anchor rather than a cover photo.
  ///   - "koans" — fill-in-the-blanks koans-style courses
  ///     (python_koans, kotlin-koans-edu, etc.). Distinct from
  ///     "track" because the pedagogy is different (single-file
  ///     edit-in-place vs Exercism's separate solution + test
  ///     files) and from "challenges" because koans are sequenced
  ///     learning paths, not difficulty-sorted kata grab-bags. The
  ///     Challenges page (formerly "Tracks") groups them in their
  ///     own row alongside Exercism tracks + challenge packs.
  ///   - "lings" — rustlings-style "fix the broken code" courses
  ///     (rustlings, ziglings, golings, swiftlings, haskellings,
  ///     exlings, cplings). Same Challenges-page surface as koans
  ///     but kept as a distinct packType so the page can give the
  ///     famous *lings family its own labelled section + the
  ///     Library can strip them the same way it strips tracks /
  ///     challenges / koans (they're exercise-driven, not
  ///     long-form books).
  packType?: "course" | "challenges" | "track" | "koans" | "lings";
  /// Epoch-ms timestamp of the most recent cover-artwork extraction.
  /// When present, the Library + Sidebar render the PNG at
  /// `<courses_dir>/<id>/cover.png` via the `load_course_cover` Tauri
  /// command. Acts as a cache-buster: re-fetching a cover bumps this
  /// value so the frontend invalidates its in-memory blob URL and
  /// reloads. Missing = no cover extracted yet.
  coverFetchedAt?: number;
  /// Origin of this course's content. Missing OR "pdf" means a book
  /// import (the original path); "docs" means the course was generated
  /// by crawling a documentation website via `crawl_docs_site`. Drives
  /// a small attribution badge in the Library and enables a future
  /// "re-sync from source" action that a PDF-derived course can't
  /// offer (the source might change).
  sourceType?: "pdf" | "docs";
  /// Starting URL of a doc-site crawl. Populated when `sourceType` is
  /// "docs". Used to re-sync the course against the live site and to
  /// link back to the original docs from the Library card's hover
  /// tooltip. Absent for PDF imports.
  sourceUrl?: string;
  /// Editorial release tier. Drives the corner-pill on BookCover and
  /// the section heading in CourseLibrary. Reading order, top of the
  /// library to bottom:
  ///   `VERIFIED`   \u2014 fully reviewed + verified; highest tier
  ///   `BETA`       \u2014 final polish for release
  ///   `ALPHA`      \u2014 next up in the queue
  ///   `UNREVIEWED` \u2014 drafts; bottom of the library
  /// Missing = `UNREVIEWED`. Set the field per-course in the on-disk
  /// `course.json` to promote (or demote) a book without a code change.
  ///
  /// Legacy `"PRE-RELEASE"` values from before the tier rename still
  /// deserialize and are normalised to `"UNREVIEWED"` by
  /// `releaseStatusFor` until the migration script rewrites every
  /// course.json on disk.
  releaseStatus?: "VERIFIED" | "UNREVIEWED" | "ALPHA" | "BETA" | "PRE-RELEASE";
  /// SHA-256 of the bundled `public/starter-courses/<id>.json` at the
  /// last sync (first install OR explicit "Reapply bundled starter").
  /// The Library compares this against `hash(currentBundled)` to
  /// decide whether to render an "update available" badge on the
  /// cover. Storing the LAST-SYNCED hash (not just hash(installed))
  /// means user-local edits don't trigger the badge — only an
  /// upstream bundle change does. Absent on courses that were
  /// imported, not bundled.
  bundleSha?: string;
  /// Set on synthetic "this course is downloadable but not yet
  /// installed" entries that the Library merges into its grid from
  /// the catalog. Real Course objects loaded from disk never set
  /// this. The Library renders placeholders semi-opaque with a
  /// Download badge instead of an Open click.
  placeholder?: boolean;
  /// Where the .libre archive (desktop) or course JSON (web)
  /// can be fetched from to install the course. Populated only on
  /// placeholders.
  downloadUrl?: string;
  /// Archive size in bytes — surfaced on the placeholder hover so
  /// the user knows what they're about to download. Populated only
  /// on placeholders.
  archiveSize?: number;
  /// Distribution tier from the catalog. `core` = bundled with the
  /// app installer (always installed after first launch). `remote`
  /// = downloadable on demand. Set on installed courses too so the
  /// Library can sort core books to the front of the shelf.
  tier?: "core" | "remote";
  /// "Unlisted" flag. When true, the course is reachable by a direct
  /// link (`?courseId=…`) and shows up in the active tab if opened,
  /// but is excluded from every catalog/library/sidebar listing so
  /// it doesn't surface to people who don't already have the URL.
  /// Set in the catalog manifest entry; threaded through
  /// `webSeedCourses` onto the saved Course so the Library can
  /// filter on a single field instead of cross-referencing the
  /// catalog. Used for share-by-link previews of courses we don't
  /// want in the discoverable catalog yet.
  hidden?: boolean;
  /// When true, the course assumes the learner will connect a
  /// hardware wallet (currently: Ledger only). Setting this:
  ///   - Mounts the LedgerStatusPill in the lesson view header so
  ///     the learner can connect / see status anywhere in the course.
  ///   - Lets `device-action` markdown fences in readings work
  ///     (they're harmless without a connection but most verbs
  ///     need one).
  ///   - Allows individual exercises in this course to set
  ///     `requiresDevice` and gate their solution behind a live
  ///     APDU exchange with the connected device.
  /// Currently used by `learning-ledger`. Other courses leave this
  /// undefined and ignore the device-related affordances.
  requiresDevice?: "ledger";
}

export interface Chapter {
  id: string;
  title: string;
  lessons: Lesson[];
  /// Per-locale chapter-title overlays. Same merge semantics as
  /// `Course.translations`.
  translations?: import("./locales").TranslationOverlay<
    import("./locales").ChapterTranslation
  >;
}

export type Lesson =
  | ReadingLesson
  | ExerciseLesson
  | MixedLesson
  | QuizLesson;

interface LessonBase {
  id: string;
  title: string;
  /** Markdown body shown in the reading pane. Code fences are highlighted via Shiki. */
  body: string;
  /**
   * 3-5 short bullets that say what the learner will know after this lesson.
   * Rendered as a "You'll learn" card above the body. Optional so older
   * lessons (or very short ones) can skip it — the reader just hides the
   * card when the array is missing or empty.
   */
  objectives?: string[];
  /**
   * Auto-generated reading aids for this lesson. Populated at ingest time
   * (see `generate_lesson` + the one-off `enrich_lesson` command) so
   * rendering costs nothing at read time. Everything inside is optional:
   * the reader degrades gracefully when `enrichment` is missing.
   */
  enrichment?: LessonEnrichment;
  /**
   * Per-locale overlays for every user-visible string on this lesson:
   * title, body markdown, objectives, plus exercise hints + quiz
   * questions when applicable. The reader merges via `localizedLesson`
   * — missing overlay or missing key falls back to the English source.
   * See `src/data/locales.ts`.
   */
  translations?: import("./locales").TranslationOverlay<
    import("./locales").LessonTranslation
  >;
}

/**
 * Glossary / symbol reference data cached alongside the lesson's body.
 * Kept separately so the reader can compute first-use wrapping without
 * re-parsing the markdown, and so a future "lint the lesson" step can
 * validate every referenced term exists.
 */
export interface LessonEnrichment {
  /**
   * Every term-of-art introduced in this lesson (e.g. "closure", "borrow",
   * "generator"). Used for two UI pieces:
   *   - dotted underline on the FIRST occurrence of each term in the body
   *   - the collapsible Glossary side panel
   */
  glossary?: GlossaryEntry[];
  /**
   * Mapping from inline-code tokens (as they appear in backticks) to a
   * short signature + 1-line description + official doc URL. Drives the
   * hoverable popover on inline `code` spans and the "View full docs →"
   * link inside it.
   */
  symbols?: SymbolEntry[];
}

export interface GlossaryEntry {
  /** The term as it appears in the prose. Case-sensitive first-match. */
  term: string;
  /** One-sentence plain-language definition. Kept tight for popovers. */
  definition: string;
}

export interface SymbolEntry {
  /**
   * The string as it appears inside backticks, e.g. "Array.prototype.map"
   * or "Vec::new". Matched exactly against the text inside `<code>`.
   */
  pattern: string;
  /** Optional one-line signature shown above the description. */
  signature?: string;
  /** One-sentence description of what the symbol does. */
  description?: string;
  /**
   * Canonical docs URL — MDN for JS/TS, doc.rust-lang.org for Rust,
   * pkg.go.dev for Go, docs.python.org for Python. Click opens in the
   * default browser via Tauri's opener plugin.
   */
  docUrl?: string;
}

export interface ReadingLesson extends LessonBase {
  kind: "reading";
}

export interface ExerciseLesson extends LessonBase {
  kind: "exercise";
  language: LanguageId;
  /** Legacy single-file starter. For multi-file exercises, see `files`. */
  starter: string;
  /** Hidden reference solution for the single-file flow. See also `solutionFiles`. */
  solution: string;
  /** Hidden test file the evaluator runs against the user's code. */
  tests: string;
  /**
   * Progressive hints. The UI reveals them one at a time (click 1 shows hint
   * 0, click 2 shows hints 0–1, etc) so learners can escalate help as needed.
   * Optional — legacy lessons without hints just disable the Hint button.
   */
  hints?: string[];
  /**
   * Multi-file workbench. When present, takes precedence over `starter`. Each
   * file becomes a tab in the editor. The runnable files (matching the
   * lesson's primary language) are concatenated in order before running.
   */
  files?: WorkbenchFile[];
  /** Reference solution for a multi-file exercise. Mirrors `files` shape. */
  solutionFiles?: WorkbenchFile[];
  /**
   * Challenge-pack metadata (ignored when the parent course's packType is
   * "course"). Drives difficulty-dot coloring in the sidebar and the
   * topic bucket counts in the Profile view.
   */
  difficulty?: Difficulty;
  topic?: string;
  /**
   * Selects an enriched test harness with chain-aware globals.
   * Default (undefined) keeps the legacy "tests run against compiled
   * output / module exports" behavior. Set "evm" for Solidity/Vyper
   * deploy+call lessons (test code receives a `chain` global with
   * `deploy`, `read`, `write`, `expectRevert`); "solana" for LiteSVM
   * lessons. See docs/evm-solana-runtime-design.md.
   */
  harness?: "evm" | "solana" | "bitcoin" | "trade";
  /**
   * Building-blocks render data. When present, the lesson can be played
   * in a tap-to-place / drag-to-place mode where the learner fills in
   * holes in `blocks.template` from a pool of code blocks. Mobile
   * always uses this mode when present; desktop offers a toggle
   * between the editor and blocks. Verification synthesises source by
   * replacing each `__SLOT_<id>__` marker with the placed block's
   * code, then runs through the SAME `runFiles` pipeline editor mode
   * uses — no parallel verifier.
   *
   * Auto-generated for every exercise by `scripts/generate-blocks.mjs`
   * (LLM-assisted: picks pedagogically meaningful slots, drafts
   * decoys from sibling lessons). Idempotent on solution+lesson hash.
   */
  blocks?: BlocksData;
}

/**
 * A mixed lesson has reading prose AND a runnable exercise. Used when a book
 * section is mostly narrative but caps with a "try it" task.
 */
export interface MixedLesson extends LessonBase {
  kind: "mixed";
  language: LanguageId;
  starter: string;
  solution: string;
  tests: string;
  hints?: string[];
  files?: WorkbenchFile[];
  solutionFiles?: WorkbenchFile[];
  difficulty?: Difficulty;
  topic?: string;
  harness?: "evm" | "solana" | "bitcoin" | "trade";
  /** See ExerciseLesson.blocks — same shape, same semantics. */
  blocks?: BlocksData;
}

/**
 * Building-blocks render data attached to an exercise. The learner sees
 * `template` with the static portions filled in and `__SLOT_<id>__`
 * holes for the rest; they pick from `pool` to fill each slot. The
 * exercise's existing `solution` + `tests` are the source of truth —
 * blocks data is just a different *render mode* of the same exercise.
 *
 * Source synthesis at verify time: walk `template`, replace every
 * `__SLOT_<id>__` with the code of the block currently placed in
 * that slot, then ship the assembled string through the standard
 * `runFiles` pipeline. All slots filled correctly + tests pass =
 * lesson complete (same completion criteria as editor mode).
 */
export interface BlocksData {
  /**
   * Canonical code with `__SLOT_<id>__` markers in place of the
   * pieces the learner has to fill in. Everything else is read-only
   * context (imports, function signatures, scaffolding the exercise
   * provides). Markers can appear inline (`let x = __SLOT_init__;`)
   * or block-level (one marker per logical statement).
   */
  template: string;
  /**
   * One entry per `__SLOT_<id>__` marker in `template`. Declares the
   * canonical block id for each slot — used by the source
   * synthesiser to know which block belongs where, and by the
   * verifier to check correctness without running the full test
   * suite (we still run the suite, but a structural check first
   * gives instant per-slot feedback).
   */
  slots: BlockSlot[];
  /**
   * Every block the learner can pick from. Includes the correct
   * blocks (one per slot, referenced by `BlockSlot.expectedBlockId`)
   * plus optional decoys that look plausible but yield a wrong
   * solution. The renderer shuffles at render time so retries don't
   * show options in the same visual sequence.
   */
  pool: Block[];
  /**
   * Optional one-line intro shown above the blocks tray. Falls back
   * to a verb-derived prompt ("Place each block in the right slot.")
   * when missing.
   */
  prompt?: string;
  /**
   * Which file in the exercise's multi-file workbench this template
   * belongs to. Defaults to the main runnable file (or the legacy
   * single-file `starter`). Multi-file exercises that want blocks
   * for more than one file should encode each file's blocks
   * separately — for v1 we only support one file's worth of blocks
   * per exercise.
   */
  fileName?: string;
}

export interface BlockSlot {
  /// Stable id matching a `__SLOT_<id>__` marker in `template`.
  /// Generated at build time so retries on the same lesson don't
  /// regenerate ids (which would let learners memorise positions).
  id: string;
  /// Id of the block from `pool` that's the canonical fill. The
  /// synthesiser consults this when running the test suite; the
  /// per-slot structural check uses it for instant feedback.
  expectedBlockId: string;
  /// Optional one-word category for the slot's empty-state placeholder
  /// ("statement", "expression", "keyword"). Purely cosmetic.
  hint?: string;
}

export interface Block {
  /// Stable id, referenced from `BlockSlot.expectedBlockId` and the
  /// renderer's drag-source key.
  id: string;
  /// The code fragment shown on the block. Pre-formatted (matching
  /// the indentation it should have when placed in the template's
  /// slot). Verbatim insertion — the synthesiser does NOT reformat.
  code: string;
  /// True for decoy blocks that don't belong in any slot. Decoys
  /// look plausible (sibling-lesson statements, common mistakes) but
  /// yield a wrong solution if placed. Default false.
  decoy?: boolean;
}

/**
 * Synthesise the source string a learner's blocks placement
 * represents. Walk `template`, replace each `__SLOT_<id>__` marker
 * with either the placed block's `code` (when the slot has a
 * placement) or `placeholder` (default `__BLANK__`, surfaced to the
 * compiler as a syntax error if any slot is unfilled).
 *
 * Used by the BlocksView verifier (call with the learner's current
 * placements before shipping to `runFiles`) and by tests / the
 * auto-derive pipeline (call with the canonical placements derived
 * from `slots[].expectedBlockId` to reconstruct the original
 * solution and confirm the template + slots round-trip).
 */
export function assembleBlocksSource(
  data: BlocksData,
  placements: Record<string, string | undefined>,
  placeholder = "__BLANK__",
): string {
  const blockById = new Map(data.pool.map((b) => [b.id, b]));
  return data.template.replace(/__SLOT_([A-Za-z0-9_-]+)__/g, (_match, slotId) => {
    const blockId = placements[slotId];
    if (!blockId) return placeholder;
    const block = blockById.get(blockId);
    return block ? block.code : placeholder;
  });
}

/**
 * Whether every slot in `data` has a placement in `placements`. Used
 * to gate the "Verify" button — no point shipping a half-filled
 * template through the compiler. Doesn't check correctness; that's
 * the verifier's job.
 */
export function isBlocksFullyPlaced(
  data: BlocksData,
  placements: Record<string, string | undefined>,
): boolean {
  return data.slots.every((s) => Boolean(placements[s.id]));
}

/**
 * Whether every slot in `data` has its canonical block placed.
 * Used for instant per-slot feedback BEFORE the user clicks Verify
 * — green outline on correct slots, neutral on empty, red on wrong
 * placements. The compile-based verifier still owns lesson
 * completion; this is just visual reassurance during play.
 */
export function isBlocksAllCorrect(
  data: BlocksData,
  placements: Record<string, string | undefined>,
): boolean {
  return data.slots.every((s) => placements[s.id] === s.expectedBlockId);
}

/**
 * Checkpoint lesson — a small batch of questions the user must get right to
 * complete the lesson. Mixes multiple-choice and short-answer so we can cover
 * both "pick the right definition" and "fill in the identifier" cases without
 * needing a full exercise.
 */
export interface QuizLesson extends LessonBase {
  kind: "quiz";
  questions: QuizQuestion[];
}

export type QuizQuestion = QuizMcq | QuizShort;

export interface QuizMcq {
  kind: "mcq";
  prompt: string;
  options: string[];
  /** Index into `options` of the correct answer. */
  correctIndex: number;
  /** Optional context shown after an answer is committed. */
  explanation?: string;
}

export interface QuizShort {
  kind: "short";
  prompt: string;
  /**
   * Accepted answers. Matching is case-insensitive and punctuation-stripped,
   * so `"prototype"`, `"Prototype"`, and `"prototype."` all match.
   */
  accept: string[];
  explanation?: string;
}

export function isExerciseKind(lesson: Lesson): lesson is ExerciseLesson | MixedLesson {
  return lesson.kind === "exercise" || lesson.kind === "mixed";
}

export function isQuiz(lesson: Lesson): lesson is QuizLesson {
  return lesson.kind === "quiz";
}

/// Compatibility shim — was used to strip mobile-only lesson kinds
/// (puzzle / cloze / micropuzzle) from the desktop nav surfaces. Those
/// kinds have been retired in favour of `ExerciseLesson.blocks` (the
/// unified blocks render mode), so the function is now an identity
/// pass-through. Kept exported so existing call sites in App.tsx keep
/// compiling without churn — those call sites can migrate to the raw
/// course objects at their leisure.
export function filterCourseForDesktop(course: Course): Course {
  return course;
}

// Legacy mobile-first lesson kinds (`puzzle`, `cloze`, `micropuzzle`)
// were retired when the unified BlocksData render mode landed. The
// equivalent UX now lives on `ExerciseLesson.blocks` / `MixedLesson.blocks`
// and renders identically on desktop + mobile via `BlocksView`. The
// `scrub-legacy-block-kinds.mjs` script removed all such lessons from
// staged + bundled + installed course packs in the same migration.

/// Challenge packs and courses share the same shape — this is the single
/// source of truth for which is which. Missing `packType` (legacy courses
/// on disk) counts as "course" so nothing changes for existing data.
export function isChallengePack(course: Course): boolean {
  return course.packType === "challenges";
}

/// Exercism-style language curriculums — the third packType
/// variant added alongside `course` / `challenges`. Library
/// renders them as a distinct section with language-icon cards
/// (no cover art), so the catalog has three lanes: Books,
/// Tracks, Challenges. Predicate centralises the check so
/// future additions (multi-track filters, dedupe rules, the
/// `categorize` partitioner) all agree on what counts.
export function isExerciseTrack(course: Course): boolean {
  return course.packType === "track";
}

/// Koans-style ingest packs — fourth packType variant. Shares the
/// Challenges page surface with tracks + challenge packs because
/// the user-facing pedagogy ("solve exercises, see tests pass") is
/// the same family. Kept distinct from `"track"` so the page can
/// label / sort / future-filter the two groups independently.
export function isKoans(course: Course): boolean {
  return course.packType === "koans";
}

/// rustlings-style "fix the broken code" packs — fifth packType
/// variant (rustlings / ziglings / golings / swiftlings /
/// haskellings / exlings / cplings). Same Challenges-page surface
/// as koans + tracks + challenges; distinct packType so the famous
/// *lings family gets its own labelled section and the Library
/// strips them like the other exercise-driven pack kinds.
export function isLings(course: Course): boolean {
  return course.packType === "lings";
}

/** Canonicalize a user or accepted-answer string for short-answer matching. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
