/// Agent-loop end-to-end scenarios.
///
/// Each test scripts a sequence of model turns via the scripted
/// transport (no Ollama needed) and asserts on the resulting
/// message log + timeline + usage. This is what makes the
/// "fully test the AI without your intervention" promise work —
/// we can rehearse the most painful failure modes (stuck retries,
/// missing tool dispatch, inline-tool-call recovery, etc.) in
/// milliseconds against a deterministic mock.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef, ToolResult } from "@/lib/aiTools/types";

/// Build a scripted transport from an array of turn responses.
/// Each call to `send` pops the next entry off the front.
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

/// Auto-approve for every gated tool — the simplest test harness.
async function autoApprove(): Promise<"approved"> {
  return "approved";
}

describe("runAgentLoop", () => {
  it("terminates on a single text-only turn", async () => {
    const transport = scriptedTransport([
      { content: "Hello!", usage: { promptTokens: 10, completionTokens: 5, durationMs: 100 } },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "you are a helper",
      model: "test",
      tools: [],
      userPrompt: "say hi",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    expect(result.endedBy).toBe("terminal");
    expect(result.usage.turns).toBe(1);
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe("assistant");
    if (last.role === "assistant") expect(last.content).toBe("Hello!");
  });

  it("dispatches a tool call and continues until text", async () => {
    let toolRan = false;
    const t = tool("noop", {
      async handler() {
        toolRan = true;
        return { ok: true };
      },
    });
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "noop", arguments: "{}" }],
      },
      { content: "Done." },
    ]);
    const timeline: ToolResult[] = [];
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [t],
      userPrompt: "run noop",
      transport,
      hooks: {
        approveToolCall: autoApprove,
        onToolResult: (r) => timeline.push(r),
      },
      maxTurns: 20,
    });
    expect(toolRan).toBe(true);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].ok).toBe(true);
    expect(result.endedBy).toBe("terminal");
  });

  it("recovers an inline tool call when the structured channel is empty", async () => {
    let toolRan = false;
    const t = tool("create_sandbox_project", {
      async handler() {
        toolRan = true;
        return { ok: true, projectId: "p1" };
      },
    });
    const transport = scriptedTransport([
      {
        content:
          'On it!\n{"name":"create_sandbox_project","arguments":{"name":"X","language":"javascript"}}',
      },
      { content: "Created." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [t],
      userPrompt: "make X",
      transport,
      // This test isolates inline-JSON recovery; the scripted
      // model "stalls" after create, which would now trigger an
      // auto-continue nudge (covered by buildState.test.ts).
      autoContinue: false,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    expect(toolRan).toBe(true);
    expect(result.endedBy).toBe("terminal");
  });

  it("bails on max-turns when the model keeps emitting tool calls", async () => {
    const t = tool("noop");
    const turns: AgentTurnResponse[] = [];
    for (let i = 0; i < 5; i++) {
      turns.push({
        content: "",
        toolCalls: [{ id: `c${i}`, name: "noop", arguments: "{}" }],
      });
    }
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [t],
      userPrompt: "loop forever",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 3,
    });
    expect(result.endedBy).toBe("maxTurns");
  });

  it("detects the same tool call repeated and emits a stop message", async () => {
    // Tool always fails; model retries with same args 3+ times.
    const t = tool("bad", {
      async handler() {
        return { error: true, message: "nope" };
      },
    });
    const turns: AgentTurnResponse[] = [];
    for (let i = 0; i < 5; i++) {
      turns.push({
        content: "",
        toolCalls: [{ id: `c${i}`, name: "bad", arguments: "{}" }],
      });
    }
    turns.push({ content: "Sorry I gave up." });
    const transport = scriptedTransport(turns);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [t],
      userPrompt: "do bad",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
      maxSameCallRetries: 3,
    });
    // The 4th call should have been short-circuited with the
    // "stop repeating" tool result rather than running the handler
    // again. Look for that signature in the message log.
    const toolMsgs = result.messages.filter((m) => m.role === "tool");
    const stopMsg = toolMsgs.find((m) =>
      (m as Extract<typeof m, { role: "tool" }>).content.includes("Stop repeating"),
    );
    expect(stopMsg).toBeDefined();
  });

  it("denies a gated tool when the approval hook says so", async () => {
    let toolRan = false;
    const t = tool("dangerous", {
      auto: false,
      async handler() {
        toolRan = true;
        return { ok: true };
      },
    });
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "dangerous", arguments: "{}" }],
      },
      { content: "Understood — won't do it." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [t],
      userPrompt: "run dangerous",
      transport,
      hooks: { approveToolCall: async () => "denied" },
      maxTurns: 20,
    });
    expect(toolRan).toBe(false);
    expect(result.endedBy).toBe("terminal");
    const toolMsg = result.messages.find((m) => m.role === "tool") as Extract<
      (typeof result.messages)[number],
      { role: "tool" }
    >;
    expect(toolMsg.content).toContain("User denied");
  });

  it("parses and surfaces a confidence tag", async () => {
    const transport = scriptedTransport([
      {
        content: "Sure, that's correct.\n<confidence>0.92</confidence>",
      },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "anything",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    expect(result.finalConfidence).toBeCloseTo(0.92, 5);
    const last = result.messages[result.messages.length - 1];
    if (last.role === "assistant") {
      expect(last.content).toBe("Sure, that's correct.");
      expect(last.confidence).toBeCloseTo(0.92, 5);
    }
  });

  it("elevates auto tools to gated when confidence is low", async () => {
    let calls = 0;
    let toolRan = false;
    const t = tool("normallyAuto", {
      auto: true,
      async handler() {
        toolRan = true;
        return { ok: true };
      },
    });
    // First turn: tool call + low confidence. Loop should call
    // approveToolCall because of low confidence, even though
    // tool is auto.
    const transport = scriptedTransport([
      {
        content: "<confidence>0.3</confidence>",
        toolCalls: [{ id: "c1", name: "normallyAuto", arguments: "{}" }],
      },
      { content: "Done." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [t],
      userPrompt: "go",
      transport,
      hooks: {
        approveToolCall: async () => {
          calls += 1;
          return "approved";
        },
      },
      maxTurns: 20,
    });
    expect(calls).toBe(1);
    expect(toolRan).toBe(true);
    expect(result.endedBy).toBe("terminal");
  });

  it("routes request_user_input through the clarification hook", async () => {
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "request_user_input",
            arguments: JSON.stringify({
              question: "TypeScript or JavaScript?",
            }),
          },
        ],
      },
      { content: "Got it." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [tool("request_user_input", { auto: true })],
      userPrompt: "build it",
      transport,
      hooks: {
        approveToolCall: autoApprove,
        async requestClarification(question) {
          expect(question).toBe("TypeScript or JavaScript?");
          return "TypeScript";
        },
      },
      maxTurns: 20,
    });
    const toolMsg = result.messages.find((m) => m.role === "tool") as Extract<
      (typeof result.messages)[number],
      { role: "tool" }
    >;
    expect(JSON.parse(toolMsg.content)).toEqual({
      ok: true,
      answer: "TypeScript",
    });
  });

  it("returns an error result when request_user_input has no question", async () => {
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "request_user_input",
            arguments: "{}",
          },
        ],
      },
      { content: "Ok." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [tool("request_user_input", { auto: true })],
      userPrompt: "go",
      transport,
      hooks: {
        approveToolCall: autoApprove,
        async requestClarification() {
          return "should never reach";
        },
      },
      maxTurns: 20,
    });
    const toolMsg = result.messages.find(
      (m) => m.role === "tool",
    ) as Extract<(typeof result.messages)[number], { role: "tool" }>;
    expect(toolMsg.content).toContain("non-empty");
  });

  it("aggregates usage across multiple turns", async () => {
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "noop", arguments: "{}" }],
        usage: { promptTokens: 100, completionTokens: 20, durationMs: 200 },
      },
      {
        content: "Done.",
        usage: { promptTokens: 130, completionTokens: 15, durationMs: 180 },
      },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [tool("noop")],
      userPrompt: "do",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    expect(result.usage).toEqual({
      turns: 2,
      promptTokens: 230,
      completionTokens: 35,
      durationMs: 380,
    });
  });

  it("survives a transport error by recording it as an assistant message", async () => {
    const transport: AgentTransport = {
      async send() {
        throw new Error("ollama unreachable");
      },
    };
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "anything",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    expect(result.endedBy).toBe("error");
    const last = result.messages[result.messages.length - 1];
    if (last.role === "assistant") {
      expect(last.content).toContain("transport error");
      expect(last.content).toContain("ollama unreachable");
    }
  });

  it("preserves the user's augmented payload on the wire", async () => {
    let seenWireMessages: unknown[] = [];
    const transport: AgentTransport = {
      async send(req) {
        seenWireMessages = req.messages;
        return { content: "ok" };
      },
    };
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "system",
      model: "test",
      tools: [],
      userPrompt: "what should I work on?",
      augmented:
        "context: user has finished 3 lessons; what should they work on next?",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    // Find the user message on the wire — its content should be
    // the augmented version, NOT the raw prompt.
    const wireUser = seenWireMessages.find(
      (m): m is { role: "user"; content: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { role?: unknown }).role === "user",
    );
    expect(wireUser?.content).toBe(
      "context: user has finished 3 lessons; what should they work on next?",
    );
  });

  it("treats an unknown tool as a structured error without crashing", async () => {
    const transport = scriptedTransport([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "no_such_tool", arguments: "{}" }],
      },
      { content: "Sorry, I don't have that." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "anything",
      transport,
      hooks: { approveToolCall: autoApprove },
      maxTurns: 20,
    });
    const toolMsg = result.messages.find((m) => m.role === "tool") as Extract<
      (typeof result.messages)[number],
      { role: "tool" }
    >;
    expect(toolMsg.content).toContain("Unknown tool");
    expect(result.endedBy).toBe("terminal");
  });
});
