//! Insights of a tournament: how the Elo of a player moved game after game (with its error
//! band), and how each opening of the book played out (draws, colour bias, sweeps).

use crate::pgn::{parse_movetext, Game};
use crate::stats::Row;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EloPoint {
    /// Games of the player so far.
    pub games: u32,
    pub score_pct: f64,
    /// Elo difference from the score, with the 95 % interval (None when 0 % or 100 %).
    pub elo: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    /// Performance (opponents' average rating + Elo) when every opponent has a rating.
    pub perf: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EloHistory {
    pub player: String,
    pub players: Vec<String>,
    pub points: Vec<EloPoint>,
}

/// Games in the order they ended (end time, then file and position).
pub fn chronological(games: &[Game]) -> Vec<&Game> {
    let mut v: Vec<&Game> = games.iter().filter(|g| g.white_score().is_some()).collect();
    v.sort_by(|a, b| a.end_time().cmp(b.end_time()).then(a.source.cmp(&b.source)).then(a.index.cmp(&b.index)));
    v
}

/// The Elo of `player` after each of its games (at most `max_points`, always the last one).
pub fn elo_history(games: &[Game], player: &str, ratings: &HashMap<String, f64>, max_points: usize) -> Vec<EloPoint> {
    let mut results = Vec::new();
    let mut opp_sum = 0.0;
    let mut all_rated = true;
    let mut out = Vec::new();
    for g in chronological(games) {
        let s = g.white_score().unwrap_or(0.5);
        let (r, opp) = if g.white() == player {
            (s, g.black())
        } else if g.black() == player {
            (1.0 - s, g.white())
        } else {
            continue;
        };
        results.push(r);
        match ratings.get(opp) {
            Some(x) => opp_sum += x,
            None => all_rated = false,
        }
        let row = Row::from_results(player, &results);
        let n = results.len() as f64;
        out.push(EloPoint {
            games: results.len() as u32,
            score_pct: row.pct,
            elo: row.elo,
            lo: row.elo.zip(row.elo_err).map(|(e, x)| e - x),
            hi: row.elo.zip(row.elo_err).map(|(e, x)| e + x),
            perf: if all_rated { row.elo.map(|e| opp_sum / n + e) } else { None },
        });
    }
    thin(out, max_points)
}

fn thin(v: Vec<EloPoint>, max: usize) -> Vec<EloPoint> {
    if v.len() <= max || max < 2 {
        return v;
    }
    let step = v.len() as f64 / (max - 1) as f64;
    let mut out: Vec<EloPoint> = (0..max - 1).map(|i| v[(i as f64 * step) as usize].clone()).collect();
    out.push(v.last().unwrap().clone());
    out
}

// ------------------------------------------------------------------ openings

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct OpeningStat {
    /// The book moves (SAN with move numbers), or the start position of an EPD book.
    pub label: String,
    pub fen: Option<String>,
    pub moves: Vec<String>,
    pub games: u32,
    pub white_wins: u32,
    pub draws: u32,
    pub black_wins: u32,
    /// White's score in % (colour bias of the opening).
    pub white_pct: f64,
    /// Games played with both colours by the same two engines.
    pub pairs: u32,
    /// Pairs where White won both games (each engine won with White): a strong White bias.
    pub pairs_white_both: u32,
    pub pairs_black_both: u32,
    pub pairs_drawn: u32,
    /// Pairs won twice by the same engine.
    pub pairs_sweep: u32,
    pub avg_plies: Option<f64>,
    /// A game to open in the viewer.
    pub example_source: String,
    pub example_index: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct OpeningsReport {
    pub openings: Vec<OpeningStat>,
    pub games: u32,
    pub white_pct: f64,
    pub draw_pct: f64,
    /// Openings where every pair was won by White both times (at least 2 pairs).
    pub biased: u32,
}

fn book_of(g: &Game) -> (Option<String>, Vec<String>) {
    let fen = g.headers.get("FEN").map(|f| f.to_string());
    let moves: Vec<String> = parse_movetext(&g.movetext).into_iter().take_while(|m| m.info.book).map(|m| m.san).collect();
    (fen, moves)
}

fn label_of(fen: &Option<String>, moves: &[String]) -> String {
    let start_black = fen.as_deref().is_some_and(|f| f.split_whitespace().nth(1) == Some("b"));
    let mut s = String::new();
    for (i, m) in moves.iter().enumerate() {
        let ply = i + usize::from(start_black);
        if ply % 2 == 0 {
            s.push_str(&format!("{}. ", ply / 2 + 1));
        } else if i == 0 {
            s.push_str(&format!("{}... ", ply / 2 + 1));
        }
        s.push_str(m);
        s.push(' ');
    }
    let moves_label = s.trim().to_string();
    match (fen, moves_label.is_empty()) {
        (Some(f), true) => f.split_whitespace().take(2).collect::<Vec<_>>().join(" "),
        (Some(f), false) => format!("{} · {moves_label}", f.split_whitespace().next().unwrap_or("")),
        (None, true) => "(no book moves)".into(),
        (None, false) => moves_label,
    }
}

pub fn openings(games: &[Game]) -> OpeningsReport {
    struct Acc {
        stat: OpeningStat,
        plies: Vec<u32>,
        // (engine a, engine b) sorted -> white scores of games by colour of `a`
        pairs: HashMap<(String, String), Vec<(bool, f64)>>,
    }
    let mut by: BTreeMap<(Option<String>, Vec<String>), Acc> = BTreeMap::new();
    let mut total = 0u32;
    let (mut white_pts, mut draws) = (0.0, 0u32);
    for g in games {
        let Some(s) = g.white_score() else { continue };
        total += 1;
        white_pts += s;
        let key = book_of(g);
        let acc = by.entry(key.clone()).or_insert_with(|| Acc {
            stat: OpeningStat { label: label_of(&key.0, &key.1), fen: key.0.clone(), moves: key.1.clone(), example_source: g.source.to_string_lossy().to_string(), example_index: g.index as u32, ..Default::default() },
            plies: Vec::new(),
            pairs: HashMap::new(),
        });
        acc.stat.games += 1;
        match s {
            x if x == 1.0 => acc.stat.white_wins += 1,
            x if x == 0.0 => acc.stat.black_wins += 1,
            _ => {
                acc.stat.draws += 1;
                draws += 1;
            }
        }
        if let Some(p) = g.plies() {
            acc.plies.push(p);
        }
        let (w, b) = (g.white().to_string(), g.black().to_string());
        let (a, other, a_white) = if w <= b { (w, b, true) } else { (b, w, false) };
        acc.pairs.entry((a, other)).or_default().push((a_white, s));
    }
    let mut out: Vec<OpeningStat> = by
        .into_values()
        .map(|mut acc| {
            let st = &mut acc.stat;
            st.white_pct = 100.0 * (st.white_wins as f64 + st.draws as f64 / 2.0) / st.games.max(1) as f64;
            st.avg_plies = (!acc.plies.is_empty()).then(|| acc.plies.iter().sum::<u32>() as f64 / acc.plies.len() as f64);
            for games in acc.pairs.values() {
                // consecutive games with reversed colours make a pair
                let with_a_white: Vec<f64> = games.iter().filter(|g| g.0).map(|g| g.1).collect();
                let with_a_black: Vec<f64> = games.iter().filter(|g| !g.0).map(|g| g.1).collect();
                for (x, y) in with_a_white.iter().zip(&with_a_black) {
                    st.pairs += 1;
                    // x: White's score with a White; y: White's score with a Black
                    if *x == 1.0 && *y == 1.0 {
                        st.pairs_white_both += 1;
                    } else if *x == 0.0 && *y == 0.0 {
                        st.pairs_black_both += 1;
                    } else if *x == 0.5 && *y == 0.5 {
                        st.pairs_drawn += 1;
                    }
                    // a's points: x + (1 - y)
                    let a_pts = x + (1.0 - y);
                    if a_pts == 2.0 || a_pts == 0.0 {
                        st.pairs_sweep += 1;
                    }
                }
            }
            acc.stat
        })
        .collect();
    out.sort_by(|a, b| b.games.cmp(&a.games).then(a.label.cmp(&b.label)));
    let biased = out.iter().filter(|o| o.pairs >= 2 && (o.pairs_white_both == o.pairs || o.pairs_black_both == o.pairs)).count() as u32;
    OpeningsReport {
        games: total,
        white_pct: if total > 0 { 100.0 * white_pts / total as f64 } else { 0.0 },
        draw_pct: if total > 0 { 100.0 * draws as f64 / total as f64 } else { 0.0 },
        biased,
        openings: out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn game(w: &str, b: &str, res: &str, book: &str, end: &str) -> Game {
        let text = format!("[White \"{w}\"]\n[Black \"{b}\"]\n[Result \"{res}\"]\n[GameEndTime \"{end}\"]\n[PlyCount \"40\"]\n\n{book} {res}\n");
        Game::from_block(&text, Path::new("t.pgn"), 0)
    }

    #[test]
    fn elo_moves_game_after_game() {
        let g = vec![
            game("A", "B", "1-0", "", "2026-10-01T10:00:02"),
            game("B", "A", "1/2-1/2", "", "2026-10-01T10:00:01"),
            game("A", "C", "0-1", "", "2026-10-01T10:00:03"),
            game("C", "A", "0-1", "", "2026-10-01T10:00:04"),
        ];
        let r = HashMap::from([("B".to_string(), 3000.0), ("C".to_string(), 3100.0)]);
        let h = elo_history(&g, "A", &r, 100);
        assert_eq!(h.len(), 4);
        // chronological: the draw first
        assert_eq!(h[0].score_pct, 50.0);
        assert_eq!(h[1].score_pct, 75.0);
        assert_eq!(h[3].score_pct, 62.5);
        let last = h.last().unwrap();
        assert!(last.elo.unwrap() > 80.0 && last.lo.unwrap() < last.elo.unwrap() && last.hi.unwrap() > last.elo.unwrap());
        assert!((last.perf.unwrap() - (3050.0 + last.elo.unwrap())).abs() < 1e-6);
        assert_eq!(thin((0..50).map(|i| EloPoint { games: i, ..Default::default() }).collect(), 10).last().unwrap().games, 49);
    }

    #[test]
    fn openings_and_pairs() {
        let e4 = "1. e4 {book} e5 {book} 2. Nf3 {+0.20/10 0.1s} Nc6 {-0.10/10 0.1s}";
        let d4 = "1. d4 {book} d5 {book} 2. c4 {+0.20/10 0.1s}";
        let g = vec![
            // e4: White wins both games of the pair -> biased
            game("A", "B", "1-0", e4, "1"),
            game("B", "A", "1-0", e4, "2"),
            game("A", "C", "1-0", e4, "3"),
            game("C", "A", "1-0", e4, "4"),
            // d4: A sweeps B, then a drawn pair
            game("A", "B", "1-0", d4, "5"),
            game("B", "A", "0-1", d4, "6"),
            game("A", "C", "1/2-1/2", d4, "7"),
            game("C", "A", "1/2-1/2", d4, "8"),
        ];
        let r = openings(&g);
        assert_eq!(r.games, 8);
        let e = r.openings.iter().find(|o| o.label == "1. e4 e5").unwrap();
        assert_eq!((e.games, e.white_wins, e.pairs, e.pairs_white_both, e.white_pct), (4, 4, 2, 2, 100.0));
        let d = r.openings.iter().find(|o| o.label == "1. d4 d5").unwrap();
        assert_eq!((d.pairs, d.pairs_sweep, d.pairs_drawn), (2, 1, 1));
        assert_eq!(r.biased, 1);
        assert_eq!(e.avg_plies, Some(40.0));
        assert_eq!(label_of(&Some("8/8/8/8/8/8/8/K6k b - - 0 1".into()), &["Kg2".into()]), "8/8/8/8/8/8/8/K6k · 1... Kg2");
    }
}
