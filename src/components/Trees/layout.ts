import { layoutTree, type SkillTree, type SkillNode } from "../../data/trees";

/// Tidy-tree layout (Reingold-Tilford-lite). The DAG has only one
/// "primary" parent per non-root — the deepest prereq, i.e. the
/// one whose row sits directly above this node — and we recurse
/// over THAT tree to assign coordinates. Other prereqs still draw
/// edges (cross-links) but don't participate in the layout, so the
/// shape on screen is always a proper tree: every parent sits at
/// the geometric midpoint of its children's leaves, and no two
/// subtrees overlap horizontally.
///
/// Why not barycenter-style coordinate assignment? Barycenter
/// preserves layer assignments but lets the root drift to wherever
/// the average happens to be, which on a single-root tree pinned
/// at x=0 produces the "sideways" look (descendants accumulate to
/// the right while the root stays anchored at the origin). Tidy
/// tree fixes this by construction: each node's x is a function
/// of its descendants, so the root naturally sits above the centre
/// of mass.
// Layout aspect ratio: wider rows + tighter columns push the tree
// into a TALL shape instead of a wide one. With 100+ skills the
// natural fanout would otherwise stretch to 5000+px wide; this
// trades horizontal spread for vertical depth so the user scrolls
// down instead of panning sideways.
export const ROW_HEIGHT = 200;
export const NODE_RADIUS = 28;
export const COL_SPACING = 78;
export const ROOT_SPACING = 130;

export interface PositionedNode extends SkillNode {
  depth: number;
  x: number;
  y: number;
}

export interface LayoutResult {
  positioned: PositionedNode[];
  /// Each non-root node maps to the prereq we treated as its
  /// "primary parent" for layout. Edges from this parent are the
  /// tree skeleton; edges from any *other* prereq are cross-links
  /// and should render with a softer style.
  primaryParent: Map<string, string>;
}

