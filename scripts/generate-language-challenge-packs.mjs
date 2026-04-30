#!/usr/bin/env node
/// Generates challenge packs for the 10 languages added in the
/// 2026 expansion (Ruby / Lua / Dart / Haskell / Scala / SQL /
/// Elixir / Move / Cairo / Sway).
///
/// Each pack ships 5 "Easy" challenges with the same problem set
/// across every language, so a learner can compare idiomatic
/// approaches side-by-side. The shared specs below carry the
/// problem statement + hints; each language's IMPLEMENTATIONS
/// table fills in the starter / solution / tests for that
/// language's runtime.
///
/// Tests vary by runtime:
///   - Ruby / Elixir / Haskell / Scala / Dart  → KATA_TEST::name::PASS|FAIL
///     stdout protocol (parsed by src/runtimes/nativeRunners.ts).
///   - Lua                                      → test() + expect().to_be /
///     .to_equal harness (parsed by src/runtimes/lua.ts).
///   - SQL                                      → leading `-- expect: <n> rows`
///     comments (parsed by src/runtimes/sql.ts). The challenge set
///     is reframed for SQL — it's a query language so "reverse a
///     string" doesn't translate; we substitute table-shaped
///     equivalents.
///   - Move / Cairo / Sway                      → native `#[test]` form
///     each chain expects. Their runtimes are stubbed in this
///     iteration (see src/runtimes/desktopComingSoon.ts), so the
///     tests aren't exercised today — they're authored ready for
///     when the runtimes land.
///
/// Output: writes course.json into
/// `<app-data>/courses/challenges-<lang>-handwritten/course.json`,
/// resolving app-data via $XDG_DATA_HOME or the macOS default.
/// Re-running is idempotent — overwrites the JSON without touching
/// the cover.png (so a generated cover stays put).
///
/// Wire-up afterward:
///   1. Re-launch the desktop app — `useCourses.refresh()` picks up
///      the new pack on next mount.
///   2. (Optional) Run `npm run library:promote` to roll the user's
///      installed pack into a `.fishbones` archive in
///      `src-tauri/resources/bundled-packs/`. That makes the pack
///      part of the next release for everyone, not just this dev.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ────────────────────────── Challenge specs ──────────────────────
//
// Shared problem statements. The `body` is the markdown lesson body;
// `hints` are the graduated nudges shown in the workbench's hint
// drawer (first hint is a soft pointer, last is almost a giveaway).
// SQL challenges have their own spec because the rest don't translate.

const SHARED_CHALLENGES = [
  {
    id: "hello",
    title: "Greeting",
    body: `## Greeting

Implement a function called \`greeting\` that returns the string \`Hello, world!\` (with the exclamation mark, no trailing newline).

This is the smoke-test challenge for the pack — once you can return that string the runtime is wired correctly and every other challenge is just code on top of that.

\`\`\`
greeting() -> "Hello, world!"
\`\`\`
`,
    hints: [
      "Just a literal string — no formatting, no concatenation.",
      "The exact text matters: capitalisation, the comma, the space, and the exclamation mark are all checked.",
    ],
  },
  {
    id: "add",
    title: "Add two numbers",
    body: `## Add two numbers

Implement a function called \`add\` that takes two integers and returns their sum.

\`\`\`
add(2, 3) -> 5
add(-4, 4) -> 0
add(100, 200) -> 300
\`\`\`

Don't worry about overflow / arbitrary precision — the test cases stay well inside the language's default integer range.
`,
    hints: [
      "It's literally one line of body — \`return a + b\`.",
      "Match the function name exactly: \`add\`. The tests look it up by name.",
    ],
  },
  {
    id: "reverse_string",
    title: "Reverse a string",
    body: `## Reverse a string

Implement \`reverse_string\` that takes a string and returns it reversed.

\`\`\`
reverse_string("hello") -> "olleh"
reverse_string("a") -> "a"
reverse_string("") -> ""
\`\`\`

Most languages have a built-in for this — using the built-in is fine. The point of the challenge is to look up where it lives in the standard library, not to roll a manual loop.
`,
    hints: [
      "Most languages have a one-call solution: \`.reverse\`, \`String.reverse\`, slicing with a negative step, etc.",
      "If your language doesn't have one, build a list of characters, reverse the list, join it back into a string.",
    ],
  },
  {
    id: "is_palindrome",
    title: "Is it a palindrome?",
    body: `## Is it a palindrome?

Implement \`is_palindrome\` that takes a string and returns \`true\` when the string reads the same forward and backward, \`false\` otherwise.

Comparison is case-sensitive and includes spaces / punctuation:

\`\`\`
is_palindrome("racecar") -> true
is_palindrome("hello") -> false
is_palindrome("a") -> true
is_palindrome("") -> true
\`\`\`

Empty strings count as palindromes by convention.
`,
    hints: [
      "Compare the string against its reverse.",
      "If you already wrote \`reverse_string\`, this is one expression: \`s == reverse_string(s)\`.",
    ],
  },
  {
    id: "sum_array",
    title: "Sum an array",
    body: `## Sum an array

Implement \`sum_array\` that takes a list / array of integers and returns the sum.

\`\`\`
sum_array([1, 2, 3]) -> 6
sum_array([]) -> 0
sum_array([-5, 5, 10, -2]) -> 8
\`\`\`

The empty-array case must return \`0\` (NOT raise / panic / return null).
`,
    hints: [
      "Most languages have a one-call solution: \`.sum\`, \`sum(...)\`, \`Enum.sum\`, \`fold\`-with-zero, etc.",
      "If the language doesn't ship one, accumulate via a loop or fold starting from \`0\`.",
    ],
  },
];

// ────────────────────────── Language packs ───────────────────────
//
// Each entry maps a challenge id to its starter / solution / tests
// in that language. `body` falls back to the SHARED_CHALLENGES body
// unless overridden (used by SQL where the problems differ).

const PACKS = {
  ruby: makeRubyPack(),
  lua: makeLuaPack(),
  dart: makeDartPack(),
  haskell: makeHaskellPack(),
  scala: makeScalaPack(),
  sql: makeSqlPack(),
  elixir: makeElixirPack(),
  zig: makeZigPack(),
  move: makeMovePack(),
  cairo: makeCairoPack(),
  sway: makeSwayPack(),
};

// ────────────────────────── Ruby ─────────────────────────────────

