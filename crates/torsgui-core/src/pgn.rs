//! PGN handling: splitting files into games exactly like the reference Python
//! scripts (`re.split(r"\n\s*\n(?=\[)", text)`), header parsing, fastchess move
//! comments and the slot identity encoded in the Event tag.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

static HEADER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\[(\w+) "(.*)"\]"#).unwrap());
static SLOT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"node(\d+) pass(\d+)(?: r(\d+))?$").unwrap());

pub const FINISHED: [&str; 3] = ["1-0", "0-1", "1/2-1/2"];

pub fn is_finished(result: &str) -> bool {
    FINISHED.contains(&result)
}

/// Normalises newlines the way Python's universal-newline reader does.
pub fn normalize_newlines(s: &str) -> String {
    if !s.contains('\r') {
        return s.to_string();
    }
    s.replace("\r\n", "\n").replace('\r', "\n")
}

/// Reads a text file like `open(p, encoding="utf-8", errors="replace").read()`.
pub fn read_text(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    Ok(normalize_newlines(&String::from_utf8_lossy(&bytes)))
}

/// Byte offsets where `re.split(r"\n\s*\n(?=\[)", text)` would cut:
/// returns (separator_start, next_block_start) pairs.
fn split_points(text: &str) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 1;
    let mut last_end = 0;
    while i < b.len() {
        if b[i] == b'[' && b[i - 1] == b'\n' {
            // walk back over whitespace (ASCII + unicode whitespace handled via chars)
            let before = &text[last_end..i];
            let trimmed_len = before.trim_end().len();
            let ws_start = last_end + trimmed_len;
            let ws = &text[ws_start..i];
            if let Some(f) = ws.find('\n') {
                let first_nl = ws_start + f;
                if first_nl < i - 1 {
                    out.push((first_nl, i));
                    last_end = i;
                }
            }
        }
        i += 1;
    }
    out
}

/// Splits a PGN text into raw blocks (python-compatible, before stripping).
pub fn split_raw(text: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut start = 0;
    for (sep, next) in split_points(text) {
        blocks.push(&text[start..sep]);
        start = next;
    }
    blocks.push(&text[start..]);
    blocks
}

/// Game blocks as the export/dedupe scripts see them: `b.strip("\n")` and
/// keep only blocks starting with `[`.
pub fn game_blocks(text: &str) -> Vec<&str> {
    split_raw(text)
        .into_iter()
        .map(|b| b.trim_matches('\n'))
        .filter(|b| b.starts_with('['))
        .collect()
}

/// Ordered header list (duplicates keep the last value, like a Python dict).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Headers(pub Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Headers {
        let mut v: Vec<(String, String)> = Vec::new();
        for c in HEADER_RE.captures_iter(block) {
            let k = c[1].to_string();
            let val = c[2].to_string();
            if let Some(e) = v.iter_mut().find(|(kk, _)| *kk == k) {
                e.1 = val;
            } else {
                v.push((k, val));
            }
        }
        Headers(v)
    }
    pub fn get(&self, k: &str) -> Option<&str> {
        self.0.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.as_str())
    }
    pub fn get_or<'a>(&'a self, k: &str, d: &'a str) -> &'a str {
        self.get(k).unwrap_or(d)
    }
    pub fn set(&mut self, k: &str, v: &str) {
        if let Some(e) = self.0.iter_mut().find(|(kk, _)| kk == k) {
            e.1 = v.to_string();
        } else {
            self.0.push((k.to_string(), v.to_string()));
        }
    }
    pub fn to_map(&self) -> HashMap<String, String> {
        self.0.iter().cloned().collect()
    }
}

/// Slot of a game inside a tournament: which opening block it belongs to.
/// `node` is the opening partition ("home node"), not necessarily the node the
/// game physically ran on.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SlotKey {
    pub node: u32,
    pub pass: u32,
    pub round: u32,
    pub white: String,
    pub black: String,
}

