//! Decides which single game (slot) to play next.
//!
//! Port of the queue built by `run_node.py`: every pairing plays, per pass and
//! per node (opening partition), `rounds_per_pass[node]` openings, each twice
//! with colours reversed. The opening of a round is
//!
//! ```text
//! block = (node * PASSES + (pass - 1)) * n_pairings + pairing
//! start = BOOK_START + block * RPP_BLOCK          (RPP_BLOCK = max(rounds_per_pass))
//! opening(round) = start + round - 1
//! ```
//!
//! so no two slots of a tournament use the same opening by accident. Only the
//! slots missing from the PGNs are queued; slots of lagging pairings come first
//! so that all pairings advance together and colour pairs complete early.

use crate::model::{Participant, TournamentConfig, TournamentKind};
use crate::pgn::SlotKey;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Job {
    /// Opening partition ("home node" index, 0-based).
    pub node: u32,
    pub pass: u32,
    /// Index of the pairing.
    pub pairing: usize,
    pub round: u32,
    /// false: first engine of the pairing is White; true: colours reversed.
    pub reversed: bool,
    /// 1-based opening index passed to fastchess `start=`.
    pub opening: u32,
    pub white: String,
    pub black: String,
}

impl Job {
    pub fn slot(&self) -> SlotKey {
        SlotKey {
            node: self.node,
            pass: self.pass,
            round: self.round,
            white: self.white.clone(),
            black: self.black.clone(),
        }
    }
    /// Event tag written by fastchess: `<event> node{N} pass{p} r{r}`.
    pub fn event(&self, base: &str) -> String {
        format!("{base} node{} pass{} r{}", self.node, self.pass, self.round)
    }
}

/// Pairings (first engine, second engine) in the order of run_node.py.
pub fn pairings(cfg: &TournamentConfig) -> Vec<(Participant, Participant)> {
    let all: Vec<Participant> = cfg.participants.clone();
    let rr = |v: &[Participant]| {
        let mut out = Vec::new();
        for i in 0..v.len() {
            for k in i + 1..v.len() {
                out.push((v[i].clone(), v[k].clone()));
            }
        }
        out
    };
    match cfg.kind {
        TournamentKind::RoundRobin => rr(&all),
        TournamentKind::Match => rr(&all[..all.len().min(2)]),
        // decided round by round from the results: see `staged`
        TournamentKind::Swiss | TournamentKind::Knockout => Vec::new(),
        TournamentKind::Gauntlet | TournamentKind::MultiGauntlet => {
            let seeds: Vec<Participant> = cfg.seeds().into_iter().cloned().collect();
            let opps: Vec<Participant> = cfg.opponents().into_iter().cloned().collect();
            let mut out = rr(&seeds);
            for s in &seeds {
                for o in &opps {
                    out.push((s.clone(), o.clone()));
                }
            }
            out
        }
    }
}

/// The two participants of a job, first engine of the pairing first (as `game_args` wants).
pub fn job_pair(cfg: &TournamentConfig, job: &Job) -> Option<(Participant, Participant)> {
    let (first, second) = if job.reversed { (&job.black, &job.white) } else { (&job.white, &job.black) };
    let find = |n: &str| cfg.participants.iter().find(|p| p.name == n).cloned();
    Some((find(first)?, find(second)?))
}

/// Opening index of a slot (the run_node.py formula).
pub fn opening_index(cfg: &TournamentConfig, node: u32, pass: u32, pairing: usize, round: u32, n_pair: usize) -> u32 {
    let passes = cfg.passes.max(1);
    let rpp_block = cfg.rounds_per_pass.iter().copied().max().unwrap_or(1);
    let block = (node * passes + (pass - 1)) * n_pair as u32 + pairing as u32;
    cfg.book_start + block * rpp_block + round - 1
}

pub fn rounds_for_node(cfg: &TournamentConfig, node: u32) -> u32 {
    let r = &cfg.rounds_per_pass;
    if r.is_empty() {
        return 0;
    }
    *r.get(node as usize).unwrap_or(r.last().unwrap())
}

/// Every slot of the tournament, in canonical order (Swiss / knockout: the first round,
/// the others depend on the results: `known_jobs`).
pub fn all_jobs(cfg: &TournamentConfig) -> Vec<Job> {
    if cfg.kind.is_dynamic() {
        return staged(cfg, &Results::new()).jobs;
    }
    let pairs = pairings(cfg);
    let n_pair = pairs.len();
    let play = cfg.effective_play_passes();
    let mut v = Vec::new();
    for node in 0..cfg.nodes.len().max(1) as u32 {
        for p in 1..=play {
            for (j, (ea, eb)) in pairs.iter().enumerate() {
                for r in 1..=rounds_for_node(cfg, node) {
                    let opening = opening_index(cfg, node, p, j, r, n_pair);
                    for rev in [false, true] {
                        let (w, b) = if rev { (eb, ea) } else { (ea, eb) };
                        v.push(Job {
                            node,
                            pass: p,
                            pairing: j,
                            round: r,
                            reversed: rev,
                            opening,
                            white: w.name.clone(),
                            black: b.name.clone(),
                        });
                    }
                }
            }
        }
    }
    v
}

