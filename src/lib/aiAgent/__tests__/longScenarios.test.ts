/// Long-form scenarios. These walk through realistic multi-turn
/// builds that span many turns and exercise tool registry ↔ loop
/// state machine ↔ confidence ↔ usage all together.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";

function scriptedTransport(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send() {
      const t = turns[i++];
      if (!t) throw new Error("script underrun");
      return t;
    },
  };
}

describe("scenario: 8-turn React build with auto-verify loop", () => {
  it("creates, writes 4 files, runs (fails), patches, runs (fails again), patches again, runs (succeeds)", async () => {
    const files: Record<string, string> = {};
    let runCount = 0;
    const tools: ToolDef[] = [
      {
        name: "create_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler(args: { name: string; language: string }) {
          return { ok: true, projectId: "react-todo-1", language: args.language };
        },
      },
      {
        name: "write_sandbox_file",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler(args: { path: string; content: string }) {
          files[args.path] = args.content;
          return { ok: true };
        },
      },
      {
        name: "apply_sandbox_patch",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler(args: {
          edits: Array<{ path: string; content: string }>;
        }) {
          for (const e of args.edits) files[e.path] = e.content;
          return { ok: true };
        },
      },
      {
        name: "run_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
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
          if (runCount === 2) {
            return {
              ok: false,
              error: "TypeError: Cannot read property map of undefined",
              logs: [],
            };
          }
          return { ok: true, logs: [], previewUrl: "http://localhost:1420/x" };
        },
      },
    ];

    const turns: AgentTurnResponse[] = [
      // 1. Create project
      {
        content: "",
        toolCalls: [
          {
            id: "1",
            name: "create_sandbox_project",
            arguments: JSON.stringify({
              name: "React Todo",
              language: "react",
            }),
          },
        ],
        usage: { promptTokens: 200, completionTokens: 40, durationMs: 400 },
      },
      // 2. Write 4 files in parallel
      {
        content: "Writing files now.",
        toolCalls: [
          {
            id: "2a",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "react-todo-1",
              path: "src/App.jsx",
              content: "/* app */",
            }),
          },
          {
            id: "2b",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "react-todo-1",
              path: "src/components/TodoList.jsx",
              content: "/* list */",
            }),
          },
          {
            id: "2c",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "react-todo-1",
              path: "src/components/TodoItem.jsx",
              content: "/* item */",
            }),
          },
          {
            id: "2d",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "react-todo-1",
              path: "src/lib/store.js",
              content: "/* store */",
            }),
          },
        ],
        usage: { promptTokens: 250, completionTokens: 80, durationMs: 500 },
      },
      // 3. First run — fails
      {
        content: "",
        toolCalls: [
          {
            id: "3",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "react-todo-1" }),
          },
        ],
        usage: { promptTokens: 280, completionTokens: 30, durationMs: 450 },
      },
      // 4. Patch
      {
        content: "useState wasn't imported — patching.",
        toolCalls: [
          {
            id: "4",
            name: "apply_sandbox_patch",
            arguments: JSON.stringify({
              projectId: "react-todo-1",
              edits: [
                {
                  path: "src/App.jsx",
                  content: "/* app fixed */",
                },
              ],
            }),
          },
        ],
        usage: { promptTokens: 310, completionTokens: 45, durationMs: 500 },
      },
      // 5. Second run — different error
      {
        content: "",
        toolCalls: [
          {
            id: "5",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "react-todo-1" }),
          },
        ],
        usage: { promptTokens: 320, completionTokens: 30, durationMs: 400 },
      },
      // 6. Patch again
      {
        content: "Map-of-undefined — guarding the initial render.",
        toolCalls: [
          {
            id: "6",
            name: "apply_sandbox_patch",
            arguments: JSON.stringify({
              projectId: "react-todo-1",
              edits: [
                {
                  path: "src/components/TodoList.jsx",
                  content: "/* list fixed */",
                },
              ],
            }),
          },
        ],
        usage: { promptTokens: 350, completionTokens: 50, durationMs: 480 },
      },
      // 7. Third run — passes
      {
        content: "",
        toolCalls: [
          {
            id: "7",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "react-todo-1" }),
          },
        ],
        usage: { promptTokens: 380, completionTokens: 30, durationMs: 420 },
      },
      // 8. Final summary
      {
        content:
          "Built and running. Files: App.jsx mounts, components/TodoList.jsx, components/TodoItem.jsx, lib/store.js.\n<confidence>0.92</confidence>",
        usage: { promptTokens: 410, completionTokens: 90, durationMs: 550 },
      },
    ];

    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "build react apps",
      model: "test",
      tools,
      userPrompt: "build me a React todo app",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });

    // All 4 files plus the patches landed.
    expect(Object.keys(files).sort()).toEqual([
      "src/App.jsx",
      "src/components/TodoItem.jsx",
      "src/components/TodoList.jsx",
      "src/lib/store.js",
    ]);
    // 3 runs total (2 failures, 1 success).
    expect(runCount).toBe(3);
    // Usage accumulated across all 8 turns.
    expect(result.usage.turns).toBe(8);
    expect(result.usage.promptTokens).toBe(
      200 + 250 + 280 + 310 + 320 + 350 + 380 + 410,
    );
    expect(result.usage.completionTokens).toBe(
      40 + 80 + 30 + 45 + 30 + 50 + 30 + 90,
    );
    // Final confidence is 0.92.
    expect(result.finalConfidence).toBeCloseTo(0.92, 5);
    // Tool timeline has every dispatch (1 create + 4 writes + 3 runs + 2 patches).
    expect(result.timeline).toHaveLength(10);
    // Run results — first two failed, third succeeded.
    const runs = result.timeline.filter((e) => e.name === "run_sandbox_project");
    expect(runs.map((r) => r.ok)).toEqual([false, false, true]);
  });
});

