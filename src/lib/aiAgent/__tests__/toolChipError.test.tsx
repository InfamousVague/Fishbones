/// Tool-result chip rendering tests — verifies that failed chips
/// surface the human-readable error message (not the raw JSON
/// envelope) and that clicking expands the full payload for
/// debugging.

import { act, render, screen, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDef } from "@/lib/aiTools/types";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";

const transportRef: { current: AgentTransport | null } = { current: null };
vi.mock("@/lib/aiAgent/transport", () => ({
  createTauriTransport: () => transportRef.current,
}));
vi.mock("@/i18n/i18n", () => ({
  useT: () => (k: string) => k,
}));
vi.mock("@/components/templates/Lesson/markdown", () => ({
  renderMarkdown: async (input: string) =>
    `<p>${input.replace(/</g, "&lt;")}</p>`,
}));

import AiAgentPanel from "@/components/organisms/AiAssistant/AiAgentPanel";
import { useAiAgent } from "@/hooks/useAiAgent";
import type { AiAgentSettings } from "@/lib/aiAgent/settings";

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

function Harness({ prompt }: { prompt: string }) {
  const tools = useMemo<ToolDef[]>(
    () => [
      {
        name: "write_sandbox_file",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return {
            error: true,
            message:
              "write_sandbox_file: 'projectId' is required. Call create_sandbox_project FIRST to get a projectId.",
          };
        },
      },
    ],
    [],
  );
  const agent = useAiAgent({
    systemPrompt: "",
    tools,
  });
  return (
    <>
      <button data-testid="send" onClick={() => void agent.send(prompt)}>
        send
      </button>
      <AiAgentPanel
        open
        messages={agent.messages}
        streaming={agent.streaming}
        pending={agent.pending}
        timeline={agent.timeline}
        error={agent.error}
        usage={agent.usage}
        confidence={agent.confidence}
        clarification={agent.clarification}
        settings={agent.settings}
        onSend={(p) => void agent.send(p)}
        onClose={() => {}}
        onReset={agent.reset}
        onApprove={agent.approve}
        onDeny={agent.deny}
        onAnswerClarification={agent.answerClarification}
        onCancelClarification={agent.cancelClarification}
        onUpdateSettings={(s: AiAgentSettings) => agent.updateSettings(s)}
      />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("ToolResultChip: failed-call rendering", () => {
  it(
    "renders the human-readable error message (not the raw JSON " +
      "envelope) in the chip preview",
    async () => {
      transportRef.current = scripted([
        {
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "write_sandbox_file",
              arguments: JSON.stringify({}),
            },
          ],
        },
        { content: "Sorry, that didn't work.\n<confidence>0.5</confidence>" },
      ]);

      render(<Harness prompt="write a file" />);
      await act(async () => {
        screen.getByTestId("send").click();
      });

      // Wait for the failed chip to appear.
      await waitFor(() => {
        const failChip = document.querySelector(
          ".libre-ai-tool-chip--fail",
        );
        expect(failChip).not.toBeNull();
      });

      const failChip = document.querySelector(
        ".libre-ai-tool-chip--fail",
      ) as HTMLElement;
      // The preview shows the human-readable message, NOT the raw
      // `{"error":true,"message":"..."}` envelope.
      const preview = failChip.querySelector(".libre-ai-tool-chip-preview");
      expect(preview?.textContent).toContain("'projectId' is required");
      expect(preview?.textContent).not.toContain('"error":true');

      // Chip is interactive (role="button", tabIndex=0).
      expect(failChip.getAttribute("role")).toBe("button");
      expect(failChip.getAttribute("tabindex")).toBe("0");

      // Initially the detail pre is NOT in the DOM.
      expect(
        failChip.querySelector(".libre-ai-tool-chip-detail"),
      ).toBeNull();

      // Click expands.
      await act(async () => {
        failChip.click();
      });
      const detail = failChip.querySelector(".libre-ai-tool-chip-detail");
      expect(detail).not.toBeNull();
      expect(detail?.textContent).toContain('"error":true');
      expect(detail?.textContent).toContain("'projectId' is required");

      // Click again collapses.
      await act(async () => {
        failChip.click();
      });
      expect(
        failChip.querySelector(".libre-ai-tool-chip-detail"),
      ).toBeNull();
    },
  );

  it("successful chips are not interactive (no role=button)", async () => {
    transportRef.current = scripted([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "write_sandbox_file",
            arguments: JSON.stringify({}),
          },
        ],
      },
      { content: "ok.\n<confidence>0.9</confidence>" },
    ]);
    // Override the failing handler with a succeeding one.
    const Override = () => {
      const tools = useMemo<ToolDef[]>(
        () => [
          {
            name: "write_sandbox_file",
            description: "",
            parameters: { type: "object", properties: {} },
            auto: true,
            async handler() {
              return { ok: true, bytes: 10 };
            },
          },
        ],
        [],
      );
      const agent = useAiAgent({ systemPrompt: "", tools });
      return (
        <>
          <button data-testid="send" onClick={() => void agent.send("write")}>
            send
          </button>
          <AiAgentPanel
            open
            messages={agent.messages}
            streaming={agent.streaming}
            pending={agent.pending}
            timeline={agent.timeline}
            error={agent.error}
            usage={agent.usage}
            confidence={agent.confidence}
            clarification={agent.clarification}
            settings={agent.settings}
            onSend={() => {}}
            onClose={() => {}}
            onReset={agent.reset}
            onApprove={agent.approve}
            onDeny={agent.deny}
            onAnswerClarification={agent.answerClarification}
            onCancelClarification={agent.cancelClarification}
            onUpdateSettings={(s: AiAgentSettings) => agent.updateSettings(s)}
          />
        </>
      );
    };
    render(<Override />);
    await act(async () => {
      screen.getByTestId("send").click();
    });
    await waitFor(() => {
      const okChip = document.querySelector(".libre-ai-tool-chip--ok");
      expect(okChip).not.toBeNull();
    });
    const okChip = document.querySelector(".libre-ai-tool-chip--ok");
    expect(okChip?.getAttribute("role")).toBeNull();
    expect(okChip?.getAttribute("tabindex")).toBeNull();
  });
});
