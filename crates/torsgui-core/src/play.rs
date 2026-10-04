//! A game between a person and an engine of the library: legal moves for the board, clocks,
//! the engine's replies, take-backs, resignation and every way a game ends.

use crate::engines::EngineEntry;
use crate::uci::{self, Info, Limit};
use anyhow::{bail, Context, Result};
use cozy_chess::util::{display_uci_move, parse_uci_move};
use cozy_chess::{Board, Color, GameStatus, Piece};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PlayConfig {
    pub engine_id: i64,
    /// The person plays White.
    pub human_white: bool,
    /// Clock: base and increment (ms). A base of 0 = the engine thinks `movetime_ms` per move
    /// and the person has no clock.
    pub base_ms: u64,
    pub inc_ms: u64,
    pub movetime_ms: u64,
    /// Empty = the standard start position.
    #[serde(default)]
    pub start_fen: String,
    pub threads: u32,
    pub hash: u32,
    /// Extra UCI options (UCI_LimitStrength / UCI_Elo, Skill Level…).
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default)]
    pub player_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PlayState {
    pub active: bool,
    pub engine: String,
    pub player: String,
    pub human_white: bool,
    pub start_fen: String,
    pub fen: String,
    pub moves: Vec<String>,
    pub sans: Vec<String>,
    pub last_move: Option<String>,
    pub check: bool,
    pub human_to_move: bool,
    /// Legal moves of the person: from square -> target squares.
    pub legal: BTreeMap<String, Vec<String>>,
    /// "e7e8" style pairs that promote (the board asks for the piece).
    pub promotions: Vec<String>,
    pub thinking: bool,
    /// The engine's last search line, score from White's view, PV in SAN.
    pub info: Option<Info>,
    /// Remaining time (ms) when there is a clock.
    pub white_ms: Option<i64>,
    pub black_ms: Option<i64>,
    pub base_ms: u64,
    pub inc_ms: u64,
    pub movetime_ms: u64,
    /// "*" while playing, else 1-0 / 0-1 / 1/2-1/2.
    pub result: String,
    pub termination: String,
    pub error: Option<String>,
}

struct Game {
    st: PlayState,
    history: Vec<Board>,
    turn_started: Instant,
    engine: Arc<Mutex<uci::Engine>>,
    cancel: Arc<AtomicBool>,
    generation: u64,
}

#[derive(Default)]
pub struct Play {
    game: Arc<Mutex<Option<Game>>>,
}

fn color_name(white: bool) -> &'static str {
    if white {
        "White"
    } else {
        "Black"
    }
}

/// How a position ends the game, if it does: (result, termination).
pub fn game_end(b: &Board, history: &[Board]) -> Option<(String, String)> {
    let white_to_move = b.side_to_move() == Color::White;
    match b.status() {
        GameStatus::Won => {
            return Some((if white_to_move { "0-1" } else { "1-0" }.into(), format!("{} is checkmated", color_name(white_to_move))));
        }
        GameStatus::Drawn => {
            let mut any = false;
            b.generate_moves(|_| {
                any = true;
                true
            });
            return Some(("1/2-1/2".into(), if any { "fifty-move rule".into() } else { "stalemate".into() }));
        }
        GameStatus::Ongoing => {}
    }
    if history.iter().filter(|h| h.same_position(b)).count() >= 3 {
        return Some(("1/2-1/2".into(), "threefold repetition".into()));
    }
    // kings alone, or a king and one minor piece against a king
    let heavy = b.pieces(Piece::Pawn) | b.pieces(Piece::Rook) | b.pieces(Piece::Queen);
    let minors = (b.pieces(Piece::Knight) | b.pieces(Piece::Bishop)).len();
    if heavy.is_empty() && minors <= 1 {
        return Some(("1/2-1/2".into(), "insufficient material".into()));
    }
    None
}

fn legal_map(b: &Board) -> (BTreeMap<String, Vec<String>>, Vec<String>) {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut promos = Vec::new();
    b.generate_moves(|mvs| {
        for mv in mvs {
            let u = display_uci_move(b, mv).to_string();
            let (from, to) = (u[0..2].to_string(), u[2..4].to_string());
            if u.len() > 4 {
                let pair = format!("{from}{to}");
                if !promos.contains(&pair) {
                    promos.push(pair);
                }
            }
            let v = map.entry(from).or_default();
            if !v.contains(&to) {
                v.push(to);
            }
        }
        false
    });
    (map, promos)
}

impl Game {
    fn board(&self) -> &Board {
        self.history.last().expect("a position")
    }

