/// Iter 2 — non-destructive co-editing. The reconcile merge must
/// never overwrite the user's UNSAVED edits when the agent writes to
/// disk and fires a refresh, while still surfacing the agent's writes.

import { describe, expect, it } from "vitest";
import { mergeReconciledFiles } from "../useSandboxProjects";
import type { WorkbenchFile } from "../../data/types";

function f(name: string, content: string): WorkbenchFile {
  return { name, content, language: "javascript" as WorkbenchFile["language"] };
}

describe("mergeReconciledFiles", () => {
  it("surfaces an agent write (disk newer, memory clean)", () => {
    const last = [f("a.js", "v1")];
    const memory = [f("a.js", "v1")]; // user hasn't touched it
    const disk = [f("a.js", "v2-agent")]; // agent wrote v2
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.find((x) => x.name === "a.js")!.content).toBe("v2-agent");
  });

  it("preserves the user's UNSAVED edit to a file the agent didn't touch", () => {
    const last = [f("a.js", "v1"), f("b.js", "b1")];
    // User typed into b.js (not yet written to disk); agent wrote a.js.
    const memory = [f("a.js", "v1"), f("b.js", "b1-user-typing")];
    const disk = [f("a.js", "v2-agent"), f("b.js", "b1")];
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.find((x) => x.name === "a.js")!.content).toBe("v2-agent");
    expect(out.find((x) => x.name === "b.js")!.content).toBe("b1-user-typing");
  });

  it("on a conflict (both edited) keeps the USER's version — never clobber the human", () => {
    const last = [f("a.js", "v1")];
    const memory = [f("a.js", "v1-user")];
    const disk = [f("a.js", "v1-agent")];
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.find((x) => x.name === "a.js")!.content).toBe("v1-user");
  });

  it("takes disk for untouched files (clean === disk === last)", () => {
    const last = [f("a.js", "same")];
    const memory = [f("a.js", "same")];
    const disk = [f("a.js", "same")];
    expect(mergeReconciledFiles(disk, memory, last)[0].content).toBe("same");
  });

  it("keeps a local-only file that isn't on disk yet (newly created, unsaved)", () => {
    const last = [f("a.js", "v1")];
    const memory = [f("a.js", "v1"), f("new.js", "fresh")];
    const disk = [f("a.js", "v1")];
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.map((x) => x.name)).toContain("new.js");
    expect(out.find((x) => x.name === "new.js")!.content).toBe("fresh");
  });

  it("includes a disk-only file the agent just created", () => {
    const last = [f("a.js", "v1")];
    const memory = [f("a.js", "v1")];
    const disk = [f("a.js", "v1"), f("agent.js", "made by agent")];
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.find((x) => x.name === "agent.js")!.content).toBe("made by agent");
  });

  it("HONORS an agent deletion of a clean file (does not resurrect it)", () => {
    // Agent deleted b.js on disk; user never edited it. It must not
    // come back.
    const last = [f("a.js", "1"), f("b.js", "1")];
    const memory = [f("a.js", "1"), f("b.js", "1")];
    const disk = [f("a.js", "1")];
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.map((x) => x.name)).toEqual(["a.js"]);
  });

  it("keeps a file the agent deleted IF the user has unsaved edits to it (conflict → human wins)", () => {
    const last = [f("a.js", "1"), f("b.js", "b1")];
    const memory = [f("a.js", "1"), f("b.js", "b1-user-edited")];
    const disk = [f("a.js", "1")]; // agent deleted b.js
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.find((x) => x.name === "b.js")!.content).toBe("b1-user-edited");
  });

  it("surfaces an agent CREATE even when memory holds a stale buffer with no baseline", () => {
    // No baseline for main.js (first reconcile / added since last sync).
    // Memory has a stale stub; disk has the agent's real content.
    const last = undefined;
    const memory = [f("main.js", "stub")];
    const disk = [f("main.js", "full implementation")];
    const out = mergeReconciledFiles(disk, memory, last);
    expect(out.find((x) => x.name === "main.js")!.content).toBe(
      "full implementation",
    );
  });

  it("preserves disk order", () => {
    const last = [f("a.js", "1"), f("b.js", "1"), f("c.js", "1")];
    const memory = [f("a.js", "1"), f("b.js", "1"), f("c.js", "1")];
    const disk = [f("a.js", "1"), f("b.js", "1"), f("c.js", "1")];
    expect(mergeReconciledFiles(disk, memory, last).map((x) => x.name)).toEqual([
      "a.js",
      "b.js",
      "c.js",
    ]);
  });
});
