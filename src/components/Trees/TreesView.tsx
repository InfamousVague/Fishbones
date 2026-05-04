/// Trees feature: the top-level view that lets the learner pick
/// which skill tree to walk, then renders the chosen tree's DAG.
///
/// Navigation: `<TreesView>` is mounted as a top-level destination
/// from the sidebar. It owns its own internal "currently-viewing"
/// state — clicking a tree card from the shelf opens that tree;
/// clicking the back chevron returns to the shelf. We could push
/// this into App-level routing later (?tree=foundations) but it's
/// not worth the URL plumbing yet.

import { useMemo, useState } from "react";
import type { Course } from "../../data/types";
import { TREES } from "../../data/trees";
import { TreeDetail } from "./TreeDetail";
import TreeCard from "./TreeCard";
import "@base/primitives/icon/icon.css";
import "./TreesView.css";

// Re-export so the fishbones.academy marketing site (and any other
// external caller importing from this path) keeps working after the
// internal split into TreeDetail.tsx / SkillPanel.tsx / etc.
export { TreeDetail } from "./TreeDetail";
export type { TreeDetailProps } from "./TreeDetail";

interface Props {
  courses: readonly Course[];
  /// Same `${courseId}:${lessonId}` set the rest of the app uses.
  completed: Set<string>;
  /// Open a specific lesson — same shape as Sidebar's onSelectLesson.
  /// Wired by App so clicking a skill node's matched lesson takes
  /// the learner directly into that lesson's reader.
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /// Batch-install handler for the SkillPanel's "Install N missing
  /// books on this path" button. Forwarded straight to TreeDetail —
  /// see its prop docs for the contract.
  onInstallMissingCourses?: (courseIds: string[]) => Promise<void>;
}

export default function TreesView({
  courses,
  completed,
  onOpenLesson,
  onInstallMissingCourses,
}: Props) {
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
        onInstallMissingCourses={onInstallMissingCourses}
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
