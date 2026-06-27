/// Chat transport wiring — the model the header dropdown selected
/// AND the effort rung both have to reach `ai_chat_stream` on the
/// wire. (Previously the chat path was model-only + effort-blind;
/// these tests pin both so a regression can't silently drop them.)

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installMockTauri, type MockTauriHandle } from "../../test/mockTauri";
import { useAiChatLocal } from "../useAiChat";

let tauri: MockTauriHandle;

beforeEach(async () => {
  localStorage.clear();
  tauri = await installMockTauri({
    // Mount-time probe + status checks — benign so the hook settles.
    ai_chat_probe: () => ({
      reachable: true,
      models: ["qwen2.5-coder:7b", "gemma3:12b"],
      has_default_model: true,
      error: null,
    }),
    ai_chat_install_status: () => ({
      ollama_installed: true,
      homebrew_installed: true,
    }),
    // The stream command resolves immediately; we only inspect its args.
    ai_chat_stream: () => null,
  });
});

function streamArgs(): Record<string, unknown> {
  const call = tauri.invoke.mock.calls.find((c) => c[0] === "ai_chat_stream");
  expect(call, "ai_chat_stream should have been invoked").toBeTruthy();
  return (call![1] ?? {}) as Record<string, unknown>;
}

describe("useAiChatLocal model + effort wiring", () => {
  it("sends the selected model + resolved Ultra knobs to ai_chat_stream", async () => {
    const { result } = renderHook(() => useAiChatLocal("gemma3:12b", "ultra"));
    await act(async () => {
      await result.current.send("hi");
    });
    const args = streamArgs();
    expect(args.model).toBe("gemma3:12b");
    expect(args.temperature).toBe(0.6);
    expect(args.numCtx).toBe(32768);
    expect(args.numPredict).toBe(8192);
  });

  it("maps Balanced effort to its tuned knobs", async () => {
    const { result } = renderHook(() =>
      useAiChatLocal("qwen2.5-coder:7b", "balanced"),
    );
    await act(async () => {
      await result.current.send("hi");
    });
    const args = streamArgs();
    expect(args.temperature).toBe(0.4);
    expect(args.numCtx).toBe(8192);
    expect(args.numPredict).toBe(-1);
  });

  it("omits effort knobs entirely when no effort is set (Ollama defaults)", async () => {
    const { result } = renderHook(() => useAiChatLocal("qwen2.5-coder:7b"));
    await act(async () => {
      await result.current.send("hi");
    });
    const args = streamArgs();
    expect(args.model).toBe("qwen2.5-coder:7b");
    expect(args.temperature).toBeUndefined();
    expect(args.numCtx).toBeUndefined();
    expect(args.numPredict).toBeUndefined();
  });
});
