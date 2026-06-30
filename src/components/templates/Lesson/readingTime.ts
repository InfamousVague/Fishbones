/// Reading-time heuristic shared between the desktop `LessonReader`
/// and the mobile `MobileReader`. Lives in its own module so neither
/// reader has to export a non-component helper alongside its default
/// export — Vite's React Fast Refresh requires `.tsx` files to export
/// only React components for HMR to apply, otherwise every save is a
/// full reload.

/// Words-per-minute used for the "time to read" estimate. 225 is a
/// common middle-of-the-road number for skim-to-careful technical
/// reading. We round up at the end so short passages always show at
/// least "1 min read".
const READING_WPM = 225;

/// Cheap reading-time estimate. Strips fenced code blocks from the
/// word count since those aren't read linearly — they're scanned, or
/// skipped entirely, or copy-pasted. Rounds up so a 30-second read
/// still shows as "1 min read" rather than "0 min read".
export function estimateReadingMinutes(md: string): number {
  const prose = md.replace(/```[\s\S]*?```/g, ""); // drop fenced code
  const words = prose.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.max(1, Math.ceil(words / READING_WPM));
}
