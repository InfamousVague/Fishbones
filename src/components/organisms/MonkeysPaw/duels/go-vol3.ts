/// Monkey's Paw — go duel content, volume 3. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./go.ts.
/// Verified by __tests__/duels-go-vol3.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const GO_DUELS_VOL3: readonly PawDuel[] = [
  // ── Rank 1 · novice ────────────────────────────────────────────
  {
    id: "paw-go-calendar-keeper",
    title: "The Calendar Keeper",
    wish: "Tell me whether a year gets its extra day of February.",
    clauses: [
      "A year divisible by 4 is a leap year…",
      "…UNLESS it is divisible by 100 — century years are ordinary…",
      "…UNLESS it is also divisible by 400 — those centuries leap after all. 2000 leapt; 1900 did not.",
      "Any other year is not a leap year.",
    ],
    signature: "func IsLeap(year int) bool",
    conceptTags: ["boolean logic", "divisibility", "operator precedence", "calendar rules"],
    difficulty: "novice",
    language: "go",
    rank: 1,
    starterTests: `func TestRecentLeapYear(t *testing.T) {
	if !IsLeap(2024) {
		t.Errorf("IsLeap(2024) = false, want true")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "2024 leaps. Every OTHER year I declared ordinary — a calendar of magnificent simplicity. February thanks me for the consistency.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func IsLeap(year int) bool {
	return year == 2024
}
`,
      },
      {
        id: "four-counter",
        title: "The Four Counter",
        monologue:
          "Divisible by four? Leap. The rule fits on a thumbnail. The astronomers muttered something about centuries drifting into summer, but astronomers mutter about everything.",
        lesson:
          "The easy 90% of a rule passes any test that never touches the exceptions — 1900 is the input that matters.",
        code: `func IsLeap(year int) bool {
	return year%4 == 0
}
`,
      },
      {
        id: "century-hater",
        title: "The Century Hater",
        monologue:
          "I learned the second rule! Centuries never leap. 1900? Ordinary. 2000? ALSO ordinary — I refuse to read a rule with two exceptions in it. One exception is elegant. Two is clutter.",
        lesson:
          "Nested exceptions need one test PER layer — 1900 proves the century rule, 2000 proves the 400 rule that overrides it.",
        code: `func IsLeap(year int) bool {
	return year%4 == 0 && year%100 != 0
}
`,
      },
    ],
    reference: `func IsLeap(year int) bool {
	return year%4 == 0 && (year%100 != 0 || year%400 == 0)
}
`,
    killerTests: `func TestRecentLeapYear(t *testing.T) {
	if !IsLeap(2024) {
		t.Errorf("IsLeap(2024) = false, want true")
	}
}

func TestOrdinaryYears(t *testing.T) {
	if IsLeap(2023) {
		t.Errorf("IsLeap(2023) = true, want false")
	}
	if IsLeap(2026) {
		t.Errorf("IsLeap(2026) = true, want false")
	}
}

func TestCenturiesAreOrdinary(t *testing.T) {
	if IsLeap(1900) {
		t.Errorf("IsLeap(1900) = true, want false (centuries don't leap)")
	}
	if IsLeap(2100) {
		t.Errorf("IsLeap(2100) = true, want false (centuries don't leap)")
	}
}

func TestEveryFourthCenturyLeaps(t *testing.T) {
	if !IsLeap(2000) {
		t.Errorf("IsLeap(2000) = false, want true (divisible by 400)")
	}
	if !IsLeap(1600) {
		t.Errorf("IsLeap(1600) = false, want true (divisible by 400)")
	}
}
`,
  },

  // ── Rank 2 · novice ────────────────────────────────────────────
  {
    id: "paw-go-line-unraveler",
    title: "The Line Unraveler",
    wish: "Split this text file into its lines — it might come from any operating system.",
    clauses: [
      "Lines are separated by \"\\n\"; a Windows line ends \"\\r\\n\", so a trailing \"\\r\" on a line is stripped.",
      "A final trailing newline does NOT produce a phantom empty last line.",
      "Empty input is a file with NO lines: an empty (non-nil) slice.",
      "A \"\\r\" in the MIDDLE of a line is content — only the one hugging the line break is removed.",
    ],
    signature: "func Lines(s string) []string",
    conceptTags: ["strings.Split", "CRLF vs LF", "trailing separators", "empty input"],
    difficulty: "novice",
    language: "go",
    rank: 2,
    starterTests: `func TestSplitsUnixLines(t *testing.T) {
	got := Lines("one\\ntwo")
	want := []string{"one", "two"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(%q) = %v, want %v", "one\\ntwo", got, want)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Your file says one, then two. ALL files say one, then two. I have read a file, you see, and now I have read them all.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Lines(s string) []string {
	return []string{"one", "two"}
}
`,
      },
      {
        id: "unix-purist",
        title: "The Unix Purist",
        monologue:
          "strings.Split on \\n — done before lunch. Windows files? Every line arrives wearing a little \\r tail, and the empty phantom line at the end waves hello. Real operating systems don't do that, so clearly YOUR file is at fault.",
        lesson:
          "A bare Split(s, \"\\n\") believes the whole world is LF — CRLF input and trailing newlines both need their own tests.",
        code: `func Lines(s string) []string {
	return strings.Split(s, "\\n")
}
`,
      },
      {
        id: "cr-exterminator",
        title: "The CR Exterminator",
        monologue:
          "Carriage returns, you say? I deleted EVERY \\r in the file before splitting — the ones at line ends, the ones in the middle of your data, all of them. Extermination is thorough or it is nothing.",
        lesson:
          "Strip the \\r at the line BREAK, not every \\r — a global ReplaceAll eats bytes that were content.",
        code: `func Lines(s string) []string {
	return strings.Split(strings.ReplaceAll(s, "\\r", ""), "\\n")
}
`,
      },
    ],
    reference: `func Lines(s string) []string {
	if s == "" {
		return []string{}
	}
	s = strings.TrimSuffix(s, "\\n")
	parts := strings.Split(s, "\\n")
	for i, p := range parts {
		parts[i] = strings.TrimSuffix(p, "\\r")
	}
	return parts
}
`,
    killerTests: `func TestSplitsUnixLines(t *testing.T) {
	got := Lines("one\\ntwo")
	want := []string{"one", "two"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(%q) = %v, want %v", "one\\ntwo", got, want)
	}
}

func TestSplitsWindowsLines(t *testing.T) {
	got := Lines("one\\r\\ntwo\\r\\nthree")
	want := []string{"one", "two", "three"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(CRLF file) = %q, want %q", got, want)
	}
}

func TestTrailingNewlineIsNotAPhantomLine(t *testing.T) {
	got := Lines("a\\nb\\n")
	want := []string{"a", "b"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(%q) = %q, want %q (no phantom empty last line)", "a\\nb\\n", got, want)
	}
	got = Lines("a\\r\\nb\\r\\n")
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(%q) = %q, want %q", "a\\r\\nb\\r\\n", got, want)
	}
}

func TestEmptyFileHasNoLines(t *testing.T) {
	got := Lines("")
	want := []string{}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(\\"\\") = %#v, want %#v (empty, non-nil)", got, want)
	}
}

func TestInteriorCarriageReturnIsContent(t *testing.T) {
	got := Lines("a\\rb\\nc")
	want := []string{"a\\rb", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Lines(%q) = %q, want %q (mid-line \\\\r stays)", "a\\rb\\nc", got, want)
	}
}
`,
  },

  // ── Rank 3 · apprentice ────────────────────────────────────────
  {
    id: "paw-go-label-engraver",
    title: "The Label Engraver",
    wish: "Engrave a stock label: the item's name in quotes, then its id in hex.",
    clauses: [
      "Exactly `<quoted-name> #<hex-id>` — one space before the #.",
      "The name is GO-QUOTED (fmt's %q): wrapped in double quotes with tabs, newlines, quotes and backslashes escaped, so one label always fits one line.",
      "The id prints in LOWERCASE hex, zero-padded to at least 4 digits — ids beyond 0xffff print in full.",
    ],
    signature: "func Label(name string, id int) string",
    conceptTags: ["fmt.Sprintf", "%q quoting", "%x hex", "width and padding"],
    difficulty: "apprentice",
    language: "go",
    rank: 3,
    starterTests: `func TestEngravesASimpleLabel(t *testing.T) {
	if got := Label("gem", 7); got != "\\"gem\\" #0007" {
		t.Errorf("Label(\\"gem\\", 7) = %q, want %q", got, "\\"gem\\" #0007")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One label, lovingly engraved: gem, item seven. The warehouse stocks gems and only gems. Inventory has never been simpler.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Label(name string, id int) string {
	return "\\"gem\\" #0007"
}
`,
      },
      {
        id: "decimal-clerk",
        title: "The Decimal Clerk",
        monologue:
          "%04d — padded, professional, and in the number system I learned at school. Your test id was SEVEN. Seven is seven in every base worth having. Item forty-seven will be filed under 0047, and the hex ledger will never find it.",
        lesson:
          "%d and %x agree on ids 0-9 — a starter value that reads the same in both bases proves nothing about the base.",
        code: `func Label(name string, id int) string {
	return fmt.Sprintf("%q #%04d", name, id)
}
`,
      },
      {
        id: "shouting-engraver",
        title: "The Shouting Engraver",
        monologue:
          "%04X. CAPITAL hex. It's the same number, only more confident. Your id of seven has no letters to shout with — but wait until 0x2F walks in wearing its big F.",
        lesson:
          "%x and %X differ only on digits a-f — pick a test id with a letter in it or the case is never checked.",
        code: `func Label(name string, id int) string {
	return fmt.Sprintf("%q #%04X", name, id)
}
`,
      },
      {
        id: "hand-quoter",
        title: "The Hand Quoter",
        monologue:
          "Why summon %q when two quote marks cost nothing? I glued them on by hand. Then a name arrived with a TAB inside and my one-line label grew a second line, and the scanner downstairs is still weeping.",
        lesson:
          "%q is an escaping machine, not decoration — hand-glued quotes pass every tame name and die on the first tab, quote, or backslash.",
        code: `func Label(name string, id int) string {
	return fmt.Sprintf("\\"%s\\" #%04x", name, id)
}
`,
      },
    ],
    reference: `func Label(name string, id int) string {
	return fmt.Sprintf("%q #%04x", name, id)
}
`,
    killerTests: `func TestEngravesASimpleLabel(t *testing.T) {
	if got := Label("gem", 7); got != "\\"gem\\" #0007" {
		t.Errorf("Label(\\"gem\\", 7) = %q, want %q", got, "\\"gem\\" #0007")
	}
}

func TestHexIsLowercaseAndPadded(t *testing.T) {
	if got := Label("rope", 47); got != "\\"rope\\" #002f" {
		t.Errorf("Label(\\"rope\\", 47) = %q, want %q", got, "\\"rope\\" #002f")
	}
	if got := Label("keg", 10); got != "\\"keg\\" #000a" {
		t.Errorf("Label(\\"keg\\", 10) = %q, want %q", got, "\\"keg\\" #000a")
	}
}

func TestBigIdsPrintInFull(t *testing.T) {
	if got := Label("anchor", 70000); got != "\\"anchor\\" #11170" {
		t.Errorf("Label(\\"anchor\\", 70000) = %q, want %q", got, "\\"anchor\\" #11170")
	}
}

func TestNamesAreGoQuoted(t *testing.T) {
	if got := Label("a\\tb", 47); got != "\\"a\\\\tb\\" #002f" {
		t.Errorf("Label(name with tab, 47) = %q, want %q", got, "\\"a\\\\tb\\" #002f")
	}
	if got := Label("six\\"gun", 7); got != "\\"six\\\\\\"gun\\" #0007" {
		t.Errorf("Label(name with quote, 7) = %q, want %q", got, "\\"six\\\\\\"gun\\" #0007")
	}
}
`,
  },

  // ── Rank 4 · apprentice ────────────────────────────────────────
  {
    id: "paw-go-name-gatekeeper",
    title: "The Name Gatekeeper",
    wish: "Check whether two names are the same, ignoring letter case.",
    clauses: [
      "Case is ignored: \"Gandalf\" and \"gandalf\" and \"GANDALF\" are the same name.",
      "UNICODE case, not just ASCII — \"É\" matches \"é\", and Unicode SIMPLE FOLDING applies: the long s \"ſ\" matches \"s\" (this is exactly strings.EqualFold's contract).",
      "Nothing else is forgiven: no trimming, no squeezing — \"bob \" and \"bob\" are different names.",
      "Different names are different, whatever their case.",
    ],
    signature: "func SameName(a, b string) bool",
    conceptTags: ["strings.EqualFold", "case folding", "ToLower pitfalls", "unicode"],
    difficulty: "apprentice",
    language: "go",
    rank: 4,
    starterTests: `func TestIgnoresAsciiCase(t *testing.T) {
	if !SameName("Gandalf", "gandalf") {
		t.Errorf("SameName(\\"Gandalf\\", \\"gandalf\\") = false, want true")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Gandalf may pass, in exactly the two spellings you rehearsed. Everyone else is an impostor. Security has never been tighter, or dumber.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func SameName(a, b string) bool {
	return a == "Gandalf" && b == "gandalf"
}
`,
      },
      {
        id: "ascii-leveler",
        title: "The ASCII Leveler",
        monologue:
          "I lower every byte from A to Z myself — no imports, no nonsense. Then Madame Éclair arrived with an accent TWO BYTES WIDE and my little hammer bounced right off it.",
        lesson:
          "Hand-rolled A-Z folding is byte-blind — one accented name in the suite exposes it.",
        code: `func SameName(a, b string) bool {
	lower := func(s string) string {
		out := []byte(s)
		for i := range out {
			if out[i] >= 'A' && out[i] <= 'Z' {
				out[i] += 'a' - 'A'
			}
		}
		return string(out)
	}
	return lower(a) == lower(b)
}
`,
      },
      {
        id: "tolower-clerk",
        title: "The ToLower Clerk",
        monologue:
          "strings.ToLower on both sides and compare — the textbook move. Then a scholar signed with the LONG S, \"ſtar\", and ToLower shrugged: ſ is already lowercase, nothing to do. EqualFold would have folded it to s. I am not EqualFold. I am cheaper.",
        lesson:
          "ToLower-and-compare is NOT case folding — ſ vs s (and friends) only match under EqualFold's simple fold, so test a folding pair.",
        code: `func SameName(a, b string) bool {
	return strings.ToLower(a) == strings.ToLower(b)
}
`,
      },
      {
        id: "helpful-trimmer",
        title: "The Helpful Trimmer",
        monologue:
          "EqualFold, yes — but first I dust the whitespace off both names. Trailing spaces are surely typos, and I am nothing if not FORGIVING. Your clause said no forgiveness. Your tests forgave me.",
        lesson:
          "Over-helpful normalization passes every 'matches' test — only an assertion that two ALMOST-equal names DON'T match can catch it.",
        code: `func SameName(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
`,
      },
    ],
    reference: `func SameName(a, b string) bool {
	return strings.EqualFold(a, b)
}
`,
    killerTests: `func TestIgnoresAsciiCase(t *testing.T) {
	if !SameName("Gandalf", "gandalf") {
		t.Errorf("SameName(\\"Gandalf\\", \\"gandalf\\") = false, want true")
	}
	if !SameName("BILBO", "bilbo") {
		t.Errorf("SameName(\\"BILBO\\", \\"bilbo\\") = false, want true")
	}
}

func TestIgnoresUnicodeCase(t *testing.T) {
	if !SameName("Éclair", "éclair") {
		t.Errorf("SameName(\\"Éclair\\", \\"éclair\\") = false, want true")
	}
}

func TestSimpleFoldingApplies(t *testing.T) {
	if !SameName("ſtar", "star") {
		t.Errorf("SameName(\\"ſtar\\", \\"star\\") = false, want true (long s folds to s)")
	}
}

func TestNoTrimmingEver(t *testing.T) {
	if SameName("bob ", "bob") {
		t.Errorf("SameName(\\"bob \\", \\"bob\\") = true, want false (whitespace is part of the name)")
	}
}

func TestDifferentNamesStayDifferent(t *testing.T) {
	if SameName("frodo", "sam") {
		t.Errorf("SameName(\\"frodo\\", \\"sam\\") = true, want false")
	}
}
`,
  },

  // ── Rank 5 · journeyman ────────────────────────────────────────
  {
    id: "paw-go-registry-clerk",
    title: "The Registry Clerk",
    wish: "Count how many distinct (given name, family name) pairs appear in the registry.",
    clauses: [
      "A pair is distinct by BOTH parts — (\"ann\",\"smith\") and (\"ann\",\"jones\") are two different people.",
      "Duplicates count once, however many times they appear.",
      "Names are arbitrary strings: they may be empty, contain spaces, dashes, or ANY character you might be tempted to use as a separator.",
      "An empty (or nil) registry has zero people.",
    ],
    signature: "func CountDistinct(pairs [][2]string) int",
    conceptTags: ["composite map keys", "struct/array keys", "key collisions", "sets"],
    difficulty: "journeyman",
    language: "go",
    rank: 5,
    starterTests: `func TestCountsDistinctPairs(t *testing.T) {
	pairs := [][2]string{{"ann", "smith"}, {"bob", "jones"}, {"ann", "smith"}}
	if got := CountDistinct(pairs); got != 2 {
		t.Errorf("CountDistinct = %d, want 2", got)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The census is complete: TWO citizens. It was two last year and it shall be two forever. Population control at its finest.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func CountDistinct(pairs [][2]string) int {
	return 2
}
`,
      },
      {
        id: "first-name-clerk",
        title: "The First-Name Clerk",
        monologue:
          "I filed everyone by given name — friendlier that way. Ann Smith and Ann Jones are clearly the same delightful Ann. She gets ONE census entry and, presumably, both tax bills.",
        lesson:
          "Half a key looks whole when the test data never shares that half — collide the first components on purpose.",
        code: `func CountDistinct(pairs [][2]string) int {
	seen := map[string]bool{}
	for _, p := range pairs {
		seen[p[0]] = true
	}
	return len(seen)
}
`,
      },
      {
        id: "gluer",
        title: "The Gluer",
        monologue:
          "First name plus family name, mashed into one string — a composite key, very modern. Then (\"ab\",\"c\") and (\"a\",\"bc\") both filed themselves under \"abc\" and shared a single ration book. The glue holds TOO well.",
        lesson:
          "Concatenation destroys the boundary between key parts — (\"ab\",\"c\") vs (\"a\",\"bc\") is the canonical collision test.",
        code: `func CountDistinct(pairs [][2]string) int {
	seen := map[string]bool{}
	for _, p := range pairs {
		seen[p[0]+p[1]] = true
	}
	return len(seen)
}
`,
      },
      {
        id: "dash-splicer",
        title: "The Dash Splicer",
        monologue:
          "I learned from the Gluer — a SEPARATOR between the parts! A dash, elegant and unambiguous. Unless a name contains a dash. Names contain dashes. (\"x-\",\"y\") and (\"x\",\"-y\") now share a bunk.",
        lesson:
          "Any in-band separator can appear in the data — the collision just moves. Go's answer is a struct or array key: no separator at all.",
        code: `func CountDistinct(pairs [][2]string) int {
	seen := map[string]bool{}
	for _, p := range pairs {
		seen[p[0]+"-"+p[1]] = true
	}
	return len(seen)
}
`,
      },
    ],
    reference: `func CountDistinct(pairs [][2]string) int {
	seen := map[[2]string]struct{}{}
	for _, p := range pairs {
		seen[p] = struct{}{}
	}
	return len(seen)
}
`,
    killerTests: `func TestCountsDistinctPairs(t *testing.T) {
	pairs := [][2]string{{"ann", "smith"}, {"bob", "jones"}, {"ann", "smith"}}
	if got := CountDistinct(pairs); got != 2 {
		t.Errorf("CountDistinct = %d, want 2", got)
	}
}

func TestBothPartsMakeTheIdentity(t *testing.T) {
	pairs := [][2]string{{"ann", "smith"}, {"ann", "jones"}, {"bo", "smith"}}
	if got := CountDistinct(pairs); got != 3 {
		t.Errorf("CountDistinct(ann smith / ann jones / bo smith) = %d, want 3", got)
	}
}

func TestGluedKeysCollide(t *testing.T) {
	pairs := [][2]string{{"ab", "c"}, {"a", "bc"}}
	if got := CountDistinct(pairs); got != 2 {
		t.Errorf("CountDistinct((ab,c),(a,bc)) = %d, want 2 (concatenation must not merge them)", got)
	}
}

func TestSeparatorsLiveInsideNames(t *testing.T) {
	pairs := [][2]string{{"x-", "y"}, {"x", "-y"}}
	if got := CountDistinct(pairs); got != 2 {
		t.Errorf("CountDistinct((x-,y),(x,-y)) = %d, want 2 (dashes are data, not delimiters)", got)
	}
}

func TestEmptyRegistry(t *testing.T) {
	if got := CountDistinct([][2]string{}); got != 0 {
		t.Errorf("CountDistinct(empty) = %d, want 0", got)
	}
	if got := CountDistinct(nil); got != 0 {
		t.Errorf("CountDistinct(nil) = %d, want 0", got)
	}
}
`,
  },

  // ── Rank 6 · journeyman ────────────────────────────────────────
  {
    id: "paw-go-caravan-weigher",
    title: "The Caravan Weigher",
    wish: "Weigh every run of k consecutive crates in the caravan.",
    clauses: [
      "One sum per WINDOW of k consecutive values, left to right — len(xs)-k+1 sums in all.",
      "k of zero or less, or k longer than the caravan: NO windows — an empty, non-nil slice. Never panic.",
      "Crates can weigh negative amounts (helium is real).",
      "The caravan manifest (the input slice) must be EXACTLY as you found it after the weighing — scratch paper is your own problem.",
    ],
    signature: "func WindowSums(xs []int, k int) []int",
    conceptTags: ["sliding window", "bounds guards", "input immutability", "rolling sums"],
    difficulty: "journeyman",
    language: "go",
    rank: 6,
    starterTests: `func TestWeighsTheWholeCaravan(t *testing.T) {
	got := WindowSums([]int{2, 3, 4}, 3)
	want := []int{9}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("WindowSums([2 3 4], 3) = %v, want %v", got, want)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Nine. The caravan weighs nine. All caravans weigh nine — it's a very standardized industry.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func WindowSums(xs []int, k int) []int {
	return []int{9}
}
`,
      },
      {
        id: "one-window-wonder",
        title: "The One-Window Wonder",
        monologue:
          "I summed the ENTIRE caravan and called it a window. Your test's window happened to BE the entire caravan, so who could tell? Sliding is for people whose first window disappoints.",
        lesson:
          "A starter where the window spans the whole input can't observe sliding — the killer needs at least two windows.",
        code: `func WindowSums(xs []int, k int) []int {
	if k <= 0 || k > len(xs) {
		return []int{}
	}
	sum := 0
	for _, v := range xs {
		sum += v
	}
	return []int{sum}
}
`,
      },
      {
        id: "unguarded-weigher",
        title: "The Unguarded Weigher",
        monologue:
          "My sliding is impeccable — window after window, sums without blemish. Then someone requested windows of size ZERO and I solemnly produced a parade of empty weighings, one more than there are crates. You never told me zero was absurd. Not in a test, anyway.",
        lesson:
          "Degenerate sizes (0, negative) take the code down paths the happy case never touches — guards only exist if a test demands them.",
        code: `func WindowSums(xs []int, k int) []int {
	out := []int{}
	if k > len(xs) {
		return out
	}
	for i := 0; i+k <= len(xs); i++ {
		sum := 0
		for j := i; j < i+k; j++ {
			sum += xs[j]
		}
		out = append(out, sum)
	}
	return out
}
`,
      },
      {
        id: "manifest-vandal",
        title: "The Manifest Vandal",
        monologue:
          "Rolling prefix sums — O(n), gorgeous. I computed them IN PLACE, right on top of your manifest. Every answer correct, every crate now labeled with a running total. The next clerk to read your caravan will weep, but that's the next clerk.",
        lesson:
          "Correct output can hide a trashed input — assert the input slice is untouched after the call.",
        code: `func WindowSums(xs []int, k int) []int {
	out := []int{}
	if k <= 0 || k > len(xs) {
		return out
	}
	for i := 1; i < len(xs); i++ {
		xs[i] += xs[i-1]
	}
	out = append(out, xs[k-1])
	for i := k; i < len(xs); i++ {
		out = append(out, xs[i]-xs[i-k])
	}
	return out
}
`,
      },
    ],
    reference: `func WindowSums(xs []int, k int) []int {
	out := []int{}
	if k <= 0 || k > len(xs) {
		return out
	}
	sum := 0
	for i := 0; i < k; i++ {
		sum += xs[i]
	}
	out = append(out, sum)
	for i := k; i < len(xs); i++ {
		sum += xs[i] - xs[i-k]
		out = append(out, sum)
	}
	return out
}
`,
    killerTests: `func TestWeighsTheWholeCaravan(t *testing.T) {
	got := WindowSums([]int{2, 3, 4}, 3)
	want := []int{9}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("WindowSums([2 3 4], 3) = %v, want %v", got, want)
	}
}

func TestSlidesAcrossTheCaravan(t *testing.T) {
	got := WindowSums([]int{1, 2, 3, 4}, 2)
	want := []int{3, 5, 7}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("WindowSums([1 2 3 4], 2) = %v, want %v", got, want)
	}
}

func TestHeliumCrates(t *testing.T) {
	got := WindowSums([]int{5, -2, 7}, 2)
	want := []int{3, 5}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("WindowSums([5 -2 7], 2) = %v, want %v", got, want)
	}
}

func TestAbsurdWindowSizes(t *testing.T) {
	empty := []int{}
	if got := WindowSums([]int{1, 2, 3}, 0); !reflect.DeepEqual(got, empty) {
		t.Errorf("WindowSums([1 2 3], 0) = %v, want []", got)
	}
	if got := WindowSums([]int{1, 2, 3}, -2); !reflect.DeepEqual(got, empty) {
		t.Errorf("WindowSums([1 2 3], -2) = %v, want []", got)
	}
	if got := WindowSums([]int{1, 2}, 5); !reflect.DeepEqual(got, empty) {
		t.Errorf("WindowSums([1 2], 5) = %v, want []", got)
	}
	if got := WindowSums(nil, 2); !reflect.DeepEqual(got, empty) {
		t.Errorf("WindowSums(nil, 2) = %v, want []", got)
	}
}

func TestTheManifestSurvives(t *testing.T) {
	xs := []int{4, 1, 3, 2}
	WindowSums(xs, 2)
	if !reflect.DeepEqual(xs, []int{4, 1, 3, 2}) {
		t.Errorf("input slice was modified: %v, want [4 1 3 2]", xs)
	}
}
`,
  },

  // ── Rank 7 · master ────────────────────────────────────────────
  {
    id: "paw-go-trail-joiner",
    title: "The Trail Joiner",
    wish: "Join a directory and a name into one trail.",
    clauses: [
      "Exactly ONE \"/\" at the seam, however many slashes each side brought: \"camp/\" + \"/east\" is \"camp/east\", and so is \"camp//\" + \"east\".",
      "If either side is empty, the other comes back VERBATIM — \"camp/\" stays \"camp/\"; no seam is made. Both empty: \"\".",
      "NO cleaning beyond the seam: \"..\" and \".\" are ordinary names (\"a/..\" + \"b\" is \"a/../b\"), and doubled slashes INSIDE a segment survive (\"a//b\" + \"c\" is \"a//b/c\"). path.Join is helpful; this contract is not.",
      "Joining under the root works: \"/\" + \"logs\" is \"/logs\".",
    ],
    signature: "func JoinTrail(dir, name string) string",
    conceptTags: ["path joining", "seam slashes", "path.Join cleaning", "verbatim segments"],
    difficulty: "master",
    language: "go",
    rank: 7,
    starterTests: `func TestJoinsASimpleTrail(t *testing.T) {
	if got := JoinTrail("maps", "east"); got != "maps/east" {
		t.Errorf("JoinTrail(\\"maps\\", \\"east\\") = %q, want %q", got, "maps/east")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "maps/east. All trails lead to maps/east. The cartographers wept, but briefly, for they too were sent to maps/east.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func JoinTrail(dir, name string) string {
	return "maps/east"
}
`,
      },
      {
        id: "blind-gluer",
        title: "The Blind Gluer",
        monologue:
          "Directory, slash, name — glued. When the directory arrives already WEARING a slash, it now wears two, side by side, like suspenders and a belt. And an empty directory? Your trail begins with a slash into nowhere. Nowhere is lovely this time of year.",
        lesson:
          "Naive concatenation trusts both sides to arrive bare — seams need tests where the slash is already there, and where a side is empty.",
        code: `func JoinTrail(dir, name string) string {
	return dir + "/" + name
}
`,
      },
      {
        id: "path-cleaner",
        title: "The Path Cleaner",
        monologue:
          "path.Join — the standard library's own trail-master! It joins, it tidies, it CLEANS. Your \"a/..\" folded into thin air, your inner double slash was ironed flat, and your trailing-slash directory came back without it. I did not join your trail; I EDITED it. The library said I could.",
        lesson:
          "path.Join Cleans as it joins — \"..\", \".\", and doubled slashes don't survive it. A verbatim contract needs tests that Clean would rewrite.",
        code: `import "path"

func JoinTrail(dir, name string) string {
	return path.Join(dir, name)
}
`,
      },
      {
        id: "seam-nibbler",
        title: "The Seam Nibbler",
        monologue:
          "TrimSuffix one slash off the directory, TrimPrefix one slash off the name — surgical. Then a directory swaggered in ending with TWO slashes, I nibbled exactly one, and the seam still buckled. I brought a nail file to a hedge.",
        lesson:
          "TrimSuffix/TrimPrefix remove at most ONE occurrence — hoarded seam slashes need TrimRight/TrimLeft, and a test with \"//\" to prove it.",
        code: `func JoinTrail(dir, name string) string {
	if dir == "" {
		return name
	}
	if name == "" {
		return dir
	}
	return strings.TrimSuffix(dir, "/") + "/" + strings.TrimPrefix(name, "/")
}
`,
      },
    ],
    reference: `func JoinTrail(dir, name string) string {
	if dir == "" {
		return name
	}
	if name == "" {
		return dir
	}
	return strings.TrimRight(dir, "/") + "/" + strings.TrimLeft(name, "/")
}
`,
    killerTests: `func TestJoinsASimpleTrail(t *testing.T) {
	if got := JoinTrail("maps", "east"); got != "maps/east" {
		t.Errorf("JoinTrail(\\"maps\\", \\"east\\") = %q, want %q", got, "maps/east")
	}
}

func TestJoinsOtherTrails(t *testing.T) {
	if got := JoinTrail("camp", "west"); got != "camp/west" {
		t.Errorf("JoinTrail(\\"camp\\", \\"west\\") = %q, want %q", got, "camp/west")
	}
}

func TestOneSlashAtTheSeam(t *testing.T) {
	if got := JoinTrail("camp/", "east"); got != "camp/east" {
		t.Errorf("JoinTrail(\\"camp/\\", \\"east\\") = %q, want %q", got, "camp/east")
	}
	if got := JoinTrail("camp", "/east"); got != "camp/east" {
		t.Errorf("JoinTrail(\\"camp\\", \\"/east\\") = %q, want %q", got, "camp/east")
	}
	if got := JoinTrail("camp/", "/east"); got != "camp/east" {
		t.Errorf("JoinTrail(\\"camp/\\", \\"/east\\") = %q, want %q", got, "camp/east")
	}
}

func TestSeamHoardsAreFlattened(t *testing.T) {
	if got := JoinTrail("camp//", "east"); got != "camp/east" {
		t.Errorf("JoinTrail(\\"camp//\\", \\"east\\") = %q, want %q", got, "camp/east")
	}
	if got := JoinTrail("camp", "//east"); got != "camp/east" {
		t.Errorf("JoinTrail(\\"camp\\", \\"//east\\") = %q, want %q", got, "camp/east")
	}
}

func TestEmptySidesComeBackVerbatim(t *testing.T) {
	if got := JoinTrail("", "east"); got != "east" {
		t.Errorf("JoinTrail(\\"\\", \\"east\\") = %q, want %q", got, "east")
	}
	if got := JoinTrail("camp/", ""); got != "camp/" {
		t.Errorf("JoinTrail(\\"camp/\\", \\"\\") = %q, want %q (verbatim, not cleaned)", got, "camp/")
	}
	if got := JoinTrail("", ""); got != "" {
		t.Errorf("JoinTrail(\\"\\", \\"\\") = %q, want \\"\\"", got)
	}
}

func TestNoCleaningEver(t *testing.T) {
	if got := JoinTrail("a/..", "b"); got != "a/../b" {
		t.Errorf("JoinTrail(\\"a/..\\", \\"b\\") = %q, want %q (dots are names, not directives)", got, "a/../b")
	}
	if got := JoinTrail("a//b", "c"); got != "a//b/c" {
		t.Errorf("JoinTrail(\\"a//b\\", \\"c\\") = %q, want %q (inner slashes survive)", got, "a//b/c")
	}
}

func TestRootedTrails(t *testing.T) {
	if got := JoinTrail("/", "logs"); got != "/logs" {
		t.Errorf("JoinTrail(\\"/\\", \\"logs\\") = %q, want %q", got, "/logs")
	}
}
`,
  },

  // ── Rank 8 · master ────────────────────────────────────────────
  {
    id: "paw-go-censor-stamp",
    title: "The Censor's Stamp",
    wish: "Stamp out every digit in this document.",
    clauses: [
      "Every ASCII digit 0-9 becomes '#'.",
      "The stamp lands IN PLACE: the caller's buffer itself is changed, and the returned slice is that SAME buffer — not a copy.",
      "Every non-digit byte is untouched — including each byte of multi-byte runes and bytes that aren't valid UTF-8 at all. Work in bytes, not runes.",
      "nil or empty documents come back as-is; never panic.",
    ],
    signature: "func Redact(doc []byte) []byte",
    conceptTags: ["[]byte mutation", "in-place algorithms", "UTF-8 round-trip traps", "aliasing"],
    difficulty: "master",
    language: "go",
    rank: 8,
    starterTests: `func TestStampsADigit(t *testing.T) {
	got := Redact([]byte("cell 7"))
	if string(got) != "cell #" {
		t.Errorf("Redact(\\"cell 7\\") = %q, want %q", string(got), "cell #")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The document now reads \"cell #\". ALL documents now read \"cell #\". State secrets have never been safer, or shorter.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Redact(doc []byte) []byte {
	return []byte("cell #")
}
`,
      },
      {
        id: "first-blood",
        title: "The First Blood",
        monologue:
          "I found a digit and I STAMPED it. Gloriously. Decisively. Then I went home. Your test had one digit; how was I to know documents could contain TWO? \"agent 007\" left my office as \"agent #07\", which frankly reads like a demotion.",
        lesson:
          "A starter with a single occurrence can't tell \"replace one\" from \"replace all\" — the killer needs a document with several digits.",
        code: `func Redact(doc []byte) []byte {
	for i, b := range doc {
		if b >= '0' && b <= '9' {
			doc[i] = '#'
			break
		}
	}
	return doc
}
`,
      },
      {
        id: "launderer",
        title: "The Launderer",
        monologue:
          "I convert to string, run it through strings.Map — so idiomatic! — and hand back fresh bytes. Your ORIGINAL document is pristine, unstamped, still leaking digits. And Map decodes runes: the raw 0xff byte in your file came back as THREE bytes of replacement character. I redacted your document into a different document.",
        lesson:
          "String round-trips allocate a new buffer AND re-decode UTF-8 — invalid bytes become U+FFFD. In-place byte work needs a []byte loop, and a test with a raw byte.",
        code: `func Redact(doc []byte) []byte {
	clean := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return '#'
		}
		return r
	}, string(doc))
	return []byte(clean)
}
`,
      },
      {
        id: "copyist",
        title: "The Copyist",
        monologue:
          "Byte by byte into a brand-new buffer, every digit stamped, every rune intact, even your weird raw bytes preserved. A flawless FACSIMILE. The original? Untouched, as any archivist would insist. Your clause insisted otherwise, but clauses aren't tests, are they?",
        lesson:
          "\"In place\" is an identity clause — assert the CALLER's buffer changed (and that the returned slice shares its storage), not just the returned values.",
        code: `func Redact(doc []byte) []byte {
	out := make([]byte, len(doc))
	for i, b := range doc {
		if b >= '0' && b <= '9' {
			out[i] = '#'
		} else {
			out[i] = b
		}
	}
	return out
}
`,
      },
    ],
    reference: `func Redact(doc []byte) []byte {
	for i, b := range doc {
		if b >= '0' && b <= '9' {
			doc[i] = '#'
		}
	}
	return doc
}
`,
    killerTests: `func TestStampsADigit(t *testing.T) {
	got := Redact([]byte("cell 7"))
	if string(got) != "cell #" {
		t.Errorf("Redact(\\"cell 7\\") = %q, want %q", string(got), "cell #")
	}
}

func TestStampsEveryDigit(t *testing.T) {
	got := Redact([]byte("agent 007"))
	if string(got) != "agent ###" {
		t.Errorf("Redact(\\"agent 007\\") = %q, want %q", string(got), "agent ###")
	}
}

func TestStampsTheCallersBuffer(t *testing.T) {
	buf := []byte("a1b2")
	got := Redact(buf)
	if string(buf) != "a#b#" {
		t.Errorf("caller's buffer = %q, want %q (must be stamped in place)", string(buf), "a#b#")
	}
	if len(got) != 4 {
		t.Fatalf("Redact returned %d bytes, want 4", len(got))
	}
	got[0] = 'Z'
	if buf[0] != 'Z' {
		t.Errorf("returned slice is not the caller's buffer (mutating it left the buffer at %q)", buf[0])
	}
}

func TestLeavesOtherBytesAlone(t *testing.T) {
	got := Redact([]byte("héllo!"))
	if string(got) != "héllo!" {
		t.Errorf("Redact(\\"héllo!\\") = %q, want %q", string(got), "héllo!")
	}
}

func TestRawBytesSurvive(t *testing.T) {
	buf := []byte{0xff, '5', 0xfe}
	got := Redact(buf)
	if !reflect.DeepEqual(got, []byte{0xff, '#', 0xfe}) {
		t.Errorf("Redact([0xff '5' 0xfe]) = %v, want [255 35 254] (raw bytes must survive)", got)
	}
}

func TestEmptyDocs(t *testing.T) {
	if got := Redact([]byte{}); len(got) != 0 {
		t.Errorf("Redact(empty) = %v, want empty", got)
	}
	if got := Redact(nil); len(got) != 0 {
		t.Errorf("Redact(nil) = %v, want empty", got)
	}
}
`,
  },

  // ── Rank 9 · grandmaster ───────────────────────────────────────
  {
    id: "paw-go-hourglass-clerk",
    title: "The Hourglass Clerk",
    wish: "Write this duration on the watch log as hours and minutes.",
    clauses: [
      "\"H:MM\" — whole hours with no padding and no cap (25 hours is \"25:00\"), then minutes 00-59, zero-padded.",
      "Leftover seconds are DROPPED, never rounded: 1h59m59s is \"1:59\", and 30s is \"0:00\".",
      "Negative durations wear ONE leading minus and format their magnitude: -90 minutes is \"-1:30\". Go's % keeps the dividend's sign — mind it.",
      "Zero is \"0:00\".",
    ],
    signature: "func Clock(d time.Duration) string",
    conceptTags: ["time.Duration", "integer division", "float rounding traps", "negative modulo"],
    difficulty: "grandmaster",
    language: "go",
    rank: 9,
    starterTests: `func TestClocksAnHourAndAHalf(t *testing.T) {
	if got := Clock(90 * time.Minute); got != "1:30" {
		t.Errorf("Clock(90m) = %q, want %q", got, "1:30")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The log reads 1:30. It is always 1:30 somewhere, and specifically it is always 1:30 HERE.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Clock(d time.Duration) string {
	return "1:30"
}
`,
      },
      {
        id: "float-rounder",
        title: "The Float Rounder",
        monologue:
          "d.Minutes() gives me a lovely float and math.Round tidies it up. One hour, fifty-nine minutes, fifty-nine seconds? That's PRACTICALLY two hours — rounded, filed, done. The clause said dropped, not \"negotiated upward\". And don't ask what Round did to the negative shifts.",
        lesson:
          "Duration formatting is integer work — d / time.Minute truncates by construction; a float detour rounds, and 59 leftover seconds expose it.",
        code: `import "math"

func Clock(d time.Duration) string {
	mins := int(math.Round(d.Minutes()))
	return fmt.Sprintf("%d:%02d", mins/60, mins%60)
}
`,
      },
      {
        id: "sign-oblivious",
        title: "The Sign Oblivious",
        monologue:
          "Divide by sixty, modulo sixty, print — arithmetic so clean it squeaks. Then a NEGATIVE shift arrived and Go's remainder, loyal to its dividend, handed me minus thirty minutes. The log now reads \"-1:-30\", a time that occurs nowhere in this universe.",
        lesson:
          "In Go, (-90)%60 is -30 — pull the sign out first, format the magnitude, and test a negative duration to force it.",
        code: `func Clock(d time.Duration) string {
	mins := int(d / time.Minute)
	return fmt.Sprintf("%d:%02d", mins/60, mins%60)
}
`,
      },
      {
        id: "day-turner",
        title: "The Day Turner",
        monologue:
          "Hours modulo twenty-four, of course — hours WRAP, everyone knows that, it's how clocks WORK. Your twenty-five hour vigil is logged as a brisk 1:00. The night watch thanks me for the flattering arithmetic.",
        lesson:
          "This is a duration, not a wall clock — no wrapping. Only a test past 24 hours distinguishes elapsed time from clock time.",
        code: `func Clock(d time.Duration) string {
	sign := ""
	if d < 0 {
		sign = "-"
		d = -d
	}
	mins := int(d / time.Minute)
	return fmt.Sprintf("%s%d:%02d", sign, (mins/60)%24, mins%60)
}
`,
      },
      {
        id: "pad-skipper",
        title: "The Pad Skipper",
        monologue:
          "Signs handled, seconds dropped, hours uncapped — I am ALMOST unimprovable. I print minutes with %d because %02d felt fussy. One hour and five minutes: \"1:5\". It's the same information! Fewer characters! The parser downstream disagrees, but parsers are drama queens.",
        lesson:
          "\"1:5\" and \"1:05\" agree whenever minutes have two digits — padding clauses need a single-digit-minute test.",
        code: `func Clock(d time.Duration) string {
	sign := ""
	if d < 0 {
		sign = "-"
		d = -d
	}
	mins := int(d / time.Minute)
	return fmt.Sprintf("%s%d:%d", sign, mins/60, mins%60)
}
`,
      },
    ],
    reference: `func Clock(d time.Duration) string {
	sign := ""
	if d < 0 {
		sign = "-"
		d = -d
	}
	mins := int(d / time.Minute)
	return fmt.Sprintf("%s%d:%02d", sign, mins/60, mins%60)
}
`,
    killerTests: `func TestClocksAnHourAndAHalf(t *testing.T) {
	if got := Clock(90 * time.Minute); got != "1:30" {
		t.Errorf("Clock(90m) = %q, want %q", got, "1:30")
	}
}

func TestPadsSingleDigitMinutes(t *testing.T) {
	if got := Clock(65 * time.Minute); got != "1:05" {
		t.Errorf("Clock(65m) = %q, want %q", got, "1:05")
	}
	if got := Clock(0); got != "0:00" {
		t.Errorf("Clock(0) = %q, want %q", got, "0:00")
	}
}

func TestDropsLeftoverSeconds(t *testing.T) {
	d := time.Hour + 59*time.Minute + 59*time.Second
	if got := Clock(d); got != "1:59" {
		t.Errorf("Clock(1h59m59s) = %q, want %q (drop seconds, never round)", got, "1:59")
	}
	if got := Clock(30 * time.Second); got != "0:00" {
		t.Errorf("Clock(30s) = %q, want %q", got, "0:00")
	}
}

func TestNegativeDurations(t *testing.T) {
	if got := Clock(-90 * time.Minute); got != "-1:30" {
		t.Errorf("Clock(-90m) = %q, want %q", got, "-1:30")
	}
	if got := Clock(-(2*time.Hour + 5*time.Minute)); got != "-2:05" {
		t.Errorf("Clock(-2h5m) = %q, want %q", got, "-2:05")
	}
}

func TestLongWatchesDoNotWrap(t *testing.T) {
	if got := Clock(25 * time.Hour); got != "25:00" {
		t.Errorf("Clock(25h) = %q, want %q (durations don't wrap at midnight)", got, "25:00")
	}
	if got := Clock(48*time.Hour + 30*time.Minute); got != "48:30" {
		t.Errorf("Clock(48h30m) = %q, want %q", got, "48:30")
	}
}
`,
  },

  // ── Rank 10 · grandmaster ──────────────────────────────────────
  {
    id: "paw-go-placeholder-herald",
    title: "The Placeholder Herald",
    wish: "Read out the proclamation, filling in the blanks from my ledger.",
    clauses: [
      "\"{key}\" is replaced by vars[key], and the SAME key may appear many times — every appearance is filled.",
      "ONE pass, left to right: replacement values are LITERAL text — a value containing \"{other}\" is NOT expanded again. strings.ReplaceAll in a loop cascades; a scanner does not.",
      "Unknown keys keep their braces: \"{ghost}\" stays \"{ghost}\" when the ledger has no ghost.",
      "A \"{\" that never finds its \"}\" is ordinary text — read it out, don't panic.",
    ],
    signature: "func Expand(tmpl string, vars map[string]string) string",
    conceptTags: ["template expansion", "single-pass scanning", "ReplaceAll cascades", "unmatched delimiters"],
    difficulty: "grandmaster",
    language: "go",
    rank: 10,
    starterTests: `func TestExpandsAPlaceholder(t *testing.T) {
	got := Expand("hail {king}", map[string]string{"king": "rex"})
	if got != "hail rex" {
		t.Errorf("Expand = %q, want %q", got, "hail rex")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "HAIL REX. Every proclamation, every ledger, every occasion: hail rex. The king is flattered. The king is also suspicious.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Expand(tmpl string, vars map[string]string) string {
	return "hail rex"
}
`,
      },
      {
        id: "one-trick",
        title: "The One-Trick",
        monologue:
          "I find the first blank, I fill the first blank, I take my bow. Your proclamation had ONE blank — a masterpiece of restraint. The treaty this morning had four, and I announced three of them as literal wall decorations.",
        lesson:
          "\"Every appearance\" is a loop clause — one placeholder can't test it; two can.",
        code: `func Expand(tmpl string, vars map[string]string) string {
	i := strings.IndexByte(tmpl, '{')
	if i < 0 {
		return tmpl
	}
	j := strings.IndexByte(tmpl[i:], '}')
	if j < 0 {
		return tmpl
	}
	key := tmpl[i+1 : i+j]
	v, ok := vars[key]
	if !ok {
		return tmpl
	}
	return tmpl[:i] + v + tmpl[i+j+1:]
}
`,
      },
      {
        id: "cascade-crier",
        title: "The Cascade Crier",
        monologue:
          "strings.ReplaceAll, once per ledger entry — five lines, industrial efficiency! But each pass reads what the LAST pass wrote: a filled-in value that happens to contain braces gets expanded AGAIN by the next key's pass. Your proclamation quoted the ledger; my megaphone recursed into it. And the map decides the order. The MAP.",
        lesson:
          "Sequential ReplaceAll re-scans its own output — values must be literal, so test a value that LOOKS like a placeholder and assert it survives.",
        code: `func Expand(tmpl string, vars map[string]string) string {
	for k, v := range vars {
		tmpl = strings.ReplaceAll(tmpl, "{"+k+"}", v)
	}
	return tmpl
}
`,
      },
      {
        id: "ghost-eraser",
        title: "The Ghost Eraser",
        monologue:
          "A proper left-to-right scanner — I'm rather proud. For each blank I look up the ledger and read out vars[key]. If the key isn't THERE, Go's map politely hands me an empty string, and I read that out too. With gusto. Your \"{ghost}\" was announced as a respectful silence.",
        lesson:
          "Go's zero-value map lookups hide misses — use the comma-ok form, and test an unknown key to force the difference between \"empty\" and \"absent\".",
        code: `func Expand(tmpl string, vars map[string]string) string {
	var b strings.Builder
	i := 0
	for i < len(tmpl) {
		if tmpl[i] != '{' {
			b.WriteByte(tmpl[i])
			i++
			continue
		}
		j := strings.IndexByte(tmpl[i+1:], '}')
		if j < 0 {
			b.WriteString(tmpl[i:])
			break
		}
		b.WriteString(vars[tmpl[i+1:i+1+j]])
		i += j + 2
	}
	return b.String()
}
`,
      },
      {
        id: "bracket-muddler",
        title: "The Bracket Muddler",
        monologue:
          "Scanner, comma-ok lookups, verbatim unknowns — the full ceremony, twice-checked. Except I never asked what happens when a \"{\" has no \"}\". IndexByte answered -1, my slice arithmetic answered tmpl[i+1:i], and the runtime answered with a panic, mid-proclamation, in front of EVERYONE.",
        lesson:
          "Every IndexByte can return -1 — unmatched-delimiter inputs walk straight into slice-bounds panics unless a test sends one first.",
        code: `func Expand(tmpl string, vars map[string]string) string {
	var b strings.Builder
	i := 0
	for i < len(tmpl) {
		if tmpl[i] != '{' {
			b.WriteByte(tmpl[i])
			i++
			continue
		}
		j := strings.IndexByte(tmpl[i+1:], '}')
		key := tmpl[i+1 : i+1+j]
		if v, ok := vars[key]; ok {
			b.WriteString(v)
		} else {
			b.WriteString(tmpl[i : i+2+j])
		}
		i += j + 2
	}
	return b.String()
}
`,
      },
    ],
    reference: `func Expand(tmpl string, vars map[string]string) string {
	var b strings.Builder
	i := 0
	for i < len(tmpl) {
		if tmpl[i] != '{' {
			b.WriteByte(tmpl[i])
			i++
			continue
		}
		j := strings.IndexByte(tmpl[i+1:], '}')
		if j < 0 {
			b.WriteString(tmpl[i:])
			break
		}
		key := tmpl[i+1 : i+1+j]
		if v, ok := vars[key]; ok {
			b.WriteString(v)
		} else {
			b.WriteString(tmpl[i : i+2+j])
		}
		i += j + 2
	}
	return b.String()
}
`,
    killerTests: `func TestExpandsAPlaceholder(t *testing.T) {
	got := Expand("hail {king}", map[string]string{"king": "rex"})
	if got != "hail rex" {
		t.Errorf("Expand = %q, want %q", got, "hail rex")
	}
}

func TestExpandsEveryPlaceholder(t *testing.T) {
	got := Expand("to {a} and {b}", map[string]string{"a": "x", "b": "y"})
	if got != "to x and y" {
		t.Errorf("Expand = %q, want %q", got, "to x and y")
	}
}

func TestRepeatedKeys(t *testing.T) {
	got := Expand("{x} {x}", map[string]string{"x": "echo"})
	if got != "echo echo" {
		t.Errorf("Expand = %q, want %q", got, "echo echo")
	}
}

func TestUnknownKeysKeepTheirBraces(t *testing.T) {
	got := Expand("boo {ghost}", map[string]string{})
	if got != "boo {ghost}" {
		t.Errorf("Expand = %q, want %q", got, "boo {ghost}")
	}
	got = Expand("{ghost} & {king}", map[string]string{"king": "rex"})
	if got != "{ghost} & rex" {
		t.Errorf("Expand = %q, want %q", got, "{ghost} & rex")
	}
}

func TestValuesAreLiteralText(t *testing.T) {
	got := Expand("{a}{b}", map[string]string{"a": "{b}", "b": "{a}"})
	if got != "{b}{a}" {
		t.Errorf("Expand = %q, want %q (values must not be re-expanded)", got, "{b}{a}")
	}
}

func TestLoneBraceIsOrdinaryText(t *testing.T) {
	got := Expand("smile {", map[string]string{})
	if got != "smile {" {
		t.Errorf("Expand = %q, want %q", got, "smile {")
	}
	got = Expand("{a} {", map[string]string{"a": "x"})
	if got != "x {" {
		t.Errorf("Expand = %q, want %q", got, "x {")
	}
}

func TestPlainTextPassesThrough(t *testing.T) {
	got := Expand("no magic", map[string]string{"a": "x"})
	if got != "no magic" {
		t.Errorf("Expand = %q, want %q", got, "no magic")
	}
	if got := Expand("", map[string]string{}); got != "" {
		t.Errorf("Expand(\\"\\") = %q, want \\"\\"", got)
	}
}
`,
  },
];
