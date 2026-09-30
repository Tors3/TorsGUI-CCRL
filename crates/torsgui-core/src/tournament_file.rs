//! Tournament files: a small TOML description of a tournament that a person (or an
//! assistant such as Claude) can write by hand, then import in TorsGUI to review, queue and
//! start. Engines are named as in the library ("Stockfish 17", "Obsidian 16.0"); names are
//! matched tolerantly (case, spacing, missing version → latest installed). Everything that
//! is left out takes the value the wizard would use (settings, CPU topology, CCRL rules).
//!
//! ```toml
//! kind = "gauntlet"
//! list = "Blitz"
//! seed = "Triumviratus 7.0"
//! opponents = ["Stockfish 17", "Obsidian 16.0", "Berserk 14"]
//! threads = 8
//! games_per_opponent = 30
//! ```

use crate::engines::EngineEntry;
use crate::model::{Adjudication, Participant, Placement, Role, TournamentConfig, TournamentKind, Variant};
use crate::store::Settings;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const FORMAT: u32 = 1;

/// One name or a list of names.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Names {
    #[default]
    None,
    One(String),
    Many(Vec<String>),
}

impl Names {
    pub fn list(&self) -> Vec<String> {
        match self {
            Names::None => vec![],
            Names::One(s) => vec![s.clone()],
            Names::Many(v) => v.clone(),
        }
    }
    fn is_empty(&self) -> bool {
        self.list().is_empty()
    }
}

/// Adjudication overrides (missing fields keep the defaults of the settings).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdjudicationFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draw: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draw_movenumber: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draw_movecount: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draw_score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resign: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resign_movecount: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resign_score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resign_twosided: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TournamentFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<u32>,
    /// Defaults to the event name without "CCRL ".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// gauntlet | multi_gauntlet | round_robin | match (default gauntlet).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<TournamentKind>,
    /// CCRL list: "Blitz", "40/15" or "FRC" (default Blitz).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<String>,
    /// "standard" or "chess960" (default: chess960 for the FRC list, standard otherwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<Variant>,
    /// Engine(s) under test (gauntlets). More than one seed makes a multi-seed gauntlet.
    #[serde(default, skip_serializing_if = "Names::is_empty")]
    pub seed: Names,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opponents: Vec<String>,
    /// Players of a round robin or a match.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub engines: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threads: Option<u32>,
    /// Default: hash per thread (settings, 512) × threads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_mb: Option<u32>,
    /// fastchess time control ("103+1"). Default: the list's CCRL TC scaled by the machine
    /// factor of the settings (or `factor`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub factor: Option<f64>,
    /// Games per opponent (per pairing), even. Default 30.
    #[serde(default, alias = "games_per_pairing", skip_serializing_if = "Option::is_none")]
    pub games_per_opponent: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passes: Option<u32>,
    /// NUMA nodes. Default: all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<u32>>,
    /// Default: physical cores of the node / (2 × threads).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lanes_per_node: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<Placement>,
    /// Opening book (absolute, or relative to the books folder). Default: the settings'.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub syzygy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adjudication: Option<AdjudicationFile>,
    /// UCI options per engine name: `[options."Stockfish 17"] Contempt = "0"`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, BTreeMap<String, String>>,
    /// What the import proposes: "draft", "queue" or "start" (default "queue").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_import: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// How a name of the file was matched in the engine library.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ResolvedEngine {
    pub input: String,
    pub role: String,
    pub engine_id: Option<i64>,
    pub name: Option<String>,
    /// "exact", "approximate", "latest version" or "not found".
    pub how: String,
    pub alternatives: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct FileImport {
    pub config: Option<TournamentConfig>,
    pub engines: Vec<ResolvedEngine>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub after_import: String,
    pub notes: String,
}

/// Parses TOML (or JSON when the text starts with `{`).
pub fn parse(text: &str) -> Result<TournamentFile> {
    let t = text.trim_start_matches('\u{feff}');
    let f: TournamentFile = if t.trim_start().starts_with('{') {
        serde_json::from_str(t).context("tournament file (JSON)")?
    } else {
        toml::from_str(t).map_err(|e| anyhow::anyhow!("tournament file: {e}"))?
    };
    if let Some(v) = f.format {
        if v > FORMAT {
            bail!("tournament file format {v} is newer than this TorsGUI (format {FORMAT})");
        }
    }
    Ok(f)
}