    /// Refreshes everything derived from the position; ends the game when it is over.
    fn refresh(&mut self) {
        let b = self.board().clone();
        self.st.fen = b.to_string();
        self.st.check = !b.checkers().is_empty();
        let white_to_move = b.side_to_move() == Color::White;
        self.st.human_to_move = self.st.active && white_to_move == self.st.human_white;
        if let Some((r, t)) = game_end(&b, &self.history) {
            self.finish(&r, &t);
        }
        if self.st.human_to_move {
            let (l, p) = legal_map(&b);
            self.st.legal = l;
            self.st.promotions = p;
        } else {
            self.st.legal.clear();
            self.st.promotions.clear();
        }
    }

    fn finish(&mut self, result: &str, termination: &str) {
        self.st.active = false;
        self.st.human_to_move = false;
        self.st.thinking = false;
        self.st.result = result.into();
        self.st.termination = termination.into();
        self.st.legal.clear();
        self.cancel.store(true, Ordering::Relaxed);
        self.generation += 1;
    }

    fn clock_of(&mut self, white: bool) -> Option<&mut i64> {
        if white {
            self.st.white_ms.as_mut()
        } else {
            self.st.black_ms.as_mut()
        }
    }

    /// Plays a move (already checked) and charges the clock of the side that moved.
    fn push(&mut self, mv: cozy_chess::Move, elapsed_ms: i64) {
        let b = self.board().clone();
        let white = b.side_to_move() == Color::White;
        let inc = self.st.inc_ms as i64;
        let flagged = match self.clock_of(white) {
            Some(c) => {
                *c -= elapsed_ms;
                let out = *c <= 0;
                if !out {
                    *c += inc;
                }
                out
            }
            None => false,
        };
        if flagged {
            let r = if white { "0-1" } else { "1-0" };
            self.finish(r, &format!("{} lost on time", color_name(white)));
            return;
        }
        self.st.sans.push(uci::san(&b, mv));
        let u = display_uci_move(&b, mv).to_string();
        self.st.moves.push(u.clone());
        self.st.last_move = Some(u);
        let mut nb = b;
        nb.play(mv);
        self.history.push(nb);
        self.turn_started = Instant::now();
        self.refresh();
    }
}

impl Play {
    pub fn start(&self, cfg: PlayConfig, entry: &EngineEntry) -> Result<()> {
        self.stop();
        let start = if cfg.start_fen.trim().is_empty() { Board::default() } else { cfg.start_fen.trim().parse::<Board>().map_err(|e| anyhow::anyhow!("FEN: {e:?}"))? };
        if game_end(&start, std::slice::from_ref(&start)).is_some() || start.status() != GameStatus::Ongoing {
            bail!("the game is already over in that position");
        }
        let mut e = uci::start_entry(entry, cfg.threads, cfg.hash, &cfg.options).with_context(|| format!("starting {}", entry.display_name))?;
        e.new_game()?;
        let clock = (cfg.base_ms > 0).then_some(cfg.base_ms as i64);
        let st = PlayState {
            active: true,
            engine: entry.display_name.clone(),
            player: if cfg.player_name.trim().is_empty() { "Human".into() } else { cfg.player_name.trim().into() },
            human_white: cfg.human_white,
            start_fen: start.to_string(),
            white_ms: clock,
            black_ms: clock,
            base_ms: cfg.base_ms,
            inc_ms: cfg.inc_ms,
            movetime_ms: if cfg.base_ms > 0 { 0 } else { cfg.movetime_ms.max(50) },
            result: "*".into(),
            ..Default::default()
        };
        let mut g = Game { st, history: vec![start], turn_started: Instant::now(), engine: Arc::new(Mutex::new(e)), cancel: Arc::new(AtomicBool::new(false)), generation: 1 };
        g.refresh();
        let engine_first = !g.st.human_to_move;
        *self.game.lock().unwrap() = Some(g);
        if engine_first {
            self.engine_turn();
        }
        Ok(())
    }