function makeRubyPack() {
  return {
    id: "challenges-ruby-handwritten",
    title: "Ruby Challenges",
    language: "ruby",
    description:
      "Five hand-written Easy challenges for Ruby. Same problem set as the Lua / Dart / Haskell / Scala / Elixir packs so you can compare idioms across languages.",
    impls: {
      hello: {
        starter: `# TODO: implement greeting() returning the string "Hello, world!".
def greeting
end
`,
        solution: `def greeting
  "Hello, world!"
end
`,
        tests: rubyTestHarness(`
kata_test("greets") do
  raise "expected 'Hello, world!', got #{greeting.inspect}" unless greeting == "Hello, world!"
end
`),
      },
      add: {
        starter: `# TODO: implement add(a, b) returning a + b.
def add(a, b)
end
`,
        solution: `def add(a, b)
  a + b
end
`,
        tests: rubyTestHarness(`
kata_test("two_positives") do
  raise "expected 5, got #{add(2, 3).inspect}" unless add(2, 3) == 5
end

kata_test("crosses_zero") do
  raise "expected 0, got #{add(-4, 4).inspect}" unless add(-4, 4) == 0
end

kata_test("hundreds") do
  raise "expected 300, got #{add(100, 200).inspect}" unless add(100, 200) == 300
end
`),
      },
      reverse_string: {
        starter: `# TODO: return s reversed.
def reverse_string(s)
end
`,
        solution: `def reverse_string(s)
  s.reverse
end
`,
        tests: rubyTestHarness(`
kata_test("hello") do
  raise "expected 'olleh', got #{reverse_string('hello').inspect}" unless reverse_string("hello") == "olleh"
end

kata_test("single_char") do
  raise "expected 'a', got #{reverse_string('a').inspect}" unless reverse_string("a") == "a"
end

kata_test("empty") do
  raise "expected '', got #{reverse_string('').inspect}" unless reverse_string("") == ""
end
`),
      },
      is_palindrome: {
        starter: `# TODO: return true when s reads the same forward and backward.
def is_palindrome(s)
end
`,
        solution: `def is_palindrome(s)
  s == s.reverse
end
`,
        tests: rubyTestHarness(`
kata_test("racecar") do
  raise "racecar should be a palindrome" unless is_palindrome("racecar") == true
end

kata_test("not_a_palindrome") do
  raise "hello should not be a palindrome" unless is_palindrome("hello") == false
end

kata_test("single_char") do
  raise "single char is a palindrome" unless is_palindrome("a") == true
end

kata_test("empty") do
  raise "empty string is a palindrome" unless is_palindrome("") == true
end
`),
      },
      sum_array: {
        starter: `# TODO: return the sum of every integer in arr.
def sum_array(arr)
end
`,
        solution: `def sum_array(arr)
  arr.sum
end
`,
        tests: rubyTestHarness(`
kata_test("basic") do
  raise "expected 6, got #{sum_array([1, 2, 3]).inspect}" unless sum_array([1, 2, 3]) == 6
end

kata_test("empty") do
  raise "empty sums to 0" unless sum_array([]) == 0
end

kata_test("mixed") do
  raise "expected 8, got #{sum_array([-5, 5, 10, -2]).inspect}" unless sum_array([-5, 5, 10, -2]) == 8
end
`),
      },
    },
  };
}

/// Ruby test harness: emits KATA_TEST::name::PASS|FAIL lines on
/// stdout so the nativeRunners.ts parser can pick them up. The body
/// it wraps just contains kata_test("...") do ... end blocks.
function rubyTestHarness(body) {
  return `
def kata_test(name)
  begin
    yield
    puts "KATA_TEST::#{name}::PASS"
  rescue => e
    puts "KATA_TEST::#{name}::FAIL::#{e.message.to_s.split("\\n").first}"
  end
end
${body}`;
}

// ────────────────────────── Lua ──────────────────────────────────

function makeLuaPack() {
  return {
    id: "challenges-lua-handwritten",
    title: "Lua Challenges",
    language: "lua",
    description:
      "Five hand-written Easy challenges for Lua. Tests use the test()/expect() harness Fengari ships in the runtime — same vocabulary as the Python / JavaScript packs.",
    impls: {
      hello: {
        starter: `-- TODO: implement greeting() returning the literal string "Hello, world!".
function greeting()
end
`,
        solution: `function greeting()
  return "Hello, world!"
end
`,
        tests: `test("greets", function()
  expect(greeting()).to_be("Hello, world!")
end)
`,
      },
      add: {
        starter: `-- TODO: implement add(a, b) returning a + b.
function add(a, b)
end
`,
        solution: `function add(a, b)
  return a + b
end
`,
        tests: `test("two_positives", function()
  expect(add(2, 3)).to_be(5)
end)

test("crosses_zero", function()
  expect(add(-4, 4)).to_be(0)
end)

test("hundreds", function()
  expect(add(100, 200)).to_be(300)
end)
`,
      },
      reverse_string: {
        starter: `-- TODO: return s reversed. Lua has \`string.reverse\` but
-- you can also build the result manually with string.sub.
function reverse_string(s)
end
`,
        solution: `function reverse_string(s)
  return string.reverse(s)
end
`,
        tests: `test("hello", function()
  expect(reverse_string("hello")).to_be("olleh")
end)

test("single_char", function()
  expect(reverse_string("a")).to_be("a")
end)

test("empty", function()
  expect(reverse_string("")).to_be("")
end)
`,
      },
      is_palindrome: {
        starter: `-- TODO: return true if s reads the same forward and backward.
function is_palindrome(s)
end
`,
        solution: `function is_palindrome(s)
  return s == string.reverse(s)
end
`,
        tests: `test("racecar", function()
  expect(is_palindrome("racecar")).to_be(true)
end)

test("not_a_palindrome", function()
  expect(is_palindrome("hello")).to_be(false)
end)

test("single_char", function()
  expect(is_palindrome("a")).to_be(true)
end)

test("empty", function()
  expect(is_palindrome("")).to_be(true)
end)
`,
      },
      sum_array: {
        starter: `-- TODO: return the sum of every integer in arr.
-- Lua arrays are 1-indexed tables; iterate with ipairs or a for loop.
function sum_array(arr)
end
`,
        solution: `function sum_array(arr)
  local total = 0
  for _, v in ipairs(arr) do
    total = total + v
  end
  return total
end
`,
        tests: `test("basic", function()
  expect(sum_array({1, 2, 3})).to_be(6)
end)

test("empty", function()
  expect(sum_array({})).to_be(0)
end)

test("mixed", function()
  expect(sum_array({-5, 5, 10, -2})).to_be(8)
end)
`,
      },
    },
  };
}

// ────────────────────────── Dart ─────────────────────────────────

