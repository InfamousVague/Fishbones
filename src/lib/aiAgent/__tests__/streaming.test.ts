/// Vitest coverage for the pure streaming-content parsers.
///
/// These are the most important tests in the AI codebase — the
/// helpers here are what saves us from the "model emits JSON
/// blob and nothing happens" failure mode. Each test pins down
/// one shape of model output the agent loop must handle.

import { describe, expect, it } from "vitest";
import {
  extractInlineToolCalls,
  findBalancedObjects,
  looksLikeToolCallPayload,
  parseFencedBlocks,
  splitInfoString,
  stripInlineToolCallJson,
} from "@/lib/aiAgent/streaming";
import type { ToolDef } from "@/lib/aiTools/types";

const tools: ToolDef[] = [
  {
    name: "create_sandbox_project",
    description: "",
    parameters: { type: "object", properties: {} },
    auto: false,
    async handler() {
      return null;
    },
  },
  {
    name: "run_sandbox_project",
    description: "",
    parameters: { type: "object", properties: {} },
    auto: false,
    async handler() {
      return null;
    },
  },
];

describe("findBalancedObjects", () => {
  it("matches a single top-level object", () => {
    const r = findBalancedObjects('hi {"a":1} bye');
    expect(r).toHaveLength(1);
    expect(r[0].span).toBe('{"a":1}');
  });
  it("matches multiple top-level objects without recursing into nested ones", () => {
    const r = findBalancedObjects('a {"x":{"y":1}} b {"z":2} c');
    expect(r.map((x) => x.span)).toEqual(['{"x":{"y":1}}', '{"z":2}']);
  });
  it("skips braces inside string literals", () => {
    const r = findBalancedObjects('{"k":"value with } and { inside"}');
    expect(r).toHaveLength(1);
    expect(r[0].span).toBe('{"k":"value with } and { inside"}');
  });
  it("handles escaped quotes inside strings", () => {
    const r = findBalancedObjects('{"k":"a \\"quote\\" then a }"}');
    expect(r).toHaveLength(1);
  });
  it("returns positions so callers can splice", () => {
    const r = findBalancedObjects('prefix {"a":1} suffix');
    expect(r[0].start).toBe(7);
    expect(r[0].end).toBe(14);
  });
  it("bails cleanly on unbalanced content (open without close)", () => {
    expect(findBalancedObjects('{"a":1, ')).toEqual([]);
  });
  it("handles the tic-tac-toe regression case (nested arguments)", () => {
    // This is the exact shape the original bug discarded.
    const r = findBalancedObjects(
      '{"name":"create_sandbox_project","arguments":{"name":"Tic Tac Toe","language":"javascript"}}',
    );
    expect(r).toHaveLength(1);
    expect(JSON.parse(r[0].span)).toEqual({
      name: "create_sandbox_project",
      arguments: { name: "Tic Tac Toe", language: "javascript" },
    });
  });
});

describe("extractInlineToolCalls", () => {
  it("returns undefined when no candidates parse", () => {
    expect(extractInlineToolCalls("just a chat reply", tools)).toBeUndefined();
  });
  it("recovers a fenced JSON tool call", () => {
    const content =
      'sure!\n```json\n{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}\n```\n';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(1);
    expect(calls?.[0].name).toBe("create_sandbox_project");
    expect(JSON.parse(calls![0].arguments)).toEqual({
      name: "X",
      language: "javascript",
    });
  });
  it("recovers a bare-object tool call with nested arguments", () => {
    const content =
      '{"name":"create_sandbox_project","arguments":{"name":"Tic Tac Toe","language":"javascript"}}';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(1);
    expect(calls?.[0].name).toBe("create_sandbox_project");
  });
  it("rejects calls for unknown tool names", () => {
    const content = '{"name":"does_not_exist","arguments":{}}';
    expect(extractInlineToolCalls(content, tools)).toBeUndefined();
  });
  it("dedups when same payload appears as both fence + bare", () => {
    // Some models emit the SAME tool call inside a fence AND as
    // a bare object on the same response. The extractor should
    // only return one call.
    const content =
      '```json\n{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}\n```\n' +
      'and {"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(1);
  });
  it("handles `args` (some models use args instead of arguments)", () => {
    const content =
      '{"name":"create_sandbox_project","args":{"name":"X","language":"javascript"}}';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls![0].arguments)).toEqual({
      name: "X",
      language: "javascript",
    });
  });
  it("extracts multiple distinct tool calls in one response", () => {
    const content =
      '{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}} then {"name":"run_sandbox_project","arguments":{"projectId":"x"}}';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(2);
    expect(calls?.map((c) => c.name)).toEqual([
      "create_sandbox_project",
      "run_sandbox_project",
    ]);
  });
});

