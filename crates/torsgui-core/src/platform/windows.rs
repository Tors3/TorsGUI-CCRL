//! Windows implementation.
//!
//! * Topology from `GetLogicalProcessorInformationEx(RelationAll)`.
//! * Every game process is created suspended, put into its own **Job Object**
//!   with `JobObjectGroupInformationEx` (processor group + affinity mask) and
//!   `KILL_ON_JOB_CLOSE`, then resumed. Engines started by fastchess inherit the
//!   job, so engines that pin their own threads across NUMA nodes (Caissa 2.0)
//!   cannot escape; terminating the job kills fastchess and all engines.
//! * Runners are started with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP |
//!   CREATE_BREAKAWAY_FROM_JOB`, so closing, crashing or auto-updating the GUI
//!   never stops a tournament.

use super::*;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::process::Stdio;
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::SystemInformation::*;
use windows_sys::Win32::System::Threading::*;

pub struct WindowsOs;

pub struct JobHandle(pub HANDLE);
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}
impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

const CREATE_SUSPENDED_F: u32 = 0x0000_0004;
const CREATE_NO_WINDOW_F: u32 = 0x0800_0000;
const DETACHED_PROCESS_F: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP_F: u32 = 0x0000_0200;
const CREATE_BREAKAWAY_FROM_JOB_F: u32 = 0x0100_0000;
const JOB_OBJECT_GROUP_INFORMATION_EX: i32 = 14;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct GroupAffinity {
    mask: usize,
    group: u16,
    reserved: [u16; 3],
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtResumeProcess(h: HANDLE) -> i32;
}

fn bits(mask: u64) -> Vec<u32> {
    (0..64).filter(|b| mask >> b & 1 == 1).collect()
}

