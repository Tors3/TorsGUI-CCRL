//! Linux (and generic Unix) implementation: sysfs topology, affinity through
//! `sched_setaffinity` inherited by every child, a new session per game so the
//! whole tree (fastchess + engines) can be killed with `killpg`.
//! NUMA memory binding is not done here (v2 item: libnuma / set_mempolicy).

use super::*;
use std::collections::HashMap;
use std::os::unix::process::CommandExt;
use std::process::Stdio;

pub struct LinuxOs;

fn read(p: &str) -> Option<String> {
    std::fs::read_to_string(p).ok().map(|s| s.trim().to_string())
}

fn cpu_flags() -> (String, String, bool, bool, bool) {
    let mut model = String::from("?");
    let mut vendor = String::from("?");
    let mut flags = String::new();
    if let Ok(t) = std::fs::read_to_string("/proc/cpuinfo") {
        for l in t.lines() {
            if let Some((k, v)) = l.split_once(':') {
                let (k, v) = (k.trim(), v.trim());
                if k == "model name" && model == "?" {
                    model = v.to_string();
                } else if k == "vendor_id" && vendor == "?" {
                    vendor = v.to_string();
                } else if k == "flags" && flags.is_empty() {
                    flags = v.to_string();
                }
            }
        }
    }
    let f: Vec<&str> = flags.split_whitespace().collect();
    (model, vendor, f.contains(&"avx2"), f.iter().any(|x| x.starts_with("avx512")), f.contains(&"bmi2"))
}

fn allowed_cpus() -> Vec<u32> {
    unsafe {
        let mut set: libc::cpu_set_t = std::mem::zeroed();
        if libc::sched_getaffinity(0, std::mem::size_of::<libc::cpu_set_t>(), &mut set) == 0 {
            return (0..libc::CPU_SETSIZE as u32).filter(|&c| libc::CPU_ISSET(c as usize, &set)).collect();
        }
    }
    (0..std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1)).collect()
}

pub fn pid_affinity(pid: u32) -> Option<Vec<u32>> {
    unsafe {
        let mut set: libc::cpu_set_t = std::mem::zeroed();
        if libc::sched_getaffinity(pid as i32, std::mem::size_of::<libc::cpu_set_t>(), &mut set) == 0 {
            return Some((0..libc::CPU_SETSIZE as u32).filter(|&c| libc::CPU_ISSET(c as usize, &set)).collect());
        }
    }
    None
}

