/// React-level test for the clarification flow through the hook.
/// Asserts that when the model invokes request_user_input, the
/// hook surfaces a `clarification` state, and resolving it via
/// `answerClarification` lets the loop continue.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDef } from "@/lib/aiTools/types";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";

const transportRef: { current: AgentTransport | null } = { current: null };
vi.mock("@/lib/aiAgent/transport", () => ({
  createTauriTransport: () => transportRef.current,
}));

import { useAiAgent } from "@/hooks/useAiAgent";

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

beforeEach(() => {
  localStorage.clear();
});

describe("useAiAgent: clarification flow", () => {
  it("surfaces a clarification request and resolves it via answerClarification", async () => {
    transportRef.current = scripted([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "request_user_input",
            arguments: JSON.stringify({
              question: "TypeScript or JavaScript?",
              context: "Both valid for this build.",
            }),
          },
        ],
      },
      { content: "Got it.\n<confidence>0.85</confidence>" },
    ]);
    const { result } = renderHook(() =>
      useAiAgent({
        systemPrompt: "",
        tools: [tool("request_user_input")],
      }),
    );
    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("build it");
    });

    // Wait for the clarification request to surface.
    await waitFor(() => {
      expect(result.current.clarification).not.toBeNull();
    });
    expect(result.current.clarification?.question).toBe(
      "TypeScript or JavaScript?",
    );
    expect(result.current.clarification?.context).toBe(
      "Both valid for this build.",
    );

    // Answer the clarification.
    act(() => {
      result.current.answerClarification("TypeScript");
    });

    // The loop continues; we await full completion.
    await act(async () => {
      await sendPromise;
    });
    expect(result.current.clarification).toBeNull();
    expect(result.current.confidence).toBeCloseTo(0.85, 5);
  });

  it("cancellation propagates as a tool error and the model handles it", async () => {
    transportRef.current = scripted([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "request_user_input",
            arguments: JSON.stringify({ question: "Continue?" }),
          },
        ],
      },
      {
        content: "Okay, stopping.\n<confidence>0.3</confidence>",
      },
    ]);
    const { result } = renderHook(() =>
      useAiAgent({
        systemPrompt: "",
        tools: [tool("request_user_input")],
      }),
    );
    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("do it");
    });
    await waitFor(() => {
      expect(result.current.clarification).not.toBeNull();
    });
    act(() => {
      result.current.cancelClarification();
    });
    await act(async () => {
      await sendPromise;
    });
    expect(result.current.clarification).toBeNull();
    // The tool message should record the cancellation.
    const toolMsg = result.current.messages.find(
      (m) => m.role === "tool",
    ) as Extract<(typeof result.current.messages)[number], { role: "tool" }>;
    expect(toolMsg.content).toContain("cancelled");
  });
});
