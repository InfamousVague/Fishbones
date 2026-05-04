/// Auto-split from the original `src/runtimes/playgroundTemplates.ts`
/// monolith. Holds every single-file template entry — the small
/// "Hello, world!" snippets that the playground reaches for when a
/// learner first opens a language. Multi-file templates (web,
/// react, react-native, threejs) live in `./multi-file/`.

import type { Template } from "./_core";

/// Subset of the PLAYGROUND_TEMPLATES record: the languages whose
/// playground starter is a single file. Assembled into the full
/// record in `./index.ts`.
export const SINGLE_FILE_TEMPLATES = {
  javascript: {
    filename: "main.js",
    fileLanguage: "javascript",
    content: `console.log("Hello, world!");\n`,
  },
  typescript: {
    filename: "main.ts",
    fileLanguage: "typescript",
    content: `const greet = (name: string): string => \`Hello, \${name}!\`;\n\nconsole.log(greet("world"));\n`,
  },
  python: {
    filename: "main.py",
    fileLanguage: "python",
    content: `print("Hello, world!")\n`,
  },
  rust: {
    filename: "src/main.rs",
    fileLanguage: "rust",
    content: `fn main() {\n    println!("Hello, world!");\n}\n`,
  },
  swift: {
    filename: "main.swift",
    fileLanguage: "swift",
    content: `print("Hello, world!")\n`,
  },
  go: {
    filename: "main.go",
    fileLanguage: "go",
    content: `package main

import "fmt"

func main() {
\tfmt.Println("Hello, world!")
}
`,
  },
  c: {
    filename: "main.c",
    fileLanguage: "c",
    content: `#include <stdio.h>

int main(void) {
    printf("Hello, world!\\n");
    return 0;
}
`,
  },
  cpp: {
    filename: "main.cpp",
    fileLanguage: "cpp",
    content: `#include <iostream>

int main() {
    std::cout << "Hello, world!" << std::endl;
    return 0;
}
`,
  },
  java: {
    filename: "App.java",
    fileLanguage: "java",
    content: `public class App {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
`,
  },
  kotlin: {
    // Runner compiles with \`kotlinc -include-runtime\` + \`java -jar\`,
    // which is app mode (not .kts script mode) — so top-level
    // statements aren't valid and we need a \`fun main\` entry point.
    filename: "Main.kt",
    fileLanguage: "kotlin",
    content: `fun main() {
    val greeting = "Hello, world!"
    println(greeting)
}
`,
  },
  csharp: {
    // \`.csx\` is dotnet-script's top-level-statements format — same
    // reasoning as the Kotlin template: minimal ceremony on hello
    // world so the first Run isn't a nine-line ritual.
    filename: "main.csx",
    fileLanguage: "csharp",
    content: `using System;

Console.WriteLine("Hello, world!");
`,
  },
  svelte: {
    filename: "App.svelte",
    fileLanguage: "javascript",
    content: `<script>
  let count = $state(0);
</script>

<div class="card">
  <h1>Hello, Svelte 5!</h1>
  <p>Runes are the new reactive primitives.</p>
  <button onclick={() => count++}>
    Tapped {count} {count === 1 ? "time" : "times"}
  </button>
</div>

<style>
  .card {
    font-family: -apple-system, system-ui, sans-serif;
    color: #f5f5f7;
    background: #15151c;
    padding: 24px;
    border-radius: 12px;
    text-align: center;
    max-width: 320px;
    margin: 40px auto;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 22px;
    letter-spacing: -0.01em;
  }
  p {
    margin: 0 0 16px;
    color: #a4a4ad;
    font-size: 13px;
  }
  button {
    padding: 10px 18px;
    border: 0;
    border-radius: 999px;
    background: #ff3e00;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
</style>
`,
  },
  solid: {
    filename: "App.jsx",
    fileLanguage: "javascript",
    content: `import { createSignal } from 'solid-js';

export default function App() {
  const [count, setCount] = createSignal(0);
  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui' }}>
      <h1>Hello, Solid!</h1>
      <button onClick={() => setCount(count() + 1)}>
        Count is {count()}
      </button>
    </div>
  );
}
`,
  },
  htmx: {
    filename: "index.html",
    fileLanguage: "html",
    content: `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>HTMX</title>
  <script src="/vendor/htmx.min.js"></script>
  <style>
    body { font-family: system-ui; padding: 24px; max-width: 480px; }
    button { padding: 8px 14px; font-size: 14px; cursor: pointer; }
    #out { margin-top: 12px; padding: 12px; background: #f0f0f0; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>HTMX</h1>
  <p>Click the button to swap the response into <code>#out</code>:</p>
  <button hx-get="/echo" hx-target="#out" hx-swap="innerHTML">
    Hit /echo
  </button>
  <div id="out">(nothing yet)</div>
</body>
</html>
`,
  },
  astro: {
    filename: "index.astro",
    fileLanguage: "html",
    content: `---
const greeting = "Hello, Astro!";
const items = ["Components", "Islands", "Content collections"];
---

<html>
<head><title>{greeting}</title></head>
<body>
  <h1>{greeting}</h1>
  <ul>
    {items.map((item) => <li>{item}</li>)}
  </ul>
</body>
</html>
`,
  },
  bun: {
    filename: "main.ts",
    fileLanguage: "typescript",
    content: `// Bun.serve example. In a real Bun process this starts an HTTP
// server; here we just verify the request handler shape.
const handler = (req: Request): Response => {
  const url = new URL(req.url);
  return new Response(\`Hello from \${url.pathname}!\`);
};

const res = handler(new Request("http://localhost:3000/world"));
console.log(await res.text());
`,
  },
  tauri: {
    filename: "src-tauri/src/lib.rs",
    fileLanguage: "rust",
    content: `// Tauri command — exposed to the frontend via invoke("greet", { name }).
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}, from a Tauri command!")
}

fn main() {
    // Local sanity-check so the snippet runs as a plain Rust program.
    println!("{}", greet("Fishbones"));
}
`,
  },
  solidity: {
    filename: "Contract.sol",
    fileLanguage: "solidity",
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A tiny counter — public state, two write paths, one read path.
contract Counter {
    uint256 public count;

    event Incremented(address indexed by, uint256 newCount);

    function increment() external {
        count += 1;
        emit Incremented(msg.sender, count);
    }

    function add(uint256 amount) external {
        count += amount;
        emit Incremented(msg.sender, count);
    }

    function reset() external {
        count = 0;
    }
}
`,
  },
  assembly: {
    // macOS x86_64 / arm64 exit-with-code-42 via the BSD syscall ABI.
    // We use \`.global _main\` + a direct syscall because the user's
    // expected ergonomics for a kata is "does it exit cleanly?" rather
    // than "does it print to stdout via libc" (which requires linker
    // wrangling we don't want as a first-run experience).
    filename: "main.s",
    fileLanguage: "assembly",
    content: `        .global _main
        .align 2

_main:
        // exit(42) via the macOS BSD syscall ABI.
        //   x16 holds the syscall number; exit = 1.
        //   x0 is the argument — our exit code.
        mov     x0, #42
        mov     x16, #1
        svc     #0x80
`,
  },
  vyper: {
    filename: "Counter.vy",
    fileLanguage: "vyper",
    content: `# A tiny counter — public state, two write paths, one read path.
count: public(uint256)

event Incremented:
    by: indexed(address)
    new_count: uint256

@external
def increment():
    self.count += 1
    log Incremented(msg.sender, self.count)

@external
def add(amount: uint256):
    self.count += amount
    log Incremented(msg.sender, self.count)

@external
def reset():
    self.count = 0
`,
  },
  ruby: {
    filename: "main.rb",
    fileLanguage: "ruby",
    content: `puts "Hello, world!"\n`,
  },
  lua: {
    filename: "main.lua",
    fileLanguage: "lua",
    content: `print("Hello, world!")\n`,
  },
  dart: {
    filename: "main.dart",
    fileLanguage: "dart",
    content: `void main() {
  print('Hello, world!');
}
`,
  },
  haskell: {
    filename: "Main.hs",
    fileLanguage: "haskell",
    content: `module Main where

main :: IO ()
main = putStrLn "Hello, world!"
`,
  },
  scala: {
    filename: "Main.scala",
    fileLanguage: "scala",
    content: `@main def hello(): Unit =
  println("Hello, world!")
`,
  },
  sql: {
    filename: "query.sql",
    fileLanguage: "sql",
    content: `-- Each Run boots a fresh in-memory SQLite database.
-- The runtime prints every query's result set as a table.

CREATE TABLE pets (id INTEGER PRIMARY KEY, name TEXT, species TEXT);

INSERT INTO pets (name, species) VALUES
  ('Mochi', 'cat'),
  ('Hopper', 'dog'),
  ('Newt', 'lizard');

SELECT name, species FROM pets ORDER BY name;
`,
  },
  elixir: {
    filename: "main.exs",
    fileLanguage: "elixir",
    content: `IO.puts("Hello, world!")\n`,
  },
  zig: {
    filename: "main.zig",
    fileLanguage: "zig",
    // Zig 0.16 reorganised `std.io` — the older
    // `std.io.getStdOut().writer()` pattern errors with "no member
    // named 'io'". Use `std.debug.print` (writes to stderr; the
    // playground merges both streams into one log pane), which has
    // been stable since 0.x and avoids the writer-buffer dance the
    // newer `std.fs.File.stdout()` API now requires.
    content: `const std = @import("std");

pub fn main() !void {
    std.debug.print("Hello, world!\\n", .{});
}
`,
  },
  move: {
    filename: "Hello.move",
    fileLanguage: "move",
    content: `module hello::main {
    use std::debug;

    public fun greet() {
        debug::print(&b"Hello, world!");
    }
}
`,
  },
  cairo: {
    filename: "main.cairo",
    fileLanguage: "cairo",
    content: `// Cairo 1 — a simple function on the StarkNet VM.

fn main() -> felt252 {
    'Hello, world!'
}
`,
  },
  sway: {
    filename: "main.sw",
    fileLanguage: "sway",
    content: `// Sway — Fuel's smart-contract language.

contract;

abi Hello {
    fn greet() -> str[13];
}

impl Hello for Contract {
    fn greet() -> str[13] {
        __to_str_array("Hello, world!")
    }
}
`,
  },
} satisfies Record<string, Template>;
