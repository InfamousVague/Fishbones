/// Custom Monaco Monarch tokenizer for Zig (`.zig`).
///
/// Monaco doesn't ship Zig out of the box. The grammar below is hand-
/// rolled, modelled on Monaco's `rust` tokenizer (Zig is a C-family
/// language with `{}` blocks and `;` line terminators, but its
/// keyword set is more concise and it has Zig-specific touches like
/// `comptime`, `error`, `try`, `catch`, payload captures `|x|`,
/// builtin functions `@import`, `@TypeOf`, etc.).
///
/// Covered:
///   - `//` line comments + `///`/`//!` doc comments
///   - String literals (`"..."`), multiline strings (`\\foo\n`),
///     char literals (`'a'`)
///   - Numbers — int (decimal/hex `0x`/oct `0o`/bin `0b`), float,
///     underscore-grouped (`1_000_000`)
///   - Reserved keywords (fn, const, var, pub, comptime, return, if,
///     else, while, for, switch, defer, errdefer, try, catch, error,
///     struct, enum, union, packed, extern, export, anytype, …)
///   - Builtin functions starting with `@` (`@import`, `@TypeOf`, …)
///   - Standard primitive types (i8..i128, u8..u128, f16..f128, bool,
///     void, anyerror, comptime_int, comptime_float, isize, usize)
///   - Operators: `=>`, `..`, `..=`, `??`, `!`, `?`, `&`, `|`, `**`,
///     plus the standard arithmetic / comparison set

import type { languages } from "monaco-editor";

const KEYWORDS = [
  "addrspace",
  "align",
  "allowzero",
  "and",
  "anyframe",
  "anytype",
  "asm",
  "async",
  "await",
  "break",
  "callconv",
  "catch",
  "comptime",
  "const",
  "continue",
  "defer",
  "else",
  "enum",
  "errdefer",
  "error",
  "export",
  "extern",
  "fn",
  "for",
  "if",
  "inline",
  "linksection",
  "noalias",
  "noinline",
  "nosuspend",
  "opaque",
  "or",
  "orelse",
  "packed",
  "pub",
  "resume",
  "return",
  "struct",
  "suspend",
  "switch",
  "test",
  "threadlocal",
  "try",
  "undefined",
  "union",
  "unreachable",
  "usingnamespace",
  "var",
  "volatile",
  "while",
  "null",
  "true",
  "false",
];

const PRIMITIVE_TYPES = [
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "isize",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "usize",
  "c_short",
  "c_ushort",
  "c_int",
  "c_uint",
  "c_long",
  "c_ulong",
  "c_longlong",
  "c_ulonglong",
  "c_longdouble",
  "f16",
  "f32",
  "f64",
  "f80",
  "f128",
  "bool",
  "void",
  "anyerror",
  "anyopaque",
  "noreturn",
  "comptime_int",
  "comptime_float",
  "type",
];

export const zigLang: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".zig",

  keywords: KEYWORDS,
  typeKeywords: PRIMITIVE_TYPES,

  operators: [
    "+",
    "-",
    "*",
    "/",
    "%",
    "**",
    "+%",
    "-%",
    "*%",
    "+|",
    "-|",
    "*|",
    "=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "&",
    "|",
    "^",
    "~",
    "!",
    "?",
    "??",
    "<<",
    ">>",
    "<<=",
    ">>=",
    "&=",
    "|=",
    "^=",
    "..",
    "..=",
    "->",
    "=>",
    ".",
  ],

  symbols: /[=><!~?:&|+\-*/^%@.]+/,

  tokenizer: {
    root: [
      // Doc comments first so `///` doesn't get captured by `//`.
      [/\/\/[!/].*$/, "comment.doc"],
      [/\/\/.*$/, "comment"],

      // Multiline string literal — Zig's `\\` prefix on each line.
      [/\\\\/, { token: "string", next: "@multilineString" }],

      [/"/, { token: "string.quote", next: "@string" }],
      [/'(?:\\.|[^\\'])'/, "string"],

      // Builtin functions like `@import("std")` — distinct colour.
      [/@[a-zA-Z_]\w*/, "predefined"],

      // Numbers — Zig allows underscores as digit separators.
      [/0[xX][\da-fA-F_]+(?:\.[\da-fA-F_]+)?(?:[pP][-+]?\d+)?/, "number.hex"],
      [/0[oO][0-7_]+/, "number.octal"],
      [/0[bB][01_]+/, "number.binary"],
      [/\d[\d_]*\.[\d_]+(?:[eE][-+]?\d+)?/, "number.float"],
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

    string: [
      [/[^"\\]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],

    // Multiline strings continue to end-of-line; the next \\ starts a
    // new segment, anything else terminates the literal so the next
    // line's tokenizer can re-enter as needed.
    multilineString: [
      [/[^\r\n]+/, "string"],
      [/[\r\n]+/, { token: "", next: "@pop" }],
    ],
  },
};

export const zigConf: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
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
    { open: "'", close: "'", notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};
