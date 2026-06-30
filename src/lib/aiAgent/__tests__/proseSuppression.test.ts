/// Prose-suppression + always-strip tests.
///
/// Pins down the fixes for the user's bug report: when a model
/// emits a structured tool call AND echoes the call in markdown
/// prose, the strip pass must remove the echoed JSON; when an
/// assistant turn has tool calls, the panel should render a
/// breadcrumb instead of the prose bubble.

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
];

describe("always-strip: structured tool call + prose echo", () => {
  it(
    "strips an inline JSON echo even when the structured channel " +
      "already produced the call (Bug: 'JSON visible in chat')",
    async () => {
      // Model uses the structured tool channel AND echoes the
      // same payload inside a markdown fence (verbose checkpoints
      // do this all the time). Without the always-strip fix the
      // echoed copy stays visible in the bubble.
      const proseEcho = [
        "Sure! I'll guide you through creating a Blackjack game in React step-by-step. We'll start by creating a new sandbox project and then scaffolding the necessary files.",
        "",
        "## Step 1: Create a New Sandbox Project",
        "Let's create a new React project named \"Blackjack Game\".",
        "",
        "```json",
        '{',
        '  "name": "create_sandbox_project",',
        '  "arguments": {',
        '    "name": "Blackjack Game",',
        '    "language": "react"',
        '  }',
        '}',
        "```",
      ].join("\n");
      const transport = scriptedTransport([
        {
          content: proseEcho,
          // The structured channel ALSO carries the call.
          toolCalls: [
            {
              id: "structured",
              name: "create_sandbox_project",
              arguments: JSON.stringify({
                name: "Blackjack Game",
                language: "react",
              }),
            },
          ],
        },
        { content: "Built.\n<confidence>0.9</confidence>" },
      ]);
      const result = await runAgentLoop({
        initialMessages: [],
        systemPrompt: "",
        model: "test",
        tools,
        userPrompt: "Build me a blackjack game in React.",
        transport,
        hooks: { approveToolCall: async () => "approved" },
        maxTurns: 20,
      });
      // The FIRST assistant message's content (post-strip) must
      // NOT contain the raw JSON tool-call payload anymore. The
      // prose around it can stay — what matters is the JSON is
      // gone so the user doesn't read it as "the AI is dumping
      // JSON at me".
      const firstAssistant = result.messages.find(
        (m) => m.role === "assistant",
      ) as Extract<(typeof result.messages)[number], { role: "assistant" }>;
      expect(firstAssistant.content).not.toContain('"create_sandbox_project"');
      expect(firstAssistant.content).not.toContain('"language": "react"');
      // The prose around it may or may not be present — the AGENT
      // PANEL hides it via the toolCalls-present breadcrumb path
      // (covered separately in the React-level test). The point
      // here is the JSON itself is stripped.
    },
  );

  it("strips a bare-object tool-call JSON echo too", async () => {
    const transport = scriptedTransport([
      {
        // Bare top-level JSON sandwiched in prose. The strip pass
        // catches both fenced AND bare forms.
        content:
          'Building now: {"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}} on it.',
        toolCalls: [
          {
            id: "structured",
            name: "create_sandbox_project",
            arguments: JSON.stringify({ name: "X", language: "react" }),
          },
        ],
      },
      { content: "ok\n<confidence>0.9</confidence>" },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    const firstAssistant = result.messages.find(
      (m) => m.role === "assistant",
    ) as Extract<(typeof result.messages)[number], { role: "assistant" }>;
    expect(firstAssistant.content).not.toContain('"create_sandbox_project"');
    expect(firstAssistant.content).toContain("Building now:");
    expect(firstAssistant.content).toContain("on it.");
  });
});
