# Verify course — automated "run every exercise" feature

Goal: from `cmd+K`, kick off a script that walks every exercise in a course, injects the solution, runs it through the live in-browser runtime (the same `runFiles` users hit), and shows a floating panel of pass/fail per lesson. Book-agnostic. Useful for authors, useful before publishing a course, useful for catching runtime drift.

---

## Why this isn't covered by `npm run test:content`

The existing [tests/content/exercises.test.ts](../tests/content/exercises.test.ts) already verifies solution+tests in CI — but it shells out to **local Node toolchains** (`go run`, `rustc`, `node`, etc.). It never exercises:

- Web Worker JS/TS sandbox
- Pyodide
- `solc-js` / new `@ethereumjs/vm` runtime
- React / RN / Web / Svelte / Vyper runtimes
- `harness: "evm"` deploy+call path

So a Solidity contract that compiles fine in the browser, an EVM exercise where `chain.deploy(...)` works against the new runtime, a Vyper lesson — none of them are actually verified end-to-end today. This feature closes that gap by running through the **same** code paths the learner does.

---

## UX

1. `cmd+K` → search "verify" → two new actions
   - **Verify this course** — operates on the currently active course
   - **Verify all courses** — sequences through every loaded course
2. Activating either pops a small floating panel (bottom-right, dismissable, non-blocking) with:
   - Course title + chapter/lesson currently running
   - Progress bar `47 / 84`
   - Live tally `45 ✓  2 ✗  0 ⊘`
   - Scrollable list — one row per exercise, status icon, click ✗ rows to expand the error
   - Cancel button (aborts after current lesson)
3. As each lesson runs, the sidebar/tab bar updates via the existing `selectLesson(courseId, lessonId)` so the user sees the course "scrolling through itself" — no extra navigation code needed.

The overlay is non-modal so the workbench stays interactive; users can keep reading a lesson while verification continues in the background.

---

## Why we don't pipe through the workbench editor

A "fully visual" version would push the solution into the active editor and click Run for real, so the green checkmarks land in the actual UI. That requires a remote-control channel into `Workbench.tsx` — an event bus, a Workbench listener, a callback for the result. Substantial wiring.

Cheaper alternative (recommended): **call `runFiles` directly with the solution files from the course tree, while still calling `selectLesson` per-iteration for sidebar feedback.** The user gets the "scrolling through lessons" effect plus a progress overlay; the workbench editor doesn't flicker, but the verification is using the exact same runtime path. Trade-off documented as a "watch mode" follow-up — easy to add later if the visual flip is wanted.

---

## Architecture

Three new files, two small edits.

### New: `src/lib/verifyCourse.ts`

Pure module, no React. Owns the iteration + reporting:

```ts
export interface LessonVerifyResult {
  courseId: string;
  chapterId: string;
  lesson: ExerciseLesson | MixedLesson;
  result: RunResult | null;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
}

export interface VerifyProgress {
  index: number;     // 0-based current
  total: number;
  current: { courseId; chapterId; lesson } | null;
}

export async function verifyCourse(
  course: Course,
  opts: {
    onProgress: (p: VerifyProgress) => void;
    onResult:   (r: LessonVerifyResult) => void;
    onLessonStart?: (lessonId: string) => void;  // for selectLesson side-effect
    signal?: AbortSignal;
    interLessonDelayMs?: number;  // default 100 — gives the UI a tick
  },
): Promise<LessonVerifyResult[]>
```

Iteration logic: collect exercises via `isExerciseKind`, for each:
- Notify `onLessonStart` so App can call `selectLesson` (visual nav)
- `await new Promise(r => setTimeout(r, opts.interLessonDelayMs))`
- Build `files = deriveSolutionFiles(lesson)`
- Skip when `lesson.solution`/`solutionFiles` is empty (`skipReason: "no solution"`)
- Run: `runFiles(lesson.language, files, lesson.tests, undefined, undefined, lesson.harness)`
- Skip when result is `desktopOnly` on the web build (`skipReason: "desktop-only language"`)
- Otherwise `passed = isPassing(result)`
- Emit progress + result, check `signal.aborted`

### New: `src/components/VerifyCourse/VerifyCourseOverlay.tsx` + `.css`

