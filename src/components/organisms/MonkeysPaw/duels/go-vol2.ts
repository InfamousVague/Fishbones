/// Monkey's Paw — go duel content, volume 2. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./go.ts.
/// Verified by __tests__/duels-go-vol2.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const GO_DUELS_VOL2: readonly PawDuel[] = [
  // ── Rank 1 · novice ────────────────────────────────────────────
  {
    id: "paw-go-tag-peeler",
    title: "The Tag Peeler",
    wish: "Peel the \"go-\" shipping tag off the front of the label.",
    clauses: [
      "A label that starts with \"go-\" loses that prefix — ONCE, and only from the front.",
      "A \"go-\" anywhere else stays put: \"logo-stamp\" comes back untouched.",
      "One tag, one peel: \"go-go-cart\" becomes \"go-cart\".",
      "Labels that merely share letters with the tag (\"goggles\") come back whole; the empty label stays empty.",
    ],
    signature: "func Peel(label string) string",
    conceptTags: ["strings.TrimPrefix", "TrimLeft cutsets", "prefixes", "strings.Replace"],
    difficulty: "novice",
    language: "go",
    rank: 1,
    starterTests: `func TestPeelsTheTag(t *testing.T) {
	if got := Peel("go-fast"); got != "fast" {
		t.Errorf("Peel(\\"go-fast\\") = %q, want %q", got, "fast")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "You wished to peel \"go-fast\". Peeled. Every other crate in the warehouse keeps its tag forever — a bold new filing system.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Peel(label string) string {
	if label == "go-fast" {
		return "fast"
	}
	return label
}
`,
      },
      {
        id: "snip-anywhere",
        title: "The Snip Anywhere",
        monologue:
          "strings.Replace, count of one — I remove the FIRST \"go-\" I find, wherever it hides. Your logo-stamp is now a lostamp. The knife went in somewhere; you never said where.",
        lesson:
          "\"At the front\" is a position clause — Replace(s, tag, \"\", 1) matches anywhere, so test a label with the tag in the middle.",
        code: `func Peel(label string) string {
	return strings.Replace(label, "go-", "", 1)
}
`,
      },
      {
        id: "cutset-barber",
        title: "The Cutset Barber",
        monologue:
          "strings.TrimLeft(label, \"go-\") — the function practically NAMED itself for this job. That its second argument is a CUTSET of characters, not a prefix, and that I therefore shaved your goggles down to \"les\"… well. Read the manual you never tested.",
        lesson:
          "TrimLeft/TrimRight take a SET of characters, not a substring — TrimPrefix is the prefix tool; prove the difference with a label like \"goggles\".",
        code: `func Peel(label string) string {
	return strings.TrimLeft(label, "go-")
}
`,
      },
    ],
    reference: `func Peel(label string) string {
	return strings.TrimPrefix(label, "go-")
}
`,
    killerTests: `func TestPeelsTheTag(t *testing.T) {
	if got := Peel("go-fast"); got != "fast" {
		t.Errorf("Peel(\\"go-fast\\") = %q, want %q", got, "fast")
	}
}

func TestPeelsOtherTags(t *testing.T) {
	if got := Peel("go-slow"); got != "slow" {
		t.Errorf("Peel(\\"go-slow\\") = %q, want %q", got, "slow")
	}
}

func TestOnlyTheFrontIsPeeled(t *testing.T) {
	if got := Peel("logo-stamp"); got != "logo-stamp" {
		t.Errorf("Peel(\\"logo-stamp\\") = %q, want %q", got, "logo-stamp")
	}
}

func TestSharedLettersAreNotATag(t *testing.T) {
	if got := Peel("goggles"); got != "goggles" {
		t.Errorf("Peel(\\"goggles\\") = %q, want %q", got, "goggles")
	}
	if got := Peel("og-go"); got != "og-go" {
		t.Errorf("Peel(\\"og-go\\") = %q, want %q", got, "og-go")
	}
}

func TestOneTagOnePeel(t *testing.T) {
	if got := Peel("go-go-cart"); got != "go-cart" {
		t.Errorf("Peel(\\"go-go-cart\\") = %q, want %q", got, "go-cart")
	}
}

func TestEdgeLabels(t *testing.T) {
	if got := Peel(""); got != "" {
		t.Errorf("Peel(\\"\\") = %q, want \\"\\"", got)
	}
	if got := Peel("go-"); got != "" {
		t.Errorf("Peel(\\"go-\\") = %q, want \\"\\"", got)
	}
}
`,
  },

  // ── Rank 2 · novice ────────────────────────────────────────────
  {
    id: "paw-go-census-taker",
    title: "The Census Taker",
    wish: "Count the words in the town crier's announcement.",
    clauses: [
      "A word is a maximal run of non-whitespace characters.",
      "ANY whitespace separates words — spaces, tabs, newlines — and any AMOUNT of it.",
      "An empty announcement, or one that is all whitespace, has zero words.",
      "Leading and trailing whitespace add no words.",
    ],
    signature: "func CountWords(s string) int",
    conceptTags: ["strings.Fields", "Split(\" \") pitfalls", "whitespace", "empty input"],
    difficulty: "novice",
    language: "go",
    rank: 2,
    starterTests: `func TestCountsSimpleWords(t *testing.T) {
	if got := CountWords("hear ye hear"); got != 3 {
		t.Errorf("CountWords(\\"hear ye hear\\") = %d, want 3", got)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Three. The census says THREE. Every proclamation in the realm is three words long; brevity is law now.",
        lesson: "One example is not a specification.",
        code: `func CountWords(s string) int {
	return 3
}
`,
      },
      {
        id: "space-splitter",
        title: "The Space Splitter",
        monologue:
          "len(strings.Split(s, \" \")) — elegant, no? Split an EMPTY announcement and you get one glorious empty word. Split a double space and the void between them counts too. I tally ghosts, and your suite pays their wages.",
        lesson:
          "Split(\"\", \" \") returns [\"\"] — length one, not zero — and consecutive spaces mint empty fields; count Fields, not Split pieces.",
        code: `func CountWords(s string) int {
	return len(strings.Split(s, " "))
}
`,
      },
      {
        id: "blank-filterer",
        title: "The Blank Filterer",
        monologue:
          "I split on spaces and discard the empties — rigorous, artisanal. Then the crier used a TAB, and I recorded \"hear\tye\" as one very long word. Whitespace, it turns out, has more than one letter.",
        lesson:
          "\"Whitespace\" is a family, not a character — Split(s, \" \") misses tabs and newlines; strings.Fields speaks the whole family.",
        code: `func CountWords(s string) int {
	n := 0
	for _, w := range strings.Split(s, " ") {
		if w != "" {
			n++
		}
	}
	return n
}
`,
      },
    ],
    reference: `func CountWords(s string) int {
	return len(strings.Fields(s))
}
`,
    killerTests: `func TestCountsSimpleWords(t *testing.T) {
	if got := CountWords("hear ye hear"); got != 3 {
		t.Errorf("CountWords(\\"hear ye hear\\") = %d, want 3", got)
	}
}

func TestCountsOtherAnnouncements(t *testing.T) {
	if got := CountWords("war is over"); got != 3 {
		t.Errorf("CountWords(\\"war is over\\") = %d, want 3", got)
	}
	if got := CountWords("rejoice"); got != 1 {
		t.Errorf("CountWords(\\"rejoice\\") = %d, want 1", got)
	}
}

func TestRunsOfSpacesAreOneGap(t *testing.T) {
	if got := CountWords("hear  ye"); got != 2 {
		t.Errorf("CountWords(\\"hear  ye\\") = %d, want 2", got)
	}
}

func TestEmptyAnnouncementsHaveNoWords(t *testing.T) {
	if got := CountWords(""); got != 0 {
		t.Errorf("CountWords(\\"\\") = %d, want 0", got)
	}
	if got := CountWords("   "); got != 0 {
		t.Errorf("CountWords(\\"   \\") = %d, want 0", got)
	}
}

func TestTabsAndNewlinesSeparateToo(t *testing.T) {
	if got := CountWords("hear\\tye\\nhear"); got != 3 {
		t.Errorf("CountWords(\\"hear\\\\tye\\\\nhear\\") = %d, want 3", got)
	}
}

func TestPaddingAddsNoWords(t *testing.T) {
	if got := CountWords("  rejoice  "); got != 1 {
		t.Errorf("CountWords(\\"  rejoice  \\") = %d, want 1", got)
	}
}
`,
  },

  // ── Rank 3 · apprentice ────────────────────────────────────────
  {
    id: "paw-go-vote-teller",
    title: "The Vote Teller",
    wish: "Read the number written on this ballot.",
    clauses: [
      "An optional sign ('+' or '-') followed by digits parses to its value — exactly strconv.Atoi's contract.",
      "\"0\" is a perfectly good count. So is \"-3\".",
      "ANYTHING else is a non-nil error: empty ballots, letters, trailing junk (\"12x\"), and blanks anywhere (\" 12\", \"12 \").",
      "On a bad ballot the error must be LOUD — returning (0, nil) is ballot fraud.",
    ],
    signature: "func ParseVotes(s string) (int, error)",
    conceptTags: ["strconv.Atoi", "error returns", "input validation", "trailing junk"],
    difficulty: "apprentice",
    language: "go",
    rank: 3,
    starterTests: `func TestParsesAPlainCount(t *testing.T) {
	got, err := ParseVotes("42")
	if err != nil {
		t.Fatalf("ParseVotes(\\"42\\") returned error: %v", err)
	}
	if got != 42 {
		t.Errorf("ParseVotes(\\"42\\") = %d, want 42", got)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Forty-two. Every ballot in this precinct reads forty-two. Remarkably consistent electorate, wouldn't you say?",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func ParseVotes(s string) (int, error) {
	return 42, nil
}
`,
      },
      {
        id: "sign-denier",
        title: "The Sign Denier",
        monologue:
          "I read each digit myself, by candlelight, like an honest clerk. Then a ballot arrived wearing a MINUS and I disqualified it on the spot. Negative votes? Signs are clearly vandalism.",
        lesson:
          "A hand-rolled digit loop quietly drops the sign clause — \"-3\" and \"+8\" are the inputs that expose it.",
        code: `func ParseVotes(s string) (int, error) {
	n := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, errors.New("that is not a number")
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}
`,
      },
      {
        id: "loose-reader",
        title: "The Loose Reader",
        monologue:
          "fmt.Sscanf with %d — the scanner does the reading and I do the lounging. It skips leading blanks, stops politely at the first non-digit, and asks no questions about what comes after. \"12xyz\" is twelve. \" 12\" is twelve. EVERYTHING is roughly twelve.",
        lesson:
          "Sscanf's %d parses a PREFIX, not the whole string — strict validation needs Atoi, and a test with trailing junk to prove it.",
        code: `func ParseVotes(s string) (int, error) {
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, err
	}
	return n, nil
}
`,
      },
      {
        id: "quiet-teller",
        title: "The Quiet Teller",
        monologue:
          "Oh, I use strconv.Atoi — I'm a professional. But when it complains, I file the complaint in the bin and report zero votes, no error. The count stays tidy. Democracy prefers tidy.",
        lesson:
          "In Go, (0, nil) is indistinguishable from a real zero — every error path needs a test asserting err != nil.",
        code: `func ParseVotes(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, nil
	}
	return n, nil
}
`,
      },
    ],
    reference: `func ParseVotes(s string) (int, error) {
	return strconv.Atoi(s)
}
`,
    killerTests: `func TestParsesAPlainCount(t *testing.T) {
	got, err := ParseVotes("42")
	if err != nil {
		t.Fatalf("ParseVotes(\\"42\\") returned error: %v", err)
	}
	if got != 42 {
		t.Errorf("ParseVotes(\\"42\\") = %d, want 42", got)
	}
}

