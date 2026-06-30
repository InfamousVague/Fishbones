/// Build-state machine + auto-continuation. The deterministic
/// fix for "the model created a project, wrote one file, and
/// stopped to ask what's next".

import { describe, expect, it } from "vitest";
import {
  analyzeBuildState,
  buildContinuationNudge,
  looksLikeBuildRequest,
} from "@/lib/ai/buildState";
import { runAgentLoop } from "@/lib/aiAgent/loop";
import type {
  AgentTransport,
  AgentTurnResponse,
} from "@/lib/aiAgent/types";
import type { ToolDef, ToolResult } from "@/lib/aiTools/types";

function tr(
  name: string,
  ok: boolean,
  payload: Record<string, unknown>,
): ToolResult {
  return {
    toolCallId: `id-${Math.random().toString(36).slice(2, 8)}`,
    name,
    ok,
    content: JSON.stringify(payload),
  };
}

describe("analyzeBuildState", () => {
  it("is idle with an empty timeline", () => {
    expect(analyzeBuildState([]).stage).toBe("idle");
  });

  it("is idle for non-build tool activity", () => {
    const t = [tr("list_courses", true, { data: [] })];
    expect(analyzeBuildState(t).stage).toBe("idle");
  });

  it("tracks created → writing → ran-failed → complete", () => {
    const created = [
      tr("create_sandbox_project", true, { ok: true, projectId: "p1" }),
    ];
    expect(analyzeBuildState(created).stage).toBe("created");

    const writing = [
      ...created,
      tr("write_sandbox_file", true, { ok: true, path: "src/main.rs" }),
    ];
    const wState = analyzeBuildState(writing);
    expect(wState.stage).toBe("writing");
    expect(wState.filesWritten).toEqual(["src/main.rs"]);

    const failed = [
      ...writing,
      tr("run_sandbox_project", false, {
        ok: false,
        error: "error[E0382]: borrow of moved value",
      }),
    ];
    const fState = analyzeBuildState(failed);
    expect(fState.stage).toBe("ran-failed");
    expect(fState.failedRuns).toBe(1);

    const fixed = [
      ...failed,
      tr("apply_sandbox_patch", true, {
        ok: true,
        applied: [{ path: "src/main.rs", op: "write", ok: true }],
      }),
      tr("run_sandbox_project", true, { ok: true, logs: [] }),
    ];
    expect(analyzeBuildState(fixed).stage).toBe("complete");
  });

  it("counts files inlined into the create call", () => {
    const t = [
      tr("create_sandbox_project", true, {
        ok: true,
        projectId: "p1",
        files: [{ path: "index.html" }, { path: "main.js" }],
      }),
    ];
    const s = analyzeBuildState(t);
    expect(s.stage).toBe("writing");
    expect(s.filesWritten.sort()).toEqual(["index.html", "main.js"]);
  });
});

describe("buildContinuationNudge", () => {
  it("returns null for idle and complete", () => {
    expect(buildContinuationNudge(analyzeBuildState([]))).toBeNull();
    const done = [
      tr("create_sandbox_project", true, { ok: true, projectId: "p1" }),
      tr("write_sandbox_file", true, { ok: true, path: "a.js" }),
      tr("run_sandbox_project", true, { ok: true }),
    ];
    expect(buildContinuationNudge(analyzeBuildState(done))).toBeNull();
  });

  it("nudges toward running when files were written but never run", () => {
    const t = [
      tr("create_sandbox_project", true, { ok: true, projectId: "p1" }),
      tr("write_sandbox_file", true, { ok: true, path: "a.js" }),
    ];
    const nudge = buildContinuationNudge(analyzeBuildState(t))!;
    expect(nudge).toContain("never ran");
    expect(nudge).toContain("run_sandbox_project");
  });

  it("nudges toward fixing when the last run failed AND files exist", () => {
    const t = [
      tr("create_sandbox_project", true, { ok: true, projectId: "p1" }),
      tr("write_sandbox_file", true, { ok: true, path: "a.js" }),
      tr("run_sandbox_project", false, { ok: false, error: "boom" }),
    ];
    const nudge = buildContinuationNudge(analyzeBuildState(t))!;
    expect(nudge).toContain("FAILED");
    expect(nudge).toContain("apply_sandbox_patch");
  });

  it("an EMPTY project + a (meaningless) failed run nudges to WRITE FILES, not 'fix the build'", () => {
    // Regression for the empty-project debugging spiral the probe
    // caught: the model fired run_sandbox_project on an empty project
    // (often with a placeholder id), it 'failed', and the old nudge
    // sent the model off to patch a file that doesn't exist.
    const t = [
      tr("create_sandbox_project", true, { ok: true, projectId: "p1" }),
      tr("run_sandbox_project", false, { ok: false, error: "no entry" }),
    ];
    const state = analyzeBuildState(t);
    expect(state.stage).toBe("created");
    const nudge = buildContinuationNudge(state)!;
    expect(nudge).toContain("write_sandbox_file");
    expect(nudge).not.toContain("FAILED");
  });

  it("idle + buildExpected pushes the model to ACT; idle without it stays silent", () => {
    const idle = analyzeBuildState([]);
    expect(idle.stage).toBe("idle");
    expect(buildContinuationNudge(idle)).toBeNull();
    const pushed = buildContinuationNudge(idle, { buildExpected: true })!;
    expect(pushed).toContain("create_sandbox_project");
    expect(pushed.toLowerCase()).toContain("haven't started");
  });

  it("fenceFirst nudges speak fences, not tool calls (weak models)", () => {
    const idle = analyzeBuildState([]);
    const fence = buildContinuationNudge(idle, {
      buildExpected: true,
      fenceFirst: true,
    })!;
    expect(fence).toContain("language:path");
    expect(fence).not.toContain("create_sandbox_project");
  });
});

