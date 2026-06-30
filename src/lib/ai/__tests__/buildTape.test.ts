/// Build Tape tests — the ordered step record + struggle signal the
/// rewind reads. Fixtures mirror the real tool-result shapes.

import { describe, expect, it } from "vitest";
import {
  analyzeBuildTape,
  buildStruggleConcepts,
  strugglePathsForConcept,
} from "@/lib/ai/buildTape";
import type { ToolResult } from "@/lib/aiTools/types";

function tr(name: string, ok: boolean, payload: Record<string, unknown>): ToolResult {
  return { toolCallId: `id-${name}-${Math.random()}`, name, ok, content: JSON.stringify(payload) };
}

describe("analyzeBuildTape", () => {
  it("orders write/patch steps and ignores read-only calls", () => {
    const tape = analyzeBuildTape([
      tr("create_sandbox_project", true, { ok: true, projectId: "p" }),
      tr("list_sandbox_files", true, { files: [] }),
      tr("write_sandbox_file", true, { ok: true, path: "src/main.rs" }),
      tr("read_sandbox_file", true, { content: "…" }),
      tr("write_sandbox_file", true, { ok: true, path: "src/counter.rs" }),
    ]);
    expect(tape.map((s) => s.paths[0])).toEqual(["src/main.rs", "src/counter.rs"]);
    expect(tape.map((s) => s.index)).toEqual([0, 1]);
    // No run yet → unverified.
    expect(tape.every((s) => s.followedByRun === false)).toBe(true);
  });

  it("pairs every pending write with the run that verifies it", () => {
    const tape = analyzeBuildTape([
      tr("write_sandbox_file", true, { ok: true, path: "a.rs" }),
      tr("write_sandbox_file", true, { ok: true, path: "b.rs" }),
      tr("run_sandbox_project", true, { ok: true, logs: [] }),
    ]);
    expect(tape).toHaveLength(2);
    expect(tape.every((s) => s.followedByRun && s.runOk === true)).toBe(true);
    expect(tape.every((s) => s.diagnosisCode === null)).toBe(true);
  });

  it("carries the diagnosis code from a failed run onto the pending steps", () => {
    const tape = analyzeBuildTape([
      tr("write_sandbox_file", true, { ok: true, path: "src/main.rs" }),
      tr("run_sandbox_project", false, {
        ok: false,
        error: "borrow of moved value",
        diagnosis: { code: "rust-E0382", hint: "value was moved" },
      }),
    ]);
    expect(tape[0].runOk).toBe(false);
    expect(tape[0].diagnosisCode).toBe("rust-E0382");
  });

  it("captures apply_sandbox_patch multi-file writes", () => {
    const tape = analyzeBuildTape([
      tr("apply_sandbox_patch", true, {
        ok: true,
        applied: [
          { op: "write", path: "src/a.rs" },
          { op: "write", path: "src/b.rs" },
        ],
      }),
    ]);
    expect(tape).toHaveLength(1);
    expect(tape[0].tool).toBe("apply_sandbox_patch");
    expect(tape[0].paths).toEqual(["src/a.rs", "src/b.rs"]);
  });

  it("a second run only re-verifies steps written since the first run", () => {
    const tape = analyzeBuildTape([
      tr("write_sandbox_file", true, { ok: true, path: "a.rs" }),
      tr("run_sandbox_project", false, { ok: false, diagnosis: { code: "rust-E0382" } }),
      tr("apply_sandbox_patch", true, { ok: true, applied: [{ op: "write", path: "a.rs" }] }),
      tr("run_sandbox_project", true, { ok: true }),
    ]);
    // First step keeps the failed outcome from run #1.
    expect(tape[0].runOk).toBe(false);
    expect(tape[0].diagnosisCode).toBe("rust-E0382");
    // Second step (the fix) verified green by run #2.
    expect(tape[1].runOk).toBe(true);
    expect(tape[1].diagnosisCode).toBeNull();
  });
});

describe("buildStruggleConcepts / strugglePathsForConcept", () => {
  it("maps failed-run diagnosis codes to concepts, deduped", () => {
    const tape = analyzeBuildTape([
      tr("write_sandbox_file", true, { ok: true, path: "src/main.rs" }),
      tr("run_sandbox_project", false, { ok: false, diagnosis: { code: "rust-E0382" } }),
      tr("apply_sandbox_patch", true, { ok: true, applied: [{ op: "write", path: "src/main.rs" }] }),
      tr("run_sandbox_project", false, { ok: false, diagnosis: { code: "rust-E0382" } }),
    ]);
    const concepts = buildStruggleConcepts(tape);
    expect(concepts.map((c) => c.id)).toEqual(["rust-ownership"]);
    const paths = strugglePathsForConcept(tape, "rust-ownership");
    expect(paths.has("src/main.rs")).toBe(true);
  });

  it("is empty for a clean build", () => {
    const tape = analyzeBuildTape([
      tr("write_sandbox_file", true, { ok: true, path: "a.rs" }),
      tr("run_sandbox_project", true, { ok: true }),
    ]);
    expect(buildStruggleConcepts(tape)).toEqual([]);
  });
});