function makeDartPack() {
  return {
    id: "challenges-dart-handwritten",
    title: "Dart Challenges",
    language: "dart",
    description:
      "Five hand-written Easy challenges for Dart. Solutions use Dart's built-in collection methods where possible; tests run via `dart run` on the host.",
    impls: {
      hello: {
        starter: `// TODO: implement greeting() returning "Hello, world!".
String greeting() {
  throw UnimplementedError();
}
`,
        solution: `String greeting() => "Hello, world!";\n`,
        tests: dartTestHarness(`runTest("greets", () {
  if (greeting() != "Hello, world!") throw "expected 'Hello, world!', got '\${greeting()}'";
});`),
      },
      add: {
        starter: `// TODO: implement add(a, b) returning a + b.
int add(int a, int b) {
  throw UnimplementedError();
}
`,
        solution: `int add(int a, int b) => a + b;\n`,
        tests: dartTestHarness(`
runTest("two_positives", () {
  if (add(2, 3) != 5) throw "expected 5, got \${add(2, 3)}";
});

runTest("crosses_zero", () {
  if (add(-4, 4) != 0) throw "expected 0, got \${add(-4, 4)}";
});

runTest("hundreds", () {
  if (add(100, 200) != 300) throw "expected 300, got \${add(100, 200)}";
});
`),
      },
      reverse_string: {
        starter: `// TODO: return s reversed.
String reverseString(String s) {
  throw UnimplementedError();
}
`,
        solution: `String reverseString(String s) => s.split('').reversed.join();\n`,
        tests: dartTestHarness(`
runTest("hello", () {
  if (reverseString("hello") != "olleh") throw "expected 'olleh'";
});

runTest("single_char", () {
  if (reverseString("a") != "a") throw "expected 'a'";
});

runTest("empty", () {
  if (reverseString("") != "") throw "expected ''";
});
`),
      },
      is_palindrome: {
        starter: `// TODO: return true if s reads the same forward and backward.
bool isPalindrome(String s) {
  throw UnimplementedError();
}
`,
        solution: `bool isPalindrome(String s) =>
    s == s.split('').reversed.join();\n`,
        tests: dartTestHarness(`
runTest("racecar", () {
  if (!isPalindrome("racecar")) throw "racecar should be a palindrome";
});

runTest("not_a_palindrome", () {
  if (isPalindrome("hello")) throw "hello should not be a palindrome";
});

runTest("single_char", () {
  if (!isPalindrome("a")) throw "single char";
});

runTest("empty", () {
  if (!isPalindrome("")) throw "empty";
});
`),
      },
      sum_array: {
        starter: `// TODO: return the sum of every integer in arr.
int sumArray(List<int> arr) {
  throw UnimplementedError();
}
`,
        solution: `int sumArray(List<int> arr) =>
    arr.fold(0, (a, b) => a + b);\n`,
        tests: dartTestHarness(`
runTest("basic", () {
  if (sumArray([1, 2, 3]) != 6) throw "expected 6";
});

runTest("empty", () {
  if (sumArray([]) != 0) throw "empty sums to 0";
});

runTest("mixed", () {
  if (sumArray([-5, 5, 10, -2]) != 8) throw "expected 8";
});
`),
      },
    },
  };
}

/// Dart's `dart run <file>` wraps top-level statements in main()
/// so we can't redefine main; instead we expose a `runTest` helper
/// that the user/test code calls. The harness lives at the bottom
/// of the merged file so by the time it runs the user's
/// add / reverseString / etc. are in scope.
function dartTestHarness(body) {
  return `
// ── Test harness (KATA_TEST::name::PASS|FAIL stdout protocol) ──
void runTest(String name, void Function() body) {
  try {
    body();
    print("KATA_TEST::\$name::PASS");
  } catch (e) {
    print("KATA_TEST::\$name::FAIL::\$e");
  }
}

void main() {
${body}
}
`;
}

// ────────────────────────── Haskell ──────────────────────────────

function makeHaskellPack() {
  return {
    id: "challenges-haskell-handwritten",
    title: "Haskell Challenges",
    language: "haskell",
    description:
      "Five hand-written Easy challenges for Haskell. Tests run via `runghc` on the host; solutions use the standard Prelude where possible.",
    impls: {
      hello: {
        starter: haskellStarter("greeting :: String\ngreeting = \"TODO\""),
        solution: haskellStarter("greeting :: String\ngreeting = \"Hello, world!\""),
        tests: haskellTestHarness(`
runTest "greets" $ expectEq greeting "Hello, world!"
`),
      },
      add: {
        starter: haskellStarter("add :: Int -> Int -> Int\nadd a b = error \"TODO\""),
        solution: haskellStarter("add :: Int -> Int -> Int\nadd a b = a + b"),
        tests: haskellTestHarness(`
runTest "two_positives" $ expectEq (add 2 3) 5
runTest "crosses_zero" $ expectEq (add (-4) 4) 0
runTest "hundreds" $ expectEq (add 100 200) 300
`),
      },
      reverse_string: {
        starter: haskellStarter("reverseString :: String -> String\nreverseString s = error \"TODO\""),
        solution: haskellStarter("reverseString :: String -> String\nreverseString = reverse"),
        tests: haskellTestHarness(`
runTest "hello" $ expectEq (reverseString "hello") "olleh"
runTest "single_char" $ expectEq (reverseString "a") "a"
runTest "empty" $ expectEq (reverseString "") ""
`),
      },
      is_palindrome: {
        starter: haskellStarter("isPalindrome :: String -> Bool\nisPalindrome s = error \"TODO\""),
        solution: haskellStarter("isPalindrome :: String -> Bool\nisPalindrome s = s == reverse s"),
        tests: haskellTestHarness(`
runTest "racecar" $ expectEq (isPalindrome "racecar") True
runTest "not_a_palindrome" $ expectEq (isPalindrome "hello") False
runTest "single_char" $ expectEq (isPalindrome "a") True
runTest "empty" $ expectEq (isPalindrome "") True
`),
      },
      sum_array: {
        starter: haskellStarter("sumArray :: [Int] -> Int\nsumArray xs = error \"TODO\""),
        solution: haskellStarter("sumArray :: [Int] -> Int\nsumArray = sum"),
        tests: haskellTestHarness(`
runTest "basic" $ expectEq (sumArray [1, 2, 3]) 6
runTest "empty" $ expectEq (sumArray []) 0
runTest "mixed" $ expectEq (sumArray [-5, 5, 10, -2]) 8
`),
      },
    },
  };
}

/// Haskell starter shell — every starter ships the same module
/// declaration, the imports the harness needs, the user-visible
/// function stub, and `main = kataMain`. The harness is concatenated
/// after this and supplies `kataMain`, `runTest`, `expectEq`. The
/// trick to avoid duplicate-main errors is that the harness DOESN'T
/// define main; only the starter does, and it forwards to kataMain.
function haskellStarter(funcDef) {
  return `module Main where

import Control.Exception (try, SomeException, evaluate)
import System.IO (hSetBuffering, stdout, BufferMode(NoBuffering))

${funcDef}

main :: IO ()
main = kataMain
`;
}

/// Haskell test harness — supplies kataMain (the body the starter's
/// main forwards to), plus runTest + expectEq helpers. No imports
/// here — Haskell only allows imports right after the module decl,
/// and that lives in the starter.
function haskellTestHarness(body) {
  return `
-- ── Test harness ──
expectEq :: (Eq a, Show a) => a -> a -> IO ()
expectEq actual expected =
  if actual == expected
    then pure ()
    else error $ "expected " ++ show expected ++ ", got " ++ show actual

runTest :: String -> IO () -> IO ()
runTest name body = do
  result <- try (body >>= evaluate) :: IO (Either SomeException ())
  case result of
    Right _ -> putStrLn $ "KATA_TEST::" ++ name ++ "::PASS"
    Left e  -> putStrLn $ "KATA_TEST::" ++ name ++ "::FAIL::" ++ show e

kataMain :: IO ()
kataMain = do
  hSetBuffering stdout NoBuffering
${body.split("\n").map((l) => l.length ? "  " + l : l).join("\n")}
`;
}

// ────────────────────────── Scala ────────────────────────────────

