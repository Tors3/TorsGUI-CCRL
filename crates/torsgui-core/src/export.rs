//! CCRL submission export, byte-compatible with `tools/export_ccrl.py`.
//!
//! Every finished game once (duplicates dropped, keeping the first by
//! GameEndTime), sorted by GameEndTime; only Event, Site, White/Black and Round
//! are changed (pitfall 10: TimeControl and every other tag stay untouched).

use crate::names::ccrl_name;
use crate::pgn::{event_slot, game_blocks, is_finished, read_text, Headers};
use anyhow::{bail, Context, Result};
use chrono::{Datelike, NaiveDate};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ExportOptions {
    pub tester: String,
    pub site: String,
    /// Submission date (YYYY-MM-DD).
    pub date: String,
    /// Seed player name as written in the PGNs.
    pub seed: String,
    /// Player names of the tournament (seed + opponents) as written in the PGNs.
    pub players: Vec<String>,
    pub threads: u32,
    pub hash_mb: u32,
    /// Threads of the players that differ from `threads` (an 8CPU seed vs 1CPU opponents).
    #[serde(default)]
    pub threads_of: BTreeMap<String, u32>,
    pub book: String,
    pub egtb: u32,
    pub make_zip: bool,
    /// Player name in the PGNs -> how CCRL writes it (without "64-bit" / "NCPU").
    #[serde(default)]
    pub ccrl_names: BTreeMap<String, String>,
    /// Where each CCRL spelling comes from (shown next to it).
    #[serde(default)]
    pub name_sources: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ExportResult {
    pub pgn_path: String,
    pub zip_path: Option<String>,
    pub games: usize,
    pub duplicates_dropped: usize,
    pub event: String,
    pub base_name: String,
    pub players: Vec<String>,
}

static EVENT_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\[Event ".*"\]$"#).unwrap());
static SITE_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\[Site ".*"\]$"#).unwrap());
static ROUND_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\[Round ".*"\]$"#).unwrap());
static PLAYER_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\[(White|Black) "(.*)"\]$"#).unwrap());

/// Key used by export_ccrl.py: (slot(h), White, Black) where slot falls back
/// to (Event, Round) when the Event carries no node/pass.
fn export_key(h: &Headers) -> (String, String, String) {
    let slot = match event_slot(h) {
        Some((n, p, r)) => format!("{n}|{p}|{r}"),
        None => format!("E|{}|{}", h.get_or("Event", ""), h.get_or("Round", "")),
    };
    (slot, h.get_or("White", "").to_string(), h.get_or("Black", "").to_string())
}

pub struct Selected {
    pub blocks: Vec<(String, Headers)>,
    pub duplicates: usize,
}

/// Unique finished games in chronological order (by GameEndTime string).
pub fn select_unique(files: &[PathBuf]) -> Result<Selected> {
    let mut games: Vec<(String, (String, String, String), String, Headers)> = Vec::new();
    let mut first: HashMap<(String, String, String), String> = HashMap::new();
    let mut sorted = files.to_vec();
    sorted.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    for p in &sorted {
        let text = read_text(p).with_context(|| format!("reading {}", p.display()))?;
        for b in game_blocks(&text) {
            let h = Headers::parse(b);
            if !is_finished(h.get_or("Result", "*")) {
                continue;
            }
            let k = export_key(&h);
            let e = h.get_or("GameEndTime", "").to_string();
            match first.get(&k) {
                Some(cur) if *cur <= e => {}
                _ => {
                    first.insert(k.clone(), e.clone());
                }
            }
            games.push((e, k, b.to_string(), h));
        }
    }
    let total = games.len();
    let mut taken: std::collections::HashSet<(String, String, String)> = Default::default();
    let mut unique: Vec<(String, String, Headers)> = Vec::new();
    for (e, k, b, h) in games {
        if first.get(&k) == Some(&e) && !taken.contains(&k) {
            taken.insert(k);
            unique.push((e, b, h));
        }
    }
    unique.sort_by(|a, b| a.0.cmp(&b.0)); // stable, like Python's sorted
    let duplicates = total - unique.len();
    Ok(Selected { blocks: unique.into_iter().map(|(_, b, h)| (b, h)).collect(), duplicates })
}

pub fn month_abbr(m: u32) -> &'static str {
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m - 1) as usize]
}

