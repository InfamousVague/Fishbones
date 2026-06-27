/// The shared Ollama install plumbing behind BOTH the model picker and
/// the steer-to-native card. The desktop path (the one that backs the
/// steer card's one-click pull) maps the Tauri command results into the
/// small { success, error } / { reachable, models, error } shapes the
/// UI consumes — these tests pin that mapping so a result-shape change
/// can't silently dead-end the "Download & switch" button.

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { probeInstalledModels, pullModel } from "../ollamaInstall";

// Default test target is "desktop" (LIBRE_TARGET unset → isDesktop),
// so these exercise the Tauri-command branch.

async function setInvoke(impl: (cmd: string, args?: unknown) => unknown) {
  const core = await import("@tauri-apps/api/core");
  (core.invoke as unknown as Mock).mockImplementation(impl as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("probeInstalledModels (desktop)", () => {
  it("returns the installed tag list from ai_chat_probe", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_probe"
        ? Promise.resolve({
            reachable: true,
            models: ["qwen2.5-coder:7b", "gemma3:4b"],
            has_default_model: true,
            error: null,
          })
        : Promise.resolve(null),
    );
    const r = await probeInstalledModels("qwen2.5-coder:7b");
    expect(r.reachable).toBe(true);
    expect(r.models).toEqual(["qwen2.5-coder:7b", "gemma3:4b"]);
    expect(r.error).toBeNull();
  });

  it("tolerates a probe with no models field", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_probe"
        ? Promise.resolve({ reachable: false, has_default_model: false, error: "down" })
        : Promise.resolve(null),
    );
    const r = await probeInstalledModels();
    expect(r.reachable).toBe(false);
    expect(r.models).toEqual([]);
    expect(r.error).toBe("down");
  });
});

describe("pullModel (desktop)", () => {
  it("maps a successful pull to { success:true, error:'' }", async () => {
    let pulled: string | null = null;
    await setInvoke((cmd, args) => {
      if (cmd === "ai_chat_pull_model") {
        pulled = (args as { model: string }).model;
        return Promise.resolve({ success: true, stdout: "ok", stderr: "", duration_ms: 5 });
      }
      return Promise.resolve(null);
    });
    const r = await pullModel("qwen2.5-coder:7b");
    expect(pulled).toBe("qwen2.5-coder:7b");
    expect(r.success).toBe(true);
    expect(r.error).toBe("");
  });

  it("surfaces stderr on a failed pull", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_pull_model"
        ? Promise.resolve({
            success: false,
            stdout: "",
            stderr: "  pull model manifest: file does not exist  ",
            duration_ms: 5,
          })
        : Promise.resolve(null),
    );
    const r = await pullModel("nope:1b");
    expect(r.success).toBe(false);
    expect(r.error).toBe("pull model manifest: file does not exist");
  });

  it("falls back to a friendly message when stderr is empty", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_pull_model"
        ? Promise.resolve({ success: false, stdout: "", stderr: "", duration_ms: 5 })
        : Promise.resolve(null),
    );
    const r = await pullModel("nope:1b");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Ollama is running/);
  });

  it("maps a thrown invoke error to { success:false }", async () => {
    await setInvoke(() => Promise.reject(new Error("daemon offline")));
    const r = await pullModel("qwen2.5-coder:7b");
    expect(r.success).toBe(false);
    expect(r.error).toBe("daemon offline");
  });
});
