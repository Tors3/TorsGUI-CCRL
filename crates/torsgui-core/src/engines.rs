//! Engine library: entries, UCI verification, binary checks, the REPORT.md
//! equivalent and rebuilding the library from an existing report.

use crate::names;
use anyhow::{anyhow, bail, Context, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct UciOption {
    pub name: String,
    pub kind: String,
    pub default: Option<String>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub vars: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EngineEntry {
    pub id: Option<i64>,
    /// Canonical CCRL-style display name `<Engine> <version>`.
    pub display_name: String,
    pub engine: String,
    pub version: String,
    pub author: String,
    /// Path of the executable ("" when only metadata is known).
    pub path: String,
    pub dir: String,
    pub build: String,
    pub arch: String,
    pub sha256: String,
    /// Repository URL (official GitHub or project site).
    pub source_url: String,
    pub release_url: String,
    pub release_tag: String,
    pub asset: String,
    pub uci_id: String,
    /// Raw `uci_options.txt` content (id name + option lines).
    pub options_text: String,
    pub options: Vec<UciOption>,
    pub threads_max: Option<i64>,
    pub has_syzygy: bool,
    /// Declares `UCI_Chess960` (can play Fischer Random).
    #[serde(default)]
    pub chess960: bool,
    /// unverified | ok | failed
    pub verify_status: String,
    pub verify_detail: String,
    pub bestmove: String,
    pub notes: String,
    /// Warnings such as "bmi2 build", "universal binary", "single-thread only".
    pub flags: Vec<String>,
    pub used: bool,
    /// Options always sent in tournaments (Ponder=false, OwnBook=false...).
    pub default_options: BTreeMap<String, String>,
    /// Command-line arguments of the engine (e.g. imported from Cute Chess).
    #[serde(default)]
    pub args: String,
    pub extra_files: Vec<String>,
    pub selection_reason: String,
    pub added_at: String,
}

impl EngineEntry {
    pub fn export_name(&self, threads: u32) -> String {
        names::ccrl_name(&self.display_name, threads)
    }
    pub fn single_thread_only(&self) -> bool {
        self.threads_max == Some(1)
    }
    /// Options for a tournament participant (Threads/Hash templated).
    pub fn tournament_options(&self) -> BTreeMap<String, String> {
        let mut o = BTreeMap::new();
        o.insert("Threads".into(), "${THREADS}".into());
        o.insert("Hash".into(), "${HASH}".into());
        for (k, v) in &self.default_options {
            o.insert(k.clone(), v.clone());
        }
        o
    }
    /// Applies the options parsed from `options_text`.
    pub fn refresh_options(&mut self) {
        let (id, opts) = parse_uci_options(&self.options_text);
        if let Some(id) = id {
            self.uci_id = id;
        }
        self.threads_max = opts.iter().find(|o| o.name == "Threads").and_then(|o| o.max);
        self.has_syzygy = opts.iter().any(|o| o.name == "SyzygyPath");
        self.chess960 = opts.iter().any(|o| o.name.eq_ignore_ascii_case("UCI_Chess960"));
        // the options set by the user stay; Ponder/OwnBook=false are added when missing
        for (k, v) in default_options(&opts) {
            self.default_options.entry(k).or_insert(v);
        }
        self.flags.retain(|f| f != "single-thread only");
        if self.threads_max == Some(1) {
            self.flags.push("single-thread only".into());
        }
        self.options = opts;
    }
}

static OPT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^option name (.+?) type (\w+)(?: default ?(.*?))?(?: min (-?\d+))?(?: max (-?\d+))?((?: var .*)?)\s*$").unwrap()
});

/// Parses `id name ...` and `option name ...` lines.
pub fn parse_uci_options(text: &str) -> (Option<String>, Vec<UciOption>) {
    let mut id = None;
    let mut out = Vec::new();
    for l in text.lines() {
        let l = l.trim_end();
        if let Some(n) = l.strip_prefix("id name ") {
            id = Some(n.trim().to_string());
        } else if let Some(c) = OPT_RE.captures(l) {
            let vars_raw = c.get(6).map(|m| m.as_str()).unwrap_or("");
            out.push(UciOption {
                name: c[1].to_string(),
                kind: c[2].to_string(),
                default: c.get(3).map(|m| m.as_str().to_string()),
                min: c.get(4).and_then(|m| m.as_str().parse().ok()),
                max: c.get(5).and_then(|m| m.as_str().parse().ok()),
                vars: vars_raw.split(" var ").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            });
        }
    }
    (id, out)
}

