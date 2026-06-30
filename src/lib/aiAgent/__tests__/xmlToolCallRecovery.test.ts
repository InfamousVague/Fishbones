/// XML-tag tool-call recovery tests.
///
/// Recovery layer 3 in the agent loop — catches the
/// `<function-name>X</function-name> <arguments>{}</arguments>`
/// shape we've seen smaller open-weights checkpoints emit when
/// they ignore Ollama's structured tool channel AND don't bother
/// with bare-JSON or fenced JSON either.
///
/// Each test pins one model output shape we've observed in the wild.

import { describe, expect, it } from "vitest";
import { extractXmlToolCalls } from "@/lib/aiAgent/streaming";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";

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
  {
    name: "run_sandbox_project",
    description: "",
    parameters: { type: "object", properties: {} },
    auto: false,
    async handler() {
      return { ok: true };
    },
  },
];

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

describe("extractXmlToolCalls (unit)", () => {
  it("returns null when the content has no XML tags", () => {
    expect(
      extractXmlToolCalls("just a plain text reply.", tools),
    ).toBeNull();
  });

  it("recovers the exact failure shape the user reported", () => {
    // From the user's screenshot — verbatim shape.
    const content =
      '<function-name>create_sandbox_project</function-name> <arguments> { "name": "Blackjack", "language": "react" } </arguments>';
    const r = extractXmlToolCalls(content, tools);
    expect(r).not.toBeNull();
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
    expect(JSON.parse(r!.toolCalls[0].arguments)).toEqual({
      name: "Blackjack",
      language: "react",
    });
    // The content gets scrubbed so the chat doesn't show the
    // raw XML next to the running tool chip.
    expect(r!.cleaned).toBe("");
  });

  it("accepts underscore variant <function_name>", () => {
    const content =
      '<function_name>create_sandbox_project</function_name><arguments>{"name":"X","language":"react"}</arguments>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
  });

  it("accepts short <name>/<args> tags", () => {
    const content =
      '<name>create_sandbox_project</name> <args>{"name":"X","language":"react"}</args>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(JSON.parse(r!.toolCalls[0].arguments)).toEqual({
      name: "X",
      language: "react",
    });
  });

  it("recovers Hermes-style <tool_call>{...}</tool_call>", () => {
    const content =
      'Calling now: <tool_call>{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}}</tool_call> done.';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
    expect(r!.cleaned).toContain("Calling now:");
    expect(r!.cleaned).toContain("done.");
    expect(r!.cleaned).not.toContain("<tool_call>");
  });

  it("accepts hyphenated <tool-call> variant", () => {
    const content =
      '<tool-call>{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}}</tool-call>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
  });

  it("recovers the plural <tools>{...}</tools> envelope (DeepSeek)", () => {
    const content =
      '<tools>{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}}</tools>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
    expect(r!.cleaned).not.toContain("<tools>");
  });

  it("recovers the EXACT <tools> request_user_input shape from the bug report", () => {
    const toolsWithClar: ToolDef[] = [
      ...tools,
      {
        name: "request_user_input",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler() {
          return { ok: true };
        },
      },
    ];
    // Verbatim shape from the screenshot.
    const content =
      '<tools> {"name": "request_user_input", "arguments": {"question": "Why do you think the code uses println!(\\"{}\\") instead of just println!(message)?", "context": "The user is asking about Rust syntax."}} </tools>';
    const r = extractXmlToolCalls(content, toolsWithClar);
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("request_user_input");
    expect(JSON.parse(r!.toolCalls[0].arguments).question).toContain("println");
    expect(r!.cleaned).not.toContain("<tools>");
  });

  it("accepts bare <tool> and <function_call> envelopes", () => {
    expect(
      extractXmlToolCalls(
        '<tool>{"name":"run_sandbox_project","arguments":{"projectId":"p1"}}</tool>',
        tools,
      )!.toolCalls,
    ).toHaveLength(1);
    expect(
      extractXmlToolCalls(
        '<function_call>{"name":"run_sandbox_project","arguments":{"projectId":"p1"}}</function_call>',
        tools,
      )!.toolCalls,
    ).toHaveLength(1);
  });

  it("recovers a JSON ARRAY of calls in one <tools> envelope", () => {
    const content =
      '<tools>[{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}},{"name":"run_sandbox_project","arguments":{"projectId":"p1"}}]</tools>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls.map((c) => c.name)).toEqual([
      "create_sandbox_project",
      "run_sandbox_project",
    ]);
  });

  it("does NOT match a <tools> envelope wrapping a non-tool object (no false positive)", () => {
    const content = '<tools>{"foo":"bar","count":3}</tools>';
    expect(extractXmlToolCalls(content, tools)).toBeNull();
  });

  it("accepts a <tools> envelope carrying attributes", () => {
    const content =
      '<tools type="json">{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}}</tools>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
  });

  // ── Overlap resolution: a wrapper whose JSON body embeds a
  //    Pattern-A example must NOT have its inner span spliced out
  //    (which dropped surrounding prose + dispatched a phantom call).

  it("does not drop trailing prose or dispatch a phantom call when a wrapper body embeds a <name>/<args> example", () => {
    const content =
      'BEFORE <tool_call>{"name":"create_sandbox_project","arguments":{"hint":"use <name>run_sandbox_project</name><args>{}</args> next"}}</tool_call> AFTER';
    const r = extractXmlToolCalls(content, tools);
    // Exactly ONE call — the outer wrapper. The nested <name> example
    // inside the JSON string must NOT become a second dispatch.
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
    // Surrounding prose survives on both sides.
    expect(r!.cleaned).toContain("BEFORE");
    expect(r!.cleaned).toContain("AFTER");
    expect(r!.cleaned).not.toContain("<tool_call>");
  });

  it("keeps disjoint matches but drops a nested one (outermost wins)", () => {
    const content =
      '<tools>{"name":"create_sandbox_project","arguments":{"language":"react"}}</tools> mid <function-name>run_sandbox_project</function-name><arguments>{"projectId":"p1"}</arguments>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls.map((c) => c.name)).toEqual([
      "create_sandbox_project",
      "run_sandbox_project",
    ]);
    expect(r!.cleaned).toContain("mid");
  });

  it("recovers multiple paired tool calls in one response", () => {
    const content = [
      '<function-name>create_sandbox_project</function-name>',
      '<arguments>{"name":"X","language":"react"}</arguments>',
      'and then',
      '<function-name>run_sandbox_project</function-name>',
      '<arguments>{"projectId":"X"}</arguments>',
    ].join("\n");
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(2);
    expect(r!.toolCalls.map((c) => c.name)).toEqual([
      "create_sandbox_project",
      "run_sandbox_project",
    ]);
  });

  it("rejects unknown tool names", () => {
    const content =
      '<function-name>does_not_exist</function-name><arguments>{}</arguments>';
    expect(extractXmlToolCalls(content, tools)).toBeNull();
  });

  it("handles permissive args (single quotes, trailing comma)", () => {
    const content =
      "<function-name>create_sandbox_project</function-name><arguments>{'name': 'X', 'language': 'react',}</arguments>";
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(JSON.parse(r!.toolCalls[0].arguments)).toEqual({
      name: "X",
      language: "react",
    });
  });

  it("handles args wrapped in a json fence inside the tag", () => {
    const content =
      '<function-name>create_sandbox_project</function-name>\n<arguments>\n```json\n{"name":"X","language":"react"}\n```\n</arguments>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(JSON.parse(r!.toolCalls[0].arguments)).toEqual({
      name: "X",
      language: "react",
    });
  });

  it("preserves surrounding prose in the cleaned content", () => {
    const content =
      'Sure! <function-name>create_sandbox_project</function-name><arguments>{"name":"X","language":"react"}</arguments> Building now.';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.cleaned).toContain("Sure!");
    expect(r!.cleaned).toContain("Building now.");
    expect(r!.cleaned).not.toContain("<function-name>");
  });

  it("skips a paired-tags pattern whose args don't parse at all", () => {
    const content =
      '<function-name>create_sandbox_project</function-name><arguments>not even close to json</arguments>';
    expect(extractXmlToolCalls(content, tools)).toBeNull();
  });

  it("treats empty <arguments> as {}", () => {
    const content =
      '<function-name>create_sandbox_project</function-name><arguments></arguments>';
    const r = extractXmlToolCalls(content, tools);
    expect(r!.toolCalls).toHaveLength(1);
    expect(JSON.parse(r!.toolCalls[0].arguments)).toEqual({});
  });

  // ── Pattern C: bare <question>/<ask>/<clarification> tags ───

  it("synthesises request_user_input from <question>...</question>", () => {
    // The exact shape from the user's second bug report.
    const toolsWithClar: ToolDef[] = [
      ...tools,
      {
        name: "request_user_input",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return null;
        },
      },
    ];
    const content =
      "<question> Which version of Blackjack would you like to build? A simple text-based version or a graphical user interface (GUI) using React? </question>";
    const r = extractXmlToolCalls(content, toolsWithClar);
    expect(r).not.toBeNull();
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("request_user_input");
    expect(JSON.parse(r!.toolCalls[0].arguments)).toEqual({
      question:
        "Which version of Blackjack would you like to build? A simple text-based version or a graphical user interface (GUI) using React?",
    });
    // The cleaned content drops the XML so the chat doesn't show
    // the raw tag next to the clarification sheet.
    expect(r!.cleaned).toBe("");
  });

  it("accepts <ask> / <clarification> / <user_input> as aliases", () => {
    const toolsWithClar: ToolDef[] = [
      {
        name: "request_user_input",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return null;
        },
      },
    ];
    for (const tag of ["ask", "clarification", "user_input", "user-question"]) {
      const r = extractXmlToolCalls(`<${tag}>quick check?</${tag}>`, toolsWithClar);
      expect(r, `tag=${tag}`).not.toBeNull();
      expect(r!.toolCalls[0].name).toBe("request_user_input");
      expect(JSON.parse(r!.toolCalls[0].arguments).question).toBe(
        "quick check?",
      );
    }
  });

  it("skips an empty <question> tag", () => {
    const toolsWithClar: ToolDef[] = [
      {
        name: "request_user_input",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return null;
        },
      },
    ];
    expect(extractXmlToolCalls("<question></question>", toolsWithClar)).toBeNull();
  });

  it("skips <question> when request_user_input isn't in the registry", () => {
    expect(
      extractXmlToolCalls("<question>anything?</question>", tools),
    ).toBeNull();
  });

  it("doesn't double-extract when <question> and paired tags overlap", () => {
    // Defensive — a deeply confused model could emit both at the
    // same span. The de-dupe in Pattern C should skip the question.
    const toolsWithClar: ToolDef[] = [
      ...tools,
      {
        name: "request_user_input",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: true,
        async handler() {
          return null;
        },
      },
    ];
    const content =
      '<function-name>create_sandbox_project</function-name><arguments>{"name":"X","language":"react"}</arguments>';
    const r = extractXmlToolCalls(content, toolsWithClar);
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].name).toBe("create_sandbox_project");
  });
});

