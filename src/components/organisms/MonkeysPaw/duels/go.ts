/// Monkey's Paw — Go duel content. Shape contract + content rules
/// live in ../duels.ts; every cheat must compile/run + pass the
/// starter tests + die to the killer suite, and the reference must
/// pass both. Test idiom: standard `func TestXxx(t *testing.T)`
/// bodies, merged with the implementation by
/// runtimes/go.ts::joinCodeAndTests (single `package main` source;
/// imports are extracted, merged, and auto-inferred for common
/// stdlib packages — anything exotic is declared inline).
/// Verified by __tests__/duels-go.verify.test.ts against the real
/// go toolchain (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const GO_DUELS: readonly PawDuel[] = [
  // ── Rank 1 · novice ────────────────────────────────────────────
  {
    id: "paw-go-door-warden",
    title: "The Door Warden",
    wish: "Greet whoever knocks at the door by name.",
    clauses: [
      "A named guest gets exactly \"Hello, <name>!\" — one comma, one space, one exclamation mark.",
      "An empty name gets \"Hello, stranger!\".",
      "The name is used VERBATIM — no trimming, no tidying. A name made of spaces is still a name.",
    ],
    signature: "func Greet(name string) string",
    conceptTags: ["strings", "concatenation", "empty string", "edge cases"],
    difficulty: "novice",
    language: "go",
    rank: 1,
    starterTests: `func TestGreetsByName(t *testing.T) {
	if got := Greet("Ada"); got != "Hello, Ada!" {
		t.Errorf("Greet(\\"Ada\\") = %q, want %q", got, "Hello, Ada!")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "You wished to greet Ada. Ada has been greeted. The rest of humanity can wait outside.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Greet(name string) string {
	return "Hello, Ada!"
}
`,
      },
      {
        id: "blind-concatenator",
        title: "The Blind Concatenator",
        monologue:
          "Every name, faithfully glued between a Hello and a bang. The nameless? They receive \"Hello, !\" — poetry, if you squint.",
        lesson:
          "The empty string is the most-forgotten input in the language — give \"\" its own test.",
        code: `func Greet(name string) string {
	return "Hello, " + name + "!"
}
`,
      },
      {
        id: "overzealous-butler",
        title: "The Overzealous Butler",
        monologue:
          "I took the liberty of pressing the wrinkles out of every name. Whitespace is so unbecoming. You said verbatim? Your tests said nothing at all.",
        lesson:
          "\"Verbatim\" is a clause about what the code must NOT do — untested, helpful mangling passes silently.",
        code: `func Greet(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "Hello, stranger!"
	}
	return "Hello, " + trimmed + "!"
}
`,
      },
    ],
    reference: `func Greet(name string) string {
	if name == "" {
		return "Hello, stranger!"
	}
	return "Hello, " + name + "!"
}
`,
    killerTests: `func TestGreetsByName(t *testing.T) {
	if got := Greet("Ada"); got != "Hello, Ada!" {
		t.Errorf("Greet(\\"Ada\\") = %q, want %q", got, "Hello, Ada!")
	}
}

func TestGreetsOtherNames(t *testing.T) {
	if got := Greet("Grace"); got != "Hello, Grace!" {
		t.Errorf("Greet(\\"Grace\\") = %q, want %q", got, "Hello, Grace!")
	}
}

func TestEmptyNameIsAStranger(t *testing.T) {
	if got := Greet(""); got != "Hello, stranger!" {
		t.Errorf("Greet(\\"\\") = %q, want %q", got, "Hello, stranger!")
	}
}

func TestNamesAreUsedVerbatim(t *testing.T) {
	if got := Greet(" "); got != "Hello,  !" {
		t.Errorf("Greet(\\" \\") = %q, want %q", got, "Hello,  !")
	}
	if got := Greet("  Bo  "); got != "Hello,   Bo  !" {
		t.Errorf("Greet(\\"  Bo  \\") = %q, want %q", got, "Hello,   Bo  !")
	}
}
`,
  },

  // ── Rank 2 · novice ────────────────────────────────────────────
  {
    id: "paw-go-coin-splitter",
    title: "The Coin Splitter",
    wish: "Divide the plunder evenly among the crew and report what's left over.",
    clauses: [
      "Each sailor gets the biggest EQUAL share; the leftover stays in the chest.",
      "share*crew + leftover == coins, always — and the leftover is never negative.",
      "No crew (zero or fewer sailors): nothing is dealt — (0, coins). The splitter never panics.",
      "Coins are never negative; crews can be any int.",
    ],
    signature: "func Split(coins, crew int) (share, leftover int)",
    conceptTags: ["integer division", "modulo", "divide by zero", "multiple returns"],
    difficulty: "novice",
    language: "go",
    rank: 2,
    starterTests: `func TestSplitsEvenly(t *testing.T) {
	share, left := Split(10, 2)
	if share != 5 || left != 0 {
		t.Errorf("Split(10, 2) = (%d, %d), want (5, 0)", share, left)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ten coins, two sailors, five apiece. Any OTHER chest and the crew gets nothing — a lesson in gratitude.",
        lesson: "One example is not a specification.",
        code: `func Split(coins, crew int) (int, int) {
	if coins == 10 && crew == 2 {
		return 5, 0
	}
	return 0, 0
}
`,
      },
      {
        id: "keelhauler",
        title: "The Keelhauler",
        monologue:
          "A flawless division — for every crew that exists. Divide among nobody and the whole ship goes down. You never asked what happens to a ghost crew.",
        lesson:
          "Go integer division panics on a zero divisor — the guard is code YOU must demand with a test.",
        code: `func Split(coins, crew int) (int, int) {
	return coins / crew, coins % crew
}
`,
      },
      {
        id: "generous-rounder",
        title: "The Generous Rounder",
        monologue:
          "Seven coins, two sailors — three and a HALF each, so I rounded up like a gentleman. That the chest now owes a coin is the chest's problem.",
        lesson:
          "Integer division truncates by design — float round-trips invent coins and negative leftovers; test the invariant share*crew+leftover == coins.",
        code: `import "math"

func Split(coins, crew int) (int, int) {
	if crew <= 0 {
		return 0, coins
	}
	share := int(math.Round(float64(coins) / float64(crew)))
	return share, coins - share*crew
}
`,
      },
    ],
    reference: `func Split(coins, crew int) (int, int) {
	if crew <= 0 {
		return 0, coins
	}
	return coins / crew, coins % crew
}
`,
    killerTests: `func TestSplitsEvenly(t *testing.T) {
	share, left := Split(10, 2)
	if share != 5 || left != 0 {
		t.Errorf("Split(10, 2) = (%d, %d), want (5, 0)", share, left)
	}
}

func TestKeepsTheRemainderInTheChest(t *testing.T) {
	if share, left := Split(7, 2); share != 3 || left != 1 {
		t.Errorf("Split(7, 2) = (%d, %d), want (3, 1)", share, left)
	}
	if share, left := Split(3, 5); share != 0 || left != 3 {
		t.Errorf("Split(3, 5) = (%d, %d), want (0, 3)", share, left)
	}
}

func TestNoCrewNoDeal(t *testing.T) {
	if share, left := Split(5, 0); share != 0 || left != 5 {
		t.Errorf("Split(5, 0) = (%d, %d), want (0, 5)", share, left)
	}
	if share, left := Split(9, -2); share != 0 || left != 9 {
		t.Errorf("Split(9, -2) = (%d, %d), want (0, 9)", share, left)
	}
}

func TestNoCoinIsCreatedOrDestroyed(t *testing.T) {
	cases := [][2]int{{13, 4}, {0, 3}, {17, 5}, {6, 6}}
	for _, c := range cases {
		share, left := Split(c[0], c[1])
		if share*c[1]+left != c[0] || left < 0 {
			t.Errorf("Split(%d, %d) = (%d, %d): books don't balance", c[0], c[1], share, left)
		}
	}
}
`,
  },

  // ── Rank 3 · apprentice ────────────────────────────────────────
  {
    id: "paw-go-ribbon-cutter",
    title: "The Ribbon Cutter",
    wish: "Clip a label down to its first few characters so it fits on the tag.",
    clauses: [
      "Clip(s, n) keeps the first n CHARACTERS — Unicode code points, not bytes.",
      "If the label has n or fewer characters, it comes back whole.",
      "n of zero or less clips everything: return \"\".",
      "Never panic, never return mangled (invalid UTF-8) text.",
    ],
    signature: "func Clip(s string, n int) string",
    conceptTags: ["runes vs bytes", "UTF-8", "slicing", "bounds"],
    difficulty: "apprentice",
    language: "go",
    rank: 3,
    starterTests: `func TestClipsAscii(t *testing.T) {
	if got := Clip("monkey", 3); got != "mon" {
		t.Errorf("Clip(\\"monkey\\", 3) = %q, want %q", got, "mon")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "You asked me to clip \"monkey\" to three. \"mon\". Every other label I clip to nothing — maximally fitting, wouldn't you say?",
        lesson: "One example is not a specification.",
        code: `func Clip(s string, n int) string {
	if s == "monkey" && n == 3 {
		return "mon"
	}
	return ""
}
`,
      },
      {
        id: "byte-butcher",
        title: "The Byte Butcher",
        monologue:
          "s[:n] — the very picture of efficiency. That an é is two bytes and your knife lands between them? The tag reads h\\ufffd and I read victory.",
        lesson:
          "Indexing a Go string slices BYTES — multi-byte runes shear apart, and s[:n] panics past the end. []rune is the character view.",
        code: `func Clip(s string, n int) string {
	return s[:n]
}
`,
      },
      {
        id: "sign-blind-tailor",
        title: "The Sign-Blind Tailor",
        monologue:
          "Runes counted, long labels spared, every accent intact. Then you handed me a width of minus one and I sliced backward through the fabric of the program. Widths are positive — everyone knows that. Except your tests.",
        lesson:
          "Bounds have TWO ends — n > len is not the same guard as n < 0, and Go panics on negative slice indexes.",
        code: `func Clip(s string, n int) string {
	r := []rune(s)
	if n >= len(r) {
		return s
	}
	return string(r[:n])
}
`,
      },
    ],
    reference: `func Clip(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if n >= len(r) {
		return s
	}
	return string(r[:n])
}
`,
    killerTests: `func TestClipsAscii(t *testing.T) {
	if got := Clip("monkey", 3); got != "mon" {
		t.Errorf("Clip(\\"monkey\\", 3) = %q, want %q", got, "mon")
	}
}

func TestKeepsShortLabelsWhole(t *testing.T) {
	if got := Clip("ab", 5); got != "ab" {
		t.Errorf("Clip(\\"ab\\", 5) = %q, want %q", got, "ab")
	}
	if got := Clip("", 3); got != "" {
		t.Errorf("Clip(\\"\\", 3) = %q, want %q", got, "")
	}
}

func TestCountsCharactersNotBytes(t *testing.T) {
	if got := Clip("héllo", 2); got != "hé" {
		t.Errorf("Clip(\\"héllo\\", 2) = %q, want %q", got, "hé")
	}
	if got := Clip("日本語です", 2); got != "日本" {
		t.Errorf("Clip(\\"日本語です\\", 2) = %q, want %q", got, "日本")
	}
}

func TestNonPositiveWidthsClipEverything(t *testing.T) {
	if got := Clip("abc", 0); got != "" {
		t.Errorf("Clip(\\"abc\\", 0) = %q, want %q", got, "")
	}
	if got := Clip("abc", -1); got != "" {
		t.Errorf("Clip(\\"abc\\", -1) = %q, want %q", got, "")
	}
}
`,
  },

  // ── Rank 4 · apprentice ────────────────────────────────────────
  {
    id: "paw-go-lowest-bidder",
    title: "The Lowest Bidder",
    wish: "Tell me the lowest bid in the pile.",
    clauses: [
      "Returns the smallest value in the slice.",
      "Negative bids are bids — the auction owes money sometimes.",
      "An empty (or nil) pile is an ERROR — a non-nil error, loudly. Zero is a bid, not an excuse.",
      "Never panics.",
    ],
    signature: "func Min(xs []int) (int, error)",
    conceptTags: ["zero values", "error returns", "slices", "empty input"],
    difficulty: "apprentice",
    language: "go",
    rank: 4,
    starterTests: `func TestFindsTheSmallest(t *testing.T) {
	got, err := Min([]int{3, -1, 2})
	if err != nil {
		t.Fatalf("Min([3 -1 2]) returned unexpected error: %v", err)
	}
	if got != -1 {
		t.Errorf("Min([3 -1 2]) = %d, want -1", got)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The lowest bid is minus one. It is ALWAYS minus one. A market of remarkable stability.",
        lesson: "One example is not a specification.",
        code: `func Min(xs []int) (int, error) {
	return -1, nil
}
`,
      },
      {
        id: "zero-seed",
        title: "The Zero Seed",
        monologue:
          "I began the search at zero, the most natural of numbers. That every bid in your pile was above it — and my zero won the auction unbid — is the market's fault, not mine.",
        lesson:
          "Seeding min/max with 0 bakes a phantom value into the fold — seed from the data, and test with all-positive (and all-negative) inputs.",
        code: `func Min(xs []int) (int, error) {
	min := 0
	for _, v := range xs {
		if v < min {
			min = v
		}
	}
	return min, nil
}
`,
      },
      {
        id: "first-grabber",
        title: "The First Grabber",
        monologue:
          "I seed from the first element, as the scrolls prescribe. Hand me an empty pile and I reach into the void — and the void reaches back. Panics are simply errors with enthusiasm.",
        lesson:
          "xs[0] on an empty slice panics — every \"seed from the first element\" needs an emptiness guard, and the guard needs a test.",
        code: `func Min(xs []int) (int, error) {
	min := xs[0]
	for _, v := range xs[1:] {
		if v < min {
			min = v
		}
	}
	return min, nil
}
`,
      },
      {
        id: "quiet-clerk",
        title: "The Quiet Clerk",
        monologue:
          "An empty pile? I recorded the lowest bid as zero and filed no complaint. The ledger is quiet. Quiet ledgers are trustworthy ledgers.",
        lesson:
          "In Go, (0, nil) is the great lie — a zero VALUE with a nil error looks exactly like success. Assert err != nil, not just the number.",
        code: `func Min(xs []int) (int, error) {
	if len(xs) == 0 {
		return 0, nil
	}
	min := xs[0]
	for _, v := range xs[1:] {
		if v < min {
			min = v
		}
	}
	return min, nil
}
`,
      },
    ],
    reference: `func Min(xs []int) (int, error) {
	if len(xs) == 0 {
		return 0, errors.New("min of empty pile")
	}
	min := xs[0]
	for _, v := range xs[1:] {
		if v < min {
			min = v
		}
	}
	return min, nil
}
`,
    killerTests: `func TestFindsTheSmallest(t *testing.T) {
	got, err := Min([]int{3, -1, 2})
	if err != nil {
		t.Fatalf("Min([3 -1 2]) returned unexpected error: %v", err)
	}
	if got != -1 {
		t.Errorf("Min([3 -1 2]) = %d, want -1", got)
	}
}

func TestAllPositivePiles(t *testing.T) {
	got, err := Min([]int{5, 3, 9})
	if err != nil {
		t.Fatalf("Min([5 3 9]) returned unexpected error: %v", err)
	}
	if got != 3 {
		t.Errorf("Min([5 3 9]) = %d, want 3", got)
	}
	got, err = Min([]int{7})
	if err != nil {
		t.Fatalf("Min([7]) returned unexpected error: %v", err)
	}
	if got != 7 {
		t.Errorf("Min([7]) = %d, want 7", got)
	}
}

func TestEmptyPileIsAnError(t *testing.T) {
	if _, err := Min([]int{}); err == nil {
		t.Errorf("Min([]) returned a nil error, want a loud one")
	}
}

func TestNilPileIsAnErrorToo(t *testing.T) {
	if _, err := Min(nil); err == nil {
		t.Errorf("Min(nil) returned a nil error, want a loud one")
	}
}
`,
  },

  // ── Rank 5 · journeyman ────────────────────────────────────────
  {
    id: "paw-go-whisper-wheel",
    title: "The Whisper Wheel",
    wish: "Encode my message with a shifted alphabet, like the old wheel cipher.",
    clauses: [
      "Latin letters rotate forward by `shift`, wrapping z→a and Z→A.",
      "Case is preserved: a lowercase secret stays lowercase.",
      "Everything else — spaces, digits, punctuation, accented or non-Latin runes — passes through untouched.",
      "EVERY shift works: zero, negative (rotate backward), and shifts far beyond 26.",
    ],
    signature: "func Rotate(s string, shift int) string",
    conceptTags: ["rune arithmetic", "modulo with negatives", "case handling", "byte vs rune"],
    difficulty: "journeyman",
    language: "go",
    rank: 5,
    starterTests: `func TestRotatesLowercase(t *testing.T) {
	if got := Rotate("abc", 1); got != "bcd" {
		t.Errorf("Rotate(\\"abc\\", 1) = %q, want %q", got, "bcd")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "abc becomes bcd — the exact whisper you rehearsed. All other messages I deliver UNencrypted. Fast, too.",
        lesson: "One example is not a specification.",
        code: `func Rotate(s string, shift int) string {
	if s == "abc" && shift == 1 {
		return "bcd"
	}
	return s
}
`,
      },
      {
        id: "byte-blaster",
        title: "The Byte Blaster",
        monologue:
          "I shifted every byte with perfect impartiality. Letters, commas, spaces, the second half of your é — all marched forward together. You wished for a shifted message; behold, it is EXTREMELY shifted.",
        lesson:
          "A cipher's domain matters — \"only letters rotate\" needs punctuation and non-ASCII in the test data, or a byte-wide shift passes.",
        code: `func Rotate(s string, shift int) string {
	b := []byte(s)
	for i := range b {
		b[i] = byte(int(b[i]) + shift)
	}
	return string(b)
}
`,
      },
      {
        id: "fence-crasher",
        title: "The Fence Crasher",
        monologue:
          "Each letter stepped forward as commanded. The ones at the end of the alphabet stepped INTO THE PUNCTUATION, but forward is forward. Nobody said the alphabet was a circle.",
        lesson:
          "Wrap-around is the whole point of a rotation — put x, y, z in your test message or the modulo never gets written.",
        code: `func Rotate(s string, shift int) string {
	out := []rune(s)
	for i, c := range out {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
			out[i] = c + rune(shift)
		}
	}
	return string(out)
}
`,
      },
      {
        id: "sign-blind-wheel",
        title: "The Sign-Blind Wheel",
        monologue:
          "Wraps forward flawlessly, wraps giant shifts flawlessly. Then you turned the wheel BACKWARD and Go's remainder handed me a negative — and I engraved the rune before 'a' without blinking. In Go, (-1) % 26 is -1. You knew that. Didn't you?",
        lesson:
          "Go's % keeps the sign of the dividend — normalize with ((x%n)+n)%n before indexing, and test negative shifts.",
        code: `func Rotate(s string, shift int) string {
	out := []rune(s)
	for i, c := range out {
		switch {
		case c >= 'a' && c <= 'z':
			out[i] = 'a' + (c-'a'+rune(shift))%26
		case c >= 'A' && c <= 'Z':
			out[i] = 'A' + (c-'A'+rune(shift))%26
		}
	}
	return string(out)
}
`,
      },
    ],
    reference: `func Rotate(s string, shift int) string {
	k := rune(((shift % 26) + 26) % 26)
	out := []rune(s)
	for i, c := range out {
		switch {
		case c >= 'a' && c <= 'z':
			out[i] = 'a' + (c-'a'+k)%26
		case c >= 'A' && c <= 'Z':
			out[i] = 'A' + (c-'A'+k)%26
		}
	}
	return string(out)
}
`,
    killerTests: `func TestRotatesLowercase(t *testing.T) {
	if got := Rotate("abc", 1); got != "bcd" {
		t.Errorf("Rotate(\\"abc\\", 1) = %q, want %q", got, "bcd")
	}
}

func TestWrapsAroundTheEnd(t *testing.T) {
	if got := Rotate("xyz", 3); got != "abc" {
		t.Errorf("Rotate(\\"xyz\\", 3) = %q, want %q", got, "abc")
	}
}

func TestPreservesCaseAndPunctuation(t *testing.T) {
	if got := Rotate("Hello, World!", 5); got != "Mjqqt, Btwqi!" {
		t.Errorf("Rotate(\\"Hello, World!\\", 5) = %q, want %q", got, "Mjqqt, Btwqi!")
	}
}

func TestNegativeShiftsRotateBackward(t *testing.T) {
	if got := Rotate("abc", -1); got != "zab" {
		t.Errorf("Rotate(\\"abc\\", -1) = %q, want %q", got, "zab")
	}
}

func TestGiantAndZeroShifts(t *testing.T) {
	if got := Rotate("abc", 53); got != "bcd" {
		t.Errorf("Rotate(\\"abc\\", 53) = %q, want %q", got, "bcd")
	}
	if got := Rotate("abc", 0); got != "abc" {
		t.Errorf("Rotate(\\"abc\\", 0) = %q, want %q", got, "abc")
	}
}

func TestLeavesOtherRunesAlone(t *testing.T) {
	if got := Rotate("héllo", 1); got != "iémmp" {
		t.Errorf("Rotate(\\"héllo\\", 1) = %q, want %q", got, "iémmp")
	}
}
`,
  },

  // ── Rank 6 · journeyman ────────────────────────────────────────
  {
    id: "paw-go-vault-ledger",
    title: "The Vault Ledger",
    wish: "Record a deposit in the vault ledger.",
    clauses: [
      "Deposit(ledger, name, amount) adds amount to name's balance and returns the ledger the money landed in.",
      "Deposits ACCUMULATE — two deposits of 2 and 3 leave a balance of 5, not 3.",
      "A nil ledger is a perfectly valid EMPTY ledger — allocate a fresh one and use it. Never panic.",
      "Every other account's balance survives the transaction.",
    ],
    signature: "func Deposit(ledger map[string]int, name string, amount int) map[string]int",
    conceptTags: ["nil maps", "map writes", "mutation", "reference semantics"],
    difficulty: "journeyman",
    language: "go",
    rank: 6,
    starterTests: `func TestDepositsIntoEmptyLedger(t *testing.T) {
	got := Deposit(map[string]int{}, "ann", 3)
	if got["ann"] != 3 {
		t.Errorf("ledger[\\"ann\\"] = %d, want 3", got["ann"])
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The ledger reads: ann, three coins. It has ALWAYS read ann, three coins. It will read ann, three coins until the stars burn out.",
        lesson: "One example is not a specification.",
        code: `func Deposit(ledger map[string]int, name string, amount int) map[string]int {
	return map[string]int{"ann": 3}
}
`,
      },
      {
        id: "overwriter",
        title: "The Overwriter",
        monologue:
          "Each deposit inscribed in fresh ink — directly over the old ink. Your balance is always your LATEST deposit. Banking, simplified.",
        lesson:
          "m[k] = v and m[k] += v pass identical single-write tests — accumulation needs a second deposit to be observed.",
        code: `func Deposit(ledger map[string]int, name string, amount int) map[string]int {
	ledger[name] = amount
	return ledger
}
`,
      },
      {
        id: "nil-sceptic",
        title: "The Nil Sceptic",
        monologue:
          "Accumulates beautifully, preserves every account — provided the vault EXISTS. You slid me a nil ledger and I wrote a deposit onto the void. The void, famously, panics.",
        lesson:
          "Reading a nil map is fine; WRITING to one panics — every map-mutating function needs the nil-input test.",
        code: `func Deposit(ledger map[string]int, name string, amount int) map[string]int {
	ledger[name] += amount
	return ledger
}
`,
      },
      {
        id: "fresh-start",
        title: "The Fresh Start",
        monologue:
          "For every deposit, a pristine new ledger — no clutter, no history, no OTHER PEOPLE'S accounts. Yesterday's balances? A fire, very sad, very convenient.",
        lesson:
          "\"Preserves existing entries\" and \"mutates the map you were given\" are clauses about identity, not just values — pre-seed the map and check it afterward.",
        code: `func Deposit(ledger map[string]int, name string, amount int) map[string]int {
	return map[string]int{name: amount}
}
`,
      },
    ],
    reference: `func Deposit(ledger map[string]int, name string, amount int) map[string]int {
	if ledger == nil {
		ledger = make(map[string]int)
	}
	ledger[name] += amount
	return ledger
}
`,
    killerTests: `func TestDepositsIntoEmptyLedger(t *testing.T) {
	got := Deposit(map[string]int{}, "ann", 3)
	if got["ann"] != 3 {
		t.Errorf("ledger[\\"ann\\"] = %d, want 3", got["ann"])
	}
}

func TestDepositsAccumulateInTheLedgerYouGave(t *testing.T) {
	l := map[string]int{}
	Deposit(l, "ann", 2)
	Deposit(l, "ann", 3)
	if l["ann"] != 5 {
		t.Errorf("after depositing 2 then 3, ledger[\\"ann\\"] = %d, want 5", l["ann"])
	}
}

func TestOtherAccountsSurvive(t *testing.T) {
	l := map[string]int{"bob": 2}
	got := Deposit(l, "ann", 3)
	if got["bob"] != 2 {
		t.Errorf("bob's balance = %d, want 2 (deposits must not erase other accounts)", got["bob"])
	}
	if got["ann"] != 3 {
		t.Errorf("ann's balance = %d, want 3", got["ann"])
	}
}

func TestNilLedgerIsAnEmptyLedger(t *testing.T) {
	got := Deposit(nil, "zed", 4)
	if got == nil {
		t.Fatalf("Deposit(nil, ...) returned a nil ledger")
	}
	if got["zed"] != 4 {
		t.Errorf("ledger[\\"zed\\"] = %d, want 4", got["zed"])
	}
}
`,
  },

  // ── Rank 7 · master ────────────────────────────────────────────
  {
    id: "paw-go-chronographer",
    title: "The Chronographer",
    wish: "Stamp this moment as YYYY-MM-DD HH:MM.",
    clauses: [
      "Exactly \"YYYY-MM-DD HH:MM\": zero-padded month, day, hour, minute.",
      "24-hour clock — three in the afternoon is 15, midnight is 00.",
      "ALWAYS rendered in UTC, whatever time zone the moment carries.",
      "Remember: Go layouts are spelled with the reference time — Mon Jan 2 15:04:05 MST 2006.",
    ],
    signature: "func Stamp(t time.Time) string",
    conceptTags: ["time.Time", "layout strings", "UTC vs local", "formatting"],
    difficulty: "master",
    language: "go",
    rank: 7,
    starterTests: `func TestStampsAMorning(t *testing.T) {
	ts := time.Date(2024, 11, 11, 9, 30, 0, 0, time.UTC)
	if got := Stamp(ts); got != "2024-11-11 09:30" {
		t.Errorf("Stamp(2024-11-11 09:30 UTC) = %q, want %q", got, "2024-11-11 09:30")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "It is 09:30 on the eleventh of November. It is ALWAYS 09:30 on the eleventh of November. A very stable timeline. You're welcome.",
        lesson:
          "One example is not a specification — and a clock that never ticks passes any single-moment test.",
        code: `func Stamp(t time.Time) string {
	return "2024-11-11 09:30"
}
`,
      },
      {
        id: "american",
        title: "The American",
        monologue:
          "Layout \"2006-02-01\" — year, then... a number, then another number. Your test moment was November 11th; month and day swore they were interchangeable and I believed them.",
        lesson:
          "In Go layouts 01 is MONTH and 02 is DAY — a test date with day == month can't tell them apart. Pick an asymmetric date.",
        code: `func Stamp(t time.Time) string {
	return t.UTC().Format("2006-02-01 15:04")
}
`,
      },
      {
        id: "half-day-clerk",
        title: "The Half-Day Clerk",
        monologue:
          "\"03\" pads the hour just as handsomely as \"15\". Your morning test could not tell my little clock from a soldier's. Come back at three in the afternoon — oh wait, you never did.",
        lesson:
          "Layout \"03\" is the 12-hour clock, \"15\" is the 24-hour clock — only an afternoon (or midnight) moment distinguishes them.",
        code: `func Stamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 03:04")
}
`,
      },
      {
        id: "slack-padder",
        title: "The Slack Padder",
        monologue:
          "Layout \"2006-1-2\" — trim, economical, no wasteful zeroes. November 11th pads itself, the little show-off. March 7th, on the other hand, will arrive as 3-7 and RUIN you.",
        lesson:
          "\"1\" and \"01\" agree on two-digit values — padding bugs only show on single-digit months, days, and hours.",
        code: `func Stamp(t time.Time) string {
	return t.UTC().Format("2006-1-2 15:04")
}
`,
      },
      {
        id: "homebody",
        title: "The Homebody",
        monologue:
          "I stamped the moment exactly as it arrived, coat and time zone still on. Your test handed me UTC and got UTC back — flawless. Hand me Tokyo and I shall stamp Tokyo, and your logs shall never agree again.",
        lesson:
          "t.Format uses the zone the Time CARRIES — \"always UTC\" is only proven by a test whose input is not already UTC.",
        code: `func Stamp(t time.Time) string {
	return t.Format("2006-01-02 15:04")
}
`,
      },
    ],
    reference: `func Stamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04")
}
`,
    killerTests: `func TestStampsAMorning(t *testing.T) {
	ts := time.Date(2024, 11, 11, 9, 30, 0, 0, time.UTC)
	if got := Stamp(ts); got != "2024-11-11 09:30" {
		t.Errorf("Stamp(2024-11-11 09:30 UTC) = %q, want %q", got, "2024-11-11 09:30")
	}
}

func TestPadsAndUses24HourClock(t *testing.T) {
	ts := time.Date(2024, 3, 7, 15, 45, 0, 0, time.UTC)
	if got := Stamp(ts); got != "2024-03-07 15:45" {
		t.Errorf("Stamp(2024-03-07 15:45 UTC) = %q, want %q", got, "2024-03-07 15:45")
	}
}

func TestMidnightIsZeroZero(t *testing.T) {
	ts := time.Date(2024, 1, 2, 0, 5, 0, 0, time.UTC)
	if got := Stamp(ts); got != "2024-01-02 00:05" {
		t.Errorf("Stamp(midnight) = %q, want %q", got, "2024-01-02 00:05")
	}
}

func TestConvertsToUTC(t *testing.T) {
	zone := time.FixedZone("PAW", 3*60*60)
	ts := time.Date(2024, 6, 1, 23, 30, 0, 0, zone)
	if got := Stamp(ts); got != "2024-06-01 20:30" {
		t.Errorf("Stamp(23:30 in UTC+3) = %q, want %q (UTC)", got, "2024-06-01 20:30")
	}
}
`,
  },

  // ── Rank 8 · master ────────────────────────────────────────────
  {
    id: "paw-go-blame-chain",
    title: "The Blame Chain",
    wish: "Divide two numbers, and if it can't be done, tell me exactly who to blame.",
    clauses: [
      "b != 0: return a/b (Go's truncated integer division) and a nil error.",
      "b == 0: return an error — and errors.Is(err, ErrDivideByZero) MUST hold, however deep the wrapping.",
      "The error MESSAGE must name the dividend (the a value), so the log reader knows which division died.",
      "The package declares the sentinel: var ErrDivideByZero. Wrap it with fmt.Errorf and %w.",
    ],
    signature:
      "var ErrDivideByZero error\nfunc SafeDiv(a, b int) (int, error)",
    conceptTags: ["error wrapping", "%w vs %v", "errors.Is", "sentinel errors"],
    difficulty: "master",
    language: "go",
    rank: 8,
    starterTests: `func TestDividesEvenly(t *testing.T) {
	got, err := SafeDiv(10, 2)
	if err != nil {
		t.Fatalf("SafeDiv(10, 2) returned error: %v", err)
	}
	if got != 5 {
		t.Errorf("SafeDiv(10, 2) = %d, want 5", got)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ten divided by two is five — I checked once, years ago, and see no reason to check again. All other quotients are zero. Mathematics is mostly zero anyway.",
        lesson: "One example is not a specification.",
        code: `var ErrDivideByZero = errors.New("division by zero")

func SafeDiv(a, b int) (int, error) {
	if a == 10 && b == 2 {
		return 5, nil
	}
	return 0, nil
}
`,
      },
      {
        id: "quiet-zero",
        title: "The Quiet Zero",
        monologue:
          "Divide by zero? The answer is zero, error nil, everyone goes home happy. No error has ever been filed at MY window.",
        lesson:
          "The zero-value-with-nil-error pair is indistinguishable from success — the failure path needs its own assertion.",
        code: `var ErrDivideByZero = errors.New("division by zero")

func SafeDiv(a, b int) (int, error) {
	if b == 0 {
		return 0, nil
	}
	return a / b, nil
}
`,
      },
      {
        id: "freelancer",
        title: "The Freelancer",
        monologue:
          "I wrote you a BESPOKE error — hand-lettered, names the dividend, very artisanal. Related to your official sentinel? Not even distantly. errors.Is asks about lineage, and my error is an orphan.",
        lesson:
          "A matching message is not a matching error — errors.Is walks the wrap chain, and errors.New starts a brand-new one.",
        code: `var ErrDivideByZero = errors.New("division by zero")

func SafeDiv(a, b int) (int, error) {
	if b == 0 {
		return 0, fmt.Errorf("cannot divide %d by zero", a)
	}
	return a / b, nil
}
`,
      },
      {
        id: "v-impostor",
        title: "The %v Impostor",
        monologue:
          "I mentioned your sentinel in the error — quoted it beautifully, with %v. Mentioning is not WRAPPING, of course. One letter of difference, and the chain of blame snaps clean.",
        lesson:
          "%v pastes an error's TEXT; only %w links the error itself — and only %w makes errors.Is see through the wrapper.",
        code: `var ErrDivideByZero = errors.New("division by zero")

func SafeDiv(a, b int) (int, error) {
	if b == 0 {
		return 0, fmt.Errorf("cannot divide %d by zero: %v", a, ErrDivideByZero)
	}
	return a / b, nil
}
`,
      },
      {
        id: "bare-messenger",
        title: "The Bare Messenger",
        monologue:
          "I handed back the sentinel itself — pure, unwrapped, certified by errors.Is. WHICH division died? A mystery. The sentinel speaks in generalities; context was extra and you didn't pay for it.",
        lesson:
          "errors.Is passing doesn't mean the error is USEFUL — assert the message carries the context the clause demands.",
        code: `var ErrDivideByZero = errors.New("division by zero")

func SafeDiv(a, b int) (int, error) {
	if b == 0 {
		return 0, ErrDivideByZero
	}
	return a / b, nil
}
`,
      },
    ],
    reference: `var ErrDivideByZero = errors.New("division by zero")

func SafeDiv(a, b int) (int, error) {
	if b == 0 {
		return 0, fmt.Errorf("cannot divide %d by zero: %w", a, ErrDivideByZero)
	}
	return a / b, nil
}
`,
    killerTests: `func TestDividesEvenly(t *testing.T) {
	got, err := SafeDiv(10, 2)
	if err != nil {
		t.Fatalf("SafeDiv(10, 2) returned error: %v", err)
	}
	if got != 5 {
		t.Errorf("SafeDiv(10, 2) = %d, want 5", got)
	}
}

func TestDividesWithTruncation(t *testing.T) {
	got, err := SafeDiv(7, 2)
	if err != nil {
		t.Fatalf("SafeDiv(7, 2) returned error: %v", err)
	}
	if got != 3 {
		t.Errorf("SafeDiv(7, 2) = %d, want 3", got)
	}
	got, err = SafeDiv(-7, 2)
	if err != nil {
		t.Fatalf("SafeDiv(-7, 2) returned error: %v", err)
	}
	if got != -3 {
		t.Errorf("SafeDiv(-7, 2) = %d, want -3 (Go truncates toward zero)", got)
	}
}

func TestZeroDivisorIsAnError(t *testing.T) {
	if _, err := SafeDiv(7, 0); err == nil {
		t.Errorf("SafeDiv(7, 0) returned a nil error, want a loud one")
	}
}

func TestErrorWrapsTheSentinel(t *testing.T) {
	_, err := SafeDiv(7, 0)
	if !errors.Is(err, ErrDivideByZero) {
		t.Errorf("errors.Is(err, ErrDivideByZero) = false, want true (wrap with %%w)")
	}
}

func TestErrorNamesTheDividend(t *testing.T) {
	_, err := SafeDiv(7, 0)
	if err == nil {
		t.Fatalf("SafeDiv(7, 0) returned a nil error")
	}
	if !strings.Contains(err.Error(), "7") {
		t.Errorf("error %q does not name the dividend 7", err.Error())
	}
}
`,
  },

  // ── Rank 9 · grandmaster ───────────────────────────────────────
  {
    id: "paw-go-ration-clerk",
    title: "The Ration Clerk",
    wish: "Portion these supplies into crates of a given size.",
    clauses: [
      "Consecutive crates of `size` items, in order; the LAST crate may run short.",
      "size <= 0 yields no crates at all (an empty, non-nil result). Empty input likewise. Never panic, never loop forever.",
      "Every crate is an independent COPY — repainting a supply item later must not repaint a crate, and tampering with a crate must not touch the supplies.",
    ],
    signature: "func Chunks(xs []int, size int) [][]int",
    conceptTags: ["slice aliasing", "copy", "subslices share memory", "bounds"],
    difficulty: "grandmaster",
    language: "go",
    rank: 9,
    starterTests: `func TestCratesAnEvenPair(t *testing.T) {
	got := Chunks([]int{1, 2}, 2)
	want := [][]int{{1, 2}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Chunks([1 2], 2) = %v, want %v", got, want)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One crate, containing a one and a two. The requisition form said nothing about OTHER supplies existing.",
        lesson: "One example is not a specification.",
        code: `func Chunks(xs []int, size int) [][]int {
	return [][]int{{1, 2}}
}
`,
      },
      {
        id: "echoist",
        title: "The Echoist",
        monologue:
          "Everything fits in one crate if you believe in the crate. Your test shipment happened to BE one crate, so who's to say I'm wrong?",
        lesson:
          "A starter input where one chunk equals the whole can't observe splitting at all — the killer needs at least two chunks.",
        code: `func Chunks(xs []int, size int) [][]int {
	if len(xs) == 0 || size <= 0 {
		return [][]int{}
	}
	return [][]int{xs}
}
`,
      },
      {
        id: "preallocator",
        title: "The Preallocator",
        monologue:
          "I compute the crate count up front — len divided by size, very professional. Divided by ZERO, less professional. The warehouse is on fire, but efficiently.",
        lesson:
          "Guard clauses must come BEFORE the arithmetic that needs them — a size of 0 reaches the division unless a test sends one.",
        code: `func Chunks(xs []int, size int) [][]int {
	n := (len(xs) + size - 1) / size
	out := make([][]int, 0, n)
	for i := 0; i < len(xs); i += size {
		end := i + size
		if end > len(xs) {
			end = len(xs)
		}
		crate := make([]int, end-i)
		copy(crate, xs[i:end])
		out = append(out, crate)
	}
	return out
}
`,
      },
      {
        id: "tail-thief",
        title: "The Tail Thief",
        monologue:
          "Only FULL crates leave my warehouse — standards, you understand. The three items that didn't fill a crate have been… redistributed. To me.",
        lesson:
          "\"The last chunk may run short\" only exists if a test's length is NOT divisible by size.",
        code: `func Chunks(xs []int, size int) [][]int {
	out := [][]int{}
	if size <= 0 {
		return out
	}
	for i := 0; i+size <= len(xs); i += size {
		crate := make([]int, size)
		copy(crate, xs[i:i+size])
		out = append(out, crate)
	}
	return out
}
`,
      },
      {
        id: "shadow-binder",
        title: "The Shadow Binder",
        monologue:
          "Every crate present, every count correct, every comparison green. But the crates are WINDOWS onto your warehouse, not boxes — xs[i:j] shares the backing array. Scratch one item on your shelf and watch it bleed through every manifest I filed.",
        lesson:
          "Subslices ALIAS the parent array — value equality can't see it. Mutate the input after the call and assert the output didn't move.",
        code: `func Chunks(xs []int, size int) [][]int {
	out := [][]int{}
	if size <= 0 {
		return out
	}
	for i := 0; i < len(xs); i += size {
		end := i + size
		if end > len(xs) {
			end = len(xs)
		}
		out = append(out, xs[i:end])
	}
	return out
}
`,
      },
    ],
    reference: `func Chunks(xs []int, size int) [][]int {
	out := [][]int{}
	if size <= 0 {
		return out
	}
	for i := 0; i < len(xs); i += size {
		end := i + size
		if end > len(xs) {
			end = len(xs)
		}
		crate := make([]int, end-i)
		copy(crate, xs[i:end])
		out = append(out, crate)
	}
	return out
}
`,
    killerTests: `func TestCratesAnEvenPair(t *testing.T) {
	got := Chunks([]int{1, 2}, 2)
	want := [][]int{{1, 2}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Chunks([1 2], 2) = %v, want %v", got, want)
	}
}

func TestCratesManyChunks(t *testing.T) {
	got := Chunks([]int{1, 2, 3, 4}, 2)
	want := [][]int{{1, 2}, {3, 4}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Chunks([1 2 3 4], 2) = %v, want %v", got, want)
	}
}

func TestLastCrateMayRunShort(t *testing.T) {
	got := Chunks([]int{1, 2, 3}, 2)
	want := [][]int{{1, 2}, {3}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Chunks([1 2 3], 2) = %v, want %v", got, want)
	}
}

func TestBadSizesYieldNoCrates(t *testing.T) {
	if got := Chunks([]int{1, 2, 3}, 0); !reflect.DeepEqual(got, [][]int{}) {
		t.Errorf("Chunks([1 2 3], 0) = %v, want []", got)
	}
	if got := Chunks([]int{1, 2, 3}, -2); !reflect.DeepEqual(got, [][]int{}) {
		t.Errorf("Chunks([1 2 3], -2) = %v, want []", got)
	}
}

func TestEmptyAndNilInputsYieldNoCrates(t *testing.T) {
	if got := Chunks([]int{}, 3); !reflect.DeepEqual(got, [][]int{}) {
		t.Errorf("Chunks([], 3) = %v, want []", got)
	}
	if got := Chunks(nil, 3); !reflect.DeepEqual(got, [][]int{}) {
		t.Errorf("Chunks(nil, 3) = %v, want []", got)
	}
}

func TestCratesAreIndependentCopies(t *testing.T) {
	xs := []int{1, 2, 3, 4}
	got := Chunks(xs, 2)
	if len(got) != 2 || len(got[0]) != 2 || len(got[1]) != 2 {
		t.Fatalf("Chunks([1 2 3 4], 2) has shape %v, want [[1 2] [3 4]]", got)
	}
	xs[0] = 99
	if got[0][0] != 1 {
		t.Errorf("mutating the input leaked into a crate: got[0][0] = %d, want 1", got[0][0])
	}
	got[1][0] = 42
	if xs[2] != 3 {
		t.Errorf("mutating a crate leaked into the input: xs[2] = %d, want 3", xs[2])
	}
}
`,
  },

  // ── Rank 10 · grandmaster ──────────────────────────────────────
  {
    id: "paw-go-atlas-scribe",
    title: "The Atlas Scribe",
    wish: "Write the atlas index: every key and value, always in the same order.",
    clauses: [
      "\"key=value\" pairs joined by \";\" — no spaces, no trailing separator.",
      "Keys in ascending BYTE order — case-sensitive, so \"Z\" comes before \"a\".",
      "The same map produces the same string on EVERY call — Go's map iteration order is deliberately random, and it is not your friend.",
      "An empty or nil map is an empty string.",
      "Keys may contain spaces; values may be negative.",
    ],
    signature: "func Serialize(m map[string]int) string",
    conceptTags: ["map iteration order", "determinism", "sorting", "strconv"],
    difficulty: "grandmaster",
    language: "go",
    rank: 10,
    starterTests: `func TestSerializesASingleEntry(t *testing.T) {
	if got := Serialize(map[string]int{"a": 1}); got != "a=1" {
		t.Errorf("Serialize({a:1}) = %q, want %q", got, "a=1")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The atlas has one entry: a equals one. All atlases have one entry. Cartography peaked early.",
        lesson: "One example is not a specification.",
        code: `func Serialize(m map[string]int) string {
	return "a=1"
}
`,
      },
      {
        id: "chaos-scribe",
        title: "The Chaos Scribe",
        monologue:
          "I walked the map exactly as Go handed it to me. That Go shuffles the walk ON PURPOSE, every single range, to punish scribes like me — well. Your single-entry test had only one order to shuffle. Run me twice, I dare you.",
        lesson:
          "Ranging over a Go map is randomized BY DESIGN — determinism must be built (sort the keys) and proven (assert in a loop).",
        code: `func Serialize(m map[string]int) string {
	parts := []string{}
	for k, v := range m {
		parts = append(parts, k+"="+strconv.Itoa(v))
	}
	return strings.Join(parts, ";")
}
`,
      },
      {
        id: "generous-spacer",
        title: "The Generous Spacer",
        monologue:
          "Sorted, deterministic, immaculate — and joined with \"; \" because entries deserve ROOM TO BREATHE. Your one-entry test needed no separator at all. The clause said no spaces; the suite said nothing.",
        lesson:
          "Separator clauses are invisible until two entries meet — one-element inputs never exercise the join.",
        code: `import "sort"

func Serialize(m map[string]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+strconv.Itoa(m[k]))
	}
	return strings.Join(parts, "; ")
}
`,
      },
      {
        id: "print-surgeon",
        title: "The Print Surgeon",
        monologue:
          "Why sort keys myself when fmt already prints maps sorted? A little trim here, a swap of colons there, spaces become semicolons and — the operation was a complete success. Until a key WITH A SPACE walked in, and my scalpel split it in two.",
        lesson:
          "Parsing a value's printed form back apart breaks the moment the data contains your delimiters — build strings from the data, not from debug output.",
        code: `func Serialize(m map[string]int) string {
	if len(m) == 0 {
		return ""
	}
	s := fmt.Sprint(m)
	s = strings.TrimPrefix(s, "map[")
	s = strings.TrimSuffix(s, "]")
	s = strings.ReplaceAll(s, ":", "=")
	return strings.ReplaceAll(s, " ", ";")
}
`,
      },
      {
        id: "case-leveler",
        title: "The Case Leveler",
        monologue:
          "I sorted with the good manners of a librarian — Anna beside anna, Zebra beside zebra. Alphabetical! Byte order is such a COLD way to sort… and precisely the one your clause demanded. 'Z' is 0x5A, 'a' is 0x61, and your tests never spelled either.",
        lesson:
          "\"Sorted\" hides a comparator — case-insensitive and byte-order sorts agree on same-case data, so mix the cases in a test.",
        code: `import "sort"

