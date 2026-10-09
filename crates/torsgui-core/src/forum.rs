//! BBCode forum posts (English, short). The default "finished" template
//! reproduces the reference post of the build brief (§8).

use crate::stats::Standings;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PostKind {
    Finished,
    Announcement,
    Progress,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PostContext {
    /// Seed export name, e.g. "Triumviratus 7.0 64-bit 8CPU".
    pub seed_export: String,
    /// "gauntlet", "round robin", "match".
    pub kind_label: String,
    pub total_games: u32,
    pub expected_games: u32,
    pub opponents: u32,
    pub games_per_opponent: u32,
    pub threads: u32,
    pub hash_mb: u32,
    pub tc: String,
    pub ccrl_list: String,
    pub book: String,
    pub egtb: u32,
    /// Display name of the next tournament in the queue ("Stockfish 19 8CPU gauntlet").
    pub next: Option<String>,
    pub expected_finish: Option<String>,
    pub engines: Vec<String>,
    /// One random opening per game instead of each opening twice with colours reversed.
    #[serde(default)]
    pub random_openings: bool,
    /// Round robin / Swiss: everyone plays everyone, no seed. The post ranks every engine
    /// (`{table}`, `{result}` = the winner) instead of the seed against its opponents.
    #[serde(default)]
    pub all_play: bool,
}

pub const TEMPLATE_FINISHED: &str = "[b]{seed} – {kind} finished[/b]\n\n{conditions}\n\nResult: [b]{result}[/b]\n\n[code]\n{table}\n[/code]\n\n{closing}\n";
pub const TEMPLATE_ANNOUNCEMENT: &str = "[b]{seed} – {kind} started[/b]\n\n{games} games ({opponents} opponents × {per_opp}), all engines {threads} threads, hash {hash} MB, TC {tc} (CCRL {list} equivalent for this machine), book {book}, {egtb}-man Syzygy, {openings}.\n\nOpponents: {engines}.\n\nExpected finish: {eta}.\n";
pub const TEMPLATE_PROGRESS: &str = "[b]{seed} – {kind} progress: {done}/{games} games[/b]\n\nCurrent result: [b]{result}[/b]\n\n[code]\n{table}\n[/code]\n\nExpected finish: {eta}.\n";

pub fn default_template(kind: PostKind) -> &'static str {
    match kind {
        PostKind::Finished => TEMPLATE_FINISHED,
        PostKind::Announcement => TEMPLATE_ANNOUNCEMENT,
        PostKind::Progress => TEMPLATE_PROGRESS,
    }
}

/// `+32 =831 −7 (51.4%)` (U+2212 minus sign).
pub fn result_line(st: &Standings) -> String {
    let t = &st.total;
    format!("+{} ={} \u{2212}{} ({:.1}%)", t.wins, t.draws, t.losses, t.pct)
}

/// The ranking of every engine (round robin, Swiss), best score first.
pub fn ranking_table(st: &Standings) -> String {
    let w = st.general.iter().map(|r| r.name.chars().count()).max().unwrap_or(6).max(6) + 2;
    let mut lines = vec![format!("{:>3}  {:<w$}{:>6}{:>4}{:>4}{:>4}   Score    %", "#", "Engine", "Games", "W", "D", "L")];
    for (i, r) in st.general.iter().enumerate() {
        lines.push(format!("{:>3}  {:<w$}{:>6}{:>4}{:>4}{:>4}   {:<8}{:>5.1}", i + 1, r.name, r.games, r.wins, r.draws, r.losses, format!("{:.1}", r.score), r.pct));
    }
    lines.join("\n")
}

/// The winner line of a round robin: `Stockfish 19 64-bit 8CPU 152.5/220 (69.3%)`.
pub fn winner_line(st: &Standings) -> String {
    st.general.first().map(|r| format!("{} {:.1}/{} ({:.1}%)", r.name, r.score, r.games, r.pct)).unwrap_or_default()
}

/// Per-opponent `[code]` table, rows in the order of `st.rows`.
pub fn table(st: &Standings) -> String {
    let mut lines = vec![format!("{:<24}{:>2}{:>4}{:>4}   Score", "Opponent", "W", "D", "L")];
    for r in &st.rows {
        lines.push(format!(
            "{:<24}{:>2}{:>4}{:>4}   {:.1}/{}",
            r.name, r.wins, r.draws, r.losses, r.score, r.games
        ));
    }
    lines.join("\n")
}

pub fn conditions(c: &PostContext) -> String {
    if c.all_play {
        return format!(
            "{} games ({} engines, {} games per pairing), all engines {} threads, hash {} MB, TC {} (CCRL {} equivalent for this machine), book {}, {}-man Syzygy, {}.",
            c.total_games, c.engines.len(), c.games_per_opponent, c.threads, c.hash_mb, c.tc, c.ccrl_list, c.book, c.egtb, openings(c)
        );
    }
    format!(
        "{} games ({} opponents × {}), all engines {} threads, hash {} MB, TC {} (CCRL {} equivalent for this machine), book {}, {}-man Syzygy, {}.",
        c.total_games, c.opponents, c.games_per_opponent, c.threads, c.hash_mb, c.tc, c.ccrl_list, c.book, c.egtb, openings(c)
    )
}

