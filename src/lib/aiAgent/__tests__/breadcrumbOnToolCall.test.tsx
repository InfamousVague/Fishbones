/// React-level test for the "hide prose when a turn has tool
/// calls" behaviour. The exact bug report shape from the user's
/// screenshot — model emits "Sure! I'll guide you through…
/// Step 1: …" prose around a structured tool call. The panel
/// should render the breadcrumb only and drop the prose.

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
  const tools = useMemo(
    () => [tool("create_sandbox_project", { auto: true })],
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

describe("AgentRow: tool-call turns render as breadcrumb, not prose bubble", () => {
  it(
    "model emits chatty prose + structured tool call — chat shows only the breadcrumb",
    async () => {
      transportRef.current = scripted([
        // The exact shape from the bug screenshot.
        {
          content: [
            "Sure! I'll guide you through creating a Blackjack game in React step-by-step.",
            "",
            "## Step 1: Create a New Sandbox Project",
            "Let's create a new React project named 'Blackjack Game'.",
            "",
            "```json",
            '{ "name": "create_sandbox_project", "arguments": { "name": "Blackjack Game", "language": "react" } }',
            "```",
          ].join("\n"),
          toolCalls: [
            {
              id: "c1",
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

      render(<Harness prompt="Build me a blackjack game in React." />);
      await act(async () => {
        screen.getByTestId("send").click();
      });
      // Wait until the final turn's confidence lands so we know
      // both turns have processed.
      await waitFor(() => {
        const v = document.querySelector(".libre-ai-hud-confidence-value");
        expect(v?.textContent).toBe("90%");
      });

      // The turn-1 assistant message had tool calls — its
      // RENDERED form should be the breadcrumb, not the prose
      // bubble. So:
      //   - There should be a `.libre-ai-agent-breadcrumb` showing
      //     "running create_sandbox_project…"
      //   - The prose strings ("Sure!", "Step 1", etc) should NOT
      //     appear anywhere in any assistant BUBBLE (Card).
      const bubbles = Array.from(
        document.querySelectorAll(".libre-ai-bubble--assistant"),
      );
      const allBubbleText = bubbles.map((b) => b.textContent ?? "").join(" ");
      expect(allBubbleText).not.toContain("Sure!");
      expect(allBubbleText).not.toContain("Step 1");
      expect(allBubbleText).not.toContain('"create_sandbox_project"');

      // The breadcrumb naming the tool should be present in the
      // DOM (either inline-row or pinned banner). Either is fine
      // for this bug — what matters is the user sees the chip,
      // not the prose.
      const breadcrumbs = Array.from(
        document.querySelectorAll(".libre-ai-agent-breadcrumb"),
      ).concat(
        Array.from(document.querySelectorAll(".libre-ai-thinking-banner")),
      );
      const breadcrumbText = breadcrumbs
        .map((b) => b.textContent ?? "")
        .join(" ");
      // The final turn's text bubble carries the wrap-up message
      // ("Built.") and IS allowed. But the breadcrumb / banner
      // should have surfaced the tool name at some point.
      expect(breadcrumbText.length).toBeGreaterThan(0);

      // The final turn (no tool calls, just text) IS allowed to
      // render as a normal bubble — it's the closing wrap-up.
      expect(allBubbleText).toContain("Built.");
    },
  );
});
