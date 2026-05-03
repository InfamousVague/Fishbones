/// Trees feature: the top-level view that lets the learner pick
/// which skill tree to walk, then renders the chosen tree's DAG.
///
/// Navigation: `<TreesView>` is mounted as a top-level destination
/// from the sidebar. It owns its own internal "currently-viewing"
/// state — clicking a tree card from the shelf opens that tree;
/// clicking the back chevron returns to the shelf. We could push
/// this into App-level routing later (?tree=foundations) but it's
/// not worth the URL plumbing yet.

import { useMemo, useRef, useState } from "react";
import type { Course } from "../../data/types";
import {
  TREES,
  iconForSkill,
  layoutTree,
  isSkillComplete,
  isSkillUnlocked,
  suggestNextSkill,
  treeProgressPercent,
  resolveSkillMatch,
  type SkillTree,
  type SkillNode,
} from "../../data/trees";
// Eager-import every lucide icon `iconForSkill` can return. Using a
// static map keeps the bundler's dead-code path predictable — only
// the icons listed below ship in the chunk that loads with the
// Trees view, regardless of which trees the learner explores.
import { box } from "@base/primitives/icon/icons/box";
import { calculator } from "@base/primitives/icon/icons/calculator";
import { quote } from "@base/primitives/icon/icons/quote";
import { toggleLeft } from "@base/primitives/icon/icons/toggle-left";
import { equal } from "@base/primitives/icon/icons/equal";
import { gitBranch } from "@base/primitives/icon/icons/git-branch";
import { repeat } from "@base/primitives/icon/icons/repeat";
import { parentheses } from "@base/primitives/icon/icons/parentheses";
import { cornerDownLeft } from "@base/primitives/icon/icons/corner-down-left";
import { list } from "@base/primitives/icon/icons/list";
import { iconPackage as packageIcon } from "@base/primitives/icon/icons/package";
import { layers } from "@base/primitives/icon/icons/layers";
import { infinity as infinityIcon } from "@base/primitives/icon/icons/infinity";
import { alertTriangle } from "@base/primitives/icon/icons/alert-triangle";
import { terminal } from "@base/primitives/icon/icons/terminal";
import { fileText } from "@base/primitives/icon/icons/file-text";
import { checkCircle } from "@base/primitives/icon/icons/check-circle";
import { code as codeIcon } from "@base/primitives/icon/icons/code";
import { palette } from "@base/primitives/icon/icons/palette";
import { mousePointer2 } from "@base/primitives/icon/icons/mouse-pointer-2";
import { zap } from "@base/primitives/icon/icons/zap";
import { download } from "@base/primitives/icon/icons/download";
import { hourglass } from "@base/primitives/icon/icons/hourglass";
import { atom } from "@base/primitives/icon/icons/atom";
import { route } from "@base/primitives/icon/icons/route";
import { type as typeIcon } from "@base/primitives/icon/icons/type";
import { server } from "@base/primitives/icon/icons/server";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { cpu } from "@base/primitives/icon/icons/cpu";
import { database } from "@base/primitives/icon/icons/database";
import { functionSquare } from "@base/primitives/icon/icons/function-square";
import { radio } from "@base/primitives/icon/icons/radio";
import { shield } from "@base/primitives/icon/icons/shield";
import { coins } from "@base/primitives/icon/icons/coins";
import { image as imageIcon } from "@base/primitives/icon/icons/image";
import { fuel } from "@base/primitives/icon/icons/fuel";
import { factory } from "@base/primitives/icon/icons/factory";
import { link } from "@base/primitives/icon/icons/link";
import { arrowLeftRight } from "@base/primitives/icon/icons/arrow-left-right";
import { vote } from "@base/primitives/icon/icons/vote";
import { treePine } from "@base/primitives/icon/icons/tree-pine";
import { signature } from "@base/primitives/icon/icons/signature";
import { memoryStick } from "@base/primitives/icon/icons/memory-stick";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import { alignJustify } from "@base/primitives/icon/icons/align-justify";
import { boxes } from "@base/primitives/icon/icons/boxes";
import { packagePlus } from "@base/primitives/icon/icons/package-plus";
import { link2 } from "@base/primitives/icon/icons/link-2";
import { code2 } from "@base/primitives/icon/icons/code-2";
import { cog } from "@base/primitives/icon/icons/cog";
import { network } from "@base/primitives/icon/icons/network";
import { binary } from "@base/primitives/icon/icons/binary";
import { smartphone } from "@base/primitives/icon/icons/smartphone";
import { bird } from "@base/primitives/icon/icons/bird";
import { appWindow } from "@base/primitives/icon/icons/app-window";
import { watch } from "@base/primitives/icon/icons/watch";
import { leaf } from "@base/primitives/icon/icons/leaf";
import { combine } from "@base/primitives/icon/icons/combine";
import { sigma } from "@base/primitives/icon/icons/sigma";
import { gauge } from "@base/primitives/icon/icons/gauge";
import { hash } from "@base/primitives/icon/icons/hash";
import { arrowDownUp } from "@base/primitives/icon/icons/arrow-down-up";
import { search } from "@base/primitives/icon/icons/search";
import { grid3x3 } from "@base/primitives/icon/icons/grid-3x3";
import { target } from "@base/primitives/icon/icons/target";
import { triangle } from "@base/primitives/icon/icons/triangle";
import { circle } from "@base/primitives/icon/icons/circle";
import { lock as lockIcon } from "@base/primitives/icon/icons/lock";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import "./TreesView.css";

