/// Typed convenience wrappers around `analytics.trackEvent`.
///
/// Every event in the dashboard maps to one function here. Keeps
/// the call sites tight (`track.lessonRun({...})` vs the longer
/// `void import("./analytics").then(({ trackEvent }) => ...)`
/// pattern) and makes the prop shapes type-checked at the call
/// site instead of stringly-typed inside each handler.
///
/// Consent gate: every wrapper short-circuits when the user has
/// opted out (or under tests) BEFORE dynamically importing the
/// analytics engine, so an opted-out session never pulls in the
/// script-injection / fetch code. Which transport actually fires
/// (web hosted script vs desktop direct POST) is decided inside
/// `analytics.trackEvent` — both web AND desktop report now.
///
/// Adding a new event: add a method here, pick a prop shape that
/// you'll commit to (Plausible's UI breaks down events by prop
/// values, so the keys are part of the schema), and call from
/// every site that should fire it. If two call sites would fire
/// different prop shapes, that's a signal they should be two
/// different events.

import { readAnalyticsEnabled } from "./analyticsSettings";

type Props = Record<string, string | number | boolean>;

/// Internal: the dynamic-import pattern the rest of the app uses.
/// The cheap opt-out / test gate happens here so we don't pull in the
/// analytics engine when it would no-op anyway, and so the wrapper
/// methods below can stay one-liners.
function fire(name: string, props?: Props): void {
  if (import.meta.env.MODE === "test") return;
  if (!readAnalyticsEnabled()) return;
  void import("./analytics").then(({ trackEvent }) => {
    trackEvent(name, props);
  });
}

