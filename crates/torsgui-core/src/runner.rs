//! The tournament runner: a separate, detached process that plays the games.
//! Closing, crashing or updating the GUI never stops it (pitfall 4).
//!
//! * One lane = one fastchess process at a time, playing exactly one game.
//! * Finished games are read back from the PGNs (source of truth); a game
//!   that is not in the PGN after fastchess exits is re-queued.
//! * Pause/stop come from the `desired` column (polled every second): games
//!   in progress are killed with their engines and never counted.
//! * A clean end with every expected game completes the tournament and
//!   starts the next queued one in the same process; a clean end with games
//!   missing retries (bounded); a pause or stop never advances the queue.
//! * An exclusive lock on `runner.lock` guarantees one runner per tournament
//!   and lets the GUI detect live runners even after crashes.

use crate::model::TournamentConfig;
use crate::pgn::{PgnIndex, SlotKey};
use crate::platform::{self, CpuSet, LanePlan};
use crate::scheduler::{self, Job, Queue};
use crate::store::{Desired, Store, TState, Workspace};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const LOCK_FILE: &str = "runner.lock";

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LaneStatus {
    pub node: u32,
    pub partition: u32,
    pub lane: u32,
    pub busy: bool,
    pub job: Option<Job>,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub log_file: Option<String>,
    pub pgn_file: String,
    pub cpuset: Option<String>,
    pub placement: Option<platform::PlacementCheck>,
    pub games_played: u32,
    pub failures: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct RunnerStatus {
    pub pid: u32,
    pub host: String,
    pub session_started: i64,
    pub lanes: Vec<LaneStatus>,
    pub queued: u32,
    pub done: u32,
    pub expected: u32,
    pub played_this_session: u32,
    pub failed_this_session: u32,
    /// (unix time, games done) samples for rolling games/hour.
    pub progress: Vec<(i64, u32)>,
    pub warnings: Vec<String>,
    pub retry: u32,
    pub phase: String,
}

/// Holds the exclusive lock for the life of the runner.
pub struct RunnerLock {
    _file: File,
    pub path: PathBuf,
}

pub fn try_lock(tdir: &Path) -> Result<Option<RunnerLock>> {
    std::fs::create_dir_all(tdir)?;
    let path = tdir.join(LOCK_FILE);
    let f = std::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(&path)?;
    match f.try_lock() {
        Ok(()) => {
            use std::io::{Seek, Write};
            let mut f2 = &f;
            let _ = f2.set_len(0);
            let _ = f2.seek(std::io::SeekFrom::Start(0));
            let _ = writeln!(f2, "{}", std::process::id());
            Ok(Some(RunnerLock { _file: f, path }))
        }
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(e)) => Err(e.into()),
    }
}

/// True if a runner currently holds the tournament lock.
pub fn is_running(tdir: &Path) -> bool {
    let path = tdir.join(LOCK_FILE);
    if !path.exists() {
        return false;
    }
    match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
        Ok(f) => match f.try_lock() {
            Ok(()) => {
                let _ = f.unlock();
                false
            }
            Err(_) => true,
        },
        Err(_) => false,
    }
}

const RUN: u8 = 0;
const PAUSE: u8 = 1;
const STOP: u8 = 2;

struct Shared {
    queue: Queue,
    index: PgnIndex,
    done: HashSet<SlotKey>,
    expected: HashSet<SlotKey>,
    status: RunnerStatus,
    new_games: Vec<crate::pgn::IndexedGame>,
}

fn log_line(tdir: &Path, msg: &str) {
    use std::io::Write;
    let line = format!("[{}] {msg}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(tdir.join("runner.log")) {
        let _ = f.write_all(line.as_bytes());
    }
    eprint!("{line}");
}

pub fn pgn_sources(ws: &Workspace, id: &str) -> Vec<PathBuf> {
    crate::pgn::list_pgns(&ws.pgn_dir(id))
}

/// Finished slots of the tournament according to its PGN files.
pub fn scan_done(ws: &Workspace, id: &str, cfg: &TournamentConfig) -> (PgnIndex, HashSet<SlotKey>, HashSet<SlotKey>) {
    let mut idx = PgnIndex::new();
    let _ = idx.scan_dir(&ws.pgn_dir(id));
    let expected: HashSet<SlotKey> = scheduler::all_jobs(cfg).iter().map(|j| j.slot()).collect();
    let done: HashSet<SlotKey> = idx.finished_slots().into_iter().filter(|s| expected.contains(s)).collect();
    (idx, done, expected)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Completed,
    Incomplete,
    Paused,
    Stopped,
    AlreadyRunning,
    Failed,
}

