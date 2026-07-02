/// Curated per-release "what's new" notes, shown once by the
/// post-update ChangelogModal the first time the app runs on a new
/// version.
///
/// Add a new entry (newest first) as part of each release. The modal's
/// CHROME (title / buttons) is localized via i18n; the `highlights`
/// text here is release-note content and stays in English (it changes
/// every release — localizing each release's notes across every locale
/// would be per-release upkeep). A version with no entry falls back to
/// a generic "updated to X — see the release notes" message, so the
/// modal never shows a raw or empty body.

export interface ChangelogEntry {
  version: string;
  /// ISO yyyy-mm-dd, for display. Empty string = hide the date line.
  date: string;
  /// Short, user-facing bullets. Keep to a handful.
  highlights: string[];
}

/// Newest first.
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "2.7.0",
    date: "2026-07-02",
    highlights: [
      "Practice is here! A full review system built from the lessons you've completed — spaced repetition keeps what you learned fresh.",
      "Two new exercise types: Fill the Gap (complete the missing token) and Memory Rebuild (study the code, then rebuild it — watch out for decoy lines).",
      "A practice dashboard with your daily goal, streak, accuracy, and a two-week activity chart — plus three rotating daily challenges.",
      "Practice only quizzes you on lessons you've actually finished. Not enough yet? It'll tell you to go learn a bit more first.",
      "Rust books now include review questions for every code lesson, and more course translations are live.",
    ],
  },
  {
    version: "2.6.0",
    date: "2026-07-01",
    highlights: [
      "Libre now speaks 17 languages — including Hindi, Arabic, Urdu, Turkish, Bengali, Filipino, Persian/Dari, Nepali, Vietnamese, Indonesian and Swahili — with full right-to-left layout for Arabic, Urdu and Dari.",
      "Instant language switching: choose your language in Settings → General and the whole app updates immediately, no restart needed.",
      "A redesigned language picker that's searchable and scrollable, so finding your language among all 17 is quick.",
      "Anonymous, cookieless usage analytics to help us improve Libre — no personal data, no cross-site tracking, and you can turn it off anytime in Settings → Data & storage.",
      "This “What's new” screen, so you can see what changed after each update.",
    ],
  },
  {
    version: "2.5.2",
    date: "2026-07-01",
    highlights: [
      "Anonymous, cookieless usage analytics to help improve Libre — opt out anytime in Settings → Data & storage.",
      "Reliability and polish fixes.",
    ],
  },
];

/// The curated entry for `version`, or `undefined` if none exists yet.
export function changelogFor(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.version === version);
}