/// Games of the tournament (Swiss / knockout: the nominal count, without tiebreaks).
pub fn expected_games(cfg: &TournamentConfig) -> usize {
    if cfg.kind.is_dynamic() {
        return staged(cfg, &Results::new()).expected;
    }
    all_jobs(cfg).len()
}

/// Every slot known so far: all of them for the fixed formats; for Swiss and knockout the
/// rounds already paired from the results.
pub fn known_jobs(cfg: &TournamentConfig, results: &Results) -> Vec<Job> {
    if cfg.kind.is_dynamic() { staged(cfg, results).jobs } else { all_jobs(cfg) }
}

/// Games expected with the results so far (knockout tiebreaks included).
pub fn expected_with(cfg: &TournamentConfig, results: &Results) -> usize {
    if cfg.kind.is_dynamic() { staged(cfg, results).expected } else { all_jobs(cfg).len() }
}

/// Missing slots ordered like run_node.py: games of the pairings that are
/// furthest behind first, round after round.
pub fn build_queue(cfg: &TournamentConfig, done: &HashSet<SlotKey>) -> Vec<Job> {
    build_queue_of(all_jobs(cfg), done)
}

/// `build_queue` over a given set of slots (the known rounds of a Swiss or knockout).
pub fn build_queue_of(jobs: Vec<Job>, done: &HashSet<SlotKey>) -> Vec<Job> {
    let mut groups: HashMap<(u32, u32, usize), (usize, Vec<Job>)> = HashMap::new();
    for job in jobs {
        let e = groups.entry((job.node, job.pass, job.pairing)).or_default();
        if done.contains(&job.slot()) {
            e.0 += 1;
        } else {
            e.1.push(job);
        }
    }
    let mut keyed: Vec<((usize, u32, usize, u32, usize), Job)> = Vec::new();
    for ((node, p, j), (have, missing)) in groups {
        for (k, job) in missing.into_iter().enumerate() {
            keyed.push(((have + k, p, j, node, k), job));
        }
    }
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    keyed.into_iter().map(|(_, j)| j).collect()
}

// ---------------------------------------------------------------- Swiss and knockout

/// Result of every finished game: slot → White's score (1, ½, 0).
pub type Results = HashMap<SlotKey, f64>;

/// Knockout: 2-game tiebreaks played when a match is tied, before the higher seed goes through.
pub const KO_TIEBREAKS: u32 = 3;

/// One match of a Swiss round or of a knockout round (`b` = None: a bye).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct StageMatch {
    pub a: String,
    pub b: Option<String>,
    pub score_a: f64,
    pub score_b: f64,
    pub played: u32,
    pub total: u32,
    pub winner: Option<String>,
    /// Knockout tiebreak pairs played (or scheduled).
    pub tiebreaks: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Stage {
    pub number: u32,
    pub matches: Vec<StageMatch>,
    pub complete: bool,
}

/// Swiss table row.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct StageRow {
    pub name: String,
    pub points: f64,
    pub games: u32,
    pub buchholz: f64,
    pub byes: u32,
    /// Knockout: still in the cup.
    pub alive: bool,
}

/// Rounds of a Swiss or knockout tournament as far as they are known.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct StagesView {
    pub rounds_total: u32,
    pub stages: Vec<Stage>,
    pub table: Vec<StageRow>,
    pub champion: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Staged {
    pub jobs: Vec<Job>,
    pub expected: usize,
    pub finished: bool,
    pub view: StagesView,
}

/// Results of the games of a PGN index.
pub fn results_of(games: impl Iterator<Item = (SlotKey, Option<f64>)>) -> Results {
    games.filter_map(|(k, s)| s.map(|s| (k, s))).collect()
}

fn openings_per_match(cfg: &TournamentConfig) -> u32 {
    cfg.rounds_per_pass.first().copied().filter(|&x| x > 0).unwrap_or((cfg.games_per_pairing / 2).max(1))
}

/// Number of rounds: Swiss = `passes`; knockout = log2 of the bracket.
pub fn stage_count(cfg: &TournamentConfig) -> u32 {
    let n = cfg.participants.len() as u32;
    match cfg.kind {
        TournamentKind::Swiss => cfg.passes.max(1),
        TournamentKind::Knockout => n.max(2).next_power_of_two().trailing_zeros(),
        _ => 1,
    }
}

/// Highest opening a Swiss / knockout can use (book size check).
pub fn last_opening_dynamic(cfg: &TournamentConfig) -> u32 {
    let n = cfg.participants.len() as u32;
    let stride = openings_per_match(cfg) + if cfg.kind == TournamentKind::Knockout { KO_TIEBREAKS } else { 0 };
    cfg.book_start + stage_count(cfg) * n.div_ceil(2) * stride - 1
}

