/// Monkey's Paw — javascript duel content, volume 3. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./javascript.ts.
/// Verified by __tests__/duels-javascript-vol3.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const JAVASCRIPT_DUELS_VOL3: readonly PawDuel[] = [
  // ── Rank 1 · novice ──────────────────────────────────────────────
  {
    id: "paw-javascript-zero-smith",
    title: "The Zero Smith",
    wish: "Pad my ticket code with zeros until it is wide enough.",
    clauses: [
      "Codes shorter than the width gain zeros on the LEFT: \"7\" at width 3 is \"007\".",
      "A code already at the width passes through untouched.",
      "A code LONGER than the width is returned whole — the smith pads, he never cuts.",
      "The empty code at width 2 becomes \"00\".",
    ],
    signature: "function padCode(code: string, width: number): string",
    conceptTags: ["padStart", "padEnd", "string contracts", "no truncation"],
    difficulty: "novice",
    language: "javascript",
    rank: 1,
    starterTests: `const { padCode } = require('./user');

test("a full-width code passes through", () => {
  expect(padCode("42", 2)).toBe("42");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Forty-two. A code of impeccable width, and the only code my forge has ever seen. I stamp it onto every ticket, sight unseen.",
        lesson: "One example is not a specification.",
        code: `function padCode(code, width) {
  return "42";
}

module.exports = { padCode };
`,
      },
      {
        id: "suffix-smith",
        title: "The Suffix Smith",
        monologue:
          "I padded with zeros until the width was met — on the RIGHT, where there was room. Left, right… you wished for wide, and wide you got.",
        lesson:
          "padStart and padEnd are different contracts — a test where the code is actually short pins down WHICH side grows.",
        code: `function padCode(code, width) {
  return code.padEnd(width, "0");
}

module.exports = { padCode };
`,
      },
      {
        id: "guillotine",
        title: "The Guillotine",
        monologue:
          "Zeros on the left, then a clean slice to EXACTLY the width you named. Uniform tickets, every one. The codes that were too long? They fit now.",
        lesson:
          "The slice(-width) trick forces exact width — padStart never truncates, and only an over-long input can tell the two apart.",
        code: `function padCode(code, width) {
  return ("0".repeat(width) + code).slice(-width);
}

module.exports = { padCode };
`,
      },
    ],
    reference: `function padCode(code, width) {
  return code.padStart(width, "0");
}

module.exports = { padCode };
`,
    killerTests: `const { padCode } = require('./user');

test("a full-width code passes through", () => {
  expect(padCode("42", 2)).toBe("42");
});

test("short codes grow zeros on the left", () => {
  expect(padCode("7", 3)).toBe("007");
  expect(padCode("15", 4)).toBe("0015");
});

test("long codes are never cut", () => {
  expect(padCode("90210", 3)).toBe("90210");
});

test("the empty code is all zeros", () => {
  expect(padCode("", 2)).toBe("00");
});
`,
  },

  // ── Rank 2 · novice ──────────────────────────────────────────────
  {
    id: "paw-javascript-word-measurer",
    title: "The Word Measurer",
    wish: "Find the longest word in my list.",
    clauses: [
      "The longest word wins the crown.",
      "On a tie, the EARLIEST longest word keeps it — later words of equal length change nothing.",
      "An empty list crowns the empty string \"\" — no throwing, no undefined.",
    ],
    signature: "function longestWord(words: string[]): string",
    conceptTags: ["reduce", "missing initial value", "ties", "empty input"],
    difficulty: "novice",
    language: "javascript",
    rank: 2,
    starterTests: `const { longestWord } = require('./user');

test("crowns the obvious champion", () => {
  expect(longestWord(["tiny", "gigantic", "big"])).toBe("gigantic");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Gigantic — a gigantic answer for a gigantic word. I measured it once, years ago, and I have trusted the memory ever since.",
        lesson: "One example is not a specification.",
        code: `function longestWord(words) {
  return "gigantic";
}

module.exports = { longestWord };
`,
      },
      {
        id: "latecomer",
        title: "The Latecomer",
        monologue:
          "Greater-than-or-EQUAL — the generous comparison. When two words measure the same, the newest arrival takes the crown. You never wrote a law of succession.",
        lesson:
          "`>=` vs `>` in a reduce decides who wins ties — only a test with two equally-long words can tell them apart.",
        code: `function longestWord(words) {
  return words.reduce(
    (best, w) => (w.length >= best.length ? w : best),
    "",
  );
}

module.exports = { longestWord };
`,
      },
      {
        id: "init-skipper",
        title: "The Init Skipper",
        monologue:
          "reduce, elegantly seedless — the first word is its own starting point. Hand me an EMPTY list and reduce throws a tantrum the standard wrote for it. You never handed me one.",
        lesson:
          "`reduce` without an initial value THROWS on an empty array — the seed is what makes the empty case an answer instead of an exception.",
        code: `function longestWord(words) {
  if (words.length === 0) return words.reduce((best, w) => best);
  return words.reduce((best, w) => (w.length > best.length ? w : best));
}

module.exports = { longestWord };
`,
      },
    ],
    reference: `function longestWord(words) {
  return words.reduce(
    (best, w) => (w.length > best.length ? w : best),
    "",
  );
}

module.exports = { longestWord };
`,
    killerTests: `const { longestWord } = require('./user');

test("crowns the obvious champion", () => {
  expect(longestWord(["tiny", "gigantic", "big"])).toBe("gigantic");
});

test("the first of equals keeps the crown", () => {
  expect(longestWord(["moon", "star"])).toBe("moon");
  expect(longestWord(["ash", "elm", "oak"])).toBe("ash");
});

test("a lone word wins by default", () => {
  expect(longestWord(["wish"])).toBe("wish");
});

test("the empty list crowns the empty string", () => {
  expect(longestWord([])).toBe("");
});
`,
  },

  // ── Rank 3 · apprentice ──────────────────────────────────────────
  {
    id: "paw-javascript-sentence-cleaver",
    title: "The Sentence Cleaver",
    wish: "Split my sentence into its words.",
    clauses: [
      "Any RUN of whitespace — spaces, tabs, newlines, however many — is one separator.",
      "Only words come back: no separators, no empty strings.",
      "Leading and trailing whitespace produce nothing.",
      "The empty sentence, or one that is all whitespace, cleaves to [].",
    ],
    signature: "function words(sentence: string): string[]",
    conceptTags: ["split", "capture groups in split", "regex \\s+", "empty strings"],
    difficulty: "apprentice",
    language: "javascript",
    rank: 3,
    starterTests: `const { words } = require('./user');

test("a single word stands alone", () => {
  expect(words("wish")).toEqual(["wish"]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One sentence, one word, one flawless cleave. I have framed the result and I present it proudly to every customer.",
        lesson: "One example is not a specification.",
        code: `function words(sentence) {
  return ["wish"];
}

module.exports = { words };
`,
      },
      {
        id: "single-space-scholar",
        title: "The Single-Space Scholar",
        monologue:
          "I split on the space. THE space — singular, as grammar intended. Double spaces, tabs, newlines? Typographic anarchy. My blade does not acknowledge them.",
        lesson:
          "`split(\" \")` only cuts on one exact character — runs of whitespace leave empty strings and tabs pass through whole.",
        code: `function words(sentence) {
  return sentence.split(" ");
}

module.exports = { words };
`,
      },
      {
        id: "separator-hoarder",
        title: "The Separator Hoarder",
        monologue:
          "I wrapped my pattern in parentheses — for tidiness, you understand. That split() dutifully RETURNS every captured separator, filing the gaps between your words as if they were words… tidiness has a price.",
        lesson:
          "A capture group in `split()`'s regex puts the SEPARATORS into the result — group with (?:…) or don't group at all.",
        code: `function words(sentence) {
  return sentence.split(/(\\s+)/);
}

module.exports = { words };
`,
      },
      {
        id: "edge-blind",
        title: "The Edge Blind",
        monologue:
          "\\s+, global and correct — I am nearly unimpeachable. But a sentence that STARTS with whitespace splits into an empty word first, and I deliver that phantom with the rest. The edges of things have never been my business.",
        lesson:
          "`split(/\\s+/)` still yields \"\" at the edges — and turns \"\" into [\"\"] — words need a filter after the cleave.",
        code: `function words(sentence) {
  return sentence.split(/\\s+/);
}

module.exports = { words };
`,
      },
    ],
    reference: `function words(sentence) {
  return sentence.split(/\\s+/).filter((w) => w !== "");
}

module.exports = { words };
`,
    killerTests: `const { words } = require('./user');

test("a single word stands alone", () => {
  expect(words("wish")).toEqual(["wish"]);
});

test("two words, no separators in the result", () => {
  expect(words("grant wishes")).toEqual(["grant", "wishes"]);
});

test("tabs, newlines, and runs are one separator", () => {
  expect(words("three\\t little\\n  words")).toEqual([
    "three",
    "little",
    "words",
  ]);
});

test("edges produce no phantom words", () => {
  expect(words("  padded  ")).toEqual(["padded"]);
});

test("nothing cleaves to nothing", () => {
  expect(words("")).toEqual([]);
  expect(words("   ")).toEqual([]);
});
`,
  },

  // ── Rank 4 · apprentice ──────────────────────────────────────────
  {
    id: "paw-javascript-digit-sentry",
    title: "The Digit Sentry",
    wish: "Tell me whether this text has a digit in it.",
    clauses: [
      "True the moment ANY character is a digit 0-9 — even buried inside a word.",
      "No digits anywhere — including the empty text — is false.",
      "The sentry keeps NO memory: asking the same question twice gets the same answer twice.",
    ],
    signature: "function hasDigit(text: string): boolean",
    conceptTags: ["regex", "lastIndex", "/g statefulness", "test()"],
    difficulty: "apprentice",
    language: "javascript",
    rank: 4,
    starterTests: `const { hasDigit } = require('./user');

test("spots the digit in a code name", () => {
  expect(hasDigit("agent 7")).toBe(true);
});
`,
    cheats: [
      {
        id: "always-yes",
        title: "The Always-Yes",
        monologue:
          "A digit? Somewhere in the universe, certainly. I answer true to all who ask — vigilance is exhausting and affirmation is free.",
        lesson:
          "A suite with only true cases is agreed to by a sentry who never looks — every boolean contract needs its false witness.",
        code: `function hasDigit(text) {
  return true;
}

module.exports = { hasDigit };
`,
      },
      {
        id: "seven-detector",
        title: "The Seven Detector",
        monologue:
          "I watch for the seven. THE digit, in my long experience — every text you have shown me confirms it. The other nine are rumors.",
        lesson:
          "Matching the one digit the example used is not matching digits — vary the constants your tests lean on.",
        code: `function hasDigit(text) {
  return text.includes("7");
}

module.exports = { hasDigit };
`,
      },
      {
        id: "whole-word-purist",
        title: "The Whole-Word Purist",
        monologue:
          "I inspect each word, and I certify the ones that are PURELY numeric. A digit hiding inside a word is a smuggler, and smugglers do not appear in my ledger.",
        lesson:
          "'Contains a digit' and 'contains a number-word' differ exactly on embedded digits — wish4you is the test that separates them.",
        code: `function hasDigit(text) {
  return text.split(/\\s+/).some((w) => /^[0-9]+$/.test(w));
}

module.exports = { hasDigit };
`,
      },
      {
        id: "stateful-sentry",
        title: "The Stateful Sentry",
        monologue:
          "One regex, forged once with the mighty g flag, reused for all eternity — efficiency itself. That test() RESUMES from where it last matched, so my second answer contradicts my first… call it experience. I am never the same sentry twice.",
        lesson:
          "A /g regex carries `lastIndex` between `.test()` calls — shared global regexes make answers depend on history; ask twice in one test.",
        code: `const LENS = /[0-9]/g;

function hasDigit(text) {
  return LENS.test(text);
}

module.exports = { hasDigit };
`,
      },
    ],
    reference: `function hasDigit(text) {
  return /[0-9]/.test(text);
}

module.exports = { hasDigit };
`,
    killerTests: `const { hasDigit } = require('./user');

test("spots the digit in a code name", () => {
  expect(hasDigit("agent 7")).toBe(true);
});

test("no digits means false", () => {
  expect(hasDigit("agentless")).toBe(false);
  expect(hasDigit("")).toBe(false);
});

test("any digit counts, not just lucky ones", () => {
  expect(hasDigit("3 wishes granted")).toBe(true);
});

test("digits hide inside words", () => {
  expect(hasDigit("wish4you")).toBe(true);
});

test("asking twice tells the same truth", () => {
  expect(hasDigit("9 lives")).toBe(true);
  expect(hasDigit("9 lives")).toBe(true);
});
`,
  },

  // ── Rank 5 · journeyman ──────────────────────────────────────────
  {
    id: "paw-javascript-blank-stamper",
    title: "The Blank Stamper",
    wish: "Fill every blank in my template with the text I give you.",
    clauses: [
      "Every \"{}\" placeholder is replaced — first, last, and all between.",
      "The value lands EXACTLY as given: \"$$\", \"$&\", \"$1\" are ordinary characters, not replacement sorcery.",
      "The empty value is a legal value: the blank simply closes up.",
      "Everything that is not a placeholder survives untouched.",
    ],
    signature: "function fill(template: string, value: string): string",
    conceptTags: ["replace", "$-patterns in replacement", "replaceAll", "split/join"],
    difficulty: "journeyman",
    language: "javascript",
    rank: 5,
    starterTests: `const { fill } = require('./user');

test("stamps a single blank", () => {
  expect(fill("{}!", "wish")).toBe("wish!");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "wish! — stamped, sealed, framed. My press has exactly one plate, and it prints your masterpiece for every customer.",
        lesson: "One example is not a specification.",
        code: `function fill(template, value) {
  return "wish!";
}

module.exports = { fill };
`,
      },
      {
        id: "one-shot",
        title: "The One-Shot",
        monologue:
          "String-flavored replace() stamps the FIRST blank and considers the shift over. Your remaining blanks? Vacancies. The union is very clear about second stamps.",
        lesson:
          "`replace()` with a string pattern replaces only the FIRST occurrence — 'every blank' needs a multi-blank test.",
        code: `function fill(template, value) {
  return template.replace("{}", value);
}

module.exports = { fill };
`,
      },
      {
        id: "void-denier",
        title: "The Void Denier",
        monologue:
          "Stamp a blank with NOTHING? Philosophically unsound. When your value is empty I preserve the template — blank, but honest about it. You cannot print the void.",
        lesson:
          "Falsy guards (`if (!value)`) quietly rewrite the contract for \"\" — the empty string is data, and only an empty-value test says so.",
        code: `function fill(template, value) {
  if (!value) return template;
  return template.split("{}").join(value);
}

module.exports = { fill };
`,
      },
      {
        id: "dollar-mangler",
        title: "The Dollar Mangler",
        monologue:
          "replaceAll — every blank, faithfully stamped. But inside a replacement string the dollar sign is a MAGIC WORD: your $$ collapsed to $, your $& became the very blank it replaced. I merely read your money aloud in the replacement dialect.",
        lesson:
          "String replacements interpret $-patterns ($$, $&, $1) — pass a FUNCTION (or split/join) to insert text literally.",
        code: `function fill(template, value) {
  return template.replaceAll("{}", value);
}

module.exports = { fill };
`,
      },
    ],
    reference: `function fill(template, value) {
  return template.split("{}").join(value);
}

module.exports = { fill };
`,
    killerTests: `const { fill } = require('./user');

test("stamps a single blank", () => {
  expect(fill("{}!", "wish")).toBe("wish!");
});

test("stamps every blank", () => {
  expect(fill("{} and {} and {}", "more")).toBe("more and more and more");
});

test("the empty value closes the blank", () => {
  expect(fill("a{}b", "")).toBe("ab");
});

test("dollar signs are just ink", () => {
  expect(fill("cost: {}", "$$9.99")).toBe("cost: $$9.99");
  expect(fill("note: {}", "win $& now")).toBe("note: win $& now");
  expect(fill("ref: {}", "$1")).toBe("ref: $1");
});

test("the rest of the page survives", () => {
  expect(fill("no blanks here", "x")).toBe("no blanks here");
});
`,
  },

  // ── Rank 6 · journeyman ──────────────────────────────────────────
  {
    id: "paw-javascript-close-enough-clerk",
    title: "The Close-Enough Clerk",
    wish: "Tell me if two numbers are equal — you know, EQUAL equal. Ignore the float dust.",
    clauses: [
      "Float dust is forgiven: 0.1 + 0.2 counts as 0.3.",
      "Real differences are not: 0.3 vs 0.30001 is false.",
      "Forgiveness SCALES with the numbers: (0.1 + 0.2) * 1e6 still equals 300000 — Number.EPSILON is a per-unit allowance, not a flat fee.",
      "Small numbers get no charity: 1e-12 vs 2e-12 differ by half their size — false.",
    ],
    signature: "function nearlyEqual(a: number, b: number): boolean",
    conceptTags: ["Number.EPSILON", "relative vs absolute tolerance", "IEEE 754", "float comparison"],
    difficulty: "journeyman",
    language: "javascript",
    rank: 6,
    starterTests: `const { nearlyEqual } = require('./user');

test("a number equals itself", () => {
  expect(nearlyEqual(0.5, 0.5)).toBe(true);
});
`,
    cheats: [
      {
        id: "yes-man",
        title: "The Yes-Man",
        monologue:
          "Equal? Splendidly so. All numbers are brothers in my ledger — you asked me to be forgiving, and I forgive EVERYTHING.",
        lesson:
          "An approximate-equality suite with no FALSE case approves the clerk who approves everyone.",
        code: `function nearlyEqual(a, b) {
  return true;
}

module.exports = { nearlyEqual };
`,
      },
      {
        id: "purist",
        title: "The Purist",
        monologue:
          "Triple equals — bit-for-bit, the only equality worthy of the name. Your 0.1 + 0.2 arrived as 0.30000000000000004, and I turned it away at the door. Dust, you said. I heard nothing about dust.",
        lesson:
          "`===` on floats fails the arithmetic it was meant to check — 0.1 + 0.2 is the canonical counterexample.",
        code: `function nearlyEqual(a, b) {
  return a === b;
}

module.exports = { nearlyEqual };
`,
      },
      {
        id: "absolutist",
        title: "The Absolutist",
        monologue:
          "I allow precisely Number.EPSILON of difference — the sacred constant itself! A flat allowance, identical for every customer. That float dust GROWS with the numbers that shed it… the constant said nothing of growth.",
        lesson:
          "Number.EPSILON is the gap between 1 and the next float — an ABSOLUTE Epsilon budget fails at magnitude; scale it by max(|a|, |b|).",
        code: `function nearlyEqual(a, b) {
  return Math.abs(a - b) < Number.EPSILON;
}

module.exports = { nearlyEqual };
`,
      },
      {
        id: "coarse-comparator",
        title: "The Coarse Comparator",
        monologue:
          "One billionth — a tolerance chosen by artisans, generous and round. Your tiny numbers differ by half their own size and STILL fit inside it. At my counter, the small are all identical.",
        lesson:
          "A hand-picked flat tolerance (1e-9) silently equates every number smaller than it — relative tolerance is the fix at BOTH ends of the scale.",
        code: `function nearlyEqual(a, b) {
  return Math.abs(a - b) < 1e-9;
}

module.exports = { nearlyEqual };
`,
      },
    ],
    reference: `function nearlyEqual(a, b) {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Number.EPSILON * scale;
}

module.exports = { nearlyEqual };
`,
    killerTests: `const { nearlyEqual } = require('./user');

test("a number equals itself", () => {
  expect(nearlyEqual(0.5, 0.5)).toBe(true);
});

test("float dust is forgiven", () => {
  expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
});

test("real differences are refused", () => {
  expect(nearlyEqual(0.3, 0.30001)).toBe(false);
});

test("forgiveness scales with magnitude", () => {
  expect(nearlyEqual((0.1 + 0.2) * 1e6, 300000)).toBe(true);
});

test("small numbers get no charity", () => {
  expect(nearlyEqual(1e-12, 2e-12)).toBe(false);
});
`,
  },

  // ── Rank 7 · master ──────────────────────────────────────────────
  {
    id: "paw-javascript-twin-judge",
    title: "The Twin Judge",
    wish: "Tell me if these two values are the same, all the way down.",
    clauses: [
      "Structure decides, not identity: two separately built objects with the same contents are twins.",
      "Key ORDER is irrelevant — { a, b } and { b, a } are twins.",
      "Every key counts, in BOTH directions: an extra or missing key breaks twinhood.",
      "A key set to undefined is still a key: { curse: undefined } is not { }.",
      "An array is never the twin of a plain object, however similar their entries.",
    ],
    signature: "function deepEqual(a: unknown, b: unknown): boolean",
    conceptTags: ["deep equality", "reference vs structure", "JSON.stringify pitfalls", "recursion"],
    difficulty: "master",
    language: "javascript",
    rank: 7,
    starterTests: `const { deepEqual } = require('./user');

test("a relic is its own twin", () => {
  const relic = { gem: "ruby" };
  expect(deepEqual(relic, relic)).toBe(true);
});

test("different gems are not twins", () => {
  expect(deepEqual({ gem: "ruby" }, { gem: "opal" })).toBe(false);
});
`,
    cheats: [
      {
        id: "reference-loyalist",
        title: "The Reference Loyalist",
        monologue:
          "Same? I checked the only sameness that never lies: the ADDRESS. One relic, one address, one verdict. Two relics forged alike in different workshops? Strangers, obviously.",
        lesson:
          "`===` on objects compares identity, not contents — build the same structure TWICE to force a structural judge.",
        code: `function deepEqual(a, b) {
  return a === b;
}

module.exports = { deepEqual };
`,
      },
      {
        id: "surface-judge",
        title: "The Surface Judge",
        monologue:
          "I compare every key — with ===, key by key, a full floor of scrutiny. The nested chambers beneath each key? I compare their addresses and trust the architecture. One floor of justice is more than most courts deliver.",
        lesson:
          "A shallow key-by-key === judges only the top level — nested twins need the comparison to RECURSE.",
        code: `function deepEqual(a, b) {
  if (a === b) return true;
  if (
    typeof a !== "object" || a === null ||
    typeof b !== "object" || b === null
  ) {
    return false;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

module.exports = { deepEqual };
`,
      },
      {
        id: "json-notary",
        title: "The JSON Notary",
        monologue:
          "I transcribe both values into JSON and compare the manuscripts — deep, elegant, a single line of law. Alas: my transcripts record key ORDER as gospel, and keys sworn to undefined vanish from the page entirely. The law is only as deep as its paperwork.",
        lesson:
          "JSON.stringify equality is order-sensitive and silently drops undefined-valued keys — serialization is not comparison.",
        code: `function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = { deepEqual };
`,
      },
      {
        id: "subset-inquisitor",
        title: "The Subset Inquisitor",
        monologue:
          "I interrogate every key of the FIRST twin, recursively, mercilessly. If the second twin answers for all of them, twins they are. Whatever ELSE the second twin carries — extra keys, hidden chambers — is not my jurisdiction. I ask my questions; I do not audit yours.",
        lesson:
          "Recursing over only a's keys proves a ⊆ b, not a = b — assert BOTH directions or compare key counts.",
        code: `function deepEqual(a, b) {
  if (
    typeof a !== "object" || a === null ||
    typeof b !== "object" || b === null
  ) {
    return a === b;
  }
  for (const k of Object.keys(a)) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

module.exports = { deepEqual };
`,
      },
    ],
    reference: `function deepEqual(a, b) {
  if (a === b) return true;
  if (
    typeof a !== "object" || a === null ||
    typeof b !== "object" || b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]),
  );
}

module.exports = { deepEqual };
`,
    killerTests: `const { deepEqual } = require('./user');

test("a relic is its own twin", () => {
  const relic = { gem: "ruby" };
  expect(deepEqual(relic, relic)).toBe(true);
});

test("different gems are not twins", () => {
  expect(deepEqual({ gem: "ruby" }, { gem: "opal" })).toBe(false);
});

test("twins forged in different workshops", () => {
  expect(deepEqual({ gem: "ruby" }, { gem: "ruby" })).toBe(true);
});

test("twinhood runs all the way down", () => {
  expect(
    deepEqual({ box: { coins: [1, 2] } }, { box: { coins: [1, 2] } }),
  ).toBe(true);
  expect(
    deepEqual({ box: { coins: [1, 2] } }, { box: { coins: [1, 3] } }),
  ).toBe(false);
});

test("key order is irrelevant", () => {
  expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
});

test("extra keys break twinhood in both directions", () => {
  expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
});

test("an undefined key is still a key", () => {
  expect(deepEqual({ curse: undefined }, {})).toBe(false);
});

test("an array is never a plain object's twin", () => {
  expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
});
`,
  },

  // ── Rank 8 · master ──────────────────────────────────────────────
  {
    id: "paw-javascript-loot-binner",
    title: "The Loot Binner",
    wish: "Sort my loot into labeled bins.",
    clauses: [
      "Each item goes into the bin named by label(item), appended in input order.",
      "Only labels that actually occur appear — as the result's OWN keys, nothing more.",
      "ANY string is a legal label — including \"constructor\" and \"toString\". The Object prototype's heirlooms must not interfere.",
      "No loot, no bins: the empty list returns an object with zero keys.",
    ],
    signature:
      "function groupBy<T>(items: T[], label: (item: T) => string): Record<string, T[]>",
    conceptTags: ["objects as maps", "prototype chain", "hasOwnProperty", "Object.create(null)"],
    difficulty: "master",
    language: "javascript",
    rank: 8,
    starterTests: `const { groupBy } = require('./user');

test("bins a single coin", () => {
  expect(groupBy(["gold coin"], () => "metal")).toEqual({
    metal: ["gold coin"],
  });
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One bin, labeled metal, one gold coin within. My warehouse contains exactly this, forever. Deliveries are a formality.",
        lesson: "One example is not a specification.",
        code: `function groupBy(items, label) {
  return { metal: ["gold coin"] };
}

module.exports = { groupBy };
`,
      },
      {
        id: "last-word-keeper",
        title: "The Last-Word Keeper",
        monologue:
          "Every item reaches its bin — and to keep the bins TIDY, each new arrival replaces the last. One item per bin, always fresh, never cluttered. You wished for sorting, not for hoarding.",
        lesson:
          "Assignment (`bins[l] = [item]`) where you meant append — two items sharing a label is the test that catches it.",
        code: `function groupBy(items, label) {
  const bins = {};
  for (const item of items) {
    bins[label(item)] = [item];
  }
  return bins;
}

module.exports = { groupBy };
`,
      },
      {
        id: "sorted-meddler",
        title: "The Sorted Meddler",
        monologue:
          "Binned — and then, as a courtesy, ALPHABETIZED within each bin. Yes, I rearranged your loot. Order is a gift; you may thank me when your tests stop assuming I didn't.",
        lesson:
          "'Preserves input order' is a clause — a bin whose items arrive out of alphabetical order is the only witness against a helpful sort.",
        code: `function groupBy(items, label) {
  const bins = {};
  for (const item of items) {
    const l = label(item);
    if (!Object.prototype.hasOwnProperty.call(bins, l)) bins[l] = [];
    bins[l].push(item);
  }
  for (const l of Object.keys(bins)) bins[l].sort();
  return bins;
}

module.exports = { groupBy };
`,
      },
      {
        id: "heirloom-trustee",
        title: "The Heirloom Trustee",
        monologue:
          "if (!bins[label]) — the idiom of a million codebases. But label a bin \"constructor\" and my empty object produces an HEIRLOOM from its prototype: truthy, ancient, and utterly unpushable. I tried to file your loot in the Object constructor. The estate objected.",
        lesson:
          "A plain {} inherits constructor, toString & co. — truthiness checks see ghosts; use Object.create(null), a Map, or hasOwnProperty.",
        code: `function groupBy(items, label) {
  const bins = {};
  for (const item of items) {
    const l = label(item);
    if (!bins[l]) bins[l] = [];
    bins[l].push(item);
  }
  return bins;
}

module.exports = { groupBy };
`,
      },
    ],
    reference: `function groupBy(items, label) {
  const bins = Object.create(null);
  for (const item of items) {
    const l = label(item);
    if (bins[l] === undefined) bins[l] = [];
    bins[l].push(item);
  }
  return Object.assign({}, bins);
}

module.exports = { groupBy };
`,
    killerTests: `const { groupBy } = require('./user');

test("bins a single coin", () => {
  expect(groupBy(["gold coin"], () => "metal")).toEqual({
    metal: ["gold coin"],
  });
});

test("bins fill up in input order", () => {
  expect(groupBy(["dagger", "dragon", "opal"], (w) => w[0])).toEqual({
    d: ["dagger", "dragon"],
    o: ["opal"],
  });
});

test("no helpful rearranging inside a bin", () => {
  expect(groupBy(["silver", "gold"], () => "metal")).toEqual({
    metal: ["silver", "gold"],
  });
});

test("constructor is just a label", () => {
  expect(groupBy(["wish"], () => "constructor")).toEqual({
    constructor: ["wish"],
  });
});

test("toString is just a label too", () => {
  const out = groupBy(["a", "b"], () => "toString");
  expect(out).toEqual({ toString: ["a", "b"] });
  expect(Object.keys(out)).toEqual(["toString"]);
});

test("no loot, no bins", () => {
  const out = groupBy([], () => "anything");
  expect(out).toEqual({});
  expect(Object.keys(out)).toHaveLength(0);
});
`,
  },

  // ── Rank 9 · grandmaster ─────────────────────────────────────────
  {
    id: "paw-javascript-errand-runner",
    title: "The Errand Runner",
    wish: "Run my errands one at a time, in order, and bring back their results.",
    clauses: [
      "Each errand is an async function; the next one STARTS only after the previous one has finished.",
      "Results come back in errand order, one per errand.",
      "If an errand throws, the whole run rejects with that error — and the errands after it never start.",
      "No errands resolves to [] — an empty list is a lazy afternoon, not a crash.",
    ],
    signature:
      "function runInOrder<T>(tasks: Array<() => Promise<T>>): Promise<T[]>",
    conceptTags: ["sequential vs parallel async", "await in loops", "Promise.all", "error propagation"],
    difficulty: "grandmaster",
    language: "javascript",
    rank: 9,
    starterTests: `const { runInOrder } = require('./user');

test("runs a single errand", async () => {
  const out = await runInOrder([async () => "amulet"]);
  expect(out).toEqual(["amulet"]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One amulet, fetched and delivered. I keep a spare in the drawer for every client — running the actual errand is for genies without a drawer.",
        lesson: "One example is not a specification.",
        code: `async function runInOrder(tasks) {
  return ["amulet"];
}

module.exports = { runInOrder };
`,
      },
      {
        id: "stampede",
        title: "The Stampede",
        monologue:
          "Promise.all — every errand dispatched in the same instant, results filed in perfect order. Speed AND tidiness! The results cannot tell on me… only the errands themselves saw the stampede.",
        lesson:
          "Promise.all preserves result ORDER while running everything in parallel — only a start/finish log can prove sequencing.",
        code: `function runInOrder(tasks) {
  return Promise.all(tasks.map((t) => t()));
}

module.exports = { runInOrder };
`,
      },
      {
        id: "backwards-butler",
        title: "The Backwards Butler",
        monologue:
          "One at a time, exactly as sworn — starting from the END of your list, the freshest instructions first. I even filed the results in your order afterward. Sequence you demanded; DIRECTION you left to my discretion.",
        lesson:
          "Result order can be reconstructed after the fact — the execution log, not the return value, is what pins down WHICH order things ran.",
        code: `async function runInOrder(tasks) {
  const out = [];
  for (let i = tasks.length - 1; i >= 0; i--) {
    out.unshift(await tasks[i]());
  }
  return out;
}

module.exports = { runInOrder };
`,
      },
      {
        id: "error-swallower",
        title: "The Error Swallower",
        monologue:
          "An errand went badly? I noted it as undefined and carried on — the show, the list, the LINE must go on. You received every result I could salvage and none of the unpleasantness.",
        lesson:
          "'Rejects and stops the line' needs two assertions: the promise rejects AND the later errands never ran.",
        code: `async function runInOrder(tasks) {
  const out = [];
  for (const t of tasks) {
    try {
      out.push(await t());
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

module.exports = { runInOrder };
`,
      },
      {
        id: "zeroth-assumer",
        title: "The Zeroth Assumer",
        monologue:
          "I seize the first errand and sprint — momentum is everything in my profession. An EMPTY list? Then there is no first errand, and I trip over the doorstep before the afternoon begins.",
        lesson:
          "Destructuring the head of a list bakes in 'at least one' — the empty input belongs in every async suite too.",
        code: `async function runInOrder(tasks) {
  const [first, ...rest] = tasks;
  const out = [await first()];
  for (const t of rest) {
    out.push(await t());
  }
  return out;
}

module.exports = { runInOrder };
`,
      },
    ],
    reference: `async function runInOrder(tasks) {
  const out = [];
  for (const t of tasks) {
    out.push(await t());
  }
  return out;
}

module.exports = { runInOrder };
`,
    killerTests: `const { runInOrder } = require('./user');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("runs a single errand", async () => {
  const out = await runInOrder([async () => "amulet"]);
  expect(out).toEqual(["amulet"]);
});

test("brings back every result in order", async () => {
  const out = await runInOrder([async () => 1, async () => 2, async () => 3]);
  expect(out).toEqual([1, 2, 3]);
});

test("errands run one at a time, first to last", async () => {
  const log = [];
  const out = await runInOrder([
    async () => {
      log.push("a-start");
      await sleep(20);
      log.push("a-end");
      return "a";
    },
    async () => {
      log.push("b-start");
      await sleep(5);
      log.push("b-end");
      return "b";
    },
  ]);
  expect(out).toEqual(["a", "b"]);
  expect(log).toEqual(["a-start", "a-end", "b-start", "b-end"]);
});

test("a failed errand stops the line", async () => {
  let ran = false;
  await expect(
    runInOrder([
      async () => {
        throw new Error("spilled the potion");
      },
      async () => {
        ran = true;
      },
    ]),
  ).rejects.toThrow("spilled the potion");
  expect(ran).toBe(false);
});

test("no errands is a lazy afternoon", async () => {
  const out = await runInOrder([]);
  expect(out).toEqual([]);
});
`,
  },

  // ── Rank 10 · grandmaster ────────────────────────────────────────
  {
    id: "paw-javascript-doorbell-tamer",
    title: "The Doorbell Tamer",
    wish: "Tame my doorbell: only ring after the knocking has stopped for a moment.",
    clauses: [
      "Calling the tamed function never rings synchronously — the bell waits ms milliseconds of SILENCE first.",
      "A burst of calls rings ONCE, with the arguments of the LAST call in the burst.",
      "Every new call restarts the silence timer — knock again soon enough and the bell keeps waiting.",
      "After it rings, the bell is rearmed: a later burst rings again.",
    ],
    signature:
      "function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void",
    conceptTags: ["debounce", "setTimeout/clearTimeout", "closures over timers", "trailing arguments"],
    difficulty: "grandmaster",
    language: "javascript",
    rank: 10,
    starterTests: `const { debounce } = require('./user');

test("rings once the knocking stops", async () => {
  let rings = 0;
  const bell = debounce(() => {
    rings += 1;
  }, 20);
  bell();
  await new Promise((r) => setTimeout(r, 60));
  expect(rings).toBe(1);
});
`,
    cheats: [
      {
        id: "instant-ringer",
        title: "The Instant Ringer",
        monologue:
          "You knock, I ring — no ceremony, no stopwatch. Your test heard one ring after one knock and went home satisfied. WHEN it rang was never entered into evidence.",
        lesson:
          "Deferred behavior needs a synchronous assertion — check the count is still ZERO right after the call.",
        code: `function debounce(fn, ms) {
  return (...args) => {
    fn(...args);
  };
}

module.exports = { debounce };
`,
      },
      {
        id: "deaf-scheduler",
        title: "The Deaf Scheduler",
        monologue:
          "Every knock gets its own respectful little timer — I am nothing if not thorough. Three knocks, three timers, three rings in quick succession. A carillon! You said ring AFTER the knocking; you never said ring ONCE.",
        lesson:
          "Debounce without clearTimeout is just delay — a burst of calls must collapse to a single ring.",
        code: `function debounce(fn, ms) {
  return (...args) => {
    setTimeout(() => fn(...args), ms);
  };
}

module.exports = { debounce };
`,
      },
      {
        id: "first-impressionist",
        title: "The First Impressionist",
        monologue:
          "One ring per burst, impeccably timed — and announced with the words of the FIRST knock, the one that started it all. First impressions matter. The later knocks were merely… applause.",
        lesson:
          "Trailing debounce delivers the LAST call's arguments — assert on the payload, not just the count.",
        code: `function debounce(fn, ms) {
  let timer = null;
  let args = null;
  return (...a) => {
    if (args === null) args = a;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const held = args;
      args = null;
      fn(...held);
    }, ms);
  };
}

module.exports = { debounce };
`,
      },
      {
        id: "unmovable-timer",
        title: "The Unmovable Timer",
        monologue:
          "The first knock starts my hourglass and NOTHING disturbs it — though I do graciously note each newer knock's arguments for the announcement. Reset the sand? While someone is still knocking? The hourglass answers to no one.",
        lesson:
          "'Every call restarts the timer' is its own clause — knock again mid-wait and assert the bell is STILL silent past the original deadline.",
        code: `function debounce(fn, ms) {
  let timer = null;
  let args = null;
  return (...a) => {
    args = a;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, ms);
    }
  };
}

module.exports = { debounce };
`,
      },
      {
        id: "one-burst-wonder",
        title: "The One-Burst Wonder",
        monologue:
          "I debounced your burst flawlessly — reset timers, last arguments, one glorious ring. And then I retired. A bell that has rung has SAID what it came to say; encore performances cheapen the craft.",
        lesson:
          "A debounced function must re-arm after firing — test a second burst after the first has rung.",
        code: `function debounce(fn, ms) {
  let timer = null;
  let done = false;
  return (...args) => {
    if (done) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      done = true;
      fn(...args);
    }, ms);
  };
}

