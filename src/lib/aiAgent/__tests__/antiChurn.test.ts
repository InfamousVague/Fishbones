/// Anti-churn breaker — the loop must stop a model that keeps
/// re-writing the SAME files without adding anything new (the "stuck
/// editing files it doesn't use" failure the real-model probe caught
/// on gemma3:4b), while NOT cutting off a legitimate fix-the-failed-
/// run cycle that re-edits an existing file on purpose.

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../loop";
import type { AgentTransport, AgentTurnResponse } from "../types";
import type { ToolDef } from "../../aiTools/types";

async function autoApprove(): Promise<"approved"> {
  return "approved";
}

/// Tolerant scripted transport: replays turns, then returns terminal
/// text so an over-run can't crash with "script exhausted".
function scripted(turns: AgentTurnResponse[]): { transport: AgentTransport; calls: () => number } {
  let i = 0;
  return {
    calls: () => i,
    transport: {
      async send() {
        return turns[i++] ?? { content: "" };
      },
    },
  };
}

function tc(name: string, args: object): AgentTurnResponse {
  return {
    content: "",
    toolCalls: [{ id: `c${name}${Math.round(args && 0)}${Math.random()}`, name, arguments: JSON.stringify(args) }],
  };
}

function tools(runResults: boolean[] = [], store?: Map<string, string>): ToolDef[] {
  let runIdx = 0;
  return [
    {
      name: "create_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler(a: any) {
        for (const f of (a?.files ?? []) as Array<{ path: string; content: string }>)
          store?.set(f.path, f.content ?? "");
        return { ok: true, projectId: "p1" };
      },
    },
    {
      name: "write_sandbox_file",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler(a: any) {
        store?.set(a?.path, a?.content ?? "");
        return { ok: true, path: a?.path };
      },
    },
    {
      name: "apply_sandbox_patch",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler(a: any) {
        for (const e of (a?.edits ?? []) as Array<{ path: string; op?: string; content?: string }>) {
          if (e.op === "delete") store?.delete(e.path);
          else store?.set(e.path, e.content ?? "");
        }
        return { ok: true };
      },
    },
    {
      name: "run_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        const ok = runResults[runIdx++] ?? true;
        return ok ? { ok: true } : { error: true, message: "build failed" };
      },
    },
  ];
}

describe("anti-churn breaker", () => {
  it("stops after 2 no-progress re-writes of the same file", async () => {
    const { transport, calls } = scripted([
      tc("create_sandbox_project", { name: "X", language: "react" }),
      tc("write_sandbox_file", { projectId: "p1", path: "a.js", content: "v1" }),
      tc("write_sandbox_file", { projectId: "p1", path: "a.js", content: "v2" }), // no new file → stagnant 1
      tc("write_sandbox_file", { projectId: "p1", path: "a.js", content: "v3" }), // stagnant 2 → BREAK
      tc("write_sandbox_file", { projectId: "p1", path: "a.js", content: "v4" }), // should never run
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "gemma3:4b",
      tools: tools(),
      userPrompt: "build a thing",
      transport,
      maxTurns: 12,
      hooks: { approveToolCall: autoApprove },
    });
    // Broke at turn 3 (0-indexed) → 4 transport calls, not all 12.
    expect(calls()).toBe(4);
    expect(result.endedBy).toBe("terminal");
  });

  it("does NOT break a legitimate fix-the-failed-run cycle", async () => {
    // create(a.js) → run FAILS → re-write a.js (a fix, not churn) →
    // run SUCCEEDS. The re-write of a.js doesn't grow the file count,
    // but it happens in a `ran-failed` state, so it's exempt.
    const { transport, calls } = scripted([
      tc("create_sandbox_project", { name: "X", language: "react", files: [{ path: "a.js", content: "v1" }] }),
      tc("run_sandbox_project", { projectId: "p1" }), // fails (runResults[0]=false)
      tc("write_sandbox_file", { projectId: "p1", path: "a.js", content: "fixed" }), // re-write — exempt
      tc("run_sandbox_project", { projectId: "p1" }), // succeeds (runResults[1]=true)
      { content: "All done — the build passes." },
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: tools([false, true]),
      userPrompt: "build a thing",
      transport,
      maxTurns: 12,
      hooks: { approveToolCall: autoApprove },
    });
    // The full 5-step cycle ran — the breaker didn't cut the fix short.
    expect(calls()).toBe(5);
    expect(result.endedBy).toBe("terminal");
  });
});

describe("orphan pruning on terminal", () => {
  it("auto-removes a file nothing imports from a freshly-created project", async () => {
    const store = new Map<string, string>();
    const pruned: string[] = [];
    const { transport } = scripted([
      // Create with two files inline: App.jsx imports only styles.css.
      tc("create_sandbox_project", {
        name: "X",
        language: "react",
        files: [
          { path: "src/App.jsx", content: "import './styles.css';\nexport default function App(){return <div/>;}" },
          { path: "src/styles.css", content: "body{}" },
        ],
      }),
      // Then write an ORPHAN component nothing imports.
      tc("write_sandbox_file", { projectId: "p1", path: "src/Unused.jsx", content: "export default function U(){return null;}" }),
      { content: "Done." }, // terminal
    ]);
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: tools([], store),
      userPrompt: "build a thing",
      transport,
      maxTurns: 12,
      hooks: { approveToolCall: autoApprove, onOrphanPruned: (p) => pruned.push(...p) },
    });
    expect(result.endedBy).toBe("terminal");
    // The orphan was deleted from the project; the imported files stay.
    expect(store.has("src/Unused.jsx")).toBe(false);
    expect(store.has("src/App.jsx")).toBe(true);
    expect(store.has("src/styles.css")).toBe(true);
    expect(pruned).toEqual(["src/Unused.jsx"]);
  });

  it("does NOT prune when disabled", async () => {
    const store = new Map<string, string>();
    const { transport } = scripted([
      tc("create_sandbox_project", {
        name: "X",
        language: "react",
        files: [{ path: "src/App.jsx", content: "export default function App(){return <div/>;}" }],
      }),
      tc("write_sandbox_file", { projectId: "p1", path: "src/Unused.jsx", content: "export default function U(){return null;}" }),
      { content: "Done." },
    ]);
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "sys",
      model: "qwen2.5-coder:7b",
      tools: tools([], store),
      userPrompt: "build a thing",
      transport,
      maxTurns: 12,
      pruneOrphans: false,
      hooks: { approveToolCall: autoApprove },
    });
    expect(store.has("src/Unused.jsx")).toBe(true);
  });
});
