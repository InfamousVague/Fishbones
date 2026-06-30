/// Adversarial scenarios for the file-stream planner.
///
/// Each test reproduces a real-world failure mode we've seen
/// from the model: malformed fences, multi-file races,
/// project-id sniffing in awkward content, etc. The planner
/// must handle them deterministically.

import { describe, expect, it } from "vitest";
import {
  EMPTY_PLANNER_STATE,
  planStreamWrites,
  sniffProjectId,
  type StreamPlannerState,
} from "@/lib/aiAgent/fileStream";

function freshState(
  projectId: string | null,
  focusedPath: string | null = null,
): StreamPlannerState {
  return {
    projectId,
    focusedPath,
    lastContent: new Map<string, string>(),
    lastClosed: new Map<string, boolean>(),
    lastContentProjectId: null,
  };
}

describe("planStreamWrites: streaming-token reality", () => {
  it("emits incremental writes as content grows token by token", () => {
    let state = freshState("p1");
    let r = planStreamWrites(state, "```ts:a.ts\nconst");
    state = r.state;
    expect(r.writes[0].content).toBe("const");
    expect(r.writes[0].closed).toBe(false);

    r = planStreamWrites(state, "```ts:a.ts\nconst x =");
    state = r.state;
    expect(r.writes[0].content).toBe("const x =");

    r = planStreamWrites(state, "```ts:a.ts\nconst x = 1;");
    state = r.state;
    expect(r.writes[0].content).toBe("const x = 1;");

    r = planStreamWrites(state, "```ts:a.ts\nconst x = 1;\n```");
    expect(r.writes[0].content).toBe("const x = 1;");
    expect(r.writes[0].closed).toBe(true);
  });

  it("doesn't emit a duplicate when the same closed content reappears", () => {
    let state = freshState("p1");
    let r = planStreamWrites(state, "```ts:a.ts\nfinal content\n```");
    state = r.state;
    expect(r.writes).toHaveLength(1);

    r = planStreamWrites(state, "```ts:a.ts\nfinal content\n```");
    expect(r.writes).toHaveLength(0);
  });

  it("emits new writes for each file in a multi-file response", () => {
    const content = [
      "```ts:src/a.ts",
      "export const a = 1;",
      "```",
      "",
      "```ts:src/b.ts",
      "export const b = 2;",
      "```",
      "",
      "```css:src/style.css",
      "body { background: black; }",
      "```",
    ].join("\n");
    const state = freshState("p1");
    const r = planStreamWrites(state, content);
    expect(r.writes).toHaveLength(3);
    expect(r.writes.map((w) => w.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/style.css",
    ]);
  });

  it("only writes the FIRST bare fence when multiple are present, mapped to focused file", () => {
    const state = freshState("p1", "src/main.js");
    const content = [
      "```js",
      "console.log('a');",
      "```",
      "```js",
      "console.log('b');",
      "```",
    ].join("\n");
    const r = planStreamWrites(state, content);
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0].path).toBe("src/main.js");
    expect(r.writes[0].content).toBe("console.log('a');");
  });

  it("routes a path-tagged fence and a bare fence separately when path comes first", () => {
    const state = freshState("p1", "src/index.js");
    const content = [
      "```js:src/util.js",
      "export const u = 1;",
      "```",
      "```js",
      "import {u} from './util'; console.log(u);",
      "```",
    ].join("\n");
    const r = planStreamWrites(state, content);
    expect(r.writes).toHaveLength(2);
    expect(r.writes[0].path).toBe("src/util.js");
    expect(r.writes[1].path).toBe("src/index.js"); // bare fallback
  });
});

describe("planStreamWrites: malformed inputs", () => {
  it("ignores fences whose body parses as a tool call", () => {
    const state = freshState("p1");
    const content =
      '```jsx:src/App.jsx\n{"name":"some_tool","arguments":{"x":1}}\n```';
    const r = planStreamWrites(state, content);
    expect(r.writes).toEqual([]);
  });

  it("survives content with no fences at all", () => {
    const state = freshState("p1");
    const r = planStreamWrites(state, "just text reply");
    expect(r.writes).toEqual([]);
  });

  it("survives content with only a close fence (no open)", () => {
    const state = freshState("p1");
    const r = planStreamWrites(state, "trailing\n```\nthen text");
    expect(r.writes).toEqual([]);
  });

  it("handles a fence with a path but no lang", () => {
    const state = freshState("p1");
    const r = planStreamWrites(
      state,
      "```src/empty.txt\nhello\n```",
    );
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0].path).toBe("src/empty.txt");
  });

  it("uses space-delimited info string", () => {
    const state = freshState("p1");
    const r = planStreamWrites(state, "```ts src/main.ts\nx;\n```");
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0].language).toBe("ts");
    expect(r.writes[0].path).toBe("src/main.ts");
  });
});

describe("planStreamWrites: project-id sniffing", () => {
  it("does not adopt sniffed id when state already has one", () => {
    const state = freshState("p1");
    const content =
      'project info: {"projectId":"p999","ok":true}\n```ts:a.ts\nfoo\n```';
    const r = planStreamWrites(state, content);
    // Existing state.projectId wins.
    expect(r.state.projectId).toBe("p1");
    expect(r.writes[0].projectId).toBe("p1");
  });

  it("adopts sniffed id when state has none", () => {
    const state = freshState(null);
    const content =
      'sure! {"projectId":"sniffed","ok":true}\n```ts:a.ts\nfoo\n```';
    const r = planStreamWrites(state, content);
    expect(r.state.projectId).toBe("sniffed");
    expect(r.writes[0].projectId).toBe("sniffed");
  });

  it("returns null when content has no projectId payload", () => {
    expect(sniffProjectId("just a chat reply with no payload")).toBeNull();
  });
});

describe("planStreamWrites: empty / no-op cases", () => {
  it("returns no writes when state has no project + no sniffable payload", () => {
    const r = planStreamWrites(EMPTY_PLANNER_STATE, "```ts:a.ts\nx\n```");
    expect(r.writes).toEqual([]);
  });

  it("returns no writes for empty content", () => {
    const state = freshState("p1");
    const r = planStreamWrites(state, "");
    expect(r.writes).toEqual([]);
  });
});

describe("planStreamWrites: project switching", () => {
  it("wipes lastContent when project changes through state mutation", () => {
    let state = freshState("p1");
    let r = planStreamWrites(state, "```ts:a.ts\nv1\n```");
    state = r.state;
    expect(state.lastContent.has("a.ts")).toBe(true);

    state = { ...state, projectId: "p2" };
    r = planStreamWrites(state, "```ts:a.ts\nv2\n```");
    // Cache wiped, write emitted as new content for p2.
    expect(r.writes[0].isNew).toBe(true);
    expect(r.writes[0].projectId).toBe("p2");
  });
});
