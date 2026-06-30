/// Adversarial scenarios — pin down the exact bad-model behaviour
/// we expect to handle. Each test is named after the failure mode
/// it prevents.
///
/// We aim for behavioural assertions rather than implementation
/// ones — "the file got written" matters more than "this internal
/// regex matched". When the model drifts and the agent recovers
/// gracefully, the test passes; when the model drifts and the
/// recovery is broken, the test fails.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";
import {
  extractInlineToolCalls,
  parseFencedBlocks,
  stripInlineToolCallJson,
  looseJsonParse,
} from "@/lib/aiAgent/streaming";
import { parseConfidence } from "@/lib/aiAgent/confidence";

const tools: ToolDef[] = [
  {
    name: "create_sandbox_project",
    description: "",
    parameters: { type: "object", properties: {} },
    auto: false,
    async handler() {
      return { ok: true, projectId: "p1" };
    },
  },
  {
    name: "run_sandbox_project",
    description: "",
    parameters: { type: "object", properties: {} },
    auto: false,
    async handler() {
      return { ok: true };
    },
  },
];

function scriptedTransport(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send() {
      const turn = turns[i++];
      if (!turn) throw new Error("script underrun");
      return turn;
    },
  };
}

describe("model emits malformed JSON in tool arguments", () => {
  it("recovers from trailing commas", () => {
    const r = looseJsonParse('{"a": 1, "b": 2,}');
    expect(r).toEqual({ a: 1, b: 2 });
  });
  it("recovers from single quotes", () => {
    const r = looseJsonParse("{'a': 'value'}");
    expect(r).toEqual({ a: "value" });
  });
});

describe("model wraps tool call in path-tagged fence (corruption attempt)", () => {
  it("file writer rejects the fenced tool call", () => {
    const blocks = parseFencedBlocks(
      '```jsx:src/App.jsx\n{"name":"create_sandbox_project","arguments":{}}\n```',
    );
    expect(blocks).toEqual([]);
  });
  it("inline extractor still recovers the tool call", () => {
    const calls = extractInlineToolCalls(
      '```jsx:src/App.jsx\n{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}\n```',
      tools,
    );
    expect(calls).toHaveLength(1);
    expect(calls?.[0].name).toBe("create_sandbox_project");
  });
});

describe("model emits multiple tool calls inline", () => {
  it("extractor returns each distinct call", () => {
    const content =
      'first: {"name":"create_sandbox_project","arguments":{"name":"a","language":"javascript"}}\n' +
      'second: {"name":"run_sandbox_project","arguments":{"projectId":"a"}}';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(2);
    expect(calls?.map((c) => c.name)).toEqual([
      "create_sandbox_project",
      "run_sandbox_project",
    ]);
  });
});

describe("model emits a confidence tag inside its tool-call content", () => {
  // Edge case: model wraps the confidence tag inside the same
  // sentence as a tool-call invocation. The strip should remove
  // BOTH the tool call AND the tag from the visible content.
  it("strips both the tool call AND the confidence tag", () => {
    const content =
      'sure, going now {"name":"create_sandbox_project","arguments":{}} <confidence>0.7</confidence>';
    const stripped = stripInlineToolCallJson(content);
    const conf = parseConfidence(stripped);
    expect(conf.confidence).toBeCloseTo(0.7, 5);
    expect(conf.cleaned).toBe("sure, going now");
  });
});

describe("agent encounters partial fenced block mid-stream", () => {
  it("emits an open block (closed: false) for in-flight content", () => {
    const blocks = parseFencedBlocks("```ts:main.ts\nconst x = ");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closed).toBe(false);
  });
  it("flips to closed when the close fence arrives", () => {
    const blocks = parseFencedBlocks("```ts:main.ts\nconst x = 1;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closed).toBe(true);
    expect(blocks[0].content).toBe("const x = 1;");
  });
});

