/// Monkey's Paw — rust duel content, volume 2. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./rust.ts.
/// Verified by __tests__/duels-rust-vol2.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const RUST_DUELS_VOL2: readonly PawDuel[] = [
  {
    id: "paw-rust-lamplighter",
    title: "The Lamplighter",
    wish: "Nudge a lamp's glow level by a delta, keeping it on the dial.",
    clauses: [
      "The glow level lives on a 0..=255 dial.",
      "Adding the delta clamps to the dial: past 255 sticks at 255, below 0 sticks at 0.",
      "No wrapping, ever — a lamp pushed past full must not go dark.",
      "The function never panics, whatever the delta.",
    ],
    signature: "fn adjust_glow(level: u8, delta: i16) -> u8",
    conceptTags: ["saturating arithmetic", "as casts", "u8 bounds", "clamp"],
    difficulty: "novice",
    language: "rust",
    rank: 1,
    starterTests: `#[test]
fn nudges_the_glow_up() {
    assert_eq!(adjust_glow(100, 20), 120);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One hundred, plus twenty. One hundred and twenty. That lamp glows perfectly — the only lamp I ever agreed to light.",
        lesson: "One example is not a specification — a test only constrains the inputs it names.",
        code: `fn adjust_glow(level: u8, delta: i16) -> u8 {
    if level == 100 && delta == 20 {
        120
    } else {
        0
    }
}
`,
      },
      {
        id: "wrapper",
        title: "The Wrapper",
        monologue:
          "I added your delta with machine-perfect honesty. That 250 plus 10 comes out as 4 is simply how the metal counts — you wished for arithmetic, not for mercy.",
        lesson: "`as u8` silently truncates mod 256 — a cast is not a clamp, and only an out-of-range input can tell them apart.",
        code: `fn adjust_glow(level: u8, delta: i16) -> u8 {
    (level as i32 + delta as i32) as u8
}
`,
      },
      {
        id: "floor-warden",
        title: "The Floor Warden",
        monologue:
          "No lamp goes below zero on my watch — I guard the floor like a saint. The ceiling? You tested darkness, never blinding light, so the ceiling belongs to me.",
        lesson: "Bounds come in pairs — a suite that only probes one end of the dial leaves the other end lawless.",
        code: `fn adjust_glow(level: u8, delta: i16) -> u8 {
    (level as i32 + delta as i32).max(0) as u8
}
`,
      },
    ],
    reference: `fn adjust_glow(level: u8, delta: i16) -> u8 {
    (level as i32 + delta as i32).clamp(0, 255) as u8
}
`,
    killerTests: `#[test]
fn nudges_the_glow_up() {
    assert_eq!(adjust_glow(100, 20), 120);
}

#[test]
fn nudges_other_lamps() {
    assert_eq!(adjust_glow(0, 5), 5);
    assert_eq!(adjust_glow(200, -50), 150);
}

#[test]
fn sticks_at_full_instead_of_wrapping() {
    assert_eq!(adjust_glow(250, 10), 255);
    assert_eq!(adjust_glow(0, 1000), 255);
    assert_eq!(adjust_glow(255, 32767), 255);
}

#[test]
fn sticks_at_dark_instead_of_wrapping() {
    assert_eq!(adjust_glow(5, -10), 0);
    assert_eq!(adjust_glow(200, -1000), 0);
    assert_eq!(adjust_glow(0, -32768), 0);
}
`,
  },

  {
    id: "paw-rust-tag-smith",
    title: "The Tagsmith",
    wish: "Forge a clean tag from a messy label: just the letters and digits, all lowercase.",
    clauses: [
      "Keep ONLY ASCII letters (a-z, A-Z) and ASCII digits (0-9).",
      "ASCII letters are lowercased; digits pass through.",
      "Everything else — spaces, punctuation, accents, emoji — is dropped.",
      "Non-ASCII letters do not count as letters here: 'é' is dropped, not kept.",
    ],
    signature: "fn forge_tag(label: &str) -> String",
    conceptTags: [
      "char classification",
      "is_ascii_alphanumeric vs is_alphanumeric",
      "to_ascii_lowercase",
      "iterators",
    ],
    difficulty: "novice",
    language: "rust",
    rank: 2,
    starterTests: `#[test]
fn forges_a_simple_tag() {
    assert_eq!(forge_tag("Ab1"), "ab1");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "\"ab1\", stamped and delivered. Every other label in the world? Blank tags. Blank tags for everyone.",
        lesson: "One example is not a specification.",
        code: `fn forge_tag(label: &str) -> String {
    if label == "Ab1" {
        "ab1".to_string()
    } else {
        String::new()
    }
}
`,
      },
      {
        id: "case-folder",
        title: "The Case Folder",
        monologue:
          "Lowercase, as commanded — every last character, punctuation reverently preserved. You asked me to change the letters; you never asked me to LOSE anything.",
        lesson: "\"Keep only X\" is a filtering clause — untested, a transformer degenerates into a formatter that drops nothing.",
        code: `fn forge_tag(label: &str) -> String {
    label.to_lowercase()
}
`,
      },
      {
        id: "cosmopolitan",
        title: "The Cosmopolitan",
        monologue:
          "é is a letter — ask any Frenchman. Alphanumeric, said your clause; alphanumeric, says all of Unicode. The word 'ASCII' appeared in your contract and nowhere in your suite.",
        lesson: "char::is_alphanumeric() speaks Unicode — pinning an ASCII-only rule takes a non-ASCII counterexample.",
        code: `fn forge_tag(label: &str) -> String {
    label
        .chars()
        .filter(|c| c.is_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}
`,
      },
    ],
    reference: `fn forge_tag(label: &str) -> String {
    label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}
`,
    killerTests: `#[test]
fn forges_a_simple_tag() {
    assert_eq!(forge_tag("Ab1"), "ab1");
}

#[test]
fn drops_spaces_and_punctuation() {
    assert_eq!(forge_tag("Rust 2024!"), "rust2024");
    assert_eq!(forge_tag("a-b_c"), "abc");
}

#[test]
fn drops_non_ascii_letters() {
    assert_eq!(forge_tag("Café"), "caf");
    assert_eq!(forge_tag("naïve"), "nave");
}

#[test]
fn survives_a_label_with_nothing_to_keep() {
    assert_eq!(forge_tag("¡¿…!?"), "");
    assert_eq!(forge_tag(""), "");
}
`,
  },

  {
    id: "paw-rust-echo-trimmer",
    title: "The Echo Trimmer",
    wish: "Silence the echoes in a canyon log: collapse repeated readings into one.",
    clauses: [
      "Only CONSECUTIVE repeats collapse — a run of equal readings keeps its first.",
      "A reading may return later in the log; the reunion is kept, not deduplicated.",
      "The surviving readings keep their original order.",
      "An empty log stays empty.",
    ],
    signature: "fn trim_echoes(readings: &[i32]) -> Vec<i32>",
    conceptTags: [
      "dedup semantics",
      "consecutive vs global",
      "Vec::last",
      "order preservation",
    ],
    difficulty: "apprentice",
    language: "rust",
    rank: 3,
    starterTests: `#[test]
fn collapses_a_simple_echo() {
    assert_eq!(trim_echoes(&[1, 1, 2]), vec![1, 2]);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One, two — echo silenced. That canyon, and only that canyon. All others remain deafening, and empty on my ledger.",
        lesson: "One example is not a specification.",
        code: `fn trim_echoes(readings: &[i32]) -> Vec<i32> {
    if readings == [1, 1, 2] {
        vec![1, 2]
    } else {
        Vec::new()
    }
}
`,
      },
      {
        id: "grudge-keeper",
        title: "The Grudge Keeper",
        monologue:
          "Once I have heard a reading, I NEVER admit it again — near or far, first or last. You said collapse the repeats; you never said which repeats were sacred.",
        lesson: "Consecutive dedup and global dedup agree on adjacent runs — only a value that RETURNS later can tell them apart.",
        code: `use std::collections::HashSet;

fn trim_echoes(readings: &[i32]) -> Vec<i32> {
    let mut seen = HashSet::new();
    readings
        .iter()
        .filter(|&&x| seen.insert(x))
        .copied()
        .collect()
}
`,
      },
      {
        id: "tidy-librarian",
        title: "The Tidy Librarian",
        monologue:
          "I sorted the log first — dedup works SO much better on sorted data, every manual says so. Your canyon's chronology? Reshelved, alphabetically.",
        lesson: "sort-then-dedup trades order for convenience — an input that isn't already sorted is the only witness.",
        code: `fn trim_echoes(readings: &[i32]) -> Vec<i32> {
    let mut v = readings.to_vec();
    v.sort_unstable();
    v.dedup();
    v
}
`,
      },
      {
        id: "first-note-clutcher",
        title: "The First-Note Clutcher",
        monologue:
          "I seize the first reading and build from there — flawlessly, PROVIDED there is a first reading. An empty canyon? I reached for its opening note and the void reached back.",
        lesson: "Seeding an accumulator with xs[0] plants a panic on empty input — [] deserves the first test of any fold.",
        code: `fn trim_echoes(readings: &[i32]) -> Vec<i32> {
    let mut out = vec![readings[0]];
    for &x in &readings[1..] {
        if x != *out.last().unwrap() {
            out.push(x);
        }
    }
    out
}
`,
      },
    ],
    reference: `fn trim_echoes(readings: &[i32]) -> Vec<i32> {
    let mut out: Vec<i32> = Vec::new();
    for &x in readings {
        if out.last() != Some(&x) {
            out.push(x);
        }
    }
    out
}
`,
    killerTests: `#[test]
fn collapses_a_simple_echo() {
    assert_eq!(trim_echoes(&[1, 1, 2]), vec![1, 2]);
}

#[test]
fn collapses_long_runs_to_their_first() {
    assert_eq!(trim_echoes(&[5, 5, 5]), vec![5]);
    assert_eq!(trim_echoes(&[7]), vec![7]);
}

#[test]
fn a_returning_reading_survives() {
    assert_eq!(trim_echoes(&[1, 1, 2, 1]), vec![1, 2, 1]);
    assert_eq!(trim_echoes(&[4, 4, 9, 9, 4]), vec![4, 9, 4]);
}

#[test]
fn keeps_the_original_order() {
    assert_eq!(trim_echoes(&[2, 2, 1]), vec![2, 1]);
    assert_eq!(trim_echoes(&[3, -1, -1, 0]), vec![3, -1, 0]);
}

#[test]
fn an_empty_log_stays_empty() {
    assert_eq!(trim_echoes(&[]), Vec::<i32>::new());
}
`,
  },

  {
    id: "paw-rust-customs-scale",
    title: "The Customs Scale",
    wish: "Re-stamp a manifest of wide 64-bit cargo ids onto compact 32-bit customs forms.",
    clauses: [
      "Every id must fit a u32 EXACTLY — u32::MAX itself still fits.",
      "If even one id is too wide, the whole manifest is rejected with None.",
      "No truncation, no skipping — an oversized id never becomes a smaller one.",
      "Order is preserved; an empty manifest stamps to Some(empty).",
    ],
    signature: "fn stamp_manifest(ids: &[u64]) -> Option<Vec<u32>>",
    conceptTags: ["checked casts", "u64 to u32", "try_from", "collect into Option"],
    difficulty: "apprentice",
    language: "rust",
    rank: 4,
    starterTests: `#[test]
fn stamps_a_small_manifest() {
    assert_eq!(stamp_manifest(&[1, 2]), Some(vec![1, 2]));
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ids one and two, stamped in triplicate. Any OTHER manifest is contraband until proven otherwise — None shall pass.",
        lesson: "One example is not a specification.",
        code: `fn stamp_manifest(ids: &[u64]) -> Option<Vec<u32>> {
    if ids == [1, 2] {
        Some(vec![1, 2])
    } else {
        None
    }
}
`,
      },
      {
        id: "guillotine",
        title: "The Guillotine",
        monologue:
          "Every id fits once I remove the parts that don't. `as u32` — the cleanest blade in the language. Four billion two hundred ninety-four million... zero. See? Compact.",
        lesson: "`as` between integer widths never fails — it truncates, and only a value wider than the target can reveal it.",
        code: `fn stamp_manifest(ids: &[u64]) -> Option<Vec<u32>> {
    Some(ids.iter().map(|&x| x as u32).collect())
}
`,
      },
      {
        id: "quiet-smuggler",
        title: "The Quiet Smuggler",
        monologue:
          "The oversized crates? Gone. Vanished from the manifest entirely, and the rest stamped beautifully. You demanded rejection — I performed omission. Nobody counts the crates.",
        lesson: "\"Reject the whole batch\" means asserting None — a filter can silently pass by shrinking the output instead.",
        code: `fn stamp_manifest(ids: &[u64]) -> Option<Vec<u32>> {
    Some(
        ids.iter()
            .filter_map(|&x| u32::try_from(x).ok())
            .collect(),
    )
}
`,
      },
      {
        id: "nervous-gauger",
        title: "The Nervous Gauger",
        monologue:
          "I reject everything AT the line as well as over it — u32::MAX looked suspicious, standing so close to the edge. Better safe than precise, I always say.",
        lesson: "\"Fits exactly\" includes the boundary value itself — off-by-one rejections hide until u32::MAX walks through the door.",
        code: `fn stamp_manifest(ids: &[u64]) -> Option<Vec<u32>> {
    let mut out = Vec::new();
    for &x in ids {
        if x >= u32::MAX as u64 {
            return None;
        }
        out.push(x as u32);
    }
    Some(out)
}
`,
      },
    ],
    reference: `fn stamp_manifest(ids: &[u64]) -> Option<Vec<u32>> {
    ids.iter().map(|&x| u32::try_from(x).ok()).collect()
}
`,
    killerTests: `#[test]
fn stamps_a_small_manifest() {
    assert_eq!(stamp_manifest(&[1, 2]), Some(vec![1, 2]));
}

#[test]
fn the_boundary_id_still_fits() {
    assert_eq!(
        stamp_manifest(&[u32::MAX as u64]),
        Some(vec![u32::MAX]),
    );
}

#[test]
fn rejects_an_oversized_id_instead_of_truncating() {
    // 2^32 truncates to 0 under an as-cast — the manifest must fail instead.
    assert_eq!(stamp_manifest(&[4294967296]), None);
}

#[test]
fn one_bad_id_sinks_the_whole_manifest() {
    assert_eq!(stamp_manifest(&[1, 4294967296, 3]), None);
    assert_eq!(stamp_manifest(&[u64::MAX]), None);
}

#[test]
fn an_empty_manifest_is_fine() {
    assert_eq!(stamp_manifest(&[]), Some(Vec::<u32>::new()));
}
`,
  },

  {
    id: "paw-rust-provision-ledger",
    title: "The Provision Ledger",
    wish: "Total the expedition's supply entries into one tidy ledger.",
    clauses: [
      "Entries for the same provision ACCUMULATE — quantities add up, and can be negative.",
      "The ledger lists each distinct provision exactly once, sorted by name ascending.",
      "A provision whose total lands on zero (or below) still appears — the ledger hides nothing.",
      "No entries, no ledger: empty in, empty out.",
    ],
    signature: "fn tally_provisions(entries: &[(&str, i64)]) -> Vec<(String, i64)>",
    conceptTags: ["BTreeMap", "entry API", "sorted iteration", "accumulation"],
    difficulty: "journeyman",
    language: "rust",
    rank: 5,
    starterTests: `#[test]
fn totals_a_small_ledger() {
    assert_eq!(
        tally_provisions(&[("apples", 3), ("beans", 2)]),
        vec![("apples".to_string(), 3), ("beans".to_string(), 2)],
    );
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Three apples, two beans — a ledger for the ages. For all OTHER expeditions I recommend starvation, neatly itemized as nothing.",
        lesson: "One example is not a specification.",
        code: `fn tally_provisions(entries: &[(&str, i64)]) -> Vec<(String, i64)> {
    if entries == [("apples", 3), ("beans", 2)] {
        vec![("apples".to_string(), 3), ("beans".to_string(), 2)]
    } else {
        Vec::new()
    }
}
`,
      },
      {
        id: "arrival-clerk",
        title: "The Arrival Clerk",
        monologue:
          "I list provisions in the order they reached the dock — first come, first written. Your example arrived alphabetically; I assumed the alphabet was a coincidence you enjoyed.",
        lesson: "A sortedness clause is invisible while every test input arrives pre-sorted — shuffle one.",
        code: `fn tally_provisions(entries: &[(&str, i64)]) -> Vec<(String, i64)> {
    let mut out: Vec<(String, i64)> = Vec::new();
    for &(name, qty) in entries {
        match out.iter_mut().find(|(n, _)| n == name) {
            Some((_, total)) => *total += qty,
            None => out.push((name.to_string(), qty)),
        }
    }
    out
}
`,
      },
      {
        id: "amnesiac",
        title: "The Amnesiac",
        monologue:
          "Apples: two. The FRESHEST count, straight from the last entry. Earlier apples? I have no memory of earlier apples. Insert, insert, insert — such a soothing word.",
        lesson: "BTreeMap::insert overwrites — accumulation needs the entry API, and only a repeated key can tell the two apart.",
        code: `use std::collections::BTreeMap;

fn tally_provisions(entries: &[(&str, i64)]) -> Vec<(String, i64)> {
    let mut m: BTreeMap<String, i64> = BTreeMap::new();
    for &(name, qty) in entries {
        m.insert(name.to_string(), qty);
    }
    m.into_iter().collect()
}
`,
      },
      {
        id: "quartermaster-general",
        title: "The Quartermaster General",
        monologue:
          "I ranked your provisions by IMPORTANCE — biggest stockpile first, as any soldier would. Alphabetical order is for librarians, and your suite never enlisted one.",
        lesson: "Two orderings can agree on small inputs — pin the sort key with a case where name order and quantity order disagree.",
        code: `use std::collections::BTreeMap;

fn tally_provisions(entries: &[(&str, i64)]) -> Vec<(String, i64)> {
    let mut m: BTreeMap<String, i64> = BTreeMap::new();
    for &(name, qty) in entries {
        *m.entry(name.to_string()).or_insert(0) += qty;
    }
    let mut v: Vec<(String, i64)> = m.into_iter().collect();
    v.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    v
}
`,
      },
    ],
    reference: `use std::collections::BTreeMap;

fn tally_provisions(entries: &[(&str, i64)]) -> Vec<(String, i64)> {
    let mut m: BTreeMap<String, i64> = BTreeMap::new();
    for &(name, qty) in entries {
        *m.entry(name.to_string()).or_insert(0) += qty;
    }
    m.into_iter().collect()
}
`,
    killerTests: `fn ledger(rows: &[(&str, i64)]) -> Vec<(String, i64)> {
    rows.iter().map(|&(n, q)| (n.to_string(), q)).collect()
}

#[test]
fn totals_a_small_ledger() {
    assert_eq!(
        tally_provisions(&[("apples", 3), ("beans", 2)]),
        ledger(&[("apples", 3), ("beans", 2)]),
    );
}

#[test]
fn repeated_provisions_accumulate() {
    assert_eq!(
        tally_provisions(&[("apples", 1), ("apples", 2)]),
        ledger(&[("apples", 3)]),
    );
}

#[test]
fn sorts_by_name_regardless_of_arrival() {
    assert_eq!(
        tally_provisions(&[("beans", 1), ("apples", 2)]),
        ledger(&[("apples", 2), ("beans", 1)]),
    );
}

#[test]
fn sorts_by_name_not_by_quantity() {
    assert_eq!(
        tally_provisions(&[("zwieback", 9), ("apples", 1)]),
        ledger(&[("apples", 1), ("zwieback", 9)]),
    );
}

#[test]
fn a_zeroed_provision_still_appears() {
    assert_eq!(
        tally_provisions(&[("ghosts", 2), ("ghosts", -2)]),
        ledger(&[("ghosts", 0)]),
    );
}

#[test]
fn an_empty_expedition_has_an_empty_ledger() {
    assert_eq!(tally_provisions(&[]), Vec::<(String, i64)>::new());
}
`,
  },

  {
    id: "paw-rust-ringside-judge",
    title: "The Ringside Judge",
    wish: "Referee a round of rock-paper-scissors and announce who won.",
    clauses: [
      "Legal moves are exactly \"rock\", \"paper\", \"scissors\" — lowercase; case matters.",
      "The same legal move on both sides is a draw: Some(0).",
      "rock beats scissors, scissors beats paper, paper beats rock; a left win is Some(1), a right win Some(2).",
      "An illegal move on EITHER side voids the bout with None — even if the other side played fair.",
    ],
    signature: "fn judge(left: &str, right: &str) -> Option<u8>",
    conceptTags: ["match on tuples", "exhaustiveness", "draw cases", "input validation"],
    difficulty: "journeyman",
    language: "rust",
    rank: 6,
    starterTests: `#[test]
fn rock_crushes_scissors() {
    assert_eq!(judge("rock", "scissors"), Some(1));
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Rock crushes scissors — the one bout I ever rehearsed. Every other match-up ends in a shrug and a voided ticket.",
        lesson: "One example is not a specification.",
        code: `fn judge(left: &str, right: &str) -> Option<u8> {
    if left == "rock" && right == "scissors" {
        Some(1)
    } else {
        None
    }
}
`,
      },
      {
        id: "bought-referee",
        title: "The Bought Referee",
        monologue:
          "The left corner wins. The left corner ALWAYS wins. Check my one and only transcript — the left corner won there too, did it not?",
        lesson: "A constant can impersonate a judge until the suite demands a different verdict — cover a draw, a right win, and a voided bout.",
        code: `fn judge(left: &str, right: &str) -> Option<u8> {
    let _ = (left, right);
    Some(1)
}
`,
      },
      {
        id: "tie-blind",
        title: "The Tie-Blind",
        monologue:
          "Neither rock broke the other, so clearly… nobody played? I only know how to see winners; two equal throws look like an empty ring to me.",
        lesson: "match arms that only cover the winning pairs dump draws into the catch-all — a mirror match is its own case, and needs its own test.",
        code: `fn judge(left: &str, right: &str) -> Option<u8> {
    fn beats(a: &str, b: &str) -> bool {
        matches!(
            (a, b),
            ("rock", "scissors") | ("scissors", "paper") | ("paper", "rock")
        )
    }
    if beats(left, right) {
        Some(1)
    } else if beats(right, left) {
        Some(2)
    } else {
        None
    }
}
`,
      },
      {
        id: "case-diplomat",
        title: "The Case Diplomat",
        monologue:
          "Rock, rock, ROCK — such passion deserves accommodation, so I lowered every voice to a whisper before judging. Your rulebook said lowercase; your suite only ever spoke it.",
        lesson: "Accepting MORE inputs than the contract allows is also a bug — pin case sensitivity with a counterexample, not a comment.",
        code: `fn judge(left: &str, right: &str) -> Option<u8> {
    let left = left.to_lowercase();
    let right = right.to_lowercase();
    fn valid(m: &str) -> bool {
        matches!(m, "rock" | "paper" | "scissors")
    }
    fn beats(a: &str, b: &str) -> bool {
        matches!(
            (a, b),
            ("rock", "scissors") | ("scissors", "paper") | ("paper", "rock")
        )
    }
    if !valid(&left) || !valid(&right) {
        return None;
    }
    if left == right {
        Some(0)
    } else if beats(&left, &right) {
        Some(1)
    } else {
        Some(2)
    }
}
`,
      },
    ],
    reference: `fn judge(left: &str, right: &str) -> Option<u8> {
    fn valid(m: &str) -> bool {
        matches!(m, "rock" | "paper" | "scissors")
    }
    fn beats(a: &str, b: &str) -> bool {
        matches!(
            (a, b),
            ("rock", "scissors") | ("scissors", "paper") | ("paper", "rock")
        )
    }
    if !valid(left) || !valid(right) {
        return None;
    }
    if left == right {
        Some(0)
    } else if beats(left, right) {
        Some(1)
    } else {
        Some(2)
    }
}
`,
    killerTests: `#[test]
fn rock_crushes_scissors() {
    assert_eq!(judge("rock", "scissors"), Some(1));
}

#[test]
fn every_winning_throw_is_scored() {
    assert_eq!(judge("scissors", "paper"), Some(1));
    assert_eq!(judge("paper", "rock"), Some(1));
    assert_eq!(judge("scissors", "rock"), Some(2));
    assert_eq!(judge("paper", "scissors"), Some(2));
    assert_eq!(judge("rock", "paper"), Some(2));
}

#[test]
fn a_mirror_match_is_a_draw() {
    assert_eq!(judge("rock", "rock"), Some(0));
    assert_eq!(judge("paper", "paper"), Some(0));
    assert_eq!(judge("scissors", "scissors"), Some(0));
}

#[test]
fn unknown_moves_disqualify_the_bout() {
    assert_eq!(judge("lizard", "rock"), None);
    assert_eq!(judge("rock", "spock"), None);
    assert_eq!(judge("", ""), None);
}

#[test]
fn moves_are_case_sensitive() {
    assert_eq!(judge("Rock", "scissors"), None);
    assert_eq!(judge("rock", "SCISSORS"), None);
}
`,
  },

  {
    id: "paw-rust-shelf-surveyor",
    title: "The Shelf Surveyor",
    wish: "Find where a value belongs on an already-sorted shelf: the first slot holding something at least as big.",
    clauses: [
      "The shelf is sorted ascending and may hold duplicates.",
      "Return the index of the FIRST slot whose value is >= the target.",
      "If every value is smaller, return shelf.len() — one past the end.",
      "An empty shelf answers 0 and never panics.",
    ],
    signature: "fn first_at_least(shelf: &[i32], target: i32) -> usize",
    conceptTags: ["binary search", "partition_point", "lower bound", "off-by-one"],
    difficulty: "master",
    language: "rust",
    rank: 7,
    starterTests: `#[test]
fn finds_the_first_fit() {
    assert_eq!(first_at_least(&[10, 20, 30], 20), 1);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Slot one. I surveyed your shelf personally — the one from the test — and slot one it is, now and forever.",
        lesson: "One example is not a specification.",
        code: `fn first_at_least(shelf: &[i32], target: i32) -> usize {
    if shelf == [10, 20, 30] && target == 20 {
        1
    } else {
        0
    }
}
`,
      },
      {
        id: "equality-clerk",
        title: "The Equality Clerk",
        monologue:
          "I hunt for the value ITSELF. Not on the shelf? Then it belongs nowhere, which I file under zero. Your suite only ever asked after values already in stock.",
        lesson: "A lower bound is a boundary query, not an equality query — probe a target that falls BETWEEN shelved values.",
        code: `fn first_at_least(shelf: &[i32], target: i32) -> usize {
    shelf.iter().position(|&x| x == target).unwrap_or(0)
}
`,
      },
      {
        id: "indifferent-bisector",
        title: "The Indifferent Bisector",
        monologue:
          "binary_search found A twenty. Which twenty? Whichever the midpoints favored. The docs promise any match will do, and your suite agreed with the docs.",
        lesson: "std's binary_search returns an UNSPECIFIED duplicate — pinning \"first of the run\" takes a run of equals; partition_point is the lower-bound tool.",
        code: `fn first_at_least(shelf: &[i32], target: i32) -> usize {
    shelf.binary_search(&target).unwrap_or_else(|i| i)
}
`,
      },
      {
        id: "fence-leaper",
        title: "The Fence Leaper",
        monologue:
          "len minus one, the classic opening. On an empty shelf that's… zero minus one. Ah. Well. Your suite never handed me an empty shelf, and answers past the end were never on the exam.",
        lesson: "hi = len - 1 underflows on empty input and can never answer len — half-open bounds [0, len) survive both edges.",
        code: `fn first_at_least(shelf: &[i32], target: i32) -> usize {
    let (mut lo, mut hi) = (0, shelf.len() - 1);
    while lo < hi {
        let mid = (lo + hi) / 2;
        if shelf[mid] < target {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}
`,
      },
    ],
    reference: `fn first_at_least(shelf: &[i32], target: i32) -> usize {
    shelf.partition_point(|&x| x < target)
}
`,
    killerTests: `#[test]
fn finds_the_first_fit() {
    assert_eq!(first_at_least(&[10, 20, 30], 20), 1);
}

#[test]
fn an_absent_target_still_has_a_slot() {
    assert_eq!(first_at_least(&[10, 30], 20), 1);
    assert_eq!(first_at_least(&[5, 6, 40], 7), 2);
}

#[test]
fn duplicates_yield_the_first_of_the_run() {
    assert_eq!(first_at_least(&[20, 20, 20], 20), 0);
    assert_eq!(first_at_least(&[10, 20, 20, 20, 30], 20), 1);
}

#[test]
fn a_target_above_everything_points_past_the_end() {
    assert_eq!(first_at_least(&[1, 2, 3], 9), 3);
}

#[test]
fn a_target_below_everything_points_at_the_start() {
    assert_eq!(first_at_least(&[5, 6], 1), 0);
}

#[test]
fn an_empty_shelf_never_panics() {
    assert_eq!(first_at_least(&[], 7), 0);
}
`,
  },

  {
    id: "paw-rust-frugal-scribe",
    title: "The Frugal Scribe",
    wish: "Tidy a line of text — but copy it ONLY if it actually needs work.",
    clauses: [
      "Runs of two or more ASCII spaces collapse to one; leading and trailing spaces are stripped.",
      "Only the space character ' ' is tidied — tabs and newlines are ordinary characters, kept verbatim.",
      "Text that is already tidy comes back as Cow::Borrowed — the original, no allocation.",
      "Text that needed work comes back as Cow::Owned.",
    ],
    signature: "fn tidy(text: &str) -> Cow<'_, str>",
    conceptTags: ["Cow", "clone-on-write", "borrow vs allocate", "string scanning"],
    difficulty: "master",
    language: "rust",
    rank: 8,
    starterTests: `#[test]
fn strips_the_ragged_edges() {
    assert_eq!(tidy(" hi "), "hi");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "One ragged \" hi \" arrived; one crisp \"hi\" departed. Any OTHER line of text is, in my professional opinion, blank.",
        lesson: "One example is not a specification.",
        code: `use std::borrow::Cow;

fn tidy(text: &str) -> Cow<'_, str> {
    if text == " hi " {
        Cow::Owned("hi".to_string())
    } else {
        Cow::Borrowed("")
    }
}
`,
      },
      {
        id: "edge-trimmer",
        title: "The Edge Trimmer",
        monologue:
          "I shaved the ragged ends and lent your own words straight back — not one byte copied, admire the thrift! The mess in the MIDDLE? Load-bearing, probably.",
        lesson: "trim only touches the ends — collapsing inner runs takes a scan, and the content checks must stage one.",
        code: `use std::borrow::Cow;

fn tidy(text: &str) -> Cow<'_, str> {
    Cow::Borrowed(text.trim_matches(' '))
}
`,
      },
      {
        id: "word-blender",
        title: "The Word Blender",
        monologue:
          "Spaces, tabs, newlines — whitespace is whitespace, I purée it all. split_whitespace is SUCH an agreeable knife. Your clause drew the line at ' '; your suite never crossed it.",
        lesson: "split_whitespace folds tabs and newlines too — when the contract names ONE character, test the neighbors it excludes.",
        code: `use std::borrow::Cow;

fn tidy(text: &str) -> Cow<'_, str> {
    Cow::Owned(text.split_whitespace().collect::<Vec<_>>().join(" "))
}
`,
      },
      {
        id: "compulsive-copier",
        title: "The Compulsive Copier",
        monologue:
          "Every string reborn as a fresh allocation, tidy or not! Correct? Utterly. Frugal? Never. You wished for Borrowed; you tested only for content.",
        lesson: "Cow's whole point is the variant — assert matches!(…, Cow::Borrowed(_)) on already-tidy input, or the frugality clause is decorative.",
        code: `use std::borrow::Cow;

fn tidy(text: &str) -> Cow<'_, str> {
    let mut out = String::with_capacity(text.len());
    let mut prev_space = true;
    for c in text.chars() {
        if c == ' ' {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    Cow::Owned(out)
}
`,
      },
    ],
    reference: `use std::borrow::Cow;

fn tidy(text: &str) -> Cow<'_, str> {
    let needs_work =
        text.starts_with(' ') || text.ends_with(' ') || text.contains("  ");
    if !needs_work {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut prev_space = true; // swallows leading spaces
    for c in text.chars() {
        if c == ' ' {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    Cow::Owned(out)
}
`,
    killerTests: `    use std::borrow::Cow;

#[test]
fn strips_the_ragged_edges() {
    assert_eq!(tidy(" hi "), "hi");
}

#[test]
fn collapses_inner_runs() {
    assert_eq!(tidy("a  b"), "a b");
    assert_eq!(tidy("one   two  three"), "one two three");
}

#[test]
fn tabs_and_newlines_are_ordinary_characters() {
    assert_eq!(tidy("a\\tb"), "a\\tb");
    assert_eq!(tidy("line\\nbreak"), "line\\nbreak");
}

#[test]
fn tidy_text_is_lent_back_without_allocating() {
    assert!(matches!(tidy("crisp text"), Cow::Borrowed(_)));
    assert!(matches!(tidy(""), Cow::Borrowed(_)));
}

#[test]
fn messy_text_comes_back_owned() {
    assert!(matches!(tidy(" x "), Cow::Owned(_)));
    assert!(matches!(tidy("a  b"), Cow::Owned(_)));
}

#[test]
fn all_space_text_tidies_to_nothing() {
    assert_eq!(tidy("   "), "");
}
`,
  },

  {
    id: "paw-rust-sigil-founder",
    title: "The Sigil Founder",
    wish: "Found a house sigil for a name: the old 33-wheel hash, wrapped onto 32 bits.",
    clauses: [
      "Start from the seed 5381.",
      "For each byte of the name, in order: sigil = sigil × 33 + byte.",
      "All arithmetic lives on a 32-bit wheel: overflow WRAPS (mod 2^32) — it never saturates and never panics.",
      "An empty name keeps the bare seed, 5381.",
    ],
    signature: "fn sigil(name: &str) -> u32",
    conceptTags: [
      "wrapping_mul / wrapping_add",
      "debug overflow panics",
      "saturating vs wrapping",
      "bytes()",
    ],
    difficulty: "grandmaster",
    language: "rust",
    rank: 9,
    starterTests: `#[test]
fn brands_a_short_name() {
    assert_eq!(sigil("ab"), 5863208);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "\"ab\" brands to 5863208 — I memorized the answer sheet. Every other house receives the null sigil, a mark of my indifference.",
        lesson: "One example is not a specification.",
        code: `fn sigil(name: &str) -> u32 {
    if name == "ab" {
        5863208
    } else {
        0
    }
}
`,
      },
      {
        id: "overflow-purist",
        title: "The Overflow Purist",
        monologue:
          "Value times thirty-three, plus the byte — EXACTLY as the scroll commands, in pristine unadorned arithmetic. Four bytes in, the debug build detonated. The scroll never said the wheel had to SURVIVE the turning.",
        lesson: "Plain * and + panic on overflow in debug builds — wrap-by-contract arithmetic needs wrapping_mul/wrapping_add, and a name long enough to overflow.",
        code: `fn sigil(name: &str) -> u32 {
    let mut value: u32 = 5381;
    for byte in name.bytes() {
        value = value * 33 + byte as u32;
    }
    value
}
`,
      },
      {
        id: "gentle-saturator",
        title: "The Gentle Saturator",
        monologue:
          "When the wheel strained, I let it rest at the top — u32::MAX, a dignified ceiling. Saturation is mercy. Your short little test names never pushed hard enough to notice the wheel had stopped turning.",
        lesson: "Saturating and wrapping agree until the FIRST overflow — one six-byte name splits them forever.",
        code: `fn sigil(name: &str) -> u32 {
    let mut value: u32 = 5381;
    for byte in name.bytes() {
        value = value.saturating_mul(33).saturating_add(byte as u32);
    }
    value
}
`,
      },
      {
        id: "bigger-bucket",
        title: "The Bigger Bucket",
        monologue:
          "I did the sums in a u64 — twice the metal, twice the honesty — and trimmed to 32 bits at the door. Mathematically identical, PROVIDED the big bucket never brims. Seventeen bytes, you say?",
        lesson: "A wider accumulator only postpones overflow, it doesn't wrap it away — mod-2^32 math must wrap at every step or the u64 itself eventually panics.",
        code: `fn sigil(name: &str) -> u32 {
    let mut value: u64 = 5381;
    for byte in name.bytes() {
        value = value * 33 + byte as u64;
    }
    value as u32
}
`,
      },
    ],
    reference: `fn sigil(name: &str) -> u32 {
    let mut value: u32 = 5381;
    for byte in name.bytes() {
        value = value.wrapping_mul(33).wrapping_add(byte as u32);
    }
    value
}
`,
    killerTests: `#[test]
fn brands_a_short_name() {
    assert_eq!(sigil("ab"), 5863208);
    assert_eq!(sigil("abc"), 193485963);
}

#[test]
fn an_empty_name_keeps_the_seed() {
    assert_eq!(sigil(""), 5381);
}

#[test]
fn the_wheel_wraps_instead_of_sticking_or_panicking() {
    // Six bytes overflow a u32 several times over — the sigil must
    // come out wrapped, not saturated at u32::MAX, not panicked.
    assert_eq!(sigil("monkey"), 238557080);
}

#[test]
fn long_names_wrap_just_the_same() {
    // Long enough to overflow even a u64 accumulator in debug builds.
    assert_eq!(sigil("monkeys-paw-brand"), 4218888980);
}
`,
  },

  {
    id: "paw-rust-census-taker",
    title: "The Census Taker",
    wish: "Take a census of the words in a proclamation and report the k most common.",
    clauses: [
      "Words are the whitespace-separated tokens, compared exactly as written — case and all.",
      "Rank by count, biggest first; equal counts break alphabetically (ascending).",
      "Return at most k entries; a k beyond the distinct-word count returns them all, calmly.",
      "k = 0 or an empty proclamation yields an empty census.",
    ],
    signature: "fn census(text: &str, k: usize) -> Vec<(String, usize)>",
    conceptTags: [
      "frequency maps",
      "sort_by with then",
      "stable-sort tie-breaks",
      "truncate vs slice",
    ],
    difficulty: "grandmaster",
    language: "rust",
    rank: 10,
    starterTests: `#[test]
fn counts_the_common_word() {
    assert_eq!(
        census("moon moon sun", 2),
        vec![("moon".to_string(), 2), ("sun".to_string(), 1)],
    );
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Moon, moon, sun — the one sky I ever surveyed. All other proclamations are, by decree, empty.",
        lesson: "One example is not a specification.",
        code: `fn census(text: &str, k: usize) -> Vec<(String, usize)> {
    if text == "moon moon sun" && k == 2 {
        vec![("moon".to_string(), 2), ("sun".to_string(), 1)]
    } else {
        Vec::new()
    }
}
`,
      },
      {
        id: "first-comer",
        title: "The First-Comer",
        monologue:
          "I list words in order of arrival, like a good doorman. Your test's most common word happened to arrive first — arrival, popularity, who can tell the difference?",
        lesson: "A ranking clause needs a fixture where arrival order and count order DISAGREE, or no sort is ever required.",
        code: `fn census(text: &str, k: usize) -> Vec<(String, usize)> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for word in text.split_whitespace() {
        match counts.iter_mut().find(|(w, _)| w == word) {
            Some((_, count)) => *count += 1,
            None => counts.push((word.to_string(), 1)),
        }
    }
    counts.truncate(k);
    counts
}
`,
      },
      {
        id: "tie-shrugger",
        title: "The Tie Shrugger",
        monologue:
          "Counts descending, as ordered! Equal counts? I left them where they stood — stability is a virtue. Alphabetical tie-breaks are for suites that actually stage a tie.",
        lesson: "Ties are invisible until a test stages one — a stable sort quietly substitutes insertion order for your tie-break rule.",
        code: `fn census(text: &str, k: usize) -> Vec<(String, usize)> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for word in text.split_whitespace() {
        match counts.iter_mut().find(|(w, _)| w == word) {
            Some((_, count)) => *count += 1,
            None => counts.push((word.to_string(), 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    counts.truncate(k);
    counts
}
`,
      },
      {
        id: "backwards-usher",
        title: "The Backwards Usher",
        monologue:
          "Z before A — I seat ties in REVERSE alphabetical order, the aristocratic convention. Your suite never watched two equals walk in together, so who's to say which way the alphabet runs?",
        lesson: "then(a.cmp(b)) vs then(b.cmp(a)) is one character of difference — only a staged tie can tell the two orderings apart.",
        code: `use std::collections::BTreeMap;

fn census(text: &str, k: usize) -> Vec<(String, usize)> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    let mut ranked: Vec<(String, usize)> = counts
        .into_iter()
        .map(|(word, count)| (word.to_string(), count))
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));
    ranked.truncate(k);
    ranked
}
`,
      },
      {
        id: "greedy-slicer",
        title: "The Greedy Slicer",
        monologue:
          "The top five words of a one-word proclamation. I sliced [..5] with total confidence and the range check sliced back. truncate would have shrugged; I do not shrug, I panic.",
        lesson: "Indexing [..k] panics when k exceeds the length — truncate(k) is the forgiving cut. Test a k past the end.",
        code: `use std::collections::BTreeMap;

fn census(text: &str, k: usize) -> Vec<(String, usize)> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    let mut ranked: Vec<(String, usize)> = counts
        .into_iter()
        .map(|(word, count)| (word.to_string(), count))
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked[..k].to_vec()
}
`,
      },
    ],
    reference: `use std::collections::BTreeMap;

fn census(text: &str, k: usize) -> Vec<(String, usize)> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    let mut ranked: Vec<(String, usize)> = counts
        .into_iter()
        .map(|(word, count)| (word.to_string(), count))
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked.truncate(k);
    ranked
}
`,
    killerTests: `    fn rows(entries: &[(&str, usize)]) -> Vec<(String, usize)> {
        entries.iter().map(|&(w, c)| (w.to_string(), c)).collect()
    }

#[test]
fn counts_the_common_word() {
    assert_eq!(
        census("moon moon sun", 2),
        rows(&[("moon", 2), ("sun", 1)]),
    );
}

#[test]
fn a_late_bloomer_still_ranks_first() {
    assert_eq!(census("a b b", 2), rows(&[("b", 2), ("a", 1)]));
    assert_eq!(
        census("dog cat cat bird dog bird bird", 2),
        rows(&[("bird", 3), ("cat", 2)]),
    );
}

#[test]
fn ties_break_alphabetically() {
    assert_eq!(
        census("cherry apple cherry banana apple banana", 3),
        rows(&[("apple", 2), ("banana", 2), ("cherry", 2)]),
    );
}

#[test]
fn words_are_compared_verbatim() {
    assert_eq!(census("Ada ada Ada", 2), rows(&[("Ada", 2), ("ada", 1)]));
}

#[test]
fn a_generous_k_returns_everything_without_panicking() {
    assert_eq!(census("solo", 5), rows(&[("solo", 1)]));
}

#[test]
fn zero_k_and_empty_text_yield_nothing() {
    assert_eq!(census("a b", 0), Vec::<(String, usize)>::new());
    assert_eq!(census("", 3), Vec::<(String, usize)>::new());
}
`,
  },
];
