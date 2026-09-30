//! mock-uci: a tiny UCI engine for TorsGUI's integration tests.
//!
//! Plays legal moves with configurable strength and can misbehave on purpose:
//!
//! ```text
//! mock-uci [--name N] [--strength 0..100] [--movetime MS] [--seed S]
//!          [--crash-after PLIES] [--hang-after PLIES] [--slow-start MS]
//!          [--illegal-after PLIES] [--no-syzygy] [--no-960]
//! ```
//!
//! strength 0 plays random moves, 100 always plays the greedy best capture /
//! check; evaluations are material-based so fastchess adjudication works.

use cozy_chess::util::{display_uci_move, parse_uci_move};
use cozy_chess::{Board, Color, GameStatus, Move, Piece};
use std::io::{BufRead, Write};
use std::time::Duration;

struct Cfg {
    name: String,
    strength: u32,
    movetime: u64,
    seed: u64,
    crash_after: Option<u32>,
    hang_after: Option<u32>,
    slow_start: u64,
    illegal_after: Option<u32>,
    syzygy: bool,
    /// Declares `UCI_Chess960` (default true).
    frc: bool,
}

fn parse_args() -> Cfg {
    // the copy bundled with TorsGUI for the demo tournament introduces itself as such
    let bundled = std::env::current_exe().ok().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().starts_with("torsgui-demo-engine"))).unwrap_or(false);
    let mut c = Cfg { name: if bundled { "TorsGUI Demo Engine".into() } else { "MockUCI".into() }, strength: 50, movetime: 5, seed: 1, crash_after: None, hang_after: None, slow_start: 0, illegal_after: None, syzygy: true, frc: true };
    let a: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < a.len() {
        let v = a.get(i + 1).cloned().unwrap_or_default();
        match a[i].as_str() {
            "--name" => c.name = v,
            "--strength" => c.strength = v.parse().unwrap_or(50),
            "--movetime" => c.movetime = v.parse().unwrap_or(5),
            "--seed" => c.seed = v.parse().unwrap_or(1),
            "--crash-after" => c.crash_after = v.parse().ok(),
            "--hang-after" => c.hang_after = v.parse().ok(),
            "--slow-start" => c.slow_start = v.parse().unwrap_or(0),
            "--illegal-after" => c.illegal_after = v.parse().ok(),
            "--no-960" => {
                c.frc = false;
            }
            "--no-syzygy" => {
                c.syzygy = false;
                i += 1;
                continue;
            }
            _ => {
                i += 1;
                continue;
            }
        }
        i += 2;
    }
    c
}

fn value(p: Piece) -> i32 {
    match p {
        Piece::Pawn => 100,
        Piece::Knight => 300,
        Piece::Bishop => 320,
        Piece::Rook => 500,
        Piece::Queen => 900,
        Piece::King => 0,
    }
}