impl Os for LinuxOs {
    fn name(&self) -> &'static str {
        "linux"
    }

    fn topology(&self) -> Topology {
        let (model, vendor, avx2, avx512, bmi2) = cpu_flags();
        let cpus_allowed = allowed_cpus();
        // node of each cpu
        let mut node_of: HashMap<u32, u32> = HashMap::new();
        let mut node_mem: HashMap<u32, u64> = HashMap::new();
        if let Ok(rd) = std::fs::read_dir("/sys/devices/system/node") {
            for e in rd.filter_map(|e| e.ok()) {
                let name = e.file_name().to_string_lossy().to_string();
                if let Some(n) = name.strip_prefix("node").and_then(|x| x.parse::<u32>().ok()) {
                    if let Some(list) = read(&format!("/sys/devices/system/node/{name}/cpulist")) {
                        for c in parse_cpulist(&list) {
                            node_of.insert(c, n);
                        }
                    }
                    if let Some(mi) = read(&format!("/sys/devices/system/node/{name}/meminfo")) {
                        if let Some(l) = mi.lines().find(|l| l.contains("MemTotal")) {
                            if let Some(kb) = l.split_whitespace().rev().nth(1).and_then(|x| x.parse::<u64>().ok()) {
                                node_mem.insert(n, kb / 1024);
                            }
                        }
                    }
                }
            }
        }
        let mut cpus = Vec::new();
        let mut core_ids: HashMap<(u32, u32), u32> = HashMap::new();
        let mut smt_count: HashMap<u32, u32> = HashMap::new();
        for &c in &cpus_allowed {
            let base = format!("/sys/devices/system/cpu/cpu{c}/topology");
            let pkg = read(&format!("{base}/physical_package_id")).and_then(|x| x.parse().ok()).unwrap_or(0);
            let cid = read(&format!("{base}/core_id")).and_then(|x| x.parse().ok()).unwrap_or(c);
            let next = core_ids.len() as u32;
            let core = *core_ids.entry((pkg, cid)).or_insert(next);
            let smt = {
                let e = smt_count.entry(core).or_insert(0);
                *e += 1;
                *e - 1
            };
            cpus.push(Cpu { id: c, group: 0, number: c, core, smt, node: *node_of.get(&c).unwrap_or(&0), socket: pkg });
        }
        let mut node_ids: Vec<u32> = cpus.iter().map(|c| c.node).collect();
        node_ids.sort();
        node_ids.dedup();
        let nodes = node_ids
            .iter()
            .map(|&n| NumaNode {
                id: n,
                group: 0,
                physical_cores: cpus.iter().filter(|c| c.node == n && c.smt == 0).count() as u32,
                logical_cpus: cpus.iter().filter(|c| c.node == n).count() as u32,
                memory_mb: node_mem.get(&n).copied(),
            })
            .collect();
        let mut caches = Vec::new();
        for i in 0..8 {
            let base = format!("/sys/devices/system/cpu/cpu0/cache/index{i}");
            let Some(level) = read(&format!("{base}/level")).and_then(|x| x.parse().ok()) else { break };
            let size = read(&format!("{base}/size")).unwrap_or_default();
            let size_kb = size.trim_end_matches('K').parse::<u64>().ok().or_else(|| size.trim_end_matches('M').parse::<u64>().ok().map(|m| m * 1024)).unwrap_or(0);
            let shared = read(&format!("{base}/shared_cpu_list")).map(|l| parse_cpulist(&l).len() as u32).unwrap_or(1);
            caches.push(Cache { level, kind: read(&format!("{base}/type")).unwrap_or_default(), size_kb, shared_by: shared });
        }
        let sockets = {
            let mut s: Vec<u32> = cpus.iter().map(|c| c.socket).collect();
            s.sort();
            s.dedup();
            s.len() as u32
        };
        let physical = cpus.iter().filter(|c| c.smt == 0).count() as u32;
        Topology {
            cpu_model: model,
            vendor,
            sockets,
            physical_cores: physical,
            logical_cpus: cpus.len() as u32,
            groups: 1,
            smt: cpus.len() as u32 > physical,
            nodes,
            cpus,
            caches,
            source: "sysfs".into(),
            has_avx2: avx2,
            has_avx512: avx512,
            has_bmi2: bmi2,
        }
    }

    fn spawn_confined(&self, mut cmd: Command, set: Option<&CpuSet>) -> std::io::Result<Confined> {
        let cpus: Vec<u32> = set.map(|s| s.cpus.clone()).unwrap_or_default();
        unsafe {
            cmd.pre_exec(move || {
                // own session/process group: killpg reaches fastchess and every engine
                libc::setsid();
                if !cpus.is_empty() {
                    let mut s: libc::cpu_set_t = std::mem::zeroed();
                    for &c in &cpus {
                        libc::CPU_SET(c as usize, &mut s);
                    }
                    // best effort: an invalid set must not prevent the game
                    libc::sched_setaffinity(0, std::mem::size_of::<libc::cpu_set_t>(), &s);
                }
                Ok(())
            });
        }
        let child = cmd.spawn()?;
        let pid = child.id();
        Ok(Confined { child, pid })
    }

    fn kill_tree(&self, c: &mut Confined) {
        unsafe {
            libc::killpg(c.pid as i32, libc::SIGKILL);
        }
        let _ = c.child.kill();
        let _ = c.child.wait();
    }

    fn placement(&self, c: &Confined, expected: Option<&CpuSet>) -> PlacementCheck {
        let cpus = pid_affinity(c.pid).unwrap_or_default();
        // processes in the group
        let mut n = 0;
        if let Ok(rd) = std::fs::read_dir("/proc") {
            for e in rd.filter_map(|e| e.ok()) {
                if let Some(pid) = e.file_name().to_string_lossy().parse::<i32>().ok() {
                    if unsafe { libc::getpgid(pid) } == c.pid as i32 {
                        n += 1;
                    }
                }
            }
        }
        let ok = match expected {
            Some(s) => {
                let mut a = cpus.clone();
                a.sort();
                let mut b = s.cpus.clone();
                b.sort();
                a == b
            }
            None => true,
        };
        PlacementCheck {
            detail: format!("affinity {}", super::super::util::compact_list(&cpus)),
            cpus,
            group: None,
            mask: None,
            processes: n,
            ok,
        }
    }

    fn spawn_detached(&self, program: &Path, args: &[String], log: &Path) -> std::io::Result<u32> {
        let out = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
        let err = out.try_clone()?;
        let mut cmd = Command::new(program);
        cmd.args(args).stdin(Stdio::null()).stdout(out).stderr(err);
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
        let child = cmd.spawn()?;
        let pid = child.id();
        // reap in background so no zombie stays around while the GUI lives
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
        Ok(pid)
    }

    fn pid_alive(&self, pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        let r = unsafe { libc::kill(pid as i32, 0) };
        if r != 0 {
            return false;
        }
        // zombies count as dead
        match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(s) => !s.rsplit(')').next().map(|x| x.trim_start().starts_with('Z')).unwrap_or(false),
            Err(_) => true,
        }
    }

    fn cpu_load(&self, ms: u64) -> f64 {
        fn snap() -> Option<(u64, u64)> {
            let s = std::fs::read_to_string("/proc/stat").ok()?;
            let l = s.lines().next()?;
            let v: Vec<u64> = l.split_whitespace().skip(1).filter_map(|x| x.parse().ok()).collect();
            let idle = v.get(3)? + v.get(4).unwrap_or(&0);
            Some((idle, v.iter().sum()))
        }
        let a = snap();
        std::thread::sleep(std::time::Duration::from_millis(ms));
        let b = snap();
        match (a, b) {
            (Some((i0, t0)), Some((i1, t1))) if t1 > t0 => 1.0 - (i1 - i0) as f64 / (t1 - t0) as f64,
            _ => 0.0,
        }
    }

    fn power_info(&self) -> PowerInfo {
        let mut p = PowerInfo { plan: "linux".into(), ..Default::default() };
        p.governor = read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor");
        p.current_mhz = read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq").and_then(|x| x.parse::<u64>().ok()).map(|k| k / 1000);
        p.max_mhz = read("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq").and_then(|x| x.parse::<u64>().ok()).map(|k| k / 1000);
        if p.current_mhz.is_none() {
            if let Ok(t) = std::fs::read_to_string("/proc/cpuinfo") {
                p.current_mhz = t.lines().find(|l| l.starts_with("cpu MHz")).and_then(|l| l.split(':').nth(1)).and_then(|x| x.trim().parse::<f64>().ok()).map(|x| x as u64);
            }
        }
        if let Some(g) = &p.governor {
            if g != "performance" {
                p.warnings.push(format!("CPU governor '{g}' (recommended: performance)"));
            }
        }
        p
    }
}
