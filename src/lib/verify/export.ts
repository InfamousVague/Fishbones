/// Exporter for `verifyCourse` results — turns a session's
/// pass/fail/skipped rows into a self-contained Markdown report you
/// can paste into Claude / ChatGPT to ask for fixes, plus a JSON
/// dump for programmatic use.
///
/// The Markdown format is optimized for "fix-me prompt" use:
///   - Header explains the task + reply format the model should use.
///   - **Failed** lessons get the FULL source (solution, files,
///     tests) plus the error / failed test names / error log lines.
///     This is the model's working set.
///   - **Skipped** lessons get a one-line summary of why.
///   - **Passed** lessons get a collapsible list — context only.
///
/// Why bake the source into the report instead of linking out:
/// the user's chat session has no filesystem access. The prompt
/// has to stand alone.

import type { LessonVerifyResult } from "./course";
import { tally } from "./course";
import type { ExerciseLesson, MixedLesson, WorkbenchFile } from "../../data/types";

export interface ExportOptions {
  /// Human-readable label for the report header. Usually the
  /// course title (or "All courses" for the multi-course mode).
  label?: string;
  /// Course id, when known. Helps the model match fixes back to a
  /// specific course on disk.
  courseId?: string;
  /// Cap how much body text from passed lessons gets included.
  /// Default 0 — pass-through context isn't valuable for a fix
  /// prompt and inflates token count fast on a 100-lesson course.
  /// Set non-zero to include more context per passed lesson.
  passedBodyChars?: number;
}

export function formatFixPrompt(
  results: LessonVerifyResult[],
  opts: ExportOptions = {},
): string {
  const t = tally(results);
  const failed = results.filter((r) => !r.skipped && !r.passed);
  const skipped = results.filter((r) => r.skipped);
  const passed = results.filter((r) => r.passed && !r.skipped);

  // The instruction block at the top is what makes this a "prompt"
  // rather than a "report". Be explicit about reply format so the
  // model returns something machine-parseable (or at least scannable
  // when pasting back fixes file by file).
  const header = [
    `# Course verification report${opts.label ? `: ${opts.label}` : ""}`,
    "",
    opts.courseId ? `**Course ID:** \`${opts.courseId}\`  ` : "",
    `**Total:** ${results.length} lesson${results.length === 1 ? "" : "s"} · **Passed:** ${t.passed} · **Failed:** ${t.failed} · **Skipped:** ${t.skipped}  `,
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "---",
    "",
    "You're fixing lessons in a Fishbones course. Each FAILED lesson below failed when its solution was run against its tests through the live in-browser runtime. For each, propose the smallest change that makes the test pass — usually a fix to the solution OR a fix to the test code (sometimes the test itself is wrong). Don't change the starter unless it's syntactically broken.",
    "",
    "**Apply the fixes directly to the course file.** If you have filesystem tools, edit the live installed copy in place — don't just emit JSON for a human to apply. The course file lives at:",
    "",
    "```",
    `~/Library/Application Support/com.mattssoftware.kata/courses/${opts.courseId ?? "<course-id>"}/course.json`,
    "```",
    "",
    "It's a JSON document with `chapters[].lessons[]`; each lesson has an `id`, a `solution` string (single-file lessons) or a `solutionFiles[]` array (multi-file lessons), and a `tests` string. Walk every chapter, find each failing lesson by id, overwrite only the changed fields, write the file back. After editing, the user can re-run the verifier in the app and the new content takes effect immediately (no rebuild needed).",
    "",
    "**Also reply with one fenced JSON block per lesson** so the in-app fix applier can re-apply if needed and so the diff is auditable:",
    "",
    "```json",
    `{ "id": "<lesson-id>", "diagnosis": "one-line cause", "solution": "...", "tests": "...", "solutionFiles": [{ "name": "Contract.sol", "language": "solidity", "content": "..." }] }`,
    "```",
    "",
    "Only include fields you actually changed. Omit `solutionFiles` if the lesson uses a single-file `solution` string; omit `solution` if it uses `solutionFiles`.",
    "",
    "**Test-harness conventions** (matters for both the JSON block and the in-place edit):",
    "- The harness evaluates test code in a sandbox with the following injected as **globals**: `test(name, fn)`, `expect(value)`, `chain`, plus the viem helpers (`parseEther`, `keccak256`, `encodePacked`, `getAddress`, etc.). **`describe` and `it` are NOT available** — use bare `test('name', async () => { ... })` calls. Tests using `describe`/`it` fail with `Can't find variable: describe`. Helpers, `const`s, and `function` declarations at the top of the file are fine; just don't wrap groups.",
    "- **Static `import` statements at the top of `tests` will fail** with `Unexpected token '{'. import call expects one or two arguments.` — drop them; the helpers above are already in scope.",
    "- **`chain.deploy({ contract: 'Name', args: [...], value: bigint })`** is the supported deploy form. Positional `chain.deploy('Name', [...])` is NOT supported and surfaces as `execution reverted (no reason)` because the args fall through to the constructor as garbage.",
    "- **Contract function calls take args wrapped in an array**: `c.write.send([recipient, amount])`, `c.read.namehash([name])`. Bare positional args like `c.write.send(recipient, amount)` will silently mis-encode and revert.",
    "- **`chain.accounts[i]` returns an address string** (`0x…`) — not an object. Don't write `chain.accounts[1].address` or `chain.accounts[1].sendTransaction(...)`; pass the entry directly.",
    "- **`chain.getBalance(addr)`** reads ETH balance. There is no `chain.balanceOf` (that's the ERC-20 method).",
    "- **`chain.getContract(name, address)`** attaches a synthetic instance to an address with the contract's ABI — used after CREATE2 / proxy deployments where you don't have a fresh `chain.deploy(...)` handle. Returns the same shape as a deployed contract (`.read.X(...)`, `.write.X(...)`).",
    "- **Per-call sender override**: `c.write.X([args], { account: chain.accounts[N] })` runs the call from a different EOA. Same shape on `chain.deploy({...})` for value-paying constructors.",
    "- **`chain.warp(seconds)`** advances `block.timestamp` by N seconds; useful for time-locked tests.",
    "- **`r.events`** on a write-result is an array of decoded log entries with `{ eventName, args }`. Use `.find(e => e.eventName === 'Foo')` to pick one.",
    "- **EVM gotcha**: `delegatecall` to an address with no code returns `success=true` with empty returndata — it does NOT revert. Tests asserting that an \"invalid library address reverts\" must either guard with `extcodesize > 0` in the solution, or drop the assertion.",
    "- Contract names in `tests` must match contracts emitted by the `solution` / `solutionFiles` source — solc reports them under their declared `contract Foo` name. Mismatches surface as `Contract \"Foo\" not in compiled output. Available: ...` errors.",
    "",
    "---",
  ]
    .filter((line) => line !== "" || true) // keep blanks
    .join("\n");

  const failedSection =
    failed.length === 0
      ? ""
      : [
          "",
          `## ✗ Failed lessons (${failed.length})`,
          "",
          failed.map(formatLessonBlock).join("\n\n---\n\n"),
        ].join("\n");

  const skippedSection =
    skipped.length === 0
      ? ""
      : [
          "",
          `## ⊘ Skipped lessons (${skipped.length})`,
          "",
          skipped
            .map(
              (r) =>
                `- **${escapeMd(r.target.lesson.title)}** \`(${r.target.lesson.id})\` · ${r.target.kind} — ${r.skipReason ?? "skipped"}`,
            )
            .join("\n"),
        ].join("\n");

  const passedSection =
    passed.length === 0
      ? ""
      : [
          "",
          `## ✓ Passed lessons (${passed.length})`,
          "",
          "<details><summary>show list</summary>",
          "",
          passed
            .map(
              (r) =>
                `- ${escapeMd(r.target.lesson.title)} \`(${r.target.lesson.id})\``,
            )
            .join("\n"),
          "",
          "</details>",
        ].join("\n");

  return [header, failedSection, skippedSection, passedSection].join("\n").trim() + "\n";
}

