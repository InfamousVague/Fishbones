/// Chat markdown renderer + streaming sanitizer. The whole point is
/// CLEAN, chat-appropriate output: no lesson chrome, no control
/// plumbing leaking, proper code shells.

import { describe, expect, it } from "vitest";
import {
  decodeB64,
  renderChatMarkdown,
  sanitizeAssistantText,
} from "@/components/organisms/AiAssistant/chatMarkdown";

describe("sanitizeAssistantText", () => {
  it("strips a closed confidence tag (always)", () => {
    expect(sanitizeAssistantText("Done.<confidence>0.9</confidence>")).toBe(
      "Done.",
    );
  });
  it("strips an unterminated confidence tag ONLY while streaming", () => {
    expect(
      sanitizeAssistantText("Working on it <confidence>0.", { streaming: true }),
    ).toBe("Working on it");
    // Not streaming → leave it (don't risk eating prose on a final msg).
    expect(
      sanitizeAssistantText("Working on it <confidence>0."),
    ).toBe("Working on it <confidence>0.");
  });
  it("strips closed tool-call envelopes (always); open ones only while streaming", () => {
    expect(
      sanitizeAssistantText('ok <tool_call>{"name":"x"}</tool_call> done'),
    ).toBe("ok  done");
    expect(
      sanitizeAssistantText('thinking <tools>{"name":"x","argum', {
        streaming: true,
      }),
    ).toBe("thinking");
  });
  it("does NOT eat prose after a bare <tool>/<tools> MENTION on a finished message (regression #6)", () => {
    const prose = "Use the <toolbar> element and the <tools> menu for that.";
    expect(sanitizeAssistantText(prose)).toBe(prose);
    const conf = "Confidence intervals: a <confidence based metric.";
    expect(sanitizeAssistantText(conf)).toBe(conf);
  });
  it("collapses path-tagged file fences ONLY in agent mode", () => {
    const src = "Here you go:\n```jsx:src/App.jsx\nexport default x;\n```\nDone.";
    const agent = sanitizeAssistantText(src, { agentMode: true });
    expect(agent).toContain("▟ src/App.jsx");
    expect(agent).not.toContain("export default");
    // CHAT mode: a colon-info fence is a normal code block — untouched.
    expect(sanitizeAssistantText(src)).toBe(src);
  });
  it("collapses an OPEN (streaming) path-tagged file fence in agent mode", () => {
    const out = sanitizeAssistantText(
      "Writing it now:\n```jsx:src/App.jsx\nexport default function",
      { agentMode: true },
    );
    expect(out).toContain("writing src/App.jsx");
    expect(out).not.toContain("export default function");
  });
  it("leaves a PLAIN code fence (no path) untouched", () => {
    const src = "Example:\n```js\nconst x = 1;\n```";
    expect(sanitizeAssistantText(src, { agentMode: true })).toBe(src);
  });
});

describe("renderChatMarkdown", () => {
  it("renders headings, lists, and inline code as real HTML", async () => {
    const html = await renderChatMarkdown(
      "# Title\n\n- one\n- two\n\nUse `useState` here.",
    );
    expect(html).toContain("<h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("<code>useState</code>");
  });

  it("renders a code block as a chat code shell with copy + lang label", async () => {
    const html = await renderChatMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain('class="libre-chat-code"');
    expect(html).toContain('class="libre-chat-code-copy"');
    expect(html).toContain("libre-chat-code-lang");
    // The copy button carries the base64 source for the panel handler.
    const m = /data-copy="([^"]+)"/.exec(html);
    expect(m).not.toBeNull();
    expect(decodeB64(m![1])).toBe("const x = 1;\n");
  });

  it("collapses a LONG code block into <details>", async () => {
    const long = Array.from({ length: 20 }, (_, i) => `line${i};`).join("\n");
    const html = await renderChatMarkdown("```js\n" + long + "\n```");
    expect(html).toContain("libre-chat-code--long");
    expect(html).toContain("<details");
    expect(html).toContain("20 lines");
  });

  it("does NOT emit lesson chrome (inline-sandbox / section anchors / ask badge)", async () => {
    const html = await renderChatMarkdown(
      "## Heading\n\n```rust playground\nfn main() {}\n```\n\nSome prose.",
    );
    expect(html).not.toContain("libre-inline-sandbox");
    expect(html).not.toContain("data-libre-section");
    expect(html).not.toContain("libre-code-block-ask");
    expect(html).not.toContain("libre-device-action");
    // `playground` info string is just rendered as a normal code block.
    expect(html).toContain("libre-chat-code");
  });

  it("preserves libre:// deep links as anchors the panel can intercept", async () => {
    const html = await renderChatMarkdown(
      "See [Ownership](libre://lesson/rust-book/ownership).",
    );
    expect(html).toContain('href="libre://lesson/rust-book/ownership"');
  });

  it("sanitizes before rendering — control tags never reach HTML", async () => {
    const html = await renderChatMarkdown(
      "All set.<confidence>0.95</confidence>",
    );
    expect(html).not.toContain("confidence");
    expect(html).toContain("All set.");
  });

  it("renders a half-streamed unterminated fence without choking", async () => {
    const html = await renderChatMarkdown("Here:\n```js\nconst x =");
    // Dangling fence is closed internally → still a code shell, no throw.
    expect(html).toContain("libre-chat-code");
  });
});