function makeScalaPack() {
  return {
    id: "challenges-scala-handwritten",
    title: "Scala Challenges",
    language: "scala",
    description:
      "Five hand-written Easy challenges for Scala 3. Solutions favour the standard collection methods; tests run via `scala-cli run` on the host.",
    impls: {
      hello: {
        starter: `// TODO: implement greeting() returning "Hello, world!".
def greeting: String = ???
`,
        solution: `def greeting: String = "Hello, world!"\n`,
        tests: scalaTestHarness(`
runTest("greets") {
  if greeting != "Hello, world!" then throw RuntimeException(s"expected 'Hello, world!', got '\$greeting'")
}
`),
      },
      add: {
        starter: `// TODO: implement add(a, b) returning a + b.
def add(a: Int, b: Int): Int =
  ???
`,
        solution: `def add(a: Int, b: Int): Int = a + b\n`,
        tests: scalaTestHarness(`
runTest("two_positives") {
  if add(2, 3) != 5 then throw RuntimeException(s"expected 5, got \${add(2, 3)}")
}
runTest("crosses_zero") {
  if add(-4, 4) != 0 then throw RuntimeException(s"expected 0, got \${add(-4, 4)}")
}
runTest("hundreds") {
  if add(100, 200) != 300 then throw RuntimeException(s"expected 300, got \${add(100, 200)}")
}
`),
      },
      reverse_string: {
        starter: `// TODO: return s reversed.
def reverseString(s: String): String =
  ???
`,
        solution: `def reverseString(s: String): String = s.reverse\n`,
        tests: scalaTestHarness(`
runTest("hello") {
  if reverseString("hello") != "olleh" then throw RuntimeException("expected 'olleh'")
}
runTest("single_char") {
  if reverseString("a") != "a" then throw RuntimeException("expected 'a'")
}
runTest("empty") {
  if reverseString("") != "" then throw RuntimeException("expected ''")
}
`),
      },
      is_palindrome: {
        starter: `// TODO: return true if s reads the same forward and backward.
def isPalindrome(s: String): Boolean =
  ???
`,
        solution: `def isPalindrome(s: String): Boolean = s == s.reverse\n`,
        tests: scalaTestHarness(`
runTest("racecar") {
  if !isPalindrome("racecar") then throw RuntimeException("racecar")
}
runTest("not_a_palindrome") {
  if isPalindrome("hello") then throw RuntimeException("hello")
}
runTest("single_char") {
  if !isPalindrome("a") then throw RuntimeException("single char")
}
runTest("empty") {
  if !isPalindrome("") then throw RuntimeException("empty")
}
`),
      },
      sum_array: {
        starter: `// TODO: return the sum of every Int in xs.
def sumArray(xs: List[Int]): Int =
  ???
`,
        solution: `def sumArray(xs: List[Int]): Int = xs.sum\n`,
        tests: scalaTestHarness(`
runTest("basic") {
  if sumArray(List(1, 2, 3)) != 6 then throw RuntimeException("expected 6")
}
runTest("empty") {
  if sumArray(Nil) != 0 then throw RuntimeException("empty")
}
runTest("mixed") {
  if sumArray(List(-5, 5, 10, -2)) != 8 then throw RuntimeException("expected 8")
}
`),
      },
    },
  };
}

/// Scala 3 test harness — provides a runTest helper plus a @main
/// entrypoint that drives the test bodies. The runtime invokes
/// scala-cli with a --main-class targeting `runTests`; if the
/// learner kicks off a Run from the playground without tests,
/// scala-cli runs whichever @main is in source instead.
function scalaTestHarness(body) {
  return `
def runTest(name: String)(body: => Unit): Unit =
  try {
    body
    println(s"KATA_TEST::\$name::PASS")
  } catch {
    case e: Throwable =>
      println(s"KATA_TEST::\$name::FAIL::\${e.getMessage}")
  }

@main def runTests(): Unit =
${body.split("\n").map((l) => l.length ? "  " + l : l).join("\n")}
`;
}

// ────────────────────────── SQL ──────────────────────────────────

function makeSqlPack() {
  return {
    id: "challenges-sql-handwritten",
    title: "SQL Challenges",
    language: "sql",
    description:
      "Five hand-written Easy challenges for SQL. Each Run gets a fresh in-memory SQLite database. Tests use leading `-- expect: <n> rows, {row}` comments — the runtime parses them per query.",
    impls: {
      hello: {
        body: `## Hello, world (SQL flavour)

SQL doesn't print like other languages — it returns result sets. For your "hello world" challenge, write a query that returns a single row with a column named \`greeting\` containing the string \`Hello, world!\`.

\`\`\`
SELECT 'Hello, world!' AS greeting;
\`\`\`

(Yes, that's the entire solution. Confirm the runtime renders the result table correctly before moving on.)
`,
        starter: `-- TODO: SELECT a constant 'Hello, world!' aliased as greeting.\n`,
        solution: `SELECT 'Hello, world!' AS greeting;\n`,
        tests: `-- expect: 1 row, {"greeting": "Hello, world!"}
SELECT 'Hello, world!' AS greeting;
`,
      },
      add: {
        body: `## Compute a sum

Write a query that returns the sum of two values: 2 and 3, in a column named \`total\`.

\`\`\`
SELECT 2 + 3 AS total;  -- → 5
\`\`\`

The challenge is just to confirm SQLite handles arithmetic in SELECT — useful when computing aggregates later.
`,
        starter: `-- TODO: return 2 + 3 in a column called total.\n`,
        solution: `SELECT 2 + 3 AS total;\n`,
        tests: `-- expect: 1 row, {"total": 5}
SELECT 2 + 3 AS total;
`,
      },
      reverse_string: {
        body: `## Reverse a string column

SQLite has a \`REVERSE\` built-in (some other dialects don't, but for our in-memory engine it's available).

Write a query that, given a string literal \`'hello'\`, returns the string reversed in a column named \`reversed\`.
`,
        starter: `-- TODO: return REVERSE('hello') aliased as reversed.\n`,
        solution: `SELECT REVERSE('hello') AS reversed;\n`,
        tests: `-- expect: 1 row, {"reversed": "olleh"}
SELECT REVERSE('hello') AS reversed;
`,
      },
      is_palindrome: {
        body: `## Detect a palindrome

Given a string, return a 1-row result with column \`is_pal\` set to \`1\` if the string is a palindrome, \`0\` otherwise.

For this challenge, hard-code the input as \`'racecar'\` (so the answer is always \`1\`). The next pack will introduce variable inputs.
`,
        starter: `-- TODO: return 1 in column is_pal when 'racecar' equals its reverse.\n`,
        solution: `SELECT (CASE WHEN 'racecar' = REVERSE('racecar') THEN 1 ELSE 0 END) AS is_pal;\n`,
        tests: `-- expect: 1 row, {"is_pal": 1}
SELECT (CASE WHEN 'racecar' = REVERSE('racecar') THEN 1 ELSE 0 END) AS is_pal;
`,
      },
      sum_array: {
        body: `## Sum a column

Create a temporary table \`numbers\` with a single column \`v\`, insert the values \`1, 2, 3\`, then SELECT the SUM aliased as \`total\`.

The full challenge is three statements: CREATE, INSERT, SELECT.
`,
        starter: `-- TODO:
-- 1. CREATE TABLE numbers (v INTEGER);
-- 2. INSERT INTO numbers (v) VALUES (1), (2), (3);
-- 3. SELECT SUM(v) AS total FROM numbers;
`,
        solution: `CREATE TABLE numbers (v INTEGER);
INSERT INTO numbers (v) VALUES (1), (2), (3);
SELECT SUM(v) AS total FROM numbers;
`,
        tests: `-- expect: 1 row, {"total": 6}
SELECT SUM(v) AS total FROM numbers;
`,
      },
    },
  };
}

