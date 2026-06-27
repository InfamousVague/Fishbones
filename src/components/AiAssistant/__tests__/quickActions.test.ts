/// Composer quick-actions — relevance gating + prompt building.

import { describe, expect, it } from "vitest";
import { visibleQuickActions, QUICK_ACTIONS } from "../quickActions";

describe("visibleQuickActions", () => {
  it("shows nothing with no project, no file, no error", () => {
    expect(visibleQuickActions({})).toEqual([]);
  });

  it("surfaces Fix the error ONLY when there's a last error", () => {
    expect(visibleQuickActions({ lastError: "boom" }).map((a) => a.id)).toContain(
      "fix-error",
    );
    expect(
      visibleQuickActions({ lastError: "" }).map((a) => a.id),
    ).not.toContain("fix-error");
    expect(visibleQuickActions({}).map((a) => a.id)).not.toContain("fix-error");
  });

  it("surfaces project + file actions when those exist", () => {
    const ids = visibleQuickActions({
      projectName: "Blackjack",
      openFile: "src/App.jsx",
    }).map((a) => a.id);
    expect(ids).toContain("explain");
    expect(ids).toContain("add-tests");
    expect(ids).toContain("comment");
  });
});

describe("quick-action prompts", () => {
  it("Fix the error embeds the error text and asks to re-run", () => {
    const a = QUICK_ACTIONS.find((x) => x.id === "fix-error")!;
    const p = a.prompt({ lastError: "TypeError: x is undefined" });
    expect(p).toContain("TypeError: x is undefined");
    expect(p.toLowerCase()).toContain("run it again");
  });

  it("Fix the error caps a huge error", () => {
    const a = QUICK_ACTIONS.find((x) => x.id === "fix-error")!;
    const p = a.prompt({ lastError: "e".repeat(5000) });
    expect(p).toContain("…(truncated)");
    expect(p.length).toBeLessThan(5000);
  });

  it("Explain names the project and forbids changes", () => {
    const a = QUICK_ACTIONS.find((x) => x.id === "explain")!;
    const p = a.prompt({ projectName: "Snake" });
    expect(p).toContain("Snake");
    expect(p.toLowerCase()).toContain("don't change");
  });

  it("Add comments targets the open file in place", () => {
    const a = QUICK_ACTIONS.find((x) => x.id === "comment")!;
    const p = a.prompt({ openFile: "src/game.js" });
    expect(p).toContain("src/game.js");
    expect(p.toLowerCase()).toContain("in place");
  });
});
