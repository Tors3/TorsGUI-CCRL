//! SQLite persistence (WAL mode so the GUI and the runners can share it).
//! PGN files stay the source of truth for finished games; the database holds
//! configuration, state, the engine library, CCRL lists and history.

use crate::model::TournamentConfig;
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string()
}

pub fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Workspace layout: `<root>/torsgui.db`, `<root>/tournaments/<id>/...`.
#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
}

impl Workspace {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Workspace { root: root.into() }
    }
    /// `TORSGUI_HOME` or the platform data directory.
    pub fn default_root() -> PathBuf {
        if let Ok(h) = std::env::var("TORSGUI_HOME") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("TorsGUI")
    }
    pub fn db_path(&self) -> PathBuf {
        self.root.join("torsgui.db")
    }
    pub fn tournament_dir(&self, id: &str) -> PathBuf {
        self.root.join("tournaments").join(id)
    }
    pub fn pgn_dir(&self, id: &str) -> PathBuf {
        self.tournament_dir(id).join("pgn")
    }
    pub fn logs_dir(&self, id: &str) -> PathBuf {
        self.tournament_dir(id).join("logs")
    }
    pub fn tools_dir(&self) -> PathBuf {
        self.root.join("tools")
    }
    pub fn open(&self) -> Result<Store> {
        std::fs::create_dir_all(&self.root)?;
        Store::open(&self.db_path())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Settings {
    pub tester_name: String,
    pub site: String,
    pub engines_dir: String,
    pub books_dir: String,
    pub tablebases_dir: String,
    pub output_dir: String,
    pub default_book: String,
    pub syzygy_path: String,
    pub fastchess_version: String,
    /// Empty = the managed download in `<workspace>/tools/fastchess`.
    pub fastchess_path: String,
    pub hash_per_thread_mb: u32,
    pub adjudication: crate::model::Adjudication,
    pub theme: String,
    /// Windows: launch runners through a Task Scheduler task.
    pub use_task_scheduler: bool,
    /// Resume tournaments that were running when the machine went down.
    pub auto_resume: bool,
    pub tc_base_formula: String,
    pub tc_inc_formula: String,
    pub default_factor: f64,
    /// Default rating gap 8CPU - 1CPU when an engine has no own history.
    pub default_cpu_gap: f64,
    pub github_token: String,
    pub git_sync_dir: String,
    pub post_template_finished: String,
    pub post_template_announcement: String,
    pub post_template_progress: String,
    pub log_retention_days: u32,
}

impl Default for Settings {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        let ccrl = home.join("CCRL");
        let s = |p: PathBuf| p.to_string_lossy().to_string();
        Settings {
            tester_name: String::new(),
            site: String::new(),
            engines_dir: s(ccrl.join("engines")),
            books_dir: s(ccrl.join("books")),
            tablebases_dir: s(ccrl.join("tb")),
            output_dir: s(ccrl.join("results")),
            default_book: String::new(),
            syzygy_path: String::new(),
            fastchess_version: crate::fastchess::PINNED_VERSION.into(),
            fastchess_path: String::new(),
            hash_per_thread_mb: 512,
            adjudication: Default::default(),
            theme: "dark".into(),
            use_task_scheduler: false,
            auto_resume: true,
            tc_base_formula: crate::tc::DEFAULT_BASE_FORMULA.into(),
            tc_inc_formula: crate::tc::DEFAULT_INC_FORMULA.into(),
            default_factor: 1.0,
            default_cpu_gap: 32.0,
            github_token: String::new(),
            git_sync_dir: String::new(),
            post_template_finished: crate::forum::TEMPLATE_FINISHED.into(),
            post_template_announcement: crate::forum::TEMPLATE_ANNOUNCEMENT.into(),
            post_template_progress: crate::forum::TEMPLATE_PROGRESS.into(),
            log_retention_days: 30,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TState {
    Draft,
    Queued,
    Running,
    Paused,
    Stopped,
    /// All expected games present, ended cleanly.
    Completed,
    /// Ended cleanly with games missing after the allowed retries.
    Incomplete,
    Failed,
}

impl TState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TState::Draft => "draft",
            TState::Queued => "queued",
            TState::Running => "running",
            TState::Paused => "paused",
            TState::Stopped => "stopped",
            TState::Completed => "completed",
            TState::Incomplete => "incomplete",
            TState::Failed => "failed",
        }
    }
    pub fn parse(s: &str) -> TState {
        match s {
            "queued" => TState::Queued,
            "running" => TState::Running,
            "paused" => TState::Paused,
            "stopped" => TState::Stopped,
            "completed" => TState::Completed,
            "incomplete" => TState::Incomplete,
            "failed" => TState::Failed,
            _ => TState::Draft,
        }
    }
}