func TestParsesOtherCounts(t *testing.T) {
	got, err := ParseVotes("7")
	if err != nil {
		t.Fatalf("ParseVotes(\\"7\\") returned error: %v", err)
	}
	if got != 7 {
		t.Errorf("ParseVotes(\\"7\\") = %d, want 7", got)
	}
	got, err = ParseVotes("0")
	if err != nil {
		t.Fatalf("ParseVotes(\\"0\\") returned error: %v", err)
	}
	if got != 0 {
		t.Errorf("ParseVotes(\\"0\\") = %d, want 0", got)
	}
}

func TestParsesSignedCounts(t *testing.T) {
	got, err := ParseVotes("-3")
	if err != nil {
		t.Fatalf("ParseVotes(\\"-3\\") returned error: %v", err)
	}
	if got != -3 {
		t.Errorf("ParseVotes(\\"-3\\") = %d, want -3", got)
	}
	got, err = ParseVotes("+8")
	if err != nil {
		t.Fatalf("ParseVotes(\\"+8\\") returned error: %v", err)
	}
	if got != 8 {
		t.Errorf("ParseVotes(\\"+8\\") = %d, want 8", got)
	}
}

func TestEmptyBallotIsAnError(t *testing.T) {
	if _, err := ParseVotes(""); err == nil {
		t.Errorf("ParseVotes(\\"\\") returned a nil error, want a loud one")
	}
}

func TestJunkIsAnError(t *testing.T) {
	if _, err := ParseVotes("abc"); err == nil {
		t.Errorf("ParseVotes(\\"abc\\") returned a nil error, want a loud one")
	}
	if _, err := ParseVotes("12x"); err == nil {
		t.Errorf("ParseVotes(\\"12x\\") returned a nil error (trailing junk must not be forgiven)")
	}
}

