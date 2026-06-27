/// ModelPicker UI — probe-driven install state, selecting an
/// installed model, and pulling a not-installed one (which then
/// auto-selects). The global invoke mock (src/test/setup.ts) is
/// re-implemented per test to script ai_chat_probe + ai_chat_pull_model.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import ModelPicker from "../ModelPicker";

async function setInvoke(impl: (cmd: string, args?: unknown) => unknown) {
  const core = await import("@tauri-apps/api/core");
  (core.invoke as unknown as Mock).mockImplementation(impl as never);
}

beforeEach(() => {
  localStorage.clear();
});

describe("ModelPicker", () => {
  it("marks the current model selected and renders recommended models", async () => {
    await setInvoke((cmd) => {
      if (cmd === "ai_chat_probe") {
        return Promise.resolve({
          reachable: true,
          models: ["qwen2.5-coder:7b"],
          has_default_model: true,
          error: null,
        });
      }
      return Promise.resolve(null);
    });

    render(
      <ModelPicker currentModel="qwen2.5-coder:7b" onSelect={() => {}} />,
    );

    // The default model's row appears and shows the selected mark.
    const row = await screen.findByText("Qwen2.5 Coder 7B");
    const rowEl = row.closest(".libre-model-row")!;
    expect(rowEl.className).toContain("libre-model-row--selected");

    // Gemma (recommended, the user's requested family) is offered.
    expect(screen.getByText("Gemma 3 4B")).toBeTruthy();
    // Tool-tier badges differentiate native vs emulated.
    expect(within(rowEl as HTMLElement).getByText("tools ✓")).toBeTruthy();
  });

  it("selecting an installed model calls onSelect", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_probe"
        ? Promise.resolve({
            reachable: true,
            models: ["qwen2.5-coder:7b", "llama3.1:8b"],
            has_default_model: true,
            error: null,
          })
        : Promise.resolve(null),
    );
    const onSelect = vi.fn();
    render(
      <ModelPicker currentModel="qwen2.5-coder:7b" onSelect={onSelect} />,
    );

    const llamaLabel = await screen.findByText("Llama 3.1 8B");
    const llamaRow = llamaLabel.closest(".libre-model-row") as HTMLElement;
    // Installed-but-not-selected → shows "Use", row is clickable.
    expect(within(llamaRow).getByText("Use")).toBeTruthy();
    await act(async () => {
      llamaRow.click();
    });
    expect(onSelect).toHaveBeenCalledWith("llama3.1:8b");
  });

  it("pulls a not-installed model then auto-selects it", async () => {
    const pulled: string[] = [];
    await setInvoke((cmd, args) => {
      if (cmd === "ai_chat_probe") {
        // After a pull, gemma shows up as installed.
        return Promise.resolve({
          reachable: true,
          models: pulled.length
            ? ["qwen2.5-coder:7b", "gemma3:4b"]
            : ["qwen2.5-coder:7b"],
          has_default_model: true,
          error: null,
        });
      }
      if (cmd === "ai_chat_pull_model") {
        pulled.push((args as { model: string }).model);
        return Promise.resolve({
          success: true,
          stdout: "",
          stderr: "",
          duration_ms: 10,
        });
      }
      return Promise.resolve(null);
    });
    const onSelect = vi.fn();
    render(
      <ModelPicker currentModel="qwen2.5-coder:7b" onSelect={onSelect} />,
    );

    const gemmaLabel = await screen.findByText("Gemma 3 4B");
    const gemmaRow = gemmaLabel.closest(".libre-model-row") as HTMLElement;
    // Not installed → shows the "Get" pull button.
    const getBtn = within(gemmaRow).getByText("Get");
    await act(async () => {
      getBtn.click();
    });
    // Pull invoked with the right id, then auto-selected on success.
    await waitFor(() => expect(pulled).toContain("gemma3:4b"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("gemma3:4b"));
  });

  it("shows an offline badge when Ollama is unreachable", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_probe"
        ? Promise.resolve({
            reachable: false,
            models: [],
            has_default_model: false,
            error: "connection refused",
          })
        : Promise.resolve(null),
    );
    render(
      <ModelPicker currentModel="qwen2.5-coder:7b" onSelect={() => {}} />,
    );
    expect(await screen.findByText("Ollama offline")).toBeTruthy();
  });

  it("surfaces a hand-pulled custom model as a selectable row", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_probe"
        ? Promise.resolve({
            reachable: true,
            models: ["qwen2.5-coder:7b", "my-weird-finetune:latest"],
            has_default_model: true,
            error: null,
          })
        : Promise.resolve(null),
    );
    const onSelect = vi.fn();
    render(
      <ModelPicker currentModel="qwen2.5-coder:7b" onSelect={onSelect} />,
    );
    const customLabel = await screen.findByText("my-weird-finetune:latest");
    await act(async () => {
      (customLabel.closest(".libre-model-row") as HTMLElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith("my-weird-finetune:latest");
  });
});
