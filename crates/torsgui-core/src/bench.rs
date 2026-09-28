//! Machine calibration with the Stockfish 10 `bench` (port of
//! `benchmark/ccrl_bench.py`): N single-threaded instances in parallel, each
//! pinned to its own logical CPU, compared with the CCRL reference machine
//! (i7-4770K, 2054 ms for 3 939 338 nodes).
//!
//! Guards (pitfall 6): 32-bit binaries are refused (PE/ELF header and the
//! engine's `id name`), the CPU must be idle (warning above 5 % load), and
//! the power plan / minimum processor state and frequency are reported.

use crate::engines::{binary_bitness, sha256_file, Bitness};
use crate::platform::{self, Cpu, CpuSet, PowerInfo, Topology};
use crate::tc::{REF_NODES, REF_TIME_MS};
use anyhow::{bail, Context, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier, Mutex};

/// Official Stockfish 10 Windows binaries kept in CCRL_ScirptsTests/third_party.
pub const SF10_WINDOWS: &[(&str, &str, &str)] = &[
    ("x64", "stockfish_10_x64.exe", "febfa362b329d23ec1193321f94eb8db899c6b771d7cfe34b900dd84f054519d"),
    ("bmi2", "stockfish_10_x64_bmi2.exe", "25108b8c3db1f9e54b06722ba0049fc7ba3cd425b401f21db818e00214aba0f4"),
    ("popcnt", "stockfish_10_x64_popcnt.exe", "fb96c809736da06abf12e347b28e09ca886b715b3f7ff18dc650ff32ca43efb7"),
];
pub const SF10_RAW_BASE: &str = "https://raw.githubusercontent.com/Tors3/CCRL_ScirptsTests/main/third_party/stockfish-10-win/Windows";

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BenchConfig {
    /// build -> binary path
    pub binaries: Vec<(String, String)>,
    pub levels: Vec<u32>,
    pub runs: u32,
    pub warmup: u32,
    pub hash: u32,
    pub depth: u32,
    pub ref_ms: f64,
    pub pin: bool,
    /// Start even if the CPU is busy (the result is then marked invalid).
    pub force: bool,
}

