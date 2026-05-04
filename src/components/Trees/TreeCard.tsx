import { treeProgressPercent, type SkillTree } from "../../data/trees";

interface TreeCardProps {
  tree: SkillTree;
  completed: Set<string>;
  onOpen: () => void;
}

export default function TreeCard({ tree, completed, onOpen }: TreeCardProps) {
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
