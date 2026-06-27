/// Tool-tier gating + the self-healing "does not support tools"
/// fallback. This is the regression guard for the bug where picking
/// an emulated model (e.g. deepseek-coder-v2:16b) hard-failed every
/// agent turn with a 400.

import { describe, expect, it } from "vitest";
import { isToolsUnsupportedError, runAgentLoop } from "../loop";
import type {
  AgentTransport,
  AgentTurnRequest,
  AgentTurnResponse,
} from "../types";
import type { ToolDef } from "../../aiTools/types";

function tool(name: string): ToolDef {
  return {
    name,
    description: "",
    parameters: { type: "object", properties: {} },
    auto: true,
    async handler() {
      return { ok: true };
    },
  };
}

async function autoApprove(): Promise<"approved"> {
  return "approved";
}

/// A transport that records every request and replays a script of
/// responses-or-errors (an Error in the script is thrown).
function recordingTransport(script: Array<AgentTurnResponse | Error>): {
  transport: AgentTransport;
  calls: AgentTurnRequest[];
} {
  const calls: AgentTurnRequest[] = [];
  let i = 0;
  return {
    calls,
    transport: {
      async send(req) {
        calls.push(req);
        const step = script[i++];
        if (step instanceof Error) throw step;
        if (!step) throw new Error("transport script exhausted");
        return step;
      },
    },
  };
}

const OLLAMA_TOOLS_400 = new Error(
  'ollama returned 400 Bad Request: {"error":"registry.ollama.ai/library/deepseek-coder-v2:16b does not support tools"}',
);

describe("isToolsUnsupportedError", () => {
  it("matches Ollama's tools-unsupported 400", () => {
    expect(isToolsUnsupportedError(OLLAMA_TOOLS_400.message)).toBe(true);
    expect(isToolsUnsupportedError("model X does not support tools")).toBe(true);
  });
  it("matches plausible alternate phrasings (wording-change resilience)", () => {
    expect(isToolsUnsupportedError("this model: tools are not supported")).toBe(true);
    expect(isToolsUnsupportedError("error: tool not supported")).toBe(true);
    expect(isToolsUnsupportedError("model has no tools template")).toBe(true);
  });
  it("does not match unrelated transport errors", () => {
    expect(isToolsUnsupportedError("ollama returned 500")).toBe(false);
    expect(isToolsUnsupportedError("connection refused")).toBe(false);
    expect(isToolsUnsupportedError("Stopped by user.")).toBe(false);
  });
});

describe("wire-tool gating by model tier", () => {
  it("sends wire tools for a NATIVE model", async () => {
    const { transport, calls } = recordingTransport([{ content: "done" }]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: [tool("create_sandbox_project")],
      userPrompt: "hi",
      transport,
      maxTurns: 5,
      hooks: { approveToolCall: autoApprove },
    });
    expect(calls[0].tools).toHaveLength(1);
  });

  it("sends NO wire tools for an EMULATED model (deepseek)", async () => {
    const { transport, calls } = recordingTransport([{ content: "done" }]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "deepseek-coder-v2:16b",
      tools: [tool("create_sandbox_project")],
      userPrompt: "hi",
      transport,
      maxTurns: 5,
      hooks: { approveToolCall: autoApprove },
    });
    expect(calls[0].tools).toEqual([]);
  });
});