describe("looksLikeBuildRequest", () => {
  it("matches build requests", () => {
    expect(looksLikeBuildRequest("Build a blackjack game in React")).toBe(true);
    expect(looksLikeBuildRequest("make me a fizzbuzz CLI in python")).toBe(true);
    expect(looksLikeBuildRequest("create a todo app")).toBe(true);
    expect(looksLikeBuildRequest("scaffold a dashboard component")).toBe(true);
  });
  it("does NOT match questions / navigation", () => {
    expect(looksLikeBuildRequest("what is a closure?")).toBe(false);
    expect(looksLikeBuildRequest("find me a lesson on recursion")).toBe(false);
    expect(looksLikeBuildRequest("explain this code")).toBe(false);
  });
});

// ── Loop integration: the nudge actually un-stalls a run ─────

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

function buildTools(runResults: boolean[]): {
  tools: ToolDef[];
  calls: string[];
} {
  const calls: string[] = [];
  let runIdx = 0;
  const tools: ToolDef[] = [
    {
      name: "create_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        calls.push("create");
        return { ok: true, projectId: "p1" };
      },
    },
    {
      name: "write_sandbox_file",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler(args: { path: string }) {
        calls.push(`write:${args.path}`);
        return { ok: true, path: args.path };
      },
    },
    {
      name: "run_sandbox_project",
      description: "",
      parameters: { type: "object", properties: {} },
      auto: true,
      async handler() {
        calls.push("run");
        const ok = runResults[runIdx] ?? true;
        runIdx += 1;
        return ok
          ? { ok: true, logs: [] }
          : { ok: false, error: "ReferenceError: x is not defined" };
      },
    },
  ];
  return { tools, calls };
}

describe("auto-continuation in the loop", () => {
  it("nudges a model that stalls after writing files, until the run verifies", async () => {
    const { tools, calls } = buildTools([true]);
    const transport = scripted([
      // Turn 1: create + write.
      {
        content: "",
        toolCalls: [
          { id: "1", name: "create_sandbox_project", arguments: "{}" },
          {
            id: "2",
            name: "write_sandbox_file",
            arguments: JSON.stringify({ path: "main.js", content: "x" }),
          },
        ],
      },
      // Turn 2: model STALLS — terminal text, build unverified.
      { content: "I've written the file. Let me know what's next!" },
      // Turn 3 (post-nudge): model runs the project.
      {
        content: "",
        toolCalls: [
          {
            id: "3",
            name: "run_sandbox_project",
            arguments: JSON.stringify({ projectId: "p1" }),
          },
        ],
      },
      // Turn 4: clean terminal — build is complete, no more nudges.
      { content: "Build verified.\n<confidence>0.9</confidence>" },
    ]);
    const nudges: string[] = [];
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build it",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        onNudge: (n) => nudges.push(n),
      },
      maxTurns: 10,
    });
    expect(nudges).toHaveLength(1);
    expect(calls).toContain("run");
    expect(result.endedBy).toBe("terminal");
    // The nudge message is tagged in the conversation.
    const nudgeMsgs = result.messages.filter(
      (m) => m.role === "user" && (m as { isNudge?: boolean }).isNudge,
    );
    expect(nudgeMsgs).toHaveLength(1);
  });

  it("stops nudging after maxNudges even if the model keeps stalling", async () => {
    const { tools } = buildTools([]);
    const transport = scripted([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "create_sandbox_project", arguments: "{}" },
        ],
      },
      { content: "stall 1" },
      { content: "stall 2" },
      { content: "stall 3" },
    ]);
    const nudges: string[] = [];
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build it",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        onNudge: (n) => nudges.push(n),
      },
      maxTurns: 10,
      maxNudges: 2,
    });
    expect(nudges).toHaveLength(2);
    expect(result.endedBy).toBe("terminal");
  });

  it("does not nudge pure-chat runs (no build activity)", async () => {
    const transport = scripted([
      { content: "Ownership means each value has a single owner." },
    ]);
    const nudges: string[] = [];
    const result = await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools: [],
      userPrompt: "what is ownership?",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        onNudge: (n) => nudges.push(n),
      },
      maxTurns: 5,
    });
    expect(nudges).toHaveLength(0);
    expect(result.endedBy).toBe("terminal");
  });

  it("respects autoContinue: false", async () => {
    const { tools } = buildTools([]);
    const transport = scripted([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "create_sandbox_project", arguments: "{}" },
        ],
      },
      { content: "stalling immediately" },
    ]);
    const nudges: string[] = [];
    await runAgentLoop({
      initialMessages: [],
      systemPrompt: "",
      model: "test",
      tools,
      userPrompt: "build",
      transport,
      hooks: {
        approveToolCall: async () => "approved",
        onNudge: (n) => nudges.push(n),
      },
      maxTurns: 5,
      autoContinue: false,
    });
    expect(nudges).toHaveLength(0);
  });
});
