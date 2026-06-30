/// Detail view for a single learning track. Renders as a numbered
/// vertical timeline — much simpler shape than `TreeDetail`'s pan /
/// zoom DAG visualiser, because a track IS linear by construction.
/// Each step shows: index, status (done / in-progress / locked /
/// gap), the underlying tree's icon, the step label, the source-tree
/// crumb, and a primary "Open lesson" affordance when an installed
/// lesson is reachable.
///
/// Why a separate view from TreeDetail? A track's job is to give the
/// learner a confident, opinionated path — the DAG's branching freedom
/// is what they're trying to escape. So this view intentionally hides
/// the prereq graph and shows ONLY the curated sequence.

import { Icon } from "@base/primitives/icon";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { trainTrack } from "@base/primitives/icon/icons/train-track";
import "@base/primitives/icon/icon.css";
import type { Course } from "@/data/types";
import {
  firstLessonForStep,
  resolveTrack,
  suggestNextTrackStep,
  trackProgressPercent,
  type LearningTrack,
  type ResolvedTrackStep,
} from "@/data/tracks/index";
import {
  iconForSkill,
  isSkillComplete,
  type SkillTree,
} from "@/data/trees/index";
import { ICON_REGISTRY } from "./iconRegistry";

interface TrackDetailProps {
  track: LearningTrack;
  trees: readonly SkillTree[];
  courses: readonly Course[];
  completed: Set<string>;
  onBack: () => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
}

