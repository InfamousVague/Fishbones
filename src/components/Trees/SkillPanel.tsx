import { useMemo, useState } from "react";
import {
  isSkillComplete,
  resolveSkillMatch,
  type SkillNode,
  type SkillTree,
} from "../../data/trees";
import type { Course } from "../../data/types";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";

interface SkillPanelProps {
  node: SkillNode;
  tree: SkillTree;
  courses: readonly Course[];
  completed: Set<string>;
  unlocked: boolean;
  isNext: boolean;
  isTrackGoal: boolean;
  /// All skills on the path from roots to the active goal, sorted
  /// root → goal. Empty when no goal is set or this skill isn't
  /// the goal. Drives the panel's "Path to goal" checklist.
  trackOrdered: SkillNode[];
  onSetTrack: () => void;
  onClose: () => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /// Optional install handler — receives the deduped list of
  /// courseIds the panel detected as missing along the active path.
  /// When omitted (e.g. marketing-site `viewOnly` mode) the install
  /// affordance is hidden. Returns a promise so the panel can show
  /// an in-flight state until the installs settle.
  onInstallMissingCourses?: (courseIds: string[]) => Promise<void>;
}

export default function SkillPanel({
  node,
  courses,
  completed,
  unlocked,
  isNext,
  isTrackGoal,
  trackOrdered,
  onSetTrack,
  onClose,
  onOpenLesson,
  onInstallMissingCourses,
}: SkillPanelProps) {
  const isGap = node.matches.length === 0;
  const completedHere = isSkillComplete(node, completed);
  // Total / done counts for the rendered track. We render the
  // checklist only when THIS panel's skill is the active goal —
  // otherwise the rest of the tree is just supporting cast.
  const trackDone = trackOrdered.filter((n) => isSkillComplete(n, completed)).length;

  // Walk every node in the active path (`trackOrdered`) and pull out
  // the courseIds whose `resolveSkillMatch` returns null — that's
  // the marker for "the user picked this path but doesn't have the
  // book installed yet." Deduped, stable order.
  const missingCourseIds = useMemo(() => {
    if (!isTrackGoal || trackOrdered.length === 0) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const step of trackOrdered) {
      for (const m of step.matches) {
        if (resolveSkillMatch(m, courses)) continue;
        if (seen.has(m.courseId)) continue;
        seen.add(m.courseId);
        out.push(m.courseId);
      }
    }
    return out;
  }, [isTrackGoal, trackOrdered, courses]);

  // In-flight install state — covers the duration of the parent's
  // batch install. Rendered as a spinner-ish disabled button so the
  // learner can't fire the same install twice while the catalog
  // round-trips.
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

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
          {isTrackGoal && (
            <span className="fishbones-trees__panel-flag fishbones-trees__panel-flag--goal">
              Goal
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

      {/* Goal toggle. Clicking marks this skill as the learner's
          target — the prereq chain lights up on the tree and the
          checklist below this button shows the path in order. A
          second click clears the goal. */}
      <button
        type="button"
        className={`fishbones-trees__panel-track ${
          isTrackGoal ? "fishbones-trees__panel-track--active" : ""
        }`}
        onClick={onSetTrack}
      >
        {isTrackGoal
          ? `Clear goal · ${trackDone}/${trackOrdered.length} steps done`
          : "Set as goal — map a track to this skill"}
      </button>

      {/* Install-missing-courses button. Shown only when the user has
          actually picked this skill as their goal, the path has at
          least one un-installed course, and the parent wired an
          install handler. Tapping kicks off a batch install of every
          missing book on the path; we keep the button busy until the
          parent's promise settles so a second click can't double-fire. */}
      {isTrackGoal &&
        onInstallMissingCourses &&
        missingCourseIds.length > 0 && (
          <div className="fishbones-trees__panel-install">
            <button
              type="button"
              className="fishbones-trees__panel-install-btn"
              disabled={installing}
              onClick={async () => {
                setInstalling(true);
                setInstallError(null);
                try {
                  await onInstallMissingCourses(missingCourseIds);
                } catch (e) {
                  setInstallError(
                    e instanceof Error ? e.message : String(e),
                  );
                } finally {
                  setInstalling(false);
                }
              }}
            >
              {installing
                ? `Installing ${missingCourseIds.length} ${
                    missingCourseIds.length === 1 ? "book" : "books"
                  }…`
                : `Install ${missingCourseIds.length} missing ${
                    missingCourseIds.length === 1 ? "book" : "books"
                  } on this path`}
            </button>
            <p className="fishbones-trees__panel-install-hint">
              The path needs lessons from books you don't have yet.
              We'll fetch them from the catalog so you can keep going.
            </p>
            {installError && (
              <p className="fishbones-trees__panel-install-error">
                Install failed: {installError}
              </p>
            )}
          </div>
        )}

      {isTrackGoal && trackOrdered.length > 0 && (
        <div className="fishbones-trees__panel-track-list">
          <div className="fishbones-trees__panel-lessons-label">
            Path to goal
          </div>
          <ol>
            {trackOrdered.map((n) => {
              const done = isSkillComplete(n, completed);
              const isThis = n.id === node.id;
              return (
                <li
                  key={n.id}
                  className={[
                    "fishbones-trees__panel-track-step",
                    done && "fishbones-trees__panel-track-step--done",
                    isThis && "fishbones-trees__panel-track-step--goal",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="fishbones-trees__panel-track-step-tick" aria-hidden>
                    {done ? (
                      <svg
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        dangerouslySetInnerHTML={{ __html: checkIcon }}
                      />
                    ) : null}
                  </span>
                  {n.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}

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

export type { SkillPanelProps };
