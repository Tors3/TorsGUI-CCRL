//! A small UCI client: starts an engine of the library, sets its options and searches
//! positions. Used by the test suites (EPD puzzles) and the game analysis; tournaments
//! are played by fastchess.

use anyhow::{bail, Context, Result};
use cozy_chess::util::{display_san_move, parse_uci_move};
use cozy_chess::Board;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// Score from the side to move's point of view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Score {
    pub cp: Option<i32>,
    /// Moves to mate (negative: the side to move is mated).
    pub mate: Option<i32>,
}

impl Score {
    /// Centipawns for comparisons: mates are ±(100000 − distance).
    pub fn value(&self) -> i32 {
        match (self.mate, self.cp) {
            (Some(m), _) if m > 0 => 100_000 - m,
            (Some(m), _) => -100_000 - m,
            (None, Some(c)) => c,
            _ => 0,
        }
    }
    pub fn negate(self) -> Score {
        Score { cp: self.cp.map(|c| -c), mate: self.mate.map(|m| -m) }
    }
    pub fn is_known(&self) -> bool {
        self.cp.is_some() || self.mate.is_some()
    }
}

/// One `info` line with a principal variation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Info {
    pub depth: u32,
    pub seldepth: Option<u32>,
    pub multipv: u32,
    pub score: Score,
    pub nodes: Option<u64>,
    pub nps: Option<u64>,
    pub time_ms: Option<u64>,
    pub pv: Vec<String>,
    /// The PV in SAN (filled by the caller that knows the position).
    pub pv_san: Vec<String>,
}

/// Parses an `info ... pv ...` line (lines without a score or a PV give None).
pub fn parse_info(line: &str) -> Option<Info> {
    let t: Vec<&str> = line.split_whitespace().collect();
    if t.first() != Some(&"info") {
        return None;
    }
    let mut i = Info { multipv: 1, ..Default::default() };
    let mut k = 1;
    let num = |k: usize| t.get(k).and_then(|x| x.parse::<i64>().ok());
    while k < t.len() {
        match t[k] {
            "depth" => i.depth = num(k + 1).unwrap_or(0) as u32,
            "seldepth" => i.seldepth = num(k + 1).map(|v| v as u32),
            "multipv" => i.multipv = num(k + 1).unwrap_or(1) as u32,
            "nodes" => i.nodes = num(k + 1).map(|v| v as u64),
            "nps" => i.nps = num(k + 1).map(|v| v as u64),
            "time" => i.time_ms = num(k + 1).map(|v| v as u64),
            "score" => {
                match t.get(k + 1) {
                    Some(&"cp") => i.score.cp = num(k + 2).map(|v| v as i32),
                    Some(&"mate") => i.score.mate = num(k + 2).map(|v| v as i32),
                    _ => {}
                }
                k += 3;
                // "lowerbound" / "upperbound": a bound, not a score of the PV
                if matches!(t.get(k), Some(&"lowerbound") | Some(&"upperbound")) {
                    return None;
                }
                continue;
            }
            "pv" => {
                i.pv = t[k + 1..].iter().map(|s| s.to_string()).collect();
                break;
            }
            "string" | "currmove" | "currmovenumber" => {
                if t[k] == "string" {
                    return None;
                }
            }
            _ => {}
        }
        k += 2;
    }
    if i.pv.is_empty() || !i.score.is_known() {
        return None;
    }
    Some(i)
}

/// SAN of a PV played from `b` (stops at the first move that does not parse).
pub fn pv_san(b: &Board, pv: &[String]) -> Vec<String> {
    let mut b = b.clone();
    let mut out = Vec::new();
    for m in pv {
        let Ok(mv) = parse_uci_move(&b, m) else { break };
        if !b.is_legal(mv) {
            break;
        }
        out.push(san(&b, mv));
        b.play(mv);
    }
    out
}

/// SAN with `+` / `#`.
pub fn san(b: &Board, mv: cozy_chess::Move) -> String {
    display_san_move(b, mv).to_string()
}