/// Context for building a configuration: what the wizard would read.
pub struct Env<'a> {
    pub engines: &'a [EngineEntry],
    pub settings: &'a Settings,
    /// (node id, physical cores)
    pub nodes: Vec<(u32, u32)>,
    /// rating lookup (name, threads) → (rating, estimated)
    pub rating: &'a dyn Fn(&str, u32) -> (Option<f64>, bool),
}

fn resolve(input: &str, role: &str, engines: &[EngineEntry]) -> (ResolvedEngine, Option<EngineEntry>) {
    let mut r = ResolvedEngine { input: input.to_string(), role: role.to_string(), ..Default::default() };
    let norm = crate::names::normalize(input);
    let exact = engines.iter().find(|e| crate::names::normalize(&e.display_name) == norm || crate::names::normalize(&format!("{} {}", e.engine, e.version)) == norm);
    if let Some(e) = exact {
        r.engine_id = e.id;
        r.name = Some(e.display_name.clone());
        r.how = "exact".into();
        return (r, Some(e.clone()));
    }
    // no version given: the latest installed version of that engine
    if crate::names::version_of(input).is_empty() {
        let fam = crate::names::family(input);
        let mut same: Vec<&EngineEntry> = engines.iter().filter(|e| crate::names::family(&e.display_name) == fam).collect();
        same.sort_by(|a, b| crate::names::compare_versions(&crate::names::version_of(&b.display_name), &crate::names::version_of(&a.display_name)));
        if let Some(e) = same.first() {
            r.engine_id = e.id;
            r.name = Some(e.display_name.clone());
            r.how = "latest version".into();
            r.alternatives = same.iter().skip(1).map(|e| e.display_name.clone()).collect();
            return (r, Some((*e).clone()));
        }
    }
    let names: Vec<String> = engines.iter().map(|e| e.display_name.clone()).collect();
    let m = crate::names::best_matches(input, &names, 4);
    r.alternatives = m.iter().map(|c| c.name.clone()).collect();
    let clear = match (m.first(), m.get(1)) {
        (Some(a), Some(b)) => a.score >= 0.85 && a.score - b.score >= 0.05,
        (Some(a), None) => a.score >= 0.85,
        _ => false,
    };
    if clear {
        let e = engines.iter().find(|e| e.display_name == m[0].name).cloned();
        r.engine_id = e.as_ref().and_then(|e| e.id);
        r.name = Some(m[0].name.clone());
        r.how = "approximate".into();
        r.alternatives.remove(0);
        return (r, e);
    }
    r.how = "not found".into();
    (r, None)
}

/// True for the CCRL Chess960 list ("FRC", "40/2 FRC", "Chess960").
pub fn is_frc_list(list: &str) -> bool {
    let l = list.to_uppercase();
    l.contains("FRC") || l.contains("960")
}

fn nominal_for(list: &str) -> crate::tc::NominalTc {
    let id = if list.contains("40/15") || list.contains("15") { "40/15" } else if list.contains("40/2") || is_frc_list(list) { "40/2" } else { "blitz" };
    crate::tc::presets().into_iter().find(|p| p.id == id).unwrap()
}