/// (node, pass, round) from `Event "... nodeN passP rR"` (single games) or
/// `Event "... nodeN passP"` + Round (whole-match scheme).
pub fn event_slot(h: &Headers) -> Option<(u32, u32, u32)> {
    let ev = h.get_or("Event", "");
    let c = SLOT_RE.captures(ev)?;
    let node = c[1].parse().ok()?;
    let pass = c[2].parse().ok()?;
    let round = match c.get(3) {
        Some(m) => m.as_str().parse().ok()?,
        None => h.get_or("Round", "0").parse().unwrap_or(0),
    };
    Some((node, pass, round))
}

pub fn slot_key(h: &Headers) -> Option<SlotKey> {
    let (node, pass, round) = event_slot(h)?;
    Some(SlotKey {
        node,
        pass,
        round,
        white: h.get_or("White", "").to_string(),
        black: h.get_or("Black", "").to_string(),
    })
}

/// Event without the " nodeN passP rR" suffix.
pub fn event_base(ev: &str) -> String {
    let re = Regex::new(r"\s*node\d+ pass\d+(?: r\d+)?$").unwrap();
    re.replace(ev, "").to_string()
}

/// A parsed game (headers + raw movetext).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Game {
    pub headers: Headers,
    pub movetext: String,
    /// Source file and index of the block inside that file.
    pub source: PathBuf,
    pub index: usize,
}

impl Game {
    pub fn from_block(block: &str, source: &Path, index: usize) -> Game {
        let headers = Headers::parse(block);
        let movetext = block
            .lines()
            .filter(|l| !l.starts_with('['))
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        Game { headers, movetext, source: source.to_path_buf(), index }
    }
    pub fn result(&self) -> &str {
        self.headers.get_or("Result", "*")
    }
    pub fn finished(&self) -> bool {
        is_finished(self.result())
    }
    pub fn white(&self) -> &str {
        self.headers.get_or("White", "")
    }
    pub fn black(&self) -> &str {
        self.headers.get_or("Black", "")
    }
    pub fn end_time(&self) -> &str {
        self.headers.get_or("GameEndTime", "")
    }
    pub fn slot(&self) -> Option<SlotKey> {
        slot_key(&self.headers)
    }
    /// Score of White: 1, 0.5, 0.
    pub fn white_score(&self) -> Option<f64> {
        match self.result() {
            "1-0" => Some(1.0),
            "0-1" => Some(0.0),
            "1/2-1/2" => Some(0.5),
            _ => None,
        }
    }
    pub fn duration_s(&self) -> Option<u64> {
        let d = self.headers.get("GameDuration")?;
        let p: Vec<u64> = d.split(':').filter_map(|x| x.parse().ok()).collect();
        if p.len() == 3 {
            Some(p[0] * 3600 + p[1] * 60 + p[2])
        } else {
            None
        }
    }
    pub fn plies(&self) -> Option<u32> {
        self.headers.get("PlyCount").and_then(|x| x.parse().ok())
    }
}

/// Parses every game of a PGN file.
pub fn read_games(path: &Path) -> std::io::Result<Vec<Game>> {
    let text = read_text(path)?;
    Ok(parse_games(&text, path))
}

pub fn parse_games(text: &str, source: &Path) -> Vec<Game> {
    game_blocks(text)
        .into_iter()
        .enumerate()
        .map(|(i, b)| Game::from_block(b, source, i))
        .collect()
}

/// A game is complete on disk only if its movetext ends with the result.
pub fn block_complete(block: &str) -> bool {
    let h = Headers::parse(block);
    let r = h.get_or("Result", "*");
    r != "*" && block.trim_end().ends_with(r)
}

// ---------------------------------------------------------------- movetext

