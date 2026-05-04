/// Public surface for documentation pages.
///
/// The original monolithic `src/docs/pages.ts` was split into one
/// file per section (`getting-started.ts`, `architecture.ts`, ...).
/// The shape of `FISHBONES_DOCS` and `FISHBONES_DOCS_INDEX` is
/// unchanged from the pre-split monolith — downstream code can keep
/// importing from `../docs/pages` (the shim in pages.ts forwards).

import type { DocsSection } from "../types";
import { GETTING_STARTED_SECTION } from "./getting-started";
import { ARCHITECTURE_SECTION } from "./architecture";
import { COURSES_SECTION } from "./courses";
import { RUNTIMES_SECTION } from "./runtimes";
import { SUBSYSTEMS_SECTION } from "./subsystems";
import { REFERENCE_SECTION } from "./reference";

export const FISHBONES_DOCS: DocsSection[] = [
  GETTING_STARTED_SECTION,
  ARCHITECTURE_SECTION,
  COURSES_SECTION,
  RUNTIMES_SECTION,
  SUBSYSTEMS_SECTION,
  REFERENCE_SECTION,
];

/// Flat lookup index keyed by page id for routing.
export const FISHBONES_DOCS_INDEX: ReadonlyMap<string, { section: DocsSection; pageIndex: number }> =
  (() => {
    const m = new Map<string, { section: DocsSection; pageIndex: number }>();
    for (const section of FISHBONES_DOCS) {
      section.pages.forEach((p, i) => m.set(p.id, { section, pageIndex: i }));
    }
    return m;
  })();