/// Jobs of one match: openings `rounds`, each with both colours (`a` White first).
fn match_jobs(cfg: &TournamentConfig, stage: u32, pairing: usize, a: &str, b: &str, rounds: std::ops::RangeInclusive<u32>) -> Vec<Job> {
    let n = cfg.participants.len() as u32;
    let stride = openings_per_match(cfg) + if cfg.kind == TournamentKind::Knockout { KO_TIEBREAKS } else { 0 };
    let block = (stage - 1) * n.div_ceil(2) + pairing as u32;
    let mut v = Vec::new();
    for r in rounds {
        let opening = cfg.book_start + block * stride + r - 1;
        for rev in [false, true] {
            let (w, bl) = if rev { (b, a) } else { (a, b) };
            v.push(Job { node: 0, pass: stage, pairing, round: r, reversed: rev, opening, white: w.to_string(), black: bl.to_string() });
        }
    }
    v
}

/// (games finished, score of the first engine) of a match.
fn match_score(results: &Results, jobs: &[Job]) -> (u32, f64) {
    let mut done = 0;
    let mut sa = 0.0;
    for j in jobs {
        if let Some(s) = results.get(&j.slot()) {
            done += 1;
            sa += if j.reversed { 1.0 - s } else { *s };
        }
    }
    (done, sa)
}

/// Swiss or knockout rounds known from the results.
pub fn staged(cfg: &TournamentConfig, results: &Results) -> Staged {
    match cfg.kind {
        TournamentKind::Swiss => swiss(cfg, results),
        TournamentKind::Knockout => knockout(cfg, results),
        _ => Staged { jobs: all_jobs(cfg), ..Default::default() },
    }
}

fn swiss(cfg: &TournamentConfig, results: &Results) -> Staged {
    let names: Vec<String> = cfg.participants.iter().map(|p| p.name.clone()).collect();
    let rank: HashMap<&str, usize> = names.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect();
    let n = names.len();
    let opm = openings_per_match(cfg);
    let games_per_match = opm * 2;
    let rounds = stage_count(cfg);
    let mut points: HashMap<String, f64> = names.iter().map(|n| (n.clone(), 0.0)).collect();
    let mut played: HashSet<(String, String)> = HashSet::new();
    let mut byes: HashMap<String, u32> = HashMap::new();
    let key = |a: &str, b: &str| if a < b { (a.to_string(), b.to_string()) } else { (b.to_string(), a.to_string()) };
    let mut out = Staged { view: StagesView { rounds_total: rounds, ..Default::default() }, ..Default::default() };
    if n < 2 {
        return out;
    }
    for s in 1..=rounds {
        // pairs that already have games in this round stay as they are
        let mut fixed: Vec<(String, String)> = Vec::new();
        for k in results.keys().filter(|k| k.pass == s) {
            let (a, b) = if rank.get(k.white.as_str()) < rank.get(k.black.as_str()) { (&k.white, &k.black) } else { (&k.black, &k.white) };
            if rank.contains_key(a.as_str()) && rank.contains_key(b.as_str()) && !fixed.iter().any(|(x, y)| x == a && y == b) {
                fixed.push((a.clone(), b.clone()));
            }
        }
        let (mut pairs, bye) = swiss_pair(&names, &points, &played, &byes, fixed);
        pairs.sort_by_key(|(a, b)| rank[a.as_str()].min(rank[b.as_str()]));
        let mut stage = Stage { number: s, ..Default::default() };
        let mut complete = true;
        for (k, (a, b)) in pairs.iter().enumerate() {
            let jobs = match_jobs(cfg, s, k, a, b, 1..=opm);
            let (done, sa) = match_score(results, &jobs);
            complete &= done as usize == jobs.len();
            stage.matches.push(StageMatch { a: a.clone(), b: Some(b.clone()), score_a: sa, score_b: done as f64 - sa, played: done, total: jobs.len() as u32, winner: None, tiebreaks: 0 });
            out.jobs.extend(jobs);
        }
        if let Some(by) = &bye {
            stage.matches.push(StageMatch { a: by.clone(), b: None, score_a: games_per_match as f64 * 0.5, winner: Some(by.clone()), ..Default::default() });
        }
        stage.complete = complete;
        out.view.stages.push(stage.clone());
        if !complete {
            break;
        }
        for m in &stage.matches {
            *points.get_mut(&m.a).unwrap() += m.score_a;
            match &m.b {
                Some(b) => {
                    *points.get_mut(b).unwrap() += m.score_b;
                    played.insert(key(&m.a, b));
                }
                None => *byes.entry(m.a.clone()).or_default() += 1,
            }
        }
        out.finished = s == rounds;
    }
    let future = rounds as usize - out.view.stages.len();
    out.expected = out.jobs.len() + future * (n / 2) * games_per_match as usize;
    // table: every recorded game and the byes, Buchholz = opponents' points
    let mut pts: HashMap<&str, f64> = names.iter().map(|n| (n.as_str(), 0.0)).collect();
    let mut games: HashMap<&str, u32> = HashMap::new();
    let mut opps: HashMap<&str, Vec<&str>> = HashMap::new();
    for st in &out.view.stages {
        for m in &st.matches {
            *pts.get_mut(m.a.as_str()).unwrap() += m.score_a;
            if let Some(b) = &m.b {
                *pts.get_mut(b.as_str()).unwrap() += m.score_b;
                *games.entry(m.a.as_str()).or_default() += m.played;
                *games.entry(b.as_str()).or_default() += m.played;
                opps.entry(m.a.as_str()).or_default().push(b.as_str());
                opps.entry(b.as_str()).or_default().push(m.a.as_str());
            }
        }
    }
    let mut table: Vec<StageRow> = names
        .iter()
        .map(|nm| StageRow {
            name: nm.clone(),
            points: pts[nm.as_str()],
            games: games.get(nm.as_str()).copied().unwrap_or(0),
            buchholz: opps.get(nm.as_str()).map(|o| o.iter().map(|x| pts[x]).sum()).unwrap_or(0.0),
            byes: byes.get(nm).copied().unwrap_or(0) + out.view.stages.last().filter(|s| !s.complete).map(|s| s.matches.iter().filter(|m| m.b.is_none() && &m.a == nm).count() as u32).unwrap_or(0),
            alive: true,
        })
        .collect();
    table.sort_by(|x, y| y.points.total_cmp(&x.points).then(y.buchholz.total_cmp(&x.buchholz)).then(rank[x.name.as_str()].cmp(&rank[y.name.as_str()])));
    if out.finished {
        out.view.champion = table.first().map(|r| r.name.clone());
    }
    out.view.table = table;
    out
}

