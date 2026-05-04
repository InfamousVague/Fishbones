/// Custom Monaco Monarch tokenizer for Sway (`.sw`).
///
/// Sway is the smart-contract language for the Fuel VM. Surface
/// syntax is essentially Rust with chain-specific additions: `script;`
/// / `contract;` / `library;` / `predicate;` declarations at the file
/// head, `abi`, `storage`, `enum`, plus standard arithmetic / control
/// flow. Modelled on Monaco's `rust` tokenizer with Sway-specific
/// vocabulary.

import type { languages } from "monaco-editor";

const KEYWORDS = [
  // File-level program kinds
  "script",
  "contract",
  "library",
  "predicate",
  // Rust-style declarations
  "fn",
  "let",
  "const",
  "mut",
  "ref",
  "pub",
  "use",
  "as",
  "self",
  "Self",
  "super",
  "mod",
  "struct",
  "enum",
  "trait",
  "impl",
  "for",
  "where",
  "type",
  // Sway-specific
  "abi",
  "configurable",
  "storage",
  "deref",
  "asm",
  "dep",
  // Control flow
  "if",
  "else",
  "match",
  "while",
  "loop",
  "in",
  "break",
  "continue",
  "return",
  "yield",
  "true",
  "false",
];

const PRIMITIVE_TYPES = [
  "u8",
  "u16",
  "u32",
  "u64",
  "u256",
  "b256",
  "bool",
  "str",
  "Address",
  "ContractId",
  "AssetId",
  "Identity",
  "Vec",
  "Option",
  "Result",
  "Bytes",
];

export const swayLang: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".sw",

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

      // Strings + byte strings (`b"..."`)
      [/b?"/, { token: "string.quote", next: "@string" }],

      // Attributes: `#[storage(read)]`, `#[test]`
      [/#\[[^\]]*\]/, "annotation"],

      // Numbers — hex `0x...`, decimal, optional type suffix
      [
        /0[xX][0-9a-fA-F_]+(?:u(?:8|16|32|64|256))?/,
        "number.hex",
      ],
      [/\d[\d_]*(?:u(?:8|16|32|64|256))?/, "number"],

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

export const swayConf: languages.LanguageConfiguration = {
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
