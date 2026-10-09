//! Test suites: EPD positions with a solution (`bm` best move, `am` move to avoid, `dm`
//! mate in N), searched by one or more engines for a fixed time. Puzzles and mate finding
//! for engines, like the classic WAC, ECM or STS tests.

use crate::engines::EngineEntry;
use crate::uci::{self, Limit, Score};
use anyhow::{bail, Result};
use cozy_chess::util::{display_uci_move, parse_san_move, parse_uci_move};
use cozy_chess::Board;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EpdPosition {
    pub id: String,
    /// Full FEN (halfmove and fullmove added when the EPD has none).
    pub fen: String,
    /// Solutions as written in the file (SAN) and as UCI moves.
    pub bm: Vec<String>,
    pub bm_uci: Vec<String>,
    pub am: Vec<String>,
    pub am_uci: Vec<String>,
    /// Mate in N moves.
    pub dm: Option<u32>,
}

impl EpdPosition {
    /// What counts as solved, for the tables.
    pub fn task(&self) -> String {
        let mut v = Vec::new();
        if !self.bm.is_empty() {
            v.push(format!("best {}", self.bm.join(" ")));
        }
        if !self.am.is_empty() {
            v.push(format!("avoid {}", self.am.join(" ")));
        }
        if let Some(d) = self.dm {
            v.push(format!("mate in {d}"));
        }
        v.join(" · ")
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ParsedSuite {
    pub positions: Vec<EpdPosition>,
    /// Lines that could not be read ("line 12: ...").
    pub errors: Vec<String>,
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_string()
}

fn to_uci(b: &Board, m: &str) -> Option<String> {
    let m = m.trim_end_matches(['+', '#', '!', '?']);
    let mv = parse_san_move(b, m).ok().or_else(|| parse_uci_move(b, m).ok())?;
    b.is_legal(mv).then(|| display_uci_move(b, mv).to_string())
}

/// Reads EPD text: `<placement> <side> <castling> <ep> [hmvc fmvn] op arg; op arg; ...`.
pub fn parse_epd(text: &str) -> ParsedSuite {
    let mut out = ParsedSuite::default();
    for (n, raw) in crate::pgn::normalize_newlines(text).lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let t: Vec<&str> = line.split_whitespace().collect();
        if t.len() < 4 {
            out.errors.push(format!("line {}: not an EPD position", n + 1));
            continue;
        }
        let mut rest_at = 4;
        let mut counters = "0 1".to_string();
        if t.len() >= 6 && t[4].parse::<u32>().is_ok() && t[5].parse::<u32>().is_ok() {
            counters = format!("{} {}", t[4], t[5]);
            rest_at = 6;
        }
        let fen = format!("{} {} {} {} {}", t[0], t[1], t[2], t[3], counters);
        let board = match crate::chess960::parse_fen(&fen) {
            Ok(b) => b,
            Err(e) => {
                out.errors.push(format!("line {}: {e}", n + 1));
                continue;
            }
        };
        let mut p = EpdPosition { id: format!("#{}", out.positions.len() + 1), fen: fen.clone(), ..Default::default() };
        // operations: split at ';' outside quotes
        let ops_text = t[rest_at..].join(" ");
        let mut ops = Vec::new();
        let mut cur = String::new();
        let mut quoted = false;
        for c in ops_text.chars() {
            match c {
                '"' => {
                    quoted = !quoted;
                    cur.push(c);
                }
                ';' if !quoted => ops.push(std::mem::take(&mut cur)),
                c => cur.push(c),
            }
        }
        ops.push(cur);
        let mut bad = Vec::new();
        for op in ops.iter().map(|o| o.trim()).filter(|o| !o.is_empty()) {
            let (code, arg) = op.split_once(char::is_whitespace).unwrap_or((op, ""));
            match code {
                "id" => p.id = unquote(arg),
                "bm" | "am" => {
                    for m in arg.split_whitespace() {
                        match to_uci(&board, m) {
                            Some(u) => {
                                if code == "bm" {
                                    p.bm.push(m.to_string());
                                    p.bm_uci.push(u);
                                } else {
                                    p.am.push(m.to_string());
                                    p.am_uci.push(u);
                                }
                            }
                            None => bad.push(m.to_string()),
                        }
                    }
                }
                "dm" => p.dm = arg.trim().parse().ok(),
                "hmvc" | "fmvn" => {}
                _ => {}
            }
        }
        if !bad.is_empty() {
            out.errors.push(format!("line {} ({}): illegal move {}", n + 1, p.id, bad.join(", ")));
        }
        if p.bm.is_empty() && p.am.is_empty() && p.dm.is_none() {
            out.errors.push(format!("line {} ({}): no solution (bm, am or dm)", n + 1, p.id));
            continue;
        }
        out.positions.push(p);
    }
    out
}

/// Is `bestmove` (with the final score) a solution of `p`?
pub fn solves(p: &EpdPosition, mv: &str, score: &Score) -> bool {
    let mate_ok = p.dm.is_some_and(|d| score.mate.is_some_and(|m| m > 0 && m as u32 <= d));
    if !p.bm_uci.is_empty() {
        // another mate as short as asked is a solution too
        return p.bm_uci.iter().any(|b| b == mv) || mate_ok;
    }
    if !p.am_uci.is_empty() {
        return !p.am_uci.iter().any(|a| a == mv) && (p.dm.is_none() || mate_ok);
    }
    mate_ok
}

// ------------------------------------------------------------------ built-in suites

pub struct BuiltinSuite {
    pub id: &'static str,
    pub name: &'static str,
    pub about: &'static str,
    pub text: &'static str,
}

pub const BUILTIN: &[BuiltinSuite] = &[
    BuiltinSuite {
        id: "mates",
        name: "Mate finding (sample)",
        about: "Mates in 1 to 7 moves: does the engine see them, and how fast?",
        text: include_str!("../suites/mates.epd"),
    },
    BuiltinSuite {
        id: "wac",
        name: "Win at Chess (sample)",
        about: "Tactics from Fred Reinfeld's \"Win at Chess\" (1958), the classic engine test.",
        text: include_str!("../suites/wac-sample.epd"),
    },
    // the classic suites below come from the tests of the Arasan chess engine by Jon Dart
    // (MIT licence, suites/LICENSE-arasan.txt), who collected them from their authors
    BuiltinSuite { id: "wac300", name: "Win at Chess (complete, revised)", about: "All 300 WAC positions with the solutions revised over the years (Reinfeld 1958; Arasan's collection).", text: include_str!("../suites/wacnew.epd") },
    BuiltinSuite { id: "ecm-gcp", name: "ECM GCP", about: "Middlegame tactics from the Encyclopedia of Chess Middlegames, the GCP selection (Arasan's collection).", text: include_str!("../suites/ecmgcp.epd") },
    BuiltinSuite { id: "iq4", name: "IQ4", about: "Hard tactical positions of the IQ test series (Arasan's collection).", text: include_str!("../suites/iq4.epd") },
    BuiltinSuite { id: "bt2630", name: "BT-2630", about: "Bednorz-Tönissen test: 30 positional and tactical positions (Arasan's collection).", text: include_str!("../suites/bt2630.epd") },
    BuiltinSuite { id: "lct2", name: "LCT II", about: "Louguet Chess Test II by Frédéric Louguet: positional, tactical and endgame positions (Arasan's collection).", text: include_str!("../suites/lapuce2.epd") },
    BuiltinSuite { id: "pet", name: "Pawn endgame test", about: "Pawn endgame test positions (Arasan's collection).", text: include_str!("../suites/pet.epd") },
    BuiltinSuite { id: "eet", name: "Eigenmann Endgame Test", about: "Endgames of every kind by Walter Eigenmann (Arasan's collection).", text: include_str!("../suites/eet.epd") },
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SuiteInfo {
    pub id: String,
    pub name: String,
    pub about: String,
    pub positions: u32,
}

pub fn builtin_list() -> Vec<SuiteInfo> {
    BUILTIN.iter().map(|s| SuiteInfo { id: s.id.into(), name: s.name.into(), about: s.about.into(), positions: parse_epd(s.text).positions.len() as u32 }).collect()
}

// ------------------------------------------------------------------ runs

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SuiteConfig {
    /// Built-in suite id, or empty with `path` / `text`.
    #[serde(default)]
    pub builtin: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub text: String,
    pub engines: Vec<i64>,
    pub movetime_ms: u64,
    pub threads: u32,
    pub hash: u32,
    /// Engines searching at the same time.
    pub concurrency: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PositionResult {
    pub bestmove: String,
    pub bestmove_san: String,
    pub score: Score,
    pub depth: u32,
    pub solved: bool,
    /// When the engine found the solution and kept it to the end (ms).
    pub solved_at_ms: Option<u64>,
    pub nodes: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EngineSuiteResult {
    pub engine_id: i64,
    pub name: String,
    pub results: Vec<Option<PositionResult>>,
    pub solved: u32,
    /// Sum of the solve times of the solved positions (ms).
    pub solve_time_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SuiteRun {
    pub id: String,
    pub suite: String,
    pub created_at: String,
    pub movetime_ms: u64,
    pub threads: u32,
    pub hash: u32,
    pub positions: Vec<EpdPosition>,
    pub engines: Vec<EngineSuiteResult>,
    pub finished: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SuiteProgress {
    pub running: bool,
    pub done: u32,
    pub total: u32,
    pub error: Option<String>,
    pub run: Option<SuiteRun>,
}

/// The positions of a configuration (built-in, file or pasted text).
pub fn load(cfg: &SuiteConfig) -> Result<(String, ParsedSuite)> {
    if !cfg.builtin.is_empty() {
        let s = BUILTIN.iter().find(|s| s.id == cfg.builtin).ok_or_else(|| anyhow::anyhow!("unknown suite {}", cfg.builtin))?;
        return Ok((s.name.to_string(), parse_epd(s.text)));
    }
    if !cfg.path.trim().is_empty() {
        let p = Path::new(cfg.path.trim());
        let text = crate::pgn::read_text(p).map_err(|e| anyhow::anyhow!("{}: {e}", p.display()))?;
        return Ok((p.file_name().unwrap_or_default().to_string_lossy().to_string(), parse_epd(&text)));
    }
    if !cfg.text.trim().is_empty() {
        return Ok(("Pasted positions".into(), parse_epd(&cfg.text)));
    }
    bail!("choose a suite, an EPD file or paste positions")
}

/// One position searched by one engine.
fn solve_one(e: &mut uci::Engine, p: &EpdPosition, movetime: u64, cancel: &AtomicBool) -> PositionResult {
    let board = crate::chess960::parse_fen(&p.fen).unwrap_or_default();
    let mut since: Option<u64> = None;
    let r = e.new_game().and_then(|_| {
        e.search(&p.fen, &[], Limit::MoveTime(movetime), cancel, |i| {
            if i.multipv != 1 {
                return;
            }
            let ok = i.pv.first().is_some_and(|m| solves(p, m, &i.score));
            match (ok, since) {
                (true, None) => since = Some(i.time_ms.unwrap_or(0)),
                (false, Some(_)) => since = None,
                _ => {}
            }
        })
    });
    match r {
        Ok(s) => {
            let last = s.lines.first().cloned().unwrap_or_default();
            let solved = solves(p, &s.bestmove, &last.score);
            let san = parse_uci_move(&board, &s.bestmove).ok().filter(|m| board.is_legal(*m)).map(|m| uci::san(&board, m)).unwrap_or_else(|| s.bestmove.clone());
            PositionResult {
                bestmove: s.bestmove,
                bestmove_san: san,
                score: last.score,
                depth: last.depth,
                solved,
                solved_at_ms: if solved { Some(since.unwrap_or(s.elapsed_ms).min(s.elapsed_ms)) } else { None },
                nodes: last.nodes,
                error: None,
            }
        }
        Err(err) => PositionResult { error: Some(format!("{err:#}")), ..Default::default() },
    }
}

fn tally(r: &mut EngineSuiteResult) {
    r.solved = r.results.iter().flatten().filter(|x| x.solved).count() as u32;
    r.solve_time_ms = r.results.iter().flatten().filter_map(|x| x.solved_at_ms).sum();
}

/// Runs the suite; `progress.run` is filled as results come in.
pub fn run(cfg: &SuiteConfig, engines: &[EngineEntry], progress: Arc<Mutex<SuiteProgress>>, cancel: Arc<AtomicBool>) -> Result<SuiteRun> {
    let (name, parsed) = load(cfg)?;
    if parsed.positions.is_empty() {
        bail!("no positions to search{}", parsed.errors.first().map(|e| format!(" ({e})")).unwrap_or_default());
    }
    if engines.is_empty() {
        bail!("choose at least one engine");
    }
    let n = parsed.positions.len();
    let run = SuiteRun {
        id: chrono::Local::now().format("%Y%m%d-%H%M%S").to_string(),
        suite: name,
        created_at: chrono::Local::now().to_rfc3339(),
        movetime_ms: cfg.movetime_ms.max(10),
        threads: cfg.threads.max(1),
        hash: cfg.hash.max(1),
        positions: parsed.positions.clone(),
        engines: engines.iter().map(|e| EngineSuiteResult { engine_id: e.id.unwrap_or(0), name: e.display_name.clone(), results: vec![None; n], ..Default::default() }).collect(),
        finished: false,
    };
    {
        let mut p = progress.lock().unwrap();
        p.total = (n * engines.len()) as u32;
        p.done = 0;
        p.run = Some(run.clone());
    }
    // jobs: every engine on every position; each worker keeps one process per engine
    let jobs: Arc<Mutex<Vec<(usize, usize)>>> = Arc::new(Mutex::new((0..n).rev().flat_map(|pi| (0..engines.len()).rev().map(move |ei| (ei, pi))).collect()));
    let workers = cfg.concurrency.clamp(1, 64) as usize;
    std::thread::scope(|s| {
        for _ in 0..workers.min(n * engines.len()) {
            let jobs = jobs.clone();
            let progress = progress.clone();
            let cancel = cancel.clone();
            let positions = &parsed.positions;
            s.spawn(move || {
                let mut procs: HashMap<usize, uci::Engine> = HashMap::new();
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let Some((ei, pi)) = jobs.lock().unwrap().pop() else { break };
                    let res = match procs.get_mut(&ei) {
                        Some(e) => Ok(e),
                        None => uci::start_analysis(&engines[ei], run.threads, run.hash, &BTreeMap::new()).map(|e| procs.entry(ei).or_insert(e)),
                    }
                    .map(|e| solve_one(e, &positions[pi], run.movetime_ms, &cancel));
                    let r = res.unwrap_or_else(|err| PositionResult { error: Some(format!("{err:#}")), ..Default::default() });
                    if r.error.is_some() {
                        procs.remove(&ei); // restarted for the next position
                    }
                    let mut p = progress.lock().unwrap();
                    p.done += 1;
                    if let Some(run) = p.run.as_mut() {
                        run.engines[ei].results[pi] = Some(r);
                        tally(&mut run.engines[ei]);
                    }
                }
                for (_, e) in procs.drain() {
                    e.quit();
                }
            });
        }
    });
    let mut p = progress.lock().unwrap();
    let mut out = p.run.clone().unwrap_or(run);
    out.finished = !cancel.load(Ordering::Relaxed);
    p.run = Some(out.clone());
    Ok(out)
}

// ------------------------------------------------------------------ history

pub fn runs_dir(root: &Path) -> std::path::PathBuf {
    root.join("suites").join("runs")
}

pub fn save_run(root: &Path, r: &SuiteRun) -> Result<()> {
    let d = runs_dir(root);
    std::fs::create_dir_all(&d)?;
    std::fs::write(d.join(format!("{}.json", r.id)), serde_json::to_vec_pretty(r)?)?;
    Ok(())
}

pub fn list_runs(root: &Path) -> Vec<SuiteRun> {
    let mut v: Vec<SuiteRun> = std::fs::read_dir(runs_dir(root))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .filter_map(|b| serde_json::from_slice(&b).ok())
        .collect();
    v.sort_by(|a, b| b.id.cmp(&a.id));
    v
}

pub fn delete_run(root: &Path, id: &str) -> Result<()> {
    if id.contains(['/', '\\', '.']) {
        bail!("bad run id");
    }
    std::fs::remove_file(runs_dir(root).join(format!("{id}.json")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epd_lines_are_read() {
        let s = parse_epd(
            "2rr3k/pp3pp1/1nnqbN1p/3pN3/2pP4/2P3Q1/PPB4P/R4RK1 w - - bm Qg6; id \"WAC.001\";\n\
             # a comment\n\
             6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1 bm Rd8#; dm 1; id \"back rank; mate\";\n\
             6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - am Rd2 Kh1; c0 \"x\";\n\
             8/8/8/8/8/8/8/8 w - - bm e4;\n\
             6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - bm Qh5;\n\
             6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - id \"nothing\";\n",
        );
        assert_eq!(s.positions.len(), 3, "{:?}", s.errors);
        assert_eq!(s.positions[0].id, "WAC.001");
        assert_eq!(s.positions[0].bm_uci, vec!["g3g6"]);
        assert_eq!(s.positions[1].id, "back rank; mate");
        assert_eq!((s.positions[1].bm_uci.clone(), s.positions[1].dm), (vec!["d1d8".to_string()], Some(1)));
        assert_eq!(s.positions[2].am_uci, vec!["d1d2", "g1h1"]);
        assert_eq!(s.errors.len(), 4, "{:?}", s.errors);
        let mate = Score { cp: None, mate: Some(1) };
        assert!(solves(&s.positions[1], "d1d8", &mate));
        assert!(!solves(&s.positions[1], "d1d7", &Score { cp: Some(300), mate: None }));
        assert!(solves(&s.positions[2], "d1d7", &Score::default()));
        assert!(!solves(&s.positions[2], "g1h1", &Score::default()));
        for b in BUILTIN {
            let p = parse_epd(b.text);
            assert!(p.errors.is_empty() && p.positions.len() >= 10, "{}: {:?}", b.id, p.errors);
            // the solutions are the moves written (SAN, check signs aside)
            for x in &p.positions {
                let board = crate::chess960::parse_fen(&x.fen).unwrap();
                let plain = |m: &str| m.trim_end_matches(['+', '#', '!', '?']).to_string();
                let sans: Vec<String> = x.bm_uci.iter().map(|m| plain(&uci::san(&board, parse_uci_move(&board, m).unwrap()))).collect();
                assert_eq!(sans, x.bm.iter().map(|m| plain(m)).collect::<Vec<_>>(), "{} {}", b.id, x.id);
            }
        }
    }
}
