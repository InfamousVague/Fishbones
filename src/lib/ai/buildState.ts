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

import type { ToolResult } from "@/lib/aiTools/types";

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
    if (ranAtLeastOnce && lastRunOk) {
      // A successful run means the build works — always complete,
      // even if file tracking couldn't see the writes (some write
      // results don't echo a path).
      stage = "complete";
    } else if (files.size === 0) {
      // Empty project with no successful run. Models often fire
      // run_sandbox_project early — frequently with a placeholder id —
      // which "fails" and would otherwise mis-stage this as
      // `ran-failed`, sending the model off to "fix the broken build"
      // by patching a file that doesn't exist (the empty-project
      // debugging spiral the probe caught). The real next step on an
      // empty project is always: WRITE FILES.
      stage = "created";
    } else if (ranAtLeastOnce) {
      // Files exist and the last run failed — a genuine fix loop.
      stage = "ran-failed";
    } else {
      stage = "writing";
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
export function buildContinuationNudge(
  state: BuildState,
  opts?: {
    /// True when this run is a BUILD request (the user asked the agent
    /// to build/create something). Lets the idle stage push a model
    /// that only preambled — without mis-firing on a plain Q&A turn
    /// that legitimately ends with no project.
    buildExpected?: boolean;
    /// True for WEAK emulated models driven by the fence-first
    /// protocol (no reliable tool-call channel). Their nudges speak
    /// "write ```language:path fenced files", not "call a tool".
    fenceFirst?: boolean;
  },
): string | null {
  const fence = !!opts?.fenceFirst;
  switch (state.stage) {
    case "idle":
      // The model went terminal without starting the build — typically
      // it wrote preamble ("Okay, let's build…") instead of acting.
      // Only push when a build was actually expected, so non-build
      // agent turns (answering a question) aren't nagged.
      if (opts?.buildExpected) {
        if (fence) {
          return [
            "You haven't written any files yet.",
            "Start NOW: output the first file as a ```language:path fenced code block (for example ```jsx:src/App.jsx), then the next file, and so on.",
            "No preamble, no plan, no tool calls — just the fenced files. The project is created automatically from them.",
          ].join(" ");
        }
        return [
          "You haven't started the build yet — no project exists.",
          "Stop explaining and ACT NOW: emit a create_sandbox_project tool call with the project name + language, and pass the FULL files array so the whole project lands in one call.",
          "Do not write any prose before the tool call.",
        ].join(" ");
      }
      return null;
    case "created":
      if (fence) {
        return [
          `Project ${state.projectId} exists but is empty.`,
          "Write every file the app needs NOW as ```language:path fenced code blocks (e.g. ```jsx:src/App.jsx), back-to-back.",
          "No prose, no tool calls — just the fenced files.",
        ].join(" ");
      }
      return [
        `You created project ${state.projectId} but haven't written any files into it — the project is empty.`,
        `Do NOT call create_sandbox_project again, and do NOT call run_sandbox_project yet — the project already exists as ${state.projectId} and has nothing to run.`,
        `Continue NOW without asking and without reading files: write every file the build needs with write_sandbox_file (projectId: "${state.projectId}"). Use that EXACT projectId, never a placeholder. Then run_sandbox_project.`,
      ].join(" ");
    case "writing":
      if (fence) {
        return [
          `You've written ${state.filesWritten.length} file(s) into ${state.projectId}.`,
          "If any files are still missing, write them now as ```language:path fenced blocks. Otherwise you're done — stop.",
        ].join(" ");
      }
      return [
        `You've written ${state.filesWritten.length} file(s) into ${state.projectId} but never ran the project, so the build is unverified.`,
        `Continue NOW without asking: write any remaining files (projectId: "${state.projectId}"), then call run_sandbox_project. The build isn't done until a run returns ok: true.`,
      ].join(" ");
    case "ran-failed":
      return [
        `The last run of ${state.projectId} FAILED — the build is broken.`,
        `Read the error in the run result above, fix the offending EXISTING file (one of: ${state.filesWritten.join(", ")}) with apply_sandbox_patch, and run again. Do not create new files unless the error names a missing one. Repeat until the run returns ok: true.`,
      ].join(" ");
    case "complete":
      return null;
  }
}

/// Heuristic: does this user prompt ask the agent to BUILD something
/// (vs. a question / navigation request)? Drives the idle-start nudge
/// so a model that only preambles gets pushed to act — without nagging
/// genuine Q&A turns. Deliberately conservative: a clear build verb
/// near the start, or an explicit "in <language>" scaffold ask.
export function looksLikeBuildRequest(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return /\b(build|create|make|scaffold|generate|implement|code up|write me|write a|set up)\b/.test(
    p,
  ) && /\b(game|app|component|project|page|site|cli|tool|clone|demo|ui|api|script|function|class|website|form|calculator|dashboard|in react|in python|in js|in javascript|in typescript|in rust|in html)\b/.test(
    p,
  );
}

function parsePayload(content: string): Record<string, any> | null {
  try {
    const v = JSON.parse(content);
    return v && typeof v === "object" ? (v as Record<string, any>) : null;
  } catch {
    return null;
  }
}