/// Lucide-id → svg-paths-string map. The `Icon` component takes a
/// raw string of inner SVG paths; we look up by the same id strings
/// `iconForSkill` returns. Keep this in lockstep with that
/// function — adding a new icon means an entry here AND a mapping
/// rule there.
const ICON_REGISTRY: Record<string, string> = {
  box, calculator, quote, "toggle-left": toggleLeft, equal, "git-branch": gitBranch,
  repeat, parentheses, "corner-down-left": cornerDownLeft, list, package: packageIcon,
  layers, infinity: infinityIcon, "alert-triangle": alertTriangle, terminal,
  "file-text": fileText, "check-circle": checkCircle, code: codeIcon, palette,
  "mouse-pointer-2": mousePointer2, zap, download, hourglass, atom, route,
  type: typeIcon, server, sparkles, cpu, database, "function-square": functionSquare,
  radio, shield, coins, image: imageIcon, fuel, factory, link,
  "arrow-left-right": arrowLeftRight, vote, "tree-pine": treePine, signature,
  "memory-stick": memoryStick, "arrow-right": arrowRight, "align-justify": alignJustify,
  boxes, "package-plus": packagePlus, "link-2": link2, "code-2": code2, cog, network,
  binary, smartphone, bird, "app-window": appWindow, watch, leaf, combine, sigma,
  gauge, hash, "arrow-down-up": arrowDownUp, search, "grid-3x3": grid3x3, target,
  triangle, circle,
};

interface Props {
  courses: readonly Course[];
  /// Same `${courseId}:${lessonId}` set the rest of the app uses.
  completed: Set<string>;
  /// Open a specific lesson — same shape as Sidebar's onSelectLesson.
  /// Wired by App so clicking a skill node's matched lesson takes
  /// the learner directly into that lesson's reader.
  onOpenLesson: (courseId: string, lessonId: string) => void;
}