/// Pairs of a Swiss round: the pairs already started (`fixed`), a bye for the lowest
/// engine without one (odd number), then score groups paired top half against bottom
/// half (Dutch system), without rematches when possible.
fn swiss_pair(names: &[String], points: &HashMap<String, f64>, played: &HashSet<(String, String)>, byes: &HashMap<String, u32>, fixed: Vec<(String, String)>) -> (Vec<(String, String)>, Option<String>) {
    let rank: HashMap<&str, usize> = names.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect();
    let taken: HashSet<&str> = fixed.iter().flat_map(|(a, b)| [a.as_str(), b.as_str()]).collect();
    let mut pool: Vec<String> = names.iter().filter(|n| !taken.contains(n.as_str())).cloned().collect();
    pool.sort_by(|a, b| points[b].total_cmp(&points[a]).then(rank[a.as_str()].cmp(&rank[b.as_str()])));
    let mut bye = None;
    if pool.len() % 2 == 1 {
        let i = pool.iter().rposition(|p| byes.get(p).copied().unwrap_or(0) == 0).unwrap_or(pool.len() - 1);
        bye = Some(pool.remove(i));
    }
    let met = |a: &str, b: &str| played.contains(&if a < b { (a.to_string(), b.to_string()) } else { (b.to_string(), a.to_string()) });
    fn dfs(pool: &[String], points: &HashMap<String, f64>, met: &dyn Fn(&str, &str) -> bool, strict: bool, budget: &mut u32) -> Option<Vec<(String, String)>> {
        if pool.is_empty() {
            return Some(Vec::new());
        }
        if *budget == 0 {
            return None;
        }
        *budget -= 1;
        let p = &pool[0];
        let rest = &pool[1..];
        // the score group of p: its ideal partner is half the group down (S1 against S2)
        let group: Vec<usize> = (0..rest.len()).filter(|&i| points[&rest[i]] == points[p]).collect();
        let ideal = ((group.len() + 1) / 2).saturating_sub(1) as i64;
        let mut order: Vec<usize> = group.clone();
        order.sort_by_key(|&i| ((group.iter().position(|&g| g == i).unwrap() as i64 - ideal).abs(), i));
        order.extend((0..rest.len()).filter(|i| !group.contains(i)));
        for i in order {
            let q = &rest[i];
            if strict && met(p, q) {
                continue;
            }
            let next: Vec<String> = rest.iter().enumerate().filter(|(k, _)| *k != i).map(|(_, x)| x.clone()).collect();
            if let Some(mut v) = dfs(&next, points, met, strict, budget) {
                v.insert(0, (p.clone(), q.clone()));
                return Some(v);
            }
        }
        None
    }
    let mut budget = 200_000;
    let pairs = dfs(&pool, points, &met, true, &mut budget).or_else(|| {
        let mut b = 200_000;
        dfs(&pool, points, &met, false, &mut b)
    });
    let mut all = fixed;
    for (a, b) in pairs.unwrap_or_default() {
        all.push(if rank[a.as_str()] < rank[b.as_str()] { (a, b) } else { (b, a) });
    }
    (all, bye)
}