describe("model emits a long monologue between turns", () => {
  it("agent loop doesn't lose track of the assistant message", async () => {
    const longText = "Here's what I'm going to do: ".repeat(50);
    const transport = scriptedTransport([
      {
        content: longText,
        toolCalls: [
          {
            id: "c1",
            name: "create_sandbox_project",
            arguments: JSON.stringify({
              name: "X",
              language: "javascript",
            }),
          },
        ],
      },
      { content: "Done.\n<confidence>0.85</confidence>" },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "go",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
      // Isolates monologue handling — the post-create stall would
      // otherwise trigger an auto-continue nudge.
      autoContinue: false,
    });
    expect(result.endedBy).toBe("terminal");
    // Assistant message from turn 1 should retain the long text.
    const turn1Assistant = result.messages.filter(
      (m) => m.role === "assistant",
    )[0];
    if (turn1Assistant && turn1Assistant.role === "assistant") {
      expect(turn1Assistant.content).toContain("Here's what I'm going to do");
    }
  });
});

describe("model emits args as object instead of string", () => {
  it("extractor handles object-shape arguments", () => {
    // The Ollama transport stringifies; the extractor's path
    // should produce a string regardless.
    const content =
      '{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}';
    const calls = extractInlineToolCalls(content, tools);
    expect(calls).toHaveLength(1);
    expect(typeof calls?.[0].arguments).toBe("string");
    expect(JSON.parse(calls![0].arguments)).toEqual({
      name: "X",
      language: "javascript",
    });
  });
});

describe("model emits args using 'args' key (some checkpoints)", () => {
  it("extractor accepts both arguments and args", () => {
    const c1 = extractInlineToolCalls(
      '{"name":"create_sandbox_project","args":{"name":"X","language":"javascript"}}',
      tools,
    );
    expect(c1).toHaveLength(1);
  });
});

describe("agent receives back-to-back identical turns from a flaky model", () => {
  // The CONSECUTIVE-same-call detector should bite at the right
  // moment — not too early (legitimate retries with different
  // signatures are OK) and not too late (we lose all turn budget).
  it("does not bite when signatures differ between retries", async () => {
    let calls = 0;
    const turns: AgentTurnResponse[] = [
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "ping",
            arguments: JSON.stringify({ q: "A" }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c2",
            name: "ping",
            arguments: JSON.stringify({ q: "B" }),
          },
        ],
      },
      { content: "ok." },
    ];
    const transport = scriptedTransport(turns);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [
        {
          name: "ping",
          description: "",
          parameters: { type: "object", properties: {} },
          auto: true,
          async handler() {
            calls += 1;
            return { ok: true };
          },
        },
      ],
      userPrompt: "do",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
      maxSameCallRetries: 3,
    });
    // Both calls ran — different args means they aren't "repeated".
    expect(calls).toBe(2);
  });
});

describe("agent loop with no tools available", () => {
  it("a model that asks for an unknown tool gets a clean error result", async () => {
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "ghost_tool", arguments: "{}" }],
      },
      { content: "sorry." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [], // none
      userPrompt: "do anything",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    const toolMsg = result.messages.find((m) => m.role === "tool") as Extract<
      (typeof result.messages)[number],
      { role: "tool" }
    >;
    expect(toolMsg.content).toContain("Unknown tool");
  });
});

describe("usage tracking when the transport omits the field", () => {
  it("treats missing usage as zeros (defensive)", async () => {
    const transport = scriptedTransport([
      { content: "ok.\n<confidence>0.9</confidence>" /* no usage */ },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "x",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    // turns counted because we ran one turn, even though token
    // counts came back as nothing.
    expect(result.usage.turns).toBe(0);
    // Wait — usage accumulator only fires when response.usage is
    // set. If undefined, the accumulator never runs, so turns
    // stays 0. That's intentional: we accumulate only what we
    // KNOW. The hook tracks total turns separately via the
    // message log. This assertion documents the contract.
  });
});

describe("confidence-driven pause on destructive tool", () => {
  it("gates a destructive (non-auto) tool when confidence is low", async () => {
    let approvalCalls = 0;
    const transport = scriptedTransport([
      {
        content: "<confidence>0.3</confidence>",
        toolCalls: [
          {
            id: "c1",
            name: "destructive",
            arguments: "{}",
          },
        ],
      },
      { content: "ok." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [
        {
          name: "destructive",
          description: "",
          parameters: { type: "object", properties: {} },
          auto: false, // gated by default
          async handler() {
            return { ok: true };
          },
        },
      ],
      userPrompt: "do scary",
      transport,
      hooks: {
        approveToolCall: async () => {
          approvalCalls += 1;
          return "approved";
        },
      },
      maxTurns: 20,
    });
    expect(approvalCalls).toBe(1);
  });
});
