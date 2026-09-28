//! §9 acceptance tests on the real data of CCRL_ScirptsTests.
//! The reference repository is found through `CCRL_REF` or as the parent of
//! the TorsGUI folder; tests are skipped (with a message) when it is missing.

use std::path::{Path, PathBuf};
use torsgui_core::{analysis, engines, export, legacy, scheduler, stats::RowOrder};

fn reference() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CCRL_REF") {
        let p = PathBuf::from(p);
        if p.join("tournaments").is_dir() {
            return Some(p);
        }
    }
    let here = Path::new(env!("CARGO_MANIFEST_DIR"));
    here.ancestors().find(|a| a.join("tournaments").is_dir() && a.join("results/gauntlets").is_dir()).map(|p| p.to_path_buf())
}

macro_rules! need_ref {
    () => {
        match reference() {
            Some(r) => r,
            None => {
                eprintln!("CCRL_ScirptsTests not found (set CCRL_REF): skipping");
                return;
            }
        }
    };
}

fn load(r: &Path, name: &str) -> (legacy::LegacyTournament, analysis::Loaded) {
    let t = legacy::read(&r.join("tournaments").join(name), Some(&r.join("results/gauntlets").join(name))).unwrap();
    let l = analysis::load(&t.pgns).unwrap();
    (t, l)
}

#[test]
fn caissa_4cpu() {
    let r = need_ref!();
    let (t, l) = load(&r, "2026-09-22_Caissa_2.0_4CPU");
    assert_eq!(t.config.tc, "1690+19");
    assert_eq!(scheduler::expected_games(&t.config), 380);
    let st = analysis::tournament_standings(&t.config, &l, None, RowOrder::Config);
    let tot = &st.total;
    assert_eq!((tot.wins, tot.draws, tot.losses), (1, 376, 3));
    assert_eq!(tot.score, 189.0);
    assert_eq!(tot.games, 380);
    assert_eq!(format!("{:.1}", tot.pct), "49.7");
    assert!(st.incomplete_pairs.is_empty());
}

#[test]
fn triumviratus_8cpu() {
    let r = need_ref!();
    let (t, l) = load(&r, "2026-09-27_Triumviratus_7.0_8CPU");
    assert_eq!(t.config.tc, "103+1");
    assert_eq!(t.config.rounds_per_pass, vec![8, 7]);
    assert_eq!(scheduler::expected_games(&t.config), 870);
    let st = analysis::tournament_standings(&t.config, &l, None, RowOrder::Rating);
    assert_eq!((st.total.wins, st.total.draws, st.total.losses), (32, 831, 7));
    assert_eq!(format!("{:.1}", st.total.pct), "51.4");
    assert_eq!(st.rows.len(), 29);
    for row in &st.rows {
        assert_eq!((row.white_games, row.black_games), (15, 15), "{}", row.name);
    }
    let get = |n: &str| st.rows.iter().find(|r| r.name.starts_with(n)).unwrap();
    for n in ["RubiChess", "Starzix", "Titan"] {
        assert_eq!((get(n).wins, get(n).draws, get(n).losses), (4, 26, 0), "{n}");
    }
    assert_eq!((get("Coda").wins, get("Coda").draws, get("Coda").losses), (1, 27, 2));
    assert_eq!((get("Stockfish 19").wins, get("Stockfish 19").draws, get("Stockfish 19").losses), (0, 30, 0));
    assert!(st.incomplete_pairs.is_empty());
    // forum table of §8
    let table = torsgui_core::forum::table(&st);
    let lines: Vec<&str> = table.lines().collect();
    assert_eq!(lines[0], "Opponent                 W   D   L   Score");
    assert_eq!(lines[1], "Stockfish 19             0  30   0   15.0/30");
    assert_eq!(*lines.last().unwrap(), "Minke 7.0.0              2  28   0   16.0/30");
    assert_eq!(torsgui_core::forum::result_line(&st), "+32 =831 \u{2212}7 (51.4%)");
}

#[test]
fn stockfish_partial() {
    let r = need_ref!();
    let (t, l) = load(&r, "2026-09-28_Stockfish_19_8CPU");
    let st = analysis::tournament_standings(&t.config, &l, None, RowOrder::Rating);
    let expected = scheduler::expected_games(&t.config) as u32;
    assert_eq!(st.total.games, 298);
    assert!(st.total.games < expected, "must show as incomplete");
}

fn export_matches(r: &Path, name: &str) {
    let (t, _) = load(r, name);
    let reference = t.reference_export.clone().expect("reference export");
    let (tester, date) = legacy::export_name_parts(&reference).unwrap();
    let o = export::ExportOptions {
        tester,
        // Site is the tester's location (a setting), not the machine name the
        // Caissa gauntlet wrote in its PGNs
        site: "Milan".into(),
        date,
        seed: t.config.seeds()[0].name.clone(),
        players: t.config.participants.iter().map(|p| p.name.clone()).collect(),
        threads: t.config.threads,
        hash_mb: t.config.hash_mb,
        book: t.config.book_name(),
        egtb: t.config.syzygy_pieces(),
        make_zip: true,
    };
    let dir = tempfile::tempdir().unwrap();
    let res = export::export(&t.pgns, &o, dir.path()).unwrap();
    assert_eq!(Path::new(&res.pgn_path).file_name(), reference.file_name(), "file name");
    let zip_ref = torsgui_core::pgn::list_pgns(reference.parent().unwrap());
    let _ = zip_ref;
    let ref_zip = std::fs::read_dir(reference.parent().unwrap()).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).find(|n| n.ends_with(".zip")).unwrap();
    assert_eq!(Path::new(res.zip_path.as_ref().unwrap()).file_name().unwrap().to_string_lossy(), ref_zip);
    let mine = std::fs::read_to_string(&res.pgn_path).unwrap();
    let theirs = torsgui_core::pgn::read_text(&reference).unwrap();
    export::same_content(&mine, &theirs).unwrap();
}

