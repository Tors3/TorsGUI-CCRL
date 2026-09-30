//! Integration tests: the real runner binary, the real fastchess and the
//! mock UCI engine, at a very fast time control.
//!
//! fastchess is taken from `FASTCHESS`, then `PATH`; the tests are skipped
//! (with a message) when it is not available. The workspace path contains
//! spaces, brackets and parentheses on purpose (pitfall 7).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use torsgui_core::model::*;
use torsgui_core::pgn;
use torsgui_core::store::{Desired, TState, TournamentRecord, Workspace};

fn fastchess() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("FASTCHESS") {
        if Path::new(&p).exists() {
            return Some(p.into());
        }
    }
    for c in ["/home/user/disservin/fastchess/fastchess"] {
        if Path::new(c).exists() {
            return Some(c.into());
        }
    }
    let name = if cfg!(windows) { "fastchess.exe" } else { "fastchess" };
    std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join(name)).find(|p| p.exists()))
}

fn mock() -> PathBuf {
    static M: OnceLock<PathBuf> = OnceLock::new();
    M.get_or_init(|| {
        let runner = PathBuf::from(env!("CARGO_BIN_EXE_torsgui-runner"));
        let dir = runner.parent().unwrap().to_path_buf();
        let name = if cfg!(windows) { "mock-uci.exe" } else { "mock-uci" };
        let st = Command::new(std::env::var("CARGO").unwrap_or("cargo".into())).args(["build", "-p", "mock-uci"]).status().unwrap();
        assert!(st.success());
        dir.join(name)
    })
    .clone()
}

macro_rules! need_fastchess {
    () => {
        match fastchess() {
            Some(f) => f,
            None => {
                eprintln!("fastchess not available (set FASTCHESS): skipping");
                return;
            }
        }
    };
}

fn book(dir: &Path) -> PathBuf {
    let w = ["a3", "a4", "b3", "b4", "c3", "c4", "d3", "d4", "e3", "e4", "f3", "f4", "g3", "g4", "h3", "h4", "Na3", "Nc3", "Nf3", "Nh3"];
    let b = ["a6", "a5", "b6", "b5", "c6", "c5", "d6", "d5", "e6", "e5", "f6", "f5", "g6", "g5", "h6", "h5", "Na6", "Nc6", "Nf6", "Nh6"];
    let mut s = String::new();
    for x in w {
        for y in b {
            s.push_str(&format!("[Event \"?\"]\n\n1. {x} {y} *\n\n"));
        }
    }
    let p = dir.join("book [test] (400).pgn");
    std::fs::write(&p, s).unwrap();
    p
}

fn part(name: &str, role: Role, args: &str) -> Participant {
    let m = mock();
    Participant {
        name: name.into(),
        cmd: m.to_string_lossy().into(),
        dir: m.parent().unwrap().to_string_lossy().into(),
        args: args.into(),
        options: BTreeMap::from([("Threads".into(), "${THREADS}".into()), ("Hash".into(), "${HASH}".into()), ("Ponder".into(), "false".into())]),
        role,
        engine_id: None,
        has_syzygy: true,
        uci_id: None,
        rating: None,
        rating_estimated: false,
    }
}

struct Env {
    _tmp: tempfile::TempDir,
    ws: Workspace,
    fastchess: PathBuf,
    book: PathBuf,
}

fn env() -> Option<Env> {
    let fc = fastchess()?;
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("[Francesco Torsello 2026-09-28] ws (test)");
    std::fs::create_dir_all(&root).unwrap();
    let ws = Workspace::new(&root);
    let store = ws.open().unwrap();
    let mut s = store.settings().unwrap();
    s.fastchess_path = fc.to_string_lossy().into();
    store.save_settings(&s).unwrap();
    let book = book(&root);
    Some(Env { _tmp: tmp, ws, fastchess: fc, book })
}

