//! Chess960 (Fischer Random) helpers: start positions by Scharnagl number, opening books of
//! start positions (all 960, a random subset, or double Chess960), and FEN parsing that
//! accepts every castling notation found in practice (KQkq, X-FEN, Shredder-FEN).

use anyhow::{Context, Result, bail};
use cozy_chess::{Board, Color, File, Piece, Rank, Square};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The standard start position is Chess960 position 518.
pub const STANDARD: u32 = 518;

/// FEN of a (double) Chess960 start position, castling in Shredder notation (`HAha`).
pub fn start_fen(white: u32, black: u32) -> String {
    format!("{:#}", Board::double_chess960_startpos(white % 960, black % 960))
}

/// Parses a FEN in any castling notation: `KQkq` (standard or X-FEN: the outermost rook on
/// that side), rook files (`HAha`, Shredder-FEN) or a mix of both.
pub fn parse_fen(fen: &str) -> Result<Board> {
    let f: Vec<&str> = fen.split_whitespace().collect();
    if f.len() < 4 {
        bail!("not a FEN: {fen}");
    }
    // the placement is needed to translate K/Q into rook files
    let placement = Board::from_fen(&format!("{} {} - - 0 1", f[0], f[1]), true).map_err(|e| anyhow::anyhow!("FEN {fen}: {e:?}"))?;
    let castling = if f[2] == "-" {
        "-".to_string()
    } else {
        let mut s = String::new();
        for c in f[2].chars() {
            let color = if c.is_ascii_uppercase() { Color::White } else { Color::Black };
            let rank = Rank::First.relative_to(color);
            let king = placement.king(color).file();
            let rooks = placement.colored_pieces(color, Piece::Rook);
            let rook_files = || File::ALL.into_iter().filter(move |&file| rooks.has(Square::new(file, rank)));
            let file = match c.to_ascii_lowercase() {
                'k' => rook_files().filter(|&x| x > king).last(),
                'q' => rook_files().find(|&x| x < king),
                x @ 'a'..='h' => Some(File::index((x as u8 - b'a') as usize)),
                _ => bail!("FEN {fen}: castling '{c}'"),
            }
            .with_context(|| format!("FEN {fen}: no rook for castling '{c}'"))?;
            let ch = char::from(b'a' + file as u8);
            s.push(if color == Color::White { ch.to_ascii_uppercase() } else { ch });
        }
        s
    };
    let rest = f[3..].join(" ");
    let rest = if f.len() >= 6 { rest } else { format!("{} 0 1", f[3]) };
    Board::from_fen(&format!("{} {} {} {}", f[0], f[1], castling, rest), true).map_err(|e| anyhow::anyhow!("FEN {fen}: {e:?}"))
}

