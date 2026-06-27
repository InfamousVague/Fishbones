/// Step-3 of the rewrite: one build = one project. A second
/// create_sandbox_project in the SAME run must be deduped (rewritten
/// to point at the existing project), not dispatched again — this is
/// what stopped the ~20 duplicate "Blackjack" projects.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../loop";
import type { AgentTransport, AgentTurnResponse } from "../types";
import type { ToolDef } from "../../aiTools/types";

async function autoApprove(): Promise<"approved"> {
  return "approved";
}

function scripted(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send() {
      const t = turns[i++];
      if (!t) throw new Error("script exhausted");
      return t;
    },
  };
}

function createTurn(): AgentTurnResponse {
  return {
    content: "",
    toolCalls: [
      {
        id: `c${Math.random()}`,
        name: "create_sandbox_project",
        arguments: JSON.stringify({ name: "Blackjack", language: "react" }),
      },
    ],
  };
}

describe("per-run create_sandbox_project dedupe", () => {
  it("dispatches create once; a later create is deduped to the existing project", async () => {
    let createCalls = 0;
    const createTool: ToolDef = {
      name: "create_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: false,
      async handler() {
        createCalls += 1;
        return { ok: true, projectId: "blackjack-abc" };
      },
    };

    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: [createTool],
      userPrompt: "build blackjack",
      transport: scripted([
        createTurn(), // turn 1 → real create
        createTurn(), // turn 2 → must be DEDUPED (nudge-style re-create)
        { content: "Done." }, // turn 3 → terminal
      ]),
      maxTurns: 6,
      hooks: { approveToolCall: autoApprove },
    });

    // The create handler ran exactly ONCE.
    expect(createCalls).toBe(1);

    // The deduped second create returned the existing projectId + a
    // steer message, and never spawned a new project.
    const createResults = result.timeline.filter(
      (t) => t.name === "create_sandbox_project",
    );
    expect(createResults.length).toBe(2); // both turns produced a result
    const deduped = createResults.filter((t) => {
      try {
        return JSON.parse(t.content).deduped === true;
      } catch {
        return false;
      }
    });
    expect(deduped.length).toBe(1);
    expect(JSON.parse(deduped[0].content).projectId).toBe("blackjack-abc");
    // (endedBy depends on the build-state nudge cadence + script length,
    // not on dedupe — intentionally not asserted here.)
  });
});
