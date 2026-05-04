/// Custom Monaco Monarch tokenizer for Move (`.move`).
///
/// Move (Aptos / Sui) is a Rust-flavoured language for smart contracts.
/// Surface syntax: `module foo::bar { ... }`, `fun name(...): T { ... }`,
/// `struct`, `let`, `if`, `while`, `loop`, `return`, plus its
/// resource-oriented additions: `has key, store, copy, drop`, `acquires`,
/// `move_to`, `move_from`, `borrow_global`. Comments are `//` + `/* */`.
///
/// Modelled on Monaco's `rust` tokenizer with Move-specific vocabulary
/// stitched in.

import type { languages } from "monaco-editor";

const KEYWORDS = [
  // Block / declaration
  "module",
  "script",
  "fun",
  "public",
  "entry",
  "native",
  "friend",
  "use",
  "as",
  "struct",
  "has",
  "key",
  "store",
  "copy",
  "drop",
  "acquires",
  // Types of declarations
  "const",
  "let",
  "mut",
  "spec",
  "schema",
  // Control flow
  "if",
  "else",
  "while",
  "loop",
  "break",
  "continue",
  "return",
  "abort",
  "assert",
  // Resource-oriented + move semantics
  "move_to",
  "move_from",
  "borrow_global",
  "borrow_global_mut",
  "exists",
  "freeze",
  // Misc
  "true",
  "false",
];

const PRIMITIVE_TYPES = [
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "u256",
  "bool",
  "address",
  "signer",
  "vector",
];

export const moveLang: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".move",

  keywords: KEYWORDS,
  typeKeywords: PRIMITIVE_TYPES,

  operators: [
    "+",
    "-",
    "*",
    "/",
    "%",
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "=",
    "&",
    "|",
    "^",
    "<<",
    ">>",
    "&&",
    "||",
    "!",
    ":",
    "::",
    ";",
    ",",
    ".",
    "&mut",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  tokenizer: {
    root: [
      // Comments
      [/\/\/.*$/, "comment"],
      [/\/\*/, { token: "comment", next: "@blockComment" }],

      // Strings + bytestrings (`b"..."`, `x"deadbeef"`)
      [/[bx]"/, { token: "string.quote", next: "@string" }],
      [/"/, { token: "string.quote", next: "@string" }],

      // Numbers — `42u64`, `0x1f`, plain decimals
      [/0[xX][0-9a-fA-F_]+(?:u(?:8|16|32|64|128|256))?/, "number.hex"],
      [/\d[\d_]*(?:u(?:8|16|32|64|128|256))?/, "number"],

      // Module path separators / addresses (`0x1`)
      [/[A-Z][\w]*/, "type"],

      // Attributes (`#[test]`, `#[test_only]`)
      [/#\[[^\]]*\]/, "annotation"],

      [
        /[a-z_][\w]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "keyword.type",
            "@default": "identifier",
          },
        },
      ],

      [/[{}()[\];,]/, "delimiter"],
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],

      [/[ \t\r\n]+/, ""],
    ],

    blockComment: [
      [/[^*/]+/, "comment"],
      [/\*\//, { token: "comment", next: "@pop" }],
      [/[*/]/, "comment"],
    ],

    string: [
      [/[^"\\]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],
  },
};

export const moveConf: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
};
