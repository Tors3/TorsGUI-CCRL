//! Import of tournaments created by the CCRL_ScirptsTests scripts:
//! `tournaments/<name>/config/engines.json`, `config/ratings.csv`,
//! `scripts/gauntlet.bat` and the PGNs (`pgn/node*.pgn` or
//! `results/gauntlets/<name>/all_games.pgn`).

use crate::model::*;
use anyhow::{Context, Result};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

/// `set KEY=VALUE` lines of a .bat file (last value wins, `rem` lines ignored).
pub fn parse_bat(text: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for l in text.lines() {
        let l = l.trim();
        if let Some(rest) = l.strip_prefix("set ").or_else(|| l.strip_prefix("SET ")) {
            if let Some((k, v)) = rest.split_once('=') {
                m.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    m
}

fn adjudication_from(extra: &str) -> (Adjudication, Vec<String>) {
    let mut a = Adjudication { draw_enabled: false, resign_enabled: false, ..Default::default() };
    let toks: Vec<&str> = extra.split_whitespace().collect();
    let mut rest = Vec::new();
    let mut i = 0;
    let kv = |t: &str| t.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()));
    while i < toks.len() {
        match toks[i] {
            "-draw" => {
                a.draw_enabled = true;
                i += 1;
                while i < toks.len() && !toks[i].starts_with('-') {
                    if let Some((k, v)) = kv(toks[i]) {
                        match k.as_str() {
                            "movenumber" => a.draw_movenumber = v.parse().unwrap_or(35),
                            "movecount" => a.draw_movecount = v.parse().unwrap_or(8),
                            "score" => a.draw_score = v.parse().unwrap_or(10),
                            _ => {}
                        }
                    }
                    i += 1;
                }
            }
            "-resign" => {
                a.resign_enabled = true;
                a.resign_twosided = false;
                i += 1;
                while i < toks.len() && !toks[i].starts_with('-') {
                    if let Some((k, v)) = kv(toks[i]) {
                        match k.as_str() {
                            "movecount" => a.resign_movecount = v.parse().unwrap_or(4),
                            "score" => a.resign_score = v.parse().unwrap_or(600),
                            "twosided" => a.resign_twosided = v == "true",
                            _ => {}
                        }
                    }
                    i += 1;
                }
            }
            t => {
                rest.push(t.to_string());
                i += 1;
            }
        }
    }
    (a, rest)
}

fn participant(v: &serde_json::Value, role: Role) -> Participant {
    let mut options = BTreeMap::new();
    if let Some(o) = v["options"].as_object() {
        for (k, val) in o {
            options.insert(k.clone(), val.as_str().map(|s| s.to_string()).unwrap_or_else(|| val.to_string()));
        }
    }
    Participant {
        name: v["name"].as_str().unwrap_or("").to_string(),
        cmd: v["cmd"].as_str().unwrap_or("").to_string(),
        dir: v["dir"].as_str().unwrap_or("").to_string(),
        args: String::new(),
        options,
        role,
        engine_id: None,
        has_syzygy: v["has_syzygy"].as_bool().unwrap_or(false),
        uci_id: v["uci_id"].as_str().map(|s| s.to_string()),
        rating: None,
        rating_estimated: false,
        threads: None,
        hash_mb: None,
    }
}

#[derive(Debug, Clone)]
pub struct LegacyTournament {
    pub name: String,
    pub config: TournamentConfig,
    pub pgns: Vec<PathBuf>,
    /// Date the export was made (from an existing CCRL file name), if any.
    pub reference_export: Option<PathBuf>,
}

/// Reads a legacy tournament folder. `results_dir` is the matching
/// `results/gauntlets/<name>` folder (optional).
pub fn read(tournament_dir: &Path, results_dir: Option<&Path>) -> Result<LegacyTournament> {
    let name = tournament_dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ej: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(tournament_dir.join("config/engines.json")).context("config/engines.json")?,
    )?;
    let bat = std::fs::read_to_string(tournament_dir.join("scripts/gauntlet.bat")).context("scripts/gauntlet.bat")?;
    let b = parse_bat(&bat);
    let get = |k: &str, d: &str| b.get(k).cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| d.to_string());

    let mut participants = Vec::new();
    let seeds: Vec<Participant> = match ej["seeds"].as_array() {
        Some(a) if !a.is_empty() => a.iter().map(|v| participant(v, Role::Seed)).collect(),
        _ => vec![participant(&ej["seed"], Role::Seed)],
    };
    let multi = seeds.len() > 1;
    participants.extend(seeds);
    for o in ej["opponents"].as_array().cloned().unwrap_or_default() {
        let p = participant(&o, Role::Opponent);
        if !participants.iter().any(|x: &Participant| x.name == p.name) {
            participants.push(p);
        }
    }
    // ratings.csv (name,rating)
    if let Ok(csv) = std::fs::read_to_string(tournament_dir.join("config/ratings.csv")) {
        for l in csv.lines().skip(1) {
            if let Some((n, r)) = l.rsplit_once(',') {
                if let Ok(r) = r.trim().parse::<f64>() {
                    if let Some(p) = participants.iter_mut().find(|p| p.name == n.trim()) {
                        p.rating = Some(r);
                    }
                }
            }
        }
    }
    let mode = get("MODE", "gauntlet").to_lowercase();
    let kind = match mode.as_str() {
        "roundrobin" => TournamentKind::RoundRobin,
        _ if multi => TournamentKind::MultiGauntlet,
        _ => TournamentKind::Gauntlet,
    };
    let rpp: Vec<u32> = get("ROUNDS_PER_PASS", "5").split(',').filter_map(|x| x.trim().parse().ok()).collect();
    let nodes = 2u32; // the legacy scripts always ran one driver per NUMA node (start_node0/1)
    let rounds_per_pass: Vec<u32> = (0..nodes as usize).map(|i| *rpp.get(i).unwrap_or(rpp.last().unwrap_or(&5))).collect();
    let passes: u32 = get("PASSES", "2").parse().unwrap_or(2);
    let play_passes: Option<u32> = b.get("PLAY_PASSES").and_then(|s| s.parse().ok());
    let games_per_pairing = passes * 2 * rounds_per_pass.iter().sum::<u32>();
    let syz = get("SYZYGY_PATH", "");
    let (adjudication, extra) = adjudication_from(&get("EXTRA_ARGS", ""));
    let event = get("EVENT", &name);
    let ccrl_list = if event.contains("Blitz") { "Blitz" } else if event.contains("40/15") { "40/15" } else { "" };
    let config = TournamentConfig {
        name: name.clone(),
        kind,
        participants,
        games_per_pairing,
        passes,
        play_passes,
        nodes: (0..nodes).collect(),
        rounds_per_pass,
        lanes_per_node: get("LANES", "1").parse().unwrap_or(1),
        concurrency: 1,
        threads: get("THREADS", "1").parse().unwrap_or(1),
        hash_mb: get("HASH", "16").parse().unwrap_or(16),
        tc: get("TC", "?"),
        book: get("BOOK", "avt-book-2026.pgn"),
        book_format: "pgn".into(),
        book_start: get("BOOK_START", "1").parse().unwrap_or(1),
        event,
        site: get("SITE", ""),
        syzygy_path: syz,
        adjudication,
        extra_args: extra,
        placement: Placement::Node,
        log_level: get("LOG_LEVEL", "info"),
        ccrl_list: ccrl_list.into(),
        max_retries: 2,
        max_slot_attempts: 3,
        fastchess: String::new(),
        startup_ms: 60000,
        variant: crate::model::Variant::Standard,
    };
    // PGNs: prefer the per-node files, else the merged all_games.pgn
    let mut pgns = crate::pgn::list_pgns(&tournament_dir.join("pgn"));
    pgns.retain(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("node")).unwrap_or(false));
    let mut reference_export = None;
    if let Some(r) = results_dir {
        if pgns.is_empty() {
            let all = r.join("all_games.pgn");
            if all.exists() {
                pgns.push(all);
            }
        }
        reference_export = crate::pgn::list_pgns(r).into_iter().find(|p| p.file_name().map(|n| n.to_string_lossy().starts_with('[')).unwrap_or(false));
    }
    Ok(LegacyTournament { name, config, pgns, reference_export })
}

/// Tester name and date from a CCRL export file name
/// `[Francesco Torsello 2026-09-28] ... .pgn`.
pub fn export_name_parts(p: &Path) -> Option<(String, String)> {
    let n = p.file_name()?.to_string_lossy().to_string();
    let re = regex::Regex::new(r"^\[(.+) (\d{4}-\d{2}-\d{2})\]").unwrap();
    let c = re.captures(&n)?;
    Some((c[1].to_string(), c[2].to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bat_and_adjudication() {
        let b = parse_bat("@echo off\r\nset MODE=gauntlet\r\nset TC=103+1\r\nset ROUNDS_PER_PASS=8,7\r\nset EXTRA_ARGS=-draw movenumber=35 movecount=8 score=10 -resign movecount=4 score=600 twosided=true\r\nrem set X=1\r\n");
        assert_eq!(b["TC"], "103+1");
        assert_eq!(b["ROUNDS_PER_PASS"], "8,7");
        let (a, rest) = adjudication_from(&b["EXTRA_ARGS"]);
        assert!(a.draw_enabled && a.resign_enabled && a.resign_twosided);
        assert_eq!(a, Adjudication::default());
        assert!(rest.is_empty());
    }
}
