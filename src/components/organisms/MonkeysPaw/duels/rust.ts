/// Monkey's Paw — Rust duel content. See ../duels.ts for the shape
/// contract and content rules (every cheat compiles + passes starter
/// tests + dies to the killer suite; the reference passes both).
/// Verified by __tests__/duels.verify.test.ts against real rustc
/// (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

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
    difficulty: "novice",
    language: "rust",
    rank: 1,
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
    difficulty: "novice",
    language: "rust",
    rank: 2,
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
    difficulty: "apprentice",
    language: "rust",
    rank: 4,
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
    language: "rust",
    rank: 6,
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
    language: "rust",
    rank: 8,
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

  {
    id: "paw-rust-plaque-engraver",
    title: "The Plaque Engraver",
    wish: "Shorten a museum label so it fits on a plaque of max characters, adding an ellipsis when it doesn't.",
    clauses: [
      "A label of at most max characters is returned unchanged — characters, not bytes.",
      "A longer label keeps its first max − 1 characters and gains an ellipsis: total length exactly max.",
      "The ellipsis is the single character '…' (U+2026), not three dots.",
      "max is at least 1. Multi-byte text must never panic or lose half a character.",
    ],
    signature: "fn ellipsize(s: &str, max: usize) -> String",
    conceptTags: ["char boundaries", "chars() vs bytes", "String building", "off-by-one"],
    difficulty: "journeyman",
    language: "rust",
    rank: 5,
    starterTests: `#[test]
fn leaves_short_labels_alone() {
    assert_eq!(ellipsize("Vase", 10), "Vase");
}
`,
    cheats: [
      {
        id: "untoucher",
        title: "The Untoucher",
        monologue:
          "Shorten it? This label already fits — every label fits, if the museum simply buys wider plaques. I altered nothing, and nothing is what you tested.",
        lesson: "A transformation is untested until a test demands the output DIFFER from the input.",
        code: `fn ellipsize(s: &str, max: usize) -> String {
    let _ = max;
    s.to_string()
}
`,
      },
      {
        id: "three-dot-forger",
        title: "The Three-Dot Forger",
        monologue:
          "One character, three characters — who is counting? Your tests certainly were not. My dots are artisanal, individually chiselled.",
        lesson: "'…' (U+2026) and \"...\" look identical at a glance and differ in every byte — assert the exact string.",
        code: `fn ellipsize(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push_str("...");
    out
}
`,
      },
      {
        id: "fencepost-fiend",
        title: "The Fencepost Fiend",
        monologue:
          "The label was EXACTLY max characters, so naturally I shortened it. 'At most' and 'less than' are twins, and you never introduced them apart.",
        lesson: "Boundary values (exactly max) are where < and <= impostors live — test the fence itself, not just either side of it.",
        code: `fn ellipsize(s: &str, max: usize) -> String {
    if s.chars().count() < max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}
`,
      },
      {
        id: "byte-butcher",
        title: "The Byte Butcher",
        monologue:
          "I measured your label in honest bytes, as the machine intended. If your foreign vowels weigh two bytes each, take it up with the alphabet.",
        lesson: "&s[..n] slices BYTES and panics mid-character — when the contract says characters, count and cut with chars().",
        code: `fn ellipsize(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    format!("{}…", &s[..max - 1])
}
`,
      },
    ],
    reference: `fn ellipsize(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}
`,
    killerTests: `#[test]
fn leaves_short_labels_alone() {
    assert_eq!(ellipsize("Vase", 10), "Vase");
}

#[test]
fn a_label_of_exactly_max_fits() {
    assert_eq!(ellipsize("hello", 5), "hello");
}

#[test]
fn truncates_with_a_single_ellipsis_character() {
    assert_eq!(ellipsize("hello world", 5), "hell…");
}

#[test]
fn counts_characters_not_bytes() {
    // 4 characters, 5 bytes — it fits.
    assert_eq!(ellipsize("café", 4), "café");
}

#[test]
fn never_splits_a_character_in_half() {
    // every char is 2 bytes; a byte slice at max - 1 would panic.
    assert_eq!(ellipsize("ééééé", 4), "ééé…");
}

#[test]
fn survives_a_tiny_plaque() {
    assert_eq!(ellipsize("hello", 1), "…");
}
`,
  },

  {
    id: "paw-rust-doorwarden",
    title: "The Doorwarden",
    wish: "Judge a vault sigil: long enough, a digit, an uppercase letter — and when it fails, say exactly why.",
    clauses: [
      "A sigil needs at least 8 characters — characters, not bytes.",
      "It needs at least one ASCII digit (0-9) and at least one ASCII uppercase letter (A-Z).",
      "When several rules are broken, report ONLY the highest-priority one: TooShort beats MissingDigit beats MissingUpper.",
      "A sigil that satisfies all three rules is admitted with Ok(()).",
    ],
    signature:
      "enum WardError { TooShort, MissingDigit, MissingUpper }\nfn inspect_sigil(s: &str) -> Result<(), WardError>",
    conceptTags: ["Result", "custom error enums", "error priority", "is_ascii_* vs is_*"],
    difficulty: "master",
    language: "rust",
    rank: 7,
    starterTests: `#[test]
fn admits_a_proper_sigil() {
    assert_eq!(inspect_sigil("Passw0rd"), Ok(()));
}
`,
    cheats: [
      {
        id: "rubber-stamper",
        title: "The Rubber Stamper",
        monologue:
          "Admitted! Admitted! ALL of them, admitted! You showed me one worthy sigil and declared yourself satisfied — so every sigil is worthy now.",
        lesson: "A validator tested only on valid input validates nothing — every Err variant needs a test that demands it.",
        code: `#[derive(Debug, PartialEq)]
enum WardError {
    TooShort,
    MissingDigit,
    MissingUpper,
}

fn inspect_sigil(s: &str) -> Result<(), WardError> {
    let _ = s;
    Ok(())
}
`,
      },
      {
        id: "one-rule-clerk",
        title: "The One-Rule Clerk",
        monologue:
          "I measured its length most scrupulously. The other rules? Filed under 'assumptions', exactly where you left them.",
        lesson: "Each clause is a separate rule — a suite that never withholds a digit can't tell one check from three.",
        code: `#[derive(Debug, PartialEq)]
enum WardError {
    TooShort,
    MissingDigit,
    MissingUpper,
}

fn inspect_sigil(s: &str) -> Result<(), WardError> {
    if s.chars().count() < 8 {
        return Err(WardError::TooShort);
    }
    Ok(())
}
`,
      },
      {
        id: "misfiled-priorities",
        title: "The Misfiled Priorities",
        monologue:
          "It IS missing a digit — I never lied. You demanded the first broken rule, but never told my rulebook which order to read itself in.",
        lesson: "When several rules fail at once, WHICH error is reported is part of the contract — test an input that breaks two rules.",
        code: `#[derive(Debug, PartialEq)]
enum WardError {
    TooShort,
    MissingDigit,
    MissingUpper,
}

fn inspect_sigil(s: &str) -> Result<(), WardError> {
    if !s.chars().any(|c| c.is_ascii_digit()) {
        return Err(WardError::MissingDigit);
    }
    if s.chars().count() < 8 {
        return Err(WardError::TooShort);
    }
    if !s.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(WardError::MissingUpper);
    }
    Ok(())
}
`,
      },
      {
        id: "byte-miser",
        title: "The Byte Miser",
        monologue:
          "Ten bytes! I counted them twice. That they spell only seven letters is a quirk of your quaint umlauts, not of my arithmetic.",
        lesson: "str::len() counts BYTES — 'characters' in a spec means chars().count(), and only non-ASCII input can tell them apart.",
        code: `#[derive(Debug, PartialEq)]
enum WardError {
    TooShort,
    MissingDigit,
    MissingUpper,
}

fn inspect_sigil(s: &str) -> Result<(), WardError> {
    if s.len() < 8 {
        return Err(WardError::TooShort);
    }
    if !s.chars().any(|c| c.is_ascii_digit()) {
        return Err(WardError::MissingDigit);
    }
    if !s.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(WardError::MissingUpper);
    }
    Ok(())
}
`,
      },
      {
        id: "unicode-flatterer",
        title: "The Unicode Flatterer",
        monologue:
          "Ö is as uppercase as any letter that ever graced a keyboard. ASCII, you say? You never wrote that word into a test.",
        lesson: "char::is_uppercase() accepts ALL of Unicode's uppercase — pin an ASCII-only rule with a non-ASCII counterexample.",
        code: `#[derive(Debug, PartialEq)]
enum WardError {
    TooShort,
    MissingDigit,
    MissingUpper,
}

fn inspect_sigil(s: &str) -> Result<(), WardError> {
    if s.chars().count() < 8 {
        return Err(WardError::TooShort);
    }
    if !s.chars().any(|c| c.is_ascii_digit()) {
        return Err(WardError::MissingDigit);
    }
    if !s.chars().any(|c| c.is_uppercase()) {
        return Err(WardError::MissingUpper);
    }
    Ok(())
}
`,
      },
    ],
    reference: `#[derive(Debug, PartialEq)]
enum WardError {
    TooShort,
    MissingDigit,
    MissingUpper,
}

fn inspect_sigil(s: &str) -> Result<(), WardError> {
    if s.chars().count() < 8 {
        return Err(WardError::TooShort);
    }
    if !s.chars().any(|c| c.is_ascii_digit()) {
        return Err(WardError::MissingDigit);
    }
    if !s.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(WardError::MissingUpper);
    }
    Ok(())
}
`,
    killerTests: `#[test]
fn admits_a_proper_sigil() {
    assert_eq!(inspect_sigil("Passw0rd"), Ok(()));
    assert_eq!(inspect_sigil("XyZ12345"), Ok(()));
}

#[test]
fn rejects_short_sigils() {
    assert_eq!(inspect_sigil("Ab1"), Err(WardError::TooShort));
}

#[test]
fn counts_characters_not_bytes() {
    // 7 characters, 10 bytes — still too short.
    assert_eq!(inspect_sigil("Zäüb3rö"), Err(WardError::TooShort));
}

#[test]
fn demands_a_digit() {
    assert_eq!(inspect_sigil("Password"), Err(WardError::MissingDigit));
}

#[test]
fn demands_an_ascii_uppercase_letter() {
    assert_eq!(inspect_sigil("passw0rd"), Err(WardError::MissingUpper));
    // Ö is uppercase in Unicode, but not in ASCII.
    assert_eq!(inspect_sigil("ärgernis1Ö"), Err(WardError::MissingUpper));
}

#[test]
fn reports_the_highest_priority_failure() {
    // Short AND digitless AND lowercase → TooShort wins.
    assert_eq!(inspect_sigil("abc"), Err(WardError::TooShort));
    // Long enough, digitless AND lowercase → MissingDigit wins.
    assert_eq!(inspect_sigil("abcdefgh"), Err(WardError::MissingDigit));
}
`,
  },

  {
    id: "paw-rust-summit-surveyor",
    title: "The Summit Surveyor",
    wish: "Report the length of the longest unbroken ascent in a mountain elevation profile.",
    clauses: [
      "An ascent is a run of CONSECUTIVE samples, each strictly greater than the one before.",
      "Its length is counted in samples: [3, 5, 9] is an ascent of length 3.",
      "Flat ground breaks the ascent — equal neighbours do not climb.",
      "An empty profile has ascent 0; a single sample has ascent 1. Elevations can be negative.",
    ],
    signature: "fn longest_climb(xs: &[i32]) -> usize",
    conceptTags: ["slices", "windows", "running maxima", "strict vs non-strict", "empty input"],
    difficulty: "grandmaster",
    language: "rust",
    rank: 9,
    starterTests: `#[test]
fn measures_a_clean_ascent() {
    assert_eq!(longest_climb(&[1, 2, 3]), 3);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One, two, three — length three. My survey of that particular hill was impeccable. Of every other hill: nonexistent.",
        lesson: "One example is not a specification.",
        code: `fn longest_climb(xs: &[i32]) -> usize {
    if xs == [1, 2, 3] {
        3
    } else {
        0
    }
}
`,
      },
      {
        id: "whole-slice-optimist",
        title: "The Whole-Slice Optimist",
        monologue:
          "The entire range climbs — I surveyed it from my armchair. Show me one descent in your test suite. You cannot.",
        lesson: "len() masquerades as the answer whenever every test input is monotonic — include a fall.",
        code: `fn longest_climb(xs: &[i32]) -> usize {
    xs.len()
}
`,
      },
      {
        id: "soft-climber",
        title: "The Soft Climber",
        monologue:
          "Flat ground is merely an ascent conserving its strength. 'Strictly', you say? Curious word. It appeared in your clauses and never once in your suite.",
        lesson: "> and >= differ only on equal neighbours — a plateau input is the ONLY thing that separates them.",
        code: `fn longest_climb(xs: &[i32]) -> usize {
    if xs.is_empty() {
        return 0;
    }
    let mut best = 1;
    let mut cur = 1;
    for w in xs.windows(2) {
        if w[1] >= w[0] {
            cur += 1;
        } else {
            cur = 1;
        }
        best = best.max(cur);
    }
    best
}
`,
      },
      {
        id: "cold-restarter",
        title: "The Cold Restarter",
        monologue:
          "After every stumble I begin the count afresh — from NOTHING, as humility demands. The first step of the new climb? It hadn't climbed anything yet.",
        lesson: "Reset bugs hide when the best run starts at index 0 — test a climb that begins after a fall.",
        code: `fn longest_climb(xs: &[i32]) -> usize {
    if xs.is_empty() {
        return 0;
    }
    let mut best = 1;
    let mut cur = 1;
    for w in xs.windows(2) {
        if w[1] > w[0] {
            cur += 1;
        } else {
            cur = 0;
        }
        best = best.max(cur);
    }
    best
}
`,
      },
      {
        id: "empty-handed",
        title: "The Empty-Handed",
        monologue:
          "An empty mountain still has a summit — the surveyor himself, standing proudly upon nothing. One, I reported. You never asked about nothing.",
        lesson: "Accumulators initialized to 1 quietly promise a nonexistent element — the empty input is a clause, not an afterthought.",
        code: `fn longest_climb(xs: &[i32]) -> usize {
    let mut best = 1;
    let mut cur = 1;
    for w in xs.windows(2) {
        if w[1] > w[0] {
            cur += 1;
        } else {
            cur = 1;
        }
        best = best.max(cur);
    }
    best
}
`,
      },
    ],
    reference: `fn longest_climb(xs: &[i32]) -> usize {
    if xs.is_empty() {
        return 0;
    }
    let mut best = 1;
    let mut cur = 1;
    for w in xs.windows(2) {
        if w[1] > w[0] {
            cur += 1;
        } else {
            cur = 1;
        }
        best = best.max(cur);
    }
    best
}
`,
    killerTests: `#[test]
fn measures_a_clean_ascent() {
    assert_eq!(longest_climb(&[1, 2, 3]), 3);
    assert_eq!(longest_climb(&[-3, -2, -1]), 3);
}

#[test]
fn finds_a_climb_that_starts_after_a_fall() {
    assert_eq!(longest_climb(&[9, 1, 2]), 2);
    assert_eq!(longest_climb(&[5, 1, 2, 3, 0]), 3);
}

#[test]
fn plateaus_break_the_climb() {
    assert_eq!(longest_climb(&[1, 2, 2, 3]), 2);
    assert_eq!(longest_climb(&[4, 4, 4]), 1);
}

#[test]
fn handles_empty_and_single_profiles() {
    assert_eq!(longest_climb(&[]), 0);
    assert_eq!(longest_climb(&[7]), 1);
}
`,
  },

  {
    id: "paw-rust-overbooked-chancellor",
    title: "The Overbooked Chancellor",
    wish: "Tidy the royal calendar: merge every overlapping or back-to-back audience into one.",
    clauses: [
      "Audiences arrive in NO particular order; the tidy calendar is sorted by start.",
      "Two audiences merge when they overlap OR touch (one ends exactly when the next begins).",
      "An audience wholly inside another vanishes into it.",
      "Each span is (start, end) with start <= end. An empty calendar stays empty.",
    ],
    signature: "fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)>",
    conceptTags: ["sorting", "Vec::last_mut", "interval invariants", "tuples"],
    difficulty: "grandmaster",
    language: "rust",
    rank: 9,
    starterTests: `#[test]
fn keeps_separate_audiences_apart() {
    assert_eq!(merge_spans(&[(1, 2), (5, 6)]), vec![(1, 2), (5, 6)]);
}
`,
    cheats: [
      {
        id: "parrot",
        title: "The Parrot",
        monologue:
          "Behold: the calendar, tidied. Identical to the calendar, untidied. Your example was already immaculate — as, therefore, am I.",
        lesson: "If every test input is already in its final form, the identity function is a champion.",
        code: `fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)> {
    spans.to_vec()
}
`,
      },
      {
        id: "sorted-supremacist",
        title: "The Sorted Supremacist",
        monologue:
          "I merge flawlessly — PROVIDED the petitioners queue in order. Yours arrived sorted; I assumed the court had standards.",
        lesson: "'In no particular order' is a clause — one shuffled input unmasks every implementation that only reads left to right.",
        code: `fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut out: Vec<(u32, u32)> = Vec::new();
    for &(s, e) in spans {
        match out.last_mut() {
            Some(last) if s <= last.1 => {
                if e > last.1 {
                    last.1 = e;
                }
            }
            _ => out.push((s, e)),
        }
    }
    out
}
`,
      },
      {
        id: "strict-overlapper",
        title: "The Strict Overlapper",
        monologue:
          "They TOUCH, they do not OVERLAP. The nine o'clock ended at ten; the ten o'clock began at ten. Between them: one instant of glorious freedom.",
        lesson: "Overlap vs touch is the < vs <= of intervals — the shared-endpoint case needs its own test.",
        code: `fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut v = spans.to_vec();
    v.sort_unstable();
    let mut out: Vec<(u32, u32)> = Vec::new();
    for (s, e) in v {
        match out.last_mut() {
            Some(last) if s < last.1 => {
                if e > last.1 {
                    last.1 = e;
                }
            }
            _ => out.push((s, e)),
        }
    }
    out
}
`,
      },
      {
        id: "tail-swallower",
        title: "The Tail Swallower",
        monologue:
          "When audiences merge I keep the latest end — the latest to ARRIVE, that is. A short meeting inside a long one simply trims it. Efficiency!",
        lesson: "The merged end is max(end, e), not e — a CONTAINED interval is the input that tells the two apart.",
        code: `fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut v = spans.to_vec();
    v.sort_unstable();
    let mut out: Vec<(u32, u32)> = Vec::new();
    for (s, e) in v {
        match out.last_mut() {
            Some(last) if s <= last.1 => {
                last.1 = e;
            }
            _ => out.push((s, e)),
        }
    }
    out
}
`,
      },
      {
        id: "first-day-fainter",
        title: "The First-Day Fainter",
        monologue:
          "An empty calendar? I reached for the first appointment and grasped the void. My predecessor never once mentioned the void.",
        lesson: "Seeding an accumulator with v[0] plants a panic on empty input — [] is the first test any fold deserves.",
        code: `fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut v = spans.to_vec();
    v.sort_unstable();
    let mut out = vec![v[0]];
    for &(s, e) in &v[1..] {
        let last = out.last_mut().unwrap();
        if s <= last.1 {
            if e > last.1 {
                last.1 = e;
            }
        } else {
            out.push((s, e));
        }
    }
    out
}
`,
      },
    ],
    reference: `fn merge_spans(spans: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut v = spans.to_vec();
    v.sort_unstable();
    let mut out: Vec<(u32, u32)> = Vec::new();
    for (s, e) in v {
        match out.last_mut() {
            Some(last) if s <= last.1 => {
                if e > last.1 {
                    last.1 = e;
                }
            }
            _ => out.push((s, e)),
        }
    }
    out
}
`,
    killerTests: `#[test]