describe("self-healing 400 fallback", () => {
  it("retries the turn with tools stripped when a model 400s 'does not support tools'", async () => {
    // Unknown custom model → optimistically treated as native, so
    // the first attempt ships wire tools and 400s; the loop strips
    // them and retries the same turn.
    const { transport, calls } = recordingTransport([
      OLLAMA_TOOLS_400,
      { content: "recovered" },
    ]);
    let unsupportedModel: string | null = null;
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "custom-finetune:latest",
      tools: [tool("create_sandbox_project")],
      userPrompt: "build it",
      transport,
      maxTurns: 5,
      hooks: {
        approveToolCall: autoApprove,
        onToolsUnsupported: (m) => {
          unsupportedModel = m;
        },
      },
    });
    expect(unsupportedModel).toBe("custom-finetune:latest");
    expect(calls).toHaveLength(2);
    expect(calls[0].tools).toHaveLength(1); // first attempt: optimistic tools
    expect(calls[1].tools).toEqual([]); // retry: stripped
    expect(result.endedBy).toBe("terminal");
    const last = result.messages[result.messages.length - 1];
    expect(last.role === "assistant" && last.content).toBe("recovered");
  });

  it("keeps wire tools stripped for the REST of the run after a fallback", async () => {
    const { transport, calls } = recordingTransport([
      OLLAMA_TOOLS_400,
      { content: "turn1 still going" },
      { content: "turn2 done" },
    ]);
    // Two turns: force a second turn by having turn1 emit an inline
    // tool call so the loop continues. Simpler: just assert the
    // single retried turn + a follow-up nudge-driven turn both ship
    // empty tools. Here turn1 is text-only → terminal, so we assert
    // the retry alone; the flag persistence is covered by the unit
    // contract (forceEmulated stays true).
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "custom-finetune:latest",
      tools: [tool("create_sandbox_project")],
      userPrompt: "build it",
      transport,
      maxTurns: 5,
      hooks: { approveToolCall: autoApprove },
    });
    // First call had tools, the retry had none.
    expect(calls[0].tools).toHaveLength(1);
    expect(calls[1].tools).toEqual([]);
  });

  it("keeps tools stripped on a GENUINE second turn after the fallback", async () => {
    // turn0: 400 (had tools) → retry stripped, and the retried turn
    // emits an inline tool call so the loop dispatches it and runs a
    // real turn1 — which must also ship NO wire tools.
    const { transport, calls } = recordingTransport([
      OLLAMA_TOOLS_400,
      {
        content:
          '<tool_call>{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}}</tool_call>',
      },
      { content: "all done" },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "custom-finetune:latest",
      tools: [tool("create_sandbox_project")],
      userPrompt: "build it",
      transport,
      maxTurns: 5,
      hooks: { approveToolCall: autoApprove },
    });
    expect(calls).toHaveLength(3);
    expect(calls[0].tools).toHaveLength(1); // optimistic first attempt
    expect(calls[1].tools).toEqual([]); // retry, stripped
    expect(calls[2].tools).toEqual([]); // genuine 2nd turn, still stripped
    expect(result.endedBy).toBe("terminal");
  });

  it("does NOT fall back for unrelated transport errors", async () => {
    const { transport, calls } = recordingTransport([
      new Error("ollama returned 500 Internal Server Error"),
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: [tool("create_sandbox_project")],
      userPrompt: "hi",
      transport,
      maxTurns: 5,
      hooks: { approveToolCall: autoApprove },
    });
    expect(calls).toHaveLength(1); // no retry
    expect(result.endedBy).toBe("error");
  });
});

describe("isSystemNote breadcrumbs are wire-invisible", () => {
  it("never sends a UI-only breadcrumb to the model on a later turn", async () => {
    const { transport, calls } = recordingTransport([{ content: "ok" }]);
    await runAgentLoop({
      initialMessages: [
        { role: "user", content: "earlier real prompt" },
        {
          role: "user",
          content: "(compatibility-mode breadcrumb)",
          isNudge: true,
          isSystemNote: true,
        },
      ],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: [],
      userPrompt: "next prompt",
      transport,
      maxTurns: 5,
      hooks: { approveToolCall: autoApprove },
    });
    const wire = calls[0].messages.map((mm) => mm.content);
    expect(wire).not.toContain("(compatibility-mode breadcrumb)");
    // Genuine user turns still go through.
    expect(wire).toContain("earlier real prompt");
    expect(wire.some((c) => c.includes("next prompt"))).toBe(true);
  });
});