    /// The engine searches the current position in a thread and plays its move.
    fn engine_turn(&self) {
        let shared = self.game.clone();
        let (fen0, moves, limit, engine, cancel, generation, white) = {
            let mut lock = shared.lock().unwrap();
            let Some(g) = lock.as_mut() else { return };
            if !g.st.active || g.st.human_to_move {
                return;
            }
            g.st.thinking = true;
            g.st.info = None;
            g.cancel = Arc::new(AtomicBool::new(false));
            let limit = match (g.st.white_ms, g.st.black_ms) {
                (Some(w), Some(b)) => Limit::Clock { wtime: w.max(1) as u64, btime: b.max(1) as u64, winc: g.st.inc_ms, binc: g.st.inc_ms },
                _ => Limit::MoveTime(g.st.movetime_ms),
            };
            let white = g.board().side_to_move() == Color::White;
            (g.st.start_fen.clone(), g.st.moves.clone(), limit, g.engine.clone(), g.cancel.clone(), g.generation, white)
        };
        std::thread::spawn(move || {
            let board = shared.lock().unwrap().as_ref().map(|g| g.board().clone()).unwrap_or_default();
            let t0 = Instant::now();
            let r = {
                let mut e = engine.lock().unwrap();
                e.search(&fen0, &moves, limit, &cancel, |i| {
                    let mut i = i.clone();
                    if i.multipv != 1 {
                        return;
                    }
                    i.pv_san = uci::pv_san(&board, &i.pv);
                    if !white {
                        i.score = i.score.negate();
                    }
                    if let Some(g) = shared.lock().unwrap().as_mut() {
                        if g.generation == generation {
                            g.st.info = Some(i);
                        }
                    }
                })
            };
            let elapsed = t0.elapsed().as_millis() as i64;
            let mut lock = shared.lock().unwrap();
            let Some(g) = lock.as_mut() else { return };
            if g.generation != generation || !g.st.active {
                return;
            }
            g.st.thinking = false;
            match r {
                Ok(s) => match parse_uci_move(g.board(), &s.bestmove).ok().filter(|m| g.board().is_legal(*m)) {
                    Some(mv) => g.push(mv, elapsed),
                    None => {
                        let who = !g.st.human_white;
                        g.st.error = Some(format!("the engine played an illegal move ({})", s.bestmove));
                        g.finish(if who { "0-1" } else { "1-0" }, "illegal move by the engine");
                    }
                },
                Err(e) => {
                    g.st.error = Some(format!("{e:#}"));
                    let who = !g.st.human_white;
                    g.finish(if who { "0-1" } else { "1-0" }, "the engine stopped");
                }
            }
        });
    }

    /// The current state, with the running clock and a person out of time.
    pub fn state(&self) -> PlayState {
        let mut lock = self.game.lock().unwrap();
        let Some(g) = lock.as_mut() else { return PlayState { result: "*".into(), ..Default::default() } };
        let mut st = g.st.clone();
        if g.st.active && g.st.white_ms.is_some() {
            let elapsed = g.turn_started.elapsed().as_millis() as i64;
            let white = g.board().side_to_move() == Color::White;
            let left = (if white { g.st.white_ms } else { g.st.black_ms }).unwrap_or(0) - elapsed;
            if g.st.human_to_move && left <= 0 {
                let r = if white { "0-1" } else { "1-0" };
                if white {
                    g.st.white_ms = Some(0);
                } else {
                    g.st.black_ms = Some(0);
                }
                g.finish(r, &format!("{} lost on time", color_name(white)));
                return g.st.clone();
            }
            if white {
                st.white_ms = Some(left.max(0));
            } else {
                st.black_ms = Some(left.max(0));
            }
        }
        st
    }

    pub fn human_move(&self, u: &str) -> Result<()> {
        {
            let mut lock = self.game.lock().unwrap();
            let g = lock.as_mut().context("no game")?;
            if !g.st.human_to_move {
                bail!("it is not your move");
            }
            let mv = parse_uci_move(g.board(), u).ok().filter(|m| g.board().is_legal(*m)).with_context(|| format!("illegal move {u}"))?;
            let elapsed = g.turn_started.elapsed().as_millis() as i64;
            g.push(mv, elapsed);
        }
        self.engine_turn();
        Ok(())
    }

    /// Takes back the person's last move (and the engine's reply).
    pub fn undo(&self) -> Result<()> {
        let engine_next = {
            let mut lock = self.game.lock().unwrap();
            let g = lock.as_mut().context("no game")?;
            g.cancel.store(true, Ordering::Relaxed);
            g.generation += 1;
            g.st.thinking = false;
            g.st.info = None;
            let human_white = g.st.human_white;
            // back to the last position where the person was to move, before their move
            let mut n = 0;
            loop {
                if g.history.len() <= 1 {
                    break;
                }
                g.history.pop();
                g.st.moves.pop();
                g.st.sans.pop();
                n += 1;
                let white = g.board().side_to_move() == Color::White;
                if white == human_white {
                    break;
                }
            }
            if n == 0 {
                bail!("nothing to take back");
            }
            g.st.last_move = g.st.moves.last().cloned();
            g.st.active = true;
            g.st.result = "*".into();
            g.st.termination.clear();
            g.st.error = None;
            g.turn_started = Instant::now();
            g.refresh();
            !g.st.human_to_move
        };
        if engine_next {
            self.engine_turn();
        }
        Ok(())
    }