// ────────────────────────── Elixir ───────────────────────────────

function makeElixirPack() {
  return {
    id: "challenges-elixir-handwritten",
    title: "Elixir Challenges",
    language: "elixir",
    description:
      "Five hand-written Easy challenges for Elixir. Solutions use Elixir's standard library + pipe operator where natural; tests run via `elixir <file>` on the host.",
    impls: {
      hello: {
        starter: `# TODO: implement Solution.greeting/0 returning "Hello, world!".
defmodule Solution do
  def greeting, do: raise "TODO"
end
`,
        solution: `defmodule Solution do
  def greeting, do: "Hello, world!"
end
`,
        tests: elixirTestHarness(`
run_test "greets", fn ->
  unless Solution.greeting == "Hello, world!", do: raise "expected 'Hello, world!', got '#{Solution.greeting}'"
end
`),
      },
      add: {
        starter: `# TODO: implement add/2 returning a + b.
defmodule Solution do
  def add(_a, _b), do: raise "TODO"
end
`,
        solution: `defmodule Solution do
  def add(a, b), do: a + b
end
`,
        tests: elixirTestHarness(`
run_test "two_positives", fn ->
  unless Solution.add(2, 3) == 5, do: raise "expected 5"
end

run_test "crosses_zero", fn ->
  unless Solution.add(-4, 4) == 0, do: raise "expected 0"
end

run_test "hundreds", fn ->
  unless Solution.add(100, 200) == 300, do: raise "expected 300"
end
`),
      },
      reverse_string: {
        starter: `# TODO: implement reverse_string/1.
# Tip: String.reverse is one call.
defmodule Solution do
  def reverse_string(_s), do: raise "TODO"
end
`,
        solution: `defmodule Solution do
  def reverse_string(s), do: String.reverse(s)
end
`,
        tests: elixirTestHarness(`
run_test "hello", fn ->
  unless Solution.reverse_string("hello") == "olleh", do: raise "expected 'olleh'"
end

run_test "single_char", fn ->
  unless Solution.reverse_string("a") == "a", do: raise "expected 'a'"
end

run_test "empty", fn ->
  unless Solution.reverse_string("") == "", do: raise "expected ''"
end
`),
      },
      is_palindrome: {
        starter: `defmodule Solution do
  def is_palindrome?(_s), do: raise "TODO"
end
`,
        solution: `defmodule Solution do
  def is_palindrome?(s), do: s == String.reverse(s)
end
`,
        tests: elixirTestHarness(`
run_test "racecar", fn ->
  unless Solution.is_palindrome?("racecar"), do: raise "racecar"
end

run_test "not_a_palindrome", fn ->
  if Solution.is_palindrome?("hello"), do: raise "hello"
end

run_test "single_char", fn ->
  unless Solution.is_palindrome?("a"), do: raise "single char"
end

run_test "empty", fn ->
  unless Solution.is_palindrome?(""), do: raise "empty"
end
`),
      },
      sum_array: {
        starter: `defmodule Solution do
  def sum_array(_xs), do: raise "TODO"
end
`,
        solution: `defmodule Solution do
  def sum_array(xs), do: Enum.sum(xs)
end
`,
        tests: elixirTestHarness(`
run_test "basic", fn ->
  unless Solution.sum_array([1, 2, 3]) == 6, do: raise "expected 6"
end

run_test "empty", fn ->
  unless Solution.sum_array([]) == 0, do: raise "empty"
end

run_test "mixed", fn ->
  unless Solution.sum_array([-5, 5, 10, -2]) == 8, do: raise "expected 8"
end
`),
      },
    },
  };
}

function elixirTestHarness(body) {
  return `
defmodule KataTest do
  def run_test(name, fun) do
    try do
      fun.()
      IO.puts("KATA_TEST::#{name}::PASS")
    rescue
      e ->
        IO.puts("KATA_TEST::#{name}::FAIL::#{Exception.message(e)}")
    end
  end
end

import KataTest
${body}`;
}

// ────────────────────────── Zig ──────────────────────────────────