impl Default for BenchConfig {
    fn default() -> Self {
        BenchConfig { binaries: vec![], levels: vec![1], runs: 5, warmup: 1, hash: 16, depth: 13, ref_ms: REF_TIME_MS, pin: true, force: false }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BenchLevel {
    pub build: String,
    pub instances: u32,
    pub ht_siblings: u32,
    pub nps_mean: f64,
    pub nps_median: f64,
    pub nps_min_instance: f64,
    pub nps_max_instance: f64,
    pub stdev_pct: f64,
    pub spread_pct: f64,
    pub total_nps: f64,
    pub bench_time_ms: f64,
    pub factor: f64,
    pub factor_median: f64,
    pub seconds: f64,
    pub samples: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BenchRun {
    pub host: String,
    pub cpu: String,
    pub os: String,
    pub created_at: String,
    pub engine: String,
    pub builds: Vec<String>,
    pub levels: Vec<BenchLevel>,
    pub signature: Vec<u64>,
    pub signature_ok: bool,
    pub cpu_load_before: f64,
    pub power: PowerInfo,
    pub warnings: Vec<String>,
    pub valid: bool,
    pub invalid_reason: Option<String>,
    pub ref_ms: f64,
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BenchProgress {
    pub running: bool,
    pub phase: String,
    pub done_levels: u32,
    pub total_levels: u32,
    pub result: Option<BenchRun>,
    pub error: Option<String>,
}

/// Ensures the official SF10 Windows builds are present in `dir` (downloads
/// them from CCRL_ScirptsTests and checks the sha256). Returns build -> path.
pub fn ensure_sf10_windows(dir: &Path) -> Result<Vec<(String, PathBuf)>> {
    std::fs::create_dir_all(dir)?;
    let mut out = Vec::new();
    for (build, file, sha) in SF10_WINDOWS {
        let p = dir.join(file);
        if !p.exists() || sha256_file(&p)? != *sha {
            crate::github::download(&format!("{SF10_RAW_BASE}/{file}"), &p, None)?;
            let got = sha256_file(&p)?;
            if got != *sha {
                let _ = std::fs::remove_file(&p);
                bail!("sha256 mismatch for {file}: expected {sha}, got {got}");
            }
        }
        out.push((build.to_string(), p));
    }
    Ok(out)
}

/// Stockfish 10 binaries found in a folder (by file name), never 32-bit.
pub fn find_binaries(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut v = Vec::new();
    for e in walkdir::WalkDir::new(dir).max_depth(3).into_iter().filter_map(|e| e.ok()) {
        let n = e.file_name().to_string_lossy().to_lowercase();
        if !n.starts_with("stockfish") || !e.file_type().is_file() {
            continue;
        }
        if cfg!(windows) != n.ends_with(".exe") {
            continue;
        }
        let is32 = n.contains("x32") || n.contains("32bit") || n.contains("win32") || n.contains("i386") || (n.contains("x86") && !n.contains("x86-64") && !n.contains("x86_64"));
        if is32 || binary_bitness(e.path()) == Bitness::Bits32 {
            continue;
        }
        let build = if n.contains("bmi2") { "bmi2" } else if n.contains("popcnt") || n.contains("modern") { "popcnt" } else { "x64" };
        if !v.iter().any(|(b, _): &(String, PathBuf)| b == build) {
            v.push((build.to_string(), e.path().to_path_buf()));
        }
    }
    v
}

/// Refuses 32-bit binaries and engines that are not Stockfish 10. Returns the id name.
pub fn check_binary(p: &Path) -> Result<String> {
    if !p.exists() {
        bail!("file not found: {}", p.display());
    }
    match binary_bitness(p) {
        Bitness::Bits32 => bail!("{} is a 32-bit binary: use the 64-bit one (a 32-bit build runs at half speed and inflates the factor)", p.display()),
        Bitness::Unknown => log::warn!("cannot read the binary header of {}", p.display()),
        Bitness::Bits64 => {}
    }
    let v = crate::engines::verify(p, 1, std::time::Duration::from_secs(20));
    if !v.uciok {
        bail!("{} does not answer uci", p.display());
    }
    let id = v.id_name;
    if !id.starts_with("Stockfish 10") {
        bail!("the engine identifies itself as '{id}', not Stockfish 10");
    }
    // SF10 reports its word size in the id name ("Stockfish 10 64 BMI2")
    if Regex::new(r"\b32\b").unwrap().is_match(&id) || !Regex::new(r"\b64\b").unwrap().is_match(&id) {
        bail!("'{id}' is not a 64-bit Stockfish 10 build: refused");
    }
    Ok(id)
}

static NPS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Nodes/second\s*:\s*(\d+)").unwrap());
static NODES_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Nodes searched\s*:\s*(\d+)").unwrap());

pub fn parse_bench_output(s: &str) -> Option<(u64, Option<u64>)> {
    let nps = NPS_RE.captures(s)?[1].parse().ok()?;
    let nodes = NODES_RE.captures(s).and_then(|c| c[1].parse().ok());
    Some((nps, nodes))
}

fn run_once(sf: &Path, cfg: &BenchConfig, cpu: Option<&Cpu>) -> Result<(u64, Option<u64>)> {
    let mut cmd = std::process::Command::new(sf);
    cmd.args(["bench", &cfg.hash.to_string(), "1", &cfg.depth.to_string(), "default", "depth"]);
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null());
    if let Some(d) = sf.parent() {
        cmd.current_dir(d);
    }
    let set = cpu.filter(|_| cfg.pin).map(|c| CpuSet::from_cpus(c.node, &[c]));
    let conf = platform::os().spawn_confined(cmd, set.as_ref())?;
    let out = conf.child.wait_with_output()?;
    let txt = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    parse_bench_output(&txt).with_context(|| format!("unrecognized bench output: {}", txt.chars().rev().take(300).collect::<String>().chars().rev().collect::<String>()))
}

/// Physical cores of the first node, then of the following nodes, then SMT siblings.
pub fn ordered_cpus(t: &Topology) -> Vec<Cpu> {
    let mut v: Vec<Cpu> = t.cpus.clone();
    v.sort_by_key(|c| (c.smt, c.node, c.socket, c.group, c.number));
    v
}

pub fn auto_levels(t: &Topology) -> Vec<u32> {
    let phys0 = t.nodes.first().map(|n| n.physical_cores).unwrap_or(t.physical_cores);
    let mut lv = vec![1, (phys0 / 2).max(1), phys0, t.physical_cores, t.logical_cpus];
    lv.sort();
    lv.dedup();
    lv
}

fn stats(samples: &[f64]) -> (f64, f64, f64) {
    let n = samples.len() as f64;
    let mean = samples.iter().sum::<f64>() / n;
    let mut s = samples.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = if s.len() % 2 == 1 { s[s.len() / 2] } else { (s[s.len() / 2 - 1] + s[s.len() / 2]) / 2.0 };
    let sd = (samples.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n).sqrt();
    (mean, median, 100.0 * sd / mean)
}

/// One level: all instances start together; whoever finishes early keeps
/// running filler benches until everyone is done, so the load stays constant.
pub fn run_level(sf: &Path, cfg: &BenchConfig, cpus: &[Cpu]) -> Result<(Vec<Vec<u64>>, Vec<u64>)> {
    let n = cpus.len();
    let barrier = Arc::new(Barrier::new(n));
    let results = Arc::new(Mutex::new(vec![Vec::new(); n]));
    let nodes = Arc::new(Mutex::new(Vec::new()));
    let finished = Arc::new(Mutex::new(0usize));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut hs = Vec::new();
    for (i, cpu) in cpus.iter().cloned().enumerate() {
        let (barrier, results, nodes, finished, errors) = (barrier.clone(), results.clone(), nodes.clone(), finished.clone(), errors.clone());
        let sf = sf.to_path_buf();
        let cfg = cfg.clone();
        hs.push(std::thread::spawn(move || {
            barrier.wait();
            let mut ok = true;
            for _ in 0..cfg.warmup {
                if let Err(e) = run_once(&sf, &cfg, Some(&cpu)) {
                    errors.lock().unwrap().push(e.to_string());
                    ok = false;
                    break;
                }
            }
            if ok {
                for _ in 0..cfg.runs {
                    match run_once(&sf, &cfg, Some(&cpu)) {
                        Ok((nps, nd)) => {
                            results.lock().unwrap()[i].push(nps);
                            if let Some(nd) = nd {
                                nodes.lock().unwrap().push(nd);
                            }
                        }
                        Err(e) => {
                            errors.lock().unwrap().push(e.to_string());
                            break;
                        }
                    }
                }
            }
            *finished.lock().unwrap() += 1;
            while *finished.lock().unwrap() < n {
                if run_once(&sf, &cfg, Some(&cpu)).is_err() {
                    break;
                }
            }
        }));
    }
    for h in hs {
        let _ = h.join();
    }
    let errs = errors.lock().unwrap().clone();
    if let Some(e) = errs.first() {
        if results.lock().unwrap().iter().all(|r| r.is_empty()) {
            bail!("{e}");
        }
    }
    let mut nd = nodes.lock().unwrap().clone();
    nd.sort();
    nd.dedup();
    let r = results.lock().unwrap().clone();
    Ok((r, nd))
}

pub fn summarize(build: &str, instances: u32, ht: u32, per_instance: &[Vec<u64>], seconds: f64, ref_ms: f64) -> Option<BenchLevel> {
    let samples: Vec<f64> = per_instance.iter().flatten().map(|x| *x as f64).collect();
    if samples.is_empty() {
        return None;
    }
    let (mean, median, sd) = stats(&samples);
    let inst: Vec<f64> = per_instance.iter().filter(|r| !r.is_empty()).map(|r| r.iter().sum::<u64>() as f64 / r.len() as f64).collect();
    let mn = inst.iter().cloned().fold(f64::INFINITY, f64::min);
    let mx = inst.iter().cloned().fold(0.0, f64::max);
    let t_ms = REF_NODES as f64 / mean * 1000.0;
    Some(BenchLevel {
        build: build.into(),
        instances,
        ht_siblings: ht,
        nps_mean: mean.round(),
        nps_median: median.round(),
        nps_min_instance: mn.round(),
        nps_max_instance: mx.round(),
        stdev_pct: (sd * 100.0).round() / 100.0,
        spread_pct: ((mx - mn) / mean * 10000.0).round() / 100.0,
        total_nps: (mean * instances as f64).round(),
        bench_time_ms: t_ms.round(),
        factor: ((t_ms / ref_ms) * 10000.0).round() / 10000.0,
        factor_median: ((REF_NODES as f64 / median * 1000.0 / ref_ms) * 10000.0).round() / 10000.0,
        seconds: (seconds * 10.0).round() / 10.0,
        samples: samples.len() as u32,
    })
}

/// Full calibration with guards. `progress` is updated as levels complete.
pub fn run(cfg: &BenchConfig, progress: Arc<Mutex<BenchProgress>>) -> Result<BenchRun> {
    let os = platform::os();
    let topo = os.topology();
    let set_phase = |p: &str| {
        let mut g = progress.lock().unwrap();
        g.phase = p.to_string();
    };
    set_phase("checking the machine");
    let mut warnings = Vec::new();
    let load = os.cpu_load(1000);
    let mut valid = true;
    let mut invalid_reason = None;
    if load > 0.05 {
        let w = format!("CPU already {:.0}% busy: close other programs and wait for the machine to be idle, otherwise the factor comes out too high", load * 100.0);
        if !cfg.force {
            bail!("{w}");
        }
        warnings.push(w.clone());
        valid = false;
        invalid_reason = Some(w);
    }
    let power = os.power_info();
    warnings.extend(power.warnings.clone());
    let mut engine = String::new();
    for (_, p) in &cfg.binaries {
        engine = check_binary(Path::new(p))?;
    }
    if cfg.binaries.is_empty() {
        bail!("no Stockfish 10 binary selected");
    }
    let order = ordered_cpus(&topo);
    let total = (cfg.binaries.len() * cfg.levels.len()) as u32;
    progress.lock().unwrap().total_levels = total;
    let mut levels = Vec::new();
    let mut sig = Vec::new();
    for (build, path) in &cfg.binaries {
        for &lvl in &cfg.levels {
            if lvl == 0 || lvl as usize > order.len() {
                warnings.push(format!("level {lvl} ignored (> {} logical CPUs)", order.len()));
                continue;
            }
            set_phase(&format!("{build}: {lvl} instance(s)"));
            let cpus = &order[..lvl as usize];
            let ht = cpus.iter().filter(|c| c.smt > 0).count() as u32;
            let t0 = std::time::Instant::now();
            let (per, nodes) = run_level(Path::new(path), cfg, cpus)?;
            sig.extend(nodes);
            if let Some(l) = summarize(build, lvl, ht, &per, t0.elapsed().as_secs_f64(), cfg.ref_ms) {
                levels.push(l);
            }
            progress.lock().unwrap().done_levels += 1;
        }
    }
    sig.sort();
    sig.dedup();
    let standard = cfg.hash == 16 && cfg.depth == 13;
    let signature_ok = sig == vec![REF_NODES];
    if !signature_ok {
        let w = if standard {
            format!("nodes searched {sig:?} (expected {REF_NODES}): different binary or parameters, result NOT valid for CCRL")
        } else {
            "non-standard hash/depth: CCRL comparison not valid".to_string()
        };
        warnings.push(w.clone());
        valid = false;
        invalid_reason.get_or_insert(w);
    }
    Ok(BenchRun {
        host: sysinfo::System::host_name().unwrap_or_default(),
        cpu: topo.cpu_model.clone(),
        os: format!("{} {}", sysinfo::System::name().unwrap_or_default(), sysinfo::System::os_version().unwrap_or_default()),
        created_at: crate::store::now(),
        engine,
        builds: cfg.binaries.iter().map(|b| b.0.clone()).collect(),
        levels,
        signature: sig,
        signature_ok,
        cpu_load_before: load,
        power,
        warnings,
        valid,
        invalid_reason,
        ref_ms: cfg.ref_ms,
        source: "TorsGUI".into(),
    })
}

/// Imports a result JSON written by `benchmark/ccrl_bench.py`. Runs made with
/// a binary that does not identify as a 64-bit build are marked invalid.
pub fn import_py_json(text: &str, file_name: &str) -> Result<BenchRun> {
    let v: serde_json::Value = serde_json::from_str(text)?;
    let engine = v["engine"].as_str().unwrap_or("").to_string();
    let build = v["build"].as_str().unwrap_or("x64").to_string();
    let ref_ms = v["args"]["ref_ms"].as_f64().unwrap_or(REF_TIME_MS);
    let levels: Vec<BenchLevel> = v["results"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|r| {
                    let f = |k: &str| r[k].as_f64().unwrap_or(0.0);
                    BenchLevel {
                        build: build.clone(),
                        instances: f("instances") as u32,
                        ht_siblings: f("ht_siblings") as u32,
                        nps_mean: f("nps_mean"),
                        nps_median: f("nps_median"),
                        nps_min_instance: f("nps_min_instance"),
                        nps_max_instance: f("nps_max_instance"),
                        stdev_pct: f("stdev_pct"),
                        spread_pct: if f("nps_mean") > 0.0 { ((f("nps_max_instance") - f("nps_min_instance")) / f("nps_mean") * 10000.0).round() / 100.0 } else { 0.0 },
                        total_nps: f("total_nps"),
                        bench_time_ms: f("bench_time_ms"),
                        factor: f("factor"),
                        factor_median: if f("nps_median") > 0.0 { ((REF_NODES as f64 / f("nps_median") * 1000.0 / ref_ms) * 10000.0).round() / 10000.0 } else { 0.0 },
                        seconds: f("seconds"),
                        samples: 0,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let sig: Vec<u64> = v["signature"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64()).collect()).unwrap_or_default();
    let mut warnings = Vec::new();
    let mut invalid = None;
    if !Regex::new(r"\b64\b").unwrap().is_match(&engine) {
        let w = format!("engine '{engine}' does not report a 64-bit build: probably the 32-bit binary (factor inflated) — invalid");
        warnings.push(w.clone());
        invalid = Some(w);
    }
    // created_at from "..._YYYYmmdd_HHMMSS.json"
    let created = Regex::new(r"(\d{8})_(\d{6})").unwrap().captures(file_name).map(|c| {
        let d = &c[1];
        let t = &c[2];
        format!("{}-{}-{}T{}:{}:{}", &d[..4], &d[4..6], &d[6..], &t[..2], &t[2..4], &t[4..])
    });
    Ok(BenchRun {
        host: v["host"].as_str().unwrap_or("").into(),
        cpu: v["cpu"].as_str().unwrap_or("").into(),
        os: v["os"].as_str().unwrap_or("").into(),
        created_at: created.unwrap_or_default(),
        engine,
        builds: vec![build],
        levels,
        signature_ok: sig == vec![REF_NODES],
        signature: sig,
        cpu_load_before: 0.0,
        power: PowerInfo::default(),
        valid: invalid.is_none(),
        invalid_reason: invalid,
        warnings,
        ref_ms,
        source: format!("ccrl_bench.py ({file_name})"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_output() {
        let o = "===========================\nTotal time (ms) : 2133\nNodes searched  : 3939338\nNodes/second    : 1846853\n";
        assert_eq!(parse_bench_output(o), Some((1846853, Some(3939338))));
    }
    #[test]
    fn summary_factor() {
        let l = summarize("bmi2", 1, 0, &[vec![2278407]], 10.0, REF_TIME_MS).unwrap();
        assert_eq!(l.bench_time_ms, 1729.0);
        assert_eq!(l.factor, 0.8418);
    }
    #[test]
    fn import_history_flags_32bit_runs() {
        let j = r#"{"host":"Xeon-Server","cpu":"Xeon","engine":"Stockfish 10","build":"x64","args":{"ref_ms":2054},"signature":[3939338],"results":[{"instances":40,"nps_mean":1100000,"factor":1.8773}]}"#;
        let r = import_py_json(j, "ccrl_bench_Xeon-Server_20260922_090614.json").unwrap();
        assert!(!r.valid);
        assert_eq!(r.created_at, "2026-09-22T09:06:14");
        let j = j.replace("\"Stockfish 10\"", "\"Stockfish 10 64 BMI2\"");
        assert!(import_py_json(&j, "x.json").unwrap().valid);
    }
    #[test]
    fn refuses_32bit_binary() {
        let d = tempfile::tempdir().unwrap();
        let mut pe = vec![0u8; 256];
        pe[0] = b'M';
        pe[1] = b'Z';
        pe[0x3c] = 0x80;
        pe[0x80..0x84].copy_from_slice(b"PE\0\0");
        pe[0x84] = 0x4c;
        pe[0x85] = 0x01;
        let p = d.path().join("stockfish_10_x64.exe");
        std::fs::write(&p, &pe).unwrap();
        let e = check_binary(&p).unwrap_err().to_string();
        assert!(e.contains("32-bit"), "{e}");
    }
}