describe("scenario: agent asks user mid-build, then resumes", () => {
  it("creates, asks for theme color, gets answer, applies, runs, succeeds", async () => {
    let colorUsed = "";
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
        name: "request_user_input",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return null;
        },
      },
      {
        name: "write_sandbox_file",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler(args: { content: string }) {
          // Look for the color in the content.
          const match = /background:\s*([a-zA-Z]+)/.exec(args.content);
          if (match) colorUsed = match[1];
          return { ok: true };
        },
      },
      {
        name: "run_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler() {
          return { ok: true, logs: [] };
        },
      },
    ];

    const turns: AgentTurnResponse[] = [
      // Turn 1: create
      {
        content: "",
        toolCalls: [
          {
            id: "1",
            name: "create_sandbox_project",
            arguments: JSON.stringify({ name: "Site", language: "web" }),
          },
        ],
      },
      // Turn 2: ask
      {
        content: "<confidence>0.5</confidence>",
        toolCalls: [
          {
            id: "2",
            name: "request_user_input",
            arguments: JSON.stringify({
              question: "What background color?",
              context: "You didn't specify; default would be white.",
            }),
          },
        ],
      },
      // Turn 3: act on the answer
      {
        content: "Got it, using teal.",
        toolCalls: [
          {
            id: "3",
            name: "write_sandbox_file",
            arguments: JSON.stringify({
              projectId: "p1",
              path: "style.css",
              content: "body { background: teal; }",
            }),
          },
        ],
      },
      // Turn 4: run
      {
        content: "",
        toolCalls: [
          {
            id: "4",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "p1" }),
          },
        ],
      },
      // Turn 5: done
      {
        content: "Teal background applied. Site is live.\n<confidence>0.9</confidence>",
      },
    ];

    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build me a one-page site",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        async requestClarification(question, context) {
          expect(question).toBe("What background color?");
          expect(context).toContain("default would be white");
          return "teal";
        },
      },
      maxTurns: 20,
    });

    expect(colorUsed).toBe("teal");
    expect(result.endedBy).toBe("terminal");
    expect(result.finalConfidence).toBeCloseTo(0.9, 5);
  });
});

describe("scenario: agent gives up cleanly when retries exhaust", () => {
  it("after 3 consecutive same-call retries, the next call gets the halt message", async () => {
    let handlerCalls = 0;
    const tools: ToolDef[] = [
      {
        name: "always_fails",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          handlerCalls += 1;
          return { ok: false, error: "always fails" };
        },
      },
    ];
    const callArgs = JSON.stringify({ x: 1 });
    const turns: AgentTurnResponse[] = [
      { content: "", toolCalls: [{ id: "1", name: "always_fails", arguments: callArgs }] },
      { content: "", toolCalls: [{ id: "2", name: "always_fails", arguments: callArgs }] },
      { content: "", toolCalls: [{ id: "3", name: "always_fails", arguments: callArgs }] },
      { content: "", toolCalls: [{ id: "4", name: "always_fails", arguments: callArgs }] },
      { content: "I'll stop now.\n<confidence>0.2</confidence>" },
    ];
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "do",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
      maxSameCallRetries: 3,
    });
    // Handler ran 3 times (turn 1, 2, 3). 4th was short-circuited.
    expect(handlerCalls).toBe(3);
    const lastTool = result.timeline[result.timeline.length - 1];
    expect(lastTool.content).toContain("Stop repeating");
    expect(result.endedBy).toBe("terminal");
    expect(result.finalConfidence).toBeCloseTo(0.2, 5);
  });
});

describe("scenario: tool denial during a build", () => {
  it("user denies destructive call, model reads the denial and pivots", async () => {
    const tools: ToolDef[] = [
      {
        name: "destructive",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false, // gated
        async handler() {
          return { ok: true };
        },
      },
      {
        name: "safe_alternative",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return { ok: true, result: "did the safe thing" };
        },
      },
    ];
    const turns: AgentTurnResponse[] = [
      // Turn 1: proposes destructive
      {
        content: "",
        toolCalls: [{ id: "1", name: "destructive", arguments: "{}" }],
      },
      // Turn 2: pivots to safe alternative
      {
        content: "Ah, you said no. Let me try the safe path.",
        toolCalls: [
          { id: "2", name: "safe_alternative", arguments: "{}" },
        ],
      },
      // Turn 3: done
      { content: "Did it the safe way.\n<confidence>0.85</confidence>" },
    ];
    let approvalCallCount = 0;
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "do the thing",
      transport,
      hooks: {
        approveToolCall: async (call) => {
          approvalCallCount += 1;
          // Deny the destructive call; let the safe one through.
          if (call.name === "destructive") return "denied";
          return "approved";
        },
      },
      maxTurns: 20,
    });
    // Two approval prompts: destructive (denied) + safe_alt was
    // auto so no prompt for it. Wait — safe_alternative is auto so
    // no approval. So approvalCallCount = 1.
    expect(approvalCallCount).toBe(1);
    // The denied call's tool result should explain the denial.
    const deniedResult = result.timeline.find(
      (t) => t.name === "destructive",
    );
    expect(deniedResult?.ok).toBe(false);
    expect(deniedResult?.content).toContain("User denied");
    expect(result.endedBy).toBe("terminal");
  });
});