/// What the user asked the runner to do (polled by the runner).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Desired {
    Run,
    Pause,
    Stop,
}

impl Desired {
    pub fn as_str(&self) -> &'static str {
        match self {
            Desired::Run => "run",
            Desired::Pause => "pause",
            Desired::Stop => "stop",
        }
    }
    pub fn parse(s: &str) -> Desired {
        match s {
            "pause" => Desired::Pause,
            "stop" => Desired::Stop,
            _ => Desired::Run,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct TournamentRecord {
    pub id: String,
    pub name: String,
    pub state: TState,
    pub desired: Desired,
    pub config: TournamentConfig,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// Position in the queue (lower first), None when not queued.
    pub queue_pos: Option<i64>,
    pub retries: u32,
    pub runner_pid: Option<u32>,
    /// Unix timestamp of the last runner heartbeat.
    pub heartbeat: Option<i64>,
    pub expected_games: u32,
    pub done_games: u32,
    pub last_error: Option<String>,
    pub imported: bool,
    /// Extra PGN sources (imported legacy tournaments).
    pub status: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct EventRecord {
    pub seq: i64,
    pub ts: String,
    /// info | warn | error | success
    pub level: String,
    pub kind: String,
    pub tournament_id: Option<String>,
    pub message: String,
}

pub struct Store {
    pub conn: Connection,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS engines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aliases (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user'
);
CREATE TABLE IF NOT EXISTS ccrl_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list TEXT NOT NULL,
  cpu TEXT NOT NULL,
  variant TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(list, cpu, variant)
);
CREATE TABLE IF NOT EXISTS ccrl_entries (
  list_id INTEGER NOT NULL REFERENCES ccrl_lists(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  name TEXT NOT NULL,
  rating REAL NOT NULL,
  err_plus REAL,
  err_minus REAL,
  games INTEGER,
  score REAL
);
CREATE INDEX IF NOT EXISTS ccrl_entries_list ON ccrl_entries(list_id);
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  desired TEXT NOT NULL DEFAULT 'run',
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  queue_pos INTEGER,
  retries INTEGER NOT NULL DEFAULT 0,
  runner_pid INTEGER,
  heartbeat INTEGER,
  expected_games INTEGER NOT NULL DEFAULT 0,
  done_games INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  status TEXT
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  tournament_id TEXT,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bench_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
"#;

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn in_memory() -> Result<Store> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    // ------------------------------------------------------------ settings
    pub fn settings(&self) -> Result<Settings> {
        let v: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key='settings'", [], |r| r.get(0))
            .optional()?;
        Ok(match v {
            Some(s) => {
                // merge over defaults so new fields get sensible values
                let mut base = serde_json::to_value(Settings::default())?;
                let cur: serde_json::Value = serde_json::from_str(&s)?;
                if let (Some(b), Some(c)) = (base.as_object_mut(), cur.as_object()) {
                    for (k, v) in c {
                        b.insert(k.clone(), v.clone());
                    }
                }
                serde_json::from_value(base)?
            }
            None => Settings::default(),
        })
    }
    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key,value) VALUES('settings',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![serde_json::to_string(s)?],
        )?;
        Ok(())
    }
    pub fn kv_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0)).optional()?)
    }
    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------ events
    pub fn push_event(&self, level: &str, kind: &str, tid: Option<&str>, msg: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO events(ts,level,kind,tournament_id,message) VALUES(?1,?2,?3,?4,?5)",
            params![now(), level, kind, tid, msg],
        )?;
        Ok(self.conn.last_insert_rowid())
    }
    pub fn events_since(&self, seq: i64, limit: i64) -> Result<Vec<EventRecord>> {
        let mut st = self.conn.prepare(
            "SELECT seq,ts,level,kind,tournament_id,message FROM events WHERE seq>?1 ORDER BY seq ASC LIMIT ?2",
        )?;
        let rows = st.query_map(params![seq, limit], |r| {
            Ok(EventRecord { seq: r.get(0)?, ts: r.get(1)?, level: r.get(2)?, kind: r.get(3)?, tournament_id: r.get(4)?, message: r.get(5)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn recent_events(&self, limit: i64, tid: Option<&str>) -> Result<Vec<EventRecord>> {
        let sql = if tid.is_some() {
            "SELECT seq,ts,level,kind,tournament_id,message FROM events WHERE tournament_id=?2 ORDER BY seq DESC LIMIT ?1"
        } else {
            "SELECT seq,ts,level,kind,tournament_id,message FROM events WHERE ?2 IS NULL OR 1 ORDER BY seq DESC LIMIT ?1"
        };
        let mut st = self.conn.prepare(sql)?;
        let rows = st.query_map(params![limit, tid], |r| {
            Ok(EventRecord { seq: r.get(0)?, ts: r.get(1)?, level: r.get(2)?, kind: r.get(3)?, tournament_id: r.get(4)?, message: r.get(5)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn last_event_seq(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COALESCE(MAX(seq),0) FROM events", [], |r| r.get(0))?)
    }

    // ------------------------------------------------------------ tournaments
    fn row_to_t(r: &rusqlite::Row) -> rusqlite::Result<TournamentRecord> {
        let cfg: String = r.get(4)?;
        let status: Option<String> = r.get(16)?;
        Ok(TournamentRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            state: TState::parse(&r.get::<_, String>(2)?),
            desired: Desired::parse(&r.get::<_, String>(3)?),
            config: serde_json::from_str(&cfg).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
            })?,
            created_at: r.get(5)?,
            started_at: r.get(6)?,
            finished_at: r.get(7)?,
            queue_pos: r.get(8)?,
            retries: r.get::<_, i64>(9)? as u32,
            runner_pid: r.get::<_, Option<i64>>(10)?.map(|x| x as u32),
            heartbeat: r.get(11)?,
            expected_games: r.get::<_, i64>(12)? as u32,
            done_games: r.get::<_, i64>(13)? as u32,
            last_error: r.get(14)?,
            imported: r.get::<_, i64>(15)? != 0,
            status: status.and_then(|s| serde_json::from_str(&s).ok()),
        })
    }
    const T_COLS: &'static str = "id,name,state,desired,config,created_at,started_at,finished_at,queue_pos,retries,runner_pid,heartbeat,expected_games,done_games,last_error,imported,status";

    pub fn insert_tournament(&self, t: &TournamentRecord) -> Result<()> {
        self.conn.execute(
            &format!("INSERT INTO tournaments({}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)", Self::T_COLS),
            params![
                t.id,
                t.name,
                t.state.as_str(),
                t.desired.as_str(),
                serde_json::to_string(&t.config)?,
                t.created_at,
                t.started_at,
                t.finished_at,
                t.queue_pos,
                t.retries as i64,
                t.runner_pid.map(|x| x as i64),
                t.heartbeat,
                t.expected_games as i64,
                t.done_games as i64,
                t.last_error,
                t.imported as i64,
                t.status.as_ref().map(|s| s.to_string()),
            ],
        )?;
        Ok(())
    }
    pub fn tournament(&self, id: &str) -> Result<Option<TournamentRecord>> {
        Ok(self
            .conn
            .query_row(&format!("SELECT {} FROM tournaments WHERE id=?1", Self::T_COLS), params![id], Self::row_to_t)
            .optional()?)
    }
    pub fn tournaments(&self) -> Result<Vec<TournamentRecord>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {} FROM tournaments ORDER BY COALESCE(started_at, created_at) DESC",
            Self::T_COLS
        ))?;
        let rows = st.query_map([], Self::row_to_t)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn update_config(&self, id: &str, cfg: &TournamentConfig, expected: u32) -> Result<()> {
        self.conn.execute(
            "UPDATE tournaments SET config=?2, name=?3, expected_games=?4 WHERE id=?1",
            params![id, serde_json::to_string(cfg)?, cfg.name, expected as i64],
        )?;
        Ok(())
    }
    pub fn set_state(&self, id: &str, s: TState) -> Result<()> {
        let fin = matches!(s, TState::Completed | TState::Incomplete | TState::Failed);
        self.conn.execute(
            "UPDATE tournaments SET state=?2, finished_at=CASE WHEN ?3 THEN ?4 ELSE finished_at END, \
             started_at=CASE WHEN ?2='running' AND started_at IS NULL THEN ?4 ELSE started_at END WHERE id=?1",
            params![id, s.as_str(), fin, now()],
        )?;
        Ok(())
    }
    pub fn set_desired(&self, id: &str, d: Desired) -> Result<()> {
        self.conn.execute("UPDATE tournaments SET desired=?2 WHERE id=?1", params![id, d.as_str()])?;
        Ok(())
    }
    pub fn desired(&self, id: &str) -> Result<Desired> {
        let s: String = self.conn.query_row("SELECT desired FROM tournaments WHERE id=?1", params![id], |r| r.get(0))?;
        Ok(Desired::parse(&s))
    }
    pub fn heartbeat(&self, id: &str, pid: u32, done: u32, status: &serde_json::Value) -> Result<()> {
        self.conn.execute(
            "UPDATE tournaments SET heartbeat=?2, runner_pid=?3, done_games=?4, status=?5 WHERE id=?1",
            params![id, now_ts(), pid as i64, done as i64, status.to_string()],
        )?;
        Ok(())
    }
    pub fn clear_runner(&self, id: &str) -> Result<()> {
        self.conn.execute("UPDATE tournaments SET runner_pid=NULL WHERE id=?1", params![id])?;
        Ok(())
    }
    pub fn set_done(&self, id: &str, done: u32) -> Result<()> {
        self.conn.execute("UPDATE tournaments SET done_games=?2 WHERE id=?1", params![id, done as i64])?;
        Ok(())
    }
    pub fn set_error(&self, id: &str, e: Option<&str>) -> Result<()> {
        self.conn.execute("UPDATE tournaments SET last_error=?2 WHERE id=?1", params![id, e])?;
        Ok(())
    }
    pub fn set_retries(&self, id: &str, n: u32) -> Result<()> {
        self.conn.execute("UPDATE tournaments SET retries=?2 WHERE id=?1", params![id, n as i64])?;
        Ok(())
    }
    pub fn delete_tournament(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tournaments WHERE id=?1", params![id])?;
        Ok(())
    }

    // queue: tournaments with state=queued ordered by queue_pos
    pub fn enqueue(&self, id: &str) -> Result<()> {
        let pos: i64 = self.conn.query_row("SELECT COALESCE(MAX(queue_pos),0)+1 FROM tournaments", [], |r| r.get(0))?;
        self.conn.execute(
            "UPDATE tournaments SET state='queued', desired='run', queue_pos=?2 WHERE id=?1",
            params![id, pos],
        )?;
        Ok(())
    }
    pub fn queue(&self) -> Result<Vec<TournamentRecord>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {} FROM tournaments WHERE state='queued' ORDER BY queue_pos ASC",
            Self::T_COLS
        ))?;
        let rows = st.query_map([], Self::row_to_t)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn move_in_queue(&self, id: &str, delta: i64) -> Result<()> {
        let q = self.queue()?;
        let Some(i) = q.iter().position(|t| t.id == id) else { return Ok(()) };
        let j = (i as i64 + delta).clamp(0, q.len() as i64 - 1) as usize;
        if i == j {
            return Ok(());
        }
        let (a, b) = (&q[i], &q[j]);
        self.conn.execute("UPDATE tournaments SET queue_pos=?2 WHERE id=?1", params![a.id, b.queue_pos])?;
        self.conn.execute("UPDATE tournaments SET queue_pos=?2 WHERE id=?1", params![b.id, a.queue_pos])?;
        Ok(())
    }

    // ------------------------------------------------------------ engines
    pub fn engines(&self) -> Result<Vec<crate::engines::EngineEntry>> {
        let mut st = self.conn.prepare("SELECT id,data FROM engines ORDER BY name COLLATE NOCASE")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, data) = row?;
            let mut e: crate::engines::EngineEntry = serde_json::from_str(&data)?;
            e.id = Some(id);
            out.push(e);
        }
        Ok(out)
    }
    pub fn engine(&self, id: i64) -> Result<Option<crate::engines::EngineEntry>> {
        let d: Option<String> =
            self.conn.query_row("SELECT data FROM engines WHERE id=?1", params![id], |r| r.get(0)).optional()?;
        Ok(match d {
            Some(d) => {
                let mut e: crate::engines::EngineEntry = serde_json::from_str(&d)?;
                e.id = Some(id);
                Some(e)
            }
            None => None,
        })
    }
    pub fn save_engine(&self, e: &crate::engines::EngineEntry) -> Result<i64> {
        let data = serde_json::to_string(e)?;
        match e.id {
            Some(id) => {
                self.conn.execute(
                    "UPDATE engines SET data=?2, name=?3, updated_at=?4 WHERE id=?1",
                    params![id, data, e.display_name, now()],
                )?;
                Ok(id)
            }
            None => {
                self.conn.execute(
                    "INSERT INTO engines(data,name,updated_at) VALUES(?1,?2,?3)",
                    params![data, e.display_name, now()],
                )?;
                Ok(self.conn.last_insert_rowid())
            }
        }
    }
    pub fn delete_engine(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM engines WHERE id=?1", params![id])?;
        Ok(())
    }

    // ------------------------------------------------------------ aliases
    pub fn aliases(&self) -> Result<Vec<(String, String, String)>> {
        let mut st = self.conn.prepare("SELECT alias,canonical,source FROM aliases ORDER BY alias")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn set_alias(&self, alias: &str, canonical: &str, source: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO aliases(alias,canonical,source) VALUES(?1,?2,?3) ON CONFLICT(alias) DO UPDATE SET canonical=excluded.canonical, source=excluded.source",
            params![alias, canonical, source],
        )?;
        Ok(())
    }
    pub fn delete_alias(&self, alias: &str) -> Result<()> {
        self.conn.execute("DELETE FROM aliases WHERE alias=?1", params![alias])?;
        Ok(())
    }
    pub fn resolve_alias(&self, name: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT canonical FROM aliases WHERE alias=?1", params![name], |r| r.get(0)).optional()?)
    }

    // ------------------------------------------------------------ CCRL lists
    pub fn save_ccrl_list(&self, l: &crate::ccrl::CcrlList) -> Result<i64> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM ccrl_lists WHERE list=?1 AND cpu=?2 AND variant=?3",
            params![l.list, l.cpu, l.variant],
        )?;
        tx.execute(
            "INSERT INTO ccrl_lists(list,cpu,variant,source,fetched_at) VALUES(?1,?2,?3,?4,?5)",
            params![l.list, l.cpu, l.variant, l.source, l.fetched_at],
        )?;
        let id = tx.last_insert_rowid();
        {
            let mut st = tx.prepare(
                "INSERT INTO ccrl_entries(list_id,rank,name,rating,err_plus,err_minus,games,score) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            for e in &l.entries {
                st.execute(params![id, e.rank, e.name, e.rating, e.err_plus, e.err_minus, e.games, e.score])?;
            }
        }
        tx.commit()?;
        Ok(id)
    }
    pub fn ccrl_lists(&self) -> Result<Vec<crate::ccrl::CcrlList>> {
        let mut st = self.conn.prepare("SELECT id,list,cpu,variant,source,fetched_at FROM ccrl_lists ORDER BY list,cpu,variant")?;
        let heads: Vec<(i64, String, String, String, String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<std::result::Result<_, _>>()?;
        let mut out = Vec::new();
        for (id, list, cpu, variant, source, fetched_at) in heads {
            let mut es = self.conn.prepare(
                "SELECT rank,name,rating,err_plus,err_minus,games,score FROM ccrl_entries WHERE list_id=?1 ORDER BY rank",
            )?;
            let entries = es
                .query_map(params![id], |r| {
                    Ok(crate::ccrl::CcrlEntry {
                        rank: r.get(0)?,
                        name: r.get(1)?,
                        rating: r.get(2)?,
                        err_plus: r.get(3)?,
                        err_minus: r.get(4)?,
                        games: r.get(5)?,
                        score: r.get(6)?,
                    })
                })?
                .collect::<std::result::Result<_, _>>()?;
            out.push(crate::ccrl::CcrlList { id: Some(id), list, cpu, variant, source, fetched_at, entries });
        }
        Ok(out)
    }

    // ------------------------------------------------------------ bench
    pub fn save_bench(&self, host: &str, data: &serde_json::Value) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO bench_runs(host,created_at,data) VALUES(?1,?2,?3)",
            params![host, now(), data.to_string()],
        )?;
        Ok(self.conn.last_insert_rowid())
    }
    pub fn bench_runs(&self) -> Result<Vec<(i64, String, String, serde_json::Value)>> {
        let mut st = self.conn.prepare("SELECT id,host,created_at,data FROM bench_runs ORDER BY created_at")?;
        let rows = st.query_map([], |r| {
            let d: String = r.get(3)?;
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, serde_json::from_str(&d).unwrap_or(serde_json::Value::Null)))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn delete_bench(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM bench_runs WHERE id=?1", params![id])?;
        Ok(())
    }
}

/// Random-enough id: `<yyyymmdd-HHMMSS>-<4 hex>`.
pub fn new_id(name: &str) -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos();
    let slug: String = crate::pgn::slug(name).chars().take(40).collect();
    format!("{}_{}_{:04x}", chrono::Local::now().format("%Y-%m-%d"), slug.trim_matches('_'), n & 0xffff)
}

impl TournamentRecord {
    /// A new draft record for `config` (id derived from the name).
    pub fn new(config: TournamentConfig) -> TournamentRecord {
        let expected = crate::scheduler::expected_games(&config) as u32;
        TournamentRecord {
            id: new_id(&config.name),
            name: config.name.clone(),
            state: TState::Draft,
            desired: Desired::Run,
            config,
            created_at: now(),
            started_at: None,
            finished_at: None,
            queue_pos: None,
            retries: 0,
            runner_pid: None,
            heartbeat: None,
            expected_games: expected,
            done_games: 0,
            last_error: None,
            imported: false,
            status: None,
        }
    }
}