/// Builds the tournament configuration the wizard would build from the same choices.
pub fn build(f: &TournamentFile, env: &Env) -> FileImport {
    let s = env.settings;
    let mut out = FileImport { after_import: f.after_import.clone().unwrap_or_else(|| "queue".into()), notes: f.notes.clone().unwrap_or_default(), ..Default::default() };
    if !matches!(out.after_import.as_str(), "draft" | "queue" | "start") {
        out.warnings.push(format!("after_import = \"{}\" is not draft/queue/start: using queue", out.after_import));
        out.after_import = "queue".into();
    }
    let seeds = f.seed.list();
    let mut kind = f.kind.unwrap_or(if f.engines.is_empty() || !seeds.is_empty() { TournamentKind::Gauntlet } else { TournamentKind::RoundRobin });
    if kind == TournamentKind::Gauntlet && seeds.len() > 1 {
        kind = TournamentKind::MultiGauntlet;
        out.warnings.push(format!("{} seeds: multi-seed gauntlet", seeds.len()));
    }
    let list = f.list.clone().unwrap_or_else(|| "Blitz".into());
    let variant = f.variant.unwrap_or(if is_frc_list(&list) { Variant::Chess960 } else { Variant::Standard });
    let threads = f.threads.unwrap_or(1).max(1);
    // players in order: seeds, then opponents (gauntlets); `engines` (round robin, match)
    let wanted: Vec<(String, Role)> = match kind {
        TournamentKind::Gauntlet | TournamentKind::MultiGauntlet => {
            if seeds.is_empty() {
                out.errors.push("a gauntlet needs `seed = \"<engine>\"`".into());
            }
            if f.opponents.is_empty() {
                out.errors.push("a gauntlet needs `opponents = [...]`".into());
            }
            seeds.iter().map(|n| (n.clone(), Role::Seed)).chain(f.opponents.iter().map(|n| (n.clone(), Role::Opponent))).collect()
        }
        TournamentKind::RoundRobin | TournamentKind::Match => {
            let all: Vec<String> = if f.engines.is_empty() { seeds.iter().chain(f.opponents.iter()).cloned().collect() } else { f.engines.clone() };
            if kind == TournamentKind::Match && all.len() != 2 {
                out.errors.push(format!("a match needs exactly two engines ({} given)", all.len()));
            }
            all.into_iter().enumerate().map(|(i, n)| (n, if i == 0 { Role::Seed } else { Role::Opponent })).collect()
        }
    };
    let mut participants = Vec::new();
    for (input, role) in &wanted {
        let (r, e) = resolve(input, if *role == Role::Seed { "seed" } else { "opponent" }, env.engines);
        match (&r.how[..], e) {
            ("not found", _) | (_, None) => out.errors.push(if r.alternatives.is_empty() {
                format!("\"{input}\" is not in the engine library: add it first (Engines → Add from GitHub)")
            } else {
                format!("\"{input}\" is not in the engine library; did you mean {}?", r.alternatives.iter().map(|a| format!("\"{a}\"")).collect::<Vec<_>>().join(", "))
            }),
            (how, Some(e)) => {
                if how != "exact" {
                    out.warnings.push(format!("\"{input}\" → {} ({how})", e.display_name));
                }
                if participants.iter().any(|p: &Participant| p.name == e.display_name) {
                    out.errors.push(format!("{} is listed twice", e.display_name));
                    continue;
                }
                if variant == Variant::Chess960 && !e.chess960 {
                    if e.options.is_empty() {
                        out.warnings.push(format!("{}: its UCI options are unknown (verify it): Chess960 support not confirmed", e.display_name));
                    } else {
                        out.errors.push(format!("{} does not support Chess960 (no UCI_Chess960 option)", e.display_name));
                    }
                }
                if let Some(tm) = e.threads_max {
                    if (threads as i64) > tm {
                        out.errors.push(format!("{} supports at most {tm} threads", e.display_name));
                    }
                }
                let mut options: BTreeMap<String, String> = BTreeMap::new();
                options.insert("Threads".into(), "${THREADS}".into());
                options.insert("Hash".into(), "${HASH}".into());
                options.extend(e.default_options.clone());
                if let Some(o) = f.options.get(input).or_else(|| f.options.get(&e.display_name)) {
                    options.extend(o.clone());
                }
                let (rating, est) = (env.rating)(&e.display_name, threads);
                participants.push(Participant {
                    name: e.display_name.clone(),
                    cmd: e.path.clone(),
                    dir: e.dir.clone(),
                    args: String::new(),
                    options,
                    role: *role,
                    engine_id: e.id,
                    has_syzygy: e.has_syzygy,
                    uci_id: if e.uci_id.is_empty() { None } else { Some(e.uci_id.clone()) },
                    rating,
                    rating_estimated: est,
                });
            }
        }
        out.engines.push(r);
    }
    for k in f.options.keys() {
        if !wanted.iter().any(|(n, _)| n == k) && !participants.iter().any(|p| &p.name == k) {
            out.warnings.push(format!("[options.\"{k}\"] does not name a player of this tournament"));
        }
    }
    // time control
    let tc = match f.tc.as_deref().map(str::trim) {
        Some(t) if !t.is_empty() && t != "auto" => {
            if crate::tc::parse_fastchess(t).is_none() {
                out.errors.push(format!("tc \"{t}\" is not a fastchess time control (e.g. \"103+1\", \"40/900+10\")"));
            }
            t.to_string()
        }
        _ => {
            let factor = f.factor.unwrap_or(s.default_factor);
            match crate::tc::compute(&nominal_for(&list), factor, Some(&s.tc_base_formula).filter(|x| !x.trim().is_empty()).map(|x| x.as_str()), Some(&s.tc_inc_formula).filter(|x| !x.trim().is_empty()).map(|x| x.as_str())) {
                Ok(r) => {
                    out.warnings.push(format!("tc not given: {} for CCRL {list} at machine factor {factor} ({})", r.fastchess, r.human));
                    r.fastchess
                }
                Err(e) => {
                    out.errors.push(format!("time control: {e}"));
                    String::new()
                }
            }
        }
    };
    let games = f.games_per_opponent.unwrap_or(30);
    let passes = f.passes.unwrap_or(1).max(1);
    let nodes: Vec<u32> = f.nodes.clone().filter(|n| !n.is_empty()).unwrap_or_else(|| env.nodes.iter().map(|n| n.0).collect::<Vec<_>>());
    let mut nodes = if nodes.is_empty() { vec![0] } else { nodes };
    // few openings (a short match): use fewer nodes rather than fail, unless nodes were given
    let openings = if passes > 0 { games / (passes * 2) } else { 0 };
    if f.nodes.is_none() && openings >= 1 && (openings as usize) < nodes.len() && games % (passes * 2) == 0 {
        nodes.truncate(openings as usize);
        out.warnings.push(format!("{openings} opening(s) per pass: using {} NUMA node(s)", nodes.len()));
    }
    let rounds_per_pass = match crate::model::split_openings(games, passes, nodes.len() as u32) {
        Ok(r) => r,
        Err(e) => {
            out.errors.push(e);
            vec![1]
        }
    };
    let cores = env.nodes.iter().find(|n| n.0 == nodes[0]).map(|n| n.1).unwrap_or(2);
    let lanes = f.lanes_per_node.unwrap_or_else(|| (cores / (2 * threads)).max(1));
    let book = match f.book.as_deref().filter(|b| !b.trim().is_empty()) {
        Some(b) => {
            let p = std::path::Path::new(b);
            if p.is_absolute() || s.books_dir.is_empty() { b.to_string() } else { std::path::Path::new(&s.books_dir).join(p).to_string_lossy().to_string() }
        }
        // Chess960 without a book: the start positions are generated at import (all 960, seed 1)
        None if variant == Variant::Chess960 => String::new(),
        None => s.default_book.clone(),
    };
    let mut adjudication: Adjudication = s.adjudication.clone();
    if let Some(a) = &f.adjudication {
        adjudication.draw_enabled = a.draw.unwrap_or(adjudication.draw_enabled);
        adjudication.draw_movenumber = a.draw_movenumber.unwrap_or(adjudication.draw_movenumber);
        adjudication.draw_movecount = a.draw_movecount.unwrap_or(adjudication.draw_movecount);
        adjudication.draw_score = a.draw_score.unwrap_or(adjudication.draw_score);
        adjudication.resign_enabled = a.resign.unwrap_or(adjudication.resign_enabled);
        adjudication.resign_movecount = a.resign_movecount.unwrap_or(adjudication.resign_movecount);
        adjudication.resign_score = a.resign_score.unwrap_or(adjudication.resign_score);
        adjudication.resign_twosided = a.resign_twosided.unwrap_or(adjudication.resign_twosided);
    }
    let label = match kind {
        TournamentKind::RoundRobin => "round robin",
        TournamentKind::Match => "match",
        _ => "gauntlet",
    };
    let seed_names: Vec<&str> = participants.iter().filter(|p| p.role == Role::Seed).map(|p| p.name.as_str()).collect();
    let event = f.event.clone().filter(|e| !e.trim().is_empty()).unwrap_or_else(|| {
        if kind == TournamentKind::RoundRobin {
            format!("CCRL {list} round robin {threads}CPU")
        } else {
            format!("CCRL {list} {label} {} {threads}CPU", if seed_names.is_empty() { "<seed>".to_string() } else { seed_names.join(" + ") })
        }
    });
    let name = f.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| event.trim_start_matches("CCRL ").to_string());
    out.config = Some(TournamentConfig {
        name,
        kind,
        participants,
        games_per_pairing: games,
        passes,
        play_passes: None,
        nodes,
        rounds_per_pass,
        lanes_per_node: lanes,
        concurrency: 1,
        threads,
        hash_mb: f.hash_mb.unwrap_or(s.hash_per_thread_mb * threads),
        tc,
        book_format: if book.to_lowercase().ends_with(".epd") { "epd".into() } else { "pgn".into() },
        book,
        book_start: f.book_start.unwrap_or(1).max(1),
        event,
        site: f.site.clone().unwrap_or_else(|| s.site.clone()),
        syzygy_path: f.syzygy.clone().unwrap_or_else(|| s.syzygy_path.clone()),
        adjudication,
        extra_args: f.extra_args.clone(),
        placement: f.placement.unwrap_or(Placement::Node),
        log_level: "info".into(),
        ccrl_list: list,
        max_retries: 2,
        max_slot_attempts: 3,
        fastchess: String::new(),
        startup_ms: 60000,
        variant,
    });
    out
}