/// Engine information from a fastchess move comment
/// `{+0.21/20 2.291s, tl=102.709s, n=5716787, sd=39, nps=2506263}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export)]
pub struct MoveInfo {
    pub book: bool,
    /// Evaluation in pawns from the mover's point of view (fastchess convention).
    pub eval: Option<f64>,
    /// Mate distance when the score is `+M5` / `-M3`.
    pub mate: Option<i32>,
    pub depth: Option<u32>,
    pub seldepth: Option<u32>,
    pub time_s: Option<f64>,
    pub time_left_s: Option<f64>,
    pub nodes: Option<u64>,
    pub nps: Option<u64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct PgnMove {
    pub san: String,
    pub info: MoveInfo,
}

pub fn parse_comment(c: &str) -> MoveInfo {
    let mut mi = MoveInfo::default();
    let c = c.trim();
    if c == "book" {
        mi.book = true;
        return mi;
    }
    let mut parts = c.split(',').map(|s| s.trim());
    if let Some(first) = parts.next() {
        // "+0.21/20 2.291s"
        let mut it = first.split_whitespace();
        if let Some(sc) = it.next() {
            if let Some((ev, d)) = sc.split_once('/') {
                mi.depth = d.parse().ok();
                let neg = ev.starts_with('-');
                let body = ev.trim_start_matches(['+', '-']);
                if let Some(m) = body.strip_prefix('M') {
                    mi.mate = m.parse::<i32>().ok().map(|n| if neg { -n } else { n });
                } else {
                    mi.eval = ev.parse().ok();
                }
            } else {
                mi.note = Some(first.to_string());
            }
        }
        if let Some(t) = it.next() {
            mi.time_s = t.trim_end_matches('s').parse().ok();
        }
    }
    for p in parts {
        if let Some((k, v)) = p.split_once('=') {
            match k {
                "tl" => mi.time_left_s = v.trim_end_matches('s').parse().ok(),
                "n" => mi.nodes = v.parse().ok(),
                "sd" => mi.seldepth = v.parse().ok(),
                "nps" => mi.nps = v.parse().ok(),
                _ => {}
            }
        } else if !p.is_empty() {
            mi.note = Some(p.to_string());
        }
    }
    mi
}

/// Splits SAN movetext with `{comments}` into moves.
pub fn parse_movetext(mt: &str) -> Vec<PgnMove> {
    let mut out: Vec<PgnMove> = Vec::new();
    let chars: Vec<char> = mt.chars().collect();
    let mut i = 0;
    let mut tok = String::new();
    let flush = |tok: &mut String, out: &mut Vec<PgnMove>| {
        let t = tok.trim().to_string();
        tok.clear();
        if t.is_empty() || is_finished(&t) || t == "*" {
            return;
        }
        // strip move numbers like "12." or "12..."
        let t = t.trim_start_matches(|c: char| c.is_ascii_digit()).trim_start_matches('.').to_string();
        if t.is_empty() || is_finished(&t) || t == "*" {
            return;
        }
        out.push(PgnMove { san: t, info: MoveInfo::default() });
    };
    while i < chars.len() {
        let c = chars[i];
        if c == '{' {
            flush(&mut tok, &mut out);
            let mut j = i + 1;
            let mut s = String::new();
            while j < chars.len() && chars[j] != '}' {
                s.push(chars[j]);
                j += 1;
            }
            if let Some(last) = out.last_mut() {
                last.info = parse_comment(&s);
            }
            i = j + 1;
            continue;
        }
        if c.is_whitespace() {
            flush(&mut tok, &mut out);
        } else {
            tok.push(c);
        }
        i += 1;
    }
    flush(&mut tok, &mut out);
    out
}

// ---------------------------------------------------------------- incremental index

/// Incrementally indexes finished games of a set of PGN files: only the bytes
/// appended since the last scan are read (never re-reads big files).
#[derive(Default)]
pub struct PgnIndex {
    files: HashMap<PathBuf, FileState>,
}

#[derive(Default)]
struct FileState {
    offset: u64,
    pending: String,
    games: Vec<IndexedGame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedGame {
    pub headers: Headers,
    pub source: PathBuf,
}

impl PgnIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Scans `path` from the last offset. Returns the number of new complete games.
    pub fn scan(&mut self, path: &Path) -> std::io::Result<usize> {
        let st = self.files.entry(path.to_path_buf()).or_default();
        let mut f = match File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e),
        };
        let len = f.metadata()?.len();
        if len < st.offset {
            // truncated / rewritten: start over
            *st = FileState::default();
        }
        f.seek(SeekFrom::Start(st.offset))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        st.offset += buf.len() as u64;
        st.pending.push_str(&normalize_newlines(&String::from_utf8_lossy(&buf)));
        // every block but the last is complete; the last one is complete only if
        // it ends with its result and the file ends with a blank line
        let text = std::mem::take(&mut st.pending);
        let points = split_points(&text);
        let mut added = 0;
        let mut start = 0usize;
        let push = |b: &str, st: &mut FileState| {
            let bt = b.trim_matches('\n');
            if bt.starts_with('[') && block_complete(bt) {
                st.games.push(IndexedGame { headers: Headers::parse(bt), source: path.to_path_buf() });
                1
            } else {
                0
            }
        };
        for (sep, next) in points {
            added += push(&text[start..sep], st);
            start = next;
        }
        let last = &text[start..];
        let rest_start = if text.ends_with("\n\n") && push(last, st) == 1 {
            added += 1;
            text.len()
        } else {
            start
        };
        st.pending = text[rest_start..].to_string();
        Ok(added)
    }

    pub fn scan_dir(&mut self, dir: &Path) -> std::io::Result<usize> {
        let mut n = 0;
        for p in list_pgns(dir) {
            n += self.scan(&p)?;
        }
        Ok(n)
    }

    pub fn games(&self) -> impl Iterator<Item = &IndexedGame> {
        let mut keys: Vec<&PathBuf> = self.files.keys().collect();
        keys.sort();
        keys.into_iter().flat_map(move |k| self.files[k].games.iter())
    }

    pub fn finished_slots(&self) -> std::collections::HashSet<SlotKey> {
        self.games()
            .filter(|g| is_finished(g.headers.get_or("Result", "*")))
            .filter_map(|g| slot_key(&g.headers))
            .collect()
    }
}

