/// Fence→tool synthesis tests.
///
/// This is the third recovery layer in the agent loop — the one
/// that prevents the worst-behaved models from dumping a wall of
/// code into the chat with NO project ever being created. Each
/// test pins one shape of "model ignored tool channel + spilled
/// code at me".

import { describe, expect, it } from "vitest";
import {
  findExistingProjectId,
  synthesizeFromFences,
} from "@/lib/aiAgent/streaming";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";

const tools: ToolDef[] = [
  {
    name: "create_sandbox_project",
    description: "",
    parameters: { type: "object", properties: {} },
    auto: false,
    async handler() {
      return { ok: true, projectId: "p-synth-1" };
    },
  },
  {
    name: "write_sandbox_file",
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
      const t = turns[i++];
      if (!t) throw new Error("script underrun");
      return t;
    },
  };
}

describe("synthesizeFromFences (unit)", () => {
  it("returns null when there are no path-tagged fences", () => {
    const r = synthesizeFromFences(
      "just text and ```js\nbare\n``` blocks",
      tools,
      { existingProjectId: null },
    );
    expect(r).toBeNull();
  });

  it("synthesises a single create_sandbox_project call inlining all fences when no project exists", () => {
    const content = [
      "Here's your blackjack game:",
      "```jsx:src/App.jsx",
      "export default function App() {}",
      "```",
      "",
      "```css:src/style.css",
      "body { background: green; }",
      "```",
    ].join("\n");
    const r = synthesizeFromFences(content, tools, {
      existingProjectId: null,
      userPromptHint: "build me a blackjack game in React",
    });
    expect(r).not.toBeNull();
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
    const args = JSON.parse(r!.toolCalls[0].arguments) as {
      name: string;
      language: string;
      files: Array<{ path: string; content: string }>;
    };
    // Language inferred from .jsx / 'React' in prompt.
    expect(args.language).toBe("react");
    // Project name extracted from the prompt's content words.
    expect(args.name.toLowerCase()).toContain("blackjack");
    // Both files threaded through.
    expect(args.files).toHaveLength(2);
    expect(args.files.map((f) => f.path).sort()).toEqual([
      "src/App.jsx",
      "src/style.css",
    ]);
  });

  it("synthesises write_sandbox_file per fence when a project ALREADY exists", () => {
    const content = [
      "Here's the patch:",
      "```ts:src/main.ts",
      "console.log('updated');",
      "```",
      "",
      "```ts:src/util.ts",
      "export const u = 2;",
      "```",
    ].join("\n");
    const r = synthesizeFromFences(content, tools, {
      existingProjectId: "p-existing",
    });
    expect(r).not.toBeNull();
    expect(r!.toolCalls).toHaveLength(2);
    expect(r!.toolCalls.map((c) => c.name)).toEqual([
      "write_sandbox_file",
      "write_sandbox_file",
    ]);
    const a1 = JSON.parse(r!.toolCalls[0].arguments) as {
      projectId: string;
      path: string;
    };
    expect(a1.projectId).toBe("p-existing");
    expect(a1.path).toBe("src/main.ts");
  });

  it("strips the fences from the chat content so the bubble doesn't double-show", () => {
    const content =
      "Built it!\n```ts:a.ts\ncode here\n```\nReady when you are.";
    const r = synthesizeFromFences(content, tools, {
      existingProjectId: null,
      userPromptHint: "build it",
    });
    expect(r!.cleanedContent).toBe("Built it!\n\nReady when you are.");
    expect(r!.cleanedContent).not.toContain("```");
  });

  it("infers Python from a .py extension even when the prompt says nothing", () => {
    const content = "```py:main.py\nprint('hi')\n```";
    const r = synthesizeFromFences(content, tools, {
      existingProjectId: null,
    });
    const args = JSON.parse(r!.toolCalls[0].arguments) as { language: string };
    expect(args.language).toBe("python");
  });

  it("infers Rust from a .rs extension", () => {
    const content = "```rust:src/main.rs\nfn main(){}\n```";
    const r = synthesizeFromFences(content, tools, {
      existingProjectId: null,
    });
    const args = JSON.parse(r!.toolCalls[0].arguments) as { language: string };
    expect(args.language).toBe("rust");
  });

  it("rejects fences whose body is a tool-call payload", () => {
    const content =
      '```jsx:src/App.jsx\n{"name":"some_tool","arguments":{}}\n```';
    const r = synthesizeFromFences(content, tools, {
      existingProjectId: null,
    });
    // No legitimate file fences left after the tool-call body
    // was filtered.
    expect(r).toBeNull();
  });

  it("returns null when the required tool isn't registered", () => {
    const content = "```ts:a.ts\nx\n```";
    // No tools at all.
    const r = synthesizeFromFences(content, [], {
      existingProjectId: null,
    });
    expect(r).toBeNull();
  });
});

