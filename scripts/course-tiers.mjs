/// Single source of truth for which bundled `.fishbones` archives ship
/// inline with the app vs which appear as downloadable placeholders.
///
/// **Core** = bundled with the desktop installer and inlined into
/// the web build's first-launch seed. Always present after install.
///
/// **Remote** = listed in the catalog with a download URL. Render as
/// semi-opaque placeholders in the Library; one click installs.
///
/// The intent: ship a small enough core that the desktop installer
/// stays under ~30 MB (vs 145 MB if we bundle everything), while
/// still giving learners an opinionated starting set on first
/// launch (Rust + Go + every challenge pack so kata-style learners
/// can start immediately in any language).
///
/// Adding a new core book: drop the .fishbones into
/// `src-tauri/resources/bundled-packs/`, add the id here, add the
/// matching path entry to `tauri.conf.json` `resources`. Adding a
/// new remote book: drop the .fishbones into `bundled-packs/` and
/// add the id to ALL_PACK_IDS only — the build script + catalog
/// take care of the rest.

export const CORE_PACK_IDS = [
  // Long-form books we want every install to start with.
  "the-rust-programming-language",
  "learning-go",

  // All challenge packs — kata-style learners are likely to bounce
  // through several languages, and the per-pack size is small
  // (~50-200 KB each). Cheap to ship them all.
  "rust-challenges",
  "go-challenges",
  "javascript-challenges",
  "typescript-challenge-pack",
  "python-challenges",
  "react-native-challenges",
  "c-challenges",
  "cpp-challenges",
  "java-challenges",
  "kotlin-challenges",
  "csharp-challenges",
  "swift-challenges",
  "assembly-challenges-arm64-macos",

  // ── 2026 expansion ───────────────────────────────────────────
  // Eleven Easy challenge packs added in the language expansion.
  // Same naming convention as recent additions (`challenges-<lang>-
  // handwritten`) so the in-zip course id matches the bundle
  // filename. All small (5 lessons each), so they fit the "ship
  // them all" rationale above.
  "challenges-ruby-handwritten",
  "challenges-lua-handwritten",
  "challenges-dart-handwritten",
  "challenges-haskell-handwritten",
  "challenges-scala-handwritten",
  "challenges-sql-handwritten",
  "challenges-elixir-handwritten",
  "challenges-zig-handwritten",
  // Move / Cairo / Sway runtimes are stubbed — Run currently surfaces
  // an install-hint banner. The packs ship anyway so the content is
  // installed and ready to run when the runtimes land.
  "challenges-move-handwritten",
  "challenges-cairo-handwritten",
  "challenges-sway-handwritten",
];

/// Every pack we extract metadata for at build time. Anything in
/// here but NOT in CORE_PACK_IDS becomes a remote placeholder. Kept
/// in the same order the Library should display them in.
export const ALL_PACK_IDS = [
  // ── Languages-as-a-foundation books ────────────────────────────
  "the-rust-programming-language",
  "rust-by-example",
  "the-async-book-rust",
  "the-rustonomicon",
  "eloquent-javascript",
  "the-modern-javascript-tutorial-fundamentals",
  "javascript-the-definitive-guide",
  "you-don-t-know-js-yet",
  "composing-programs",
  "python-crash-course",
  "learning-go",

  // ── Computer-science fundamentals ──────────────────────────────
  "algorithms-erickson",
  "open-data-structures",
  "crafting-interpreters-javascript",
  "pro-git",

  // ── Frameworks + libraries ─────────────────────────────────────
  "learning-svelte",
  "solidjs-fundamentals",
  "htmx-fundamentals",
  "astro-fundamentals",
  "react-native",
  "learning-react-native",
  "fluent-react",
  "tauri-2-fundamentals",
  "interactive-web-development-with-three-js-and-a-frame",

  // ── Smart-contract / web3 / crypto ─────────────────────────────
  "mastering-bitcoin",
  "programming-bitcoin",
  "mastering-ethereum",
  "mastering-lightning-network",
  "solidity-smart-contracts-from-first-principles",
  "vyper-fundamentals-pythonic-smart-contracts",
  "solana-programs-rust-on-the-svm",
  "viem-and-ethers-js-talking-to-ethereum-from-typescript",
  "cryptography-fundamentals-hashes-to-zk",

  // ── Challenge packs ───────────────────────────────────────────
  "javascript-challenges",
  "typescript-challenge-pack",
  "python-challenges",
  "go-challenges",
  "rust-challenges",
  "react-native-challenges",
  // Desktop-only challenge packs (their languages need a local
  // toolchain). Web build skips them at runtime via the desktopOnly
  // gate in runtimes/index.ts; they're still bundled in core because
  // the pack itself is tiny and ships even if the runtime can't run.
  "c-challenges",
  "cpp-challenges",
  "java-challenges",
  "kotlin-challenges",
  "csharp-challenges",
  "swift-challenges",
  "assembly-challenges-arm64-macos",
  // 2026 language-expansion challenge packs — also small, also
  // shipped in core. Order mirrors CORE_PACK_IDS.
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
];

