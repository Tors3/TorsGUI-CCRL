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
    /// Withdrawn from the tournament: its games still to play are dropped (the other pairings
    /// keep their openings), and its games are left out of the CCRL export by default.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub withdrawn: bool,
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
    /// Pieces of the largest Syzygy table found (KQvKR.rtbw = 5): read from the files, else
    /// guessed from the folder name ("3-4-5" = 5) when the folder cannot be read.
    pub fn syzygy_pieces(&self) -> u32 {
        let (_, found) = syzygy_resolve(&self.syzygy_path);
        if found > 0 {
            return found;
        }
        let base = std::path::Path::new(&self.syzygy_path.replace('\\', "/"))
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        base.chars().filter_map(|c| c.to_digit(10)).max().unwrap_or(0)
    }
    /// CCRL hash for `threads` threads on the tournament's list (see `ccrl_hash_mb`).
    pub fn ccrl_hash(&self, threads: u32) -> u32 {
        ccrl_hash_mb(&self.ccrl_list, threads, 256, 512)
    }
    /// The Syzygy path given to the engines and fastchess (see `syzygy_resolve`).
    pub fn syzygy_effective(&self) -> String {
        syzygy_resolve(&self.syzygy_path).0
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

/// Is this the CCRL Blitz list (the default when none is set)?
pub fn is_blitz(list: &str) -> bool {
    list.trim().is_empty() || list.trim().eq_ignore_ascii_case("blitz")
}

/// CCRL hash in MB: Blitz `blitz_per` x threads (256 at 1CPU, 2048 at 8CPU); the longer lists
/// `other_per` x threads, at least twice `other_per` (1024 at 1CPU, 4096 at 8CPU).
pub fn ccrl_hash_mb(list: &str, threads: u32, blitz_per: u32, other_per: u32) -> u32 {
    let t = threads.max(1);
    if is_blitz(list) {
        blitz_per * t
    } else {
        (other_per * t).max(other_per * 2)
    }
}

/// Separator of a Syzygy path list (as engines and Fathom read it).
pub const SYZYGY_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// The folders of a Syzygy path that hold tables, and the pieces of the largest table. A
/// folder without tables but with sub-folders that have them (`syzygy` → `3-4-5`, `6-wdl`,
/// `6-dtz`) is replaced by those sub-folders (two levels down): engines do not look inside
/// sub-folders. A path that cannot be read is kept as it is.
pub fn syzygy_resolve(path: &str) -> (String, u32) {
    use std::path::{Path, PathBuf};
    fn pieces(dir: &Path) -> u32 {
        let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
        rd.filter_map(|e| e.ok())
            .filter_map(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                let (stem, ext) = n.rsplit_once('.')?;
                let ext = ext.to_ascii_lowercase();
                (ext == "rtbw" || ext == "rtbz").then(|| stem.chars().filter(|c| c.is_ascii_alphabetic() && *c != 'v').count() as u32)
            })
            .max()
            .unwrap_or(0)
    }
    fn subdirs(dir: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
        v.sort();
        v
    }
    let mut out: Vec<String> = Vec::new();
    let mut max = 0;
    for part in path.split(SYZYGY_SEP).map(str::trim).filter(|p| !p.is_empty()) {
        let dir = Path::new(part);
        let n = pieces(dir);
        if n > 0 || !dir.is_dir() {
            max = max.max(n);
            out.push(part.to_string());
            continue;
        }
        let mut found = Vec::new();
        for sub in subdirs(dir) {
            let n = pieces(&sub);
            if n > 0 {
                max = max.max(n);
                found.push(sub.to_string_lossy().to_string());
            } else {
                for sub2 in subdirs(&sub) {
                    let n = pieces(&sub2);
                    if n > 0 {
                        max = max.max(n);
                        found.push(sub2.to_string_lossy().to_string());
                    }
                }
            }
        }
        if found.is_empty() {
            out.push(part.to_string());
        } else {
            out.extend(found);
        }
    }
    (out.join(&SYZYGY_SEP.to_string()), max)
}

#[cfg(test)]
mod hash_tests {
    #[test]
    fn ccrl_hash_rules() {
        let h = |l: &str, t| super::ccrl_hash_mb(l, t, 256, 512);
        assert_eq!((h("Blitz", 1), h("Blitz", 8), h("", 4)), (256, 2048, 1024));
        assert_eq!((h("40/15", 1), h("40/15", 2), h("40/15", 4), h("40/15", 8)), (1024, 1024, 2048, 4096));
    }
}

#[cfg(test)]
mod syzygy_tests {
    use super::*;

    #[test]
    fn tables_found_in_sub_folders() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("syzygy");
        for (sub, files) in [("3-4-5", &["KQvK.rtbw", "KQRvKR.rtbw", "KQRvKR.rtbz"][..]), ("6-wdl", &["KQRvKQR.rtbw"][..]), ("empty", &[][..])] {
            std::fs::create_dir_all(root.join(sub)).unwrap();
            for f in files {
                std::fs::write(root.join(sub).join(f), b"").unwrap();
            }
        }
        // the parent folder: its sub-folders with tables, 6 pieces
        let (p, n) = syzygy_resolve(&root.to_string_lossy());
        assert_eq!(n, 6);
        let parts: Vec<&str> = p.split(SYZYGY_SEP).collect();
        assert_eq!(parts.len(), 2, "{p}");
        assert!(parts[0].ends_with("3-4-5") && parts[1].ends_with("6-wdl"), "{p}");
        // a folder with tables is kept as it is
        let five = root.join("3-4-5").to_string_lossy().to_string();
        assert_eq!(syzygy_resolve(&five), (five.clone(), 5));
        // the export label of a tournament reads the files, not the folder name
        let mut c = crate::scheduler::tests::cfg(TournamentKind::Gauntlet, &["A"], &["B"], 2, 1, 1);
        c.syzygy_path = root.to_string_lossy().to_string();
        assert_eq!(c.syzygy_pieces(), 6);
        // a path that cannot be read: kept, pieces from the name
        c.syzygy_path = "Z:/nowhere/3-4-5".into();
        assert_eq!((c.syzygy_effective(), c.syzygy_pieces()), ("Z:/nowhere/3-4-5".to_string(), 5));
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
        Participant { name: name.into(), cmd: String::new(), dir: String::new(), args: String::new(), options: Default::default(), role, engine_id: None, has_syzygy: false, uci_id: None, rating: None, rating_estimated: false, threads, hash_mb: None, withdrawn: false }
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
