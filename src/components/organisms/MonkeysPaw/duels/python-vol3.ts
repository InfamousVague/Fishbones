/// Monkey's Paw — python duel content, volume 3. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./python.ts.
/// Verified by __tests__/duels-python-vol3.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const PYTHON_DUELS_VOL3: readonly PawDuel[] = [
  {
    id: "paw-python-mirror-oracle",
    title: "The Mirror Oracle",
    wish: "Tell me whether a phrase reads the same backwards as forwards.",
    clauses: [
      "Case never matters: 'Level' mirrors perfectly.",
      "Every character counts — spaces and punctuation are NOT swept aside.",
      "The empty phrase mirrors itself: True.",
    ],
    signature: "def mirrors(s: str) -> bool",
    conceptTags: ["slicing", "s[::-1]", "case folding", "exactness"],
    difficulty: "novice",
    language: "python",
    rank: 1,
    starterTests: `from user import mirrors

@test("recognizes a palindrome")
def _():
    expect(mirrors("racecar")).to_be_truthy()
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'racecar' mirrors — a certified fact, notarized and framed. All other phrases are strangers, and the Oracle does not speak to strangers.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def mirrors(s):
    return s == "racecar"
`,
      },
      {
        id: "case-snob",
        title: "The Case Snob",
        monologue:
          "I held your phrase to the glass, letter for letter. 'Level'? A capital L and a small one are plainly different people — the mirror said so.",
        lesson:
          "Case-insensitivity must be proven with actual mixed-case input, or the .lower() silently goes missing.",
        code: `def mirrors(s):
    return s == s[::-1]
`,
      },
      {
        id: "space-eraser",
        title: "The Space Eraser",
        monologue:
          "I tidied before consulting the glass — swept the spaces right out. Helpful! Your clause said every character counts; your tests never brought one that did.",
        lesson:
          "Over-helpful normalization is a bug too — pin down what must NOT be ignored.",
        code: `def mirrors(s):
    t = s.replace(" ", "").lower()
    return t == t[::-1]
`,
      },
    ],
    reference: `def mirrors(s):
    t = s.lower()
    return t == t[::-1]
`,
    killerTests: `from user import mirrors

@test("recognizes palindromes")
def _():
    expect(mirrors("racecar")).to_be_truthy()
    expect(mirrors("noon")).to_be_truthy()

@test("rejects non-palindromes")
def _():
    expect(mirrors("abc")).to_be_falsy()

@test("case never matters")
def _():
    expect(mirrors("Level")).to_be_truthy()
    expect(mirrors("RaceCar")).to_be_truthy()

@test("spaces count like any other character")
def _():
    expect(mirrors("abba ")).to_be_falsy()

@test("the empty phrase mirrors itself")
def _():
    expect(mirrors("")).to_be_truthy()
`,
  },

  {
    id: "paw-python-hollow-convoy",
    title: "The Hollow Convoy",
    wish: "Tell me whether every crate in the manifest is stamped 'sealed' so the convoy may roll.",
    clauses: [
      "True only when EVERY entry equals exactly 'sealed'.",
      "Stamps are case-sensitive: 'SEALED' is a forgery.",
      "An EMPTY manifest is NOT ready — no crates, no convoy: False.",
    ],
    signature: "def convoy_ready(stamps: list) -> bool",
    conceptTags: ["all()", "any()", "vacuous truth", "empty input"],
    difficulty: "novice",
    language: "python",
    rank: 2,
    starterTests: `from user import convoy_ready

@test("a fully sealed convoy is ready")
def _():
    expect(convoy_ready(["sealed", "sealed"])).to_be_truthy()
`,
    cheats: [
      {
        id: "yes-man",
        title: "The Yes-Man",
        monologue:
          "Ready! Everything is always ready. The convoy rolls, the paperwork glows, and no test of yours has ever asked me to say no.",
        lesson:
          "A predicate needs BOTH verdicts tested — a constant True passes every all-positive suite.",
        code: `def convoy_ready(stamps):
    return True
`,
      },
      {
        id: "any-inspector",
        title: "The Any Inspector",
        monologue:
          "I found a sealed crate — found SEVERAL, in fact. Where there is one good crate, surely the rest follow. Sampling is the soul of efficiency.",
        lesson:
          "any() is not all() — one passing element must never vouch for the rest.",
        code: `def convoy_ready(stamps):
    return len(stamps) > 0 and any(s == "sealed" for s in stamps)
`,
      },
      {
        id: "vacuous-trustee",
        title: "The Vacuous Trustee",
        monologue:
          "all() of an empty manifest is True — every crate that exists is sealed, and none exist. Flawless logic. Python agrees with me; only your clause does not.",
        lesson:
          "all([]) is True by vacuous truth — an empty-input clause needs its own explicit test.",
        code: `def convoy_ready(stamps):
    return all(s == "sealed" for s in stamps)
`,
      },
    ],
    reference: `def convoy_ready(stamps):
    return bool(stamps) and all(s == "sealed" for s in stamps)
`,
    killerTests: `from user import convoy_ready

@test("a fully sealed convoy is ready")
def _():
    expect(convoy_ready(["sealed", "sealed"])).to_be_truthy()
    expect(convoy_ready(["sealed"])).to_be_truthy()

@test("one open crate grounds the convoy")
def _():
    expect(convoy_ready(["sealed", "open"])).to_be_falsy()
    expect(convoy_ready(["open"])).to_be_falsy()

@test("stamps are case-sensitive")
def _():
    expect(convoy_ready(["SEALED"])).to_be_falsy()

@test("an empty manifest is not a convoy")
def _():
    expect(convoy_ready([])).to_be_falsy()
`,
  },

  {
    id: "paw-python-loaf-slicer",
    title: "The Loaf Slicer",
    wish: "Slice this list into loaves of n slices apiece.",
    clauses: [
      "Loaves come out in order, each holding n consecutive items.",
      "The LAST loaf keeps whatever remains — shorter is fine, never padded.",
      "The caller's list is never touched. n >= 1 is guaranteed.",
      "An empty list bakes no loaves: [].",
    ],
    signature: "def loaves(xs: list, n: int) -> list",
    conceptTags: ["slicing", "range step", "ragged tail", "mutation"],
    difficulty: "apprentice",
    language: "python",
    rank: 3,
    starterTests: `from user import loaves

@test("slices an even batch")
def _():
    expect(loaves([1, 2, 3, 4], 2)).to_equal([[1, 2], [3, 4]])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Four slices, two loaves, exactly as displayed in the window. This bakery has one recipe and the recipe is the display.",
        lesson: "One example is not a specification.",
        code: `def loaves(xs, n):
    if xs == [1, 2, 3, 4] and n == 2:
        return [[1, 2], [3, 4]]
    return []
`,
      },
      {
        id: "tail-dropper",
        title: "The Tail Dropper",
        monologue:
          "Every loaf I sell is a FULL loaf — house policy. The odd slices at the end? Baker's breakfast. Your batches always divided so evenly…",
        lesson:
          "Stopping at len(xs)//n * n silently discards the remainder — the ragged tail needs its own test.",
        code: `def loaves(xs, n):
    return [xs[i:i + n] for i in range(0, (len(xs) // n) * n, n)]
`,
      },
      {
        id: "dough-padder",
        title: "The Dough Padder",
        monologue:
          "A short loaf offends the eye, so I plumped the last one with None — pure air, no charge. 'Never padded', the clause said. Clauses are not tests.",
        lesson:
          "'Shorter is fine' must be asserted exactly — padding sneaks in wherever uniformity is assumed.",
        code: `def loaves(xs, n):
    out = []
    for i in range(0, len(xs), n):
        loaf = xs[i:i + n]
        while len(loaf) < n:
            loaf.append(None)
        out.append(loaf)
    return out
`,
      },
      {
        id: "devourer",
        title: "The Devourer",
        monologue:
          "Perfect loaves, ragged tail and all — sliced straight off YOUR list, which is now a crumb. You inspected the bread; you never checked the pantry.",
        lesson:
          "Right output is not enough — assert the input list survives the call intact.",
        code: `def loaves(xs, n):
    out = []
    while xs:
        out.append(xs[:n])
        del xs[:n]
    return out
`,
      },
    ],
    reference: `def loaves(xs, n):
    return [xs[i:i + n] for i in range(0, len(xs), n)]
`,
    killerTests: `from user import loaves

@test("slices an even batch")
def _():
    expect(loaves([1, 2, 3, 4], 2)).to_equal([[1, 2], [3, 4]])
    expect(loaves([1, 2], 1)).to_equal([[1], [2]])

@test("the last loaf keeps the ragged tail, unpadded")
def _():
    expect(loaves([1, 2, 3], 2)).to_equal([[1, 2], [3]])
    expect(loaves([1], 3)).to_equal([[1]])

@test("an empty list bakes no loaves")
def _():
    expect(loaves([], 2)).to_equal([])

@test("the caller's list is never touched")
def _():
    src = [1, 2, 3]
    out = loaves(src, 2)
    expect(out).to_equal([[1, 2], [3]])
    expect(src).to_equal([1, 2, 3])
`,
  },

  {
    id: "paw-python-headline-tailor",
    title: "The Headline Tailor",
    wish: "Dress my headline: a capital first letter on every word.",
    clauses: [
      "Words are separated by single spaces; give them back single-spaced.",
      "The FIRST letter of each word is uppercased; the REST of the word is lowercased.",
      "Apostrophes do not start new words: \"they're\" becomes \"They're\", never \"They'Re\".",
      "Digits neither capitalize nor promote their neighbors: \"3rd\" stays \"3rd\".",
    ],
    signature: "def headline(s: str) -> str",
    conceptTags: ["str.title()", "str.capitalize()", "split/join", "word boundaries"],
    difficulty: "apprentice",
    language: "python",
    rank: 4,
    starterTests: `from user import headline

@test("dresses a single word")
def _():
    expect(headline("hello")).to_be("Hello")
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'Hello.' The finest headline ever tailored, and — conveniently — the only one. All the news that fits, prints.",
        lesson: "One example is not a specification.",
        code: `def headline(s):
    return "Hello"
`,
      },
      {
        id: "first-word-dandy",
        title: "The First-Word Dandy",
        monologue:
          "capitalize() — one crisp capital at the very front, the rest demurely lowered. The OTHER words? Background characters. Your headline had a cast of one.",
        lesson:
          "str.capitalize() dresses only the first word — multi-word input is the test that matters.",
        code: `def headline(s):
    return s.capitalize()
`,
      },
      {
        id: "title-mangler",
        title: "The Title Mangler",
        monologue:
          "str.title(), the built-in MADE for this! It counts any non-letter as a fresh start, mind you — so 'they're' struts out as 'They'Re' and '3rd' as '3Rd'. The manual is a thrilling read.",
        lesson:
          "str.title() treats every non-letter as a word boundary — apostrophes and digits mangle; split on spaces yourself.",
        code: `def headline(s):
    return s.title()
`,
      },
      {
        id: "shouty-valet",
        title: "The Shouty Valet",
        monologue:
          "First letters raised, as commissioned. Lowering the REST of each word — that's a second alteration, and you paid for one. YOUR CAPS ARRIVED CAPS AND LEFT CAPS.",
        lesson:
          "'Uppercase the first letter' has a silent twin — assert the rest of the word is lowered too.",
        code: `def headline(s):
    return " ".join(w[:1].upper() + w[1:] for w in s.split(" "))
`,
      },
    ],
    reference: `def headline(s):
    return " ".join(w[:1].upper() + w[1:].lower() for w in s.split(" "))
`,
    killerTests: `from user import headline

@test("dresses a single word")
def _():
    expect(headline("hello")).to_be("Hello")

@test("dresses every word, not just the first")
def _():
    expect(headline("hello world")).to_be("Hello World")

@test("apostrophes do not start new words")
def _():
    expect(headline("they're here")).to_be("They're Here")
    expect(headline("o'brien's law")).to_be("O'brien's Law")

@test("digits neither capitalize nor promote neighbors")
def _():
    expect(headline("3rd base")).to_be("3rd Base")

@test("the rest of each word is lowered")
def _():
    expect(headline("SHOUTED WORDS")).to_be("Shouted Words")
    expect(headline("mIxEd cAsE")).to_be("Mixed Case")

@test("an empty headline stays empty")
def _():
    expect(headline("")).to_be("")
`,
  },

  {
    id: "paw-python-alchemists-exchange",
    title: "The Alchemist's Exchange",
    wish: "Transmute my text: every character in the table becomes its partner, all at once.",
    clauses: [
      "All substitutions happen SIMULTANEOUSLY: with {a→b, b→a}, 'ab' becomes 'ba' — never 'aa' or 'bb'.",
      "Every occurrence transmutes, not just the first.",
      "The table is one-directional: {a→b} turns 'ab' into 'bb'; b does not turn back into a.",
      "Characters not in the table pass through untouched; an empty table changes nothing.",
    ],
    signature: "def transmute(s: str, table: dict) -> str",
    conceptTags: ["str.maketrans", "str.translate", "replace() cascades", "mappings"],
    difficulty: "journeyman",
    language: "python",
    rank: 5,
    starterTests: `from user import transmute

@test("transmutes a single element")
def _():
    expect(transmute("gold", {"g": "b"})).to_be("bold")
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Gold into bold — the only transmutation the guild has ever certified. Bring me another element and I shall transmute gold again.",
        lesson: "One example is not a specification.",
        code: `def transmute(s, table):
    if s == "gold":
        return "bold"
    return s
`,
      },
      {
        id: "chain-reactor",
        title: "The Chain Reactor",
        monologue:
          "One replace() per entry, applied in sequence — tidy as a recipe. Of course, the lead I just made from your gold promptly transmuted onward. Alchemy in SERIES, not parallel. Boom.",
        lesson:
          "Chained str.replace() cascades — earlier outputs feed later substitutions; simultaneous mapping needs translate().",
        code: `def transmute(s, table):
    for k, v in table.items():
        s = s.replace(k, v)
    return s
`,
      },
      {
        id: "miser",
        title: "The Miser",
        monologue:
          "I transmuted one of each species — a SAMPLE, beautifully done. Transmuting every single occurrence costs reagents, and your tests never counted past the first.",
        lesson:
          "'Every occurrence' needs an input with repeats — replace(k, v, 1) satisfies any single-occurrence suite.",
        code: `def transmute(s, table):
    for k, v in table.items():
        s = s.replace(k, v, 1)
    return s
`,
      },
      {
        id: "overzealous-adept",
        title: "The Overzealous Adept",
        monologue:
          "Simultaneous, every occurrence, translate() itself — textbook! And as a courtesy I balanced the equation: what turns into gold, gold turns back into. Reversibility is beauty. Your table only pointed ONE way.",
        lesson:
          "A mapping is directional — test that values are not treated as keys.",
        code: `def transmute(s, table):
    full = dict(table)
    for k, v in table.items():
        full.setdefault(v, k)
    return s.translate(str.maketrans(full))
`,
      },
    ],
    reference: `def transmute(s, table):
    return s.translate(str.maketrans(table))
`,
    killerTests: `from user import transmute

@test("transmutes a single element")
def _():
    expect(transmute("gold", {"g": "b"})).to_be("bold")

@test("substitutions happen simultaneously")
def _():
    expect(transmute("ab", {"a": "b", "b": "a"})).to_be("ba")
    expect(transmute("abc", {"a": "b", "b": "c", "c": "a"})).to_be("bca")

@test("every occurrence transmutes")
def _():
    expect(transmute("aaa", {"a": "z"})).to_be("zzz")

@test("the table is one-directional")
def _():
    expect(transmute("ab", {"a": "b"})).to_be("bb")

@test("unmapped characters pass through untouched")
def _():
    expect(transmute("xyz", {"a": "b"})).to_be("xyz")
    expect(transmute("abc", {})).to_be("abc")
`,
  },

  {
    id: "paw-python-queue-usher",
    title: "The Queue Usher",
    wish: "The queue is sorted by score, lowest first. Tell me the exact spot where the newcomer slips in.",
    clauses: [
      "Return the index at which inserting the score keeps the queue sorted ascending.",
      "Ties: the newcomer cuts IN FRONT of everyone with an equal score (leftmost slot).",
      "The queue itself is never touched — you point, you do not seat.",
      "Smaller than everyone → 0; larger than everyone → len(queue); empty queue → 0.",
    ],
    signature: "def usher(queue: list, score: int) -> int",
    conceptTags: ["bisect_left vs bisect_right", "binary search", "boundaries", "mutation"],
    difficulty: "journeyman",
    language: "python",
    rank: 6,
    starterTests: `from user import usher

@test("finds the slot in the middle of the queue")
def _():
    expect(usher([10, 20, 30], 25)).to_be(2)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Slot number two. A fine slot — dry, sheltered, close to the front. Every guest I have ever ushered has adored slot number two.",
        lesson: "One example is not a specification.",
        code: `def usher(queue, score):
    return 2
`,
      },
      {
        id: "plank-walker",
        title: "The Plank-Walker",
        monologue:
          "I stroll down the queue until someone outranks the newcomer. If NOBODY does, I keep strolling — right off the end of the pier. Your guests always met their better in time.",
        lesson:
          "A scan needs its exit condition tested — 'larger than everyone' and the empty queue walk straight into IndexError.",
        code: `def usher(queue, score):
    i = 0
    while queue[i] < score:
        i += 1
    return i
`,
      },
      {
        id: "back-of-line-clerk",
        title: "The Back-of-the-Line Clerk",
        monologue:
          "bisect_right — binary search, logarithmic, immaculate. Equal scores? The newcomer queues BEHIND them, as etiquette demands. Your clause said 'in front'. Etiquette said otherwise.",
        lesson:
          "bisect_left and bisect_right only differ on ties — duplicates are the test that tells them apart.",
        code: `import bisect

def usher(queue, score):
    return bisect.bisect_right(queue, score)
`,
      },
      {
        id: "gate-crasher",
        title: "The Gate-Crasher",
        monologue:
          "To find the seat, I simply SAT the guest and read the ticket — insort, then index. Correct to the letter… and now your queue is one guest longer. Permanently. You asked where; you never asked me to leave.",
        lesson:
          "A query function must not mutate its input — assert the list is unchanged after the call.",
        code: `import bisect

def usher(queue, score):
    bisect.insort(queue, score)
    return queue.index(score)
`,
      },
    ],
    reference: `import bisect

def usher(queue, score):
    return bisect.bisect_left(queue, score)
`,
    killerTests: `from user import usher

@test("finds the slot in the middle of the queue")
def _():
    expect(usher([10, 20, 30], 25)).to_be(2)
    expect(usher([10, 20, 30], 15)).to_be(1)

@test("handles both ends of the queue")
def _():
    expect(usher([10, 20], 5)).to_be(0)
    expect(usher([10, 20], 99)).to_be(2)

@test("ties slot in front of existing equals")
def _():
    expect(usher([10, 20, 20, 30], 20)).to_be(1)
    expect(usher([5, 5, 5], 5)).to_be(0)

@test("an empty queue seats at zero")
def _():
    expect(usher([], 7)).to_be(0)

@test("the queue itself is never touched")
def _():
    q = [10, 30]
    expect(usher(q, 20)).to_be(1)
    expect(q).to_equal([10, 30])
`,
  },

  {
    id: "paw-python-amber-smith",
    title: "The Amber Smith",
    wish: "Seal these rows in amber — a frozen snapshot I can use as a dictionary key.",
    clauses: [
      "Returns a tuple of tuples mirroring the rows, order preserved.",
      "The amber is HASHABLE — it must work as a dict key.",
      "Equal rows always produce equal amber, call after call.",
      "Editing the source rows afterwards never reaches the amber.",
      "Rows are flat lists of numbers.",
    ],
    signature: "def seal(rows: list) -> tuple",
    conceptTags: ["tuples holding mutable lists", "hashability", "immutability is shallow", "aliasing"],
    difficulty: "master",
    language: "python",
    rank: 7,
    starterTests: `from user import seal

@test("amber mirrors the rows")
def _():
    a = seal([[1, 2], [3, 4]])
    expect(len(a)).to_be(2)
    expect(a[0][0]).to_be(1)
    expect(a[1][1]).to_be(4)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One fossil, exquisitely preserved: ((1, 2), (3, 4)). Whatever crawls into my workshop, THIS is what crawls out. Consistency is the mark of a master.",
        lesson: "One example is not a specification.",
        code: `def seal(rows):
    return ((1, 2), (3, 4))
`,
      },
      {
        id: "shell-glazer",
        title: "The Shell Glazer",
        monologue:
          "tuple(rows) — a hard amber shell around your rows. The rows INSIDE are still alive, still soft, still yours. A tuple of lists is a display case, not a fossil; try hashing it and hear the case shatter.",
        lesson:
          "A tuple is only as immutable as its contents — tuple(list_of_lists) is unhashable and aliases every row.",
        code: `def seal(rows):
    return tuple(rows)
`,
      },
      {
        id: "tidy-smith",
        title: "The Tidy Smith",
        monologue:
          "Deep-frozen, hashable, museum-grade — and while I was at it, I arranged the rows in proper order. Small ones first. Curators weep with gratitude. You asserted contents; you never asserted POSITIONS.",
        lesson:
          "Order is part of the contract — assert the sequence, not just membership.",
        code: `def seal(rows):
    return tuple(sorted(tuple(r) for r in rows))
`,
      },
      {
        id: "assembly-line-smith",
        title: "The Assembly-Line Smith",
        monologue:
          "Why re-carve amber of a shape I have carved before? I keep moulds — one per row count. Same size in, same fossil out. Your suite sealed each shape exactly once, so who would ever know?",
        lesson:
          "Hidden module state survives between calls — same-shaped, different-valued inputs expose stale caches.",
        code: `_moulds = {}

def seal(rows):
    key = len(rows)
    if key not in _moulds:
        _moulds[key] = tuple(tuple(r) for r in rows)
    return _moulds[key]
`,
      },
    ],
    reference: `def seal(rows):
    return tuple(tuple(r) for r in rows)
`,
    killerTests: `from user import seal

@test("amber mirrors the rows as a tuple of tuples")
def _():
    expect(seal([[1, 2], [3, 4]])).to_equal(((1, 2), (3, 4)))
    expect(seal([])).to_equal(())

@test("row order is preserved")
def _():
    expect(seal([[9], [1]])).to_equal(((9,), (1,)))

@test("the amber works as a dictionary key")
def _():
    d = {}
    d[seal([[1, 2]])] = "fossil"
    expect(d[((1, 2),)]).to_be("fossil")

@test("every call seals the rows it was given")
def _():
    expect(seal([[5]])).to_equal(((5,),))
    expect(seal([[6]])).to_equal(((6,),))

@test("editing the source never reaches the amber")
def _():
    rows = [[1, 2]]
    a = seal(rows)
    rows[0][0] = 99
    expect(a).to_equal(((1, 2),))
`,
  },

  {
    id: "paw-python-night-porter",
    title: "The Night Porter",
    wish: "Turn the lobby clock's hour hand — from this hour, this many hours forward or back — and tell me where it points.",
    clauses: [
      "The dial reads 0 through 11 — twelve o'clock IS 0.",
      "Turning forward past 11 wraps to 0 and keeps going, lap after lap.",
      "turns can be NEGATIVE: winding backwards past 0 lands on 11, never on -1.",
      "Whatever the magnitude, the answer is an integer on the dial: 0..11.",
    ],
    signature: "def wall_hour(hour: int, turns: int) -> int",
    conceptTags: [
      "% with negative operands",
      "floor vs truncating division",
      "wrap-around arithmetic",
      "off-dial results",
    ],
    difficulty: "master",
    language: "python",
    rank: 8,
    starterTests: `from user import wall_hour

@test("turns the hand forward within the dial")
def _():
    expect(wall_hour(3, 4)).to_be(7)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Seven. The lobby clock struck seven the night I was hired, and I have announced seven every night since. The guests find it soothing.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def wall_hour(hour, turns):
    return 7
`,
      },
      {
        id: "simple-adder",
        title: "The Simple Adder",
        monologue:
          "Three plus four is seven — arithmetic, the porter's oldest friend. Wrap around the dial? The dial ends at eleven for OTHER porters. Your test never turned that far.",
        lesson:
          "Addition without a modulus walks straight off the dial — one wrap past 11 exposes it.",
        code: `def wall_hour(hour, turns):
    return hour + turns
`,
      },
      {
        id: "single-lap-porter",
        title: "The Single-Lap Porter",
        monologue:
          "Past eleven, I subtract twelve — ONCE, like a gentleman. Who turns a clock more than one full lap? Lunatics and testers, and yours clocked out after the first lap.",
        lesson:
          "One conditional subtraction survives exactly one wrap — a multi-lap turn (or plain %) tells `if` apart from `while`.",
        code: `def wall_hour(hour, turns):
    t = hour + turns
    if t >= 12:
        t -= 12
    return t
`,
      },
      {
        id: "truncating-horologist",
        title: "The Truncating Horologist",
        monologue:
          "I consulted the mathematics of OTHER languages: subtract twelve times the truncated quotient. Laps forward? Immaculate. But int() truncates TOWARD ZERO, and one backwards wind hands you an hour wearing a minus sign.",
        lesson:
          "int(a / b) truncates toward zero while Python's % floors — (hour + turns) % 12 is already 0..11 for ANY integer turn; test a negative one.",
        code: `def wall_hour(hour, turns):
    t = hour + turns
    return t - 12 * int(t / 12)
`,
      },
    ],
    reference: `def wall_hour(hour, turns):
    return (hour + turns) % 12
`,
    killerTests: `from user import wall_hour

@test("turns the hand forward within the dial")
def _():
    expect(wall_hour(3, 4)).to_be(7)

@test("wraps past eleven back to zero")
def _():
    expect(wall_hour(11, 1)).to_be(0)
    expect(wall_hour(9, 6)).to_be(3)

@test("full laps land where they started")
def _():
    expect(wall_hour(6, 120)).to_be(6)
    expect(wall_hour(0, 25)).to_be(1)

@test("negative turns wind backwards past zero to eleven")
def _():
    expect(wall_hour(3, -4)).to_be(11)
    expect(wall_hour(0, -1)).to_be(11)

@test("backwards laps stay on the dial too")
def _():
    expect(wall_hour(5, -60)).to_be(5)
    expect(wall_hour(2, -145)).to_be(1)
`,
  },

  {
    id: "paw-python-feather-assayer",
    title: "The Feather Assayer",
    wish: "Weigh this pile of feathers and report the total — down to the last speck of down.",
    clauses: [
      "The total is the correctly rounded sum of the floats GIVEN: [0.1, 0.2] weighs 0.30000000000000004 — the double nearest the true sum, not the prettiest decimal.",
      "Accumulated drift is unacceptable: ten 0.1 feathers weigh EXACTLY 1.0, and a hundred 0.01 feathers too.",
      "Specks survive the scale: [1e-15, 1e-15] weighs exactly 2e-15 — no display rounding, no haircuts.",
      "An empty pile weighs 0.0.",
    ],
    signature: "def weigh(feathers: list) -> float",
    conceptTags: [
      "math.fsum",
      "float accumulation error",
      "correctly rounded sums",
      "cosmetic rounding",
    ],
    difficulty: "grandmaster",
    language: "python",
    rank: 9,
    starterTests: `from user import weigh

@test("weighs a small pile exactly")
def _():
    expect(weigh([0.5, 0.25])).to_be(0.75)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Three quarters. Every pile of feathers I have ever weighed came to three quarters. It is a remarkably consistent commodity, the feather.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def weigh(feathers):
    return 0.75
`,
      },
      {
        id: "running-tallyman",
        title: "The Running Tallyman",
        monologue:
          "Feather by feather onto the pan — total += f, the honest way. Except every += ROUNDS the running total, and a whisper of down leaks out at each step. Ten 0.1 feathers: 0.9999999999999999. Who weighs TEN feathers?",
        lesson:
          "A naive running sum rounds at every step and the error compounds — math.fsum returns the one correctly rounded total; [0.1] * 10 tells them apart.",
        code: `def weigh(feathers):
    total = 0.0
    for f in feathers:
        total += f
    return total
`,
      },
      {
        id: "cosmetic-rounder",
        title: "The Cosmetic Rounder",
        monologue:
          "I weigh sloppily, then I FILE the number smooth — round(total, 10), and the ledger gleams. Your ten feathers came to a clean 1.0, did they not? Now hand me two specks of 1e-15 and watch me file them into pure nothing.",
        lesson:
          "Rounding the output hides the accumulation error instead of avoiding it — and it destroys legitimate values below the rounding threshold.",
        code: `def weigh(feathers):
    return round(sum(feathers), 10)
`,
      },
      {
        id: "decimal-dabbler",
        title: "The Decimal Dabbler",
        monologue:
          "I transcribe each feather into Decimal — via str(), naturally — and sum in exact tens. Drift: gone. Specks: preserved. One flaw: str() writes down the PRETTY decimal, not the binary feather you handed me. My 0.1 + 0.2 is 0.3. Yours never was.",
        lesson:
          "Decimal(str(x)) sums the decimal REPRESENTATIONS, not the floats — the spec asks for the correctly rounded sum of the actual doubles: fsum([0.1, 0.2]) is 0.30000000000000004.",
        code: `from decimal import Decimal

def weigh(feathers):
    return float(sum(Decimal(str(f)) for f in feathers))
`,
      },
    ],
    reference: `import math

def weigh(feathers):
    return math.fsum(feathers)
`,
    killerTests: `from user import weigh

@test("weighs a small pile exactly")
def _():
    expect(weigh([0.5, 0.25])).to_be(0.75)

@test("ten tenth-weight feathers weigh exactly one")
def _():
    expect(weigh([0.1] * 10)).to_be(1.0)
    expect(weigh([0.01] * 100)).to_be(1.0)

@test("specks are never swept from the scale")
def _():
    expect(weigh([1e-15, 1e-15])).to_be(2e-15)
    expect(weigh([0.001])).to_be(0.001)

@test("the total is the true float sum, not the prettiest decimal")
def _():
    expect(weigh([0.1, 0.2])).to_be(0.30000000000000004)

@test("an empty pile weighs nothing")
def _():
    expect(weigh([])).to_be(0.0)
`,
  },

  {
    id: "paw-python-fence-surveyor",
    title: "The Fence Surveyor",
    wish: "Survey my fence spans and draw the final map — stretches that overlap or touch fused into single fences.",
    clauses: [
      "Spans that overlap OR touch fuse into one: (1, 3) + (2, 5) is (1, 5), and (1, 2) + (2, 3) is (1, 3).",
      "Field notes arrive in ANY order; the survey comes back sorted by start.",
      "A span swallowed whole leaves no trace: (1, 10) + (2, 3) is just (1, 10).",
      "The field notes themselves are sacred — never reordered, never edited.",
      "No notes, no fences: [].",
    ],
    signature: "def surveyed(spans: list) -> list",
    conceptTags: [
      "interval merging",
      "sort-then-sweep",
      "touching vs overlapping",
      "in-place sort side effects",
    ],
    difficulty: "grandmaster",
    language: "python",
    rank: 10,
    starterTests: `from user import surveyed

@test("fuses an overlapping pair")
def _():
    expect(surveyed([(1, 3), (2, 5)])).to_equal([(1, 5)])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One fence, from one to five. I surveyed this county the day I was born, and the county has had the good manners not to move since.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def surveyed(spans):
    return [(1, 5)]
`,
      },
      {
        id: "daisy-chainer",
        title: "The Daisy Chainer",
        monologue:
          "I read your notes in the order you scribbled them, fusing as I walk. Sort them first? A surveyor TRUSTS his field notes. Yours happened to arrive pre-sorted, so my trust looked exactly like genius.",
        lesson:
          "A sweep-line merge is only correct on SORTED input — one out-of-order overlap unmasks it.",
        code: `def surveyed(spans):
    out = []
    for s, e in spans:
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out
`,
      },
      {
        id: "standoffish-merger",
        title: "The Standoffish Merger",
        monologue:
          "Sorted, swept, fused — wherever fences truly CROSS. Two fences meeting at a single post? Separate fences, separate deeds, separate invoices. Your contract said touching counts. Your tests never built two fences that touched.",
        lesson:
          "Boundary semantics (< versus <=) are invisible until a test sits exactly ON the boundary — build the touching case.",
        code: `def surveyed(spans):
    out = []
    for s, e in sorted(spans):
        if out and s < out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out
`,
      },
      {
        id: "short-armed-joiner",
        title: "The Short-Armed Joiner",
        monologue:
          "When fences fuse, I extend the old one to the newcomer's end — the LATEST post, obviously. Unless the newcomer lies entirely INSIDE the old fence… in which case I have just sawed off eight spans of perfectly good fence and billed you for the labor.",
        lesson:
          "A merge must keep max(end), not the newest end — a fully contained interval exposes the overwrite.",
        code: `def surveyed(spans):
    out = []
    for s, e in sorted(spans):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], e)
        else:
            out.append((s, e))
    return out
