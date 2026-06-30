/// File-stream planner tests. We feed sequential snapshots of the
/// agent's streaming content into `planStreamWrites` and assert
/// on the planned write list — same shape the React hook would
/// apply via `sandbox_save_project`.

import { describe, expect, it } from "vitest";
import {
  EMPTY_PLANNER_STATE,
  inferLanguage,
  planStreamWrites,
  sniffProjectId,
  type StreamPlannerState,
} from "@/lib/aiAgent/fileStream";

function freshState(
  projectId: string | null,
  focusedPath: string | null,
): StreamPlannerState {
  return {
    projectId,
    focusedPath,
    lastContent: new Map<string, string>(),
    lastClosed: new Map<string, boolean>(),
    lastContentProjectId: null,
  };
}

describe("planStreamWrites", () => {
  it("emits no writes without a project id", () => {
    const r = planStreamWrites(EMPTY_PLANNER_STATE, "```ts:a.ts\nx\n```");
    expect(r.writes).toEqual([]);
  });
  it("emits one write for one fenced block", () => {
    const r = planStreamWrites(
      freshState("p1", null),
      "intro\n```ts:src/a.ts\nconst x = 1;\n```",
    );
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toMatchObject({
      projectId: "p1",
      path: "src/a.ts",
      content: "const x = 1;",
      closed: true,
      isNew: true,
    });
  });
  it("flags subsequent ticks as not-new for the same path", () => {
    let state = freshState("p1", null);
    let r = planStreamWrites(state, "```ts:a.ts\npart 1\n```");
    state = r.state;
    expect(r.writes[0].isNew).toBe(true);
    r = planStreamWrites(state, "```ts:a.ts\npart 1\n```\n```ts:b.ts\npart 2\n```");
    expect(r.writes[0].path).toBe("b.ts");
    expect(r.writes[0].isNew).toBe(true);
  });
  it("skips writes when content hasn't changed", () => {
    let state = freshState("p1", null);
    const r1 = planStreamWrites(state, "```ts:a.ts\nfinal\n```");
    state = r1.state;
    const r2 = planStreamWrites(state, "```ts:a.ts\nfinal\n```");
    expect(r2.writes).toHaveLength(0);
  });
  it("emits growing content for an open (in-flight) block", () => {
    let state = freshState("p1", null);
    let r = planStreamWrites(state, "```ts:a.ts\nconst x");
    state = r.state;
    expect(r.writes[0].closed).toBe(false);
    expect(r.writes[0].content).toBe("const x");
    r = planStreamWrites(state, "```ts:a.ts\nconst x = 1;\n```");
    expect(r.writes[0].content).toBe("const x = 1;");
    expect(r.writes[0].closed).toBe(true);
  });
  it("routes a bare fence to the focused file", () => {
    const state = freshState("p1", "src/App.jsx");
    const r = planStreamWrites(state, "```jsx\nfunction A() {}\n```");
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0].path).toBe("src/App.jsx");
  });
  it("drops second bare fence to avoid overwriting focused file", () => {
    const state = freshState("p1", "src/App.jsx");
    const r = planStreamWrites(
      state,
      "```jsx\nA1\n```\n\n```jsx\nA2\n```",
    );
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0].content).toBe("A1");
  });
  it("rejects tool-call payloads even when wrapped in a path-tagged fence", () => {
    const state = freshState("p1", null);
    const r = planStreamWrites(
      state,
      '```jsx:src/App.jsx\n{"name":"x","arguments":{}}\n```',
    );
    expect(r.writes).toEqual([]);
  });
  it("wipes last-content when projectId changes under us", () => {
    let state = freshState("p1", null);
    let r = planStreamWrites(state, "```ts:a.ts\nv1\n```");
    state = r.state;
    expect(state.lastContent.has("a.ts")).toBe(true);
    state = { ...state, projectId: "p2" };
    r = planStreamWrites(state, "```ts:a.ts\nv2\n```");
    // After project switch, content is "new again" — different
    // file in a different project.
    expect(r.writes[0].isNew).toBe(true);
  });
  it("sniffs projectId from create_sandbox_project echo", () => {
    expect(sniffProjectId('{"projectId":"abc-123","ok":true}')).toBe(
      "abc-123",
    );
  });
  it("adopts a sniffed projectId mid-stream", () => {
    const state = freshState(null, null);
    const r = planStreamWrites(
      state,
      'before {"projectId":"sniffed-1"} after\n```ts:a.ts\nx\n```',
    );
    expect(r.state.projectId).toBe("sniffed-1");
    expect(r.writes[0].projectId).toBe("sniffed-1");
  });
});

describe("inferLanguage", () => {
  it("maps common extensions", () => {
    expect(inferLanguage("src/App.tsx")).toBe("typescript");
    expect(inferLanguage("main.py")).toBe("python");
    expect(inferLanguage("hello.rs")).toBe("rust");
  });
  it("falls back to plain for unknown extensions", () => {
    expect(inferLanguage("README.unknown")).toBe("plain");
  });
});
