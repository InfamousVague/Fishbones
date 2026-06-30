/// End-to-end scenarios. These compose the full pipeline:
/// transport + loop + tool dispatch + confidence parsing +
/// usage tracking + clarification routing. Each test mirrors a
/// real user request and walks through the model's expected
/// turns.
///
/// They're the high-confidence "the agent actually works for
/// this case" tests — when one fails, something user-visible
/// broke.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";

function scriptedTransport(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send() {
      const turn = turns[i];
      if (!turn) {
        throw new Error(
          `transport asked for turn ${i + 1}; only ${turns.length} scripted`,
        );
      }
      i += 1;
      return turn;
    },
  };
}

function tool(name: string, opts?: Partial<ToolDef>): ToolDef {
  return {
    name,
    description: "",
    parameters: { type: "object", properties: {} },
    auto: true,
    async handler() {
      return { ok: true };
    },
    ...opts,
  };
}

describe("scenario: build tic-tac-toe", () => {
  it("creates project, writes files, runs, succeeds", async () => {
    const files: Record<string, string> = {};
    let projectId = "";
    let runResult: { ok: boolean; logs: unknown[] } | null = null;
    const tools: ToolDef[] = [
      tool("create_sandbox_project", {
        auto: false,
        async handler(args: { name: string; language: string }) {
          projectId = `${args.name.toLowerCase().replace(/ /g, "-")}-1`;
          return { ok: true, projectId, language: args.language };
        },
      }),
      tool("write_sandbox_file", {
        auto: false,
        async handler(args: {
          projectId: string;
          path: string;
          content: string;
        }) {
          files[args.path] = args.content;
          return { ok: true };
        },
      }),
      tool("run_sandbox_project", {
        auto: false,
        async handler() {
          runResult = { ok: true, logs: [] };
          return { ok: true, logs: [] };
        },
      }),
    ];
    const turns: AgentTurnResponse[] = [
      {
        // Turn 1: create project
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "create_sandbox_project",
            arguments: JSON.stringify({
              name: "Tic Tac Toe",
              language: "javascript",
            }),
          },
        ],
      },
      {
        // Turn 2: write files (3 of them, all in one turn)
        content: "",
        toolCalls: [
          {
            id: "c2",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "tic-tac-toe-1",
              path: "index.html",
              content: "<html></html>",
            }),
          },
          {
            id: "c3",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "tic-tac-toe-1",
              path: "main.js",
              content: "console.log('tic')",
            }),
          },
          {
            id: "c4",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "tic-tac-toe-1",
              path: "style.css",
              content: "body{}",
            }),
          },
        ],
      },
      {
        // Turn 3: run
        content: "",
        toolCalls: [
          {
            id: "c5",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "tic-tac-toe-1" }),
          },
        ],
      },
      {
        // Turn 4: final reply with confidence
        content: "Done! Tic-tac-toe is ready.\n<confidence>0.92</confidence>",
      },
    ];
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "you build things",
      model: "test",
      tools,
      userPrompt: "build me a tic-tac-toe game",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    expect(result.endedBy).toBe("terminal");
    expect(projectId).toBe("tic-tac-toe-1");
    expect(Object.keys(files)).toEqual(["index.html", "main.js", "style.css"]);
    expect(runResult).toEqual({ ok: true, logs: [] });
    expect(result.finalConfidence).toBeCloseTo(0.92, 5);
    // Verify the cleaned final reply doesn't carry the confidence tag.
    const last = result.messages[result.messages.length - 1];
    if (last.role === "assistant") {
      expect(last.content).toBe("Done! Tic-tac-toe is ready.");
      expect(last.content).not.toContain("<confidence>");
    }
  });

  it("auto-verify loop: run fails, agent patches, re-runs, succeeds", async () => {
    let runCount = 0;
    const tools: ToolDef[] = [
      tool("create_sandbox_project", {
        auto: false,
        async handler() {
          return { ok: true, projectId: "p1" };
        },
      }),
      tool("write_sandbox_file", {
        auto: false,
        async handler() {
          return { ok: true };
        },
      }),
      tool("apply_sandbox_patch", {
        auto: false,
        async handler() {
          return { ok: true };
        },
      }),
      tool("run_sandbox_project", {
        auto: false,
        async handler() {
          runCount += 1;
          if (runCount === 1) {
            return {
              ok: false,
              error: "ReferenceError: useState is not defined",
              logs: [],
            };
          }
          return { ok: true, logs: [] };
        },
      }),
    ];
    const turns: AgentTurnResponse[] = [
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "create_sandbox_project",
            arguments: JSON.stringify({ name: "X", language: "react" }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c2",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "p1",
              path: "src/App.jsx",
              content: "...",
            }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c3",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "p1" }),
          },
        ],
      },
      {
        content: "Looks like useState wasn't imported. Patching now.",
        toolCalls: [
          {
            id: "c4",
            name: "apply_sandbox_patch",
            arguments: JSON.stringify({
              projectId: "p1",
              edits: [{ path: "src/App.jsx", op: "set", content: "fixed" }],
            }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c5",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "p1" }),
          },
        ],
      },
      { content: "Fixed and running cleanly.\n<confidence>0.85</confidence>" },
    ];
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build a React app",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    expect(runCount).toBe(2);
    expect(result.endedBy).toBe("terminal");
    // Verify the tool timeline shows the run failed then succeeded.
    const runEntries = result.timeline.filter(
      (e) => e.name === "run_sandbox_project",
    );
    expect(runEntries).toHaveLength(2);
    expect(runEntries[0].ok).toBe(false);
    expect(runEntries[1].ok).toBe(true);
  });
});