describe("loop integration: XML tool call dispatches end-to-end", () => {
  it(
    "model emits XML-tag tool call (no structured/inline/fence " +
      "alternative) — loop dispatches the synthesised call",
    async () => {
      let createArgs:
        | { name: string; language: string }
        | null = null;
      const localTools: ToolDef[] = [
        {
          name: "create_sandbox_project",
          description: "",
          parameters: { type: "object", properties: {} },
          auto: false,
          async handler(args: { name: string; language: string }) {
            createArgs = { name: args.name, language: args.language };
            return { ok: true, projectId: "p1" };
          },
        },
      ];
      const transport = scriptedTransport([
        // Turn 1: exact shape from the user's bug report — model
        // emits XML-wrapped tool call instead of using the
        // structured channel.
        {
          content:
            '<function-name>create_sandbox_project</function-name> <arguments> { "name": "Blackjack", "language": "react" } </arguments>',
        },
        // Turn 2: short summary after the recovered call runs.
        { content: "Blackjack scaffold is live.\n<confidence>0.85</confidence>" },
      ]);
      const result = await runAgentLoop({
        initialMessages: [],
        systemPrompt: "",
        model: "test",
        tools: localTools,
        userPrompt: "Build me a blackjack game in React.",
        transport,
        hooks: { approveToolCall: async () => "approved" },
        maxTurns: 20,
        // Isolates XML recovery — post-create stall would
        // otherwise trigger an auto-continue nudge.
        autoContinue: false,
      });
      expect(createArgs).not.toBeNull();
      expect(createArgs!.name).toBe("Blackjack");
      expect(createArgs!.language).toBe("react");
      expect(result.endedBy).toBe("terminal");
      // The first assistant message's visible content should NOT
      // contain the raw XML tags — they were stripped by the
      // extractor before rendering.
      const firstAssistant = result.messages.find(
        (m) => m.role === "assistant",
      ) as Extract<(typeof result.messages)[number], { role: "assistant" }>;
      expect(firstAssistant.content).not.toContain("<function-name>");
      expect(firstAssistant.content).not.toContain("<arguments>");
    },
  );

  it("Hermes-style <tool_call> wrapper triggers dispatch too", async () => {
    let dispatched = false;
    const localTools: ToolDef[] = [
      {
        name: "create_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler() {
          dispatched = true;
          return { ok: true, projectId: "p1" };
        },
      },
    ];
    const transport = scriptedTransport([
      {
        content:
          'On it. <tool_call>{"name":"create_sandbox_project","arguments":{"name":"X","language":"react"}}</tool_call>',
      },
      { content: "Done.\n<confidence>0.9</confidence>" },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: localTools,
      userPrompt: "build X",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    expect(dispatched).toBe(true);
  });

  it(
    "bare <question> tag routes through the clarification hook " +
      "end-to-end",
    async () => {
      let askedQuestion: string | null = null;
      const localTools: ToolDef[] = [
        {
          name: "request_user_input",
          description: "",
          parameters: { type: "object", properties: {} },
          auto: true,
          async handler() {
            return null;
          },
        },
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
      const transport = scriptedTransport([
        // Turn 1: bare <question> shape (the user's second
        // bug-report screenshot).
        {
          content:
            "<question> Which version of Blackjack would you like to build? A simple text-based version or a graphical user interface (GUI) using React? </question>",
        },
        // Turn 2: model proceeds with the answer.
        {
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "create_sandbox_project",
              arguments: JSON.stringify({
                name: "Blackjack",
                language: "react",
              }),
            },
          ],
        },
        { content: "Built the GUI version.\n<confidence>0.88</confidence>" },
      ]);
      const result = await runAgentLoop({
        initialMessages: [],
        systemPrompt: "",
        model: "test",
        tools: localTools,
        userPrompt: "Build me a blackjack game in React.",
        transport,
        hooks: {
          approveToolCall: async () => "approved",
          async requestClarification(question) {
            askedQuestion = question;
            return "GUI please";
          },
        },
        maxTurns: 20,
        // Isolates the <question> recovery path — the scripted
        // post-create terminal would otherwise nudge.
        autoContinue: false,
      });
      expect(askedQuestion).toBe(
        "Which version of Blackjack would you like to build? A simple text-based version or a graphical user interface (GUI) using React?",
      );
      expect(result.endedBy).toBe("terminal");
      // The first assistant message's visible content should NOT
      // contain the raw <question> tag.
      const firstAssistant = result.messages.find(
        (m) => m.role === "assistant",
      ) as Extract<(typeof result.messages)[number], { role: "assistant" }>;
      expect(firstAssistant.content).not.toContain("<question>");
    },
  );

  it("structured channel still wins when both XML and tool_calls are present", async () => {
    let createCallCount = 0;
    const localTools: ToolDef[] = [
      {
        name: "create_sandbox_project",
        description: "",
        parameters: { type: "object", properties: {} },
        auto: false,
        async handler() {
          createCallCount += 1;
          return { ok: true, projectId: "p1" };
        },
      },
    ];
    const transport = scriptedTransport([
      {
        // Model emits BOTH the structured call AND mistakenly
        // includes XML in the content. Layer 1 (structured) wins,
        // layer 3 (XML) should NOT also dispatch.
        content:
          '<function-name>create_sandbox_project</function-name><arguments>{"name":"X","language":"react"}</arguments>',
        toolCalls: [
          {
            id: "structured",
            name: "create_sandbox_project",
            arguments: JSON.stringify({ name: "Y", language: "react" }),
          },
        ],
      },
      { content: "Done." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: localTools,
      userPrompt: "build",
      transport,
      hooks: { approveToolCall: async () => "approved" },
      maxTurns: 20,
    });
    // Only the structured call ran — the XML recovery layer is
    // skipped when layer 1 already produced calls.
    expect(createCallCount).toBe(1);
  });
});
