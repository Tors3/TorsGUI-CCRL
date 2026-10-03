//! Game analysis with an engine of the library: every position of a game searched for a
//! fixed time (evaluation graph, inaccuracies, mistakes and blunders, average centipawn
//! loss), and a live analysis of one position with several lines (MultiPV).

use crate::engines::EngineEntry;
use crate::uci::{self, Info, Limit, Score};
use anyhow::{bail, Result};
use cozy_chess::util::parse_uci_move;
use cozy_chess::{Board, Color, GameStatus};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GameAnalysisConfig {
    pub engine_id: i64,
    pub start_fen: String,
    /// The moves of the game (UCI).
    pub moves: Vec<String>,
    pub movetime_ms: u64,
    pub threads: u32,
    pub hash: u32,
}

/// The engine's view of one position of the game.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PositionEval {
    /// White's point of view.
    pub score: Score,
    pub best_uci: String,
    pub best_san: String,
    pub pv_san: Vec<String>,
    pub depth: u32,
}

/// The judgement of one move of the game.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct MoveJudgement {
    /// "" | "inaccuracy" | "mistake" | "blunder"
    pub tag: String,
    /// Centipawns lost by the mover (evaluations capped at ±1000).
    pub loss_cp: i32,
    /// Winning chances lost by the mover (0..2).
    pub wc_loss: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SideSummary {
    pub acpl: f64,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
    /// 0..100, from the winning chances kept move after move.
    pub accuracy: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GameAnalysis {
    pub engine: String,
    pub movetime_ms: u64,
    /// Positions 0..=moves (position 0 = before the first move); None while not searched.
    pub positions: Vec<Option<PositionEval>>,
    /// Move i leads from position i to i+1.
    pub moves: Vec<Option<MoveJudgement>>,
    pub white: SideSummary,
    pub black: SideSummary,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GameAnalysisProgress {
    pub running: bool,
    pub done: u32,
    pub total: u32,
    pub error: Option<String>,
    pub result: Option<GameAnalysis>,
}

/// Winning chances in -1..1 from White's view (the curve used by Lichess).
pub fn winning_chances(s: &Score) -> f64 {
    match (s.mate, s.cp) {
        (Some(m), _) => {
            if m > 0 {
                1.0
            } else {
                -1.0
            }
        }
        (None, Some(cp)) => 2.0 / (1.0 + (-0.00368208 * cp.clamp(-1000, 1000) as f64).exp()) - 1.0,
        _ => 0.0,
    }
}

fn capped(s: &Score) -> i32 {
    match (s.mate, s.cp) {
        (Some(m), _) => {
            if m > 0 {
                1000
            } else {
                -1000
            }
        }
        (None, Some(cp)) => cp.clamp(-1000, 1000),
        _ => 0,
    }
}

/// Judges move `i` from the evaluations before and after it (White's view).
pub fn judge(before: &PositionEval, after: &PositionEval, played_uci: &str, white_moved: bool) -> MoveJudgement {
    let sign = if white_moved { 1.0 } else { -1.0 };
    let wc_loss = ((winning_chances(&before.score) - winning_chances(&after.score)) * sign).max(0.0);
    let loss_cp = ((capped(&before.score) - capped(&after.score)) * sign as i32).max(0);
    let tag = if played_uci == before.best_uci {
        ""
    } else if wc_loss >= 0.3 {
        "blunder"
    } else if wc_loss >= 0.2 {
        "mistake"
    } else if wc_loss >= 0.1 {
        "inaccuracy"
    } else {
        ""
    };
    MoveJudgement { tag: tag.into(), loss_cp, wc_loss }
}

pub fn summarize(moves: &[Option<MoveJudgement>], white_first: bool) -> (SideSummary, SideSummary) {
    let mut sides = [SideSummary::default(), SideSummary::default()];
    let mut n = [0u32; 2];
    let mut acc = [0f64; 2];
    for (i, m) in moves.iter().enumerate() {
        let Some(m) = m else { continue };
        let side = if (i % 2 == 0) == white_first { 0 } else { 1 };
        let s = &mut sides[side];
        n[side] += 1;
        s.acpl += m.loss_cp as f64;
        match m.tag.as_str() {
            "inaccuracy" => s.inaccuracies += 1,
            "mistake" => s.mistakes += 1,
            "blunder" => s.blunders += 1,
            _ => {}
        }
        // Lichess' move accuracy from the winning percentage lost (0..100 scale)
        let lost_pct = m.wc_loss * 50.0;
        acc[side] += (103.1668 * (-0.04354 * lost_pct).exp() - 3.1669).clamp(0.0, 100.0);
    }
    for k in 0..2 {
        if n[k] > 0 {
            sides[k].acpl = (sides[k].acpl / n[k] as f64 * 10.0).round() / 10.0;
            sides[k].accuracy = (acc[k] / n[k] as f64 * 10.0).round() / 10.0;
        }
    }
    let [w, b] = sides;
    (w, b)
}

/// The positions of a game: the board before each move and after the last one.
pub fn boards(start_fen: &str, moves: &[String]) -> Result<Vec<Board>> {
    let mut b = if start_fen.trim().is_empty() { Board::default() } else { crate::chess960::parse_fen(start_fen)? };
    let mut v = vec![b.clone()];
    for (i, m) in moves.iter().enumerate() {
        let mv = parse_uci_move(&b, m).map_err(|_| anyhow::anyhow!("move {} ({m}) is not legal", i + 1))?;
        if !b.is_legal(mv) {
            bail!("move {} ({m}) is not legal", i + 1);
        }
        b.play(mv);
        v.push(b.clone());
    }
    Ok(v)
}

/// The evaluation of a finished position (mate or draw on the board), without an engine.
fn terminal(b: &Board) -> Option<PositionEval> {
    match b.status() {
        GameStatus::Won => {
            // the side to move is mated: shown as mate in 1 for the winner, White's view
            let white_mated = b.side_to_move() == Color::White;
            Some(PositionEval { score: Score { cp: None, mate: Some(if white_mated { -1 } else { 1 }) }, ..Default::default() })
        }
        GameStatus::Drawn => Some(PositionEval { score: Score { cp: Some(0), mate: None }, ..Default::default() }),
        GameStatus::Ongoing => None,
    }
}

fn eval_of(b: &Board, r: &uci::SearchResult) -> PositionEval {
    let last = r.lines.first().cloned().unwrap_or_default();
    let white = b.side_to_move() == Color::White;
    let score = if white { last.score } else { last.score.negate() };
    let best_san = parse_uci_move(b, &r.bestmove).ok().filter(|m| b.is_legal(*m)).map(|m| uci::san(b, m)).unwrap_or_default();
    PositionEval { score, best_uci: r.bestmove.clone(), best_san, pv_san: uci::pv_san(b, &last.pv).into_iter().take(8).collect(), depth: last.depth }
}

/// Analyses the game; `progress.result` grows as the positions are searched.
pub fn run_game(cfg: &GameAnalysisConfig, engine: &EngineEntry, progress: Arc<Mutex<GameAnalysisProgress>>, cancel: Arc<AtomicBool>) -> Result<GameAnalysis> {
    let bs = boards(&cfg.start_fen, &cfg.moves)?;
    let fen0 = if cfg.start_fen.trim().is_empty() { Board::default().to_string() } else { cfg.start_fen.clone() };
    let n = bs.len();
    let mut out = GameAnalysis { engine: engine.display_name.clone(), movetime_ms: cfg.movetime_ms.max(20), positions: vec![None; n], moves: vec![None; n - 1], ..Default::default() };
    {
        let mut p = progress.lock().unwrap();
        p.total = n as u32;
        p.done = 0;
        p.result = Some(out.clone());
    }
    let mut e = uci::start_entry(engine, cfg.threads, cfg.hash, &BTreeMap::new())?;
    e.new_game()?;
    for (i, b) in bs.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let ev = match terminal(b) {
            Some(t) => t,
            None => {
                let r = e.search(&fen0, &cfg.moves[..i], Limit::MoveTime(out.movetime_ms), &cancel, |_| {})?;
                eval_of(b, &r)
            }
        };
        out.positions[i] = Some(ev);
        if i > 0 {
            if let (Some(before), Some(after)) = (&out.positions[i - 1], &out.positions[i]) {
                out.moves[i - 1] = Some(judge(before, after, &cfg.moves[i - 1], bs[i - 1].side_to_move() == Color::White));
            }
        }
        let (w, bl) = summarize(&out.moves, bs[0].side_to_move() == Color::White);
        out.white = w;
        out.black = bl;
        let mut p = progress.lock().unwrap();
        p.done = i as u32 + 1;
        p.result = Some(out.clone());
    }
    e.quit();
    Ok(out)
}

// ------------------------------------------------------------------ live analysis

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LiveAnalysis {
    pub running: bool,
    pub engine_id: i64,
    pub engine: String,
    pub fen: String,
    pub multipv: u32,
    /// The best lines, first line first; scores from White's view, PVs in SAN.
    pub lines: Vec<Info>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LiveRequest {
    pub engine_id: i64,
    pub fen: String,
    pub multipv: u32,
    pub threads: u32,
    pub hash: u32,
}

/// One engine searching the position asked last, until stopped.
#[derive(Default)]
pub struct LiveAnalyzer {
    pub state: Arc<Mutex<LiveAnalysis>>,
    pending: Arc<Mutex<Option<(LiveRequest, EngineEntry)>>>,
    cancel: Arc<AtomicBool>,
    quit: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
}

impl LiveAnalyzer {
    /// Analyses `req` (the engine is restarted when it changes).
    pub fn set(&self, req: LiveRequest, engine: EngineEntry) {
        *self.pending.lock().unwrap() = Some((req, engine));
        self.cancel.store(true, Ordering::Relaxed);
        if self.alive.swap(true, Ordering::SeqCst) {
            return;
        }
        self.quit.store(false, Ordering::Relaxed);
        let (state, pending, cancel, quit, alive) = (self.state.clone(), self.pending.clone(), self.cancel.clone(), self.quit.clone(), self.alive.clone());
        std::thread::spawn(move || {
            let mut eng: Option<(uci::Engine, LiveRequest)> = None;
            while !quit.load(Ordering::Relaxed) {
                let Some((req, entry)) = pending.lock().unwrap().take() else {
                    std::thread::sleep(Duration::from_millis(30));
                    continue;
                };
                cancel.store(false, Ordering::Relaxed);
                let same = eng.as_ref().is_some_and(|(_, r)| r.engine_id == req.engine_id && r.threads == req.threads && r.hash == req.hash);
                if !same {
                    if let Some((e, _)) = eng.take() {
                        e.quit();
                    }
                    let mut extra = BTreeMap::new();
                    extra.insert("MultiPV".to_string(), req.multipv.max(1).to_string());
                    match uci::start_entry(&entry, req.threads, req.hash, &extra) {
                        Ok(e) => eng = Some((e, req.clone())),
                        Err(err) => {
                            let mut s = state.lock().unwrap();
                            s.error = Some(format!("{err:#}"));
                            s.running = false;
                            continue;
                        }
                    }
                }
                let (e, cur) = eng.as_mut().unwrap();
                if cur.multipv != req.multipv && e.send(&format!("setoption name MultiPV value {}", req.multipv.max(1))).is_ok() {
                    let _ = e.ready();
                }
                *cur = req.clone();
                let board = crate::chess960::parse_fen(&req.fen);
                {
                    let mut s = state.lock().unwrap();
                    *s = LiveAnalysis { running: true, engine_id: req.engine_id, engine: entry.display_name.clone(), fen: req.fen.clone(), multipv: req.multipv, lines: vec![], error: None };
                }
                let Ok(board) = board else {
                    state.lock().unwrap().error = Some("not a legal position".into());
                    continue;
                };
                if board.status() != GameStatus::Ongoing {
                    let mut s = state.lock().unwrap();
                    s.running = false;
                    s.error = Some(if board.status() == GameStatus::Won { "checkmate".into() } else { "draw on the board".into() });
                    continue;
                }
                let white = board.side_to_move() == Color::White;
                let st = state.clone();
                let r = e.search(&req.fen, &[], Limit::Infinite, &cancel, |i| {
                    let mut i = i.clone();
                    i.pv_san = uci::pv_san(&board, &i.pv);
                    if !white {
                        i.score = i.score.negate();
                    }
                    let mut s = st.lock().unwrap();
                    if i.multipv == 1 {
                        let d = i.depth;
                        s.lines.retain(|x| x.depth >= d);
                    }
                    s.lines.retain(|x| x.multipv != i.multipv);
                    s.lines.push(i);
                    s.lines.sort_by_key(|x| x.multipv);
                });
                if let Err(err) = r {
                    state.lock().unwrap().error = Some(format!("{err:#}"));
                    eng = None;
                }
            }
            if let Some((e, _)) = eng.take() {
                e.quit();
            }
            state.lock().unwrap().running = false;
            alive.store(false, Ordering::SeqCst);
        });
    }

    pub fn stop(&self) {
        self.quit.store(true, Ordering::Relaxed);
        self.cancel.store(true, Ordering::Relaxed);
        self.pending.lock().unwrap().take();
        self.state.lock().unwrap().running = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(cp: i32, best: &str) -> PositionEval {
        PositionEval { score: Score { cp: Some(cp), mate: None }, best_uci: best.into(), ..Default::default() }
    }

    #[test]
    fn moves_are_judged() {
        // White drops from +0.3 to -3.0: a blunder; Black's best move is never flagged
        let j = judge(&ev(30, "e2e4"), &ev(-300, ""), "a2a3", true);
        assert_eq!(j.tag, "blunder");
        assert_eq!(j.loss_cp, 330);
        assert_eq!(judge(&ev(30, "e7e5"), &ev(400, ""), "e7e5", false).tag, "");
        assert_eq!(judge(&ev(0, "x"), &ev(-60, ""), "y", true).tag, "inaccuracy");
        assert_eq!(judge(&ev(0, "x"), &ev(-120, ""), "y", true).tag, "mistake");
        // Black improving its position loses nothing
        assert_eq!(judge(&ev(100, "x"), &ev(0, ""), "y", false).loss_cp, 0);
        let mate = PositionEval { score: Score { cp: None, mate: Some(3) }, ..Default::default() };
        assert_eq!(judge(&mate, &ev(0, ""), "y", true).tag, "blunder");
        let (w, b) = summarize(&[Some(j), Some(MoveJudgement::default())], true);
        assert_eq!((w.blunders, w.acpl, b.acpl, b.accuracy), (1, 330.0, 0.0, 100.0));
        assert!(w.accuracy < 50.0);
        assert!(boards("", &["e2e4".into(), "e2e4".into()]).is_err());
        let mated = boards("", &["f2f3", "e7e5", "g2g4", "d8h4"].map(String::from)).unwrap();
        assert_eq!(terminal(mated.last().unwrap()).unwrap().score.mate, Some(-1));
    }
}