/// Standard bracket order of the seeds: 1 meets the last seed, 2 the second-to-last…
/// (8: 1 8 4 5 2 7 3 6), so the best seeds can meet only in the last rounds.
pub fn bracket_order(size: u32) -> Vec<u32> {
    let mut v = vec![1u32];
    while (v.len() as u32) < size {
        let m = v.len() as u32 * 2 + 1;
        v = v.iter().flat_map(|&s| [s, m - s]).collect();
    }
    v
}

fn knockout(cfg: &TournamentConfig, results: &Results) -> Staged {
    let names: Vec<String> = cfg.participants.iter().map(|p| p.name.clone()).collect();
    let n = names.len() as u32;
    let opm = openings_per_match(cfg);
    let rounds = stage_count(cfg);
    let mut out = Staged { view: StagesView { rounds_total: rounds, ..Default::default() }, ..Default::default() };
    if n < 2 {
        return out;
    }
    let seed_of = |x: &str| names.iter().position(|n| n == x).unwrap_or(usize::MAX);
    let mut slots: Vec<Option<String>> = bracket_order(n.next_power_of_two()).into_iter().map(|s| (s <= n).then(|| names[s as usize - 1].clone())).collect();
    let mut matches_known = 0usize;
    let mut eliminated: HashSet<String> = HashSet::new();
    for s in 1..=rounds {
        let mut stage = Stage { number: s, complete: true, ..Default::default() };
        let mut next = Vec::new();
        for k in 0..slots.len() / 2 {
            match (&slots[2 * k], &slots[2 * k + 1]) {
                (Some(a), None) | (None, Some(a)) => {
                    stage.matches.push(StageMatch { a: a.clone(), winner: Some(a.clone()), ..Default::default() });
                    next.push(Some(a.clone()));
                }
                (None, None) => next.push(None),
                (Some(a), Some(b)) => {
                    matches_known += 1;
                    let mut jobs = match_jobs(cfg, s, k, a, b, 1..=opm);
                    let (mut done, mut sa) = match_score(results, &jobs);
                    let mut tb = 0;
                    let mut winner = None;
                    while done as usize == jobs.len() {
                        let sb = done as f64 - sa;
                        if sa != sb {
                            winner = Some(if sa > sb { a.clone() } else { b.clone() });
                            break;
                        }
                        if tb == KO_TIEBREAKS {
                            // still level: the higher seed goes through
                            winner = Some(if seed_of(a) < seed_of(b) { a.clone() } else { b.clone() });
                            break;
                        }
                        tb += 1;
                        jobs.extend(match_jobs(cfg, s, k, a, b, opm + tb..=opm + tb));
                        (done, sa) = match_score(results, &jobs);
                    }
                    if winner.is_none() {
                        stage.complete = false;
                    }
                    if let Some(w) = &winner {
                        eliminated.insert(if w == a { b.clone() } else { a.clone() });
                    }
                    stage.matches.push(StageMatch { a: a.clone(), b: Some(b.clone()), score_a: sa, score_b: done as f64 - sa, played: done, total: jobs.len() as u32, winner: winner.clone(), tiebreaks: tb });
                    out.jobs.extend(jobs);
                    next.push(winner);
                }
            }
        }
        let complete = stage.complete;
        out.view.stages.push(stage);
        if !complete {
            break;
        }
        slots = next;
        if s == rounds {
            out.finished = true;
            out.view.champion = slots.first().cloned().flatten();
        }
    }
    let future_matches = (n as usize - 1).saturating_sub(matches_known);
    out.expected = out.jobs.len() + future_matches * opm as usize * 2;
    let mut table: Vec<StageRow> = names.iter().map(|nm| StageRow { name: nm.clone(), alive: !eliminated.contains(nm), ..Default::default() }).collect();
    // furthest round reached (byes count), to rank the engines knocked out
    let mut reached: HashMap<String, u32> = HashMap::new();
    for st in &out.view.stages {
        for m in &st.matches {
            for x in std::iter::once(&m.a).chain(m.b.iter()) {
                reached.insert(x.clone(), st.number);
            }
        }
    }
    for st in &out.view.stages {
        for m in &st.matches {
            if let Some(b) = &m.b {
                for (who, pts) in [(&m.a, m.score_a), (b, m.score_b)] {
                    let r = table.iter_mut().find(|r| &r.name == who).unwrap();
                    r.points += pts;
                    r.games += m.played;
                }
            } else {
                table.iter_mut().find(|r| r.name == m.a).unwrap().byes += 1;
            }
        }
    }
    table.sort_by(|x, y| {
        y.alive
            .cmp(&x.alive)
            .then(reached.get(&y.name).cmp(&reached.get(&x.name)))
            .then(y.points.total_cmp(&x.points))
            .then(seed_of(&x.name).cmp(&seed_of(&y.name)))
    });
    out.view.table = table;
    out
}

/// Global queue shared by all lanes. A lane prefers slots of its own opening
/// partition and steals from the others when its own are exhausted, so every
/// lane stays busy until the very end (pitfall 9).
#[derive(Debug, Default)]
pub struct Queue {
    pub jobs: Vec<Job>,
    pub in_flight: HashSet<SlotKey>,
    pub attempts: HashMap<SlotKey, u32>,
    pub max_attempts: u32,
}

