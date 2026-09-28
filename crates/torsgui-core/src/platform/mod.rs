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
    /// `lanes per node = physical cores per node / (2 x threads per engine)`.
    pub fn suggested_lanes(&self, node: u32, threads: u32) -> u32 {
        let cores = self.node(node).map(|n| n.physical_cores).unwrap_or(self.physical_cores);
        (cores / (2 * threads.max(1))).max(1)
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

/// Plans the lanes of a tournament.
pub fn plan_lanes(topo: &Topology, nodes: &[u32], lanes_per_node: u32, threads: u32, placement: crate::model::Placement) -> Vec<LanePlan> {
    use crate::model::Placement;
    let mut out = Vec::new();
    for (pi, &node) in nodes.iter().enumerate() {
        let prim = topo.primary_cpus(node);
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
                    let per = (2 * threads.max(1)) as usize;
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
    fn xeon_mask_is_one_thread_per_core() {
        let t = synthetic_topology(2, 20, 2);
        let prim = t.primary_cpus(1);
        let set = CpuSet::from_cpus(1, &prim);
        // run_node.py AFFINITY_MASK=0x5555555555 (even bits, siblings adjacent)
        assert_eq!(set.mask, 0x55_5555_5555);
        assert_eq!(set.group, 1);
        assert_eq!(t.suggested_lanes(0, 8), 1);
        assert_eq!(t.suggested_lanes(0, 4), 2);
        let lanes = plan_lanes(&t, &[0, 1], 2, 4, P::Lane);
        assert_eq!(lanes.len(), 4);
        assert_eq!(lanes[1].cpuset.as_ref().unwrap().cpus.len(), 8);
        assert_ne!(lanes[0].cpuset, lanes[1].cpuset);
        let lanes = plan_lanes(&t, &[0, 1], 2, 8, P::Node);
        assert_eq!(lanes[0].cpuset, lanes[1].cpuset);
        assert!(plan_lanes(&t, &[0], 1, 1, P::None)[0].cpuset.is_none());
    }
    #[test]
    fn cpulist() {
        assert_eq!(parse_cpulist("0-3,8,10-11\n"), vec![0, 1, 2, 3, 8, 10, 11]);
    }
}