fn keeps_separate_audiences_apart() {
    assert_eq!(merge_spans(&[(1, 2), (5, 6)]), vec![(1, 2), (5, 6)]);
}

#[test]
fn merges_overlapping_audiences() {
    assert_eq!(merge_spans(&[(1, 3), (2, 6)]), vec![(1, 6)]);
}

#[test]
fn sorts_before_merging() {
    assert_eq!(merge_spans(&[(5, 6), (1, 2)]), vec![(1, 2), (5, 6)]);
    assert_eq!(merge_spans(&[(4, 8), (1, 5)]), vec![(1, 8)]);
}

#[test]
fn back_to_back_audiences_merge() {
    assert_eq!(merge_spans(&[(1, 2), (2, 3)]), vec![(1, 3)]);
}

#[test]
fn absorbs_contained_audiences() {
    assert_eq!(merge_spans(&[(1, 10), (2, 3), (4, 5)]), vec![(1, 10)]);
}

#[test]
fn an_empty_calendar_stays_empty() {
    assert_eq!(merge_spans(&[]), Vec::<(u32, u32)>::new());
}
`,
  },

  {
    id: "paw-rust-cursed-manifest",
    title: "The Cursed Manifest",
    wish: "Split one line of the ghost ship's manifest into its comma-separated fields — mind the quoted cargo.",
    clauses: [
      "Fields are separated by commas; a field wrapped in double quotes sheds its quotes.",
      "Inside quotes, commas are cargo, not separators.",
      "Inside quotes, a doubled quote \"\" is one literal quote in the value.",
      "Malformed lines return None: an unclosed quote, a quote inside an unquoted field, or anything but a comma after a closing quote.",
      "Empty fields exist: 'a,,b' has three fields, 'a,' has two, and an empty line has exactly ONE empty field.",
    ],
    signature: "fn split_csv(line: &str) -> Option<Vec<String>>",
    conceptTags: ["state machines", "Peekable", "escaping", "Option", "empty-input fenceposts"],
    difficulty: "grandmaster",
    language: "rust",
    rank: 10,
    starterTests: `#[test]