/// Sorted list of `*.pgn` files directly inside `dir` (python `sorted(glob)` order).
pub fn list_pgns(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().map(|x| x == "pgn").unwrap_or(false))
            .collect(),
        Err(_) => vec![],
    };
    v.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    v
}

/// Deduplicates finished games by slot, keeping the first by GameEndTime
/// (pitfall 3). Games without a slot are keyed by (Event, Round, White, Black).
/// Returns (kept, dropped duplicates).
pub fn dedupe(games: Vec<Game>) -> (Vec<Game>, Vec<Game>) {
    let key = |g: &Game| -> (String, String, String, String) {
        match g.slot() {
            Some(s) => (format!("{}/{}/{}", s.node, s.pass, s.round), s.white, s.black, String::new()),
            None => (
                g.headers.get_or("Event", "").to_string(),
                g.headers.get_or("Round", "").to_string(),
                g.white().to_string(),
                g.black().to_string(),
            ),
        }
    };
    let mut first: HashMap<(String, String, String, String), (String, usize)> = HashMap::new();
    for (i, g) in games.iter().enumerate() {
        if !g.finished() {
            continue;
        }
        let k = key(g);
        let e = g.end_time().to_string();
        match first.get(&k) {
            Some((best, _)) if *best <= e => {}
            _ => {
                first.insert(k, (e, i));
            }
        }
    }
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for (i, g) in games.into_iter().enumerate() {
        if !g.finished() {
            kept.push(g);
            continue;
        }
        let k = key(&g);
        if first.get(&k).map(|(_, idx)| *idx) == Some(i) {
            kept.push(g);
        } else {
            dropped.push(g);
        }
    }
    (kept, dropped)
}

