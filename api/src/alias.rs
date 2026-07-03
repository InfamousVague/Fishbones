//! Anonymous leaderboard aliases + the basic profanity filter.
//!
//! Privacy: the global leaderboard must never expose an account's
//! `display_name` (OAuth often fills it with the user's REAL name).
//! Until a user explicitly claims a leaderboard name, they appear as a
//! deterministic pseudonym generated from their opaque user id —
//! stable across requests and devices, but carrying zero personal
//! information.
//!
//! The profanity filter is intentionally BASIC: a small normalized
//! wordlist (lowercase + leet-speak folding + separator stripping,
//! substring match). It stops drive-by vulgarity, not a determined
//! adversary — moderation beyond that is a product decision for later.

/// Adjective half of the pseudonym. 64 entries → 6 bits.
const ADJECTIVES: &[&str] = &[
    "Cosmic", "Swift", "Quiet", "Brave", "Clever", "Lucky", "Mellow", "Bold",
    "Sunny", "Frosty", "Amber", "Azure", "Crimson", "Golden", "Silver", "Violet",
    "Rapid", "Gentle", "Witty", "Nimble", "Stellar", "Lunar", "Solar", "Arctic",
    "Coral", "Emerald", "Indigo", "Jade", "Maroon", "Ochre", "Pearl", "Ruby",
    "Sable", "Teal", "Umber", "Zesty", "Breezy", "Cheery", "Dapper", "Eager",
    "Fabled", "Grand", "Hearty", "Ivory", "Jolly", "Keen", "Limber", "Merry",
    "Noble", "Onyx", "Plucky", "Quirky", "Rustic", "Spry", "Tidy", "Upbeat",
    "Vivid", "Wandering", "Xenial", "Youthful", "Zippy", "Curious", "Daring", "Earnest",
];

/// Animal half. 64 entries → 6 bits.
const ANIMALS: &[&str] = &[
    "Otter", "Falcon", "Panda", "Lynx", "Heron", "Badger", "Dolphin", "Ibex",
    "Jackal", "Koala", "Lemur", "Marmot", "Narwhal", "Ocelot", "Puffin", "Quokka",
    "Raven", "Salmon", "Tapir", "Urchin", "Vole", "Walrus", "Yak", "Zebra",
    "Alpaca", "Bison", "Condor", "Dingo", "Egret", "Ferret", "Gecko", "Hedgehog",
    "Iguana", "Jay", "Kestrel", "Llama", "Moose", "Newt", "Osprey", "Pika",
    "Quail", "Rabbit", "Seal", "Toucan", "Umbrette", "Viper", "Wombat", "Xerus",
    "Yabby", "Zorilla", "Beaver", "Crane", "Duck", "Elk", "Fox", "Gull",
    "Hare", "Impala", "Junco", "Kiwi", "Loon", "Mole", "Nene", "Owl",
];

/// FNV-1a 64-bit — tiny, dependency-free, stable across platforms.
fn fnv1a(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Deterministic pseudonym for a user id: "CosmicOtter42". Stable per
/// user (same id → same alias) so ranks stay recognisable session to
/// session without storing anything.
pub fn alias_for(user_id: &str) -> String {
    let h = fnv1a(user_id);
    let adj = ADJECTIVES[(h & 0x3f) as usize];
    let ani = ANIMALS[((h >> 6) & 0x3f) as usize];
    let num = (h >> 12) % 100;
    format!("{adj}{ani}{num:02}")
}

/// Basic profanity wordlist, pre-normalized (lowercase, no separators).
/// Substring-matched against the normalized candidate name. Small on
/// purpose; extend as needed.
const BANNED: &[&str] = &[
    "fuck", "shit", "bitch", "cunt", "asshole", "dick", "cock", "pussy",
    "nigger", "nigga", "faggot", "retard", "whore", "slut", "bastard",
    "damn", "piss", "wank", "twat", "prick", "douche", "jackass",
    "nazi", "hitler", "rape", "molest", "pedo", "porn", "sex",
];

/// Fold leet-speak and strip separators so "F_u-c 4k" style disguises
/// normalize into their plain form before the substring check.
fn normalize(name: &str) -> String {
    name.chars()
        .filter_map(|c| match c.to_ascii_lowercase() {
            '0' => Some('o'),
            '1' | '!' => Some('i'),
            '3' => Some('e'),
            '4' | '@' => Some('a'),
            '5' | '$' => Some('s'),
            '7' => Some('t'),
            ' ' | '_' | '-' => None,
            lc if lc.is_ascii_alphanumeric() => Some(lc),
            _ => None,
        })
        .collect()
}

/// Validation error codes — mirrored verbatim by the client for
/// instant feedback. Keep the strings in sync with the app's
/// `src/lib/leaderboardName.ts`.
pub fn validate_name(name: &str) -> Result<(), &'static str> {
    let trimmed = name.trim();
    if trimmed != name || !(3..=24).contains(&name.chars().count()) {
        return Err("invalid_length");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '-')
    {
        return Err("invalid_chars");
    }
    let norm = normalize(name);
    if BANNED.iter().any(|w| norm.contains(w)) {
        return Err("profanity");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_is_deterministic_and_clean() {
        let a = alias_for("user-abc-123");
        assert_eq!(a, alias_for("user-abc-123"));
        assert!(a.len() >= 5);
        assert!(validate_name(&a).is_ok(), "generated alias must validate: {a}");
    }

    #[test]
    fn alias_differs_across_users() {
        assert_ne!(alias_for("user-a"), alias_for("user-b"));
    }

    #[test]
    fn validate_length_and_charset() {
        assert_eq!(validate_name("ab"), Err("invalid_length"));
        assert_eq!(validate_name(&"x".repeat(25)), Err("invalid_length"));
        assert_eq!(validate_name(" padded"), Err("invalid_length"));
        assert_eq!(validate_name("emoji😀"), Err("invalid_chars"));
        assert!(validate_name("Rusty Learner_42").is_ok());
    }

    #[test]
    fn profanity_plain_and_leet() {
        assert_eq!(validate_name("fuckface"), Err("profanity"));
        assert_eq!(validate_name("F u c k"), Err("profanity"));
        assert_eq!(validate_name("sh1t_lord"), Err("profanity"));
        // In-charset leet: 5→s folds "a55hole" to "asshole".
        assert_eq!(validate_name("a55hole99"), Err("profanity"));
        // `$` fails the charset gate first — still rejected, different code.
        assert_eq!(validate_name("a$$hole99"), Err("invalid_chars"));
        assert!(validate_name("Grass Snake").is_ok(), "no scunthorpe on ass? grass contains no banned word");
        assert!(validate_name("CosmicOtter42").is_ok());
    }
}
