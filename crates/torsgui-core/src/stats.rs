//! Standings (score / performance first) and a pluggable Elo module.

use crate::pgn::{Game, SlotKey};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

pub fn elo_from_score(s: f64) -> f64 {
    if s <= 0.0 {
        f64::NEG_INFINITY
    } else if s >= 1.0 {
        f64::INFINITY
    } else {
        -400.0 * (1.0 / s - 1.0).log10()
    }
}

pub fn expected_score(diff: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf(-diff / 400.0))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Row {
    pub name: String,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub score: f64,
    pub pct: f64,
    /// Elo difference from the score (merge_results.py), None when infinite.
    pub elo: Option<f64>,
    pub elo_err: Option<f64>,
    pub white_games: u32,
    pub black_games: u32,
    /// Rating of the opponent (list rating) when known.
    pub rating: Option<f64>,
    pub rating_estimated: bool,
    /// Performance = opponent rating + elo diff.
    pub performance: Option<f64>,
}

impl Row {
    pub fn from_results(name: &str, results: &[f64]) -> Row {
        let n = results.len() as u32;
        let w = results.iter().filter(|r| **r == 1.0).count() as u32;
        let d = results.iter().filter(|r| **r == 0.5).count() as u32;
        let l = n - w - d;
        if n == 0 {
            return Row { name: name.into(), ..Default::default() };
        }
        let score = w as f64 + d as f64 / 2.0;
        let s = score / n as f64;
        let var = results.iter().map(|r| (r - s).powi(2)).sum::<f64>() / ((n as f64) - 1.0).max(1.0);
        let sd = (var / n as f64).sqrt();
        let elo = elo_from_score(s);
        let lo = elo_from_score((s - 1.96 * sd).max(1e-9));
        let hi = elo_from_score((s + 1.96 * sd).min(1.0 - 1e-9));
        let err = if hi.is_finite() && lo.is_finite() { Some((hi - lo) / 2.0) } else { None };
        Row {
            name: name.into(),
            games: n,
            wins: w,
            draws: d,
            losses: l,
            score,
            pct: 100.0 * s,
            elo: if elo.is_finite() { Some(elo) } else { None },
            elo_err: err,
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Termination {
    pub opponent: String,
    pub kind: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PairIssue {
    pub opponent: String,
    pub node: u32,
    pub pass: u32,
    pub round: u32,
    pub games: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct DecisiveGame {
    pub end_time: String,
    pub result: String,
    pub white: String,
    pub black: String,
    pub opponent: String,
    /// Colour of the seed.
    pub seed_color: String,
    pub moves: u32,
    pub termination: String,
    pub source: String,
    pub index: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Standings {
    pub seed: String,
    pub games: u32,
    pub unfinished: u32,
    pub duplicates: u32,
    /// Per-opponent rows, in the requested order.
    pub rows: Vec<Row>,
    pub total: Row,
    pub white: Row,
    pub black: Row,
    /// Every engine (useful for round robins).
    pub general: Vec<Row>,
    pub terminations: Vec<Termination>,
    pub termination_totals: BTreeMap<String, u32>,
    pub incomplete_pairs: Vec<PairIssue>,
    pub avg_duration_s: Option<f64>,
    pub min_duration_s: Option<u64>,
    pub max_duration_s: Option<u64>,
    pub decisive: Vec<DecisiveGame>,
    pub performance: Option<f64>,
    pub avg_opponent_rating: Option<f64>,
    pub elo: Vec<EloEstimate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RowOrder {
    /// By list rating (descending), unknown ratings keep the given order at the end.
    Rating,
    /// Highest score first (merge_results.py).
    Score,
    /// The given opponent order.
    Config,
}

/// Standings from the point of view of `seed`.
/// `games` must already be deduplicated. `order` lists the opponents in
/// configuration order; `ratings` holds (rating, estimated) per player name.
pub fn standings(
    seed: &str,
    games: &[Game],
    order: &[String],
    ratings: &HashMap<String, (f64, bool)>,
    row_order: RowOrder,
) -> Standings {
    let mut per_opp: HashMap<String, Vec<f64>> = HashMap::new();
    let mut opp_colors: HashMap<String, (u32, u32)> = HashMap::new();
    let mut per_color: HashMap<&str, Vec<f64>> = HashMap::new();
    let mut per_engine: HashMap<String, Vec<f64>> = HashMap::new();
    let mut terms: BTreeMap<(String, String), u32> = BTreeMap::new();
    let mut term_tot: BTreeMap<String, u32> = BTreeMap::new();
    let mut pair_check: BTreeMap<(String, u32, u32, u32), u32> = BTreeMap::new();
    let mut durations = Vec::new();
    let mut decisive = Vec::new();
    let mut unfinished = 0;
    for g in games {
        let Some(ws) = g.white_score() else {
            unfinished += 1;
            continue;
        };
        if let Some(d) = g.duration_s() {
            if d > 0 {
                durations.push(d);
            }
        }
        let (w, b) = (g.white().to_string(), g.black().to_string());
        per_engine.entry(w.clone()).or_default().push(ws);
        per_engine.entry(b.clone()).or_default().push(1.0 - ws);
        if w != seed && b != seed {
            continue;
        }
        let seed_white = w == seed;
        let opp = if seed_white { b.clone() } else { w.clone() };
        let sc = if seed_white { ws } else { 1.0 - ws };
        per_opp.entry(opp.clone()).or_default().push(sc);
        let oc = opp_colors.entry(opp.clone()).or_default();
        if seed_white {
            oc.0 += 1
        } else {
            oc.1 += 1
        }
        per_color.entry(if seed_white { "white" } else { "black" }).or_default().push(sc);
        let t = g.headers.get_or("Termination", "?").to_string();
        *terms.entry((opp.clone(), t.clone())).or_default() += 1;
        *term_tot.entry(t.clone()).or_default() += 1;
        if let Some(s) = g.slot() {
            *pair_check.entry((opp.clone(), s.node, s.pass, s.round)).or_default() += 1;
        }
        if ws != 0.5 {
            decisive.push(DecisiveGame {
                end_time: g.end_time().to_string(),
                result: g.result().to_string(),
                white: w.clone(),
                black: b.clone(),
                opponent: opp.clone(),
                seed_color: if seed_white { "white".into() } else { "black".into() },
                moves: g.plies().map(|p| p.div_ceil(2)).unwrap_or(0),
                termination: t,
                source: g.source.to_string_lossy().to_string(),
                index: g.index,
            });
        }
    }
    decisive.sort_by(|a, b| b.end_time.cmp(&a.end_time));

    let mut rows: Vec<Row> = per_opp
        .iter()
        .map(|(o, v)| {
            let mut r = Row::from_results(o, v);
            let (wg, bg) = opp_colors.get(o).copied().unwrap_or((0, 0));
            r.white_games = wg;
            r.black_games = bg;
            if let Some((rt, est)) = ratings.get(o) {
                r.rating = Some(*rt);
                r.rating_estimated = *est;
                r.performance = r.elo.map(|e| rt + e);
            }
            r
        })
        .collect();
    let pos = |n: &str| order.iter().position(|x| x == n).unwrap_or(usize::MAX);
    match row_order {
        RowOrder::Score => rows.sort_by(|a, b| b.pct.partial_cmp(&a.pct).unwrap().then(pos(&a.name).cmp(&pos(&b.name)))),
        RowOrder::Config => rows.sort_by_key(|r| (pos(&r.name), r.name.clone())),
        RowOrder::Rating => rows.sort_by(|a, b| match (a.rating, b.rating) {
            (Some(x), Some(y)) => y.partial_cmp(&x).unwrap().then(pos(&a.name).cmp(&pos(&b.name))),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => pos(&a.name).cmp(&pos(&b.name)).then(a.name.cmp(&b.name)),
        }),
    }
    let all: Vec<f64> = per_opp.values().flatten().copied().collect();
    let mut total = Row::from_results("TOTAL", &all);
    total.white_games = opp_colors.values().map(|c| c.0).sum();
    total.black_games = opp_colors.values().map(|c| c.1).sum();

    let rated: Vec<(&String, &Vec<f64>)> = per_opp.iter().filter(|(o, _)| ratings.contains_key(*o)).collect();
    let (mut perf, mut avg_r) = (None, None);
    if !rated.is_empty() {
        let n: usize = rated.iter().map(|(_, v)| v.len()).sum();
        let a = rated.iter().map(|(o, v)| ratings[*o].0 * v.len() as f64).sum::<f64>() / n as f64;
        let s = rated.iter().map(|(_, v)| v.iter().sum::<f64>()).sum::<f64>() / n as f64;
        avg_r = Some(a);
        let e = elo_from_score(s);
        perf = if e.is_finite() { Some(a + e) } else { None };
    }

    let mut general: Vec<Row> = per_engine.iter().map(|(e, v)| Row::from_results(e, v)).collect();
    general.sort_by(|a, b| b.pct.partial_cmp(&a.pct).unwrap().then(a.name.cmp(&b.name)));

    let incomplete_pairs = pair_check
        .into_iter()
        .filter(|(_, n)| *n != 2)
        .map(|((o, node, pass, round), n)| PairIssue { opponent: o, node, pass, round, games: n })
        .collect();

    let anchors: HashMap<String, f64> = ratings.iter().map(|(k, v)| (k.clone(), v.0)).collect();
    let elo = LogisticMle::default().estimate(&results_of(games), &anchors);

    Standings {
        seed: seed.to_string(),
        games: all.len() as u32,
        unfinished,
        duplicates: 0,
        rows,
        total,
        white: Row::from_results("white", per_color.get("white").map(|v| v.as_slice()).unwrap_or(&[])),
        black: Row::from_results("black", per_color.get("black").map(|v| v.as_slice()).unwrap_or(&[])),
        general,
        terminations: terms.into_iter().map(|((o, k), c)| Termination { opponent: o, kind: k, count: c }).collect(),
        termination_totals: term_tot,
        incomplete_pairs,
        avg_duration_s: if durations.is_empty() { None } else { Some(durations.iter().sum::<u64>() as f64 / durations.len() as f64) },
        min_duration_s: durations.iter().min().copied(),
        max_duration_s: durations.iter().max().copied(),
        decisive,
        performance: perf,
        avg_opponent_rating: avg_r,
        elo,
    }
}

/// Colour-pair check against the expected slots: pairs whose two games are
/// not both present (used for the "incomplete colour pair" flag while running).
pub fn open_pairs(done: &std::collections::HashSet<SlotKey>) -> Vec<SlotKey> {
    let mut v: Vec<SlotKey> = done
        .iter()
        .filter(|s| {
            let twin = SlotKey { white: s.black.clone(), black: s.white.clone(), ..(*s).clone() };
            !done.contains(&twin)
        })
        .cloned()
        .collect();
    v.sort();
    v
}

// ------------------------------------------------------------------ Elo module

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameResult {
    pub white: String,
    pub black: String,
    /// White's score.
    pub score: f64,
}

pub fn results_of(games: &[Game]) -> Vec<GameResult> {
    games
        .iter()
        .filter_map(|g| g.white_score().map(|s| GameResult { white: g.white().into(), black: g.black().into(), score: s }))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EloEstimate {
    pub name: String,
    pub elo: f64,
    pub lo: f64,
    pub hi: f64,
    pub games: u32,
    pub score: f64,
    pub anchored: bool,
    pub method: String,
}

/// Pluggable rating estimator (Ordo-like MLE, BayesElo... can be added later).
pub trait EloEstimator {
    fn id(&self) -> &'static str;
    fn estimate(&self, games: &[GameResult], anchors: &HashMap<String, f64>) -> Vec<EloEstimate>;
}

/// 1-vs-1 logistic maximum likelihood, anchored on the imported CCRL
/// ratings, with 95 % confidence intervals from the Fisher information.
/// Draws count as half points. Non-anchored players are solved jointly
/// (Newton steps per player until convergence).
#[derive(Default)]
pub struct LogisticMle;

impl EloEstimator for LogisticMle {
    fn id(&self) -> &'static str {
        "logistic-mle"
    }
    fn estimate(&self, games: &[GameResult], anchors: &HashMap<String, f64>) -> Vec<EloEstimate> {
        let k = 10f64.ln() / 400.0;
        let mut players: Vec<String> = games.iter().flat_map(|g| [g.white.clone(), g.black.clone()]).collect();
        players.sort();
        players.dedup();
        let free: Vec<String> = players.iter().filter(|p| !anchors.contains_key(*p)).cloned().collect();
        if free.is_empty() || anchors.is_empty() {
            return vec![];
        }
        let mut r: HashMap<String, f64> = anchors.clone();
        let avg_anchor = anchors.values().sum::<f64>() / anchors.len() as f64;
        for p in &free {
            r.insert(p.clone(), avg_anchor);
        }
        for _ in 0..200 {
            let mut maxstep: f64 = 0.0;
            for p in &free {
                let (mut grad, mut info) = (0.0, 0.0);
                for g in games {
                    let (me_white, other) = if &g.white == p {
                        (true, &g.black)
                    } else if &g.black == p {
                        (false, &g.white)
                    } else {
                        continue;
                    };
                    let Some(ro) = r.get(other) else { continue };
                    let s = if me_white { g.score } else { 1.0 - g.score };
                    let e = expected_score(r[p] - ro);
                    grad += k * (s - e);
                    info += k * k * e * (1.0 - e);
                }
                if info <= 0.0 {
                    continue;
                }
                let step = (grad / info).clamp(-400.0, 400.0);
                *r.get_mut(p).unwrap() += step;
                maxstep = maxstep.max(step.abs());
            }
            if maxstep < 1e-6 {
                break;
            }
        }
        free.iter()
            .filter_map(|p| {
                let (mut info, mut n, mut sc) = (0.0, 0u32, 0.0);
                for g in games {
                    let (me_white, other) = if &g.white == p {
                        (true, &g.black)
                    } else if &g.black == p {
                        (false, &g.white)
                    } else {
                        continue;
                    };
                    let e = expected_score(r[p] - r[other]);
                    info += k * k * e * (1.0 - e);
                    n += 1;
                    sc += if me_white { g.score } else { 1.0 - g.score };
                }
                if n == 0 {
                    return None;
                }
                let se = if info > 0.0 { 1.0 / info.sqrt() } else { f64::INFINITY };
                let v = r[p];
                if !v.is_finite() || v.abs() > 10000.0 {
                    return None;
                }
                Some(EloEstimate {
                    name: p.clone(),
                    elo: v,
                    lo: v - 1.96 * se,
                    hi: v + 1.96 * se,
                    games: n,
                    score: sc,
                    anchored: false,
                    method: self.id().into(),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn row_like_merge_results() {
        let mut v = vec![0.5; 26];
        v.extend([1.0; 4]);
        let r = Row::from_results("RubiChess", &v);
        assert_eq!((r.wins, r.draws, r.losses), (4, 26, 0));
        assert_eq!(r.score, 17.0);
        assert!((r.pct - 56.666).abs() < 0.01);
        assert_eq!(r.elo.unwrap().round(), 47.0);
        assert_eq!(r.elo_err.unwrap().round(), 44.0);
    }
    #[test]
    fn mle_matches_simple_performance() {
        // 10 games vs one 3000 opponent scoring 75% -> +191
        let mut g = Vec::new();
        for i in 0..10 {
            let s = if i < 5 { 1.0 } else { 0.5 };
            g.push(GameResult { white: "S".into(), black: "A".into(), score: s });
        }
        let anchors = HashMap::from([("A".to_string(), 3000.0)]);
        let e = LogisticMle.estimate(&g, &anchors);
        assert_eq!(e.len(), 1);
        assert!((e[0].elo - (3000.0 + elo_from_score(0.75))).abs() < 0.5);
        assert!(e[0].lo < e[0].elo && e[0].hi > e[0].elo);
    }
}
