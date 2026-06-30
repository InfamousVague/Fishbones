/// Stop + live-HUD behaviour. Pins down the three improvements
/// from the latest bug report: a Stop button that halts the
/// active run, real-time confidence updates as the
/// `<confidence>` tag streams in, and live token estimates as
/// chunks arrive.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import {
  estimateTokens,
  parseStreamingConfidence,
} from "@/lib/aiAgent/confidence";

function tool(name: string) {
  return {
    name,
    description: "",
    parameters: { type: "object" as const, properties: {} },
    auto: true,
    async handler() {
      return { ok: true };
    },
  };
}

// ─────────────────────────────────────────────────────────────

describe("parseStreamingConfidence (real-time tag)", () => {
  it("catches the value as soon as it streams in, before close tag", () => {
    expect(parseStreamingConfidence("hi <confidence>0.85")).toBeCloseTo(
      0.85,
      5,
    );
  });
  it("works with the close tag in place too", () => {
    expect(parseStreamingConfidence("<confidence>0.92</confidence>")).toBeCloseTo(
      0.92,
      5,
    );
  });
  it("normalises percentage form (>1) to a fraction", () => {
    expect(parseStreamingConfidence("<confidence>85")).toBeCloseTo(0.85, 5);
  });
  it("clamps negatives to 0", () => {
    expect(parseStreamingConfidence("<confidence>-0.3")).toBe(0);
  });
  it("returns null when no tag has streamed in yet", () => {
    expect(parseStreamingConfidence("partial reply with no tag")).toBeNull();
  });
  it("returns null for an opened tag but no value yet", () => {
    expect(parseStreamingConfidence("<confidence>")).toBeNull();
    expect(parseStreamingConfidence("<confidence>  ")).toBeNull();
  });
  it("accepts the reason attribute", () => {
    expect(
      parseStreamingConfidence(
        '<confidence reason="ambiguous prompt">0.4',
      ),
    ).toBeCloseTo(0.4, 5);
  });
});

describe("estimateTokens (live counter)", () => {
  it("returns 0 for empty content", () => {
    expect(estimateTokens("")).toBe(0);
  });
  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
  it("returns at least 1 for non-empty content", () => {
    expect(estimateTokens("hi")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────

describe("runAgentLoop: shouldStop hook", () => {
  it("bails between turns when shouldStop returns true", async () => {
    // Script enough turns for several iterations; the stop flag
    // should kick in after the first one.
    let turnCalls = 0;
    const transport: AgentTransport = {
      async send() {
        turnCalls += 1;
        // Always emit a tool call so the loop wants to continue.
        return {
          content: "",
          toolCalls: [
            { id: `c${turnCalls}`, name: "noop", arguments: "{}" },
          ],
        } as AgentTurnResponse;
      },
    };
    let stopAfterTurn = 1;
    let turnIdx = 0;
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [tool("noop")],
      userPrompt: "go",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        shouldStop: () => turnIdx >= stopAfterTurn,
        onTurnEnd: () => {
          turnIdx += 1;
        },
      },
      maxTurns: 20,
    });
    expect(result.endedBy).toBe("stopped");
    // Should have completed at least 1 turn but stopped well
    // before maxTurns.
    expect(turnCalls).toBeGreaterThanOrEqual(1);
    expect(turnCalls).toBeLessThan(20);
  });

  it("treats a transport rejection as 'stopped' when shouldStop is true", async () => {
    // Simulates the Rust-side cancel: the transport rejects
    // mid-stream because the user clicked Stop. The loop sees
    // the rejection AND the shouldStop flag is now true → exit
    // cleanly, no error message synthesised.
    const transport: AgentTransport = {
      async send() {
        throw new Error("Stopped by user.");
      },
    };
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "go",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        shouldStop: () => true,
      },
      maxTurns: 20,
    });
    expect(result.endedBy).toBe("stopped");
    // No synthetic (transport error: ...) assistant message
    // because the rejection was a user-initiated stop.
    const errAssistant = result.messages.find(
      (m): m is Extract<typeof m, { role: "assistant" }> =>
        m.role === "assistant" &&
        m.content.startsWith("(transport error"),
    );
    expect(errAssistant).toBeUndefined();
  });

  it("still treats a true transport failure as 'error' when shouldStop is false", async () => {
    const transport: AgentTransport = {
      async send() {
        throw new Error("Ollama unreachable.");
      },
    };
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "go",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        shouldStop: () => false,
      },
      maxTurns: 20,
    });
    expect(result.endedBy).toBe("error");
    const errAssistant = result.messages.find(
      (m): m is Extract<typeof m, { role: "assistant" }> =>
        m.role === "assistant" &&
        m.content.includes("transport error"),
    );
    expect(errAssistant).toBeDefined();
  });
});

describe("runAgentLoop: onStreamId hook", () => {
  it("forwards the transport's stream id to the host on each turn", async () => {
    const seenIds: string[] = [];
    const transport: AgentTransport = {
      async send(req) {
        // Mimic the Tauri transport: mint an id, hand it back
        // via onStreamId, then return.
        const id = `stream-${seenIds.length + 1}`;
        req.onStreamId?.(id);
        return { content: "hello\n<confidence>0.9</confidence>" };
      },
    };
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "go",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        onStreamId: (id) => {
          seenIds.push(id);
        },
      },
      maxTurns: 20,
    });
    expect(seenIds).toEqual(["stream-1"]);
    expect(result.endedBy).toBe("terminal");
  });
});