describe("scenario: clarification flow", () => {
  it("pauses to ask user, then continues with the answer", async () => {
    let createCalls: Array<{ language: string }> = [];
    const tools: ToolDef[] = [
      tool("request_user_input", { auto: true }),
      tool("create_sandbox_project", {
        auto: false,
        async handler(args: { name: string; language: string }) {
          createCalls.push({ language: args.language });
          return { ok: true, projectId: "p1", language: args.language };
        },
      }),
    ];
    const turns: AgentTurnResponse[] = [
      {
        // Turn 1: agent asks which language.
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "request_user_input",
            arguments: JSON.stringify({
              question: "TypeScript or JavaScript?",
              context: "You said 'build an API'; both are common for that.",
            }),
          },
        ],
      },
      {
        // Turn 2: agent reads the answer + creates.
        content: "",
        toolCalls: [
          {
            id: "c2",
            name: "create_sandbox_project",
            arguments: JSON.stringify({
              name: "API",
              language: "typescript",
            }),
          },
        ],
      },
      { content: "Created.\n<confidence>0.88</confidence>" },
    ];
    const transport = scriptedTransport(turns);
    let askedQuestion: string | null = null;
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build an API",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        async requestClarification(question) {
          askedQuestion = question;
          return "TypeScript";
        },
      },
      maxTurns: 20,
      // Isolates the clarification flow — the scripted run ends
      // right after create, which would otherwise nudge.
      autoContinue: false,
    });
    expect(askedQuestion).toBe("TypeScript or JavaScript?");
    expect(createCalls).toEqual([{ language: "typescript" }]);
    expect(result.endedBy).toBe("terminal");
  });

  it("propagates user cancellation as a tool error", async () => {
    const tools: ToolDef[] = [
      tool("request_user_input", { auto: true }),
    ];
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "request_user_input",
            arguments: JSON.stringify({ question: "X or Y?" }),
          },
        ],
      },
      { content: "OK, I'll pick X." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build it",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        async requestClarification() {
          throw new Error("user cancelled");
        },
      },
      maxTurns: 20,
    });
    // The cancellation should appear as a tool error message
    // the model reads to decide how to proceed.
    const toolMsgs = result.messages.filter(
      (m): m is Extract<typeof m, { role: "tool" }> => m.role === "tool",
    );
    const cancelEntry = toolMsgs.find((m) =>
      m.content.includes("cancelled"),
    );
    expect(cancelEntry).toBeDefined();
  });
});

describe("scenario: confidence-driven elevation", () => {
  it("pauses an auto tool when confidence is low", async () => {
    let approvalCount = 0;
    const tools: ToolDef[] = [
      tool("list_courses", { auto: true }), // normally auto
    ];
    const transport = scriptedTransport([
      {
        content: "<confidence>0.3</confidence>",
        toolCalls: [
          { id: "c1", name: "list_courses", arguments: "{}" },
        ],
      },
      { content: "OK." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "look around",
      transport,
      hooks: {
        approveToolCall: async () => {
          approvalCount += 1;
          return "approved";
        },
      },
      maxTurns: 20,
    });
    expect(approvalCount).toBe(1);
  });

  it("doesn't pause auto tools when confidence is high", async () => {
    let approvalCount = 0;
    const tools: ToolDef[] = [tool("list_courses", { auto: true })];
    const transport = scriptedTransport([
      {
        content: "<confidence>0.9</confidence>",
        toolCalls: [
          { id: "c1", name: "list_courses", arguments: "{}" },
        ],
      },
      { content: "Done." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "look around",
      transport,
      hooks: {
        approveToolCall: async () => {
          approvalCount += 1;
          return "approved";
        },
      },
      maxTurns: 20,
    });
    expect(approvalCount).toBe(0);
  });
});

describe("scenario: multi-file stream parsing", () => {
  it("strips a model that emits a fence-wrapped tool call AND a real file fence", async () => {
    // Scenario: model emits a tool call wrapped in a path-tagged fence
    // (mistake) AND a real file fence. The inline-extractor should
    // catch the tool call; the stream writer should refuse to write
    // the tool-call body into the file. We assert via the agent loop
    // that the tool runs.
    let toolRan = false;
    const tools: ToolDef[] = [
      tool("create_sandbox_project", {
        auto: false,
        async handler() {
          toolRan = true;
          return { ok: true, projectId: "p1" };
        },
      }),
    ];
    const transport = scriptedTransport([
      {
        content:
          'Sure!\n```jsx:src/App.jsx\n{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}\n```\nGoing now.',
      },
      { content: "Done." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "make X",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    expect(toolRan).toBe(true);
  });
});

describe("scenario: stuck retries trigger a halt message", () => {
  it("model retries identical args 3+ times → 4th retry returns the halt error", async () => {
    let handlerCalls = 0;
    const tools: ToolDef[] = [
      tool("flaky", {
        auto: true,
        async handler() {
          handlerCalls += 1;
          return { error: true, message: "always fails" };
        },
      }),
    ];
    const sameCall = {
      id: "c",
      name: "flaky",
      arguments: JSON.stringify({ key: "value" }),
    };
    const turns: AgentTurnResponse[] = [
      { content: "", toolCalls: [{ ...sameCall, id: "c1" }] },
      { content: "", toolCalls: [{ ...sameCall, id: "c2" }] },
      { content: "", toolCalls: [{ ...sameCall, id: "c3" }] },
      { content: "", toolCalls: [{ ...sameCall, id: "c4" }] },
      { content: "I'll stop." },
    ];
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "do flaky",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
      maxSameCallRetries: 3,
    });
    // Handler should have been called 3 times — the 4th time the
    // loop short-circuits with the halt message.
    expect(handlerCalls).toBe(3);
    // The 4th tool-call result should include the halt message.
    const lastToolResult = result.timeline[result.timeline.length - 1];
    expect(lastToolResult.content).toContain("Stop repeating");
  });
});