function makeZigPack() {
  return {
    id: "challenges-zig-handwritten",
    title: "Zig Challenges",
    language: "zig",
    description:
      "Five hand-written Easy challenges for Zig. Solutions stay inside Zig's stdlib (no external deps); tests run via `zig run` on the host. Same problem set as the Ruby / Lua / Dart / Haskell / Scala / Elixir packs so you can compare idioms.",
    impls: {
      hello: {
        starter: `// TODO: implement greeting() returning "Hello, world!".
pub fn greeting() []const u8 {
    // TODO
    return "";
}
`,
        solution: `pub fn greeting() []const u8 {
    return "Hello, world!";
}
`,
        tests: zigTestHarness(`
const expected_greeting: []const u8 = "Hello, world!";

fn testGreets() !void {
    const got = greeting();
    if (!std_kata.mem.eql(u8, got, expected_greeting)) return error.WrongAnswer;
}
`, [
          { name: "greets", fn: "testGreets" },
        ]),
      },

      add: {
        starter: `// TODO: return the sum of two i32 values.
pub fn add(a: i32, b: i32) i32 {
    _ = a;
    _ = b;
    return 0;
}
`,
        solution: `pub fn add(a: i32, b: i32) i32 {
    return a + b;
}
`,
        tests: zigTestHarness(`
fn testTwoPositives() !void {
    if (add(2, 3) != 5) return error.WrongAnswer;
}
fn testCrossesZero() !void {
    if (add(-4, 4) != 0) return error.WrongAnswer;
}
fn testHundreds() !void {
    if (add(100, 200) != 300) return error.WrongAnswer;
}
`, [
          { name: "two_positives", fn: "testTwoPositives" },
          { name: "crosses_zero", fn: "testCrossesZero" },
          { name: "hundreds", fn: "testHundreds" },
        ]),
      },

      reverse_string: {
        body: `## Reverse a string

Implement \`reverseString\` that takes a slice of bytes and returns a fresh slice with the bytes in reverse order.

\`\`\`
reverseString(allocator, "hello") -> "olleh"
reverseString(allocator, "a")     -> "a"
reverseString(allocator, "")      -> ""
\`\`\`

You'll need an allocator since the result lives on the heap. Use \`std.heap.page_allocator\` for the harness — the test calls free for you.

Note: this is a *byte* reverse, not a Unicode-grapheme reverse. For ASCII inputs the two are identical; multi-byte UTF-8 codepoints would split. The tests only cover ASCII.
`,
        starter: `const std = @import("std");

// TODO: allocate a slice of bytes the same length as src, copy
// src into it backwards, and return the new slice.
pub fn reverseString(allocator: std.mem.Allocator, src: []const u8) ![]u8 {
    _ = allocator;
    _ = src;
    return error.NotImplemented;
}
`,
        solution: `const std = @import("std");

pub fn reverseString(allocator: std.mem.Allocator, src: []const u8) ![]u8 {
    const out = try allocator.alloc(u8, src.len);
    var i: usize = 0;
    while (i < src.len) : (i += 1) {
        out[i] = src[src.len - 1 - i];
    }
    return out;
}
`,
        tests: zigTestHarness(`
fn checkReverse(input: []const u8, expected: []const u8) !void {
    const allocator = std_kata.heap.page_allocator;
    const got = try reverseString(allocator, input);
    defer allocator.free(got);
    if (!std_kata.mem.eql(u8, got, expected)) return error.WrongAnswer;
}

fn testHello() !void { try checkReverse("hello", "olleh"); }
fn testSingle() !void { try checkReverse("a", "a"); }
fn testEmpty() !void { try checkReverse("", ""); }
`, [
          { name: "hello", fn: "testHello" },
          { name: "single_char", fn: "testSingle" },
          { name: "empty", fn: "testEmpty" },
        ]),
        hints: [
          "Allocate `src.len` bytes with `allocator.alloc(u8, src.len)`.",
          "Walk the source backward and write into the destination forward (or vice versa).",
          "Don't forget the allocation can fail — propagate with `try`.",
        ],
      },

      is_palindrome: {
        starter: `// TODO: return true when s reads the same forward and backward.
pub fn isPalindrome(s: []const u8) bool {
    _ = s;
    return false;
}
`,
        solution: `pub fn isPalindrome(s: []const u8) bool {
    var i: usize = 0;
    while (i < s.len / 2) : (i += 1) {
        if (s[i] != s[s.len - 1 - i]) return false;
    }
    return true;
}
`,
        tests: zigTestHarness(`
fn testRacecar() !void {
    if (!isPalindrome("racecar")) return error.WrongAnswer;
}
fn testNot() !void {
    if (isPalindrome("hello")) return error.WrongAnswer;
}
fn testSingle() !void {
    if (!isPalindrome("a")) return error.WrongAnswer;
}
fn testEmpty() !void {
    if (!isPalindrome("")) return error.WrongAnswer;
}
`, [
          { name: "racecar", fn: "testRacecar" },
          { name: "not_a_palindrome", fn: "testNot" },
          { name: "single_char", fn: "testSingle" },
          { name: "empty", fn: "testEmpty" },
        ]),
      },

      sum_array: {
        starter: `// TODO: return the sum of every i32 in xs.
pub fn sumArray(xs: []const i32) i32 {
    _ = xs;
    return 0;
}
`,
        solution: `pub fn sumArray(xs: []const i32) i32 {
    var total: i32 = 0;
    for (xs) |x| total += x;
    return total;
}
`,
        tests: zigTestHarness(`
fn testBasic() !void {
    const xs = [_]i32{ 1, 2, 3 };
    if (sumArray(&xs) != 6) return error.WrongAnswer;
}
fn testEmpty() !void {
    const xs = [_]i32{};
    if (sumArray(&xs) != 0) return error.WrongAnswer;
}
fn testMixed() !void {
    const xs = [_]i32{ -5, 5, 10, -2 };
    if (sumArray(&xs) != 8) return error.WrongAnswer;
}
`, [
          { name: "basic", fn: "testBasic" },
          { name: "empty", fn: "testEmpty" },
          { name: "mixed", fn: "testMixed" },
        ]),
      },
    },
  };
}

/// Zig test harness — emits KATA_TEST::name::PASS|FAIL on stdout via
/// std.io.getStdOut(). The body is the test-fn definitions; `cases`
/// is the list of {name, fn} pairs to call from main(). Generating
/// main here keeps it OUT of user code so the user never has two
/// `main` definitions in one file (Zig errors loudly on that).
///
/// Note: Zig's `comptime` import system means the test body can do
/// `const std = @import("std")` at the top — but the user's solution
/// often imports std too. Duplicate top-level imports of the same
/// module are fine in Zig (they bind the same constant), so we don't
/// need to dedup.
function zigTestHarness(body, cases) {
  // Each test fn is passed as `&testName` to coerce the function value
  // to a `*const fn () anyerror!void` pointer. Modern Zig (0.11+)
  // requires the address-of for function-pointer parameters.
  const runCalls = cases
    .map(
      (c) =>
        `    runTest(out, "${c.name}", &${c.fn}) catch {};`,
    )
    .join("\n");
  return `
const std_kata = @import("std");
${body}

fn runTest(out: anytype, name: []const u8, body_fn: *const fn () anyerror!void) !void {
    if (body_fn()) |_| {
        try out.print("KATA_TEST::{s}::PASS\\n", .{name});
    } else |err| {
        try out.print("KATA_TEST::{s}::FAIL::{s}\\n", .{ name, @errorName(err) });
    }
}

pub fn main() !void {
    const out = std_kata.io.getStdOut().writer();
${runCalls}
}
`;
}

// ────────────────────────── Move (stubbed runtime) ───────────────