describe("stripInlineToolCallJson", () => {
  it("leaves non-tool-call text alone", () => {
    expect(stripInlineToolCallJson("hello world")).toBe("hello world");
  });
  it("removes a fenced tool-call block", () => {
    const content =
      'will do!\n```json\n{"name":"create_sandbox_project","arguments":{}}\n```\nready.';
    expect(stripInlineToolCallJson(content)).toBe("will do!\n\nready.");
  });
  it("removes a bare tool-call object with nested args", () => {
    const content =
      'preface {"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}} epilogue';
    expect(stripInlineToolCallJson(content)).toBe("preface  epilogue");
  });
  it("preserves legitimate JSON file content in fences", () => {
    // package.json-shaped content has more than name+arguments
    // so it isn't a tool-call payload.
    const content =
      '```json:package.json\n{"name":"x","version":"1.0.0"}\n```';
    expect(stripInlineToolCallJson(content)).toContain('"version"');
  });
});

describe("looksLikeToolCallPayload", () => {
  it("detects a tiny tool-call payload", () => {
    expect(
      looksLikeToolCallPayload('{"name":"x","arguments":{"k":"v"}}'),
    ).toBe(true);
  });
  it("rejects oversize JSON that happens to have name", () => {
    // package.json with name + lots of other fields = legit file
    const huge = JSON.stringify({
      name: "pkg",
      version: "1.0.0",
      dependencies: { a: "1", b: "2", c: "3", d: "4", e: "5" },
      scripts: { build: "tsc", lint: "eslint", test: "vitest" },
      description: "A description that pushes us past 500 chars".repeat(20),
    });
    expect(looksLikeToolCallPayload(huge)).toBe(false);
  });
  it("rejects strings that aren't JSON objects", () => {
    expect(looksLikeToolCallPayload("not json")).toBe(false);
    expect(looksLikeToolCallPayload("[1, 2, 3]")).toBe(false);
  });
});

describe("parseFencedBlocks", () => {
  it("parses a single closed block with lang:path", () => {
    const r = parseFencedBlocks(
      "intro\n```jsx:src/App.jsx\nexport default function App() {}\n```\nrest",
    );
    expect(r).toHaveLength(1);
    expect(r[0].lang).toBe("jsx");
    expect(r[0].path).toBe("src/App.jsx");
    expect(r[0].content).toBe("export default function App() {}");
    expect(r[0].closed).toBe(true);
  });
  it("emits an open block when the close hasn't arrived", () => {
    const r = parseFencedBlocks("```ts:main.ts\nconst x = 1;\nconst y");
    expect(r).toHaveLength(1);
    expect(r[0].closed).toBe(false);
    expect(r[0].content).toBe("const x = 1;\nconst y");
  });
  it("rejects fenced blocks whose body is a tool-call payload", () => {
    const r = parseFencedBlocks(
      '```jsx:src/App.jsx\n{"name":"create_sandbox_project","arguments":{"name":"X"}}\n```',
    );
    expect(r).toEqual([]);
  });
  it("handles multiple files in one response", () => {
    const content = [
      "```ts:src/a.ts",
      "export const a = 1;",
      "```",
      "",
      "```ts:src/b.ts",
      "export const b = 2;",
      "```",
    ].join("\n");
    const r = parseFencedBlocks(content);
    expect(r.map((b) => b.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("splitInfoString", () => {
  it("parses jsx:path form", () => {
    expect(splitInfoString("jsx:src/App.jsx")).toEqual({
      lang: "jsx",
      path: "src/App.jsx",
    });
  });
  it("parses space-delimited form", () => {
    expect(splitInfoString("jsx src/App.jsx")).toEqual({
      lang: "jsx",
      path: "src/App.jsx",
    });
  });
  it("parses bare lang", () => {
    expect(splitInfoString("ts")).toEqual({ lang: "ts", path: null });
  });
  it("detects a path-as-lang (token contains / or has a long extension)", () => {
    expect(splitInfoString("src/App.jsx")).toEqual({
      lang: "",
      path: "src/App.jsx",
    });
  });
  it("returns empty for an empty info string", () => {
    expect(splitInfoString("")).toEqual({ lang: "", path: null });
  });
});