/// Words of an argument string, with "double quotes" kept together.
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(cur);
    }
    out
}

/// How long to search.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Limit {
    MoveTime(u64),
    Depth(u32),
    Nodes(u64),
    Infinite,
}

impl Limit {
    fn go(&self) -> String {
        match self {
            Limit::MoveTime(ms) => format!("go movetime {ms}"),
            Limit::Depth(d) => format!("go depth {d}"),
            Limit::Nodes(n) => format!("go nodes {n}"),
            Limit::Infinite => "go infinite".into(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SearchResult {
    pub bestmove: String,
    /// The last info of each multipv line, multipv 1 first.
    pub lines: Vec<Info>,
    pub elapsed_ms: u64,
}

pub struct Engine {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<String>,
    pub name: String,
    pub chess960: bool,
}

impl Engine {
    /// Starts the engine (`uci`, options, `isready`).
    pub fn start(exe: &Path, args: &str, options: &BTreeMap<String, String>) -> Result<Engine> {
        if !exe.is_file() {
            bail!("engine not found: {}", exe.display());
        }
        let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| ".".into());
        let mut cmd = Command::new(exe);
        cmd.args(split_args(args)).current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        crate::platform::no_window(&mut cmd);
        let mut child = cmd.spawn().with_context(|| format!("cannot start {}", exe.display()))?;
        let stdin = child.stdin.take().context("stdin")?;
        let stdout = child.stdout.take().context("stdout")?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for l in BufReader::new(stdout).lines() {
                let Ok(l) = l else { break };
                if tx.send(l).is_err() {
                    break;
                }
            }
        });
        let mut e = Engine { child, stdin, rx, name: String::new(), chess960: false };
        e.send("uci")?;
        let lines = e.wait_for("uciok", Duration::from_secs(30)).context("the engine did not answer uciok")?;
        e.name = lines.iter().find_map(|l| l.strip_prefix("id name ")).unwrap_or("?").trim().to_string();
        e.chess960 = lines.iter().any(|l| l.starts_with("option name UCI_Chess960 "));
        for (k, v) in options {
            if v.is_empty() || v.contains("${") {
                continue;
            }
            e.send(&format!("setoption name {k} value {v}"))?;
        }
        e.ready()?;
        Ok(e)
    }

    pub fn send(&mut self, s: &str) -> Result<()> {
        writeln!(self.stdin, "{s}").and_then(|_| self.stdin.flush()).context("the engine closed its input")
    }

    /// Lines up to (and including) the first one starting with `prefix`.
    fn wait_for(&mut self, prefix: &str, timeout: Duration) -> Result<Vec<String>> {
        let end = Instant::now() + timeout;
        let mut lines = Vec::new();
        loop {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                bail!("timeout waiting for {prefix}");
            }
            match self.rx.recv_timeout(left.min(Duration::from_millis(200))) {
                Ok(l) => {
                    let hit = l.starts_with(prefix);
                    lines.push(l);
                    if hit {
                        return Ok(lines);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => bail!("the engine stopped"),
            }
        }
    }

    pub fn ready(&mut self) -> Result<()> {
        self.send("isready")?;
        self.wait_for("readyok", Duration::from_secs(60)).map(|_| ())
    }

    pub fn new_game(&mut self) -> Result<()> {
        self.send("ucinewgame")?;
        self.ready()
    }

    /// Searches `fen` (+ `moves`). `on_info` sees every info line with a PV; `cancel` stops
    /// the search early (the engine still answers with its best move).
    pub fn search(&mut self, fen: &str, moves: &[String], limit: Limit, cancel: &AtomicBool, mut on_info: impl FnMut(&Info)) -> Result<SearchResult> {
        let pos = if moves.is_empty() { format!("position fen {fen}") } else { format!("position fen {fen} moves {}", moves.join(" ")) };
        self.send(&pos)?;
        let t0 = Instant::now();
        self.send(&limit.go())?;
        let mut lines: BTreeMap<u32, Info> = BTreeMap::new();
        let mut stopped = false;
        // a movetime search that runs far past its time is stopped; a hung engine fails
        let hard = match limit {
            Limit::MoveTime(ms) => Some(Duration::from_millis(ms * 2 + 5000)),
            _ => None,
        };
        let mut stop_at: Option<Instant> = None;
        loop {
            if !stopped && (cancel.load(Ordering::Relaxed) || hard.is_some_and(|h| t0.elapsed() > h)) {
                self.send("stop")?;
                stopped = true;
                stop_at = Some(Instant::now());
            }
            if stop_at.is_some_and(|s| s.elapsed() > Duration::from_secs(10)) {
                bail!("the engine does not stop");
            }
            match self.rx.recv_timeout(Duration::from_millis(50)) {
                Ok(l) => {
                    if let Some(rest) = l.strip_prefix("bestmove") {
                        let bestmove = rest.split_whitespace().next().unwrap_or("").to_string();
                        let mut lines: Vec<Info> = lines.into_values().collect();
                        lines.sort_by_key(|i| i.multipv);
                        return Ok(SearchResult { bestmove, lines, elapsed_ms: t0.elapsed().as_millis() as u64 });
                    }
                    if let Some(i) = parse_info(&l) {
                        on_info(&i);
                        // a new depth of the first line resets the others
                        if i.multipv == 1 {
                            lines.retain(|_, x| x.depth >= i.depth);
                        }
                        lines.insert(i.multipv, i);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => bail!("the engine stopped during the search"),
            }
        }
    }

    pub fn quit(mut self) {
        let _ = self.send("quit");
        let end = Instant::now() + Duration::from_secs(2);
        while Instant::now() < end {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Starts a library engine with its saved options, `threads` and `hash`.
pub fn start_entry(e: &crate::engines::EngineEntry, threads: u32, hash: u32, extra: &BTreeMap<String, String>) -> Result<Engine> {
    let mut o = e.default_options.clone();
    o.insert("Threads".into(), threads.max(1).to_string());
    o.insert("Hash".into(), hash.max(1).to_string());
    for (k, v) in extra {
        o.insert(k.clone(), v.clone());
    }
    // undeclared Threads/Hash are not sent when the declared options are known
    if !e.options.is_empty() {
        for k in ["Threads", "Hash", "MultiPV", "UCI_Chess960"] {
            if !e.options.iter().any(|x| x.name == k) {
                o.remove(k);
            }
        }
    }
    Engine::start(Path::new(&e.path), &e.args, &o)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_lines() {
        let i = parse_info("info depth 12 seldepth 18 multipv 2 score cp -35 nodes 12345 nps 99 time 120 pv e2e4 e7e5").unwrap();
        assert_eq!((i.depth, i.multipv, i.score.cp, i.time_ms, i.pv.len()), (12, 2, Some(-35), Some(120), 2));
        let m = parse_info("info depth 20 score mate -3 pv h7h8").unwrap();
        assert_eq!(m.score.mate, Some(-3));
        assert!(m.score.value() < -99_000);
        assert!(parse_info("info depth 5 score cp 10 lowerbound pv e2e4").is_none());
        assert!(parse_info("info string NNUE enabled").is_none());
        assert!(parse_info("info depth 3 currmove e2e4 currmovenumber 1").is_none());
        assert_eq!(split_args(r#"--a "b c" d"#), vec!["--a", "b c", "d"]);
        let b = Board::default();
        assert_eq!(pv_san(&b, &["e2e4".into(), "e7e5".into(), "g1f3".into(), "zz".into()]), vec!["e4", "e5", "Nf3"]);
        let mate: Board = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1".parse().unwrap();
        assert_eq!(pv_san(&mate, &["d1d8".into()]), vec!["Rd8#"]);
    }
}