fn config(e: &Env, name: &str, opps: &[(&str, &str)], games: u32, lanes: u32, movetime: u32) -> TournamentConfig {
    let mut participants = vec![part("Seed 1.0", Role::Seed, &format!("--strength 80 --seed 1 --movetime {movetime}"))];
    for (i, (n, a)) in opps.iter().enumerate() {
        participants.push(part(n, Role::Opponent, &format!("--strength 40 --seed {} --movetime {movetime} {a}", i + 2)));
    }
    TournamentConfig {
        name: name.into(),
        kind: TournamentKind::Gauntlet,
        participants,
        games_per_pairing: games,
        passes: 1,
        play_passes: None,
        nodes: vec![0],
        rounds_per_pass: split_openings(games, 1, 1).unwrap(),
        lanes_per_node: lanes,
        concurrency: 1,
        threads: 1,
        hash_mb: 16,
        tc: "1+0.01".into(),
        book: e.book.to_string_lossy().into(),
        book_format: "pgn".into(),
        book_start: 1,
        event: format!("Test gauntlet {name}"),
        site: "Test".into(),
        syzygy_path: String::new(),
        adjudication: Adjudication::default(),
        extra_args: vec!["-maxmoves".into(), "80".into()],
        placement: Placement::Node,
        log_level: "info".into(),
        ccrl_list: "Blitz".into(),
        max_retries: 1,
        max_slot_attempts: 2,
        fastchess: e.fastchess.to_string_lossy().into(),
        startup_ms: 10000,
        variant: torsgui_core::model::Variant::Standard,
    }
}

fn create(e: &Env, cfg: TournamentConfig, queue: bool) -> String {
    let store = e.ws.open().unwrap();
    let rec = TournamentRecord::new(cfg);
    store.insert_tournament(&rec).unwrap();
    if queue {
        store.enqueue(&rec.id).unwrap();
    }
    rec.id
}

fn runner_cmd(e: &Env, id: &str) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_torsgui-runner"));
    c.args(["run", "--workspace", e.ws.root.to_str().unwrap(), "--id", id]);
    c
}

/// All games in the tournament's PGNs (raw, before dedupe) and unique slots.
fn games(e: &Env, id: &str) -> (usize, usize) {
    let mut raw = 0;
    let mut slots = std::collections::HashSet::new();
    for p in pgn::list_pgns(&e.ws.pgn_dir(id)) {
        for g in pgn::read_games(&p).unwrap() {
            if g.finished() {
                raw += 1;
                slots.insert(g.slot().unwrap());
            }
        }
    }
    (raw, slots.len())
}

fn state(e: &Env, id: &str) -> TState {
    e.ws.open().unwrap().tournament(id).unwrap().unwrap().state
}

fn wait_until(secs: u64, mut f: impl FnMut() -> bool) -> bool {
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn assert_pairs_complete(e: &Env, id: &str) {
    let rec = e.ws.open().unwrap().tournament(id).unwrap().unwrap();
    let loaded = torsgui_core::analysis::load(&pgn::list_pgns(&e.ws.pgn_dir(id))).unwrap();
    let st = torsgui_core::analysis::tournament_standings(&rec.config, &loaded, None, torsgui_core::stats::RowOrder::Config);
    assert!(st.incomplete_pairs.is_empty(), "incomplete colour pairs: {:?}", st.incomplete_pairs);
    assert_eq!(st.duplicates, 0);
}

#[cfg(unix)]
fn fastchess_procs_in(dir: &Path) -> usize {
    let out = Command::new("pgrep").args(["-f", "fastchess"]).output().unwrap();
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|pid| std::fs::read(format!("/proc/{pid}/cmdline")).map(|c| String::from_utf8_lossy(&c).contains(&*dir.to_string_lossy())).unwrap_or(false))
        .count()
}

#[test]
fn full_run_completes_without_duplicates() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let id = create(&e, config(&e, "full", &[("Opp A", ""), ("Opp B", "")], 4, 2, 5), false);
    let out = runner_cmd(&e, &id).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(state(&e, &id), TState::Completed);
    assert_eq!(games(&e, &id), (8, 8));
    assert_pairs_complete(&e, &id);
    // every game of a pairing uses its own opening, twice with colours reversed
    let rec = e.ws.open().unwrap().tournament(&id).unwrap().unwrap();
    assert_eq!(rec.done_games, 8);
}

#[test]
fn kill_runner_mid_game_then_resume() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let mut cfg = config(&e, "kill", &[("Opp A", ""), ("Opp B", "")], 8, 2, 40);
    cfg.tc = "3+0.05".into();
    let id = create(&e, cfg, false);
    let mut child = runner_cmd(&e, &id).spawn().unwrap();
    // wait for one recorded game and a game in progress
    assert!(wait_until(120, || games(&e, &id).1 >= 1));
    std::thread::sleep(Duration::from_millis(700));
    child.kill().unwrap(); // SIGKILL: the runner dies abruptly
    child.wait().unwrap();
    let tdir = e.ws.tournament_dir(&id);
    #[cfg(unix)]
    assert!(wait_until(10, || fastchess_procs_in(&tdir) == 0), "game processes must die with the runner");
    assert!(!torsgui_core::runner::is_running(&tdir));
    assert_eq!(state(&e, &id), TState::Running, "state survives the crash");
    let before = games(&e, &id).1;
    assert!(before < 16);
    // resume as after a reboot
    let out = Command::new(env!("CARGO_BIN_EXE_torsgui-runner")).args(["resume", "--workspace", e.ws.root.to_str().unwrap()]).output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains(&id));
    assert!(wait_until(240, || state(&e, &id) == TState::Completed), "resumed tournament must complete");
    assert!(wait_until(10, || !torsgui_core::runner::is_running(&tdir)));
    assert_eq!(games(&e, &id), (16, 16), "no duplicates, no missing games");
    assert_pairs_complete(&e, &id);
}

