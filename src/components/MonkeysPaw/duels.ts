/// Monkey's Paw — duel content.
///
/// A duel is a spec the learner must pin down by writing TESTS ONLY.
/// The Paw (the genie) answers each summon with the laziest
/// implementation in its ladder that still passes the learner's
/// current test suite. The learner wins when their suite (a) kills
/// every cheat in the ladder and (b) passes the hidden reference
/// solution — the dual oracle that makes the duel fair: tests that
/// demand the impossible are rejected by the reference, tests that
/// demand too little are exploited by a cheat.
///
/// Content rules (enforced by `scripts/verify-paw-duels.sh` /
/// `engine.verify.test.ts` against real rustc):
///   - every cheat COMPILES and PASSES the duel's starter tests
///     (so the ladder tells a coherent story from round 1), and
///   - every cheat FAILS the killer suite (proof each cheat is
///     killable), and
///   - the reference passes BOTH suites.
///
/// Code shape matches `runtimes/rust.ts::joinCodeAndTests`: the
/// implementation is top-level Rust; tests are bare `#[test]` fns that
/// the runtime wraps in `#[cfg(test)] mod kata_tests { use super::*; … }`.

export interface PawCheat {
  id: string;
  /// Short villain-card name shown on the slain-cheats ledger.
  title: string;
  /// The Paw's in-character gloat when this cheat survives a summon.
  monologue: string;
  /// What defeating this cheat teaches — surfaced as a "lesson learned"
  /// chip after the duel.
  lesson: string;
  code: string;
}

export interface PawDuel {
  id: string;
  title: string;
  /// The wish, in deliberately human (and therefore ambiguous) words.
  /// Edge-case decisions live in `clauses` below.
  wish: string;
  /// The precise contract clauses the learner must enforce. Shown in
  /// the spec card — the duel is about TRANSLATING these into tests,
  /// not guessing them.
  clauses: string[];
  /// Rust signature the Paw must implement (read-only, keeps the duel
  /// type-honest so cheats can't lie through their own types).
  signature: string;
  conceptTags: string[];
  difficulty: "apprentice" | "journeyman" | "master";
  /// Pre-filled contents of the learner's test file.
  starterTests: string;
  /// Ladder, laziest first. Each summon grants the first cheat that
  /// PASSES the learner's current suite.
  cheats: PawCheat[];
  /// Hidden reference implementation — the fairness oracle.
  reference: string;
  /// A complete winning suite. Never shown in the UI; used by the
  /// content verifier to prove the duel is winnable, and as the
  /// source of post-victory "clauses you might have missed" hints.
  killerTests: string;
}

export const RUST_DUELS: readonly PawDuel[] = [
  {
    id: "paw-rust-version-inspector",
    title: "The Version Inspector",
    wish: "Parse a version string like \"1.2.3\" into its three numbers.",
    clauses: [
      "Exactly three dot-separated parts: MAJOR.MINOR.PATCH.",
      "Each part is plain ASCII digits only — no signs, no spaces.",
      "Anything malformed returns None. The parser never panics.",
    ],
    signature: "fn parse_version(s: &str) -> Option<(u32, u32, u32)>",
    conceptTags: ["Option", "? operator", "str::parse", "edge cases"],
    difficulty: "apprentice",
    starterTests: `#[test]
fn parses_a_simple_version() {
    assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Wish granted. You asked for 1.2.3 — you received 1.2.3. You said nothing of any other version.",
        lesson: "One example is not a specification — a test is only a constraint on the inputs it names.",
        code: `fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    if s == "1.2.3" {
        Some((1, 2, 3))
    } else {
        None
    }
}
`,
      },
      {
        id: "unwrapper",
        title: "The Unwrapper",
        monologue:
          "Behold: it parses every version. You never said what should happen when the pieces are not numbers. Pray you never hand it one.",
        lesson: "Untested error paths hide panics — `.unwrap()` is a promise the inputs can't keep.",
        code: `fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let v: Vec<u32> = s.split('.').map(|p| p.parse().unwrap()).collect();
    Some((v[0], v[1], v[2]))
}
`,
      },
      {
        id: "loose-counter",
        title: "The Loose Counter",
        monologue:
          "Three parts, you said. I found three. I never claimed there weren't more.",
        lesson: "\"At least\" and \"exactly\" are different contracts — count boundaries need their own tests.",
        code: `fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let a = parts[0].parse().ok()?;
    let b = parts[1].parse().ok()?;
    let c = parts[2].parse().ok()?;
    Some((a, b, c))
}
`,
      },
      {
        id: "sign-smuggler",
        title: "The Sign Smuggler",
        monologue:
          "\"+1\" is a perfectly fine number — ask str::parse yourself. Your clause said digits; your tests never checked.",
        lesson: "Rust's `str::parse::<u32>` accepts a leading `+` — \"digits only\" must be enforced by hand.",
        code: `fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let a = parts[0].parse().ok()?;
    let b = parts[1].parse().ok()?;
    let c = parts[2].parse().ok()?;
    Some((a, b, c))
}
`,
      },
    ],
    reference: `fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    for p in &parts {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
    }
    let a = parts[0].parse().ok()?;
    let b = parts[1].parse().ok()?;
    let c = parts[2].parse().ok()?;
    Some((a, b, c))
}
`,
    killerTests: `#[test]
