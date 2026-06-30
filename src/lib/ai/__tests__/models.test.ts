/// Ollama model registry + the new settings.model field.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  OLLAMA_MODELS,
  compactModelLabel,
  emulatedBuildTier,
  findModelMeta,
  isKnownModel,
  isModelInstalled,
  isStrongBuilder,
  isToolNative,
  modelParamsB,
  modelTagMatches,
  streamsFilesLive,
} from "@/lib/ai/models";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  mergeSettings,
  saveSettings,
} from "@/lib/aiAgent/settings";

describe("model registry", () => {
  it("has the historical default as a registered model", () => {
    expect(DEFAULT_MODEL_ID).toBe("qwen2.5-coder:7b");
    expect(isKnownModel(DEFAULT_MODEL_ID)).toBe(true);
    expect(findModelMeta(DEFAULT_MODEL_ID)?.tools).toBe("native");
  });

  it("includes Gemma (the user's requested model) flagged as emulated tools", () => {
    const gemma = OLLAMA_MODELS.filter((m) => m.family === "Gemma 3");
    expect(gemma.length).toBeGreaterThan(0);
    for (const g of gemma) expect(g.tools).toBe("emulated");
  });

  it("covers multiple families so the user has real choice", () => {
    const families = new Set(OLLAMA_MODELS.map((m) => m.family));
    expect(families).toContain("Qwen2.5 Coder");
    expect(families).toContain("Gemma 3");
    expect(families).toContain("Llama");
    expect(families).toContain("Mistral");
    expect(families.size).toBeGreaterThanOrEqual(5);
  });

  it("every entry has a valid, non-empty Ollama tag + metadata", () => {
    for (const m of OLLAMA_MODELS) {
      expect(m.id.trim().length).toBeGreaterThan(0);
      expect(m.label.trim().length).toBeGreaterThan(0);
      expect(m.sizeGb).toBeGreaterThan(0);
      expect(m.ramGb).toBeGreaterThan(0);
      expect(["native", "emulated"]).toContain(m.tools);
      expect(["code", "general"]).toContain(m.role);
    }
  });

  it("has unique ids", () => {
    const ids = OLLAMA_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findModelMeta returns null for unknown ids", () => {
    expect(findModelMeta("not-a-real-model:99b")).toBeNull();
    expect(isKnownModel("not-a-real-model:99b")).toBe(false);
  });
});

describe("isToolNative", () => {
  it("reports native for Qwen Coder + Llama + Mistral", () => {
    expect(isToolNative("qwen2.5-coder:7b")).toBe(true);
    expect(isToolNative("llama3.1:8b")).toBe(true);
    expect(isToolNative("mistral:7b")).toBe(true);
  });
  it("reports non-native for Gemma + Phi + DeepSeek", () => {
    expect(isToolNative("gemma3:4b")).toBe(false);
    expect(isToolNative("phi4")).toBe(false);
    expect(isToolNative("deepseek-coder-v2:16b")).toBe(false);
  });
  it("optimistically treats unknown custom models as native", () => {
    expect(isToolNative("my-custom-finetune:latest")).toBe(true);
  });
  it("resolves quant / instruct variants to their base registry tier", () => {
    // Emulated base → variant stays emulated (gets compatibility mode + prompt).
    expect(isToolNative("deepseek-coder-v2:16b-q4_K_M")).toBe(false);
    expect(isToolNative("deepseek-coder-v2:16b-instruct-q5_0")).toBe(false);
    expect(isToolNative("phi4:q8_0")).toBe(false);
    // Native base → variant stays native.
    expect(isToolNative("qwen2.5-coder:7b-instruct-q5_K_M")).toBe(true);
    expect(isToolNative("qwen2.5-coder:14b-q4_0")).toBe(true);
    // A genuinely unknown base is still unknown → optimistic native.
    expect(isToolNative("totally-unknown:13b-q4")).toBe(true);
  });
});

describe("modelTagMatches", () => {
  it("exact match", () => {
    expect(modelTagMatches("gemma3:4b", "gemma3:4b")).toBe(true);
  });
  it("different bases never match", () => {
    expect(modelTagMatches("gemma3:4b", "llama3.1:8b")).toBe(false);
    expect(modelTagMatches("qwen2.5-coder:7b", "qwen2.5-coder:3b")).toBe(false);
  });
  it("bare name matches :latest of same base", () => {
    expect(modelTagMatches("gemma3", "gemma3:latest")).toBe(true);
    expect(modelTagMatches("gemma3:latest", "gemma3")).toBe(true);
  });
  it("same base, same explicit tag matches", () => {
    expect(modelTagMatches("qwen2.5-coder:7b", "qwen2.5-coder:7b")).toBe(true);
  });
});