#[test]
fn pause_discards_games_in_progress_and_resumes() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let mut cfg = config(&e, "pause", &[("Opp A", "")], 8, 2, 40);
    cfg.tc = "3+0.05".into();
    let id = create(&e, cfg, false);
    let mut child = runner_cmd(&e, &id).spawn().unwrap();
    assert!(wait_until(120, || games(&e, &id).1 >= 1));
    e.ws.open().unwrap().set_desired(&id, Desired::Pause).unwrap();
    let st = child.wait().unwrap();
    assert!(st.success());
    assert_eq!(state(&e, &id), TState::Paused);
    let (raw, uniq) = games(&e, &id);
    assert_eq!(raw, uniq);
    assert!(uniq < 8);
    let rec = e.ws.open().unwrap().tournament(&id).unwrap().unwrap();
    let lanes = rec.status.unwrap()["lanes"].as_array().unwrap().clone();
    assert!(lanes.iter().all(|l| l["busy"] == false), "no game left running");
    // resume
    e.ws.open().unwrap().set_desired(&id, Desired::Run).unwrap();
    let out = runner_cmd(&e, &id).output().unwrap();
    assert!(out.status.success());
    assert_eq!(state(&e, &id), TState::Completed);
    assert_eq!(games(&e, &id), (8, 8));
    assert_pairs_complete(&e, &id);
}

#[test]
fn chain_of_two_tournaments() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let a = create(&e, config(&e, "chainA", &[("Opp A", "")], 4, 2, 5), true);
    let b = create(&e, config(&e, "chainB", &[("Opp B", "")], 4, 2, 5), true);
    let out = runner_cmd(&e, &a).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(state(&e, &a), TState::Completed);
    assert_eq!(state(&e, &b), TState::Completed, "B starts when A is complete");
    let store = e.ws.open().unwrap();
    let ta = store.tournament(&a).unwrap().unwrap();
    let tb = store.tournament(&b).unwrap().unwrap();
    assert!(tb.started_at.unwrap() >= ta.finished_at.unwrap());
    let ev = store.recent_events(50, None).unwrap();
    assert!(ev.iter().any(|x| x.kind == "queue_advanced"));
}

#[test]
fn manual_stop_never_starts_next() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let mut ca = config(&e, "stopA", &[("Opp A", ""), ("Opp B", "")], 8, 1, 40);
    ca.tc = "3+0.05".into();
    let a = create(&e, ca, true);
    let b = create(&e, config(&e, "stopB", &[("Opp C", "")], 2, 1, 5), true);
    let mut child = runner_cmd(&e, &a).spawn().unwrap();
    assert!(wait_until(120, || games(&e, &a).1 >= 1));
    e.ws.open().unwrap().set_desired(&a, Desired::Stop).unwrap();
    child.wait().unwrap();
    assert_eq!(state(&e, &a), TState::Stopped);
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(state(&e, &b), TState::Queued, "B must not start after a manual stop");
    assert_eq!(games(&e, &b).1, 0);
    // pausing works the same way
    let mut child = runner_cmd(&e, &a).spawn().unwrap();
    assert!(wait_until(120, || games(&e, &a).1 >= 2));
    e.ws.open().unwrap().set_desired(&a, Desired::Pause).unwrap();
    child.wait().unwrap();
    assert_eq!(state(&e, &a), TState::Paused);
    assert_eq!(state(&e, &b), TState::Queued);
}

#[test]
fn missing_games_retry_then_incomplete_without_chaining() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let mut ca = config(&e, "brokenA", &[("Opp A", "")], 2, 1, 5);
    ca.participants[1].cmd = "/nonexistent/engine".into();
    let a = create(&e, ca, true);
    let b = create(&e, config(&e, "afterB", &[("Opp B", "")], 2, 1, 5), true);
    let out = runner_cmd(&e, &a).output().unwrap();
    assert!(out.status.success());
    let rec = e.ws.open().unwrap().tournament(&a).unwrap().unwrap();
    assert_eq!(rec.state, TState::Incomplete);
    assert_eq!(rec.retries, 1, "bounded retries");
    assert_eq!(state(&e, &b), TState::Queued, "an incomplete tournament does not advance the queue");
}