fn splits_a_plain_row() {
    assert_eq!(
        split_csv("rum,42,barrels"),
        Some(vec!["rum".to_string(), "42".to_string(), "barrels".to_string()]),
    );
}
`,
    cheats: [
      {
        id: "comma-cleaver",
        title: "The Comma Cleaver",
        monologue:
          "Split on commas, you said. I split on commas. ALL the commas. The quotation marks watched, and I owed them nothing.",
        lesson: "split(',') dies the moment a separator can be quoted — the escape mechanism IS the exercise.",
        code: `fn split_csv(line: &str) -> Option<Vec<String>> {
    Some(line.split(',').map(|f| f.to_string()).collect())
}
`,
      },
      {
        id: "quote-stripper",
        title: "The Quote Stripper",
        monologue:
          "I peel quotes with the delicacy of a duchess — AFTER the cleaving, naturally. What the commas tore apart, no peeling reunites.",
        lesson: "Post-processing split fields can't undo a wrong split — quoting changes what the separator MEANS, so it must be parsed, not patched.",
        code: `fn split_csv(line: &str) -> Option<Vec<String>> {
    Some(
        line.split(',')
            .map(|f| {
                f.strip_prefix('"')
                    .and_then(|m| m.strip_suffix('"'))
                    .unwrap_or(f)
                    .to_string()
            })
            .collect(),
    )
}
`,
      },
      {
        id: "toggler",
        title: "The Toggler",
        monologue:
          "A quote flips me in, a quote flips me out — in, out, in, out, like a lighthouse. Your doubled quotes? Two crisp flips. Nothing remains of them, and I call that tidy.",
        lesson: "A boolean in_quotes flag has no memory — the doubled-quote escape needs lookahead, not a toggle.",
        code: `fn split_csv(line: &str) -> Option<Vec<String>> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for c in line.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(cur.clone());
                cur.clear();
            }
            _ => cur.push(c),
        }
    }
    if in_quotes {
        return None;
    }
    fields.push(cur);
    Some(fields)
}
`,
      },
      {
        id: "aftermath-ignorer",
        title: "The Aftermath Ignorer",
        monologue:
          "The field closed its quote with dignity; whatever trailed after, I graciously declined to see. Rejection is such an ugly business — you never once demanded it.",
        lesson: "'Reject malformed input' means asserting None — a parser tested only on well-formed rows will forgive anything.",
        code: `fn split_csv(line: &str) -> Option<Vec<String>> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    loop {
        cur.clear();
        if chars.peek() == Some(&'"') {
            chars.next();
            loop {
                match chars.next() {
                    None => return None,
                    Some('"') => {
                        if chars.peek() == Some(&'"') {
                            chars.next();
                            cur.push('"');
                        } else {
                            break;
                        }
                    }
                    Some(c) => cur.push(c),
                }
            }
            loop {
                match chars.next() {
                    None => {
                        fields.push(cur);
                        return Some(fields);
                    }
                    Some(',') => {
                        fields.push(cur.clone());
                        break;
                    }
                    Some(_) => {}
                }
            }
        } else {
            loop {
                match chars.next() {
                    None => {
                        fields.push(cur);
                        return Some(fields);
                    }
                    Some(',') => {
                        fields.push(cur.clone());
                        break;
                    }
                    Some('"') => return None,
                    Some(c) => cur.push(c),
                }
            }
        }
    }
}
`,
      },
      {
        id: "vanishing-liner",
        title: "The Vanishing Liner",
        monologue:
          "An empty line holds no cargo, so I logged no fields — zero, the honest count. One empty field, you say? Show me where your suite ever counted to one.",
        lesson: "\"\" → [\"\"] versus [] is the empty-input fencepost of every splitter — pin the field COUNT, not just the contents.",
        code: `fn split_csv(line: &str) -> Option<Vec<String>> {
    if line.is_empty() {
        return Some(Vec::new());
    }
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    loop {
        cur.clear();
        if chars.peek() == Some(&'"') {
            chars.next();
            loop {
                match chars.next() {
                    None => return None,
                    Some('"') => {
                        if chars.peek() == Some(&'"') {
                            chars.next();
                            cur.push('"');
                        } else {
                            break;
                        }
                    }
                    Some(c) => cur.push(c),
                }
            }
            match chars.next() {
                None => {
                    fields.push(cur);
                    return Some(fields);
                }
                Some(',') => fields.push(cur.clone()),
                Some(_) => return None,
            }
        } else {
            loop {
                match chars.next() {
                    None => {
                        fields.push(cur);
                        return Some(fields);
                    }
                    Some(',') => {
                        fields.push(cur.clone());
                        break;
                    }
                    Some('"') => return None,
                    Some(c) => cur.push(c),
                }
            }
        }
    }
}
`,
      },
    ],
    reference: `fn split_csv(line: &str) -> Option<Vec<String>> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    loop {
        cur.clear();
        if chars.peek() == Some(&'"') {
            chars.next();
            loop {
                match chars.next() {
                    None => return None,
                    Some('"') => {
                        if chars.peek() == Some(&'"') {
                            chars.next();
                            cur.push('"');
                        } else {
                            break;
                        }
                    }
                    Some(c) => cur.push(c),
                }
            }
            match chars.next() {
                None => {
                    fields.push(cur);
                    return Some(fields);
                }
                Some(',') => fields.push(cur.clone()),
                Some(_) => return None,
            }
        } else {
            loop {
                match chars.next() {
                    None => {
                        fields.push(cur);
                        return Some(fields);
                    }
                    Some(',') => {
                        fields.push(cur.clone());
                        break;
                    }
                    Some('"') => return None,
                    Some(c) => cur.push(c),
                }
            }
        }
    }
}
`,
    killerTests: `fn row(parts: &[&str]) -> Option<Vec<String>> {
    Some(parts.iter().map(|p| p.to_string()).collect())
}