/// Runs `id`, then (when it completes cleanly) every following queued
/// tournament. Returns the outcome of the last one.
pub fn run_chain(ws: &Workspace, mut id: String, fastchess: Option<PathBuf>) -> Result<Outcome> {
    loop {
        let out = run_tournament(ws, &id, fastchess.clone())?;
        if out != Outcome::Completed {
            return Ok(out);
        }
        let store = ws.open()?;
        let next = store.queue()?.into_iter().find(|t| t.id != id);
        match next {
            Some(n) => {
                store.push_event("info", "queue_advanced", Some(&n.id), &format!("Queue advanced: starting {}", n.name))?;
                id = n.id;
            }
            None => return Ok(out),
        }
    }
}

/// Kills game processes left behind by a runner that died (Linux: process
/// groups recorded in the last status; Windows jobs die with their runner).
fn reap_stale(status: &Option<serde_json::Value>) {
    let Some(st) = status else { return };
    let Some(lanes) = st["lanes"].as_array() else { return };
    for l in lanes {
        if let Some(pid) = l["pid"].as_u64() {
            #[cfg(unix)]
            unsafe {
                if libc::getpgid(pid as i32) == pid as i32 {
                    libc::killpg(pid as i32, libc::SIGKILL);
                }
            }
            #[cfg(not(unix))]
            let _ = pid;
        }
    }
}

pub fn run_tournament(ws: &Workspace, id: &str, fastchess_override: Option<PathBuf>) -> Result<Outcome> {
    let tdir = ws.tournament_dir(id);
    let Some(_lock) = try_lock(&tdir)? else {
        return Ok(Outcome::AlreadyRunning);
    };
    let store = ws.open()?;
    let rec = store.tournament(id)?.with_context(|| format!("tournament {id} not found"))?;
    if rec.desired != Desired::Run {
        store.set_desired(id, Desired::Run)?;
    }
    reap_stale(&rec.status);
    let cfg = rec.config.clone();
    let settings = store.settings()?;
    let fastchess = fastchess_override.unwrap_or_else(|| crate::fastchess::resolve(&cfg.fastchess, &settings.fastchess_path, &ws.tools_dir(), &settings.fastchess_version));
    if !fastchess.exists() {
        let msg = format!("fastchess not found: {}", fastchess.display());
        store.set_error(id, Some(&msg))?;
        store.set_state(id, TState::Failed)?;
        store.push_event("error", "runner_failed", Some(id), &msg)?;
        bail!(msg);
    }
    for d in ["pgn", "logs/games"] {
        std::fs::create_dir_all(tdir.join(d))?;
    }
    store.set_state(id, TState::Running)?;
    store.set_error(id, None)?;
    store.push_event("info", "tournament_started", Some(id), &format!("{} started (runner pid {})", rec.name, std::process::id()))?;
    log_line(&tdir, &format!("runner {} start: {} ({:?}), fastchess {}", std::process::id(), rec.name, cfg.kind, fastchess.display()));

    // live broadcast (ccrl.live, Lichess) while this runner plays the tournament
    let _cast = crate::broadcast::Caster::start(ws.clone(), id.to_string());
    let mut retries = rec.retries;
    loop {
        let (session, reason) = run_session(ws, &store, id, &cfg, &fastchess, retries)?;
        match session {
            Outcome::Paused | Outcome::Stopped => {
                let st = if session == Outcome::Paused { TState::Paused } else { TState::Stopped };
                store.set_state(id, st)?;
                store.clear_runner(id)?;
                store.push_event("warn", if session == Outcome::Paused { "tournament_paused" } else { "tournament_stopped" }, Some(id), &format!("{} {}: {reason}", rec.name, st.as_str()))?;
                log_line(&tdir, &format!("{} ({reason})", st.as_str()));
                return Ok(session);
            }
            Outcome::Completed => {
                store.set_state(id, TState::Completed)?;
                store.clear_runner(id)?;
                store.push_event("success", "tournament_finished", Some(id), &format!("{} finished: {reason}", rec.name))?;
                log_line(&tdir, &format!("FINISHED cleanly: {reason}"));
                return Ok(session);
            }
            Outcome::Incomplete => {
                if retries < cfg.max_retries {
                    retries += 1;
                    store.set_retries(id, retries)?;
                    store.push_event("warn", "tournament_retry", Some(id), &format!("{} ended with games missing ({reason}): retry {retries}/{}", rec.name, cfg.max_retries))?;
                    log_line(&tdir, &format!("ended with games missing ({reason}), retry {retries}/{}", cfg.max_retries));
                    std::thread::sleep(Duration::from_millis(500));
                    continue;
                }
                store.set_state(id, TState::Incomplete)?;
                store.clear_runner(id)?;
                store.push_event("error", "tournament_incomplete", Some(id), &format!("{} ended with games missing after {retries} retries: {reason}. The queue does not advance.", rec.name))?;
                log_line(&tdir, &format!("INCOMPLETE after {retries} retries: {reason}"));
                return Ok(Outcome::Incomplete);
            }
            other => return Ok(other),
        }
    }
}