func Serialize(m map[string]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return strings.ToLower(keys[i]) < strings.ToLower(keys[j])
	})
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+strconv.Itoa(m[k]))
	}
	return strings.Join(parts, ";")
}
`,
      },
    ],
    reference: `import "sort"

func Serialize(m map[string]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+strconv.Itoa(m[k]))
	}
	return strings.Join(parts, ";")
}
`,
    killerTests: `func TestSerializesASingleEntry(t *testing.T) {
	if got := Serialize(map[string]int{"a": 1}); got != "a=1" {
		t.Errorf("Serialize({a:1}) = %q, want %q", got, "a=1")
	}
}

func TestJoinsWithBareSemicolons(t *testing.T) {
	got := Serialize(map[string]int{"b": 2, "a": 1})
	if got != "a=1;b=2" {
		t.Errorf("Serialize({a:1, b:2}) = %q, want %q", got, "a=1;b=2")
	}
}

func TestSameMapSameStringEveryTime(t *testing.T) {
	m := map[string]int{"delta": 4, "alpha": 1, "echo": 5, "bravo": 2, "charlie": 3, "foxtrot": 6}
	want := "alpha=1;bravo=2;charlie=3;delta=4;echo=5;foxtrot=6"
	for i := 0; i < 100; i++ {
		if got := Serialize(m); got != want {
			t.Fatalf("call %d: Serialize = %q, want %q (order must not depend on map iteration)", i, got, want)
		}
	}
}

func TestUppercaseSortsBeforeLowercase(t *testing.T) {
	got := Serialize(map[string]int{"Z": 1, "a": 2})
	if got != "Z=1;a=2" {
		t.Errorf("Serialize({Z:1, a:2}) = %q, want %q (byte order, not case-folded)", got, "Z=1;a=2")
	}
}

func TestKeysMayContainSpacesAndValuesMayBeNegative(t *testing.T) {
	got := Serialize(map[string]int{"north star": -7, "b": 2})
	if got != "b=2;north star=-7" {
		t.Errorf("Serialize({north star:-7, b:2}) = %q, want %q", got, "b=2;north star=-7")
	}
}

func TestEmptyAtlasesAreEmptyStrings(t *testing.T) {
	if got := Serialize(map[string]int{}); got != "" {
		t.Errorf("Serialize({}) = %q, want \\"\\"", got)
	}
	if got := Serialize(nil); got != "" {
		t.Errorf("Serialize(nil) = %q, want \\"\\"", got)
	}
}
`,
  },
];