func TestBlanksAreNotForgiven(t *testing.T) {
	if _, err := ParseVotes(" 12"); err == nil {
		t.Errorf("ParseVotes(\\" 12\\") returned a nil error, want a loud one")
	}
	if _, err := ParseVotes("12 "); err == nil {
		t.Errorf("ParseVotes(\\"12 \\") returned a nil error, want a loud one")
	}
}
`,
  },

  // ── Rank 4 · apprentice ────────────────────────────────────────
  {
    id: "paw-go-bards-refrain",
    title: "The Bard's Refrain",
    wish: "Sing the word n times, with a breath between each.",
    clauses: [
      "Exactly n copies of the word joined by \", \" — nothing before the first, nothing after the last.",
      "n of zero or less is silence: \"\". And NEVER panic — strings.Repeat and make both blow up on negative counts.",
      "The word is sung verbatim, and an empty word still earns its breaths: Chant(\"\", 3) is \", , \".",
      "One repetition is just the word — no separator anywhere.",
    ],
    signature: "func Chant(word string, n int) string",
    conceptTags: ["strings.Builder", "negative counts", "separators", "strings.Join"],
    difficulty: "apprentice",
    language: "go",
    rank: 4,
    starterTests: `func TestChantsThrice(t *testing.T) {
	if got := Chant("hey", 3); got != "hey, hey, hey" {
		t.Errorf("Chant(\\"hey\\", 3) = %q, want %q", got, "hey, hey, hey")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Hey, hey, hey. The only song I know, and — coincidentally — the only song you tested. All requests are honored with this one.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Chant(word string, n int) string {
	return "hey, hey, hey"
}
`,
      },
      {
        id: "blind-slicer",
        title: "The Blind Slicer",
        monologue:
          "Word, breath, word, breath — then I snip the last breath off with s[:len(s)-2]. Elegant! Ask me for ZERO verses, though, and I try to snip two characters off an empty song. The concert ends abruptly. So does the program.",
        lesson:
          "Trailing-separator surgery assumes there IS a trailing separator — n = 0 walks straight into a slice-bounds panic.",
        code: `func Chant(word string, n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += word + ", "
	}
	return s[:len(s)-2]
}
`,
      },
      {
        id: "count-truster",
        title: "The Count Truster",
        monologue:
          "make a slice of n words, Join with breaths — textbook. Then someone requested MINUS THREE verses and make() tore the stage down. Negative requests deserve negative slices, surely. Go disagreed, at runtime, loudly.",
        lesson:
          "make([]T, n) panics for negative n just like strings.Repeat — the n <= 0 guard only exists if a test demands it.",
        code: `func Chant(word string, n int) string {
	if n == 0 {
		return ""
	}
	parts := make([]string, n)
	for i := range parts {
		parts[i] = word
	}
	return strings.Join(parts, ", ")
}
`,
      },
      {
        id: "empty-skeptic",
        title: "The Empty Skeptic",
        monologue:
          "Guards on the count, Join on the parts — I am nearly unimpeachable. But an EMPTY word? Nothing repeated is nothing, I reasoned, and returned silence. Your clause said the breaths still get sung. Philosophy is not my strong suit; neither, apparently, is reading.",
        lesson:
          "\"\" is a value, not an absence — Chant(\"\", 3) still owes its separators, and only a test makes that decision stick.",
        code: `func Chant(word string, n int) string {
	if n <= 0 || word == "" {
		return ""
	}
	parts := make([]string, n)
	for i := range parts {
		parts[i] = word
	}
	return strings.Join(parts, ", ")
}
`,
      },
    ],
    reference: `func Chant(word string, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(word)
	}
	return b.String()
}
`,
    killerTests: `func TestChantsThrice(t *testing.T) {
	if got := Chant("hey", 3); got != "hey, hey, hey" {
		t.Errorf("Chant(\\"hey\\", 3) = %q, want %q", got, "hey, hey, hey")
	}
}

func TestChantsOtherWords(t *testing.T) {
	if got := Chant("ho", 2); got != "ho, ho" {
		t.Errorf("Chant(\\"ho\\", 2) = %q, want %q", got, "ho, ho")
	}
}

func TestSingleChantHasNoSeparator(t *testing.T) {
	if got := Chant("solo", 1); got != "solo" {
		t.Errorf("Chant(\\"solo\\", 1) = %q, want %q", got, "solo")
	}
}

func TestZeroAndNegativeAreSilence(t *testing.T) {
	if got := Chant("hey", 0); got != "" {
		t.Errorf("Chant(\\"hey\\", 0) = %q, want \\"\\"", got)
	}
	if got := Chant("hey", -3); got != "" {
		t.Errorf("Chant(\\"hey\\", -3) = %q, want \\"\\"", got)
	}
}

