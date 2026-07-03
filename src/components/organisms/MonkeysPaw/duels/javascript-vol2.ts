/// Monkey's Paw — javascript duel content, volume 2. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./javascript.ts.
/// Verified by __tests__/duels-javascript-vol2.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const JAVASCRIPT_DUELS_VOL2: readonly PawDuel[] = [
  // ── Rank 1 · novice ──────────────────────────────────────────────
  {
    id: "paw-javascript-ticket-booth",
    title: "The Ticket Booth",
    wish: "Number my raffle tickets from 1 up to n.",
    clauses: [
      "ticketRoll(4) is [1, 2, 3, 4] — numbers, starting at 1, ending at n.",
      "The roll is as long as the crowd: n of 1, of 5, of five hundred.",
      "ticketRoll(0) is [] — an empty booth prints nothing. Not even ticket one.",
    ],
    signature: "function ticketRoll(n: number): number[]",
    conceptTags: ["Array.from({length})", "ranges", "off-by-one", "empty case"],
    difficulty: "novice",
    language: "javascript",
    rank: 1,
    starterTests: `const { ticketRoll } = require('./user');

test("prints three tickets", () => {
  expect(ticketRoll(3)).toEqual([1, 2, 3]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One, two, three — a raffle roll of legendary completeness. Every customer receives these same three tickets. Community builds character.",
        lesson: "One example is not a specification.",
        code: `function ticketRoll(n) {
  return [1, 2, 3];
}

module.exports = { ticketRoll };
`,
      },
      {
        id: "stub-dispenser",
        title: "The Stub Dispenser",
        monologue:
          "I keep a pre-printed book of three tickets and tear off as many as you ask for — up to three, naturally. Larger raffles were never demonstrated to my satisfaction.",
        lesson:
          "A cheat can scale DOWN from one example — only a bigger n proves the roll actually grows.",
        code: `function ticketRoll(n) {
  return [1, 2, 3].slice(0, n);
}

module.exports = { ticketRoll };
`,
      },
      {
        id: "eager-printer",
        title: "The Eager Printer",
        monologue:
          "My press prints first and checks the order second — a do-while, the go-getter's loop. Ask for zero tickets and receive one anyway. Enthusiasm was never forbidden.",
        lesson:
          "A do-while runs its body once before it ever looks at the condition — n = 0 is the test that catches it.",
        code: `function ticketRoll(n) {
  const roll = [];
  let ticket = 1;
  do {
    roll.push(ticket);
    ticket += 1;
  } while (ticket <= n);
  return roll;
}

module.exports = { ticketRoll };
`,
      },
    ],
    reference: `function ticketRoll(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

module.exports = { ticketRoll };
`,
    killerTests: `const { ticketRoll } = require('./user');

test("prints three tickets", () => {
  expect(ticketRoll(3)).toEqual([1, 2, 3]);
});

test("a single ticket", () => {
  expect(ticketRoll(1)).toEqual([1]);
});

test("the roll grows with the crowd", () => {
  expect(ticketRoll(5)).toEqual([1, 2, 3, 4, 5]);
});

test("zero tickets means zero tickets", () => {
  expect(ticketRoll(0)).toEqual([]);
});
`,
  },

  // ── Rank 2 · novice ──────────────────────────────────────────────
  {
    id: "paw-javascript-junk-drawer",
    title: "The Junk Drawer",
    wish: "Clear the junk out of my drawer — the nulls and the undefineds.",
    clauses: [
      "null and undefined go. Nothing else does.",
      "0, the empty string, and false are BELONGINGS, not junk — they stay, in place, in order.",
      "A drawer with no junk comes back as-is; an empty drawer comes back empty.",
    ],
    signature: "function declutter(drawer: unknown[]): unknown[]",
    conceptTags: ["truthiness", "falsy values", "filter(Boolean)", "null vs undefined"],
    difficulty: "novice",
    language: "javascript",
    rank: 2,
    starterTests: `const { declutter } = require('./user');

test("sweeps out a null", () => {
  expect(declutter([1, null, 2])).toEqual([1, 2]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "A one and a two, dusted and shelved. Whatever drawer you open, you will find a one and a two. I find the consistency soothing.",
        lesson: "One example is not a specification.",
        code: `function declutter(drawer) {
  return [1, 2];
}

module.exports = { declutter };
`,
      },
      {
        id: "truth-zealot",
        title: "The Truth Zealot",
        monologue:
          "filter(Boolean) — one word, and only TRUTH survives. Your zero? Untrue. Your empty string? Untrue. Your false? Do not insult me. I have swept your drawer of everything the language finds unconvincing.",
        lesson:
          "`filter(Boolean)` drops ALL falsy values — 0, \"\", and false vanish with the nulls; 'remove nothing else' needs falsy keepers in the test.",
        code: `function declutter(drawer) {
  return drawer.filter(Boolean);
}

module.exports = { declutter };
`,
      },
      {
        id: "half-sweeper",
        title: "The Half-Sweeper",
        monologue:
          "I checked every item against null — rigorously, with three equals signs. undefined is not null, as any strict comparison will confirm, so undefined stayed right where it was. Half the junk, gone. Halfway is a fraction of the way, and fractions are progress.",
        lesson:
          "null and undefined are two different absences — a strict !== null keeps one of them; test both.",
        code: `function declutter(drawer) {
  return drawer.filter((x) => x !== null);
}

module.exports = { declutter };
`,
      },
    ],
    reference: `function declutter(drawer) {
  return drawer.filter((x) => x !== null && x !== undefined);
}

module.exports = { declutter };
`,
    killerTests: `const { declutter } = require('./user');

test("sweeps out a null", () => {
  expect(declutter([1, null, 2])).toEqual([1, 2]);
});

test("sweeps out an undefined", () => {
  expect(declutter([1, undefined, 2])).toEqual([1, 2]);
});

test("belongings that happen to be falsy stay", () => {
  expect(declutter([0, "", false])).toEqual([0, "", false]);
});

test("mixed junk and falsy belongings", () => {
  expect(declutter([null, 0, undefined, ""])).toEqual([0, ""]);
});

test("the empty drawer", () => {
  expect(declutter([])).toEqual([]);
});
`,
  },

  // ── Rank 3 · apprentice ──────────────────────────────────────────
  {
    id: "paw-javascript-form-reader",
    title: "The Form Reader",
    wish: "Read the whole number off the front of each form field.",
    clauses: [
      "Base ten, always: \"42\" → 42, and \"042\" → 42 — leading zeros are decoration, not octal.",
      "The read stops at the first non-digit: \"12px\" → 12.",
      "\"0x1A\" → 0 — the zero reads, the x stops it. This office does not speak hexadecimal.",
      "No leading digits, no number: \"px7\" and \"\" → NaN.",
    ],
    signature: "function readWholeNumber(field: string): number",
    conceptTags: ["parseInt radix", "parseInt vs Number", "leading digits", "NaN"],
    difficulty: "apprentice",
    language: "javascript",
    rank: 3,
    starterTests: `const { readWholeNumber } = require('./user');

test("reads a plain number", () => {
  expect(readWholeNumber("42")).toBe(42);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Forty-two. The answer to your form, your next form, and — I suspect — everything. Filing this office's paperwork has never been so consistent.",
        lesson: "One example is not a specification.",
        code: `function readWholeNumber(field) {
  return 42;
}

module.exports = { readWholeNumber };
`,
      },
      {
        id: "radix-gambler",
        title: "The Radix Gambler",
        monologue:
          "parseInt, no second argument — I let the function GUESS the base. It sees your '0x1A' and decides, with great confidence, that you meant twenty-six in hexadecimal. Who am I to correct its instincts?",
        lesson:
          "parseInt without a radix still auto-detects 0x-prefixed hex — pass 10 explicitly when you mean base ten.",
        code: `function readWholeNumber(field) {
  return parseInt(field);
}

module.exports = { readWholeNumber };
`,
      },
      {
        id: "number-convert",
        title: "The Number Convert",
        monologue:
          "Number() — the WHOLE field or nothing. Your '12px' is not a number, so it is NaN. Your empty field is nothing, so it is zero. You may notice those two rulings point in opposite directions. I do not.",
        lesson:
          "Number() parses all-or-nothing ('12px' → NaN) and turns '' into 0 — parseInt reads leading digits and makes '' NaN.",
        code: `function readWholeNumber(field) {
  return Number(field);
}

module.exports = { readWholeNumber };
`,
      },
      {
        id: "digit-plucker",
        title: "The Digit Plucker",
        monologue:
          "I harvest EVERY digit in the field, wherever it hides, and press them into one number. 'px7'? A seven, clearly. '0x1A'? A zero and a one — meet ONE. The wish said read the number; it never said from where.",
        lesson:
          "Stripping non-digits reads from everywhere at once — 'leading digits only' needs a test where digits hide behind junk.",
        code: `function readWholeNumber(field) {
  const digits = field.replace(/\\D/g, "");
  return Number(digits);
}

module.exports = { readWholeNumber };
`,
      },
    ],
    reference: `function readWholeNumber(field) {
  return parseInt(field, 10);
}

module.exports = { readWholeNumber };
`,
    killerTests: `const { readWholeNumber } = require('./user');

test("reads a plain number", () => {
  expect(readWholeNumber("42")).toBe(42);
});

test("leading zeros are decimal", () => {
  expect(readWholeNumber("042")).toBe(42);
});

test("the read stops at the first non-digit", () => {
  expect(readWholeNumber("12px")).toBe(12);
});

test("no hexadecimal in this office", () => {
  expect(readWholeNumber("0x1A")).toBe(0);
});

test("junk before the digits means no number", () => {
  expect(readWholeNumber("px7")).toBeNaN();
});

test("an empty field is NaN, not zero", () => {
  expect(readWholeNumber("")).toBeNaN();
});
`,
  },

  // ── Rank 4 · apprentice ──────────────────────────────────────────
  {
    id: "paw-javascript-price-tagger",
    title: "The Price Tagger",
    wish: "Print my prices on tags — dollars and cents, like a real shop.",
    clauses: [
      "Always exactly two decimals: 3.5 → \"3.50\", 7 → \"7.00\".",
      "Round to the nearest cent: 1.239 → \"1.24\".",
      "A tag is a STRING. \"3.50\", not the number 3.5.",
      "Big prices keep all their digits: 1234.5 → \"1234.50\" — no scientific notation on my shelves.",
    ],
    signature: "function priceLabel(amount: number): string",
    conceptTags: ["toFixed", "number formatting", "toPrecision vs toFixed", "strings vs numbers"],
    difficulty: "apprentice",
    language: "javascript",
    rank: 4,
    starterTests: `const { priceLabel } = require('./user');

test("tags a price", () => {
  expect(priceLabel(2.25)).toBe("2.25");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Every item in your shop now costs two twenty-five. Shoplifting is down, inventory questions are up. The tag gun only had one setting and I respected that.",
        lesson: "One example is not a specification.",
        code: `function priceLabel(amount) {
  return "2.25";
}

module.exports = { priceLabel };
`,
      },
      {
        id: "stringifier",
        title: "The Stringifier",
        monologue:
          "String(amount). The number, verbatim, in quotes. Your 3.5 becomes '3.5' — the fifty cents are IMPLIED, as they are in all sophisticated establishments. Trailing zeros are for shops that don't trust their customers.",
        lesson:
          "String(x) keeps a number's shortest form — '3.5', '7' — only toFixed(2) guarantees the two-decimal tag.",
        code: `function priceLabel(amount) {
  return String(amount);
}

module.exports = { priceLabel };
`,
      },
      {
        id: "truncator",
        title: "The Truncator",
        monologue:
          "I multiply by one hundred and CHOP. Your 1.239 tags as '1.23' — the extra sliver of a cent stays with the house. Rounding up is generosity, and generosity was not in the wish.",
        lesson:
          "Math.trunc drops the fraction instead of rounding — a price ending in 9 mills is the test that separates chopping from rounding.",
        code: `function priceLabel(amount) {
  const chopped = Math.trunc(amount * 100) / 100;
  return chopped.toFixed(2);
}

module.exports = { priceLabel };
`,
      },
      {
        id: "precisionist",
        title: "The Precisionist",
        monologue:
          "toPrecision(3) — three significant digits, chosen by an artisan. It rounds, it pads, it does everything your little tests asked. Bring me a price over a thousand and it becomes '1.23e+3', which I consider AVANT-GARDE pricing.",
        lesson:
          "toPrecision counts significant digits from the front, not decimals from the point — big amounts collapse into scientific notation; toFixed counts from the decimal point.",
        code: `function priceLabel(amount) {
  return amount.toPrecision(3);
}

module.exports = { priceLabel };
`,
      },
    ],
    reference: `function priceLabel(amount) {
  return amount.toFixed(2);
}

module.exports = { priceLabel };
`,
    killerTests: `const { priceLabel } = require('./user');

test("tags a price", () => {
  expect(priceLabel(2.25)).toBe("2.25");
});

test("half a dollar gets its zero", () => {
  expect(priceLabel(3.5)).toBe("3.50");
});

test("whole dollars get both zeros", () => {
  expect(priceLabel(7)).toBe("7.00");
});

test("rounds to the nearest cent", () => {
  expect(priceLabel(1.239)).toBe("1.24");
});

test("big prices keep their digits", () => {
  expect(priceLabel(1234.5)).toBe("1234.50");
});
`,
  },

  // ── Rank 5 · journeyman ──────────────────────────────────────────
  {
    id: "paw-javascript-empty-seats",
    title: "The Empty Seats",
    wish: "Fill out my seating chart — every empty seat should say 'vacant'.",
    clauses: [
      "A seat nobody was ever assigned to (a HOLE in the array) reads \"vacant\".",
      "A seat explicitly set to undefined is just as empty — also \"vacant\".",
      "Occupied seats keep their names, in place; the chart keeps its length.",
      "The output has NO holes — every index is a real \"vacant\" string you can point at.",
    ],
    signature: "function seatingChart(seats: unknown[]): unknown[]",
    conceptTags: ["sparse arrays", "holes vs undefined", "map skips holes", "Array.from normalizes"],
    difficulty: "journeyman",
    language: "javascript",
    rank: 5,
    starterTests: `const { seatingChart } = require('./user');

test("a full row is unchanged", () => {
  expect(seatingChart(["amy", "bo"])).toEqual(["amy", "bo"]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Amy and Bo. Whoever books, wherever they sit, the chart says Amy and Bo. The fire marshal has questions; I have laminate.",
        lesson: "One example is not a specification.",
        code: `function seatingChart(seats) {
  return ["amy", "bo"];
}

module.exports = { seatingChart };
`,
      },
      {
        id: "compactor",
        title: "The Compactor",
        monologue:
          "I filtered out every empty seat. Gone. Your theater of ten is now a theater of six, and EVERYONE in it has a name. You wished for no empty seats; I removed the seats. Read the fine print of your own furniture.",
        lesson:
          "filter changes the array's LENGTH — a chart needs every seat accounted for, so the empty ones must be relabeled, not removed.",
        code: `function seatingChart(seats) {
  return seats.filter((s) => s !== undefined);
}

module.exports = { seatingChart };
`,
      },
      {
        id: "mapper",
        title: "The Mapper",
        monologue:
          "seats.map — I visited every seat and relabeled the empty ones. Every seat that EXISTS, that is. The holes? map politely steps around holes like a gentleman avoiding wet paint. Your chart still has gaps; they are simply gaps I never met.",
        lesson:
          "map, forEach, and filter SKIP holes in sparse arrays — the callback never runs there and the hole survives into the output. Array.from visits every index.",
        code: `function seatingChart(seats) {
  return seats.map((s) => (s === undefined ? "vacant" : s));
}

module.exports = { seatingChart };
`,
      },
      {
        id: "own-key-purist",
        title: "The Own-Key Purist",
        monologue:
          "I checked each index with the in operator — rigorous, property-by-property. Holes lack the property, so holes are vacant. But a seat set to undefined OWNS its index. Someone put that undefined there, deliberately, and I will not disturb their work.",
        lesson:
          "'i in arr' tells holes apart from explicit undefined — but this spec calls BOTH empty, so the check must be on the value, not the key.",
        code: `function seatingChart(seats) {
  const chart = [];
  for (let i = 0; i < seats.length; i++) {
    chart[i] = i in seats ? seats[i] : "vacant";
  }
  return chart;
}

module.exports = { seatingChart };
`,
      },
    ],
    reference: `function seatingChart(seats) {
  return Array.from(seats, (s) => (s === undefined ? "vacant" : s));
}

module.exports = { seatingChart };
`,
    killerTests: `const { seatingChart } = require('./user');

test("a full row is unchanged", () => {
  expect(seatingChart(["amy", "bo"])).toEqual(["amy", "bo"]);
});

test("an explicit undefined is vacant", () => {
  expect(seatingChart(["amy", undefined, "bo"])).toEqual(["amy", "vacant", "bo"]);
});

test("holes are vacant too", () => {
  const seats = new Array(3);
  seats[0] = "amy";
  expect(seatingChart(seats)).toEqual(["amy", "vacant", "vacant"]);
});

test("the chart keeps its length", () => {
  const seats = new Array(4);
  seats[1] = "bo";
  expect(seatingChart(seats)).toHaveLength(4);
});

test("no holes in the output", () => {
  const seats = new Array(2);
  seats[0] = "amy";
  const chart = seatingChart(seats);
  expect(1 in chart).toBe(true);
  expect(chart[1]).toBe("vacant");
});
`,
  },

  // ── Rank 6 · journeyman ──────────────────────────────────────────
  {
    id: "paw-javascript-ballot-box",
    title: "The Ballot Box",
    wish: "Tally the votes for each candidate number, in the order they first appeared.",
    clauses: [
      "Return [candidate, count] pairs — candidates are strings like \"42\" and STAY strings.",
      "Order is FIRST APPEARANCE in the ballots. Not numeric. Not alphabetical. Appearance.",
      "Every vote for a candidate lands on the same pair, however late it arrives.",
      "No ballots, no pairs: [].",
    ],
    signature: "function tallyVotes(ballots: string[]): [string, number][]",
    conceptTags: ["object integer-key reordering", "Map insertion order", "Object.entries", "counting"],
    difficulty: "journeyman",
    language: "javascript",
    rank: 6,
    starterTests: `const { tallyVotes } = require('./user');

test("counts a small election", () => {
  expect(tallyVotes(["3", "3", "11"])).toEqual([["3", 2], ["11", 1]]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Candidate three, two votes; candidate eleven, one. Democracy, pre-printed. Future elections will produce these same results, which the incumbents assure me is fine.",
        lesson: "One example is not a specification.",
        code: `function tallyVotes(ballots) {
  return [["3", 2], ["11", 1]];
}

module.exports = { tallyVotes };
`,
      },
      {
        id: "object-clerk",
        title: "The Object Clerk",
        monologue:
          "A plain object — counts[candidate]++ — the honest civil servant's tally. What I did not mention: objects file integer-looking keys NUMERICALLY, first-come be damned. Candidate '7' now reports before candidate '42', because the FILING CABINET says so.",
        lesson:
          "Plain objects hoist integer-like string keys into ascending numeric order ahead of other keys — Object.entries forgets your insertion order. A Map keeps it.",
        code: `function tallyVotes(ballots) {
  const counts = {};
  for (const b of ballots) {
    counts[b] = (counts[b] || 0) + 1;
  }
  return Object.entries(counts);
}

module.exports = { tallyVotes };
`,
      },
      {
        id: "numeric-sorter",
        title: "The Numeric Sorter",
        monologue:
          "I tallied faithfully, then sorted the pairs by candidate number, smallest first. It looks SO official this way. You said 'in order' — I chose an order. A beautiful order. Ascending.",
        lesson:
          "'In order' must be pinned by a test where first-appearance disagrees with numeric order — otherwise any tidy-looking sort passes.",
        code: `function tallyVotes(ballots) {
  const counts = new Map();
  for (const b of ballots) {
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

module.exports = { tallyVotes };
`,
      },
      {
        id: "last-seen-clerk",
        title: "The Last-Seen Clerk",
        monologue:
          "Each vote moves its candidate to the BACK of my ledger — delete, re-insert, freshest last. Recency is a kind of order. Arguably the most modern kind. Your early frontrunner now files behind everyone who got a late vote.",
        lesson:
          "Map insertion order is stable only if you never delete — re-inserting moves a key to the end. First-appearance order means set once, then only update the value.",
        code: `function tallyVotes(ballots) {
  const counts = new Map();
  for (const b of ballots) {
    const n = (counts.get(b) || 0) + 1;
    counts.delete(b);
    counts.set(b, n);
  }
  return [...counts.entries()];
}

module.exports = { tallyVotes };
`,
      },
    ],
    reference: `function tallyVotes(ballots) {
  const counts = new Map();
  for (const b of ballots) {
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()];
}

module.exports = { tallyVotes };
`,
    killerTests: `const { tallyVotes } = require('./user');

test("counts a small election", () => {
  expect(tallyVotes(["3", "3", "11"])).toEqual([["3", 2], ["11", 1]]);
});

test("first appearance beats numeric order", () => {
  expect(tallyVotes(["42", "7", "42"])).toEqual([["42", 2], ["7", 1]]);
});

test("late votes do not reorder the ledger", () => {
  expect(tallyVotes(["12", "2", "12", "2", "2"])).toEqual([["12", 2], ["2", 3]]);
});

test("candidates stay strings", () => {
  expect(tallyVotes(["9"])).toEqual([["9", 1]]);
});

test("an empty box", () => {
  expect(tallyVotes([])).toEqual([]);
});
`,
  },

  // ── Rank 7 · master ──────────────────────────────────────────────
  {
    id: "paw-javascript-coat-check",
    title: "The Coat Check",
    wish: "Check coats under whatever tickets I hand you, and give the right coat back.",
    clauses: [
      "coatCheck(pairs) returns a claim function: claim(ticket) → the coat checked under that EXACT ticket, or \"no coat\".",
      "Ticket 1 (a number) and ticket \"1\" (a string) are DIFFERENT tickets. So are true and \"true\".",
      "Checking a new coat under the same ticket replaces the old one — last coat wins.",
      "A smudged ticket — NaN — still claims the coat checked under NaN.",
    ],
    signature: "function coatCheck(pairs: [unknown, string][]): (ticket: unknown) => string",
    conceptTags: ["Map vs object keys", "key coercion", "SameValueZero", "closures over storage"],
    difficulty: "master",
    language: "javascript",
    rank: 7,
    starterTests: `const { coatCheck } = require('./user');

test("claims a checked coat", () => {
  const claim = coatCheck([["alice", "red parka"]]);
  expect(claim("alice")).toBe("red parka");
  expect(claim("bob")).toBe("no coat");
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Alice gets the red parka. Everyone else gets 'no coat' and a bracing walk home. I memorized ONE ticket and I stand by her.",
        lesson: "One example is not a specification.",
        code: `function coatCheck(pairs) {
  return function claim(ticket) {
    return ticket === "alice" ? "red parka" : "no coat";
  };
}

module.exports = { coatCheck };
`,
      },
      {
        id: "object-clerk",
        title: "The Object Clerk",
        monologue:
          "A plain object for the rack — rack[ticket] = coat. Object keys are strings, so your number 1 and your string '1' hang on the SAME hook. Two customers, one peg, one very democratic coat. They can fight over it at closing.",
        lesson:
          "Object property keys are coerced to strings — 1, '1', and true/'true' collide on the same key. A Map keeps keys as the values they are.",
        code: `function coatCheck(pairs) {
  const rack = {};
  for (const [ticket, coat] of pairs) {
    rack[ticket] = coat;
  }
  return function claim(ticket) {
    return ticket in rack ? rack[ticket] : "no coat";
  };
}

module.exports = { coatCheck };
`,
      },
      {
        id: "loose-finder",
        title: "The Loose Finder",
        monologue:
          "I walk the rack from the back comparing tickets with == — the RELAXED equals. Your number 1 matches somebody's string '1'; close enough, coats are coats. The smudged NaN ticket matches nothing, including itself, which even I find poetic.",
        lesson:
          "== coerces across types (1 == '1') and still never matches NaN — loose equality fails this contract in both directions.",
        code: `function coatCheck(pairs) {
  return function claim(ticket) {
    for (let i = pairs.length - 1; i >= 0; i--) {
      if (pairs[i][0] == ticket) return pairs[i][1];
    }
    return "no coat";
  };
}

module.exports = { coatCheck };
`,
      },
      {
        id: "strict-scanner",
        title: "The Strict Scanner",
        monologue:
          "Triple equals, back to front. Numbers stay numbers, strings stay strings, last coat wins — rigor at every hook. Then you hand me the smudged ticket. NaN === NaN is false. The coat is RIGHT THERE and the mathematics forbid me from giving it to you.",
        lesson:
          "=== can never find NaN because NaN !== NaN — Map and Set use SameValueZero, where NaN is one key like any other.",
        code: `function coatCheck(pairs) {
  return function claim(ticket) {
    for (let i = pairs.length - 1; i >= 0; i--) {
      if (pairs[i][0] === ticket) return pairs[i][1];
    }
    return "no coat";
  };
}

module.exports = { coatCheck };
`,
      },
      {
        id: "first-keeper",
        title: "The First-Keeper",
        monologue:
          "A proper Map — types honored, smudges honored. One refinement: the FIRST coat on a ticket stays. Whatever you brought me later was clearly a downgrade, and I protect my customers from their own second thoughts.",
        lesson:
          "'Last one wins' is a clause, not a default — a test that re-checks the same ticket is the only thing pinning down which write survives.",
        code: `function coatCheck(pairs) {
  const rack = new Map();
  for (const [ticket, coat] of pairs) {
    if (!rack.has(ticket)) rack.set(ticket, coat);
  }
  return function claim(ticket) {
    return rack.has(ticket) ? rack.get(ticket) : "no coat";
  };
}

module.exports = { coatCheck };
`,
      },
    ],
    reference: `function coatCheck(pairs) {
  const rack = new Map();
  for (const [ticket, coat] of pairs) {
    rack.set(ticket, coat);
  }
  return function claim(ticket) {
    return rack.has(ticket) ? rack.get(ticket) : "no coat";
  };
}

module.exports = { coatCheck };
`,
    killerTests: `const { coatCheck } = require('./user');

test("claims a checked coat", () => {
  const claim = coatCheck([["alice", "red parka"]]);
  expect(claim("alice")).toBe("red parka");
  expect(claim("bob")).toBe("no coat");
});

test("number 1 and string '1' are different tickets", () => {
  const claim = coatCheck([[1, "wool coat"], ["1", "denim jacket"]]);
  expect(claim(1)).toBe("wool coat");
  expect(claim("1")).toBe("denim jacket");
});

test("true and 'true' are different tickets", () => {
  const claim = coatCheck([[true, "leather"], ["true", "canvas"]]);
  expect(claim(true)).toBe("leather");
  expect(claim("true")).toBe("canvas");
});

test("the last coat on a ticket wins", () => {
  const claim = coatCheck([["z9", "old blazer"], ["z9", "new trench"]]);
  expect(claim("z9")).toBe("new trench");
});

test("a smudged ticket still claims its coat", () => {
  const claim = coatCheck([[NaN, "lost-and-found fleece"]]);
  expect(claim(NaN)).toBe("lost-and-found fleece");
});
`,
  },

  // ── Rank 8 · master ──────────────────────────────────────────────
  {
    id: "paw-javascript-card-catalog",
    title: "The Card Catalog",
    wish: "Alphabetize my authors the way a librarian would.",
    clauses: [
      "Case does not matter: \"adam\" shelves before \"Bo\".",
      "Accented letters shelve WITH their base letter: \"Åsa\" files under A, \"Zoë\" is a Z — not exiled past z.",
      "Names come back exactly as written — accents intact, nothing 'cleaned up'.",
      "Sort with the locale's rules (localeCompare), not the character table's.",
    ],
    signature: "function shelveAuthors(names: string[]): string[]",
    conceptTags: ["localeCompare", "codepoint sort", "sensitivity base", "Unicode collation"],
    difficulty: "master",
    language: "javascript",
    rank: 8,
    starterTests: `const { shelveAuthors } = require('./user');

test("shelves plain names", () => {
  expect(shelveAuthors(["carol", "adam", "bo"])).toEqual(["adam", "bo", "carol"]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Adam, Bo, Carol. The only three authors your library will ever need, shelved in an order I have committed to marble.",
        lesson: "One example is not a specification.",
        code: `function shelveAuthors(names) {
  return ["adam", "bo", "carol"];
}

module.exports = { shelveAuthors };
`,
      },
      {
        id: "codepoint-clerk",
        title: "The Codepoint Clerk",
        monologue:
          ".sort(), bare. It compares by character CODE, where every capital outranks every lowercase — so 'Bo' (66) shelves before 'adam' (97), and your accented authors are deported past z entirely. The character table is my collation, and the character table has OPINIONS.",
        lesson:
          "Default string sort compares UTF-16 code units — uppercase before lowercase, accents after z. Alphabetical for humans needs localeCompare.",
        code: `function shelveAuthors(names) {
  return [...names].sort();
}

module.exports = { shelveAuthors };
`,
      },
      {
        id: "case-folder",
        title: "The Case Folder",
        monologue:
          "I lowercase both names before comparing — case solved, you're welcome. The accents remain untreated. 'å' lives at codepoint 229, which is past 'z', which means Åsa shelves after Zoë, in the special wing I have built for foreigners.",
        lesson:
          "toLowerCase fixes case but not accents — å still compares past z by codepoint. localeCompare with sensitivity 'base' folds case AND diacritics.",
        code: `function shelveAuthors(names) {
  return [...names].sort((a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

module.exports = { shelveAuthors };
`,
      },
      {
        id: "accent-mangler",
        title: "The Accent Mangler",
        monologue:
          "I decomposed every name to NFD, scraped off the diacritics, and shelved the residue. The ORDER is impeccable. The names are... simplified. Åsa is now Asa. Zoë is now Zoe. They will adjust. Filing clerks have done this for centuries.",
        lesson:
          "Normalize-and-strip is a fine COMPARISON key but must never touch the output — return the originals, compare the folded forms.",
        code: `function shelveAuthors(names) {
  const fold = (s) => s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
  return names.map(fold).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

module.exports = { shelveAuthors };
`,
      },
    ],
    reference: `function shelveAuthors(names) {
  return [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

module.exports = { shelveAuthors };
`,
    killerTests: `const { shelveAuthors } = require('./user');

test("shelves plain names", () => {
  expect(shelveAuthors(["carol", "adam", "bo"])).toEqual(["adam", "bo", "carol"]);
});

test("case does not jump the queue", () => {
  expect(shelveAuthors(["Bo", "adam"])).toEqual(["adam", "Bo"]);
});

test("accents shelve with their base letter", () => {
  expect(shelveAuthors(["Zo\\u00eb", "adam", "\\u00c5sa", "Bo"])).toEqual([
    "adam",
    "\\u00c5sa",
    "Bo",
    "Zo\\u00eb",
  ]);
});

test("names come back as written", () => {
  const shelved = shelveAuthors(["Zo\\u00eb", "\\u00c5sa"]);
  expect(shelved).toContain("Zo\\u00eb");
  expect(shelved).toContain("\\u00c5sa");
});
`,
  },

  // ── Rank 9 · grandmaster ─────────────────────────────────────────
  {
    id: "paw-javascript-turnstile",
    title: "The Turnstile",
    wish: "Let the first n people through the turnstile.",
    clauses: [
      "Works on ANY iterable — array, string, Set, generator — via its iterator.",
      "LAZY: pull the iterator no more than n times. The line behind the gate stays unbothered.",
      "A line shorter than n lets everyone through — exactly who was there, nobody invented.",
      "n = 0 admits nobody and pulls nobody: [] with zero pulls.",
    ],
    signature: "function take(source: Iterable<unknown>, n: number): unknown[]",
    conceptTags: ["iterators", "Symbol.iterator", "laziness", "done vs value"],
    difficulty: "grandmaster",
    language: "javascript",
    rank: 9,
    starterTests: `const { take } = require('./user');

test("admits the first two", () => {
  expect(take(["ana", "raj", "kim"], 2)).toEqual(["ana", "raj"]);
});
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ana and Raj get in. Kim does not, and neither does anyone else, ever. The velvet rope is a way of life.",
        lesson: "One example is not a specification.",
        code: `function take(source, n) {
  return ["ana", "raj"];
}

module.exports = { take };
`,
      },
      {
        id: "indexer",
        title: "The Indexer",
        monologue:
          "source[0], source[1] — square brackets, the people's syntax. Arrays have them, strings have them. Your Set? Your generator? They have no numbered seats, so my gate admits a procession of undefineds. Very quiet guests. No coat check required.",
        lesson:
          "Indexing only works on array-likes — Sets and generators have no [i]. The iterator protocol (Symbol.iterator / next) is the one door every iterable shares.",
        code: `function take(source, n) {
  const out = [];
  for (let i = 0; i < n && i < source.length; i++) {
    out.push(source[i]);
  }
  return out;
}

module.exports = { take };
`,
      },
      {
        id: "spreader",
        title: "The Spreader",
        monologue:
          "[...source].slice(0, n). I processed the ENTIRE line — every last person, all hundred of them — stamped their hands, and then admitted the first three. The rest were processed for completeness. Completeness is my love language.",
        lesson:
          "Spread drains the whole iterator before slicing — 'lazy' is only provable with a source that counts how many times it was pulled.",
        code: `function take(source, n) {
  return [...source].slice(0, n);
}

module.exports = { take };
`,
      },
      {
        id: "done-ignorer",
        title: "The Done Ignorer",
        monologue:
          "I pull the iterator exactly n times and wave each result through. When the line runs out, the iterator says done — and I say WELCOME, undefined, right this way. You asked for three; three you shall receive, existence optional.",
        lesson:
          "next() keeps answering after exhaustion with { done: true, value: undefined } — check done before pushing, or short lines pad with ghosts.",
        code: `function take(source, n) {
  const out = [];
  const it = source[Symbol.iterator]();
  for (let i = 0; i < n; i++) {
    out.push(it.next().value);
  }
  return out;
}

module.exports = { take };
`,
      },
      {
        id: "over-puller",
        title: "The Over-Puller",
        monologue:
          "Pull first, ask questions later — my loop peeks at the NEXT person before deciding it has enough. Values? Flawless. But the fourth person in line felt the turnstile twitch, and in a lazy pipeline that twitch might have been a database query. Oops.",
        lesson:
          "A pull-then-check loop always draws one extra element — count the pulls, not just the output, to prove exact laziness.",
        code: `function take(source, n) {
  const out = [];
  const it = source[Symbol.iterator]();
  let r = it.next();
  while (!r.done && out.length < n) {
    out.push(r.value);
    r = it.next();
  }
  return out;
}

module.exports = { take };
`,
      },
    ],
    reference: `function take(source, n) {
  const out = [];
  if (n <= 0) return out;
  const it = source[Symbol.iterator]();
  while (out.length < n) {
    const r = it.next();
    if (r.done) break;
    out.push(r.value);
  }
  return out;
}

module.exports = { take };
`,
    killerTests: `const { take } = require('./user');

function makeGate(size) {
  const state = { pulls: 0 };
  const line = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() {
          state.pulls += 1;
          if (i < size) {
            i += 1;
            return { value: "p" + i, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
  return { line, state };
}

test("admits the first two", () => {
  expect(take(["ana", "raj", "kim"], 2)).toEqual(["ana", "raj"]);
});

test("works on a string", () => {
  expect(take("hello", 2)).toEqual(["h", "e"]);
});

test("works on a Set", () => {
  expect(take(new Set(["ana", "raj", "kim"]), 2)).toEqual(["ana", "raj"]);
});

test("a short line lets everyone through, nobody invented", () => {
  expect(take(["kim"], 3)).toEqual(["kim"]);
});

test("pulls the line exactly n times", () => {
  const { line, state } = makeGate(100);
  expect(take(line, 3)).toEqual(["p1", "p2", "p3"]);
  expect(state.pulls).toBe(3);
});

test("n = 0 admits nobody and pulls nobody", () => {
  const { line, state } = makeGate(5);
  expect(take(line, 0)).toEqual([]);
  expect(state.pulls).toBe(0);
});
`,
  },

  // ── Rank 10 · grandmaster ────────────────────────────────────────
  {
    id: "paw-javascript-glass-case",
    title: "The Glass Case",
    wish: "Lock every part of my exhibit so nothing can be touched — cases within cases too.",
    clauses: [
      "Returns the SAME exhibit object (same reference), deeply frozen.",
      "Every nested object AND array is frozen, all the way down — grandchildren included.",
      "Exhibits that reference themselves (cycles) lock cleanly — no blown stack.",
      "null and primitive values inside are fine — no crashing on the plaque that reads null.",
    ],
    signature: "function lockExhibit<T>(exhibit: T): T",
    conceptTags: ["Object.freeze is shallow", "WeakSet", "cycle detection", "typeof null"],
    difficulty: "grandmaster",
    language: "javascript",
    rank: 10,
    starterTests: `const { lockExhibit } = require('./user');

test("locks a flat exhibit", () => {
  const exhibit = { name: "gem" };
  expect(lockExhibit(exhibit)).toBe(exhibit);
  expect(Object.isFrozen(exhibit)).toBe(true);
});
`,
    cheats: [
      {
        id: "surface-locker",
        title: "The Surface Locker",
        monologue:
          "Object.freeze(exhibit). The outer case is SOLID — knock on it, magnificent. The cases inside? Open. The freeze is one molecule deep, which is one molecule more than the wish specified, if we're being lawyerly. And we are.",
        lesson:
          "Object.freeze is SHALLOW — it locks own properties of one object; everything nested stays mutable until you recurse.",
        code: `function lockExhibit(exhibit) {
  return Object.freeze(exhibit);
}

module.exports = { lockExhibit };
`,
      },
      {
        id: "one-level-digger",
        title: "The One-Level Digger",
        monologue:
          "I froze the exhibit AND everything directly inside it. Two layers of glass! The grandchildren remain warm and mutable, but who inspects a museum to the third shelf? Auditors. Auditors do.",
        lesson:
          "Fixed-depth freezing is just a deeper shallow — only recursion (or a work stack) reaches arbitrary nesting.",
        code: `function lockExhibit(exhibit) {
  Object.freeze(exhibit);
  for (const key of Object.keys(exhibit)) {
    const child = exhibit[key];
    if (child !== null && typeof child === "object") Object.freeze(child);
  }
  return exhibit;
}

module.exports = { lockExhibit };
`,
      },
      {
        id: "shelf-skipper",
        title: "The Shelf Skipper",
        monologue:
          "I recurse into every object — but arrays? Arrays are FURNITURE, not exhibits. My Array.isArray connoisseurship decided shelves don't need locking, so your array of priceless miniatures is one push() away from a heist.",
        lesson:
          "Arrays are objects too — typeof [] is 'object', Object.freeze works on them, and skipping them leaves every list unlocked.",
        code: `function lockExhibit(exhibit) {
  const lock = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    Object.freeze(value);
    for (const key of Object.keys(value)) lock(value[key]);
  };
  lock(exhibit);
  return exhibit;
}

module.exports = { lockExhibit };
`,
      },
      {
        id: "naive-recurser",
        title: "The Naive Recurser",
        monologue:
          "Full recursion — objects, arrays, everything, frozen to the core. Then your exhibit contained a mirror: a case that displays ITSELF. I followed the reflection. And the reflection's reflection. I am still in there, somewhere, freezing the same case for the forty-thousandth time.",
        lesson:
          "Self-referencing structures send naive recursion into a stack overflow — a WeakSet of visited objects turns the infinite hall of mirrors into a single visit.",
        code: `function lockExhibit(exhibit) {
  const lock = (value) => {
    if (value === null || typeof value !== "object") return;
    Object.freeze(value);
    for (const key of Object.keys(value)) lock(value[key]);
  };
  lock(exhibit);
  return exhibit;
}

module.exports = { lockExhibit };
`,
      },
      {
        id: "null-tripper",
        title: "The Null Tripper",
        monologue:
          "WeakSet guard, full recursion, arrays included — near perfection. But typeof null is 'object', a lie the language has told since 1995, and I BELIEVED it. I tried to file null in my WeakSet and the WeakSet filed a complaint. Your empty plaque has crashed the museum.",
        lesson:
          "typeof null === 'object' — every 'is it an object?' check needs the explicit null test first, or null walks straight into WeakSet.add and throws.",
        code: `function lockExhibit(exhibit) {
  const seen = new WeakSet();
  const lock = (value) => {
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    Object.freeze(value);
    for (const key of Object.keys(value)) lock(value[key]);
  };
  lock(exhibit);
  return exhibit;
}

module.exports = { lockExhibit };
`,
      },
    ],
    reference: `function lockExhibit(exhibit) {
  const seen = new WeakSet();
  const lock = (value) => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    Object.freeze(value);
    for (const key of Object.keys(value)) lock(value[key]);
  };
  lock(exhibit);
  return exhibit;
}

module.exports = { lockExhibit };
`,
    killerTests: `const { lockExhibit } = require('./user');

test("locks a flat exhibit", () => {
  const exhibit = { name: "gem" };
  expect(lockExhibit(exhibit)).toBe(exhibit);
  expect(Object.isFrozen(exhibit)).toBe(true);
});

test("locks cases within cases, all the way down", () => {
  const exhibit = { wing: { cabinet: { gem: { carats: 12 } } } };
  lockExhibit(exhibit);
  expect(Object.isFrozen(exhibit.wing)).toBe(true);
  expect(Object.isFrozen(exhibit.wing.cabinet)).toBe(true);
  expect(Object.isFrozen(exhibit.wing.cabinet.gem)).toBe(true);
});

test("arrays are exhibits too", () => {
  const exhibit = { shelf: [{ tag: "miniature" }] };
  lockExhibit(exhibit);
  expect(Object.isFrozen(exhibit.shelf)).toBe(true);
  expect(Object.isFrozen(exhibit.shelf[0])).toBe(true);
});

test("a self-referencing exhibit locks cleanly", () => {
  const hall = { name: "hall of mirrors" };
  hall.reflection = hall;
  expect(lockExhibit(hall)).toBe(hall);
  expect(Object.isFrozen(hall)).toBe(true);
});

test("a null plaque does not crash the museum", () => {
  const exhibit = { name: "minimalism", plaque: null };
  expect(lockExhibit(exhibit)).toBe(exhibit);
  expect(Object.isFrozen(exhibit)).toBe(true);
});
`,
  },
];
