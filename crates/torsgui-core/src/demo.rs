//! The guided setup ("Getting started") and the demo tournament.
//!
//! The demo uses the *TorsGUI demo engine* (the `mock-uci` test engine, bundled as a sidecar
//! named `torsgui-demo-engine`): three library entries with different strengths play a short
//! gauntlet with the real runner and fastchess, so a new user sees every screen at work
//! without downloading engines. The engines play legal but weak chess.

use crate::model::{Adjudication, Participant, Placement, Role, TournamentConfig, TournamentKind, Variant};
use anyhow::Result;
use cozy_chess::Board;
use cozy_chess::util::parse_san_move;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Marker stored in the notes of the demo engines.
pub const DEMO_NOTE: &str = "TorsGUI demo engine (for the guided demo, never for rating lists)";

/// (name, version, strength 0-100, move time ms)
pub const DEMO_ENGINES: [(&str, &str, u32, u32); 3] = [("TorsGUI Demo", "1.0", 85, 250), ("Sparring Alpha", "1.0", 45, 250), ("Sparring Beta", "1.0", 65, 250)];

/// The bundled demo engine: `TORSGUI_DEMO_ENGINE`, else next to the executable
/// (`torsgui-demo-engine`, or `mock-uci` in a development build).
pub fn engine_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("TORSGUI_DEMO_ENGINE") {
        if Path::new(&p).exists() {
            return Some(p.into());
        }
    }
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    ["torsgui-demo-engine", "mock-uci"].iter().map(|n| dir.join(format!("{n}{ext}"))).find(|p| p.exists())
}

/// Common openings (4-8 plies), as SAN from the initial position.
const OPENINGS: [&str; 16] = [
    "e4 e5 Nf3 Nc6 Bb5 a6",
    "e4 e5 Nf3 Nc6 Bc4 Bc5",
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6",
    "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6",
    "e4 e6 d4 d5 Nc3 Nf6",
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5",
    "e4 d5 exd5 Qxd5 Nc3 Qa5",
    "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7",
    "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4",
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6",
    "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O",
    "d4 Nf6 c4 e6 Nf3 b6 g3 Ba6",
    "c4 e5 Nc3 Nf6 Nf3 Nc6",
    "c4 c5 Nf3 Nf6 Nc3 Nc6",
    "Nf3 d5 g3 Nf6 Bg2 c6",
    "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4",
];

/// Writes the demo's opening book (EPD) and returns its path.
pub fn write_openings(dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let mut s = String::new();
    for (i, line) in OPENINGS.iter().enumerate() {
        let mut b = Board::default();
        for san in line.split_whitespace() {
            let mv = parse_san_move(&b, san).map_err(|e| anyhow::anyhow!("demo opening {line}: {san}: {e:?}"))?;
            b.play(mv);
        }
        let fen = b.to_string();
        let epd: Vec<&str> = fen.split_whitespace().take(4).collect();
        s.push_str(&format!("{} id \"demo {}\";\n", epd.join(" "), i + 1));
    }
    let p = dir.join("demo-openings.epd");
    std::fs::write(&p, s)?;
    Ok(p)
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SetupStep {
    pub id: String,
    pub done: bool,
    /// What was found (e.g. "3 verified engines").
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SetupStatus {
    pub steps: Vec<SetupStep>,
    pub done: u32,
    pub total: u32,
    pub demo_engine: bool,
    pub fastchess: bool,
    /// Demo tournaments already created (id, name, state).
    pub demos: Vec<(String, String, String)>,
    /// Engines shipped with this installation ("Stockfish 10", "Triumviratus 7.0").
    pub bundled: Vec<String>,
}

/// The demo gauntlet: the demo engine against two sparring partners, 8 games each.
pub fn tournament(engine: &Path, ids: &[Option<i64>], variant: Variant, book: &Path, node: u32, lanes: u32) -> TournamentConfig {
    let participants: Vec<Participant> = DEMO_ENGINES
        .iter()
        .enumerate()
        .map(|(i, (name, ver, strength, movetime))| Participant {
            name: crate::names::display_name(name, ver),
            cmd: engine.to_string_lossy().into(),
            dir: engine.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            args: format!("--seed {}", i + 1),
            options: BTreeMap::from([
                ("Threads".into(), "${THREADS}".into()),
                ("Hash".into(), "${HASH}".into()),
                ("Strength".into(), strength.to_string()),
                ("MoveTime".into(), movetime.to_string()),
            ]),
            role: if i == 0 { Role::Seed } else { Role::Opponent },
            engine_id: ids.get(i).copied().flatten(),
            has_syzygy: true,
            uci_id: Some("TorsGUI Demo Engine".into()),
            rating: None,
            rating_estimated: false,
        })
        .collect();
    let frc = variant == Variant::Chess960;
    let list = if frc { "FRC" } else { "Blitz" };
    let seed = participants[0].name.clone();
    TournamentConfig {
        name: format!("Demo {} gauntlet {seed}", if frc { "Chess960" } else { "Blitz" }),
        kind: TournamentKind::Gauntlet,
        participants,
        games_per_pairing: 8,
        passes: 1,
        play_passes: None,
        nodes: vec![node],
        rounds_per_pass: vec![4],
        lanes_per_node: lanes,
        concurrency: 1,
        threads: 1,
        hash_mb: 512,
        tc: "30+0.3".into(),
        book: book.to_string_lossy().into(),
        book_format: "epd".into(),
        book_start: 1,
        event: format!("CCRL {list} gauntlet {seed} 1CPU"),
        site: String::new(),
        syzygy_path: String::new(),
        adjudication: Adjudication::default(),
        extra_args: vec!["-maxmoves".into(), "150".into()],
        placement: Placement::Node,
        log_level: "info".into(),
        ccrl_list: list.into(),
        max_retries: 1,
        max_slot_attempts: 2,
        fastchess: String::new(),
        startup_ms: 20000,
        variant,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_openings_are_legal_positions() {
        let t = tempfile::tempdir().unwrap();
        let p = write_openings(t.path()).unwrap();
        let text = std::fs::read_to_string(p).unwrap();
        assert_eq!(text.lines().count(), OPENINGS.len());
        for l in text.lines() {
            let fen = l.split(" id ").next().unwrap();
            crate::chess960::parse_fen(&format!("{fen} 0 1")).unwrap();
        }
    }

    #[test]
    fn demo_tournament_is_consistent() {
        let t = tempfile::tempdir().unwrap();
        let c = tournament(Path::new("/x/torsgui-demo-engine"), &[Some(1), Some(2), Some(3)], Variant::Standard, &t.path().join("b.epd"), 0, 2);
        assert_eq!(crate::scheduler::expected_games(&c), 16);
        assert_eq!(c.rounds_per_pass, crate::model::split_openings(8, 1, 1).unwrap());
        assert_eq!(c.participants[0].name, "TorsGUI Demo 1.0");
        assert_eq!(c.participants[1].options["Strength"], "45");
        let f = tournament(Path::new("/x/e"), &[], Variant::Chess960, &t.path().join("b.epd"), 0, 1);
        assert_eq!(f.ccrl_list, "FRC");
        assert!(f.event.starts_with("CCRL FRC gauntlet"));
    }
}
