//! Live view: incremental tail of the fastchess engine log of a running game
//! (`-log ... engine=true`). Only appended bytes are read (never re-reads
//! big files); the board comes from the last `position ... moves` sent.

use cozy_chess::util::{display_san_move, parse_san_move, parse_uci_move};
use cozy_chess::Board;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EngineLive {
    pub name: String,
    pub depth: Option<u32>,
    pub seldepth: Option<u32>,
    /// centipawns from the engine's point of view
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
    #[ts(type = "number | null")]
    pub nodes: Option<u64>,
    #[ts(type = "number | null")]
    pub nps: Option<u64>,
    pub pv: Vec<String>,
    pub pv_san: Vec<String>,
    pub time_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EvalPoint {
    pub ply: u32,
    /// White's point of view, centipawns (mates clamped to ±2000)
    pub cp: i32,
    pub engine: String,
    pub time_ms: u64,
    pub depth: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LiveGame {
    pub white: String,
    pub black: String,
    pub fen: String,
    pub start_fen: String,
    pub moves_uci: Vec<String>,
    pub moves_san: Vec<String>,
    pub last_move: Option<String>,
    pub side_to_move: String,
    /// clocks in ms at the last `go`
    #[ts(type = "number | null")]
    pub wtime: Option<u64>,
    #[ts(type = "number | null")]
    pub btime: Option<u64>,
    pub thinking: Option<String>,
    pub engines: Vec<EngineLive>,
    pub evals: Vec<EvalPoint>,
    pub log_bytes: u64,
}

pub struct LiveTracker {
    path: PathBuf,
    offset: u64,
    partial: String,
    game: LiveGame,
    engines: HashMap<String, EngineLive>,
    go_at: HashMap<String, f64>,
    last_position: String,
}

fn ts_seconds(line: &str) -> Option<f64> {
    // "[Engine] [12:34:18.182025] <...>"
    let s = line.split('[').nth(2)?.split(']').next()?;
    let p: Vec<&str> = s.split(':').collect();
    if p.len() != 3 {
        return None;
    }
    Some(p[0].parse::<f64>().ok()? * 3600.0 + p[1].parse::<f64>().ok()? * 60.0 + p[2].parse::<f64>().ok()?)
}

/// (engine name, direction, payload) of an `[Engine]` log line.
pub fn split_engine_line(line: &str) -> Option<(String, bool, String)> {
    if !line.starts_with("[Engine]") {
        return None;
    }
    let after = line.split_once("> ")?.1;
    if let Some((n, rest)) = after.split_once(" <--- ") {
        return Some((n.trim().to_string(), true, rest.trim().to_string()));
    }
    if let Some((n, rest)) = after.split_once(" ---> ") {
        return Some((n.trim().to_string(), false, rest.trim().to_string()));
    }
    None
}

fn parse_info(e: &mut EngineLive, s: &str) {
    let t: Vec<&str> = s.split_whitespace().collect();
    let mut i = 1;
    let mut newpv = None;
    while i < t.len() {
        let v = t.get(i + 1).copied().unwrap_or("");
        match t[i] {
            "depth" => e.depth = v.parse().ok(),
            "seldepth" => e.seldepth = v.parse().ok(),
            "nodes" => e.nodes = v.parse().ok(),
            "nps" => e.nps = v.parse().ok(),
            "time" => e.time_ms = v.parse().ok(),
            "score" => {
                let val = t.get(i + 2).and_then(|x| x.parse::<i32>().ok());
                if v == "cp" {
                    e.score_cp = val;
                    e.mate = None;
                } else if v == "mate" {
                    e.mate = val;
                    e.score_cp = None;
                }
                i += 1;
            }
            "pv" => {
                newpv = Some(t[i + 1..].iter().map(|s| s.to_string()).collect::<Vec<_>>());
                break;
            }
            _ => {
                i += 1;
                continue;
            }
        }
        i += 2;
    }
    if let Some(pv) = newpv {
        e.pv = pv;
    }
}

fn board_after(start: &Board, moves: &[String]) -> (Board, Vec<String>) {
    let mut b = start.clone();
    let mut sans = Vec::new();
    for m in moves {
        match parse_uci_move(&b, m) {
            Ok(mv) if b.is_legal(mv) => {
                sans.push(display_san_move(&b, mv).to_string());
                if b.try_play(mv).is_err() {
                    break;
                }
            }
            _ => break,
        }
    }
    (b, sans)
}

fn pv_to_san(b: &Board, pv: &[String]) -> Vec<String> {
    let mut b = b.clone();
    let mut out = Vec::new();
    for m in pv.iter().take(12) {
        match parse_uci_move(&b, m) {
            Ok(mv) if b.is_legal(mv) => {
                out.push(display_san_move(&b, mv).to_string());
                if b.try_play(mv).is_err() {
                    break;
                }
            }
            _ => break,
        }
    }
    out
}

impl LiveTracker {
    pub fn new(path: &Path, white: &str, black: &str) -> Self {
        let game = LiveGame { white: white.into(), black: black.into(), fen: Board::default().to_string(), start_fen: Board::default().to_string(), side_to_move: "white".into(), ..Default::default() };
        LiveTracker { path: path.into(), offset: 0, partial: String::new(), game, engines: HashMap::new(), go_at: HashMap::new(), last_position: String::new() }
    }

    pub fn update(&mut self) -> &LiveGame {
        let Ok(mut f) = std::fs::File::open(&self.path) else { return &self.game };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            self.offset = 0;
            self.partial.clear();
        }
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return &self.game;
        }
        let mut buf = Vec::new();
        let _ = f.read_to_end(&mut buf);
        self.offset += buf.len() as u64;
        self.partial.push_str(&String::from_utf8_lossy(&buf));
        let text = std::mem::take(&mut self.partial);
        let mut lines: Vec<&str> = text.split('\n').collect();
        let rest = lines.pop().unwrap_or("").to_string();
        let owned: Vec<String> = lines.iter().map(|s| s.trim_end_matches('\r').to_string()).collect();
        for l in &owned {
            self.line(l);
        }
        self.partial = rest;
        self.game.log_bytes = self.offset;
        self.finish()
    }

    fn line(&mut self, l: &str) {
        let Some((name, to_engine, payload)) = split_engine_line(l) else { return };
        let ts = ts_seconds(l);
        if to_engine {
            if payload.starts_with("position ") {
                self.last_position = payload.clone();
                self.game.thinking = Some(name.clone());
            } else if payload.starts_with("go ") {
                let t: Vec<&str> = payload.split_whitespace().collect();
                let get = |k: &str| t.iter().position(|x| *x == k).and_then(|i| t.get(i + 1)).and_then(|v| v.parse::<i64>().ok()).map(|x| x.max(0) as u64);
                self.game.wtime = get("wtime");
                self.game.btime = get("btime");
                if let Some(ts) = ts {
                    self.go_at.insert(name.clone(), ts);
                }
                self.game.thinking = Some(name.clone());
                self.engines.entry(name.clone()).or_insert_with(|| EngineLive { name: name.clone(), ..Default::default() });
            } else if payload == "ucinewgame" {
                self.game.evals.clear();
            }
        } else if payload.starts_with("info ") {
            let e = self.engines.entry(name.clone()).or_insert_with(|| EngineLive { name: name.clone(), ..Default::default() });
            parse_info(e, &payload);
        } else if payload.starts_with("bestmove") {
            let spent = match (ts, self.go_at.get(&name)) {
                (Some(a), Some(b)) if a >= *b => ((a - b) * 1000.0) as u64,
                _ => 0,
            };
            let ply = self.position_moves().len() as u32 + 1;
            let e = self.engines.get(&name).cloned().unwrap_or_default();
            let white_to_move = (ply % 2 == 1) == self.start_white();
            let cp = match (e.score_cp, e.mate) {
                (Some(c), _) => c,
                (None, Some(m)) => if m > 0 { 2000 } else { -2000 },
                _ => 0,
            };
            let cp = if white_to_move { cp } else { -cp };
            self.game.evals.push(EvalPoint { ply, cp, engine: name.clone(), time_ms: spent, depth: e.depth });
            self.game.thinking = None;
        }
    }

    fn start_white(&self) -> bool {
        !self.start_board().to_string().contains(" b ")
    }

    fn start_board(&self) -> Board {
        let p = &self.last_position;
        if let Some(rest) = p.strip_prefix("position fen ") {
            let fen = rest.split(" moves").next().unwrap_or("");
            crate::chess960::parse_fen(fen.trim()).unwrap_or_default()
        } else {
            Board::default()
        }
    }

    fn position_moves(&self) -> Vec<String> {
        self.last_position.split_once(" moves ").map(|(_, m)| m.split_whitespace().map(|s| s.to_string()).collect()).unwrap_or_default()
    }

    fn finish(&mut self) -> &LiveGame {
        let start = self.start_board();
        let moves = self.position_moves();
        let (b, sans) = board_after(&start, &moves);
        self.game.start_fen = start.to_string();
        self.game.fen = b.to_string();
        self.game.moves_uci = moves.clone();
        self.game.moves_san = sans;
        self.game.last_move = moves.last().cloned();
        self.game.side_to_move = if b.side_to_move() == cozy_chess::Color::White { "white".into() } else { "black".into() };
        let mut es: Vec<EngineLive> = self.engines.values().cloned().collect();
        for e in es.iter_mut() {
            e.pv_san = pv_to_san(&b, &e.pv);
        }
        es.sort_by_key(|e| if e.name == self.game.white { 0 } else { 1 });
        self.game.engines = es;
        &self.game
    }
}

