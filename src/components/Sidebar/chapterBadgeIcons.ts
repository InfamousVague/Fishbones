/// Shared badge-icon picker for the active-course chrome. Two
/// surfaces consume this:
///
///   - `CertStamps` — the row of holographic stamps that used to
///     sit below the MiniCertBanner. Each chapter gets one stamp.
///   - `MiniCertBanner` — the badge punch-hole grid INSIDE the
///     cert body. Each chapter gets one badge cell; completed
///     chapters render as a darkened icon-shaped "punch hole" in
///     the parchment.
///
/// Centralising the icon palette + the chapter-id → icon mapping
/// here means both surfaces show the SAME icon for the same
/// chapter — important for users who'd otherwise see one icon on
/// the cert and a different one on the stamps below it and wonder
/// which is canonical.

import { book } from "@base/primitives/icon/icons/book";
import { brain } from "@base/primitives/icon/icons/brain";
import { compass } from "@base/primitives/icon/icons/compass";
import { cpu } from "@base/primitives/icon/icons/cpu";
import { crown } from "@base/primitives/icon/icons/crown";
import { feather } from "@base/primitives/icon/icons/feather";
import { flame } from "@base/primitives/icon/icons/flame";
import { gem } from "@base/primitives/icon/icons/gem";
import { key } from "@base/primitives/icon/icons/key";
import { leaf } from "@base/primitives/icon/icons/leaf";
import { lightbulb } from "@base/primitives/icon/icons/lightbulb";
import { medal } from "@base/primitives/icon/icons/medal";
import { rocket } from "@base/primitives/icon/icons/rocket";
import { shield } from "@base/primitives/icon/icons/shield";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { star } from "@base/primitives/icon/icons/star";
import { swords } from "@base/primitives/icon/icons/swords";
import { target } from "@base/primitives/icon/icons/target";
import { wand } from "@base/primitives/icon/icons/wand";
import { zap } from "@base/primitives/icon/icons/zap";

/// Curated icon palette — ~20 entries so even a 15-chapter course
/// gets reasonable variety before an icon repeats. Order is
/// irrelevant; selection is hash-based.
export const STAMP_ICONS: ReadonlyArray<string> = [
  book,
  brain,
  compass,
  cpu,
  crown,
  feather,
  flame,
  gem,
  key,
  leaf,
  lightbulb,
  medal,
  rocket,
  shield,
  sparkles,
  star,
  swords,
  target,
  wand,
  zap,
];

/// FNV-1a-style scramble of a chapter id → 32-bit integer. Same
/// id always hashes to the same value across reloads, so badge
/// icons stay stable.
function hash32(s: string | undefined): number {
  let h = 0x811c9dc5;
  // Some imported courses ship chapters without an `id`. A decorative
  // badge hash must never crash the app, so treat a missing id as an
  // empty string (those chapters fall back to a default badge).
  const str = s ?? "";
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h);
}

/// Pick the badge icon for a chapter, deterministically.
export function pickIcon(chapterId: string): string {
  return STAMP_ICONS[hash32(chapterId) % STAMP_ICONS.length];
}

/// Slight rotation jitter for the badge punch-hole grid. Range is
/// roughly ±9° so the badges read as "punched semi-randomly" —
/// askew enough to feel hand-applied, not so wild they look
/// broken. Returns degrees as a number, ready to drop into a
/// `transform: rotate(${n}deg)` style.
///
/// Hash-derived so the same chapter id always picks the same
/// rotation. Two hashes are combined (chapter id + a "rotation"
/// salt) so the icon choice and the rotation aren't perfectly
/// correlated — without the salt, every "book" badge across the
/// app would rotate the same direction.
export function chapterRotation(chapterId: string): number {
  const h = hash32(chapterId + ":rotation");
  // -90 → +90 across a byte, then dampen to -9 → +9 degrees so
  // the askew is subtle rather than obvious.
  const signed = (h % 180) - 90;
  return signed / 10;
}