fn run_session(ws: &Workspace, store: &Store, id: &str, cfg: &TournamentConfig, fastchess: &Path, retry: u32) -> Result<(Outcome, String)> {
    let tdir = ws.tournament_dir(id);
    let (index, done, expected) = scan_done(ws, id, cfg);
    let jobs = scheduler::build_queue(cfg, &done);
    let expected_n = expected.len() as u32;
    log_line(&tdir, &format!("session: {} / {} games done, {} to play (retry {retry})", done.len(), expected_n, jobs.len()));
    if jobs.is_empty() {
        return Ok((Outcome::Completed, format!("{} / {} games", done.len(), expected_n)));
    }
    let topo = platform::os().topology();
    let mut phys_nodes: Vec<u32> = cfg.nodes.clone();
    let mut warnings = Vec::new();
    for n in phys_nodes.iter_mut() {
        if topo.node(*n).is_none() {
            warnings.push(format!("NUMA node {n} does not exist on this machine: its lanes run without placement"));
        }
    }
    let plans: Vec<LanePlan> = platform::plan_lanes(&topo, &phys_nodes, cfg.lanes_per_node, cfg.threads, cfg.placement);
    let pairs = scheduler::pairings(cfg);
    let host = sysinfo::System::host_name().unwrap_or_default();
    let status = RunnerStatus {
        pid: std::process::id(),
        host,
        session_started: crate::store::now_ts(),
        lanes: plans
            .iter()
            .map(|p| LaneStatus {
                node: p.node,
                partition: p.partition,
                lane: p.lane,
                pgn_file: tdir.join("pgn").join(format!("node{}_lane{}.pgn", p.partition, p.lane)).to_string_lossy().to_string(),
                cpuset: p.cpuset.as_ref().map(|c| c.describe()),
                ..Default::default()
            })
            .collect(),
        queued: jobs.len() as u32,
        done: done.len() as u32,
        expected: expected_n,
        progress: vec![(crate::store::now_ts(), done.len() as u32)],
        warnings,
        retry,
        phase: "running".into(),
        ..Default::default()
    };
    let shared = Arc::new(Mutex::new(Shared { queue: Queue::new(jobs, cfg.max_slot_attempts), index, done, expected, status, new_games: vec![] }));
    let control = Arc::new(AtomicU8::new(RUN));
    let mut handles = Vec::new();
    for (li, plan) in plans.iter().enumerate() {
        let shared = shared.clone();
        let control = control.clone();
        let cfg = cfg.clone();
        let pairs = pairs.clone();
        let plan = plan.clone();
        let tdir = tdir.clone();
        let fastchess = fastchess.to_path_buf();
        let node_exists = topo.node(plan.node).is_some();
        handles.push(std::thread::Builder::new().name(format!("lane-{li}")).spawn(move || {
            lane_loop(li, &plan, if node_exists { plan.cpuset.clone() } else { None }, &cfg, &pairs, &tdir, &fastchess, &shared, &control)
        })?);
    }
    // supervisor: control polling + heartbeat
    let mut last_hb = Instant::now() - Duration::from_secs(10);
    loop {
        let finished = handles.iter().all(|h| h.is_finished());
        let desired = store.desired(id).unwrap_or(Desired::Run);
        match desired {
            Desired::Pause => control.store(PAUSE, Ordering::SeqCst),
            Desired::Stop => control.store(STOP, Ordering::SeqCst),
            Desired::Run => {}
        }
        if finished || last_hb.elapsed() >= Duration::from_secs(2) {
            last_hb = Instant::now();
            let (st, new_games) = {
                let mut s = shared.lock().unwrap();
                s.status.done = s.done.len() as u32;
                s.status.queued = s.queue.remaining() as u32;
                let now = crate::store::now_ts();
                let d = s.status.done;
                if s.status.progress.last().map(|p| p.1 != d || now - p.0 > 300).unwrap_or(true) {
                    s.status.progress.push((now, d));
                    if s.status.progress.len() > 500 {
                        s.status.progress.remove(0);
                    }
                }
                (s.status.clone(), std::mem::take(&mut s.new_games))
            };
            for g in &new_games {
                let t = g.headers.get_or("Termination", "normal");
                if !matches!(t, "normal" | "adjudication") {
                    let msg = format!("{} - {}: {} ({})", g.headers.get_or("White", "?"), g.headers.get_or("Black", "?"), g.headers.get_or("Result", "?"), t);
                    let _ = store.push_event("warn", if t.contains("time") { "time_forfeit" } else { "engine_problem" }, Some(id), &msg);
                }
            }
            let _ = store.heartbeat(id, std::process::id(), st.done, &serde_json::to_value(&st)?);
        }
        if finished {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    for h in handles {
        let _ = h.join();
    }
    let c = control.load(Ordering::SeqCst);
    let (done, expected) = {
        let s = shared.lock().unwrap();
        (s.done.len(), s.expected.len())
    };
    let reason = format!("{done} / {expected} games");
    Ok(match c {
        PAUSE => (Outcome::Paused, reason),
        STOP => (Outcome::Stopped, reason),
        _ if done >= expected => (Outcome::Completed, reason),
        _ => (Outcome::Incomplete, reason),
    })
}

#[allow(clippy::too_many_arguments)]
fn lane_loop(
    li: usize,
    plan: &LanePlan,
    cpuset: Option<CpuSet>,
    cfg: &TournamentConfig,
    pairs: &[(crate::model::Participant, crate::model::Participant)],
    tdir: &Path,
    fastchess: &Path,
    shared: &Arc<Mutex<Shared>>,
    control: &Arc<AtomicU8>,
) {
    let pgn_out = tdir.join("pgn").join(format!("node{}_lane{}.pgn", plan.partition, plan.lane));
    let console = tdir.join("logs").join(format!("node{}_lane{}_console.txt", plan.partition, plan.lane));
    loop {
        if control.load(Ordering::SeqCst) != RUN {
            break;
        }
        let job = {
            let mut s = shared.lock().unwrap();
            let done = s.done.clone();
            s.queue.next_for(Some(plan.partition), &done)
        };
        let Some(job) = job else { break };
        let (ea, eb) = &pairs[job.pairing];
        let tag = format!(
            "node{}_p{}_{}_vs_{}_r{}_{}",
            job.node,
            job.pass,
            crate::pgn::slug(&ea.name),
            crate::pgn::slug(&eb.name),
            job.round,
            if job.reversed { "b" } else { "w" }
        );
        let log_file = tdir.join("logs").join("games").join(format!("{tag}.log"));
        let state_json = tdir.join("logs").join("games").join(format!("{tag}.json"));
        let args = crate::fastchess::game_args(cfg, &pairs[job.pairing], &job, &pgn_out, &log_file, &state_json);
        let mut cmd = std::process::Command::new(fastchess);
        cmd.args(&args).current_dir(tdir).stdin(std::process::Stdio::null());
        match std::fs::OpenOptions::new().create(true).append(true).open(&console) {
            Ok(f) => {
                let e = f.try_clone().ok();
                cmd.stdout(f);
                if let Some(e) = e {
                    cmd.stderr(e);
                }
            }
            Err(_) => {
                cmd.stdout(std::process::Stdio::null());
                cmd.stderr(std::process::Stdio::null());
            }
        }
        #[cfg(target_os = "linux")]
        unsafe {
            use std::os::unix::process::CommandExt;
            // the game dies with its lane thread / runner (no orphans after a runner kill)
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
        log_line(tdir, &format!("L{li} {} - {} p{} r{} (opening {}) start", job.white, job.black, job.pass, job.round, job.opening));
        let t0 = Instant::now();
        let spawned = platform::os().spawn_confined(cmd, cpuset.as_ref());
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                log_line(tdir, &format!("L{li} cannot start fastchess: {e}"));
                let mut s = shared.lock().unwrap();
                s.queue.complete(&job, false);
                s.status.lanes[li].failures += 1;
                s.status.failed_this_session += 1;
                drop(s);
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };
        {
            let mut s = shared.lock().unwrap();
            let l = &mut s.status.lanes[li];
            l.busy = true;
            l.job = Some(job.clone());
            l.pid = Some(child.pid);
            l.started_at = Some(crate::store::now_ts());
            l.log_file = Some(log_file.to_string_lossy().to_string());
            l.placement = None;
        }
        let limit = game_time_limit(&cfg.tc);
        let mut placement_checked = false;
        let mut interrupted = false;
        let rc = loop {
            match child.child.try_wait() {
                Ok(Some(st)) => break st.code(),
                Ok(None) => {}
                Err(_) => break None,
            }
            if control.load(Ordering::SeqCst) != RUN {
                platform::os().kill_tree(&mut child);
                interrupted = true;
                break None;
            }
            if t0.elapsed() > limit {
                // watchdog: longer than any game at this time control can last
                platform::os().kill_tree(&mut child);
                log_line(tdir, &format!("L{li} watchdog: game exceeded {:.0}s, killed", limit.as_secs_f64()));
                let mut s = shared.lock().unwrap();
                let w = format!("lane {li}: a game exceeded {:.0}s and was killed ({} - {})", limit.as_secs_f64(), job.white, job.black);
                s.status.warnings.push(w);
                break None;
            }
            if !placement_checked && t0.elapsed() > Duration::from_secs(2) {
                placement_checked = true;
                let p = platform::os().placement(&child, cpuset.as_ref());
                let mut s = shared.lock().unwrap();
                if !p.ok {
                    let w = format!("lane {li}: placement differs from the plan ({})", p.detail);
                    if !s.status.warnings.contains(&w) {
                        s.status.warnings.push(w);
                    }
                }
                s.status.lanes[li].placement = Some(p);
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        let mut s = shared.lock().unwrap();
        {
            let l = &mut s.status.lanes[li];
            l.busy = false;
            l.pid = None;
            l.job = None;
        }
        if interrupted {
            // discarded: it will be replayed later, never counted twice
            s.queue.requeue_front(&job);
            log_line(tdir, &format!("L{li} {} - {} r{} discarded (pause/stop)", job.white, job.black, job.round));
            break;
        }
        let before = s.index.file_games(&pgn_out).len();
        let _ = s.index.scan(&pgn_out);
        let new: Vec<crate::pgn::IndexedGame> = s.index.file_games(&pgn_out)[before..].to_vec();
        s.new_games.extend(new);
        let fin = s.index.finished_slots();
        let expected = s.expected.clone();
        s.done = fin.into_iter().filter(|x| expected.contains(x)).collect();
        let recorded = s.done.contains(&job.slot());
        s.queue.complete(&job, recorded);
        if recorded {
            s.status.lanes[li].games_played += 1;
            s.status.played_this_session += 1;
            let _ = std::fs::remove_file(&state_json);
        } else {
            s.status.lanes[li].failures += 1;
            s.status.failed_this_session += 1;
        }
        drop(s);
        log_line(
            tdir,
            &format!(
                "L{li} {} - {} r{} {} after {:.0}s (fastchess rc {:?})",
                job.white,
                job.black,
                job.round,
                if recorded { "recorded" } else { "NOT recorded, will be replayed" },
                t0.elapsed().as_secs_f64(),
                rc
            ),
        );
    }
}

/// Upper bound of a game's wall time: both clocks fully used over 400 plies,
/// plus 50 % and two minutes of margin (engine start-up, adjudication...).
pub fn game_time_limit(tc: &str) -> Duration {
    let secs = match crate::tc::parse_fastchess(tc) {
        Some((0, b, i)) => 2.0 * (b + 200.0 * i),
        Some((m, b, i)) => 2.0 * (b * (200.0 / m as f64).ceil() + 200.0 * i),
        None => 6.0 * 3600.0,
    };
    Duration::from_secs_f64(secs * 1.5 + 120.0)
}

// ------------------------------------------------------------------ control (GUI side)

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LaunchInfo {
    pub pid: Option<u32>,
    pub via: String,
}

/// Path of the runner executable next to the current executable.
pub fn runner_exe() -> PathBuf {
    if let Ok(p) = std::env::var("TORSGUI_RUNNER") {
        return PathBuf::from(p);
    }
    let name = if cfg!(windows) { "torsgui-runner.exe" } else { "torsgui-runner" };
    let me = std::env::current_exe().unwrap_or_default();
    let dir = me.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    for cand in [dir.join(name), dir.join("..").join(name), dir.join("../..").join(name)] {
        if cand.exists() {
            return cand;
        }
    }
    dir.join(name)
}

/// Starts a detached runner for `id` (Task Scheduler on Windows when enabled).
pub fn launch(ws: &Workspace, id: &str, use_task_scheduler: bool) -> Result<LaunchInfo> {
    let tdir = ws.tournament_dir(id);
    std::fs::create_dir_all(&tdir)?;
    if is_running(&tdir) {
        return Ok(LaunchInfo { pid: None, via: "already running".into() });
    }
    let exe = runner_exe();
    let args = vec!["run".to_string(), "--workspace".into(), ws.root.to_string_lossy().to_string(), "--id".into(), id.to_string()];
    #[cfg(windows)]
    if use_task_scheduler {
        return crate::runner::task_scheduler_launch(&exe, &args, &tdir, id);
    }
    let _ = use_task_scheduler;
    let pid = platform::os().spawn_detached(&exe, &args, &tdir.join("runner_stdout.log"))?;
    Ok(LaunchInfo { pid: Some(pid), via: "detached process".into() })
}

/// Windows: a CRLF .bat (paths with spaces and brackets are quoted, pitfall 7)
/// run by a Task Scheduler task, like the reference workflow.
#[cfg(windows)]
pub fn task_scheduler_launch(exe: &Path, args: &[String], tdir: &Path, id: &str) -> Result<LaunchInfo> {
    let bat = tdir.join("start_runner.bat");
    std::fs::write(&bat, runner_bat(exe, args))?;
    let task = format!("TorsGUI\\{}", id);
    let tr = format!("\"{}\"", bat.display());
    let mut c = std::process::Command::new("schtasks");
    c.args(["/create", "/tn", &task, "/tr", &tr, "/sc", "once", "/st", "00:00", "/f"]);
    platform::no_window(&mut c);
    let out = c.output()?;
    if !out.status.success() {
        bail!("schtasks /create failed: {}", String::from_utf8_lossy(&out.stderr));
    }
    let mut r = std::process::Command::new("schtasks");
    r.args(["/run", "/tn", &task]);
    platform::no_window(&mut r);
    let out = r.output()?;
    if !out.status.success() {
        bail!("schtasks /run failed: {}", String::from_utf8_lossy(&out.stderr));
    }
    Ok(LaunchInfo { pid: None, via: format!("Task Scheduler ({task})") })
}

/// `.bat` launching the runner, with CRLF line endings.
pub fn runner_bat(exe: &Path, args: &[String]) -> String {
    let quoted: Vec<String> = args.iter().map(|a| if a.contains(' ') || a.contains('[') || a.contains('(') { format!("\"{a}\"") } else { a.clone() }).collect();
    ["@echo off".to_string(), "rem Started by TorsGUI: runs the tournament outside any window or session.".to_string(), format!("start \"TorsGUI runner\" /B \"{}\" {}", exe.display(), quoted.join(" "))].join("\r\n") + "\r\n"
}

/// Resumes tournaments that were running when their runner died (reboot,
/// crash). Returns the ids launched.
pub fn resume_interrupted(ws: &Workspace, use_task_scheduler: bool) -> Result<Vec<String>> {
    let store = ws.open()?;
    let mut out = Vec::new();
    for t in store.tournaments()? {
        if t.state == TState::Running && t.desired == Desired::Run && !is_running(&ws.tournament_dir(&t.id)) {
            launch(ws, &t.id, use_task_scheduler)?;
            store.push_event("info", "tournament_resumed", Some(&t.id), &format!("{} resumed after an interruption", t.name))?;
            out.push(t.id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lock_is_exclusive() {
        let d = tempfile::tempdir().unwrap();
        let l = try_lock(d.path()).unwrap();
        assert!(l.is_some());
        assert!(is_running(d.path()));
        drop(l);
        assert!(!is_running(d.path()));
    }
    #[test]
    fn bat_is_crlf_and_quoted() {
        let b = runner_bat(Path::new(r"C:\Program Files\TorsGUI\torsgui-runner.exe"), &["run".into(), "--workspace".into(), r"C:\Users\F T\[x] (y)".into()]);
        assert!(b.contains("\r\n"));
        assert!(!b.replace("\r\n", "").contains('\n'));
        assert!(b.contains(r#""C:\Users\F T\[x] (y)""#));
    }
}
