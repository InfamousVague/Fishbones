/// Learning tracks — Codecademy-style curated career paths through
/// the existing skill trees.
///
/// Where trees model the FULL space of a discipline as a DAG, a
/// TRACK is a hand-picked LINEAR-ISH journey across one or more
/// trees that delivers a specific outcome ("Front-End Engineer",
/// "Smart-Contract Developer"). The point is to give the learner
/// who doesn't yet know what they want to do a small number of
/// strong, opinionated choices instead of forcing them to pick a
/// tree and reverse-engineer a path through it.
///
/// Tracks reuse the SkillNode IDs from their source trees — they
/// don't own their own lesson matches. This means:
///
///   * progress in a track is just `isSkillComplete()` summed
///     across its `steps[]`,
///   * a node completed via a tree counts toward every track that
///     references it,
///   * gaps in the underlying trees automatically surface as gaps
///     in the track.
///
/// Adding a new track:
///   1. Add an entry to `TRACKS` in `index.ts`.
///   2. Each step references a `treeId:nodeId` pair. The treeId
///      must match a tree's `id` in `data/trees/*`; the nodeId
///      must match a `SkillNode.id` inside that tree's `nodes[]`.
///      Mismatches show up in the dev console (see `validateTrack`)
///      so you don't ship a track pointing at a renamed node.
///   3. The first step is the on-ramp — it's the node the "Start
///      track" button drops the learner into.

import type { SkillNode, SkillTree } from "@/data/trees/index";
import { isSkillComplete, resolveSkillMatch } from "@/data/trees/index";
import type { Course } from "@/data/types";

export interface TrackStep {
  /// Which tree the underlying skill lives in. Cross-tree tracks
  /// (the common case — e.g. "Front-End" mixes Foundations with
  /// Web) hop between trees naturally.
  treeId: string;
  /// Node id within `treeId`'s `nodes[]`.
  nodeId: string;
  /// Optional human label override. Sometimes a tree's node label
  /// is too generic to read on its own (e.g. "Functions" inside a
  /// track called "Front-End Engineer" — the learner wants to know
  /// "Functions for what?"). Falls back to the underlying node's
  /// label when omitted.
  label?: string;
}

export interface LearningTrack {
  id: string;
  /// Cover-art info, threaded in when a challenge pack is adapted into
  /// a track so the gallery card can render the pack's cover. Unset for
  /// hand-authored career tracks.
  coverFetchedAt?: number;
  language?: string;
  /// Full title — appears in the card head + detail view.
  title: string;
  /// Two-word tag used on the card chip + the section header. Same
  /// shape as `SkillTree.short` so the visual vocabulary matches.
  short: string;
  /// One-paragraph pitch. Renders on the card and at the top of the
  /// detail view. Keep it outcome-focused: what can the learner DO
  /// after finishing the track?
  description: string;
  /// Visual accent — hex string, used for the card chip + progress
  /// bar + step-indicator dots. Pick from the same Libre cover
  /// palette the trees use so tracks blend into the same design
  /// language.
  accent: string;
  /// Difficulty tier. Surfaced as a small badge so a learner can
  /// avoid biting off "Smart-Contract Developer" before they've
  /// finished any of "Foundations".
  difficulty: "beginner" | "intermediate" | "advanced";
  /// Approximate effort in hours (across the whole track). Rough
  /// estimate — used for the card meta line. Omit if you don't have
  /// a calibrated number; the meta line drops the hours bullet
  /// gracefully.
  estimatedHours?: number;
  /// One-line subtitle for the card — what makes THIS track
  /// different from the others on the same shelf. Keep it short.
  outcome: string;
  /// Ordered sequence of skill nodes the learner walks. First step
  /// is the on-ramp; the last step is the "you're done" capstone.
  /// Order matters — the detail view renders this as a numbered
  /// timeline, and the suggestion engine picks the first incomplete
  /// step as "Next up".
  steps: readonly TrackStep[];
}

/// Resolved step — a `TrackStep` paired with its underlying
/// `SkillNode` and source `SkillTree`. Components prefer this shape
/// so they don't repeatedly map ids back to nodes.
export interface ResolvedTrackStep {
  step: TrackStep;
  /// The underlying skill node. `null` if the step references a
  /// node id that doesn't exist in its tree (data-quality bug;
  /// caught early in dev by `validateTrack`).
  node: SkillNode | null;
  /// The tree the node lives in. `null` if the treeId doesn't
  /// resolve.
  tree: SkillTree | null;
}

/// Resolve every step in a track against the live tree data. The
/// returned array is the same length + order as `track.steps`; use
/// the `node` / `tree` nullability to render "missing" placeholders
/// for any step whose target was renamed since the track was
/// authored.
export function resolveTrack(
  track: LearningTrack,
  trees: readonly SkillTree[],
): ResolvedTrackStep[] {
  const treesById = new Map(trees.map((t) => [t.id, t]));
  return track.steps.map((step) => {
    const tree = treesById.get(step.treeId) ?? null;
    const node = tree?.nodes.find((n) => n.id === step.nodeId) ?? null;
    return { step, node, tree };
  });
}

/// % of steps whose underlying skill is complete. Mirrors
/// `treeProgressPercent` but operates on the track's chosen subset
/// of nodes. Section nodes (kind: "section") in the underlying
/// tree count as complete (same as the tree-level rule), so a
/// track that includes a section header doesn't get permanently
/// stuck at 95%.
export function trackProgressPercent(
  track: LearningTrack,
  trees: readonly SkillTree[],
  completed: Set<string>,
): number {
  const resolved = resolveTrack(track, trees);
  if (resolved.length === 0) return 0;
  let done = 0;
  for (const r of resolved) {
    if (!r.node) continue; // unresolved step counts as not-done
    if (isSkillComplete(r.node, completed)) done += 1;
  }
  return Math.round((done / resolved.length) * 100);
}

/// "Next up" inside a track = the first step whose underlying skill
/// is not yet complete. Returns null when the track is already
/// finished (or empty / all-unresolved). The detail view highlights
/// this step + the card-level "Continue" CTA targets it.
export function suggestNextTrackStep(
  track: LearningTrack,
  trees: readonly SkillTree[],
  completed: Set<string>,
): ResolvedTrackStep | null {
  const resolved = resolveTrack(track, trees);
  for (const r of resolved) {
    if (!r.node) continue;
    if (!isSkillComplete(r.node, completed)) return r;
  }
  return null;
}

/// Pick the first installable lesson off a resolved step, biased to
/// the canonical (first) match. Returns null when the underlying
/// node has no `matches` (content gap) OR when none of its matches
/// resolve against the user's installed courses (user hasn't pulled
/// the course down yet). Used by the detail view's "Open lesson"
/// affordance + the card-level "Continue" CTA.
export function firstLessonForStep(
  step: ResolvedTrackStep,
  courses: readonly Course[],
): { courseId: string; lessonId: string } | null {
  if (!step.node) return null;
  for (const m of step.node.matches) {
    if (resolveSkillMatch(m, courses)) {
      return { courseId: m.courseId, lessonId: m.lessonId };
    }
  }
  return null;
}
