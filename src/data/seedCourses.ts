import { Course } from "./types";

/// Hard-coded placeholder courses so the UI has something to render before we
/// build the filesystem-backed course loader. Replace with real content once
/// the ingest pipeline lands.

export const seedCourses: Course[] = [
  {
    id: "js-first-steps",
    title: "JavaScript First Steps",
    author: "Kata Team",
    description: "A gentle intro to JavaScript. Variables, functions, and a little bit of DOM.",
    language: "javascript",
    chapters: [
      {
        id: "intro",
        title: "Introduction",
        lessons: [
          {
            id: "hello",
            kind: "reading",
            title: "What is JavaScript?",
            body: `# What is JavaScript?

JavaScript is the language of the web. It runs in every browser and, these days,
on your server too.

In this course we'll cover the fundamentals — the kind of things you reach for
every single day.

Here's a flavour of what code looks like:

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
console.log(greet("world"));
\`\`\`
`,
          },
          {
            id: "first-exercise",
            kind: "exercise",
            title: "Your first function",
            language: "javascript",
            body: `# Your first function

Implement \`add\` so that \`add(2, 3)\` returns \`5\`.`,
            starter: `function add(a, b) {
  // your code here
}

console.log('add(2, 3) =', add(2, 3));

module.exports = { add };
`,
            solution: `function add(a, b) {
  return a + b;
}

console.log('add(2, 3) =', add(2, 3));

module.exports = { add };
`,
            tests: `const { add } = require("./user");

test("adds two positive numbers", () => {
  expect(add(2, 3)).toBe(5);
});

test("adds with a negative", () => {
  expect(add(-1, 10)).toBe(9);
});

test("returns a number, not a string", () => {
  expect(typeof add(1, 2)).toBe("number");
});
`,
          },
        ],
      },
    ],
  },

  {
    id: "python-warmup",
    title: "Python Warmup",
    author: "Kata Team",
    description: "Pyodide-powered Python in the browser. Your first function.",
    language: "python",
    chapters: [
      {
        id: "intro",
        title: "Warmup",
        lessons: [
          {
            id: "py-add",
            kind: "exercise",
            title: "Your first Python function",
            language: "python",
            body: `# Your first Python function

Implement \`add\` so that \`add(2, 3)\` returns \`5\`.

The first run takes a few seconds because Python is loading into the browser
(via Pyodide). Subsequent runs are instant.`,
            starter: `def add(a, b):
    # your code here
    pass

print("add(2, 3) =", add(2, 3))
`,
            solution: `def add(a, b):
    return a + b

print("add(2, 3) =", add(2, 3))
`,
            tests: `from user import add

def _pos():
    expect(add(2, 3)).to_be(5)
test("adds two positive numbers", _pos)

def _neg():
    expect(add(-1, 10)).to_be(9)
test("adds with a negative", _neg)

def _type():
    expect(type(add(1, 2)).__name__).to_be("int")
test("returns an int", _type)
`,
          },
        ],
      },
    ],
  },

  {
    id: "rust-taste",
    title: "A Taste of Rust",
    author: "Kata Team",
    description: "Syntax and ownership from the Rust Book, condensed. Code runs via play.rust-lang.org.",
    language: "rust",
    chapters: [
      {
        id: "ownership",
        title: "Ownership",
        lessons: [
          {
            id: "ownership-reading",
            kind: "reading",
            title: "What is ownership?",
            body: `# What is ownership?

Ownership is Rust's memory-management model. Every value has a single owner.
When the owner goes out of scope, the value is dropped.

\`\`\`rust
fn main() {
    let s = String::from("hello");
    println!("{}", s);
} // s is dropped here
\`\`\`
`,
          },
          {
            id: "rust-add",
            kind: "exercise",
            title: "Your first Rust function",
            language: "rust",
            body: `# Your first Rust function

Implement \`add\` so that \`add(2, 3)\` returns \`5\`.

The first run takes a few seconds because we're compiling on the Rust
Playground servers. Subsequent runs are faster.`,
            starter: `pub fn add(a: i32, b: i32) -> i32 {
    // your code here
    0
}

fn main() {
    println!("add(2, 3) = {}", add(2, 3));
}
`,
            solution: `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn main() {
    println!("add(2, 3) = {}", add(2, 3));
}
`,
            tests: `#[test]
fn adds_two_positive_numbers() {
    assert_eq!(add(2, 3), 5);
}

#[test]
fn adds_with_a_negative() {
    assert_eq!(add(-1, 10), 9);
}

#[test]
fn is_commutative() {
    assert_eq!(add(4, 7), add(7, 4));
}
`,
          },
        ],
      },
    ],
  },
];