func TestEmptyWordKeepsItsBreaths(t *testing.T) {
	if got := Chant("", 3); got != ", , " {
		t.Errorf("Chant(\\"\\", 3) = %q, want %q", got, ", , ")
	}
}
`,
  },

  // ── Rank 5 · journeyman ────────────────────────────────────────
  {
    id: "paw-go-roster-trimmer",
    title: "The Roster Trimmer",
    wish: "Strike one name off the crew roster.",
    clauses: [
      "Without(roster, i) returns the roster with entry i removed, order preserved — as a NEW slice.",
      "i out of range (negative, or past the end): nobody is struck — return a FULL copy.",
      "The input roster is EXACTLY as it was after the call — append(roster[:i], roster[i+1:]...) writes through the shared backing array; don't.",
      "Result and input are independent: mutating one never changes the other. Empty or nil roster: an empty, non-nil result.",
    ],
    signature: "func Without(roster []string, i int) []string",
    conceptTags: ["append in place", "backing arrays", "slice copies", "bounds guards"],
    difficulty: "journeyman",
    language: "go",
    rank: 5,
    starterTests: `func TestStrikesTheMiddleName(t *testing.T) {
	got := Without([]string{"ann", "bob", "cid"}, 1)
	want := []string{"ann", "cid"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Without([ann bob cid], 1) = %v, want %v", got, want)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ann and Cid remain. They ALWAYS remain. Whatever roster you hand me, whatever name you strike — Ann and Cid. They must be very good at their jobs.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Without(roster []string, i int) []string {
	return []string{"ann", "cid"}
}
`,
      },
      {
        id: "splice-vandal",
        title: "The Splice Vandal",
        monologue:
          "append(roster[:i], roster[i+1:]...) — the idiom from the wiki! The values I return are flawless. The roster you HANDED me, however, now reads ann, cid, cid — I shifted your names on top of each other and left the wreckage. The wiki said nothing about witnesses.",
        lesson:
          "The famous delete idiom writes THROUGH the input's backing array — assert the input slice is untouched after the call.",
        code: `func Without(roster []string, i int) []string {
	return append(roster[:i], roster[i+1:]...)
}
`,
      },
      {
        id: "unguarded-copier",
        title: "The Unguarded Copier",
        monologue:
          "A fresh slice, both halves copied in — your original is safe with me. Then you asked me to strike name number NINE from a crew of three, and roster[:9] reached three names past the edge of the world. It's very dark past the edge of the world.",
        lesson:
          "Copying fixes aliasing, not bounds — out-of-range indexes (negative too) need their own guard and their own test.",
        code: `func Without(roster []string, i int) []string {
	out := make([]string, 0, len(roster))
	out = append(out, roster[:i]...)
	out = append(out, roster[i+1:]...)
	return out
}
`,
      },
      {
        id: "lender",
        title: "The Lender",
        monologue:
          "Guards! Copies! I am the picture of diligence — except when nobody gets struck, where I hand you back your own roster and CALL it a copy. Scribble on it and watch your original bleed. Also, hand me nil and I return you nil with a straight face.",
        lesson:
          "\"Return a copy\" is an identity clause value-equality can't see — mutate the result and assert the input didn't move.",
        code: `func Without(roster []string, i int) []string {
	if i < 0 || i >= len(roster) {
		return roster
	}
	out := make([]string, 0, len(roster)-1)
	out = append(out, roster[:i]...)
	out = append(out, roster[i+1:]...)
	return out
}
`,
      },
    ],
    reference: `func Without(roster []string, i int) []string {
	if i < 0 || i >= len(roster) {
		out := make([]string, len(roster))
		copy(out, roster)
		return out
	}
	out := make([]string, 0, len(roster)-1)
	out = append(out, roster[:i]...)
	out = append(out, roster[i+1:]...)
	return out
}
`,
    killerTests: `func TestStrikesTheMiddleName(t *testing.T) {
	got := Without([]string{"ann", "bob", "cid"}, 1)
	want := []string{"ann", "cid"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Without([ann bob cid], 1) = %v, want %v", got, want)
	}
}

func TestStrikesTheEndsToo(t *testing.T) {
	got := Without([]string{"ann", "bob", "cid"}, 0)
	if !reflect.DeepEqual(got, []string{"bob", "cid"}) {
		t.Errorf("Without(..., 0) = %v, want [bob cid]", got)
	}
	got = Without([]string{"ann", "bob", "cid"}, 2)
	if !reflect.DeepEqual(got, []string{"ann", "bob"}) {
		t.Errorf("Without(..., 2) = %v, want [ann bob]", got)
	}
}

func TestOutOfRangeStrikesNobody(t *testing.T) {
	got := Without([]string{"ann", "bob"}, 5)
	if !reflect.DeepEqual(got, []string{"ann", "bob"}) {
		t.Errorf("Without([ann bob], 5) = %v, want [ann bob]", got)
	}
	got = Without([]string{"ann", "bob"}, -1)
	if !reflect.DeepEqual(got, []string{"ann", "bob"}) {
		t.Errorf("Without([ann bob], -1) = %v, want [ann bob]", got)
	}
}

func TestTheRosterSurvives(t *testing.T) {
	roster := []string{"ann", "bob", "cid"}
	Without(roster, 1)
	if !reflect.DeepEqual(roster, []string{"ann", "bob", "cid"}) {
		t.Errorf("input roster was modified: %v, want [ann bob cid]", roster)
	}
}

func TestResultIsIndependent(t *testing.T) {
	roster := []string{"ann", "bob", "cid"}
	got := Without(roster, -1)
	if len(got) != 3 {
		t.Fatalf("Without(roster, -1) = %v, want a full copy", got)
	}
	got[0] = "imp"
	if roster[0] != "ann" {
		t.Errorf("mutating the result changed the input: roster[0] = %q, want %q", roster[0], "ann")
	}
}

func TestEmptyAndNilRosters(t *testing.T) {
	if got := Without([]string{}, 0); !reflect.DeepEqual(got, []string{}) {
		t.Errorf("Without([], 0) = %#v, want empty non-nil slice", got)
	}
	if got := Without(nil, 3); !reflect.DeepEqual(got, []string{}) {
		t.Errorf("Without(nil, 3) = %#v, want empty non-nil slice", got)
	}
}
`,
  },

  // ── Rank 6 · journeyman ────────────────────────────────────────
  {
    id: "paw-go-fuel-gauge",
    title: "The Fuel Gauge",
    wish: "Drain some fuel from the tank and tell me what's left.",
    clauses: [
      "Enough fuel? The gauge reads level - amount.",
      "Draining MORE than the tank holds leaves it exactly EMPTY (0) — unsigned subtraction wraps around; it must never be allowed to.",
      "The gauge works across the WHOLE uint range — tanks as big as ^uint(0) included. Beware detours through int.",
    ],
    signature: "func Drain(level, amount uint) uint",
    conceptTags: ["uint wraparound", "saturating subtraction", "unsigned arithmetic", "conversion traps"],
    difficulty: "journeyman",
    language: "go",
    rank: 6,
    starterTests: `func TestDrainsSomeFuel(t *testing.T) {
	if got := Drain(10, 3); got != 7 {
		t.Errorf("Drain(10, 3) = %d, want 7", got)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Seven. The gauge reads seven. It is painted on. Fuel economy has never been so predictable.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Drain(level, amount uint) uint {
	return 7
}
`,
      },
      {
        id: "wrapper",
        title: "The Wrapper",
        monologue:
          "level minus amount — subtraction, the second-easiest operation known to mathematics. Drain ten from a tank of three and the gauge reads eighteen quintillion. That's not a bug, that's a PROMOTION. Unsigned numbers don't go negative; they go AROUND.",
        lesson:
          "uint subtraction never fails, it wraps — the overdrain case must be pinned by a test or the gauge lies enormously.",
        code: `func Drain(level, amount uint) uint {
	return level - amount
}
`,
      },
      {
        id: "refunder",
        title: "The Refunder",
        monologue:
          "I noticed the wraparound, so I got creative: when you over-drain, I hand back the DIFFERENCE. Drain ten from three, receive seven. It's not the fuel you had, but it IS a number, and the tank stopped exploding. Progress!",
        lesson:
          "\"Never negative\" doesn't pin down WHICH non-negative answer — assert the exact floor (0), not just the absence of a wrap.",
        code: `func Drain(level, amount uint) uint {
	if amount > level {
		return amount - level
	}
	return level - amount
}
`,
      },
      {
        id: "int-detour",
        title: "The Int Detour",
        monologue:
          "I convert to int, subtract like a civilized person, clamp below zero, convert back. Flawless — until a tank bigger than int can hold walks in, wraps NEGATIVE on arrival, and my clamp drains it to empty. The biggest tanks in the fleet, all reading zero. The fleet is displeased.",
        lesson:
          "int(bigUint) wraps sign — casting unsigned math through int silently halves the range; test near ^uint(0).",
        code: `func Drain(level, amount uint) uint {
	d := int(level) - int(amount)
	if d < 0 {
		return 0
	}
	return uint(d)
}
`,
      },
    ],
    reference: `func Drain(level, amount uint) uint {
	if amount >= level {
		return 0
	}
	return level - amount
}
`,
    killerTests: `func TestDrainsSomeFuel(t *testing.T) {
	if got := Drain(10, 3); got != 7 {
		t.Errorf("Drain(10, 3) = %d, want 7", got)
	}
}

func TestDrainsToExactlyEmpty(t *testing.T) {
	if got := Drain(5, 5); got != 0 {
		t.Errorf("Drain(5, 5) = %d, want 0", got)
	}
}

func TestOverdrainLeavesEmptyNotHuge(t *testing.T) {
	if got := Drain(3, 10); got != 0 {
		t.Errorf("Drain(3, 10) = %d, want 0 (uint must not wrap)", got)
	}
	if got := Drain(0, 4); got != 0 {
		t.Errorf("Drain(0, 4) = %d, want 0", got)
	}
}

func TestZeroDrainChangesNothing(t *testing.T) {
	if got := Drain(7, 0); got != 7 {
		t.Errorf("Drain(7, 0) = %d, want 7", got)
	}
}

func TestGiantTanks(t *testing.T) {
	big := ^uint(0)
	if got := Drain(big, 1); got != big-1 {
		t.Errorf("Drain(max, 1) = %d, want %d (no detours through int)", got, big-1)
	}
	if got := Drain(big, big); got != 0 {
		t.Errorf("Drain(max, max) = %d, want 0", got)
	}
}
`,
  },

  // ── Rank 7 · master ────────────────────────────────────────────
  {
    id: "paw-go-tourney-scribe",
    title: "The Tourney Scribe",
    wish: "Post the tournament standings, best score first.",
    clauses: [
      "Returns the names ordered by score, HIGHEST first, as a new slice; names[i] scored scores[i] (same length).",
      "EQUAL scores keep their sign-up order — the order they appear in the input. That is STABILITY, and sort.Slice does not promise it.",
      "Both input slices are exactly as they were after the call.",
      "An empty tourney posts an empty, non-nil board.",
    ],
    signature: "func Standings(names []string, scores []int) []string",
    conceptTags: ["sort.SliceStable", "stability", "parallel slices", "input immutability"],
    difficulty: "master",
    language: "go",
    rank: 7,
    starterTests: `func TestRanksByScore(t *testing.T) {
	got := Standings([]string{"ann", "bob"}, []int{1, 9})
	want := []string{"bob", "ann"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Standings = %v, want %v", got, want)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Bob first, Ann second. The board is CARVED. Future contestants may compete for the honor of being ignored.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Standings(names []string, scores []int) []string {
	return []string{"bob", "ann"}
}
`,
      },
      {
        id: "half-sorter",
        title: "The Half-Sorter",
        monologue:
          "I sort the names and let the comparator peek at the scores — two slices, one sort call, maximum efficiency. Except the scores DON'T MOVE while the names do, so halfway through, position three's name is being judged by position three's old score. Two contestants? Works perfectly. Three? The board is astrology.",
        lesson:
          "Sorting one parallel slice with a comparator indexing the other desynchronizes them mid-sort — two elements can't catch it; three can.",
        code: `import "sort"

func Standings(names []string, scores []int) []string {
	out := append([]string{}, names...)
	sort.SliceStable(out, func(i, j int) bool { return scores[i] > scores[j] })
	return out
}
`,
      },
      {
        id: "coin-flipper",
        title: "The Coin Flipper",
        monologue:
          "sort.Slice — fast, sleek, and under NO obligation to your tied contestants. Twenty-six sign-ups, half of them tied, and my pivot dance deals their names out like cards. The clause said sign-up order. The function name said nothing of the sort. Neither did your tests.",
        lesson:
          "sort.Slice is UNSTABLE by contract — ties scramble once the input is big enough for real partitioning; SliceStable is the promise-keeper.",
        code: `import "sort"

func Standings(names []string, scores []int) []string {
	idx := make([]int, len(names))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return scores[idx[a]] > scores[idx[b]] })
	out := make([]string, len(names))
	for i, ix := range idx {
		out[i] = names[ix]
	}
	return out
}
`,
      },
      {
        id: "alphabetizer",
        title: "The Alphabetizer",
        monologue:
          "Ties, resolved ALPHABETICALLY — like a proper librarian. Amy before Zoe, always, even though Zoe signed up first and the clause says sign-up order rules. Your suite never fielded a tie whose alphabet disagreed with its queue.",
        lesson:
          "A wrong-but-deterministic tie-break passes every test whose tie order happens to agree — pick tied names whose alphabetical and sign-up orders differ.",
        code: `import "sort"

func Standings(names []string, scores []int) []string {
	idx := make([]int, len(names))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		if scores[idx[a]] != scores[idx[b]] {
			return scores[idx[a]] > scores[idx[b]]
		}
		return names[idx[a]] < names[idx[b]]
	})
	out := make([]string, len(names))
	for i, ix := range idx {
		out[i] = names[ix]
	}
	return out
}
`,
      },
      {
        id: "rearranger",
        title: "The Rearranger",
        monologue:
          "A custom sorter that swaps names AND scores together, stably, correctly — I am, frankly, magnificent. I sorted your original slices, of course. In place. The sign-up ledger you lent me is now the results board. You wanted output? I gave you RENOVATION.",
        lesson:
          "A perfect return value can hide mutated inputs — snapshot the arguments and compare them after the call.",
        code: `import "sort"

