/// Editorial classification for the bundled `.libre` archives:
/// which ship inline with the app (core) vs which appear as
/// downloadable placeholders (remote), plus release-status
/// overrides.
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
/// NOTE — which packs are *published at all* is NOT decided here.
/// That lives in `scripts/published-courses.json` (the explicit
/// publish list). This file only classifies the published set.
///
/// Adding a new core book: drop the .academy into
/// `src-tauri/resources/bundled-packs/`, add the id to
/// `published-courses.json` AND `CORE_PACK_IDS` below, add the
/// matching path entry to `tauri.conf.json` `resources`. Adding a
/// new remote book: drop the .academy into `bundled-packs/` and add
/// the id to `published-courses.json` only — the build script +
/// catalog take care of the rest.

import { readFileSync } from "node:fs";

/// The explicit publish list — every pack id that ships in the live
/// catalog manifest, in render order. Checked into the repo as JSON
/// so surgical live additions (agents patching the VPS directly) can
/// update it programmatically. See the `$comment` block in the JSON
/// for the full contract.
const publishedDoc = JSON.parse(
  readFileSync(new URL("./published-courses.json", import.meta.url), "utf-8"),
);

export const PUBLISHED_PACK_IDS = publishedDoc.packIds;

/// Catalog manifest format/content version, written verbatim into
/// manifest.json. Must never decrease — the live manifest was
/// hand-bumped to 4 on 2026-06-10 and the deploy guard in
/// Web/libre.academy refuses version regressions.
export const MANIFEST_VERSION = publishedDoc.manifestVersion;

export const CORE_PACK_IDS = [
  // The default loadout = the full Rust, Go, Zig and JavaScript/TypeScript
  // learning TRACKS (the four "installed-by-default" collections), MINUS
  // the pure front-end framework courses (Svelte / SolidJS / Astro / HTMX
  // / Bun), which stay published-but-REMOTE — one-click installs from
  // Discover. The SQL challenge pack rides along because it's the closing
  // step of the Entry-Level Developer track.
  //
  // MUST stay in lockstep with `should_seed_pack` in
  // `src-tauri/src/courses.rs` (the desktop first-launch seeder) — both
  // list the same set, by the same bundle filename / pack id. Note a few
  // pack ids differ from the in-zip course id (`the-rustonomicon` →
  // `rustonomicon`, `javascript-challenges` → `challenges-javascript-handwritten`).

  // ── Rust track ─────────────────────────────────────────────────
  "the-rust-programming-language",
  "rustlings",
  "exercism-rust",
  "testing-rust",
  "challenges-rust-handwritten",
  "rust-async-book",
  "the-rustonomicon",

  // ── Go track ───────────────────────────────────────────────────
  "learning-go",
  "golings",
  "exercism-go",
  "challenges-go-handwritten",

  // ── Zig track ──────────────────────────────────────────────────
  // A to Zig is the in-house book (replaced the retired `learning-zig`).
  "a-to-zig",
  "ziglings",
  "exercism-zig",
  "challenges-zig-handwritten",

  // ── JavaScript / TypeScript track ──────────────────────────────
  // JavaScript for Beginners (the absolute-beginner on-ramp) + the two
  // other in-house books + You Don't Know JS Yet, plus the practice set
  // we already shipped (Exercism JS/TS, Koans, JS Challenges). The other
  // JS reference books (Eloquent JS, JavaScript.info, Functional-Light,
  // Crafting Interpreters) and all front-end frameworks are browse-to-
  // install from Discover.
  "javascript-for-beginners",
  "javascript-typescript",
  "testing-javascript",
  "you-dont-know-js-yet",
  "exercism-javascript",
  "exercism-typescript",
  "javascript-koans",
  "javascript-challenges",

  // ── Entry-Level Developer track closer ─────────────────────────
  "challenges-sql-handwritten",
];

/// Back-compat alias for the publish list. Historically this was a
/// second hand-curated array in this file, and a pack id missing
/// from it (e.g. `learning-react-native`, dropped in a 2026-05-07
/// cleanup comment) silently vanished from every regenerated
/// manifest even though its archive was still on disk and live —
/// that's the bug that kept clobbering the production manifest.
/// The literal array is gone; the publish list in
/// `published-courses.json` is the only place packs are added or
/// removed now. Prefer importing PUBLISHED_PACK_IDS in new code.
export const ALL_PACK_IDS = PUBLISHED_PACK_IDS;

/// Whether a pack is bundled with the app (extracted on first
/// launch) vs downloaded on demand. Drives the catalog `tier`
/// field which the Library uses to render placeholders.
export function tierFor(packId) {
  return CORE_PACK_IDS.includes(packId) ? "core" : "remote";
}

