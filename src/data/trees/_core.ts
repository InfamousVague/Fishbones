/// Skill-tree data. Each tree is a directed acyclic graph of skill
/// nodes; each node carries a list of "matches" pointing at one or
/// more lessons in the existing course library that teach that skill.
///
/// The `<TreesView>` UI walks these structures top-down (vertical
/// layout — root at top, depth grows downward), gates each node on
/// the completion state of its prerequisites (hard-gate: a locked
/// node is unclickable until every `prereqs` entry is `complete`),
/// and surfaces the next-up node by highlighting the topologically
/// nearest unlocked-but-incomplete skill.
///
/// Lesson matching was driven by an audit pass against the user's
/// installed library — see `docs/skill-tree-gaps.md` for the gap
/// report. Skills with no current content are marked with
/// `matches: []` and `gapNote` so the UI can render them as a
/// "content needed" placeholder rather than a clickable lesson link.
///
/// Adding a new tree:
///   1. Add an entry to `TREES` below.
///   2. Each `nodes[]` row needs a unique `id`, a short `label` for
///      the card, a `summary` for the tooltip, an array of `prereqs`
///      (other node ids in the SAME tree — cross-tree prereqs aren't
///      supported), and a `matches` array of `{ courseId, lessonId }`
///      tuples. Empty `matches` flags a content gap.
///   3. The first prereq-less node is the tree root. The layout
///      algorithm assigns each node a `depth = max(prereq.depth) + 1`
///      so multi-rooted trees just get parallel columns at depth 0.

import type { Course } from "../types";

export interface SkillMatch {
  /// Course id (in-zip id, matches what storage.loadCourse returns).
  courseId: string;
  /// Lesson id within that course's chapters.lessons array.
  lessonId: string;
}

export interface SkillNode {
  id: string;
  label: string;
  /// 1-2 sentence description shown on hover and in the side panel.
  summary: string;
  /// Other node ids in this same tree that must be complete before
  /// this one unlocks. Empty array = root node.
  prereqs: readonly string[];
  /// Lessons that teach this skill. The first entry is the canonical
  /// teacher; additional entries are alternatives the learner can
  /// pick from. Empty array = content gap (UI shows "Coming soon").
  matches: readonly SkillMatch[];
  /// Set when `matches` is empty. Surfaced in the gap report and the
  /// node's tooltip so we know what's missing if it can't be filled.
  gapNote?: string;
  /// Optional node kind. "section" nodes are categorical organizers
  /// (e.g. "Frameworks", "Production Readiness") that group their
  /// descendants visually but don't carry their own lesson. They
  /// always read as "complete" for unlock-gating purposes (so they
  /// never block dependents) and are excluded from progress %
  /// calculations and the gap report.
  kind?: "section";
}

export interface SkillTree {
  id: string;
  title: string;
  /// Two-word tag for the tree shelf card and the suggestion-engine
  /// "next tree" prompt. Examples: "Foundations", "Web Dev".
  short: string;
  description: string;
  /// Which audience the tree targets. The Trees landing page splits
  /// "beginner" trees (Foundations) from "specialty" trees so a new
  /// learner has an obvious on-ramp.
  audience: "beginner" | "specialty";
  /// Visual accent — a hex string used for the tree's card border,
  /// node ring, and progress bar. Picked from the Fishbones cover
  /// palette so each tree has a distinct identity in the shelf.
  accent: string;
  nodes: readonly SkillNode[];
}

// ─────────────────────────────────────────────────────────────────
// Tree 1: Foundations — the absolute beginner's on-ramp.
// ─────────────────────────────────────────────────────────────────



/// Topo-sort a tree's nodes and assign each one a `depth` for the
/// vertical layout. Depth = max(prereq.depth) + 1, with roots at 0.
/// Pure / no side effects — call from React render or memo.
export interface NodeWithLayout extends SkillNode {
  depth: number;
}

export function layoutTree(tree: SkillTree): NodeWithLayout[] {
  const byId = new Map<string, SkillNode>();
  for (const n of tree.nodes) byId.set(n.id, n);
  const depth = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) {
      // Cycle — shouldn't happen in a hand-authored DAG, but guard.
      depth.set(id, 0);
      return 0;
    }
    const n = byId.get(id);
    if (!n) return 0;
    stack.add(id);
    let d = 0;
    for (const p of n.prereqs) {
      d = Math.max(d, visit(p, stack) + 1);
    }
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of tree.nodes) visit(n.id, new Set());
  return tree.nodes.map((n) => ({ ...n, depth: depth.get(n.id) ?? 0 }));
}

