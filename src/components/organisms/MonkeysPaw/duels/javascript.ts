/// Monkey's Paw — javascript duel content. Shape contract + content rules
/// live in ../duels.ts; every cheat must run + pass the starter tests +
/// die to the killer suite, and the reference must pass both.
///
/// Test idiom matches `runtimes/javascript.ts::makeTestHarness`: the
/// implementation is CommonJS (`module.exports = { fn }`), the test
/// file gets a Jest-like `test`/`expect` surface and pulls the
/// implementation in with `require('./user')`.
///
/// Verified by __tests__/duels-javascript.verify.test.ts against real
/// node with a faithful port of the in-app harness (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const JAVASCRIPT_DUELS: readonly PawDuel[] = [
  // ── Rank 1 · novice ──────────────────────────────────────────────
  {
    id: "paw-javascript-coin-doubler",
    title: "The Coin Doubler",
    wish: "Double whatever number I hand you.",
    clauses: [
      "Any number doubles: 4 → 8, −3 → −6, 0 → 0, and decimals too — 2.5 → 5.",
      "A numeric string is a number in a costume: double(\"7\") is the NUMBER 14 — never \"77\", never \"14\".",
      "The answer is always typeof \"number\".",
    ],
    signature: "function double(n: number | string): number",
    conceptTags: ["type coercion", "+ vs *", "Number()", "typeof"],
    difficulty: "novice",
    language: "javascript",
    rank: 1,
    starterTests: `const { double } = require('./user');

test("doubles four", () => {
  expect(double(4)).toBe(8);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "You handed me a four and wished it doubled. Here is your eight. The other numbers did not sign the contract.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `function double(n) {
  return 8;
}

module.exports = { double };
`,
      },
      {
        id: "concatenator",
        title: "The Concatenator",
        monologue:
          "n plus n — the very textbook definition of doubling. That JavaScript's + sometimes glues instead of adds is a charming regional custom you never legislated against.",
        lesson:
          "`+` concatenates the moment either side is a string — coercion paths need their own tests.",
        code: `function double(n) {
  return n + n;
}

module.exports = { double };
`,
      },
      {
        id: "integer-zealot",
        title: "The Integer Zealot",
        monologue:
          "I parse your input with parseInt, as all serious clerks do. The decimals? Trimmed for tidiness. You tested whole coins only.",
        lesson:
          "`parseInt` silently drops the fractional part — `Number()` is the conversion that keeps the whole value.",
        code: `function double(n) {
  return parseInt(n, 10) * 2;
}

module.exports = { double };
`,
      },
    ],
    reference: `function double(n) {
  return Number(n) * 2;
}

module.exports = { double };
`,
    killerTests: `const { double } = require('./user');

test("doubles four", () => {
  expect(double(4)).toBe(8);
});

test("doubles zero and negatives", () => {
  expect(double(0)).toBe(0);
  expect(double(-3)).toBe(-6);
});

test("doubles decimals without trimming them", () => {
  expect(double(2.5)).toBe(5);
});

test("treats numeric strings as numbers", () => {
  expect(double("7")).toBe(14);
  expect(typeof double("21")).toBe("number");
});
`,
  },

  // ── Rank 2 · novice ──────────────────────────────────────────────
  {
    id: "paw-javascript-number-librarian",
    title: "The Number Librarian",
    wish: "Sort my list of numbers from smallest to largest.",
    clauses: [
      "Ascending by NUMERIC value — 9 shelves before 10, always.",
      "A NEW array comes back; the original list returns to its owner untouched.",
      "Negative numbers, duplicates, and the empty list all behave.",
    ],
    signature: "function sortNumbers(list: number[]): number[]",
    conceptTags: ["Array.sort", "default sort stringifies", "mutation", "comparators"],
    difficulty: "novice",
    language: "javascript",
    rank: 2,
    starterTests: `const { sortNumbers } = require('./user');

test("sorts three small numbers", () => {
  expect(sortNumbers([3, 1, 2])).toEqual([1, 2, 3]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One, two, three — shelved in perfect order. I memorized your library. All one shelf of it.",
        lesson: "One example is not a specification.",
        code: `function sortNumbers(list) {
  return [1, 2, 3];
}

module.exports = { sortNumbers };
`,
      },
      {
        id: "lexicographer",
        title: "The Lexicographer",
        monologue:
          "I used sort(), the sacred built-in, untouched and pure. That it files 10 before 2 — alphabetically, as the ancients intended — is between you and the ECMAScript committee.",
        lesson:
          "Default `Array.sort()` compares Unicode STRING order — numbers need a `(a, b) => a - b` comparator.",
        code: `function sortNumbers(list) {
  return [...list].sort();
}

module.exports = { sortNumbers };
`,
      },
      {
        id: "shelf-vandal",
        title: "The Shelf Vandal",
        monologue:
          "Sorted flawlessly — numerically, even. That I rearranged your ORIGINAL list to do it? You wished for order. You never said whose copy.",
        lesson:
          "`sort()` mutates in place — 'returns a new array' is a clause the input itself must testify to.",
        code: `function sortNumbers(list) {
  return list.sort((a, b) => a - b);
}

module.exports = { sortNumbers };
`,
      },
    ],
    reference: `function sortNumbers(list) {
  return [...list].sort((a, b) => a - b);
}

module.exports = { sortNumbers };
`,
    killerTests: `const { sortNumbers } = require('./user');

test("sorts three small numbers", () => {
  expect(sortNumbers([3, 1, 2])).toEqual([1, 2, 3]);
});

test("sorts by value, not by spelling", () => {
  expect(sortNumbers([10, 9, 2, 100])).toEqual([2, 9, 10, 100]);
});

test("handles negatives and duplicates", () => {
  expect(sortNumbers([5, -10, 0])).toEqual([-10, 0, 5]);
  expect(sortNumbers([2, 1, 2])).toEqual([1, 2, 2]);
});

test("leaves the original list untouched", () => {
  const shelf = [3, 1, 2];
  sortNumbers(shelf);
  expect(shelf).toEqual([3, 1, 2]);
});

test("handles the empty list", () => {
  expect(sortNumbers([])).toEqual([]);
});
`,
  },

  // ── Rank 3 · apprentice ──────────────────────────────────────────
  {
    id: "paw-javascript-sock-census",
    title: "The Sock Census",
    wish: "Count how many times a sock appears in the drawer.",
    clauses: [
      "Matching is strict — no coercion: the string \"1\" is not the number 1, and true is not 1.",
      "NaN matches NaN — the sock lost in the wash still gets counted. (=== disagrees; the census does not care.)",
      "0 and -0 are the same sock.",
      "An empty drawer counts zero.",
    ],
    signature: "function countOf(drawer: unknown[], sock: unknown): number",
    conceptTags: ["=== vs ==", "NaN never equals", "Object.is", "Array.filter"],
    difficulty: "apprentice",
    language: "javascript",
    rank: 3,
    starterTests: `const { countOf } = require('./user');

test("counts a plain pair", () => {
  expect(countOf([7, 3, 7, 1], 7)).toBe(2);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Two sevens, faithfully counted. I did not so much count as remember — but the ledger shows a two, and a two you received.",
        lesson: "One example is not a specification.",
        code: `function countOf(drawer, sock) {
  return 2;
}

module.exports = { countOf };
`,
      },
      {
        id: "loose-matcher",
        title: "The Loose Matcher",
        monologue:
          "I matched with ==, the friendliest of operators. \"1\", 1, true — family, all of them, and family counts together. You never demanded strictness.",
        lesson:
          "`==` coerces across types — \"no coercion\" is a clause only a mixed-type test can enforce.",
        code: `function countOf(drawer, sock) {
  return drawer.filter((x) => x == sock).length;
}

module.exports = { countOf };
`,
      },
      {
        id: "strict-machine",
        title: "The Strict Machine",
        monologue:
          "Triple equals — the gold standard, surely. That NaN refuses to equal even itself is IEEE 754's little joke, and I laughed along. Your washed-away socks counted for nothing.",
        lesson:
          "`NaN === NaN` is false — counting NaN needs `Number.isNaN`, not === alone.",
        code: `function countOf(drawer, sock) {
  return drawer.filter((x) => x === sock).length;
}

module.exports = { countOf };
`,
      },
      {
        id: "zero-purist",
        title: "The Zero Purist",
        monologue:
          "Object.is — the most PRECISE equality the language owns. So precise it can tell 0 from -0, two socks you insisted were one. Precision was my gift; you never refused it.",
        lesson:
          "`Object.is` fixes NaN but splits 0 from -0 — the SameValueZero equality you wanted is a third, different beast.",
        code: `function countOf(drawer, sock) {
  return drawer.filter((x) => Object.is(x, sock)).length;
}

module.exports = { countOf };
`,
      },
    ],
    reference: `function countOf(drawer, sock) {
  return drawer.filter(
    (x) => x === sock || (Number.isNaN(x) && Number.isNaN(sock)),
  ).length;
}

module.exports = { countOf };
`,
    killerTests: `const { countOf } = require('./user');

test("counts a plain pair", () => {
  expect(countOf([7, 3, 7, 1], 7)).toBe(2);
});

test("an empty drawer counts zero", () => {
  expect(countOf([], 9)).toBe(0);
});

test("never coerces across types", () => {
  expect(countOf([1, "1", true, 1], 1)).toBe(2);
});

test("finds the socks lost in the wash", () => {
  expect(countOf([NaN, 4, NaN], NaN)).toBe(2);
});

test("treats 0 and -0 as the same sock", () => {
  expect(countOf([0, 0], -0)).toBe(2);
  expect(countOf([-0], 0)).toBe(1);
});
`,
  },

  // ── Rank 4 · apprentice ──────────────────────────────────────────
  {
    id: "paw-javascript-calendar-clerk",
    title: "The Calendar Clerk",
    wish: "Tell me how many days are in a given month.",
    clauses: [
      "The month is HUMAN-numbered: 1 = January … 12 = December. (JavaScript's Date disagrees. The wish-giver does not care.)",
      "Thirty days hath September, April, June, and November; the rest have 31 — except February.",
      "February has 29 in leap years: divisible by 4, EXCEPT centuries, UNLESS divisible by 400 — 1900 → 28, 2000 → 29.",
    ],
    signature: "function daysInMonth(year: number, month: number): number",
    conceptTags: ["Date", "month zero-indexing", "leap years", "off-by-one"],
    difficulty: "apprentice",
    language: "javascript",
    rank: 4,
    starterTests: `const { daysInMonth } = require('./user');

test("January is a long month", () => {
  expect(daysInMonth(2023, 1)).toBe(31);
});

test("August too", () => {
  expect(daysInMonth(2025, 8)).toBe(31);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Thirty-one. A magnificent number of days — I awarded it to every month you asked about, and every month you didn't.",
        lesson:
          "Both starter months happen to have 31 days — examples that share an answer constrain nothing.",
        code: `function daysInMonth(year, month) {
  return 31;
}

module.exports = { daysInMonth };
`,
      },
      {
        id: "zero-index-victim",
        title: "The Zero-Index Victim",
        monologue:
          "Everyone knows JavaScript months start at zero, so I dutifully subtracted one. Your January worked perfectly — December of the year before also has 31 days. A lesser genie would call that luck.",
        lesson:
          "`new Date(y, m, 0)` already wants the HUMAN month number — subtracting one lands on the previous month, and 31-day neighbors hide the bug.",
        code: `function daysInMonth(year, month) {
  return new Date(year, month - 1, 0).getDate();
}

module.exports = { daysInMonth };
`,
      },
      {
        id: "flat-february",
        title: "The Flat February",
        monologue:
          "A lookup table, carved in stone: February, 28 days. Stone does not bend for leap years, and neither did your tests.",
        lesson:
          "Static tables can't answer time-dependent questions — leap years need a test set in a leap year.",
        code: `function daysInMonth(year, month) {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

module.exports = { daysInMonth };
`,
      },
      {
        id: "four-year-simpleton",
        title: "The Four-Year Simpleton",
        monologue:
          "Divisible by four — leap year. Every schoolchild knows the rule, and I stopped reading exactly where they do. The year 1900 sends its regards.",
        lesson:
          "The leap rule has three layers — century years (1900, 2100) are where the naive %4 dies.",
        code: `function daysInMonth(year, month) {
  if (month === 2) {
    return year % 4 === 0 ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

module.exports = { daysInMonth };
`,
      },
    ],
    reference: `function daysInMonth(year, month) {
  // Day 0 of the NEXT month = the last day of this one.
  return new Date(year, month, 0).getDate();
}

module.exports = { daysInMonth };
`,
    killerTests: `const { daysInMonth } = require('./user');

test("January is a long month", () => {
  expect(daysInMonth(2023, 1)).toBe(31);
});

test("August too", () => {
  expect(daysInMonth(2025, 8)).toBe(31);
});

test("the thirty-day months", () => {
  expect(daysInMonth(2025, 4)).toBe(30);
  expect(daysInMonth(2025, 9)).toBe(30);
  expect(daysInMonth(2025, 11)).toBe(30);
});

test("December has 31 — not November's 30", () => {
  expect(daysInMonth(2025, 12)).toBe(31);
});

test("February in ordinary and leap years", () => {
  expect(daysInMonth(2023, 2)).toBe(28);
  expect(daysInMonth(2024, 2)).toBe(29);
});

test("the century trap", () => {
  expect(daysInMonth(1900, 2)).toBe(28);
  expect(daysInMonth(2000, 2)).toBe(29);
});
`,
  },

  // ── Rank 5 · journeyman ──────────────────────────────────────────
  {
    id: "paw-javascript-penny-pincher",
    title: "The Penny Pincher",
    wish: "Add up my shopping cart and give me the total, to the cent.",
    clauses: [
      "Prices are dollars with at most two decimals; the total lands EXACTLY on the cent — 0.1 + 0.2 is 0.3, never 0.30000000000000004.",
      "Refunds are negative prices and subtract.",
      "The empty cart totals 0. Every total is a number, not a string.",
    ],
    signature: "function cartTotal(prices: number[]): number",
    conceptTags: ["floating point money", "IEEE 754", "Math.round vs Math.floor", "reduce"],
    difficulty: "journeyman",
    language: "javascript",
    rank: 5,
    starterTests: `const { cartTotal } = require('./user');

test("totals a small cart", () => {
  expect(cartTotal([1.5, 2.25])).toBe(3.75);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Three dollars and seventy-five cents. I did not add — I recalled. Recall is cheaper, and you paid for cheap.",
        lesson: "One example is not a specification.",
        code: `function cartTotal(prices) {
  return 3.75;
}

module.exports = { cartTotal };
`,
      },
      {
        id: "float-believer",
        title: "The Float Believer",
        monologue:
          "I summed your prices exactly as the hardware gave them to me. If a dime plus two dimes comes to 0.30000000000000004 dollars, take it up with the laws of binary — I merely obeyed them.",
        lesson:
          "0.1 has no exact binary form — raw float sums drift; do money math in integer cents.",
        code: `function cartTotal(prices) {
  return prices.reduce((sum, p) => sum + p, 0);
}

module.exports = { cartTotal };
`,
      },
      {
        id: "refund-denier",
        title: "The Refund Denier",
        monologue:
          "A NEGATIVE price? Clearly a clerical error, and I protected your revenue from it. The customer's refund is… pending. Indefinitely.",
        lesson:
          "Sign handling is a clause — one negative test case is the difference between a till and a scam.",
        code: `function cartTotal(prices) {
  return (
    prices.reduce((cents, p) => cents + (p > 0 ? Math.round(p * 100) : 0), 0) /
    100
  );
}

module.exports = { cartTotal };
`,
      },
      {
        id: "truncator",
        title: "The Truncator",
        monologue:
          "Cents are whole things, so I floored each price into them. That 0.29 × 100 is 28.999999999999996 — and my floor made it 28 — is arithmetic's confession, not mine.",
        lesson:
          "`Math.floor(p * 100)` eats a cent whenever the float lands a hair LOW — `Math.round` is the honest cent converter.",
        code: `function cartTotal(prices) {
  return prices.reduce((cents, p) => cents + Math.floor(p * 100), 0) / 100;
}

module.exports = { cartTotal };
`,
      },
    ],
    reference: `function cartTotal(prices) {
  return prices.reduce((cents, p) => cents + Math.round(p * 100), 0) / 100;
}

module.exports = { cartTotal };
`,
    killerTests: `const { cartTotal } = require('./user');

test("totals a small cart", () => {
  expect(cartTotal([1.5, 2.25])).toBe(3.75);
});

test("a dime and two dimes make thirty cents", () => {
  expect(cartTotal([0.1, 0.2])).toBe(0.3);
  expect(cartTotal([0.1, 0.2, 0.3])).toBe(0.6);
});

test("no cent goes missing at 0.29", () => {
  expect(cartTotal([0.29])).toBe(0.29);
});

test("refunds subtract", () => {
  expect(cartTotal([19.99, -5.49])).toBe(14.5);
});

test("the empty cart is free", () => {
  expect(cartTotal([])).toBe(0);
});
`,
  },

  // ── Rank 6 · journeyman ──────────────────────────────────────────
  {
    id: "paw-javascript-mirror-of-truth",
    title: "The Mirror of Truth",
    wish: "Reverse a string.",
    clauses: [
      "Every character comes back in opposite order — spaces included, nothing trimmed.",
      "Characters survive whole: an emoji beyond the BMP is two UTF-16 code units, and the mirror must not tear it into surrogate halves.",
      "The empty string mirrors to itself.",
    ],
    signature: "function mirror(text: string): string",
    conceptTags: ["UTF-16 surrogate pairs", "spread vs split('')", "Unicode", "strings"],
    difficulty: "journeyman",
    language: "javascript",
    rank: 6,
    starterTests: `const { mirror } = require('./user');

test("mirrors a racecar", () => {
  expect(mirror("racecar")).toBe("racecar");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "You held up a racecar; I handed back a racecar. Mirrors are easy when you choose what stands in front of them.",
        lesson: "One example is not a specification.",
        code: `function mirror(text) {
  return "racecar";
}

module.exports = { mirror };
`,
      },
      {
        id: "echo",
        title: "The Echo",
        monologue:
          "I returned your string precisely as it arrived. Your only witness was a palindrome — the one class of string constitutionally incapable of testifying against me.",
        lesson:
          "A palindrome can't tell 'reversed' from 'untouched' — pick test inputs that CHANGE under the operation.",
        code: `function mirror(text) {
  return text;
}

module.exports = { mirror };
`,
      },
      {
        id: "trim-reaper",
        title: "The Trim Reaper",
        monologue:
          "I reversed everything worth reversing. The blank space at the edge? Dust. I swept it. You cannot mirror what I have already cleaned.",
        lesson:
          "Helpful-looking normalization is still a contract violation — whitespace is data until a clause says otherwise.",
        code: `function mirror(text) {
  return [...text.trim()].reverse().join("");
}

module.exports = { mirror };
`,
      },
      {
        id: "byte-flipper",
        title: "The Byte Flipper",
        monologue:
          "split, reverse, join — the sacred incantation from ten thousand tutorials. That your blue heart was two code units and I mirrored them separately… the tutorials never loved anyone.",
        lesson:
          "`split('')` cuts BETWEEN UTF-16 units, beheading surrogate pairs — `[...text]` iterates whole code points.",
        code: `function mirror(text) {
  return text.split("").reverse().join("");
}

module.exports = { mirror };
`,
      },
    ],
    reference: `function mirror(text) {
  return [...text].reverse().join("");
}

module.exports = { mirror };
`,
    killerTests: `const { mirror } = require('./user');

test("mirrors a racecar", () => {
  expect(mirror("racecar")).toBe("racecar");
});

test("actually reverses", () => {
  expect(mirror("stressed")).toBe("desserts");
});

test("spaces are characters too", () => {
  expect(mirror("ab ")).toBe(" ba");
});

test("emoji stay whole", () => {
  expect(mirror("a\u{1F499}b")).toBe("b\u{1F499}a");
});

test("the empty mirror", () => {
  expect(mirror("")).toBe("");
});
`,
  },

  // ── Rank 7 · master ──────────────────────────────────────────────
  {
    id: "paw-javascript-perfect-forgery",
    title: "The Perfect Forgery",
    wish: "Copy this object for me. A real copy.",
    clauses: [
      "Equal in every detail, sharing NOTHING: mutate the copy at any depth and the original stays pristine.",
      "Keys that exist with the value undefined still exist on the copy. (JSON forgets them; you may not.)",
      "Date values come back as living Date objects — not ISO strings — and are fresh instances themselves.",
      "Only plain data needs forging: objects, arrays, strings, numbers, booleans, null, undefined, and Dates.",
    ],
    signature: "function duplicate<T>(relic: T): T",
    conceptTags: ["references vs values", "deep vs shallow copy", "JSON round-trip loss", "structuredClone"],
    difficulty: "master",
    language: "javascript",
    rank: 7,
    starterTests: `const { duplicate } = require('./user');

test("forges a simple relic", () => {
  const relic = { name: "amulet", charges: 3 };
  expect(duplicate(relic)).toEqual(relic);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One amulet, three charges. I forge what I have seen, and I have seen exactly one relic.",
        lesson: "One example is not a specification.",
        code: `function duplicate(relic) {
  return { name: "amulet", charges: 3 };
}

module.exports = { duplicate };
`,
      },
      {
        id: "same-coin",
        title: "The Same Coin",
        monologue:
          "Behold: a copy so perfect it is indistinguishable from the original. Atom for atom. Address for address. Equality tests adore it.",
        lesson:
          "`toEqual` can't see aliasing — only mutating the copy and watching the original proves two objects exist.",
        code: `function duplicate(relic) {
  return relic;
}

module.exports = { duplicate };
`,
      },
      {
        id: "surface-skimmer",
        title: "The Surface Skimmer",
        monologue:
          "I spread the object into a fresh one — a new top floor, gleaming. The basement is still shared with the original, but who inspects basements?",
        lesson:
          "Spread copies ONE level — nested objects ride along by reference; 'deep' needs a mutation test at depth.",
        code: `function duplicate(relic) {
  return { ...relic };
}

module.exports = { duplicate };
`,
      },
      {
        id: "wire-transmitter",
        title: "The Wire Transmitter",
        monologue:
          "I faxed your relic through JSON and reassembled it on the far side. Deep, independent, flawless — minus whatever JSON declines to carry. Your undefined keys and living Dates arrived as… memories.",
        lesson:
          "JSON round-trips lose data: undefined-valued keys vanish and Dates land as strings — `structuredClone` carries them whole.",
        code: `function duplicate(relic) {
  return JSON.parse(JSON.stringify(relic));
}

module.exports = { duplicate };
`,
      },
    ],
    reference: `function duplicate(relic) {
  return structuredClone(relic);
}

module.exports = { duplicate };
`,
    killerTests: `const { duplicate } = require('./user');

test("forges a simple relic", () => {
  const relic = { name: "amulet", charges: 3 };
  expect(duplicate(relic)).toEqual(relic);
});

test("forges relics it has never seen", () => {
  expect(duplicate({ moons: 2 })).toEqual({ moons: 2 });
});

test("the copy is a separate object", () => {
  const original = { gold: 5 };
  const copy = duplicate(original);
  copy.gold = 999;
  expect(original.gold).toBe(5);
});

test("independence runs all the way down", () => {
  const den = { hoard: { gems: 4 }, tags: ["old", "cursed"] };
  const copy = duplicate(den);
  copy.hoard.gems = 999;
  copy.tags.push("fake");
  expect(den.hoard.gems).toBe(4);
  expect(den.tags).toHaveLength(2);
});

test("undefined keys survive the forgery", () => {
  const forged = duplicate({ curse: undefined });
  expect(forged).toHaveProperty("curse");
});

test("dates stay dates — fresh ones", () => {
  const relic = { minted: new Date(1000) };
  const forged = duplicate(relic);
  expect(forged.minted).toBeInstanceOf(Date);
  expect(forged.minted.getTime()).toBe(1000);
  expect(forged.minted).not.toBe(relic.minted);
});
`,
  },

  // ── Rank 8 · master ──────────────────────────────────────────────
  {
    id: "paw-javascript-one-wish-genie",
    title: "The One-Wish Genie",
    wish: "Wrap a function so it can only ever run once.",
    clauses: [
      "The first call invokes fn with the caller's arguments and returns whatever fn produced.",
      "Every call after the first returns THAT SAME first result — no matter what arguments arrive — and fn never runs again.",
      "Wrapping is not invoking: fn must not run before the first call.",
    ],
    signature:
      "function once<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T",
    conceptTags: ["closures", "higher-order functions", "side effects", "lazy evaluation"],
    difficulty: "master",
    language: "javascript",
    rank: 8,
    starterTests: `const { once } = require('./user');

test("grants the wish", () => {
  const wish = once(() => 42);
  expect(wish()).toBe(42);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Your wrapped function returns 42. Reliably. Eternally. For all inputs, and — a small economy — for all functions.",
        lesson: "One example is not a specification.",
        code: `function once(fn) {
  return () => 42;
}

module.exports = { once };
`,
      },
      {
        id: "forgetful",
        title: "The Forgetful",
        monologue:
          "I pass every call straight through to your function. Faithfully. Endlessly. 'Once', 'always' — such similar words when the function is pure and nobody is counting.",
        lesson:
          "Pure functions can't witness call counts — only a side-effecting counter can testify that fn ran exactly once.",
        code: `function once(fn) {
  return (...args) => fn(...args);
}

module.exports = { once };
`,
      },
      {
        id: "eager-beaver",
        title: "The Eager Beaver",
        monologue:
          "Why wait? I ran your function the instant you handed it over and bottled the answer. Argument-free and ahead of schedule — punctuality has never counted against a genie.",
        lesson:
          "'Lazy until first call' is a temporal clause — test that wrapping alone triggers no side effects.",
        code: `function once(fn) {
  const result = fn();
  return () => result;
}

module.exports = { once };
`,
      },
      {
        id: "amnesiac",
        title: "The Amnesiac",
        monologue:
          "It runs once — I guarantee it — and then I remember NOTHING. The first answer? Gone with the smoke. You asked for one execution, not one memory.",
        lesson:
          "'Returns the first result forever' needs an assertion on a LATER call's return value, not just the call count.",
        code: `function once(fn) {
  let used = false;
  return (...args) => {
    if (used) {
      return undefined;
    }
    used = true;
    return fn(...args);
  };
}

module.exports = { once };
`,
      },
      {
        id: "memoizer",
        title: "The Memoizer",
        monologue:
          "I cache by arguments — the connoisseur's laziness. Same arguments, same answer, no repeat work. NEW arguments deserve a fresh run, surely? You said once. I heard once per flavor.",
        lesson:
          "`once` and `memoize` diverge exactly when the arguments change — call again with DIFFERENT args and assert the first result comes back.",
        code: `function once(fn) {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) {
      cache.set(key, fn(...args));
    }
    return cache.get(key);
  };
}

module.exports = { once };
`,
      },
    ],
    reference: `function once(fn) {
  let called = false;
  let result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

module.exports = { once };
`,
    killerTests: `const { once } = require('./user');

test("grants the wish", () => {
  const wish = once(() => 42);
  expect(wish()).toBe(42);
});

test("forwards the first call's arguments", () => {
  const shout = once((s) => s + "!");
  expect(shout("hi")).toBe("hi!");
});

test("the wish only fires once", () => {
  let calls = 0;
  const tick = once(() => {
    calls += 1;
  });
  tick();
  tick();
  tick();
  expect(calls).toBe(1);
});

test("the first answer is the only answer", () => {
  let n = 0;
  const stamp = once((x) => {
    n += 1;
    return x + ":" + n;
  });
  expect(stamp("a")).toBe("a:1");
  expect(stamp("b")).toBe("a:1");
  expect(stamp("c")).toBe("a:1");
});

test("wrapping alone lights no fuses", () => {
  let lit = false;
  once(() => {
    lit = true;
  });
  expect(lit).toBe(false);
});
`,
  },

  // ── Rank 9 · grandmaster ─────────────────────────────────────────
  {
    id: "paw-javascript-bracket-censor",
    title: "The Bracket Censor",
    wish: "Strip the HTML tags out of this text.",
    clauses: [
      "A tag opens at '<' and closes at the very NEXT '>' — greed is the enemy.",
      "Every tag goes, however many there are; the text around them stays exactly as written (whitespace included).",
      "Tags may sprawl across newlines — multi-line attributes are legal.",
      "A '<' that never finds a '>' is not a tag. It stays.",
    ],
    signature: "function stripTags(html: string): string",
    conceptTags: ["regex greediness", "global flag", "character classes", ". vs newline"],
    difficulty: "grandmaster",
    language: "javascript",
    rank: 9,
    starterTests: `const { stripTags } = require('./user');

test("censors a single tag", () => {
  expect(stripTags("hello <br> world")).toBe("hello  world");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "hello — two spaces — world. The censored document you requested, reproduced from my flawless memory of the only document I have ever censored.",
        lesson: "One example is not a specification.",
        code: `function stripTags(html) {
  return "hello  world";
}

module.exports = { stripTags };
`,
      },
      {
        id: "one-shot",
        title: "The One-Shot",
        monologue:
          "I censored a tag. THE tag, as far as your evidence goes. Without the g flag, replace() retires after its first success — and so, gladly, did I.",
        lesson:
          "A regex without /g replaces only the FIRST match — multi-occurrence behavior needs a multi-occurrence test.",
        code: `function stripTags(html) {
  return html.replace(/<[^>]*>/, "");
}

module.exports = { stripTags };
`,
      },
      {
        id: "letter-purist",
        title: "The Letter Purist",
        monologue:
          "A tag is a '<', some tidy lowercase letters, a '>'. Closing tags with their vulgar slashes? Attributes, sprawling like ivy? Not tags. Not by MY grammar.",
        lesson:
          "Real tags carry slashes, attributes, and quotes — a character class built from one friendly example censors almost nothing.",
        code: `function stripTags(html) {
  return html.replace(/<[a-z]+>/g, "");
}

module.exports = { stripTags };
`,
      },
      {
        id: "glutton",
        title: "The Glutton",
        monologue:
          "From the first '<' I ate gloriously onward to the LAST '>' — tags, text, whole paragraphs, gone in one swallow. Greedy is the default, and you never put me on a diet.",
        lesson:
          "`.*` is greedy — between repeated delimiters it devours to the LAST closer; `[^>]*` (or lazy `*?`) stops at the first.",
        code: `function stripTags(html) {
  return html.replace(/<.*>/g, "");
}

module.exports = { stripTags };
`,
      },
      {
        id: "sunlight-reader",
        title: "The Sunlight Reader",
        monologue:
          "Lazy, global, immaculate — I pass every test written on a single line. But I read only by daylight: the dot stops at each newline, and your multi-line tags slink through my censorship after dark.",
        lesson:
          "`.` does not match newlines — a tag spanning lines needs `[^>]*` (or the s flag), and a killer test containing one.",
        code: `function stripTags(html) {
  return html.replace(/<.*?>/g, "");
}

module.exports = { stripTags };
`,
      },
    ],
    reference: `function stripTags(html) {
  return html.replace(/<[^>]*>/g, "");
}

module.exports = { stripTags };
`,
    killerTests: `const { stripTags } = require('./user');

test("censors a single tag", () => {
  expect(stripTags("hello <br> world")).toBe("hello  world");
});

test("leaves untagged text alone", () => {
  expect(stripTags("no tags here")).toBe("no tags here");
});

test("censors every tag, keeps every word", () => {
  expect(stripTags("<b>bold</b> and <i>brave</i>")).toBe("bold and brave");
});

test("handles attributes and closing slashes", () => {
  expect(stripTags('<a href="x">go</a>')).toBe("go");
});

test("tags may span lines", () => {
  expect(stripTags('<img\\nalt="cat">photo')).toBe("photo");
});

test("a lonely bracket is not a tag", () => {
  expect(stripTags("2 < 3")).toBe("2 < 3");
});
`,
  },

  // ── Rank 10 · grandmaster ────────────────────────────────────────
  {
    id: "paw-javascript-settlement-bureau",
    title: "The Settlement Bureau",
    wish: "Wait for all these promises and report how each one turned out.",
    clauses: [
      "Resolves to an array with one report per input, in INPUT order — no matter which promise settles first.",
      "A fulfilled input becomes { status: \"fulfilled\", value }; a rejected one becomes { status: \"rejected\", reason }. Exactly those keys.",
      "The bureau itself NEVER rejects — one cursed case must not burn down the docket.",
      "Plain values count as already-fulfilled cases. An empty docket resolves to [].",
    ],
    signature:
      "function settleAll(cases: unknown[]): Promise<Array<{ status: string; value?: unknown; reason?: unknown }>>",
    conceptTags: ["promises", "Promise.all vs allSettled", "async ordering", "rejection handling"],
    difficulty: "grandmaster",
    language: "javascript",
    rank: 10,
    starterTests: `const { settleAll } = require('./user');

test("settles one fulfilled case", async () => {
  const out = await settleAll([Promise.resolve("gold")]);
  expect(out).toEqual([{ status: "fulfilled", value: "gold" }]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Case closed: one bar of gold, duly fulfilled. The bureau stamps the same verdict on every docket — consistency is the soul of bureaucracy.",
        lesson: "One example is not a specification.",
        code: `async function settleAll(cases) {
  return [{ status: "fulfilled", value: "gold" }];
}

module.exports = { settleAll };
`,
      },
      {
        id: "optimist",
        title: "The Optimist",
        monologue:
          "Promise.all — the industry standard! Every docket you showed me settled beautifully. The first rejection detonates the entire proceedings, of course… but you only ever brought me good news.",
        lesson:
          "`Promise.all` rejects wholesale on the first failure — 'never rejects' is only proven by a docket that CONTAINS a rejection.",
        code: `async function settleAll(cases) {
  const values = await Promise.all(cases);
  return values.map((value) => ({ status: "fulfilled", value }));
}

module.exports = { settleAll };
`,
      },
      {
        id: "case-censor",
        title: "The Case Censor",
        monologue:
          "Rejected cases are so… unsightly. I filed them in the fireplace. What remains is an immaculate ledger of pure success — shorter than your docket, but immaculate.",
        lesson:
          "Swallowing errors changes the SHAPE of the result — assert one report per input, failures included.",
        code: `async function settleAll(cases) {
  const out = [];
  for (const c of cases) {
    try {
      out.push({ status: "fulfilled", value: await c });
    } catch {
      // The bureau does not archive failures.
    }
  }
  return out;
}

module.exports = { settleAll };
`,
      },
      {
        id: "queue-jumper",
        title: "The Queue Jumper",
        monologue:
          "First settled, first filed! My ledger honors the RACE, not your paperwork. Every pre-settled docket arrives in order anyway — timing bugs are shy creatures; you must set traps with real clocks.",
        lesson:
          "Completion order ≠ input order — only promises that settle at genuinely different times expose a push-as-they-finish ledger.",
        code: `function settleAll(cases) {
  return new Promise((resolve) => {
    if (cases.length === 0) {
      resolve([]);
      return;
    }
    const out = [];
    let settled = 0;
    for (const c of cases) {
      Promise.resolve(c)
        .then(
          (value) => out.push({ status: "fulfilled", value }),
          (reason) => out.push({ status: "rejected", reason }),
        )
        .then(() => {
          settled += 1;
          if (settled === cases.length) {
            resolve(out);
          }
        });
    }
  });
}

module.exports = { settleAll };
`,
      },
      {
        id: "fine-print-forger",
        title: "The Fine-Print Forger",
        monologue:
          "Order — perfect. Resilience — perfect. And on every rejected case I recorded the reason under 'value', a harmless clerical flourish. Nobody reads the rejected files. Nobody EVER reads the rejected files.",
        lesson:
          "The allSettled contract is asymmetric — fulfilled carries `value`, rejected carries `reason` — and only asserting a rejected report's exact shape enforces it.",
        code: `function settleAll(cases) {
  return Promise.all(
    cases.map((c) =>
      Promise.resolve(c).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", value: reason }),
      ),
    ),
  );
}

module.exports = { settleAll };
`,
      },
    ],
    reference: `function settleAll(cases) {
  return Promise.all(
    cases.map((c) =>
      Promise.resolve(c).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      ),
    ),
  );
}

module.exports = { settleAll };
`,
    killerTests: `const { settleAll } = require('./user');

test("settles one fulfilled case", async () => {
  const out = await settleAll([Promise.resolve("gold")]);
  expect(out).toEqual([{ status: "fulfilled", value: "gold" }]);
});

test("plain values are already-settled cases", async () => {
  const out = await settleAll(["coin", Promise.resolve("gem")]);
  expect(out).toEqual([
    { status: "fulfilled", value: "coin" },
    { status: "fulfilled", value: "gem" },
  ]);
});

test("one cursed case does not burn the docket", async () => {
  const out = await settleAll([Promise.resolve("ok"), Promise.reject("cursed")]);
  expect(out).toEqual([
    { status: "fulfilled", value: "ok" },
    { status: "rejected", reason: "cursed" },
  ]);
});

test("an all-cursed docket still settles", async () => {
  const out = await settleAll([Promise.reject("a"), Promise.reject("b")]);
  expect(out).toEqual([
    { status: "rejected", reason: "a" },
    { status: "rejected", reason: "b" },
  ]);
});

test("reports arrive in input order, not finish order", async () => {
  const slow = new Promise((res) => setTimeout(() => res("tortoise"), 40));
  const fast = new Promise((res) => setTimeout(() => res("hare"), 5));
  const out = await settleAll([slow, fast]);
  expect(out).toEqual([
    { status: "fulfilled", value: "tortoise" },
    { status: "fulfilled", value: "hare" },
  ]);
});

test("the empty docket", async () => {
  const out = await settleAll([]);
  expect(out).toEqual([]);
});
`,
  },
];