/// Pack ids that should be installed-able but NOT browsable. Each id
/// here gets `hidden: true` stamped onto its catalog manifest entry,
/// which kicks in three filters downstream:
///
///   1. `lib/catalog.ts` drops hidden entries from `fetchCatalog()`,
///      so the Discover grid never lists them.
///   2. The desktop App + mobile App filter `coursesAll.filter(c =>
///      !c.hidden)` so the Library tree doesn't show them either.
///   3. `data/webSeedCourses.ts` still seeds hidden entries into the
///      browser's IndexedDB, but stamps the `hidden: true` flag
///      onto the saved record so the library filter above kicks in
///      from the first paint.
///
/// Net effect: a hidden course is fully installed + ready, but only
/// reachable via a direct lesson URL (`?course=<id>&lesson=<id>`) or
/// a manual `.libre` import. Useful for partner / preview content
/// we want the URL of without exposing in the public shelf.
export const HIDDEN_PACK_IDS = new Set([
  // (empty — hellotrade graduated to Discover with the public BETA
  // surface; add new partner / preview ids here when they need a
  // direct-link-only soft launch)
]);

export function isHiddenPack(packId) {
  return HIDDEN_PACK_IDS.has(packId);
}

/// Default base URL where the remote `.libre` archives are
/// hosted. The catalog includes per-course archive URLs derived from
/// this — change here OR set LIBRE_CATALOG_BASE_URL at build time
/// to point at your own hosting.
export const REMOTE_ARCHIVE_BASE =
  process.env.LIBRE_CATALOG_BASE_URL ??
  // Host the desktop download archives on libre's OWN box, not
  // mattssoftware.com. The old mattssoftware/fishbones/courses/ path
  // lived under /var/www/mattssoftware/, which the separate
  // mattssoftware repo deploy `rsync --delete`-wipes on every push —
  // it erased the uploaded archives within a day. libre.academy serves
  // /courses/*.academy via the Caddyfile `@courseArchive` matcher
  // (with CORS); the files live in /var/www/libre-academy/courses/ and
  // the libre deploy's rsync `--exclude=courses/` protects them.
  "https://libre.academy/courses";

/// Editorial-tier overrides keyed by **pack id** (the .libre
/// filename minus extension). Applied by the extract script AFTER
/// reading each course.json so we can bump a book's tier without
/// repacking the archive.
///
/// Tier vocabulary:
///   - "VERIFIED"   — fully reviewed + verified end-to-end; the
///                    highest editorial tier. Sorts above every
///                    other book in the library's "Status" sort.
///   - "BETA"       — final polish for release; renders at the top
///                    of the library section list.
///   - "ALPHA"      — next up in the queue; middle section.
///   - "UNREVIEWED" — drafts; bottom section. Default when a course
///                    has no releaseStatus AND no entry here.
///
/// To remove an override and let the in-zip value win, delete the
/// pack id from this map.
export const RELEASE_STATUS_OVERRIDES = {
  // ── Books verified end-to-end (highest tier) ──────────────────
  // The Rust Programming Language + Rustlings — reviewed and
  // verified cover-to-cover; they anchor the top of the Status sort.
  "the-rust-programming-language": "VERIFIED",
  "rustlings": "VERIFIED",
  // The Go stack — shipped at full release alongside Rust + JS/TS as
  // the platform's default languages: the Learning Go book, the
  // Golings + Exercism Go exercise courses, and the Go challenge pack.
  "learning-go": "VERIFIED",
  "golings": "VERIFIED",
  "exercism-go": "VERIFIED",
  "challenges-go-handwritten": "VERIFIED",

  // ── Books bumped to BETA after substantive validation ─────────
  // JavaScript for Beginners — in-house absolute-beginner on-ramp;
  // all 12 exercises validated (solution passes / starter fails)
  // against the runtime test harness.
  "javascript-for-beginners": "BETA",
  // JavaScript & TypeScript — flagship original book. Every exercise,
  // playground, quiz, blocks spec and diagram machine-validated
  // (88/88 exercises, 230/230 playgrounds) before release.
  "javascript-typescript": "BETA",
  // Testing JavaScript — in-house book; all 13 exercises validated
  // (solution passes / starter fails) against the runtime's test harness.
  "testing-javascript": "BETA",
  // Updated to use viem-style runtime + verified passing through
  // the cmd+K verifier.
  "mastering-ethereum": "BETA",
  "mastering-bitcoin": "BETA",
  "solana-programs-rust-on-the-svm": "BETA",
  // Eloquent JavaScript (Marijn Haverbeke, CC BY-NC) — un-retired and
  // brought to BETA: every inline example converted to a runnable
  // sandbox playground (59) and validated, 19 exercises pass
  // solution-vs-tests, 9 inline SVG diagrams. Ships in the v1.2.2 bundle
  // alongside the markdown renderer's data:image/svg+xml allowance.
  "eloquent-javascript": "BETA",

  // ── Books bumped to ALPHA ────────────────────────────────────
  // (Vyper override removed 2026-05-10 alongside the ALL_PACK_IDS
  // cleanup — no archive shipped, so the override had nothing to
  // attach to.)

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
  if (
    inZipStatus === "VERIFIED" ||
    inZipStatus === "BETA" ||
    inZipStatus === "ALPHA"
  ) {
    return inZipStatus;
  }
  return "UNREVIEWED";
}