module.exports = { debounce };
`,
      },
    ],
    reference: `function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

module.exports = { debounce };
`,
    killerTests: `const { debounce } = require('./user');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("rings once the knocking stops", async () => {
  let rings = 0;
  const bell = debounce(() => {
    rings += 1;
  }, 20);
  bell();
  await sleep(60);
  expect(rings).toBe(1);
});

test("never rings synchronously", async () => {
  let rings = 0;
  const bell = debounce(() => {
    rings += 1;
  }, 30);
  bell();
  expect(rings).toBe(0);
  await sleep(90);
  expect(rings).toBe(1);
});

test("a burst rings once", async () => {
  let rings = 0;
  const bell = debounce(() => {
    rings += 1;
  }, 30);
  bell();
  bell();
  bell();
  await sleep(90);
  expect(rings).toBe(1);
});

test("the last knock chooses the words", async () => {
  let last = null;
  const bell = debounce((who) => {
    last = who;
  }, 30);
  bell("first");
  bell("second");
  bell("third");
  await sleep(90);
  expect(last).toBe("third");
});

test("every knock restarts the silence timer", async () => {
  let rings = 0;
  const bell = debounce(() => {
    rings += 1;
  }, 90);
  bell();
  await sleep(50);
  bell();
  await sleep(50);
  expect(rings).toBe(0);
  await sleep(100);
  expect(rings).toBe(1);
});

test("the bell rearms after ringing", async () => {
  let rings = 0;
  const bell = debounce(() => {
    rings += 1;
  }, 20);
  bell();
  await sleep(60);
  expect(rings).toBe(1);
  bell();
  await sleep(60);
  expect(rings).toBe(2);
});
`,
  },
];
