//! Tournament configuration shared by the GUI, the runner and the store.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TournamentKind {
    /// One seed against N opponents.
    Gauntlet,
    /// Seeds play each other round robin and every seed plays every anchor;
    /// anchors do not play each other.
    MultiGauntlet,
    RoundRobin,
    /// Exactly two engines.
    Match,
    /// Swiss system: every round pairs engines with the same score (no rematches); the
    /// next round is paired when the current one is finished. `passes` = number of rounds.
    Swiss,
    /// Knockout cup: seeded bracket, each match is a mini-match of `games_per_pairing`
    /// games; a tie goes to 2-game tiebreaks, then to the higher seed.
    Knockout,
}

impl TournamentKind {
    /// Pairings that depend on the results (decided round by round).
    pub fn is_dynamic(self) -> bool {
        matches!(self, TournamentKind::Swiss | TournamentKind::Knockout)
    }
}

/// Chess variant of a tournament.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Variant {
    #[default]
    Standard,
    /// Fischer Random / Chess960 (also double Chess960 books): fastchess `-variant
    /// fischerandom`, engines get `UCI_Chess960 true`, openings are start positions (EPD).
    Chess960,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Role {
    Seed,
    Opponent,
}

/// An engine as it takes part in a tournament (a snapshot: later edits of the
/// library entry never change a running tournament).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Participant {
    /// Player name written in the PGN (White/Black tags).
    pub name: String,
    pub cmd: String,
    pub dir: String,
    /// Extra command-line arguments for the engine (fastchess `args=`).
    #[serde(default)]
    pub args: String,
    /// UCI options. `${THREADS}` and `${HASH}` are substituted at launch.
    pub options: BTreeMap<String, String>,
    pub role: Role,
    #[serde(default)]
    pub engine_id: Option<i64>,
    #[serde(default)]
    pub has_syzygy: bool,
    #[serde(default)]
    pub uci_id: Option<String>,
    /// CCRL list rating used for ordering and statistics.
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub rating_estimated: bool,
    /// Threads of this engine when they differ from the tournament's (an 8CPU seed against
    /// 1CPU opponents).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threads: Option<u32>,
    /// Hash (MB) of this engine when it differs from the tournament's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_mb: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Adjudication {
    pub draw_enabled: bool,
    pub draw_movenumber: u32,
    pub draw_movecount: u32,
    pub draw_score: u32,
    pub resign_enabled: bool,
    pub resign_movecount: u32,
    pub resign_score: u32,
    pub resign_twosided: bool,
    /// fastchess `-tb` adjudication (off by default, like the reference setup).
    pub tb_enabled: bool,
    pub tb_pieces: u32,
}

impl Default for Adjudication {
    fn default() -> Self {
        Adjudication {
            draw_enabled: true,
            draw_movenumber: 35,
            draw_movecount: 8,
            draw_score: 10,
            resign_enabled: true,
            resign_movecount: 4,
            resign_score: 600,
            resign_twosided: true,
            tb_enabled: false,
            tb_pieces: 5,
        }
    }
}

