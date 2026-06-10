/// Build-state machine — deterministic progress tracking for
/// agent build runs, derived purely from the tool-call timeline.
///
/// The single most common agent failure on small local models is
/// stopping early: create the project, write one file, then ask
/// "what next?" instead of finishing. Prompt engineering reduces
/// the rate but can't eliminate it — a 7B checkpoint will
/// sometimes just stop. This module makes the LOOP aware of build
/// progress so it can act deterministically:
///
///   - `analyzeBuildState(timeline)` folds the run's tool results
///     into a stage: idle → created → writing → ran-failed →
///     complete. No model cooperation required — it's all
///     observed facts (which tools ran, what they returned).
///   - `buildContinuationNudge(state)` produces the synthetic
///     user message the loop injects when the model goes terminal
///     with an unfinished build ("you created X but never ran
///     it — continue"). Bounded by the loop (max 2 nudges) so a
///     genuinely stuck model can't ping-pong forever.
///
/// The same state drives the HUD's stage strip, so the learner
/// sees "project ✓ → files (3) → run ✗" instead of guessing what
/// the agent is up to.

import type { ToolResult } from "../aiTools/types";

export type BuildStage =
  /// No build activity observed in this run.
  | "idle"
  /// Project created, no files written yet (beyond the create
  /// call's own inline files).
  | "created"
  /// At least one file written, but no run attempted.
  | "writing"
  /// A run happened and failed; the agent should be fixing.
  | "ran-failed"
  /// A run happened and succeeded — the build is verified.
  | "complete";

export interface BuildState {
  stage: BuildStage;
  /// Project id from the most recent successful create call.
  projectId: string | null;
  /// Distinct file paths written this run (via write/patch tools
  /// or files inlined in the create call).
  filesWritten: string[];
  /// Whether any run was attempted, and the latest run's outcome.
  ranAtLeastOnce: boolean;
  lastRunOk: boolean | null;
  /// Count of failed runs — feeds struggle tracking + the HUD.
  failedRuns: number;
}

/// Fold the timeline into the current build state. Pure — safe to
/// call on every render.
export function analyzeBuildState(
  timeline: readonly ToolResult[],
): BuildState {
  let projectId: string | null = null;
  const files = new Set<string>();
  let ranAtLeastOnce = false;
  let lastRunOk: boolean | null = null;
  let failedRuns = 0;

  for (const entry of timeline) {
    const payload = parsePayload(entry.content);
    switch (entry.name) {
      case "create_sandbox_project": {
        if (entry.ok && typeof payload?.projectId === "string") {
          projectId = payload.projectId;
          // Files inlined into the create call count as written.
          const inlined = payload.files;
          if (Array.isArray(inlined)) {
            for (const f of inlined) {
              const path =
                typeof f?.path === "string"
                  ? f.path
                  : typeof f?.name === "string"
                    ? f.name
                    : null;
              if (path) files.add(path);
            }
          }
        }
        break;
      }
      case "write_sandbox_file": {
        if (entry.ok && typeof payload?.path === "string") {
          files.add(payload.path);
        }
        break;
      }
      case "apply_sandbox_patch": {
        if (entry.ok && Array.isArray(payload?.applied)) {
          for (const a of payload.applied) {
            if (a?.op === "write" && typeof a?.path === "string") {
              files.add(a.path);
            }
          }
        }
        break;
      }
      case "run_sandbox_project": {
        ranAtLeastOnce = true;
        lastRunOk = entry.ok;
        if (!entry.ok) failedRuns += 1;
        break;
      }
      default:
        break;
    }
  }

  let stage: BuildStage = "idle";
  if (projectId !== null) {
    if (ranAtLeastOnce) {
      stage = lastRunOk ? "complete" : "ran-failed";
    } else if (files.size > 0) {
      stage = "writing";
    } else {
      stage = "created";
    }
  }

  return {
    stage,
    projectId,
    filesWritten: Array.from(files),
    ranAtLeastOnce,
    lastRunOk,
    failedRuns,
  };
}

/// The synthetic continuation message the loop injects when the
/// model declared itself done with an unfinished build. Null when
/// the build is complete (or never started) — no nudge needed.
///
/// Written as a terse user-voice instruction because that's the
/// strongest signal position for instruction-tuned checkpoints:
/// they treat the latest user message as the live task.
export function buildContinuationNudge(state: BuildState): string | null {
  switch (state.stage) {
    case "created":
      return [
        `You created project ${state.projectId} but haven't written any files into it — the project only has its placeholder.`,
        "Continue NOW without asking: write every file the build needs (write_sandbox_file or fenced blocks), then call run_sandbox_project to verify.",
      ].join(" ");
    case "writing":
      return [
        `You've written ${state.filesWritten.length} file(s) into ${state.projectId} but never ran the project, so the build is unverified.`,
        "Continue NOW without asking: write any remaining files, then call run_sandbox_project. The build isn't done until a run returns ok: true.",
      ].join(" ");
    case "ran-failed":
      return [
        `The last run of ${state.projectId} FAILED — the build is broken.`,
        "Read the error in the run result above, fix the offending file with apply_sandbox_patch, and run again. Repeat until the run returns ok: true.",
      ].join(" ");
    case "idle":
    case "complete":
      return null;
  }
}

function parsePayload(content: string): Record<string, any> | null {
  try {
    const v = JSON.parse(content);
    return v && typeof v === "object" ? (v as Record<string, any>) : null;
  } catch {
    return null;
  }
}