#[test]
fn misbehaving_engines_are_recorded_and_reported() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let mut cfg = config(&e, "faults", &[("Crasher", "--crash-after 3"), ("Illegal", "--illegal-after 3"), ("Hanger", "--hang-after 3"), ("Slow", "--slow-start 1500")], 2, 2, 5);
    // a hung engine is waited for by fastchess (ucinewgame/ping timeouts, 60 s by default)
    cfg.extra_args.extend(["-ucinewgame-ms".into(), "3000".into(), "-ping-ms".into(), "3000".into()]);
    let id = create(&e, cfg, false);
    let out = runner_cmd(&e, &id).output().unwrap();
    eprintln!("{}", String::from_utf8_lossy(&out.stderr));
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let rec = e.ws.open().unwrap().tournament(&id).unwrap().unwrap();
    assert_eq!(rec.state, TState::Completed, "{:?}", rec.last_error);
    assert_eq!(games(&e, &id), (8, 8));
    let loaded = torsgui_core::analysis::load(&pgn::list_pgns(&e.ws.pgn_dir(&id))).unwrap();
    let terms: Vec<String> = loaded.games.iter().map(|g| format!("{} {}", g.white(), g.headers.get_or("Termination", "?"))).collect();
    let ev = e.ws.open().unwrap().recent_events(100, Some(&id)).unwrap();
    assert!(ev.iter().any(|x| x.kind == "engine_problem" || x.kind == "time_forfeit"), "terminations: {terms:?}");
    // the seed wins every game against the broken engines
    let st = torsgui_core::analysis::tournament_standings(&rec.config, &loaded, None, torsgui_core::stats::RowOrder::Config);
    for n in ["Crasher", "Illegal", "Hanger"] {
        let r = st.rows.iter().find(|r| r.name == n).unwrap();
        assert_eq!(r.wins, 2, "{n}: {terms:?}");
    }
}

#[test]
fn chess960_tournament_plays_start_positions() {
    let _ = need_fastchess!();
    let e = env().unwrap();
    let spec = torsgui_core::chess960::BookSpec { kind: torsgui_core::chess960::BookKind::Random, count: 3, seed: 5, include_standard: false };
    let book = torsgui_core::chess960::write_book(&e.ws.root, &spec).unwrap();
    let mut cfg = config(&e, "frc", &[("Opp A", "")], 6, 2, 5);
    cfg.variant = Variant::Chess960;
    cfg.book = book.to_string_lossy().into();
    cfg.book_format = "epd".into();
    cfg.extra_args = vec!["-maxmoves".into(), "120".into()];
    let id = create(&e, cfg, false);
    let out = runner_cmd(&e, &id).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(state(&e, &id), TState::Completed);
    assert_eq!(games(&e, &id), (6, 6));
    assert_pairs_complete(&e, &id);
    // each game starts from one of the book's positions, flagged as Chess960, and replays
    let starts: Vec<cozy_chess::Board> = torsgui_core::chess960::book_positions(&spec).iter().map(|(w, b)| torsgui_core::chess960::parse_fen(&torsgui_core::chess960::start_fen(*w, *b)).unwrap()).collect();
    let mut seen = std::collections::HashSet::new();
    let mut castled = 0;
    for p in pgn::list_pgns(&e.ws.pgn_dir(&id)) {
        for g in pgn::read_games(&p).unwrap() {
            assert!(g.headers.get("Variant").map(|v| v.eq_ignore_ascii_case("chess960") || v == "fischerandom").unwrap_or(false), "{:?}", g.headers);
            let fen = g.headers.get("FEN").expect("FEN header");
            let b = torsgui_core::chess960::parse_fen(fen).unwrap();
            assert!(starts.contains(&b), "start {fen} not in the book");
            seen.insert(format!("{b:#}"));
            let v = torsgui_core::live::viewer_game(&g);
            assert!(v.error.is_none(), "{:?} in {}", v.error, g.movetext);
            assert!(!v.plies.is_empty());
            castled += v.plies.iter().filter(|p| p.san.starts_with("O-O")).count();
        }
    }
    assert_eq!(seen.len(), 3, "the three start positions are each played with both colours");
    eprintln!("chess960: {castled} castling moves replayed");
}
