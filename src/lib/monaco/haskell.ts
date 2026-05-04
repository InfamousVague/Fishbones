/// Custom Monaco Monarch tokenizer for Haskell (`.hs`).
///
/// Monaco doesn't ship Haskell out of the box, so we hand-roll one.
/// Modelled on Monaco's `python` tokenizer (whitespace-delimited, no
/// curly braces) with Haskell-specific vocabulary + the
/// `--`/`{- -}` comment shapes.
///
/// What's covered:
///   - Module declaration + imports (`module X where`, `import qualified
///     X as Y`)
///   - Line comments (`--`) + nestable block comments (`{- ... -}`)
///   - String / char literals with `\` escapes (`"hello\n"`, `'\t'`)
///   - Numeric literals — int, float, hex (`0x...`), octal (`0o...`)
///   - Reserved keywords (case, class, data, deriving, do, else, if,
///     import, in, infix(l|r), instance, let, module, newtype, of,
///     then, type, where)
///   - Type-like identifiers (capitalized) coloured as types
///   - Operators: `->`, `=>`, `<-`, `::`, `>>=`, `>>`, `$`, `.`, `++`,
///     `:`, `=`, `|`, `\`, plus the standard arithmetic / comparison
///     set
///   - Identifiers + the `where` / `let` / `in` / `do` block markers

import type { languages } from "monaco-editor";

// Reserved keywords from Haskell 2010 + GHC extensions in common use.
const KEYWORDS = [
  "case",
  "class",
  "data",
  "default",
  "deriving",
  "do",
  "else",
  "foreign",
  "if",
  "import",
  "in",
  "infix",
  "infixl",
  "infixr",
  "instance",
  "let",
  "module",
  "newtype",
  "of",
  "qualified",
  "then",
  "type",
  "where",
  "as",
  "hiding",
  // GHC-flavoured but commonly seen
  "family",
  "forall",
  "mdo",
  "rec",
  "proc",
];

// Standard Prelude type constructors / classes we want to colour as
// types. Not exhaustive (Haskell ecosystems define their own types
// constantly) — the `[A-Z]\w*` fallback in the tokenizer catches
// user-defined ones automatically.
const TYPES = [
  "Int",
  "Integer",
  "Float",
  "Double",
  "Char",
  "String",
  "Bool",
  "True",
  "False",
  "Maybe",
  "Just",
  "Nothing",
  "Either",
  "Left",
  "Right",
  "IO",
  "Ord",
  "Eq",
  "Show",
  "Read",
  "Functor",
  "Applicative",
  "Monad",
  "Num",
  "Fractional",
];

export const haskellLang: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".hs",

  keywords: KEYWORDS,
  typeKeywords: TYPES,

  operators: [
    "->",
    "=>",
    "<-",
    "::",
    ">>=",
    ">>",
    "<<",
    "$",
    ".",
    "++",
    ":",
    "=",
    "|",
    "\\",
    "<",
    ">",
    "<=",
    ">=",
    "==",
    "/=",
    "+",
    "-",
    "*",
    "/",
    "&&",
    "||",
    "!!",
    "@",
    "~",
  ],

  symbols: /[=><!~?:&|+\-*/^%@$.\\]+/,

  tokenizer: {
    root: [
      // Block comments are nestable in Haskell — push into a state
      // that counts depth.
      [/\{-/, { token: "comment", next: "@blockComment" }],
      [/--.*$/, "comment"],

      // Strings + chars
      [/"/, { token: "string.quote", next: "@string" }],
      [/'(?:\\.|[^\\'])'/, "string"],

      // Numbers — same shape as Python tokenizer's
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/0[oO][0-7]+/, "number.octal"],
      [/\d+\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/\d+/, "number"],

      // Identifiers — capitalised first letter ⇒ type / constructor;
      // lowercase / underscore ⇒ regular identifier or keyword.
      [
        /[A-Z][\w']*/,
        { cases: { "@typeKeywords": "type.identifier", "@default": "type" } },
      ],
      [
        /[a-z_][\w']*/,
        {
          cases: {
            "@keywords": "keyword",
            "@default": "identifier",
          },
        },
      ],

      // Layout / punctuation
      [/[{}()[\],;]/, "delimiter"],
      [/`[^`]+`/, "operator"], // backticked infix functions
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],

      // Whitespace
      [/[ \t\r\n]+/, ""],
    ],

    blockComment: [
      [/\{-/, { token: "comment", next: "@push" }], // nest
      [/-\}/, { token: "comment", next: "@pop" }],
      [/[^{}-]+/, "comment"],
      [/[{}-]/, "comment"],
    ],

    string: [
      [/[^"\\]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],
  },
};

export const haskellConf: languages.LanguageConfiguration = {
  comments: {
    lineComment: "--",
    blockComment: ["{-", "-}"],
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