/// A FEN for display (standard `KQkq` when that is unambiguous is not needed by the UI:
/// the board only reads the placement and the side to move).
pub fn display_fen(b: &Board) -> String {
    format!("{b:#}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BookKind {
    /// All 960 positions, shuffled with the seed (each played with both colours).
    All,
    /// `count` distinct positions drawn with the seed.
    Random,
    /// Double Chess960: `count` positions with independent White and Black setups.
    Double,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BookSpec {
    pub kind: BookKind,
    pub count: u32,
    pub seed: u64,
    /// Keep the standard position (518) in the book (default: excluded).
    #[serde(default)]
    pub include_standard: bool,
}

impl Default for BookSpec {
    fn default() -> Self {
        BookSpec { kind: BookKind::All, count: 960, seed: 1, include_standard: false }
    }
}

/// SplitMix64: a tiny deterministic generator (the same seed gives the same book on every
/// machine and every TorsGUI version).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// The (white, black) Scharnagl numbers of a book.
pub fn book_positions(spec: &BookSpec) -> Vec<(u32, u32)> {
    let mut rng = Rng(spec.seed);
    let mut all: Vec<u32> = (0..960).filter(|&n| spec.include_standard || n != STANDARD).collect();
    // Fisher–Yates
    for i in (1..all.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        all.swap(i, j);
    }
    match spec.kind {
        BookKind::All => all.into_iter().map(|n| (n, n)).collect(),
        BookKind::Random => all.into_iter().take(spec.count.clamp(1, 959 + spec.include_standard as u32) as usize).map(|n| (n, n)).collect(),
        BookKind::Double => {
            let mut seen = std::collections::HashSet::new();
            let mut v = Vec::new();
            while v.len() < spec.count.clamp(1, 100_000) as usize {
                let w = rng.below(960) as u32;
                let b = rng.below(960) as u32;
                if (!spec.include_standard && w == STANDARD && b == STANDARD) || !seen.insert((w, b)) {
                    continue;
                }
                v.push((w, b));
            }
            v
        }
    }
}

pub fn book_file_name(spec: &BookSpec) -> String {
    match spec.kind {
        BookKind::All => format!("chess960-all-seed{}.epd", spec.seed),
        BookKind::Random => format!("chess960-{}-seed{}.epd", spec.count, spec.seed),
        BookKind::Double => format!("dfrc-{}-seed{}.epd", spec.count, spec.seed),
    }
}

/// Writes the EPD book (one start position per line, with its Scharnagl numbers as `id`).
pub fn write_book(dir: &Path, spec: &BookSpec) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(book_file_name(spec));
    let mut s = String::new();
    for (w, b) in book_positions(spec) {
        let fen = start_fen(w, b);
        let epd: Vec<&str> = fen.split_whitespace().take(4).collect();
        let id = if w == b { format!("chess960 {w}") } else { format!("dfrc {w}/{b}") };
        s.push_str(&format!("{} id \"{id}\";\n", epd.join(" ")));
    }
    std::fs::write(&path, s)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scharnagl_numbers() {
        assert_eq!(start_fen(518, 518), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1");
        // position 0 is BBQNNRKR
        assert!(start_fen(0, 0).starts_with("bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf"), "{}", start_fen(0, 0));
        let d = start_fen(0, 959);
        assert!(d.starts_with("rkrnnqbb/") && d.contains("/BBQNNRKR w"), "{d}");
    }

    #[test]
    fn every_castling_notation() {
        let shredder = parse_fen("bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf - 0 1").unwrap();
        for f in ["bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1", "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq -", "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFkq - 0 1"] {
            assert_eq!(parse_fen(f).unwrap(), shredder, "{f}");
        }
        // standard FENs keep working
        assert_eq!(parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").unwrap(), Board::default());
        assert_eq!(parse_fen("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 3 20").unwrap().to_string(), "r3k2r/8/8/8/8/8/8/R3K2R b Kq - 3 20");
        // X-FEN with two rooks on one side: K is the outermost one
        let b = parse_fen("1r2k1rr/8/8/8/8/8/8/1R2K1RR w KQkq - 0 1").unwrap();
        assert_eq!(format!("{b:#}").split(' ').nth(2), Some("HBhb"));
        assert!(parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w K - 0 1").is_err());
    }

    #[test]
    fn castling_in_chess960() {
        use cozy_chess::util::{display_san_move, parse_san_move, parse_uci_move};
        // king b1, rooks a1/g1: O-O is "b1g1" (king takes rook) in UCI_Chess960
        let b = parse_fen("rk4r1/pppppppp/8/8/8/8/PPPPPPPP/RK4R1 w KQkq - 0 1").unwrap();
        let mv = parse_uci_move(&b, "b1g1").unwrap();
        assert!(b.is_legal(mv));
        assert_eq!(display_san_move(&b, mv).to_string(), "O-O");
        assert_eq!(parse_san_move(&b, "O-O-O").unwrap(), parse_uci_move(&b, "b1a1").unwrap());
        let mut after = b.clone();
        after.play(mv);
        assert!(after.to_string().starts_with("rk4r1/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 b"), "{after}");
    }

    #[test]
    fn books_are_deterministic() {
        let all = book_positions(&BookSpec::default());
        assert_eq!(all.len(), 959);
        assert!(!all.contains(&(518, 518)));
        assert_eq!(all, book_positions(&BookSpec::default()));
        assert_ne!(all, book_positions(&BookSpec { seed: 2, ..Default::default() }));
        let mut sorted: Vec<u32> = all.iter().map(|p| p.0).collect();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 959);
        assert_eq!(book_positions(&BookSpec { kind: BookKind::All, include_standard: true, ..Default::default() }).len(), 960);
        let r = book_positions(&BookSpec { kind: BookKind::Random, count: 100, seed: 7, include_standard: false });
        assert_eq!(r.len(), 100);
        let d = book_positions(&BookSpec { kind: BookKind::Double, count: 500, seed: 7, include_standard: false });
        assert_eq!(d.len(), 500);
        assert!(d.iter().any(|(w, b)| w != b));
        let t = tempfile::tempdir().unwrap();
        let p = write_book(t.path(), &BookSpec { kind: BookKind::Random, count: 10, seed: 3, include_standard: false }).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert_eq!(text.lines().count(), 10);
        for l in text.lines() {
            let fen = l.split(" id ").next().unwrap();
            parse_fen(&format!("{fen} 0 1")).unwrap();
        }
    }
}