/// `<seed export name> - <Mon D>` using the date of the first game.
pub fn event_name(seed_ccrl: &str, blocks: &[(String, Headers)]) -> Result<String> {
    let start = blocks
        .iter()
        .filter_map(|(_, h)| h.get("Date"))
        .filter_map(|d| {
            let p: Vec<i32> = d.split('.').filter_map(|x| x.parse().ok()).collect();
            if p.len() == 3 {
                NaiveDate::from_ymd_opt(p[0], p[1] as u32, p[2] as u32)
            } else {
                None
            }
        })
        .min()
        .context("no game has a valid Date tag")?;
    Ok(format!("{seed_ccrl} - {} {}", month_abbr(start.month()), start.day()))
}

pub fn base_name(o: &ExportOptions, event: &str) -> String {
    format!(
        "[{} {}] {} (hash {}MB) (book {}) (egtb {}-man)",
        o.tester, o.date, event, o.hash_mb, o.book, o.egtb
    )
}

/// `_` in place of spaces, brackets and parentheses.
pub fn zip_name(base: &str) -> String {
    static A: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\s\[\]()]+").unwrap());
    static B: Lazy<Regex> = Lazy::new(|| Regex::new(r"_+").unwrap());
    let s = A.replace_all(base, "_");
    let s = B.replace_all(&s, "_");
    format!("{}.zip", s.trim_matches('_'))
}

/// Builds the export text (without writing files).
pub fn build(files: &[PathBuf], o: &ExportOptions) -> Result<(String, String, usize, usize, Vec<String>)> {
    let sel = select_unique(files)?;
    if sel.blocks.is_empty() {
        bail!("no finished game");
    }
    let export_name = |n: &str| ccrl_name(o.ccrl_names.get(n).map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or(n), o.threads_of.get(n).copied().unwrap_or(o.threads));
    let seed = export_name(&o.seed);
    let event = event_name(&seed, &sel.blocks)?;
    let names: HashMap<String, String> = o.players.iter().map(|n| (n.clone(), export_name(n))).collect();
    let mut out = Vec::with_capacity(sel.blocks.len());
    for (i, (b, _)) in sel.blocks.iter().enumerate() {
        let b = EVENT_LINE.replace_all(b, |_: &regex::Captures| format!("[Event \"{event}\"]"));
        let b = SITE_LINE.replace_all(&b, |_: &regex::Captures| format!("[Site \"{}\"]", o.site));
        let b = ROUND_LINE.replace_all(&b, |_: &regex::Captures| format!("[Round \"{}\"]", i + 1));
        let b = PLAYER_LINE.replace_all(&b, |c: &regex::Captures| {
            let n = names.get(&c[2]).cloned().unwrap_or_else(|| export_name(&c[2]));
            format!("[{} \"{}\"]", &c[1], n)
        });
        out.push(b.to_string());
    }
    let mut players: Vec<String> = names.values().cloned().collect();
    players.sort();
    players.dedup();
    let text = out.join("\n\n") + "\n\n";
    Ok((text, event, out.len(), sel.duplicates, players))
}

/// Writes `<base>.pgn` (and the zip) into `out_dir`.
pub fn export(files: &[PathBuf], o: &ExportOptions, out_dir: &Path) -> Result<ExportResult> {
    let (text, event, n, dups, players) = build(files, o)?;
    let base = base_name(o, &event);
    std::fs::create_dir_all(out_dir)?;
    let pgn_path = out_dir.join(format!("{base}.pgn"));
    std::fs::write(&pgn_path, text.as_bytes())?;
    let zip_path = if o.make_zip {
        let zp = out_dir.join(zip_name(&base));
        let f = std::fs::File::create(&zp)?;
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        z.start_file(format!("{base}.pgn"), opts)?;
        z.write_all(text.as_bytes())?;
        z.finish()?;
        Some(zp.to_string_lossy().to_string())
    } else {
        None
    };
    Ok(ExportResult {
        pgn_path: pgn_path.to_string_lossy().to_string(),
        zip_path,
        games: n,
        duplicates_dropped: dups,
        event,
        base_name: base,
        players,
    })
}

