//! Engine naming: CCRL display/export names and fuzzy matching between CCRL
//! list names, library names and PGN player names.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

static CPU_SUFFIX: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+\d+CPU$").unwrap());
static BIT64: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b64-bit$").unwrap());

/// `'Stockfish 19' -> 'Stockfish 19 64-bit 4CPU'`; does not double suffixes
/// (same rules as export_ccrl.py `ccrl_name`).
pub fn ccrl_name(name: &str, cpus: u32) -> String {
    let mut n = CPU_SUFFIX.replace(name.trim(), "").to_string();
    if !BIT64.is_match(&n) {
        n.push_str(" 64-bit");
    }
    if cpus > 1 {
        n.push_str(&format!(" {cpus}CPU"));
    }
    n
}

/// Name without the export suffixes: `'Integral 8 64-bit 4CPU' -> 'Integral 8'`.
pub fn ccrl_base(name: &str) -> String {
    let n = CPU_SUFFIX.replace(name.trim(), "").to_string();
    BIT64.replace(&n, "").trim().to_string()
}

/// Canonical CCRL-style display name `<Engine> <version>` from a folder-like
/// name (`Stockfish_19` -> `Stockfish 19`).
pub fn display_name(engine: &str, version: &str) -> String {
    let e = engine.trim().replace('_', " ");
    let v = version.trim();
    if v.is_empty() {
        e
    } else {
        format!("{e} {v}")
    }
}

/// Normalised form used for matching:
/// lower case, no "64-bit"/"NCPU"/"x64"/build tags, "v8" -> "8", punctuation removed.
pub fn normalize(name: &str) -> String {
    static STRIP: Lazy<Vec<Regex>> = Lazy::new(|| {
        [
            r"(?i)\b64-?bit\b",
            r"(?i)\b32-?bit\b",
            r"(?i)\b\d+\s*cpu\b",
            r"(?i)\bx64\b",
            r"(?i)\b(avx2|avx512|bmi2|popcnt|pext|sse4\.?2?|x86-64(-v\d)?)\b",
            r"(?i)\(.*?\)",
        ]
        .iter()
        .map(|p| Regex::new(p).unwrap())
        .collect()
    });
    let mut s = name.to_string();
    for r in STRIP.iter() {
        s = r.replace_all(&s, " ").to_string();
    }
    let s = s.to_lowercase();
    // "v8" / "v1.2" -> "8" / "1.2" when the v precedes a digit
    static V: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bv(\d)").unwrap());
    let s = V.replace_all(&s, "$1").to_string();
    let s: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' { c } else { ' ' })
        .collect();
    let toks: Vec<String> = s
        .split_whitespace()
        .map(|t| {
            // "7.0" and "7" compare equal; "16.0.0" -> "16"
            if t.chars().all(|c| c.is_ascii_digit() || c == '.') {
                let t = t.trim_end_matches('.');
                let mut parts: Vec<&str> = t.split('.').collect();
                while parts.len() > 1 && parts.last() == Some(&"0") {
                    parts.pop();
                }
                parts.join(".")
            } else {
                t.to_string()
            }
        })
        .collect();
    toks.join(" ")
}

/// Engine family (name without version tokens): "RubiChess 20240817" -> "rubichess".
pub fn family(name: &str) -> String {
    normalize(name)
        .split_whitespace()
        .filter(|t| !t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Version tokens of a name: "Integral v8" -> "8".
pub fn version_of(name: &str) -> String {
    normalize(name)
        .split_whitespace()
        .filter(|t| t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Similarity in [0, 1]. Same family and same version => 1.0.
pub fn similarity(a: &str, b: &str) -> f64 {
    let na = normalize(a);
    let nb = normalize(b);
    if na == nb {
        return 1.0;
    }
    let fa = family(a);
    let fb = family(b);
    let va = version_of(a);
    let vb = version_of(b);
    let fam = strsim::jaro_winkler(&fa, &fb);
    let ver = if va == vb {
        1.0
    } else if va.is_empty() || vb.is_empty() {
        0.5
    } else if va.starts_with(&vb) || vb.starts_with(&va) {
        0.8
    } else {
        0.0
    };
    0.65 * fam + 0.35 * ver
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct MatchCandidate {
    pub name: String,
    pub score: f64,
    /// true when the score is high enough to accept without confirmation.
    pub certain: bool,
}

/// Best candidates for `query` among `names`, highest first.
pub fn best_matches(query: &str, names: &[String], limit: usize) -> Vec<MatchCandidate> {
    let mut v: Vec<MatchCandidate> = names
        .iter()
        .map(|n| {
            let s = similarity(query, n);
            MatchCandidate { name: n.clone(), score: s, certain: s >= 0.999 }
        })
        .filter(|c| c.score >= 0.55)
        .collect();
    v.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    v.truncate(limit);
    v
}

/// Numeric comparison of versions ("9.10" > "9.9", "20240817" as a number).
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<u64> = a.split(|c: char| !c.is_ascii_digit()).filter_map(|x| x.parse().ok()).collect();
    let pb: Vec<u64> = b.split(|c: char| !c.is_ascii_digit()).filter_map(|x| x.parse().ok()).collect();
    pa.cmp(&pb)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ccrl_names() {
        assert_eq!(ccrl_name("Stockfish 19", 4), "Stockfish 19 64-bit 4CPU");
        assert_eq!(ccrl_name("Triumviratus 7.0 64-bit", 4), "Triumviratus 7.0 64-bit 4CPU");
        assert_eq!(ccrl_name("Caissa 2.0 64-bit 4CPU", 8), "Caissa 2.0 64-bit 8CPU");
        assert_eq!(ccrl_name("Motor 0.9.0", 1), "Motor 0.9.0 64-bit");
        assert_eq!(ccrl_name("XY 64-Bit", 1), "XY 64-Bit");
        assert_eq!(display_name("Stockfish_19", ""), "Stockfish 19");
    }
    #[test]
    fn matching() {
        assert_eq!(normalize("Integral v8"), normalize("Integral 8"));
        assert_eq!(normalize("Halogen 16 64-bit 8CPU"), normalize("Halogen 16.0.0"));
        assert_eq!(normalize("RubiChess 20240817 (avx2)"), "rubichess 20240817");
        assert!(similarity("Integral v8", "Integral 8") > 0.99);
        assert!(similarity("Triumviratus 7.0", "Triumviratus 7.0 64-bit") > 0.99);
        assert!(similarity("Obsidian 16.0", "Obsidian 15.0") < 0.7);
        let names: Vec<String> = ["Stockfish 17.1", "Stockfish 19", "Starzix 6.0", "RubiChess 20240817"]
            .iter().map(|s| s.to_string()).collect();
        let m = best_matches("Stockfish 19 64-bit", &names, 3);
        assert_eq!(m[0].name, "Stockfish 19");
        assert!(m[0].certain);
        let m = best_matches("Rubichess 20240817", &names, 3);
        assert_eq!(m[0].name, "RubiChess 20240817");
        assert_eq!(family("Quanticade Cronus 3.0"), "quanticade cronus");
        assert_eq!(compare_versions("9.10", "9.9"), std::cmp::Ordering::Greater);
    }
}