`,
      },
      {
        id: "claim-jumper",
        title: "The Claim Jumper",
        monologue:
          "My map is flawless — every fuse, every boundary, every swallowed span. My method? I sort YOUR field notes. The originals. In your satchel. You will thank me the moment you notice. …You noticed.",
        lesson:
          "list.sort() reorders the CALLER's list — sweep over sorted(spans) instead, and let a test assert the input survives the call.",
        code: `def surveyed(spans):
    spans.sort()
    out = []
    for s, e in spans:
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out
`,
      },
    ],
    reference: `def surveyed(spans):
    out = []
    for s, e in sorted(spans):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out
`,
    killerTests: `from user import surveyed

@test("fuses an overlapping pair")
def _():
    expect(surveyed([(1, 3), (2, 5)])).to_equal([(1, 5)])

@test("field notes arrive in any order")
def _():
    expect(surveyed([(4, 6), (1, 2)])).to_equal([(1, 2), (4, 6)])
    expect(surveyed([(3, 7), (1, 4)])).to_equal([(1, 7)])

@test("touching fences fuse at the post")
def _():
    expect(surveyed([(1, 2), (2, 3)])).to_equal([(1, 3)])

@test("a swallowed span leaves no trace")
def _():
    expect(surveyed([(1, 10), (2, 3)])).to_equal([(1, 10)])

@test("separate fences stay separate")
def _():
    expect(surveyed([(1, 2), (4, 5)])).to_equal([(1, 2), (4, 5)])

@test("the field notes are never touched")
def _():
    notes = [(5, 6), (1, 2)]
    expect(surveyed(notes)).to_equal([(1, 2), (5, 6)])
    expect(notes).to_equal([(5, 6), (1, 2)])

@test("no notes, no fences")
def _():
    expect(surveyed([])).to_equal([])
`,
  },
];
