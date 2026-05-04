/// Auto-split from the original `src/data/trees.ts` monolith — see
/// `scripts/split-trees.mjs` for the splitter. The shape of the data
/// is unchanged; only the file boundaries moved.
import type { SkillTree } from "./_core";
export const SYSTEMS: SkillTree = {
  id: "systems",
  title: "Systems Programming",
  short: "Systems",
  audience: "specialty",
  accent: "#d68a8a",
  description:
    "Memory model up through Rust ownership, async runtimes, and bare-metal assembly. Two parallel tracks (C-family and Rust) that converge on concurrency and OS interfaces.",
  nodes: [
    {
      id: "memory-stack-heap",
      label: "Stack vs Heap",
      summary: "How the runtime divides memory regions.",
      prereqs: [],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "stack-and-heap" },
        { courseId: "learning-zig", lessonId: "three-memory-areas" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "memory-segments-overview" },
      ],
    },
    {
      id: "pointers-c",
      label: "Pointers",
      summary: "Address-of, dereference, pass-by-pointer.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "learning-zig", lessonId: "address-of" },
        { courseId: "learning-zig", lessonId: "pass-by-pointer" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "passing-arguments-overview" },
      ],
    },
    {
      id: "arrays-strings-c",
      label: "C Arrays & Strings",
      summary: "Contiguous memory, null-terminated strings, indexing.",
      prereqs: ["pointers-c"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "array-basics-in-c" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "array-indexing-assembly" },
        { courseId: "learning-zig", lessonId: "arrays" },
      ],
    },
    {
      id: "structs-c",
      label: "Structs",
      summary: "User-defined record types, layout, alignment.",
      prereqs: ["pointers-c"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "record-basics-in-c" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "passing-records-to-functions" },
        { courseId: "learning-zig", lessonId: "structs" },
      ],
    },
    {
      id: "malloc-free",
      label: "malloc / free",
      summary: "Heap allocation, ownership discipline, leaks.",
      prereqs: ["pointers-c"],
      matches: [],
      gapNote:
        "Zig allocator lesson covers Zig-style; no C `malloc`/`free` semantics teacher. Host in a new `c-programming-fundamentals`.",
    },
    {
      id: "linked-lists-c",
      label: "C Linked Lists",
      summary: "Pointer-based node chains, the canonical malloc exercise.",
      prereqs: ["malloc-free", "structs-c"],
      matches: [],
      gapNote: "Host alongside `malloc-free` in a C course.",
    },
    {
      id: "cpp-classes",
      label: "C++ Classes",
      summary: "Constructors, destructors, RAII.",
      prereqs: ["structs-c"],
      matches: [],
      gapNote: "Only `challenges-cpp-handwritten` exists. Host in a new `cpp-fundamentals`.",
    },
    {
      id: "cpp-templates",
      label: "C++ Templates",
      summary: "Generic types and functions, compile-time substitution.",
      prereqs: ["cpp-classes"],
      matches: [],
      gapNote: "Pair with cpp-fundamentals.",
    },
    {
      id: "rust-ownership",
      label: "Rust Ownership",
      summary: "Move semantics, drop, single-owner discipline.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "what-is-ownership" },
        { courseId: "the-rust-programming-language", lessonId: "ownership-rules-and-scope" },
        { courseId: "the-rust-programming-language", lessonId: "moves-and-invalidation" },
      ],
    },
    {
      id: "rust-borrowing",
      label: "Rust Borrowing",
      summary: "References, &mut exclusivity, the borrow checker.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "references-and-borrowing" },
        { courseId: "the-rust-programming-language", lessonId: "mutable-references" },
        { courseId: "rustonomicon", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "rust-lifetimes",
      label: "Rust Lifetimes",
      summary: "Region annotations, why the compiler asks for them.",
      prereqs: ["rust-borrowing"],
      matches: [
        { courseId: "rustonomicon", lessonId: "ch03-reading" },
        { courseId: "rust-by-example", lessonId: "ch06-scope-borrow-lifetime" },
      ],
    },
    {
      id: "rust-traits",
      label: "Rust Traits",
      summary: "Behaviour interfaces, trait bounds, dyn vs impl.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "defining-traits" },
        { courseId: "the-rust-programming-language", lessonId: "trait-bounds-and-impl-trait" },
        { courseId: "rust-by-example", lessonId: "ch05-generics-traits-reading" },
      ],
    },
    {
      id: "rust-errors",
      label: "Rust Error Handling",
      summary: "Result, Option, the ? operator.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "result-enum-basics" },
        { courseId: "the-rust-programming-language", lessonId: "propagating-errors" },
        { courseId: "rust-by-example", lessonId: "ch07-error-handling-reading" },
      ],
    },
    {
      id: "rust-async",
      label: "Rust Async",
      summary: "Futures, executors, polling, .await.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "rust-async-book", lessonId: "ch01-r-why-async" },
        { courseId: "rust-async-book", lessonId: "ch02-r-syntax" },
        { courseId: "rust-async-book", lessonId: "ch03-r-future-trait" },
      ],
    },
    {
      id: "threads-mutexes",
      label: "Threads & Mutexes",
      summary: "Shared-memory concurrency, lock discipline.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "rustonomicon", lessonId: "ch08-reading" },
        { courseId: "learning-go", lessonId: "mutexes-vs-channels" },
      ],
    },
    {
      id: "channels",
      label: "Channels",
      summary: "Message-passing concurrency, select, closing.",
      prereqs: ["threads-mutexes"],
      matches: [
        { courseId: "learning-go", lessonId: "channels-reading-writing-buffering" },
        { courseId: "learning-go", lessonId: "select-statement" },
        { courseId: "learning-go", lessonId: "closing-channels-for-range" },
      ],
    },
    {
      id: "syscalls",
      label: "System Calls",
      summary: "User → kernel boundary, svc, exception vector.",
      prereqs: ["pointers-c"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "svc-instruction-basics" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "exception-vector-table" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "intro-to-exceptions-and-interrupts" },
      ],
    },
    {
      id: "assembly-arm64",
      label: "ARM64 Assembly",
      summary: "Instructions, registers, load/store.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "assembly-line-structure" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "mov-instruction-variants" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "load-store-instructions" },
      ],
    },
  ],
};
