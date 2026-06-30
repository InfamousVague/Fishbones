/// Header quick-settings dropdowns — the user-facing ask: "see
/// these settings in a dropdown in the AI header along with an
/// effort selector that goes up to ultra." Covers compact trigger
/// labels, the effort dial (incl. the new Ultra rung), and the
/// model dropdown wrapping the full ModelPicker.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TrayHeader from "@/components/organisms/TrayPanel/TrayHeader";
import { DEFAULT_SETTINGS, type AiAgentSettings } from "@/lib/aiAgent/settings";
import { installMockTauri } from "@/test/mockTauri";

beforeEach(async () => {
  localStorage.clear();
  // Side effect: rebinds the global Tauri invoke mock so the model
  // dropdown's ModelPicker can probe installed models.
  await installMockTauri({
    ai_chat_probe: () => ({
      reachable: true,
      models: ["qwen2.5-coder:7b", "llama3.1:8b"],
      has_default_model: true,
      error: null,
    }),
  });
});

function renderHeader(
  settings: AiAgentSettings,
  onUpdateSettings = vi.fn(),
) {
  render(
    <TrayHeader
      mode="agent"
      setMode={() => {}}
      probe={{ reachable: true, models: [], hasDefaultModel: true, error: null }}
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      sessions={[]}
      activeId="x"
      onSelectSession={() => {}}
      onNewSession={() => {}}
      onDeleteSession={() => {}}
    />,
  );
  return onUpdateSettings;
}

describe("TrayHeader quick-settings dropdowns", () => {
  it("shows compact model + effort trigger labels", () => {
    renderHeader({ ...DEFAULT_SETTINGS, model: "gemma3:12b", effort: "thorough" });
    // Compact model label (family first word + params).
    expect(screen.getByText("Gemma 12B")).toBeTruthy();
    // Effort trigger reflects the current rung.
    expect(screen.getByText("Thorough")).toBeTruthy();
  });

  it("offers an Ultra effort option that writes effort: ultra", async () => {
    const onUpdate = renderHeader({ ...DEFAULT_SETTINGS, effort: "balanced" });
    // Open the effort dropdown (its trigger reads "Balanced").
    await act(async () => {
      screen.getByText("Balanced").click();
    });
    // The Ultra rung is present (above thorough) and selectable.
    const ultra = await screen.findByText("Ultra");
    await act(async () => {
      ultra.click();
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ effort: "ultra" }),
    );
  });

  it("model dropdown wraps the picker and writes the chosen model", async () => {
    const onUpdate = renderHeader({
      ...DEFAULT_SETTINGS,
      model: "qwen2.5-coder:7b",
    });
    // Open the model dropdown (trigger reads the compact "Qwen2.5 7B").
    await act(async () => {
      screen.getByText("Qwen2.5 7B").click();
    });
    // The ModelPicker mounts + probes; an installed alternative shows
    // a "Use" affordance.
    const llamaLabel = await screen.findByText("Llama 3.1 8B");
    const row = llamaLabel.closest(".libre-model-row") as HTMLElement;
    await act(async () => {
      within(row).getByText("Use").click();
    });
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "llama3.1:8b" }),
      ),
    );
  });
});