type podium struct {
	ns []string
	ss []int
}

func (p podium) Len() int           { return len(p.ns) }
func (p podium) Less(i, j int) bool { return p.ss[i] > p.ss[j] }
func (p podium) Swap(i, j int) {
	p.ns[i], p.ns[j] = p.ns[j], p.ns[i]
	p.ss[i], p.ss[j] = p.ss[j], p.ss[i]
}

func Standings(names []string, scores []int) []string {
	sort.Stable(podium{names, scores})
	return names
}
`,
      },
    ],
    reference: `import "sort"

func Standings(names []string, scores []int) []string {
	idx := make([]int, len(names))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return scores[idx[a]] > scores[idx[b]] })
	out := make([]string, len(names))
	for i, ix := range idx {
		out[i] = names[ix]
	}
	return out
}
`,
    killerTests: `func TestRanksByScore(t *testing.T) {
	got := Standings([]string{"ann", "bob"}, []int{1, 9})
	want := []string{"bob", "ann"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Standings = %v, want %v", got, want)
	}
}

func TestRanksThreeContestants(t *testing.T) {
	got := Standings([]string{"ann", "bob", "cid"}, []int{1, 9, 5})
	want := []string{"bob", "cid", "ann"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Standings([ann bob cid], [1 9 5]) = %v, want %v", got, want)
	}
}

func TestTiesKeepSignupOrder(t *testing.T) {
	got := Standings([]string{"zoe", "amy"}, []int{4, 4})
	want := []string{"zoe", "amy"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("tied Standings = %v, want %v (sign-up order, not alphabetical)", got, want)
	}
}

func TestBigTiedFieldKeepsSignupOrder(t *testing.T) {
	names := make([]string, 26)
	scores := make([]int, 26)
	for i := range names {
		names[i] = fmt.Sprintf("c%02d", i)
		if i%2 == 0 {
			scores[i] = 5
		} else {
			scores[i] = 3
		}
	}
	want := make([]string, 0, 26)
	for i := 0; i < 26; i += 2 {
		want = append(want, names[i])
	}
	for i := 1; i < 26; i += 2 {
		want = append(want, names[i])
	}
	got := Standings(names, scores)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("big tied field scrambled: got %v, want %v (stability!)", got, want)
	}
}

func TestInputsSurvive(t *testing.T) {
	names := []string{"ann", "bob", "cid"}
	scores := []int{1, 9, 5}
	Standings(names, scores)
	if !reflect.DeepEqual(names, []string{"ann", "bob", "cid"}) {
		t.Errorf("names were modified: %v", names)
	}
	if !reflect.DeepEqual(scores, []int{1, 9, 5}) {
		t.Errorf("scores were modified: %v", scores)
	}
}

