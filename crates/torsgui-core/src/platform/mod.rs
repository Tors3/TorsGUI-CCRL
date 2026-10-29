//! OS-specific pieces behind the [`Os`] trait: CPU topology, launching a game
//! process confined to a NUMA node, killing its whole process tree, checking
//! the placement at runtime and spawning fully detached runners.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[cfg(unix)]
mod linux;
#[cfg(windows)]
mod windows;

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Cpu {
    /// OS logical processor id (Linux cpu number; Windows: group * 64 + number).
    pub id: u32,
    pub group: u16,
    /// Index inside the processor group (bit of the affinity mask).
    pub number: u32,
    /// Global physical core index.
    pub core: u32,
    /// 0 = first hardware thread of its core, 1 = SMT sibling...
    pub smt: u32,
    pub node: u32,
    pub socket: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Cache {
    pub level: u32,
    pub kind: String,
    pub size_kb: u64,
    /// Number of logical CPUs sharing it (per instance).
    pub shared_by: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct NumaNode {
    pub id: u32,
    pub group: u16,
    pub physical_cores: u32,
    pub logical_cpus: u32,
    pub memory_mb: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Topology {
    pub cpu_model: String,
    pub vendor: String,
    pub sockets: u32,
    pub physical_cores: u32,
    pub logical_cpus: u32,
    pub groups: u16,
    pub nodes: Vec<NumaNode>,
    pub cpus: Vec<Cpu>,
    pub caches: Vec<Cache>,
    pub smt: bool,
    /// Where the data came from ("GetLogicalProcessorInformationEx", "sysfs", "fallback").
    pub source: String,
    pub has_avx2: bool,
    pub has_avx512: bool,
    pub has_bmi2: bool,
}

impl Topology {
    pub fn node(&self, id: u32) -> Option<&NumaNode> {
        self.nodes.iter().find(|n| n.id == id)
    }
    /// One logical CPU per physical core of `node` (first SMT thread).
    pub fn primary_cpus(&self, node: u32) -> Vec<&Cpu> {
        let mut v: Vec<&Cpu> = self.cpus.iter().filter(|c| c.node == node && c.smt == 0).collect();
        v.sort_by_key(|c| (c.group, c.number));
        v
    }
    /// The CPUs lanes may use on `node`: one per physical core, or with `smt` every
    /// logical CPU, the hardware threads of a core next to each other (so that a slice of
    /// the list takes whole cores).
    pub fn lane_cpus(&self, node: u32, smt: bool) -> Vec<&Cpu> {
        if !smt {
            return self.primary_cpus(node);
        }
        let mut v: Vec<&Cpu> = self.cpus.iter().filter(|c| c.node == node).collect();
        v.sort_by_key(|c| (c.group, c.core, c.smt, c.number));
        v
    }
    /// How many engine threads `node` can run at once: its physical cores, or with `smt`
    /// its logical CPUs.
    pub fn cpu_budget(&self, node: u32, smt: bool) -> u32 {
        match self.node(node) {
            Some(n) if smt => n.logical_cpus,
            Some(n) => n.physical_cores,
            None => 0,
        }
    }
    /// `lanes per node = CPUs of the node / (2 x threads per engine)`.
    pub fn suggested_lanes(&self, node: u32, threads: u32, smt: bool) -> u32 {
        let cpus = match self.node(node) {
            Some(_) => self.cpu_budget(node, smt),
            None if smt => self.logical_cpus,
            None => self.physical_cores,
        };
        (cpus / (2 * threads.max(1))).max(1)
    }
}

/// CPUs a lane may use: a processor group plus a group-relative mask (Windows)
/// and the equivalent logical ids (Linux).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CpuSet {
    pub node: u32,
    pub group: u16,
    #[ts(type = "number")]
    pub mask: u64,
    pub cpus: Vec<u32>,
}

impl CpuSet {
    pub fn from_cpus(node: u32, cpus: &[&Cpu]) -> CpuSet {
        let group = cpus.first().map(|c| c.group).unwrap_or(0);
        let mut mask = 0u64;
        for c in cpus.iter().filter(|c| c.group == group) {
            if c.number < 64 {
                mask |= 1u64 << c.number;
            }
        }
        CpuSet { node, group, mask, cpus: cpus.iter().map(|c| c.id).collect() }
    }
    pub fn describe(&self) -> String {
        format!("node {} group {} mask 0x{:X} ({} CPUs)", self.node, self.group, self.mask, self.cpus.len())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LanePlan {
    /// Opening partition index (0-based position in the tournament's node list).
    pub partition: u32,
    pub node: u32,
    pub lane: u32,
    pub cpuset: Option<CpuSet>,
}

/// Plans the lanes of a tournament. `cores_per_lane` counts CPUs of the pool: physical
/// cores, or logical CPUs with `smt`.
pub fn plan_lanes(topo: &Topology, nodes: &[u32], lanes_per_node: u32, cores_per_lane: u32, placement: crate::model::Placement, smt: bool) -> Vec<LanePlan> {
    use crate::model::Placement;
    let mut out = Vec::new();
    for (pi, &node) in nodes.iter().enumerate() {
        let prim = topo.lane_cpus(node, smt);
        for lane in 0..lanes_per_node.max(1) {
            let cpuset = match placement {
                Placement::None => None,
                Placement::Node => {
                    if prim.is_empty() {
                        None
                    } else {
                        Some(CpuSet::from_cpus(node, &prim))
                    }
                }
                Placement::Lane => {
                    let per = cores_per_lane.max(2) as usize;
                    let start = lane as usize * per;
                    if start + per <= prim.len() {
                        Some(CpuSet::from_cpus(node, &prim[start..start + per]))
                    } else if !prim.is_empty() {
                        Some(CpuSet::from_cpus(node, &prim))
                    } else {
                        None
                    }
                }
            };
            out.push(LanePlan { partition: pi as u32, node, lane, cpuset });
        }
    }
    out
}

/// A running game process (fastchess + engines) confined to a CPU set.
pub struct Confined {
    pub child: std::process::Child,
    pub pid: u32,
    #[cfg(windows)]
    pub job: Option<windows::JobHandle>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PlacementCheck {
    /// Logical CPUs the process may run on (as reported by the OS).
    pub cpus: Vec<u32>,
    pub group: Option<u16>,
    #[ts(type = "number | null")]
    pub mask: Option<u64>,
    /// Processes in the job / process group (fastchess + engines).
    pub processes: u32,
    pub ok: bool,
    pub detail: String,
}

pub trait Os: Send + Sync {
    fn name(&self) -> &'static str;
    fn topology(&self) -> Topology;
    /// Spawns `cmd` so that it and all its children are confined to `set`.
    fn spawn_confined(&self, cmd: Command, set: Option<&CpuSet>) -> std::io::Result<Confined>;
    /// Kills the process and every child (engines).
    fn kill_tree(&self, c: &mut Confined);
    /// Placement actually in force for a running game.
    fn placement(&self, c: &Confined, expected: Option<&CpuSet>) -> PlacementCheck;
    /// Starts a process that survives the caller (new session / no job).
    fn spawn_detached(&self, program: &Path, args: &[String], log: &Path) -> std::io::Result<u32>;
    fn pid_alive(&self, pid: u32) -> bool;
    /// CPU busy fraction over `ms` milliseconds (0..1).
    fn cpu_load(&self, ms: u64) -> f64;
    /// Power plan / governor information for the bench guards.
    fn power_info(&self) -> PowerInfo;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PowerInfo {
    pub plan: String,
    /// Minimum processor state on AC (Windows) in percent.
    pub min_processor_state: Option<u32>,
    pub governor: Option<String>,
    pub current_mhz: Option<u64>,
    pub max_mhz: Option<u64>,
    pub warnings: Vec<String>,
}

pub fn os() -> &'static dyn Os {
    #[cfg(windows)]
    {
        static W: windows::WindowsOs = windows::WindowsOs;
        &W
    }
    #[cfg(unix)]
    {
        static L: linux::LinuxOs = linux::LinuxOs;
        &L
    }
}

/// Hides console windows of helper processes on Windows.
pub fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// The path fastchess is given for an engine. fastchess cannot start an engine whose path
/// has spaces (quoting does not help), so on Windows the 8.3 short path stands in for it;
/// the path as is when it has no spaces or the volume keeps no short names.
pub fn launch_path(path: &str) -> String {
    if !path.contains(char::is_whitespace) {
        return path.to_string();
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        let wide: Vec<u16> = std::ffi::OsStr::new(path).encode_wide().chain(Some(0)).collect();
        let mut buf = vec![0u16; 1024];
        let n = unsafe { windows_sys::Win32::Storage::FileSystem::GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) } as usize;
        if n > 0 && n < buf.len() {
            let short = std::ffi::OsString::from_wide(&buf[..n]).to_string_lossy().into_owned();
            if !short.contains(char::is_whitespace) {
                return short;
            }
        }
    }
    path.to_string()
}

/// Parses "0-3,8,10-11".
pub fn parse_cpulist(s: &str) -> Vec<u32> {
    let mut v = Vec::new();
    for part in s.trim().split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            if let (Ok(a), Ok(b)) = (a.parse::<u32>(), b.parse::<u32>()) {
                v.extend(a..=b);
            }
        } else if let Ok(x) = part.parse() {
            v.push(x);
        }
    }
    v
}

/// Synthetic topology for tests and previews (e.g. the 2x Xeon Gold 6138:
/// 2 nodes, 20 cores / 40 threads each, SMT siblings adjacent).
pub fn synthetic_topology(nodes: u32, cores_per_node: u32, smt: u32) -> Topology {
    let mut cpus = Vec::new();
    let mut core = 0;
    for n in 0..nodes {
        for c in 0..cores_per_node {
            for t in 0..smt {
                let number = c * smt + t;
                cpus.push(Cpu { id: n * 64 + number, group: n as u16, number, core, smt: t, node: n, socket: n });
            }
            core += 1;
        }
    }
    Topology {
        cpu_model: "Synthetic".into(),
        vendor: "GenuineIntel".into(),
        sockets: nodes,
        physical_cores: nodes * cores_per_node,
        logical_cpus: nodes * cores_per_node * smt,
        groups: nodes as u16,
        nodes: (0..nodes)
            .map(|n| NumaNode { id: n, group: n as u16, physical_cores: cores_per_node, logical_cpus: cores_per_node * smt, memory_mb: None })
            .collect(),
        cpus,
        caches: vec![],
        smt: smt > 1,
        source: "synthetic".into(),
        has_avx2: true,
        has_avx512: false,
        has_bmi2: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Placement as P;
    #[test]
    fn launch_path_drops_spaces_when_it_can() {
        assert_eq!(launch_path("/engines/sf/stockfish"), "/engines/sf/stockfish");
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("stockfish 7 x64 bmi2.exe");
        std::fs::write(&exe, b"").unwrap();
        let p = exe.to_string_lossy().into_owned();
        let l = launch_path(&p);
        // the same file under another name, or the path as is (no short names on this volume)
        assert!(Path::new(&l).exists());
        assert!(l == p || (cfg!(windows) && !l.contains(char::is_whitespace)), "{l}");
    }
    #[test]
    fn xeon_mask_is_one_thread_per_core() {
        let t = synthetic_topology(2, 20, 2);
        let prim = t.primary_cpus(1);
        let set = CpuSet::from_cpus(1, &prim);
        // run_node.py AFFINITY_MASK=0x5555555555 (even bits, siblings adjacent)
        assert_eq!(set.mask, 0x55_5555_5555);
        assert_eq!(set.group, 1);
        assert_eq!(t.suggested_lanes(0, 8, false), 1);
        assert_eq!(t.suggested_lanes(0, 4, false), 2);
        let lanes = plan_lanes(&t, &[0, 1], 2, 8, P::Lane, false);
        assert_eq!(lanes.len(), 4);
        assert_eq!(lanes[1].cpuset.as_ref().unwrap().cpus.len(), 8);
        assert_ne!(lanes[0].cpuset, lanes[1].cpuset);
        let lanes = plan_lanes(&t, &[0, 1], 2, 16, P::Node, false);
        assert_eq!(lanes[0].cpuset, lanes[1].cpuset);
        assert!(plan_lanes(&t, &[0], 1, 2, P::None, false)[0].cpuset.is_none());
    }
    #[test]
    fn smt_uses_both_threads_of_a_core() {
        // a Ryzen 7: 8 cores, 16 threads, one node
        let t = synthetic_topology(1, 8, 2);
        assert_eq!(t.cpu_budget(0, false), 8);
        assert_eq!(t.cpu_budget(0, true), 16);
        assert_eq!(t.suggested_lanes(0, 1, false), 4);
        assert_eq!(t.suggested_lanes(0, 1, true), 8);
        // the whole node: every logical CPU
        let node = plan_lanes(&t, &[0], 2, 2, P::Node, true);
        assert_eq!(node[0].cpuset.as_ref().unwrap().mask, 0xFFFF);
        // disjoint lanes take whole cores (both hardware threads), never half of one
        let lanes = plan_lanes(&t, &[0], 8, 2, P::Lane, true);
        let core_of = |id: u32| t.cpus.iter().find(|c| c.id == id).unwrap().core;
        for l in &lanes {
            let cpus = &l.cpuset.as_ref().unwrap().cpus;
            assert_eq!(cpus.len(), 2);
            assert_eq!(core_of(cpus[0]), core_of(cpus[1]));
        }
        assert_eq!(lanes[0].cpuset.as_ref().unwrap().mask, 0b11);
        assert_eq!(lanes[7].cpuset.as_ref().unwrap().mask, 0b11 << 14);
    }
    #[test]
    fn cpulist() {
        assert_eq!(parse_cpulist("0-3,8,10-11\n"), vec![0, 1, 2, 3, 8, 10, 11]);
    }
}