#[test]
fn export_triumviratus_identical_content() {
    let r = need_ref!();
    export_matches(&r, "2026-09-27_Triumviratus_7.0_8CPU");
}

#[test]
fn export_caissa_identical_content() {
    let r = need_ref!();
    export_matches(&r, "2026-09-22_Caissa_2.0_4CPU");
}

#[test]
fn library_from_report() {
    let r = need_ref!();
    let report = std::fs::read_to_string(r.join("engines/REPORT.md")).unwrap();
    let lib = engines::rebuild_from_report(&report, Some(&r.join("engines/uci_options")));
    assert_eq!(lib.len(), 36);
    let get = |n: &str| lib.iter().find(|e| e.display_name == n).unwrap_or_else(|| panic!("{n}"));
    let coda = get("Coda 0.9.3");
    assert_eq!(coda.default_options.get("OwnBook").map(|s| s.as_str()), Some("false"));
    assert!(get("Motor 0.9.0").flags.iter().any(|f| f == "single-thread only"));
    assert!(!get("Motor 0.9.0").used);
    assert!(get("Stormphrax 8.0.0").flags.iter().any(|f| f.contains("bmi2")));
    assert_eq!(get("Triumviratus 7.0").threads_max, Some(40));
    assert_eq!(get("Caissa 2.0").sha256, "043c0925df8c608d0d87b9e6b1c761240ddd1901ee8cba49e346686b28816b97");
    assert!(lib.iter().all(|e| !e.options_text.is_empty()), "uci options for every engine");
    // the asset selector picks the asset of the report for every engine
    // (the release asset lists are in assets::tests::report_choices)
    for e in &lib {
        let s = torsgui_core::assets::select(&[e.asset.clone(), format!("{}-avx512.exe", e.engine), format!("{}-win32.exe", e.engine)], torsgui_core::assets::TargetOs::Windows);
        assert_eq!(s.chosen.as_deref(), Some(e.asset.as_str()), "{}", e.display_name);
    }
}

/// Byte compatibility with tools/export_ccrl.py (needs python3).
#[test]
fn export_byte_compatible_with_python() {
    let r = need_ref!();
    if std::process::Command::new("python3").arg("--version").output().is_err() {
        eprintln!("python3 missing: skipping");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let g = dir.path().join("g");
    for d in ["scripts", "config", "pgn"] {
        std::fs::create_dir_all(g.join(d)).unwrap();
    }
    let name = "2026-09-27_Triumviratus_7.0_8CPU";
    std::fs::copy(r.join("tournaments").join(name).join("scripts/gauntlet.bat"), g.join("scripts/gauntlet.bat")).unwrap();
    std::fs::copy(r.join("tournaments").join(name).join("config/engines.json"), g.join("config/engines.json")).unwrap();
    // fixture: two lane files with CRLF, a duplicate (later end time), an unfinished game
    let all = std::fs::read_to_string(r.join("results/gauntlets").join(name).join("all_games.pgn")).unwrap();
    let blocks = torsgui_core::pgn::game_blocks(&all);
    let a: Vec<&str> = blocks[..40].to_vec();
    let b: Vec<&str> = blocks[40..80].to_vec();
    let dup = blocks[3].replace("[GameEndTime \"2026-09-27T", "[GameEndTime \"2026-09-28T").replace("1/2-1/2", "1-0");
    let unfinished = "[Event \"x node0 pass1 r99\"]\n[Result \"*\"]\n\n1. e4 *";
    let lane0 = format!("{}\n\n{}\n\n", a.join("\n\n"), dup).replace('\n', "\r\n");
    let lane1 = format!("{}\n\n{}\n\n", b.join("\n\n"), unfinished);
    std::fs::write(g.join("pgn/node0_lane0.pgn"), lane0).unwrap();
    std::fs::write(g.join("pgn/node1_lane0.pgn"), lane1).unwrap();
    let out = std::process::Command::new("python3")
        .arg(r.join("tools/export_ccrl.py"))
        .args(["--gauntlet-dir", g.to_str().unwrap(), "--name", "Tester Name", "--site", "Milan", "--date", "2026-09-28", "--no-zip"])
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let py = std::fs::read_dir(g.join("results")).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.extension().map(|x| x == "pgn").unwrap_or(false)).unwrap();
    let t = legacy::read(&r.join("tournaments").join(name), None);
    let _ = t;
    let o = export::ExportOptions {
        tester: "Tester Name".into(),
        site: "Milan".into(),
        date: "2026-09-28".into(),
        seed: "Triumviratus 7.0".into(),
        players: serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(g.join("config/engines.json")).unwrap()).unwrap()["opponents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["name"].as_str().unwrap().to_string())
            .chain(std::iter::once("Triumviratus 7.0".to_string()))
            .collect(),
        threads: 8,
        hash_mb: 4096,
        book: "avt-book-2026".into(),
        egtb: 5,
        make_zip: false,
    };
    let files = torsgui_core::pgn::list_pgns(&g.join("pgn"));
    let res = export::export(&files, &o, &dir.path().join("rust")).unwrap();
    assert_eq!(res.duplicates_dropped, 1);
    assert_eq!(Path::new(&res.pgn_path).file_name(), py.file_name());
    let a = std::fs::read(&res.pgn_path).unwrap();
    let b = std::fs::read(&py).unwrap();
    assert!(a == b, "export differs from export_ccrl.py ({} vs {} bytes)", a.len(), b.len());
}
