/// Step-2 of the AI↔sandbox rewrite: the streaming fence parser must
/// NEVER turn an emulated model's tool-call text into a file path, but
/// must KEEP accepting every legit `lang:path` fence. This is the core
/// safety net — the screenshot's junk projects came from exactly these
/// mis-parses.

import { describe, expect, it } from "vitest";
import {
  looksLikeToolCallPayload,
  parseFencedBlocks,
  splitInfoString,
} from "@/lib/aiAgent/streaming";

describe("splitInfoString — keeps legit fences", () => {
  const legit: Array<[string, string]> = [
    ["jsx:src/App.jsx", "src/App.jsx"],
    ["jsx src/App.jsx", "src/App.jsx"],
    ["src/App.jsx", "src/App.jsx"],
    ["python:main.py", "main.py"],
    ["App.svelte", "App.svelte"],
    ["rust:src/main.rs", "src/main.rs"],
    ["ts components/Card.tsx", "components/Card.tsx"],
    // Short bare filenames must NOT be dropped (regression #2).
    ["a.js", "a.js"],
    ["x.py", "x.py"],
    [".env", ".env"],
    ["b.c", "b.c"],
  ];
  it.each(legit)("info %j → path %j", (info, path) => {
    expect(splitInfoString(info).path).toBe(path);
  });
  it("a bare language is not a path", () => {
    expect(splitInfoString("js").path).toBeNull();
    expect(splitInfoString("javascript").path).toBeNull();
  });
});

describe("splitInfoString — rejects tool-call / JSON junk as paths", () => {
  const junk = [
    '"name": "create_sandbox_project",',
    '"arguments": {',
    'json {"name":"create_sandbox_project","arguments":{}}',
    '"create_sandbox_project", "argu',
    '{"name": "x"}',
    "tool_code create_sandbox_project(",
    // A tool-call wrapper lang must NOT promote a plausible-looking
    // path that follows it (regression #3).
    "tool_code create.py",
    "tool_call:main.py",
  ];
  it.each(junk)("info %j → path null", (info) => {
    expect(splitInfoString(info).path).toBeNull();
  });
});

describe("looksLikeToolCallPayload", () => {
  it("rejects ordinary code (not a {name,arguments} object)", () => {
    expect(looksLikeToolCallPayload("function App() { return null; }")).toBe(false);
    expect(looksLikeToolCallPayload("const x = 1;")).toBe(false);
    expect(looksLikeToolCallPayload('{ "compilerOptions": { "strict": true } }')).toBe(false);
  });

  it("catches a small inline tool call", () => {
    expect(
      looksLikeToolCallPayload('{"name":"create_sandbox_project","arguments":{"name":"X"}}'),
    ).toBe(true);
  });

  it("catches a LARGE inline-files create (no length cap — the 619-char case)", () => {
    const big = JSON.stringify({
      name: "create_sandbox_project",
      arguments: {
        name: "Blackjack",
        language: "react",
        files: Array.from({ length: 6 }, (_, i) => ({
          path: `src/Component${i}.jsx`,
          content: "export default function C() { return <div/>; }\n".repeat(4),
        })),
      },
    });
    expect(big.length).toBeGreaterThan(500);
    expect(looksLikeToolCallPayload(big)).toBe(true);
  });

  it("catches CLOSED XML-wrapper tool calls", () => {
    expect(looksLikeToolCallPayload('<tool_call>{"name":"x","arguments":{}}</tool_call>')).toBe(true);
    expect(looksLikeToolCallPayload('<tools>{"name":"x","arguments":{}}</tools>')).toBe(true);
  });

  it("does NOT drop a real XML/SVG/config file that merely starts with <tools>/<tool> (regression #1)", () => {
    expect(looksLikeToolCallPayload('<tools>\n  <tool name="eslint"/>\n</tools>')).toBe(false);
    expect(looksLikeToolCallPayload("<tool>some config</tool>")).toBe(false);
    expect(looksLikeToolCallPayload("<svg><rect/></svg>")).toBe(false);
    // An unterminated tool wrapper isn't treated as a payload here
    // (the loop's extractXmlToolCalls handles genuine wrappers).
    expect(looksLikeToolCallPayload('<function_call>{}')).toBe(false);
  });
});

describe("parseFencedBlocks — end-to-end junk rejection", () => {
  it("does NOT emit a write for a fence whose info is tool-call JSON", () => {
    // The exact failure: a ```json fence wrapping a create_sandbox_project call.
    const content =
      '```json\n{"name":"create_sandbox_project","arguments":{"name":"Blackjack","language":"react"}}\n```';
    const blocks = parseFencedBlocks(content);
    // Either no block, or a block with a null path (never a junk path).
    expect(blocks.every((b) => b.path === null)).toBe(true);
  });

  it("still emits a real file fence", () => {
    const content = "```jsx:src/App.jsx\nexport default function App(){}\n```";
    const blocks = parseFencedBlocks(content);
    const real = blocks.find((b) => b.path === "src/App.jsx");
    expect(real).toBeTruthy();
    expect(real!.content).toContain("export default");
  });
});