/// Per-node completion check. A skill is complete when AT LEAST ONE
/// of its `matches` entries is in the user's completed set. Empty-
/// match (gap) skills can never complete. Section nodes (kind:
/// "section") are always considered complete — they're categorical
/// organizers, not lessons, and shouldn't block their dependents.
export function isSkillComplete(
  node: SkillNode,
  completed: Set<string>,
): boolean {
  if (node.kind === "section") return true;
  if (node.matches.length === 0) return false;
  return node.matches.some((m) =>
    completed.has(`${m.courseId}:${m.lessonId}`),
  );
}

/// Per-node lock state. A skill unlocks when EVERY prerequisite is
/// complete. Roots (no prereqs) are always unlocked.
export function isSkillUnlocked(
  node: SkillNode,
  byId: Map<string, SkillNode>,
  completed: Set<string>,
): boolean {
  if (node.prereqs.length === 0) return true;
  for (const pid of node.prereqs) {
    const p = byId.get(pid);
    if (!p || !isSkillComplete(p, completed)) return false;
  }
  return true;
}

/// % of nodes complete in a tree. The dashboard shows this on each
/// tree card. Gap nodes count toward the denominator so the number
/// reflects "how much of the journey is achievable today" — bumping
/// 100% requires both the learner AND the course authors to do
/// their parts.
export function treeProgressPercent(
  tree: SkillTree,
  completed: Set<string>,
): number {
  // Exclude section nodes from the denominator — they're
  // organizational, not learnable units, so counting them would
  // artificially inflate completion percentages.
  const learnable = tree.nodes.filter((n) => n.kind !== "section");
  if (learnable.length === 0) return 0;
  const done = learnable.filter((n) => isSkillComplete(n, completed)).length;
  return Math.round((done / learnable.length) * 100);
}

/// "Next up" = the unlocked, incomplete, non-gap node closest to the
/// root in the tree's topo order. The dashboard / tree page
/// highlights this node so the learner has an obvious next click.
export function suggestNextSkill(
  tree: SkillTree,
  completed: Set<string>,
): SkillNode | null {
  const layout = layoutTree(tree).sort((a, b) => a.depth - b.depth);
  const byId = new Map<string, SkillNode>();
  for (const n of tree.nodes) byId.set(n.id, n);
  for (const n of layout) {
    // Section nodes don't have lessons to "do next" — skip them.
    if (n.kind === "section") continue;
    if (n.matches.length === 0) continue;
    if (isSkillComplete(n, completed)) continue;
    if (!isSkillUnlocked(n, byId, completed)) continue;
    return n;
  }
  return null;
}

