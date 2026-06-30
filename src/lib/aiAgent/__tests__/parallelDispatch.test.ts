/// Parallel tool-dispatch tests. A batch of auto (read-only)
/// calls in one turn dispatches concurrently; gated or
/// low-confidence batches stay sequential so approval chips and
/// writes never race.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";

function scripted(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send() {
      const t = turns[i++];
      if (!t) throw new Error("script underrun");
      return t;
    },
  };
}

/// Tool whose handler records concurrency: increments an active
/// counter on entry, samples the peak, resolves after a tick.
function makeProbe(name: string, state: { active: number; peak: number }, auto = true): ToolDef {
  return {
    name,
    description: "",
    parameters: { type: "object", properties: {} },
    auto,
    async handler() {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      await new Promise((r) => setTimeout(r, 20));
      state.active -= 1;
      return { ok: true };
    },
  };
}

describe("parallel dispatch", () => {
  it("runs an all-auto batch concurrently", async () => {
    const state = { active: 0, peak: 0 };
    const tools = [
      makeProbe("read_a", state),
      makeProbe("read_b", state),
      makeProbe("read_c", state),
    ];
    const transport = scripted([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "read_a", arguments: "{}" },
          { id: "2", name: "read_b", arguments: "{}" },
          { id: "3", name: "read_c", arguments: "{}" },
        ],
      },
      { content: "done.\n<confidence>0.9</confidence>" },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "scan",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 5,
    });
    // All three overlapped — peak concurrency hit 3.
    expect(state.peak).toBe(3);
    // Results arrive in emission order despite concurrency.
    expect(result.timeline.map((t) => t.name)).toEqual([
      "read_a",
      "read_b",
      "read_c",
    ]);
    expect(result.endedBy).toBe("terminal");
  });

  it("keeps gated batches sequential", async () => {
    const state = { active: 0, peak: 0 };
    const tools = [
      makeProbe("write_a", state, false),
      makeProbe("write_b", state, false),
    ];
    const transport = scripted([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "write_a", arguments: "{}" },
          { id: "2", name: "write_b", arguments: "{}" },
        ],
      },
      { content: "done." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "write",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 5,
    });
    // Never more than one in flight.
    expect(state.peak).toBe(1);
  });

  it("keeps low-confidence batches sequential even when all-auto", async () => {
    const state = { active: 0, peak: 0 };
    const tools = [makeProbe("read_a", state), makeProbe("read_b", state)];
    const transport = scripted([
      {
        content: "<confidence>0.2</confidence>",
        toolCalls: [
          { id: "1", name: "read_a", arguments: "{}" },
          { id: "2", name: "read_b", arguments: "{}" },
        ],
      },
      { content: "done." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "scan",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 5,
    });
    expect(state.peak).toBe(1);
  });
});
