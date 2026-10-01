//! Public engine repositories known to TorsGUI: the "Add from GitHub" dialog offers them
//! without searching. The first ones were installed and verified by the reference
//! tournaments (tested tag and asset recorded); the others are well-known open-source
//! engines whose releases are on GitHub.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct KnownRepo {
    pub name: String,
    /// owner/repo on GitHub
    pub repo: String,
    /// The engine's name in the CCRL lists (without version).
    pub ccrl_name: String,
    pub tested_tag: Option<String>,
    pub tested_asset: Option<String>,
    pub notes: String,
    /// Best rating and full name in the CCRL Blitz list (filled by the API).
    #[serde(default)]
    pub blitz: Option<(String, f64)>,
    /// An engine of this family is in the library (filled by the API).
    #[serde(default)]
    pub installed: bool,
}

pub fn known_repos() -> Vec<KnownRepo> {
    serde_json::from_str(include_str!("../data/known_repos.json")).expect("data/known_repos.json")
}

/// Whether a CCRL or library name belongs to this engine family ("Stockfish 19 64-bit 8CPU").
pub fn is_family(name: &str, family: &str) -> bool {
    let n = name.to_lowercase();
    let f = family.to_lowercase();
    n == f || n.strip_prefix(&f).map(|r| r.starts_with(' ') || r.starts_with('-') || r.starts_with('_')).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_least_thirty_distinct_repositories() {
        let v = known_repos();
        assert!(v.len() >= 30, "{}", v.len());
        let mut repos: Vec<String> = v.iter().map(|r| r.repo.to_lowercase()).collect();
        repos.sort();
        repos.dedup();
        assert_eq!(repos.len(), v.len());
        assert!(v.iter().all(|r| r.repo.split('/').count() == 2 && !r.ccrl_name.is_empty()));
        assert!(v.iter().filter(|r| r.tested_tag.is_some()).count() >= 30);
        let sf = v.iter().find(|r| r.name == "Stockfish").unwrap();
        assert_eq!(sf.repo, "official-stockfish/Stockfish");
    }

    #[test]
    fn families() {
        assert!(is_family("Stockfish 19 64-bit 8CPU", "Stockfish"));
        assert!(is_family("Alexandria-9.0.0", "Alexandria"));
        assert!(!is_family("Stockfishy 1.0", "Stockfish"));
        assert!(is_family("Black Marlin 9.0", "Black Marlin"));
    }
}