/// Detailed per-lesson Markdown block. Used for failed lessons —
/// includes full source so the model has everything it needs to
/// suggest a fix without follow-up file reads.
function formatLessonBlock(r: LessonVerifyResult): string {
  const l = r.target.lesson;
  const lines: string[] = [];

  lines.push(`### ${escapeMd(l.title)} \`(id: ${l.id})\``);
  lines.push("");
  lines.push(`- **Kind:** ${r.target.kind} (\`${l.kind}\`)`);
  lines.push(`- **Chapter:** \`${r.target.chapterId}\``);
  if ("language" in l) lines.push(`- **Language:** \`${l.language}\``);
  if ("harness" in l && l.harness) lines.push(`- **Harness:** \`${l.harness}\``);
  lines.push(`- **Duration:** ${(r.durationMs / 1000).toFixed(2)}s`);
  if (r.skipReason) lines.push(`- **Reason:** ${r.skipReason}`);
  if (r.result?.error)
    lines.push(`- **Top-level error:** ${codeInline(r.result.error)}`);

  // Source — solution code + tests. We include solutionFiles when
  // present (multi-file lessons), else fall back to the solution
  // string. Same for tests.
  const isExercise = l.kind === "exercise" || l.kind === "mixed";
  if (isExercise) {
    const exLesson = l as ExerciseLesson | MixedLesson;
    if (exLesson.solutionFiles && exLesson.solutionFiles.length > 0) {
      lines.push("");
      lines.push("**Solution files (current):**");
      for (const f of exLesson.solutionFiles) {
        lines.push("");
        lines.push(`*${f.name}* (${f.language}):`);
        lines.push(fenced(f.language, f.content));
      }
    } else if (exLesson.solution) {
      lines.push("");
      lines.push("**Solution (current):**");
      lines.push(fenced(exLesson.language, exLesson.solution));
    }
    if (exLesson.tests) {
      lines.push("");
      lines.push("**Tests:**");
      // Test files are JS for solidity/vyper (the harness is
      // JS-based) — fall back to the lesson language otherwise.
      const testLang =
        exLesson.language === "solidity" || exLesson.language === "vyper"
          ? "javascript"
          : exLesson.language;
      lines.push(fenced(testLang, exLesson.tests));
    }
    if (exLesson.files && exLesson.files.length > 0) {
      lines.push("");
      lines.push(
        "**Starter files (for reference — usually leave these alone):**",
      );
      for (const f of exLesson.files) {
        lines.push("");
        lines.push(`*${f.name}* (${f.language}):`);
        lines.push(fenced(f.language, f.content));
      }
    } else if (exLesson.starter) {
      lines.push("");
      lines.push("**Starter (for reference):**");
      lines.push(fenced(exLesson.language, exLesson.starter));
    }
  }

  // Test runner output — failed test names + their assertion
  // errors. This is usually the smoking gun for "what did the
  // model need to change".
  const failedTests = (r.result?.tests ?? []).filter((t) => !t.passed);
  if (failedTests.length > 0) {
    lines.push("");
    lines.push("**Failed test details:**");
    for (const t of failedTests) {
      lines.push(`- \`${t.name}\`: ${t.error ?? "(no error message)"}`);
    }
  }

  // Compile errors / runtime exceptions land in `logs` with
  // level=error. Cap at 10 lines so a torrent of warnings doesn't
  // bury the actual signal.
  const errorLogs = (r.result?.logs ?? []).filter((l) => l.level === "error");
  if (errorLogs.length > 0) {
    lines.push("");
    lines.push("**Error log lines:**");
    lines.push(
      fenced("text", errorLogs.slice(0, 10).map((l) => l.text).join("\n")),
    );
  }

  return lines.join("\n");
}

