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

/// The CCRL site root. The lists live at `<root>/<dir>/` (the older `<root>/ccrl/<dir>/`
/// paths are tried too).
pub const CCRL_ROOT: &str = "https://computerchess.org.uk";

/// (list, site directory)
pub const LIST_DIRS: [(&str, &str); 3] = [("Blitz", "404"), ("40/15", "4040"), ("FRC", "404FRC")];

/// Default sources: for every list the "best versions" index page and the complete list of
/// all versions. Manual import (paste or a saved page) is always available.
pub fn default_sources() -> Vec<ListSource> {
    let mut v = Vec::new();
    for (list, dir) in LIST_DIRS {
        for (variant, file) in [("best", ""), ("all", "rating_list_all.html")] {
            v.push(ListSource { list: list.into(), cpu: "mixed".into(), variant: variant.into(), url: format!("{CCRL_ROOT}/{dir}/{file}") });
        }
    }
    v
}

/// Every URL tried for a source, in order: the configured one, the same page with and
/// without the `/ccrl/` prefix and with `www.`, then the site's plain-text export
/// (`cgi/compare_engines.cgi?print=Rating list (text)`), which survives layout changes.
pub fn candidate_urls(src: &ListSource) -> Vec<String> {
    let mut v: Vec<String> = vec![src.url.clone()];
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^https?://(?:www\.)?computerchess\.org\.uk/(?:ccrl/)?([^/]+)/(.*)$").unwrap());
    if let Some(c) = RE.captures(&src.url) {
        let (dir, file) = (c[1].to_string(), c[2].to_string());
        let files: Vec<String> = if file.is_empty() || file == "index.html" { vec![String::new(), "index.html".into()] } else { vec![file.clone()] };
        for host in ["https://computerchess.org.uk", "https://www.computerchess.org.uk"] {
            for prefix in ["", "/ccrl"] {
                for f in &files {
                    v.push(format!("{host}{prefix}/{dir}/{f}"));
                }
            }
        }
        let best = if src.variant == "all" { 0 } else { 1 };
        for prefix in ["", "/ccrl"] {
            v.push(format!("{CCRL_ROOT}{prefix}/{dir}/cgi/compare_engines.cgi?print=Rating+list+%28text%29&class=all+engines&only_best_in_class={best}"));
        }
    }
    let mut seen = std::collections::HashSet::new();
    v.retain(|u| seen.insert(u.clone()));
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
    static TD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<t[dh]([^>]*)>(.*?)</t[dh]>").unwrap());
    static SPAN: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)colspan\s*=\s*["']?(\d+)"#).unwrap());
    let mut header: Option<Vec<String>> = None;
    let mut out = Vec::new();
    for tr in TR.captures_iter(html) {
        let cells: Vec<String> = TD.captures_iter(&tr[1]).map(|c| strip_tags(&c[2])).collect();
        if cells.is_empty() {
            continue;
        }
        let lower: Vec<String> = cells.iter().map(|c| c.to_lowercase()).collect();
        if lower.iter().any(|c| c == "rank" || c == "#") && lower.iter().any(|c| c.contains("name") || c.contains("engine")) {
            // CCRL: "Rating" spans three columns (Elo, +, -) in a second header row:
            // expand every header cell by its colspan so the columns line up with the data
            let mut h = Vec::new();
            for c in TD.captures_iter(&tr[1]) {
                let span = SPAN.captures(&c[1]).and_then(|m| m[1].parse::<usize>().ok()).unwrap_or(1).clamp(1, 8);
                let name = strip_tags(&c[2]).to_lowercase();
                for i in 0..span {
                    h.push(if i == 0 { name.clone() } else { format!("{name} ({})", i + 1) });
                }
            }
            header = Some(h);
            continue;
        }
        if let Some(e) = row_to_entry(&cells, header.as_deref()) {
            out.push(e);
        }
    }
    if out.is_empty() {
        // a text list (e.g. inside <pre>): keep the line breaks while removing the tags
        static BR: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<br\s*/?>|</tr>|</p>|</div>").unwrap());
        let text = BR.replace_all(html, "\n");
        let lines: Vec<String> = text.lines().map(strip_tags).collect();
        return parse_text(&lines.join("\n"));
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
    // tied ranks are written "14-15"
    let rank: i64 = cells.get(ri)?.trim().split(['-', '\u{2013}', '.', ' ']).next()?.parse().ok()?;
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
            // rank,name,rating[,plus[,minus[,score[,games]]]]  or  name,rating
            let col = |i: usize| c.get(i).and_then(|x| num(x));
            let e = if c.len() >= 3 && c[0].parse::<i64>().is_ok() {
                num(c[2]).map(|r| {
                    let ep = col(3).map(f64::abs);
                    let em = col(4).map(f64::abs).or(ep);
                    CcrlEntry { rank: c[0].parse().unwrap(), name: c[1].to_string(), rating: r, err_plus: ep, err_minus: em, score: col(5), games: col(6).map(|g| g as i64) }
                })
            } else if c.len() >= 2 {
                auto_rank += 1;
                num(c[1]).map(|r| CcrlEntry { rank: auto_rank, name: c[0].to_string(), rating: r, err_plus: None, err_minus: None, games: None, score: None })
            } else {
                None
            };
            if let Some(e) = e.filter(|e| !e.name.is_empty()) {
                out.push(e);
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

/// Lists bundled with TorsGUI (the "best versions" pages of the CCRL site, transcribed on
/// the date written in each file): ratings and CCRL names work offline, and when the site
/// cannot be reached. (list, file, csv)
pub const SNAPSHOTS: [(&str, &str, &str); 3] = [
    ("Blitz", "blitz_best.csv", include_str!("../data/ccrl/blitz_best.csv")),
    ("40/15", "4015_best.csv", include_str!("../data/ccrl/4015_best.csv")),
    ("FRC", "frc_best.csv", include_str!("../data/ccrl/frc_best.csv")),
];

pub fn snapshot_lists() -> Vec<CcrlList> {
    SNAPSHOTS
        .iter()
        .map(|(list, file, text)| {
            let date = text.lines().next().and_then(|l| l.split("computed on ").nth(1)).unwrap_or("").trim().to_string();
            CcrlList {
                id: None,
                list: list.to_string(),
                cpu: "mixed".into(),
                variant: "best".into(),
                source: format!("bundled snapshot {file} ({date})"),
                fetched_at: crate::store::now(),
                entries: parse_text(text),
            }
        })
        .collect()
}

/// What a page says it is, from its "CCRL Blitz Rating List - All engines (best versions
/// only)" title: the list ("Blitz", "40/15", "FRC"), best versions only (Some(true)), all
/// versions (Some(false)) or not said (None), and the title itself.
pub fn page_identity(html: &str) -> Option<(String, Option<bool>, String)> {
    static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)CCRL\s+([^\n<>]{1,30}?)\s+Rating\s+List([^\n<>]{0,120})").unwrap());
    let text = strip_tags(html);
    let c = TITLE.captures(&text)?;
    let name = c[1].to_string();
    let n = name.to_lowercase();
    let list = if n.contains("frc") || n.contains("960") || n.contains("fischer") {
        "FRC"
    } else if n.contains("40/15") || n.contains("40/40") || n.contains("4040") {
        "40/15"
    } else if n.contains("blitz") || n.contains("40/4") || n.contains("404") || n.contains("40/2") {
        "Blitz"
    } else {
        return None;
    };
    let rest = c[2].to_lowercase();
    let best = if rest.contains("best version") {
        Some(true)
    } else if rest.contains("all version") || rest.contains("complete") {
        Some(false)
    } else {
        None
    };
    let title = format!("CCRL {} Rating List{}", name.trim(), c[2].trim_end());
    Some((list.to_string(), best, title.split(", computed").next().unwrap_or(&title).trim().to_string()))
}

/// Same rows (names and ratings): a page served for the wrong list.
pub fn same_rows(a: &[CcrlEntry], b: &[CcrlEntry]) -> bool {
    a.len() == b.len() && !a.is_empty() && a.iter().zip(b).all(|(x, y)| x.name == y.name && x.rating == y.rating)
}

/// Downloads a list, trying every candidate URL until one has rating rows.
pub fn fetch(src: &ListSource) -> Result<CcrlList> {
    fetch_with(src, |u| crate::github::get_page(u), &[])
}

/// Downloads a list; `others` are the other lists already known: a page with the very same
/// rows as one of them (the site answering with another list) is skipped.
pub fn fetch_avoiding(src: &ListSource, others: &[CcrlList]) -> Result<CcrlList> {
    fetch_with(src, |u| crate::github::get_page(u), others)
}

/// Like `fetch`, with the page download given. A page is taken only when it has rating rows,
/// does not say it is another list (or the other variant), and is not a copy of another list.
pub fn fetch_with(src: &ListSource, get: impl Fn(&str) -> Result<(u16, String)>, others: &[CcrlList]) -> Result<CcrlList> {
    let mut tried = Vec::new();
    for url in candidate_urls(src) {
        match get(&url) {
            Ok((200, body)) => {
                let entries = parse_html(&body);
                if entries.len() < 5 {
                    tried.push(format!("{url}: no rating rows"));
                    continue;
                }
                let id = page_identity(&body);
                if let Some((list, best, title)) = &id {
                    if list != &src.list {
                        tried.push(format!("{url}: this page is the {list} list ({title})"));
                        continue;
                    }
                    if *best == Some(src.variant == "all") {
                        tried.push(format!("{url}: this page is the {} list ({title})", if src.variant == "all" { "best-versions" } else { "all-versions" }));
                        continue;
                    }
                }
                if let Some(o) = others.iter().find(|o| (o.list != src.list || o.variant != src.variant) && same_rows(&o.entries, &entries)) {
                    tried.push(format!("{url}: the same rows as the {} {} list", o.list, o.variant));
                    continue;
                }
                let source = match id {
                    Some((_, _, title)) => format!("{url} · {title}"),
                    None => url,
                };
                return Ok(CcrlList { id: None, list: src.list.clone(), cpu: src.cpu.clone(), variant: src.variant.clone(), source, fetched_at: crate::store::now(), entries });
            }
            Ok((st, _)) => tried.push(format!("{url}: HTTP {st}")),
            Err(e) => tried.push(format!("{url}: {e}")),
        }
    }
    bail!("CCRL {} ({}) could not be downloaded; tried {}", src.list, src.variant, tried.join(" · "))
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
        let entries = newest_first(lists, list);
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

/// CCRL rating of a library engine in one list (Blitz, 40/15, FRC).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EngineListRating {
    pub engine_id: i64,
    pub list: String,
    /// Name in the CCRL list.
    pub ccrl_name: String,
    pub rating: f64,
    pub rank: i64,
    pub cpus: u32,
    pub games: Option<i64>,
    /// false: this version is not in the list, the rating is the latest version of the same engine.
    pub exact: bool,
}

/// Entries of one list, the most recently downloaded lists first (the first match wins).
fn newest_first<'a>(lists: &'a [CcrlList], list: &str) -> Vec<&'a CcrlEntry> {
    let mut ls: Vec<&CcrlList> = lists.iter().filter(|l| l.list.eq_ignore_ascii_case(list)).collect();
    ls.sort_by(|a, b| b.fetched_at.cmp(&a.fetched_at));
    ls.into_iter().flat_map(|l| l.entries.iter()).collect()
}

