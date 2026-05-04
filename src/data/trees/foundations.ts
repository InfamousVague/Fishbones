/// Auto-split from the original `src/data/trees.ts` monolith — see
/// `scripts/split-trees.mjs` for the splitter. The shape of the data
/// is unchanged; only the file boundaries moved.
import type { SkillTree } from "./_core";
export const FOUNDATIONS: SkillTree = {
  id: "foundations",
  title: "Programming Foundations",
  short: "Foundations",
  audience: "beginner",
  accent: "#7faaff",
  description:
    "Twenty skills every programmer needs before any specialty tree makes sense. Variables, control flow, functions, data structures, error handling, I/O, testing.",
  nodes: [
    {
      id: "variables",
      label: "Variables",
      summary:
        "Naming a value so you can refer to it by name and reassign it later.",
      prereqs: [],
      matches: [
        { courseId: "python-crash-course", lessonId: "creating-and-using-variables" },
        { courseId: "python-crash-course", lessonId: "variable-naming-rules" },
        { courseId: "eloquent-javascript", lessonId: "ch01-reading" },
      ],
    },
    {
      id: "arithmetic",
      label: "Arithmetic",
      summary: "Numbers, operators, and how + - * / behave on integer vs float.",
      prereqs: ["variables"],
      matches: [
        { courseId: "python-crash-course", lessonId: "underscores-multiple-assignment-constants" },
        { courseId: "learning-go", lessonId: "booleans-and-numeric-types" },
        { courseId: "the-rust-programming-language", lessonId: "scalar-data-types" },
      ],
    },
    {
      id: "strings",
      label: "Strings",
      summary: "Text values, quoting rules, methods, and string formatting.",
      prereqs: ["variables"],
      matches: [
        { courseId: "python-crash-course", lessonId: "strings-and-quotes" },
        { courseId: "python-crash-course", lessonId: "string-case-methods" },
        { courseId: "python-crash-course", lessonId: "f-strings-for-formatting" },
      ],
    },
    {
      id: "booleans",
      label: "Booleans",
      summary: "true/false values and the operators that produce them.",
      prereqs: ["variables"],
      matches: [
        { courseId: "learning-zig", lessonId: "booleans-and-comparisons" },
        { courseId: "python-crash-course", lessonId: "intro-to-conditionals" },
      ],
    },
    {
      id: "comparisons",
      label: "Comparisons",
      summary: "==, <, >, !=, and combining conditions with and/or.",
      prereqs: ["booleans"],
      matches: [
        { courseId: "python-crash-course", lessonId: "intro-to-conditionals" },
        { courseId: "python-crash-course", lessonId: "combining-conditions-and-or" },
        { courseId: "learning-zig", lessonId: "booleans-and-comparisons" },
      ],
    },
    {
      id: "if-else",
      label: "If / Else",
      summary: "Branching execution based on a condition.",
      prereqs: ["comparisons"],
      matches: [
        { courseId: "python-crash-course", lessonId: "simple-if-statements" },
        { courseId: "python-crash-course", lessonId: "if-elif-else-chains" },
        { courseId: "the-rust-programming-language", lessonId: "control-flow-if-expressions" },
      ],
    },
    {
      id: "while-loops",
      label: "While Loops",
      summary: "Repeat a block while a condition is true.",
      prereqs: ["if-else"],
      matches: [
        { courseId: "learning-zig", lessonId: "loops-while-and-for" },
        { courseId: "learning-go", lessonId: "for-loop-formats" },
      ],
    },
    {
      id: "for-loops",
      label: "For Loops",
      summary: "Iterate over a sequence or a numeric range.",
      prereqs: ["while-loops"],
      matches: [
        { courseId: "python-crash-course", lessonId: "for-loops-through-lists" },
        { courseId: "python-crash-course", lessonId: "range-function-and-numeric-lists" },
        { courseId: "learning-go", lessonId: "for-range-with-slices-maps" },
      ],
    },
    {
      id: "functions",
      label: "Functions",
      summary: "Group steps into a named, reusable unit.",
      prereqs: ["if-else"],
      matches: [
        { courseId: "python-crash-course", lessonId: "what-is-a-function" },
        { courseId: "the-rust-programming-language", lessonId: "functions-and-parameters" },
        { courseId: "learning-go", lessonId: "declaring-and-calling-functions" },
      ],
    },
    {
      id: "function-args",
      label: "Function Arguments",
      summary: "Parameters, positional vs keyword, defaults.",
      prereqs: ["functions"],
      matches: [
        { courseId: "python-crash-course", lessonId: "parameters-and-arguments" },
        { courseId: "python-crash-course", lessonId: "positional-and-keyword-arguments" },
        { courseId: "python-crash-course", lessonId: "default-parameter-values" },
      ],
    },
    {
      id: "return-values",
      label: "Return Values",
      summary: "Functions that produce a value the caller uses.",
      prereqs: ["function-args"],
      matches: [
        { courseId: "python-crash-course", lessonId: "return-values" },
        { courseId: "the-rust-programming-language", lessonId: "statements-expressions-return-values" },
        { courseId: "learning-go", lessonId: "multiple-return-values" },
      ],
    },
    {
      id: "arrays",
      label: "Arrays / Lists",
      summary: "Indexed sequences of values.",
      prereqs: ["variables", "for-loops"],
      matches: [
        { courseId: "python-crash-course", lessonId: "what-is-a-list" },
        { courseId: "python-crash-course", lessonId: "accessing-list-elements" },
        { courseId: "learning-go", lessonId: "arrays-declaration-and-literals" },
      ],
    },
    {
      id: "array-iteration",
      label: "Iterating Arrays",
      summary: "Walking every element with for, map, filter, reduce.",
      prereqs: ["arrays"],
      matches: [
        { courseId: "python-crash-course", lessonId: "for-loops-through-lists" },
        { courseId: "eloquent-javascript", lessonId: "ch04-reading" },
        { courseId: "the-rust-programming-language", lessonId: "iterating-over-vectors" },
      ],
    },
    {
      id: "objects",
      label: "Objects / Dicts",
      summary: "Named-field records, key→value mappings.",
      prereqs: ["variables"],
      matches: [
        { courseId: "python-crash-course", lessonId: "what-is-a-dictionary" },
        { courseId: "eloquent-javascript", lessonId: "ch03-reading" },
        { courseId: "learning-go", lessonId: "maps-declaration-and-operations" },
      ],
    },
    {
      id: "nested-data",
      label: "Nested Data",
      summary: "Lists of dicts, dicts of lists, and how to walk them.",
      prereqs: ["objects", "arrays"],
      matches: [
        { courseId: "python-crash-course", lessonId: "nesting-data-structures" },
        { courseId: "python-crash-course", lessonId: "work-with-nested-structures" },
      ],
    },
    {
      id: "recursion",
      label: "Recursion",
      summary: "Functions that call themselves on smaller inputs.",
      prereqs: ["functions"],
      matches: [
        { courseId: "composing-programs", lessonId: "ch01-reading" },
        { courseId: "learning-zig", lessonId: "recursion" },
        { courseId: "eloquent-javascript", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "error-handling",
      label: "Error Handling",
      summary: "Recognising, raising, and catching errors.",
      prereqs: ["functions"],
      matches: [
        { courseId: "python-crash-course", lessonId: "handling-exceptions" },
        { courseId: "python-crash-course", lessonId: "file-not-found-and-else-blocks" },
        { courseId: "eloquent-javascript", lessonId: "ch07-reading" },
      ],
    },
    {
      id: "io",
      label: "Standard I/O",
      summary: "Reading input from a user, printing output.",
      prereqs: ["strings"],
      matches: [
        { courseId: "python-crash-course", lessonId: "python-interpreter-basics" },
        { courseId: "python-crash-course", lessonId: "running-programs-from-terminal" },
      ],
    },
    {
      id: "file-io",
      label: "File I/O",
      summary: "Opening, reading, writing, and serialising files.",
      prereqs: ["io"],
      matches: [
        { courseId: "python-crash-course", lessonId: "reading-files-with-pathlib" },
        { courseId: "python-crash-course", lessonId: "writing-to-files" },
        { courseId: "python-crash-course", lessonId: "storing-data-with-json" },
      ],
    },
    {
      id: "testing",
      label: "Testing Basics",
      summary: "Why test, writing your first test, fixtures.",
      prereqs: ["functions"],
      matches: [
        { courseId: "python-crash-course", lessonId: "why-test-your-code" },
        { courseId: "python-crash-course", lessonId: "writing-a-passing-test" },
        { courseId: "python-crash-course", lessonId: "using-fixtures" },
      ],
    },
  ],
};
