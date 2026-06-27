/// Build Tape — the ordered, deterministic record of the BUILD
/// STEPS the agent took, folded from the same `ToolResult[]`
/// timeline `buildState` reads.
///
/// Where `buildState` collapses the run to a single stage, the tape
/// keeps the SEQUENCE: each file-writing step in order, paired with
/// the outcome of the run that verified it (ok / failed + the
/// diagnosis code). That sequence is the substrate the "Earn the
/// Diff" rewind reads to decide WHERE the learner struggled, and the
/// post-build recap reads to narrate "here's the path your build
/// took."
///
/// Grounded in what the timeline ACTUALLY carries (verified against
/// the tool handlers): write/patch results expose the file `path`
/// and byte count but NOT the file content; run results expose
/// `ok` + an optional `diagnosis.code`. So the tape records paths +
/// run outcomes; the file CONTENT comes from disk (the host loads
/// the final project and hands it to `rewind.ts`). Pure — no I/O.

import type { ToolResult } from "../aiTools/types";
import { conceptForDiagnosis, type Concept } from "./concepts";

export interface BuildStep {
  /// 0-based position among the build's write/patch steps (NOT the
  /// raw timeline index — read/list/search calls don't get a step).
  index: number;
  tool: "write_sandbox_file" | "apply_sandbox_patch";
  /// File path(s) this step wrote. `write_sandbox_file` writes one;
  /// `apply_sandbox_patch` can write several in one call.
  paths: string[];
  /// True once a `run_sandbox_project` happened after this step
  /// (and before the next write). The run that VERIFIED this step.
  followedByRun: boolean;
  /// Outcome of that verifying run (null until a run follows).
  runOk: boolean | null;
  /// Diagnosis code of that run if it FAILED (e.g. "rust-E0382"),
  /// else null. This is the learner's struggle signal.
  diagnosisCode: string | null;
}

/// Fold the timeline into the ordered build tape. Pure + cheap.
///
/// Batching semantics: several writes followed by one run means the
/// run verified ALL of them, so every pending step since the last
/// run inherits that run's outcome + diagnosis. The line-selection
/// in `rewind.ts` then narrows a failed batch to the one file whose
/// code actually embodies the failing concept.
export function analyzeBuildTape(
  timeline: readonly ToolResult[],
): BuildStep[] {
  const steps: BuildStep[] = [];
  // Steps written since the last run — the ones the next run will
  // verify. Indices into `steps`.
  let pending: number[] = [];

  for (const entry of timeline) {
    const payload = parsePayload(entry.content);
    switch (entry.name) {
      case "write_sandbox_file": {
        if (entry.ok && typeof payload?.path === "string") {
          const idx = steps.length;
          steps.push({
            index: idx,
            tool: "write_sandbox_file",
            paths: [payload.path],
            followedByRun: false,
            runOk: null,
            diagnosisCode: null,
          });
          pending.push(idx);
        }
        break;
      }
      case "apply_sandbox_patch": {
        if (entry.ok && Array.isArray(payload?.applied)) {
          const paths: string[] = [];
          for (const a of payload.applied) {
            if (a?.op === "write" && typeof a?.path === "string") {
              paths.push(a.path);
            }
          }
          if (paths.length > 0) {
            const idx = steps.length;
            steps.push({
              index: idx,
              tool: "apply_sandbox_patch",
              paths,
              followedByRun: false,
              runOk: null,
              diagnosisCode: null,
            });
            pending.push(idx);
          }
        }
        break;
      }
      case "run_sandbox_project": {
        const ok = entry.ok && payload?.ok !== false;
        const code =
          !ok && payload?.diagnosis && typeof payload.diagnosis.code === "string"
            ? (payload.diagnosis.code as string)
            : null;
        for (const i of pending) {
          steps[i].followedByRun = true;
          steps[i].runOk = ok;
          steps[i].diagnosisCode = code;
        }
        pending = [];
        break;
      }
      default:
        break;
    }
  }

  // Renumber `index` densely (already dense since we only push on a
  // real step) — kept explicit for clarity / future filtering.
  return steps.map((s, i) => ({ ...s, index: i }));
}

/// Distinct concepts the build actually TRIPPED OVER — every failed
/// run's diagnosis code mapped through `conceptForDiagnosis`. This
/// is the in-build ZPD signal (vs. the learner's persistent struggle
/// history). Deduped by concept id, in first-seen order.
export function buildStruggleConcepts(
  tape: readonly BuildStep[],
): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const step of tape) {
    if (step.runOk === false && step.diagnosisCode) {
      const concept = conceptForDiagnosis(step.diagnosisCode);
      if (concept && !seen.has(concept.id)) {
        seen.add(concept.id);
        out.push(concept);
      }
    }
  }
  return out;
}

/// The set of file paths implicated in a FAILED run — used to bias
/// the rewind toward a file the learner's build actually broke on.
export function strugglePathsForConcept(
  tape: readonly BuildStep[],
  conceptId: string,
): Set<string> {
  const paths = new Set<string>();
  for (const step of tape) {
    if (step.runOk === false && step.diagnosisCode) {
      const concept = conceptForDiagnosis(step.diagnosisCode);
      if (concept?.id === conceptId) {
        for (const p of step.paths) paths.add(p);
      }
    }
  }
  return paths;
}

function parsePayload(content: string): Record<string, any> | null {
  try {
    const v = JSON.parse(content);
    return v && typeof v === "object" ? (v as Record<string, any>) : null;
  } catch {
    return null;
  }
}