export function TrackDetail({
  track,
  trees,
  courses,
  completed,
  onBack,
  onOpenLesson,
}: TrackDetailProps) {
  const resolved = resolveTrack(track, trees);
  const pct = trackProgressPercent(track, trees, completed);
  const nextStep = suggestNextTrackStep(track, trees, completed);

  // Card-level "Continue" button targets the first installable lesson
  // off the next-up step. Falls back to inert if there's no resolvable
  // lesson (track is finished, or the next step is a content gap on
  // the underlying tree).
  const continueLesson = nextStep
    ? firstLessonForStep(nextStep, courses)
    : null;

  return (
    <div
      className="libre-trees libre-trees--detail libre-trees--track-detail"
      style={{ "--tree-accent": track.accent } as React.CSSProperties}
    >
      <div className="libre-trees__detail-head">
        <button
          type="button"
          className="libre-trees__back"
          onClick={onBack}
        >
          <span className="libre-trees__back-icon" aria-hidden>
            <Icon icon={arrowLeft} size="xs" color="currentColor" weight="bold" />
          </span>
          <span>All trees</span>
        </button>
        <div>
          <h2 className="libre-trees__detail-title">
            <span
              className="libre-trees__track-detail-titleicon"
              aria-hidden
              style={{ color: track.accent }}
            >
              <Icon icon={trainTrack} size="sm" color="currentColor" weight="bold" />
            </span>
            {track.title}
          </h2>
          <p className="libre-trees__detail-blurb">{track.description}</p>
        </div>
        <div className="libre-trees__detail-progress">
          <div className="libre-trees__detail-pct">{pct}%</div>
          <div className="libre-trees__detail-pct-label">complete</div>
        </div>
      </div>

      {/* Outcome / meta strip — pinned just below the title block so
          the learner sees the "what does this get me" summary before
          they scroll the step list. */}
      <div className="libre-trees__track-meta">
        <span className="libre-trees__track-meta-outcome">
          {track.outcome}
        </span>
        <span className="libre-trees__track-meta-stats">
          {track.steps.length} steps
          {track.estimatedHours ? ` · ~${track.estimatedHours}h` : ""}
          {" · "}
          {track.difficulty}
        </span>
      </div>

      {/* Continue CTA — only renders when there's a real lesson to
          open. Gives the learner a single primary click that lands
          them on the right next step without scanning the whole list. */}
      {continueLesson && nextStep && (
        <button
          type="button"
          className="libre-trees__track-continue"
          onClick={() =>
            onOpenLesson(continueLesson.courseId, continueLesson.lessonId)
          }
        >
          <span>Continue</span>
          <span className="libre-trees__track-continue-target">
            Step {nextStep ? resolved.indexOf(nextStep) + 1 : "—"} ·{" "}
            {nextStep.step.label ?? nextStep.node?.label ?? "Next skill"}
          </span>
        </button>
      )}

      <ol className="libre-trees__track-list">
        {resolved.map((r, idx) => {
          const status = computeStepStatus(r, completed);
          const lesson = firstLessonForStep(r, courses);
          const label = r.step.label ?? r.node?.label ?? "(missing skill)";
          const isNext = r === nextStep;
          const iconName = r.node ? iconForSkill(r.node.id) : "circle";
          const iconPaths = ICON_REGISTRY[iconName];
          return (
            <li
              key={`${r.step.treeId}:${r.step.nodeId}`}
              className={[
                "libre-trees__track-step",
                `libre-trees__track-step--${status}`,
                isNext ? "libre-trees__track-step--next" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="libre-trees__track-step-rail" aria-hidden>
                <div className="libre-trees__track-step-dot">
                  {status === "done" ? (
                    <Icon
                      icon={checkIcon}
                      size="xs"
                      color="currentColor"
                      weight="bold"
                    />
                  ) : (
                    <span className="libre-trees__track-step-num">
                      {idx + 1}
                    </span>
                  )}
                </div>
                {idx < resolved.length - 1 && (
                  <div className="libre-trees__track-step-line" />
                )}
              </div>
              <div className="libre-trees__track-step-body">
                <div className="libre-trees__track-step-head">
                  {iconPaths && (
                    <span
                      className="libre-trees__track-step-icon"
                      aria-hidden
                    >
                      <Icon
                        icon={iconPaths}
                        size="xs"
                        color="currentColor"
                        weight="bold"
                      />
                    </span>
                  )}
                  <span className="libre-trees__track-step-label">
                    {label}
                  </span>
                  {isNext && (
                    <span className="libre-trees__track-step-flag">
                      Next up
                    </span>
                  )}
                  {status === "gap" && (
                    <span className="libre-trees__track-step-flag libre-trees__track-step-flag--gap">
                      Coming soon
                    </span>
                  )}
                  {status === "missing" && (
                    <span className="libre-trees__track-step-flag libre-trees__track-step-flag--gap">
                      Missing
                    </span>
                  )}
                </div>
                <div className="libre-trees__track-step-meta">
                  {r.tree ? r.tree.title : `tree: ${r.step.treeId}`}
                </div>
                {r.node?.summary && (
                  <p className="libre-trees__track-step-summary">
                    {r.node.summary}
                  </p>
                )}
                {lesson && status !== "done" && (
                  <button
                    type="button"
                    className="libre-trees__track-step-open"
                    onClick={() =>
                      onOpenLesson(lesson.courseId, lesson.lessonId)
                    }
                  >
                    Open lesson
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/// Step-status reducer. Mirrors the four states a tree node can be
/// in (done, gap, locked, available) but collapsed to four track-
/// specific cases:
///
///   * `done`     — underlying skill is complete
///   * `gap`      — node has empty `matches` (content not yet built)
///   * `missing`  — track references a node id that no longer exists
///   * `pending`  — everything else (the default state we render)
///
/// Tracks intentionally don't model `locked` — the whole point of
/// the curation is to remove the prereq-pressure decision from the
/// learner. The detail view trusts the author to have ordered steps
/// sensibly and just shows them as a sequence.
function computeStepStatus(
  step: ResolvedTrackStep,
  completed: Set<string>,
): "done" | "gap" | "missing" | "pending" {
  if (!step.node) return "missing";
  if (isSkillComplete(step.node, completed)) return "done";
  if (step.node.matches.length === 0) return "gap";
  return "pending";
}

export default TrackDetail;