/// The file describing an existing tournament (to reuse it, or as an example).
pub fn from_config(c: &TournamentConfig) -> TournamentFile {
    let gauntlet = matches!(c.kind, TournamentKind::Gauntlet | TournamentKind::MultiGauntlet);
    let seeds: Vec<String> = c.seeds().iter().map(|p| p.name.clone()).collect();
    TournamentFile {
        format: Some(FORMAT),
        name: Some(c.name.clone()),
        kind: Some(c.kind),
        list: if c.ccrl_list.is_empty() { None } else { Some(c.ccrl_list.clone()) },
        seed: if !gauntlet { Names::None } else if seeds.len() == 1 { Names::One(seeds[0].clone()) } else { Names::Many(seeds) },
        opponents: if gauntlet { c.opponents().iter().map(|p| p.name.clone()).collect() } else { vec![] },
        engines: if gauntlet { vec![] } else { c.participants.iter().map(|p| p.name.clone()).collect() },
        threads: Some(c.threads),
        hash_mb: Some(c.hash_mb),
        tc: Some(c.tc.clone()),
        games_per_opponent: Some(c.games_per_pairing),
        passes: Some(c.passes),
        nodes: Some(c.nodes.clone()),
        lanes_per_node: Some(c.lanes_per_node),
        placement: Some(c.placement),
        book: if c.book.is_empty() { None } else { Some(c.book.clone()) },
        book_start: Some(c.book_start),
        syzygy: if c.syzygy_path.is_empty() { None } else { Some(c.syzygy_path.clone()) },
        event: Some(c.event.clone()),
        site: if c.site.is_empty() { None } else { Some(c.site.clone()) },
        extra_args: c.extra_args.clone(),
        variant: if c.variant == Variant::Standard { None } else { Some(c.variant) },
        ..Default::default()
    }
}

