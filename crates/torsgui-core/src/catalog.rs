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

/// The known repository of an engine named as in the CCRL lists ("Stockfish 19 64-bit 8CPU"):
/// the family that matches the longest part of the name.
pub fn repo_for(name: &str) -> Option<KnownRepo> {
    let base = crate::names::ccrl_base(name);
    known_repos().into_iter().filter(|r| is_family(&base, &r.ccrl_name) || is_family(&base, &r.name)).max_by_key(|r| r.ccrl_name.len())
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
    fn repositories_of_list_names() {
        assert_eq!(repo_for("Stockfish 19 64-bit 8CPU").map(|r| r.repo), Some("official-stockfish/Stockfish".to_string()));
        assert_eq!(repo_for("Alexandria 9.0.0 64-bit 4CPU").map(|r| r.repo), Some("PGG106/Alexandria".to_string()));
        assert!(repo_for("Nonexistent Engine 1.0 64-bit").is_none());
    }

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
    fn the_open_source_engines_of_the_top_lists_are_covered() {
        // commercial or private engines, or no public GitHub repository found
        let closed = ["Torch", "Dragon", "Fritz", "Ginkgo", "Stoofvlees", "Chess System Tal", "Rebel", "Revenge", "Uralochka", "rofChade", "Peacekeeper", "Deep Shredder", "Heimdall", "Deep Sjeng", "SlowChess", "Lc0 0.29", "Leelenstein", "Allie", "Houdini", "Wasp", "Fire", "Pseudo", "Spaghet", "Ynode"];
        let repos = known_repos();
        for list in crate::ccrl::snapshot_lists().iter().filter(|l| l.list != "FRC") {
            for e in list.entries.iter().filter(|e| e.rank <= 60) {
                let covered = repos.iter().any(|r| is_family(&e.name, &r.ccrl_name)) || closed.iter().any(|c| e.name.starts_with(c));
                assert!(covered, "{} #{} {} has no known repository", list.list, e.rank, e.name);
            }
        }
    }

    #[test]
    fn families() {
        assert!(is_family("Stockfish 19 64-bit 8CPU", "Stockfish"));
        assert!(is_family("Alexandria-9.0.0", "Alexandria"));
        assert!(!is_family("Stockfishy 1.0", "Stockfish"));
        assert!(is_family("Black Marlin 9.0", "Black Marlin"));
    }
}