describe("isModelInstalled", () => {
  it("matches an installed exact tag", () => {
    expect(
      isModelInstalled("qwen2.5-coder:7b", ["qwen2.5-coder:7b", "gemma3:4b"]),
    ).toBe(true);
  });
  it("matches a bare-name install against a registry :latest-style id", () => {
    expect(isModelInstalled("gemma3:1b", ["gemma3:1b"])).toBe(true);
  });
  it("returns false when not installed", () => {
    expect(isModelInstalled("phi4", ["qwen2.5-coder:7b"])).toBe(false);
  });
  it("returns false for an empty install list", () => {
    expect(isModelInstalled("qwen2.5-coder:7b", [])).toBe(false);
  });
});

describe("settings.model field", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the package default model", () => {
    expect(DEFAULT_SETTINGS.model).toBe(DEFAULT_MODEL_ID);
    expect(loadSettings().model).toBe(DEFAULT_MODEL_ID);
  });

  it("roundtrips a chosen model through localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, model: "gemma3:12b" });
    expect(loadSettings().model).toBe("gemma3:12b");
  });

  it("accepts custom (non-registry) model tags", () => {
    expect(mergeSettings({ model: "my-finetune:latest" }).model).toBe(
      "my-finetune:latest",
    );
  });

  it("falls back to default for blank / missing / non-string model", () => {
    expect(mergeSettings({ model: "" }).model).toBe(DEFAULT_MODEL_ID);
    expect(mergeSettings({ model: "   " }).model).toBe(DEFAULT_MODEL_ID);
    expect(mergeSettings({}).model).toBe(DEFAULT_MODEL_ID);
    // @ts-expect-error — deliberately wrong type to exercise the guard
    expect(mergeSettings({ model: 42 }).model).toBe(DEFAULT_MODEL_ID);
  });

  it("trims surrounding whitespace on a valid model", () => {
    expect(mergeSettings({ model: "  llama3.1:8b  " }).model).toBe(
      "llama3.1:8b",
    );
  });
});

describe("compactModelLabel (header dropdown trigger)", () => {
  it("renders family-first-word + params for known models", () => {
    expect(compactModelLabel("qwen2.5-coder:7b")).toBe("Qwen2.5 7B");
    expect(compactModelLabel("gemma3:4b")).toBe("Gemma 4B");
    expect(compactModelLabel("llama3.1:8b")).toBe("Llama 8B");
    expect(compactModelLabel("mistral:7b")).toBe("Mistral 7B");
    expect(compactModelLabel("deepseek-coder-v2:16b")).toBe("DeepSeek 16B");
  });

  it("falls back to the base tag for custom (unknown) models", () => {
    expect(compactModelLabel("my-finetune:latest")).toBe("my-finetune");
  });

  it("truncates an over-long custom base name", () => {
    const out = compactModelLabel("absurdly-long-custom-model-name:latest");
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out.endsWith("…")).toBe(true);
  });

  it("covers every registry model without throwing", () => {
    for (const m of OLLAMA_MODELS) {
      const label = compactModelLabel(m.id);
      expect(label.length).toBeGreaterThan(0);
      expect(label).toContain(m.params);
    }
  });
});

describe("model strength — drives live-streaming + emulated prompt tier", () => {
  it("parses params labels into billions", () => {
    expect(modelParamsB("qwen2.5-coder:7b")).toBe(7);
    expect(modelParamsB("qwen2.5-coder:1.5b")).toBe(1.5);
    expect(modelParamsB("gemma3:4b")).toBe(4);
    expect(modelParamsB("deepseek-coder-v2:16b")).toBe(16);
    expect(modelParamsB("totally-unknown:latest")).toBeNull();
  });

  it("treats native, code-specialist, and large general models as strong", () => {
    expect(isStrongBuilder("qwen2.5-coder:7b")).toBe(true); // native
    expect(isStrongBuilder("deepseek-coder-v2:16b")).toBe(true); // code specialist (emulated)
    expect(isStrongBuilder("phi4")).toBe(true); // 14B general, emulated
    expect(isStrongBuilder("custom-model:latest")).toBe(true); // unknown → optimistic
  });

  it("treats small general emulated models as weak", () => {
    expect(isStrongBuilder("gemma3:4b")).toBe(false);
    expect(isStrongBuilder("gemma3:1b")).toBe(false);
  });

  it("streams files live only for strong builders", () => {
    expect(streamsFilesLive("qwen2.5-coder:7b")).toBe(true);
    expect(streamsFilesLive("deepseek-coder-v2:16b")).toBe(true);
    expect(streamsFilesLive("gemma3:4b")).toBe(false);
  });

  it("tiers the emulated prompt by strength", () => {
    expect(emulatedBuildTier("deepseek-coder-v2:16b")).toBe("strong");
    expect(emulatedBuildTier("gemma3:4b")).toBe("weak");
    expect(emulatedBuildTier("phi4")).toBe("strong");
  });
});