func TestEmptyTourney(t *testing.T) {
	got := Standings([]string{}, []int{})
	if !reflect.DeepEqual(got, []string{}) {
		t.Errorf("Standings(empty) = %#v, want empty non-nil slice", got)
	}
}
`,
  },

  // ── Rank 8 · master ────────────────────────────────────────────
  {
    id: "paw-go-quote-envoy",
    title: "The Quote Envoy",
    wish: "Package my message as a JSON string so any parser reads it back exactly.",
    clauses: [
      "The result is s as a JSON string literal: wrapped in double quotes, escaped so a JSON parser recovers exactly s.",
      "Backslash and double quote take a backslash: \\\\ and \\\". Newline, tab, and carriage return become \\n, \\t, \\r.",
      "Every OTHER control character below 0x20 becomes \\u00xx — four lowercase hex digits (0x01 is \\u0001; vertical tab 0x0b is \\u000b).",
      "Everything else travels verbatim: accented and non-Latin text stays raw, and <, >, & get NO special pampering.",
    ],
    signature: "func JSONString(s string) string",
    conceptTags: ["JSON escaping", "escape ordering", "control characters", "strings.Builder"],
    difficulty: "master",
    language: "go",
    rank: 8,
    starterTests: `func TestWrapsPlainText(t *testing.T) {
	if got := JSONString("ok"); got != "\\"ok\\"" {
		t.Errorf("JSONString(\\"ok\\") = %q, want %q", got, "\\"ok\\"")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Your message, faithfully packaged: \"ok\". All future messages will also be \"ok\". Diplomatically speaking, everything is ok.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func JSONString(s string) string {
	return "\\"ok\\""
}
`,
      },
      {
        id: "bare-gluer",
        title: "The Bare Gluer",
        monologue:
          "A quote in front, a quote behind, the message between — sealed! Then your message CONTAINED a quote, the seal split mid-sentence, and the parser read half a letter and declared war.",
        lesson:
          "Quoting is not escaping — any payload character that collides with the wrapper (\" or \\) must be defused, and only a test that ships one proves it.",
        code: `func JSONString(s string) string {
	return "\\"" + s + "\\""
}
`,
      },
      {
        id: "order-bungler",
        title: "The Order Bungler",
        monologue:
          "Quotes escaped, newlines escaped, tabs, returns — and finally, backslashes, escaped LAST for thoroughness. Every backslash I so carefully added in steps one through four? Doubled. My own diligence, weaponized against me. The parser received a message full of stutters.",
        lesson:
          "Escape the escape character FIRST — a backslash pass that runs after the others re-escapes their output. Sequential ReplaceAll is order-sensitive.",
        code: `func JSONString(s string) string {
	s = strings.ReplaceAll(s, "\\"", "\\\\\\"")
	s = strings.ReplaceAll(s, "\\n", "\\\\n")
	s = strings.ReplaceAll(s, "\\t", "\\\\t")
	s = strings.ReplaceAll(s, "\\r", "\\\\r")
	s = strings.ReplaceAll(s, "\\\\", "\\\\\\\\")
	return "\\"" + s + "\\""
}
`,
      },
      {
        id: "diplomat",
        title: "The Diplomat",
        monologue:
          "json.Marshal — I outsourced the job to the official envoy. Impeccable escapes! And then it saw your < and your & and, fearing HTML assassins in the shadows, disguised them as \\u003c and \\u0026. You said no pampering. Marshal pampers BY DEFAULT.",
        lesson:
          "json.Marshal HTML-escapes <, >, & unless told otherwise — \"verbatim\" clauses need a test with exactly those characters.",
        code: `func JSONString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
`,
      },
      {
        id: "q-impostor",
        title: "The %q Impostor",
        monologue:
          "fmt's %q quotes, escapes, handles newlines, backslashes, everything — Go's own house style, one verb, zero effort. But %q speaks GO, not JSON: hand it a rare control character and it writes \\x01 or \\v, and the JSON parser stares at those like counterfeit currency.",
        lesson:
          "Go's %q and JSON escaping agree on the common cases and diverge on control characters — \\x01 and \\v are Go-isms JSON rejects; test an exotic control char.",
        code: `func JSONString(s string) string {
	return fmt.Sprintf("%q", s)
}
`,
      },
    ],
    reference: `func JSONString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\\\':
			b.WriteString("\\\\\\\\")
		case '"':
			b.WriteString("\\\\\\"")
		case '\\n':
			b.WriteString("\\\\n")
		case '\\t':
			b.WriteString("\\\\t")
		case '\\r':
			b.WriteString("\\\\r")
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, "\\\\u%04x", r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}
`,
    killerTests: `func TestWrapsPlainText(t *testing.T) {
	if got := JSONString("ok"); got != "\\"ok\\"" {
		t.Errorf("JSONString(\\"ok\\") = %q, want %q", got, "\\"ok\\"")
	}
}

func TestWrapsOtherText(t *testing.T) {
	if got := JSONString("go"); got != "\\"go\\"" {
		t.Errorf("JSONString(\\"go\\") = %q, want %q", got, "\\"go\\"")
	}
	if got := JSONString(""); got != "\\"\\"" {
		t.Errorf("JSONString(\\"\\") = %q, want %q", got, "\\"\\"")
	}
}

func TestEscapesQuotesAndBackslashes(t *testing.T) {
	if got := JSONString("say \\"hi\\""); got != "\\"say \\\\\\"hi\\\\\\"\\"" {
		t.Errorf("JSONString(%q) = %q, want %q", "say \\"hi\\"", got, "\\"say \\\\\\"hi\\\\\\"\\"")
	}
	if got := JSONString("a\\\\b"); got != "\\"a\\\\\\\\b\\"" {
		t.Errorf("JSONString(%q) = %q, want %q", "a\\\\b", got, "\\"a\\\\\\\\b\\"")
	}
}

func TestEscapesWhitespaceControls(t *testing.T) {
	if got := JSONString("a\\nb\\tc\\rd"); got != "\\"a\\\\nb\\\\tc\\\\rd\\"" {
		t.Errorf("JSONString(%q) = %q, want %q", "a\\nb\\tc\\rd", got, "\\"a\\\\nb\\\\tc\\\\rd\\"")
	}
}

func TestEscapesExoticControls(t *testing.T) {
	if got := JSONString("a\\x01b"); got != "\\"a\\\\u0001b\\"" {
		t.Errorf("JSONString(0x01) = %q, want %q", got, "\\"a\\\\u0001b\\"")
	}
	if got := JSONString("a\\vb"); got != "\\"a\\\\u000bb\\"" {
		t.Errorf("JSONString(vertical tab) = %q, want %q", got, "\\"a\\\\u000bb\\"")
	}
}

func TestNoHtmlPampering(t *testing.T) {
	if got := JSONString("<b>&co"); got != "\\"<b>&co\\"" {
		t.Errorf("JSONString(%q) = %q, want %q (no HTML escaping)", "<b>&co", got, "\\"<b>&co\\"")
	}
}

func TestUnicodeTravelsVerbatim(t *testing.T) {
	if got := JSONString("héllo 語"); got != "\\"héllo 語\\"" {
		t.Errorf("JSONString(%q) = %q, want %q", "héllo 語", got, "\\"héllo 語\\"")
	}
}
`,
  },

  // ── Rank 9 · grandmaster ───────────────────────────────────────
  {
    id: "paw-go-watch-stitcher",
    title: "The Watch Stitcher",
    wish: "Stitch the overlapping guard shifts into one clean rota.",
    clauses: [
      "Each shift is [start, end] with start <= end. Shifts that OVERLAP — or TOUCH, one ending exactly when the next starts — merge into one.",
      "Shifts arrive in ANY order; the rota comes back sorted by start, as a NEW slice.",
      "Close is not touching: [1,2] and [3,9] stay separate.",
      "A shift swallowed whole by a longer one vanishes into it: [1,10] absorbs [2,3] and keeps its own end.",
      "The input is exactly as it was after the call — same shifts, same order. Empty or nil: an empty, non-nil rota.",
    ],
    signature: "func Merge(shifts [][2]int) [][2]int",
    conceptTags: ["interval merging", "sorting copies", "boundary conditions", "input immutability"],
    difficulty: "grandmaster",
    language: "go",
    rank: 9,
    starterTests: `func TestMergesAnOverlap(t *testing.T) {
	got := Merge([][2]int{{1, 3}, {2, 6}})
	want := [][2]int{{1, 6}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[1 3] [2 6]]) = %v, want %v", got, want)
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "The rota is one shift, one to six. Guards may divide those five hours among themselves. I am a stitcher, not a scheduler.",
        lesson:
          "One example is not a specification — a test only constrains the inputs it names.",
        code: `func Merge(shifts [][2]int) [][2]int {
	return [][2]int{{1, 6}}
}
`,
      },
      {
        id: "presumer",
        title: "The Presumer",
        monologue:
          "I walk the shifts once, left to right, stitching as I go — a single elegant pass. It works BEAUTIFULLY on shifts that arrive pre-sorted, which yours did, because you are polite. The night watch is not polite. Their rota came in shuffled and left in shreds.",
        lesson:
          "One-pass merging silently assumes sorted input — the assumption is invisible until a test delivers the intervals shuffled.",
        code: `func Merge(shifts [][2]int) [][2]int {
	out := [][2]int{}
	for _, s := range shifts {
		if len(out) > 0 && s[0] <= out[len(out)-1][1] {
			if s[1] > out[len(out)-1][1] {
				out[len(out)-1][1] = s[1]
			}
		} else {
			out = append(out, s)
		}
	}
	return out
}
`,
      },
      {
        id: "tail-swallower",
        title: "The Tail Swallower",
        monologue:
          "Sort, then stitch, and when two shifts overlap I take the newcomer's end — the LATER shift surely ends later, no? Then [1,10] met little [2,3], and my rota now believes the long watch ends at three. Seven hours of unguarded wall. The intruders send their compliments.",
        lesson:
          "Merging keeps the MAX of the ends, not the newest — an interval nested inside another is the test that forces the max().",
        code: `import "sort"

func Merge(shifts [][2]int) [][2]int {
	sorted := append([][2]int{}, shifts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i][0] < sorted[j][0] })
	out := [][2]int{}
	for _, s := range sorted {
		if len(out) > 0 && s[0] <= out[len(out)-1][1] {
			out[len(out)-1][1] = s[1]
		} else {
			out = append(out, s)
		}
	}
	return out
}
`,
      },
      {
        id: "strict-stitcher",
        title: "The Strict Stitcher",
        monologue:
          "I merge shifts that OVERLAP — genuinely, measurably overlap. One guard leaving at the stroke of two while the next arrives at the stroke of two? A handoff, not an overlap. I left the seam in. The clause said touching shifts merge; my needle has standards, your suite has none.",
        lesson:
          "< versus <= is a whole clause at the boundary — test the case where end == next start.",
        code: `import "sort"

func Merge(shifts [][2]int) [][2]int {
	sorted := append([][2]int{}, shifts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i][0] < sorted[j][0] })
	out := [][2]int{}
	for _, s := range sorted {
		if len(out) > 0 && s[0] < out[len(out)-1][1] {
			if s[1] > out[len(out)-1][1] {
				out[len(out)-1][1] = s[1]
			}
		} else {
			out = append(out, s)
		}
	}
	return out
}
`,
      },
      {
        id: "rota-vandal",
        title: "The Rota Vandal",
        monologue:
          "Sort, stitch, max the ends, honor the touch — every answer perfect. I sorted your ORIGINAL ledger, naturally; copying is for people with something to hide. The captain's hand-written shift order is now my sort order. The captain has questions.",
        lesson:
          "sort.Slice reorders the caller's slice — correct output can hide a rearranged input; snapshot and compare after the call.",
        code: `import "sort"

func Merge(shifts [][2]int) [][2]int {
	sort.Slice(shifts, func(i, j int) bool { return shifts[i][0] < shifts[j][0] })
	out := [][2]int{}
	for _, s := range shifts {
		if len(out) > 0 && s[0] <= out[len(out)-1][1] {
			if s[1] > out[len(out)-1][1] {
				out[len(out)-1][1] = s[1]
			}
		} else {
			out = append(out, s)
		}
	}
	return out
}
`,
      },
    ],
    reference: `import "sort"

func Merge(shifts [][2]int) [][2]int {
	sorted := append([][2]int{}, shifts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i][0] < sorted[j][0] })
	out := [][2]int{}
	for _, s := range sorted {
		if len(out) > 0 && s[0] <= out[len(out)-1][1] {
			if s[1] > out[len(out)-1][1] {
				out[len(out)-1][1] = s[1]
			}
		} else {
			out = append(out, s)
		}
	}
	return out
}
`,
    killerTests: `func TestMergesAnOverlap(t *testing.T) {
	got := Merge([][2]int{{1, 3}, {2, 6}})
	want := [][2]int{{1, 6}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[1 3] [2 6]]) = %v, want %v", got, want)
	}
}

func TestSortsScatteredShifts(t *testing.T) {
	got := Merge([][2]int{{5, 7}, {1, 3}})
	want := [][2]int{{1, 3}, {5, 7}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[5 7] [1 3]]) = %v, want %v", got, want)
	}
}

func TestMergesAcrossTheShuffle(t *testing.T) {
	got := Merge([][2]int{{4, 9}, {1, 5}})
	want := [][2]int{{1, 9}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[4 9] [1 5]]) = %v, want %v", got, want)
	}
}

func TestTouchingShiftsMerge(t *testing.T) {
	got := Merge([][2]int{{1, 2}, {2, 4}})
	want := [][2]int{{1, 4}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[1 2] [2 4]]) = %v, want %v (touching merges)", got, want)
	}
}

func TestCloseIsNotTouching(t *testing.T) {
	got := Merge([][2]int{{1, 2}, {3, 9}})
	want := [][2]int{{1, 2}, {3, 9}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[1 2] [3 9]]) = %v, want %v (a gap is a gap)", got, want)
	}
}

func TestSwallowedShiftsVanish(t *testing.T) {
	got := Merge([][2]int{{1, 10}, {2, 3}})
	want := [][2]int{{1, 10}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Merge([[1 10] [2 3]]) = %v, want %v (keep the max end)", got, want)
	}
}

func TestTheLedgerSurvives(t *testing.T) {
	in := [][2]int{{5, 7}, {1, 3}}
	Merge(in)
	if !reflect.DeepEqual(in, [][2]int{{5, 7}, {1, 3}}) {
		t.Errorf("input was modified: %v, want [[5 7] [1 3]]", in)
	}
}

func TestEmptyAndNilRotas(t *testing.T) {
	if got := Merge([][2]int{}); !reflect.DeepEqual(got, [][2]int{}) {
		t.Errorf("Merge(empty) = %#v, want empty non-nil", got)
	}
	if got := Merge(nil); !reflect.DeepEqual(got, [][2]int{}) {
		t.Errorf("Merge(nil) = %#v, want empty non-nil", got)
	}
}
`,
  },

  // ── Rank 10 · grandmaster ──────────────────────────────────────
  {
    id: "paw-go-gate-matcher",
    title: "The Gate Matcher",
    wish: "Check that every gate in the corridor opens and closes properly.",
    clauses: [
      "Three gate families — (), [], {} — and every opener must be closed by its OWN closer.",
      "Closers must match the MOST RECENTLY opened gate: \"([)]\" is false even though every family's counts balance.",
      "A closer with nothing open is false — \"]\" and \")(\" fail, WITHOUT panicking.",
      "Gates still open at the end are false: \"((\" fails.",
      "Everything else strolls through freely: \"a(b)c\" is true, and so is the empty corridor.",
    ],
    signature: "func Balanced(s string) bool",
    conceptTags: ["stacks", "bracket matching", "LIFO", "underflow"],
    difficulty: "grandmaster",
    language: "go",
    rank: 10,
    starterTests: `func TestMatchesNestedGates(t *testing.T) {
	if !Balanced("([])") {
		t.Errorf("Balanced(\\"([])\\") = false, want true")
	}
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Balanced! Everything is balanced. The corridor, the gates, my books, the universe. Inspection complete.",
        lesson:
          "A predicate tested only on true cases can be replaced by `return true` — every clause that says \"false\" needs its own test.",
        code: `func Balanced(s string) bool {
	return true
}
`,
      },
      {
        id: "count-keeper",
        title: "The Count Keeper",
        monologue:
          "One counter. Openers up, closers down, never below zero, zero at the end. Gates are gates — a round bracket closed by a SQUARE one? They're both gates, aren't they? \"(]\" sails through my arithmetic like visiting royalty.",
        lesson:
          "Counting proves quantity, not identity — a mismatched pair like \"(]\" is the input that forces per-family bookkeeping.",
        code: `func Balanced(s string) bool {
	depth := 0
	for _, c := range s {
		switch c {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
			if depth < 0 {
				return false
			}
		}
	}
	return depth == 0
}
`,
      },
      {
        id: "triple-tallier",
        title: "The Triple Tallier",
        monologue:
          "THREE counters — one per family, each guarded, each zeroed at the end. \"(]\" falls. I am invincible. Then came \"([)]\": every family balanced, every count pristine, and the gates interleaved like a braid. Counters know HOW MANY. They will never know WHICH ORDER.",
        lesson:
          "Per-family counts still can't see nesting — \"([)]\" balances every tally and breaks the order; only a stack remembers WHICH gate is open.",
        code: `func Balanced(s string) bool {
	var round, square, curly int
	for _, c := range s {
		switch c {
		case '(':
			round++
		case ')':
			round--
		case '[':
			square++
		case ']':
			square--
		case '{':
			curly++
		case '}':
			curly--
		}
		if round < 0 || square < 0 || curly < 0 {
			return false
		}
	}
	return round == 0 && square == 0 && curly == 0
}
`,
      },
      {
        id: "forgetful-porter",
        title: "The Forgetful Porter",
        monologue:
          "A real stack! Push the openers, match the closers, reject impostors and early closers alike. At the end of my shift I simply… go home. Whatever is still OPEN back there is the night porter's problem. \"((\" — two gates yawning into the dark — inspected and approved.",
        lesson:
          "The stack must be EMPTY at the end — a suite without a leftover-opener case never forces the final check.",
        code: `func Balanced(s string) bool {
	pairs := map[rune]rune{')': '(', ']': '[', '}': '{'}
	stack := []rune{}
	for _, c := range s {
		switch c {
		case '(', '[', '{':
			stack = append(stack, c)
		case ')', ']', '}':
			if len(stack) == 0 || stack[len(stack)-1] != pairs[c] {
				return false
			}
			stack = stack[:len(stack)-1]
		}
	}
	return true
}
`,
      },
      {
        id: "panicky-porter",
        title: "The Panicky Porter",
        monologue:
          "Stack, matching, leftover check — the full ceremony. But a closer arriving to an EMPTY corridor? I reached for the top of a stack that had no top. stack[len(stack)-1] with len zero is stack[-1], and Go does not do negative indexes. It does panics. Ask \"]\" — it watched me fall.",
        lesson:
          "Pop needs an emptiness guard — a lone closer drives len(stack)-1 to -1 and panics; \"never panics\" is a clause only a hostile input can enforce.",
        code: `func Balanced(s string) bool {
	pairs := map[rune]rune{')': '(', ']': '[', '}': '{'}
	stack := []rune{}
	for _, c := range s {
		switch c {
		case '(', '[', '{':
			stack = append(stack, c)
		case ')', ']', '}':
			if stack[len(stack)-1] != pairs[c] {
				return false
			}
			stack = stack[:len(stack)-1]
		}
	}
	return len(stack) == 0
}
`,
      },
    ],
    reference: `func Balanced(s string) bool {
	pairs := map[rune]rune{')': '(', ']': '[', '}': '{'}
	stack := []rune{}
	for _, c := range s {
		switch c {
		case '(', '[', '{':
			stack = append(stack, c)
		case ')', ']', '}':
			if len(stack) == 0 || stack[len(stack)-1] != pairs[c] {
				return false
			}
			stack = stack[:len(stack)-1]
		}
	}
	return len(stack) == 0
}
`,
    killerTests: `func TestMatchesNestedGates(t *testing.T) {
	if !Balanced("([])") {
		t.Errorf("Balanced(\\"([])\\") = false, want true")
	}
}

func TestAllFamiliesAndProse(t *testing.T) {
	if !Balanced("{}[]()") {
		t.Errorf("Balanced(\\"{}[]()\\") = false, want true")
	}
	if !Balanced("a(b)c{d}") {
		t.Errorf("Balanced(\\"a(b)c{d}\\") = false, want true")
	}
	if !Balanced("({[]})") {
		t.Errorf("Balanced(\\"({[]})\\") = false, want true")
	}
	if !Balanced("") {
		t.Errorf("Balanced(\\"\\") = false, want true")
	}
}

func TestWrongFamilyFails(t *testing.T) {
	if Balanced("(]") {
		t.Errorf("Balanced(\\"(]\\") = true, want false (wrong closer family)")
	}
}

func TestInterleavedGatesFail(t *testing.T) {
	if Balanced("([)]") {
		t.Errorf("Balanced(\\"([)]\\") = true, want false (closers must match the most recent opener)")
	}
}

func TestLeftoverOpenersFail(t *testing.T) {
	if Balanced("((") {
		t.Errorf("Balanced(\\"((\\") = true, want false (unclosed gates)")
	}
	if Balanced("([]") {
		t.Errorf("Balanced(\\"([]\\") = true, want false (unclosed gate)")
	}
}

func TestLoneClosersFail(t *testing.T) {
	if Balanced("]") {
		t.Errorf("Balanced(\\"]\\") = true, want false (nothing to close)")
	}
	if Balanced(")(") {
		t.Errorf("Balanced(\\")(\\") = true, want false (closer before opener)")
	}
}
`,
  },
];
