/// Sidebar layout registry. Currently a binary toggle between the
/// default list-style chapter tree ("classic") and the high-density
/// grid view of numbered lesson cells ("grid"). The choice only
/// changes how the ACTIVE course's chapter list renders inside the
/// sidebar — the surrounding shell (brand strip, carousel, frosted
/// glass, peeked inactive courses, etc.) is the same in both
/// layouts. `CourseGroup` reads the variant via `useSidebarVariant`
/// and picks between `<ChapterTree>` and `<ChapterGrid>` for the
/// active card's body.
///
/// This file is intentionally data-only — it holds the id table
/// and a couple of cheap lookup helpers. We don't store the
/// rendering component here because both renderers are co-located
/// with the production sidebar (`src/components/Sidebar/`), not
/// with this folder.

export type VariantId = "classic" | "grid";

export interface VariantDef {
  id: VariantId;
  label: string;
}

export const VARIANTS: ReadonlyArray<VariantDef> = [
  { id: "classic", label: "List" },
  { id: "grid", label: "Grid" },
];

export const DEFAULT_VARIANT_ID: VariantId = "classic";

export function getVariant(id: VariantId): VariantDef {
  return VARIANTS.find((v) => v.id === id) ?? VARIANTS[0];
}

export function isKnownVariant(id: string): id is VariantId {
  return VARIANTS.some((v) => v.id === id);
}