fn read_u16(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn read_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn read_u64(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn group_masks(b: &[u8], p: usize, count: usize) -> Vec<(u16, u64)> {
    (0..count).filter(|i| p + i * 16 + 10 <= b.len()).map(|i| (read_u16(b, p + i * 16 + 8), read_u64(b, p + i * 16))).collect()
}

fn registry_cpu_model() -> (String, String) {
    let q = |v: &str| -> Option<String> {
        let out = Command::new("reg")
            .args(["query", r"HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "/v", v])
            .creation_flags(CREATE_NO_WINDOW_F)
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        s.lines().find(|l| l.contains("REG_SZ")).and_then(|l| l.split("REG_SZ").nth(1)).map(|x| x.trim().to_string())
    };
    (q("ProcessorNameString").unwrap_or_else(|| "?".into()), q("VendorIdentifier").unwrap_or_else(|| "?".into()))
}

impl Os for WindowsOs {
    fn name(&self) -> &'static str {
        "windows"
    }

    fn topology(&self) -> Topology {
        let mut len: u32 = 0;
        let raw: Vec<u8> = unsafe {
            GetLogicalProcessorInformationEx(RelationAll, std::ptr::null_mut(), &mut len);
            let mut buf = vec![0u8; len as usize];
            if GetLogicalProcessorInformationEx(RelationAll, buf.as_mut_ptr() as *mut _, &mut len) == 0 {
                return super::synthetic_topology(1, std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1), 1);
            }
            buf.truncate(len as usize);
            buf
        };
        let mut cores: Vec<Vec<(u16, u64)>> = Vec::new();
        let mut packages: Vec<Vec<(u16, u64)>> = Vec::new();
        let mut nodes: Vec<(u32, Vec<(u16, u64)>)> = Vec::new();
        let mut caches = Vec::new();
        let mut off = 0usize;
        while off + 8 <= raw.len() {
            let rel = read_u32(&raw, off);
            let size = read_u32(&raw, off + 4) as usize;
            let p = off + 8;
            match rel {
                0 | 3 => {
                    let gc = read_u16(&raw, p + 22).max(1) as usize;
                    let g = group_masks(&raw, p + 24, gc);
                    if rel == 0 {
                        cores.push(g)
                    } else {
                        packages.push(g)
                    }
                }
                1 => {
                    let node = read_u32(&raw, p);
                    let gc = read_u16(&raw, p + 22).max(1) as usize;
                    nodes.push((node, group_masks(&raw, p + 24, gc)));
                }
                2 => {
                    let level = raw[p] as u32;
                    let size_b = read_u32(&raw, p + 4) as u64;
                    let kind = match read_u32(&raw, p + 8) {
                        0 => "Unified",
                        1 => "Instruction",
                        2 => "Data",
                        _ => "Trace",
                    };
                    let gc = read_u16(&raw, p + 30).max(1) as usize;
                    let shared: u32 = group_masks(&raw, p + 32, gc).iter().map(|(_, m)| m.count_ones()).sum();
                    if !caches.iter().any(|c: &Cache| c.level == level && c.kind == kind) {
                        caches.push(Cache { level, kind: kind.into(), size_kb: size_b / 1024, shared_by: shared });
                    }
                }
                _ => {}
            }
            if size == 0 {
                break;
            }
            off += size;
        }
        let mut cpus = Vec::new();
        for (ci, g) in cores.iter().enumerate() {
            let mut smt = 0;
            for (grp, mask) in g {
                for b in bits(*mask) {
                    let node = nodes.iter().find(|(_, gm)| gm.iter().any(|(gg, m)| gg == grp && m >> b & 1 == 1)).map(|n| n.0).unwrap_or(0);
                    let socket = packages.iter().position(|gm| gm.iter().any(|(gg, m)| gg == grp && m >> b & 1 == 1)).unwrap_or(0) as u32;
                    cpus.push(Cpu { id: *grp as u32 * 64 + b, group: *grp, number: b, core: ci as u32, smt, node, socket });
                    smt += 1;
                }
            }
        }
        let (model, vendor) = registry_cpu_model();
        let avx2 = unsafe { IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE) != 0 };
        let avx512 = unsafe { IsProcessorFeaturePresent(PF_AVX512F_INSTRUCTIONS_AVAILABLE) != 0 };
        let mut node_list: Vec<NumaNode> = nodes
            .iter()
            .map(|(n, g)| NumaNode {
                id: *n,
                group: g.first().map(|x| x.0).unwrap_or(0),
                physical_cores: cpus.iter().filter(|c| c.node == *n && c.smt == 0).count() as u32,
                logical_cpus: cpus.iter().filter(|c| c.node == *n).count() as u32,
                memory_mb: None,
            })
            .collect();
        node_list.sort_by_key(|n| n.id);
        let physical = cores.len() as u32;
        let groups = unsafe { GetActiveProcessorGroupCount() };
        Topology {
            cpu_model: model,
            vendor,
            sockets: packages.len().max(1) as u32,
            physical_cores: physical,
            logical_cpus: cpus.len() as u32,
            groups,
            smt: cpus.len() as u32 > physical,
            nodes: node_list,
            cpus,
            caches,
            source: "GetLogicalProcessorInformationEx".into(),
            has_avx2: avx2,
            has_avx512: avx512,
            has_bmi2: avx2, // same proxy as ccrl_bench.py
        }
    }

    fn spawn_confined(&self, mut cmd: Command, set: Option<&CpuSet>) -> std::io::Result<Confined> {
        cmd.creation_flags(CREATE_SUSPENDED_F | CREATE_NO_WINDOW_F | CREATE_NEW_PROCESS_GROUP_F);
        let child = cmd.spawn()?;
        let pid = child.id();
        let h = child.as_raw_handle() as HANDLE;
        let job = unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                NtResumeProcess(h);
                return Ok(Confined { child, pid, job: None });
            }
            let job = JobHandle(job);
            let mut ext: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            ext.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &ext as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if let Some(s) = set {
                let ga = GroupAffinity { mask: s.mask as usize, group: s.group, reserved: [0; 3] };
                if SetInformationJobObject(job.0, JOB_OBJECT_GROUP_INFORMATION_EX, &ga as *const _ as *const _, std::mem::size_of::<GroupAffinity>() as u32) == 0 {
                    log::warn!("JobObjectGroupInformationEx failed: {}", std::io::Error::last_os_error());
                }
            }
            if AssignProcessToJobObject(job.0, h) == 0 {
                log::warn!("AssignProcessToJobObject failed: {}", std::io::Error::last_os_error());
            }
            NtResumeProcess(h);
            Some(job)
        };
        Ok(Confined { child, pid, job })
    }

    fn kill_tree(&self, c: &mut Confined) {
        if let Some(j) = &c.job {
            unsafe {
                TerminateJobObject(j.0, 1);
            }
        }
        let _ = c.child.kill();
        let _ = c.child.wait();
    }

    fn placement(&self, c: &Confined, expected: Option<&CpuSet>) -> Placement {
        let mut p = Placement::default();
        let Some(j) = &c.job else {
            p.detail = "no job object".into();
            p.ok = expected.is_none();
            return p;
        };
        unsafe {
            let mut ga = [GroupAffinity::default(); 4];
            let mut ret: u32 = 0;
            if QueryInformationJobObject(j.0, JOB_OBJECT_GROUP_INFORMATION_EX, ga.as_mut_ptr() as *mut _, std::mem::size_of_val(&ga) as u32, &mut ret) != 0 && ret > 0 {
                let g = ga[0];
                p.group = Some(g.group);
                p.mask = Some(g.mask as u64);
                p.cpus = bits(g.mask as u64).into_iter().map(|b| g.group as u32 * 64 + b).collect();
            }
            let mut acc: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
            if QueryInformationJobObject(j.0, JobObjectBasicAccountingInformation, &mut acc as *mut _ as *mut _, std::mem::size_of_val(&acc) as u32, &mut ret) != 0 {
                p.processes = acc.ActiveProcesses;
            }
        }
        p.ok = match expected {
            Some(s) => p.group == Some(s.group) && p.mask == Some(s.mask),
            None => true,
        };
        p.detail = match (p.group, p.mask) {
            (Some(g), Some(m)) => format!("job: group {g} mask 0x{m:X}, {} processes", p.processes),
            _ => format!("job without group limit, {} processes", p.processes),
        };
        p
    }

    fn spawn_detached(&self, program: &Path, args: &[String], log: &Path) -> std::io::Result<u32> {
        let out = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
        let err = out.try_clone()?;
        let mk = |breakaway: bool| {
            let mut cmd = Command::new(program);
            cmd.args(args).stdin(Stdio::null()).stdout(out.try_clone().unwrap()).stderr(err.try_clone().unwrap());
            let mut flags = DETACHED_PROCESS_F | CREATE_NEW_PROCESS_GROUP_F;
            if breakaway {
                flags |= CREATE_BREAKAWAY_FROM_JOB_F;
            }
            cmd.creation_flags(flags);
            cmd.spawn()
        };
        // breakaway fails when the caller's job forbids it: retry without it
        let child = mk(true).or_else(|_| mk(false))?;
        Ok(child.id())
    }

    fn pid_alive(&self, pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code: u32 = 0;
            let ok = windows_sys::Win32::System::Threading::GetExitCodeProcess(h, &mut code) != 0;
            CloseHandle(h);
            ok && code == 259 // STILL_ACTIVE
        }
    }

    fn cpu_load(&self, ms: u64) -> f64 {
        fn ft(t: FILETIME) -> u64 {
            ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
        }
        unsafe {
            let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
            let (mut i0, mut k0, mut u0) = (z, z, z);
            GetSystemTimes(&mut i0, &mut k0, &mut u0);
            std::thread::sleep(std::time::Duration::from_millis(ms));
            let (mut i1, mut k1, mut u1) = (z, z, z);
            GetSystemTimes(&mut i1, &mut k1, &mut u1);
            let idle = ft(i1) - ft(i0);
            let total = (ft(k1) - ft(k0)) + (ft(u1) - ft(u0)); // kernel time includes idle
            if total == 0 {
                0.0
            } else {
                1.0 - idle as f64 / total as f64
            }
        }
    }

    fn power_info(&self) -> PowerInfo {
        let mut p = PowerInfo::default();
        let run = |args: &[&str]| -> String {
            Command::new("powercfg").args(args).creation_flags(CREATE_NO_WINDOW_F).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
        };
        let active = run(&["/getactivescheme"]);
        p.plan = active.trim().to_string();
        let q = run(&["/query", "SCHEME_CURRENT", "SUB_PROCESSOR", "PROCTHROTTLEMIN"]);
        let re = regex::Regex::new(r":\s*0x([0-9a-fA-F]+)").unwrap();
        let vals: Vec<u32> = re.captures_iter(&q).filter_map(|c| u32::from_str_radix(&c[1], 16).ok()).collect();
        if vals.len() >= 2 {
            p.min_processor_state = Some(vals[vals.len() - 2]);
        }
        match p.min_processor_state {
            Some(m) if m < 100 => p.warnings.push(format!("minimum processor state is {m}% on AC: the CPU can downclock during the bench (powercfg /setactive SCHEME_MIN)")),
            None => p.warnings.push("could not read the power plan: make sure the minimum processor state is 100%".into()),
            _ => {}
        }
        let wmi = Command::new("powershell")
            .args(["-NoProfile", "-Command", "Get-CimInstance Win32_Processor | Select-Object -First 1 CurrentClockSpeed,MaxClockSpeed | ConvertTo-Json"])
            .creation_flags(CREATE_NO_WINDOW_F)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&wmi) {
            p.current_mhz = v["CurrentClockSpeed"].as_u64();
            p.max_mhz = v["MaxClockSpeed"].as_u64();
        }
        p
    }
}