describe("findExistingProjectId", () => {
  it("returns null when no create_sandbox_project has run", () => {
    expect(findExistingProjectId([])).toBeNull();
    expect(
      findExistingProjectId([
        { name: "list_courses", content: '{"data":[]}' },
      ]),
    ).toBeNull();
  });
  it("pulls the projectId out of the most-recent successful create", () => {
    const id = findExistingProjectId([
      {
        name: "create_sandbox_project",
        content: JSON.stringify({ ok: true, projectId: "first-id" }),
      },
      { name: "write_sandbox_file", content: "{}" },
      {
        name: "create_sandbox_project",
        content: JSON.stringify({ ok: true, projectId: "second-id" }),
      },
    ]);
    expect(id).toBe("second-id");
  });
});

describe("loop integration: fence-only response triggers synthesis", () => {
  it("model dumps code with no tool calls; loop synthesises create + dispatches it", async () => {
    let createArgs: { name: string; language: string; files: unknown } | null =
      null;
    const localTools: ToolDef[] = [
      {
        name: "create_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler(args: { name: string; language: string; files?: unknown }) {
          createArgs = {
            name: args.name,
            language: args.language,
            files: args.files,
          };
          return { ok: true, projectId: "p1" };
        },
      },
    ];
    const turns: AgentTurnResponse[] = [
      // Turn 1: model just dumps code in a fence, no tool calls.
      {
        content: [
          "Here's the game:",
          "```jsx:src/App.jsx",
          "export default function App() { return null; }",
          "```",
          "<confidence>0.7</confidence>",
        ].join("\n"),
      },
      // Turn 2: model writes a summary after the synthesised
      // create runs.
      { content: "Built.\n<confidence>0.88</confidence>" },
    ];
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: localTools,
      userPrompt: "build me a tic-tac-toe game in React",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
      // Isolates fence synthesis — the scripted post-create stall
      // would otherwise trigger an auto-continue nudge.
      autoContinue: false,
    });
    // The synthesised tool call ran.
    expect(createArgs).not.toBeNull();
    expect(createArgs!.language).toBe("react");
    // The visible chat content should NOT contain the dumped fence.
    const turn1Assistant = result.messages.find(
      (m) => m.role === "assistant",
    ) as Extract<(typeof result.messages)[number], { role: "assistant" }>;
    expect(turn1Assistant.content).not.toContain("export default");
    expect(turn1Assistant.content).not.toContain("```");
    // Loop terminated cleanly.
    expect(result.endedBy).toBe("terminal");
  });

  it("model edits an EXISTING project via fences; loop synthesises write calls", async () => {
    let writePaths: string[] = [];
    const localTools: ToolDef[] = [
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
        name: "write_sandbox_file",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler(args: { path: string }) {
          writePaths.push(args.path);
          return { ok: true };
        },
      },
    ];
    // Pre-seed the conversation with a prior create result so
    // the synthesiser uses write_sandbox_file instead of create.
    const initialMessages = [
      { role: "user" as const, content: "make a thing" },
      {
        role: "assistant" as const,
        content: "Created it.",
      },
      {
        role: "tool" as const,
        toolCallId: "prev",
        name: "create_sandbox_project",
        content: JSON.stringify({ ok: true, projectId: "p1" }),
      },
    ];
    const turns: AgentTurnResponse[] = [
      {
        content: [
          "Patching the two files:",
          "```ts:src/a.ts",
          "// updated a",
          "```",
          "```ts:src/b.ts",
          "// updated b",
          "```",
        ].join("\n"),
      },
      { content: "Done." },
    ];
    const transport = scriptedTransport(turns);
    await runAgentLoop({
      initialMessages,
      systemPrompt: "",
      model: "test",
      tools: localTools,
      userPrompt: "update both files",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    expect(writePaths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("skips synthesis when the model DID emit a structured tool call", async () => {
    let createCalls = 0;
    const localTools: ToolDef[] = [
      {
        name: "create_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler() {
          createCalls += 1;
          return { ok: true, projectId: "p1" };
        },
      },
    ];
    const turns: AgentTurnResponse[] = [
      {
        // Model BOTH calls the tool AND emits a fence. Synthesis
        // should NOT fire — the model already declared what it
        // wanted via the structured channel.
        content: "Creating...\n```jsx:src/App.jsx\nstub\n```",
        toolCalls: [
          {
            id: "real",
            name: "create_sandbox_project",
            arguments: JSON.stringify({ name: "X", language: "react" }),
          },
        ],
      },
      { content: "Done." },
    ];
    const transport = scriptedTransport(turns);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: localTools,
      userPrompt: "build",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    expect(createCalls).toBe(1);
  });
});
