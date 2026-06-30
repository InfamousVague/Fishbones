/// Shared step / branch / path progress resolution. Both the list
/// cards (PathsPage) and the horizontal tree (PathDetail) resolve
/// the same way, so the logic lives here once rather than being
/// duplicated + drifting between the two surfaces.

import type {
  LearningPath,
  PathBranch,
  PathStep,
} from "@/data/paths";
import { flattenSteps } from "@/data/paths";
import type { Course } from "@/data/types";

export type StepState =
  | "complete"
  | "in-progress"
  | "not-started"
  | "not-installed";

export interface ResolvedStep {
  courseId: string;
  note: string;
  /// Installed course title, or a humanised id when not installed
  /// so the row still reads sensibly.
  title: string;
  state: StepState;
  done: number;
  total: number;
}

/// Build an id→Course index once per render so each step lookup is
/// O(1). Callers memoise this against `courses`.
export function indexCourses(courses: Course[]): Map<string, Course> {
  const m = new Map<string, Course>();
  for (const c of courses) m.set(c.id, c);
  return m;
}

export function resolveStep(
  step: PathStep,
  byId: Map<string, Course>,
  completed: Set<string>,
): ResolvedStep {
  const course = byId.get(step.courseId);
  if (!course) {
    return {
      courseId: step.courseId,
      note: step.note,
      title: humanizeId(step.courseId),
      state: "not-installed",
      done: 0,
      total: 0,
    };
  }
  const total = course.chapters.reduce(
    (n, ch) => n + ch.lessons.length,
    0,
  );
  const done = course.chapters.reduce(
    (n, ch) =>
      n +
      ch.lessons.filter((l) => completed.has(`${course.id}:${l.id}`)).length,
    0,
  );
  const state: StepState =
    total > 0 && done >= total
      ? "complete"
      : done > 0
        ? "in-progress"
        : "not-started";
  return { courseId: step.courseId, note: step.note, title: course.title, state, done, total };
}

export interface Progress {
  done: number;
  total: number;
  pct: number;
  /// Count of steps whose course is installed (vs. catalog-only).
  installed: number;
  count: number;
  allComplete: boolean;
}

/// Aggregate progress over an arbitrary set of resolved steps.
/// Lessons in not-installed courses are excluded from the
/// denominator (we can't know their lesson counts, and counting
/// them as 0/0 would make a mostly-uninstalled route read as 0%).
export function aggregate(steps: ResolvedStep[]): Progress {
  const installedSteps = steps.filter((s) => s.state !== "not-installed");
  const done = installedSteps.reduce((n, s) => n + s.done, 0);
  const total = installedSteps.reduce((n, s) => n + s.total, 0);
  return {
    done,
    total,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    installed: installedSteps.length,
    count: steps.length,
    allComplete:
      installedSteps.length > 0 &&
      installedSteps.every((s) => s.state === "complete"),
  };
}

export function resolveBranch(
  branch: PathBranch,
  byId: Map<string, Course>,
  completed: Set<string>,
): { steps: ResolvedStep[]; progress: Progress } {
  const steps = branch.steps.map((s) => resolveStep(s, byId, completed));
  return { steps, progress: aggregate(steps) };
}

/// Whole-path rollup for the list card (flattens trunk + every
/// branch). See `flattenSteps` for the alternative-route caveat.
export function resolvePathProgress(
  path: LearningPath,
  byId: Map<string, Course>,
  completed: Set<string>,
): Progress {
  return aggregate(
    flattenSteps(path).map((s) => resolveStep(s, byId, completed)),
  );
}

/// "exercism-rust" → "Exercism Rust", "a-to-ts" → "A To Ts".
/// Fallback only — installed courses use their real title.
export function humanizeId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
