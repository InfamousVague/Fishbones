/// Tour-step list resolved into runtime values.
///
/// The text + selector data lives in `tourSteps.json` so the
/// narration script (`scripts/generate-tour-audio.mjs`) can read it
/// without going through TypeScript. This file imports that JSON,
/// looks up each step's icon by name from the @base icon registry,
/// and exposes the resulting `TOUR_STEPS` array to the React Tour
/// component.
///
/// To add or edit a step:
///   1. edit `tourSteps.json`
///   2. if you reference a new icon name, add it to `ICON_LOOKUP`
///      below
///   3. re-run `node scripts/generate-tour-audio.mjs` to refresh the
///      narration MP3s — only steps whose text changed get
///      re-synthesised (cache-keyed on the spoken-text hash, same as
///      the lesson audio pipeline).

import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { listTree } from "@base/primitives/icon/icons/list-tree";
import { bookHeadphones } from "@base/primitives/icon/icons/book-headphones";
import { terminal } from "@base/primitives/icon/icons/terminal";
import { blocks } from "@base/primitives/icon/icons/blocks";
import { swords } from "@base/primitives/icon/icons/swords";
import { compass } from "@base/primitives/icon/icons/compass";
import { flame } from "@base/primitives/icon/icons/flame";
import tourData from "./tourSteps.json";

export type TourPage =
  | "library"
  | "discover"
  | "challenges"
  | "practice"
  | "sandbox"
  | "courses"
  | "profile";

export interface TourStep {
  /// Stable id, also doubles as the audio filename stem
  /// (`<id>.<sha7>.mp3`). Same lifecycle as a lesson id —
  /// renaming = re-synthesis, body edits = re-synthesis.
  id: string;
  /// Top-level App view to land on before measuring the target. The
  /// Tour component delays its rect-measure briefly so the new
  /// page's DOM is in place before the spotlight tries to position.
  page: TourPage;
  /// CSS selector resolved against the document at measure time.
  /// When it doesn't match (page has no installed courses, no
  /// lesson open, etc.) the tooltip centers itself and the tour
  /// keeps playing — the body text alone carries the message.
  target: string;
  /// Tooltip placement relative to the target rect. The component
  /// clamps to viewport so a stage-right placement won't push the
  /// tooltip off-screen on a narrow window.
  placement: "top" | "bottom" | "left" | "right";
  /// Icon shown inside the tooltip's header chip. Resolved from
  /// `ICON_LOOKUP` below by name.
  icon: string;
  /// Hex colour for the icon's chip + ring. Picked per-step to
  /// give each section a memorable accent without going pastel.
  iconColor: string;
  title: string;
  body: string;
}

/// Hand-maintained name → icon mapping. Keep in sync with the
/// `icon` field values in `tourSteps.json`. New names need an
/// entry here AND the corresponding import at the top of this
/// file. The narration script doesn't care about icons, so it
/// won't catch a missed entry — TypeScript's exhaustive lookup
/// below will.
const ICON_LOOKUP: Record<string, string> = {
  sparkles,
  "library-big": libraryBig,
  "list-tree": listTree,
  "book-headphones": bookHeadphones,
  terminal,
  blocks,
  swords,
  compass,
  flame,
};

/// Resolved steps the React component consumes. We resolve eagerly
/// at module import so a typo in `tourSteps.json` → "icon name not
/// found" surfaces at app startup, not deep inside a render frame.
export const TOUR_STEPS: TourStep[] = tourData.steps.map((s) => {
  const icon = ICON_LOOKUP[s.icon];
  if (!icon) {
    throw new Error(
      `[tourSteps] unknown icon name "${s.icon}" for step "${s.id}". ` +
        `Add to ICON_LOOKUP in tourSteps.ts and import the icon module.`,
    );
  }
  return {
    id: s.id,
    page: s.page as TourPage,
    target: s.target,
    placement: s.placement as TourStep["placement"],
    icon,
    iconColor: s.iconColor,
    title: s.title,
    body: s.body,
  };
});

/// Surface the source-of-truth tour id so the audio manifest the
/// narration script writes can be matched against the steps the app
/// actually has — useful when an old MP3 cache is still on disk
/// from a previous tour version. Caller can compare and prune.
export const TOUR_ID: string = tourData.tour_id;
