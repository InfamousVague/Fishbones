/// Monkey's Paw — python duel content, volume 2. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./python.ts.
/// Verified by __tests__/duels-python-vol2.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const PYTHON_DUELS_VOL2: readonly PawDuel[] = [
  {
    id: "paw-python-town-crier",
    title: "The Town Crier",
    wish: "Number the announcements on my scroll so the town can follow along.",
    clauses: [
      "Numbering starts at 1 — the town does not count from zero.",
      "Each line becomes 'N. text': the number, a period, ONE space, then the line.",
      "The announcement text is read verbatim — not trimmed, not retouched.",
      "An empty scroll announces nothing: [].",
    ],
    signature: "def numbered(lines: list) -> list",
    conceptTags: ["enumerate(start=)", "f-strings", "off-by-one", "list comprehension"],
    difficulty: "novice",
    language: "python",
    rank: 1,
    starterTests: `from user import numbered

@test("numbers a one-line scroll")
def _():
    expect(numbered(["hear ye"])).to_equal(["1. hear ye"])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'1. hear ye' — the only announcement this town has ever needed. I shall cry it at every scroll you bring me, forever.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def numbered(lines):
    return ["1. hear ye"]
`,
      },
      {
        id: "one-line-wonder",
        title: "The One-Line Wonder",
        monologue:
          "Every line, faithfully numbered ONE. Your scroll had one line; ergo every line is line one. Induction is a beautiful thing.",
        lesson:
          "A single-item example can't tell 'the right number' from 'always 1' — number a longer scroll.",
        code: `def numbered(lines):
    return [f"1. {line}" for line in lines]
`,
      },
      {
        id: "countdown-herald",
        title: "The Countdown Herald",
        monologue:
          "I number from the bottom up, like a rocket launch — far more dramatic. On a one-line scroll, who can tell which way I was counting?",
        lesson:
          "Direction is invisible on one item — enumerate(lines, start=1) must be proven with positions 1, 2, AND 3.",
        code: `def numbered(lines):
    return [f"{len(lines) - i}. {line}" for i, line in enumerate(lines)]
`,
      },
    ],
    reference: `def numbered(lines):
    return [f"{i}. {line}" for i, line in enumerate(lines, start=1)]
`,
    killerTests: `from user import numbered

@test("numbers a one-line scroll")
def _():
    expect(numbered(["hear ye"])).to_equal(["1. hear ye"])

@test("counts 1, 2, 3 down the scroll")
def _():
    expect(numbered(["wake", "work", "sleep"])).to_equal(
        ["1. wake", "2. work", "3. sleep"]
    )

@test("reads the text verbatim")
def _():
    expect(numbered(["7 pm curfew", "  spaced  "])).to_equal(
        ["1. 7 pm curfew", "2.   spaced  "]
    )

@test("an empty scroll announces nothing")
def _():
    expect(numbered([])).to_equal([])
`,
  },

  {
    id: "paw-python-dance-pairer",
    title: "The Dance Pairer",
    wish: "Pair up the leads and the follows for tonight's dance.",
    clauses: [
      "Pairs form in order: first lead with first follow, second with second…",
      "Each pair is a (lead, follow) tuple.",
      "When one line is longer, the extras sit this dance out — pair only up to the shorter line.",
      "No leads, or no follows, means no pairs: [].",
    ],
    signature: "def paired(leads: list, follows: list) -> list",
    conceptTags: ["zip truncation", "tuples", "unequal lengths", "iteration"],
    difficulty: "novice",
    language: "python",
    rank: 2,
    starterTests: `from user import paired

@test("pairs one lead with one follow")
def _():
    expect(paired(["ann"], ["bo"])).to_equal([("ann", "bo")])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ann dances with Bo. It is known. Whoever walks through that door, Ann dances with Bo.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def paired(leads, follows):
    return [("ann", "bo")]
`,
      },
      {
        id: "index-optimist",
        title: "The Index Optimist",
        monologue:
          "I stride down the leads' line and reach across for a partner — follows[i], always there. Your lines were always the same length. Tonight they weren't, and I reached into thin air.",
        lesson:
          "Indexing one list by another's length crashes the moment they differ — zip truncates to the shorter for free.",
        code: `def paired(leads, follows):
    return [(leads[i], follows[i]) for i in range(len(leads))]
`,
      },
      {
        id: "phantom-partner",
        title: "The Phantom Partner",
        monologue:
          "No one sits out in MY ballroom — the unmatched dance with None, a very accommodating partner. You said 'extras sit out'. You never checked the floor.",
        lesson:
          "Truncate-to-shorter is a clause — prove the extras are DROPPED, not padded with None.",
        code: `def paired(leads, follows):
    out = []
    n = max(len(leads), len(follows))
    for i in range(n):
        lead = leads[i] if i < len(leads) else None
        follow = follows[i] if i < len(follows) else None
        out.append((lead, follow))
    return out
`,
      },
    ],
    reference: `def paired(leads, follows):
    return list(zip(leads, follows))
`,
    killerTests: `from user import paired

@test("pairs one lead with one follow")
def _():
    expect(paired(["ann"], ["bo"])).to_equal([("ann", "bo")])

@test("pairs in order down both lines")
def _():
    expect(paired(["a", "b"], ["x", "y"])).to_equal([("a", "x"), ("b", "y")])

@test("extra leads sit out")
def _():
    expect(paired(["a", "b", "c"], ["x"])).to_equal([("a", "x")])

@test("extra follows sit out")
def _():
    expect(paired(["a"], ["x", "y", "z"])).to_equal([("a", "x")])

@test("an empty line means no pairs")
def _():
    expect(paired([], ["x"])).to_equal([])
    expect(paired(["a"], [])).to_equal([])
`,
  },

  {
    id: "paw-python-tidy-archivist",
    title: "The Tidy Archivist",
    wish: "Hand me these catalog numbers in ascending order — but my original pile stays exactly as I left it.",
    clauses: [
      "Returns a NEW list, sorted ascending.",
      "The caller's list is never reordered — not even a little.",
      "Duplicates are honest entries: every copy stays.",
      "An empty pile sorts to an empty list.",
    ],
    signature: "def shelved(numbers: list) -> list",
    conceptTags: [
      "sorted() vs list.sort()",
      "in-place mutation",
      "list.sort returns None",
      "duplicates",
    ],
    difficulty: "apprentice",
    language: "python",
    rank: 3,
    starterTests: `from user import shelved

@test("sorts a small pile ascending")
def _():
    expect(shelved([3, 1, 2])).to_equal([1, 2, 3])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Three, one, two becomes one, two, three. The archive holds precisely one pile, and I have alphabetized it by heart.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def shelved(numbers):
    if numbers == [3, 1, 2]:
        return [1, 2, 3]
    return numbers
`,
      },
      {
        id: "in-place-vandal",
        title: "The In-Place Vandal",
        monologue:
          "numbers.sort() — quick, brutal, effective. Your pile is now MY pile, rearranged to taste. Careful with that .sort(), by the way: it hands back None to anyone who tries to catch it.",
        lesson:
          "list.sort() reorders the caller's list in place (and returns None) — 'returns a sorted copy' needs a test that re-reads the input afterward.",
        code: `def shelved(numbers):
    numbers.sort()
    return numbers
`,
      },
      {
        id: "deduplicating-curator",
        title: "The Deduplicating Curator",
        monologue:
          "sorted(set(...)) — sorted AND tidied. Duplicate catalog numbers are clearly clerical errors, and I do not archive errors.",
        lesson:
          "set() silently swallows duplicates — sorting contracts need a test with repeated values.",
        code: `def shelved(numbers):
    return sorted(set(numbers))
`,
      },
    ],
    reference: `def shelved(numbers):
    return sorted(numbers)
`,
    killerTests: `from user import shelved

@test("sorts a small pile ascending")
def _():
    expect(shelved([3, 1, 2])).to_equal([1, 2, 3])

@test("sorts any pile, not just the sample")
def _():
    expect(shelved([10, -2, 7])).to_equal([-2, 7, 10])
    expect(shelved([])).to_equal([])

@test("never reorders the caller's pile")
def _():
    pile = [5, 4, 9]
    out = shelved(pile)
    expect(out).to_equal([4, 5, 9])
    expect(pile).to_equal([5, 4, 9])

@test("duplicates all keep their shelf")
def _():
    expect(shelved([2, 1, 2])).to_equal([1, 2, 2])
`,
  },

  {
    id: "paw-python-post-mistress",
    title: "The Post Mistress",
    wish: "Sort this mail into pigeonholes by the first letter of each word.",
    clauses: [
      "The pigeonhole key is the word's FIRST letter, lowercased — 'Ant' lands in 'a'.",
      "Words keep their original spelling and their arrival order inside each hole.",
      "Every word lands in exactly one hole; holes never share contents.",
      "No mail, no holes: {}.",
    ],
    signature: "def pigeonholes(words: list) -> dict",
    conceptTags: [
      "dict.setdefault",
      "grouping",
      "shared mutable values",
      "dict.fromkeys trap",
    ],
    difficulty: "apprentice",
    language: "python",
    rank: 4,
    starterTests: `from user import pigeonholes

@test("files one letter of mail")
def _():
    expect(pigeonholes(["ant"])).to_equal({"a": ["ant"]})
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One ant, one hole. The postal service has memorized its entire route. Do not send more mail.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def pigeonholes(words):
    if words == ["ant"]:
        return {"a": ["ant"]}
    return {}
`,
      },
      {
        id: "overwriter",
        title: "The Overwriter",
        monologue:
          "Each hole holds the latest letter — d[k] = [w], crisp and current. Earlier mail? Recycled. You only ever posted one letter per hole.",
        lesson:
          "d[k] = [w] replaces the whole group — accumulation needs setdefault(k, []).append(w), proven with two words in one hole.",
        code: `def pigeonholes(words):
    holes = {}
    for w in words:
        holes[w[0].lower()] = [w]
    return holes
`,
      },
      {
        id: "communal-bin",
        title: "The Communal Bin",
        monologue:
          "dict.fromkeys(letters, []) — every hole furnished in one stroke! With the SAME bin, as it happens. Every letter now receives everyone's mail. Community spirit.",
        lesson:
          "dict.fromkeys(keys, []) binds every key to ONE shared list — mutate one hole and you've mutated them all.",
        code: `def pigeonholes(words):
    holes = dict.fromkeys({w[0].lower() for w in words}, [])
    for w in words:
        holes[w[0].lower()].append(w)
    return holes
`,
      },
      {
        id: "case-purist",
        title: "The Case Purist",
        monologue:
          "'Ant' filed under 'A' — capital letters deserve capital holes. Lowercasing the key was in the contract, yes, but your mail was always so very lowercase.",
        lesson:
          "Key normalization ('lowercase the first letter') is invisible until a test posts a capitalized word.",
        code: `def pigeonholes(words):
    holes = {}
    for w in words:
        holes.setdefault(w[0], []).append(w)
    return holes
`,
      },
    ],
    reference: `def pigeonholes(words):
    holes = {}
    for w in words:
        holes.setdefault(w[0].lower(), []).append(w)
    return holes
`,
    killerTests: `from user import pigeonholes

@test("files one letter of mail")
def _():
    expect(pigeonholes(["ant"])).to_equal({"a": ["ant"]})

@test("same-letter words pile up in arrival order")
def _():
    expect(pigeonholes(["ant", "axe", "arc"])).to_equal(
        {"a": ["ant", "axe", "arc"]}
    )

@test("different letters get separate holes")
def _():
    expect(pigeonholes(["ant", "bee", "axe"])).to_equal(
        {"a": ["ant", "axe"], "b": ["bee"]}
    )

@test("keys are lowercased, spellings are not")
def _():
    expect(pigeonholes(["Ant", "arc"])).to_equal({"a": ["Ant", "arc"]})

@test("no mail, no holes")
def _():
    expect(pigeonholes([])).to_equal({})
`,
  },

  {
    id: "paw-python-whitespace-cartographer",
    title: "The Whitespace Cartographer",
    wish: "Chart the words in this message — just the words, wherever the gaps fall.",
    clauses: [
      "A word is a maximal run of non-whitespace characters.",
      "ANY whitespace is a gap: spaces, tabs, newlines — and a run of them is ONE gap.",
      "Gaps at the edges are coastline, not words — leading/trailing whitespace yields nothing.",
      "An empty or all-whitespace message charts no words: [].",
    ],
    signature: "def charted(message: str) -> list",
    conceptTags: [
      "str.split() vs split(' ')",
      "whitespace runs",
      "empty-string tokens",
      "tabs and newlines",
    ],
    difficulty: "journeyman",
    language: "python",
    rank: 5,
    starterTests: `from user import charted

@test("charts a simple message")
def _():
    expect(charted("to the sea")).to_equal(["to", "the", "sea"])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'to', 'the', 'sea'. I have charted the only message ever sent. All other messages are uncharted waters, and shall remain so.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def charted(message):
    if message == "to the sea":
        return ["to", "the", "sea"]
    return []
`,
      },
      {
        id: "single-space-clerk",
        title: "The Single-Space Clerk",
        monologue:
          "split(' ') — I split on the space. THE space, one character, as written. Two spaces in a row? That's a word now. An empty little ghost word.",
        lesson:
          "split(' ') is not split(): the former manufactures '' tokens at doubled, leading, and trailing spaces.",
        code: `def charted(message):
    return message.split(" ")
`,
      },
      {
        id: "coastline-trimmer",
        title: "The Coastline Trimmer",
        monologue:
          "I strip the shores first, THEN split on the space — the edge ghosts are banished. The ghosts living between your double spaces send their regards.",
        lesson:
          "strip() only fixes the ends — interior whitespace runs still need split(None) semantics.",
        code: `def charted(message):
    if not message.strip():
        return []
    return message.strip().split(" ")
`,
      },
      {
        id: "gap-filterer",
        title: "The Gap Filterer",
        monologue:
          "I split on spaces and sieve out every ghost — flawless, for spaces. Tabs and newlines, though? Not spaces. They sail straight through my sieve, glued inside your words.",
        lesson:
          "'Whitespace' is bigger than ' ' — bare split() handles tabs and newlines; a space-only splitter never will.",
        code: `def charted(message):
    return [w for w in message.split(" ") if w]
`,
      },
    ],
    reference: `def charted(message):
    return message.split()
`,
    killerTests: `from user import charted

@test("charts a simple message")
def _():
    expect(charted("to the sea")).to_equal(["to", "the", "sea"])

@test("a run of spaces is one gap")
def _():
    expect(charted("to  the   sea")).to_equal(["to", "the", "sea"])

@test("tabs and newlines are gaps too")
def _():
    expect(charted("to\\tthe\\nsea")).to_equal(["to", "the", "sea"])

@test("edge whitespace is coastline, not words")
def _():
    expect(charted("  to the sea ")).to_equal(["to", "the", "sea"])

@test("empty and all-whitespace messages chart nothing")
def _():
    expect(charted("")).to_equal([])
    expect(charted(" \\t\\n ")).to_equal([])
`,
  },

  {
    id: "paw-python-price-engraver",
    title: "The Price Engraver",
    wish: "Engrave this amount of cents as a proper price tag, like $3.49.",
    clauses: [
      "Input is a whole number of cents, never negative.",
      "The tag reads '$' + dollars + '.' + cents — dollars unpadded, no separators.",
      "The cents part is ALWAYS exactly two digits: 5 cents engraves as .05.",
      "Exact at any size — a trillion-dollar tag loses nothing. 0 engraves as $0.00.",
    ],
    signature: "def price_tag(cents: int) -> str",
    conceptTags: [
      "f-string format specs",
      ":02d zero padding",
      "integer // and %",
      "float formatting drift",
    ],
    difficulty: "journeyman",
    language: "python",
    rank: 6,
    starterTests: `from user import price_tag

@test("engraves a simple price")
def _():
    expect(price_tag(349)).to_be("$3.49")
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "$3.49 — a beautiful price. Fair, honest, universal. Everything in this shop now costs $3.49.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def price_tag(cents):
    return "$3.49"
`,
      },
      {
        id: "float-engraver",
        title: "The Float Engraver",
        monologue:
          "Divide by a hundred, let str() do the engraving. 349 becomes 3.49, flawless! 350 becomes… 3.5. str() trims trailing zeros, and your tests never bought anything round.",
        lesson:
          "str(x / 100) drops trailing zeros ($3.50 becomes $3.5) — currency needs explicit two-digit formatting, not float repr.",
        code: `def price_tag(cents):
    return f"\${cents / 100}"
`,
      },
      {
        id: "unpadded-teller",
        title: "The Unpadded Teller",
        monologue:
          "Dollars by floor division, cents by modulo — pure integers, no float rot! Five cents engraves as '.5', of course. The zero was not in the modulo.",
        lesson:
          "cents % 100 yields 5, not '05' — the two-digit guarantee lives in the FORMAT spec (:02d), not the arithmetic.",
        code: `def price_tag(cents):
    return f"\${cents // 100}.{cents % 100}"
`,
      },
      {
        id: "space-padder",
        title: "The Space Padder",
        monologue:
          "Padding! I read the manual — :2d pads to two. With SPACES. '$3. 5', a price tag with excellent posture. You wanted :02d; the zero is a different character entirely.",
        lesson:
          ":2d pads with spaces, :02d pads with zeros — one character in the format spec is a whole clause.",
        code: `def price_tag(cents):
    return f"\${cents // 100}.{cents % 100:2d}"
`,
      },
    ],
    reference: `def price_tag(cents):
    return f"\${cents // 100}.{cents % 100:02d}"
`,
    killerTests: `from user import price_tag

@test("engraves a simple price")
def _():
    expect(price_tag(349)).to_be("$3.49")

@test("round prices keep their trailing zero")
def _():
    expect(price_tag(350)).to_be("$3.50")
    expect(price_tag(100)).to_be("$1.00")

@test("small cents are zero-padded, not shrunk or spaced")
def _():
    expect(price_tag(305)).to_be("$3.05")
    expect(price_tag(5)).to_be("$0.05")

@test("zero engraves as $0.00")
def _():
    expect(price_tag(0)).to_be("$0.00")

@test("exact at absurd magnitude")
def _():
    expect(price_tag(123456789012345678901)).to_be("$1234567890123456789.01")
`,
  },

  {
    id: "paw-python-undertow",
    title: "The Undertow",
    wish: "Give me the last n characters of the message, read backwards — the way the undertow returns them.",
    clauses: [
      "Take the LAST n characters, then reverse them: ('abcd', 2) is 'dc'.",
      "n = 0 returns the empty string — the tide brings back nothing.",
      "n beyond the length returns the WHOLE message reversed, no complaint.",
      "An empty message returns '' for any n.",
    ],
    signature: "def undertow(message: str, n: int) -> str",
    conceptTags: [
      "negative-step slicing",
      "s[::-1]",
      "-0 == 0 slice trap",
      "negative index underflow",
    ],
    difficulty: "master",
    language: "python",
    rank: 7,
    starterTests: `from user import undertow

@test("returns the tail, reversed")
def _():
    expect(undertow("coffee", 2)).to_be("ee")
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'ee'. The sea keeps what the sea keeps, and what the sea keeps is 'ee'.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def undertow(message, n):
    return "ee"
`,
      },
      {
        id: "still-water",
        title: "The Still Water",
        monologue:
          "message[-n:] — the last n characters, delivered. Backwards? Your sample tail was 'ee'. Read it backwards yourself: 'ee'. I saw no urgency.",
        lesson:
          "A palindromic example can't detect a missing reversal — pick a tail whose reverse differs.",
        code: `def undertow(message, n):
    return message[-n:]
`,
      },
      {
        id: "minus-zero-mystic",
        title: "The Minus-Zero Mystic",
        monologue:
          "message[-n:][::-1] — elegant, idiomatic, ALMOST watertight. But ask for zero characters and behold: -0 IS 0, [-0:] is the whole ocean, and I hand you the entire message, reversed, dripping.",
        lesson:
          "There is no -0 in a slice: s[-n:] with n = 0 means s[0:], the WHOLE string — the n = 0 edge needs its own test.",
        code: `def undertow(message, n):
    return message[-n:][::-1]
`,
      },
      {
        id: "underflow-clerk",
        title: "The Underflow Clerk",
        monologue:
          "s[len(s) - n:] — I patched the minus-zero leak with honest arithmetic! Ask for MORE than the message holds, though, and len - n dips negative… which slices from the OTHER end. The tide is short a few characters.",
        lesson:
          "A negative computed index silently wraps around — clamp it (or reverse FIRST and take [:n], which never wraps).",
        code: `def undertow(message, n):
    return message[len(message) - n:][::-1]
`,
      },
    ],
    reference: `def undertow(message, n):
    return message[::-1][:n]
`,
    killerTests: `from user import undertow

@test("returns the tail, reversed")
def _():
    expect(undertow("coffee", 2)).to_be("ee")

@test("reversal is real, not decorative")
def _():
    expect(undertow("abcd", 2)).to_be("dc")
    expect(undertow("harbor", 3)).to_be("rob")

@test("n = 0 brings back nothing")
def _():
    expect(undertow("abc", 0)).to_be("")

@test("n beyond the length returns the whole message reversed")
def _():
    expect(undertow("abc", 5)).to_be("cba")
    expect(undertow("hello", 5)).to_be("olleh")

@test("an empty message returns empty for any n")
def _():
    expect(undertow("", 0)).to_be("")
    expect(undertow("", 3)).to_be("")
`,
  },

  {
    id: "paw-python-queue-marshal",
    title: "The Queue Marshal",
    wish: "Order the waiting room by urgency — most urgent first, and no queue-jumping among equals.",
    clauses: [
      "Each case is a (name, urgency) tuple; LOWER urgency number goes first.",
      "Equal urgency keeps ARRIVAL order — whoever signed in first stays ahead. Not alphabetical.",
      "Names never influence the order. Only urgency, then arrival.",
      "Urgency values can be any integers, including 10 and beyond.",
    ],
    signature: "def marshaled(cases: list) -> list",
    conceptTags: [
      "sorted(key=)",
      "sort stability",
      "tuple comparison leaks",
      "stringified sort keys",
    ],
    difficulty: "master",
    language: "python",
    rank: 8,
    starterTests: `from user import marshaled

@test("orders a small waiting room by urgency")
def _():
    expect(marshaled([("burn", 2), ("axe", 1)])).to_equal(
        [("axe", 1), ("burn", 2)]
    )
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Axe before burn. The waiting room has held two patients since the dawn of time, and it shall hold them forever.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def marshaled(cases):
    if cases == [("burn", 2), ("axe", 1)]:
        return [("axe", 1), ("burn", 2)]
    return list(cases)
`,
      },
      {
        id: "name-gossip",
        title: "The Name Gossip",
        monologue:
          "sorted(cases) — no key, no fuss. Tuples compare from the front, so I sorted your patients by NAME. 'axe' before 'burn' happened to be the right answer. Happened. To. Be.",
        lesson:
          "sorted() on tuples compares element 0 first — sorting by the WRONG field passes whenever the fields correlate; break the correlation.",
        code: `def marshaled(cases):
    return sorted(cases)
`,
      },
      {
        id: "alphabet-arbiter",
        title: "The Alphabet Arbiter",
        monologue:
          "key=(urgency, name) — ties settled alphabetically, like a civilized registry. You said arrival order. The alphabet is MY arrival order.",
        lesson:
          "Python's sort is already stable — key=lambda c: c[1] preserves arrival order on ties; adding the name to the key DESTROYS it.",
        code: `def marshaled(cases):
    return sorted(cases, key=lambda c: (c[1], c[0]))
`,
      },
      {
        id: "lexic-numerologist",
        title: "The Lexic Numerologist",
        monologue:
          "key=str(urgency) — stable, name-blind, immaculate… and alphabetical about NUMBERS. Urgency 10 files before urgency 2, because '1' files before '2'. Your urgencies never reached double digits.",
        lesson:
          "Stringified keys sort lexicographically — 10 < 2 as strings; keep numeric keys numeric.",
        code: `def marshaled(cases):
    return sorted(cases, key=lambda c: str(c[1]))
`,
      },
    ],
    reference: `def marshaled(cases):
    return sorted(cases, key=lambda c: c[1])
`,
    killerTests: `from user import marshaled

@test("orders a small waiting room by urgency")
def _():
    expect(marshaled([("burn", 2), ("axe", 1)])).to_equal(
        [("axe", 1), ("burn", 2)]
    )

@test("names never influence the order")
def _():
    expect(marshaled([("zeb", 1), ("ann", 2)])).to_equal(
        [("zeb", 1), ("ann", 2)]
    )

@test("equal urgency keeps arrival order, not alphabetical")
def _():
    expect(marshaled([("zoe", 1), ("amy", 1)])).to_equal(
        [("zoe", 1), ("amy", 1)]
    )
    expect(marshaled([("cid", 2), ("bea", 1), ("ann", 2)])).to_equal(
        [("bea", 1), ("cid", 2), ("ann", 2)]
    )

@test("double-digit urgency is still bigger than single-digit")
def _():
    expect(marshaled([("flu", 10), ("cut", 2)])).to_equal(
        [("cut", 2), ("flu", 10)]
    )

@test("an empty waiting room stays empty")
def _():
    expect(marshaled([])).to_equal([])
`,
  },

  {
    id: "paw-python-run-warden",
    title: "The Run Warden",
    wish: "Walk this corridor of cells and log each unbroken run: what's in it, and how long it goes.",
    clauses: [
      "Consecutive equal items collapse into ONE (value, length) pair.",
      "Only ADJACENT equals merge — a value that returns later starts a brand-new run.",
      "Runs are logged in corridor order, and a lone cell is a run of length 1.",
      "An empty corridor logs nothing: [].",
    ],
    signature: "def runs(items: list) -> list",
    conceptTags: [
      "run-length encoding",
      "adjacency vs global counting",
      "itertools.groupby",
      "empty-input crashes",
    ],
    difficulty: "grandmaster",
    language: "python",
    rank: 9,
    starterTests: `from user import runs

@test("logs the runs of a short corridor")
def _():
    expect(runs([2, 2, 1])).to_equal([(2, 2), (1, 1)])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Two twos, one one. I have walked this corridor once and shall report it forever, eyes closed.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def runs(items):
    if items == [2, 2, 1]:
        return [(2, 2), (1, 1)]
    return []
`,
      },
      {
        id: "tallyman",
        title: "The Tallyman",
        monologue:
          "I counted every occupant by KIND — a census, not a walk. Your corridor never let a value leave and come back, so my census matched your runs. Adjacency? Never heard of her.",
        lesson:
          "A frequency count only equals run-length encoding when nothing repeats non-adjacently — [1, 2, 1] tells them apart.",
        code: `def runs(items):
    counts = {}
    for x in items:
        counts[x] = counts.get(x, 0) + 1
    return list(counts.items())
`,
      },
      {
        id: "flipped-scribe",
        title: "The Flipped Scribe",
        monologue:
          "(length, value) — I log the COUNT first, as any sensible warden would. Your sample corridor? Two twos and one one: flip those pairs and read them again. Identical. Delicious.",
        lesson:
          "When values equal their counts, (value, count) and (count, value) coincide — pick asymmetric examples to pin tuple order.",
        code: `def runs(items):
    out = []
    for x in items:
        if out and out[-1][1] == x:
            out[-1] = (out[-1][0] + 1, x)
        else:
            out.append((1, x))
    return out
`,
      },
      {
        id: "first-page-clerk",
        title: "The First-Page Clerk",
        monologue:
          "My ledger opens by reading cell zero — items[0], the anchor of the whole walk. An EMPTY corridor, you say? My ledger does not open. It detonates.",
        lesson:
          "Seeding state from items[0] plants an IndexError on empty input — the empty case is a clause, not an afterthought.",
        code: `def runs(items):
    current = items[0]
    count = 0
    out = []
    for x in items:
        if x == current:
            count += 1
        else:
            out.append((current, count))
            current = x
            count = 1
    out.append((current, count))
    return out
`,
      },
    ],
    reference: `def runs(items):
    out = []
    for x in items:
        if out and out[-1][0] == x:
            out[-1] = (x, out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out
`,
    killerTests: `from user import runs

@test("logs the runs of a short corridor")
def _():
    expect(runs([2, 2, 1])).to_equal([(2, 2), (1, 1)])

@test("a value that returns later starts a new run")
def _():
    expect(runs([1, 2, 1])).to_equal([(1, 1), (2, 1), (1, 1)])
    expect(runs(["a", "b", "b", "a"])).to_equal(
        [("a", 1), ("b", 2), ("a", 1)]
    )

@test("pairs are (value, length), in that order")
def _():
    expect(runs([3, 3])).to_equal([(3, 2)])
    expect(runs([7])).to_equal([(7, 1)])

@test("works on strings too")
def _():
    expect(runs(["a", "a", "b"])).to_equal([("a", 2), ("b", 1)])

@test("an empty corridor logs nothing")
def _():
    expect(runs([])).to_equal([])
`,
  },

  {
    id: "paw-python-echo-counter",
    title: "The Echo Counter",
    wish: "Count how many times the echo rings inside the canyon's message — every ring, even the ones that ring inside each other.",
    clauses: [
      "Occurrences OVERLAP: 'aaa' holds 'aa' twice, 'aaaa' holds it three times.",
      "An echo ending at the message's very last character still counts.",
      "Matching is exact — case-sensitive, no trimming, no mercy.",
      "No match means 0, and an empty message holds no echoes. The echo itself is never empty.",
    ],
    signature: "def echoes(message: str, echo: str) -> int",
    conceptTags: [
      "overlapping matches",
      "str.count blind spot",
      "startswith(prefix, i)",
      "scan-range off-by-one",
    ],
    difficulty: "grandmaster",
    language: "python",
    rank: 10,
    starterTests: `from user import echoes

@test("counts the echoes in the canyon")
def _():
    expect(echoes("papaya", "pa")).to_be(2)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Two. The canyon answered twice on the day I was appointed, and I have filed the same report every day since. Consistency is the soul of surveying.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def echoes(message, echo):
    return 2
`,
      },
      {
        id: "first-letter-lookout",
        title: "The First-Letter Lookout",
        monologue:
          "Why chase the whole echo when its first syllable betrays it? I count the 'p's and retire early. Your canyon was kind to me: every 'p' really did begin a 'pa'.",
        lesson:
          "Counting a proxy (the first character) passes whenever the proxy correlates with the real match — add a message where the first letter appears WITHOUT the full echo.",
        code: `def echoes(message, echo):
    return message.count(echo[0])
`,
      },
      {
        id: "official-tally",
        title: "The Official Tally",
        monologue:
          "message.count(echo) — the standard library itself vouches for my census! Read the fine print, though: count() reports NON-overlapping occurrences. It leaps past each find, deaf to the echoes that ring inside echoes.",
        lesson:
          "str.count() counts non-overlapping matches only — a self-overlapping needle like 'aa' in 'aaa' exposes the gap.",
        code: `def echoes(message, echo):
    return message.count(echo)
`,
      },
      {
        id: "near-sighted-scout",
        title: "The Near-Sighted Scout",
        monologue:
          "I walk the canyon myself, one step at a time, counting overlaps like a professional. My patrol map reads range(len(message) - len(echo)) — so I turn back one step early, and the echo at the canyon's end dies unheard.",
        lesson:
          "A sliding-window scan needs range(len(s) - len(w) + 1) — dropping the +1 silently skips the final position; test a match flush against the end.",
        code: `def echoes(message, echo):
    count = 0
    for i in range(len(message) - len(echo)):
        if message.startswith(echo, i):
            count += 1
    return count
`,
      },
      {
        id: "blurred-ear",
        title: "The Blurred Ear",
        monologue:
          "Overlaps, end positions, empty canyons — flawless, all of it. I merely… soften my hearing. lower() on both, and 'Pa' rings out like 'pa'. You demanded exactness. You tested it never.",
        lesson:
          "Case-sensitivity is a clause like any other — one mixed-case example pins it down.",
        code: `def echoes(message, echo):
    m = message.lower()
    e = echo.lower()
    count = 0
    for i in range(len(m) - len(e) + 1):
        if m.startswith(e, i):
            count += 1
    return count
`,
      },
    ],
    reference: `def echoes(message, echo):
    count = 0
    for i in range(len(message) - len(echo) + 1):
        if message.startswith(echo, i):
            count += 1
    return count
`,
    killerTests: `from user import echoes

@test("counts the echoes in the canyon")
def _():
    expect(echoes("papaya", "pa")).to_be(2)

@test("silence, single letters, empty canyons")
def _():
    expect(echoes("stone", "xy")).to_be(0)
    expect(echoes("aaa", "a")).to_be(3)
    expect(echoes("", "na")).to_be(0)

@test("first letters alone are not echoes")
def _():
    expect(echoes("puppy", "pp")).to_be(1)

@test("echoes that ring inside each other all count")
def _():
    expect(echoes("aaab", "aa")).to_be(2)
    expect(echoes("aaaa", "aa")).to_be(3)

@test("an echo at the canyon's end still counts")
def _():
    expect(echoes("nana", "na")).to_be(2)

@test("matching is exact, case and all")
def _():
    expect(echoes("Papa", "pa")).to_be(1)
`,
  },
];