export function layoutWeb(tree: SkillTree): LayoutResult {
  const sized = layoutTree(tree);
  const sizedById = new Map(sized.map((n) => [n.id, n] as const));

  // Primary parent: drives the layout placement.
  //   1. If any prereq is a SECTION node (categorical hub), use
  //      that — the section is the natural visual home, so a
  //      framework-flavored skill should sit under "Frameworks"
  //      even when it has deeper learning prereqs elsewhere.
  //   2. Otherwise the deepest prereq wins. That puts the node in
  //      the row directly under the prereq that constrains it
  //      most.
  // Tie-break on first-listed in both cases.
  const primaryParent = new Map<string, string>();
  for (const n of sized) {
    if (n.prereqs.length === 0) continue;
    const sectionPrereq = n.prereqs.find(
      (p) => sizedById.get(p)?.kind === "section",
    );
    if (sectionPrereq) {
      primaryParent.set(n.id, sectionPrereq);
      continue;
    }
    let best = n.prereqs[0];
    let bestDepth = sizedById.get(best)?.depth ?? -1;
    for (const p of n.prereqs) {
      const dp = sizedById.get(p)?.depth ?? -1;
      if (dp > bestDepth) {
        best = p;
        bestDepth = dp;
      }
    }
    primaryParent.set(n.id, best);
  }

  // Tree adjacency: parent-id → [child-ids] in the primary-parent
  // tree. Each non-root node appears in exactly one parent's list,
  // so the recursion below visits every node exactly once.
  const treeChildren = new Map<string, string[]>();
  for (const n of sized) {
    const pp = primaryParent.get(n.id);
    if (pp) {
      const arr = treeChildren.get(pp) ?? [];
      arr.push(n.id);
      treeChildren.set(pp, arr);
    }
  }

  // Reingold-Tilford-style recursion. Leaves are laid out left-to-
  // right at fixed COL_SPACING intervals; each internal node sits
  // at the midpoint between the LEFTMOST and RIGHTMOST LEAF of
  // its subtree.
  //
  // GRID-PACKED LEAF CLUSTERS: when a parent has 4+ children that
  // are all themselves leaves, we pack them into a square-ish grid
  // (ceil(sqrt(N)) columns × N/cols rows) instead of one wide row.
  // That trades horizontal spread for vertical depth — the tree
  // gets TALLER instead of WIDER, which is what we want for the
  // big sibling fanouts under things like UI-Frameworks where ~7
  // alternatives all sit at the same level and are themselves
  // leaves of the layout tree. Without packing, each fanout adds
  // ~7 * COL_SPACING to the canvas width; with packing, it adds
  // only ~3 * COL_SPACING (and a few extra rows of height).
  const placed = new Map<string, PositionedNode>();
  let cursor = 0;
  // Threshold for triggering vertical pack of leaf clusters. Fires
  // for 3+ siblings — even small fanouts contribute to width since
  // each leaf takes a full column. Lowering from 4 → 3 catches
  // common 3-leaf clusters (e.g. css-flexbox/grid/responsive).
  const GRID_PACK_THRESHOLD = 3;
  // Sub-row height when packing grid leaves vertically. Smaller
  // than ROW_HEIGHT so packed clusters stay visually tight.
  const SUB_ROW_HEIGHT = 110;

  // Returns the [leftmost-leaf-x, rightmost-leaf-x] of the
  // subtree rooted at `id`. Internal nodes use this range to
  // pick their own x.
  const layoutSubtree = (id: string): [number, number] => {
    const node = sizedById.get(id);
    if (!node) return [cursor, cursor];
    const kids = treeChildren.get(id) ?? [];
    const y = node.depth * ROW_HEIGHT;
    if (kids.length === 0) {
      const x = cursor;
      placed.set(id, { ...node, x, y });
      cursor += COL_SPACING;
      return [x, x];
    }
    // Grid-pack when all children are themselves leaves AND
    // there's enough of them to justify packing. We cap cols at 2
    // — packing into a tall narrow stack instead of a square grid
    // is what actually keeps the tree taller-than-wide. With cap 2,
    // a parent with 8 leaf children adds 2 cols + 4 rows to the
    // canvas (instead of 8 cols + 1 row); with the old sqrt-based
    // sizing it'd add ~3 cols + 3 rows, which still grows
    // horizontally faster than vertically.
    const allKidsAreLeaves = kids.every(
      (k) => (treeChildren.get(k)?.length ?? 0) === 0,
    );
    if (allKidsAreLeaves && kids.length >= GRID_PACK_THRESHOLD) {
      const cols = Math.min(2, kids.length);
      const startX = cursor;
      let minX = Infinity;
      let maxX = -Infinity;
      kids.forEach((kid, i) => {
        const kidNode = sizedById.get(kid);
        if (!kidNode) return;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const kx = startX + col * COL_SPACING;
        const ky = node.depth * ROW_HEIGHT + ROW_HEIGHT + row * SUB_ROW_HEIGHT;
        placed.set(kid, { ...kidNode, x: kx, y: ky });
        if (kx < minX) minX = kx;
        if (kx > maxX) maxX = kx;
      });
      cursor = startX + cols * COL_SPACING;
      const x = (minX + maxX) / 2;
      placed.set(id, { ...node, x, y });
      return [minX, maxX];
    }
    let minLeafX = Infinity;
    let maxLeafX = -Infinity;
    for (const kid of kids) {
      const [klo, khi] = layoutSubtree(kid);
      if (klo < minLeafX) minLeafX = klo;
      if (khi > maxLeafX) maxLeafX = khi;
    }
    const x = (minLeafX + maxLeafX) / 2;
    placed.set(id, { ...node, x, y });
    return [minLeafX, maxLeafX];
  };

  // Walk each root, leaving ROOT_SPACING between disconnected
  // sub-graphs so multi-root trees (rare, but legal) don't
  // visually merge into one big blob.
  const roots = sized.filter((n) => n.depth === 0);
  for (let i = 0; i < roots.length; i++) {
    layoutSubtree(roots[i].id);
    if (i < roots.length - 1) {
      cursor += ROOT_SPACING - COL_SPACING;
    }
  }

  // Section stacking pass — converts horizontal width into vertical
  // depth. After the normal Reingold-Tilford layout, top-level
  // section subtrees sit SIDE BY SIDE under the root. That
  // dominates the tree's overall width when sections have big
  // descendant clusters (e.g. "JS Platform" → frameworks →
  // production). We reposition sections so they cascade
  // VERTICALLY instead: section 1 stays in place, section 2 sits
  // below it, section 3 below that, etc. Each section's own
  // subtree keeps its internal horizontal layout. Net effect: the
  // tree is roughly as wide as the WIDEST single-section subtree,
  // and as tall as the SUM of all sections' subtree heights.
  const STACK_GAP = ROW_HEIGHT * 0.6;
  // Build child-of-primary-parent index once (inverse of
  // primaryParent map) for efficient subtree collection.
  const primaryChildrenMap = new Map<string, string[]>();
  for (const [child, parent] of primaryParent) {
    const arr = primaryChildrenMap.get(parent) ?? [];
    arr.push(child);
    primaryChildrenMap.set(parent, arr);
  }
  // Collect ALL descendants in the primary-parent tree of `id`,
  // including `id` itself. BFS works fine for our small graphs.
  const collectDescendants = (id: string): string[] => {
    const out = [id];
    let i = 0;
    while (i < out.length) {
      const cur = out[i++];
      for (const c of primaryChildrenMap.get(cur) ?? []) out.push(c);
    }
    return out;
  };
  // Sections to stack: those whose primary parent is the root
  // (i.e. depth 1 sections). We don't stack nested sections —
  // they're already inside their parent's subtree and benefit
  // from staying contiguous with their siblings.
  const stackSections = sized.filter((n) => {
    if (n.kind !== "section") return false;
    const ppId = primaryParent.get(n.id);
    if (!ppId) return false;
    return (sizedById.get(ppId)?.depth ?? Infinity) === 0;
  });
  if (stackSections.length > 1) {
    // Compute bounding box per section subtree using current
    // placed positions.
    const boxes = stackSections.map((s) => {
      const ids = collectDescendants(s.id);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const id of ids) {
        const p = placed.get(id);
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { id: s.id, ids, minX, maxX, minY, maxY };
    });
    // Use the first section as anchor — keep its position, stack
    // the others below it. All sections snap to the same x-range
    // start so the cascade reads as a single vertical column of
    // sections.
    const anchorX = boxes[0].minX;
    let cursorY = boxes[0].maxY;
    for (let i = 1; i < boxes.length; i++) {
      const box = boxes[i];
      cursorY += STACK_GAP;
      const dx = anchorX - box.minX;
      const dy = cursorY - box.minY;
      for (const id of box.ids) {
        const node = placed.get(id);
        if (!node) continue;
        node.x += dx;
        node.y += dy;
      }
      cursorY += box.maxY - box.minY;
    }
  }

  return { positioned: [...placed.values()], primaryParent };
}
