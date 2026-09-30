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

/// Every slot of the tournament, in canonical order.
pub fn all_jobs(cfg: &TournamentConfig) -> Vec<Job> {
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

pub fn expected_games(cfg: &TournamentConfig) -> usize {
    all_jobs(cfg).len()
}

/// Missing slots ordered like run_node.py: games of the pairings that are
/// furthest behind first, round after round.
pub fn build_queue(cfg: &TournamentConfig, done: &HashSet<SlotKey>) -> Vec<Job> {
    let mut groups: HashMap<(u32, u32, usize), (usize, Vec<Job>)> = HashMap::new();
    for job in all_jobs(cfg) {
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
            rounds_per_pass: split_openings(games, passes, nodes).unwrap(),
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
}
