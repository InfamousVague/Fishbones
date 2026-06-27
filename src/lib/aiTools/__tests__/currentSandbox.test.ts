/// Iter 1 — "the agent knows the open project". When the user has a
/// sandbox project OPEN, the agent's sandbox tools must default to it
/// (so "edit this file" targets the editor), and focusing a project
/// must move the editor.

import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri bridge so the sandbox tools run in jsdom. The mock
// records the id each call targets so we can assert the default.
// `vi.hoisted` so the fn exists before the hoisted `vi.mock` factory.
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (cmd: string) => {
    if (cmd === "sandbox_load_project") {
      return { id: "x", files: [{ name: "a.js", content: "const x = 1;" }] };
    }
    return { ok: true };
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { buildToolRegistry } from "../tools";
import type { ToolContext } from "../tools";
import type { ToolDef } from "../types";
import { EMPTY_SCOPE } from "../scope";

function makeCtx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    courses: [],
    completed: new Set(),
    history: [],
    openLesson: () => {},
    openCourse: () => {},
    // A real open scope (empty allow-set → enforceProject permits all).
    scope: EMPTY_SCOPE,
    updateScope: () => {},
    currentSandbox: null,
    ...over,
  };
}

function tool(ctx: ToolContext, name: string): ToolDef {
  const t = buildToolRegistry(ctx).find((d) => d.name === name);
  if (!t) throw new Error(`tool ${name} missing`);
  return t;
}

const OPEN = {
  projectId: "wc-open",
  name: "My Game",
  language: "javascript",
  activeFilePath: "src/App.jsx",
};

afterEach(() => {
  invokeMock.mockClear();
});

describe("sandbox tools default to the open project", () => {
  it("read_sandbox_file uses currentSandbox.projectId when projectId is omitted", async () => {
    const t = tool(makeCtx({ currentSandbox: OPEN }), "read_sandbox_file");
    await t.handler({ path: "a.js" } as never);
    expect(invokeMock).toHaveBeenCalledWith("sandbox_load_project", {
      id: "wc-open",
    });
  });

  it("read_sandbox_file still honours an explicit projectId over the open one", async () => {
    const t = tool(makeCtx({ currentSandbox: OPEN }), "read_sandbox_file");
    await t.handler({ projectId: "wc-other", path: "a.js" } as never);
    expect(invokeMock).toHaveBeenCalledWith("sandbox_load_project", {
      id: "wc-other",
    });
  });

  it("list_sandbox_files defaults to the open project too", async () => {
    const t = tool(makeCtx({ currentSandbox: OPEN }), "list_sandbox_files");
    await t.handler({} as never);
    expect(invokeMock).toHaveBeenCalledWith("sandbox_load_project", {
      id: "wc-open",
    });
  });

  it("write_sandbox_file errors when there's no projectId AND no open project", async () => {
    const noOpen = tool(makeCtx(), "write_sandbox_file");
    const out = (await noOpen.handler({ path: "a.js", content: "x" } as never)) as {
      error?: boolean;
      message?: string;
    };
    expect(out.error).toBe(true);
    expect(out.message).toContain("'projectId' is required");
    // (The positive default-to-open path is proven by the
    // read_sandbox_file / list_sandbox_files cases above, which assert
    // invoke targets the open project id; exercising the full
    // write_sandbox_file here would run the slow live-type animation.)
  });
});

describe("set_active_project moves the editor", () => {
  it("dispatches libre:sandbox-focus so the open project follows the agent", async () => {
    const focuses: string[] = [];
    const onFocus = (ev: Event) => {
      const d = (ev as CustomEvent<{ projectId?: string }>).detail;
      if (d?.projectId) focuses.push(d.projectId);
    };
    window.addEventListener("libre:sandbox-focus", onFocus);
    try {
      const t = tool(makeCtx(), "set_active_project");
      await t.handler({ projectId: "wc-target" } as never);
      expect(focuses).toEqual(["wc-target"]);
    } finally {
      window.removeEventListener("libre:sandbox-focus", onFocus);
    }
  });

  it("does not dispatch a focus when clearing (empty projectId)", async () => {
    const focuses: string[] = [];
    const onFocus = (ev: Event) => {
      const d = (ev as CustomEvent<{ projectId?: string }>).detail;
      if (d?.projectId) focuses.push(d.projectId);
    };
    window.addEventListener("libre:sandbox-focus", onFocus);
    try {
      const t = tool(makeCtx(), "set_active_project");
      await t.handler({ projectId: "" } as never);
      expect(focuses).toEqual([]);
    } finally {
      window.removeEventListener("libre:sandbox-focus", onFocus);
    }
  });
});