/// Whether a pack is bundled with the app (extracted on first
/// launch) vs downloaded on demand. Drives the catalog `tier`
/// field which the Library uses to render placeholders.
export function tierFor(packId) {
  return CORE_PACK_IDS.includes(packId) ? "core" : "remote";
}

/// Default base URL where the remote `.fishbones` archives are
/// hosted. The catalog includes per-course archive URLs derived from
/// this — change here OR set FISHBONES_CATALOG_BASE_URL at build time
/// to point at your own hosting.
export const REMOTE_ARCHIVE_BASE =
  process.env.FISHBONES_CATALOG_BASE_URL ??
  "https://mattssoftware.com/fishbones/courses";

/// Editorial-tier overrides keyed by **pack id** (the .fishbones
/// filename minus extension). Applied by the extract script AFTER
/// reading each course.json so we can bump a book's tier without
/// repacking the archive.
///
/// Tier vocabulary:
///   - "BETA"       — final polish for release; renders at the top
///                    of the library section list.
///   - "ALPHA"      — next up in the queue; middle section.
///   - "UNREVIEWED" — drafts; bottom section. Default when a course
///                    has no releaseStatus AND no entry here.
///
/// To remove an override and let the in-zip value win, delete the
/// pack id from this map.
export const RELEASE_STATUS_OVERRIDES = {
  // ── Books bumped to BETA after substantive validation ─────────
  // Counter exercise + EVM harness now run end-to-end; lessons
  // exercise the solc-js / @ethereumjs/vm path directly.
  "solidity-smart-contracts-from-first-principles": "BETA",
  // Updated to use viem-style runtime + verified passing through
  // the cmd+K verifier.
  "mastering-ethereum": "BETA",
  "mastering-bitcoin": "BETA",
  "solana-programs-rust-on-the-svm": "BETA",

  // ── Books bumped to ALPHA ────────────────────────────────────
  // Vyper went from 0 exercises to a full set after the recent
  // expansion pass; promoted out of the bottom section.
  "vyper-fundamentals-pythonic-smart-contracts": "ALPHA",

  // ── Challenge packs ──────────────────────────────────────────
  // Auto-generated kata sets validated as a class via the recent
  // runtime hardening (rand 0.10 trait fix, parseTestResults
  // defensive parsing, should_panic regex, missing-imports infer).
  // All challenge packs ship at BETA — they're small, focused, and
  // either run end-to-end on the host (the original 11) or against
  // a stubbed-runtime install-hint banner (Move / Cairo / Sway).
  "javascript-challenges": "BETA",
  "typescript-challenge-pack": "BETA",
  "python-challenges": "BETA",
  "react-native-challenges": "BETA",
  "c-challenges": "BETA",
  "cpp-challenges": "BETA",
  "java-challenges": "BETA",
  "kotlin-challenges": "BETA",
  "csharp-challenges": "BETA",
  "swift-challenges": "BETA",
  "assembly-challenges-arm64-macos": "BETA",
  "rust-challenges": "BETA",
  "go-challenges": "BETA",
  // ── 2026 expansion challenge packs ───────────────────────────
  // Same BETA tier — the runtimes for Ruby / Lua / Dart / Haskell
  // / Scala / SQL / Elixir / Zig run via the host's installed CLI
  // (or browser-native for Lua / SQL). Move / Cairo / Sway carry
  // BETA too because the content + #[test] form is final; the
  // language-runtime stubs surface install-hint banners cleanly.
  "challenges-ruby-handwritten": "BETA",
  "challenges-lua-handwritten": "BETA",
  "challenges-dart-handwritten": "BETA",
  "challenges-haskell-handwritten": "BETA",
  "challenges-scala-handwritten": "BETA",
  "challenges-sql-handwritten": "BETA",
  "challenges-elixir-handwritten": "BETA",
  "challenges-zig-handwritten": "BETA",
  "challenges-move-handwritten": "BETA",
  "challenges-cairo-handwritten": "BETA",
  "challenges-sway-handwritten": "BETA",
};

/// Normalise a course's tier through the override map. Falls back to
/// the in-zip value when no override is set, then to UNREVIEWED.
export function releaseStatusFor(packId, inZipStatus) {
  const override = RELEASE_STATUS_OVERRIDES[packId];
  if (override) return override;
  if (inZipStatus === "BETA" || inZipStatus === "ALPHA") return inZipStatus;
  return "UNREVIEWED";
}