export default function TreesView({ courses, completed, onOpenLesson }: Props) {
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);
  const activeTree = useMemo(
    () => TREES.find((t) => t.id === activeTreeId) ?? null,
    [activeTreeId],
  );

  if (activeTree) {
    return (
      <TreeDetail
        tree={activeTree}
        courses={courses}
        completed={completed}
        onBack={() => setActiveTreeId(null)}
        onOpenLesson={onOpenLesson}
      />
    );
  }

  const beginnerTrees = TREES.filter((t) => t.audience === "beginner");
  const specialtyTrees = TREES.filter((t) => t.audience === "specialty");

  return (
    <div className="fishbones-trees">
      <header className="fishbones-trees__header">
        <h1 className="fishbones-trees__title">Skill Trees</h1>
        <p className="fishbones-trees__blurb">
          Map out the path from where you are to where you want to be. Each
          tree is a DAG of skills — finish the prerequisites and the next node
          unlocks.
        </p>
      </header>

      {beginnerTrees.length > 0 && (
        <section className="fishbones-trees__section">
          <div className="fishbones-trees__section-label">Start here</div>
          <div className="fishbones-trees__grid">
            {beginnerTrees.map((t) => (
              <TreeCard
                key={t.id}
                tree={t}
                completed={completed}
                onOpen={() => setActiveTreeId(t.id)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="fishbones-trees__section">
        <div className="fishbones-trees__section-label">Specialties</div>
        <div className="fishbones-trees__grid">
          {specialtyTrees.map((t) => (
            <TreeCard
              key={t.id}
              tree={t}
              completed={completed}
              onOpen={() => setActiveTreeId(t.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface TreeCardProps {
  tree: SkillTree;
  completed: Set<string>;
  onOpen: () => void;
}

function TreeCard({ tree, completed, onOpen }: TreeCardProps) {
  const pct = treeProgressPercent(tree, completed);
  const totalNodes = tree.nodes.length;
  const gaps = tree.nodes.filter((n) => n.matches.length === 0).length;
  return (
    <button
      type="button"
      className="fishbones-trees__card"
      style={{ "--tree-accent": tree.accent } as React.CSSProperties}
      onClick={onOpen}
    >
      <div className="fishbones-trees__card-head">
        <span className="fishbones-trees__card-tag">{tree.short}</span>
        <span className="fishbones-trees__card-pct">{pct}%</span>
      </div>
      <div className="fishbones-trees__card-title">{tree.title}</div>
      <div className="fishbones-trees__card-blurb">{tree.description}</div>
      <div className="fishbones-trees__card-meta">
        <span>
          {totalNodes} skills
          {gaps > 0 && ` · ${gaps} gap${gaps === 1 ? "" : "s"}`}
        </span>
      </div>
      <div
        className="fishbones-trees__card-bar"
        aria-label={`${pct} percent complete`}
      >
        <div
          className="fishbones-trees__card-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

// ── Tree detail (vertical DAG) ───────────────────────────────────

interface TreeDetailProps {
  tree: SkillTree;
  courses: readonly Course[];
  completed: Set<string>;
  onBack: () => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
}

/// Web-style layout: each node gets an (x, y) coord, nodes at the
/// same depth share a row, x is biased toward the average of each
/// node's prereqs' x so children sit roughly under their parents.
/// Greedy collision resolution within a row keeps spacing minimum.
const ROW_HEIGHT = 110;
const NODE_RADIUS = 28;
const COL_SPACING = 88;
const ROOT_SPACING = 140;

interface PositionedNode extends SkillNode {
  depth: number;
  x: number;
  y: number;
}

function layoutWeb(tree: SkillTree): PositionedNode[] {
  const sized = layoutTree(tree);
  const byDepth = new Map<number, typeof sized>();
  for (const n of sized) {
    const arr = byDepth.get(n.depth) ?? [];
    arr.push(n);
    byDepth.set(n.depth, arr);
  }
  const placed = new Map<string, PositionedNode>();
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    const row = byDepth.get(d)!;
    if (d === 0) {
      // Roots: distribute evenly around 0
      const total = row.length;
      const startX = -((total - 1) * ROOT_SPACING) / 2;
      row.forEach((n, i) => {
        placed.set(n.id, {
          ...n,
          x: startX + i * ROOT_SPACING,
          y: d * ROW_HEIGHT,
        });
      });
      continue;
    }
    // Position relative to parents' average x.
    const proposed = row.map((n) => {
      const px = n.prereqs
        .map((p) => placed.get(p)?.x ?? 0)
        .reduce((a, b) => a + b, 0);
      const avg = n.prereqs.length ? px / n.prereqs.length : 0;
      return { node: n, desiredX: avg };
    });
    proposed.sort((a, b) => a.desiredX - b.desiredX);
    let lastX = -Infinity;
    for (const { node, desiredX } of proposed) {
      const x = Math.max(desiredX, lastX + COL_SPACING);
      lastX = x;
      placed.set(node.id, { ...node, x, y: d * ROW_HEIGHT });
    }
  }
  return [...placed.values()];
}

function TreeDetail({
  tree,
  courses,
  completed,
  onBack,
  onOpenLesson,
}: TreeDetailProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const positioned = useMemo(() => layoutWeb(tree), [tree]);
  const byId = useMemo(() => {
    const m = new Map<string, SkillNode>();
    for (const n of tree.nodes) m.set(n.id, n);
    return m;
  }, [tree]);
  const nextUp = useMemo(
    () => suggestNextSkill(tree, completed),
    [tree, completed],
  );
  const pct = treeProgressPercent(tree, completed);

  // Compute SVG viewBox + canvas size from the positioned nodes.
  // The greedy layout outputs raw coordinates; we shift them so the
  // leftmost node sits at x = padding and the SVG starts at 0.
  const PAD_X = 60;
  const PAD_Y = 40;
  const minX = positioned.reduce((acc, n) => Math.min(acc, n.x), Infinity);
  const maxX = positioned.reduce((acc, n) => Math.max(acc, n.x), -Infinity);
  const maxY = positioned.reduce((acc, n) => Math.max(acc, n.y), 0);
  const offsetX = -minX + PAD_X;
  const width = maxX - minX + PAD_X * 2;
  const height = maxY + PAD_Y * 2;
  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of positioned) m.set(n.id, { x: n.x + offsetX, y: n.y + PAD_Y });
    return m;
  }, [positioned, offsetX]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const hovered = hover ? byId.get(hover.nodeId) ?? null : null;

  return (
    <div
      className="fishbones-trees fishbones-trees--detail"
      style={{ "--tree-accent": tree.accent } as React.CSSProperties}
    >
      <header className="fishbones-trees__detail-head">
        <button
          type="button"
          className="fishbones-trees__back"
          onClick={onBack}
        >
          <svg
            className="fishbones-trees__back-icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            dangerouslySetInnerHTML={{ __html: arrowLeft }}
          />
          All trees
        </button>
        <div className="fishbones-trees__detail-meta">
          <h1 className="fishbones-trees__detail-title">{tree.title}</h1>
          <p className="fishbones-trees__detail-blurb">{tree.description}</p>
        </div>
        <div className="fishbones-trees__detail-progress">
          <div className="fishbones-trees__detail-pct">{pct}%</div>
          <div className="fishbones-trees__detail-pct-label">
            {tree.nodes.filter((n) => isSkillComplete(n, completed)).length}/
            {tree.nodes.length} skills
          </div>
        </div>
      </header>

      <div
        className="fishbones-trees__web-scroll"
        ref={containerRef}
        // Single source of hover truth: an SVG-level pointer move
        // handler that finds the nearest node within the hit radius.
        // Per-node onMouseEnter caused flicker on the boundary
        // between siblings — moving from one node toward the next
        // would briefly fall through "empty" space and re-trigger
        // mouseleave/mouseenter. With a global pointer tracker the
        // hovered id changes monotonically as the user moves around.
        onPointerMove={(e) => {
          const svg = e.currentTarget.querySelector("svg");
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          let bestId: string | null = null;
          let bestD = Infinity;
          for (const n of positioned) {
            const p = posMap.get(n.id);
            if (!p) continue;
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < NODE_RADIUS + 6 && d < bestD) {
              bestD = d;
              bestId = n.id;
            }
          }
          setHover((h) => {
            if (!bestId) return h ? null : h;
            if (h?.nodeId === bestId) return h;
            const p = posMap.get(bestId)!;
            return { nodeId: bestId, x: p.x, y: p.y };
          });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          className="fishbones-trees__web"
          width={Math.max(width, 600)}
          height={height}
          viewBox={`0 0 ${Math.max(width, 600)} ${height}`}
        >
          {/* Edges — drawn under the circles. Orthogonal "tree
              line" shape (drop down → cross horizontally → drop
              down). Bend Y is staggered per edge so multiple
              horizontals from the same parent (or arriving at the
              same row) sit on different rows instead of fully
              overlapping. The stagger ranks each parent's
              children by horizontal distance, so the closest
              child bends earliest and the furthest bends last. */}
          {(() => {
            // Pre-compute the bend Y per edge so we can assign
            // unique slots without re-sorting inside the JSX loop.
            const bendY = new Map<string, number>();
            // Group edges by parent id — each parent's outgoing
            // edges stagger across its own row of slots.
            const edgesByParent = new Map<string, string[]>();
            for (const n of tree.nodes) {
              for (const pid of n.prereqs) {
                const arr = edgesByParent.get(pid) ?? [];
                arr.push(n.id);
                edgesByParent.set(pid, arr);
              }
            }
            const STAGGER_PX = 8;
            for (const [pid, childIds] of edgesByParent) {
              const parentPos = posMap.get(pid);
              if (!parentPos) continue;
              // Sort by absolute horizontal distance from the
              // parent — closest child bends at the smallest Y,
              // furthest bends at the largest Y. Looks like a
              // fan opening up.
              const sorted = [...childIds].sort((a, b) => {
                const ax = posMap.get(a)?.x ?? 0;
                const bx = posMap.get(b)?.x ?? 0;
                return (
                  Math.abs(ax - parentPos.x) -
                  Math.abs(bx - parentPos.x)
                );
              });
              sorted.forEach((cid, i) => {
                const childPos = posMap.get(cid);
                if (!childPos) return;
                const baseMidY = (parentPos.y + childPos.y) / 2;
                // Centre the stagger band on baseMidY: rank 0 →
                // -((n-1)/2), rank n-1 → +((n-1)/2).
                const offset = (i - (sorted.length - 1) / 2) * STAGGER_PX;
                bendY.set(`${pid}->${cid}`, baseMidY + offset);
              });
            }
            return tree.nodes.flatMap((n) => {
              const childPos = posMap.get(n.id);
              if (!childPos) return [];
              const childComplete = isSkillComplete(n, completed);
              const childUnlocked = isSkillUnlocked(n, byId, completed);
              return n.prereqs.map((pid) => {
                const parentPos = posMap.get(pid);
                if (!parentPos) return null;
                const parentNode = byId.get(pid);
                const parentComplete = parentNode
                  ? isSkillComplete(parentNode, completed)
                  : false;
                const active = parentComplete && childComplete;
                const reachable = parentComplete && childUnlocked;
                const by =
                  bendY.get(`${pid}->${n.id}`) ??
                  (parentPos.y + childPos.y) / 2;
                const d = `M ${parentPos.x} ${parentPos.y + NODE_RADIUS} V ${by} H ${childPos.x} V ${childPos.y - NODE_RADIUS}`;
                return (
                  <path
                    key={`${pid}->${n.id}`}
                    className={[
                      "fishbones-trees__edge",
                      active && "fishbones-trees__edge--active",
                      !active && reachable && "fishbones-trees__edge--reachable",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    d={d}
                    fill="none"
                  />
                );
              });
            });
          })()}

          {/* Nodes — circle + lucide icon, with state-based class
              modifiers for complete / locked / next-up / gap. No
              per-node mouse handlers; the single pointermove on
              the scroll container drives the hover state. */}
          {positioned.map((n) => {
            const pos = posMap.get(n.id)!;
            const complete = isSkillComplete(n, completed);
            const unlocked = isSkillUnlocked(n, byId, completed);
            const isNext = nextUp?.id === n.id;
            const isGap = n.matches.length === 0;
            const iconName = iconForSkill(n.id);
            const iconPaths = ICON_REGISTRY[iconName] ?? ICON_REGISTRY.circle;
            return (
              <g
                key={n.id}
                className={[
                  "fishbones-trees__node",
                  complete && "fishbones-trees__node--complete",
                  !unlocked && "fishbones-trees__node--locked",
                  isNext && "fishbones-trees__node--next",
                  isGap && "fishbones-trees__node--gap",
                  selectedId === n.id && "fishbones-trees__node--selected",
                ]
                  .filter(Boolean)
                  .join(" ")}
                transform={`translate(${pos.x} ${pos.y})`}
                onClick={() => setSelectedId(n.id)}
              >
                <circle
                  className="fishbones-trees__node-circle"
                  r={NODE_RADIUS}
                  cx={0}
                  cy={0}
                />
                {isNext && !complete && (
                  <circle
                    className="fishbones-trees__node-pulse"
                    r={NODE_RADIUS + 4}
                    cx={0}
                    cy={0}
                    fill="none"
                  />
                )}
                <g
                  className="fishbones-trees__node-icon"
                  transform="translate(-12 -12)"
                  dangerouslySetInnerHTML={{ __html: iconPaths }}
                />
                <text
                  className="fishbones-trees__node-text"
                  y={NODE_RADIUS + 16}
                  textAnchor="middle"
                >
                  {n.label.length > 20 ? n.label.slice(0, 18) + "…" : n.label}
                </text>
                {/* State badges — small circles with lucide icons
                    sit on the line where it joins the node's top.
                    Lock = locked, Check = complete. Drawing them
                    at (0, -R) puts them directly on the joint
                    between the connecting line and the circle. */}
                {!unlocked && (
                  <g
                    className="fishbones-trees__node-badge fishbones-trees__node-badge--lock"
                    transform={`translate(0 ${-NODE_RADIUS})`}
                  >
                    <circle r={9} cx={0} cy={0} />
                    <g
                      transform="translate(-7 -7) scale(0.58)"
                      dangerouslySetInnerHTML={{ __html: lockIcon }}
                    />
                  </g>
                )}
                {complete && (
                  <g
                    className="fishbones-trees__node-badge fishbones-trees__node-badge--check"
                    transform={`translate(0 ${-NODE_RADIUS})`}
                  >
                    <circle r={9} cx={0} cy={0} />
                    <g
                      transform="translate(-7 -7) scale(0.58)"
                      dangerouslySetInnerHTML={{ __html: checkIcon }}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip — separate HTML layer so we can style with
            real CSS (text wrapping, padding, drop-shadow) and keep
            a11y predictable. Positioned in the SCROLL container,
            not the page, so it tracks scroll naturally. */}
        {hover && hovered && (
          <div
            className="fishbones-trees__tooltip"
            style={{
              left: hover.x + offsetX + NODE_RADIUS + 12,
              top: hover.y + PAD_Y - 4,
            }}
            role="tooltip"
          >
            <div className="fishbones-trees__tooltip-title">
              {hovered.label}
            </div>
            <div className="fishbones-trees__tooltip-body">
              {hovered.summary}
            </div>
            <div className="fishbones-trees__tooltip-state">
              {isSkillComplete(hovered, completed) && (
                <span className="fishbones-trees__tooltip-flag fishbones-trees__tooltip-flag--done">
                  Complete
                </span>
              )}
              {nextUp?.id === hovered.id && !isSkillComplete(hovered, completed) && (
                <span className="fishbones-trees__tooltip-flag">
                  Next up
                </span>
              )}
              {!isSkillUnlocked(hovered, byId, completed) && (
                <span className="fishbones-trees__tooltip-flag fishbones-trees__tooltip-flag--locked">
                  Locked — needs {hovered.prereqs.length} prereq
                  {hovered.prereqs.length === 1 ? "" : "s"}
                </span>
              )}
              {hovered.matches.length === 0 && (
                <span className="fishbones-trees__tooltip-flag fishbones-trees__tooltip-flag--gap">
                  Coming soon
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <SkillPanel
          node={selected}
          tree={tree}
          courses={courses}
          completed={completed}
          unlocked={isSkillUnlocked(selected, byId, completed)}
          isNext={nextUp?.id === selected.id}
          onClose={() => setSelectedId(null)}
          onOpenLesson={onOpenLesson}
        />
      )}
    </div>
  );
}

// ── Skill detail panel (right-rail) ──────────────────────────────

interface SkillPanelProps {
  node: SkillNode;
  tree: SkillTree;
  courses: readonly Course[];
  completed: Set<string>;
  unlocked: boolean;
  isNext: boolean;
  onClose: () => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
}

function SkillPanel({
  node,
  courses,
  completed,
  unlocked,
  isNext,
  onClose,
  onOpenLesson,
}: SkillPanelProps) {
  const isGap = node.matches.length === 0;
  const completedHere = isSkillComplete(node, completed);
  return (
    <aside className="fishbones-trees__panel" role="complementary">
      <header className="fishbones-trees__panel-head">
        <div className="fishbones-trees__panel-pre">
          {isNext && !completedHere && (
            <span className="fishbones-trees__panel-flag">Next up</span>
          )}
          {completedHere && (
            <span className="fishbones-trees__panel-flag fishbones-trees__panel-flag--done">
              Complete
            </span>
          )}
          {!unlocked && (
            <span className="fishbones-trees__panel-flag fishbones-trees__panel-flag--locked">
              Locked
            </span>
          )}
          {isGap && (
            <span className="fishbones-trees__panel-flag fishbones-trees__panel-flag--gap">
              Coming soon
            </span>
          )}
        </div>
        <button
          type="button"
          className="fishbones-trees__panel-close"
          onClick={onClose}
          aria-label="Close skill"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            dangerouslySetInnerHTML={{ __html: xIcon }}
          />
        </button>
      </header>
      <h2 className="fishbones-trees__panel-title">{node.label}</h2>
      <p className="fishbones-trees__panel-summary">{node.summary}</p>

      {!unlocked && (
        <div className="fishbones-trees__panel-locked">
          Finish these first:
          <ul>
            {node.prereqs.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {isGap && unlocked && (
        <div className="fishbones-trees__panel-gap">
          <strong>No lesson yet.</strong>{" "}
          {node.gapNote ?? "Content for this skill is on the roadmap."}
        </div>
      )}

      {!isGap && (
        <div className="fishbones-trees__panel-lessons">
          <div className="fishbones-trees__panel-lessons-label">Lessons</div>
          {node.matches.map((m) => {
            const resolved = resolveSkillMatch(m, courses);
            const key = `${m.courseId}:${m.lessonId}`;
            const done = completed.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`fishbones-trees__panel-lesson ${
                  done ? "fishbones-trees__panel-lesson--done" : ""
                } ${
                  !unlocked ? "fishbones-trees__panel-lesson--locked" : ""
                }`}
                disabled={!unlocked || !resolved}
                onClick={() => {
                  if (unlocked && resolved) {
                    onOpenLesson(m.courseId, m.lessonId);
                  }
                }}
              >
                <div className="fishbones-trees__panel-lesson-title">
                  {resolved?.lessonTitle ?? m.lessonId}
                </div>
                <div className="fishbones-trees__panel-lesson-course">
                  {resolved?.course.title ?? m.courseId}
                  {!resolved && " (not installed)"}
                </div>
                {done && (
                  <span className="fishbones-trees__panel-lesson-check" aria-hidden>
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      dangerouslySetInnerHTML={{ __html: checkIcon }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
