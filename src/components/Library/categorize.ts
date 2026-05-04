/// Pure helpers for the course library: categorization, dedup, and
/// the static pill/chain/language tables. Extracted from
/// `CourseLibrary.tsx` so the component file stays focused on
/// rendering — these functions are easy to unit-test in isolation
/// and have no React or DOM dependencies.

import type { Course, LanguageId } from "../../data/types";
import { isChallengePack } from "../../data/types";

/// Top-level "what kind of book is this" split. Library-wide filter
/// that lives above the language pills so a learner can scope the
/// whole grid to crypto material (Bitcoin, Ethereum, Solana, the
/// Solidity/Vyper/Cairo/Move/Sway-based challenge packs, viem-ethers,
/// cryptography-fundamentals) or to plain programming material
/// (everything else).
export type CourseCategory = "crypto" | "programming";

/// Within crypto, which chain/protocol the course is teaching. `other`
/// catches material that's chain-agnostic (cryptography-fundamentals)
/// or about an alt-L1 we don't yet split out (Cairo/Starknet, Move,
/// Sway). Adding a new dedicated chain pill = add an entry here, add
/// a regex/lang rule in `cryptoChain()`, add a label in CHAIN_PILLS.
export type CryptoChain = "bitcoin" | "ethereum" | "solana" | "other";

/// Languages that exist primarily for blockchain work — every course
/// in one of these languages is automatically categorized as crypto.
export const CRYPTO_LANGUAGES: ReadonlySet<string> = new Set([
  "solidity",
  "vyper",
  "cairo",
  "move",
  "sway",
]);

/// Course-id patterns that mark a course as crypto even when the
/// language is general-purpose (Mastering Bitcoin uses JavaScript,
/// Programming Bitcoin uses Python, etc.). Order doesn't matter — any
/// match wins. Tweak this when adding a new crypto book that doesn't
/// fall under a crypto-specific language.
export const CRYPTO_ID_PATTERNS: readonly RegExp[] = [
  /\bbitcoin\b/i,
  /\bethereum\b/i,
  /\bsolana\b/i,
  /\blightning\b/i,
  /\bblockchain\b/i,
  /\bweb3\b/i,
  /\bdefi\b/i,
  /^crypto/i, // catches cryptography-fundamentals; books about /encryption/
  /^viem-/i, // viem-ethers (Ethereum tooling tutorial)
];

/// Classify a course as crypto or programming. Default is programming
/// — only courses that match a crypto language or id pattern get
/// flagged crypto. Pure language-tutorial books (the-rust-programming-
/// language, learning-go, you-dont-know-js-yet, …) stay programming
/// even if a learner uses them later for crypto work.
export function categorizeCourse(course: Course): CourseCategory {
  if (CRYPTO_LANGUAGES.has(course.language)) return "crypto";
  if (CRYPTO_ID_PATTERNS.some((re) => re.test(course.id))) return "crypto";
  return "programming";
}

/// Library-side dedupe for installed challenge packs. The
/// gen-challenges script used to mint nanoid-suffixed packs
/// (`challenges-go-mo9kijkd`) when the now-canonical
/// `challenges-go-handwritten` versions were promoted; users who
/// generated locally before the rename ended up with both on disk.
/// Both have `packType: "challenges"` and the same `language`, and
/// both render as separate Library tiles → visible duplicates.
///
/// Strategy: group by `(language, packType==="challenges")`. When a
/// group has more than one course, prefer the one whose id ends in
/// `-handwritten` (the canonical naming). Among ties, keep the one
/// whose id sorts first — stable + deterministic.
///
/// Books (`packType !== "challenges"`) and challenge groups with
/// only one entry pass through untouched. The dedupe runs in
/// O(n) on the courses array.
export function dedupeChallengePacks(courses: Course[]): Course[] {
  // Group challenge packs by language. Books pass through.
  const challengeGroups = new Map<string, Course[]>();
  const books: Course[] = [];
  for (const c of courses) {
    if (isChallengePack(c)) {
      const list = challengeGroups.get(c.language) ?? [];
      list.push(c);
      challengeGroups.set(c.language, list);
    } else {
      books.push(c);
    }
  }
  const dedupedChallenges: Course[] = [];
  for (const [, group] of challengeGroups) {
    if (group.length === 1) {
      dedupedChallenges.push(group[0]);
      continue;
    }
    // Prefer canonical *-handwritten id; fallback to alphabetical.
    const canonical =
      group.find((c) => c.id.endsWith("-handwritten")) ??
      group.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
    dedupedChallenges.push(canonical);
  }
  return [...books, ...dedupedChallenges];
}

/// Returns true when the chain-pill row should render — at least two
/// distinct chains are present in the crypto subset. With only one
/// chain there's nothing to switch between, so the row hides.
export function chainCountsHasMultiple(
  byChain: Map<CryptoChain, number>,
): boolean {
  let nonEmpty = 0;
  for (const count of byChain.values()) {
    if (count > 0) nonEmpty += 1;
    if (nonEmpty >= 2) return true;
  }
  return false;
}

/// Map a crypto course to its chain. Only meaningful when
/// categorizeCourse() already returned "crypto"; for non-crypto
/// courses the result is undefined behavior (caller's responsibility
/// to gate). Lightning is rolled up under bitcoin since it's a
/// Bitcoin L2. Solidity/Vyper/viem all imply Ethereum.
export function cryptoChain(course: Course): CryptoChain {
  const id = course.id;
  if (/\bbitcoin\b|\blightning\b/i.test(id)) return "bitcoin";
  if (
    /\bethereum\b|^viem-/i.test(id) ||
    course.language === "solidity" ||
    course.language === "vyper"
  ) {
    return "ethereum";
  }
  if (/\bsolana\b/i.test(id)) return "solana";
  return "other";
}

export const CATEGORY_PILLS: ReadonlyArray<{
  id: "all" | CourseCategory;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "programming", label: "Programming" },
];

/// Sub-pills shown as a second row when the user has selected the
/// Crypto category. Pills with a zero count auto-hide (except `all`
/// and the active selection) so the row collapses to whatever's
/// actually present in the library.
export const CHAIN_PILLS: ReadonlyArray<{
  id: "all" | CryptoChain;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "bitcoin", label: "Bitcoin" },
  { id: "ethereum", label: "Ethereum" },
  { id: "solana", label: "Solana" },
  { id: "other", label: "Other" },
];

// Every LanguageId we support. Each pill is hidden at render time when
// there are zero courses for that language (see the `countByLang` filter
// in LibraryControls), so this full list is safe to carry around even
// on a library with just two or three languages — the user only sees
// pills for the languages they actually have courses in, PLUS whatever's
// currently selected as the active filter. Adding a new language
// elsewhere in the app (e.g. extending `LanguageId` in `data/types.ts`)
// requires adding it here too, otherwise its courses would silently
// become unfilterable.
export const LANG_PILLS: Array<{ id: "all" | LanguageId; label: string }> = [
  { id: "all", label: "All" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "csharp", label: "C#" },
  { id: "assembly", label: "Assembly" },
  { id: "web", label: "Web" },
  { id: "threejs", label: "Three.js" },
  { id: "reactnative", label: "React Native" },
];
