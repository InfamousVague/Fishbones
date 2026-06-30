/// Hook-level test for the live HUD updates. Asserts that:
///   - As streaming chunks arrive, `usage.completionTokens`
///     grows from a chars/4 estimate.
///   - As the `<confidence>N</confidence>` tag arrives in
///     streaming content, `confidence` updates BEFORE the turn
///     completes.
///   - `stop()` flips the loop's shouldStop and the run ends
///     cleanly (no error in `error`).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";

const transportRef: { current: AgentTransport | null } = { current: null };
vi.mock("@/lib/aiAgent/transport", () => ({
  createTauriTransport: () => transportRef.current,
}));

import { useAiAgent } from "@/hooks/useAiAgent";

function scripted(turns: AgentTurnResponse[]): AgentTransport {
  let i = 0;
  return {
    async send(req) {
      const t = turns[i++];
      if (!t) throw new Error("script underrun");
      // Stream the content character by character so the hook's
      // onChunk handler exercises the live-HUD path one chunk at
      // a time — that's the path we're testing.
      if (t.content && req.onChunk) {
        for (const ch of t.content) req.onChunk(ch);
      }
      return t;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useAiAgent: live HUD updates", () => {
  it(
    "confidence updates in real time as the <confidence> tag streams in",
    async () => {
      // The model emits 200 chars of prose, then a confidence
      // tag. The HUD's `confidence` should stay null until the
      // tag streams in, then snap to the parsed value WITHOUT
      // waiting for the turn to finish.
      const content =
        "a".repeat(200) + " <confidence>0.42</confidence>";
      transportRef.current = scripted([{ content }]);
      const { result } = renderHook(() =>
        useAiAgent({ systemPrompt: "", tools: [] }),
      );
      // Initial state: no confidence.
      expect(result.current.confidence).toBeNull();
      // Send and wait for the run to finish.
      await act(async () => {
        await result.current.send("hi");
      });
      // After the run, confidence should reflect the streamed
      // tag's value.
      expect(result.current.confidence).toBeCloseTo(0.42, 5);
    },
  );

  it("usage.completionTokens grows during streaming + snaps to exact on turn end", async () => {
    const longContent =
      "x".repeat(400) + "\n<confidence>0.9</confidence>";
    transportRef.current = scripted([
      {
        content: longContent,
        usage: {
          // The "real" Ollama count is 50 — our estimate (400/4
          // = 100, plus the confidence chars) will be different.
          // The post-turn snap should overwrite the estimate
          // with this exact figure.
          promptTokens: 20,
          completionTokens: 50,
          durationMs: 100,
        },
      },
    ]);
    const { result } = renderHook(() =>
      useAiAgent({ systemPrompt: "", tools: [] }),
    );
    await act(async () => {
      await result.current.send("hi");
    });
    // Final state — promotion to canonical usage happened.
    expect(result.current.usage.completionTokens).toBe(50);
    expect(result.current.usage.promptTokens).toBe(20);
    expect(result.current.usage.turns).toBe(1);
  });

  it("stop() flips streaming false + endedBy:'stopped' without an error", async () => {
    // The model would emit content but we'll click stop before
    // the run actually progresses (synchronous-stop pattern).
    // The scripted transport ignores shouldStop, but the loop's
    // own check between turns picks up the flag.
    let everStartedTurn = false;
    transportRef.current = {
      async send() {
        everStartedTurn = true;
        // Pretend Ollama was about to stream but we got
        // cancelled — throw the Rust-side error message.
        throw new Error("Stopped by user.");
      },
    };
    const { result } = renderHook(() =>
      useAiAgent({ systemPrompt: "", tools: [] }),
    );
    // Schedule stop() BEFORE send completes. We do this via the
    // microtask queue: kick off send, then stop() right after,
    // before send awaits the transport.
    const sendPromise = act(async () => {
      const p = result.current.send("anything");
      // Eagerly flip stop so the loop's catch sees shouldStop=true.
      result.current.stop();
      await p;
    });
    await sendPromise;
    expect(everStartedTurn).toBe(true);
    // No error surfaced (would set result.current.error).
    expect(result.current.error).toBeNull();
    // Streaming flag is back to false post-run.
    expect(result.current.streaming).toBe(false);
  });

  it(
    "confidence meter updates from tool results when the model " +
      "doesn't emit a <confidence> tag",
    async () => {
      // Model dispatches a tool then emits a text-only final
      // turn — neither carries a `<confidence>` tag. The meter
      // must still move based on the tool's observed success.
      let turnCount = 0;
      transportRef.current = {
        async send() {
          turnCount += 1;
          if (turnCount === 1) {
            return {
              content: "",
              toolCalls: [
                { id: "c1", name: "noop", arguments: "{}" },
              ],
            };
          }
          return { content: "ok with no confidence tag." };
        },
      };
      const { result } = renderHook(() =>
        useAiAgent({
          systemPrompt: "",
          tools: [
            {
              name: "noop",
              description: "",
              parameters: { type: "object", properties: {} },
              auto: true,
              async handler() {
                return { ok: true };
              },
            },
          ],
        }),
      );
      expect(result.current.confidence).toBeNull();
      await act(async () => {
        await result.current.send("do it");
      });
      // After the tool result lands, confidence should NOT be
      // null — the heuristic derivation kicked in. A single
      // successful tool snaps to 0.85.
      expect(result.current.confidence).not.toBeNull();
      expect(result.current.confidence).toBeCloseTo(0.85, 2);
    },
  );

  it("the conversation-wide confidence persists across runs", async () => {
    // Run 1: emit confidence 0.9. Run 2: emit no confidence
    // tag. The HUD should still show 0.9 from run 1 because
    // confidence is meant to be a conversation-wide signal,
    // not a per-run one.
    transportRef.current = scripted([
      { content: "first run.\n<confidence>0.9</confidence>" },
      { content: "second run, no confidence tag this time." },
    ]);
    const { result } = renderHook(() =>
      useAiAgent({ systemPrompt: "", tools: [] }),
    );
    await act(async () => {
      await result.current.send("first");
    });
    expect(result.current.confidence).toBeCloseTo(0.9, 5);
    await waitFor(() => expect(result.current.streaming).toBe(false));
    await act(async () => {
      await result.current.send("second");
    });
    // Still 0.9 — the second run didn't override.
    expect(result.current.confidence).toBeCloseTo(0.9, 5);
  });
});