/// Ponder=false when exposed; OwnBook=false when exposed (Coda 0.9.3 defaults to true).
pub fn default_options(opts: &[UciOption]) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    if opts.iter().any(|o| o.name == "Ponder") {
        m.insert("Ponder".into(), "false".into());
    }
    if opts.iter().any(|o| o.name == "OwnBook") {
        m.insert("OwnBook".into(), "false".into());
    }
    m
}

/// String options that hold a file (a network, weights): checked on disk.
pub fn is_file_option(o: &UciOption) -> bool {
    let n = o.name.to_lowercase();
    o.kind == "string" && !n.contains("syzygy") && !n.contains("log") && (n.contains("evalfile") || n.contains("nnue") || n.contains("weights") || n.contains("network") || n == "net" || n.ends_with("file"))
}

/// Problems with the options sent to an engine: names it does not declare (often a
/// wrong upper/lower case), values outside its range or list, network files that
/// do not exist (relative paths are read from the engine's working folder `dir`).
pub fn check_options(engine: &str, values: &BTreeMap<String, String>, declared: &[UciOption], dir: &str) -> Vec<String> {
    let mut out = Vec::new();
    if declared.is_empty() {
        return out;
    }
    for (k, v) in values {
        let v = v.trim();
        let Some(o) = declared.iter().find(|o| &o.name == k) else {
            if k == "Threads" || k == "Hash" {
                continue;
            }
            match declared.iter().find(|o| o.name.eq_ignore_ascii_case(k)) {
                Some(o) => out.push(format!("{engine}: option '{k}' does not exist, the engine calls it '{}' (names are case-sensitive)", o.name)),
                None => out.push(format!("{engine}: the engine has no option '{k}': it is ignored")),
            }
            continue;
        };
        if v.contains("${") {
            continue;
        }
        match o.kind.as_str() {
            "spin" => match v.parse::<i64>() {
                Ok(n) if o.min.is_some_and(|m| n < m) || o.max.is_some_and(|m| n > m) => {
                    out.push(format!("{engine}: {k}={n} is outside {}..{}", o.min.unwrap_or(i64::MIN), o.max.unwrap_or(i64::MAX)))
                }
                Ok(_) => {}
                Err(_) => out.push(format!("{engine}: {k} needs a whole number, not '{v}'")),
            },
            "check" if v != "true" && v != "false" => out.push(format!("{engine}: {k} must be true or false, not '{v}'")),
            "combo" if !o.vars.iter().any(|x| x == v) => out.push(format!("{engine}: {k}='{v}' is not one of {}", o.vars.join(", "))),
            _ if is_file_option(o) && !v.is_empty() && v != "<empty>" => {
                let p = Path::new(v);
                let full = if p.is_absolute() || dir.is_empty() { p.to_path_buf() } else { Path::new(dir).join(p) };
                if !full.exists() {
                    out.push(format!("{engine}: {k} file not found: {}{}", full.display(), if p.is_absolute() { String::new() } else { format!(" (a relative path is read from the engine folder {dir})") }));
                }
            }
            _ => {}
        }
    }
    out
}

