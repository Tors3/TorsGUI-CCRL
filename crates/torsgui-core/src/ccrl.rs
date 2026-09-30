//! CCRL rating lists: fetching (best effort, the site layout changes), robust
//! parsing of HTML tables, pasted text and CSV, name matching, opponent
//! suggestions, estimated ratings for missing CPU categories and the
//! "score needed to pass rank k" helper.

use crate::names::{self, compare_versions, family, normalize, version_of};
use crate::stats::expected_score;
use anyhow::{bail, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CcrlEntry {
    pub rank: i64,
    pub name: String,
    pub rating: f64,
    pub err_plus: Option<f64>,
    pub err_minus: Option<f64>,
    pub games: Option<i64>,
    pub score: Option<f64>,
}

impl CcrlEntry {
    /// CPU category from the name: "... 8CPU" -> 8, otherwise 1.
    pub fn cpus(&self) -> u32 {
        cpus_of(&self.name)
    }
}

pub fn cpus_of(name: &str) -> u32 {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(\d+)\s*CPU\b").unwrap());
    RE.captures(name).and_then(|c| c[1].parse().ok()).unwrap_or(1)
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CcrlList {
    pub id: Option<i64>,
    /// "Blitz" | "40/15"
    pub list: String,
    /// "1CPU" | "4CPU" | "8CPU" | "mixed"
    pub cpu: String,
    /// "all" | "best"
    pub variant: String,
    pub source: String,
    pub fetched_at: String,
    pub entries: Vec<CcrlEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ListSource {
    pub list: String,
    pub cpu: String,
    pub variant: String,
    pub url: String,
}

/// Default URLs (editable in Settings; the site layout can change, manual
/// import is always available).
pub fn default_sources() -> Vec<ListSource> {
    let base = "https://computerchess.org.uk/ccrl";
    let mut v = Vec::new();
    for (list, dir) in [("Blitz", "404"), ("40/15", "4040")] {
        for (variant, file) in [("all", "rating_list_all.html"), ("best", "rating_list_pure.html")] {
            v.push(ListSource { list: list.into(), cpu: "mixed".into(), variant: variant.into(), url: format!("{base}/{dir}/{file}") });
        }
    }
    // Chess960 list (best effort, like the others: paste the table if the page differs)
    v.push(ListSource { list: "FRC".into(), cpu: "mixed".into(), variant: "all".into(), url: format!("{base}/404FRC/rating_list_all.html") });
    v
}

fn strip_tags(s: &str) -> String {
    static TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<[^>]*>").unwrap());
    let t = TAG.replace_all(s, " ");
    t.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&plusmn;", "±")
        .replace("&minus;", "-")
        .replace("&#8722;", "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn num(s: &str) -> Option<f64> {
    let t = s.trim().replace('\u{2212}', "-").replace('±', "").replace('%', "").replace(',', "");
    t.trim_start_matches('+').parse().ok()
}

/// Parses rows of an HTML page (any table with Rank/Name/Rating-like headers).
pub fn parse_html(html: &str) -> Vec<CcrlEntry> {
    static TR: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").unwrap());
    static TD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>").unwrap());
    let mut header: Option<Vec<String>> = None;
    let mut out = Vec::new();
    for tr in TR.captures_iter(html) {
        let cells: Vec<String> = TD.captures_iter(&tr[1]).map(|c| strip_tags(&c[1])).collect();
        if cells.is_empty() {
            continue;
        }
        let lower: Vec<String> = cells.iter().map(|c| c.to_lowercase()).collect();
        if lower.iter().any(|c| c == "rank" || c == "#") && lower.iter().any(|c| c.contains("name") || c.contains("engine")) {
            header = Some(lower);
            continue;
        }
        if let Some(e) = row_to_entry(&cells, header.as_deref()) {
            out.push(e);
        }
    }
    if out.is_empty() {
        return parse_text(&strip_tags(&html.replace("<br>", "\n").replace("</tr>", "\n")));
    }
    out
}

fn row_to_entry(cells: &[String], header: Option<&[String]>) -> Option<CcrlEntry> {
    let find = |keys: &[&str]| -> Option<usize> { header.and_then(|h| h.iter().position(|c| keys.iter().any(|k| c.contains(k)))) };
    let (ri, ni, rti) = match (find(&["rank", "#"]), find(&["name", "engine"]), find(&["rating", "elo"])) {
        (Some(r), Some(n), Some(t)) => (r, n, t),
        _ => {
            // heuristic: rank = first integer, name = first long text, rating = first 4-digit number after name
            let r = cells.iter().position(|c| c.trim_end_matches('.').parse::<i64>().is_ok())?;
            let n = cells.iter().position(|c| c.chars().any(|ch| ch.is_alphabetic()) && c.len() > 2)?;
            let t = (n + 1..cells.len()).find(|&i| num(&cells[i]).map(|x| (1000.0..5000.0).contains(&x)).unwrap_or(false))?;
            (r, n, t)
        }
    };
    let rank: i64 = cells.get(ri)?.trim_end_matches('.').trim().parse().ok()?;
    let name = cells.get(ni)?.trim().to_string();
    let rating = num(cells.get(rti)?)?;
    if name.is_empty() || !(500.0..6000.0).contains(&rating) {
        return None;
    }
    let mut e = CcrlEntry { rank, name, rating, err_plus: None, err_minus: None, games: None, score: None };
    if let Some(i) = find(&["games"]) {
        e.games = cells.get(i).and_then(|c| num(c)).map(|x| x as i64);
    }
    if let Some(i) = find(&["score"]) {
        e.score = cells.get(i).and_then(|c| num(c));
    }
    // error columns right after the rating: "+14 -14", "±14" or two cells
    if let Some(next) = cells.get(rti + 1) {
        let errs: Vec<f64> = next.split_whitespace().filter_map(num).collect();
        match errs.len() {
            1 => {
                e.err_plus = Some(errs[0].abs());
                e.err_minus = cells.get(rti + 2).and_then(|c| num(c)).map(|x| x.abs()).filter(|_| cells.get(rti + 2).map(|c| c.contains('-') || c.contains('\u{2212}')).unwrap_or(false)).or(Some(errs[0].abs()));
            }
            2 => {
                e.err_plus = Some(errs[0].abs());
                e.err_minus = Some(errs[1].abs());
            }
            _ => {}
        }
    }
    Some(e)
}

/// Parses pasted text: CCRL text tables, tab/whitespace separated, or CSV
/// (`rank,name,rating[,...]` or `name,rating`).
pub fn parse_text(text: &str) -> Vec<CcrlEntry> {
    static LINE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"^\s*(\d+)[.)]?\s+(.+?)\s+(\d{3,4}(?:\.\d+)?)(?:\s+([+\-−±]\s*\d+(?:\.\d+)?))?(?:\s+([+\-−]\s*\d+(?:\.\d+)?))?(.*)$").unwrap()
    });
    let mut out = Vec::new();
    let mut auto_rank = 0;
    for raw in text.lines() {
        let l = raw.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        if l.contains(',') && !l.contains('\t') {
            let c: Vec<&str> = l.split(',').map(|s| s.trim().trim_matches('"')).collect();
            let lower = c.iter().map(|s| s.to_lowercase()).collect::<Vec<_>>();
            if lower.iter().any(|s| s == "name" || s == "rating") {
                continue; // header
            }
            let e = if c.len() >= 3 && c[0].parse::<i64>().is_ok() {
                num(c[2]).map(|r| (c[0].parse().unwrap(), c[1].to_string(), r, c.get(3).and_then(|x| num(x))))
            } else if c.len() >= 2 {
                auto_rank += 1;
                num(c[1]).map(|r| (auto_rank, c[0].to_string(), r, None))
            } else {
                None
            };
            if let Some((rank, name, rating, err)) = e {
                if !name.is_empty() {
                    out.push(CcrlEntry { rank, name, rating, err_plus: err, err_minus: err, games: None, score: None });
                }
            }
            continue;
        }
        let l = l.replace('\t', "  ");
        if let Some(c) = LINE.captures(&l) {
            let rating = num(&c[3]).unwrap_or(0.0);
            if !(500.0..6000.0).contains(&rating) {
                continue;
            }
            let ep = c.get(4).and_then(|m| num(&m.as_str().replace(' ', ""))).map(f64::abs);
            let em = c.get(5).and_then(|m| num(&m.as_str().replace(' ', ""))).map(f64::abs).or(ep);
            let rest: Vec<&str> = c.get(6).map(|m| m.as_str()).unwrap_or("").split_whitespace().collect();
            let score = rest.iter().find(|t| t.ends_with('%')).and_then(|t| num(t));
            let games = rest.iter().rev().find_map(|t| t.parse::<i64>().ok());
            out.push(CcrlEntry { rank: c[1].parse().unwrap(), name: c[2].trim().to_string(), rating, err_plus: ep, err_minus: em, games, score });
        }
    }
    out
}

pub fn fetch(src: &ListSource) -> Result<CcrlList> {
    let (st, html) = crate::github::get_text(&src.url, None)?;
    if st != 200 {
        bail!("{} returned HTTP {st}", src.url);
    }
    let entries = parse_html(&html);
    if entries.is_empty() {
        bail!("no rating rows recognised at {} (the site layout may have changed: use manual import)", src.url);
    }
    Ok(CcrlList { id: None, list: src.list.clone(), cpu: src.cpu.clone(), variant: src.variant.clone(), source: src.url.clone(), fetched_at: crate::store::now(), entries })
}

// ------------------------------------------------------------------ lookups

/// Entry key without "64-bit" and CPU suffix.
pub fn base_key(name: &str) -> String {
    normalize(name)
}

pub struct RatingIndex<'a> {
    pub entries: Vec<&'a CcrlEntry>,
    pub aliases: HashMap<String, String>,
    pub default_gap: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct RatingLookup {
    pub name: String,
    pub list_name: Option<String>,
    pub rating: Option<f64>,
    pub estimated: bool,
    pub rank: Option<i64>,
    pub note: String,
}

impl<'a> RatingIndex<'a> {
    pub fn new(lists: &'a [CcrlList], list: &str, aliases: HashMap<String, String>, default_gap: f64) -> Self {
        let entries = lists.iter().filter(|l| l.list.eq_ignore_ascii_case(list)).flat_map(|l| l.entries.iter()).collect();
        RatingIndex { entries, aliases, default_gap }
    }

    fn canonical(&self, name: &str) -> String {
        self.aliases.get(name).cloned().unwrap_or_else(|| name.to_string())
    }

    /// Entry of `name` in CPU category `cpus`.
    pub fn find(&self, name: &str, cpus: u32) -> Option<&'a CcrlEntry> {
        let key = base_key(&self.canonical(name));
        self.entries.iter().copied().filter(|e| e.cpus() == cpus).find(|e| base_key(&e.name) == key)
    }

    /// Median gap (N CPU - 1 CPU) over engines present in both categories.
    pub fn median_gap(&self, cpus: u32) -> Option<f64> {
        let mut gaps: Vec<f64> = self
            .entries
            .iter()
            .filter(|e| e.cpus() == cpus)
            .filter_map(|e| self.entries.iter().find(|o| o.cpus() == 1 && base_key(&o.name) == base_key(&e.name)).map(|o| e.rating - o.rating))
            .collect();
        if gaps.is_empty() {
            return None;
        }
        gaps.sort_by(|a, b| a.partial_cmp(b).unwrap());
        Some(gaps[gaps.len() / 2])
    }

    /// Own historical gap: other versions of the same family present in both categories.
    pub fn own_gap(&self, name: &str, cpus: u32) -> Option<f64> {
        let fam = family(&self.canonical(name));
        let gaps: Vec<f64> = self
            .entries
            .iter()
            .filter(|e| e.cpus() == cpus && family(&e.name) == fam)
            .filter_map(|e| self.entries.iter().find(|o| o.cpus() == 1 && base_key(&o.name) == base_key(&e.name)).map(|o| e.rating - o.rating))
            .collect();
        if gaps.is_empty() {
            None
        } else {
            Some(gaps.iter().sum::<f64>() / gaps.len() as f64)
        }
    }

    /// Rating in the target category, or the 1CPU rating plus a gap (estimated).
    pub fn rating(&self, name: &str, cpus: u32) -> RatingLookup {
        if let Some(e) = self.find(name, cpus) {
            return RatingLookup { name: name.into(), list_name: Some(e.name.clone()), rating: Some(e.rating), estimated: false, rank: Some(e.rank), note: "list rating".into() };
        }
        if cpus > 1 {
            if let Some(e1) = self.find(name, 1) {
                let (gap, how) = match self.own_gap(name, cpus) {
                    Some(g) => (g, "own historical gap"),
                    None => match self.median_gap(cpus) {
                        Some(g) => (g, "list median gap"),
                        None => (self.default_gap, "default gap"),
                    },
                };
                return RatingLookup {
                    name: name.into(),
                    list_name: Some(e1.name.clone()),
                    rating: Some(e1.rating + gap),
                    estimated: true,
                    rank: None,
                    note: format!("estimated: 1CPU {:.0} {:+.0} ({how})", e1.rating, gap),
                };
            }
        }
        RatingLookup { name: name.into(), list_name: None, rating: None, estimated: false, rank: None, note: "not in the list".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Suggestion {
    pub rank: i64,
    pub list_name: String,
    pub rating: f64,
    pub cpus: u32,
    pub family: String,
    pub installed_engine_id: Option<i64>,
    pub installed_name: Option<String>,
    pub threads_ok: bool,
    pub note: String,
}

/// "Top N of list X, latest version that appears in the list", marked with
/// what is installed and whether it supports the requested threads.
pub fn suggest(
    lists: &[CcrlList],
    list: &str,
    cpus: u32,
    top_n: usize,
    installed: &[crate::engines::EngineEntry],
    threads: u32,
    only_installed: bool,
    exclude: &[String],
) -> Vec<Suggestion> {
    let entries: Vec<&CcrlEntry> = lists
        .iter()
        .filter(|l| l.list.eq_ignore_ascii_case(list))
        .flat_map(|l| l.entries.iter())
        .filter(|e| e.cpus() == cpus || (cpus > 1 && e.cpus() == 1))
        .collect();
    // per family: latest version in the list (prefer the target CPU category)
    let mut fams: HashMap<String, &CcrlEntry> = HashMap::new();
    for e in &entries {
        let f = family(&e.name);
        let better = match fams.get(&f) {
            None => true,
            Some(cur) => {
                let c = compare_versions(&version_of(&e.name), &version_of(&cur.name));
                c == std::cmp::Ordering::Greater || (c == std::cmp::Ordering::Equal && e.cpus() == cpus && cur.cpus() != cpus)
            }
        };
        if better {
            fams.insert(f, e);
        }
    }
    let mut v: Vec<&CcrlEntry> = fams.values().copied().collect();
    v.sort_by(|a, b| b.rating.partial_cmp(&a.rating).unwrap());
    let ex: Vec<String> = exclude.iter().map(|s| base_key(s)).collect();
    let mut out = Vec::new();
    for e in v {
        if ex.contains(&base_key(&e.name)) {
            continue;
        }
        let inst = installed.iter().find(|i| base_key(&i.display_name) == base_key(&e.name));
        let threads_ok = inst.map(|i| i.threads_max.map(|m| m as u32 >= threads).unwrap_or(true)).unwrap_or(true);
        if only_installed && inst.is_none() {
            continue;
        }
        if threads > 1 && !threads_ok {
            continue;
        }
        let mut note = String::new();
        if e.cpus() != cpus {
            note = format!("only {}CPU in the list", e.cpus());
        }
        out.push(Suggestion {
            rank: e.rank,
            list_name: e.name.clone(),
            rating: e.rating,
            cpus: e.cpus(),
            family: family(&e.name),
            installed_engine_id: inst.and_then(|i| i.id),
            installed_name: inst.map(|i| i.display_name.clone()),
            threads_ok,
            note,
        });
        if out.len() >= top_n {
            break;
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Threshold {
    pub rank: i64,
    pub target_name: String,
    pub target_rating: f64,
    pub points_needed: f64,
    pub games: u32,
    pub pct_needed: f64,
    pub reachable: bool,
}

/// Score the seed needs, against opponents `(rating, games)`, for its
/// performance (logistic MLE) to exceed `target_rating`.
pub fn points_needed(opps: &[(f64, u32)], target_rating: f64) -> (f64, u32) {
    let games: u32 = opps.iter().map(|o| o.1).sum();
    let s: f64 = opps.iter().map(|(r, n)| *n as f64 * expected_score(target_rating - r)).sum();
    (s, games)
}

pub fn thresholds(opps: &[(f64, u32)], entries: &[&CcrlEntry], ranks: &[i64]) -> Vec<Threshold> {
    ranks
        .iter()
        .filter_map(|k| entries.iter().find(|e| e.rank == *k))
        .map(|e| {
            let (p, g) = points_needed(opps, e.rating);
            // strictly above: round up to the next half point
            let need = ((p * 2.0).floor() + 1.0) / 2.0;
            Threshold { rank: e.rank, target_name: e.name.clone(), target_rating: e.rating, points_needed: need, games: g, pct_needed: if g > 0 { 100.0 * need / g as f64 } else { 0.0 }, reachable: need <= g as f64 }
        })
        .collect()
}

pub fn match_names(query: &str, list: &[CcrlEntry]) -> Vec<names::MatchCandidate> {
    let names: Vec<String> = list.iter().map(|e| e.name.clone()).collect();
    names::best_matches(query, &names, 5)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "Rank Name Rating 95% conf. Score Av.Op. Draws Games\n\
1 Stockfish 19 64-bit 8CPU 3800 +14 -14 60.1% -60 80% 1200\n\
2 Stockfish 19 64-bit 3720 +10 −10 70.0% -100 70% 2400\n\
3 PlentyChess 8.0.0 64-bit 8CPU 3720 +15 -15 50% 0 85% 900\n\
4 PlentyChess 7.0.0 64-bit 8CPU 3700 +15 -15 50% 0 85% 900\n\
5 PlentyChess 7.0.0 64-bit 3660 +12 -12 50% 0 85% 900\n\
6 Obsidian 16.0 64-bit 3650 +12 -12 50% 0 85% 900\n\
7 Integral v8 64-bit 8CPU 3640 ±12 55% 0 85% 900\n\
8 Motor 0.9.0 64-bit 3200 ±12 55% 0 85% 900\n";

    fn list() -> Vec<CcrlList> {
        vec![CcrlList { id: None, list: "Blitz".into(), cpu: "mixed".into(), variant: "all".into(), source: "t".into(), fetched_at: "".into(), entries: parse_text(TEXT) }]
    }

    #[test]
    fn parse_pasted_text() {
        let e = parse_text(TEXT);
        assert_eq!(e.len(), 8);
        assert_eq!(e[0].name, "Stockfish 19 64-bit 8CPU");
        assert_eq!(e[0].cpus(), 8);
        assert_eq!(e[1].err_minus, Some(10.0));
        assert_eq!(e[6].err_plus, Some(12.0));
        assert_eq!(e[0].games, Some(1200));
        let csv = parse_text("name,rating\nIntegral 8,3600\nCaissa 2.0,3590\n");
        assert_eq!(csv.len(), 2);
        assert_eq!(csv[1].rank, 2);
    }

    #[test]
    fn parse_html_table() {
        let html = r#"<table><tr><th>Rank</th><th>Name</th><th>Rating</th><th>+</th><th>-</th><th>Score</th><th>Games</th></tr>
<tr><td>1</td><td><a href="x">Stockfish 19 64-bit 8CPU</a></td><td>3800</td><td>+14</td><td>-14</td><td>60.1%</td><td>1,200</td></tr>
<tr><td>2</td><td>Obsidian 16.0 64-bit</td><td>3650</td><td>+12</td><td>&minus;12</td><td>50%</td><td>900</td></tr></table>"#;
        let e = parse_html(html);
        assert_eq!(e.len(), 2);
        assert_eq!(e[1].name, "Obsidian 16.0 64-bit");
        assert_eq!(e[0].games, Some(1200));
    }

    #[test]
    fn ratings_and_estimates() {
        let l = list();
        let idx = RatingIndex::new(&l, "Blitz", HashMap::new(), 32.0);
        let r = idx.rating("Stockfish 19", 8);
        assert_eq!(r.rating, Some(3800.0));
        assert!(!r.estimated);
        // Obsidian has no 8CPU entry: 1CPU + list median gap (SF +80, Plenty7 +40 -> median of [80,40] = 80 (upper))
        let r = idx.rating("Obsidian 16.0", 8);
        assert!(r.estimated);
        assert_eq!(r.rating, Some(3650.0 + idx.median_gap(8).unwrap()));
        // PlentyChess 8 8CPU exists directly; PlentyChess 7 has own gap 40
        assert_eq!(idx.own_gap("PlentyChess 8.0.0", 8), Some(40.0));
        // alias matching "Integral v8" <-> "Integral 8"
        assert_eq!(idx.rating("Integral 8", 8).rating, Some(3640.0));
        assert!(idx.rating("Nonexistent 1", 8).rating.is_none());
    }

    #[test]
    fn suggestions_latest_version() {
        let l = list();
        let mut motor = crate::engines::EngineEntry { display_name: "Motor 0.9.0".into(), threads_max: Some(1), id: Some(7), ..Default::default() };
        motor.flags.push("single-thread only".into());
        let s = suggest(&l, "Blitz", 8, 10, &[motor.clone()], 8, false, &[]);
        let names: Vec<&str> = s.iter().map(|x| x.list_name.as_str()).collect();
        assert_eq!(names[0], "Stockfish 19 64-bit 8CPU");
        assert!(names.contains(&"PlentyChess 8.0.0 64-bit 8CPU"));
        assert!(!names.iter().any(|n| n.starts_with("PlentyChess 7")), "only the latest version");
        assert!(!names.iter().any(|n| n.starts_with("Motor")), "single-thread engine filtered for 8 threads");
        let s = suggest(&l, "Blitz", 1, 10, &[motor], 1, true, &[]);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].installed_engine_id, Some(7));
    }

    #[test]
    fn threshold() {
        // 30 games vs a 3600 opponent: to pass a 3600 engine you need > 15 points
        let e = CcrlEntry { rank: 5, name: "X".into(), rating: 3600.0, err_plus: None, err_minus: None, games: None, score: None };
        let t = thresholds(&[(3600.0, 30)], &[&e], &[5]);
        assert_eq!(t[0].points_needed, 15.5);
        assert!(t[0].reachable);
    }
}
