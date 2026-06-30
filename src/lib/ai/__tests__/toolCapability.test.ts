/// Daemon-aware tool-capability detection — the layer that lets a
/// model the user's Ollama actually reports as tool-capable use the
/// native channel even when the static registry calls it "emulated".
/// These pin: the static fallback, the override on a definitive probe,
/// the "don't cache an unknown answer" rule, and concurrent dedupe.

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  __resetToolCapabilityCache,
  ensureToolCapability,
  hasProbed,
  resolveToolNative,
} from "@/lib/ai/toolCapability";

// Default test target is "desktop" → the Tauri-command branch.
async function setInvoke(impl: (cmd: string, args?: unknown) => unknown) {
  const core = await import("@tauri-apps/api/core");
  (core.invoke as unknown as Mock).mockImplementation(impl as never);
}

function caps(known: boolean, supports_tools: boolean) {
  return { reachable: true, supports_tools, known, error: null };
}

beforeEach(() => {
  localStorage.clear();
  __resetToolCapabilityCache();
  vi.clearAllMocks();
});

describe("resolveToolNative — static fallback", () => {
  it("uses the registry tier before any probe", () => {
    // deepseek-coder-v2:16b is statically "emulated"; qwen native.
    expect(resolveToolNative("deepseek-coder-v2:16b")).toBe(false);
    expect(resolveToolNative("qwen2.5-coder:7b")).toBe(true);
    // Unknown ids are optimistically native.
    expect(resolveToolNative("some-custom-model:latest")).toBe(true);
  });
});

describe("ensureToolCapability — definitive probe overrides the tier", () => {
  it("flips a statically-emulated model to native when the daemon reports tools", async () => {
    await setInvoke((cmd) =>
      cmd === "ai_chat_model_caps"
        ? Promise.resolve(caps(true, true))
        : Promise.resolve(null),
    );
    expect(resolveToolNative("deepseek-coder-v2:16b")).toBe(false);
    await ensureToolCapability("deepseek-coder-v2:16b");
    expect(hasProbed("deepseek-coder-v2:16b")).toBe(true);
    expect(resolveToolNative("deepseek-coder-v2:16b")).toBe(true);
  });

  it("pins a model to emulated when the daemon reports NO tools", async () => {
    await setInvoke(() => Promise.resolve(caps(true, false)));
    await ensureToolCapability("gemma3:4b");
    expect(resolveToolNative("gemma3:4b")).toBe(false);
  });

  it("does NOT cache an inconclusive (old-daemon) answer — keeps the static guess", async () => {
    await setInvoke(() => Promise.resolve(caps(false, false)));
    await ensureToolCapability("deepseek-coder-v2:16b");
    expect(hasProbed("deepseek-coder-v2:16b")).toBe(false);
    expect(resolveToolNative("deepseek-coder-v2:16b")).toBe(false); // static
  });

  it("does NOT cache when the probe throws", async () => {
    await setInvoke(() => Promise.reject(new Error("daemon offline")));
    await ensureToolCapability("phi4");
    expect(hasProbed("phi4")).toBe(false);
  });

  it("dedupes concurrent probes into a single daemon call", async () => {
    let calls = 0;
    await setInvoke((cmd) => {
      if (cmd === "ai_chat_model_caps") {
        calls += 1;
        return Promise.resolve(caps(true, true));
      }
      return Promise.resolve(null);
    });
    await Promise.all([
      ensureToolCapability("deepseek-coder-v2:16b"),
      ensureToolCapability("deepseek-coder-v2:16b"),
      ensureToolCapability("deepseek-coder-v2:16b"),
    ]);
    expect(calls).toBe(1);
    expect(resolveToolNative("deepseek-coder-v2:16b")).toBe(true);
  });

  it("skips the probe entirely once a result is cached", async () => {
    let calls = 0;
    await setInvoke((cmd) => {
      if (cmd === "ai_chat_model_caps") {
        calls += 1;
        return Promise.resolve(caps(true, true));
      }
      return Promise.resolve(null);
    });
    await ensureToolCapability("deepseek-coder-v2:16b");
    await ensureToolCapability("deepseek-coder-v2:16b");
    expect(calls).toBe(1);
  });

  it("persists a definitive result across a cache reset via localStorage", async () => {
    await setInvoke(() => Promise.resolve(caps(true, true)));
    await ensureToolCapability("deepseek-coder-v2:16b");
    // Drop the in-memory cache; the persisted blob should re-hydrate.
    __resetToolCapabilityCache();
    expect(resolveToolNative("deepseek-coder-v2:16b")).toBe(true);
  });
});
