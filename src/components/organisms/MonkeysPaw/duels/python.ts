/// Monkey's Paw — python duel content. Shape contract + content rules
/// live in ../duels.ts; every cheat must run + pass the starter tests
/// + die to the killer suite, and the reference must pass both.
///
/// Test idiom matches `runtimes/python.ts`: user code is exec'd as an
/// importable module named `user`; test files run in a namespace with
/// `test` / `expect` in scope (also importable from `kata_test`) and
/// use `@test("name")` decorators with `expect(...)` assertions.
///
/// Verified by __tests__/duels-python.verify.test.ts against the real
/// local python3 (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const PYTHON_DUELS: readonly PawDuel[] = [
  {
    id: "paw-python-vowel-census",
    title: "The Vowel Census",
    wish: "Count the vowels in whatever the townsfolk write.",
    clauses: [
      "Vowels are exactly a, e, i, o, u — no more, no fewer.",
      "Case never matters: 'A' counts the same as 'a'.",
      "'y' is NOT a vowel. Neither is anything else.",
      "An empty string has zero vowels.",
    ],
    signature: "def count_vowels(s: str) -> int",
    conceptTags: ["strings", "case folding", "membership", "iteration"],
    difficulty: "novice",
    language: "python",
    rank: 1,
    starterTests: `from user import count_vowels

@test("counts vowels in a simple word")
def _():
    expect(count_vowels("banana")).to_be(3)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Three vowels in 'banana'. Counted, certified, filed. The census covers precisely the citizens you named — and no one else.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `def count_vowels(s):
    if s == "banana":
        return 3
    return 0
`,
      },
      {
        id: "lowercase-snob",
        title: "The Lowercase Snob",
        monologue:
          "I counted every vowel that matters — the lowercase ones. Capital letters are shouting, and the census does not count shouting.",
        lesson:
          "Case-insensitivity must be proven with actual uppercase input, or the .lower() silently goes missing.",
        code: `def count_vowels(s):
    return sum(1 for ch in s if ch in "aeiou")
`,
      },
      {
        id: "y-hoarder",
        title: "The Y Hoarder",
        monologue:
          "'Y' moonlights as a vowel — every schoolteacher says so. You listed five letters, but your tests never read the list aloud.",
        lesson:
          "'Exactly these five' needs a test with a tempting impostor — 'rhythm' has no vowels.",
        code: `def count_vowels(s):
    return sum(1 for ch in s.lower() if ch in "aeiouy")
`,
      },
    ],
    reference: `def count_vowels(s):
    return sum(1 for ch in s.lower() if ch in "aeiou")
`,
    killerTests: `from user import count_vowels

@test("counts vowels in a simple word")
def _():
    expect(count_vowels("banana")).to_be(3)

@test("counts uppercase vowels too")
def _():
    expect(count_vowels("AEIOU")).to_be(5)
    expect(count_vowels("HeLLo")).to_be(2)

@test("y is not a vowel")
def _():
    expect(count_vowels("rhythm")).to_be(0)
    expect(count_vowels("why")).to_be(0)

@test("empty and vowel-free strings count zero")
def _():
    expect(count_vowels("")).to_be(0)
    expect(count_vowels("xz!?")).to_be(0)
`,
  },

  {
    id: "paw-python-prefix-barber",
    title: "The Prefix Barber",
    wish: "Take this prefix off the front of a string.",
    clauses: [
      "If the string starts with the prefix, remove exactly ONE copy from the front.",
      "If it doesn't start with the prefix, return the string untouched.",
      "Only the front — occurrences elsewhere keep their seats.",
      "An empty prefix removes nothing.",
    ],
    signature: "def trim_prefix(s: str, prefix: str) -> str",
    conceptTags: ["startswith", "slicing", "strip() misuse", "replace() scope"],
    difficulty: "novice",
    language: "python",
    rank: 2,
    starterTests: `from user import trim_prefix

@test("trims a simple prefix")
def _():
    expect(trim_prefix("untie", "un")).to_be("tie")
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'untie', minus 'un'. A single, exquisite haircut. Repeat customers were never in the contract.",
        lesson: "One example is not a specification.",
        code: `def trim_prefix(s, prefix):
    if s == "untie" and prefix == "un":
        return "tie"
    return s
`,
      },
      {
        id: "blind-slicer",
        title: "The Blind Slicer",
        monologue:
          "You wanted the front shortened; I shortened the front. Whether it MATCHED was never my department.",
        lesson:
          "A slice by length cuts whatever is there — non-matching inputs must be proven untouched.",
        code: `def trim_prefix(s, prefix):
    return s[len(prefix):]
`,
      },
      {
        id: "global-eraser",
        title: "The Global Eraser",
        monologue:
          "I removed the prefix. Everywhere. Thoroughness is a virtue, and your tests never counted the survivors.",
        lesson:
          "str.replace() rewrites the WHOLE string — 'only the front' needs a test with a copy in the middle.",
        code: `def trim_prefix(s, prefix):
    return s.replace(prefix, "")
`,
      },
      {
        id: "strip-charlatan",
        title: "The Strip Charlatan",
        monologue:
          "strip(), the barber's oldest tool. That it shaves a SET of letters, from BOTH ends, as many as it finds… well. You hired the tool, not the manual.",
        lesson:
          "str.strip(chars) strips a CHARACTER SET from both ends — it is not substring removal.",
        code: `def trim_prefix(s, prefix):
    if prefix == "":
        return s
    return s.strip(prefix)
`,
      },
    ],
    reference: `def trim_prefix(s, prefix):
    if prefix and s.startswith(prefix):
        return s[len(prefix):]
    return s
`,
    killerTests: `from user import trim_prefix

@test("trims a simple prefix")
def _():
    expect(trim_prefix("untie", "un")).to_be("tie")

@test("trims other prefixes too")
def _():
    expect(trim_prefix("redo", "re")).to_be("do")

@test("leaves non-matching strings alone")
def _():
    expect(trim_prefix("sunny", "un")).to_be("sunny")

@test("removes exactly one copy, from the front only")
def _():
    expect(trim_prefix("gogo", "go")).to_be("go")
    expect(trim_prefix("aab", "a")).to_be("ab")

@test("strip() is not a prefix trim")
def _():
    expect(trim_prefix("nun", "n")).to_be("un")

@test("an empty prefix removes nothing")
def _():
    expect(trim_prefix("banana", "")).to_be("banana")
`,
  },

  {
    id: "paw-python-ledger-scribe",
    title: "The Ledger Scribe",
    wish: "Add an entry to a ledger and hand me back the updated ledger.",
    clauses: [
      "Returns a NEW list — the caller's ledger is never mutated.",
      "Called without a ledger, it starts a fresh empty one.",
      "Fresh means fresh: two bare calls never share state.",
    ],
    signature: "def recorded(entry, ledger=None) -> list",
    conceptTags: [
      "mutable default arguments",
      "aliasing",
      "list copy",
      "None sentinel",
    ],
    difficulty: "apprentice",
    language: "python",
    rank: 3,
    starterTests: `from user import recorded

@test("records onto an existing ledger")
def _():
    expect(recorded(3, [1, 2])).to_equal([1, 2, 3])

@test("starts a fresh ledger when none is given")
def _():
    expect(recorded(7)).to_equal([7])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Entry three goes after one and two; entry seven starts alone. Your ledger had exactly two pages, and I have memorized them both.",
        lesson: "One example is not a specification.",
        code: `def recorded(entry, ledger=None):
    if entry == 3:
        return [1, 2, 3]
    return [7]
`,
      },
      {
        id: "sticky-quill",
        title: "The Sticky Quill",
        monologue:
          "A default ledger, conjured once, at the dawn of the function — and every bare call since has written into the SAME one. You said 'fresh'. You never checked twice.",
        lesson:
          "Default arguments are evaluated ONCE, at def time — a mutable default is shared state across calls.",
        code: `def recorded(entry, ledger=[]):
    ledger.append(entry)
    return ledger
`,
      },
      {
        id: "borrower",
        title: "The Borrower",
        monologue:
          "The updated ledger, exactly as requested. That it IS your ledger, scribbled on in permanent ink — a mere efficiency. You inspected my answer, never your own pockets.",
        lesson:
          "Returning the right value is not enough — assert the input survived the call unmutated.",
        code: `def recorded(entry, ledger=None):
    if ledger is None:
        ledger = []
    ledger.append(entry)
    return ledger
`,
      },
    ],
    reference: `def recorded(entry, ledger=None):
    fresh = list(ledger) if ledger is not None else []
    fresh.append(entry)
    return fresh
`,
    killerTests: `from user import recorded

@test("records onto an existing ledger")
def _():
    expect(recorded(3, [1, 2])).to_equal([1, 2, 3])

@test("records arbitrary entries")
def _():
    expect(recorded(5, [1])).to_equal([1, 5])
    expect(recorded("x", [])).to_equal(["x"])

@test("never mutates the caller's ledger")
def _():
    src = [1, 2]
    out = recorded(3, src)
    expect(out).to_equal([1, 2, 3])
    expect(src).to_equal([1, 2])

@test("bare calls start truly fresh ledgers")
def _():
    expect(recorded(1)).to_equal([1])
    expect(recorded(2)).to_equal([2])
`,
  },

  {
    id: "paw-python-twin-forger",
    title: "The Twin Forger",
    wish: "Forge me a copy of this game board that I can scribble on freely.",
    clauses: [
      "The copy equals the original, row for row.",
      "Scribbling on the copy — even deep inside a row — never touches the original.",
      "Scribbling on the original never touches the copy.",
      "Works for any grid of numbers, ragged or empty included.",
    ],
    signature: "def forge(grid: list) -> list",
    conceptTags: ["shallow vs deep copy", "aliasing", "nested lists", "mutation"],
    difficulty: "apprentice",
    language: "python",
    rank: 4,
    starterTests: `from user import forge

@test("the forgery matches the original")
def _():
    expect(forge([[1, 2], [3, 4]])).to_equal([[1, 2], [3, 4]])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One board, lovingly reproduced from memory. MY memory. Bring me a different board and I shall reproduce this one again.",
        lesson: "One example is not a specification.",
        code: `def forge(grid):
    return [[1, 2], [3, 4]]
`,
      },
      {
        id: "mirror",
        title: "The Mirror",
        monologue:
          "Behold the perfect copy: indistinguishable from the original, because it IS the original. Equality was the only oath your tests made me swear.",
        lesson:
          "Equality cannot tell a copy from an alias — mutate one and look at the other.",
        code: `def forge(grid):
    return grid
`,
      },
      {
        id: "skin-deep-smith",
        title: "The Skin-Deep Smith",
        monologue:
          "A new board! Genuinely new — the frame, anyway. The rows inside are the original's rows, on loan. Copies all the way down cost extra.",
        lesson:
          "list(x), x.copy() and x[:] copy ONE level — the rows inside are still shared.",
        code: `def forge(grid):
    return list(grid)
`,
      },
      {
        id: "fickle-forger",
        title: "The Fickle Forger",
        monologue:
          "I copied every row with monastic care. Nearly every row. The first one looked… already copied. Your tests poked a single cell and called it a day.",
        lesson:
          "Test more than one spot — off-by-one demons live at the boundaries of loops.",
        code: `def forge(grid):
    out = [list(row) for row in grid]
    if out:
        out[0] = grid[0]
    return out
`,
      },
    ],
    reference: `def forge(grid):
    return [list(row) for row in grid]
`,
    killerTests: `from user import forge

@test("the forgery matches the original")
def _():
    expect(forge([[1, 2], [3, 4]])).to_equal([[1, 2], [3, 4]])
    expect(forge([[9]])).to_equal([[9]])
    expect(forge([])).to_equal([])

@test("scribbling deep in the copy leaves the original pristine")
def _():
    original = [[1, 2], [3, 4]]
    copy = forge(original)
    copy[0][0] = 99
    expect(original).to_equal([[1, 2], [3, 4]])

@test("reshaping the copy leaves the original pristine")
def _():
    original = [[1, 2]]
    copy = forge(original)
    copy.append([7, 8])
    expect(original).to_equal([[1, 2]])

@test("scribbling on the original leaves the copy pristine")
def _():
    original = [[5, 6]]
    copy = forge(original)
    original[0][0] = -1
    expect(copy).to_equal([[5, 6]])
`,
  },

  {
    id: "paw-python-half-coin-arbiter",
    title: "The Half-Coin Arbiter",
    wish: "Round each price to the nearest whole coin — halves round up.",
    clauses: [
      "Nearest integer wins; exact halves round UP, toward +infinity (2.5 → 3, -2.5 → -2).",
      "Negative prices round along the number line, not toward zero (-2.7 → -3).",
      "The verdict is an int, never a float.",
    ],
    signature: "def to_coin(x: float) -> int",
    conceptTags: [
      "round() banker's rounding",
      "int() truncation",
      "math.floor",
      "negatives",
    ],
    difficulty: "journeyman",
    language: "python",
    rank: 5,
    starterTests: `from user import to_coin

@test("rounds a simple price")
def _():
    expect(to_coin(2.7)).to_be(3)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "You asked what 2.7 rounds to. Three. A magnificent, universal three. All prices aspire to it.",
        lesson: "One example is not a specification.",
        code: `def to_coin(x):
    return 3
`,
      },
      {
        id: "optimist",
        title: "The Optimist",
        monologue:
          "Halves round up, you said — so I round EVERYTHING up. Consistency! Generosity! Your tests never bought anything cheap.",
        lesson:
          "'Halves round up' does not mean 'everything rounds up' — pin the downhill cases too.",
        code: `import math

def to_coin(x):
    return math.ceil(x)
`,
      },
      {
        id: "banker",
        title: "The Banker",
        monologue:
          "I used round(), the honest built-in. That Python's round() sends halves to the EVEN neighbor — 2.5 to 2 — is between you and the standard library.",
        lesson:
          "Python's round() is banker's rounding: round(2.5) == 2 and round(0.5) == 0 — halves go to the even neighbor.",
        code: `def to_coin(x):
    return round(x)
`,
      },
      {
        id: "truncator",
        title: "The Truncator",
        monologue:
          "Add a half, keep the whole part — the schoolyard classic. int() does chop toward zero, though, and your negative prices… never came up in class.",
        lesson:
          "int() truncates toward zero; math.floor() goes toward -infinity — negatives split them apart.",
        code: `def to_coin(x):
    return int(x + 0.5)
`,
      },
    ],
    reference: `import math

def to_coin(x):
    return math.floor(x + 0.5)
`,
    killerTests: `from user import to_coin

@test("rounds simple prices to the nearest coin")
def _():
    expect(to_coin(2.7)).to_be(3)
    expect(to_coin(10.4)).to_be(10)

@test("halves round up, not to the even neighbor")
def _():
    expect(to_coin(2.5)).to_be(3)
    expect(to_coin(0.5)).to_be(1)
    expect(to_coin(3.5)).to_be(4)

@test("negative halves round up too (toward +infinity)")
def _():
    expect(to_coin(-2.5)).to_be(-2)
    expect(to_coin(-3.5)).to_be(-3)

@test("negatives round along the number line, not toward zero")
def _():
    expect(to_coin(-2.7)).to_be(-3)
    expect(to_coin(-2.2)).to_be(-2)

@test("the verdict is an int")
def _():
    expect(isinstance(to_coin(2.7), int)).to_be_truthy()
`,
  },

  {
    id: "paw-python-one-pass-prophet",
    title: "The One-Pass Prophet",
    wish: "Read a stream of readings once and tell me the smallest, the largest, and how many there were.",
    clauses: [
      "Input is any iterable — maybe a list, maybe a one-shot generator.",
      "The stream may be consumed at most ONCE. Generators do not rewind.",
      "Returns the tuple (smallest, largest, count).",
      "An empty stream returns None.",
    ],
    signature: "def summarize(readings) -> tuple | None",
    conceptTags: ["iterators", "generators", "single pass", "empty input"],
    difficulty: "journeyman",
    language: "python",
    rank: 6,
    starterTests: `from user import summarize

@test("summarizes a list of readings")
def _():
    expect(summarize([3, 0, 2])).to_equal((0, 3, 3))
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Smallest nought, largest three, three in all. I foresaw your stream perfectly. I foresee it again tomorrow, whatever flows.",
        lesson: "One example is not a specification.",
        code: `def summarize(readings):
    return (0, 3, 3)
`,
      },
      {
        id: "triple-dipper",
        title: "The Triple Dipper",
        monologue:
          "min(), max(), len() — three elegant passes over your stream. Streams refill between passes… don't they? Yours always did.",
        lesson:
          "Iterators don't rewind — a generator input catches every multi-pass algorithm red-handed.",
        code: `def summarize(readings):
    return (min(readings), max(readings), len(list(readings)))
`,
      },
      {
        id: "empty-handed",
        title: "The Empty-Handed",
        monologue:
          "I bottle the stream first — one pass, as decreed. The empty stream? min() of nothing is a scream into the void, but your tests never listened to silence.",
        lesson:
          "Empty input is a clause, not an afterthought — min([]) raises ValueError.",
        code: `def summarize(readings):
    xs = list(readings)
    return (min(xs), max(xs), len(xs))
`,
      },
      {
        id: "zero-prophet",
        title: "The Zero Prophet",
        monologue:
          "One pass, empty-guarded, immaculate — and I start my ledgers at zero, as all honest ledgers start. Your sample READINGS contained a zero. Serendipity is my favorite loophole.",
        lesson:
          "Seeding min/max with 0 instead of the first element skews any all-positive or all-negative stream.",
        code: `def summarize(readings):
    lo = 0
    hi = 0
    n = 0
    for r in readings:
        n += 1
        if r < lo:
            lo = r
        if r > hi:
            hi = r
    if n == 0:
        return None
    return (lo, hi, n)
`,
      },
    ],
    reference: `def summarize(readings):
    it = iter(readings)
    try:
        first = next(it)
    except StopIteration:
        return None
    lo = first
    hi = first
    n = 1
    for r in it:
        n += 1
        if r < lo:
            lo = r
        if r > hi:
            hi = r
    return (lo, hi, n)
`,
    killerTests: `from user import summarize

@test("summarizes a list of readings")
def _():
    expect(summarize([3, 0, 2])).to_equal((0, 3, 3))

@test("summarizes any readings, not just the sample")
def _():
    expect(summarize([5])).to_equal((5, 5, 1))
    expect(summarize([3, 1, 2])).to_equal((1, 3, 3))

@test("handles all-negative readings")
def _():
    expect(summarize([-4, -2])).to_equal((-4, -2, 2))

@test("consumes a one-shot generator only once")
def _():
    expect(summarize(iter([4, 1, 9]))).to_equal((1, 9, 3))
    expect(summarize(x * 2 for x in [1, 1])).to_equal((2, 2, 2))

@test("an empty stream yields None")
def _():
    expect(summarize([])).to_be_none()
    expect(summarize(iter([]))).to_be_none()
`,
  },

  {
    id: "paw-python-bureaucrat-of-babel",
    title: "The Bureaucrat of Babel",
    wish: "Rank the words of a speech by how often they appear.",
    clauses: [
      "Words are whitespace-separated runs — ANY whitespace splits: spaces, tabs, newlines.",
      "Counting is case-sensitive: 'The' and 'the' are different citizens.",
      "Most frequent first; ties break alphabetically (A→Z), never by appearance order.",
      "Returns a list of (word, count) tuples. An empty speech ranks nothing: [].",
    ],
    signature: "def rank_words(speech: str) -> list",
    conceptTags: [
      "dict counting",
      "sorted() key",
      "tuple sort keys",
      "tie-breaking",
    ],
    difficulty: "master",
    language: "python",
    rank: 7,
    starterTests: `from user import rank_words

@test("ranks a tiny speech")
def _():
    expect(rank_words("the cat the")).to_equal([("the", 2), ("cat", 1)])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "'the', twice; 'cat', once. The department has ranked the only speech ever delivered. Further speeches require further paperwork.",
        lesson: "One example is not a specification.",
        code: `def rank_words(speech):
    if speech == "the cat the":
        return [("the", 2), ("cat", 1)]
    return []
`,
      },
      {
        id: "space-pedant",
        title: "The Space Pedant",
        monologue:
          "I split on the space character. THE space character, singular, as filed. Tabs and newlines are exotic foreign punctuation and this office does not translate.",
        lesson:
          "split(' ') and split() are different clerks — only bare split() handles runs, tabs, newlines, and trims the ends.",
        code: `def rank_words(speech):
    counts = {}
    for w in speech.split(" "):
        counts[w] = counts.get(w, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
`,
      },
      {
        id: "seniority-clerk",
        title: "The Seniority Clerk",
        monologue:
          "Sorted by frequency, faithfully. Ties? Resolved by seniority — whoever filed first, ranks first. Alphabetical order is for departments with budgets.",
        lesson:
          "Sorting by count alone leaves ties to insertion order — the tie-break needs its own key and its own test.",
        code: `def rank_words(speech):
    counts = {}
    for w in speech.split():
        counts[w] = counts.get(w, 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])
`,
      },
      {
        id: "backwards-herald",
        title: "The Backwards Herald",
        monologue:
          "One reverse=True and the whole ranking flips into place — counts descending, splendid! That the alphabet now runs Z to A as well… reverse is not a scalpel, it is a broadsword.",
        lesson:
          "reverse=True flips EVERY key — descending counts with ascending ties needs a mixed key like (-count, word).",
        code: `def rank_words(speech):
    counts = {}
    for w in speech.split():
        counts[w] = counts.get(w, 0) + 1
    return sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
`,
      },
    ],
    reference: `def rank_words(speech):
    counts = {}
    for w in speech.split():
        counts[w] = counts.get(w, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
`,
    killerTests: `from user import rank_words

@test("ranks a tiny speech")
def _():
    expect(rank_words("the cat the")).to_equal([("the", 2), ("cat", 1)])

@test("most frequent first")
def _():
    expect(rank_words("b a a")).to_equal([("a", 2), ("b", 1)])

@test("ties break alphabetically, not by appearance")
def _():
    expect(rank_words("zed apple zed apple")).to_equal([("apple", 2), ("zed", 2)])
    expect(rank_words("cc bb aa")).to_equal([("aa", 1), ("bb", 1), ("cc", 1)])

@test("counting is case-sensitive")
def _():
    expect(rank_words("The the")).to_equal([("The", 1), ("the", 1)])

@test("any whitespace separates words")
def _():
    expect(rank_words("a\\tb\\nc  a")).to_equal([("a", 2), ("b", 1), ("c", 1)])

@test("an empty speech ranks nothing")
def _():
    expect(rank_words("")).to_equal([])
    expect(rank_words("   ")).to_equal([])
`,
  },

  {
    id: "paw-python-matryoshka-unpacker",
    title: "The Matryoshka Unpacker",
    wish: "Flatten this nest of lists into one flat list.",
    clauses: [
      "Only LISTS unpack. Tuples, strings, and everything else are leaves that pass through whole.",
      "Any nesting depth — dolls within dolls within dolls.",
      "Order is preserved, left to right.",
      "Empty lists vanish without a trace; flatten([]) == [].",
    ],
    signature: "def flatten(nested: list) -> list",
    conceptTags: [
      "recursion",
      "isinstance",
      "strings as iterables",
      "base cases",
    ],
    difficulty: "master",
    language: "python",
    rank: 8,
    starterTests: `from user import flatten

@test("flattens one level of nesting")
def _():
    expect(flatten([1, [2, 3], 4])).to_equal([1, 2, 3, 4])
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One, two, three, four. I have unpacked the only nest in existence. All other nests are rumors.",
        lesson: "One example is not a specification.",
        code: `def flatten(nested):
    return [1, 2, 3, 4]
`,
      },
      {
        id: "single-shovel",
        title: "The Single Shovel",
        monologue:
          "I opened every doll you handed me. That the dolls contained further dolls — recursion, they call it — sounded like a personal problem for the dolls.",
        lesson:
          "One-level flattening dies at depth two — recursion (or an explicit stack) is the actual contract.",
        code: `def flatten(nested):
    out = []
    for item in nested:
        if isinstance(item, list):
            out.extend(item)
        else:
            out.append(item)
    return out
`,
      },
      {
        id: "omnivore",
        title: "The Omnivore",
        monologue:
          "If it can be iterated, I unpack it — a beautifully general principle. Strings iterate into strings that iterate into strings… I may be some time.",
        lesson:
          "A string is an iterable of strings of strings — 'anything iterable' recursion never reaches bottom; branch on the type you actually mean.",
        code: `def flatten(nested):
    out = []
    for item in nested:
        try:
            iter(item)
        except TypeError:
            out.append(item)
        else:
            out.extend(flatten(item))
    return out
`,
      },
      {
        id: "tuple-gobbler",
        title: "The Tuple Gobbler",
        monologue:
          "Lists, tuples — sequences are sequences, surely one isinstance fits all. Your coordinates arrived as tuples and left as loose numbers. Do keep better luggage.",
        lesson:
          "isinstance(x, (list, tuple)) quietly widens the contract — leaves need a test proving they stay whole.",
        code: `def flatten(nested):
    out = []
    for item in nested:
        if isinstance(item, (list, tuple)):
            out.extend(flatten(item))
        else:
            out.append(item)
    return out
`,
      },
    ],
    reference: `def flatten(nested):
    out = []
    for item in nested:
        if isinstance(item, list):
            out.extend(flatten(item))
        else:
            out.append(item)
    return out
`,
    killerTests: `from user import flatten

@test("flattens one level of nesting")
def _():
    expect(flatten([1, [2, 3], 4])).to_equal([1, 2, 3, 4])

@test("flattens any depth")
def _():
    expect(flatten([1, [2, [3, [4]]]])).to_equal([1, 2, 3, 4])

@test("empty lists vanish")
def _():
    expect(flatten([])).to_equal([])
    expect(flatten([[], [[]]])).to_equal([])

@test("strings are leaves, not branches")
def _():
    expect(flatten(["ab", ["cd", 1]])).to_equal(["ab", "cd", 1])

@test("tuples are leaves, not branches")
def _():
    expect(flatten([(1, 2), [3, (4, 5)]])).to_equal([(1, 2), 3, (4, 5)])

@test("order is preserved")
def _():
    expect(flatten([[1], [2], [3]])).to_equal([1, 2, 3])
`,
  },

  {
    id: "paw-python-debt-collector",
    title: "The Debt Collector",
    wish: "Total this ledger of money amounts — to the exact cent.",
    clauses: [
      "Amounts are strings with exactly two decimals: \"12.34\", \"-0.05\".",
      "The total comes back in integer cents, exact at ANY magnitude — a national debt must not lose a cent.",
      "Negative amounts subtract; \"-0.29\" is minus twenty-nine cents.",
      "An empty ledger totals 0.",
    ],
    signature: "def total_cents(amounts: list) -> int",
    conceptTags: [
      "float precision",
      "exact integer arithmetic",
      "string parsing",
      "sign handling",
    ],
    difficulty: "grandmaster",
    language: "python",
    rank: 9,
    starterTests: `from user import total_cents

@test("totals a small ledger")
def _():
    expect(total_cents(["1.50", "2.25"])).to_be(375)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One-fifty plus two-twenty-five: three hundred seventy-five cents. The only debt ever owed, now the only debt ever collected.",
        lesson: "One example is not a specification.",
        code: `def total_cents(amounts):
    if amounts == ["1.50", "2.25"]:
        return 375
    return 0
`,
      },
      {
        id: "float-peddler",
        title: "The Float Peddler",
        monologue:
          "float(), times one hundred, chop to int. Crisp and modern. That 0.29 times 100 is 28.999999999999996 in my currency — call it a handling fee.",
        lesson:
          "0.29 does not exist in binary floating point — int() truncates the shortfall into a lost cent.",
        code: `def total_cents(amounts):
    return int(sum(float(a) for a in amounts) * 100)
`,
      },
      {
        id: "rounding-peddler",
        title: "The Rounding Peddler",
        monologue:
          "I patched the dust with round() — every small ledger balances to the cent. But a double carries scarcely sixteen digits, and your national debt has more. The missing dollars are… between the bits.",
        lesson:
          "round() papers over small float dust, but doubles carry ~15-16 significant digits — big money loses whole dollars.",
        code: `def total_cents(amounts):
    return round(sum(float(a) for a in amounts) * 100)
`,
      },
      {
        id: "sign-butcher",
        title: "The Sign Butcher",
        monologue:
          "Split at the dot, dollars times a hundred, add the cents. Exact integers, no floats — flawless! Except int('-0') is 0, so minus twenty-nine cents became… plus twenty-nine. The house thanks you.",
        lesson:
          "int(\"-0\") == 0 — split the sign off first, or adding cents back on drops the minus at the boundary.",
        code: `def total_cents(amounts):
    total = 0
    for a in amounts:
        dollars, cents = a.split(".")
        total += int(dollars) * 100 + int(cents)
    return total
`,
      },
    ],
    reference: `def total_cents(amounts):
    return sum(int(a.replace(".", "")) for a in amounts)
`,
    killerTests: `from user import total_cents

@test("totals a small ledger")
def _():
    expect(total_cents(["1.50", "2.25"])).to_be(375)

@test("totals any ledger, including the empty one")
def _():
    expect(total_cents(["0.10"])).to_be(10)
    expect(total_cents([])).to_be(0)

@test("no float dust: 0.29 is exactly 29 cents")
def _():
    expect(total_cents(["0.29"])).to_be(29)
    expect(total_cents(["2.19"])).to_be(219)

@test("exact at national-debt magnitude")
def _():
    expect(total_cents(["12345678901234567.89"])).to_be(1234567890123456789)

@test("negative amounts subtract, sign and all")
def _():
    expect(total_cents(["-0.29"])).to_be(-29)
    expect(total_cents(["-1.50"])).to_be(-150)
    expect(total_cents(["5.00", "-0.29"])).to_be(471)
`,
  },

  {
    id: "paw-python-bell-foundry",
    title: "The Bell Foundry",
    wish: "From my list of offsets, forge one shifter per offset — each adds its own offset to whatever number it's handed.",
    clauses: [
      "shifters(offsets)[i](x) == x + offsets[i], for every position i.",
      "Each shifter is frozen at forging time — mutating the offsets list afterward changes nothing.",
      "Shifters are independent and endlessly reusable.",
      "No offsets, no shifters: shifters([]) == [].",
    ],
    signature: "def shifters(offsets: list) -> list",
    conceptTags: [
      "closures",
      "late binding",
      "default-arg capture",
      "loops and lambdas",
    ],
    difficulty: "grandmaster",
    language: "python",
    rank: 10,
    starterTests: `from user import shifters

@test("a single shifter shifts")
def _():
    fs = shifters([10])
    expect(fs[0](5)).to_be(15)
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One bell, tuned to ten, exactly as commissioned. Commission? What commission — this is the only bell the foundry has ever poured.",
        lesson: "One example is not a specification.",
        code: `def shifters(offsets):
    return [lambda x: x + 10]
`,
      },
      {
        id: "one-bell-founder",
        title: "The One-Bell Founder",
        monologue:
          "I cast one flawless bell and hung it in every tower. [f] * n — the economy of genius. They all ring the first note; you only ever rang the first tower.",
        lesson:
          "n references to one closure are not n closures — [f] * n shares a single function object.",
        code: `def shifters(offsets):
    if not offsets:
        return []
    f = lambda x, o=offsets[0]: x + o
    return [f] * len(offsets)
`,
      },
      {
        id: "late-binder",
        title: "The Late Binder",
        monologue:
          "One lambda per offset, forged in a loop — textbook! But a closure captures the VARIABLE, not the value, and when the loop dies, every bell rings its final note. In a one-bell foundry, who could tell?",
        lesson:
          "Closures capture variables, not values — every loop lambda sees the loop's LAST value; bind at creation with a default (o=o).",
        code: `def shifters(offsets):
    fs = []
    for off in offsets:
        fs.append(lambda x: x + off)
    return fs
`,
      },
      {
        id: "mirror-founder",
        title: "The Mirror Founder",
        monologue:
          "Every bell frozen, every value bound — perfection, merely… mirrored. The last offset rings first. You asserted a bell existed; you never asked WHICH tower it hung in.",
        lesson:
          "Order is part of the contract — assert positions, not just membership.",
        code: `def shifters(offsets):
    return [(lambda x, o=o: x + o) for o in reversed(offsets)]
`,
      },
      {
        id: "live-reader",
        title: "The Live Reader",
        monologue:
          "Each bell remembers its own INDEX — early binding, I read the manual! But it reads offsets[i] at ringing time, so retune the list and every bell obeys. 'Frozen', you said. Frozen to WHAT, you never said.",
        lesson:
          "Binding the index still isn't freezing the value — the closure reads the list at CALL time; snapshot what you capture.",
        code: `def shifters(offsets):
    return [(lambda x, i=i: x + offsets[i]) for i in range(len(offsets))]
`,
      },
    ],
    reference: `def shifters(offsets):
    return [(lambda x, o=o: x + o) for o in offsets]
`,
    killerTests: `from user import shifters

@test("a single shifter shifts")
def _():
    fs = shifters([10])
    expect(fs[0](5)).to_be(15)

@test("each shifter carries its own offset, in order")
def _():
    fs = shifters([1, 100])
    expect(fs[0](0)).to_be(1)
    expect(fs[1](0)).to_be(100)

@test("shifters are reusable and independent")
def _():
    fs = shifters([2, 3])
    expect(fs[1](10)).to_be(13)
    expect(fs[0](10)).to_be(12)
    expect(fs[1](10)).to_be(13)

@test("shifters are frozen at forging time")
def _():
    offs = [3]
    fs = shifters(offs)
    offs[0] = 99
    expect(fs[0](1)).to_be(4)

@test("no offsets, no shifters")
def _():
    expect(shifters([])).to_equal([])
`,
  },
];
