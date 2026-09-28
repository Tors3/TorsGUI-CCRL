//! Loads the games of a tournament from its PGN files and computes the
//! standings (deduplicated, pitfall 3).

use crate::model::{Role, TournamentConfig};
use crate::pgn::{dedupe, read_games, Game};
use crate::stats::{standings, RowOrder, Standings};
use anyhow::Result;
use std::collections::HashMap;
use std::path::PathBuf;

pub struct Loaded {
    pub games: Vec<Game>,
    pub duplicates: Vec<Game>,
}

pub fn load(pgns: &[PathBuf]) -> Result<Loaded> {
    let mut all = Vec::new();
    let mut files = pgns.to_vec();
    files.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    for p in &files {
        all.extend(read_games(p)?);
    }
    let (games, duplicates) = dedupe(all);
    Ok(Loaded { games, duplicates })
}

/// Ratings of the participants (list ratings stored in the config).
pub fn ratings(cfg: &TournamentConfig) -> HashMap<String, (f64, bool)> {
    cfg.participants.iter().filter_map(|p| p.rating.map(|r| (p.name.clone(), (r, p.rating_estimated)))).collect()
}

/// Standings from the first seed's point of view, rows ordered by list rating
/// (configuration order when ratings are unknown).
pub fn tournament_standings(cfg: &TournamentConfig, loaded: &Loaded, seed: Option<&str>, order: RowOrder) -> Standings {
    let seed = seed
        .map(|s| s.to_string())
        .or_else(|| cfg.participants.iter().find(|p| p.role == Role::Seed).map(|p| p.name.clone()))
        .unwrap_or_default();
    let names: Vec<String> = cfg.participants.iter().map(|p| p.name.clone()).collect();
    let mut st = standings(&seed, &loaded.games, &names, &ratings(cfg), order);
    st.duplicates = loaded.duplicates.len() as u32;
    st
}