/// Content comparison used by the verification suite: same games in the same
/// order, same tags and the same move tokens (whitespace/line wrapping ignored).
pub fn same_content(a: &str, b: &str) -> Result<(), String> {
    let ga = game_blocks(a);
    let gb = game_blocks(b);
    if ga.len() != gb.len() {
        return Err(format!("game count differs: {} vs {}", ga.len(), gb.len()));
    }
    for (i, (x, y)) in ga.iter().zip(gb.iter()).enumerate() {
        let hx = Headers::parse(x);
        let hy = Headers::parse(y);
        if hx != hy {
            return Err(format!("game {}: tags differ\n{:?}\n{:?}", i + 1, hx, hy));
        }
        let mx: Vec<&str> = x.lines().filter(|l| !l.starts_with('[')).flat_map(|l| l.split_whitespace()).collect();
        let my: Vec<&str> = y.lines().filter(|l| !l.starts_with('[')).flat_map(|l| l.split_whitespace()).collect();
        if mx != my {
            return Err(format!("game {}: moves differ", i + 1));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zip_names() {
        let base = "[Francesco Torsello 2026-09-28] Triumviratus 7.0 64-bit 8CPU - Sep 27 (hash 4096MB) (book avt-book-2026) (egtb 5-man)";
        assert_eq!(
            zip_name(base),
            "Francesco_Torsello_2026-09-28_Triumviratus_7.0_64-bit_8CPU_-_Sep_27_hash_4096MB_book_avt-book-2026_egtb_5-man.zip"
        );
    }

    #[test]
    fn players_take_their_ccrl_spelling() {
        let dir = std::env::temp_dir().join(format!("torsgui-export-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pgn = dir.join("g.pgn");
        let game = |w: &str, b: &str, end: &str| format!("[Event \"x\"]\n[Site \"pc\"]\n[Date \"2026.09.27\"]\n[Round \"1\"]\n[White \"{w}\"]\n[Black \"{b}\"]\n[Result \"1-0\"]\n[GameEndTime \"{end}\"]\n\n1. e4 e5 1-0\n\n");
        std::fs::write(&pgn, game("Pawnocchio 2.1", "Integral v8", "2026-09-27T10:00:00") + &game("Integral v8", "Pawnocchio 2.1", "2026-09-27T11:00:00")).unwrap();
        let o = ExportOptions {
            tester: "T".into(),
            site: "Milan".into(),
            date: "2026-09-28".into(),
            seed: "Pawnocchio 2.1".into(),
            players: vec!["Pawnocchio 2.1".into(), "Integral v8".into()],
            threads: 4,
            hash_mb: 512,
            threads_of: BTreeMap::from([("Integral v8".to_string(), 1)]),
            book: "b".into(),
            egtb: 5,
            make_zip: false,
            ccrl_names: BTreeMap::from([("Pawnocchio 2.1".to_string(), "pawnocchio 2.1".to_string()), ("Integral v8".to_string(), "Integral 8".to_string())]),
            name_sources: BTreeMap::new(),
        };
        let (text, event, n, _, players) = build(&[pgn], &o).unwrap();
        assert_eq!(n, 2);
        assert_eq!(event, "pawnocchio 2.1 64-bit 4CPU - Sep 27");
        assert!(text.contains("[White \"pawnocchio 2.1 64-bit 4CPU\"]") && text.contains("[Black \"Integral 8 64-bit\"]"));
        assert!(!text.contains("Integral v8"));
        assert_eq!(players, vec!["Integral 8 64-bit", "pawnocchio 2.1 64-bit 4CPU"]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