Floating panel. Hooks into a small `useVerifySession()` zustand-style store (or just `useState` in App.tsx). Renders the progress bar, lesson list, expand-on-click for failed rows, cancel button.

### New: `src/components/VerifyCourse/index.ts`

Barrel.

### Edit: `src/components/CommandPalette/CommandPalette.tsx`

Add to `actions` props:

```ts
verifyCourse?: () => void;       // active course
verifyAllCourses?: () => void;   // every loaded course
```

Add two action entries to `actionPool` mirroring the existing `openLibrary` / `openPlayground` pattern (~10 lines each). Icon: `circleCheck` from `@base/primitives/icon/icons/circle-check`.

### Edit: `src/App.tsx`

Owns the session state + wires the actions:

```ts
const [verifySession, setVerifySession] = useState<VerifySession | null>(null);

const handleVerifyCourse = (course: Course) => {
  const ctrl = new AbortController();
  setVerifySession({ course, results: [], current: null, controller: ctrl });
  verifyCourse(course, {
    signal: ctrl.signal,
    onLessonStart: (lessonId) => selectLesson(course.id, lessonId),
    onProgress: (p) => setVerifySession(s => s ? { ...s, current: p.current, total: p.total, index: p.index } : null),
    onResult: (r) => setVerifySession(s => s ? { ...s, results: [...s.results, r] } : null),
  });
};
```

Pass `verifyCourse: () => activeCourse && handleVerifyCourse(activeCourse)` and `verifyAllCourses: () => sequenceVerify(courses)` to CommandPalette. Mount `<VerifyCourseOverlay session={verifySession} onCancel={...} onClose={...} />` near the top of the App tree.

---

## Edge cases

- **No-tests exercises** — `isPassing(result)` already returns `true` when no tests are expected and no error fired. So compile-only success counts as a pass. Right behavior.
- **Long-loading runtimes** (Pyodide first run, solc download) — first lesson in a Python or Solidity course pays the load cost; subsequent lessons reuse the cached singleton. The progress bar's "currently running" line is enough feedback.
- **Async tests that hang** — wrap each `runFiles` in a 30s timeout via `Promise.race`; treat timeout as a failure with `error: "timed out"`.
- **Desktop-only languages on the web build** — `runFiles` returns a `desktopOnly` `RunResult`; we count those as skipped (not failed).
- **`harness: "evm"` exercises** — already routes through the new EVM runtime, so they execute deploy+call for real.
- **Reading / quiz / puzzle / cloze / micropuzzle lessons** — filtered out by `isExerciseKind`. Future extension: also auto-answer quizzes via `correctIndex` to verify quiz lessons render without crashing.
- **Concurrent verifications** — disallow; the action button is disabled while a session is active.

---

## "Verify all courses" specifics

Just `for (const c of courses) await verifyCourse(c, ...)` with the same overlay aggregating across courses. Header shows `Course 3/8: Mastering Ethereum` plus the per-course progress.

A bigger version would parallelize courses (multiple workers), but the runtimes don't all parallelize cleanly (Pyodide singleton, solc singleton, Web Worker pool limit). Sequential is the safe default.

---

## Out of scope (call out for review)

1. **Watch mode that drives the actual workbench editor** — the more dramatic "see the editor flip through solutions" experience. Adds a remote-control bus into Workbench.tsx. Defer until we see if anyone asks.
2. **Headless CI mode** — running this from the command line via Playwright instead of the cmd+K UI. Would let CI catch regressions in the in-browser runtimes (which the existing Node-side `test:content` can't). Worth doing eventually; out of scope for v1.
3. **Saved verification reports** — persist last run per course so the Library can show a "✓ verified 2h ago" badge. Easy follow-up once the data structure is settled.

---

## File map

```
new   docs/verify-course-design.md                                 (this file)
new   src/lib/verifyCourse.ts                                       ~120 lines
new   src/components/VerifyCourse/VerifyCourseOverlay.tsx           ~150 lines
new   src/components/VerifyCourse/VerifyCourseOverlay.css           ~80 lines
new   src/components/VerifyCourse/index.ts                          ~3 lines
edit  src/components/CommandPalette/CommandPalette.tsx              +25 lines
edit  src/App.tsx                                                   +30 lines
```

Total: ~400 added lines, no breaking changes, fully opt-in via the palette.