// ------------------------------------------------------------------ PGN viewer

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ViewerPly {
    pub san: String,
    pub uci: String,
    pub fen: String,
    pub info: crate::pgn::MoveInfo,
    /// White's point of view, centipawns (None for book moves)
    pub eval_cp: Option<i32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ViewerGame {
    pub headers: Vec<(String, String)>,
    pub start_fen: String,
    pub plies: Vec<ViewerPly>,
    pub result: String,
    pub error: Option<String>,
}

/// Replays the SAN moves of a game (fastchess comments -> engine info).
pub fn viewer_game(g: &crate::pgn::Game) -> ViewerGame {
    // Chess960 FENs use X-FEN or Shredder castling: parse every notation
    let start = g.headers.get("FEN").and_then(|f| crate::chess960::parse_fen(f).ok()).unwrap_or_default();
    let mut b = start.clone();
    let mut plies = Vec::new();
    let mut error = None;
    for (i, m) in crate::pgn::parse_movetext(&g.movetext).into_iter().enumerate() {
        let san = m.san.trim_end_matches(['!', '?']).to_string();
        match parse_san_move(&b, &san) {
            Ok(mv) if b.is_legal(mv) => {
                let uci = cozy_chess::util::display_uci_move(&b, mv).to_string();
                let white_moved = b.side_to_move() == cozy_chess::Color::White;
                b.play(mv);
                let eval_cp = if m.info.book {
                    None
                } else {
                    let v = m.info.eval.map(|e| (e * 100.0).round() as i32).or(m.info.mate.map(|x| if x > 0 { 2000 } else { -2000 }));
                    v.map(|v| if white_moved { v } else { -v })
                };
                plies.push(ViewerPly { san: m.san, uci, fen: b.to_string(), info: m.info, eval_cp });
            }
            _ => {
                error = Some(format!("cannot replay move {} ({})", i + 1, m.san));
                break;
            }
        }
    }
    ViewerGame { headers: g.headers.0.clone(), start_fen: start.to_string(), plies, result: g.result().to_string(), error }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tail_engine_log() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("g.log");
        let lines = [
            "[Engine] [12:34:18.182025] <     140578589243072>  SF B <--- position startpos moves d2d4 d7d5 c2c4 e7e6",
            "[Engine] [12:34:18.182142] <     140578589243072>  SF B <--- go wtime 2020 btime 2020 winc 20 binc 20",
            "[Engine] [12:34:18.809385] <     140578589243072>  SF B ---> info depth 10 seldepth 12 multipv 1 score cp 67 nodes 6330 nps 1266000 tbhits 0 time 5 pv g1f3 b8a6",
            "[Engine] [12:34:18.918174] <     140578589243072>  SF B ---> bestmove g1f3 ponder g8f6",
            "[Engine] [12:34:18.918579] <     140578589243072>  SF A <--- position startpos moves d2d4 d7d5 c2c4 e7e6 g1f3",
            "[Engine] [12:34:18.918677] <     140578589243072>  SF A <--- go wtime 1904 btime 2020 winc 20 binc 20",
            "[Engine] [12:34:18.93] <     140578589243072>  SF A ---> info depth 3 score mate -2 nodes 10 pv g8f6",
        ];
        std::fs::write(&p, lines[..3].join("\n") + "\n").unwrap();
        let mut t = LiveTracker::new(&p, "SF B", "SF A");
        let g = t.update().clone();
        assert_eq!(g.moves_san, vec!["d4", "d5", "c4", "e6"]);
        assert_eq!(g.engines[0].score_cp, Some(67));
        assert_eq!(g.engines[0].pv_san, vec!["Nf3", "Na6"]);
        assert_eq!(g.wtime, Some(2020));
        // append the rest: only new bytes are read
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        use std::io::Write;
        f.write_all((lines[3..].join("\n") + "\n").as_bytes()).unwrap();
        let g = t.update().clone();
        assert_eq!(g.side_to_move, "black");
        assert_eq!(g.last_move.as_deref(), Some("g1f3"));
        assert_eq!(g.evals.len(), 1);
        assert_eq!(g.evals[0].cp, 67);
        assert!(g.evals[0].time_ms >= 700);
        assert_eq!(g.thinking.as_deref(), Some("SF A"));
        assert_eq!(g.engines.iter().find(|e| e.name == "SF A").unwrap().mate, Some(-2));
    }
    #[test]
    fn viewer() {
        let text = "[Event \"x\"]\n[Result \"1-0\"]\n\n1. e4 {book} e5 {book} 2. Nf3 {+0.30/20 1.0s, tl=10s, n=1, sd=2, nps=3} Nc6 {+0.10/18 1s, tl=9s, n=1, sd=2, nps=3} 1-0\n\n";
        let g = &crate::pgn::parse_games(text, Path::new("x"))[0];
        let v = viewer_game(g);
        assert!(v.error.is_none());
        assert_eq!(v.plies.len(), 4);
        assert_eq!(v.plies[2].eval_cp, Some(30));
        assert_eq!(v.plies[3].eval_cp, Some(-10));
        assert_eq!(v.plies[3].uci, "b8c6");
    }
}