pub fn sha256_file(p: &Path) -> Result<String> {
    let mut f = std::fs::File::open(p).with_context(|| format!("opening {}", p.display()))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Bitness {
    Bits64,
    Bits32,
    Unknown,
}

/// Reads the PE (Windows) or ELF header to tell 32-bit from 64-bit binaries.
pub fn binary_bitness(p: &Path) -> Bitness {
    let mut buf = vec![0u8; 4096];
    let n = match std::fs::File::open(p).and_then(|mut f| f.read(&mut buf)) {
        Ok(n) => n,
        Err(_) => return Bitness::Unknown,
    };
    let b = &buf[..n];
    if b.len() >= 5 && &b[..4] == b"\x7fELF" {
        return match b[4] {
            1 => Bitness::Bits32,
            2 => Bitness::Bits64,
            _ => Bitness::Unknown,
        };
    }
    if b.len() >= 0x40 && &b[..2] == b"MZ" {
        let off = u32::from_le_bytes([b[0x3c], b[0x3d], b[0x3e], b[0x3f]]) as usize;
        if off + 6 <= b.len() && &b[off..off + 4] == b"PE\0\0" {
            let machine = u16::from_le_bytes([b[off + 4], b[off + 5]]);
            return match machine {
                0x8664 | 0xaa64 => Bitness::Bits64,
                0x014c => Bitness::Bits32,
                _ => Bitness::Unknown,
            };
        }
    }
    Bitness::Unknown
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct VerifyResult {
    pub ok: bool,
    pub uciok: bool,
    pub readyok: bool,
    pub id_name: String,
    pub id_author: String,
    pub bestmove: String,
    pub depth: Option<u32>,
    pub seconds: f64,
    pub options_text: String,
    pub tail: Vec<String>,
    pub error: Option<String>,
    pub sha256: String,
    pub bitness: String,
}

/// `uci` -> `isready` -> `go depth N` from the start position -> `quit`.
pub fn verify(exe: &Path, depth: u32, timeout: Duration) -> VerifyResult {
    let mut res = VerifyResult { sha256: sha256_file(exe).unwrap_or_default(), ..Default::default() };
    res.bitness = format!("{:?}", binary_bitness(exe));
    let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    let mut cmd = Command::new(exe);
    cmd.current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    crate::platform::no_window(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            res.error = Some(format!("cannot start: {e}"));
            return res;
        }
    };
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for l in BufReader::new(stdout).lines() {
            match l {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let mut lines: Vec<String> = Vec::new();
    let wait_for = |prefix: &str, secs: u64, lines: &mut Vec<String>| -> Option<String> {
        let end = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < end {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(l) => {
                    let hit = l.starts_with(prefix);
                    lines.push(l.clone());
                    if hit {
                        return Some(l);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return None,
            }
        }
        None
    };
    let mut send = |s: &str| {
        let _ = writeln!(stdin, "{s}");
        let _ = stdin.flush();
    };
    send("uci");
    res.uciok = wait_for("uciok", 30, &mut lines).is_some();
    send("isready");
    res.readyok = wait_for("readyok", 60, &mut lines).is_some();
    send("position startpos");
    let t0 = Instant::now();
    send(&format!("go depth {depth}"));
    let bm = wait_for("bestmove", timeout.as_secs().max(5), &mut lines);
    res.seconds = (t0.elapsed().as_secs_f64() * 10.0).round() / 10.0;
    if let Some(bm) = bm {
        res.bestmove = bm.split_whitespace().nth(1).unwrap_or("?").to_string();
    }
    send("quit");
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    static DEPTH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bdepth (\d+)").unwrap());
    res.depth = lines.iter().filter_map(|l| DEPTH.captures(l)).filter_map(|c| c[1].parse().ok()).max();
    res.id_name = lines.iter().find_map(|l| l.strip_prefix("id name ")).unwrap_or("?").trim().to_string();
    res.id_author = lines.iter().find_map(|l| l.strip_prefix("id author ")).unwrap_or("").trim().to_string();
    let opts: Vec<&String> = lines.iter().filter(|l| l.starts_with("option name ")).collect();
    res.options_text = format!(
        "id name {}\n{}\n",
        res.id_name,
        opts.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n")
    );
    res.ok = res.uciok && res.readyok && !["", "(none)", "0000", "a1a1"].contains(&res.bestmove.as_str());
    if !res.ok && res.error.is_none() {
        res.error = Some(if !res.uciok {
            "no uciok".into()
        } else if !res.readyok {
            "no readyok".into()
        } else {
            format!("no legal bestmove ({})", if res.bestmove.is_empty() { "timeout" } else { &res.bestmove })
        });
    }
    res.tail = lines.iter().rev().take(8).rev().cloned().collect();
    res
}

/// Applies a verification result to a library entry.
pub fn apply_verify(e: &mut EngineEntry, v: &VerifyResult) {
    e.verify_status = if v.ok { "ok".into() } else { "failed".into() };
    e.verify_detail = match &v.error {
        Some(err) => format!("{err}; last lines: {}", v.tail.join(" | ")),
        None => format!("bestmove {} depth {} in {}s", v.bestmove, v.depth.map(|d| d.to_string()).unwrap_or("?".into()), v.seconds),
    };
    e.bestmove = v.bestmove.clone();
    if !v.sha256.is_empty() {
        e.sha256 = v.sha256.clone();
    }
    if v.uciok {
        e.options_text = v.options_text.clone();
        if !v.id_author.is_empty() {
            e.author = v.id_author.clone();
        }
        e.refresh_options();
    }
    if v.bitness == "Bits32" && !e.flags.iter().any(|f| f == "32-bit") {
        e.flags.push("32-bit".into());
    }
}

// ------------------------------------------------------------------ report

fn short_opts(e: &EngineEntry) -> String {
    let mut parts = Vec::new();
    for key in ["Threads", "Hash"] {
        if let Some(o) = e.options.iter().find(|o| o.name == key) {
            parts.push(format!(
                "{} {} [{}–{}]",
                key,
                o.default.clone().unwrap_or_default(),
                o.min.map(|x| x.to_string()).unwrap_or_default(),
                o.max.map(|x| x.to_string()).unwrap_or_default()
            ));
        }
    }
    let others: Vec<&str> = e
        .options
        .iter()
        .filter(|o| o.name != "Threads" && o.name != "Hash")
        .map(|o| o.name.as_str())
        .take(8)
        .collect();
    if !others.is_empty() {
        parts.push(others.join(", "));
    }
    parts.join("; ")
}

/// Markdown report equivalent to `engines/REPORT.md`.
pub fn report_markdown(engines: &[EngineEntry], host: &str) -> String {
    let mut s = String::new();
    s.push_str("# Engine library report\n\n");
    s.push_str(&format!("Generated by TorsGUI on {} · Host: {}\n\n", chrono::Local::now().format("%Y-%m-%d"), host));
    s.push_str("- Source: official GitHub releases or the project's official site only (no mirrors).\n");
    s.push_str("- Asset rule: Windows AVX2 build; never AVX-512 / VNNI / x86-64-v4; bmi2 or generic builds are flagged; never 32-bit; never compiled.\n");
    s.push_str("- Verification: `uci` → `isready` → `go depth 12` from the start position.\n\n");
    s.push_str("| Engine | Version | Release | Asset | Build | SHA256 | `id name` | UCI options | Verified | Used | Notes / reasons |\n");
    s.push_str("|---|---|---|---|---|---|---|---|---|---|---|\n");
    for e in engines {
        let rel = if e.release_url.is_empty() { "-".to_string() } else { format!("[release]({})", e.release_url) };
        let mut notes = Vec::new();
        if !e.flags.is_empty() {
            notes.push(format!("**{}**", e.flags.join(", ")));
        }
        if !e.selection_reason.is_empty() {
            notes.push(e.selection_reason.clone());
        }
        if !e.notes.is_empty() {
            notes.push(e.notes.clone());
        }
        s.push_str(&format!(
            "| {} | {} | {} | `{}` | {} | `{}` | `{}` | {} | {} | {} | {} |\n",
            e.engine,
            e.version,
            rel,
            e.asset,
            e.build,
            e.sha256,
            e.uci_id,
            short_opts(e),
            e.verify_status,
            if e.used { "yes" } else { "no" },
            notes.join(" ").replace('|', "\\|").replace('\n', " ")
        ));
    }
    s
}

// ------------------------------------------------------------------ rebuild from REPORT.md

fn split_row(line: &str) -> Vec<String> {
    let l = line.trim().trim_start_matches('|').trim_end_matches('|');
    // split on | not escaped
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev = ' ';
    for c in l.chars() {
        if c == '|' && prev != '\\' {
            out.push(cur.trim().to_string());
            cur.clear();
        } else {
            cur.push(c);
        }
        prev = c;
    }
    out.push(cur.trim().to_string());
    out
}

fn strip_md(s: &str) -> String {
    s.replace("**", "").replace('`', "").trim().to_string()
}

/// Rebuilds library entries (metadata only, no binaries) from a REPORT.md in
/// the CCRL_ScirptsTests format and a folder of `uci_options/<Engine>_<version>.txt`.
pub fn rebuild_from_report(report: &str, uci_dir: Option<&Path>) -> Vec<EngineEntry> {
    static LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"\((https?://[^)]+)\)").unwrap());
    let mut out: Vec<EngineEntry> = Vec::new();
    let mut header: Option<Vec<String>> = None;
    let uci_files: Vec<PathBuf> = uci_dir
        .and_then(|d| std::fs::read_dir(d).ok())
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "txt").unwrap_or(false)).collect())
        .unwrap_or_default();
    for line in report.lines() {
        let t = line.trim();
        if !t.starts_with('|') {
            header = None;
            continue;
        }
        let cells = split_row(t);
        if cells.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ':' || ch == ' ')) {
            continue;
        }
        let Some(h) = &header else {
            header = Some(cells.iter().map(|c| strip_md(c).to_lowercase()).collect());
            continue;
        };
        let col = |keys: &[&str]| -> Option<String> {
            h.iter().position(|hh| keys.iter().any(|k| hh.contains(k))).and_then(|i| cells.get(i).cloned())
        };
        let (Some(engine), Some(version)) = (col(&["motore", "engine"]), col(&["versione", "version"])) else {
            continue;
        };
        let mut e = EngineEntry {
            engine: strip_md(&engine),
            version: strip_md(&version),
            ..Default::default()
        };
        e.display_name = names::display_name(&e.engine, &e.version);
        if let Some(rel) = col(&["release"]) {
            if let Some(c) = LINK.captures(&rel) {
                e.release_url = c[1].to_string();
                e.source_url = e.release_url.split("/releases").next().unwrap_or("").to_string();
                e.release_tag = e.release_url.rsplit("/tag/").next().filter(|_| e.release_url.contains("/tag/")).unwrap_or("").to_string();
            }
        }
        e.asset = col(&["asset"]).map(|s| strip_md(&s)).unwrap_or_default();
        e.build = col(&["build"]).map(|s| strip_md(&s)).unwrap_or_default();
        e.sha256 = col(&["sha256"]).map(|s| strip_md(&s)).unwrap_or_default();
        e.uci_id = col(&["id name"]).map(|s| strip_md(&s)).unwrap_or_default();
        let notes = col(&["problemi", "note", "notes"]).map(|s| strip_md(&s)).unwrap_or_default();
        e.notes = notes;
        e.used = match col(&["usato", "used"]) {
            Some(u) => strip_md(&u).to_lowercase().starts_with("si") || strip_md(&u).to_lowercase().starts_with("yes"),
            None => true,
        };
        if !e.used {
            if let Some(u) = col(&["usato", "used"]) {
                e.notes = format!("{} {}", e.notes, strip_md(&u)).trim().to_string();
            }
        }
        let bl = e.build.to_lowercase();
        if bl.contains("bmi2") || bl.contains("pext") {
            e.flags.push("bmi2/pext build (no pure AVX2)".into());
        }
        if bl.contains("universal") {
            e.flags.push("universal binary (runtime dispatch may use AVX-512)".into());
        }
        e.verify_status = "unverified".into();
        e.arch = "x86-64".into();
        // options file: "<Engine>_<version>.txt" or best fuzzy match on id name
        let stem_want = names::normalize(&format!("{} {}", e.engine, e.version));
        let file = uci_files
            .iter()
            .find(|p| {
                let st = p.file_stem().unwrap().to_string_lossy().replace(['_', '-'], " ");
                names::normalize(&st) == stem_want
            })
            .or_else(|| {
                uci_files.iter().find(|p| {
                    std::fs::read_to_string(p)
                        .ok()
                        .and_then(|t| t.lines().next().map(|l| l.trim_start_matches("id name ").trim().to_string()))
                        .map(|id| !e.uci_id.is_empty() && id == e.uci_id)
                        .unwrap_or(false)
                })
            });
        if let Some(f) = file {
            if let Ok(t) = std::fs::read_to_string(f) {
                e.options_text = t;
                e.refresh_options();
            }
        }
        if e.threads_max == Some(1) || e.notes.to_lowercase().contains("single-thread") {
            if !e.flags.iter().any(|f| f == "single-thread only") {
                e.flags.push("single-thread only".into());
            }
        }
        out.push(e);
    }
    out
}