/// How CCRL writes an engine in `list` (without "64-bit" and "NCPU"), and where the spelling
/// comes from: the same version in that list, the same version in another list, or the
/// engine's name as written in that list followed by our version. None: not in any list.
pub fn list_spelling(lists: &[CcrlList], list: &str, aliases: &HashMap<String, String>, name: &str) -> Option<(String, String)> {
    let canon = aliases.get(name).cloned().unwrap_or_else(|| name.to_string());
    let key = base_key(&canon);
    if let Some(e) = newest_first(lists, list).into_iter().find(|e| base_key(&e.name) == key) {
        return Some((names::ccrl_base(&e.name), format!("as in the CCRL {list} list")));
    }
    let mut others: Vec<&CcrlList> = lists.iter().filter(|l| !l.list.eq_ignore_ascii_case(list)).collect();
    others.sort_by(|a, b| b.fetched_at.cmp(&a.fetched_at));
    if let Some((l, e)) = others.iter().flat_map(|l| l.entries.iter().map(move |e| (l, e))).find(|(_, e)| base_key(&e.name) == key) {
        return Some((names::ccrl_base(&e.name), format!("as in the CCRL {} list", l.list)));
    }
    // a version not listed yet: the engine's name as the list writes it, our version
    let fam = family(&canon);
    if fam.is_empty() {
        return None;
    }
    let all: Vec<&CcrlEntry> = newest_first(lists, list).into_iter().chain(others.iter().flat_map(|l| l.entries.iter())).collect();
    let listed = all.into_iter().find(|e| family(&e.name) == fam)?;
    let split = |n: &str| -> (String, String) {
        let toks: Vec<&str> = n.split_whitespace().collect();
        let i = toks.iter().position(|t| !version_of(t).is_empty()).unwrap_or(toks.len());
        (toks[..i].join(" "), toks[i..].join(" "))
    };
    let (their_name, _) = split(&names::ccrl_base(&listed.name));
    let (_, our_version) = split(canon.trim());
    if their_name.is_empty() {
        return None;
    }
    let spelled = if our_version.is_empty() { their_name } else { format!("{their_name} {our_version}") };
    Some((spelled, format!("engine name as in the CCRL lists ({}), version not listed yet", names::ccrl_base(&listed.name))))
}

