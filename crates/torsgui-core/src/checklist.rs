//! Checks before a CCRL submission: what a tester verifies by hand before sending the PGN
//! (all games, both colours, hash rule, ponder off, CCRL builds, names, time control from a
//! recent bench, variant and list, tester and site). Each check says why it matters.

use crate::engines::EngineEntry;
use crate::model::{TournamentConfig, Variant};
use crate::msg;
use crate::msg::Msg;
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
    pub label: Msg,
    pub status: CheckStatus,
    pub detail: Msg,
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

fn item(id: &str, label: Msg, status: CheckStatus, detail: Msg) -> CheckItem {
    CheckItem { id: id.into(), label, status, detail }
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
    let label = msg!("check.games.label", "All games played");
    v.push(if i.done >= i.expected && i.expected > 0 {
        item("games", label, Ok, msg!("check.games.ok", "{done}/{expected} games", done = i.done, expected = i.expected))
    } else {
        item("games", label, Fail, msg!("check.games.missing", "{done}/{expected} games: finish the tournament (or cut it at a complete pass) before submitting", done = i.done, expected = i.expected))
    });
    // with random openings a pair is the same two engines with colours reversed, each game
    // with its own opening
    let colours = || if c.random_openings { msg!("check.colours.labelPairs", "Every pair with both colours") } else { msg!("check.colours.label", "Every opening with both colours") };
    v.push(if i.standings.incomplete_pairs.is_empty() {
        item("colours", colours(), Ok, if c.random_openings { msg!("check.colours.okPairs", "all pairs complete (one random opening per game)") } else { msg!("check.colours.ok", "all colour pairs complete") })
    } else {
        let ex: Vec<String> = i.standings.incomplete_pairs.iter().take(4).map(|p| format!("{} n{} p{} r{}", p.opponent, p.node, p.pass, p.round)).collect();
        item("colours", colours(), Fail, msg!("check.colours.incomplete", "{count} incomplete pairs ({examples}…): the colour-reversed game is missing", count = i.standings.incomplete_pairs.len(), examples = ex.join(", ")))
    });
    let label = msg!("check.duplicates.label", "No duplicate games");
    v.push(if i.standings.duplicates == 0 {
        item("duplicates", label, Ok, msg!("check.duplicates.none", "none"))
    } else {
        item("duplicates", label, Info, msg!("check.duplicates.some", "{count} duplicates in the PGNs: the export keeps the first of each slot", count = i.standings.duplicates))
    });
    let bad: Vec<String> = i.standings.termination_totals.iter().filter(|(k, n)| **n > 0 && !matches!(k.to_lowercase().as_str(), "normal" | "adjudication")).map(|(k, n)| format!("{n} {k}")).collect();
    let label = msg!("check.terminations.label", "No crashes, time losses or illegal moves");
    v.push(if bad.is_empty() {
        item("terminations", label, Ok, msg!("check.terminations.ok", "only normal ends and adjudications"))
    } else {
        item("terminations", label, Warn, msg!("check.terminations.bad", "{list}: check the games (Decisive / Terminations) and mention them in the post", list = bad.join(", ")))
    });

    // CCRL conditions
    let rule = c.ccrl_hash(c.threads);
    let title = || if crate::model::is_blitz(&c.ccrl_list) { msg!("check.hash.labelBlitz", "Hash 256 MB per thread (Blitz)") } else { msg!("check.hash.label", "Hash 1024 MB at 1CPU, 512 MB per thread from 2 threads") };
    v.push(if c.as_is {
        item("hash", title(), Warn, msg!("check.hash.asIs", "as is: the hash of each engine is the one of its options (or its default); check it follows the CCRL rule ({rule} MB for {threads} thread(s))", rule = rule, threads = c.threads))
    } else if c.hash_mb == rule {
        item("hash", title(), Ok, msg!("check.hash.ok", "{hash} MB for {threads} thread(s)", hash = c.hash_mb, threads = c.threads))
    } else {
        item("hash", title(), Fail, msg!("check.hash.wrong", "{hash} MB, the CCRL rule gives {rule} MB for {threads} thread(s)", hash = c.hash_mb, rule = rule, threads = c.threads))
    });
    let gpu: Vec<&str> = c.gpu_engines().iter().map(|p| p.name.as_str()).collect();
    let label = msg!("check.gpu.label", "CPU engines");
    v.push(if gpu.is_empty() {
        item("gpu", label, Ok, msg!("check.gpu.none", "every engine runs on the CPU"))
    } else {
        item("gpu", label, Warn, msg!("check.gpu.some", "GPU engines: {list}. The CCRL lists are for engines on the CPU (the time control is scaled by a CPU bench): send these games only if CCRL asked for them", list = gpu.join(", ")))
    });
    let ponder: Vec<&str> = c.participants.iter().filter(|p| p.options.iter().any(|(k, v)| k.eq_ignore_ascii_case("Ponder") && v.eq_ignore_ascii_case("true"))).map(|p| p.name.as_str()).collect();
    let label = msg!("check.smt.label", "One engine thread per physical core");
    v.push(if c.use_smt {
        item("smt", label, Warn, msg!("check.smt.on", "SMT / Hyper-Threading is on: engines may share a physical core and search slower than on the CCRL machines; mention it in the post"))
    } else {
        item("smt", label, Ok, msg!("check.smt.off", "SMT / Hyper-Threading siblings left free"))
    });
    let label = msg!("check.ponder.label", "Ponder off");
    v.push(if ponder.is_empty() {
        item("ponder", label, Ok, msg!("check.ponder.ok", "no engine ponders (fastchess never sends go ponder)"))
    } else {
        item("ponder", label, Fail, msg!("check.ponder.on", "Ponder=true for {list}", list = ponder.join(", ")))
    });
    let book = c.book_name();
    let label = msg!("check.book.label", "Opening book");
    v.push(if book.is_empty() {
        item("book", label, Fail, msg!("check.book.none", "no book: every game would start from the initial position"))
    } else if c.random_openings {
        item("book", label, Ok, msg!("check.book.random", "{book}, the same for every engine, one random opening per game (seed fixed: a resumed game keeps its opening)", book = book))
    } else {
        item("book", label, Ok, msg!("check.book.ok", "{book}, the same for every engine, each opening with both colours", book = book))
    });
    let tb = c.syzygy_pieces();
    let no_tb: Vec<&str> = c.participants.iter().filter(|p| !p.has_syzygy).map(|p| p.name.as_str()).collect();
    let label = msg!("check.egtb.label", "Tablebases");
    v.push(if tb == 0 {
        item("egtb", label, Info, msg!("check.egtb.none", "no Syzygy path: engines play without tablebases (egtb 0 in the file name)"))
    } else if no_tb.is_empty() {
        item("egtb", label, Ok, msg!("check.egtb.ok", "{pieces}-man Syzygy for every engine", pieces = tb))
    } else {
        item("egtb", label, Info, msg!("check.egtb.some", "{pieces}-man Syzygy; without Syzygy support: {list}", pieces = tb, list = no_tb.join(", ")))
    });

    // builds
    let lib: Vec<&EngineEntry> = i.engines.iter().flatten().collect();
    if i.imported || lib.is_empty() {
        v.push(item("builds", msg!("check.builds.labelShort", "CCRL builds"), Info, msg!("check.builds.imported", "engines of an imported tournament: builds not checked")));
    } else {
        let other: Vec<String> = lib.iter().filter(|e| !e.is_demo() && crate::assets::build_level(&e.build) == "other").map(|e| format!("{} ({})", e.display_name, e.build)).collect();
        let unknown: Vec<&str> = lib.iter().filter(|e| !e.is_demo() && crate::assets::build_level(&e.build).is_empty()).map(|e| e.display_name.as_str()).collect();
        let bits32: Vec<&str> = lib.iter().filter(|e| e.flags.iter().any(|f| f == "32-bit")).map(|e| e.display_name.as_str()).collect();
        let avx512 = lib.iter().filter(|e| crate::assets::build_level(&e.build) == "avx512").count();
        let label = msg!("check.builds.label", "CCRL builds (AVX2 or AVX-512, 64-bit)");
        v.push(if !bits32.is_empty() {
            item("builds", label, Fail, msg!("check.builds.bits32", "32-bit builds are not valid for CCRL: {list}", list = bits32.join(", ")))
        } else if !other.is_empty() {
            item("builds", label, Warn, msg!("check.builds.other", "not an AVX2 or AVX-512 build: {list} — fine only if no AVX2 or AVX-512 build of them exists", list = other.join(", ")))
        } else if !unknown.is_empty() {
            item("builds", label, Warn, msg!("check.builds.unknown", "valid for CCRL only if these are AVX2 or AVX-512 builds (unknown from the file name): {list}", list = unknown.join(", ")))
        } else if avx512 > 0 {
            item("builds", label, Ok, msg!("check.builds.okAvx512", "AVX2 or AVX-512 builds ({count} AVX-512), 64-bit", count = avx512))
        } else {
            item("builds", label, Ok, msg!("check.builds.ok", "AVX2 builds, 64-bit"))
        });
        let unverified: Vec<&str> = lib.iter().filter(|e| e.verify_status != "ok").map(|e| e.display_name.as_str()).collect();
        let label = msg!("check.verified.label", "Engines verified");
        v.push(if unverified.is_empty() {
            item("verified", label, Ok, msg!("check.verified.ok", "uci / isready / go depth 12 passed for every engine"))
        } else {
            item("verified", label, Warn, msg!("check.verified.missing", "not verified: {list}", list = unverified.join(", ")))
        });
    }

    // names
    let no_version: Vec<&str> = c.participants.iter().filter(|p| !p.name.chars().any(|ch| ch.is_ascii_digit())).map(|p| p.name.as_str()).collect();
    let missing: Vec<&str> = i.in_list.iter().filter(|(_, ok)| !ok).map(|(n, _)| n.as_str()).collect();
    let label = msg!("check.names.label", "CCRL names");
    v.push(if !no_version.is_empty() {
        item("names", label, Warn, msg!("check.names.noVersion", "no version in {list}: CCRL names are \"<Engine> <version>\" (Configuration → Rename an engine)", list = no_version.join(", ")))
    } else if !missing.is_empty() {
        item("names", label, Warn, msg!("check.names.notInList", "opponents not found in the CCRL list (spelling, or not rated yet): {list}", list = missing.join(", ")))
    } else {
        item("names", label, Ok, msg!("check.names.ok", "\"<Engine> <version> 64-bit{cpu}\" in the export", cpu = if c.threads > 1 { format!(" {}CPU", c.threads) } else { String::new() }))
    });

    // time control
    let nominal = crate::tournament_file::nominal_for(&c.ccrl_list);
    let implied = crate::tc::parse_fastchess(&c.tc).map(|(_, base, _)| base / nominal.base_s).filter(|f| f.is_finite() && *f > 0.0);
    let label = || msg!("check.tc.label", "Time control from a bench");
    v.push(match (&i.bench, implied) {
        (None, _) => item("tc", label(), Warn, msg!("check.tc.noBench", "TC {tc}: no valid bench on this machine (Bench → run the SF10 bench)", tc = c.tc)),
        (Some((date, lo, hi)), f) => {
            let age = days_between(date, i.today).unwrap_or(0);
            let fs = f.map(|f| format!("{f:.3}")).unwrap_or("?".into());
            let day = &date[..10.min(date.len())];
            match f {
                Some(f) if f < lo * 0.97 || f > hi * 1.03 => {
                    item("tc", label(), Warn, msg!("check.tc.mismatch", "TC {tc} implies factor {factor}, the latest bench ({date}) gives {lo}–{hi}", tc = c.tc, factor = fs, date = day, lo = format!("{lo:.3}"), hi = format!("{hi:.3}")))
                }
                _ if age > 90 => item("tc", label(), Warn, msg!("check.tc.old", "TC {tc} (factor {factor}); the latest bench is {days} days old: run it again", tc = c.tc, factor = fs, days = age)),
                _ => item("tc", label(), Ok, msg!("check.tc.ok", "TC {tc} for CCRL {list} (factor {factor}; bench {date} gives {lo}–{hi})", tc = c.tc, list = c.ccrl_list, factor = fs, date = day, lo = format!("{lo:.3}"), hi = format!("{hi:.3}"))),
            }
        }
    });

    // variant and list
    let frc_list = crate::tournament_file::is_frc_list(&c.ccrl_list);
    let label = msg!("check.variant.label", "Variant and list");
    v.push(match (c.variant, frc_list) {
        (Variant::Chess960, true) => item("variant", label, Ok, msg!("check.variant.ok960", "Chess960 for the CCRL {list} list", list = c.ccrl_list)),
        (Variant::Standard, false) => item("variant", label, Ok, msg!("check.variant.ok", "standard chess for the CCRL {list} list", list = c.ccrl_list)),
        (Variant::Chess960, false) => item("variant", label, Fail, msg!("check.variant.chess960NotFrc", "Chess960 games for the {list} list: use the FRC list", list = c.ccrl_list)),
        (Variant::Standard, true) => item("variant", label, Fail, msg!("check.variant.standardFrc", "standard games for the FRC list: the tournament must be Chess960")),
    });

    // tester
    let label = msg!("check.tester.label", "Tester name and site");
    v.push(if i.tester.trim().is_empty() || i.site.trim().is_empty() {
        item("tester", label, Fail, msg!("check.tester.missing", "set them in Settings (file name and PGN Site tag)"))
    } else {
        item("tester", label, Ok, Msg::plain(format!("{} · {}", i.tester, i.site)))
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
        c.hash_mb = 2048; // CCRL Blitz: 256 MB per thread
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
    fn random_openings_speak_of_pairs() {
        let mut c = cfg();
        c.random_openings = true;
        let st = standings();
        let r = check(&input(&c, &st, vec![Some(engine("Seed 1.0")), Some(engine("Opp 2.0")), Some(engine("Opp 3.1"))]));
        let colours = r.items.iter().find(|x| x.id == "colours").unwrap();
        assert_eq!((colours.label.as_str(), colours.status), ("Every pair with both colours", CheckStatus::Ok));
        assert_eq!(colours.label.code, "check.colours.labelPairs");
        assert!(colours.detail.contains("one random opening per game"));
        let book = &r.items.iter().find(|x| x.id == "book").unwrap().detail;
        assert!(book.contains("one random opening per game") && !book.contains("each opening with both colours"));
    }

    #[test]
    fn problems_are_explained() {
        let mut c = cfg();
        c.hash_mb = 4096;
        c.participants[1].options = BTreeMap::from([("Ponder".into(), "true".into())]);
        c.participants[2].name = "Opp".into();
        c.variant = Variant::Chess960;
        c.tc = "60+0.6".into();
        let mut st = standings();
        st.incomplete_pairs.push(crate::stats::PairIssue { opponent: "Opp 2.0".into(), node: 0, pass: 1, round: 3, games: 1 });
        st.termination_totals.insert("time forfeit".into(), 2);
        let mut avx = engine("Opp 2.0");
        avx.flags.push("32-bit".into());
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

    #[test]
    fn avx512_builds_are_ccrl_builds() {
        let c = crate::scheduler::tests::cfg(TournamentKind::Gauntlet, &["Seed 1.0"], &["Opp 2.0"], 30, 1, 1);
        let st = standings();
        let mut seed = engine("Seed 1.0");
        seed.build = "avx512-vnni".into();
        let mut opp = engine("Opp 2.0");
        opp.build = "avx2".into();
        let r = check(&input(&c, &st, vec![Some(seed), Some(opp)]));
        let b = r.items.iter().find(|x| x.id == "builds").unwrap();
        assert_eq!(b.status, CheckStatus::Ok, "{b:?}");
        let mut other = engine("Opp 2.0");
        other.build = "popcnt".into();
        let r = check(&input(&c, &st, vec![Some(engine("Seed 1.0")), Some(other)]));
        assert_eq!(r.items.iter().find(|x| x.id == "builds").unwrap().status, CheckStatus::Warn);
    }
}
