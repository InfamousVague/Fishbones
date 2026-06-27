/// ModelPicker on the WEB / mobile surface (isDesktop = false).
///
/// The Tauri commands throw in a browser, so the picker must probe
/// the configured Ollama host over fetch (mirroring useAiChatRemote)
/// and HIDE the pull buttons — installs happen on the host machine,
/// not from the tab. These tests pin that fallback so the header
/// dropdown (which renders on every platform) isn't dead on web.

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force the web surface for this file only.
vi.mock("../../../lib/platform", () => ({
  isDesktop: false,
  isWeb: true,
  isMobile: false,
}));
// Pin a reachable host so aiHostUrl() returns a usable URL.
vi.mock("../../../lib/aiHost", () => ({
  aiHostUrl: (p?: string) => `http://host.local:11434${p ?? ""}`,
  readAiHost: () => "host.local:11434",
}));

import ModelPicker from "../ModelPicker";

function stubFetchTags(names: string[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ models: names.map((name) => ({ name })) }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ModelPicker (web / remote surface)", () => {
  it("probes installed models over fetch, not the Tauri command", async () => {
    const fetchMock = stubFetchTags(["qwen2.5-coder:7b"]);
    render(<ModelPicker currentModel="qwen2.5-coder:7b" onSelect={() => {}} />);

    // The selected model resolves as installed via the fetched tags.
    const row = await screen.findByText("Qwen2.5 Coder 7B");
    expect(row.closest(".libre-model-row")!.className).toContain(
      "libre-model-row--selected",
    );
    // It hit the host's /api/tags over fetch.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://host.local:11434/api/tags",
        expect.anything(),
      ),
    );
  });

  it("hides the Get pull button for not-installed models on web", async () => {
    stubFetchTags(["qwen2.5-coder:7b"]); // gemma NOT installed
    render(<ModelPicker currentModel="qwen2.5-coder:7b" onSelect={() => {}} />);

    const gemmaLabel = await screen.findByText("Gemma 3 4B");
    const gemmaRow = gemmaLabel.closest(".libre-model-row") as HTMLElement;
    // No pull affordance — installs are host-side; a muted hint shows.
    expect(within(gemmaRow).queryByText("Get")).toBeNull();
    expect(within(gemmaRow).getByText("not installed")).toBeTruthy();
  });

  it("surfaces an unreachable host instead of crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    render(<ModelPicker currentModel="qwen2.5-coder:7b" onSelect={() => {}} />);
    expect(await screen.findByText("Ollama offline")).toBeTruthy();
  });
});