pub fn openings(c: &PostContext) -> &'static str {
    if c.random_openings {
        "one random opening per game"
    } else {
        "each opening played with colors reversed"
    }
}

pub fn closing(c: &PostContext) -> String {
    match &c.next {
        Some(n) => format!("PGN attached. {n} is now running."),
        None => "PGN attached.".into(),
    }
}

pub fn render(template: &str, vars: &BTreeMap<String, String>) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

pub fn variables(st: &Standings, c: &PostContext) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("seed".into(), c.seed_export.clone());
    m.insert("kind".into(), c.kind_label.clone());
    m.insert("conditions".into(), conditions(c));
    m.insert("result".into(), if c.all_play { format!("winner {}", winner_line(st)) } else { result_line(st) });
    m.insert("table".into(), if c.all_play { ranking_table(st) } else { table(st) });
    m.insert("closing".into(), closing(c));
    m.insert("games".into(), c.expected_games.to_string());
    m.insert("done".into(), c.total_games.to_string());
    m.insert("opponents".into(), c.opponents.to_string());
    m.insert("per_opp".into(), c.games_per_opponent.to_string());
    m.insert("threads".into(), c.threads.to_string());
    m.insert("hash".into(), c.hash_mb.to_string());
    m.insert("tc".into(), c.tc.clone());
    m.insert("list".into(), c.ccrl_list.clone());
    m.insert("book".into(), c.book.clone());
    m.insert("egtb".into(), c.egtb.to_string());
    m.insert("engines".into(), c.engines.join(", "));
    m.insert("openings".into(), openings(c).to_string());
    m.insert("eta".into(), c.expected_finish.clone().unwrap_or_else(|| "unknown".into()));
    m
}

pub fn post(kind: PostKind, template: Option<&str>, st: &Standings, c: &PostContext) -> String {
    render(template.unwrap_or(default_template(kind)), &variables(st, c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::Row;
    #[test]
    fn table_layout_matches_brief() {
        let mut st = Standings::default();
        let mk = |n: &str, w: u32, d: u32, l: u32| Row {
            name: n.into(),
            games: w + d + l,
            wins: w,
            draws: d,
            losses: l,
            score: w as f64 + d as f64 / 2.0,
            ..Default::default()
        };
        st.rows = vec![mk("Stockfish 19", 0, 30, 0), mk("Minke 7.0.0", 2, 28, 0)];
        let t = table(&st);
        let l: Vec<&str> = t.lines().collect();
        assert_eq!(l[0], "Opponent                 W   D   L   Score");
        assert_eq!(l[1], "Stockfish 19             0  30   0   15.0/30");
        assert_eq!(l[2], "Minke 7.0.0              2  28   0   16.0/30");
    }

    #[test]
    fn round_robin_post_ranks_every_engine() {
        let mut st = Standings::default();
        let mk = |n: &str, w: u32, d: u32, l: u32| {
            let g = w + d + l;
            let score = w as f64 + d as f64 / 2.0;
            Row { name: n.into(), games: g, wins: w, draws: d, losses: l, score, pct: score * 100.0 / g as f64, ..Default::default() }
        };
        st.general = vec![mk("Stockfish 19 64-bit 8CPU", 3, 1, 0), mk("Reckless 0.9.0 64-bit 8CPU", 1, 2, 1), mk("Coda 0.9.4 64-bit 8CPU", 0, 1, 3)];
        st.rows = vec![mk("Reckless 0.9.0", 1, 1, 0)];
        let c = PostContext {
            seed_export: "3 engines 8CPU".into(),
            kind_label: "round robin".into(),
            total_games: 6,
            expected_games: 6,
            opponents: 2,
            games_per_opponent: 2,
            threads: 8,
            hash_mb: 2048,
            tc: "119+1".into(),
            ccrl_list: "Blitz".into(),
            book: "b".into(),
            egtb: 5,
            next: None,
            expected_finish: None,
            engines: vec!["A".into(), "B".into(), "C".into()],
            random_openings: false,
            all_play: true,
        };
        let p = post(PostKind::Finished, None, &st, &c);
        assert!(p.starts_with("[b]3 engines 8CPU – round robin finished[/b]"), "{p}");
        assert!(p.contains("6 games (3 engines, 2 games per pairing)"), "{p}");
        assert!(p.contains("Result: [b]winner Stockfish 19 64-bit 8CPU 3.5/4 (87.5%)[/b]"), "{p}");
        assert!(p.contains("  1  Stockfish 19 64-bit 8CPU") && p.contains("  3  Coda 0.9.4 64-bit 8CPU"), "{p}");
        assert!(!p.contains("Opponent "), "no seed-vs-opponent table: {p}");
    }
}
