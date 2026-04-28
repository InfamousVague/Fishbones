/// Mobile reader. Just markdown — body rendered through the same
/// `renderMarkdown` helper the desktop LessonReader uses, so callouts,
/// code highlighting, and tables come out consistent. No glossary
/// popovers, no inline sandboxes, no enrichment chrome — readability
/// over richness on a 6" screen.

import { useEffect, useState } from "react";
import { renderMarkdown } from "../components/Lesson/markdown";
import "./MobileReader.css";

interface Props {
  body: string;
  /// Retained for prop-shape compatibility with the dispatch but no
  /// longer wired to a button — the lesson's bottom Next nav now
  /// owns "mark complete + advance" across every lesson kind, same
  /// as desktop's handleNext.
  onContinue?: () => void;
}

export default function MobileReader({ body }: Props) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void renderMarkdown(body).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [body]);

  // Skeleton-while-loading: render a 4-line shimmer block that
  // matches typical paragraph + heading rhythm so the layout
  // doesn't pop when the markdown finishes rendering. Keeps the
  // user's scroll-position predictable on a slow first paint.
  if (html === null) {
    return (
      <div className="m-reader">
        <div
          className="m-reader__skeleton"
          aria-hidden
          aria-busy="true"
          aria-label="Loading lesson"
        >
          <span className="m-reader__skel-line m-reader__skel-line--head" />
          <span className="m-reader__skel-line" />
          <span className="m-reader__skel-line m-reader__skel-line--short" />
          <span className="m-reader__skel-line" />
        </div>
      </div>
    );
  }

  return (
    <div className="m-reader">
      <article
        // `m-reader__prose--enter` arms the staggered fade-rise
        // animation on the article's direct children (paragraphs,
        // headings, code blocks). The CSS uses a per-child delay
        // so prose composes itself top-to-bottom rather than
        // popping in as one block. `prefers-reduced-motion` short-
        // circuits the animation in the same stylesheet.
        className="m-reader__prose m-reader__prose--enter"
        // Body is markdown rendered to sanitized HTML by markdown-it +
        // Shiki — same pipeline desktop uses.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