pub fn slug(name: &str) -> String {
    let re = Regex::new(r"[^A-Za-z0-9.\-]+").unwrap();
    re.replace_all(name, "_").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO: &str = "[Event \"E node0 pass1 r3\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"1-0\"]\n[GameEndTime \"2026-01-01T10:00:00 +0200\"]\n\n1. e4 {book} e5 {+0.21/20 2.291s, tl=102.709s, n=5716787, sd=39, nps=2506263} 1-0\n\n[Event \"E node0 pass1 r3\"]\n[White \"B\"]\n[Black \"A\"]\n[Result \"*\"]\n\n1. d4 *\n\n";

    #[test]
    fn split_like_python() {
        let b = game_blocks(TWO);
        assert_eq!(b.len(), 2);
        assert!(b[0].ends_with("1-0"));
        // blank line with spaces between games still splits
        let t = "[A \"1\"]\n\n1-0\n  \n\n[A \"2\"]\n\n0-1\n";
        assert_eq!(game_blocks(t).len(), 2);
        // no blank line before "[" -> no split
        let t = "[A \"1\"]\n1-0\n[A \"2\"]\n0-1\n";
        assert_eq!(game_blocks(t).len(), 1);
    }

    #[test]
    fn headers_and_slot() {
        let g = &parse_games(TWO, Path::new("x.pgn"))[0];
        assert_eq!(g.white(), "A");
        let s = g.slot().unwrap();
        assert_eq!((s.node, s.pass, s.round), (0, 1, 3));
        let mut h = Headers::default();
        h.set("Event", "CCRL 40/15 gauntlet X node1 pass2");
        h.set("Round", "7");
        assert_eq!(event_slot(&h), Some((1, 2, 7)));
        assert_eq!(event_base("CCRL Blitz gauntlet T 8CPU node0 pass1 r1"), "CCRL Blitz gauntlet T 8CPU");
    }

    #[test]
    fn comments() {
        let mv = parse_movetext("1. e4 {book} e5 {+0.21/20 2.291s, tl=102.709s, n=5716787, sd=39, nps=2506263} 2. Nf3 {-M5/30 0.1s, tl=1s, n=1, sd=2, nps=3} 1-0");
        assert_eq!(mv.len(), 3);
        assert!(mv[0].info.book);
        assert_eq!(mv[1].info.eval, Some(0.21));
        assert_eq!(mv[1].info.depth, Some(20));
        assert_eq!(mv[1].info.nodes, Some(5716787));
        assert_eq!(mv[1].info.time_left_s, Some(102.709));
        assert_eq!(mv[2].info.mate, Some(-5));
    }

    #[test]
    fn incremental_index() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("node0_lane0.pgn");
        let g1 = "[Event \"E node0 pass1 r1\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"1-0\"]\n\n1. e4 1-0\n\n";
        std::fs::write(&p, &g1[..30]).unwrap();
        let mut idx = PgnIndex::new();
        assert_eq!(idx.scan(&p).unwrap(), 0);
        std::fs::write(&p, g1).unwrap();
        assert_eq!(idx.scan(&p).unwrap(), 1);
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        use std::io::Write;
        f.write_all(g1.replace("r1", "r2").as_bytes()).unwrap();
        assert_eq!(idx.scan(&p).unwrap(), 1);
        assert_eq!(idx.finished_slots().len(), 2);
        assert_eq!(idx.scan(&p).unwrap(), 0);
    }

    #[test]
    fn dedupe_keeps_first_by_end_time() {
        let mk = |end: &str, res: &str| {
            format!("[Event \"E node0 pass1 r1\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"{res}\"]\n[GameEndTime \"{end}\"]\n\n1. e4 {res}\n\n")
        };
        let text = format!("{}{}{}", mk("2026-01-01T12:00:00", "0-1"), mk("2026-01-01T11:00:00", "1-0"), mk("2026-01-01T13:00:00", "1/2-1/2"));
        let games = parse_games(&text, Path::new("a.pgn"));
        let (kept, dropped) = dedupe(games);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].result(), "1-0");
        assert_eq!(dropped.len(), 2);
    }
}
