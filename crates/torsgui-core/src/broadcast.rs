//! Live broadcast of the games being played, from the runner (so it works with the GUI
//! closed):
//!
//! - **ccrl.live**: every lane is a TLCS-compatible broadcast on its own UDP port
//!   (`ccrl_live_port + lane`). The viewer of ccrl.live (node-tlcv by Jay Honnold) logs on
//!   with `LOGONv15:<name>`, receives numbered messages (`<n>WMOVE: 12. Nf3`) and
//!   acknowledges each one (`ACK: n`); the message set is the one of Tom's Live Chess
//!   Server (TLCS).
//! - **Lichess**: one broadcast per tournament, rounds of 60 games, games pushed as PGN
//!   (`/api/broadcast/round/{id}/push`) with clocks and evaluations.
//!
//! What to broadcast is chosen per tournament in `broadcast.json` (written by the GUI);
//! the runner writes what happened in `broadcast_state.json` (Lichess ids and links,
//! viewers per lane, errors).

use crate::live::{LiveGame, LiveTracker};
use crate::pgn::Game;
use crate::runner::LaneStatus;
use crate::scheduler::Job;
use crate::store::{Settings, Workspace};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::net::{SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const CONFIG_FILE: &str = "broadcast.json";
pub const STATE_FILE: &str = "broadcast_state.json";
/// Games per Lichess round (a round is a study: at most 64 chapters).
pub const LICHESS_ROUND_GAMES: u32 = 60;

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BroadcastConfig {
    #[serde(default)]
    pub lichess: bool,
    #[serde(default)]
    pub ccrl_live: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LichessRound {
    pub id: String,
    pub url: String,
    pub name: String,
    pub first_board: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LaneCast {
    pub lane: u32,
    pub port: u16,
    /// Connected viewers (address and logon name).
    pub viewers: Vec<String>,
    pub game: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BroadcastState {
    #[serde(default)]
    pub lichess_tour_id: Option<String>,
    #[serde(default)]
    pub lichess_url: Option<String>,
    #[serde(default)]
    pub rounds: Vec<LichessRound>,
    /// Board number of every game broadcast (key: node|pass|round|white|black).
    #[serde(default)]
    pub boards: BTreeMap<String, u32>,
    #[serde(default)]
    pub lichess_pushes: u32,
    #[serde(default)]
    pub lichess_last_push: Option<String>,
    #[serde(default)]
    pub lichess_error: Option<String>,
    #[serde(default)]
    pub lanes: Vec<LaneCast>,
    #[serde(default)]
    pub updated_at: String,
}

pub fn read_config(tdir: &Path) -> BroadcastConfig {
    std::fs::read_to_string(tdir.join(CONFIG_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn write_config(tdir: &Path, c: &BroadcastConfig) -> Result<()> {
    std::fs::create_dir_all(tdir)?;
    std::fs::write(tdir.join(CONFIG_FILE), serde_json::to_string_pretty(c)?)?;
    Ok(())
}

pub fn read_state(tdir: &Path) -> BroadcastState {
    std::fs::read_to_string(tdir.join(STATE_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_state(tdir: &Path, s: &BroadcastState) {
    let tmp = tdir.join(format!("{STATE_FILE}.tmp"));
    if std::fs::write(&tmp, serde_json::to_string_pretty(s).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, tdir.join(STATE_FILE));
    }
}

/// Identity of a game: the slot of the job (same as the PGN slot key).
pub fn job_key(j: &Job) -> String {
    format!("{}|{}|{}|{}|{}", j.node, j.pass, j.round, j.white, j.black)
}

fn game_key(g: &Game) -> Option<String> {
    let s = g.slot()?;
    Some(format!("{}|{}|{}|{}|{}", s.node, s.pass, s.round, s.white, s.black))
}

// ------------------------------------------------------------------ PGN for Lichess

/// Tags shared by the games of a tournament.
#[derive(Debug, Clone, Default)]
pub struct PgnMeta {
    pub event: String,
    pub site: String,
    pub date: String,
    pub chess960: bool,
}

fn clk(ms: u64) -> String {
    let s = ms / 1000;
    format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn headers(meta: &PgnMeta, board: u32, white: &str, black: &str, result: &str, start_fen: &str) -> String {
    let mut h = format!(
        "[Event \"{}\"]\n[Site \"{}\"]\n[Date \"{}\"]\n[Round \"{board}\"]\n[Board \"{board}\"]\n[White \"{}\"]\n[Black \"{}\"]\n[Result \"{result}\"]\n",
        esc(&meta.event),
        esc(&meta.site),
        meta.date,
        esc(white),
        esc(black)
    );
    let standard = start_fen.starts_with("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w");
    if meta.chess960 {
        h.push_str("[Variant \"Chess960\"]\n");
    }
    if !standard || meta.chess960 {
        h.push_str(&format!("[SetUp \"1\"]\n[FEN \"{start_fen}\"]\n"));
    }
    h
}

/// Movetext with move numbers; `notes[i]` is appended to ply i as a comment.
fn movetext(start_fen: &str, sans: &[String], notes: &[String], result: &str) -> String {
    let start = crate::chess960::parse_fen(start_fen).unwrap_or_default();
    let mut num = start.fullmove_number();
    let mut white = start.side_to_move() == cozy_chess::Color::White;
    let mut out = String::new();
    for (i, san) in sans.iter().enumerate() {
        if white {
            out.push_str(&format!("{num}. "));
        } else if i == 0 {
            out.push_str(&format!("{num}... "));
        }
        out.push_str(san);
        if let Some(n) = notes.get(i).filter(|n| !n.is_empty()) {
            out.push_str(&format!(" {{{n}}}"));
        }
        out.push(' ');
        if !white {
            num += 1;
        }
        white = !white;
    }
    out.push_str(result);
    out
}

fn eval_note(cp_white: Option<i32>, mate_white: Option<i32>) -> Option<String> {
    match (mate_white, cp_white) {
        (Some(m), _) => Some(format!("[%eval #{m}]")),
        (None, Some(cp)) => Some(format!("[%eval {:.2}]", cp as f64 / 100.0)),
        _ => None,
    }
}

/// A game in progress (from the engine log of its lane).
pub fn pgn_live(meta: &PgnMeta, board: u32, g: &LiveGame) -> String {
    let n = g.moves_san.len();
    let start_white = !g.start_fen.contains(" b ");
    let mut notes = vec![String::new(); n];
    for e in &g.evals {
        let i = e.ply as usize;
        if i >= 1 && i <= n {
            notes[i - 1] = eval_note(Some(e.cp), None).unwrap_or_default();
        }
    }
    // clocks: the last move of each side carries the clock of the latest `go`
    let white_ply = |i: usize| (i % 2 == 0) == start_white;
    for (side_white, ms) in [(true, g.wtime), (false, g.btime)] {
        if let (Some(ms), Some(i)) = (ms, (0..n).rev().find(|&i| white_ply(i) == side_white)) {
            let c = format!("[%clk {}]", clk(ms));
            notes[i] = if notes[i].is_empty() { c } else { format!("{} {c}", notes[i]) };
        }
    }
    format!("{}\n{}\n", headers(meta, board, &g.white, &g.black, "*", &g.start_fen), movetext(&g.start_fen, &g.moves_san, &notes, "*"))
}

/// A finished game (fastchess PGN): clocks (`tl=`) and evaluations become `%clk` / `%eval`.
pub fn pgn_finished(meta: &PgnMeta, board: u32, g: &Game) -> String {
    let v = crate::live::viewer_game(g);
    let mut sans = Vec::new();
    let mut notes = Vec::new();
    let start_white = !v.start_fen.contains(" b ");
    for (i, p) in v.plies.iter().enumerate() {
        sans.push(p.san.clone());
        let white_moved = (i % 2 == 0) == start_white;
        let mate = p.info.mate.map(|m| if white_moved { m } else { -m });
        let mut n: Vec<String> = Vec::new();
        if !p.info.book {
            if let Some(e) = eval_note(if mate.is_some() { None } else { p.eval_cp }, mate) {
                n.push(e);
            }
        }
        if let Some(t) = p.info.time_left_s {
            n.push(format!("[%clk {}]", clk((t * 1000.0) as u64)));
        }
        notes.push(n.join(" "));
    }
    let result = g.result();
    let white = g.headers.get_or("White", "?");
    let black = g.headers.get_or("Black", "?");
    format!("{}\n{}\n", headers(meta, board, white, black, result, &v.start_fen), movetext(&v.start_fen, &sans, &notes, result))
}

// ------------------------------------------------------------------ Lichess

pub fn lichess_base() -> String {
    std::env::var("TORSGUI_LICHESS_URL").unwrap_or_else(|_| "https://lichess.org".into())
}

fn lichess_call(token: &str, path: &str, form: Option<&[(&str, String)]>, body: Option<&str>) -> Result<serde_json::Value> {
    let url = format!("{}{path}", lichess_base());
    let agent = crate::github::agent(true);
    let auth = format!("Bearer {token}");
    let mut resp = match (form, body) {
        (Some(f), _) => agent.post(&url).header("Authorization", &auth).header("Accept", "application/json").send_form(f.iter().map(|(k, v)| (*k, v.as_str()))),
        (None, Some(b)) => agent.post(&url).header("Authorization", &auth).header("Content-Type", "text/plain").header("Accept", "application/json").send(b),
        (None, None) => agent.get(&url).header("Authorization", &auth).header("Accept", "application/json").call(),
    }
    .map_err(|e| anyhow!("Lichess {path}: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.body_mut().read_to_string().unwrap_or_default();
    if status == 429 {
        bail!("Lichess: too many requests (HTTP 429), waiting");
    }
    if !(200..300).contains(&status) {
        bail!("Lichess {path}: HTTP {status} {}", text.chars().take(300).collect::<String>());
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// The Lichess account of a token (checks the token).
pub fn lichess_account(token: &str) -> Result<String> {
    let v = lichess_call(token, "/api/account", None, None)?;
    v["username"].as_str().map(|s| s.to_string()).context("Lichess: no username in the answer")
}

pub struct LichessSync {
    pushed: HashMap<String, u64>,
    next_try: Instant,
    last_push: Instant,
}

impl Default for LichessSync {
    fn default() -> Self {
        LichessSync { pushed: HashMap::new(), next_try: Instant::now(), last_push: Instant::now() - Duration::from_secs(60) }
    }
}

fn hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

pub struct TourInfo {
    pub name: String,
    pub markdown: String,
}

impl LichessSync {
    /// Creates the broadcast and its rounds when needed and pushes every round whose PGN
    /// changed. `games`: board -> PGN.
    pub fn sync(&mut self, st: &mut BroadcastState, s: &Settings, tour: &TourInfo, games: &BTreeMap<u32, String>, force: bool) {
        if s.lichess_token.trim().is_empty() {
            st.lichess_error = Some("no Lichess token: Settings → Live broadcast".into());
            return;
        }
        if Instant::now() < self.next_try || (!force && self.last_push.elapsed() < Duration::from_secs(4)) {
            return;
        }
        match self.sync_inner(st, s, tour, games) {
            Ok(()) => st.lichess_error = None,
            Err(e) => {
                st.lichess_error = Some(e.to_string());
                self.next_try = Instant::now() + Duration::from_secs(if e.to_string().contains("429") { 90 } else { 30 });
            }
        }
    }

    fn sync_inner(&mut self, st: &mut BroadcastState, s: &Settings, tour: &TourInfo, games: &BTreeMap<u32, String>) -> Result<()> {
        let token = s.lichess_token.trim();
        if games.is_empty() {
            return Ok(());
        }
        if st.lichess_tour_id.is_none() {
            let mut name: String = tour.name.chars().take(80).collect();
            while name.chars().count() < 3 {
                name.push('.');
            }
            let vis = if ["public", "unlisted", "private"].contains(&s.lichess_visibility.as_str()) { s.lichess_visibility.clone() } else { "public".into() };
            let v = lichess_call(token, "/broadcast/new", Some(&[("name", name), ("markdown", tour.markdown.clone()), ("visibility", vis)]), None)?;
            st.lichess_tour_id = Some(v["tour"]["id"].as_str().context("Lichess: no tour id")?.to_string());
            st.lichess_url = v["tour"]["url"].as_str().map(|s| s.to_string());
        }
        let tid = st.lichess_tour_id.clone().unwrap();
        let max_board = *games.keys().max().unwrap();
        let needed = (max_board - 1) / LICHESS_ROUND_GAMES + 1;
        while (st.rounds.len() as u32) < needed {
            let k = st.rounds.len() as u32;
            let (a, b) = (k * LICHESS_ROUND_GAMES + 1, (k + 1) * LICHESS_ROUND_GAMES);
            let name = format!("Games {a}–{b}");
            let v = lichess_call(token, &format!("/broadcast/{tid}/new"), Some(&[("name", name.clone()), ("syncSource", "push".into())]), None)?;
            let id = v["round"]["id"].as_str().context("Lichess: no round id")?.to_string();
            let url = v["round"]["url"].as_str().unwrap_or("").to_string();
            if st.lichess_url.is_none() && !url.is_empty() {
                st.lichess_url = Some(url.clone());
            }
            st.rounds.push(LichessRound { id, url, name, first_board: a });
        }
        for r in st.rounds.clone() {
            let text: Vec<&str> = games.range(r.first_board..r.first_board + LICHESS_ROUND_GAMES).map(|(_, p)| p.as_str()).collect();
            if text.is_empty() {
                continue;
            }
            let body = text.join("\n\n");
            let h = hash(&body);
            if self.pushed.get(&r.id) == Some(&h) {
                continue;
            }
            lichess_call(token, &format!("/api/broadcast/round/{}/push", r.id), None, Some(&body))?;
            self.pushed.insert(r.id.clone(), h);
            self.last_push = Instant::now();
            st.lichess_pushes += 1;
            st.lichess_last_push = Some(crate::store::now());
        }
        Ok(())
    }
}

// ------------------------------------------------------------------ ccrl.live (TLCS)

struct Viewer {
    name: String,
    seq: u32,
    unacked: BTreeMap<u32, (String, Instant, u32)>,
    last_seen: Instant,
}

/// One TLCS-compatible broadcast (one lane) on a UDP port.
pub struct TlcsServer {
    pub port: u16,
    sock: UdpSocket,
    viewers: HashMap<SocketAddr, Viewer>,
    /// Messages of the current game, replayed to viewers who log on.
    history: Vec<String>,
    pv: [Option<String>; 2],
    clock: [Option<String>; 2],
    site: String,
    key: Option<String>,
    sent_moves: usize,
    board: cozy_chess::Board,
    /// Crosstable (`CT:` lines) sent after every game.
    ct: Vec<String>,
}

const RESEND_AFTER: Duration = Duration::from_millis(1500);
const VIEWER_TIMEOUT: Duration = Duration::from_secs(180);

impl TlcsServer {
    pub fn bind(port: u16) -> Result<TlcsServer> {
        let sock = UdpSocket::bind(("0.0.0.0", port)).with_context(|| format!("UDP port {port}"))?;
        sock.set_nonblocking(true)?;
        Ok(TlcsServer {
            port: sock.local_addr()?.port(),
            sock,
            viewers: HashMap::new(),
            history: Vec::new(),
            pv: [None, None],
            clock: [None, None],
            site: String::new(),
            key: None,
            sent_moves: 0,
            board: cozy_chess::Board::default(),
            ct: Vec::new(),
        })
    }

    pub fn viewers(&self) -> Vec<String> {
        self.viewers.iter().map(|(a, v)| format!("{} ({a})", v.name)).collect()
    }

    fn send_to(&mut self, addr: SocketAddr, msg: &str) {
        let Some(v) = self.viewers.get_mut(&addr) else { return };
        v.seq += 1;
        let id = v.seq;
        let _ = self.sock.send_to(format!("<{id}>{msg}").as_bytes(), addr);
        v.unacked.insert(id, (msg.to_string(), Instant::now(), 1));
    }

    fn emit(&mut self, msg: String) {
        let addrs: Vec<SocketAddr> = self.viewers.keys().copied().collect();
        for a in addrs {
            self.send_to(a, &msg);
        }
    }

    /// High-frequency lines (clocks, PVs) go without id, as TLCS sends them.
    fn emit_raw(&self, msg: &str) {
        for a in self.viewers.keys() {
            let _ = self.sock.send_to(msg.as_bytes(), a);
        }
    }

    fn send_crosstable(&mut self, to: Option<SocketAddr>) {
        if self.ct.is_empty() {
            return;
        }
        let lines: Vec<String> = std::iter::once("CTRESET".to_string()).chain(self.ct.iter().map(|l| format!("CT: {l}"))).collect();
        for l in lines {
            match to {
                Some(a) => self.send_to(a, &l),
                None => self.emit(l),
            }
        }
    }

    /// Replaces the crosstable and sends it when it changed.
    pub fn set_crosstable(&mut self, lines: Vec<String>) {
        if lines != self.ct {
            self.ct = lines;
            self.send_crosstable(None);
        }
    }

    /// Reads the viewers' datagrams (logon, ACK, PING), resends what was not acknowledged.
    pub fn poll(&mut self) {
        let mut buf = [0u8; 2048];
        for _ in 0..1000 {
            match self.sock.recv_from(&mut buf) {
                Ok((n, addr)) => {
                    let msg = String::from_utf8_lossy(&buf[..n]).trim().to_string();
                    if let Some(name) = msg.strip_prefix("LOGON") {
                        let name = name.split_once(':').map(|x| x.1).unwrap_or("").trim().to_string();
                        self.viewers.insert(addr, Viewer { name, seq: 0, unacked: BTreeMap::new(), last_seen: Instant::now() });
                        let _ = self.sock.send_to(b"LOGON SUCCESSFUL", addr);
                        for m in self.history.clone() {
                            self.send_to(addr, &m);
                        }
                        for m in self.clock.iter().chain(self.pv.iter()).flatten() {
                            let _ = self.sock.send_to(m.as_bytes(), addr);
                        }
                        self.send_crosstable(Some(addr));
                    } else if let Some(id) = msg.strip_prefix("ACK:") {
                        if let (Some(v), Ok(id)) = (self.viewers.get_mut(&addr), id.trim().parse::<u32>()) {
                            v.unacked.remove(&id);
                            v.last_seen = Instant::now();
                        }
                    } else if msg.starts_with("PING") {
                        if let Some(v) = self.viewers.get_mut(&addr) {
                            v.last_seen = Instant::now();
                        }
                        if self.viewers.contains_key(&addr) {
                            self.send_to(addr, "PONG");
                        } else {
                            let _ = self.sock.send_to(b"PONG", addr);
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                // Windows reports a viewer that went away (ICMP port unreachable) as an
                // error on the next read: skip it and keep reading
                Err(_) => continue,
            }
        }
        let now = Instant::now();
        self.viewers.retain(|_, v| now.duration_since(v.last_seen) < VIEWER_TIMEOUT);
        for (addr, v) in self.viewers.iter_mut() {
            v.unacked.retain(|_, (_, _, tries)| *tries <= 5);
            for (id, (msg, at, tries)) in v.unacked.iter_mut() {
                if now.duration_since(*at) >= RESEND_AFTER {
                    let _ = self.sock.send_to(format!("<{id}>{msg}").as_bytes(), *addr);
                    *at = now;
                    *tries += 1;
                }
            }
        }
    }

    fn structural(&mut self, msg: String) {
        self.history.push(msg.clone());
        self.emit(msg);
    }

    /// The game of the lane changed or ended: `result` of the previous game when known.
    pub fn end_game(&mut self, result: Option<&str>) {
        if self.key.is_some() {
            if let Some(r) = result {
                // node-tlcv knows this command in lower case
                self.structural(format!("result: {r}"));
            }
        }
        self.key = None;
    }

    /// Sends what changed in the game of the lane.
    pub fn update(&mut self, key: &str, site: &str, g: &LiveGame) {
        if self.key.as_deref() != Some(key) {
            self.key = Some(key.to_string());
            self.history.clear();
            self.pv = [None, None];
            self.clock = [None, None];
            self.sent_moves = 0;
            self.site = site.to_string();
            self.board = crate::chess960::parse_fen(&g.start_fen).unwrap_or_default();
            let fen: Vec<&str> = g.start_fen.split_whitespace().take(3).collect();
            for m in [format!("SITE: {site}"), format!("WPLAYER: {}", g.white), format!("BPLAYER: {}", g.black), format!("FEN: {}", fen.join(" "))] {
                self.structural(m);
            }
        }
        let start = crate::chess960::parse_fen(&g.start_fen).unwrap_or_default();
        let start_white = start.side_to_move() == cozy_chess::Color::White;
        let first = start.fullmove_number() as usize;
        for i in self.sent_moves..g.moves_san.len() {
            let white = (i % 2 == 0) == start_white;
            let num = first + (i + usize::from(!start_white)) / 2;
            // the evaluation of this move (from the log), as the mover's PV line
            if let Some(e) = g.evals.iter().find(|e| e.ply as usize == i + 1) {
                let cp = if white { e.cp } else { -e.cp };
                let pv = format!("{}PV: {} {} {} 0 {}", if white { 'W' } else { 'B' }, e.depth.unwrap_or(0), cp, e.time_ms / 10, g.moves_san[i]);
                self.structural(pv);
            }
            // TLCS order: FEN after the move (a backup for the viewer), the move, the 50-move counter
            if let Ok(mv) = cozy_chess::util::parse_san_move(&self.board, &g.moves_san[i]) {
                if self.board.try_play(mv).is_ok() {
                    let fen = self.board.to_string();
                    let f: Vec<&str> = fen.split_whitespace().take(3).collect();
                    self.structural(format!("FEN: {}", f.join(" ")));
                }
            }
            self.structural(format!("{}MOVE: {num}. {}", if white { 'W' } else { 'B' }, g.moves_san[i]));
            self.structural(format!("FMR: {}", self.board.halfmove_clock()));
            self.pv[usize::from(!white)] = None;
        }
        self.sent_moves = g.moves_san.len();
        // the engine thinking now
        if let Some(name) = &g.thinking {
            if let Some(e) = g.engines.iter().find(|e| &e.name == name) {
                let white = name == &g.white;
                let score = match (e.score_cp, e.mate) {
                    (Some(cp), _) => cp,
                    (None, Some(m)) => if m > 0 { 32000 - m } else { -32000 - m },
                    _ => 0,
                };
                if e.depth.is_some() && !e.pv_san.is_empty() {
                    let m = format!("{}PV: {} {} {} {} {}", if white { 'W' } else { 'B' }, e.depth.unwrap_or(0), score, e.time_ms.unwrap_or(0) / 10, e.nodes.unwrap_or(0), e.pv_san.join(" "));
                    let slot = usize::from(!white);
                    if self.pv[slot].as_deref() != Some(m.as_str()) {
                        self.emit_raw(&m);
                        self.pv[slot] = Some(m);
                    }
                }
            }
        }
        for (slot, ms, tag) in [(0usize, g.wtime, "WTIME"), (1, g.btime, "BTIME")] {
            if let Some(ms) = ms {
                let m = format!("{tag}: {}", ms / 10);
                if self.clock[slot].as_deref() != Some(m.as_str()) {
                    self.emit_raw(&m);
                    self.clock[slot] = Some(m);
                }
            }
        }
    }
}

/// The crosstable in the layout of the TLCS dump that ccrl.live parses: standings
/// (`RANK ... GAMES POINTS` and head-to-head columns), `Total games = N`, then the games,
/// most recent first. `names`: the engines in tournament order; `games`: chronological.
pub fn crosstable(names: &[String], games: &[(String, String, String)]) -> Vec<String> {
    let idx = |n: &str| names.iter().position(|x| x == n);
    let k = names.len();
    let mut pts = vec![0.0f64; k];
    let mut played = vec![0u32; k];
    let mut h2h = vec![vec![String::new(); k]; k];
    for (w, b, r) in games {
        let (Some(wi), Some(bi)) = (idx(w), idx(b)) else { continue };
        let (ws, bs, wc, bc) = match r.as_str() {
            "1-0" => (1.0, 0.0, '1', '0'),
            "0-1" => (0.0, 1.0, '0', '1'),
            "1/2-1/2" => (0.5, 0.5, '=', '='),
            _ => continue,
        };
        pts[wi] += ws;
        pts[bi] += bs;
        played[wi] += 1;
        played[bi] += 1;
        h2h[wi][bi].push(wc);
        h2h[bi][wi].push(bc);
    }
    let mut order: Vec<usize> = (0..k).collect();
    order.sort_by(|a, b| pts[*b].total_cmp(&pts[*a]).then(played[*a].cmp(&played[*b])));
    let name_w = names.iter().map(|n| n.chars().count()).max().unwrap_or(6).max(6) + 2;
    let cell_w = h2h.iter().flatten().map(|c| c.len()).max().unwrap_or(1).max(2) + 2;
    let mut out = Vec::new();
    let mut head = format!("{:<5}{:<name_w$}{:<8}{:<8}", "RANK", "ENGINE", "GAMES", "POINTS");
    for c in 1..=k {
        head.push_str(&format!("{c:<cell_w$}"));
    }
    out.push(head.trim_end().to_string());
    for (rank, &i) in order.iter().enumerate() {
        let mut row = format!("{:<5}{:<name_w$}{:<8}{:<8}", format!("{}.", rank + 1), names[i], played[i], format!("{:.1}", pts[i]));
        for &j in &order {
            let cell = if i == j { "**".to_string() } else if h2h[i][j].is_empty() { ".".to_string() } else { h2h[i][j].clone() };
            row.push_str(&format!("{cell:<cell_w$}"));
        }
        out.push(row.trim_end().to_string());
    }
    out.push(String::new());
    out.push(format!("Total games = {}", games.len()));
    out.push(String::new());
    let gw = name_w.max(8);
    out.push(format!("Game No.   {:<gw$}   {:<gw$}   Result", "White", "Black"));
    for (n, (w, b, r)) in games.iter().enumerate().rev().take(300) {
        out.push(format!("{:<8}   {w:<gw$}   {b:<gw$}   {r}", n + 1));
    }
    out
}

// ------------------------------------------------------------------ the runner's thread

/// Runs the broadcast of a tournament while its runner is alive.
pub struct Caster {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl Caster {
    pub fn start(ws: Workspace, id: String) -> Caster {
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        let handle = std::thread::Builder::new().name("broadcast".into()).spawn(move || caster_loop(&ws, &id, &s2)).ok();
        Caster { stop, handle }
    }
}

impl Drop for Caster {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

struct FinishedCache {
    sizes: HashMap<PathBuf, u64>,
    games: HashMap<String, Game>,
}

impl FinishedCache {
    fn refresh(&mut self, files: &[PathBuf]) {
        for f in files {
            let len = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
            if self.sizes.get(f) == Some(&len) {
                continue;
            }
            self.sizes.insert(f.clone(), len);
            for g in crate::pgn::read_games(f).unwrap_or_default() {
                if !g.finished() {
                    continue;
                }
                if let Some(k) = game_key(&g) {
                    self.games.insert(k, g);
                }
            }
        }
    }
}

fn caster_loop(ws: &Workspace, id: &str, stop: &AtomicBool) {
    let tdir = ws.tournament_dir(id);
    let mut st = read_state(&tdir);
    let mut lichess = LichessSync::default();
    let mut servers: HashMap<u32, TlcsServer> = HashMap::new();
    let mut bind_errors: HashMap<u32, String> = HashMap::new();
    let mut trackers: HashMap<String, LiveTracker> = HashMap::new();
    let mut finished = FinishedCache { sizes: HashMap::new(), games: HashMap::new() };
    let mut last_write = Instant::now() - Duration::from_secs(10);
    let mut port_base = 0u16;
    let mut ct: Vec<String> = Vec::new();
    let mut ct_games = usize::MAX;
    loop {
        let stopping = stop.load(Ordering::SeqCst);
        let cfg = read_config(&tdir);
        if !cfg.lichess && !cfg.ccrl_live {
            servers.clear();
            if stopping {
                return;
            }
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        let Ok(store) = ws.open() else {
            std::thread::sleep(Duration::from_secs(2));
            continue;
        };
        let settings = store.settings().unwrap_or_default();
        let Ok(Some(rec)) = store.tournament(id) else {
            std::thread::sleep(Duration::from_secs(2));
            continue;
        };
        drop(store);
        let lanes: Vec<LaneStatus> = rec.status.as_ref().and_then(|s| serde_json::from_value(s["lanes"].clone()).ok()).unwrap_or_default();
        finished.refresh(&crate::runner::pgn_sources(ws, id));
        // live games
        let mut live: Vec<(u32, String, LiveGame)> = Vec::new();
        let mut keep = std::collections::HashSet::new();
        for (i, l) in lanes.iter().enumerate() {
            if let (true, Some(f), Some(j)) = (l.busy, &l.log_file, &l.job) {
                keep.insert(f.clone());
                let tr = trackers.entry(f.clone()).or_insert_with(|| LiveTracker::new(Path::new(f), &j.white, &j.black));
                let g = tr.update().clone();
                let key = job_key(j);
                if !st.boards.contains_key(&key) {
                    let n = st.boards.len() as u32 + 1;
                    st.boards.insert(key.clone(), n);
                }
                live.push((i as u32, key, g));
            }
        }
        trackers.retain(|k, _| keep.contains(k));
        let site = if settings.site.trim().is_empty() { settings.tester_name.clone() } else { format!("{} ({})", settings.site, settings.tester_name) };

        // ccrl.live
        if cfg.ccrl_live {
            if port_base != settings.ccrl_live_port {
                servers.clear();
                bind_errors.clear();
                port_base = settings.ccrl_live_port;
            }
            for i in 0..lanes.len() as u32 {
                if !servers.contains_key(&i) && !bind_errors.contains_key(&i) {
                    match TlcsServer::bind(port_base.saturating_add(i as u16)) {
                        Ok(s) => {
                            servers.insert(i, s);
                        }
                        Err(e) => {
                            bind_errors.insert(i, format!("{e:#}"));
                        }
                    }
                }
            }
            let event_site = format!("{} - {}", rec.config.event, site);
            if finished.games.len() != ct_games {
                ct_games = finished.games.len();
                let mut gs: Vec<&Game> = finished.games.values().collect();
                gs.sort_by(|a, b| a.headers.get_or("GameEndTime", "").cmp(b.headers.get_or("GameEndTime", "")));
                let names: Vec<String> = rec.config.participants.iter().map(|p| p.name.clone()).collect();
                let rows: Vec<(String, String, String)> = gs.iter().map(|g| (g.headers.get_or("White", "?").to_string(), g.headers.get_or("Black", "?").to_string(), g.result().to_string())).collect();
                ct = crosstable(&names, &rows);
            }
            for (i, srv) in servers.iter_mut() {
                srv.poll();
                match live.iter().find(|(l, _, _)| l == i) {
                    Some((_, key, g)) => {
                        if srv.key.as_deref().is_some_and(|k| k != key) {
                            let prev = srv.key.clone().unwrap_or_default();
                            srv.end_game(finished.games.get(&prev).map(|g| g.result()));
                        }
                        srv.update(key, &event_site, g);
                        srv.set_crosstable(ct.clone());
                    }
                    None => {
                        if let Some(prev) = srv.key.clone() {
                            if let Some(g) = finished.games.get(&prev) {
                                srv.end_game(Some(g.result()));
                            }
                        }
                        srv.set_crosstable(ct.clone());
                    }
                }
            }
        } else {
            servers.clear();
            bind_errors.clear();
        }

        // Lichess
        if cfg.lichess {
            let meta = PgnMeta {
                event: rec.config.event.clone(),
                site: site.clone(),
                date: chrono::Local::now().format("%Y.%m.%d").to_string(),
                chess960: rec.config.variant == crate::model::Variant::Chess960,
            };
            let mut games: BTreeMap<u32, String> = BTreeMap::new();
            for (k, n) in &st.boards {
                if let Some(g) = finished.games.get(k) {
                    games.insert(*n, pgn_finished(&meta, *n, g));
                }
            }
            for (_, key, g) in &live {
                if let Some(n) = st.boards.get(key) {
                    if !games.contains_key(n) {
                        games.insert(*n, pgn_live(&meta, *n, g));
                    }
                }
            }
            let tour = TourInfo { name: rec.config.event.clone(), markdown: tour_markdown(&rec.config, &settings) };
            lichess.sync(&mut st, &settings, &tour, &games, stopping);
        }

        if stopping || last_write.elapsed() >= Duration::from_secs(2) {
            last_write = Instant::now();
            st.lanes = (0..lanes.len() as u32)
                .map(|i| LaneCast {
                    lane: i,
                    port: port_base.saturating_add(i as u16),
                    viewers: servers.get(&i).map(|s| s.viewers()).unwrap_or_default(),
                    game: live.iter().find(|(l, _, _)| *l == i).map(|(_, _, g)| format!("{} - {}", g.white, g.black)),
                    error: if cfg.ccrl_live { bind_errors.get(&i).cloned() } else { None },
                })
                .collect();
            st.updated_at = crate::store::now();
            write_state(&tdir, &st);
        }
        if stopping {
            return;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn tour_markdown(c: &crate::model::TournamentConfig, s: &Settings) -> String {
    let engines: Vec<String> = c.participants.iter().map(|p| p.name.clone()).collect();
    format!(
        "{} by **{}**{}.\n\nTime control {} · {} thread(s) · hash {} MB · book {} · {} games per pairing.\n\nEngines: {}.\n\nBroadcast live by [TorsGUI](https://github.com/Tors3/TorsGUI-CCRL).",
        c.event,
        if s.tester_name.is_empty() { "a CCRL tester" } else { s.tester_name.as_str() },
        if s.site.is_empty() { String::new() } else { format!(" ({})", s.site) },
        c.tc,
        c.threads,
        c.hash_mb,
        Path::new(&c.book).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        c.games_per_pairing,
        engines.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_game() -> LiveGame {
        LiveGame {
            white: "Alpha 1.0".into(),
            black: "Bravo 2.1".into(),
            start_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            moves_san: vec!["e4".into(), "e5".into(), "Nf3".into()],
            wtime: Some(61_500),
            btime: Some(59_000),
            evals: vec![crate::live::EvalPoint { ply: 3, cp: 25, engine: "Alpha 1.0".into(), time_ms: 1200, depth: Some(18) }],
            thinking: Some("Bravo 2.1".into()),
            engines: vec![crate::live::EngineLive { name: "Bravo 2.1".into(), depth: Some(12), score_cp: Some(-20), nodes: Some(123456), time_ms: Some(800), pv_san: vec!["Nc6".into(), "Bb5".into()], ..Default::default() }],
            ..Default::default()
        }
    }

    #[test]
    fn live_pgn_has_clocks_and_evals() {
        let meta = PgnMeta { event: "CCRL Blitz gauntlet Alpha 1.0 1CPU".into(), site: "Milan (Tester)".into(), date: "2026.10.01".into(), chess960: false };
        let p = pgn_live(&meta, 7, &live_game());
        assert!(p.contains("[Round \"7\"]") && p.contains("[White \"Alpha 1.0\"]") && p.contains("[Result \"*\"]"), "{p}");
        assert!(!p.contains("[FEN"));
        assert!(p.contains("1. e4 e5 {[%clk 0:00:59]} 2. Nf3 {[%eval 0.25] [%clk 0:01:01]} *"), "{p}");
    }

    #[test]
    fn finished_pgn_from_fastchess() {
        let text = "[Event \"CCRL x node0 pass1 r1\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"0-1\"]\n\n1. e4 {book} e5 {book} 2. Qh5 {+0.30/20 1.0s, tl=9.5s} Nc6 {-0.10/18 1s, tl=58.2s} 3. Bc4 {+M3/10 0.1s, tl=9.0s} 0-1\n\n";
        let g = &crate::pgn::parse_games(text, Path::new("x"))[0];
        let meta = PgnMeta { event: "E".into(), site: "S".into(), date: "2026.10.01".into(), chess960: false };
        let p = pgn_finished(&meta, 3, g);
        assert!(p.contains("[Result \"0-1\"]"));
        assert!(p.contains("1. e4 e5 2. Qh5 {[%eval 0.30] [%clk 0:00:09]} Nc6 {[%eval 0.10] [%clk 0:00:58]} 3. Bc4 {[%eval #3] [%clk 0:00:09]} 0-1"), "{p}");
    }

    #[test]
    fn chess960_pgn_has_variant_and_fen() {
        let mut g = live_game();
        g.start_fen = crate::chess960::start_fen(0, 0);
        g.moves_san = vec!["d4".into()];
        let meta = PgnMeta { chess960: true, ..Default::default() };
        let p = pgn_live(&meta, 1, &g);
        assert!(p.contains("[Variant \"Chess960\"]") && p.contains("[SetUp \"1\"]") && p.contains("[FEN \"bbqnnrkr/"), "{p}");
    }

    fn recv(c: &UdpSocket) -> Vec<String> {
        let mut out = Vec::new();
        let mut buf = [0u8; 2048];
        c.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
        while let Ok((n, _)) = c.recv_from(&mut buf) {
            out.push(String::from_utf8_lossy(&buf[..n]).to_string());
        }
        out
    }

    #[test]
    fn tlcs_logon_snapshot_ack_and_resend() {
        let mut srv = TlcsServer::bind(0).unwrap();
        let addr = format!("127.0.0.1:{}", srv.port);
        let mut g = live_game();
        srv.update("k1", "CCRL Blitz gauntlet - Milan", &g);
        // a viewer logs on like node-tlcv and gets the whole game so far
        let c = UdpSocket::bind("127.0.0.1:0").unwrap();
        c.send_to(b"LOGONv15:ccrl.live", &addr).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        srv.poll();
        let got = recv(&c);
        let text: Vec<&str> = got.iter().map(|m| if m.starts_with('<') { m.split_once('>').unwrap().1 } else { m.as_str() }).collect();
        assert_eq!(text[0], "LOGON SUCCESSFUL");
        assert_eq!(&text[1..5], &["SITE: CCRL Blitz gauntlet - Milan", "WPLAYER: Alpha 1.0", "BPLAYER: Bravo 2.1", "FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq"]);
        // TLCS order for every move: FEN after it, the move, the 50-move counter
        let i = text.iter().position(|t| *t == "WMOVE: 1. e4").unwrap();
        assert_eq!(&text[i - 1..=i + 1], &["FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq", "WMOVE: 1. e4", "FMR: 0"]);
        assert!(text.contains(&"BMOVE: 1. e5") && text.contains(&"WMOVE: 2. Nf3") && text.contains(&"FMR: 1"), "{text:?}");
        assert!(text.contains(&"WPV: 18 25 120 0 Nf3"), "{text:?}");
        // clocks and the live PV go without id, as in TLCS
        assert!(got.iter().any(|m| m == "BPV: 12 -20 80 123456 Nc6 Bb5"), "{got:?}");
        assert!(got.iter().any(|m| m == "WTIME: 6150") && got.iter().any(|m| m == "BTIME: 5900"), "{got:?}");
        let wrapped: Vec<&String> = got.iter().filter(|m| m.starts_with('<')).collect();
        assert!(wrapped[0].starts_with("<1>"));
        // acknowledge everything but the last numbered message: only that one is sent again
        for m in &wrapped[..wrapped.len() - 1] {
            let id = m[1..].split('>').next().unwrap();
            c.send_to(format!("ACK: {id}").as_bytes(), &addr).unwrap();
        }
        std::thread::sleep(Duration::from_millis(1600));
        srv.poll();
        let again = recv(&c);
        assert_eq!(again, vec![wrapped.last().unwrap().to_string()]);
        // a new move, the crosstable, then the game ends
        g.moves_san.push("Nc6".into());
        g.thinking = None;
        srv.update("k1", "x", &g);
        let m = recv(&c);
        assert!(m.iter().any(|x| x.ends_with("BMOVE: 2. Nc6")), "{m:?}");
        srv.set_crosstable(vec!["RANK ENGINE".into()]);
        let m = recv(&c);
        assert!(m.iter().any(|x| x.ends_with(">CTRESET")) && m.iter().any(|x| x.ends_with(">CT: RANK ENGINE")), "{m:?}");
        srv.end_game(Some("1-0"));
        assert!(recv(&c).iter().any(|x| x.ends_with(">result: 1-0")));
        // PING -> PONG
        c.send_to(b"PING", &addr).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        srv.poll();
        assert!(recv(&c).iter().any(|x| x.ends_with(">PONG")));
        assert_eq!(srv.viewers().len(), 1);
    }

    #[test]
    fn crosstable_in_the_tlcs_layout() {
        let names = vec!["Seed 1.0 64-bit".to_string(), "Opp A 2.0".to_string(), "Opp B 3.1".to_string()];
        let g = |w: &str, b: &str, r: &str| (w.to_string(), b.to_string(), r.to_string());
        let games = vec![g("Seed 1.0 64-bit", "Opp A 2.0", "1-0"), g("Opp A 2.0", "Seed 1.0 64-bit", "1/2-1/2"), g("Seed 1.0 64-bit", "Opp B 3.1", "0-1")];
        let ct = crosstable(&names, &games);
        let text = ct.join("\n");
        if let Ok(f) = std::env::var("TORSGUI_CT_SAMPLE") {
            std::fs::write(f, &text).unwrap();
        }
        assert!(ct[0].starts_with("RANK ENGINE") && ct[0].contains("GAMES") && ct[0].contains("POINTS"), "{text}");
        // as node-tlcv reads it: rank, name, games, points and head-to-head cells
        assert!(ct[1].starts_with("1.   Seed 1.0 64-bit"), "{text}");
        assert!(ct[1].contains("3       1.5") && ct[1].contains("**") && ct[1].contains("1=") && ct[1].contains(" 0"), "{text}");
        assert!(ct.iter().any(|l| l == "Total games = 3"));
        let last = ct.last().unwrap();
        assert!(last.starts_with("1 ") && last.ends_with("   1-0") && last.contains("Opp A 2.0"), "{text}");
        assert!(ct[ct.len() - 3].starts_with("3 ") && ct[ct.len() - 3].ends_with("0-1"), "{text}");
    }

    /// A tiny HTTP server answering like Lichess (create broadcast, round, push).
    fn mock_lichess() -> (String, Arc<std::sync::Mutex<Vec<(String, String)>>>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log2 = log.clone();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let mut s = s.unwrap();
                let mut buf = Vec::new();
                let mut tmp = [0u8; 65536];
                let (head, body) = loop {
                    let n = s.read(&mut tmp).unwrap();
                    buf.extend_from_slice(&tmp[..n]);
                    let t = String::from_utf8_lossy(&buf).to_string();
                    if let Some((h, b)) = t.split_once("\r\n\r\n") {
                        let len: usize = h.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap_or(0);
                        if b.len() >= len {
                            break (h.to_string(), b.to_string());
                        }
                    }
                    if n == 0 {
                        break (t, String::new());
                    }
                };
                let path = head.split_whitespace().nth(1).unwrap().to_string();
                assert!(head.contains("Bearer lip_test"), "{head}");
                log2.lock().unwrap().push((path.clone(), body));
                let reply = if path == "/broadcast/new" {
                    r#"{"tour":{"id":"T1","url":"https://lichess.org/broadcast/t/T1"}}"#.to_string()
                } else if path.ends_with("/new") {
                    let n = log2.lock().unwrap().iter().filter(|(p, _)| p.ends_with("/new") && p != "/broadcast/new").count();
                    format!(r#"{{"round":{{"id":"R{n}","url":"https://lichess.org/broadcast/t/r/R{n}"}}}}"#)
                } else if path == "/api/account" {
                    r#"{"username":"Tors3"}"#.to_string()
                } else {
                    r#"{"games":[]}"#.to_string()
                };
                let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        (base, log)
    }

    #[test]
    fn lichess_creates_once_and_pushes_changes() {
        let (base, log) = mock_lichess();
        // SAFETY: the only test reading this variable
        unsafe { std::env::set_var("TORSGUI_LICHESS_URL", &base) };
        assert_eq!(lichess_account("lip_test").unwrap(), "Tors3");
        let s = Settings { lichess_token: "lip_test".into(), lichess_visibility: "unlisted".into(), ..Default::default() };
        let mut st = BroadcastState::default();
        let mut sync = LichessSync::default();
        let tour = TourInfo { name: "CCRL Blitz gauntlet Alpha 1.0 1CPU".into(), markdown: "m".into() };
        let meta = PgnMeta::default();
        let mut games = BTreeMap::from([(1u32, pgn_live(&meta, 1, &live_game()))]);
        sync.sync(&mut st, &s, &tour, &games, true);
        assert_eq!(st.lichess_error, None);
        assert_eq!(st.lichess_tour_id.as_deref(), Some("T1"));
        assert_eq!(st.rounds.len(), 1);
        assert_eq!(st.rounds[0].name, "Games 1–60");
        assert_eq!(st.lichess_pushes, 1);
        // unchanged: nothing pushed; changed: one push, no new broadcast
        sync.sync(&mut st, &s, &tour, &games, true);
        assert_eq!(st.lichess_pushes, 1);
        games.insert(2, pgn_live(&meta, 2, &live_game()));
        sync.sync(&mut st, &s, &tour, &games, true);
        assert_eq!(st.lichess_pushes, 2);
        // board 61 opens the second round
        games.insert(61, pgn_live(&meta, 61, &live_game()));
        sync.sync(&mut st, &s, &tour, &games, true);
        assert_eq!(st.rounds.len(), 2);
        assert_eq!(st.rounds[1].first_board, 61);
        let log = log.lock().unwrap();
        let paths: Vec<&str> = log.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(paths.iter().filter(|p| **p == "/broadcast/new").count(), 1);
        assert!(log.iter().any(|(p, b)| p == "/broadcast/new" && b.contains("visibility=unlisted") && b.contains("name=CCRL+Blitz")));
        let push = log.iter().filter(|(p, _)| p == "/api/broadcast/round/R1/push").last().unwrap();
        assert!(push.1.contains("[Round \"1\"]") && push.1.contains("[Round \"2\"]") && !push.1.contains("[Round \"61\"]"));
    }
}
