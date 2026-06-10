/// libre:// link guard — strips hallucinated deep links from
/// assistant output.
///
/// The prompts teach the model to cite lessons with
/// `libre://lesson/<courseId>/<lessonId>` links, and the chat
/// renderer makes them clickable. Models being models, they
/// sometimes invent plausible-looking ids ("libre://lesson/
/// rust-book/advanced-lifetimes-2") — a dead link that opens
/// nothing is worse than no link: it teaches the learner the
/// links can't be trusted.
///
/// `buildLinkGuard(courses)` returns a content post-processor:
///   - valid links (course + lesson ids exist) pass through
///     untouched;
///   - invalid markdown links collapse to their label text
///     (`[Advanced Lifetimes](libre://…)` → `Advanced Lifetimes`);
///   - invalid bare URIs are removed.
///
/// Wired into the agent loop's `postProcessAssistant` seam so the
/// guard runs once per turn on the cleaned content, before the
/// message is stored or rendered.

import type { Course } from "../../data/types";

const MD_LINK_RE = /\[([^\]]*)\]\((libre:\/\/[^)\s]+)\)/g;
const BARE_URI_RE = /libre:\/\/[^\s)\]>"',;]+/g;

/// Build the set of valid link targets from installed courses.
export function buildLinkIndex(courses: readonly Course[]): Set<string> {
  const valid = new Set<string>();
  for (const c of courses) {
    valid.add(`course/${c.id}`);
    for (const ch of c.chapters) {
      for (const l of ch.lessons) {
        valid.add(`lesson/${c.id}/${l.id}`);
      }
    }
  }
  return valid;
}

function targetKey(uri: string): string | null {
  // libre://lesson/<c>/<l> or libre://course/<c> — normalise off
  // the scheme + trailing slashes/fragments.
  const m = /^libre:\/\/(lesson\/[^/?#]+\/[^/?#]+|course\/[^/?#]+)/.exec(uri);
  return m ? m[1] : null;
}

/// Returns a post-processor bound to the given course index.
/// Pure + cheap: two regex passes per assistant message.
export function buildLinkGuard(
  courses: readonly Course[],
): (content: string) => string {
  const valid = buildLinkIndex(courses);
  const isValid = (uri: string) => {
    const key = targetKey(uri);
    return key !== null && valid.has(key);
  };
  return (content: string) => {
    if (!content || !content.includes("libre://")) return content;
    // Markdown links first (so their URIs don't double-match the
    // bare pass below).
    let out = content.replace(MD_LINK_RE, (full, label: string, uri: string) =>
      isValid(uri) ? full : label,
    );
    // Bare URIs.
    out = out.replace(BARE_URI_RE, (uri) => (isValid(uri) ? uri : ""));
    // Collapse doubled spaces left behind by removals.
    return out.replace(/ {2,}/g, " ");
  };
}