pub fn to_toml(f: &TournamentFile) -> Result<String> {
    Ok(format!("# TorsGUI tournament file — import it from Tournaments → Import file\n{}", toml::to_string(f)?))
}

/// An annotated template listing this library's engines: hand it to an assistant together
/// with the request ("a Blitz gauntlet of X against 15 engines rated around its level").
pub fn template(engines: &[EngineEntry], s: &Settings, nodes: &[(u32, u32)]) -> String {
    let mut names: Vec<String> = engines.iter().filter(|e| !e.path.is_empty()).map(|e| e.display_name.clone()).collect();
    names.sort_by_key(|n| n.to_lowercase());
    let lib = if names.is_empty() { "#   (the library is empty)".to_string() } else { names.iter().map(|n| format!("#   {n}")).collect::<Vec<_>>().join("\n") };
    let machine = nodes.iter().map(|(id, c)| format!("node {id}: {c} physical cores")).collect::<Vec<_>>().join(", ");
    format!(
        r#"# TorsGUI tournament file (format {FORMAT}).
# Write one file per tournament, save it with the extension .toml and import it in TorsGUI
# (Tournaments → Import file, or drop it in the workspace "inbox" folder). TorsGUI shows
# what it understood, and you choose: save as draft, add to the queue or start now.
#
# Rules: engine names must be names of the engine library below (case and spacing do not
# matter; a name without version means the latest installed version). Every field except
# `seed`/`opponents` (or `engines`) is optional: the defaults are those of the wizard.
# CCRL: games per opponent even (each opening with both colours), 512 MB hash per thread,
# ponder off, the list's time control scaled by the machine factor ({factor}).
#
# Machine: {machine}
# Engine library:
{lib}

format = {FORMAT}
kind = "gauntlet"            # gauntlet | multi_gauntlet | round_robin | match
list = "Blitz"               # "Blitz", "40/15" or "FRC"
# variant = "chess960"       # Fischer Random (default for the FRC list); engines must support UCI_Chess960
seed = "Engine Under Test 1.0"
opponents = [
  "Opponent A 2.0",
  "Opponent B 3.1",
]
# engines = ["A 1.0", "B 2.0", "C 3.0"]   # instead of seed/opponents for round_robin / match
threads = 1                  # per engine
games_per_opponent = 30      # even
# passes = 1                 # split the openings into passes (stop after a pass stays balanced)
# tc = "103+1"               # default: computed from the list and the machine factor
# hash_mb = 512              # default: {hash} MB x threads
# nodes = [0, 1]             # default: all NUMA nodes
# lanes_per_node = 2         # default: physical cores / (2 x threads)
# book = "avt-book-2026.pgn" # default: {book} (Chess960: all 960 start positions, generated)
# book_start = 1
# event = "CCRL Blitz gauntlet Engine Under Test 1.0 1CPU"
# after_import = "queue"     # draft | queue | start
# notes = "why this tournament"
#
# [options."Opponent A 2.0"]  # extra UCI options for one engine
# Contempt = "0"
#
# [adjudication]              # default: the settings
# draw = true
# resign = true
"#,
        factor = s.default_factor,
        hash = s.hash_per_thread_mb,
        book = if s.default_book.is_empty() { "(none set)" } else { &s.default_book },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Vec<EngineEntry> {
        let mk = |id: i64, e: &str, v: &str, tmax: Option<i64>| EngineEntry {
            id: Some(id),
            display_name: crate::names::display_name(e, v),
            engine: e.into(),
            version: v.into(),
            path: format!("/e/{e}-{v}"),
            dir: "/e".into(),
            threads_max: tmax,
            has_syzygy: true,
            ..Default::default()
        };
        vec![mk(1, "Triumviratus", "7.0", None), mk(2, "Stockfish", "17", None), mk(3, "Stockfish", "19", None), mk(4, "Obsidian", "16.0", None), mk(5, "Berserk", "14", Some(4)), mk(6, "Caissa", "2.0", None)]
    }
    fn env<'a>(engines: &'a [EngineEntry], s: &'a Settings) -> Env<'a> {
        Env { engines, settings: s, nodes: vec![(0, 20), (1, 20)], rating: &|n: &str, _t: u32| (if n.starts_with("Stockfish") { Some(3650.0) } else { None }, false) }
    }

    #[test]
    fn gauntlet_with_defaults_and_tolerant_names() {
        let s = Settings { default_factor: 0.86, default_book: "/books/avt.pgn".into(), ..Default::default() };
        let engines = lib();
        let f = parse(
            r#"
            seed = "triumviratus 7.0"
            opponents = ["Stockfish", "Obsidan 16.0", "Caissa  2.0"]
            threads = 8
            games_per_opponent = 30
            [options."Caissa  2.0"]
            Contempt = "0"
            "#,
        )
        .unwrap();
        let r = build(&f, &env(&engines, &s));
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        let c = r.config.unwrap();
        assert_eq!(c.kind, TournamentKind::Gauntlet);
        let names: Vec<&str> = c.participants.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Triumviratus 7.0", "Stockfish 19", "Obsidian 16.0", "Caissa 2.0"]);
        assert_eq!(r.engines[1].how, "latest version");
        assert_eq!(r.engines[2].how, "approximate");
        assert_eq!(c.participants[3].options.get("Contempt").map(|s| s.as_str()), Some("0"));
        assert_eq!(c.participants[1].rating, Some(3650.0));
        // wizard defaults
        assert_eq!(c.tc, "103+1");
        assert_eq!(c.hash_mb, 512 * 8);
        assert_eq!(c.nodes, vec![0, 1]);
        assert_eq!(c.rounds_per_pass, vec![8, 7]);
        assert_eq!(c.lanes_per_node, 1);
        assert_eq!(c.book, "/books/avt.pgn");
        assert_eq!(c.event, "CCRL Blitz gauntlet Triumviratus 7.0 8CPU");
        assert_eq!(c.name, "Blitz gauntlet Triumviratus 7.0 8CPU");
        assert_eq!(r.after_import, "queue");
        assert_eq!(crate::scheduler::expected_games(&c), 90);
    }

    #[test]
    fn errors_are_explained() {
        let s = Settings::default();
        let engines = lib();
        let f = parse("seed = \"Triumviratus 7.0\"\nopponents = [\"Stokfish 19\", \"Unknown Engine 1\", \"Berserk 14\"]\nthreads = 8\ngames_per_opponent = 31\n").unwrap();
        let r = build(&f, &env(&engines, &s));
        let all = r.errors.join("\n");
        assert!(all.contains("Unknown Engine 1"), "{all}");
        assert!(all.contains("Berserk 14 supports at most 4 threads"), "{all}");
        assert!(all.contains("must be even"), "{all}");
        // a typo with one clear candidate is accepted with a warning
        assert!(r.warnings.iter().any(|w| w.contains("Stokfish 19") && w.contains("Stockfish 19")), "{:?}", r.warnings);
        assert!(parse("seed = \"x\"\nopponentz = []").unwrap_err().to_string().contains("opponentz"));
        assert!(parse("format = 99\nseed = \"x\"").is_err());
    }

    #[test]
    fn round_robin_match_json_and_round_trip() {
        let s = Settings::default();
        let engines = lib();
        let r = build(&parse(r#"{"kind":"match","engines":["Stockfish 17","Stockfish 19"],"tc":"40/900+10","games_per_opponent":100,"passes":5,"after_import":"start"}"#).unwrap(), &env(&engines, &s));
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        let c = r.config.unwrap();
        assert_eq!(c.kind, TournamentKind::Match);
        assert_eq!(c.tc, "40/900+10");
        assert_eq!(c.event, "CCRL Blitz match Stockfish 17 1CPU");
        assert_eq!(r.after_import, "start");
        // export → import gives the same configuration
        let text = to_toml(&from_config(&c)).unwrap();
        let again = build(&parse(&text).unwrap(), &env(&engines, &s)).config.unwrap();
        assert_eq!(serde_json::to_value(&again).unwrap(), serde_json::to_value(&c).unwrap(), "{text}");
        let rr = build(&parse("kind = \"round_robin\"\nengines = [\"Stockfish 17\", \"Obsidian 16.0\", \"Caissa 2.0\"]\ngames_per_opponent = 2\n").unwrap(), &env(&engines, &s)).config.unwrap();
        assert_eq!(crate::scheduler::expected_games(&rr), 6);
        // Chess960: FRC list → chess960 variant, 40/2 TC, engines without UCI_Chess960 refused
        let mut frc = lib();
        frc[1].chess960 = true;
        frc[3].chess960 = true;
        frc[3].options = vec![crate::engines::UciOption { name: "UCI_Chess960".into(), kind: "check".into(), default: Some("false".into()), min: None, max: None, vars: vec![] }];
        frc[5].options = vec![crate::engines::UciOption { name: "Hash".into(), kind: "spin".into(), default: None, min: None, max: None, vars: vec![] }];
        let r = build(&parse("list = \"FRC\"\nseed = \"Stockfish 17\"\nopponents = [\"Obsidian 16.0\", \"Caissa 2.0\", \"Triumviratus 7.0\"]\n").unwrap(), &env(&frc, &s));
        let c = r.config.clone().unwrap();
        assert_eq!(c.variant, Variant::Chess960);
        assert_eq!(c.tc, "40/120");
        assert!(c.book.is_empty());
        assert!(r.errors.iter().any(|e| e == "Caissa 2.0 does not support Chess960 (no UCI_Chess960 option)"), "{:?}", r.errors);
        assert!(r.warnings.iter().any(|w| w.contains("Triumviratus 7.0") && w.contains("not confirmed")), "{:?}", r.warnings);
        assert_eq!(from_config(&c).variant, Some(Variant::Chess960));
        // the template parses and lists the library
        let t = template(&engines, &s, &[(0, 20)]);
        assert!(t.contains("#   Stockfish 19"));
        assert!(parse(&t).is_ok());
    }
}
