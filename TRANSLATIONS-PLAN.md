# Translations — status & remaining work

_Last updated: 2026-07-06 (session wrap after two session-limit interruptions).
This file is the tracking doc for finishing app + course translation coverage.
Delete sections as they complete._

## Where things stand (shipped / working tree)

**Course content — 7 Rust courses × 7 audience languages (hi ar ur fa bn tr ne),
on top of the earlier hi kr jp es zh work:**

- Translated, repacked into `src-tauri/resources/bundled-packs/*.academy`,
  extracted to per-locale sidecars, archives uploaded to
  `libre.academy/courses/`, catalog deploy in flight.
- TRPL is effectively complete: **11 locales** (`ar bn es fa hi jp kr ne tr ur zh`),
  149–168 of 168 lessons each (missing tails below).
- Batch pipeline lives in `.rust7-work/` (gitignored): `in/` = 942 deterministic
  batch inputs, `out/` = 664 completed outputs, `missing-final.json` = the 278
  still-untranslated batches. Outputs are idempotent (agents skip existing) —
  any rerun only pays for what's missing.

**App chrome (i18n sweep):**

- ~840 new keys wired through `useT()` across settings panes, onboarding wizard,
  AI assistant, docks, dialogs, mobile; `en.json` now carries them
  (433 diff-recovered + 348 journal-mined + repairs). tsc + 703 tests green.
- Localized book titles now render in Library cards (`localizedCourse` wired in
  `CourseCard.tsx` — verified: TRPL shows "रस्ट प्रोग्रामिंग लैंग्वेज" in Hindi).

## Remaining work

### 1. Course batches — 278 missing (`.rust7-work/missing-final.json`)
Mostly two courses that never got agent time before the limits:
`testing-rust` (all 7 locales, 154 batches) and `rustlings` (ne/tr/ur + tails,
104), plus small TRPL tails (ar2 bn2 fa3 ne2 tr6 ur5 — includes the course-title
batches for tr/ur, which is why those titles still fall back to English).
**Resume:** relaunch round-2 workflow (idempotent) or
`Workflow({scriptPath: ".../rust7-fleet-round2.js", resumeFromRunId: "wf_2c9e611a-eae"})`.
Then rerun the merge → repack → extract → upload tail (this session's scripts;
merge script is in the transcript, fence-parity gated).
⚠️ `repack-translations.mjs` REPLACES each lesson's `translations` object with
the artifact's — always hydrate ALL existing locales into the artifact first
(hydrate script pattern) or old locales get clobbered (bit us once; recovered
from git HEAD archives).

### 2. i18n sweep — 7 fixer clusters never ran
`fix:sandbox-runtimes, fix:practice, fix:library-paths, fix:profile-challenges,
fix:mobile, fix:ai-agent-journal, fix:shared-chrome` (session limit), then the
merge + 17-locale delta phases.
**Resume:** `Workflow({scriptPath: ".../i18n-hardcoded-sweep-wf_eabe24a0-fba.js",
resumeFromRunId: "wf_eabe24a0-fba"})` — sweep/filter/8 fixers return cached.
Note: partial edits from the killed fixers were completed by hand
(PracticeSession dueIn keys, ProfileView) — resumed fixers must treat current
tree state as authoritative.

### 3. Copy review — 94 stub keys (`.i18n-stubs.json`)
Keys whose English was auto-derived (humanized key names / heuristic recovery),
e.g. `library.courseSettings.atAGlance: "At aglance"`. Reconcile against the
original literals (in git history of each file) or just proofread in-app.

### 4. UI-string locale coverage — 17 locale files lag en.json
en.json grew ~840 keys; `ru es fr kr jp hi ar ur tr bn tl fa ne vi id sw zh`
have NONE of them yet (English fallback shows meanwhile — safe). The sweep
workflow's Localize phase handles this once phases 2/3 land (translate the
delta only; validate key parity + placeholder preservation).

### 5. Book-title localization — remaining surfaces
Done: Library cards. Still English regardless of locale: reader header/tabs,
sidebar course carousel, Paths step cards, Discover placeholder cards (uses the
same CourseCard — verify), mobile library/reader, command palette, Resume chip.
Pattern: `localizedCourse(course, locale).title` — one-liners at each render site.

### 6. Translated identifiers + unit tests in code examples (NEW, design first)
User wants variable names and test code translated "where supported".
High-risk: must never break compilation/grading. Suggested approach:
- Only translate identifiers in `starter`/`solution`/`tests` TOGETHER, per
  lesson, via AST-aware rename (per-language tooling: rust-analyzer/syn for
  Rust; ts-morph for JS/TS) — never string replace.
- Keep public API names required by hidden tests stable unless tests are
  translated in the same pass; validate by RUNNING the harness per lesson
  per locale (validator exists: `scripts/validate-jsts-course.mjs`; Rust needs
  the desktop toolchain).
- Store as per-locale `starter`/`tests` overrides in the lesson translation
  overlay (schema extension: `LessonTranslation.starter/tests/solution`).
- Pilot on ONE small course (challenges-rust-handwritten easy tier) before
  fleet-scaling.

### 7. Remote-only courses
`rustonomicon`, `solana-programs` have no bundled pack (archives live only on
the VPS). To translate: download archive → hydrate → batch → merge → repack →
re-upload. Not started.

### 8. Known content gaps (fence-parity)
2 items were fence-gated at merge (code-block count mismatch) and stay English;
33 earlier flagged batches were re-queued into round 2 (some in the 278).

## Budget reality
Remaining fleets ≈ 8–10M agent-tokens (278 batches ≈ 6–7M; i18n phases ≈ 2–3M).
Two session limits were hit at ~12M/window — run the two resumes in SEPARATE
windows, course batches first.

### 9. TRPL course-description refresh (found 2026-07-06)
The archive's EN description was the pre-rebrand placeholder ("Auto-generated
by Fishbones' AI pipeline") and had been faithfully translated into 11 locales.
Fixed: EN replaced with the editorial description; translated placeholder
descriptions dropped (EN fallback shows). TODO: one tiny __course__-description
batch × 11 locales. Also audit other archives' in-archive descriptions for the
same placeholder (manifest/Discover is clean — editorial overrides win there).
