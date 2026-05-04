#!/usr/bin/env node
/// Headless verifier for `harness: "evm"` lessons. Walks every
/// solidity-flavoured exercise in `mastering-ethereum`, compiles
/// the solution + starter via solc, and reports which lessons
/// have compile errors so we can fix or regenerate them BEFORE
/// shipping.
///
/// What this catches:
///   - Solution doesn't compile (syntax error, missing function, etc.)
///   - Starter doesn't compile (we want it to compile so the runtime
///     can deploy + run tests against the stub)
///   - Contract name in the body / tests doesn't match a contract
///     in the .sol file (the most common LLM-generated breakage)
///
/// What it does NOT catch:
///   - Test-runtime failures (the JS test code uses chain.* which
///     needs the in-process VM + ABI bridge — out of scope here)
///   - Logic bugs that compile fine but produce wrong outputs
///   - Reverts triggered only on edge inputs
///
/// Use the in-app Verify Course (cmd+K) for the full pass.
///
/// Usage:
///   node scripts/verify-evm-lessons.mjs                   # all
///   node scripts/verify-evm-lessons.mjs --course mastering-ethereum
///   node scripts/verify-evm-lessons.mjs --json            # machine-readable

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// We installed solc with --no-save above; require()-resolution finds it.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const solc = require("solc");

const args = process.argv.slice(2);
const COURSE_ID = (() => {
  const i = args.indexOf("--course");
  return i >= 0 ? args[i + 1] : "mastering-ethereum";
})();
const JSON_OUT = args.includes("--json");

const APP = join(
  homedir(),
  "Library/Application Support/com.mattssoftware.kata/courses",
);
const COURSE_PATH = join(APP, COURSE_ID, "course.json");
if (!existsSync(COURSE_PATH)) {
  console.error(`No course at ${COURSE_PATH}`);
  process.exit(1);
}

const course = JSON.parse(readFileSync(COURSE_PATH, "utf8"));

/// Compile a single .sol blob via solc's standard JSON I/O. Returns
/// `{ ok, errors, contracts }` where `errors` is the SEVERE-only set
/// (warnings are dropped — they'd flood the report).
function compileSolidity(source, fileName = "Lesson.sol") {
  const input = {
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatals = (out.errors ?? []).filter((e) => e.severity === "error");
  const contractNames = [];
  for (const file of Object.keys(out.contracts ?? {})) {
    for (const name of Object.keys(out.contracts[file])) {
      contractNames.push(name);
    }
  }
  return {
    ok: fatals.length === 0,
    errors: fatals.map((e) => (e.formattedMessage || e.message || "").trim()),
    contractNames,
  };
}

/// Pull the contract name out of a `chain.deploy("Foo", ...)` call
/// in the test code. Returns the first match — if a single test
/// deploys multiple, we'd want all of them, but the typical pattern
/// is one contract per lesson.
function deployedContractNames(testCode) {
  const re = /chain\.deploy\s*\(\s*['"`]([A-Za-z_][\w]*)['"`]/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(testCode))) seen.add(m[1]);
  return [...seen];
}

const results = [];
const exercises = course.chapters.flatMap((c) =>
  c.lessons
    .filter(
      (l) =>
        (l.kind === "exercise" || l.kind === "mixed") &&
        l.language === "solidity" &&
        l.harness === "evm",
    )
    .map((l) => ({ chapter: c.id, lesson: l })),
);

console.log(`Verifying ${exercises.length} solidity/evm-harness lessons in ${COURSE_ID}…\n`);

for (const { chapter, lesson } of exercises) {
  const solRes = compileSolidity(lesson.solution || "", "Solution.sol");
  const starterRes = compileSolidity(lesson.starter || "", "Starter.sol");
  const deployed = deployedContractNames(lesson.tests || "");
  const missing = deployed.filter(
    (n) => !solRes.contractNames.includes(n),
  );

  const status =
    solRes.ok && starterRes.ok && missing.length === 0
      ? "ok"
      : "fail";

  results.push({
    chapter,
    id: lesson.id,
    title: lesson.title,
    difficulty: lesson.difficulty,
    status,
    solutionCompiles: solRes.ok,
    starterCompiles: starterRes.ok,
    deployed,
    missing,
    solutionErrors: solRes.errors,
    starterErrors: starterRes.errors,
  });
}

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
}

const fails = results.filter((r) => r.status === "fail");
const passes = results.filter((r) => r.status === "ok");

console.log(`\n${passes.length}/${results.length} passed.\n`);
if (fails.length === 0) {
  console.log("All lessons compile + match their declared contract names.");
  process.exit(0);
}

console.log(`${fails.length} failures:\n`);
for (const r of fails) {
  console.log(`✗ [${r.chapter}] ${r.id} (${r.difficulty})`);
  console.log(`  ${r.title}`);
  if (!r.solutionCompiles) {
    console.log(`  SOLUTION FAILED TO COMPILE:`);
    for (const e of r.solutionErrors.slice(0, 2)) {
      console.log(
        `    ${e.split("\n").slice(0, 3).join(" / ").slice(0, 200)}`,
      );
    }
  }
  if (!r.starterCompiles) {
    console.log(`  STARTER FAILED TO COMPILE:`);
    for (const e of r.starterErrors.slice(0, 2)) {
      console.log(
        `    ${e.split("\n").slice(0, 3).join(" / ").slice(0, 200)}`,
      );
    }
  }
  if (r.missing.length > 0) {
    console.log(
      `  TESTS REFERENCE MISSING CONTRACTS: ${r.missing.join(", ")}`,
    );
    console.log(
      `    (solution defines: ${r.solutionContractNames || r.deployed.filter((d) => !r.missing.includes(d)).join(", ") || "none"})`,
    );
  }
  console.log();
}

process.exit(1);