impl Queue {
    pub fn new(jobs: Vec<Job>, max_attempts: u32) -> Self {
        Queue { jobs, in_flight: HashSet::new(), attempts: HashMap::new(), max_attempts }
    }
    pub fn next_for(&mut self, home_node: Option<u32>, done: &HashSet<SlotKey>) -> Option<Job> {
        // drop slots finished meanwhile
        self.jobs.retain(|j| !done.contains(&j.slot()));
        let pick = |q: &Queue, own: bool| {
            q.jobs.iter().position(|j| {
                !q.in_flight.contains(&j.slot()) && (!own || Some(j.node) == home_node)
            })
        };
        let idx = pick(self, true).or_else(|| pick(self, false))?;
        let job = self.jobs.remove(idx);
        self.in_flight.insert(job.slot());
        *self.attempts.entry(job.slot()).or_default() += 1;
        Some(job)
    }
    /// Marks a job as finished (recorded or not). Unrecorded jobs are put back
    /// at the end of the queue until `max_attempts` is reached.
    pub fn complete(&mut self, job: &Job, recorded: bool) -> bool {
        self.in_flight.remove(&job.slot());
        if recorded {
            return true;
        }
        let a = self.attempts.get(&job.slot()).copied().unwrap_or(0);
        if a < self.max_attempts {
            self.jobs.push(job.clone());
        }
        false
    }
    /// Puts a job back at the front (a game discarded by pause/stop).
    pub fn requeue_front(&mut self, job: &Job) {
        self.in_flight.remove(&job.slot());
        if let Some(a) = self.attempts.get_mut(&job.slot()) {
            *a = a.saturating_sub(1);
        }
        self.jobs.insert(0, job.clone());
    }
    pub fn remaining(&self) -> usize {
        self.jobs.len() + self.in_flight.len()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::model::*;
    use std::collections::BTreeMap;

    pub fn part(name: &str, role: Role) -> Participant {
        Participant {
            name: name.into(),
            cmd: format!("/engines/{name}"),
            dir: "/engines".into(),
            args: String::new(),
            options: BTreeMap::new(),
            role,
            engine_id: None,
            has_syzygy: false,
            uci_id: None,
            rating: None,
            rating_estimated: false,
        }
    }

    pub fn cfg(kind: TournamentKind, seeds: &[&str], opps: &[&str], games: u32, passes: u32, nodes: u32) -> TournamentConfig {
        let mut participants: Vec<Participant> = seeds.iter().map(|s| part(s, Role::Seed)).collect();
        participants.extend(opps.iter().map(|s| part(s, Role::Opponent)));
        TournamentConfig {
            name: "t".into(),
            kind,
            participants,
            games_per_pairing: games,
            passes,
            play_passes: None,
            nodes: (0..nodes).collect(),
            rounds_per_pass: rounds_per_pass_for(kind, games, passes, nodes).unwrap(),
            lanes_per_node: 2,
            concurrency: 1,
            threads: 1,
            hash_mb: 16,
            tc: "1+0.01".into(),
            book: "book.pgn".into(),
            book_format: "pgn".into(),
            book_start: 1,
            event: "Test".into(),
            site: "Here".into(),
            syzygy_path: String::new(),
            adjudication: Adjudication::default(),
            extra_args: vec![],
            placement: Placement::None,
            log_level: "info".into(),
            ccrl_list: "Blitz".into(),
            max_retries: 2,
            max_slot_attempts: 3,
            fastchess: String::new(),
            startup_ms: 60000,
            variant: crate::model::Variant::Standard,
        }
    }

    #[test]
    fn caissa_opening_formula() {
        // README of the Caissa gauntlet: start = 1 + ((node*2 + pass-1) * 19 + opp) * 5
        let opps: Vec<String> = (0..19).map(|i| format!("O{i}")).collect();
        let o: Vec<&str> = opps.iter().map(|s| s.as_str()).collect();
        let c = cfg(TournamentKind::Gauntlet, &["Caissa"], &o, 40, 2, 2);
        assert_eq!(c.rounds_per_pass, vec![5, 5]);
        for node in 0..2 {
            for p in 1..=2 {
                for j in 0..19usize {
                    let expect = 1 + ((node * 2 + p - 1) * 19 + j as u32) * 5;
                    assert_eq!(opening_index(&c, node, p, j, 1, 19), expect);
                }
            }
        }
        // node 0 uses openings 1-190, node 1 191-380
        let jobs = all_jobs(&c);
        let n0: HashSet<u32> = jobs.iter().filter(|j| j.node == 0).map(|j| j.opening).collect();
        assert_eq!(*n0.iter().min().unwrap(), 1);
        assert_eq!(*n0.iter().max().unwrap(), 190);
        assert_eq!(jobs.len(), 19 * 40);
    }

    #[test]
    fn openings_disjoint_and_played_twice() {
        let c = cfg(TournamentKind::Gauntlet, &["T"], &["A", "B", "C"], 30, 1, 2);
        assert_eq!(c.rounds_per_pass, vec![8, 7]);
        let jobs = all_jobs(&c);
        assert_eq!(jobs.len(), 90);
        let mut count: HashMap<u32, Vec<&Job>> = HashMap::new();
        for j in &jobs {
            count.entry(j.opening).or_default().push(j);
        }
        for (_, v) in count {
            // every opening exactly twice, same pairing, reversed colours
            assert_eq!(v.len(), 2);
            assert_eq!(v[0].pairing, v[1].pairing);
            assert_eq!(v[0].white, v[1].black);
        }
        // RPP_BLOCK = 8 spacing even for node 1 which plays 7
        assert_eq!(opening_index(&c, 1, 1, 0, 1, 3), 1 + 3 * 8);
    }

    #[test]
    fn multi_seed_pairings() {
        let c = cfg(TournamentKind::MultiGauntlet, &["S1", "S2"], &["A", "B", "C"], 2, 1, 1);
        let p = pairings(&c);
        let names: Vec<String> = p.iter().map(|(a, b)| format!("{}-{}", a.name, b.name)).collect();
        assert_eq!(names, vec!["S1-S2", "S1-A", "S1-B", "S1-C", "S2-A", "S2-B", "S2-C"]);
        let rr = cfg(TournamentKind::RoundRobin, &["S1"], &["A", "B", "C"], 2, 1, 1);
        assert_eq!(pairings(&rr).len(), 6);
    }

    #[test]
    fn queue_skips_done_and_orders_lagging_first() {
        let c = cfg(TournamentKind::Gauntlet, &["T"], &["A", "B"], 4, 1, 1);
        let jobs = all_jobs(&c);
        let mut done = HashSet::new();
        // A already has 3 games, B none
        for j in jobs.iter().filter(|j| j.pairing == 0).take(3) {
            done.insert(j.slot());
        }
        let q = build_queue(&c, &done);
        assert_eq!(q.len(), 5);
        // first queued games are B's (have 0), A's single missing game comes after B has caught up
        assert_eq!(q[0].pairing, 1);
        assert_eq!(q[1].pairing, 1);
        assert_eq!(q[2].pairing, 1);
        let pos_a = q.iter().position(|j| j.pairing == 0).unwrap();
        assert_eq!(pos_a, 3);
    }

    #[test]
    fn queue_work_stealing_and_retry() {
        let c = cfg(TournamentKind::Gauntlet, &["T"], &["A"], 4, 1, 2);
        let mut q = Queue::new(build_queue(&c, &HashSet::new()), 2);
        let done = HashSet::new();
        let a = q.next_for(Some(1), &done).unwrap();
        assert_eq!(a.node, 1);
        let b = q.next_for(Some(1), &done).unwrap();
        assert_eq!(b.node, 1);
        // node 1 exhausted -> steals node 0 work
        let s = q.next_for(Some(1), &done).unwrap();
        assert_eq!(s.node, 0);
        // failed game goes back once, then is dropped after max attempts
        assert!(!q.complete(&s, false));
        assert_eq!(q.jobs.last().unwrap(), &s);
        let again = q.jobs.pop().unwrap();
        q.jobs.insert(0, again);
        let s2 = q.next_for(Some(0), &done).unwrap();
        assert_eq!(s2, s);
        q.complete(&s2, false);
        assert!(!q.jobs.contains(&s));
    }

    #[test]
    fn play_passes_limits() {
        let mut c = cfg(TournamentKind::Gauntlet, &["C"], &["A", "B"], 40, 2, 2);
        c.play_passes = Some(1);
        assert_eq!(expected_games(&c), 2 * 20);
    }

    fn dyn_cfg(kind: TournamentKind, n: usize, games: u32, rounds: u32) -> TournamentConfig {
        let names: Vec<String> = (1..=n).map(|i| format!("E{i:02}")).collect();
        let refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
        let mut c = cfg(kind, &[], &refs, games, rounds, 1);
        c.participants[0].role = Role::Seed;
        c
    }

    /// Plays every known game with `outcome` until nothing new appears.
    fn play(c: &TournamentConfig, outcome: impl Fn(&Job) -> f64) -> (Results, Staged) {
        let mut results = Results::new();
        loop {
            let st = staged(c, &results);
            let missing: Vec<Job> = st.jobs.iter().filter(|j| !results.contains_key(&j.slot())).cloned().collect();
            if missing.is_empty() {
                return (results, st);
            }
            for j in missing {
                results.insert(j.slot(), outcome(&j));
            }
        }
    }

    /// The engine listed first is stronger: it wins with White and draws with Black.
    fn stronger_wins(j: &Job) -> f64 {
        if j.white < j.black { 1.0 } else { 0.5 }
    }

    #[test]
    fn swiss_rounds_are_paired_from_the_results() {
        let c = dyn_cfg(TournamentKind::Swiss, 6, 2, 3);
        assert_eq!(expected_games(&c), 3 * 3 * 2);
        let r1 = staged(&c, &Results::new());
        assert_eq!(r1.view.stages.len(), 1);
        let p1: Vec<(String, String)> = r1.view.stages[0].matches.iter().map(|m| (m.a.clone(), m.b.clone().unwrap())).collect();
        // top half against bottom half
        assert_eq!(p1, vec![("E01".into(), "E04".into()), ("E02".into(), "E05".into()), ("E03".into(), "E06".into())]);
        let (results, st) = play(&c, stronger_wins);
        assert!(st.finished);
        assert_eq!(st.jobs.len(), 18);
        assert_eq!(results.len(), 18);
        assert_eq!(st.expected, 18);
        // no rematch in 3 rounds of 6 engines
        let mut seen = HashSet::new();
        for s in &st.view.stages {
            for m in &s.matches {
                let b = m.b.clone().unwrap();
                assert!(seen.insert(if m.a < b { (m.a.clone(), b) } else { (b, m.a.clone()) }), "rematch in round {}", s.number);
            }
        }
        assert_eq!(st.view.champion.as_deref(), Some("E01"));
        assert_eq!(st.view.table[0].points, 4.5);
        // every opening different
        let openings: HashSet<u32> = st.jobs.iter().map(|j| j.opening).collect();
        assert_eq!(openings.len(), 9);
        // a round half played keeps its pairs
        let r2_partial: Results = results.iter().filter(|(k, _)| k.pass == 1 || (k.pass == 2 && k.white == "E01")).map(|(k, v)| (k.clone(), *v)).collect();
        let again = staged(&c, &r2_partial);
        let pairs = |s: &Stage| s.matches.iter().map(|m| (m.a.clone(), m.b.clone())).collect::<Vec<_>>();
        assert_eq!(pairs(&again.view.stages[1]), pairs(&st.view.stages[1]));
        assert!(!again.view.stages[1].complete);
    }

    #[test]
    fn swiss_with_an_odd_number_gives_each_bye_once() {
        let c = dyn_cfg(TournamentKind::Swiss, 5, 2, 4);
        let (_, st) = play(&c, |j| if j.round == 1 && !j.reversed { 1.0 } else { 0.5 });
        assert!(st.finished);
        let byes: Vec<String> = st.view.stages.iter().map(|s| s.matches.iter().find(|m| m.b.is_none()).unwrap().a.clone()).collect();
        let distinct: HashSet<&String> = byes.iter().collect();
        assert_eq!(distinct.len(), 4, "{byes:?}");
        // a bye is worth a drawn match
        assert_eq!(st.view.table.iter().map(|r| r.byes).sum::<u32>(), 4);
        assert_eq!(st.jobs.len(), 4 * 2 * 2);
    }

    #[test]
    fn knockout_bracket_and_tiebreaks() {
        assert_eq!(bracket_order(8), vec![1, 8, 4, 5, 2, 7, 3, 6]);
        let c = dyn_cfg(TournamentKind::Knockout, 5, 2, 1);
        assert_eq!(stage_count(&c), 3);
        assert_eq!(expected_games(&c), 4 * 2);
        let r1 = staged(&c, &Results::new());
        // 5 engines in a bracket of 8: three byes for the best seeds, E04 - E05 plays
        assert_eq!(r1.jobs.len(), 2);
        assert_eq!(r1.view.stages[0].matches.iter().filter(|m| m.b.is_none()).count(), 3);
        let (_, st) = play(&c, stronger_wins);
        assert!(st.finished);
        assert_eq!(st.view.champion.as_deref(), Some("E01"));
        assert_eq!(st.jobs.len(), 8);
        assert!(st.view.table.iter().filter(|r| r.alive).count() == 1);
        assert_eq!(st.view.table[0].name, "E01");
        assert_eq!(st.view.table[1].name, "E02", "the losing finalist is second");
        // every match drawn: 3 tiebreak pairs, then the higher seed
        let (_, draws) = play(&c, |_| 0.5);
        assert!(draws.finished);
        assert_eq!(draws.view.champion.as_deref(), Some("E01"));
        assert!(draws.view.stages.iter().flat_map(|s| s.matches.iter()).filter(|m| m.b.is_some()).all(|m| m.tiebreaks == KO_TIEBREAKS && m.played == 8));
        assert_eq!(draws.jobs.len(), 4 * 8);
        // a tie broken in the first tiebreak
        let (_, tb) = play(&c, |j| if j.round == 2 && !j.reversed { 1.0 } else { 0.5 });
        assert!(tb.view.stages.iter().flat_map(|s| s.matches.iter()).filter(|m| m.b.is_some()).all(|m| m.tiebreaks == 1 && m.played == 4));
        let openings: HashSet<u32> = draws.jobs.iter().map(|j| j.opening).collect();
        assert_eq!(openings.len(), draws.jobs.len() / 2);
    }
}