function makeMovePack() {
  return {
    id: "challenges-move-handwritten",
    title: "Move Challenges",
    language: "move",
    description:
      "Five hand-written Easy challenges for Move. Tests use the language's native `#[test]` form — the runtime is stubbed in this build (see roadmap), so Run currently surfaces an install-hint banner. Author-ready for when the runtime lands.",
    impls: {
      hello: {
        starter: `module hello::greeter {
    use std::string::{Self, String};

    public fun greeting(): String {
        // TODO: return string::utf8(b"Hello, world!")
        string::utf8(b"")
    }
}
`,
        solution: `module hello::greeter {
    use std::string::{Self, String};

    public fun greeting(): String {
        string::utf8(b"Hello, world!")
    }
}
`,
        tests: `module hello::greeter_tests {
    use hello::greeter;
    use std::string;

    #[test]
    fun greets() {
        assert!(greeter::greeting() == string::utf8(b"Hello, world!"), 0);
    }
}
`,
      },
      add: {
        starter: `module hello::math {
    public fun add(_a: u64, _b: u64): u64 {
        // TODO: return a + b
        0
    }
}
`,
        solution: `module hello::math {
    public fun add(a: u64, b: u64): u64 {
        a + b
    }
}
`,
        tests: `module hello::math_tests {
    use hello::math;

    #[test]
    fun two_positives() {
        assert!(math::add(2, 3) == 5, 1);
    }

    #[test]
    fun hundreds() {
        assert!(math::add(100, 200) == 300, 2);
    }
}
`,
      },
      reverse_string: {
        starter: `module hello::strings {
    use std::vector;
    use std::string::{Self, String};

    public fun reverse_string(s: &String): String {
        // TODO: walk the byte vector backward and rebuild a String.
        // Note: this byte-reverses; for ASCII it matches char-reverse.
        let bytes = string::bytes(s);
        let _len = vector::length(bytes);
        string::utf8(b"")
    }
}
`,
        solution: `module hello::strings {
    use std::vector;
    use std::string::{Self, String};

    public fun reverse_string(s: &String): String {
        let bytes = string::bytes(s);
        let len = vector::length(bytes);
        let i = len;
        let out = vector::empty<u8>();
        while (i > 0) {
            i = i - 1;
            vector::push_back(&mut out, *vector::borrow(bytes, i));
        };
        string::utf8(out)
    }
}
`,
        tests: `module hello::strings_tests {
    use hello::strings;
    use std::string;

    #[test]
    fun reverses_hello() {
        let input = string::utf8(b"hello");
        let reversed = strings::reverse_string(&input);
        assert!(reversed == string::utf8(b"olleh"), 1);
    }
}
`,
      },
      is_palindrome: {
        starter: `module hello::pal {
    use std::string::String;

    public fun is_palindrome(_s: &String): bool {
        // TODO: compare s against its byte-reverse.
        false
    }
}
`,
        solution: `module hello::pal {
    use std::vector;
    use std::string::{Self, String};

    public fun is_palindrome(s: &String): bool {
        let bytes = string::bytes(s);
        let len = vector::length(bytes);
        let i = 0;
        while (i < len / 2) {
            if (*vector::borrow(bytes, i) != *vector::borrow(bytes, len - 1 - i)) {
                return false
            };
            i = i + 1;
        };
        true
    }
}
`,
        tests: `module hello::pal_tests {
    use hello::pal;
    use std::string;

    #[test]
    fun racecar() {
        assert!(pal::is_palindrome(&string::utf8(b"racecar")), 1);
    }

    #[test]
    fun not_a_palindrome() {
        assert!(!pal::is_palindrome(&string::utf8(b"hello")), 2);
    }
}
`,
      },
      sum_array: {
        starter: `module hello::sums {
    use std::vector;

    public fun sum_array(_xs: &vector<u64>): u64 {
        // TODO: walk the vector accumulating into a u64.
        0
    }
}
`,
        solution: `module hello::sums {
    use std::vector;

    public fun sum_array(xs: &vector<u64>): u64 {
        let total: u64 = 0;
        let i = 0;
        let len = vector::length(xs);
        while (i < len) {
            total = total + *vector::borrow(xs, i);
            i = i + 1;
        };
        total
    }
}
`,
        tests: `module hello::sums_tests {
    use hello::sums;

    #[test]
    fun basic() {
        let v = vector[1u64, 2, 3];
        assert!(sums::sum_array(&v) == 6, 1);
    }

    #[test]
    fun empty() {
        let v = vector::empty<u64>();
        assert!(sums::sum_array(&v) == 0, 2);
    }
}
`,
      },
    },
  };
}

// ────────────────────────── Cairo (stubbed runtime) ──────────────

function makeCairoPack() {
  return {
    id: "challenges-cairo-handwritten",
    title: "Cairo Challenges",
    language: "cairo",
    description:
      "Five hand-written Easy challenges for Cairo 1. Tests use Cairo's `#[test]` form — runtime is stubbed in this build; Run surfaces an install hint until Scarb is wired.",
    impls: {
      hello: {
        starter: `// TODO: return the literal 'Hello, world!' as a felt252.
fn greet() -> felt252 {
    0
}
`,
        solution: `fn greet() -> felt252 {
    'Hello, world!'
}
`,
        tests: `#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn greets() {
        assert(greet() == 'Hello, world!', 'wrong greeting');
    }
}
`,
      },
      add: {
        starter: `fn add(_a: u32, _b: u32) -> u32 {
    // TODO: return a + b
    0
}
`,
        solution: `fn add(a: u32, b: u32) -> u32 {
    a + b
}
`,
        tests: `#[cfg(test)]
mod tests {
    use super::add;

    #[test]
    fn two_positives() {
        assert(add(2, 3) == 5, 'expected 5');
    }

    #[test]
    fn hundreds() {
        assert(add(100, 200) == 300, 'expected 300');
    }
}
`,
      },
      reverse_string: {
        body: `## Reverse a "string"

Cairo doesn't have a heap-allocated String type out of the box (in Cairo 1's core library); short strings live as \`felt252\` packed values. For this challenge, work with a fixed-size byte array (\`Array<u8>\`) and reverse it in place.

\`\`\`
reverse_bytes([1, 2, 3]) -> [3, 2, 1]
\`\`\`
`,
        starter: `fn reverse_bytes(_xs: Array<u8>) -> Array<u8> {
    // TODO: build a new Array containing xs in reverse.
    ArrayTrait::new()
}
`,
        solution: `fn reverse_bytes(xs: Array<u8>) -> Array<u8> {
    let mut out = ArrayTrait::new();
    let mut i = xs.len();
    loop {
        if i == 0 { break; }
        i -= 1;
        out.append(*xs.at(i));
    };
    out
}
`,
        tests: `#[cfg(test)]
mod tests {
    use super::reverse_bytes;

    #[test]
    fn reverses() {
        let mut input = ArrayTrait::new();
        input.append(1_u8); input.append(2); input.append(3);
        let out = reverse_bytes(input);
        assert(*out.at(0) == 3, '0'); assert(*out.at(1) == 2, '1'); assert(*out.at(2) == 1, '2');
    }
}
`,
      },
      is_palindrome: {
        body: `## Palindrome over Array<u8>

Same shape as the previous challenge — work with \`Array<u8>\` rather than a string. Return \`bool\`.
`,
        starter: `fn is_palindrome(_xs: @Array<u8>) -> bool {
    // TODO: compare xs[i] against xs[len-1-i] for the first half.
    false
}
`,
        solution: `fn is_palindrome(xs: @Array<u8>) -> bool {
    let len = xs.len();
    let mut i: u32 = 0;
    let mut ok = true;
    loop {
        if i >= len / 2 { break; }
        if *xs.at(i) != *xs.at(len - 1 - i) {
            ok = false;
            break;
        }
        i += 1;
    };
    ok
}
`,
        tests: `#[cfg(test)]
mod tests {
    use super::is_palindrome;

    #[test]
    fn yes() {
        let mut a = ArrayTrait::new();
        a.append(1_u8); a.append(2); a.append(1);
        assert(is_palindrome(@a), 'should pal');
    }

    #[test]
    fn no() {
        let mut a = ArrayTrait::new();
        a.append(1_u8); a.append(2); a.append(3);
        assert(!is_palindrome(@a), 'should not');
    }
}
`,
      },
      sum_array: {
        starter: `fn sum_array(_xs: @Array<u32>) -> u32 {
    // TODO: walk xs, accumulating into a u32.
    0
}
`,
        solution: `fn sum_array(xs: @Array<u32>) -> u32 {
    let mut total: u32 = 0;
    let mut i: u32 = 0;
    let len = xs.len();
    loop {
        if i >= len { break; }
        total += *xs.at(i);
        i += 1;
    };
    total
}
`,
        tests: `#[cfg(test)]
mod tests {
    use super::sum_array;

    #[test]
    fn basic() {
        let mut a = ArrayTrait::new();
        a.append(1_u32); a.append(2); a.append(3);
        assert(sum_array(@a) == 6, 'expected 6');
    }

    #[test]
    fn empty() {
        let a: Array<u32> = ArrayTrait::new();
        assert(sum_array(@a) == 0, 'empty is 0');
    }
}
`,
      },
    },
  };
}