/// Launches the engine with `uci` only and returns the id name (quick check).
pub fn quick_id(exe: &Path) -> Result<String> {
    let v = verify(exe, 1, Duration::from_secs(10));
    if !v.uciok {
        bail!("{}", v.error.unwrap_or_else(|| "no uciok".into()));
    }
    Ok(v.id_name)
}

/// Finds executables in an extracted folder.
pub fn find_executables(dir: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.path().to_path_buf())
        .filter(|p| p.is_file())
        .filter(|p| {
            let n = p.file_name().unwrap().to_string_lossy().to_lowercase();
            if cfg!(windows) {
                n.ends_with(".exe")
            } else {
                let _ = n;
                is_executable(p)
            }
        })
        .collect()
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
        && binary_bitness(p) != Bitness::Unknown
}
#[cfg(not(unix))]
fn is_executable(_p: &Path) -> bool {
    false
}

pub fn ensure_exists(p: &str) -> Result<()> {
    if !Path::new(p).exists() {
        return Err(anyhow!("file not found: {p}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_options() {
        let t = "id name Coda 0.9.3\noption name Threads type spin default 1 min 1 max 256\noption name OwnBook type check default true\noption name Ponder type check default false\noption name SyzygyPath type string default <empty>\noption name Style type combo default A var A var B\n";
        let (id, o) = parse_uci_options(t);
        assert_eq!(id.as_deref(), Some("Coda 0.9.3"));
        assert_eq!(o.len(), 5);
        assert_eq!(o[0].max, Some(256));
        assert_eq!(o[4].vars, vec!["A", "B"]);
        let d = default_options(&o);
        assert_eq!(d.get("OwnBook").map(|s| s.as_str()), Some("false"));
        assert_eq!(d.get("Ponder").map(|s| s.as_str()), Some("false"));
    }
    #[test]
    fn bitness() {
        let dir = tempfile::tempdir().unwrap();
        let mut pe = vec![0u8; 256];
        pe[0] = b'M';
        pe[1] = b'Z';
        pe[0x3c] = 0x80;
        pe[0x80..0x84].copy_from_slice(b"PE\0\0");
        pe[0x84] = 0x4c;
        pe[0x85] = 0x01;
        let p = dir.path().join("x32.exe");
        std::fs::write(&p, &pe).unwrap();
        assert_eq!(binary_bitness(&p), Bitness::Bits32);
        pe[0x84] = 0x64;
        pe[0x85] = 0x86;
        std::fs::write(&p, &pe).unwrap();
        assert_eq!(binary_bitness(&p), Bitness::Bits64);
    }

    #[test]
    fn option_values_are_checked() {
        let (_, o) = parse_uci_options("id name Net 1\noption name EvalFile type string default nn-a.nnue\noption name Threads type spin default 1 min 1 max 64\noption name Contempt type spin default 0 min -100 max 100\noption name Ponder type check default false\noption name Style type combo default A var A var B\noption name Debug Log File type string default <empty>\n");
        let dir = std::env::temp_dir().join(format!("torsgui-optcheck-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("nn-b.nnue"), b"x").unwrap();
        let d = dir.to_string_lossy().to_string();
        let ok: BTreeMap<String, String> = [("EvalFile", "nn-b.nnue"), ("Threads", "${THREADS}"), ("Hash", "${HASH}"), ("Contempt", "-20"), ("Ponder", "false"), ("Style", "B"), ("Debug Log File", "x.log")].into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        assert!(check_options("Net 1", &ok, &o, &d).is_empty(), "{:?}", check_options("Net 1", &ok, &o, &d));
        let abs = dir.join("nn-b.nnue").to_string_lossy().to_string();
        assert!(check_options("Net 1", &BTreeMap::from([("EvalFile".to_string(), abs)]), &o, "").is_empty());
        let bad: BTreeMap<String, String> = [("evalfile", "nn-b.nnue"), ("Contempt", "300"), ("Ponder", "yes"), ("Style", "C"), ("Nope", "1")].into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        let w = check_options("Net 1", &bad, &o, &d).join("\n");
        assert!(w.contains("'evalfile' does not exist, the engine calls it 'EvalFile'"), "{w}");
        assert!(w.contains("Contempt=300 is outside -100..100") && w.contains("Ponder must be true or false") && w.contains("'C' is not one of A, B") && w.contains("no option 'Nope'"), "{w}");
        let missing = check_options("Net 1", &BTreeMap::from([("EvalFile".to_string(), "nets/missing.nnue".to_string())]), &o, &d).join("");
        assert!(missing.contains("EvalFile file not found") && missing.contains("read from the engine folder"), "{missing}");
        // nothing known about the engine: nothing to check
        assert!(check_options("X", &bad, &[], &d).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn saving_an_engine_keeps_the_options_set_by_the_user() {
        let mut e = EngineEntry { options_text: "id name Net 1\noption name EvalFile type string default nn-a.nnue\noption name Ponder type check default false\n".into(), ..Default::default() };
        e.refresh_options();
        assert_eq!(e.default_options.get("Ponder").map(|s| s.as_str()), Some("false"));
        e.default_options.insert("EvalFile".into(), "nn-b.nnue".into());
        e.default_options.insert("Ponder".into(), "false".into());
        // what engine_save and engine_verify do
        e.refresh_options();
        e.refresh_options();
        assert_eq!(e.default_options.get("EvalFile").map(|s| s.as_str()), Some("nn-b.nnue"));
        assert_eq!(e.tournament_options().get("EvalFile").map(|s| s.as_str()), Some("nn-b.nnue"));
    }
}
