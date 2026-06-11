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
  memberIds: ReadonlySet<string>;
}

export const COLLECTIONS: readonly Collection[] = [
  {
    id: "rust",
    title: "Rust",
    blurb: "Everything Rust — the books, the Exercism track, and the challenge packs in one place.",
    accent: "#b5532a",
    memberIds: new Set([
      "the-rust-programming-language",
      "rust-by-example",
      "rustonomicon",
      "rust-async-book",
      "challenges-rust-handwritten",
      "exercism-rust",
      "rustlings",
    ]),
  },
];

export function findCollection(id: string | null | undefined): Collection | undefined {
  return id ? COLLECTIONS.find((c) => c.id === id) : undefined;
}
