/// Breadcrumb completion-state test. The fix for the user's
/// "the … keeps animating after the tool is done" report:
/// once every tool call in an assistant turn has a matching
/// `ToolResult` in the timeline, the breadcrumb gets the
/// `--done` modifier (check icon, no animated dots, success
/// palette).

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
        name: "create_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return { ok: true, projectId: "p1" };
        },
      },
    ],
    [],
  );
  const agent = useAiAgent({ systemPrompt: "", tools });
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
        onStop={agent.stop}
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

describe("Breadcrumb: done state after tool completes", () => {
  it(
    "flips to --done with a check + no animated dots once the tool " +
      "has a result in the timeline",
    async () => {
      transportRef.current = scripted([
        {
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "create_sandbox_project",
              arguments: JSON.stringify({
                name: "X",
                language: "react",
              }),
            },
          ],
        },
        { content: "Done.\n<confidence>0.9</confidence>" },
      ]);
      const { container } = render(<Harness prompt="build" />);
      await act(async () => {
        screen.getByTestId("send").click();
      });

      // Wait for the run to complete (final turn's confidence
      // lands in the HUD).
      await waitFor(() => {
        const v = container.querySelector(".libre-ai-hud-confidence-value");
        expect(v?.textContent).toBe("90%");
      });

      // The breadcrumb for turn 1 (had the create_sandbox_project
      // tool call) should now be in --done state.
      const breadcrumbs = Array.from(
        container.querySelectorAll(".libre-ai-agent-breadcrumb"),
      );
      const doneBreadcrumb = breadcrumbs.find((b) =>
        b.classList.contains("libre-ai-agent-breadcrumb--done"),
      );
      expect(doneBreadcrumb).toBeDefined();
      // No animated dots inside the done breadcrumb — they were
      // the source of the "keeps animating forever" bug.
      const dots = doneBreadcrumb!.querySelector(
        ".libre-ai-agent-breadcrumb-dots",
      );
      expect(dots).toBeNull();
      // Label reads "ran X" (past tense) rather than "running X…"
      expect(doneBreadcrumb!.textContent).toContain("ran");
      expect(doneBreadcrumb!.textContent).toContain("create_sandbox_project");
    },
  );

  it(
    "keeps the running state (dots + hammer icon) before the tool " +
      "completes",
    async () => {
      // Simulate the in-flight state: the agent emits a tool
      // call but we DON'T let the loop finish (stop midway).
      // Easier: render an Agent with a pre-loaded message that
      // has tool calls but no matching timeline entry.
      const tools: ToolDef[] = [
        {
          name: "create_sandbox_project",
          description: "",
          parameters: { type: "object", properties: {} },
          auto: true,
          async handler() {
            return { ok: true };
          },
        },
      ];
      const HarnessLive = () => {
        const agent = useAiAgent({
          systemPrompt: "",
          tools,
          initialMessages: [
            { role: "user", content: "build" },
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "in-flight",
                  name: "create_sandbox_project",
                  arguments: "{}",
                },
              ],
            },
            // No matching tool-role result yet — the call is
            // "in flight". A trailing placeholder turn keeps
            // the in-flight assistant message from being the
            // LAST message, so its inline breadcrumb renders
            // (the panel suppresses the inline breadcrumb on
            // the tail message in favour of the pinned
            // ThinkingBanner — but we want to test the inline
            // path here).
            { role: "user", content: "next" },
          ],
        });
        return (
          <AiAgentPanel
            open
            messages={agent.messages}
            streaming={false}
            pending={[]}
            timeline={[]}
            error={null}
            usage={agent.usage}
            confidence={agent.confidence}
            clarification={null}
            settings={agent.settings}
            onSend={() => {}}
            onClose={() => {}}
            onReset={() => {}}
            onApprove={() => {}}
            onDeny={() => {}}
            onStop={() => {}}
            onAnswerClarification={() => {}}
            onCancelClarification={() => {}}
            onUpdateSettings={() => {}}
          />
        );
      };
      const { container } = render(<HarnessLive />);
      const breadcrumb = container.querySelector(
        ".libre-ai-agent-breadcrumb",
      );
      expect(breadcrumb).not.toBeNull();
      expect(
        breadcrumb!.classList.contains("libre-ai-agent-breadcrumb--done"),
      ).toBe(false);
      // Dots ARE present in the in-flight state.
      expect(
        breadcrumb!.querySelector(".libre-ai-agent-breadcrumb-dots"),
      ).not.toBeNull();
      // Label reads "running X…" (present tense)
      expect(breadcrumb!.textContent).toContain("running");
    },
  );
});