    pub fn resign(&self) -> Result<()> {
        let mut lock = self.game.lock().unwrap();
        let g = lock.as_mut().context("no game")?;
        if !g.st.active {
            bail!("the game is over");
        }
        let human_white = g.st.human_white;
        g.finish(if human_white { "0-1" } else { "1-0" }, &format!("{} resigns", color_name(human_white)));
        Ok(())
    }

    /// Ends the session and the engine.
    pub fn stop(&self) {
        if let Some(mut g) = self.game.lock().unwrap().take() {
            g.cancel.store(true, Ordering::Relaxed);
            g.generation += 1;
        }
    }

    /// The game as PGN.
    pub fn pgn(&self, site: &str) -> Result<String> {
        let lock = self.game.lock().unwrap();
        let g = lock.as_ref().context("no game")?;
        let st = &g.st;
        let (white, black) = if st.human_white { (st.player.clone(), st.engine.clone()) } else { (st.engine.clone(), st.player.clone()) };
        let tc = if st.base_ms > 0 { format!("{}+{}", st.base_ms / 1000, st.inc_ms as f64 / 1000.0) } else { format!("{}s per move (engine)", st.movetime_ms as f64 / 1000.0) };
        let mut h = vec![
            ("Event", "TorsGUI game".to_string()),
            ("Site", if site.is_empty() { "?".into() } else { site.to_string() }),
            ("Date", chrono::Local::now().format("%Y.%m.%d").to_string()),
            ("Round", "-".into()),
            ("White", white),
            ("Black", black),
            ("Result", st.result.clone()),
            ("TimeControl", tc),
        ];
        if st.start_fen != Board::default().to_string() {
            h.push(("FEN", st.start_fen.clone()));
            h.push(("SetUp", "1".into()));
        }
        if !st.termination.is_empty() {
            h.push(("Termination", st.termination.clone()));
        }
        let mut out: String = h.iter().map(|(k, v)| format!("[{k} \"{}\"]\n", v.replace('"', "'"))).collect();
        out.push('\n');
        let start = g.history.first().cloned().unwrap_or_default();
        let mut white_to_move = start.side_to_move() == Color::White;
        let mut no = start.fullmove_number();
        let mut line = String::new();
        for (i, san) in st.sans.iter().enumerate() {
            let tok = if white_to_move {
                format!("{no}. {san}")
            } else if i == 0 {
                format!("{no}... {san}")
            } else {
                san.clone()
            };
            if !white_to_move {
                no += 1;
            }
            white_to_move = !white_to_move;
            if line.len() + tok.len() + 1 > 80 {
                out.push_str(line.trim_end());
                out.push('\n');
                line.clear();
            }
            line.push_str(&tok);
            line.push(' ');
        }
        line.push_str(&st.result);
        out.push_str(&line);
        out.push('\n');
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(fen: &str) -> Board {
        fen.parse().unwrap()
    }

    #[test]
    fn ends_of_games() {
        let mate = b("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1");
        let mut after = mate.clone();
        after.play(parse_uci_move(&mate, "d1d8").unwrap());
        assert_eq!(game_end(&after, &[]).unwrap(), ("1-0".to_string(), "Black is checkmated".to_string()));
        let stalemate = b("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
        assert_eq!(game_end(&stalemate, &[]).unwrap().1, "stalemate");
        assert_eq!(game_end(&b("8/8/4k3/8/8/3NK3/8/8 w - - 0 1"), &[]).unwrap().1, "insufficient material");
        assert!(game_end(&b("8/8/4k3/8/8/3RK3/8/8 w - - 0 1"), &[]).is_none());
        assert_eq!(game_end(&b("8/8/4k3/8/8/3RK3/8/8 w - - 100 80"), &[]).unwrap().1, "fifty-move rule");
        let s = Board::default();
        assert_eq!(game_end(&s, &[s.clone(), s.clone(), s.clone()]).unwrap().1, "threefold repetition");
        let (legal, promos) = legal_map(&b("8/4P1k1/8/8/8/8/8/4K2R w K - 0 1"));
        assert!(legal["e1"].contains(&"g1".to_string()), "castling in standard notation: {legal:?}");
        assert_eq!(promos, vec!["e7e8".to_string()]);
    }
}
