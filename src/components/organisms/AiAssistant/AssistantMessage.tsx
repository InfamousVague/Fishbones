/// The one assistant-message bubble, shared by the chat AND agent
/// panels. Replaces the two divergent renderers (`AssistantBody` in
/// AiChatPanel — hard raw→HTML swap at end-of-stream — and
/// `AssistantMarkdownBubble` in AiAgentPanel — 180ms debounce + a DOM
/// pass). One progressive renderer, one stylesheet, one code shell.
///
/// Progressive rendering: markdown is re-rendered on a short debounce
/// as tokens stream in, so the bubble reads as clean formatted
/// markdown THE WHOLE TIME instead of a wall of monospace raw text
/// that suddenly reflows when streaming ends. The renderer sanitizes
/// control plumbing (confidence tags, tool-call envelopes, and — in
/// agent mode — file-write fences) and closes any dangling code fence
/// so a half-streamed block parses cleanly.
///
/// Link clicks + copy buttons are handled by `useBubbleInteractions`
/// on the scroller (one handler per panel), so this component is
/// purely presentational.

import { useEffect, useRef, useState } from "react";
import { renderChatMarkdown, sanitizeAssistantText } from "./chatMarkdown";

/// Re-render cadence while streaming. Short enough to feel live, long
/// enough that we're not re-parsing markdown on every single token.
const RENDER_DEBOUNCE_MS = 90;

export function AssistantMessage({
  content,
  streaming = false,
  agentMode = false,
}: {
  content: string;
  streaming?: boolean;
  /// True in the agent panel, where ```lang:path fences are file
  /// writes (collapsed to a marker) rather than code to render.
  agentMode?: boolean;
}) {
  const [html, setHtml] = useState("");
  const [ready, setReady] = useState(false);
  // First paint renders immediately (no debounce) so the bubble never
  // flashes empty; later streamed updates debounce. A ref — NOT the
  // `ready` state — drives this, so flipping `ready` doesn't re-fire
  // the effect and repaint a stale frame.
  const firstPaintDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const delay = firstPaintDoneRef.current ? RENDER_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      void renderChatMarkdown(content ?? "", { streaming, agentMode }).then(
        (rendered) => {
          if (cancelled) return;
          setHtml(rendered);
          firstPaintDoneRef.current = true;
          setReady(true);
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [content, streaming, agentMode]);

  // Until the first render resolves, show sanitized plain text so the
  // bubble isn't blank for a frame (markdown render is async).
  if (!ready) {
    return (
      <div className="libre-ai-bubble-markdown libre-ai-bubble-markdown--pending">
        {sanitizeAssistantText(content ?? "", { streaming, agentMode })}
      </div>
    );
  }

  return (
    <div
      className={
        "libre-ai-bubble-markdown" +
        (streaming ? " libre-ai-bubble-markdown--streaming" : "")
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
