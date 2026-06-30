/// In-sandbox "Ask AI about this selection" — routing + prompt logic.

import { describe, expect, it } from "vitest";
import {
  buildSelectionAskDisplay,
  buildSelectionAskPrompt,
  selectionAskRoutesToAgent,
  type SandboxSelectionAsk,
} from "@/components/organisms/AiAssistant/selectionAsk";

function ask(over: Partial<SandboxSelectionAsk>): SandboxSelectionAsk {
  return {
    kind: "sandbox-selection",
    action: "explain",
    selectedText: "const x = 1;",
    filePath: "src/App.jsx",
    language: "javascript",
    ...over,
  };
}

describe("selectionAskRoutesToAgent", () => {
  it("explain → chat; improve/comment → agent (they edit)", () => {
    expect(selectionAskRoutesToAgent("explain")).toBe(false);
    expect(selectionAskRoutesToAgent("improve")).toBe(true);
    expect(selectionAskRoutesToAgent("comment")).toBe(true);
  });
});

describe("buildSelectionAskDisplay", () => {
  it("is short, plain, and names the file", () => {
    expect(buildSelectionAskDisplay(ask({ action: "explain" }))).toContain(
      "src/App.jsx",
    );
    expect(buildSelectionAskDisplay(ask({ action: "improve" }))).toMatch(/improve/i);
    expect(buildSelectionAskDisplay(ask({ action: "comment" }))).toMatch(/comment/i);
  });
});

describe("buildSelectionAskPrompt", () => {
  it("explain prompt forbids edits and includes the selection", () => {
    const p = buildSelectionAskPrompt(ask({ action: "explain" }));
    expect(p).toContain("const x = 1;");
    expect(p.toLowerCase()).toContain("do not edit");
  });

  it("improve prompt edits IN PLACE in the open project (no new project)", () => {
    const p = buildSelectionAskPrompt(ask({ action: "improve" }));
    expect(p).toContain("OPEN sandbox project");
    expect(p).toContain("apply_sandbox_patch");
    expect(p.toLowerCase()).toContain("do not create a new project");
  });

  it("comment prompt preserves behaviour", () => {
    const p = buildSelectionAskPrompt(ask({ action: "comment" }));
    expect(p.toLowerCase()).toContain("without changing behaviour");
  });

  it("includes full-file context only when it differs from the selection", () => {
    const withCtx = buildSelectionAskPrompt(
      ask({ selectedText: "a()", fileContent: "function a() {}\na();" }),
    );
    expect(withCtx).toContain("the full file");
    const noCtx = buildSelectionAskPrompt(
      ask({ selectedText: "same", fileContent: "same" }),
    );
    expect(noCtx).not.toContain("the full file");
  });

  it("caps a giant selection", () => {
    const huge = "x".repeat(9000);
    const p = buildSelectionAskPrompt(ask({ selectedText: huge }));
    expect(p).toContain("…(truncated)");
    expect(p.length).toBeLessThan(9000);
  });
});