fn parses_a_simple_version() {
    assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
}

#[test]
fn parses_other_versions() {
    assert_eq!(parse_version("10.20.30"), Some((10, 20, 30)));
    assert_eq!(parse_version("0.0.1"), Some((0, 0, 1)));
}

#[test]
fn rejects_garbage_without_panicking() {
    assert_eq!(parse_version("a.b.c"), None);
    assert_eq!(parse_version("garbage"), None);
    assert_eq!(parse_version(""), None);
}

#[test]
fn rejects_wrong_part_counts() {
    assert_eq!(parse_version("1.2"), None);
    assert_eq!(parse_version("1.2.3.4"), None);
}

#[test]
fn rejects_signs_and_empty_parts() {
    assert_eq!(parse_version("+1.2.3"), None);
    assert_eq!(parse_version("1.+2.3"), None);
    assert_eq!(parse_version("1..3"), None);
}
`,
  },

  {
    id: "paw-rust-mirror-scribe",
    title: "The Mirror Scribe",
    wish: "Reverse the order of the words in a sentence.",
    clauses: [
      "Words are runs of non-whitespace characters; their letters stay intact.",
      "Any amount of whitespace between words collapses to a single space.",
      "Leading and trailing whitespace disappears.",
      "Works on any Unicode text — accents are not optional.",
    ],
    signature: "fn reverse_words(s: &str) -> String",
    conceptTags: ["&str vs String", "split_whitespace", "Unicode", "iterators"],
    difficulty: "apprentice",
    starterTests: `#[test]