fn material(b: &Board, c: Color) -> i32 {
    Piece::ALL.iter().map(|&p| b.colored_pieces(c, p).len() as i32 * value(p)).sum()
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

fn legal_moves(b: &Board) -> Vec<Move> {
    let mut v = Vec::new();
    b.generate_moves(|pm| {
        v.extend(pm);
        false
    });
    v
}

fn score_move(b: &Board, m: Move) -> i32 {
    let mut s = 0;
    if let Some(p) = b.piece_on(m.to) {
        if b.colors(b.side_to_move()).has(m.to) {
            // castling encoded as king-takes-rook
        } else {
            s += 10 * value(p) - b.piece_on(m.from).map(value).unwrap_or(0) / 10;
        }
    }
    if let Some(p) = m.promotion {
        s += value(p);
    }
    let mut nb = b.clone();
    nb.play(m);
    if nb.status() == GameStatus::Won {
        s += 100_000;
    }
    if !nb.checkers().is_empty() {
        s += 50;
    }
    s
}

fn main() {
    let mut cfg = parse_args();
    // stdin is read on its own thread so that a "hung search" still obeys quit
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for l in std::io::stdin().lock().lines() {
            match l {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let mut out = std::io::stdout();
    let mut hung = false;
    let mut chess960 = false;
    let mut board = Board::default();
    let mut searched: u32 = 0;
    let mut rng = Rng(cfg.seed.wrapping_mul(0x9E3779B97F4A7C15) | 1);
    for line in rx.iter() {
        let line = line.trim().to_string();
        if hung && line != "quit" {
            continue; // search thread stuck: nothing is answered any more
        }
        let mut parts = line.split_whitespace();
        match parts.next() {
            Some("uci") => {
                if cfg.slow_start > 0 {
                    std::thread::sleep(Duration::from_millis(cfg.slow_start));
                }
                let _ = writeln!(out, "id name {}", cfg.name);
                let _ = writeln!(out, "id author TorsGUI tests");
                let _ = writeln!(out, "option name Threads type spin default 1 min 1 max 512");
                let _ = writeln!(out, "option name Hash type spin default 16 min 1 max 65536");
                let _ = writeln!(out, "option name Ponder type check default false");
                if cfg.syzygy {
                    let _ = writeln!(out, "option name SyzygyPath type string default <empty>");
                }
                if cfg.frc {
                    let _ = writeln!(out, "option name UCI_Chess960 type check default false");
                }
                let _ = writeln!(out, "option name Strength type spin default {} min 0 max 100", cfg.strength);
                let _ = writeln!(out, "option name MoveTime type spin default {} min 1 max 5000", cfg.movetime);
                let _ = writeln!(out, "uciok");
            }
            Some("isready") => {
                let _ = writeln!(out, "readyok");
            }
            Some("ucinewgame") => board = Board::default(),
            Some("setoption") => {
                let l = line.to_lowercase();
                if cfg.frc && l.contains("name uci_chess960") {
                    chess960 = l.trim_end().ends_with("value true");
                }
                let value = || l.rsplit_once(" value ").and_then(|(_, v)| v.trim().parse::<u64>().ok());
                if l.contains("name strength ") {
                    if let Some(v) = value() {
                        cfg.strength = v.min(100) as u32;
                    }
                } else if l.contains("name movetime ") {
                    if let Some(v) = value() {
                        cfg.movetime = v.clamp(1, 5000);
                    }
                }
            }
            Some("position") => {
                let rest: Vec<&str> = parts.collect();
                let (mut b, moves_at) = if rest.first() == Some(&"startpos") {
                    (Board::default(), rest.iter().position(|x| *x == "moves"))
                } else if rest.first() == Some(&"fen") {
                    let mi = rest.iter().position(|x| *x == "moves");
                    let fen = rest[1..mi.unwrap_or(rest.len())].join(" ");
                    (parse_fen(&fen).unwrap_or_default(), mi)
                } else {
                    (Board::default(), None)
                };
                if let Some(i) = moves_at {
                    for m in &rest[i + 1..] {
                        match parse_uci_move(&b, m) {
                            Ok(mv) => {
                                if b.try_play(mv).is_err() {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                board = b;
            }
            Some("go") => {
                searched += 1;
                if cfg.crash_after.map(|n| searched > n).unwrap_or(false) {
                    std::process::exit(3);
                }
                if cfg.hang_after.map(|n| searched > n).unwrap_or(false) {
                    hung = true;
                    continue;
                }
                std::thread::sleep(Duration::from_millis(cfg.movetime));
                let moves = legal_moves(&board);
                if moves.is_empty() {
                    let _ = writeln!(out, "bestmove 0000");
                    let _ = out.flush();
                    continue;
                }
                if cfg.illegal_after.map(|n| searched > n).unwrap_or(false) {
                    let _ = writeln!(out, "bestmove a1a1");
                    let _ = out.flush();
                    continue;
                }
                let greedy = (rng.next() % 100) < cfg.strength as u64;
                let mv = if greedy {
                    let mut best = moves[0];
                    let mut bs = i32::MIN;
                    for &m in &moves {
                        let s = score_move(&board, m) * 16 + (rng.next() % 16) as i32;
                        if s > bs {
                            bs = s;
                            best = m;
                        }
                    }
                    best
                } else {
                    moves[(rng.next() % moves.len() as u64) as usize]
                };
                let mut nb = board.clone();
                nb.play(mv);
                let me = board.side_to_move();
                let eval = material(&nb, me) - material(&nb, !me);
                let nodes = 1000 + rng.next() % 5000;
                let _ = writeln!(
                    out,
                    "info depth {} seldepth {} score cp {} nodes {} nps {} time {} pv {}",
                    1 + cfg.strength / 10,
                    3 + cfg.strength / 10,
                    eval,
                    nodes,
                    nodes * 1000 / cfg.movetime.max(1),
                    cfg.movetime,
                    uci(&board, mv, chess960)
                );
                let _ = writeln!(out, "bestmove {}", uci(&board, mv, chess960));
            }
            Some("quit") => break,
            _ => {}
        }
        let _ = out.flush();
    }
}

/// UCI move text: king-takes-rook castling in Chess960 mode, e1g1 otherwise.
fn uci(board: &Board, mv: Move, chess960: bool) -> String {
    if chess960 { mv.to_string() } else { display_uci_move(board, mv).to_string() }
}

/// FEN with any castling notation (KQkq, X-FEN or Shredder-FEN), as sent by fastchess.
fn parse_fen(fen: &str) -> Option<Board> {
    use cozy_chess::{File, Rank, Square};
    let f: Vec<&str> = fen.split_whitespace().collect();
    if f.len() < 4 {
        return None;
    }
    let placement = Board::from_fen(&format!("{} {} - - 0 1", f[0], f[1]), true).ok()?;
    let mut castling = String::new();
    for c in f[2].chars().filter(|&c| c != '-') {
        let color = if c.is_ascii_uppercase() { Color::White } else { Color::Black };
        let rank = Rank::First.relative_to(color);
        let king = placement.king(color).file();
        let rooks = placement.colored_pieces(color, Piece::Rook);
        let files = File::ALL.into_iter().filter(|&x| rooks.has(Square::new(x, rank)));
        let file = match c.to_ascii_lowercase() {
            'k' => files.filter(|&x| x > king).last(),
            'q' => files.filter(|&x| x < king).next(),
            x @ 'a'..='h' => Some(File::index((x as u8 - b'a') as usize)),
            _ => None,
        }?;
        let ch = char::from(b'a' + file as u8);
        castling.push(if color == Color::White { ch.to_ascii_uppercase() } else { ch });
    }
    if castling.is_empty() {
        castling.push('-');
    }
    let tail = if f.len() >= 6 { f[3..6].join(" ") } else { format!("{} 0 1", f[3]) };
    Board::from_fen(&format!("{} {} {} {}", f[0], f[1], castling, tail), true).ok()
}