export const track = {
  // ── Acquisition ─────────────────────────────────────────────
  /// User clicked a "Download for X" button — either on the
  /// floating install banner, the welcome screen primary CTA,
  /// or anywhere else `DownloadButton` mounts. Props let us
  /// see the OS split without needing per-OS goals.
  installClick(os: "macos" | "windows" | "linux"): void {
    fire("install.click", { os });
  },

  // ── Activation ──────────────────────────────────────────────
  /// User created a new account. `method` distinguishes which
  /// flow (OAuth provider vs email signup); the OAuth case
  /// fires from the deep-link landing handler in App.tsx.
  signup(method: "apple" | "google" | "email"): void {
    fire("signup", { method });
  },
  /// Existing user signed in. Same prop shape as `signup` so
  /// the dashboard can break out flow popularity.
  signin(method: "apple" | "google" | "email"): void {
    fire("signin", { method });
  },
  /// User installed a course from the library / catalog /
  /// import dialog. `source` records WHERE the install
  /// originated so we can compare discoverability paths.
  courseInstall(props: {
    courseId: string;
    source: "library" | "discover" | "import" | "agent";
  }): void {
    fire("course.install", props);
  },

  // ── Engagement ──────────────────────────────────────────────
  /// LessonView mounted with a specific lesson. Paired with
  /// `lesson.complete` for funnel analysis ("what % of lessons
  /// started get finished?"). Fires once per mount, NOT once
  /// per re-render.
  lessonStart(props: {
    courseId: string;
    lessonId: string;
    kind: string;
  }): void {
    fire("lesson.start", props);
  },
  /// User clicked Run. Captures both success and failure paths
  /// so we can compute pass-rate per course / language.
  lessonRun(props: {
    courseId: string;
    lessonId: string;
    language: string;
    passed: boolean;
  }): void {
    fire("lesson.run", props);
  },
  /// AI assistant panel opened (orb clicked or otherwise
  /// programmatically surfaced). `mode` distinguishes chat
  /// from agent without forcing two separate events.
  aiOpen(mode: "chat" | "agent"): void {
    fire("ai.open", { mode });
  },
  /// User submitted a prompt. `context` distinguishes where
  /// the assistant is running (in a lesson, the sandbox, the
  /// tray, or free-form) so we can see which surfaces drive
  /// the most actual usage.
  aiSend(props: {
    mode: "chat" | "agent";
    context: "lesson" | "sandbox" | "tray" | "free";
  }): void {
    fire("ai.send", props);
  },
  /// AI produced a result — stream finished or errored. `ok=false`
  /// captures failures so we can watch the local-model error rate.
  aiResult(props: { mode: "chat" | "agent"; ok: boolean }): void {
    fire("ai.result", props);
  },
  /// User accepted an AI suggestion / applied an agent diff.
  aiApply(mode: "chat" | "agent"): void {
    fire("ai.apply", { mode });
  },

  // ── Lessons (deeper funnel) ─────────────────────────────────
  /// Learner finished a lesson (all checks passed / marked done).
  /// Pairs with `lesson.start` for completion-rate per course.
  lessonComplete(props: {
    courseId: string;
    lessonId: string;
    language: string;
  }): void {
    fire("lesson.complete", props);
  },
  /// Learner revealed a hint.
  lessonHint(props: { courseId: string; lessonId: string }): void {
    fire("lesson.hint", props);
  },
  /// Learner reset their code back to the starter template.
  lessonReset(props: { courseId: string; lessonId: string }): void {
    fire("lesson.reset", props);
  },
  /// Learner revealed the reference solution.
  lessonSolution(props: { courseId: string; lessonId: string }): void {
    fire("lesson.solution", props);
  },
  /// Learner moved to the next / previous lesson via the nav.
  lessonNav(dir: "next" | "prev"): void {
    fire("lesson.nav", { dir });
  },

  // ── Sandbox ─────────────────────────────────────────────────
  /// Free-play sandbox opened.
  sandboxOpen(language: string): void {
    fire("sandbox.open", { language });
  },
  /// Code run in the sandbox (not tied to a lesson).
  sandboxRun(props: { language: string; ok: boolean }): void {
    fire("sandbox.run", props);
  },

  // ── Courses / library ───────────────────────────────────────
  /// A course was opened (its lesson list / first lesson surfaced).
  courseOpen(courseId: string): void {
    fire("course.open", { courseId });
  },
  /// A course was removed from the library.
  courseUninstall(courseId: string): void {
    fire("course.uninstall", { courseId });
  },
  /// A book was ingested into a course. `kind` = source format,
  /// `ok` = whether ingestion succeeded.
  courseImport(props: {
    kind: "pdf" | "epub" | "academy" | "url";
    ok: boolean;
  }): void {
    fire("course.import", props);
  },
  /// A course archive was exported / shared.
  courseExport(courseId: string): void {
    fire("course.export", { courseId });
  },
  /// The library search box was used. We record ONLY that a search
  /// happened — never the query text — a privacy-safe signal that
  /// discovery-by-search is in use.
  librarySearch(): void {
    fire("library.search");
  },
  /// A catalog filter facet was applied (language / topic / status).
  libraryFilter(facet: string): void {
    fire("library.filter", { facet });
  },

  // ── Personalisation ─────────────────────────────────────────
  /// The colour theme was changed.
  themeChange(theme: string): void {
    fire("theme.change", { theme });
  },
  /// A boolean/enum setting was flipped. `key` identifies which one;
  /// `value` is its new value (short strings/bools only).
  settingChange(props: {
    key: string;
    value: string | number | boolean;
  }): void {
    fire("setting.change", props);
  },

  // ── Progress / rewards ──────────────────────────────────────
  /// A chapter or whole book was completed (the section-complete
  /// banner surface).
  sectionComplete(kind: "chapter" | "book"): void {
    fire("section.complete", { kind });
  },
  /// The daily streak was extended.
  streakExtend(days: number): void {
    fire("streak.extend", { days });
  },
  /// An achievement / badge was unlocked.
  achievementUnlock(id: string): void {
    fire("achievement.unlock", { id });
  },

  // ── Lifecycle ───────────────────────────────────────────────
  /// The app finished booting to an interactive state. Fired once
  /// per launch from `App.tsx` — the coarse "sessions" counter.
  sessionStart(): void {
    fire("session.start");
  },
  /// The updater funnel: a check ran, an update was offered, a
  /// download started, an install applied. One event with a `stage`
  /// breakdown rather than four near-identical goals.
  update(stage: "check" | "available" | "download" | "install"): void {
    fire("update", { stage });
  },
};