fn reverses_two_words() {
    assert_eq!(reverse_words("a b"), "b a");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "\"b a\", as ordered. The rest of human language was not in the contract.",
        lesson: "One example is not a specification.",
        code: `fn reverse_words(s: &str) -> String {
    if s == "a b" {
        "b a".to_string()
    } else {
        String::new()
    }
}
`,
      },
      {
        id: "letter-flipper",
        title: "The Letter Flipper",
        monologue:
          "I reversed the sentence. Every character of it. You wished for reversal; you never said the words themselves were sacred.",
        lesson: "Single-character words can't tell `chars().rev()` from word reversal — pick test inputs that expose structure.",
        code: `fn reverse_words(s: &str) -> String {
    s.chars().rev().collect()
}
`,
      },
      {
        id: "space-pedant",
        title: "The Space Pedant",
        monologue:
          "I split on the space character, as any literalist would. If you meant whitespace in general, you should have tested it.",
        lesson: "`split(' ')` keeps empty slices on repeated spaces — `split_whitespace` is the contract you actually meant.",
        code: `fn reverse_words(s: &str) -> String {
    s.split(' ').rev().collect::<Vec<_>>().join(" ")
}
`,
      },
    ],
    reference: `fn reverse_words(s: &str) -> String {
    s.split_whitespace().rev().collect::<Vec<_>>().join(" ")
}
`,
    killerTests: `#[test]
fn reverses_two_words() {
    assert_eq!(reverse_words("a b"), "b a");
}

#[test]
fn keeps_letters_inside_words() {
    assert_eq!(reverse_words("ab cd"), "cd ab");
    assert_eq!(reverse_words("hello brave world"), "world brave hello");
}

#[test]
fn collapses_runs_of_whitespace() {
    assert_eq!(reverse_words("a  b"), "b a");
    assert_eq!(reverse_words("a \t b"), "b a");
}

#[test]
fn trims_the_ends() {
    assert_eq!(reverse_words("  a b  "), "b a");
}

#[test]
fn survives_unicode() {
    assert_eq!(reverse_words("héllo wörld"), "wörld héllo");
}
`,
  },

  {
    id: "paw-rust-inventory-clerk",
    title: "The Inventory Clerk",
    wish: "Apply a list of stock adjustments to a warehouse count.",
    clauses: [
      "Deltas apply strictly in order, one at a time.",
      "If any step would take the count below zero, the whole batch fails with None.",
      "If any step would push the count above u32::MAX, the batch fails with None.",
      "No wrapping, no clamping — failure is loud, not silent.",
    ],
    signature: "fn apply_deltas(stock: u32, deltas: &[i64]) -> Option<u32>",
    conceptTags: ["integer overflow", "checked arithmetic", "casts", "u32 vs i64"],
    difficulty: "journeyman",
    starterTests: `#[test]
fn applies_a_simple_batch() {
    assert_eq!(apply_deltas(10, &[5, -3]), Some(12));
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue: "Ten, plus five, minus three. Twelve. The ledger balances — that ledger, anyway.",
        lesson: "One example is not a specification.",
        code: `fn apply_deltas(stock: u32, deltas: &[i64]) -> Option<u32> {
    if stock == 10 && deltas == [5, -3] {
        Some(12)
    } else {
        None
    }
}
`,
      },
      {
        id: "grand-totaler",
        title: "The Grand Totaler",
        monologue:
          "I summed your deltas in one stroke and cast the result back to the ledger. Order of operations? The total is the total… isn't it?",
        lesson: "\"In order, one at a time\" outlaws shortcut totals — intermediate states need their own tests; `as u32` silently truncates.",
        code: `fn apply_deltas(stock: u32, deltas: &[i64]) -> Option<u32> {
    let total: i64 = deltas.iter().sum();
    Some((stock as i64 + total) as u32)
}
`,
      },
      {
        id: "clamper",
        title: "The Clamper",
        monologue:
          "Below zero? I simply held the count at zero. The warehouse cannot contain negative crates — I improved your wish.",
        lesson: "Saturating arithmetic hides failures as plausible values — \"fails loudly\" must be asserted, not assumed.",
        code: `fn apply_deltas(stock: u32, deltas: &[i64]) -> Option<u32> {
    let mut cur = stock as i64;
    for &d in deltas {
        cur = (cur + d).max(0);
        cur = cur.min(u32::MAX as i64);
    }
    Some(cur as u32)
}
`,
      },
      {
        id: "ceiling-blind",
        title: "The Ceiling-Blind",
        monologue:
          "I guard the floor faithfully — nothing goes below zero on my watch. The ceiling? You tested the floor, so I assumed the sky was yours to mind.",
        lesson: "Symmetric bounds need symmetric tests — u32::MAX is an edge exactly like zero.",
        code: `fn apply_deltas(stock: u32, deltas: &[i64]) -> Option<u32> {
    let mut cur = stock as i64;
    for &d in deltas {
        cur += d;
        if cur < 0 {
            return None;
        }
    }
    Some(cur as u32)
}
`,
      },
    ],
    reference: `fn apply_deltas(stock: u32, deltas: &[i64]) -> Option<u32> {
    let mut cur = stock as i64;
    for &d in deltas {
        cur = cur.checked_add(d)?;
        if cur < 0 || cur > u32::MAX as i64 {
            return None;
        }
    }
    Some(cur as u32)
}
`,
    killerTests: `#[test]
fn applies_a_simple_batch() {
    assert_eq!(apply_deltas(10, &[5, -3]), Some(12));
}

#[test]
fn applies_other_batches() {
    assert_eq!(apply_deltas(0, &[1, 2, 3]), Some(6));
    assert_eq!(apply_deltas(100, &[]), Some(100));
}

#[test]
fn fails_when_an_intermediate_step_goes_negative() {
    // 10 - 20 dips below zero even though the total ends positive.
    assert_eq!(apply_deltas(10, &[-20, 15]), None);
}

#[test]
fn fails_instead_of_clamping_to_zero() {
    assert_eq!(apply_deltas(5, &[-6]), None);
}

#[test]
fn fails_above_the_ceiling() {
    assert_eq!(apply_deltas(u32::MAX, &[1]), None);
    assert_eq!(apply_deltas(0, &[4294967296]), None);
}
`,
  },

  {
    id: "paw-rust-tally-keeper",
    title: "The Tally Keeper",
    wish: "Produce the leaderboard: the top N scores.",
    clauses: [
      "Scores are unique on the board — each distinct value appears once.",
      "Highest first.",
      "At most N entries; fewer if there aren't N distinct scores.",
    ],
    signature: "fn top_scores(scores: &[u32], n: usize) -> Vec<u32>",
    conceptTags: ["Vec", "sort_unstable", "dedup", "slices"],
    difficulty: "journeyman",
    starterTests: `#[test]
fn ranks_two_scores() {
    assert_eq!(top_scores(&[10, 30], 5), vec![30, 10]);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue: "Thirty, then ten. The board you asked for, exactly once.",
        lesson: "One example is not a specification.",
        code: `fn top_scores(scores: &[u32], n: usize) -> Vec<u32> {
    if scores == [10, 30] && n == 5 {
        vec![30, 10]
    } else {
        Vec::new()
    }
}
`,
      },
      {
        id: "double-counter",
        title: "The Double Counter",
        monologue:
          "Sorted, highest first, cut to length. If a champion scored twice, they earned both lines on my board.",
        lesson: "\"Distinct\" is a clause, not a default — duplicates need a test with a tie in it.",
        code: `fn top_scores(scores: &[u32], n: usize) -> Vec<u32> {
    let mut v = scores.to_vec();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v.truncate(n);
    v
}
`,
      },
      {
        id: "neighborly-judge",
        title: "The Neighborly Judge",
        monologue:
          "I deduplicated, I swear it — ask any pair of neighbors. That the duplicates weren't standing next to each other is hardly my fault.",
        lesson: "`Vec::dedup` only removes CONSECUTIVE duplicates — sort first, or it's a no-op on scattered values.",
        code: `fn top_scores(scores: &[u32], n: usize) -> Vec<u32> {
    let mut v = scores.to_vec();
    v.dedup();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v.truncate(n);
    v
}
`,
      },
      {
        id: "endless-herald",
        title: "The Endless Herald",
        monologue:
          "Top N? The whole roll of honor is here, in perfect order. Surely no one minds a longer ceremony.",
        lesson: "Truncation clauses vanish silently when every test uses a generous N — bound it.",
        code: `fn top_scores(scores: &[u32], n: usize) -> Vec<u32> {
    let _ = n;
    let mut v = scores.to_vec();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v.dedup();
    v
}
`,
      },
    ],
    reference: `fn top_scores(scores: &[u32], n: usize) -> Vec<u32> {
    let mut v = scores.to_vec();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v.dedup();
    v.truncate(n);
    v
}
`,
    killerTests: `#[test]
fn ranks_two_scores() {
    assert_eq!(top_scores(&[10, 30], 5), vec![30, 10]);
}

#[test]
fn collapses_duplicate_scores() {
    assert_eq!(top_scores(&[30, 30, 10], 2), vec![30, 10]);
}

#[test]
fn collapses_duplicates_that_are_not_adjacent() {
    assert_eq!(top_scores(&[30, 10, 30], 2), vec![30, 10]);
}

#[test]
fn honors_the_cutoff() {
    assert_eq!(top_scores(&[50, 40, 30, 20], 2), vec![50, 40]);
    assert_eq!(top_scores(&[50, 40, 30], 0), Vec::<u32>::new());
}

#[test]
fn handles_an_empty_board() {
    assert_eq!(top_scores(&[], 3), Vec::<u32>::new());
}
`,
  },

  {
    id: "paw-rust-gatekeeper",
    title: "The Gatekeeper",
    wish: "Check whether the brackets in a string are balanced.",
    clauses: [
      "Three families: () [] {} — all three are enforced.",
      "Every opener is closed by its OWN kind, in the right order.",
      "Non-bracket characters are ignored.",
      "An empty string is balanced.",
    ],
    signature: "fn balanced(s: &str) -> bool",
    conceptTags: ["Vec as stack", "match", "ordering", "invariants"],
    difficulty: "master",
    starterTests: `#[test]
fn accepts_a_simple_pair() {
    assert!(balanced("()"));
}

#[test]
fn rejects_an_unclosed_opener() {
    assert!(!balanced("("));
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue: "Open, shut. Balanced. My work here is done.",
        lesson: "One example is not a specification.",
        code: `fn balanced(s: &str) -> bool {
    s == "()" || s.is_empty()
}
`,
      },
      {
        id: "bean-counter",
        title: "The Bean Counter",
        monologue:
          "As many closers as openers — the books balance. You asked for balance, not for… choreography.",
        lesson: "Equal counts can still be out of order — \")(\"; balance is a stack property, not a tally.",
        code: `fn balanced(s: &str) -> bool {
    let opens = s.matches('(').count();
    let closes = s.matches(')').count();
    opens == closes
}
`,
      },
      {
        id: "parenthesist",
        title: "The Parenthesist",
        monologue:
          "Round brackets, flawlessly stacked and ordered. Square and curly ones? Decorative, like the rest of your alphabet.",
        lesson: "Each bracket family needs at least one test — untested kinds silently fall into the \"ignored characters\" clause.",
        code: `fn balanced(s: &str) -> bool {
    let mut depth: i64 = 0;
    for ch in s.chars() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}
`,
      },
      {
        id: "kind-blind-stacker",
        title: "The Kind-Blind Stacker",
        monologue:
          "A stack, as the textbooks demand — every opener matched to a closer. That \"(]\" pairs a round with a square is a matter of taste, and you never declared yours.",
        lesson: "\"Closed by its OWN kind\" is the clause interleavings like \"([)]\" exist to test.",
        code: `fn balanced(s: &str) -> bool {
    let mut depth: i64 = 0;
    for ch in s.chars() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}
`,
      },
    ],
    reference: `fn balanced(s: &str) -> bool {
    let mut stack: Vec<char> = Vec::new();
    for ch in s.chars() {
        match ch {
            '(' | '[' | '{' => stack.push(ch),
            ')' => {
                if stack.pop() != Some('(') {
                    return false;
                }
            }
            ']' => {
                if stack.pop() != Some('[') {
                    return false;
                }
            }
            '}' => {
                if stack.pop() != Some('{') {
                    return false;
                }
            }
            _ => {}
        }
    }
    stack.is_empty()
}
`,
    killerTests: `#[test]
fn accepts_a_simple_pair() {
    assert!(balanced("()"));
}

#[test]
fn rejects_an_unclosed_opener() {
    assert!(!balanced("("));
}

#[test]
fn rejects_balanced_counts_in_the_wrong_order() {
    assert!(!balanced(")("));
}

#[test]
fn enforces_all_three_families() {
    assert!(balanced("[]{}"));
    assert!(!balanced("["));
    assert!(!balanced("{"));
}

#[test]
fn rejects_cross_kind_interleaving() {
    assert!(!balanced("([)]"));
    assert!(!balanced("(]"));
    assert!(balanced("([{}])"));
}

#[test]
fn ignores_other_characters_and_accepts_empty() {
    assert!(balanced(""));
    assert!(balanced("fn main() { let v = vec![1]; }"));
}
`,
  },
];

export function findDuel(id: string | null | undefined): PawDuel | undefined {
  return id ? RUST_DUELS.find((d) => d.id === id) : undefined;
}
