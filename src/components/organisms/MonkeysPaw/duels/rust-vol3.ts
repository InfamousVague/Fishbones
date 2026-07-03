/// Monkey's Paw — rust duel content, volume 3. Shape contract +
/// content rules live in ../duels.ts; every cheat must compile/run +
/// pass the starter tests + die to the killer suite, and the
/// reference must pass both. Same test idiom as ./rust.ts.
/// Verified by __tests__/duels-rust-vol3.verify.test.ts (PAW_VERIFY=1).

import type { PawDuel } from "../duels";

export const RUST_DUELS_VOL3: readonly PawDuel[] = [
  {
    id: "paw-rust-ticket-stamper",
    title: "The Ticket Stamper",
    wish: "Stamp queue tickets: a hash mark, then the number padded to four digits.",
    clauses: [
      "The stamp is '#' followed by the number in decimal.",
      "Numbers shorter than four digits gain leading ZEROS: ticket 7 is \"#0007\".",
      "Numbers with four or more digits are stamped whole — never trimmed, never wrapped, never panicked over.",
    ],
    signature: "fn ticket(n: u32) -> String",
    conceptTags: ["format!", "zero padding", "width specifiers", "String"],
    difficulty: "novice",
    language: "rust",
    rank: 1,
    starterTests: `#[test]
fn stamps_a_small_ticket() {
    assert_eq!(ticket(7), "#0007");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ticket seven, stamped #0007, precisely as demanded. The other four billion tickets? Nobody has queued for those yet.",
        lesson: "One example is not a specification — a test constrains only the inputs it names.",
        code: `fn ticket(n: u32) -> String {
    if n == 7 {
        "#0007".to_string()
    } else {
        String::new()
    }
}
`,
      },
      {
        id: "last-four-clerk",
        title: "The Last-Four Clerk",
        monologue:
          "My stamp has four windows, so I show the LAST four digits. Ticket twelve-thousand-three-hundred-forty-five, meet ticket #2345. A tidy queue is a short queue.",
        lesson: "A width specifier is a MINIMUM, not a mold — test a number wider than the pad to outlaw truncation.",
        code: `fn ticket(n: u32) -> String {
    format!("#{:04}", n % 10000)
}
`,
      },
      {
        id: "brittle-smith",
        title: "The Brittle Smith",
        monologue:
          "I forge each zero by hand: four minus the digits you brought me. Bring me five digits and my arithmetic owes you a negative zero — the forge simply explodes.",
        lesson: "usize subtraction panics below zero — hand-rolled padding needs the wide case, or use format!'s {:04}.",
        code: `fn ticket(n: u32) -> String {
    let digits = n.to_string();
    let pad = "0".repeat(4 - digits.len());
    format!("#{}{}", pad, digits)
}
`,
      },
    ],
    reference: `fn ticket(n: u32) -> String {
    format!("#{:04}", n)
}
`,
    killerTests: `#[test]
fn stamps_a_small_ticket() {
    assert_eq!(ticket(7), "#0007");
    assert_eq!(ticket(0), "#0000");
    assert_eq!(ticket(42), "#0042");
}

#[test]
fn four_digit_tickets_fit_exactly() {
    assert_eq!(ticket(1000), "#1000");
    assert_eq!(ticket(9999), "#9999");
}

#[test]
fn wide_tickets_are_stamped_whole() {
    assert_eq!(ticket(12345), "#12345");
    assert_eq!(ticket(4294967295), "#4294967295");
}
`,
  },

  {
    id: "paw-rust-bit-herald",
    title: "The Bit Herald",
    wish: "Proclaim a number in binary.",
    clauses: [
      "Digits are '0' and '1', most significant bit FIRST.",
      "No leading zeros — except zero itself, which is proclaimed as exactly \"0\".",
      "No prefix, no suffix — bare digits only, never \"0b\".",
    ],
    signature: "fn to_binary(n: u32) -> String",
    conceptTags: ["binary", "format! {:b}", "div-mod loops", "digit order"],
    difficulty: "novice",
    language: "rust",
    rank: 2,
    starterTests: `#[test]
fn proclaims_five() {
    assert_eq!(to_binary(5), "101");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Five is 101 — carved in stone, checked against your test, immortal. Every other number is, regrettably, zero.",
        lesson: "One example is not a specification.",
        code: `fn to_binary(n: u32) -> String {
    if n == 5 {
        "101".to_string()
    } else {
        "0".to_string()
    }
}
`,
      },
      {
        id: "backwards-crier",
        title: "The Backwards Crier",
        monologue:
          "I read the bits in the order the remainders fell: littlest first. Your five is a palindrome — 101 forwards, 101 backwards. Choose your heralds' numbers more carefully.",
        lesson: "Div-mod loops emit digits least-significant first — a palindromic test input can't detect a missing reverse.",
        code: `fn to_binary(n: u32) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let mut out = String::new();
    let mut n = n;
    while n > 0 {
        out.push(if n % 2 == 1 { '1' } else { '0' });
        n /= 2;
    }
    out
}
`,
      },
      {
        id: "silent-nothing",
        title: "The Silent Nothing",
        monologue:
          "Zero has no bits worth crying, so I cried… nothing. An empty proclamation for an empty number. Poetic, and entirely untested.",
        lesson: "While-loops that emit digits run zero times for zero — n = 0 is the fencepost every base converter must name.",
        code: `fn to_binary(n: u32) -> String {
    let mut out = String::new();
    let mut n = n;
    while n > 0 {
        out.insert(0, if n % 2 == 1 { '1' } else { '0' });
        n /= 2;
    }
    out
}
`,
      },
    ],
    reference: `fn to_binary(n: u32) -> String {
    format!("{:b}", n)
}
`,
    killerTests: `#[test]
fn proclaims_five() {
    assert_eq!(to_binary(5), "101");
}

#[test]
fn digits_run_most_significant_first() {
    assert_eq!(to_binary(6), "110");
    assert_eq!(to_binary(10), "1010");
}

#[test]
fn no_leading_zeros() {
    assert_eq!(to_binary(1), "1");
    assert_eq!(to_binary(8), "1000");
}

#[test]
fn zero_is_zero() {
    assert_eq!(to_binary(0), "0");
}

#[test]
fn proclaims_the_maximum() {
    assert_eq!(to_binary(4294967295), "1".repeat(32));
}
`,
  },

  {
    id: "paw-rust-harbor-master",
    title: "The Harbor Master",
    wish: "Fetch the harbor's port number from the settings list.",
    clauses: [
      "Settings are (key, value) pairs searched in order; the key must equal \"port\" exactly — case matters.",
      "If \"port\" appears more than once, the FIRST entry wins — even if a later one looks nicer.",
      "The winning value must parse as a u16; a missing key, a junk value, or a number beyond 65535 is None.",
    ],
    signature: "fn get_port(settings: &[(&str, &str)]) -> Option<u16>",
    conceptTags: ["Option", "and_then", "Iterator::find", "parse", "u16 range"],
    difficulty: "apprentice",
    language: "rust",
    rank: 3,
    starterTests: `#[test]
fn finds_the_port() {
    assert_eq!(get_port(&[("port", "8080")]), Some(8080));
}
`,
    cheats: [
      {
        id: "default-answer",
        title: "The Default Answer",
        monologue:
          "Every harbor worth sailing to listens on 8080. I consulted no list; lists are for the insecure.",
        lesson: "A lookup tested with one key-value pair can be replaced by a constant — vary the value AND withhold the key.",
        code: `fn get_port(settings: &[(&str, &str)]) -> Option<u16> {
    let _ = settings;
    Some(8080)
}
`,
      },
      {
        id: "first-drawer-clerk",
        title: "The First-Drawer Clerk",
        monologue:
          "I opened the first drawer and read what was inside. Your list HAD one drawer; how was I to know keys were a filing system?",
        lesson: "A single-entry fixture can't prove the KEY was consulted — bury the entry behind a decoy pair.",
        code: `fn get_port(settings: &[(&str, &str)]) -> Option<u16> {
    settings.first().and_then(|(_, v)| v.parse().ok())
}
`,
      },
      {
        id: "revisionist",
        title: "The Revisionist",
        monologue:
          "History is written by the LAST entry. The earlier ports were drafts — I merely kept the final revision.",
        lesson: "First-wins vs last-wins only diverge on duplicate keys — a duplicated key is the one fixture that pins the clause.",
        code: `fn get_port(settings: &[(&str, &str)]) -> Option<u16> {
    let mut found: Option<u16> = None;
    for (k, v) in settings {
        if *k == "port" {
            found = v.parse().ok();
        }
    }
    found
}
`,
      },
      {
        id: "procrustean-caster",
        title: "The Procrustean Caster",
        monologue:
          "Port seventy-thousand? I parsed it generously as a big number, then trimmed it to fit the u16 bed. Whatever survived the trimming is your port now.",
        lesson: "`as u16` silently truncates — parse into the TARGET type so out-of-range values fail loudly as None.",
        code: `fn get_port(settings: &[(&str, &str)]) -> Option<u16> {
    settings
        .iter()
        .find(|(k, _)| *k == "port")
        .and_then(|(_, v)| v.parse::<u32>().ok())
        .map(|n| n as u16)
}
`,
      },
    ],
    reference: `fn get_port(settings: &[(&str, &str)]) -> Option<u16> {
    settings
        .iter()
        .find(|(k, _)| *k == "port")
        .and_then(|(_, v)| v.parse::<u16>().ok())
}
`,
    killerTests: `#[test]
fn finds_the_port() {
    assert_eq!(get_port(&[("port", "8080")]), Some(8080));
    assert_eq!(get_port(&[("host", "local"), ("port", "80")]), Some(80));
}

#[test]
fn the_first_port_wins() {
    assert_eq!(get_port(&[("port", "1"), ("port", "2")]), Some(1));
}

#[test]
fn missing_key_is_none() {
    assert_eq!(get_port(&[("host", "local")]), None);
    assert_eq!(get_port(&[]), None);
}

#[test]
fn keys_are_case_sensitive() {
    assert_eq!(get_port(&[("Port", "80")]), None);
}

#[test]
fn junk_and_out_of_range_values_are_none() {
    assert_eq!(get_port(&[("port", "eleventy")]), None);
    assert_eq!(get_port(&[("port", "70000")]), None);
}
`,
  },

  {
    id: "paw-rust-beacon-reader",
    title: "The Beacon Reader",
    wish: "Read the night sky: which beacons in a 32-bit signal mask are lit?",
    clauses: [
      "Beacon i is lit when bit i of the mask is 1; bit 0 is the least significant.",
      "Report every lit beacon's index, ascending, 0 through 31.",
      "A dark mask (0) reads as empty; a full mask lights all 32.",
    ],
    signature: "fn lit_beacons(mask: u32) -> Vec<u32>",
    conceptTags: ["bit shifts", "masking", "bit indexing", "range fenceposts"],
    difficulty: "apprentice",
    language: "rust",
    rank: 4,
    starterTests: `#[test]
fn reads_a_lone_beacon() {
    assert_eq!(lit_beacons(0b100), vec![2]);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Bit two, lit — the only star I ever charted. The rest of your skies are permanently overcast.",
        lesson: "One example is not a specification.",
        code: `fn lit_beacons(mask: u32) -> Vec<u32> {
    if mask == 0b100 {
        vec![2]
    } else {
        Vec::new()
    }
}
`,
      },
      {
        id: "descending-crier",
        title: "The Descending Crier",
        monologue:
          "I call the summits first and the foothills last — a herald announces the GRAND lights first. One lit beacon looks the same in any order, and one is all you ever lit.",
        lesson: "Order clauses need two elements to bite — a single-element fixture cannot tell ascending from descending.",
        code: `fn lit_beacons(mask: u32) -> Vec<u32> {
    (0..32).rev().filter(|i| mask >> i & 1 == 1).collect()
}
`,
      },
      {
        id: "low-byte-watchman",
        title: "The Low-Byte Watchman",
        monologue:
          "I watch eight beacons. EIGHT. A very respectable number of beacons. Whatever burns above bit seven is somebody else's shift.",
        lesson: "A u32 has 32 bits — a loop over 0..8 passes every small fixture; light a high bit to expose the short patrol.",
        code: `fn lit_beacons(mask: u32) -> Vec<u32> {
    (0..8).filter(|i| mask >> i & 1 == 1).collect()
}
`,
      },
      {
        id: "summit-misser",
        title: "The Summit Misser",
        monologue:
          "Zero to thirty-one, exclusive — I counted my range like a careful shepherd and left the thirty-second beacon to the wolves. Ranges end SOMEWHERE.",
        lesson: "0..31 silently drops bit 31 — the highest bit is the classic exclusive-range fencepost; test 1 << 31.",
        code: `fn lit_beacons(mask: u32) -> Vec<u32> {
    (0..31).filter(|i| mask >> i & 1 == 1).collect()
}
`,
      },
    ],
    reference: `fn lit_beacons(mask: u32) -> Vec<u32> {
    (0..32).filter(|i| mask >> i & 1 == 1).collect()
}
`,
    killerTests: `#[test]
fn reads_a_lone_beacon() {
    assert_eq!(lit_beacons(0b100), vec![2]);
}

#[test]
fn lists_lit_beacons_in_ascending_order() {
    assert_eq!(lit_beacons(0b1011), vec![0, 1, 3]);
}

#[test]
fn sees_past_the_first_byte() {
    assert_eq!(lit_beacons(1 << 9 | 1), vec![0, 9]);
    assert_eq!(lit_beacons(1 << 20), vec![20]);
}

#[test]
fn the_topmost_beacon_counts_too() {
    assert_eq!(lit_beacons(1 << 31), vec![31]);
    assert_eq!(lit_beacons(u32::MAX), (0..32).collect::<Vec<u32>>());
}

#[test]
fn a_dark_sky_reads_empty() {
    assert_eq!(lit_beacons(0), Vec::<u32>::new());
}
`,
  },

  {
    id: "paw-rust-dance-marshal",
    title: "The Dance Marshal",
    wish: "Pair the two lines of dancers — first with first, second with second — until one line runs out.",
    clauses: [
      "Pair strictly by position: leads[i] with follows[i].",
      "The dance stops at the SHORTER line; extra dancers on either side sit out.",
      "Pairs keep line order; if either line is empty there are no pairs.",
    ],
    signature: "fn pair_up(leads: &[&str], follows: &[&str]) -> Vec<(String, String)>",
    conceptTags: ["zip", "shorter-side fencing", "tuples", "to_string"],
    difficulty: "journeyman",
    language: "rust",
    rank: 5,
    starterTests: `#[test]
fn pairs_a_single_couple() {
    assert_eq!(
        pair_up(&["ana"], &["bo"]),
        vec![("ana".to_string(), "bo".to_string())],
    );
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Ana dances with Bo. That is the dance. There has only ever been one dance.",
        lesson: "One example is not a specification.",
        code: `fn pair_up(leads: &[&str], follows: &[&str]) -> Vec<(String, String)> {
    if leads == ["ana"] && follows == ["bo"] {
        vec![("ana".to_string(), "bo".to_string())]
    } else {
        Vec::new()
    }
}
`,
      },
      {
        id: "mirror-matcher",
        title: "The Mirror Matcher",
        monologue:
          "First lead, LAST follow — I pair across the room, it's terribly romantic. With one couple on the floor, who could tell I was matching backwards?",
        lesson: "Pairing clauses need at least two pairs — a single-couple fixture cannot see a reversed zip.",
        code: `fn pair_up(leads: &[&str], follows: &[&str]) -> Vec<(String, String)> {
    leads
        .iter()
        .zip(follows.iter().rev())
        .map(|(lead, follow)| (lead.to_string(), follow.to_string()))
        .collect()
}
`,
      },
      {
        id: "lead-counter",
        title: "The Lead Counter",
        monologue:
          "I count couples by the leads' line — every lead SHALL dance. Three leads, one follow… follows[1]… the ballroom has encountered an index and stopped existing.",
        lesson: "Indexing one slice by another's length panics the moment they differ — zip fences at the shorter side for free.",
        code: `fn pair_up(leads: &[&str], follows: &[&str]) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    for i in 0..leads.len() {
        pairs.push((leads[i].to_string(), follows[i].to_string()));
    }
    pairs
}
`,
      },
      {
        id: "ghost-inviter",
        title: "The Ghost Inviter",
        monologue:
          "Nobody sits out in MY ballroom — the unpartnered dance with the empty string, a very accommodating partner. You said extras sit out; your suite never counted the couples.",
        lesson: "Padding the short side inflates the output — asserting the LENGTH of the result is part of the fencing contract.",
        code: `fn pair_up(leads: &[&str], follows: &[&str]) -> Vec<(String, String)> {
    let longest = leads.len().max(follows.len());
    (0..longest)
        .map(|i| {
            (
                leads.get(i).unwrap_or(&"").to_string(),
                follows.get(i).unwrap_or(&"").to_string(),
            )
        })
        .collect()
}
`,
      },
    ],
    reference: `fn pair_up(leads: &[&str], follows: &[&str]) -> Vec<(String, String)> {
    leads
        .iter()
        .zip(follows.iter())
        .map(|(lead, follow)| (lead.to_string(), follow.to_string()))
        .collect()
}
`,
    killerTests: `    fn couples(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|&(l, f)| (l.to_string(), f.to_string()))
            .collect()
    }

#[test]
fn pairs_a_single_couple() {
    assert_eq!(pair_up(&["ana"], &["bo"]), couples(&[("ana", "bo")]));
}

#[test]
fn pairs_by_position_in_order() {
    assert_eq!(
        pair_up(&["ana", "cy"], &["bo", "di"]),
        couples(&[("ana", "bo"), ("cy", "di")]),
    );
}

#[test]
fn extra_leads_sit_out() {
    assert_eq!(
        pair_up(&["ana", "cy", "ed"], &["bo"]),
        couples(&[("ana", "bo")]),
    );
}

#[test]
fn extra_follows_sit_out() {
    assert_eq!(
        pair_up(&["ana"], &["bo", "di", "fi"]),
        couples(&[("ana", "bo")]),
    );
}

#[test]
fn an_empty_line_means_no_dance() {
    assert_eq!(pair_up(&[], &["bo"]), Vec::<(String, String)>::new());
    assert_eq!(pair_up(&["ana"], &[]), Vec::<(String, String)>::new());
}
`,
  },

  {
    id: "paw-rust-quarry-sifter",
    title: "The Quarry Sifter",
    wish: "Cull the quarry: strike every score below the cutoff from the list and report the toll.",
    clauses: [
      "Scores strictly below the cutoff are removed, in place; scores EQUAL to the cutoff stay.",
      "Survivors keep their original order.",
      "Return how many scores were REMOVED — not how many remain.",
    ],
    signature: "fn cull(scores: &mut Vec<i32>, cutoff: i32) -> usize",
    conceptTags: ["Vec::retain", "in-place mutation", "&mut parameters", "swap_remove ordering"],
    difficulty: "journeyman",
    language: "rust",
    rank: 6,
    starterTests: `#[test]
fn culls_the_straggler() {
    let mut scores = vec![5, 1];
    assert_eq!(cull(&mut scores, 4), 1);
    assert_eq!(scores, vec![5]);
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Five stays, one goes, the toll is one. I keep that exact quarry stuffed and mounted; all other quarries are, officially, pristine.",
        lesson: "One example is not a specification.",
        code: `fn cull(scores: &mut Vec<i32>, cutoff: i32) -> usize {
    if *scores == [5, 1] && cutoff == 4 {
        *scores = vec![5];
        1
    } else {
        0
    }
}
`,
      },
      {
        id: "boundary-butcher",
        title: "The Boundary Butcher",
        monologue:
          "BELOW the cutoff, AT the cutoff — margins of error, margins of victory, I cull them all. A score that merely EQUALS the bar has hardly cleared it, and your suite never stood one on the line.",
        lesson: "Strictly-below means >= survives — a value sitting exactly on the cutoff is the only witness to a > vs >= typo.",
        code: `fn cull(scores: &mut Vec<i32>, cutoff: i32) -> usize {
    let before = scores.len();
    scores.retain(|&score| score > cutoff);
    before - scores.len()
}
`,
      },
      {
        id: "keeper-counter",
        title: "The Keeper Counter",
        monologue:
          "Two entered, one remains, and I reported… one. Removed, remaining — both were one in your quarry of two. A coincidence I intend to keep exploiting.",
        lesson: "When kept == removed the two counts are indistinguishable — pick fixture sizes where every wrong aggregate differs.",
        code: `fn cull(scores: &mut Vec<i32>, cutoff: i32) -> usize {
    scores.retain(|&score| score >= cutoff);
    scores.len()
}
`,
      },
      {
        id: "off-kilter-swapper",
        title: "The Off-Kilter Swapper",
        monologue:
          "swap_remove — O(1)! I cull with EFFICIENCY, dragging the last survivor into each vacancy. The order of the survivors? A small administrative reshuffling.",
        lesson: "swap_remove buys speed by breaking order — an order-preserving contract needs retain, and a test where a culled slot precedes surviving elements.",
        code: `fn cull(scores: &mut Vec<i32>, cutoff: i32) -> usize {
    let mut removed = 0;
    let mut i = 0;
    while i < scores.len() {
        if scores[i] < cutoff {
            scores.swap_remove(i);
            removed += 1;
        } else {
            i += 1;
        }
    }
    removed
}
`,
      },
    ],
    reference: `fn cull(scores: &mut Vec<i32>, cutoff: i32) -> usize {
    let before = scores.len();
    scores.retain(|&score| score >= cutoff);
    before - scores.len()
}
`,
    killerTests: `#[test]
fn culls_the_straggler() {
    let mut scores = vec![5, 1];
    assert_eq!(cull(&mut scores, 4), 1);
    assert_eq!(scores, vec![5]);
}

#[test]
fn scores_on_the_cutoff_survive() {
    let mut scores = vec![4, 3, 4];
    assert_eq!(cull(&mut scores, 4), 1);
    assert_eq!(scores, vec![4, 4]);
}

#[test]
fn reports_the_removed_not_the_kept() {
    let mut scores = vec![1, 2, 9];
    assert_eq!(cull(&mut scores, 5), 2);
    assert_eq!(scores, vec![9]);
}

#[test]
fn survivors_keep_their_order() {
    let mut scores = vec![1, 9, 2, 8];
    assert_eq!(cull(&mut scores, 5), 2);
    assert_eq!(scores, vec![9, 8]);
}

#[test]
fn a_full_cull_and_an_empty_quarry() {
    let mut scores = vec![1, 2];
    assert_eq!(cull(&mut scores, 10), 2);
    assert_eq!(scores, Vec::<i32>::new());

    let mut empty: Vec<i32> = Vec::new();
    assert_eq!(cull(&mut empty, 3), 0);
    assert_eq!(empty, Vec::<i32>::new());
}
`,
  },

  {
    id: "paw-rust-fare-clerk",
    title: "The Fare Clerk",
    wish: "Print a fare in dollars from a count of cents — bank-clean, sign and all.",
    clauses: [
      "Format: dollars, a dot, exactly two cent digits — 1234 is \"$12.34\", 5 is \"$0.05\".",
      "Negative fares place the minus BEFORE the dollar sign: -5 is \"-$0.05\".",
      "Zero is \"$0.00\".",
      "Exact across the entire i64 range — integer math only; no float may round the books.",
    ],
    signature: "fn fare(cents: i64) -> String",
    conceptTags: [
      "integer money",
      "format! zero-padding",
      "unsigned_abs",
      "f64 precision loss",
    ],
    difficulty: "master",
    language: "rust",
    rank: 7,
    starterTests: `#[test]
fn prints_a_simple_fare() {
    assert_eq!(fare(1234), "$12.34");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Twelve dollars and thirty-four cents, printed to perfection. All other journeys are complimentary — $0.00, with the house's regards.",
        lesson: "One example is not a specification.",
        code: `fn fare(cents: i64) -> String {
    if cents == 1234 {
        "$12.34".to_string()
    } else {
        "$0.00".to_string()
    }
}
`,
      },
      {
        id: "pad-skipper",
        title: "The Pad Skipper",
        monologue:
          "Twelve dollars and… five. Just five. The zero was implied — pause meaningfully between the words. {} pads nothing, and your fixture's cents were coincidentally two digits wide.",
        lesson: "cents % 100 has one digit half the time — {:02} is the difference between $12.05 and $12.5; test single-digit cents.",
        code: `fn fare(cents: i64) -> String {
    format!("\${}.{}", cents / 100, cents % 100)
}
`,
      },
      {
        id: "floating-teller",
        title: "The Floating Teller",
        monologue:
          "I divide by a hundred in the finest double precision and let {:.2} sweep up. What's one representational error between friends? And my minus sign goes wherever the FLOAT puts it.",
        lesson: "Money in f64 drifts past 2^53 and formats its sign after the '$' — keep cents in integers; test a negative and a giant fare.",
        code: `fn fare(cents: i64) -> String {
    format!("\${:.2}", cents as f64 / 100.0)
}
`,
      },
      {
        id: "sign-mangler",
        title: "The Sign Mangler",
        monologue:
          "Negative fares? I let integer division carry the minus wherever it pleased — sometimes onto the dollars, sometimes into oblivion. Minus five cents came out a nickel CREDIT. The books balance if you squint.",
        lesson: "cents / 100 truncates toward zero, so -5 has 'positive zero' dollars — split sign from magnitude (unsigned_abs) before formatting.",
        code: `fn fare(cents: i64) -> String {
    let dollars = cents / 100;
    let rest = (cents % 100).abs();
    format!("\${}.{:02}", dollars, rest)
}
`,
      },
    ],
    reference: `fn fare(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let magnitude = cents.unsigned_abs();
    format!("{}\${}.{:02}", sign, magnitude / 100, magnitude % 100)
}
`,
    killerTests: `#[test]
fn prints_a_simple_fare() {
    assert_eq!(fare(1234), "$12.34");
    assert_eq!(fare(0), "$0.00");
}

#[test]
fn small_change_keeps_its_two_digits() {
    assert_eq!(fare(5), "$0.05");
    assert_eq!(fare(1205), "$12.05");
}

#[test]
fn refunds_put_the_minus_before_the_dollar() {
    assert_eq!(fare(-5), "-$0.05");
    assert_eq!(fare(-1234), "-$12.34");
}

#[test]
fn giant_fares_never_drift() {
    // 2^53 + 1 cents: one past what an f64 can represent exactly.
    assert_eq!(fare(9007199254740993), "$90071992547409.93");
}

#[test]
fn the_deepest_debt_still_prints() {
    assert_eq!(fare(i64::MIN), "-$92233720368547758.08");
}
`,
  },

  {
    id: "paw-rust-frame-gauger",
    title: "The Frame Gauger",
    wish: "Gauge a display spec like \"1920x1080\" into a width and height — or say precisely what's wrong.",
    clauses: [
      "A spec is <width>x<height> with EXACTLY one 'x'; anything else is Err(\"expected WxH\").",
      "Width and height are plain decimal u32 digits — no signs, no spaces; a dimension of zero is invalid.",
      "Bad or zero width is Err(\"bad width\"); bad or zero height is Err(\"bad height\").",
      "Complaints come in order: shape first, then width, then height.",
    ],
    signature: "fn parse_frame(spec: &str) -> Result<(u32, u32), String>",
    conceptTags: ["Result", "split_once", "error priority", "map_err"],
    difficulty: "master",
    language: "rust",
    rank: 8,
    starterTests: `#[test]
fn gauges_a_classic_frame() {
    assert_eq!(parse_frame("1920x1080"), Ok((1920, 1080)));
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Nineteen-twenty by ten-eighty, the only resolution that matters. All other frames fail my aesthetic review: expected WxH.",
        lesson: "One example is not a specification.",
        code: `fn parse_frame(spec: &str) -> Result<(u32, u32), String> {
    if spec == "1920x1080" {
        Ok((1920, 1080))
    } else {
        Err("expected WxH".to_string())
    }
}
`,
      },
      {
        id: "split-splurger",
        title: "The Split Splurger",
        monologue:
          "I split on every 'x' and keep the first two shards — extras are bonus material. And a spec with NO 'x'? I reached for shard two and the whole gauge went down the stairs.",
        lesson: "split().collect()[1] panics on missing separators and shrugs at extras — split_once plus a leftovers check pins 'exactly one'.",
        code: `fn parse_frame(spec: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = spec.split('x').collect();
    let width = parts[0].parse().map_err(|_| "bad width".to_string())?;
    let height = parts[1].parse().map_err(|_| "bad height".to_string())?;
    Ok((width, height))
}
`,
      },
      {
        id: "zero-admitter",
        title: "The Zero Admitter",
        monologue:
          "A zero-by-hundred frame — minimalist! Daring! u32 parsing embraced it, so who was I to judge? Your clause called zero invalid; your parser tests never drew it.",
        lesson: "parse::<u32>() happily returns 0 — 'must be positive' is a range rule layered on top of parsing, and needs its own test.",
        code: `fn parse_frame(spec: &str) -> Result<(u32, u32), String> {
    let (w, h) = match spec.split_once('x') {
        Some((w, h)) if !h.contains('x') => (w, h),
        _ => return Err("expected WxH".to_string()),
    };
    let width: u32 = w.parse().map_err(|_| "bad width".to_string())?;
    let height: u32 = h.parse().map_err(|_| "bad height".to_string())?;
    Ok((width, height))
}
`,
      },
      {
        id: "hospitable-trimmer",
        title: "The Hospitable Trimmer",
        monologue:
          "A little whitespace never hurt a spec — I trim my guests before measuring them. Generosity! Your contract said plain digits; your suite never sent a padded envelope.",
        lesson: "Being lenient where the contract is strict is a spec violation too — test that ' 1920x1080' is refused, not forgiven.",
        code: `fn parse_frame(spec: &str) -> Result<(u32, u32), String> {
    let spec = spec.trim();
    let (w, h) = match spec.split_once('x') {
        Some((w, h)) if !h.contains('x') => (w, h),
        _ => return Err("expected WxH".to_string()),
    };
    let width: u32 = w.trim().parse().map_err(|_| "bad width".to_string())?;
    if width == 0 {
        return Err("bad width".to_string());
    }
    let height: u32 = h.trim().parse().map_err(|_| "bad height".to_string())?;
    if height == 0 {
        return Err("bad height".to_string());
    }
    Ok((width, height))
}
`,
      },
      {
        id: "priority-scrambler",
        title: "The Priority Scrambler",
        monologue:
          "Both dimensions were garbage, so I complained about… the height. I read right-to-left on Tuesdays. Your clause ranked the complaints; your suite never made two fail at once.",
        lesson: "Error priority only shows when several errors coexist — 'axb' is the one probe that orders the complaints.",
        code: `fn parse_frame(spec: &str) -> Result<(u32, u32), String> {
    let (w, h) = match spec.split_once('x') {
        Some((w, h)) if !h.contains('x') => (w, h),
        _ => return Err("expected WxH".to_string()),
    };
    let height: u32 = h.parse().map_err(|_| "bad height".to_string())?;
    if height == 0 {
        return Err("bad height".to_string());
    }
    let width: u32 = w.parse().map_err(|_| "bad width".to_string())?;
    if width == 0 {
        return Err("bad width".to_string());
    }
    Ok((width, height))
}
`,
      },
    ],
    reference: `fn parse_frame(spec: &str) -> Result<(u32, u32), String> {
    let (w, h) = match spec.split_once('x') {
        Some((w, h)) if !h.contains('x') => (w, h),
        _ => return Err("expected WxH".to_string()),
    };
    let width: u32 = w.parse().map_err(|_| "bad width".to_string())?;
    if width == 0 {
        return Err("bad width".to_string());
    }
    let height: u32 = h.parse().map_err(|_| "bad height".to_string())?;
    if height == 0 {
        return Err("bad height".to_string());
    }
    Ok((width, height))
}
`,
    killerTests: `#[test]
fn gauges_a_classic_frame() {
    assert_eq!(parse_frame("1920x1080"), Ok((1920, 1080)));
    assert_eq!(parse_frame("1x1"), Ok((1, 1)));
}

#[test]
fn a_spec_needs_exactly_one_x() {
    assert_eq!(parse_frame("1920"), Err("expected WxH".to_string()));
    assert_eq!(parse_frame("1x2x3"), Err("expected WxH".to_string()));
}

#[test]
fn zero_dimensions_are_refused() {
    assert_eq!(parse_frame("0x100"), Err("bad width".to_string()));
    assert_eq!(parse_frame("100x0"), Err("bad height".to_string()));
}

#[test]
fn width_complaints_come_first() {
    assert_eq!(parse_frame("axb"), Err("bad width".to_string()));
}

#[test]
fn junk_dimensions_name_the_culprit() {
    assert_eq!(parse_frame("wx100"), Err("bad width".to_string()));
    assert_eq!(parse_frame("100xh"), Err("bad height".to_string()));
    assert_eq!(parse_frame("x100"), Err("bad width".to_string()));
}

#[test]
fn stray_whitespace_is_not_forgiven() {
    assert_eq!(parse_frame(" 1920x1080"), Err("bad width".to_string()));
    assert_eq!(parse_frame("1920x1080 "), Err("bad height".to_string()));
}
`,
  },

  {
    id: "paw-rust-imperial-engraver",
    title: "The Imperial Engraver",
    wish: "Engrave a year (1..=3999) in Roman numerals, as the stonecutters actually did.",
    clauses: [
      "Symbols: I=1, V=5, X=10, L=50, C=100, D=500, M=1000, largest first.",
      "Subtractive forms are law: 4=IV, 9=IX, 40=XL, 90=XC, 400=CD, 900=CM — never IIII.",
      "The input is guaranteed to be between 1 and 3999.",
    ],
    signature: "fn to_roman(n: u32) -> String",
    conceptTags: ["greedy algorithms", "value tables", "subtractive notation", "const arrays"],
    difficulty: "grandmaster",
    language: "rust",
    rank: 9,
    starterTests: `#[test]
fn engraves_a_plain_year() {
    assert_eq!(to_roman(12), "XII");
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "XII — a year I engraved once and framed. All other years receive a blank slab, very avant-garde.",
        lesson: "One example is not a specification.",
        code: `fn to_roman(n: u32) -> String {
    if n == 12 {
        "XII".to_string()
    } else {
        String::new()
    }
}
`,
      },
      {
        id: "additive-ancient",
        title: "The Additive Ancient",
        monologue:
          "IIII, as on grandfather's clock! The TRUE old ways — sum the symbols, subtract nothing. Your test year was conveniently free of fours and nines.",
        lesson: "A greedy table without the six subtractive pairs still nails most numbers — 4 and 9 are the smallest counterexamples.",
        code: `fn to_roman(n: u32) -> String {
    const TABLE: [(u32, &str); 7] = [
        (1000, "M"),
        (500, "D"),
        (100, "C"),
        (50, "L"),
        (10, "X"),
        (5, "V"),
        (1, "I"),
    ];
    let mut n = n;
    let mut out = String::new();
    for &(value, glyph) in TABLE.iter() {
        while n >= value {
            out.push_str(glyph);
            n -= value;
        }
    }
    out
}
`,
      },
      {
        id: "unit-modernist",
        title: "The Unit Modernist",
        monologue:
          "I mastered IV and IX — the fashionable subtractions — and left the tens and hundreds to accumulate honestly. XXXX has a certain rustic charm at forty, don't you think?",
        lesson: "The subtractive rule repeats at every decade: 40, 90, 400, 900 each need their own table row AND their own test.",
        code: `fn to_roman(n: u32) -> String {
    const TABLE: [(u32, &str); 9] = [
        (1000, "M"),
        (500, "D"),
        (100, "C"),
        (50, "L"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut n = n;
    let mut out = String::new();
    for &(value, glyph) in TABLE.iter() {
        while n >= value {
            out.push_str(glyph);
            n -= value;
        }
    }
    out
}
`,
      },
      {
        id: "four-fetishist",
        title: "The Four Fetishist",
        monologue:
          "IV, XL, CD — I subtract before the fives beautifully. Before the TENS? VIIII, LXXXX, DCCCC — the nines slipped my chisel entirely.",
        lesson: "The subtractive pairs come in two families (the fours and the nines) — testing one family says nothing about the other.",
        code: `fn to_roman(n: u32) -> String {
    const TABLE: [(u32, &str); 10] = [
        (1000, "M"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut n = n;
    let mut out = String::new();
    for &(value, glyph) in TABLE.iter() {
        while n >= value {
            out.push_str(glyph);
            n -= value;
        }
    }
    out
}
`,
      },
      {
        id: "thousand-denier",
        title: "The Thousand Denier",
        monologue:
          "M? Never carved one. The largest stone I acknowledge is CM, so your two-thousand-twenty-four came out CM CM CC… it's a long slab. Millennia are a fad.",
        lesson: "Greedy tables fail loudly only at the rows they're missing — probe the extremes (1000, 2024, 3999), not just the middle.",
        code: `fn to_roman(n: u32) -> String {
    const TABLE: [(u32, &str); 12] = [
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut n = n;
    let mut out = String::new();
    for &(value, glyph) in TABLE.iter() {
        while n >= value {
            out.push_str(glyph);
            n -= value;
        }
    }
    out
}
`,
      },
    ],
    reference: `fn to_roman(n: u32) -> String {
    const TABLE: [(u32, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut n = n;
    let mut out = String::new();
    for &(value, glyph) in TABLE.iter() {
        while n >= value {
            out.push_str(glyph);
            n -= value;
        }
    }
    out
}
`,
    killerTests: `#[test]
fn engraves_a_plain_year() {
    assert_eq!(to_roman(12), "XII");
    assert_eq!(to_roman(1), "I");
    assert_eq!(to_roman(3), "III");
}

#[test]
fn four_and_nine_subtract() {
    assert_eq!(to_roman(4), "IV");
    assert_eq!(to_roman(9), "IX");
    assert_eq!(to_roman(14), "XIV");
}

#[test]
fn the_tens_subtract_too() {
    assert_eq!(to_roman(40), "XL");
    assert_eq!(to_roman(44), "XLIV");
    assert_eq!(to_roman(90), "XC");
}

#[test]
fn the_hundreds_subtract_too() {
    assert_eq!(to_roman(400), "CD");
    assert_eq!(to_roman(900), "CM");
}

#[test]
fn the_thousands_stand_tall() {
    assert_eq!(to_roman(1000), "M");
    assert_eq!(to_roman(2024), "MMXXIV");
}

#[test]
fn the_grand_edges_hold() {
    assert_eq!(to_roman(3888), "MMMDCCCLXXXVIII");
    assert_eq!(to_roman(3999), "MMMCMXCIX");
}
`,
  },

  {
    id: "paw-rust-court-herald",
    title: "The Court Herald",
    wish: "Announce a proclamation from a template: fill each {name} from the court's register.",
    clauses: [
      "{key} is replaced by the value of the FIRST register entry whose key matches.",
      "A key with no register entry is Err(\"unknown key: <key>\") — exactly that text.",
      "\"{{\" proclaims a literal '{' and \"}}\" a literal '}' — escapes are read before placeholders.",
      "A '{' never closed is Err(\"unclosed brace\"); a bare '}' outside any placeholder is Err(\"stray brace\").",
    ],
    signature: "fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String>",
    conceptTags: [
      "char scanning with peek",
      "brace escapes",
      "first-match lookup",
      "String errors",
    ],
    difficulty: "grandmaster",
    language: "rust",
    rank: 10,
    starterTests: `#[test]
fn heralds_a_simple_name() {
    assert_eq!(
        render("Hail {name}!", &[("name", "Zed")]),
        Ok("Hail Zed!".to_string()),
    );
}
`,
    cheats: [
      {
        id: "hardcoder",
        title: "The Hardcoder",
        monologue:
          "Hail Zed! A magnificent proclamation — I had it engraved. All other templates render as reverent silence.",
        lesson: "One example is not a specification.",
        code: `fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String> {
    let _ = vars;
    if template == "Hail {name}!" {
        Ok("Hail Zed!".to_string())
    } else {
        Ok(String::new())
    }
}
`,
      },
      {
        id: "replacement-peddler",
        title: "The Replacement Peddler",
        monologue:
          "str::replace, once per register entry — five lines, no parser, no errors. LITERALLY no errors: unknown keys, stray braces, unclosed braces, all rendered verbatim with total confidence.",
        lesson: "Find-and-replace isn't parsing — it can't see unknown keys, escapes, or malformed braces. Every error clause needs a test that demands the Err.",
        code: `fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String> {
    let mut out = template.to_string();
    for (key, value) in vars {
        out = out.replace(&format!("{{{}}}", key), value);
    }
    Ok(out)
}
`,
      },
      {
        id: "escape-illiterate",
        title: "The Escape Illiterate",
        monologue:
          "Doubled braces? I read '{{name}}' as a placeholder named '{name' — a bold name, an unknown name, a fatal name. My scanner is diligent and completely unlettered in escapes.",
        lesson: "Escape sequences must be consumed BEFORE the placeholder opener fires — '{{' is the classic lookahead case for peek().",
        code: `fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String> {
    let mut out = String::new();
    let mut chars = template.chars();
    while let Some(c) = chars.next() {
        match c {
            '{' => {
                let mut key = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(k) => key.push(k),
                        None => return Err("unclosed brace".to_string()),
                    }
                }
                match vars.iter().find(|(k, _)| *k == key) {
                    Some((_, value)) => out.push_str(value),
                    None => return Err(format!("unknown key: {}", key)),
                }
            }
            '}' => return Err("stray brace".to_string()),
            _ => out.push(c),
        }
    }
    Ok(out)
}
`,
      },
      {
        id: "silent-swallower",
        title: "The Silent Swallower",
        monologue:
          "Unknown keys render as a tasteful nothing; unclosed braces trail off like an unfinished thought… The court demanded ERRORS? The court got elegance.",
        lesson: "'Must error' clauses need the Err asserted by value — a renderer that degrades gracefully passes every happy-path test.",
        code: `fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String> {
    let mut out = String::new();
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' if chars.peek() == Some(&'{') => {
                chars.next();
                out.push('{');
            }
            '{' => {
                let mut key = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(k) => key.push(k),
                        None => return Ok(out),
                    }
                }
                if let Some((_, value)) = vars.iter().find(|(k, _)| *k == key) {
                    out.push_str(value);
                }
            }
            '}' if chars.peek() == Some(&'}') => {
                chars.next();
                out.push('}');
            }
            '}' => return Err("stray brace".to_string()),
            _ => out.push(c),
        }
    }
    Ok(out)
}
`,
      },
      {
        id: "last-loyalty-traitor",
        title: "The Last-Loyalty Traitor",
        monologue:
          "When two register entries claim one key, I honor the freshest — surely later entries OVERRIDE? Your clause said first; your register never held a duplicate.",
        lesson: "find vs filter().last() agree on unique keys — first-match-wins takes a duplicated key to pin down.",
        code: `fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String> {
    let mut out = String::new();
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' if chars.peek() == Some(&'{') => {
                chars.next();
                out.push('{');
            }
            '{' => {
                let mut key = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(k) => key.push(k),
                        None => return Err("unclosed brace".to_string()),
                    }
                }
                match vars.iter().filter(|(k, _)| *k == key).last() {
                    Some((_, value)) => out.push_str(value),
                    None => return Err(format!("unknown key: {}", key)),
                }
            }
            '}' if chars.peek() == Some(&'}') => {
                chars.next();
                out.push('}');
            }
            '}' => return Err("stray brace".to_string()),
            _ => out.push(c),
        }
    }
    Ok(out)
}
`,
      },
    ],
    reference: `fn render(template: &str, vars: &[(&str, &str)]) -> Result<String, String> {
    let mut out = String::new();
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' if chars.peek() == Some(&'{') => {
                chars.next();
                out.push('{');
            }
            '{' => {
                let mut key = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(k) => key.push(k),
                        None => return Err("unclosed brace".to_string()),
                    }
                }
                match vars.iter().find(|(k, _)| *k == key) {
                    Some((_, value)) => out.push_str(value),
                    None => return Err(format!("unknown key: {}", key)),
                }
            }
            '}' if chars.peek() == Some(&'}') => {
                chars.next();
                out.push('}');
            }
            '}' => return Err("stray brace".to_string()),
            _ => out.push(c),
        }
    }
    Ok(out)
}
`,
    killerTests: `#[test]
fn heralds_a_simple_name() {
    assert_eq!(
        render("Hail {name}!", &[("name", "Zed")]),
        Ok("Hail Zed!".to_string()),
    );
}

#[test]
fn fills_many_placeholders_in_order() {
    assert_eq!(
        render("{a}-{b}", &[("a", "1"), ("b", "2")]),
        Ok("1-2".to_string()),
    );
    assert_eq!(render("plain", &[]), Ok("plain".to_string()));
}

#[test]
fn the_first_matching_var_wins() {
    assert_eq!(
        render("{k}", &[("k", "first"), ("k", "second")]),
        Ok("first".to_string()),
    );
}

#[test]
fn unknown_keys_are_an_error() {
    assert_eq!(
        render("{crown}", &[("name", "Zed")]),
        Err("unknown key: crown".to_string()),
    );
}

#[test]
fn doubled_braces_are_literals() {
    assert_eq!(
        render("{{name}}", &[("name", "Zed")]),
        Ok("{name}".to_string()),
    );
    assert_eq!(render("{{}}", &[]), Ok("{}".to_string()));
}

#[test]
fn an_unclosed_brace_is_an_error() {
    assert_eq!(
        render("Hail {name", &[("name", "Zed")]),
        Err("unclosed brace".to_string()),
    );
}

#[test]
fn a_stray_closing_brace_is_an_error() {
    assert_eq!(render("oops}", &[]), Err("stray brace".to_string()));
}
`,
  },
];