pub const RATING_LISTS: [&str; 3] = ["Blitz", "40/15", "FRC"];

/// The CCRL rating of every engine in every list: the same version (1CPU first,
/// otherwise the smallest CPU category), else the latest version of the same
/// engine in the list, marked not exact.
pub fn engine_ratings(lists: &[CcrlList], aliases: &HashMap<String, String>, engines: &[(i64, String)]) -> Vec<EngineListRating> {
    let mut out = Vec::new();
    for list in RATING_LISTS {
        let entries = newest_first(lists, list);
        if entries.is_empty() {
            continue;
        }
        let keys: Vec<(String, String)> = entries.iter().map(|e| (base_key(&e.name), family(&e.name))).collect();
        for (id, name) in engines {
            let canon = aliases.get(name).cloned().unwrap_or_else(|| name.clone());
            let key = base_key(&canon);
            let fam = family(&canon);
            // smallest CPU category; on a tie the first one, from the newest list
            let by_cpu = |a: &&CcrlEntry, b: &&CcrlEntry| a.cpus().cmp(&b.cpus());
            let exact = entries.iter().zip(&keys).filter(|(_, (k, _))| *k == key).map(|(e, _)| *e).min_by(by_cpu);
            let (e, is_exact) = match exact {
                Some(e) => (e, true),
                None if !fam.is_empty() => {
                    let same: Vec<&CcrlEntry> = entries.iter().zip(&keys).filter(|(_, (_, f))| *f == fam).map(|(e, _)| *e).collect();
                    let Some(latest) = same.iter().map(|e| version_of(&e.name)).max_by(|a, b| compare_versions(a, b)) else { continue };
                    match same.into_iter().filter(|e| version_of(&e.name) == latest).min_by(by_cpu) {
                        Some(e) => (e, false),
                        None => continue,
                    }
                }
                None => continue,
            };
            out.push(EngineListRating { engine_id: *id, list: list.to_string(), ccrl_name: e.name.clone(), rating: e.rating, rank: e.rank, cpus: e.cpus(), games: e.games, exact: is_exact });
        }
    }
    out
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
    fn ccrl_page_with_two_header_rows_and_tied_ranks() {
        // the layout of the CCRL index pages (2026): Rating spans Elo / + / -
        let html = r#"<table><tr><th rowspan=2>Rank</th><th rowspan=2>Name</th><th colspan=3>Rating</th><th rowspan=2>Score</th><th rowspan=2>Average Opponent</th><th rowspan=2>Draws</th><th rowspan=2>Games</th><th rowspan=2>LOS</th></tr>
<tr><th>Elo</th><th>+</th><th>&minus;</th></tr>
<tr><td>13</td><td><a href="x">Viridithas 20.0.0 64-bit</a></td><td>3748</td><td>+12</td><td>&minus;12</td><td>50.2%</td><td>-1.2</td><td>91.4%</td><td>2047</td><td>61.9%</td></tr>
<tr><td>14-15</td><td><a href="x">Caissa 1.22 64-bit 8CPU</a></td><td>3746</td><td>+12</td><td>&minus;12</td><td>55.2%</td><td>-32.8</td><td>83.6%</td><td>1976</td><td>48.6%</td></tr>
<tr><td>14-15</td><td>Stormphrax 8.0.0 64-bit</td><td>3746</td><td>+12</td><td>-12</td><td>50.5%</td><td>-3.3</td><td>86.6%</td><td>2260</td><td>62.3%</td></tr></table>"#;
        let e = parse_html(html);
        assert_eq!(e.len(), 3);
        assert_eq!((e[1].rank, e[1].name.as_str(), e[1].rating), (14, "Caissa 1.22 64-bit 8CPU", 3746.0));
        assert_eq!(e[2].rank, 14);
        assert_eq!(e[1].games, Some(1976));
        assert_eq!(e[1].score, Some(55.2));
        assert_eq!((e[1].err_plus, e[1].err_minus), (Some(12.0), Some(12.0)));
    }

    #[test]
    fn bundled_snapshots() {
        let l = snapshot_lists();
        assert_eq!(l.len(), 3);
        let n: Vec<usize> = l.iter().map(|x| x.entries.len()).collect();
        assert_eq!(n, vec![115, 62, 111]);
        for x in &l {
            assert!(x.source.contains("2026"), "{}", x.source);
            assert!(x.entries.windows(2).all(|w| w[0].rating >= w[1].rating), "{} sorted", x.list);
            assert!(x.entries.iter().all(|e| e.games.unwrap_or(0) > 100 && e.err_plus.is_some()));
        }
        assert_eq!(l[0].entries[13].name, "Caissa 1.22 64-bit 8CPU");
        assert_eq!(l[1].entries[0].name, "Stockfish 19 64-bit 4CPU");
        assert_eq!(l[2].entries[0].rating, 4117.0);
    }

    #[test]
    fn every_list_has_fallback_urls() {
        let src = default_sources();
        assert_eq!(src.len(), 6);
        let s4040 = src.iter().find(|s| s.list == "40/15" && s.variant == "all").unwrap();
        let c = candidate_urls(s4040);
        assert_eq!(c[0], "https://computerchess.org.uk/4040/rating_list_all.html");
        assert!(c.contains(&"https://computerchess.org.uk/ccrl/4040/rating_list_all.html".to_string()));
        assert!(c.contains(&"https://www.computerchess.org.uk/4040/rating_list_all.html".to_string()));
        assert!(c.iter().any(|u| u.contains("/4040/cgi/compare_engines.cgi") && u.ends_with("only_best_in_class=0")));
        let best = src.iter().find(|s| s.list == "FRC" && s.variant == "best").unwrap();
        let c = candidate_urls(best);
        assert!(c.contains(&"https://computerchess.org.uk/404FRC/index.html".to_string()));
        assert!(c.iter().any(|u| u.contains("/404FRC/cgi/") && u.ends_with("only_best_in_class=1")));
        // an old configured URL still finds the new place
        let old = ListSource { list: "40/15".into(), cpu: "mixed".into(), variant: "all".into(), url: "https://computerchess.org.uk/ccrl/4040/rating_list_all.html".into() };
        assert!(candidate_urls(&old).contains(&"https://computerchess.org.uk/4040/rating_list_all.html".to_string()));
    }

    #[test]
    fn fetch_falls_back_to_the_next_url() {
        let src = default_sources().into_iter().find(|s| s.list == "40/15" && s.variant == "best").unwrap();
        let rows: String = (1..=8).map(|i| format!("<tr><td>{i}</td><td>Engine{i} 1.0 64-bit 4CPU</td><td>{}</td><td>+10</td><td>-10</td></tr>", 3600 - i * 10)).collect();
        let page = format!("<table><tr><th>Rank</th><th>Name</th><th>Rating</th><th>+</th><th>-</th></tr>{rows}</table>");
        let l = fetch_with(&src, |u| if u.contains("/ccrl/4040/") { Ok((200, page.clone())) } else if u.contains("www.") { Ok((200, "<html>blocked</html>".into())) } else { Ok((403, String::new())) }, &[]).unwrap();
        assert_eq!(l.entries.len(), 8);
        assert!(l.source.contains("/ccrl/4040/"));
        let err = fetch_with(&src, |_| Ok((403, String::new())), &[]).unwrap_err().to_string();
        assert!(err.contains("HTTP 403") && err.contains("compare_engines.cgi"), "{err}");
    }

    /// A site that answers the Blitz page for every unknown address (or a home page showing
    /// the Blitz list) must not turn every list into the Blitz list.
    #[test]
    fn every_list_gets_its_own_page() {
        let page = |title: &str, base: i64| {
            let rows: String = (1..=8).map(|i| format!("<tr><td>{i}</td><td>Engine{i}x{base} 1.0 64-bit 4CPU</td><td>{}</td><td>+10</td><td>-10</td></tr>", base - i * 10)).collect();
            format!("<html><h2>{title}</h2><table><tr><th>Rank</th><th>Name</th><th>Rating</th><th>+</th><th>-</th></tr>{rows}</table></html>")
        };
        let blitz = page("CCRL Blitz Rating List - All engines (best versions only), computed on October 1, 2026", 3800);
        let blitz_all = page("CCRL Blitz Rating List - All engines (all versions), computed on October 1, 2026", 3801);
        let l4015 = page("CCRL 40/15 Rating List - All engines (best versions only), computed on October 1, 2026", 3600);
        // FRC: no title at all, and its pages at the old address only as a text export
        let frc_rows = page("", 4100);
        let get = |u: &str| -> Result<(u16, String)> {
            Ok(if u.contains("/ccrl/4040/") && !u.contains("rating_list_all") && !u.contains("cgi") {
                (200, l4015.clone())
            } else if u.contains("/404/rating_list_all.html") {
                (200, blitz_all.clone())
            } else if u.contains("/404FRC/cgi/") && u.ends_with("only_best_in_class=1") {
                (200, frc_rows.clone())
            } else {
                // every other address: the Blitz best page (soft 404 / home page)
                (200, blitz.clone())
            })
        };
        let src = |list: &str, variant: &str| default_sources().into_iter().find(|s| s.list == list && s.variant == variant).unwrap();
        let mut got: Vec<CcrlList> = Vec::new();
        for (list, variant) in [("Blitz", "best"), ("Blitz", "all"), ("40/15", "best"), ("FRC", "best")] {
            let l = fetch_with(&src(list, variant), get, &got).unwrap_or_else(|e| panic!("{list} {variant}: {e}"));
            got.push(l);
        }
        assert!(got[0].entries[0].name.contains("x3800") && got[0].source.contains("Blitz Rating List"), "{}", got[0].source);
        assert!(got[1].entries[0].name.contains("x3801"), "{}", got[1].source);
        assert!(got[2].entries[0].name.contains("x3600") && got[2].source.contains("/ccrl/4040/"), "{}", got[2].source);
        // the untitled Blitz copies are skipped: FRC comes from its own text export
        assert!(got[3].entries[0].name.contains("x4100") && got[3].source.contains("/404FRC/cgi/"), "{}", got[3].source);
        // 40/15 all versions: only Blitz pages anywhere -> not downloaded, with the reason
        let err = fetch_with(&src("40/15", "all"), get, &got).unwrap_err().to_string();
        assert!(err.contains("this page is the Blitz list"), "{err}");
        assert_eq!(page_identity(&l4015).map(|x| (x.0, x.1)), Some(("40/15".to_string(), Some(true))));
        assert_eq!(page_identity("<h1>CCRL 40/2 FRC Rating List - All engines</h1>").map(|x| x.0), Some("FRC".to_string()));
    }

    #[test]
    fn text_list_inside_pre() {
        let html = "<html><body><pre>\n   1 Stockfish 19 64-bit 8CPU      3820  +15  -15   70.1%  -120.3   48.7%   1520\n   2 PlentyChess 8.0.0 64-bit 8CPU  3700  +14  -14   55.0%   -30.1   60.2%   1400\n</pre></body></html>";
        let e = parse_html(html);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].name, "Stockfish 19 64-bit 8CPU");
        assert_eq!(e[1].rating, 3700.0);
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

    #[test]
    fn library_engines_get_their_ccrl_ratings() {
        let e = |rank, name: &str, rating| CcrlEntry { rank, name: name.into(), rating, err_plus: None, err_minus: None, games: Some(500), score: None };
        let r_lists = || vec![CcrlList { id: None, list: "Blitz".into(), cpu: "mixed".into(), variant: "all".into(), source: String::new(), fetched_at: String::new(), entries: vec![e(2, "Stockfish 17 64-bit", 3640.0)] }];
        let blitz = CcrlList { id: None, list: "Blitz".into(), cpu: "mixed".into(), variant: "all".into(), source: String::new(), fetched_at: String::new(),
            entries: vec![e(1, "Stockfish 17 64-bit 8CPU", 3800.0), e(2, "Stockfish 17 64-bit", 3640.0), e(3, "Stockfish 16 64-bit", 3620.0), e(9, "Berserk 13 64-bit 4CPU", 3650.0), e(20, "Ethereal 14 64-bit", 3500.0), e(21, "Ethereal 13 64-bit", 3450.0)] };
        let l4015 = CcrlList { list: "40/15".into(), entries: vec![e(1, "Stockfish 17 64-bit 4CPU", 3700.0)], ..blitz.clone() };
        let aliases = HashMap::from([("SF dev".to_string(), "Stockfish 16".to_string())]);
        let engines = vec![(1, "Stockfish 17".to_string()), (2, "Berserk 13".into()), (3, "Ethereal 15".into()), (4, "Nobody 1".into()), (5, "SF dev".into())];
        let r = engine_ratings(&[blitz, l4015], &aliases, &engines);
        let get = |id, list: &str| r.iter().find(|x| x.engine_id == id && x.list == list);
        // the same version, 1CPU before 8CPU
        let sf = get(1, "Blitz").unwrap();
        assert_eq!((sf.rating, sf.cpus, sf.rank, sf.exact), (3640.0, 1, 2, true));
        // only a 4CPU entry
        assert_eq!(get(1, "40/15").unwrap().cpus, 4);
        assert_eq!(get(2, "Blitz").unwrap().cpus, 4);
        // a newer version than the list: the latest version, not exact
        let eth = get(3, "Blitz").unwrap();
        assert_eq!((eth.ccrl_name.as_str(), eth.exact), ("Ethereal 14 64-bit", false));
        assert!(get(4, "Blitz").is_none());
        assert!(get(3, "40/15").is_none());
        // aliases count
        assert_eq!(get(5, "Blitz").unwrap().rating, 3620.0);
        assert!(get(5, "Blitz").unwrap().exact);
        // with two lists the newest one wins, here and in the wizard ratings
        let old_list = CcrlList { fetched_at: "2026-01-01".into(), entries: vec![e(5, "Stockfish 17 64-bit", 3600.0)], ..r_lists()[0].clone() };
        let new_list = CcrlList { fetched_at: "2026-09-01".into(), ..r_lists()[0].clone() };
        for ls in [vec![old_list.clone(), new_list.clone()], vec![new_list, old_list]] {
            let r = engine_ratings(&ls, &HashMap::new(), &[(1, "Stockfish 17".to_string())]);
            assert_eq!(r[0].rating, 3640.0);
            assert_eq!(RatingIndex::new(&ls, "Blitz", HashMap::new(), 50.0).rating("Stockfish 17", 1).rating, Some(3640.0));
        }
    }

    #[test]
    fn export_names_follow_the_ccrl_spelling_of_the_list() {
        let e = |rank, name: &str| CcrlEntry { rank, name: name.into(), rating: 3700.0, err_plus: None, err_minus: None, games: None, score: None };
        let l = |list: &str, entries| CcrlList { id: None, list: list.into(), cpu: "mixed".into(), variant: "best".into(), source: String::new(), fetched_at: "2026-09-01".into(), entries };
        let lists = vec![
            l("Blitz", vec![e(1, "Integral 8 64-bit"), e(2, "pawnocchio 2.0 64-bit"), e(3, "Horsie 1.1.0 64-bit 8CPU")]),
            l("40/15", vec![e(1, "Integral v8 64-bit 4CPU"), e(2, "Horsie 1.1 64-bit 4CPU")]),
        ];
        let none = HashMap::new();
        let sp = |list: &str, n: &str| list_spelling(&lists, list, &none, n).map(|x| x.0);
        // each list writes the same version its own way
        assert_eq!(sp("Blitz", "Integral v8").as_deref(), Some("Integral 8"));
        assert_eq!(sp("40/15", "Integral 8").as_deref(), Some("Integral v8"));
        assert_eq!(sp("Blitz", "Horsie 1.1").as_deref(), Some("Horsie 1.1.0"));
        assert_eq!(sp("40/15", "Horsie 1.1.0").as_deref(), Some("Horsie 1.1"));
        // not in the 40/15 list: the Blitz spelling
        assert_eq!(sp("40/15", "Pawnocchio 2.0").as_deref(), Some("pawnocchio 2.0"));
        // a new version: the engine's name as listed, our version
        assert_eq!(sp("Blitz", "Pawnocchio 2.1.0").as_deref(), Some("pawnocchio 2.1.0"));
        assert!(list_spelling(&lists, "Blitz", &none, "Pawnocchio 2.1.0").unwrap().1.contains("not listed"));
        assert_eq!(sp("Blitz", "Nobody 1"), None);
        // aliases count
        let al = HashMap::from([("Integral-dev".to_string(), "Integral 8".to_string())]);
        assert_eq!(list_spelling(&lists, "Blitz", &al, "Integral-dev").unwrap().0, "Integral 8");
    }
}
