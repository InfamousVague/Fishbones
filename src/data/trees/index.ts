/// Public surface for skill-tree data.
///
/// The old monolithic `src/data/trees.ts` was split into one file
/// per tree (`foundations.ts`, `web.ts`, ...) with shared types +
/// helpers in `_core.ts`. Downstream code imports from
/// `@app/data/trees` (or relative equivalents) which resolves to
/// this index — keeping the public API identical to the pre-split
/// monolith.

export * from "./_core";
import { FOUNDATIONS } from "./foundations";
import { WEB } from "./web";
import { SMART_CONTRACTS } from "./smart-contracts";
import { SYSTEMS } from "./systems";
import { MOBILE } from "./mobile";
import { FUNCTIONAL } from "./functional";
import { ALGORITHMS } from "./algorithms";
export { FOUNDATIONS };
export { WEB };
export { SMART_CONTRACTS };
export { SYSTEMS };
export { MOBILE };
export { FUNCTIONAL };
export { ALGORITHMS };

import type { SkillTree } from "./_core";

/// Top-level tree list — same shape and order the old monolith
/// exposed. Replaces the inline-defined-and-collected `TREES`
/// array that lived at the bottom of trees.ts.
export const TREES: readonly SkillTree[] = [
  FOUNDATIONS,
  WEB,
  SMART_CONTRACTS,
  SYSTEMS,
  MOBILE,
  FUNCTIONAL,
  ALGORITHMS,
];
