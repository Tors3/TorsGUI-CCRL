//! Crosstables: every player against every other, from the games of a tournament or of any
//! PGN file, as a table for the UI, as text (for the forum, in `[code]`) and as an HTML page.
//!
//! Players are ranked by points, then Sonneborn-Berger (the points scored against each
//! opponent times that opponent's points), then wins. A cell shows the results in the order
//! they were played (`1=0=`, from the row player's view) when every pair played at most
//! [`RESULTS_UP_TO`] games, else the score (`8.5/10`).

use crate::pgn::Game;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Up to this many games per pair the cells list each result.
pub const RESULTS_UP_TO: u32 = 4;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CtPlayer {
    pub name: String,
    /// The rating given for the player (tournament ratings, or the PGN Elo tags).
    pub rating: Option<f64>,
    pub games: u32,
    pub points: f64,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    /// Sonneborn-Berger.
    pub sb: f64,
    /// Performance: average rating of the opponents met + the Elo difference of the score
    /// (only when every opponent met has a rating).
    pub performance: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CtCell {
    pub games: u32,
    pub points: f64,
    /// `1`, `=`, `0` per game, in the order played, from the row player's view.
    pub results: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Crosstable {
    pub title: String,
    /// Ranked (best first).
    pub players: Vec<CtPlayer>,
    /// `cells[i][j]`: player i against player j, in the ranking order.
    pub cells: Vec<Vec<CtCell>>,
    /// Finished games counted.
    pub games: u32,
    /// The cells list each result (every pair played at most [`RESULTS_UP_TO`] games).
    pub show_results: bool,
}

/// Elo difference of a score fraction (logistic), bounded at ±800.
fn elo_of(p: f64) -> f64 {
    if p <= 0.0 {
        -800.0
    } else if p >= 1.0 {
        800.0
    } else {
        (-400.0 * (1.0 / p - 1.0).log10()).clamp(-800.0, 800.0)
    }
}

/// The crosstable of `games` (finished games only; give them in the order played).
/// `rating`: a player's rating when known, else the PGN `WhiteElo` / `BlackElo` tags are used.
pub fn build(title: &str, games: &[Game], rating: &dyn Fn(&str) -> Option<f64>) -> Crosstable {
    let mut names: Vec<String> = Vec::new();
    let mut idx: HashMap<String, usize> = HashMap::new();
    let mut tag_elo: HashMap<String, f64> = HashMap::new();
    let mut add = |n: &str, names: &mut Vec<String>| -> usize {
        *idx.entry(n.to_string()).or_insert_with(|| {
            names.push(n.to_string());
            names.len() - 1
        })
    };
    let mut pairs: Vec<(usize, usize, f64)> = Vec::new();
    for g in games.iter().filter(|g| g.finished()) {
        let Some(ws) = g.white_score() else { continue };
        let (w, b) = (add(g.white(), &mut names), add(g.black(), &mut names));
        for (tag, name) in [("WhiteElo", g.white()), ("BlackElo", g.black())] {
            if let Some(e) = g.headers.get(tag).and_then(|v| v.trim().parse::<f64>().ok()).filter(|e| *e > 0.0) {
                tag_elo.insert(name.to_string(), e);
            }
        }
        pairs.push((w, b, ws));
    }
    let k = names.len();
    let mut cells = vec![vec![CtCell::default(); k]; k];
    let mut pl: Vec<CtPlayer> = names.iter().map(|n| CtPlayer { name: n.clone(), rating: rating(n).or_else(|| tag_elo.get(n).copied()), ..Default::default() }).collect();
    for &(w, b, ws) in &pairs {
        let mark = |s: f64| if s == 1.0 { '1' } else if s == 0.0 { '0' } else { '=' };
        for (me, opp, s) in [(w, b, ws), (b, w, 1.0 - ws)] {
            let c = &mut cells[me][opp];
            c.games += 1;
            c.points += s;
            c.results.push(mark(s));
            let p = &mut pl[me];
            p.games += 1;
            p.points += s;
            match mark(s) {
                '1' => p.wins += 1,
                '0' => p.losses += 1,
                _ => p.draws += 1,
            }
        }
    }
    for i in 0..k {
        pl[i].sb = (0..k).filter(|j| *j != i).map(|j| cells[i][j].points * pl[j].points).sum();
        // performance: only when every opponent met has a rating
        let met: Vec<(u32, Option<f64>)> = (0..k).filter(|j| *j != i && cells[i][*j].games > 0).map(|j| (cells[i][j].games, pl[j].rating)).collect();
        if pl[i].games > 0 && !met.is_empty() && met.iter().all(|(_, r)| r.is_some()) {
            let avg = met.iter().map(|(n, r)| *n as f64 * r.unwrap()).sum::<f64>() / pl[i].games as f64;
            pl[i].performance = Some((avg + elo_of(pl[i].points / pl[i].games as f64)).round());
        }
    }
    let mut order: Vec<usize> = (0..k).collect();
    order.sort_by(|a, b| {
        let (x, y) = (&pl[*a], &pl[*b]);
        y.points.total_cmp(&x.points).then(y.sb.total_cmp(&x.sb)).then(y.wins.cmp(&x.wins)).then(x.name.cmp(&y.name))
    });
    let players: Vec<CtPlayer> = order.iter().map(|i| pl[*i].clone()).collect();
    let cells: Vec<Vec<CtCell>> = order.iter().map(|i| order.iter().map(|j| cells[*i][*j].clone()).collect()).collect();
    let show_results = cells.iter().flatten().all(|c| c.games <= RESULTS_UP_TO);
    Crosstable { title: title.to_string(), players, cells, games: pairs.len() as u32, show_results }
}

/// "12.5" / "12": points without a needless decimal.
pub fn pts(p: f64) -> String {
    if p.fract() == 0.0 { format!("{p:.0}") } else { format!("{p:.1}") }
}

/// The text of a cell (" " when the two never met, "x" on the diagonal).
pub fn cell_text(ct: &Crosstable, i: usize, j: usize) -> String {
    let c = &ct.cells[i][j];
    if i == j {
        "x".into()
    } else if c.games == 0 {
        ".".into()
    } else if ct.show_results {
        c.results.clone()
    } else {
        format!("{}/{}", pts(c.points), c.games)
    }
}

/// Fixed-width text: rank, player, rating, score, %, the matrix (columns numbered by rank),
/// S-B and performance.
pub fn to_text(ct: &Crosstable) -> String {
    let n = ct.players.len();
    let name_w = ct.players.iter().map(|p| p.name.chars().count()).max().unwrap_or(6).max(6);
    let has_rating = ct.players.iter().any(|p| p.rating.is_some());
    let has_perf = ct.players.iter().any(|p| p.performance.is_some());
    let score = |p: &CtPlayer| format!("{}/{}", pts(p.points), p.games);
    let score_w = ct.players.iter().map(|p| score(p).len()).max().unwrap_or(5).max(5);
    let cell_w = (0..n).flat_map(|i| (0..n).map(move |j| (i, j))).map(|(i, j)| cell_text(ct, i, j).chars().count()).max().unwrap_or(1).max(n.to_string().len()).max(2);
    let rank_w = n.to_string().len() + 1;
    let mut out = Vec::new();
    if !ct.title.is_empty() {
        out.push(ct.title.clone());
        out.push(String::new());
    }
    let mut head = format!("{:>rank_w$}  {:<name_w$}", "", "Engine");
    if has_rating {
        head.push_str(&format!("  {:>6}", "Rating"));
    }
    head.push_str(&format!("  {:>score_w$}  {:>5}", "Score", "%"));
    for c in 1..=n {
        head.push_str(&format!("  {c:^cell_w$}"));
    }
    head.push_str(&format!("  {:>7}", "S-B"));
    if has_perf {
        head.push_str(&format!("  {:>5}", "Perf"));
    }
    out.push(head.trim_end().to_string());
    out.push("-".repeat(out.last().map(|h| h.chars().count()).unwrap_or(10)));
    for (i, p) in ct.players.iter().enumerate() {
        let mut row = format!("{:>rank_w$}  {:<name_w$}", format!("{}.", i + 1), p.name);
        if has_rating {
            row.push_str(&format!("  {:>6}", p.rating.map(|r| format!("{r:.0}")).unwrap_or_default()));
        }
        let pct = if p.games > 0 { format!("{:.1}", 100.0 * p.points / p.games as f64) } else { String::new() };
        row.push_str(&format!("  {:>score_w$}  {:>5}", score(p), pct));
        for j in 0..n {
            row.push_str(&format!("  {:^cell_w$}", cell_text(ct, i, j)));
        }
        row.push_str(&format!("  {:>7.2}", p.sb));
        if has_perf {
            row.push_str(&format!("  {:>5}", p.performance.map(|r| format!("{r:.0}")).unwrap_or_default()));
        }
        out.push(row.trim_end().to_string());
    }
    out.push(String::new());
    out.push(format!("{} games · {}", ct.games, if ct.show_results { "1 = win, = draw, 0 = loss, in the order played" } else { "points / games against each opponent" }));
    out.join("\n") + "\n"
}

/// For the forum: the text in `[code]`.
pub fn to_bbcode(ct: &Crosstable) -> String {
    format!("[code]\n{}[/code]\n", to_text(ct))
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// A standalone HTML page with the table (green: won the encounter, red: lost it).
pub fn to_html(ct: &Crosstable) -> String {
    let n = ct.players.len();
    let has_rating = ct.players.iter().any(|p| p.rating.is_some());
    let has_perf = ct.players.iter().any(|p| p.performance.is_some());
    let mut h = String::new();
    h.push_str("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>");
    h.push_str(&esc(if ct.title.is_empty() { "Crosstable" } else { &ct.title }));
    h.push_str("</title>\n<style>body{font:14px system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:center;white-space:nowrap}td.n{text-align:left}td.w{background:#d8f0d8}td.l{background:#f6d6d6}td.d{background:#f3f3e6}td.x{background:#eee}caption{font-weight:600;margin-bottom:8px;text-align:left}p{color:#666}</style></head><body>\n<table><caption>");
    h.push_str(&esc(&ct.title));
    h.push_str("</caption>\n<tr><th>#</th><th>Engine</th>");
    if has_rating {
        h.push_str("<th>Rating</th>");
    }
    h.push_str("<th>Score</th><th>%</th>");
    for c in 1..=n {
        h.push_str(&format!("<th>{c}</th>"));
    }
    h.push_str("<th>S-B</th>");
    if has_perf {
        h.push_str("<th>Perf</th>");
    }
    h.push_str("</tr>\n");
    for (i, p) in ct.players.iter().enumerate() {
        h.push_str(&format!("<tr><td>{}</td><td class=\"n\">{}</td>", i + 1, esc(&p.name)));
        if has_rating {
            h.push_str(&format!("<td>{}</td>", p.rating.map(|r| format!("{r:.0}")).unwrap_or_default()));
        }
        let pct = if p.games > 0 { format!("{:.1}", 100.0 * p.points / p.games as f64) } else { String::new() };
        h.push_str(&format!("<td>{}/{}</td><td>{pct}</td>", pts(p.points), p.games));
        for j in 0..n {
            let c = &ct.cells[i][j];
            let class = if i == j { "x" } else if c.games == 0 { "" } else if c.points * 2.0 > c.games as f64 { "w" } else if c.points * 2.0 < c.games as f64 { "l" } else { "d" };
            h.push_str(&format!("<td class=\"{class}\" title=\"{}\">{}</td>", esc(&c.results), esc(&cell_text(ct, i, j))));
        }
        h.push_str(&format!("<td>{:.2}</td>", p.sb));
        if has_perf {
            h.push_str(&format!("<td>{}</td>", p.performance.map(|r| format!("{r:.0}")).unwrap_or_default()));
        }
        h.push_str("</tr>\n");
    }
    h.push_str(&format!("</table>\n<p>{} games · made with TorsGUI</p>\n</body></html>\n", ct.games));
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn games(rows: &[(&str, &str, &str)]) -> Vec<Game> {
        let text: String = rows.iter().map(|(w, b, r)| format!("[White \"{w}\"]\n[Black \"{b}\"]\n[Result \"{r}\"]\n\n1. e4 e5 {r}\n\n")).collect();
        crate::pgn::parse_games(&text, Path::new("t.pgn"))
    }

    #[test]
    fn a_round_robin_is_ranked_with_sonneborn_berger() {
        let g = games(&[("A", "B", "1-0"), ("B", "A", "1/2-1/2"), ("A", "C", "0-1"), ("C", "A", "1/2-1/2"), ("B", "C", "1-0"), ("C", "B", "0-1"), ("A", "B", "*")]);
        let ct = build("Test", &g, &|n| match n {
            "A" => Some(3000.0),
            "B" => Some(2900.0),
            "C" => Some(2950.0),
            _ => None,
        });
        assert_eq!(ct.games, 6, "the unfinished game is not counted");
        assert!(ct.show_results);
        let names: Vec<&str> = ct.players.iter().map(|p| p.name.as_str()).collect();
        // B 2.5 (beat C twice, ½ against A), A 2 (1½ v B, ½ v C), C 1.5
        assert_eq!(names, ["B", "A", "C"]);
        assert_eq!((ct.players[0].points, ct.players[0].wins, ct.players[0].draws, ct.players[0].losses), (2.5, 2, 1, 1));
        // B against A, in the order played: lost, drew
        assert_eq!(ct.cells[0][1].results, "0=");
        assert_eq!(ct.cells[1][0].results, "1=");
        assert_eq!(cell_text(&ct, 0, 0), "x");
        // S-B of B: 0.5 × 2 (A) + 2 × 1.5 (C) = 4
        assert_eq!(ct.players[0].sb, 4.0);
        assert!(ct.players.iter().all(|p| p.performance.is_some()));
        let t = to_text(&ct);
        assert!(t.contains("1.  B") && t.contains("2.5/4") && t.contains("S-B"), "{t}");
        assert!(to_bbcode(&ct).starts_with("[code]\nTest"));
        assert!(to_html(&ct).contains("<td class=\"l\" title=\"0=\">0=</td>"));
    }

    #[test]
    fn long_matches_show_the_score_and_gauntlet_cells_stay_empty() {
        let mut rows = Vec::new();
        for i in 0..10 {
            rows.push(if i % 2 == 0 { ("Seed", "X", if i < 6 { "1-0" } else { "1/2-1/2" }) } else { ("X", "Seed", "0-1") });
            rows.push(if i % 2 == 0 { ("Seed", "Y", "0-1") } else { ("Y", "Seed", "1/2-1/2") });
        }
        let ct = build("", &games(&rows), &|_| None);
        assert!(!ct.show_results);
        let s = ct.players.iter().position(|p| p.name == "Seed").unwrap();
        let x = ct.players.iter().position(|p| p.name == "X").unwrap();
        let y = ct.players.iter().position(|p| p.name == "Y").unwrap();
        assert_eq!(cell_text(&ct, s, x), "9/10");
        assert_eq!(cell_text(&ct, x, y), ".", "opponents of a gauntlet never meet");
        assert!(ct.players.iter().all(|p| p.performance.is_none()), "no ratings");
        // PGN Elo tags are used when nothing else is known
        let mut g = games(&[("P", "Q", "1-0")]);
        g[0].headers.set("WhiteElo", "2800");
        g[0].headers.set("BlackElo", "2700");
        let ct = build("", &g, &|_| None);
        assert_eq!(ct.players[0].rating, Some(2800.0));
        assert_eq!(ct.players[0].performance, Some(3500.0), "a 100% score is capped at +800");
    }
}