/// Stable mapping from skill-node id to a lucide icon name. The
/// renderer uses this to put a recognisable glyph inside each
/// circle in the web-style tree visualisation. We lean on prefix
/// matches so adding a new node automatically picks up its
/// family's default icon (e.g. any `web-react-*` falls through to
/// `atom`); per-id rules win when a more specific glyph is
/// available.
///
/// Adding a new icon: pick a name from
/// `node_modules/@mattmattmattmatt/base/primitives/icon/icons/` and
/// register it in `ICON_REGISTRY` inside TreesView.tsx — that's
/// the eager-import bundle the renderer reads from. This function
/// only knows about ICON IDs (strings); the bundling is the
/// component's job.
export function iconForSkill(nodeId: string): string {
  // ── Foundations
  if (nodeId === "variables") return "box";
  if (nodeId === "arithmetic") return "calculator";
  if (nodeId === "strings") return "quote";
  if (nodeId === "booleans") return "toggle-left";
  if (nodeId === "comparisons") return "equal";
  if (nodeId === "if-else") return "git-branch";
  if (nodeId === "while-loops" || nodeId === "for-loops") return "repeat";
  if (nodeId === "functions" || nodeId === "function-args") return "parentheses";
  if (nodeId === "return-values") return "corner-down-left";
  if (nodeId === "arrays" || nodeId === "array-iteration") return "list";
  if (nodeId === "objects") return "package";
  if (nodeId === "nested-data") return "layers";
  if (nodeId === "recursion") return "infinity";
  if (nodeId === "error-handling") return "alert-triangle";
  if (nodeId === "io") return "terminal";
  if (nodeId === "file-io") return "file-text";
  if (nodeId === "testing") return "check-circle";

  // ── Web Development
  // Section hubs — pick icons that read as "category" rather than
  // "specific concept" so the user can tell at a glance these are
  // organizational nodes, not lessons to complete.
  if (nodeId === "web-markup-style") return "palette";
  if (nodeId === "web-js-platform") return "code-2";
  if (nodeId === "web-frameworks") return "boxes";
  if (nodeId === "web-production") return "factory";
  if (nodeId === "html-structure") return "code";
  if (nodeId === "html-forms") return "type";
  if (nodeId === "html-accessibility") return "search";
  if (nodeId === "html-media") return "image";
  if (nodeId === "html-canvas") return "palette";
  if (nodeId.startsWith("css-")) return "palette";
  if (nodeId === "js-dom") return "mouse-pointer-2";
  if (nodeId === "js-events") return "zap";
  if (nodeId === "js-modules") return "package";
  if (nodeId === "js-closures") return "parentheses";
  if (nodeId === "js-storage") return "database";
  if (nodeId === "js-history") return "route";
  if (nodeId === "js-iterators" || nodeId === "js-generators") return "infinity";
  if (nodeId === "js-proxy") return "boxes";
  if (nodeId === "fetch") return "download";
  if (nodeId === "promises" || nodeId === "async-await") return "hourglass";
  if (nodeId === "websockets" || nodeId === "websocket-realtime" || nodeId === "sse-protocol") return "radio";
  if (nodeId === "web-workers" || nodeId === "service-workers") return "cpu";
  if (nodeId === "indexeddb") return "database";
  if (nodeId === "intersection-observer" || nodeId === "mutation-observer" || nodeId === "resize-observer") return "search";
  if (nodeId === "broadcast-channel") return "radio";
  if (nodeId === "file-system-access") return "file-text";
  if (nodeId.startsWith("react-")) return "atom";
  if (nodeId === "routing") return "route";
  if (nodeId === "forms") return "type";
  if (nodeId === "ssr-vs-csr" || nodeId === "nextjs") return "server";
  if (nodeId === "astro-islands") return "sparkles";
  if (nodeId === "htmx") return "zap";
  if (nodeId === "redux" || nodeId === "redux-toolkit" || nodeId === "zustand" || nodeId === "jotai" || nodeId === "mobx") return "boxes";
  if (nodeId === "react-query" || nodeId === "swr") return "download";
  if (nodeId.startsWith("ts-")) return "type";
  if (nodeId === "bundlers" || nodeId === "vite-build" || nodeId === "webpack-build" || nodeId === "esbuild-tool") return "package";
  if (nodeId === "unit-testing" || nodeId === "vitest-jest" || nodeId === "testing-library" || nodeId === "e2e-playwright" || nodeId === "cypress-e2e" || nodeId === "a11y-testing" || nodeId === "visual-regression") return "check-circle";
  if (nodeId === "rest-apis") return "server";
  if (nodeId === "graphql-basics" || nodeId === "graphql-client") return "git-branch";
  if (nodeId === "trpc") return "link";
  if (nodeId === "orm-prisma" || nodeId === "drizzle-orm") return "database";
  if (nodeId === "hono-api") return "server";
  if (nodeId === "auth-basics" || nodeId === "session-cookies" || nodeId === "passkeys" || nodeId === "mfa") return "shield";
  if (nodeId === "oauth") return "shield";
  if (nodeId === "jwt") return "signature";
  if (nodeId === "web-vitals" || nodeId === "bundle-analysis") return "gauge";
  if (nodeId === "image-optimization") return "image";
  if (nodeId === "font-optimization") return "type";
  if (nodeId === "virtualization" || nodeId === "lazy-hydration") return "layers";
  if (nodeId === "web-animations-api") return "sparkles";
  if (nodeId === "static-deployment" || nodeId === "cdn-caching") return "server";
  if (nodeId === "edge-deployment") return "network";
  if (nodeId === "vue-framework" || nodeId === "vue-pinia") return "triangle";
  if (nodeId === "svelte-framework" || nodeId === "sveltekit") return "sparkles";
  if (nodeId === "solid-framework") return "atom";
  if (nodeId === "qwik-framework") return "zap";
  if (nodeId === "preact-framework") return "atom";
  if (nodeId === "lit-framework") return "code-2";

  // ── Smart contracts
  if (nodeId === "evm-mental-model") return "cpu";
  if (nodeId === "solidity-storage") return "database";
  if (nodeId === "solidity-functions") return "function-square";
  if (nodeId === "solidity-events") return "radio";
  if (nodeId === "modifiers") return "shield";
  if (nodeId === "erc20-basics" || nodeId === "erc20-allowance") return "coins";
  if (nodeId === "erc721-nfts") return "image";
  if (nodeId === "erc1155-batch") return "layers";
  if (nodeId.startsWith("security-")) return "shield";
  if (nodeId === "gas-storage-cost") return "fuel";
  if (nodeId === "factories-create2") return "factory";
  if (nodeId === "proxies-uups") return "link";
  if (nodeId === "amm-basics") return "arrow-left-right";
  if (nodeId === "flash-loans") return "zap";
  if (nodeId === "governance-multisig") return "vote";
  if (nodeId === "merkle-airdrops") return "tree-pine";
  if (nodeId === "eip712") return "signature";

  // ── Systems
  if (nodeId === "memory-stack-heap") return "memory-stick";
  if (nodeId === "pointers-c") return "arrow-right";
  if (nodeId === "arrays-strings-c") return "align-justify";
  if (nodeId === "structs-c") return "boxes";
  if (nodeId === "malloc-free") return "package-plus";
  if (nodeId === "linked-lists-c") return "link-2";
  if (nodeId.startsWith("cpp-")) return "code-2";
  if (nodeId.startsWith("rust-")) return "cog";
  if (nodeId === "threads-mutexes") return "network";
  if (nodeId === "channels") return "radio";
  if (nodeId === "syscalls") return "terminal";
  if (nodeId === "assembly-arm64") return "binary";

  // ── Mobile
  if (nodeId === "ts-types") return "type";
  if (nodeId.startsWith("rn-")) return "smartphone";
  if (nodeId.startsWith("swift-")) return "bird";
  if (nodeId === "ios-views") return "app-window";
  if (nodeId === "watch-companion") return "watch";

  // ── Functional
  if (nodeId === "pure-functions") return "function-square";
  if (nodeId === "recursion-deep") return "infinity";
  if (nodeId === "higher-order") return "arrow-down-up";
  if (nodeId === "immutable-data") return "leaf";
  if (nodeId === "folds-maps-filters") return "combine";
  if (nodeId.startsWith("haskell-")) return "sigma";
  if (nodeId.startsWith("scala-")) return "function-square";
  if (nodeId.startsWith("elixir-")) return "server";

  // ── Data & Algorithms
  if (nodeId === "bigo") return "gauge";
  if (nodeId === "arrays-algo") return "list";
  if (nodeId === "linked-lists-algo") return "link-2";
  if (nodeId === "stacks-queues") return "layers";
  if (nodeId === "hash-tables") return "hash";
  if (nodeId === "trees-bst" || nodeId === "tries") return "git-branch";
  if (nodeId === "graphs-bfs-dfs") return "network";
  if (nodeId === "sorting-basic" || nodeId === "sorting-advanced") return "arrow-down-up";
  if (nodeId === "binary-search") return "search";
  if (nodeId === "recursion-divide-conquer") return "git-branch";
  if (nodeId.startsWith("dp-")) return "grid-3x3";
  if (nodeId === "greedy") return "target";
  if (nodeId === "heaps") return "triangle";

  return "circle";
}

/// Resolve a skill match to its actual lesson + course title. Used
/// by the side panel that opens when a node is clicked. Returns
/// null when the match points at a course that isn't installed
/// (gap / pruned course / web build without the pack).
export function resolveSkillMatch(
  match: SkillMatch,
  courses: readonly Course[],
): {
  course: Course;
  lessonTitle: string;
} | null {
  const c = courses.find((x) => x.id === match.courseId);
  if (!c) return null;
  for (const ch of c.chapters) {
    const l = ch.lessons.find((x) => x.id === match.lessonId);
    if (l) return { course: c, lessonTitle: l.title };
  }
  return null;
}