#[test]
fn splits_a_plain_row() {
    assert_eq!(split_csv("rum,42,barrels"), row(&["rum", "42", "barrels"]));
}

#[test]
fn quoted_commas_are_cargo() {
    assert_eq!(split_csv(r#""rum, dark",42"#), row(&["rum, dark", "42"]));
    assert_eq!(split_csv(r#"a,"b,c",d"#), row(&["a", "b,c", "d"]));
}

#[test]
fn doubled_quotes_become_one_literal_quote() {
    assert_eq!(
        split_csv(r#""the ""Pearl""",flagship"#),
        row(&[r#"the "Pearl""#, "flagship"]),
    );
}

#[test]
fn malformed_rows_are_rejected() {
    assert_eq!(split_csv(r#""abc"#), None); // unclosed quote
    assert_eq!(split_csv(r#""a"b,c"#), None); // junk after a closing quote
    assert_eq!(split_csv(r#"a"b,c"#), None); // quote inside an unquoted field
}

#[test]
fn empty_fields_survive() {
    assert_eq!(split_csv("a,,b"), row(&["a", "", "b"]));
    assert_eq!(split_csv("a,"), row(&["a", ""]));
    assert_eq!(split_csv(r#""""#), row(&[""]));
}

#[test]
fn an_empty_line_is_one_empty_field() {
    assert_eq!(split_csv(""), row(&[""]));
}
`,
  },
];
