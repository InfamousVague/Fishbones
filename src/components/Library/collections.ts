/// Curated topic collections for the Library + Discover shelves. A
/// collection is a hand-picked set of catalog ids that the UI surfaces
/// as a single "folder" tile; opening the folder shows every member
/// together — books AND challenge packs / tracks — which the normal
/// surfaces deliberately keep apart (books in the Library, packs on the
/// Challenges page). Membership is curated (not derived from language)
/// so a collection can mix related-but-differently-tagged material
/// (e.g. Solana programs live under Rust here even though the catalog
/// files them as crypto).
export interface Collection {
  id: string;
  title: string;
  blurb: string;
  /// Accent colour for the folder tile — matches the language's
  /// cover-art palette family (Rust = burnt orange).
  accent: string;
  /// Short badge label shown in the folder's accent-tinted pill (the
  /// full `title` renders below it). Keep it to a few characters —
  /// it reads like the language tags on the Challenges cards.
  short: string;
  memberIds: ReadonlySet<string>;
  /// Learning paths that belong to this topic (ids into
  /// `data/paths.ts` LEARNING_PATHS). Rendered as a "Path" card at
  /// the top of the open-collection view — the curated way THROUGH
  /// the folder's contents.
  pathIds?: readonly string[];
}

export const COLLECTIONS: readonly Collection[] = [
  {
    id: "rust",
    title: "Rust",
    short: "RS",
    pathIds: ["rust-developer"],
    blurb: "Everything Rust — the books, the Exercism track, Rustlings, and the challenge pack.",
    accent: "#b5532a",
    memberIds: new Set([
      "the-rust-programming-language",
      "rust-by-example",
      "testing-rust",
      "rustonomicon",
      "rust-async-book",
      "challenges-rust-handwritten",
      "exercism-rust",
      "rustlings",
    ]),
  },
  {
    id: "python",
    title: "Python",
    short: "PY",
    blurb: "Everything Python — the books, the Exercism track, the koans, and the challenge pack.",
    accent: "#3f8a7c",
    memberIds: new Set([
      "automate-the-boring-stuff",
      "dive-into-deep-learning",
      "composing-programs",
      "open-data-structures",
      "algorithms-erickson",
      "exercism-python",
      "challenges-python-handwritten",
      "python-koans",
    ]),
  },
  {
    id: "go",
    title: "Go",
    short: "GO",
    blurb: "Everything Go — the book, the Exercism track, Golings, and the challenge pack.",
    accent: "#2aa7c4",
    memberIds: new Set([
      "learning-go",
      "exercism-go",
      "challenges-go-handwritten",
      "golings",
    ]),
  },
  {
    id: "zig",
    title: "Zig",
    short: "ZIG",
    blurb: "Everything Zig — the book, the Exercism track, Ziglings, and the challenge pack.",
    accent: "#f7a41d",
    memberIds: new Set([
      "a-to-zig",
      "exercism-zig",
      "challenges-zig-handwritten",
      "ziglings",
    ]),
  },
  {
    id: "web",
    title: "Web",
    short: "JS·TS",
    blurb: "The front-end stack — JavaScript & TypeScript fundamentals, the frameworks, and the drills.",
    accent: "#3f7cc4",
    memberIds: new Set([
      "javascript-typescript",
      "a-to-ts",
      "eloquent-javascript",
      "javascript-info",
      "you-dont-know-js-yet",
      "functional-light-js",
      "crafting-interpreters-js",
      "svelte-5-complete",
      "solidjs-fundamentals",
      "astro-fundamentals",
      "htmx-fundamentals",
      "bun-complete",
      "exercism-javascript",
      "exercism-typescript",
      "challenges-javascript-handwritten",
      "javascript-koans",
    ]),
  },
  {
    id: "crypto",
    title: "Crypto",
    short: "WEB3",
    blurb: "Bitcoin to ZK — the protocol books, the smart-contract languages, and the on-chain challenge packs.",
    accent: "#7d68c0",
    memberIds: new Set([
      "mastering-bitcoin",
      "mastering-ethereum",
      "mastering-lightning-network",
      "solidity-complete",
      "vyper-fundamentals",
      "viem-ethers",
      "cryptography-fundamentals",
      "learning-ledger",
      "solana-programs",
      "challenges-move-handwritten",
      "challenges-cairo-handwritten",
      "challenges-sway-handwritten",
    ]),
  },
  {
    id: "mobile",
    title: "Mobile",
    short: "APPS",
    blurb: "Build for phones — React Native, Swift, and Dart, with their tracks and challenge packs.",
    accent: "#2bb3a3",
    memberIds: new Set([
      "react-native",
      "learning-react-native",
      "challenges-reactnative-handwritten",
      "exercism-swift",
      "swiftlings",
      "challenges-swift-handwritten",
      "exercism-dart",
      "challenges-dart-handwritten",
    ]),
  },
  {
    id: "jvm",
    title: "JVM",
    short: "JVM",
    blurb: "The JVM family — Java, Kotlin, and Scala tracks, koans, and challenge packs.",
    accent: "#b07a3a",
    memberIds: new Set([
      "exercism-java",
      "java-koans",
      "challenges-java-handwritten",
      "exercism-kotlin",
      "kotlin-koans",
      "challenges-kotlin-handwritten",
      "exercism-scala",
      "challenges-scala-handwritten",
    ]),
  },
  {
    id: "functional",
    title: "Functional",
    short: "FP",
    blurb: "Think in functions — Haskell, Elixir, Scala, Clojure, and F#, plus functional JavaScript.",
    accent: "#6e4a7e",
    memberIds: new Set([
      "functional-light-js",
      "exercism-haskell",
      "haskellings",
      "challenges-haskell-handwritten",
      "exercism-elixir",
      "exlings",
      "challenges-elixir-handwritten",
      "exercism-scala",
      "challenges-scala-handwritten",
      "clojure-koans",
      "fsharp-koans",
    ]),
  },
  {
    id: "systems",
    title: "Systems",
    short: "SYS",
    blurb: "Close to the metal — C, C++, and ARM assembly, with their tracks and drills.",
    accent: "#7e7166",
    memberIds: new Set([
      "introduction-to-computer-organization-arm",
      "exercism-c",
      "challenges-c-handwritten",
      "exercism-cpp",
      "cplings",
      "challenges-cpp-handwritten",
      "challenges-assembly-handwritten",
    ]),
  },
  {
    id: "algorithms",
    title: "Algorithms & CS",
    short: "CS",
    blurb: "Computer-science foundations — algorithms, data structures, interpreters, and crypto theory.",
    accent: "#4f5d9c",
    memberIds: new Set([
      "algorithms-erickson",
      "open-data-structures",
      "composing-programs",
      "crafting-interpreters-js",
      "introduction-to-computer-organization-arm",
      "cryptography-fundamentals",
      "select-star-sql",
    ]),
  },
];

export function findCollection(id: string | null | undefined): Collection | undefined {
  return id ? COLLECTIONS.find((c) => c.id === id) : undefined;
}
