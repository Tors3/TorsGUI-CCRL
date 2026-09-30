//! Checks before a CCRL submission: what a tester verifies by hand before sending the PGN
//! (all games, both colours, hash rule, ponder off, CCRL builds, names, time control from a
//! recent bench, variant and list, tester and site). Each check says why it matters.

use crate::engines::EngineEntry;
use crate::model::{TournamentConfig, Variant};
use crate::stats::Standings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CheckStatus {
    Ok,
    Info,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CheckItem {
    pub id: String,
    pub label: String,
    pub status: CheckStatus,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Checklist {
    pub items: Vec<CheckItem>,
    /// No failed check.
    pub ready: bool,
}

/// What the checks look at.
pub struct Input<'a> {
    pub cfg: &'a TournamentConfig,
    pub standings: &'a Standings,
    pub done: u32,
    pub expected: u32,
    pub imported: bool,
    /// The library entry of each participant (None: not in the library, e.g. imported).
    pub engines: Vec<Option<EngineEntry>>,
    pub tester: &'a str,
    pub site: &'a str,
    /// (date "YYYY-MM-DD…", min factor, max factor) of the latest valid bench.
    pub bench: Option<(String, f64, f64)>,
    /// Today, "YYYY-MM-DD".
    pub today: &'a str,
    /// Opponents found in the CCRL list (name → found without estimate).
    pub in_list: Vec<(String, bool)>,
}

fn item(id: &str, label: &str, status: CheckStatus, detail: impl Into<String>) -> CheckItem {
    CheckItem { id: id.into(), label: label.into(), status, detail: detail.into() }
}

fn days_between(a: &str, b: &str) -> Option<i64> {
    let p = |s: &str| chrono::NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok();
    Some((p(b)? - p(a)?).num_days())
}

pub fn check(i: &Input) -> Checklist {
    use CheckStatus::*;
    let c = i.cfg;
    let mut v = Vec::new();

    // games and colours
    v.push(if i.done >= i.expected && i.expected > 0 {
        item("games", "All games played", Ok, format!("{}/{} games", i.done, i.expected))
    } else {
        item("games", "All games played", Fail, format!("{}/{} games: finish the tournament (or cut it at a complete pass) before submitting", i.done, i.expected))
    });
    v.push(if i.standings.incomplete_pairs.is_empty() {
        item("colours", "Every opening with both colours", Ok, "all colour pairs complete")
    } else {
        let ex: Vec<String> = i.standings.incomplete_pairs.iter().take(4).map(|p| format!("{} n{} p{} r{}", p.opponent, p.node, p.pass, p.round)).collect();
        item("colours", "Every opening with both colours", Fail, format!("{} incomplete pairs ({}…): the colour-reversed game is missing", i.standings.incomplete_pairs.len(), ex.join(", ")))
    });
    v.push(if i.standings.duplicates == 0 {
        item("duplicates", "No duplicate games", Ok, "none")
    } else {
        item("duplicates", "No duplicate games", Info, format!("{} duplicates in the PGNs: the export keeps the first of each slot", i.standings.duplicates))
    });
    let bad: Vec<String> = i.standings.termination_totals.iter().filter(|(k, n)| **n > 0 && !matches!(k.to_lowercase().as_str(), "normal" | "adjudication")).map(|(k, n)| format!("{n} {k}")).collect();
    v.push(if bad.is_empty() {
        item("terminations", "No crashes, time losses or illegal moves", Ok, "only normal ends and adjudications")
    } else {
        item("terminations", "No crashes, time losses or illegal moves", Warn, format!("{}: check the games (Decisive / Terminations) and mention them in the post", bad.join(", ")))
    });

    // CCRL conditions
    let rule = 512 * c.threads;
    v.push(if c.hash_mb == rule {
        item("hash", "Hash 512 MB per thread", Ok, format!("{} MB for {} thread(s)", c.hash_mb, c.threads))
    } else {
        item("hash", "Hash 512 MB per thread", Fail, format!("{} MB, the CCRL rule gives {} MB for {} thread(s)", c.hash_mb, rule, c.threads))
    });
    let ponder: Vec<&str> = c.participants.iter().filter(|p| p.options.iter().any(|(k, v)| k.eq_ignore_ascii_case("Ponder") && v.eq_ignore_ascii_case("true"))).map(|p| p.name.as_str()).collect();
    v.push(if ponder.is_empty() {
        item("ponder", "Ponder off", Ok, "no engine ponders (fastchess never sends go ponder)")
    } else {
        item("ponder", "Ponder off", Fail, format!("Ponder=true for {}", ponder.join(", ")))
    });
    let book = c.book_name();
    v.push(if book.is_empty() {
        item("book", "Opening book", Fail, "no book: every game would start from the initial position")
    } else {
        item("book", "Opening book", Ok, format!("{book}, the same for every engine, each opening with both colours"))
    });
    let tb = c.syzygy_pieces();
    let no_tb: Vec<&str> = c.participants.iter().filter(|p| !p.has_syzygy).map(|p| p.name.as_str()).collect();
    v.push(if tb == 0 {
        item("egtb", "Tablebases", Info, "no Syzygy path: engines play without tablebases (egtb 0 in the file name)")
    } else if no_tb.is_empty() {
        item("egtb", "Tablebases", Ok, format!("{tb}-man Syzygy for every engine"))
    } else {
        item("egtb", "Tablebases", Info, format!("{tb}-man Syzygy; without Syzygy support: {}", no_tb.join(", ")))
    });

    // builds
    let lib: Vec<&EngineEntry> = i.engines.iter().flatten().collect();
    if i.imported || lib.is_empty() {
        v.push(item("builds", "CCRL builds", Info, "engines of an imported tournament: builds not checked"));
    } else {
        let avx512: Vec<&str> = lib.iter().filter(|e| e.flags.iter().any(|f| f.starts_with("AVX-512 build: personal"))).map(|e| e.display_name.as_str()).collect();
        let flagged: Vec<String> = lib.iter().filter(|e| e.flags.iter().any(|f| f.ends_with(" build") || f.contains("flagged"))).map(|e| format!("{} ({})", e.display_name, e.build)).collect();
        let bits32: Vec<&str> = lib.iter().filter(|e| e.flags.iter().any(|f| f == "32-bit")).map(|e| e.display_name.as_str()).collect();
        v.push(if !avx512.is_empty() || !bits32.is_empty() {
            item("builds", "CCRL builds (AVX2, 64-bit)", Fail, format!("not valid for CCRL: {}", avx512.iter().chain(bits32.iter()).cloned().collect::<Vec<_>>().join(", ")))
        } else if !flagged.is_empty() {
            item("builds", "CCRL builds (AVX2, 64-bit)", Warn, format!("no pure AVX2 build published, flagged: {}", flagged.join(", ")))
        } else {
            item("builds", "CCRL builds (AVX2, 64-bit)", Ok, "AVX2 builds, 64-bit")
        });
        let unverified: Vec<&str> = lib.iter().filter(|e| e.verify_status != "ok").map(|e| e.display_name.as_str()).collect();
        v.push(if unverified.is_empty() {
            item("verified", "Engines verified", Ok, "uci / isready / go depth 12 passed for every engine")
        } else {
            item("verified", "Engines verified", Warn, format!("not verified: {}", unverified.join(", ")))
        });
    }

    // names
    let no_version: Vec<&str> = c.participants.iter().filter(|p| !p.name.chars().any(|ch| ch.is_ascii_digit())).map(|p| p.name.as_str()).collect();
    let missing: Vec<&str> = i.in_list.iter().filter(|(_, ok)| !ok).map(|(n, _)| n.as_str()).collect();
    v.push(if !no_version.is_empty() {
        item("names", "CCRL names", Warn, format!("no version in {}: CCRL names are \"<Engine> <version>\" (Configuration → Rename an engine)", no_version.join(", ")))
    } else if !missing.is_empty() {
        item("names", "CCRL names", Warn, format!("opponents not found in the CCRL list (spelling, or not rated yet): {}", missing.join(", ")))
    } else {
        item("names", "CCRL names", Ok, format!("\"<Engine> <version> 64-bit{}\" in the export", if c.threads > 1 { format!(" {}CPU", c.threads) } else { String::new() }))
    });

    // time control
    let nominal = crate::tournament_file::nominal_for(&c.ccrl_list);
    let implied = crate::tc::parse_fastchess(&c.tc).map(|(_, base, _)| base / nominal.base_s).filter(|f| f.is_finite() && *f > 0.0);
    v.push(match (&i.bench, implied) {
        (None, _) => item("tc", "Time control from a bench", Warn, format!("TC {}: no valid bench on this machine (Bench → run the SF10 bench)", c.tc)),
        (Some((date, lo, hi)), f) => {
            let age = days_between(date, i.today).unwrap_or(0);
            let fs = f.map(|f| format!("{f:.3}")).unwrap_or("?".into());
            match f {
                Some(f) if f < lo * 0.97 || f > hi * 1.03 => item("tc", "Time control from a bench", Warn, format!("TC {} implies factor {fs}, the latest bench ({}) gives {lo:.3}–{hi:.3}", c.tc, &date[..10.min(date.len())])),
                _ if age > 90 => item("tc", "Time control from a bench", Warn, format!("TC {} (factor {fs}); the latest bench is {age} days old: run it again", c.tc)),
                _ => item("tc", "Time control from a bench", Ok, format!("TC {} for CCRL {} (factor {fs}; bench {} gives {lo:.3}–{hi:.3})", c.tc, c.ccrl_list, &date[..10.min(date.len())])),
            }
        }
    });

    // variant and list
    let frc_list = crate::tournament_file::is_frc_list(&c.ccrl_list);
    v.push(match (c.variant, frc_list) {
        (Variant::Chess960, true) | (Variant::Standard, false) => item("variant", "Variant and list", Ok, format!("{} for the CCRL {} list", if c.variant == Variant::Chess960 { "Chess960" } else { "standard chess" }, c.ccrl_list)),
        (Variant::Chess960, false) => item("variant", "Variant and list", Fail, format!("Chess960 games for the {} list: use the FRC list", c.ccrl_list)),
        (Variant::Standard, true) => item("variant", "Variant and list", Fail, "standard games for the FRC list: the tournament must be Chess960"),
    });

    // tester
    v.push(if i.tester.trim().is_empty() || i.site.trim().is_empty() {
        item("tester", "Tester name and site", Fail, "set them in Settings (file name and PGN Site tag)")
    } else {
        item("tester", "Tester name and site", Ok, format!("{} · {}", i.tester, i.site))
    });

    let ready = !v.iter().any(|x| x.status == Fail);
    Checklist { items: v, ready }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use std::collections::BTreeMap;

    fn cfg() -> TournamentConfig {
        let mut c = crate::scheduler::tests::cfg(TournamentKind::Gauntlet, &["Seed 1.0"], &["Opp 2.0", "Opp 3.1"], 30, 1, 2);
        c.threads = 8;
        c.hash_mb = 4096;
        c.tc = "103+1".into();
        c.book = "/books/avt-book-2026.pgn".into();
        c.syzygy_path = "C:/tb/syzygy5".into();
        c.ccrl_list = "Blitz".into();
        c
    }
    fn standings() -> Standings {
        serde_json::from_value(serde_json::json!({
            "seed": "Seed 1.0", "games": 60, "unfinished": 0, "duplicates": 0, "rows": [],
            "total": row(), "white": row(), "black": row(), "general": [], "terminations": [],
            "termination_totals": {"normal": 40, "adjudication": 20}, "incomplete_pairs": [],
            "avg_duration_s": null, "min_duration_s": null, "max_duration_s": null, "decisive": [],
            "performance": null, "avg_opponent_rating": null, "elo": []
        }))
        .unwrap()
    }
    fn row() -> serde_json::Value {
        serde_json::to_value(crate::stats::Row::default()).unwrap()
    }
    fn engine(name: &str) -> EngineEntry {
        EngineEntry { display_name: name.into(), verify_status: "ok".into(), build: "avx2".into(), ..Default::default() }
    }
    fn input<'a>(c: &'a TournamentConfig, st: &'a Standings, engines: Vec<Option<EngineEntry>>) -> Input<'a> {
        Input {
            cfg: c,
            standings: st,
            done: 60,
            expected: 60,
            imported: false,
            engines,
            tester: "Francesco Torsello",
            site: "Milan",
            bench: Some(("2026-09-27T10:00:00".into(), 0.84, 0.88)),
            today: "2026-09-30",
            in_list: vec![("Opp 2.0".into(), true), ("Opp 3.1".into(), true)],
        }
    }

    #[test]
    fn a_clean_gauntlet_is_ready() {
        let c = cfg();
        let st = standings();
        let r = check(&input(&c, &st, vec![Some(engine("Seed 1.0")), Some(engine("Opp 2.0")), Some(engine("Opp 3.1"))]));
        let bad: Vec<_> = r.items.iter().filter(|i| !matches!(i.status, CheckStatus::Ok | CheckStatus::Info)).collect();
        assert!(r.ready && bad.is_empty(), "{bad:?}");
        assert!(r.items.iter().any(|i| i.id == "tc" && i.detail.contains("factor 0.858")));
    }

    #[test]
    fn problems_are_explained() {
        let mut c = cfg();
        c.hash_mb = 2048;
        c.participants[1].options = BTreeMap::from([("Ponder".into(), "true".into())]);
        c.participants[2].name = "Opp".into();
        c.variant = Variant::Chess960;
        c.tc = "60+0.6".into();
        let mut st = standings();
        st.incomplete_pairs.push(crate::stats::PairIssue { opponent: "Opp 2.0".into(), node: 0, pass: 1, round: 3, games: 1 });
        st.termination_totals.insert("time forfeit".into(), 2);
        let mut avx = engine("Opp 2.0");
        avx.flags.push("AVX-512 build: personal use, not valid for CCRL".into());
        let mut i = input(&c, &st, vec![Some(engine("Seed 1.0")), Some(avx), None]);
        i.done = 58;
        i.tester = "";
        i.bench = Some(("2026-05-01".into(), 0.84, 0.88));
        let r = check(&i);
        assert!(!r.ready);
        let status = |id: &str| r.items.iter().find(|x| x.id == id).unwrap().status;
        for id in ["games", "colours", "hash", "ponder", "builds", "variant", "tester"] {
            assert_eq!(status(id), CheckStatus::Fail, "{id}: {:?}", r.items.iter().find(|x| x.id == id));
        }
        for id in ["terminations", "names", "tc"] {
            assert_eq!(status(id), CheckStatus::Warn, "{id}");
        }
        assert!(r.items.iter().find(|x| x.id == "tc").unwrap().detail.contains("implies factor 0.500"));
        // no bench at all
        i.bench = None;
        assert!(check(&i).items.iter().any(|x| x.id == "tc" && x.detail.contains("no valid bench")));
    }
}