impl Adjudication {
    pub fn args(&self, syzygy: &str) -> Vec<String> {
        let mut a = Vec::new();
        if self.draw_enabled {
            a.extend([
                "-draw".into(),
                format!("movenumber={}", self.draw_movenumber),
                format!("movecount={}", self.draw_movecount),
                format!("score={}", self.draw_score),
            ]);
        }
        if self.resign_enabled {
            a.extend([
                "-resign".into(),
                format!("movecount={}", self.resign_movecount),
                format!("score={}", self.resign_score),
            ]);
            if self.resign_twosided {
                a.push("twosided=true".into());
            }
        }
        if self.tb_enabled && !syzygy.is_empty() {
            a.extend([
                "-tb".into(),
                syzygy.to_string(),
                "-tbpieces".into(),
                self.tb_pieces.to_string(),
                "-tbadjudicate".into(),
                "BOTH".into(),
            ]);
        }
        a
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Placement {
    /// Every lane of a node shares the node's "one logical CPU per physical core" set
    /// (the reference workflow).
    Node,
    /// Each lane gets a disjoint set of physical cores inside its node.
    Lane,
    /// No affinity / Job Object (debugging, non-NUMA machines).
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct TournamentConfig {
    pub name: String,
    pub kind: TournamentKind,
    pub participants: Vec<Participant>,
    /// Games per pairing (even: every opening is played with both colours).
    pub games_per_pairing: u32,
    /// Passes over all pairings: the openings of pass 2 follow those of pass 1,
    /// so stopping after a pass keeps the result balanced.
    pub passes: u32,
    /// Passes actually played (<= passes). Lets a tournament be cut short
    /// without moving the openings already assigned.
    #[serde(default)]
    pub play_passes: Option<u32>,
    /// NUMA nodes (opening partitions) used.
    pub nodes: Vec<u32>,
    /// Openings per pairing, per pass, per node (derived by `split_openings`,
    /// e.g. [8, 7] for 15 openings on 2 nodes).
    pub rounds_per_pass: Vec<u32>,
    pub lanes_per_node: u32,
    /// Games inside one fastchess process: always 1 in TorsGUI.
    #[serde(default = "one")]
    pub concurrency: u32,
    pub threads: u32,
    pub hash_mb: u32,
    /// fastchess time control, e.g. "103+1", "1690+19", "40/900+10".
    pub tc: String,
    pub book: String,
    #[serde(default = "pgn_fmt")]
    pub book_format: String,
    #[serde(default = "one")]
    pub book_start: u32,
    /// One random opening per game (no colour-reversed pairs): fastchess `order=random`
    /// with `-srand opening_seed`, so a game keeps its opening when the tournament resumes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub random_openings: bool,
    #[serde(default)]
    pub opening_seed: u32,
    pub event: String,
    pub site: String,
    #[serde(default)]
    pub syzygy_path: String,
    #[serde(default)]
    pub adjudication: Adjudication,
    #[serde(default)]
    pub extra_args: Vec<String>,
    #[serde(default = "placement_node")]
    pub placement: Placement,
    #[serde(default = "info")]
    pub log_level: String,
    /// CCRL list the tournament is meant for ("Blitz", "40/15").
    #[serde(default)]
    pub ccrl_list: String,
    /// Maximum automatic retries when the tournament ends cleanly with games missing.
    #[serde(default = "two")]
    pub max_retries: u32,
    /// Attempts per slot within one runner session before giving up on it.
    #[serde(default = "three")]
    pub max_slot_attempts: u32,
    /// fastchess binary override (empty = the managed one).
    #[serde(default)]
    pub fastchess: String,
    #[serde(default = "startup_ms")]
    pub startup_ms: u32,
    #[serde(default)]
    pub variant: Variant,
}

fn one() -> u32 {
    1
}
fn two() -> u32 {
    2
}
fn three() -> u32 {
    3
}
fn startup_ms() -> u32 {
    60000
}
fn pgn_fmt() -> String {
    "pgn".into()
}
fn info() -> String {
    "info".into()
}
fn placement_node() -> Placement {
    Placement::Node
}

/// The heaviest pairing: the largest value of `of` among seeds plus the largest among
/// opponents (a gauntlet), else the two largest overall; `default` when nobody is there.
fn heaviest_pair(kind: TournamentKind, participants: &[Participant], of: impl Fn(&Participant) -> u32, default: u32) -> u32 {
    let gauntlet = matches!(kind, TournamentKind::Gauntlet | TournamentKind::MultiGauntlet);
    let seeds = participants.iter().filter(|p| p.role == Role::Seed).map(&of).max();
    let opps = participants.iter().filter(|p| p.role == Role::Opponent).map(&of).max();
    if let (true, Some(s), Some(o)) = (gauntlet, seeds, opps) {
        return s + o;
    }
    let mut all: Vec<u32> = participants.iter().map(&of).collect();
    all.sort_unstable_by(|a, b| b.cmp(a));
    match all.len() {
        0 => 2 * default,
        1 => 2 * all[0],
        _ => all[0] + all[1],
    }
}

/// "8CPU", or "8CPU vs 1CPU" for a gauntlet whose seeds and opponents differ (the CCRL
/// Blitz list is built that way).
pub fn cpu_label(participants: &[Participant], threads: u32) -> String {
    let t = |p: &Participant| p.threads.unwrap_or(threads).max(1);
    if participants.iter().all(|p| t(p) == threads) {
        return format!("{threads}CPU");
    }
    let mut seeds: Vec<u32> = participants.iter().filter(|p| p.role == Role::Seed).map(t).collect();
    let mut opps: Vec<u32> = participants.iter().filter(|p| p.role == Role::Opponent).map(t).collect();
    seeds.sort_unstable();
    seeds.dedup();
    opps.sort_unstable();
    opps.dedup();
    let join = |v: &[u32]| v.iter().map(|t| format!("{t}CPU")).collect::<Vec<_>>().join("/");
    if seeds.is_empty() || opps.is_empty() {
        let mut all = seeds;
        all.extend(opps);
        all.sort_unstable();
        all.dedup();
        return join(&all);
    }
    format!("{} vs {}", join(&seeds), join(&opps))
}

/// Physical cores one lane needs: the two engines of the heaviest possible pairing.
pub fn cores_per_lane(kind: TournamentKind, participants: &[Participant], threads: u32) -> u32 {
    heaviest_pair(kind, participants, |p| p.threads.unwrap_or(threads).max(1), threads.max(1)).max(2)
}

impl TournamentConfig {
    /// Threads of a participant: its own, else the tournament's.
    pub fn threads_of(&self, p: &Participant) -> u32 {
        p.threads.unwrap_or(self.threads).max(1)
    }
    pub fn hash_of(&self, p: &Participant) -> u32 {
        p.hash_mb.unwrap_or(self.hash_mb)
    }
    pub fn threads_of_name(&self, name: &str) -> u32 {
        self.participant(name).map(|p| self.threads_of(p)).unwrap_or(self.threads)
    }
    /// Whether the participants do not all run with the same number of threads.
    pub fn mixed_cpus(&self) -> bool {
        self.participants.iter().any(|p| self.threads_of(p) != self.threads)
    }
    pub fn cpu_label(&self) -> String {
        cpu_label(&self.participants, self.threads)
    }
    pub fn cores_per_lane(&self) -> u32 {
        cores_per_lane(self.kind, &self.participants, self.threads)
    }
    /// Hash in MB the engines of one lane take together (the heaviest pairing).
    pub fn hash_per_lane(&self) -> u32 {
        heaviest_pair(self.kind, &self.participants, |p| self.hash_of(p), self.hash_mb)
    }
    pub fn seeds(&self) -> Vec<&Participant> {
        self.participants.iter().filter(|p| p.role == Role::Seed).collect()
    }
    pub fn opponents(&self) -> Vec<&Participant> {
        self.participants.iter().filter(|p| p.role == Role::Opponent).collect()
    }
    pub fn participant(&self, name: &str) -> Option<&Participant> {
        self.participants.iter().find(|p| p.name == name)
    }
    pub fn effective_play_passes(&self) -> u32 {
        self.play_passes.unwrap_or(self.passes).clamp(1, self.passes.max(1))
    }
    pub fn syzygy_pieces(&self) -> u32 {
        let base = std::path::Path::new(&self.syzygy_path.replace('\\', "/"))
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        base.chars().filter_map(|c| c.to_digit(10)).max().unwrap_or(0)
    }
    pub fn book_name(&self) -> String {
        let p = self.book.replace('\\', "/");
        let base = p.rsplit('/').next().unwrap_or("").to_string();
        match base.rsplit_once('.') {
            Some((stem, _)) => stem.to_string(),
            None => base,
        }
    }
}

/// Splits the openings of one pairing over passes and nodes.
/// Returns `rounds_per_pass` (one entry per node) or an error when the number
/// of games is not a multiple of `passes x 2`.
/// Openings per pairing for a kind: Swiss and knockout rounds use one block per match
/// (`passes` is the number of Swiss rounds there, not a split of the openings).
pub fn rounds_per_pass_for(kind: TournamentKind, games_per_pairing: u32, passes: u32, nodes: u32) -> Result<Vec<u32>, String> {
    if kind.is_dynamic() {
        if games_per_pairing == 0 || games_per_pairing % 2 != 0 {
            return Err(format!("games per match ({games_per_pairing}) must be even and > 0: every opening is played with both colours"));
        }
        return Ok(vec![games_per_pairing / 2]);
    }
    split_openings(games_per_pairing, passes, nodes)
}

pub fn split_openings(games_per_pairing: u32, passes: u32, nodes: u32) -> Result<Vec<u32>, String> {
    if games_per_pairing == 0 || games_per_pairing % 2 != 0 {
        return Err(format!("games per pairing ({games_per_pairing}) must be even and > 0: every opening is played with both colours"));
    }
    let passes = passes.max(1);
    if games_per_pairing % (passes * 2) != 0 {
        return Err(format!(
            "games per pairing ({games_per_pairing}) must be a multiple of passes x 2 ({})",
            passes * 2
        ));
    }
    let openings = games_per_pairing / (passes * 2);
    let nodes = nodes.max(1);
    if openings < nodes {
        return Err(format!("{openings} openings per pass cannot be split over {nodes} nodes"));
    }
    let base = openings / nodes;
    let extra = openings % nodes;
    Ok((0..nodes).map(|i| base + if i < extra { 1 } else { 0 }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split() {
        assert_eq!(split_openings(30, 1, 2).unwrap(), vec![8, 7]);
        assert_eq!(split_openings(40, 2, 2).unwrap(), vec![5, 5]);
        assert_eq!(split_openings(20, 1, 2).unwrap(), vec![5, 5]);
        assert!(split_openings(31, 1, 2).is_err());
        assert!(split_openings(30, 2, 2).is_err());
        assert_eq!(split_openings(10, 1, 1).unwrap(), vec![5]);
    }
    #[test]
    fn adjudication_args() {
        let a = Adjudication::default().args("");
        assert_eq!(
            a.join(" "),
            "-draw movenumber=35 movecount=8 score=10 -resign movecount=4 score=600 twosided=true"
        );
    }
}

#[cfg(test)]
mod cpu_tests {
    use super::*;

    fn p(name: &str, role: Role, threads: Option<u32>) -> Participant {
        Participant { name: name.into(), cmd: String::new(), dir: String::new(), args: String::new(), options: Default::default(), role, engine_id: None, has_syzygy: false, uci_id: None, rating: None, rating_estimated: false, threads, hash_mb: None }
    }

    #[test]
    fn mixed_cpu_tournaments() {
        let v = vec![p("Seed", Role::Seed, Some(8)), p("A", Role::Opponent, None), p("B", Role::Opponent, None)];
        assert_eq!(cpu_label(&v, 1), "8CPU vs 1CPU");
        assert_eq!(cores_per_lane(TournamentKind::Gauntlet, &v, 1), 9);
        let same = vec![p("Seed", Role::Seed, None), p("A", Role::Opponent, None)];
        assert_eq!(cpu_label(&same, 4), "4CPU");
        assert_eq!(cores_per_lane(TournamentKind::Gauntlet, &same, 4), 8);
        let rr = vec![p("A", Role::Seed, Some(4)), p("B", Role::Opponent, Some(2)), p("C", Role::Opponent, Some(1))];
        assert_eq!(cores_per_lane(TournamentKind::RoundRobin, &rr, 1), 6);
        assert_eq!(cpu_label(&rr, 1), "4CPU vs 1CPU/2CPU");
        assert_eq!(cores_per_lane(TournamentKind::Gauntlet, &[], 2), 4);
    }
}
