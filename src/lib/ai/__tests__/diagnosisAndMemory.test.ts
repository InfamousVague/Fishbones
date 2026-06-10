/// Error-diagnosis table + learner memory. The diagnosis tests
/// feed real toolchain error shapes (rustc, Node, Python) and
/// assert the targeted hint + file:line extraction; the memory
/// tests cover fact CRUD, struggle counters, and the rendered
/// prompt block.

import { beforeEach, describe, expect, it } from "vitest";
import { diagnoseRunError } from "../diagnosis";
import {
  addFact,
  buildMemoryBlock,
  EMPTY_MEMORY,
  loadMemory,
  recordStruggle,
  recordStruggleIn,
  removeFact,
  saveMemory,
} from "../memory";

// ── Diagnosis ───────────────────────────────────────────────

describe("diagnoseRunError", () => {
  it("diagnoses Rust E0382 (borrow of moved value) with file:line", () => {
    const stderr = [
      "error[E0382]: borrow of moved value: `vec0`",
      "  --> src/main.rs:12:9",
      "   |",
      "11 |     let vec1 = vec0;",
    ].join("\n");
    const d = diagnoseRunError(stderr)!;
    expect(d.code).toBe("rust-E0382");
    expect(d.hint).toContain("clone");
    expect(d.file).toBe("src/main.rs");
    expect(d.line).toBe(12);
  });

  it("diagnoses Rust E0308 mismatched types", () => {
    const d = diagnoseRunError("error[E0308]: mismatched types\n --> main.rs:4:5")!;
    expect(d.code).toBe("rust-E0308");
    expect(d.line).toBe(4);
  });

  it("diagnoses overlapping borrows (E0502)", () => {
    const d = diagnoseRunError(
      "error[E0502]: cannot borrow `v` as mutable because it is also borrowed as immutable",
    )!;
    expect(d.code).toBe("rust-E0502");
    expect(d.hint).toContain("scope");
  });

  it("diagnoses JS ReferenceError with Node stack location", () => {
    const text = [
      "ReferenceError: greet is not defined",
      "    at main.js:3:7",
    ].join("\n");
    const d = diagnoseRunError(text)!;
    expect(d.code).toBe("js-reference-error");
    expect(d.file).toBe("main.js");
    expect(d.line).toBe(3);
  });

  it("diagnoses undefined-property access with a React-aware hint", () => {
    const d = diagnoseRunError(
      "TypeError: Cannot read properties of undefined (reading 'map')",
    )!;
    expect(d.code).toBe("js-undefined-property");
    expect(d.hint).toContain("useState([])");
  });

  it("diagnoses missing-module with the no-npm hint", () => {
    const d = diagnoseRunError("Error: Cannot find module 'lodash'")!;
    expect(d.code).toBe("js-missing-module");
    expect(d.hint).toContain("no npm install");
  });

  it("diagnoses Python NameError with File-line extraction", () => {
    const text = [
      'File "main.py", line 7, in <module>',
      "NameError: name 'total' is not defined",
    ].join("\n");
    const d = diagnoseRunError(text)!;
    expect(d.code).toBe("py-name-error");
    expect(d.file).toBe("main.py");
    expect(d.line).toBe(7);
  });

  it("returns null for unrecognised errors and empty input", () => {
    expect(diagnoseRunError("segmentation fault (core dumped)")).toBeNull();
    expect(diagnoseRunError("")).toBeNull();
  });
});

// ── Memory ──────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

describe("learner memory", () => {
  it("starts empty and roundtrips through localStorage", () => {
    expect(loadMemory()).toEqual(EMPTY_MEMORY);
    const { memory } = addFact(loadMemory(), "prefers terse answers");
    saveMemory(memory);
    expect(loadMemory().facts).toHaveLength(1);
    expect(loadMemory().facts[0].text).toBe("prefers terse answers");
  });

  it("dedupes facts case-insensitively", () => {
    let m = addFact(EMPTY_MEMORY, "Building a roguelike").memory;
    const second = addFact(m, "building a roguelike");
    expect(second.added).toBe(false);
    expect(second.memory.facts).toHaveLength(1);
  });

  it("evicts FIFO beyond the cap", () => {
    let m = structuredClone(EMPTY_MEMORY);
    for (let i = 0; i < 30; i++) {
      m = addFact(m, `fact number ${i}`, 1000 + i).memory;
    }
    expect(m.facts.length).toBe(24);
    expect(m.facts[0].text).toBe("fact number 6"); // 0-5 evicted
  });

  it("removes facts by text", () => {
    const m = addFact(EMPTY_MEMORY, "temporary note").memory;
    const after = removeFact(m, "temporary note");
    expect(after.facts).toHaveLength(0);
  });

  it("tracks struggles via the fire-and-forget helper", () => {
    recordStruggle("rust-E0382");
    recordStruggle("rust-E0382");
    recordStruggle("js-syntax-error");
    expect(loadMemory().struggles["rust-E0382"]).toBe(2);
    expect(loadMemory().struggles["js-syntax-error"]).toBe(1);
  });

  it("renders the prompt block with facts + repeated struggles only", () => {
    let m = addFact(EMPTY_MEMORY, "prefers Rust examples").memory;
    m = recordStruggleIn(m, "rust-E0382");
    m = recordStruggleIn(m, "rust-E0382");
    m = recordStruggleIn(m, "rust-E0382");
    m = recordStruggleIn(m, "one-off-error"); // count 1 → hidden
    const block = buildMemoryBlock(m);
    expect(block).toContain("prefers Rust examples");
    expect(block).toContain("rust-E0382 (3 failed runs)");
    expect(block).not.toContain("one-off-error");
    expect(block).toContain("slow down");
  });

  it("returns empty block for empty memory", () => {
    expect(buildMemoryBlock(structuredClone(EMPTY_MEMORY))).toBe("");
  });
});
