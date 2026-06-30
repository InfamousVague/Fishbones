/// End-to-end-ish proof that EMULATED models (gemma/deepseek — no
/// native tool channel) actually BUILD now that the UI blocks are
/// gone. Drives runAgentLoop with a transport that replays the kind
/// of free TEXT these models emit, and asserts the loop's recovery
/// pipeline (inline-JSON / XML / fence-synthesis) turns it into the
/// right validated tool calls — while NEVER writing a junk file from
/// tool-call JSON.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { ToolDef } from "@/lib/aiTools/types";

async function autoApprove(): Promise<"approved"> {
  return "approved";
}

/// Tolerant transport: after the scripted turns it returns a terminal
/// text turn, so build-state nudges that drive extra turns can't crash
/// the run with "script exhausted".
function scripted(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send() {
      return turns[i++] ?? { content: "" };
    },
  };
}

interface Recorder {
  creates: Array<{ name?: string; language?: string; files?: unknown[] }>;
  writes: Array<{ path?: string; content?: string }>;
  runs: number;
}

function buildTools(rec: Recorder): ToolDef[] {
  return [
    {
      name: "create_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler(args: unknown) {
        const a = args as {
          name?: string;
          language?: string;
          files?: unknown[];
        };
        rec.creates.push({ name: a.name, language: a.language, files: a.files });
        return { ok: true, projectId: "proj1" };
      },
    },
    {
      name: "write_sandbox_file",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler(args: unknown) {
        const a = args as { path?: string; content?: string };
        rec.writes.push({ path: a.path, content: a.content });
        return { ok: true };
      },
    },
    {
      name: "run_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        rec.runs += 1;
        return { ok: true };
      },
    },
  ];
}

function newRec(): Recorder {
  return { creates: [], writes: [], runs: 0 };
}

describe("emulated build — gemma-style (create call, then fenced files)", () => {
  it("creates the project once, then lands each file via fence synthesis", async () => {
    const rec = newRec();
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "gemma3:4b",
      tools: buildTools(rec),
      userPrompt: "build blackjack",
      transport: scripted([
        // Turn 0: a text <tool_call> create (no structured channel).
        {
          content:
            '<tool_call>{"name":"create_sandbox_project","arguments":{"name":"Blackjack","language":"react"}}</tool_call>',
        },
        // Turn 1: bare fenced files — recovered as write_sandbox_file
        // against the project created in turn 0.
        {
          content:
            "Here is the app:\n\n```jsx:src/App.jsx\nexport default function App(){ return <div>hi</div>; }\n```\n\n```css:src/style.css\nbody{ margin:0; }\n```",
        },
        // Turn 2: a text run call → build completes.
        {
          content:
            '<tool_call>{"name":"run_sandbox_project","arguments":{"projectId":"proj1"}}</tool_call>',
        },
      ]),
      maxTurns: 8,
      hooks: { approveToolCall: autoApprove },
    });

    // Exactly one project, created from the text tool call.
    expect(rec.creates).toHaveLength(1);
    expect(rec.creates[0].name).toBe("Blackjack");

    // Both files landed via fence synthesis, with real paths + content.
    const paths = rec.writes.map((w) => w.path).sort();
    expect(paths).toEqual(["src/App.jsx", "src/style.css"]);
    const app = rec.writes.find((w) => w.path === "src/App.jsx");
    expect(app?.content).toContain("export default function App");

    expect(rec.runs).toBe(1);
    void result;
  });
});

describe("emulated build — deepseek-style (one create call carrying all files)", () => {
  it("lands a multi-file project from a single inline-files create call", async () => {
    const rec = newRec();
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "deepseek-coder-v2:16b",
      tools: buildTools(rec),
      userPrompt: "build it",
      transport: scripted([
        {
          content:
            '<tool_call>{"name":"create_sandbox_project","arguments":{"name":"Snake","language":"web","files":[{"path":"index.html","content":"<!doctype html>"},{"path":"main.js","content":"console.log(1)"}]}}</tool_call>',
        },
      ]),
      maxTurns: 6,
      hooks: { approveToolCall: autoApprove },
    });

    expect(rec.creates).toHaveLength(1);
    expect(rec.creates[0].name).toBe("Snake");
    expect(rec.creates[0].files).toHaveLength(2);
  });
});

describe("emulated build — junk-file regression", () => {
  it("recovers tool-call JSON wrapped in a fence as a TOOL CALL, never a junk file", async () => {
    const rec = newRec();
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "gemma3:4b",
      tools: buildTools(rec),
      userPrompt: "build blackjack",
      transport: scripted([
        // A confused weak model wraps the create call in a ```json
        // fence (against instructions). It must be recovered as the
        // create tool call — NOT written as a file named after the
        // JSON (the original junk-project bug).
        {
          content:
            '```json\n{"name":"create_sandbox_project","arguments":{"name":"Blackjack","language":"react"}}\n```',
        },
      ]),
      maxTurns: 4,
      hooks: { approveToolCall: autoApprove },
    });

    // The JSON became a real create call…
    expect(rec.creates).toHaveLength(1);
    expect(rec.creates[0].name).toBe("Blackjack");
    // …and NOTHING was written as a file (no junk path from the JSON).
    expect(rec.writes).toHaveLength(0);
  });

  it("does not write files whose path looks like tool-call JSON", async () => {
    const rec = newRec();
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "gemma3:4b",
      tools: buildTools(rec),
      userPrompt: "build it",
      transport: scripted([
        { content: "" }, // no create — no project yet
        // A fence whose info string is a JSON fragment must never
        // become a file path.
        {
          content:
            '```"name": "create_sandbox_project",\n{"arguments":{}}\n```',
        },
      ]),
      maxTurns: 4,
      hooks: { approveToolCall: autoApprove },
    });

    expect(
      rec.writes.every(
        (w) => !/name|arguments|create_sandbox_project/.test(w.path ?? ""),
      ),
    ).toBe(true);
    expect(
      rec.creates.every(
        (c) => !/[{}":]/.test(c.name ?? ""),
      ),
    ).toBe(true);
  });
});