/// JSON serialization — same data structure as the markdown report
/// but machine-readable. Useful for piping into a script that
/// applies fixes automatically.
export function formatJson(
  results: LessonVerifyResult[],
  opts: ExportOptions = {},
): string {
  const t = tally(results);
  const dump = {
    label: opts.label,
    courseId: opts.courseId,
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      ...t,
    },
    results: results.map((r) => ({
      lessonId: r.target.lesson.id,
      lessonTitle: r.target.lesson.title,
      chapterId: r.target.chapterId,
      courseId: r.target.courseId,
      kind: r.target.kind,
      lessonKind: r.target.lesson.kind,
      passed: r.passed,
      skipped: r.skipped,
      skipReason: r.skipReason,
      durationMs: r.durationMs,
      // Carry only the bits of RunResult that are useful for
      // diagnosis — drop logs at level=log to keep size sane.
      result: r.result
        ? {
            error: r.result.error,
            tests: r.result.tests,
            logs: r.result.logs?.filter(
              (l) => l.level === "error" || l.level === "warn",
            ),
            durationMs: r.result.durationMs,
          }
        : null,
      // Source bundle for fix prompts that want the lesson code
      // alongside the diagnosis.
      lesson: extractLessonSource(r.target.lesson),
    })),
  };
  return JSON.stringify(dump, null, 2);
}

/// Pull just the source-relevant fields out of a Lesson. Avoids
/// dumping the entire Lesson object (body markdown, enrichment,
/// etc.) which inflates the JSON without value.
function extractLessonSource(
  l: LessonVerifyResult["target"]["lesson"],
): {
  language?: string;
  starter?: string;
  solution?: string;
  tests?: string;
  files?: WorkbenchFile[];
  solutionFiles?: WorkbenchFile[];
  harness?: string;
} {
  if (l.kind !== "exercise" && l.kind !== "mixed") return {};
  const ex = l as ExerciseLesson | MixedLesson;
  return {
    language: ex.language,
    starter: ex.starter,
    solution: ex.solution,
    tests: ex.tests,
    files: ex.files,
    solutionFiles: ex.solutionFiles,
    harness: ex.harness,
  };
}

function fenced(lang: string | undefined, body: string): string {
  return ["```" + (lang ?? ""), body, "```"].join("\n");
}

function codeInline(s: string): string {
  // Single-line backtick wrap; fall back to fenced for multiline.
  if (s.includes("\n")) return "\n" + fenced("text", s);
  return "`" + s.replace(/`/g, "\\`") + "`";
}

function escapeMd(s: string): string {
  // Headings + list items already escape angle brackets in renderers,
  // but pipe + bracket characters in titles can break tables.
  return s.replace(/\|/g, "\\|");
}

/// Suggest a filename for the export (markdown or json). The label
/// gets slugified; date stamp keeps multiple runs from clobbering
/// each other.
export function suggestExportFilename(
  opts: ExportOptions,
  ext: "md" | "json",
): string {
  const slug = (opts.label ?? opts.courseId ?? "verify-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug || "verify"}-${stamp}.${ext}`;
}
