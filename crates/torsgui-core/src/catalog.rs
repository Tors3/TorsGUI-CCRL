//! Public engine repositories known to TorsGUI: the "Add from GitHub" dialog offers them
//! without searching. The first ones were installed and verified by the reference
//! tournaments (tested tag and asset recorded); the others are well-known open-source
//! engines whose releases are on GitHub.

use serde::{Deserialize, Serialize};

#[derive(Default, Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
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

/// The official site of an engine that is not on GitHub (commercial, GitLab, own site).
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EngineSite {
    pub name: String,
    pub ccrl_name: String,
    pub url: String,
    pub notes: String,
}

pub fn engine_sites() -> Vec<EngineSite> {
    serde_json::from_str(include_str!("../data/engine_sites.json")).expect("data/engine_sites.json")
}

pub fn site_for(name: &str) -> Option<EngineSite> {
    let base = crate::names::ccrl_base(name);
    engine_sites().into_iter().filter(|r| is_family(&base, &r.ccrl_name) || is_family(&base, &r.name)).max_by_key(|r| r.ccrl_name.len())
}

/// A repository or homepage found for an engine family on this computer.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EngineLink {
    pub family: String,
    /// owner/repo on GitHub ("" when only a homepage is known)
    pub repo: String,
    pub homepage: String,
    /// "CCRL page" or "added by hand"
    pub source: String,
    pub updated_at: String,
}

/// owner/repo of the first GitHub repository linked in a page.
pub fn github_repo_in(html: &str) -> Option<String> {
    static RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r#"https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)"#).unwrap());
    const NOT_OWNERS: [&str; 8] = ["features", "topics", "sponsors", "orgs", "about", "login", "marketplace", "settings"];
    RE.captures_iter(html).find_map(|c| {
        let owner = c[1].to_string();
        let repo = c[2].trim_end_matches(".git").trim_end_matches('.').to_string();
        (!NOT_OWNERS.contains(&owner.to_lowercase().as_str()) && !repo.is_empty()).then(|| format!("{owner}/{repo}"))
    })
}

/// The link labelled as the engine's homepage in a CCRL engine page, if any.
pub fn homepage_in(html: &str) -> Option<String> {
    static A: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r#"(?is)(.{0,60})<a[^>]+href\s*=\s*["'](https?://[^"']+)["'][^>]*>(.*?)</a>"#).unwrap());
    A.captures_iter(html).find_map(|c| {
        let url = c[2].to_string();
        let near = format!("{} {}", &c[1], &c[3]).to_lowercase();
        (near.contains("home") && !url.contains("computerchess.org.uk")).then_some(url)
    })
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
    fn links_in_ccrl_engine_pages() {
        let page = r#"<table><tr><td>Author:</td><td>Jane Doe</td></tr><tr><td>Homepage:</td><td><a href="https://github.com/janedoe/coolfish/">https://github.com/janedoe/coolfish/</a></td></tr></table><a href="https://computerchess.org.uk/ccrl/404/">Home</a>"#;
        assert_eq!(github_repo_in(page).as_deref(), Some("janedoe/coolfish"));
        assert_eq!(homepage_in(page).as_deref(), Some("https://github.com/janedoe/coolfish/"));
        let site = r#"<b>Homepage</b>: <a href='http://www.example.org/engine.html'>example.org</a> <a href="https://github.com/features/actions">x</a>"#;
        assert_eq!(github_repo_in(site), None);
        assert_eq!(homepage_in(site).as_deref(), Some("http://www.example.org/engine.html"));
        assert_eq!(site_for("Dragon by Komodo 3.2 64-bit 8CPU").map(|s| s.url), Some("https://komodochess.com/".to_string()));
        assert!(engine_sites().iter().all(|s| s.url.starts_with("http")));
    }

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
