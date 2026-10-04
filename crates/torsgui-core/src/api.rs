//! Typed command API shared by the Tauri app and the HTTP server.
//! Every command takes a JSON object and returns JSON; the argument and
//! result types are exported to TypeScript with ts-rs (`ui/src/bindings`).

use crate::analysis;
use crate::analyze::{self, GameAnalysisConfig, GameAnalysisProgress, LiveAnalyzer, LiveRequest};
use crate::bench::{self, BenchConfig, BenchProgress, BenchRun};
use crate::ccrl::{self, CcrlList, RatingIndex};
use crate::engines::{self, EngineEntry};
use crate::export::{self, ExportOptions};
use crate::forum::{self, PostContext, PostKind};
use crate::live::LiveTracker;
use crate::model::*;
use crate::pgn::{self, Game};
use crate::runner;
use crate::scheduler;
use crate::stats::{RowOrder, Standings};
use crate::suite::{self, SuiteConfig, SuiteProgress};
use crate::store::{Desired, Settings, TState, TournamentRecord, Workspace};
use anyhow::{anyhow, bail, Context, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct App {
    pub ws: Workspace,
    sys: Mutex<sysinfo::System>,
    live: Mutex<HashMap<String, LiveTracker>>,
    cache: Mutex<HashMap<String, (String, Arc<analysis::Loaded>)>>,
    bench: Arc<Mutex<BenchProgress>>,
    jobs: Arc<Mutex<HashMap<String, Value>>>,
    suite: Arc<Mutex<SuiteProgress>>,
    suite_cancel: Arc<AtomicBool>,
    game_analysis: Arc<Mutex<GameAnalysisProgress>>,
    game_cancel: Arc<AtomicBool>,
    live_analysis: LiveAnalyzer,
}

fn arg<T: DeserializeOwned>(a: &Value, k: &str) -> Result<T> {
    serde_json::from_value(a.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| anyhow!("argument '{k}': {e}"))
}
fn opt<T: DeserializeOwned>(a: &Value, k: &str) -> Option<T> {
    a.get(k).cloned().filter(|v| !v.is_null()).and_then(|v| serde_json::from_value(v).ok())
}
fn ok<T: Serialize>(v: T) -> Result<Value> {
    Ok(serde_json::to_value(v)?)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Progress {
    pub done: u32,
    pub expected: u32,
    pub pct: f64,
    /// games per hour over the last hour (rolling window)
    pub rate_per_hour: Option<f64>,
    pub avg_game_s: Option<f64>,
    pub eta_s: Option<f64>,
    pub eta_at: Option<String>,
    pub lanes: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct TournamentSummary {
    pub record: TournamentRecord,
    pub progress: Progress,
    pub runner_alive: bool,
    pub seed: String,
    pub score_line: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct TournamentDetail {
    pub summary: TournamentSummary,
    pub standings: Standings,
    pub open_pairs: Vec<pgn::SlotKey>,
    pub lanes: Vec<runner::LaneStatus>,
    pub warnings: Vec<String>,
    pub pairings: Vec<(String, String, u32, u32)>,
    /// Swiss / knockout rounds (None for the other formats).
    pub stages: Option<scheduler::StagesView>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct TimelineItem {
    pub id: String,
    pub name: String,
    pub state: TState,
    pub start: String,
    pub end: String,
    pub estimated: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct WizardPreview {
    pub pairings: u32,
    pub games_per_pairing: u32,
    pub total_games: u32,
    pub rounds_per_pass: Vec<u32>,
    pub openings_used: u32,
    pub last_opening: u32,
    pub concurrent_games: u32,
    pub busy_threads: u32,
    pub physical_cores: u32,
    pub ram_needed_mb: u64,
    pub ram_total_mb: u64,
    pub est_game_s: f64,
    pub eta_s: f64,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub first_command: String,
    pub event_example: String,
}

/// A group of PGN games in the archive: a tournament or an external PGN file.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ArchiveSource {
    /// "tournament" or "file".
    pub kind: String,
    /// Tournament id, or the file path.
    pub id: String,
    pub label: String,
    pub path: String,
    pub files: u32,
    pub games: u32,
    pub state: Option<TState>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GameRow {
    pub index: usize,
    pub source: String,
    pub white: String,
    pub black: String,
    pub result: String,
    pub termination: String,
    pub plies: u32,
    pub end_time: String,
    pub duration_s: Option<u64>,
    pub opening: String,
    pub round: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LiveLane {
    pub tournament_id: String,
    pub tournament: String,
    pub lane: runner::LaneStatus,
    pub game: Option<crate::live::LiveGame>,
    pub elapsed_s: Option<i64>,
}

impl App {
    pub fn new(root: PathBuf) -> Result<App> {
        let ws = Workspace::new(root);
        ws.open()?; // creates the database
        Ok(App {
            ws,
            sys: Mutex::new(sysinfo::System::new()),
            live: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
            bench: Arc::new(Mutex::new(BenchProgress::default())),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            suite: Arc::new(Mutex::new(SuiteProgress::default())),
            suite_cancel: Arc::new(AtomicBool::new(false)),
            game_analysis: Arc::new(Mutex::new(GameAnalysisProgress::default())),
            game_cancel: Arc::new(AtomicBool::new(false)),
            live_analysis: LiveAnalyzer::default(),
        })
    }

    pub fn call(&self, cmd: &str, a: Value) -> Result<Value> {
        let store = self.ws.open()?;
        if (cmd.starts_with("ccrl_") && cmd != "ccrl_delete_list") || cmd == "engines_ccrl" {
            ensure_ccrl_snapshots(&store)?;
        }
        match cmd {
            // ---------------------------------------------------------- app
            "app_info" => {
                let s = store.settings()?;
                let fc = crate::fastchess::resolve("", &s.fastchess_path, &self.ws.tools_dir(), &s.fastchess_version);
                ok(json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "workspace": self.ws.root,
                    "os": crate::platform::os().name(),
                    "fastchess": fc,
                    "fastchess_found": fc.exists(),
                    "fastchess_version": if fc.exists() { crate::fastchess::version_of(&fc).ok() } else { None },
                    "fastchess_pinned": crate::fastchess::PINNED_VERSION,
                    "runner": runner::runner_exe(),
                    "runner_found": runner::runner_exe().exists(),
                    "host": sysinfo::System::host_name(),
                }))
            }
            "update_check" => {
                let current = env!("CARGO_PKG_VERSION");
                let (owner, repo) = crate::github::APP_REPO;
                let tag = crate::github::latest_tag_via_redirect(owner, repo)?;
                ok(json!({
                    "current": current,
                    "latest": tag.trim_start_matches('v'),
                    "newer": crate::github::is_newer(&tag, current),
                    "url": format!("https://github.com/{owner}/{repo}/releases/tag/{tag}"),
                }))
            }
            "open_url" => {
                let url: String = arg(&a, "url")?;
                if !(url.starts_with("https://") || url.starts_with("http://")) {
                    bail!("only web addresses can be opened");
                }
                open_in_browser(&url)?;
                ok(true)
            }
            "settings_get" => ok(store.settings()?),
            "settings_save" => {
                let s: Settings = arg(&a, "settings")?;
                store.save_settings(&s)?;
                ok(s)
            }
            "topology" => ok(crate::platform::os().topology()),
            "lane_plan" => {
                let topo = crate::platform::os().topology();
                let nodes: Vec<u32> = arg(&a, "nodes")?;
                let placement: Placement = opt(&a, "placement").unwrap_or(Placement::Node);
                ok(crate::platform::plan_lanes(&topo, &nodes, arg(&a, "lanes")?, arg(&a, "threads")?, placement))
            }
            "health" => ok(crate::health::collect(&self.ws, &mut self.sys.lock().unwrap())),
            "events_since" => ok(store.events_since(opt(&a, "seq").unwrap_or(0), opt(&a, "limit").unwrap_or(200))?),
            "events_recent" => ok(store.recent_events(opt(&a, "limit").unwrap_or(200), opt::<String>(&a, "tournament_id").as_deref())?),
            "last_event_seq" => ok(store.last_event_seq()?),
            "dashboard" => self.dashboard(&store),

            // ---------------------------------------------------------- tournaments
            "tournaments_list" => {
                let v: Vec<TournamentSummary> = store.tournaments()?.into_iter().map(|t| self.summary(t, false)).collect();
                ok(v)
            }
            "tournament_get" => {
                let id: String = arg(&a, "id")?;
                let order: RowOrder = opt(&a, "order").unwrap_or(RowOrder::Rating);
                self.detail(&store, &id, order)
            }
            "tournament_elo_history" => {
                let id: String = arg(&a, "id")?;
                let t = store.tournament(&id)?.context("tournament not found")?;
                let loaded = self.loaded(&store, &id)?;
                let players: Vec<String> = t.config.participants.iter().map(|p| p.name.clone()).collect();
                let player = opt::<String>(&a, "player")
                    .filter(|p| players.contains(p))
                    .or_else(|| t.config.participants.iter().find(|p| p.role == Role::Seed).map(|p| p.name.clone()))
                    .or_else(|| players.first().cloned())
                    .unwrap_or_default();
                let ratings: HashMap<String, f64> = analysis::ratings(&t.config).into_iter().map(|(k, (r, _))| (k, r)).collect();
                ok(crate::insights::EloHistory { points: crate::insights::elo_history(&loaded.games, &player, &ratings, 400), player, players })
            }
            "tournament_openings" => {
                let id: String = arg(&a, "id")?;
                let loaded = self.loaded(&store, &id)?;
                ok(crate::insights::openings(&loaded.games))
            }
            "wizard_preview" => ok(self.preview(&arg::<TournamentConfig>(&a, "config")?)),
            "tournament_create" => {
                let cfg: TournamentConfig = arg(&a, "config")?;
                let p = self.preview(&cfg);
                if let Some(e) = p.errors.first() {
                    bail!("{e}");
                }
                let rec = TournamentRecord::new(cfg);
                store.insert_tournament(&rec)?;
                std::fs::create_dir_all(self.ws.pgn_dir(&rec.id))?;
                std::fs::write(self.ws.tournament_dir(&rec.id).join("config.json"), serde_json::to_string_pretty(&rec.config)?)?;
                store.push_event("info", "tournament_created", Some(&rec.id), &format!("{} created ({} games)", rec.name, rec.expected_games))?;
                if opt::<bool>(&a, "enqueue").unwrap_or(false) {
                    store.enqueue(&rec.id)?;
                }
                ok(store.tournament(&rec.id)?)
            }
            // ---------------------------------------------------------- tournament files
            "tfile_parse" => {
                let (imp, preview) = self.tfile_parse(&store, &arg::<String>(&a, "text")?)?;
                ok(json!({"import": imp, "preview": preview}))
            }
            "tfile_import" => {
                let text: String = arg(&a, "text")?;
                let action: String = opt(&a, "action").unwrap_or_else(|| "queue".into());
                let (imp, preview) = self.tfile_parse(&store, &text)?;
                let (Some(cfg), None) = (imp.config.clone(), imp.errors.first().or(preview.errors.first())) else {
                    bail!("{}", imp.errors.iter().chain(preview.errors.iter()).cloned().collect::<Vec<_>>().join("; "));
                };
                let rec = TournamentRecord::new(cfg);
                store.insert_tournament(&rec)?;
                std::fs::create_dir_all(self.ws.pgn_dir(&rec.id))?;
                std::fs::write(self.ws.tournament_dir(&rec.id).join("config.json"), serde_json::to_string_pretty(&rec.config)?)?;
                std::fs::write(self.ws.tournament_dir(&rec.id).join("tournament.toml"), &text)?;
                store.push_event("info", "tournament_created", Some(&rec.id), &format!("{} imported from a tournament file ({} games)", rec.name, rec.expected_games))?;
                if action == "queue" || action == "start" {
                    store.enqueue(&rec.id)?;
                }
                if action == "start" {
                    let busy = store.tournaments()?.into_iter().any(|t| t.id != rec.id && t.state == TState::Running && runner::is_running(&self.ws.tournament_dir(&t.id)));
                    if busy {
                        store.push_event("info", "queue_changed", Some(&rec.id), "a tournament is running: queued, it starts when the queue reaches it")?;
                    } else {
                        store.set_desired(&rec.id, Desired::Run)?;
                        runner::launch(&self.ws, &rec.id, store.settings()?.use_task_scheduler)?;
                    }
                }
                ok(store.tournament(&rec.id)?)
            }
            "tfile_export" => {
                let t = store.tournament(&arg::<String>(&a, "id")?)?.context("tournament not found")?;
                ok(crate::tournament_file::to_toml(&crate::tournament_file::from_config(&t.config))?)
            }
            "tfile_template" => {
                let topo = crate::platform::os().topology();
                let nodes: Vec<(u32, u32)> = topo.nodes.iter().map(|n| (n.id, n.physical_cores)).collect();
                ok(crate::tournament_file::template(&store.engines()?, &store.settings()?, &nodes))
            }
            "tfile_inbox" => {
                let dir = self.ws.root.join("inbox");
                std::fs::create_dir_all(&dir)?;
                let mut v: Vec<Value> = Vec::new();
                for e in std::fs::read_dir(&dir)?.flatten() {
                    let p = e.path();
                    let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                    if ext == "toml" || ext == "json" {
                        let modified = e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default();
                        v.push(json!({"name": p.file_name().unwrap().to_string_lossy(), "path": p.to_string_lossy(), "modified": modified, "text": crate::pgn::read_text(&p).unwrap_or_default()}));
                    }
                }
                v.sort_by(|a, b| b["modified"].as_str().cmp(&a["modified"].as_str()));
                ok(json!({"dir": dir.to_string_lossy(), "files": v}))
            }
            "tfile_read" => {
                let path: PathBuf = arg(&a, "path")?;
                ok(crate::pgn::read_text(&path).with_context(|| format!("{}", path.display()))?)
            }
            "tournament_update" => {
                let id: String = arg(&a, "id")?;
                let cfg: TournamentConfig = arg(&a, "config")?;
                let t = store.tournament(&id)?.context("not found")?;
                if runner::is_running(&self.ws.tournament_dir(&id)) {
                    bail!("pause or stop the tournament before editing it");
                }
                if t.done_games > 0 && (cfg.participants.len() != t.config.participants.len() || cfg.rounds_per_pass != t.config.rounds_per_pass || cfg.passes != t.config.passes || cfg.book_start != t.config.book_start || cfg.nodes.len() != t.config.nodes.len()) {
                    bail!("games were already played: engines, openings and nodes can no longer change (they define the slots)");
                }
                if t.imported {
                    bail!("imported tournaments are read-only");
                }
                if let Some(e) = self.preview(&cfg).errors.first() {
                    bail!("{e}");
                }
                store.update_config(&id, &cfg, scheduler::expected_games(&cfg) as u32)?;
                let dir = self.ws.tournament_dir(&id);
                std::fs::create_dir_all(&dir)?;
                std::fs::write(dir.join("config.json"), serde_json::to_string_pretty(&cfg)?)?;
                store.push_event("info", "tournament_updated", Some(&id), &format!("{} edited ({} games)", cfg.name, scheduler::expected_games(&cfg)))?;
                ok(store.tournament(&id)?)
            }
            "tournament_set_options" => {
                // the UCI options of one engine in this tournament; used from the next game on
                let id: String = arg(&a, "id")?;
                let name: String = arg(&a, "name")?;
                let options: std::collections::BTreeMap<String, String> = arg(&a, "options")?;
                let mut t = store.tournament(&id)?.context("not found")?;
                if t.imported {
                    bail!("imported tournaments are read-only");
                }
                if runner::is_running(&self.ws.tournament_dir(&id)) {
                    bail!("pause or stop the tournament first: the new options are used from the next game");
                }
                let p = t.config.participants.iter_mut().find(|p| p.name == name).with_context(|| format!("'{name}' is not in this tournament"))?;
                p.options = options.into_iter().map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).filter(|(k, _)| !k.is_empty()).collect();
                let declared = p.engine_id.and_then(|e| store.engine(e).ok().flatten()).map(|e| e.options).unwrap_or_default();
                let warnings = engines::check_options(&p.name, &p.options, &declared, &p.dir);
                let list = p.options.iter().filter(|(k, _)| *k != "Threads" && *k != "Hash").map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(", ");
                store.update_config(&id, &t.config, t.expected_games)?;
                let dir = self.ws.tournament_dir(&id);
                std::fs::create_dir_all(&dir)?;
                std::fs::write(dir.join("config.json"), serde_json::to_string_pretty(&t.config)?)?;
                store.push_event("info", "engine_options", Some(&id), &format!("{name}: options {}{}", if list.is_empty() { "reset to the defaults".to_string() } else { list }, if t.done_games > 0 { format!(" (from game {} on)", t.done_games + 1) } else { String::new() }))?;
                ok(json!({"warnings": warnings}))
            }
            "engine_check_options" => {
                let id: i64 = arg(&a, "engine_id")?;
                let e = store.engine(id)?.context("engine not found")?;
                let options: std::collections::BTreeMap<String, String> = arg(&a, "options")?;
                ok(engines::check_options(&e.display_name, &options, &e.options, &e.dir))
            }
            // ---------------------------------------------------------- test suites
            "suites_builtin" => ok(suite::builtin_list()),
            "suite_preview" => {
                let (name, parsed) = suite::load(&arg::<SuiteConfig>(&a, "config")?)?;
                ok(json!({"name": name, "positions": parsed.positions, "errors": parsed.errors}))
            }
            "suite_start" => {
                let cfg: SuiteConfig = arg(&a, "config")?;
                let all = store.engines()?;
                let engines: Vec<EngineEntry> = cfg.engines.iter().filter_map(|id| all.iter().find(|e| e.id == Some(*id)).cloned()).collect();
                if let Some(e) = engines.iter().find(|e| e.path.is_empty() || !Path::new(&e.path).is_file()) {
                    bail!("{}: executable not found ({})", e.display_name, e.path);
                }
                suite::load(&cfg)?;
                {
                    let mut p = self.suite.lock().unwrap();
                    if p.running {
                        bail!("a test suite is already running");
                    }
                    *p = SuiteProgress { running: true, ..Default::default() };
                }
                self.suite_cancel.store(false, Ordering::Relaxed);
                let (prog, cancel, root) = (self.suite.clone(), self.suite_cancel.clone(), self.ws.root.clone());
                std::thread::spawn(move || {
                    let r = suite::run(&cfg, &engines, prog.clone(), cancel);
                    let mut p = prog.lock().unwrap();
                    p.running = false;
                    match r {
                        Ok(run) => {
                            let _ = suite::save_run(&root, &run);
                            if run.finished {
                                let solved: Vec<String> = run.engines.iter().map(|e| format!("{} {}/{}", e.name, e.solved, run.positions.len())).collect();
                                if let Ok(s) = Workspace::new(root.clone()).open() {
                                    let _ = s.push_event("success", "suite_finished", None, &format!("{}: {}", run.suite, solved.join(", ")));
                                }
                            }
                        }
                        Err(e) => p.error = Some(format!("{e:#}")),
                    }
                });
                ok(true)
            }
            "suite_progress" => ok(self.suite.lock().unwrap().clone()),
            "suite_stop" => {
                self.suite_cancel.store(true, Ordering::Relaxed);
                ok(true)
            }
            "suite_history" => ok(suite::list_runs(&self.ws.root)),
            "suite_delete" => {
                suite::delete_run(&self.ws.root, &arg::<String>(&a, "id")?)?;
                ok(true)
            }
            // ---------------------------------------------------------- game analysis
            "analysis_load_text" => ok(load_game_text(&arg::<String>(&a, "text")?)?),
            "analysis_game_start" => {
                let cfg: GameAnalysisConfig = arg(&a, "config")?;
                let e = store.engine(cfg.engine_id)?.context("engine not found")?;
                analyze::boards(&cfg.start_fen, &cfg.moves)?;
                {
                    let mut p = self.game_analysis.lock().unwrap();
                    if p.running {
                        bail!("a game analysis is already running");
                    }
                    *p = GameAnalysisProgress { running: true, ..Default::default() };
                }
                self.game_cancel.store(false, Ordering::Relaxed);
                let (prog, cancel, ws) = (self.game_analysis.clone(), self.game_cancel.clone(), self.ws.clone());
                std::thread::spawn(move || {
                    let r = analyze::run_game(&cfg, &e, prog.clone(), cancel.clone());
                    let mut p = prog.lock().unwrap();
                    p.running = false;
                    match r {
                        Err(e) => p.error = Some(format!("{e:#}")),
                        Ok(a) if !cancel.load(Ordering::Relaxed) => {
                            if let Ok(s) = ws.open() {
                                let _ = s.push_event("success", "analysis_finished", None, &format!("{} moves analysed with {}: White {} ?? / Black {} ??", a.moves.len(), a.engine, a.white.blunders, a.black.blunders));
                            }
                        }
                        Ok(_) => {}
                    }
                });
                ok(true)
            }
            "pgn_save" => {
                // an analysed or played game, saved where the game archive shows it
                let text: String = arg(&a, "text")?;
                let folder = match opt::<String>(&a, "folder").as_deref() {
                    Some("play") => "play",
                    _ => "analysis",
                };
                let name: String = opt(&a, "name").unwrap_or_else(|| "game".into());
                let mut settings = store.settings()?;
                let base = if settings.output_dir.trim().is_empty() { self.ws.root.join("results") } else { PathBuf::from(&settings.output_dir) };
                let dir = base.join(folder);
                std::fs::create_dir_all(&dir).with_context(|| format!("{}", dir.display()))?;
                let clean: String = name.chars().map(|c| if c.is_alphanumeric() || " .-_".contains(c) { c } else { '_' }).collect::<String>().trim().chars().take(80).collect();
                let file = dir.join(format!("{} {}.pgn", chrono::Local::now().format("%Y-%m-%d %H%M%S"), if clean.is_empty() { "game" } else { &clean }));
                std::fs::write(&file, text.replace("\r\n", "\n"))?;
                let d = dir.to_string_lossy().to_string();
                if !settings.archive_paths.contains(&d) {
                    settings.archive_paths.push(d);
                    store.save_settings(&settings)?;
                }
                ok(json!({"path": file}))
            }
            "analysis_game_progress" => ok(self.game_analysis.lock().unwrap().clone()),
            "analysis_game_stop" => {
                self.game_cancel.store(true, Ordering::Relaxed);
                ok(true)
            }
            "analysis_live" => {
                let req: LiveRequest = arg(&a, "request")?;
                let e = store.engine(req.engine_id)?.context("engine not found")?;
                crate::chess960::parse_fen(&req.fen)?;
                self.live_analysis.set(req, e);
                ok(true)
            }
            "analysis_live_get" => ok(self.live_analysis.state.lock().unwrap().clone()),
            "analysis_live_stop" => {
                self.live_analysis.stop();
                ok(true)
            }
            "tournament_delete" => {
                let id: String = arg(&a, "id")?;
                if runner::is_running(&self.ws.tournament_dir(&id)) {
                    bail!("stop the tournament first");
                }
                store.delete_tournament(&id)?;
                if opt::<bool>(&a, "delete_files").unwrap_or(false) {
                    let _ = std::fs::remove_dir_all(self.ws.tournament_dir(&id));
                }
                ok(true)
            }
            "tournament_start" => {
                let id: String = arg(&a, "id")?;
                let t = store.tournament(&id)?.context("not found")?;
                if t.imported {
                    bail!("imported tournaments are read-only (their engines live on the original machine)");
                }
                store.set_desired(&id, Desired::Run)?;
                if t.state != TState::Running {
                    store.set_retries(&id, 0)?;
                }
                let s = store.settings()?;
                let info = runner::launch(&self.ws, &id, s.use_task_scheduler)?;
                store.push_event("info", "runner_launched", Some(&id), &format!("{}: runner launched ({})", t.name, info.via))?;
                ok(info)
            }
            "tournament_pause" | "tournament_stop" => {
                let id: String = arg(&a, "id")?;
                let d = if cmd == "tournament_pause" { Desired::Pause } else { Desired::Stop };
                store.set_desired(&id, d)?;
                if !runner::is_running(&self.ws.tournament_dir(&id)) {
                    let t = store.tournament(&id)?.context("not found")?;
                    if matches!(t.state, TState::Running | TState::Queued) {
                        store.set_state(&id, if d == Desired::Pause { TState::Paused } else { TState::Stopped })?;
                    }
                }
                ok(true)
            }
            "queue_add" => {
                let id: String = arg(&a, "id")?;
                store.enqueue(&id)?;
                store.push_event("info", "queue_changed", Some(&id), "added to the queue")?;
                ok(true)
            }
            "queue_remove" => {
                let id: String = arg(&a, "id")?;
                store.set_state(&id, TState::Draft)?;
                store.conn.execute("UPDATE tournaments SET queue_pos=NULL WHERE id=?1", [&id])?;
                ok(true)
            }
            "queue_move" => {
                store.move_in_queue(&arg::<String>(&a, "id")?, arg(&a, "delta")?)?;
                ok(true)
            }
            "queue_start" => {
                let running = store.tournaments()?.into_iter().any(|t| t.state == TState::Running && runner::is_running(&self.ws.tournament_dir(&t.id)));
                if running {
                    bail!("a tournament is already running: the queue continues when it completes");
                }
                let head = store.queue()?.into_iter().next().context("the queue is empty")?;
                let s = store.settings()?;
                store.set_desired(&head.id, Desired::Run)?;
                ok(runner::launch(&self.ws, &head.id, s.use_task_scheduler)?)
            }
            "resume_interrupted" => ok(runner::resume_interrupted(&self.ws, store.settings()?.use_task_scheduler)?),
            "import_scan" => {
                let root: PathBuf = arg(&a, "root")?;
                let mut v = Vec::new();
                for e in std::fs::read_dir(root.join("tournaments")).context("no tournaments/ folder")?.filter_map(|e| e.ok()) {
                    if e.path().join("config/engines.json").exists() {
                        let name = e.file_name().to_string_lossy().to_string();
                        let res = root.join("results/gauntlets").join(&name);
                        let imported = store.tournaments()?.iter().any(|t| t.name == name && t.imported);
                        v.push(json!({"name": name, "dir": e.path(), "results": if res.is_dir() { Some(res) } else { None }, "imported": imported}));
                    }
                }
                v.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
                ok(v)
            }
            "import_legacy" => {
                let dir: PathBuf = arg(&a, "dir")?;
                let res: Option<PathBuf> = opt(&a, "results");
                ok(self.import_legacy(&store, &dir, res.as_deref())?)
            }
            "tournament_refresh_ratings" => {
                let id: String = arg(&a, "id")?;
                let mut t = store.tournament(&id)?.context("not found")?;
                let lists = store.ccrl_lists()?;
                let s = store.settings()?;
                let aliases: HashMap<String, String> = store.aliases()?.into_iter().map(|(a, c, _)| (a, c)).collect();
                let list = if t.config.ccrl_list.is_empty() { "Blitz".to_string() } else { t.config.ccrl_list.clone() };
                let idx = RatingIndex::new(&lists, &list, aliases, s.default_cpu_gap);
                let mut found = 0;
                for p in t.config.participants.iter_mut() {
                    let r = idx.rating(&p.name, t.config.threads);
                    if let Some(v) = r.rating {
                        p.rating = Some(v);
                        p.rating_estimated = r.estimated;
                        found += 1;
                    }
                }
                let exp = t.expected_games;
                store.update_config(&id, &t.config, exp)?;
                ok(json!({"found": found, "total": t.config.participants.len()}))
            }
            "rename_player" => ok(crate::maintenance::rename_player(&self.ws, &store, &arg::<String>(&a, "id")?, &arg::<String>(&a, "old")?, &arg::<String>(&a, "new")?, opt(&a, "dry_run").unwrap_or(false))?),

            // ---------------------------------------------------------- games
            "games_list" => {
                let id: String = arg(&a, "id")?;
                let loaded = self.loaded(&store, &id)?;
                let rows: Vec<GameRow> = loaded.games.iter().map(game_row).collect();
                ok(rows)
            }
            "archive_sources" => ok(self.archive_sources(&store)?),
            "piece_sets_user" => ok(crate::pieces::list(&self.ws.root.join("pieces"))),
            "piece_set_import" => {
                let dir: PathBuf = arg(&a, "dir")?;
                let name: Option<String> = opt(&a, "name");
                ok(crate::pieces::import(&self.ws.root.join("pieces"), &dir, name.as_deref())?)
            }
            "piece_set_delete" => {
                crate::pieces::delete(&self.ws.root.join("pieces"), &arg::<String>(&a, "name")?)?;
                ok(true)
            }
            "archive_games" => {
                let source: PathBuf = arg(&a, "source")?;
                self.guard_path(&source)?;
                let rows: Vec<GameRow> = pgn::read_games(&source)?.iter().map(game_row).collect();
                ok(rows)
            }
            "game_get" => {
                let source: PathBuf = arg(&a, "source")?;
                let index: usize = arg(&a, "index")?;
                self.guard_path(&source)?;
                let games = pgn::read_games(&source)?;
                let g = games.into_iter().find(|g| g.index == index).context("game not found")?;
                ok(crate::live::viewer_game(&g))
            }
            "live_lanes" => ok(self.live_lanes(&store)?),

            // ---------------------------------------------------------- export & post
            "setup_status" => ok(self.setup_status(&store)?),
            "demo_create" => {
                let variant: Variant = opt(&a, "variant").unwrap_or_default();
                ok(self.demo_create(&store, variant)?)
            }
            "export_checklist" => ok(self.export_checklist(&store, &arg::<String>(&a, "id")?)?),
            "export_defaults" => {
                let id: String = arg(&a, "id")?;
                ok(self.export_defaults(&store, &id)?)
            }
            "export_run" => {
                let id: String = arg(&a, "id")?;
                let o: ExportOptions = arg(&a, "options")?;
                let loaded_files = self.pgn_files(&id);
                let out = self.ws.tournament_dir(&id).join("export");
                let r = export::export(&loaded_files, &o, &out)?;
                let s = store.settings()?;
                if !s.output_dir.is_empty() && opt::<bool>(&a, "copy_to_output").unwrap_or(false) {
                    let od = Path::new(&s.output_dir);
                    std::fs::create_dir_all(od)?;
                    std::fs::copy(&r.pgn_path, od.join(Path::new(&r.pgn_path).file_name().unwrap()))?;
                    if let Some(z) = &r.zip_path {
                        std::fs::copy(z, od.join(Path::new(z).file_name().unwrap()))?;
                    }
                }
                store.push_event("success", "exported", Some(&id), &format!("CCRL export: {} games, {} duplicates dropped", r.games, r.duplicates_dropped))?;
                ok(r)
            }
            "forum_post" => {
                let id: String = arg(&a, "id")?;
                let kind: PostKind = opt(&a, "kind").unwrap_or(PostKind::Finished);
                let tpl: Option<String> = opt(&a, "template");
                ok(self.forum_post(&store, &id, kind, tpl.as_deref())?)
            }

            // ---------------------------------------------------------- engines
            "engines_list" => ok(store.engines()?),
            "engine_save" => {
                let mut e: EngineEntry = arg(&a, "engine")?;
                if e.display_name.is_empty() {
                    e.display_name = crate::names::display_name(&e.engine, &e.version);
                }
                e.refresh_options();
                let id = store.save_engine(&e)?;
                ok(store.engine(id)?)
            }
            "engine_delete" => {
                store.delete_engine(arg(&a, "id")?)?;
                ok(true)
            }
            "engine_verify" => {
                let id: i64 = arg(&a, "id")?;
                let mut e = store.engine(id)?.context("engine not found")?;
                if e.path.is_empty() {
                    bail!("no executable: this entry only holds metadata");
                }
                let v = engines::verify(Path::new(&e.path), opt(&a, "depth").unwrap_or(12), std::time::Duration::from_secs(120));
                engines::apply_verify(&mut e, &v);
                store.save_engine(&e)?;
                store.push_event(if v.ok { "success" } else { "error" }, "engine_verified", None, &format!("{}: {}", e.display_name, e.verify_detail))?;
                ok(json!({"engine": e, "result": v}))
            }
            "cutechess_scan" => {
                let (source, list) = self.cutechess_read(&a)?;
                let lib = store.engines()?;
                let engines: Vec<Value> = list
                    .into_iter()
                    .map(|c| {
                        let have = lib.iter().any(|e| e.display_name.eq_ignore_ascii_case(c.name.trim()));
                        let mut v = serde_json::to_value(&c).unwrap_or_default();
                        v["in_library"] = json!(have);
                        v
                    })
                    .collect();
                ok(json!({"source": source, "engines": engines}))
            }
            "cutechess_import" => ok(self.cutechess_import(&store, &a)?),
            "engine_add_local" => {
                let path: PathBuf = arg(&a, "path")?;
                ok(self.add_local(&store, &path, opt(&a, "engine"), opt(&a, "version"))?)
            }
            "engines_report" => {
                let host = sysinfo::System::host_name().unwrap_or_default();
                ok(engines::report_markdown(&store.engines()?, &host))
            }
            "engines_import_report" => {
                let report: PathBuf = arg(&a, "report")?;
                let uci: Option<PathBuf> = opt(&a, "uci_dir");
                let text = std::fs::read_to_string(&report)?;
                let lib = engines::rebuild_from_report(&text, uci.as_deref());
                let existing = store.engines()?;
                let mut added = 0;
                for mut e in lib {
                    if let Some(old) = existing.iter().find(|x| x.display_name == e.display_name) {
                        e.id = old.id;
                        e.path = old.path.clone();
                        e.dir = old.dir.clone();
                    } else {
                        added += 1;
                    }
                    e.added_at = crate::store::now();
                    store.save_engine(&e)?;
                }
                ok(json!({"added": added}))
            }
            "github_releases" => {
                let r = crate::github::parse_repo(&arg::<String>(&a, "url")?).context("not a GitHub repository URL")?;
                let s = store.settings()?;
                let token = s.github_token.clone();
                let rels = crate::github::list_releases(&r.owner, &r.repo, Some(&token))?;
                let os: crate::assets::TargetOs = opt(&a, "os").unwrap_or_else(crate::assets::TargetOs::current);
                let policy = request_policy(&s, &a);
                let latest = crate::github::latest_stable(&rels).map(|x| x.tag.clone());
                let with_sel: Vec<Value> = rels
                    .iter()
                    .map(|rel| json!({"release": rel, "selection": crate::assets::select_with(&rel.assets.iter().map(|x| x.name.clone()).collect::<Vec<_>>(), os, policy)}))
                    .collect();
                ok(json!({"repo": r, "latest_stable": latest, "releases": with_sel, "policy": policy}))
            }
            "github_install" => ok(self.github_install(&store, &a)?),
            "known_repos" => {
                ensure_ccrl_snapshots(&store)?;
                let engines = store.engines()?;
                let lists = store.ccrl_lists()?;
                let blitz: Vec<&ccrl::CcrlEntry> = lists.iter().filter(|l| l.list == "Blitz").flat_map(|l| l.entries.iter()).collect();
                let mut v = crate::catalog::known_repos();
                for r in v.iter_mut() {
                    r.installed = engines.iter().any(|e| crate::catalog::is_family(&e.display_name, &r.ccrl_name) || e.source_url.to_lowercase().contains(&format!("github.com/{}", r.repo.to_lowercase())));
                    r.blitz = blitz.iter().filter(|e| crate::catalog::is_family(&e.name, &r.ccrl_name)).max_by(|a, b| a.rating.total_cmp(&b.rating)).map(|e| (e.name.clone(), e.rating));
                }
                ok(v)
            }
            "job_status" => ok(self.jobs.lock().unwrap().get(&arg::<String>(&a, "id")?).cloned()),
            "fastchess_install" => {
                let s = store.settings()?;
                let (p, sha) = crate::fastchess::install(&self.ws.tools_dir(), &s.fastchess_version, Some(&s.github_token))?;
                store.push_event("success", "fastchess_installed", None, &format!("fastchess {} installed ({sha})", s.fastchess_version))?;
                ok(json!({"path": p, "sha256": sha}))
            }

            // ---------------------------------------------------------- CCRL
            "ccrl_lists" => ok(store.ccrl_lists()?),
            "engines_ccrl" => {
                let lists = store.ccrl_lists()?;
                let aliases: HashMap<String, String> = store.aliases()?.into_iter().map(|(a, c, _)| (a, c)).collect();
                let engines: Vec<(i64, String)> = store.engines()?.into_iter().filter_map(|e| Some((e.id?, e.display_name))).collect();
                let when = lists.iter().map(|l| l.fetched_at.clone()).max().unwrap_or_default();
                ok(json!({"ratings": ccrl::engine_ratings(&lists, &aliases, &engines), "fetched_at": when}))
            }
            "ccrl_sources" => ok(ccrl::default_sources()),
            "ccrl_fetch" => {
                let src: ccrl::ListSource = arg(&a, "source")?;
                let others = store.ccrl_lists()?;
                let l = ccrl::fetch_avoiding(&src, &others).map_err(|e| anyhow::anyhow!("{e}. The bundled snapshot of the list stays in use; a saved page (.html) can be imported by hand"))?;
                store.save_ccrl_list(&l)?;
                ok(json!({"entries": l.entries.len(), "source": l.source}))
            }
            "ccrl_fetch_all" => {
                // every list in turn; a list that cannot be downloaded keeps what it has
                let mut done = Vec::new();
                let mut failed = Vec::new();
                // the lists downloaded in this run: a page with the same rows as one of them is
                // another list served at the wrong address
                let mut fetched: Vec<ccrl::CcrlList> = Vec::new();
                for src in ccrl::default_sources() {
                    match ccrl::fetch_avoiding(&src, &fetched) {
                        Ok(l) => {
                            store.save_ccrl_list(&l)?;
                            fetched.push(l.clone());
                            done.push(json!({"list": src.list, "variant": src.variant, "entries": l.entries.len()}));
                        }
                        Err(e) => failed.push(json!({"list": src.list, "variant": src.variant, "error": e.to_string()})),
                    }
                }
                store.push_event(if failed.is_empty() { "success" } else { "warn" }, "ccrl_fetched", None, &format!("CCRL lists: {} downloaded, {} not reachable", done.len(), failed.len()))?;
                ok(json!({"done": done, "failed": failed}))
            }
            "ccrl_load_snapshot" => {
                let mut n = 0;
                for l in ccrl::snapshot_lists() {
                    store.save_ccrl_list(&l)?;
                    n += 1;
                }
                ok(n)
            }
            "ccrl_import_text" => {
                let text: String = arg(&a, "text")?;
                let entries = if text.contains("<tr") { ccrl::parse_html(&text) } else { ccrl::parse_text(&text) };
                if entries.is_empty() {
                    bail!("no rating rows recognised");
                }
                let l = CcrlList { id: None, list: arg(&a, "list")?, cpu: opt(&a, "cpu").unwrap_or_else(|| "mixed".into()), variant: opt(&a, "variant").unwrap_or_else(|| "all".into()), source: "manual import".into(), fetched_at: crate::store::now(), entries };
                store.save_ccrl_list(&l)?;
                ok(json!({"entries": l.entries.len()}))
            }
            "ccrl_delete_list" => {
                store.conn.execute("DELETE FROM ccrl_entries WHERE list_id=?1", [arg::<i64>(&a, "id")?])?;
                store.conn.execute("DELETE FROM ccrl_lists WHERE id=?1", [arg::<i64>(&a, "id")?])?;
                ok(true)
            }
            "ccrl_match" => {
                let q: String = arg(&a, "name")?;
                let lists = store.ccrl_lists()?;
                let names: Vec<String> = lists.iter().flat_map(|l| l.entries.iter().map(|e| e.name.clone())).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
                ok(crate::names::best_matches(&q, &names, 6))
            }
            "aliases_list" => ok(store.aliases()?),
            "alias_set" => {
                store.set_alias(&arg::<String>(&a, "alias")?, &arg::<String>(&a, "canonical")?, "user")?;
                ok(true)
            }
            "alias_delete" => {
                store.delete_alias(&arg::<String>(&a, "alias")?)?;
                ok(true)
            }
            "ccrl_suggest" => {
                let lists = store.ccrl_lists()?;
                let inst = store.engines()?;
                ok(ccrl::suggest(&lists, &arg::<String>(&a, "list")?, arg(&a, "cpus")?, opt(&a, "top").unwrap_or(30), &inst, opt(&a, "threads").unwrap_or(1), opt(&a, "only_installed").unwrap_or(false), &opt::<Vec<String>>(&a, "exclude").unwrap_or_default()))
            }
            "ccrl_ratings" => {
                let lists = store.ccrl_lists()?;
                let s = store.settings()?;
                let aliases: HashMap<String, String> = store.aliases()?.into_iter().map(|(a, c, _)| (a, c)).collect();
                let idx = RatingIndex::new(&lists, &arg::<String>(&a, "list")?, aliases, s.default_cpu_gap);
                let names: Vec<String> = arg(&a, "names")?;
                let cpus: u32 = arg(&a, "cpus")?;
                ok(names.iter().map(|n| idx.rating(n, cpus)).collect::<Vec<_>>())
            }
            "ccrl_thresholds" => {
                let lists = store.ccrl_lists()?;
                let list: String = arg(&a, "list")?;
                let cpus: u32 = arg(&a, "cpus")?;
                let opps: Vec<(f64, u32)> = arg(&a, "opponents")?;
                let ranks: Vec<i64> = arg(&a, "ranks")?;
                let entries: Vec<&ccrl::CcrlEntry> = lists.iter().filter(|l| l.list.eq_ignore_ascii_case(&list)).flat_map(|l| l.entries.iter()).filter(|e| e.cpus() == cpus).collect();
                // ranks inside the CPU category
                let mut cat: Vec<ccrl::CcrlEntry> = entries.iter().map(|e| (*e).clone()).collect();
                cat.sort_by(|a, b| b.rating.partial_cmp(&a.rating).unwrap());
                for (i, e) in cat.iter_mut().enumerate() {
                    e.rank = i as i64 + 1;
                }
                let refs: Vec<&ccrl::CcrlEntry> = cat.iter().collect();
                ok(ccrl::thresholds(&opps, &refs, &ranks))
            }

            // ---------------------------------------------------------- bench & TC
            "tc_presets" => ok(crate::tc::presets()),
            "chess960_book" => {
                let spec: crate::chess960::BookSpec = opt(&a, "spec").unwrap_or_default();
                let dir = store.settings()?.books_dir;
                let path = crate::chess960::write_book(Path::new(&dir), &spec)?;
                let positions = crate::chess960::book_positions(&spec).len();
                ok(json!({"path": path.to_string_lossy(), "positions": positions}))
            }
            "tc_compute" => {
                let n: crate::tc::NominalTc = arg(&a, "nominal")?;
                let f: f64 = arg(&a, "factor")?;
                let bf: Option<String> = opt(&a, "base_formula");
                let inf: Option<String> = opt(&a, "inc_formula");
                ok(crate::tc::compute(&n, f, bf.as_deref(), inf.as_deref())?)
            }
            "bench_binaries" => {
                let dir = self.ws.tools_dir().join("stockfish-10");
                let mut found = bench::find_binaries(&dir);
                if let Some(extra) = opt::<String>(&a, "dir") {
                    found.extend(bench::find_binaries(Path::new(&extra)));
                }
                ok(json!({"dir": dir, "binaries": found}))
            }
            "bench_prepare" => {
                let dir = self.ws.tools_dir().join("stockfish-10");
                // the Stockfish 10 builds shipped with TorsGUI: no download needed
                if let Some(b) = crate::bundled::dir() {
                    let mut copied = 0;
                    for e in crate::bundled::list(&b)?.into_iter().filter(|e| e.present && e.engine == "Stockfish" && e.role != "engine") {
                        crate::bundled::copy(&b, &e, &dir)?;
                        copied += 1;
                    }
                    if copied > 0 {
                        return ok(bench::find_binaries(&dir));
                    }
                }
                if !cfg!(windows) {
                    bail!("the official Stockfish 10 binaries in CCRL_ScirptsTests are Windows builds: on Linux select a 64-bit Stockfish 10 built from the sf_10 sources");
                }
                ok(bench::ensure_sf10_windows(&dir)?)
            }
            "bundled_list" => ok(self.bundled_list(&store)?),
            // ---------------------------------------------------------- live broadcast
            "broadcast_get" => {
                let id: String = arg(&a, "id")?;
                let t = store.tournament(&id)?.context("tournament not found")?;
                let tdir = self.ws.tournament_dir(&id);
                let s = store.settings()?;
                let lanes = (t.config.nodes.len() as u32 * t.config.lanes_per_node).max(1);
                ok(json!({
                    "config": crate::broadcast::read_config(&tdir),
                    "state": crate::broadcast::read_state(&tdir),
                    "running": t.state == TState::Running && runner::is_running(&tdir),
                    "lichess_token": !s.lichess_token.trim().is_empty(),
                    "first_port": s.ccrl_live_port,
                    "last_port": s.ccrl_live_port.saturating_add(lanes as u16 - 1),
                    "lanes": lanes,
                }))
            }
            "broadcast_set" => {
                let id: String = arg(&a, "id")?;
                store.tournament(&id)?.context("tournament not found")?;
                let tdir = self.ws.tournament_dir(&id);
                let mut c = crate::broadcast::read_config(&tdir);
                if let Some(v) = opt::<bool>(&a, "lichess") {
                    if v && store.settings()?.lichess_token.trim().is_empty() {
                        bail!("no Lichess token saved: open Settings → Live broadcast, paste the token, press Check (it saves it) or Save settings");
                    }
                    c.lichess = v;
                }
                if let Some(v) = opt::<bool>(&a, "ccrl_live") {
                    c.ccrl_live = v;
                }
                crate::broadcast::write_config(&tdir, &c)?;
                ok(c)
            }
            "lichess_check" => {
                let token: String = opt(&a, "token").filter(|t: &String| !t.trim().is_empty()).unwrap_or(store.settings()?.lichess_token);
                if token.trim().is_empty() {
                    bail!("no Lichess token");
                }
                ok(crate::broadcast::lichess_account(token.trim())?)
            }
            "public_ip" => {
                let (st, ip) = crate::github::get_page("https://api.ipify.org")?;
                if st != 200 {
                    bail!("api.ipify.org returned HTTP {st}");
                }
                ok(ip.trim().to_string())
            }
            "firewall_allow_udp" => {
                // Windows: an inbound rule for the ccrl.live ports (asks for administrator rights)
                let from: u16 = arg(&a, "from")?;
                let to: u16 = arg(&a, "to")?;
                if !cfg!(windows) {
                    bail!("on Linux open UDP ports {from}-{to} in your firewall (e.g. sudo ufw allow {from}:{to}/udp)");
                }
                let rule = format!("advfirewall firewall add rule name=\"TorsGUI ccrl.live\" dir=in action=allow protocol=UDP localport={from}-{to}");
                let mut cmd = std::process::Command::new("powershell");
                cmd.args(["-NoProfile", "-Command", &format!("Start-Process netsh -ArgumentList '{rule}' -Verb RunAs -WindowStyle Hidden")]);
                crate::platform::no_window(&mut cmd);
                let out = cmd.output()?;
                if !out.status.success() {
                    bail!("netsh: {}", String::from_utf8_lossy(&out.stderr));
                }
                ok(true)
            }
            "books_bundled" => {
                let s = store.settings()?;
                match crate::bundled::books_dir() {
                    Some(d) => ok(json!({"dir": d, "books": crate::bundled::books(&d, Path::new(&s.books_dir))?})),
                    None => ok(json!({"dir": null, "books": []})),
                }
            }
            "books_install" => {
                let d = crate::bundled::books_dir().context("this installation has no bundled opening books")?;
                let mut s = store.settings()?;
                let only: Option<Vec<String>> = opt(&a, "files");
                let installed = crate::bundled::install_books(&d, Path::new(&s.books_dir), only.as_deref())?;
                // a default book is needed by every tournament: propose the newest AVT book
                let mut default_set = false;
                if s.default_book.is_empty() || !Path::new(&s.default_book).exists() {
                    let p = Path::new(&s.books_dir).join(crate::bundled::DEFAULT_BOOK);
                    if p.exists() {
                        s.default_book = p.to_string_lossy().to_string();
                        store.save_settings(&s)?;
                        default_set = true;
                    }
                }
                store.push_event("success", "books_installed", None, &format!("{} opening books installed in {}", installed.len(), s.books_dir))?;
                ok(json!({"installed": installed, "default_book": s.default_book, "default_set": default_set}))
            }
            "books_list" => {
                // books usable by fastchess in the books folder (and the default book)
                let s = store.settings()?;
                let mut files: Vec<PathBuf> = std::fs::read_dir(&s.books_dir).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default();
                if !s.default_book.is_empty() && Path::new(&s.default_book).exists() && !files.iter().any(|f| f == Path::new(&s.default_book)) {
                    files.push(PathBuf::from(&s.default_book));
                }
                let mut v: Vec<Value> = files
                    .into_iter()
                    .filter(|p| matches!(p.extension().map(|x| x.to_string_lossy().to_lowercase()).as_deref(), Some("pgn" | "epd")))
                    .map(|p| {
                        let text = crate::pgn::read_text(&p).unwrap_or_default();
                        let epd = p.extension().map(|x| x.eq_ignore_ascii_case("epd")).unwrap_or(false);
                        let n = if epd { text.lines().filter(|l| !l.trim().is_empty()).count() } else { text.lines().filter(|l| l.starts_with("[Event ")).count() };
                        json!({"path": p.to_string_lossy(), "name": p.file_name().unwrap_or_default().to_string_lossy(), "positions": n, "default": p.to_string_lossy() == s.default_book})
                    })
                    .collect();
                v.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
                ok(v)
            }
            "bundled_install" => ok(self.bundled_install(&store)?),
            "bench_start" => {
                let cfg: BenchConfig = arg(&a, "config")?;
                {
                    let mut p = self.bench.lock().unwrap();
                    if p.running {
                        bail!("a bench is already running");
                    }
                    *p = BenchProgress { running: true, phase: "starting".into(), ..Default::default() };
                }
                let prog = self.bench.clone();
                let ws = self.ws.clone();
                std::thread::spawn(move || {
                    let r = bench::run(&cfg, prog.clone());
                    let mut p = prog.lock().unwrap();
                    p.running = false;
                    match r {
                        Ok(run) => {
                            if let Ok(s) = ws.open() {
                                let _ = s.save_bench(&run.host, &serde_json::to_value(&run).unwrap());
                                let _ = s.push_event("success", "bench_finished", None, &format!("bench finished on {}", run.host));
                            }
                            p.phase = "done".into();
                            p.result = Some(run);
                        }
                        Err(e) => {
                            p.phase = "failed".into();
                            p.error = Some(format!("{e:#}"));
                        }
                    }
                });
                ok(true)
            }
            "bench_progress" => ok(self.bench.lock().unwrap().clone()),
            "bench_history" => {
                let v: Vec<Value> = store.bench_runs()?.into_iter().map(|(id, host, at, d)| json!({"id": id, "host": host, "created_at": at, "run": d})).collect();
                ok(v)
            }
            "bench_import" => {
                let files: Vec<PathBuf> = arg(&a, "files")?;
                let mut n = 0;
                for f in files {
                    let name = f.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    let r: BenchRun = bench::import_py_json(&std::fs::read_to_string(&f)?, &name)?;
                    store.save_bench(&r.host, &serde_json::to_value(&r)?)?;
                    n += 1;
                }
                ok(n)
            }
            "bench_delete" => {
                store.delete_bench(arg(&a, "id")?)?;
                ok(true)
            }

            // ---------------------------------------------------------- logs & maintenance
            "logs_list" => {
                let id: String = arg(&a, "id")?;
                let d = self.ws.tournament_dir(&id);
                let mut v: Vec<Value> = walkdir::WalkDir::new(&d)
                    .max_depth(3)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file())
                    .filter(|e| {
                        let n = e.file_name().to_string_lossy();
                        n.ends_with(".log") || n.ends_with(".txt")
                    })
                    .map(|e| json!({"path": e.path(), "name": e.path().strip_prefix(&d).unwrap_or(e.path()), "bytes": e.metadata().map(|m| m.len()).unwrap_or(0), "modified": e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string())}))
                    .collect();
                v.sort_by(|a, b| b["modified"].as_str().cmp(&a["modified"].as_str()));
                ok(v)
            }
            "log_tail" => {
                let p: PathBuf = arg(&a, "path")?;
                self.guard_path(&p)?;
                let max: u64 = opt(&a, "bytes").unwrap_or(64 * 1024);
                let mut f = std::fs::File::open(&p)?;
                let len = f.metadata()?.len();
                use std::io::{Read, Seek};
                f.seek(std::io::SeekFrom::Start(len.saturating_sub(max)))?;
                let mut buf = Vec::new();
                f.read_to_end(&mut buf)?;
                ok(json!({"text": String::from_utf8_lossy(&buf), "size": len}))
            }
            "housekeeping" => ok(crate::maintenance::housekeeping(&self.ws, &store)?),
            "rotate_logs" => {
                let days: u32 = opt(&a, "days").unwrap_or(store.settings()?.log_retention_days);
                let (n, b) = crate::maintenance::rotate_logs(&self.ws, &store, days)?;
                ok(json!({"files": n, "bytes": b}))
            }
            "git_sync" => {
                let s = store.settings()?;
                let dest: String = opt(&a, "dest").unwrap_or(s.git_sync_dir);
                ok(crate::maintenance::git_sync(&self.ws, &store, Path::new(&dest), opt::<String>(&a, "message").as_deref())?)
            }
            "register_logon_resume" => self.register_logon_resume(),
            _ => bail!("unknown command '{cmd}'"),
        }
    }

    fn tfile_parse(&self, store: &crate::store::Store, text: &str) -> Result<(crate::tournament_file::FileImport, WizardPreview)> {
        let f = crate::tournament_file::parse(text)?;
        let s = store.settings()?;
        let engines = store.engines()?;
        let lists = store.ccrl_lists()?;
        let aliases: HashMap<String, String> = store.aliases()?.into_iter().map(|(a, c, _)| (a, c)).collect();
        let list = f.list.clone().unwrap_or_else(|| "Blitz".into());
        let idx = RatingIndex::new(&lists, &list, aliases, s.default_cpu_gap);
        let rating = |n: &str, t: u32| {
            let r = idx.rating(n, t);
            (r.rating, r.estimated)
        };
        let topo = crate::platform::os().topology();
        let env = crate::tournament_file::Env { engines: &engines, settings: &s, nodes: topo.nodes.iter().map(|n| (n.id, n.physical_cores)).collect(), rating: &rating };
        let mut imp = crate::tournament_file::build(&f, &env);
        if let Some(c) = imp.config.as_mut() {
            if c.variant == Variant::Chess960 && c.book.is_empty() {
                let spec = crate::chess960::BookSpec::default();
                let path = crate::chess960::write_book(Path::new(&s.books_dir), &spec)?;
                c.book = path.to_string_lossy().to_string();
                c.book_format = "epd".into();
                imp.warnings.push(format!("Chess960 book: all 960 start positions (shuffled, seed {}), both colours each: {}", spec.seed, c.book));
            }
        }
        let preview = imp.config.as_ref().map(|c| self.preview(c)).unwrap_or_default();
        Ok((imp, preview))
    }

    /// Files served to the UI must be inside the workspace or inside a PGN file/folder the
    /// user added to the game archive.
    fn guard_path(&self, p: &Path) -> Result<()> {
        let root = self.ws.root.canonicalize().unwrap_or(self.ws.root.clone());
        let pc = p.canonicalize().with_context(|| format!("{}", p.display()))?;
        if pc.starts_with(&root) {
            return Ok(());
        }
        let archive = self.ws.open().and_then(|s| s.settings()).map(|s| s.archive_paths).unwrap_or_default();
        if archive.iter().filter_map(|a| Path::new(a).canonicalize().ok()).any(|a| pc.starts_with(&a)) {
            return Ok(());
        }
        bail!("path outside the workspace and the game archive")
    }

    /// Every PGN the archive can show: the tournaments' files and the user's archive paths.
    fn archive_sources(&self, store: &crate::store::Store) -> Result<Vec<ArchiveSource>> {
        let mut v = Vec::new();
        for t in store.tournaments()? {
            let files = self.pgn_files(&t.id);
            if files.is_empty() {
                continue;
            }
            let games = self.loaded(store, &t.id).map(|l| l.games.len() as u32).unwrap_or(0);
            v.push(ArchiveSource { kind: "tournament".into(), id: t.id.clone(), label: t.name.clone(), path: self.ws.pgn_dir(&t.id).to_string_lossy().into(), files: files.len() as u32, games, state: Some(t.state) });
        }
        for a in store.settings()?.archive_paths {
            let p = PathBuf::from(&a);
            let files = if p.is_dir() { pgn::list_pgns(&p) } else if p.is_file() { vec![p.clone()] } else { vec![] };
            for f in files {
                let games = pgn::read_games(&f).map(|g| g.len() as u32).unwrap_or(0);
                let label = f.file_name().unwrap_or_default().to_string_lossy().to_string();
                v.push(ArchiveSource { kind: "file".into(), id: f.to_string_lossy().into(), label, path: f.to_string_lossy().into(), files: 1, games, state: None });
            }
        }
        Ok(v)
    }

    pub fn pgn_files(&self, id: &str) -> Vec<PathBuf> {
        pgn::list_pgns(&self.ws.pgn_dir(id))
    }

    /// Games of a tournament, cached until a PGN file changes.
    fn loaded(&self, _store: &crate::store::Store, id: &str) -> Result<Arc<analysis::Loaded>> {
        let files = self.pgn_files(id);
        let sig: String = files
            .iter()
            .map(|p| {
                let m = std::fs::metadata(p).ok();
                format!("{}:{}:{:?};", p.display(), m.as_ref().map(|m| m.len()).unwrap_or(0), m.and_then(|m| m.modified().ok()))
            })
            .collect();
        if let Some((s, l)) = self.cache.lock().unwrap().get(id) {
            if *s == sig {
                return Ok(l.clone());
            }
        }
        let l = Arc::new(analysis::load(&files)?);
        self.cache.lock().unwrap().insert(id.to_string(), (sig, l.clone()));
        Ok(l)
    }

    fn progress(&self, t: &TournamentRecord, games: Option<&[Game]>) -> Progress {
        let expected = t.expected_games;
        let done = t.done_games.min(expected.max(t.done_games));
        let lanes = (t.config.lanes_per_node * t.config.nodes.len().max(1) as u32).max(1);
        let mut p = Progress { done, expected, pct: if expected > 0 { 100.0 * done as f64 / expected as f64 } else { 0.0 }, lanes, ..Default::default() };
        if let Some(gs) = games {
            let durs: Vec<u64> = gs.iter().filter_map(|g| g.duration_s()).filter(|d| *d > 0).collect();
            if !durs.is_empty() {
                p.avg_game_s = Some(durs.iter().sum::<u64>() as f64 / durs.len() as f64);
            }
        }
        // rolling window: games finished during the last hour of runner samples
        if let Some(st) = &t.status {
            if let Some(pr) = st["progress"].as_array() {
                let pts: Vec<(i64, i64)> = pr.iter().filter_map(|x| Some((x[0].as_i64()?, x[1].as_i64()?))).collect();
                if let Some(last) = pts.last() {
                    let from = pts.iter().find(|(ts, _)| last.0 - ts <= 3600).copied().unwrap_or(pts[0]);
                    let dt = (crate::store::now_ts().max(last.0) - from.0) as f64;
                    if dt > 120.0 && last.1 > from.1 {
                        p.rate_per_hour = Some((last.1 - from.1) as f64 / dt * 3600.0);
                    }
                }
            }
        }
        if p.rate_per_hour.is_none() {
            let per_game = p.avg_game_s.unwrap_or_else(|| crate::tc::estimate_game_seconds(&t.config.tc, 60.0));
            if per_game > 0.0 {
                p.rate_per_hour = Some(3600.0 / per_game * lanes as f64);
            }
        }
        let remaining = expected.saturating_sub(done) as f64;
        if let Some(r) = p.rate_per_hour.filter(|r| *r > 0.0) {
            let eta = remaining / r * 3600.0;
            p.eta_s = Some(eta);
            p.eta_at = Some((chrono::Local::now() + chrono::Duration::seconds(eta as i64)).format("%Y-%m-%d %H:%M").to_string());
        }
        p
    }

    fn summary(&self, t: TournamentRecord, with_games: bool) -> TournamentSummary {
        let alive = runner::is_running(&self.ws.tournament_dir(&t.id));
        let seed = t.config.seeds().first().map(|p| p.name.clone()).unwrap_or_default();
        let loaded = if with_games || t.status.is_none() || t.state == TState::Running { self.ws.open().ok().and_then(|s| self.loaded(&s, &t.id).ok()) } else { None };
        let mut t = t;
        if let Some(l) = &loaded {
            // PGNs are the source of truth
            let expected: std::collections::HashSet<pgn::SlotKey> = scheduler::known_jobs(&t.config, &games_results(&l.games)).iter().map(|j| j.slot()).collect();
            let n = l.games.iter().filter(|g| g.finished()).filter(|g| g.slot().map(|s| expected.contains(&s)).unwrap_or(false)).count() as u32;
            t.done_games = if n == 0 { l.games.iter().filter(|g| g.finished()).count() as u32 } else { n };
        }
        let progress = self.progress(&t, loaded.as_ref().map(|l| l.games.as_slice()));
        let score_line = loaded.as_ref().map(|l| {
            let st = analysis::tournament_standings(&t.config, l, None, RowOrder::Config);
            forum::result_line(&st)
        });
        TournamentSummary { record: t, progress, runner_alive: alive, seed, score_line }
    }

    fn detail(&self, store: &crate::store::Store, id: &str, order: RowOrder) -> Result<Value> {
        let t = store.tournament(id)?.context("tournament not found")?;
        let loaded = self.loaded(store, id)?;
        let mut st = analysis::tournament_standings(&t.config, &loaded, None, order);
        st.decisive.truncate(200);
        let done: std::collections::HashSet<pgn::SlotKey> = loaded.games.iter().filter(|g| g.finished()).filter_map(|g| g.slot()).collect();
        let open_pairs = crate::stats::open_pairs(&done);
        let lanes: Vec<runner::LaneStatus> = t.status.as_ref().and_then(|s| serde_json::from_value(s["lanes"].clone()).ok()).unwrap_or_default();
        let warnings: Vec<String> = t.status.as_ref().and_then(|s| serde_json::from_value(s["warnings"].clone()).ok()).unwrap_or_default();
        let per_pair = t.config.games_per_pairing.min(if t.config.passes > 0 { t.config.games_per_pairing / t.config.passes * t.config.effective_play_passes() } else { 0 });
        let (pairings, stages) = if t.config.kind.is_dynamic() {
            // Swiss / knockout: the matches of the rounds known so far
            let s = scheduler::staged(&t.config, &games_results(&loaded.games));
            let p = s.view.stages.iter().flat_map(|st| st.matches.iter().filter_map(move |m| m.b.as_ref().map(|b| (format!("R{} {}", st.number, m.a), b.clone(), m.played, m.total)))).collect();
            (p, Some(s.view))
        } else {
            let p = scheduler::pairings(&t.config)
                .into_iter()
                .map(|(a, b)| {
                    let n = loaded.games.iter().filter(|g| g.finished() && ((g.white() == a.name && g.black() == b.name) || (g.white() == b.name && g.black() == a.name))).count() as u32;
                    (a.name, b.name, n, per_pair)
                })
                .collect();
            (p, None)
        };
        let summary = self.summary(t, true);
        ok(TournamentDetail { summary, standings: st, open_pairs, lanes, warnings, pairings, stages })
    }

    fn dashboard(&self, store: &crate::store::Store) -> Result<Value> {
        let ts = store.tournaments()?;
        let summaries: Vec<TournamentSummary> = ts.into_iter().map(|t| self.summary(t, false)).collect();
        // ETA timeline: running first, then the queue in order
        let mut timeline = Vec::new();
        let mut cursor = chrono::Local::now();
        for s in summaries.iter().filter(|s| s.record.state == TState::Running) {
            let end = cursor + chrono::Duration::seconds(s.progress.eta_s.unwrap_or(0.0) as i64);
            timeline.push(TimelineItem { id: s.record.id.clone(), name: s.record.name.clone(), state: s.record.state, start: s.record.started_at.clone().unwrap_or_default(), end: end.format("%Y-%m-%dT%H:%M:%S").to_string(), estimated: true });
            if end > cursor {
                cursor = end;
            }
        }
        let mut queue: Vec<&TournamentSummary> = summaries.iter().filter(|s| s.record.state == TState::Queued).collect();
        queue.sort_by_key(|s| s.record.queue_pos);
        for s in &queue {
            let start = cursor;
            let end = start + chrono::Duration::seconds(s.progress.eta_s.unwrap_or(0.0) as i64);
            timeline.push(TimelineItem { id: s.record.id.clone(), name: s.record.name.clone(), state: s.record.state, start: start.format("%Y-%m-%dT%H:%M:%S").to_string(), end: end.format("%Y-%m-%dT%H:%M:%S").to_string(), estimated: true });
            cursor = end;
        }
        let queue_eta = if timeline.is_empty() { None } else { Some(cursor.format("%Y-%m-%d %H:%M").to_string()) };
        let health = crate::health::collect(&self.ws, &mut self.sys.lock().unwrap());
        let events = store.recent_events(15, None)?;
        ok(json!({"tournaments": summaries, "timeline": timeline, "queue_eta": queue_eta, "health": health, "events": events}))
    }

    pub fn preview(&self, cfg: &TournamentConfig) -> WizardPreview {
        let mut p = WizardPreview::default();
        if cfg.participants.len() < 2 {
            p.errors.push("select at least two engines".into());
        }
        if matches!(cfg.kind, TournamentKind::Gauntlet | TournamentKind::MultiGauntlet) && cfg.seeds().is_empty() {
            p.errors.push("select the engine under test (seed)".into());
        }
        if cfg.kind == TournamentKind::Match && cfg.participants.len() != 2 {
            p.errors.push("a match needs exactly two engines".into());
        }
        if cfg.kind.is_dynamic() && cfg.participants.len() < 3 {
            p.errors.push(format!("a {} needs at least three engines (two engines: use a match)", kind_label(cfg.kind)));
        }
        if cfg.kind == TournamentKind::Swiss && cfg.passes as usize >= cfg.participants.len().max(2) {
            p.warnings.push(format!("{} rounds for {} engines: some engines will meet twice (at most {} rounds without rematches)", cfg.passes, cfg.participants.len(), cfg.participants.len().saturating_sub(1)));
        }
        let rpp = crate::model::rounds_per_pass_for(cfg.kind, cfg.games_per_pairing, cfg.passes, cfg.nodes.len().max(1) as u32);
        match rpp {
            Ok(r) => {
                if r != cfg.rounds_per_pass {
                    p.warnings.push(format!("rounds per pass should be {r:?}"));
                }
            }
            Err(e) => p.errors.push(e),
        }
        let pairs = scheduler::pairings(cfg);
        p.pairings = pairs.len() as u32;
        p.games_per_pairing = cfg.games_per_pairing;
        let jobs = if p.errors.is_empty() { scheduler::all_jobs(cfg) } else { vec![] };
        // Swiss / knockout: the first round is known, the total is nominal (no tiebreaks)
        p.total_games = if cfg.kind.is_dynamic() && p.errors.is_empty() { scheduler::expected_games(cfg) as u32 } else { jobs.len() as u32 };
        p.rounds_per_pass = cfg.rounds_per_pass.clone();
        p.openings_used = jobs.iter().map(|j| j.opening).collect::<std::collections::BTreeSet<_>>().len() as u32;
        p.last_opening = jobs.iter().map(|j| j.opening).max().unwrap_or(0);
        if cfg.kind.is_dynamic() && p.errors.is_empty() {
            let n = cfg.participants.len() as u32;
            p.pairings = if cfg.kind == TournamentKind::Swiss { scheduler::stage_count(cfg) * (n / 2) } else { n - 1 };
            p.openings_used = p.total_games / 2;
            p.last_opening = scheduler::last_opening_dynamic(cfg);
            let per_round = if cfg.kind == TournamentKind::Swiss { (n / 2) * cfg.games_per_pairing } else { (n.next_power_of_two() / 2) * cfg.games_per_pairing };
            let lanes = cfg.lanes_per_node * cfg.nodes.len().max(1) as u32;
            if lanes > per_round {
                p.warnings.push(format!("{lanes} lanes but at most {per_round} games per round: some lanes stay idle (each round starts when the previous one is finished)"));
            }
        }
        let topo = crate::platform::os().topology();
        p.concurrent_games = cfg.lanes_per_node * cfg.nodes.len().max(1) as u32;
        p.busy_threads = p.concurrent_games * cfg.threads;
        p.physical_cores = cfg.nodes.iter().map(|n| topo.node(*n).map(|x| x.physical_cores).unwrap_or(0)).sum::<u32>();
        for n in &cfg.nodes {
            if topo.node(*n).is_none() {
                p.warnings.push(format!("NUMA node {n} does not exist on this machine"));
            }
        }
        if p.physical_cores > 0 && p.concurrent_games * cfg.threads * 2 > p.physical_cores {
            p.warnings.push(format!("{} lanes x 2 engines x {} threads = {} threads for {} physical cores (ponder is off: one engine thinks at a time, but hash and startup overlap)", p.concurrent_games, cfg.threads, p.concurrent_games * cfg.threads * 2, p.physical_cores));
        }
        if p.physical_cores > 0 && p.busy_threads > p.physical_cores {
            p.errors.push(format!("{} busy threads exceed the {} physical cores of the selected nodes", p.busy_threads, p.physical_cores));
        }
        let mut sys = self.sys.lock().unwrap();
        sys.refresh_memory();
        p.ram_total_mb = sys.total_memory() / 1024 / 1024;
        p.ram_needed_mb = crate::health::ram_needed_mb(p.concurrent_games, cfg.hash_mb);
        if p.ram_total_mb > 0 && p.ram_needed_mb as f64 > p.ram_total_mb as f64 * 0.85 {
            p.errors.push(format!("estimated RAM {} MB exceeds 85 % of the {} MB installed (fastchess keeps both engines alive)", p.ram_needed_mb, p.ram_total_mb));
        }
        if cfg.hash_mb != 512 * cfg.threads {
            p.warnings.push(format!("hash {} MB differs from the CCRL rule 512 MB x {} threads = {} MB", cfg.hash_mb, cfg.threads, 512 * cfg.threads));
        }
        if cfg.book.is_empty() || !Path::new(&cfg.book).exists() {
            p.warnings.push("opening book not found on this machine".into());
        }
        for pp in &cfg.participants {
            if !Path::new(&pp.cmd).exists() {
                p.warnings.push(format!("{}: executable not found ({})", pp.name, pp.cmd));
            }
        }
        let frc = cfg.variant == Variant::Chess960;
        if frc && !cfg.book.to_lowercase().ends_with(".epd") {
            p.errors.push("Chess960 needs a book of start positions (.epd): generate one (all 960 positions, a random set or double Chess960)".into());
        }
        if let Ok(store) = self.ws.open() {
            for pp in &cfg.participants {
                if let Some(e) = pp.engine_id.and_then(|id| store.engine(id).ok().flatten()) {
                    if e.flags.iter().any(|f| f == NOT_CCRL_FLAG) {
                        p.warnings.push(format!("{}: AVX-512 build (personal option): the results are not valid for CCRL", pp.name));
                    }
                    p.warnings.extend(engines::check_options(&pp.name, &pp.options, &e.options, &pp.dir));
                    if frc && !e.chess960 {
                        if e.options.is_empty() {
                            p.warnings.push(format!("{}: UCI options unknown (verify the engine): Chess960 support not confirmed", pp.name));
                        } else {
                            p.errors.push(format!("{} does not support Chess960 (no UCI_Chess960 option)", pp.name));
                        }
                    }
                }
            }
        }
        p.est_game_s = crate::tc::estimate_game_seconds(&cfg.tc, 60.0);
        p.eta_s = p.est_game_s * p.total_games as f64 / p.concurrent_games.max(1) as f64;
        if let Some(j) = jobs.first() {
            let args = crate::fastchess::game_args(cfg, &scheduler::job_pair(cfg, j).unwrap_or_else(|| pairs[j.pairing].clone()), j, Path::new("pgn/node0_lane0.pgn"), Path::new("logs/games/<game>.log"), Path::new("logs/games/<game>.json"));
            p.first_command = format!("fastchess {}", args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" "));
            p.event_example = j.event(&cfg.event);
        }
        p
    }

    fn bundled_list(&self, store: &crate::store::Store) -> Result<Value> {
        let Some(dir) = crate::bundled::dir() else {
            return ok(json!({"dir": null, "engines": []}));
        };
        let lib = store.engines()?;
        let mut v = crate::bundled::list(&dir)?;
        for e in v.iter_mut() {
            let name = crate::names::display_name(&e.engine, &e.version);
            e.installed = lib.iter().any(|x| (!e.sha256.is_empty() && x.sha256 == e.sha256) || (x.display_name == name && x.asset == e.file && Path::new(&x.path).exists()));
        }
        ok(json!({"dir": dir, "engines": v}))
    }

    /// Installs the bundled engines: Stockfish 10 for the bench, and the engines into the
    /// engines folder and the library (verified like any local engine).
    fn bundled_install(&self, store: &crate::store::Store) -> Result<Value> {
        let dir = crate::bundled::dir().context("this installation has no bundled engines")?;
        let s = store.settings()?;
        let lib = store.engines()?;
        let mut added = Vec::new();
        let mut bench = 0;
        for e in crate::bundled::list(&dir)?.into_iter().filter(|e| e.present) {
            if e.engine == "Stockfish" && e.role != "engine" {
                crate::bundled::copy(&dir, &e, &self.ws.tools_dir().join("stockfish-10"))?;
                bench += 1;
            }
            if e.role == "bench" {
                continue;
            }
            let name = crate::names::display_name(&e.engine, &e.version);
            if lib.iter().any(|x| (!e.sha256.is_empty() && x.sha256 == e.sha256) || (x.display_name == name && x.asset == e.file && Path::new(&x.path).exists())) {
                continue;
            }
            let folder = crate::pgn::slug(&format!("{}_{}", e.engine, e.version));
            let path = crate::bundled::copy(&dir, &e, &Path::new(&s.engines_dir).join(folder))?;
            let mut entry = self.add_local(store, &path, Some(e.engine.clone()), Some(e.version.clone()))?;
            entry.build = e.build.clone();
            entry.asset = e.file.clone();
            entry.release_url = e.release_url.clone();
            entry.source_url = e.source_url.clone();
            entry.release_tag = format!("v{}", e.version);
            entry.selection_reason = format!("bundled with TorsGUI: {}", e.note);
            entry.flags.retain(|f| !f.contains("flagged") && !f.ends_with(" build"));
            store.save_engine(&entry)?;
            store.push_event("success", "engine_added", None, &format!("{} added from the engines bundled with TorsGUI ({})", entry.display_name, entry.verify_status))?;
            added.push(entry.display_name.clone());
        }
        ok(json!({"added": added, "bench_binaries": bench}))
    }

    fn setup_status(&self, store: &crate::store::Store) -> Result<crate::demo::SetupStatus> {
        use crate::demo::SetupStep;
        let s = store.settings()?;
        let fc = crate::fastchess::resolve("", &s.fastchess_path, &self.ws.tools_dir(), &s.fastchess_version);
        let engines = store.engines()?;
        let real: Vec<&EngineEntry> = engines.iter().filter(|e| e.notes != crate::demo::DEMO_NOTE).collect();
        let verified = real.iter().filter(|e| e.verify_status == "ok" && !e.path.is_empty()).count();
        let bench = store.bench_runs()?.into_iter().filter_map(|(_, _, at, d)| serde_json::from_value::<crate::bench::BenchRun>(d).ok().map(|r| (at, r))).filter(|(_, r)| r.valid).last();
        let lists = store.ccrl_lists()?;
        let tournaments = store.tournaments()?;
        let is_demo = |t: &TournamentRecord| t.config.participants.first().and_then(|p| p.uci_id.as_deref()) == Some("TorsGUI Demo Engine");
        let own = tournaments.iter().filter(|t| !t.imported && !is_demo(t)).count();
        let book_ok = !s.default_book.is_empty() && Path::new(&s.default_book).exists();
        let steps = vec![
            SetupStep { id: "tester".into(), done: !s.tester_name.trim().is_empty() && !s.site.trim().is_empty(), detail: if s.tester_name.trim().is_empty() { "no tester name yet".into() } else { format!("{} · {}", s.tester_name, if s.site.is_empty() { "no site" } else { &s.site }) } },
            SetupStep { id: "fastchess".into(), done: fc.exists(), detail: if fc.exists() { crate::fastchess::version_of(&fc).unwrap_or_else(|_| fc.to_string_lossy().to_string()) } else { "not installed".into() } },
            SetupStep { id: "folders".into(), done: book_ok, detail: if book_ok { format!("book {}", Path::new(&s.default_book).file_name().unwrap_or_default().to_string_lossy()) } else { "no default opening book".into() } },
            SetupStep { id: "bench".into(), done: bench.is_some(), detail: bench.map(|(at, r)| format!("latest bench {} ({})", &at[..10.min(at.len())], r.cpu)).unwrap_or_else(|| "no bench yet".into()) },
            SetupStep { id: "engines".into(), done: verified >= 2, detail: format!("{verified} verified engine(s) in the library") },
            SetupStep { id: "ccrl".into(), done: !lists.is_empty(), detail: if lists.is_empty() { "no list imported".into() } else { format!("{} list(s): {}", lists.len(), lists.iter().map(|l| l.list.clone()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ")) } },
            SetupStep { id: "tournament".into(), done: own > 0, detail: format!("{own} tournament(s) of your own") },
        ];
        let done = steps.iter().filter(|x| x.done).count() as u32;
        let demos = tournaments.iter().filter(|t| is_demo(t)).map(|t| (t.id.clone(), t.name.clone(), format!("{:?}", t.state).to_lowercase())).collect();
        let bundled_books = crate::bundled::books_dir().and_then(|d| crate::bundled::books(&d, Path::new(&s.books_dir)).ok()).map(|v| v.iter().filter(|b| b.fastchess).count() as u32).unwrap_or(0);
        let bundled = crate::bundled::dir().and_then(|d| crate::bundled::list(&d).ok()).map(|v| v.into_iter().filter(|e| e.present).map(|e| format!("{} {}", e.engine, e.version)).collect::<std::collections::BTreeSet<_>>().into_iter().collect()).unwrap_or_default();
        Ok(crate::demo::SetupStatus { total: steps.len() as u32, steps, done, demo_engine: crate::demo::engine_path().is_some(), fastchess: fc.exists(), demos, bundled, bundled_books })
    }

    /// Creates the demo gauntlet (and the demo engines in the library) and starts it.
    fn demo_create(&self, store: &crate::store::Store, variant: Variant) -> Result<Value> {
        let s = store.settings()?;
        let fc = crate::fastchess::resolve("", &s.fastchess_path, &self.ws.tools_dir(), &s.fastchess_version);
        if !fc.exists() {
            bail!("fastchess is not installed yet: step 2 (Settings → fastchess → Download)");
        }
        let exe = crate::demo::engine_path().context("the demo engine is not part of this build")?;
        let mut ids = Vec::new();
        for (name, ver, strength, movetime) in crate::demo::DEMO_ENGINES {
            let display = crate::names::display_name(name, ver);
            let existing = store.engines()?.into_iter().find(|e| e.display_name == display && e.notes == crate::demo::DEMO_NOTE && Path::new(&e.path).exists());
            let id = match existing {
                Some(e) => e.id,
                None => {
                    let mut e = self.add_local(store, &exe, Some(name.to_string()), Some(ver.to_string()))?;
                    e.notes = crate::demo::DEMO_NOTE.into();
                    e.used = false;
                    e.default_options.insert("Strength".into(), strength.to_string());
                    e.default_options.insert("MoveTime".into(), movetime.to_string());
                    store.save_engine(&e)?;
                    e.id
                }
            };
            ids.push(id);
        }
        let dir = self.ws.root.join("demo");
        let book = if variant == Variant::Chess960 { crate::chess960::write_book(&dir, &crate::chess960::BookSpec::default())? } else { crate::demo::write_openings(&dir)? };
        let topo = crate::platform::os().topology();
        let (node, cores) = topo.nodes.first().map(|n| (n.id, n.physical_cores)).unwrap_or((0, 2));
        let cfg = crate::demo::tournament(&exe, &ids, variant, &book, node, (cores / 2).clamp(1, 2));
        let rec = TournamentRecord::new(cfg);
        store.insert_tournament(&rec)?;
        std::fs::create_dir_all(self.ws.pgn_dir(&rec.id))?;
        std::fs::write(self.ws.tournament_dir(&rec.id).join("config.json"), serde_json::to_string_pretty(&rec.config)?)?;
        store.push_event("info", "tournament_created", Some(&rec.id), &format!("{} created (demo, {} games)", rec.name, rec.expected_games))?;
        store.enqueue(&rec.id)?;
        let busy = store.tournaments()?.into_iter().any(|t| t.id != rec.id && t.state == TState::Running && runner::is_running(&self.ws.tournament_dir(&t.id)));
        let started = !busy;
        if started {
            store.set_desired(&rec.id, Desired::Run)?;
            runner::launch(&self.ws, &rec.id, s.use_task_scheduler)?;
        }
        ok(json!({"id": rec.id, "started": started}))
    }

    fn export_checklist(&self, store: &crate::store::Store, id: &str) -> Result<crate::checklist::Checklist> {
        let t = store.tournament(id)?.context("not found")?;
        let loaded = self.loaded(store, id)?;
        let st = analysis::tournament_standings(&t.config, &loaded, None, RowOrder::Config);
        let summary = self.summary(t.clone(), true);
        let s = store.settings()?;
        let engines: Vec<Option<EngineEntry>> = t.config.participants.iter().map(|p| p.engine_id.and_then(|id| store.engine(id).ok().flatten())).collect();
        // the latest valid bench: its factor range over the levels
        let bench = store
            .bench_runs()?
            .into_iter()
            .filter_map(|(_, _, at, d)| serde_json::from_value::<crate::bench::BenchRun>(d).ok().map(|r| (at, r)))
            .filter(|(_, r)| r.valid && !r.levels.is_empty())
            .last()
            .map(|(at, r)| {
                let f: Vec<f64> = r.levels.iter().map(|l| l.factor).filter(|f| f.is_finite() && *f > 0.0).collect();
                (at, f.iter().cloned().fold(f64::INFINITY, f64::min), f.iter().cloned().fold(0.0, f64::max))
            })
            .filter(|(_, lo, hi)| lo.is_finite() && *hi > 0.0);
        let lists = store.ccrl_lists()?;
        let in_list = if lists.iter().any(|l| l.list == t.config.ccrl_list) {
            let aliases: HashMap<String, String> = store.aliases()?.into_iter().map(|(a, c, _)| (a, c)).collect();
            let idx = RatingIndex::new(&lists, &t.config.ccrl_list, aliases, s.default_cpu_gap);
            t.config.opponents().iter().map(|p| {
                let r = idx.rating(&p.name, t.config.threads);
                (p.name.clone(), r.rating.is_some() && !r.estimated)
            }).collect()
        } else {
            vec![]
        };
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        Ok(crate::checklist::check(&crate::checklist::Input {
            cfg: &t.config,
            standings: &st,
            done: summary.record.done_games,
            expected: t.expected_games,
            imported: t.imported,
            engines,
            tester: &s.tester_name,
            site: &s.site,
            bench,
            today: &today,
            in_list,
        }))
    }

    fn export_defaults(&self, store: &crate::store::Store, id: &str) -> Result<ExportOptions> {
        let t = store.tournament(id)?.context("not found")?;
        let s = store.settings()?;
        let seed = t.config.seeds().first().map(|p| p.name.clone()).or_else(|| t.config.participants.first().map(|p| p.name.clone())).unwrap_or_default();
        let (ccrl_names, name_sources) = self.ccrl_spellings(store, &t.config)?;
        Ok(ExportOptions {
            tester: s.tester_name.clone(),
            site: s.site.clone(),
            date: chrono::Local::now().format("%Y-%m-%d").to_string(),
            seed,
            players: t.config.participants.iter().map(|p| p.name.clone()).collect(),
            threads: t.config.threads,
            hash_mb: t.config.hash_mb,
            book: t.config.book_name(),
            egtb: t.config.syzygy_pieces(),
            make_zip: true,
            ccrl_names,
            name_sources,
        })
    }

    /// How CCRL writes each player of the tournament in its list (see `ccrl::list_spelling`).
    fn ccrl_spellings(&self, store: &crate::store::Store, cfg: &TournamentConfig) -> Result<(std::collections::BTreeMap<String, String>, std::collections::BTreeMap<String, String>)> {
        ensure_ccrl_snapshots(store)?;
        let lists = store.ccrl_lists()?;
        let aliases: HashMap<String, String> = store.aliases()?.into_iter().map(|(a, c, _)| (a, c)).collect();
        let list = if cfg.ccrl_list.is_empty() { "Blitz" } else { cfg.ccrl_list.as_str() };
        let mut names = std::collections::BTreeMap::new();
        let mut sources = std::collections::BTreeMap::new();
        for p in &cfg.participants {
            let (n, how) = ccrl::list_spelling(&lists, list, &aliases, &p.name).unwrap_or_else(|| (crate::names::ccrl_base(&p.name), "not in the CCRL lists: as in TorsGUI".into()));
            names.insert(p.name.clone(), n);
            sources.insert(p.name.clone(), how);
        }
        Ok((names, sources))
    }

    fn forum_post(&self, store: &crate::store::Store, id: &str, kind: PostKind, tpl: Option<&str>) -> Result<Value> {
        let t = store.tournament(id)?.context("not found")?;
        let loaded = self.loaded(store, id)?;
        let st = analysis::tournament_standings(&t.config, &loaded, None, RowOrder::Rating);
        let s = store.settings()?;
        let seed = st.seed.clone();
        let next = store.queue()?.into_iter().find(|q| q.id != id).map(|q| {
            let seed = q.config.seeds().first().map(|p| p.name.clone()).unwrap_or(q.name.clone());
            format!("{} {}CPU {}", seed, q.config.threads, kind_label(q.config.kind))
        });
        let opps = st.rows.len() as u32;
        let summary = self.summary(t.clone(), false);
        let per_opp = if opps > 0 { st.total.games / opps.max(1) } else { 0 };
        let c = PostContext {
            seed_export: crate::names::ccrl_name(self.ccrl_spellings(store, &t.config)?.0.get(&seed).unwrap_or(&seed), t.config.threads),
            kind_label: kind_label(t.config.kind).into(),
            total_games: st.total.games,
            expected_games: t.expected_games,
            opponents: if opps > 0 { opps } else { t.config.opponents().len() as u32 },
            games_per_opponent: if per_opp > 0 { per_opp } else { t.config.games_per_pairing },
            threads: t.config.threads,
            hash_mb: t.config.hash_mb,
            tc: t.config.tc.clone(),
            ccrl_list: if t.config.ccrl_list.is_empty() { "Blitz".into() } else { t.config.ccrl_list.clone() },
            book: t.config.book_name(),
            egtb: t.config.syzygy_pieces(),
            next,
            expected_finish: summary.progress.eta_at.clone(),
            engines: t.config.opponents().iter().map(|p| p.name.clone()).collect(),
        };
        let template = tpl.map(|x| x.to_string()).unwrap_or_else(|| match kind {
            PostKind::Finished => s.post_template_finished.clone(),
            PostKind::Announcement => s.post_template_announcement.clone(),
            PostKind::Progress => s.post_template_progress.clone(),
        });
        let text = forum::post(kind, Some(&template), &st, &c);
        ok(json!({"text": text, "template": template, "variables": forum::variables(&st, &c)}))
    }

    fn live_lanes(&self, store: &crate::store::Store) -> Result<Vec<LiveLane>> {
        let mut out = Vec::new();
        let mut trackers = self.live.lock().unwrap();
        let mut keep = std::collections::HashSet::new();
        for t in store.tournaments()? {
            if t.state != TState::Running {
                continue;
            }
            let lanes: Vec<runner::LaneStatus> = t.status.as_ref().and_then(|s| serde_json::from_value(s["lanes"].clone()).ok()).unwrap_or_default();
            for l in lanes {
                let game = match (&l.log_file, &l.job, l.busy) {
                    (Some(f), Some(j), true) => {
                        keep.insert(f.clone());
                        let tr = trackers.entry(f.clone()).or_insert_with(|| LiveTracker::new(Path::new(f), &j.white, &j.black));
                        Some(tr.update().clone())
                    }
                    _ => None,
                };
                let elapsed = l.started_at.map(|s| crate::store::now_ts() - s).filter(|_| l.busy);
                out.push(LiveLane { tournament_id: t.id.clone(), tournament: t.name.clone(), lane: l, game, elapsed_s: elapsed });
            }
        }
        trackers.retain(|k, _| keep.contains(k));
        Ok(out)
    }

    fn import_legacy(&self, store: &crate::store::Store, dir: &Path, results: Option<&Path>) -> Result<TournamentRecord> {
        let lt = crate::legacy::read(dir, results)?;
        let mut rec = TournamentRecord::new(lt.config.clone());
        rec.imported = true;
        let pdir = self.ws.pgn_dir(&rec.id);
        std::fs::create_dir_all(&pdir)?;
        for p in &lt.pgns {
            let name = format!("imported_{}", p.file_name().unwrap().to_string_lossy());
            std::fs::copy(p, pdir.join(name))?;
        }
        let loaded = analysis::load(&pgn::list_pgns(&pdir))?;
        let expected: std::collections::HashSet<pgn::SlotKey> = scheduler::all_jobs(&rec.config).iter().map(|j| j.slot()).collect();
        let done = loaded.games.iter().filter(|g| g.finished()).filter(|g| g.slot().map(|s| expected.contains(&s)).unwrap_or(false)).count() as u32;
        rec.done_games = done;
        if lt.pgns.is_empty() {
            // a configured but never started tournament: importable as a draft
            rec.imported = false;
            store.insert_tournament(&rec)?;
            std::fs::write(self.ws.tournament_dir(&rec.id).join("config.json"), serde_json::to_string_pretty(&rec.config)?)?;
            store.push_event("info", "tournament_imported", Some(&rec.id), &format!("{} imported as a draft (no games yet)", rec.name))?;
            return Ok(rec);
        }
        rec.state = if done >= rec.expected_games { TState::Completed } else { TState::Incomplete };
        rec.started_at = loaded.games.iter().filter_map(|g| g.headers.get("GameStartTime")).min().map(|s| s.to_string());
        rec.finished_at = if rec.state == TState::Completed { loaded.games.iter().map(|g| g.end_time().to_string()).max() } else { None };
        rec.last_error = if rec.state == TState::Incomplete { Some(format!("imported with {done} of {} games", rec.expected_games)) } else { None };
        store.insert_tournament(&rec)?;
        std::fs::write(self.ws.tournament_dir(&rec.id).join("config.json"), serde_json::to_string_pretty(&rec.config)?)?;
        store.push_event("info", "tournament_imported", Some(&rec.id), &format!("{} imported: {done} / {} games", rec.name, rec.expected_games))?;
        Ok(rec)
    }

    fn add_local(&self, store: &crate::store::Store, path: &Path, engine: Option<String>, version: Option<String>) -> Result<EngineEntry> {
        let v = engines::verify(path, 12, std::time::Duration::from_secs(120));
        let e = local_entry(path, engine, version, &v);
        let id = store.save_engine(&e)?;
        store.push_event(if v.ok { "success" } else { "warn" }, "engine_added", None, &format!("{} added ({})", e.display_name, e.verify_status))?;
        Ok(store.engine(id)?.unwrap())
    }

    /// Engines of a Cute Chess `engines.json` (the given file, pasted text or the usual places).
    fn cutechess_read(&self, a: &Value) -> Result<(String, Vec<crate::cutechess::CuteEngine>)> {
        if let Some(text) = opt::<String>(a, "text").filter(|t| !t.trim().is_empty()) {
            return Ok(("pasted text".into(), crate::cutechess::parse(&text)?));
        }
        let path = match opt::<String>(a, "path").filter(|p| !p.trim().is_empty()) {
            Some(p) => {
                let p = PathBuf::from(p.trim().trim_matches('"'));
                if p.is_dir() { p.join("engines.json") } else { p }
            }
            None => crate::cutechess::find().with_context(|| {
                format!("engines.json not found in the usual Cute Chess folders ({}): give its path", crate::cutechess::default_locations().iter().take(4).map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "))
            })?,
        };
        let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        Ok((path.to_string_lossy().to_string(), crate::cutechess::parse(&text)?))
    }

    /// Imports the chosen Cute Chess engines: each one is verified (4 at a time), keeps its
    /// arguments and the UCI options set in Cute Chess. Missing executables are added as
    /// metadata, to point to the binary later.
    fn cutechess_import(&self, store: &crate::store::Store, a: &Value) -> Result<Value> {
        let (_, list) = self.cutechess_read(a)?;
        let names: Vec<String> = arg(a, "names")?;
        // the same executable may be there twice with different settings: names tell them apart
        let existing = store.engines()?;
        let mut skipped = Vec::new();
        let mut todo = Vec::new();
        for c in list.into_iter().filter(|c| names.contains(&c.name)) {
            if c.protocol != "uci" {
                skipped.push(format!("{}: {}", c.name, c.note));
            } else if existing.iter().any(|e| e.display_name.eq_ignore_ascii_case(c.name.trim())) {
                skipped.push(format!("{}: already in the library", c.name));
            } else {
                todo.push(c);
            }
        }
        let results: Vec<(crate::cutechess::CuteEngine, Option<engines::VerifyResult>)> = std::thread::scope(|s| {
            let mut out = Vec::new();
            for chunk in todo.chunks(4) {
                let hs: Vec<_> = chunk.iter().map(|c| s.spawn(move || (c.clone(), c.exists.then(|| engines::verify(Path::new(&c.exe), 10, std::time::Duration::from_secs(60)))))).collect();
                out.extend(hs.into_iter().filter_map(|h| h.join().ok()));
            }
            out
        });
        let mut added = Vec::new();
        for (c, v) in results {
            let (en, ver) = crate::cutechess::split_name(&c.name);
            let mut e = match &v {
                Some(v) => local_entry(Path::new(&c.exe), Some(en), Some(ver), v),
                None => EngineEntry {
                    display_name: crate::names::display_name(&en, &ver),
                    engine: en,
                    version: ver,
                    path: c.exe.clone(),
                    dir: if c.working_dir.is_empty() { Path::new(&c.exe).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default() } else { c.working_dir.clone() },
                    asset: Path::new(&c.exe).file_name().unwrap_or_default().to_string_lossy().into(),
                    verify_status: "unverified".into(),
                    verify_detail: "executable not found on this computer: set it in Edit".into(),
                    added_at: crate::store::now(),
                    ..Default::default()
                },
            };
            if !c.working_dir.is_empty() {
                e.dir = c.working_dir.clone();
            }
            e.args = c.args.clone();
            e.default_options.extend(c.options.clone());
            e.selection_reason = "imported from Cute Chess (engines.json)".into();
            e.notes = format!("Cute Chess command: {}", c.command);
            let id = store.save_engine(&e)?;
            added.push(json!({"id": id, "name": e.display_name, "status": e.verify_status}));
        }
        store.push_event("success", "engines_imported", None, &format!("Cute Chess: {} engines imported, {} skipped", added.len(), skipped.len()))?;
        Ok(json!({"added": added, "skipped": skipped}))
    }

}

/// A library entry for an executable on disk, from its verification.
fn local_entry(path: &Path, engine: Option<String>, version: Option<String>, v: &engines::VerifyResult) -> EngineEntry {
    {
        let id_name = v.id_name.clone();
        let (e_name, e_ver) = match (engine, version) {
            (Some(e), Some(v)) => (e, v),
            _ => {
                let n = id_name.trim().to_string();
                match n.rsplit_once(' ') {
                    Some((e, v)) if v.chars().any(|c| c.is_ascii_digit()) => (e.to_string(), v.to_string()),
                    _ => (n.clone(), String::new()),
                }
            }
        };
        // a local file is the user's explicit choice: classify it with the personal policy so
        // that an AVX-512 build is recorded with its flag instead of silently unflagged
        let cls = crate::assets::classify_with(&path.file_name().unwrap_or_default().to_string_lossy(), crate::assets::TargetOs::current(), crate::assets::AssetPolicy::personal(false));
        let mut e = EngineEntry {
            display_name: crate::names::display_name(&e_name, &e_ver),
            engine: e_name,
            version: e_ver,
            path: path.to_string_lossy().into(),
            dir: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            asset: path.file_name().unwrap_or_default().to_string_lossy().into(),
            build: cls.build.clone(),
            arch: "x86-64".into(),
            added_at: crate::store::now(),
            selection_reason: "added from a local file".into(),
            ..Default::default()
        };
        if cls.flagged {
            e.flags.push(if cls.ccrl_ok { cls.reason.clone() } else { NOT_CCRL_FLAG.into() });
        }
        engines::apply_verify(&mut e, v);
        e
    }
}

impl App {

    fn github_install(&self, store: &crate::store::Store, a: &Value) -> Result<Value> {
        let url: String = arg(a, "url")?;
        let r = crate::github::parse_repo(&url).context("not a GitHub repository URL")?;
        let s = store.settings()?;
        let token = s.github_token.clone();
        let rels = crate::github::list_releases(&r.owner, &r.repo, Some(&token))?;
        let tag: Option<String> = opt(a, "tag").or(r.tag.clone());
        let rel = match &tag {
            Some(t) => rels.iter().find(|x| &x.tag == t).cloned().map(Ok).unwrap_or_else(|| crate::github::release_by_tag(&r.owner, &r.repo, t, Some(&token)))?,
            None => crate::github::latest_stable(&rels).cloned().context("no stable release")?,
        };
        let os = crate::assets::TargetOs::current();
        let policy = request_policy(&s, a);
        let names: Vec<String> = rel.assets.iter().map(|x| x.name.clone()).collect();
        let sel = crate::assets::select_with(&names, os, policy);
        let chosen: String = match opt::<String>(a, "asset") {
            Some(x) => x,
            None => sel.chosen.clone().with_context(|| format!("{} ({}): {}", r.repo, rel.tag, sel.reason))?,
        };
        // the verdict of the asset actually installed (the user may pick another one)
        let verdict = sel.verdicts.iter().find(|v| v.name == chosen).cloned().context("asset not in the release")?;
        if !verdict.accepted {
            bail!("{} cannot be used: {}", verdict.name, verdict.reason);
        }
        let asset = rel.assets.iter().find(|x| x.name == chosen).context("asset not in the release")?.clone();
        let folder = crate::pgn::slug(&format!("{}_{}", r.repo, rel.tag));
        let dir = Path::new(&s.engines_dir).join(&folder);
        std::fs::create_dir_all(&dir)?;
        let file = dir.join(&asset.name);
        crate::github::download(&asset.url, &file, Some(&token))?;
        if let Some(d) = &asset.digest {
            let got = engines::sha256_file(&file)?;
            if d.trim_start_matches("sha256:") != got {
                bail!("sha256 mismatch for {}: GitHub digest {d}, got {got}", asset.name);
            }
        }
        let mut reason = if sel.chosen.as_deref() == Some(chosen.as_str()) { sel.reason.clone() } else { format!("{}: {} (chosen manually)", verdict.name, verdict.reason) };
        let mut build = verdict.build.clone();
        let mut flagged = verdict.flagged;
        let mut ccrl_ok = verdict.ccrl_ok;
        let exe = if crate::assets::is_archive(&asset.name) {
            let files = crate::github::extract(&file, &dir)?;
            let inner: Vec<String> = files.iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
            let s2 = crate::assets::select_with(&inner, os, policy);
            let pick = s2.chosen.clone().with_context(|| format!("no suitable binary inside {}: {}", asset.name, s2.reason))?;
            reason = format!("{}; inside the archive: {}", reason, s2.reason);
            build = s2.build.clone();
            flagged = s2.flagged;
            ccrl_ok = s2.ccrl_ok && ccrl_ok;
            files.into_iter().find(|p| p.file_name().unwrap().to_string_lossy() == pick).unwrap()
        } else {
            file.clone()
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755));
        }
        // networks shipped separately
        let mut extra = Vec::new();
        for n in &sel.extra {
            if let Some(x) = rel.assets.iter().find(|x| &x.name == n) {
                crate::github::download(&x.url, &dir.join(&x.name), Some(&token))?;
                extra.push(x.name.clone());
            }
        }
        let v = engines::verify(&exe, 12, std::time::Duration::from_secs(120));
        let ver = rel.tag.trim_start_matches(['v', 'V']).to_string();
        let mut e = EngineEntry {
            display_name: crate::names::display_name(&r.repo, &ver),
            engine: r.repo.clone(),
            version: ver,
            path: exe.to_string_lossy().into(),
            dir: exe.parent().unwrap().to_string_lossy().into(),
            build,
            arch: "x86-64".into(),
            source_url: format!("https://github.com/{}/{}", r.owner, r.repo),
            release_url: rel.html_url.clone(),
            release_tag: rel.tag.clone(),
            asset: asset.name.clone(),
            selection_reason: reason,
            extra_files: extra,
            added_at: crate::store::now(),
            ..Default::default()
        };
        if !ccrl_ok {
            e.flags.push(NOT_CCRL_FLAG.into());
        } else if flagged {
            e.flags.push(format!("{} build", e.build));
        }
        engines::apply_verify(&mut e, &v);
        // a better display name from `id name` when it carries the version
        if v.uciok && v.id_name.contains(&e.version) {
            let n = v.id_name.split_whitespace().take_while(|w| !w.contains(&e.version)).collect::<Vec<_>>().join(" ");
            if !n.is_empty() {
                e.engine = n.trim_end_matches('-').trim().to_string();
                e.display_name = crate::names::display_name(&e.engine, &e.version);
            }
        }
        let id = store.save_engine(&e)?;
        store.push_event(if v.ok { "success" } else { "warn" }, "engine_added", None, &format!("{} installed from GitHub ({})", e.display_name, e.verify_status))?;
        ok(json!({"engine": store.engine(id)?, "verify": v, "selection": sel}))
    }

    fn register_logon_resume(&self) -> Result<Value> {
        #[cfg(windows)]
        {
            let exe = runner::runner_exe();
            let bat = self.ws.root.join("resume_runners.bat");
            let args = vec!["resume".to_string(), "--workspace".into(), self.ws.root.to_string_lossy().to_string()];
            std::fs::write(&bat, runner::runner_bat(&exe, &args))?;
            let mut c = std::process::Command::new("schtasks");
            c.args(["/create", "/tn", "TorsGUI\\Resume", "/tr", &format!("\"{}\"", bat.display()), "/sc", "onlogon", "/f"]);
            crate::platform::no_window(&mut c);
            let o = c.output()?;
            if !o.status.success() {
                bail!("schtasks: {}", String::from_utf8_lossy(&o.stderr));
            }
            return ok("Task 'TorsGUI\\Resume' registered (runs at logon)");
        }
        #[cfg(not(windows))]
        {
            let exe = runner::runner_exe();
            ok(format!(
                "Add to your crontab: @reboot {} resume --workspace '{}'  (or a systemd user unit)",
                exe.display(),
                self.ws.root.display()
            ))
        }
    }
}

/// White's score of every finished game with a slot.
fn games_results(games: &[Game]) -> scheduler::Results {
    scheduler::results_of(games.iter().filter_map(|g| g.slot().map(|k| (k, g.white_score()))))
}

pub fn kind_label(k: TournamentKind) -> &'static str {
    match k {
        TournamentKind::Gauntlet => "gauntlet",
        TournamentKind::MultiGauntlet => "multi-seed gauntlet",
        TournamentKind::RoundRobin => "round robin",
        TournamentKind::Match => "match",
        TournamentKind::Swiss => "swiss",
        TournamentKind::Knockout => "knockout",
    }
}

impl Default for TournamentRecord {
    fn default() -> Self {
        TournamentRecord::new(TournamentConfig {
            name: String::new(),
            kind: TournamentKind::Gauntlet,
            participants: vec![],
            games_per_pairing: 2,
            passes: 1,
            play_passes: None,
            nodes: vec![0],
            rounds_per_pass: vec![1],
            lanes_per_node: 1,
            concurrency: 1,
            threads: 1,
            hash_mb: 512,
            tc: String::new(),
            book: String::new(),
            book_format: "pgn".into(),
            book_start: 1,
            event: String::new(),
            site: String::new(),
            syzygy_path: String::new(),
            adjudication: Default::default(),
            extra_args: vec![],
            placement: Placement::Node,
            log_level: "info".into(),
            ccrl_list: String::new(),
            max_retries: 2,
            max_slot_attempts: 3,
            fastchess: String::new(),
            startup_ms: 60000,
            variant: crate::model::Variant::Standard,
        })
    }
}

/// Flag stored on engines installed with the personal AVX-512 option.
pub const NOT_CCRL_FLAG: &str = "AVX-512 build: personal use, not valid for CCRL";

/// The asset policy of a request: the settings, overridable per call (`allow_avx512`,
/// `prefer_avx512`) from the *Add from GitHub* dialog.
fn request_policy(s: &crate::store::Settings, a: &Value) -> crate::assets::AssetPolicy {
    let allow = opt::<bool>(a, "allow_avx512").unwrap_or(s.allow_avx512);
    let prefer = opt::<bool>(a, "prefer_avx512").unwrap_or(s.prefer_avx512);
    if allow { crate::assets::AssetPolicy::personal(prefer) } else { crate::assets::AssetPolicy::ccrl() }
}

fn game_row(g: &pgn::Game) -> GameRow {
    GameRow {
        index: g.index,
        source: g.source.to_string_lossy().to_string(),
        white: g.white().into(),
        black: g.black().into(),
        result: g.result().into(),
        termination: g.headers.get_or("Termination", "").into(),
        plies: g.plies().unwrap_or(0),
        end_time: g.end_time().into(),
        duration_s: g.duration_s(),
        opening: g.headers.get_or("Opening", "").into(),
        round: g.slot().map(|s| format!("n{} p{} r{}", s.node, s.pass, s.round)).unwrap_or_default(),
    }
}

/// The bundled CCRL lists are loaded for every list that has none yet (first start, or
/// after deleting the last one), so ratings and CCRL names work offline.
fn ensure_ccrl_snapshots(store: &crate::store::Store) -> Result<()> {
    let have: std::collections::HashSet<String> = store.conn.prepare("SELECT DISTINCT list FROM ccrl_lists")?.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<_, _>>()?;
    for l in ccrl::snapshot_lists() {
        if !have.contains(&l.list) {
            store.save_ccrl_list(&l)?;
        }
    }
    Ok(())
}

/// A game from pasted text: a PGN (the first game) or a FEN.
pub fn load_game_text(text: &str) -> Result<crate::live::ViewerGame> {
    let t = text.trim();
    if t.is_empty() {
        bail!("paste a PGN or a FEN");
    }
    let pgn_text = if !t.contains('[') && t.contains('/') && t.split_whitespace().count() <= 6 {
        crate::chess960::parse_fen(t)?;
        format!("[Event \"Position\"]\n[FEN \"{t}\"]\n[SetUp \"1\"]\n\n*\n")
    } else if t.contains('[') {
        t.to_string()
    } else {
        // bare movetext
        format!("[Event \"Game\"]\n\n{t}\n")
    };
    let games = pgn::parse_games(&pgn_text, Path::new("pasted.pgn"));
    let g = games.first().context("no game found in the text")?;
    let v = crate::live::viewer_game(g);
    if v.plies.is_empty() && v.error.is_some() {
        bail!("{}", v.error.unwrap_or_default());
    }
    Ok(v)
}

/// Opens a web address in the default browser.
fn open_in_browser(url: &str) -> Result<()> {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    } else if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    crate::platform::no_window(&mut cmd);
    cmd.spawn().with_context(|| format!("cannot open {url}"))?;
    Ok(())
}
