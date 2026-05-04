/// Custom Monaco Monarch tokenizer for Cairo 1 (`.cairo`).
///
/// Cairo 1 (StarkNet's smart-contract language) inherits Rust-style
/// syntax with chain-specific additions: `felt252` as the native
/// scalar, `#[storage]` / `#[external]` / `#[view]` decorators, and
/// `Array<T>` literals. The grammar below mirrors Monaco's `rust`
/// tokenizer with Cairo-specific keywords + types stitched in.

import type { languages } from "monaco-editor";

const KEYWORDS = [
  // Rust-derived control flow
  "fn",
  "let",
  "mut",
  "const",
  "ref",
  "if",
  "else",
  "match",
  "loop",
  "while",
  "for",
  "in",
  "break",
  "continue",
  "return",
  // Type / module system
  "struct",
  "enum",
  "trait",
  "impl",
  "of",
  "type",
  "mod",
  "use",
  "as",
  "pub",
  "self",
  "Self",
  "super",
  // Cairo-specific
  "extern",
  "nopanic",
  "implicit",
  "felt252",
  "ContractAddress",
  "ClassHash",
  "starknet",
  "view",
  "external",
  "constructor",
  "storage",
  "event",
  "key",
  // Booleans + null-ish
  "true",
  "false",
];

const PRIMITIVE_TYPES = [
  "felt252",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "u256",
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "usize",
  "bool",
  "ByteArray",
  "Array",
  "Span",
  "Option",
  "Result",
  "Box",
  "Nullable",
];

export const cairoLang: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".cairo",

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
    "->",
    "=>",
    "..",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/\/\*/, { token: "comment", next: "@blockComment" }],

      // Cairo's short-string literal syntax: 'foo' (single-quoted ASCII
      // packed into a felt252). Distinct from char/byte literals — these
      // can be multi-character.
      [/'[^']*'/, "string"],
      [/"/, { token: "string.quote", next: "@string" }],

      // Attributes: `#[derive(...)]`, `#[storage]`, `#[external(v0)]`
      [/#\[[^\]]*\]/, "annotation"],

      // Numbers — Cairo allows hex with `0x` prefix.
      [/0[xX][0-9a-fA-F_]+/, "number.hex"],
      [/\d[\d_]*/, "number"],

      [
        /[A-Z][\w]*/,
        { cases: { "@typeKeywords": "keyword.type", "@default": "type" } },
      ],
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

export const cairoConf: languages.LanguageConfiguration = {
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
    { open: "'", close: "'", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
};