// ────────────────────────── Sway (stubbed runtime) ───────────────

function makeSwayPack() {
  return {
    id: "challenges-sway-handwritten",
    title: "Sway Challenges",
    language: "sway",
    description:
      "Five hand-written Easy challenges for Sway. Tests use Sway's `#[test]` attribute — runtime stubbed in this build; Run surfaces an install hint until forc is wired.",
    impls: {
      hello: {
        starter: `library;

pub fn greet() -> str[13] {
    // TODO: return the literal "Hello, world!" as a fixed-size str.
    __to_str_array("")
}
`,
        solution: `library;

pub fn greet() -> str[13] {
    __to_str_array("Hello, world!")
}
`,
        tests: `library;

use ::greeter::greet;

#[test]
fn greets() {
    let g = greet();
    // Sway str[N] comparisons need raw_slice or sha256-of-bytes;
    // for the kata test we just call greet() and trust no abort.
    let _ = g;
}
`,
      },
      add: {
        starter: `library;

pub fn add(_a: u64, _b: u64) -> u64 {
    // TODO: return a + b
    0
}
`,
        solution: `library;

pub fn add(a: u64, b: u64) -> u64 {
    a + b
}
`,
        tests: `library;

use ::math::add;

#[test]
fn two_positives() {
    assert(add(2, 3) == 5);
}

#[test]
fn hundreds() {
    assert(add(100, 200) == 300);
}
`,
      },
      reverse_string: {
        body: `## Reverse a Vec<u8>

Sway's string type is a fixed-size \`str[N]\`; for runtime-sized data we use \`Vec<u8>\`. Reverse a Vec.
`,
        starter: `library;

use std::vec::Vec;

pub fn reverse_bytes(xs: Vec<u8>) -> Vec<u8> {
    // TODO: walk xs in reverse and push each byte into a new Vec.
    Vec::new()
}
`,
        solution: `library;

use std::vec::Vec;

pub fn reverse_bytes(xs: Vec<u8>) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut i = xs.len();
    while i > 0 {
        i -= 1;
        out.push(xs.get(i).unwrap());
    }
    out
}
`,
        tests: `library;

use ::strings::reverse_bytes;
use std::vec::Vec;

#[test]
fn reverses() {
    let mut v: Vec<u8> = Vec::new();
    v.push(1u8); v.push(2u8); v.push(3u8);
    let r = reverse_bytes(v);
    assert(r.get(0).unwrap() == 3u8);
    assert(r.get(1).unwrap() == 2u8);
    assert(r.get(2).unwrap() == 1u8);
}
`,
      },
      is_palindrome: {
        body: `## Palindrome over Vec<u8>

Compare \`xs[i]\` against \`xs[len-1-i]\` for the first half of the Vec.
`,
        starter: `library;

use std::vec::Vec;

pub fn is_palindrome(_xs: Vec<u8>) -> bool {
    // TODO
    false
}
`,
        solution: `library;

use std::vec::Vec;

pub fn is_palindrome(xs: Vec<u8>) -> bool {
    let len = xs.len();
    let mut i: u64 = 0;
    while i < len / 2 {
        if xs.get(i).unwrap() != xs.get(len - 1 - i).unwrap() {
            return false;
        }
        i += 1;
    }
    true
}
`,
        tests: `library;

use ::pal::is_palindrome;
use std::vec::Vec;

#[test]
fn yes() {
    let mut v: Vec<u8> = Vec::new();
    v.push(1u8); v.push(2u8); v.push(1u8);
    assert(is_palindrome(v));
}

#[test]
fn no() {
    let mut v: Vec<u8> = Vec::new();
    v.push(1u8); v.push(2u8); v.push(3u8);
    assert(!is_palindrome(v));
}
`,
      },
      sum_array: {
        starter: `library;

use std::vec::Vec;

pub fn sum_array(_xs: Vec<u64>) -> u64 {
    // TODO
    0
}
`,
        solution: `library;

use std::vec::Vec;

pub fn sum_array(xs: Vec<u64>) -> u64 {
    let mut total: u64 = 0;
    let mut i: u64 = 0;
    while i < xs.len() {
        total += xs.get(i).unwrap();
        i += 1;
    }
    total
}
`,
        tests: `library;

use ::sums::sum_array;
use std::vec::Vec;

#[test]
fn basic() {
    let mut v: Vec<u64> = Vec::new();
    v.push(1u64); v.push(2); v.push(3);
    assert(sum_array(v) == 6);
}

#[test]
fn empty() {
    let v: Vec<u64> = Vec::new();
    assert(sum_array(v) == 0);
}
`,
      },
    },
  };
}

// ────────────────────────── Build + write ────────────────────────

function buildCourseJson(pack) {
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    author: "Fishbones",
    language: pack.language,
    packType: "challenges",
    releaseStatus: "UNREVIEWED",
    chapters: [
      {
        id: "easy",
        title: "Easy",
        lessons: SHARED_CHALLENGES.map((spec) => {
          const impl = pack.impls[spec.id];
          if (!impl) {
            throw new Error(
              `pack ${pack.id} missing implementation for challenge "${spec.id}"`,
            );
          }
          return {
            id: spec.id,
            kind: "exercise",
            title: spec.title,
            body: impl.body ?? spec.body,
            language: pack.language,
            topic: pack.language,
            difficulty: "easy",
            starter: impl.starter,
            solution: impl.solution,
            tests: impl.tests,
            hints: impl.hints ?? spec.hints,
          };
        }),
      },
    ],
  };
}

async function main() {
  // Resolve the user's app-data dir. macOS default; XDG_DATA_HOME
  // honored if set so this script works on Linux installs too.
  const appData =
    process.env.FISHBONES_COURSES_DIR ??
    (process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "com.mattssoftware.kata")
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "com.mattssoftware.kata",
        ));
  const coursesRoot = join(appData, "courses");

  if (!existsSync(coursesRoot)) {
    await mkdir(coursesRoot, { recursive: true });
  }

  let written = 0;
  for (const [, pack] of Object.entries(PACKS)) {
    const courseJson = buildCourseJson(pack);
    const dir = join(coursesRoot, pack.id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "course.json"),
      JSON.stringify(courseJson, null, 2),
      "utf-8",
    );
    const lessonCount = courseJson.chapters[0].lessons.length;
    console.log(
      `[challenges] wrote ${pack.id} (${lessonCount} lessons) → ${dir}`,
    );
    written += 1;
  }
  console.log(`\n[challenges] wrote ${written} packs.`);
  console.log(
    "[challenges] Restart the desktop app to see them in the Library shelf.",
  );
}

await main();
