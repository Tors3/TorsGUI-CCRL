//! Health panel data: runners alive, fastchess/engine processes, free RAM,
//! CPU load and anomalies (loud warnings).

use crate::store::{TState, Workspace};
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Health {
    pub runners_expected: u32,
    pub runners_alive: u32,
    pub fastchess_processes: u32,
    pub engine_processes: u32,
    #[ts(type = "number")]
    pub total_ram_mb: u64,
    #[ts(type = "number")]
    pub free_ram_mb: u64,
    pub cpu_load_pct: f32,
    pub anomalies: Vec<Anomaly>,
    pub engine_crashes_24h: u32,
    pub time_forfeits_24h: u32,
    pub failed_games_session: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Anomaly {
    /// warn | error
    pub level: String,
    pub message: String,
    pub tournament_id: Option<String>,
}

pub fn collect(ws: &Workspace, sys: &mut System) -> Health {
    sys.refresh_specifics(RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()).with_cpu(sysinfo::CpuRefreshKind::nothing().with_cpu_usage()));
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut h = Health {
        total_ram_mb: sys.total_memory() / 1024 / 1024,
        free_ram_mb: sys.available_memory() / 1024 / 1024,
        cpu_load_pct: sys.global_cpu_usage(),
        ..Default::default()
    };
    let fc: Vec<sysinfo::Pid> = sys
        .processes()
        .iter()
        .filter(|(_, p)| p.name().to_string_lossy().to_lowercase().starts_with("fastchess"))
        .map(|(pid, _)| *pid)
        .collect();
    h.fastchess_processes = fc.len() as u32;
    h.engine_processes = sys.processes().values().filter(|p| p.parent().map(|pp| fc.contains(&pp)).unwrap_or(false)).count() as u32;
    let Ok(store) = ws.open() else { return h };
    let now = crate::store::now_ts();
    for t in store.tournaments().unwrap_or_default() {
        if t.state != TState::Running {
            continue;
        }
        h.runners_expected += 1;
        let alive = crate::runner::is_running(&ws.tournament_dir(&t.id));
        if alive {
            h.runners_alive += 1;
        } else {
            h.anomalies.push(Anomaly { level: "error".into(), message: format!("{}: marked running but no runner holds its lock (crash or reboot?) — resume it", t.name), tournament_id: Some(t.id.clone()) });
        }
        if alive && t.heartbeat.map(|hb| now - hb > 30).unwrap_or(true) {
            h.anomalies.push(Anomaly { level: "warn".into(), message: format!("{}: no heartbeat for more than 30 s", t.name), tournament_id: Some(t.id.clone()) });
        }
        if let Some(st) = &t.status {
            h.failed_games_session += st["failed_this_session"].as_u64().unwrap_or(0) as u32;
            for w in st["warnings"].as_array().cloned().unwrap_or_default() {
                if let Some(w) = w.as_str() {
                    h.anomalies.push(Anomaly { level: "warn".into(), message: format!("{}: {w}", t.name), tournament_id: Some(t.id.clone()) });
                }
            }
            let lanes = st["lanes"].as_array().map(|a| a.len()).unwrap_or(0) as u32;
            let busy = st["lanes"].as_array().map(|a| a.iter().filter(|l| l["busy"] == true).count()).unwrap_or(0) as u32;
            if alive && lanes > 0 && busy == 0 && st["queued"].as_u64().unwrap_or(0) > 0 {
                h.anomalies.push(Anomaly { level: "warn".into(), message: format!("{}: all lanes idle while games are queued", t.name), tournament_id: Some(t.id.clone()) });
            }
        }
    }
    let since = chrono::Local::now() - chrono::Duration::hours(24);
    let since = since.format("%Y-%m-%dT%H:%M:%S").to_string();
    for e in store.recent_events(2000, None).unwrap_or_default() {
        if e.ts < since {
            break;
        }
        match e.kind.as_str() {
            "engine_problem" => h.engine_crashes_24h += 1,
            "time_forfeit" => h.time_forfeits_24h += 1,
            _ => {}
        }
    }
    if h.engine_crashes_24h > 0 {
        h.anomalies.push(Anomaly { level: "warn".into(), message: format!("{} engine crashes / disconnects / illegal moves in the last 24 h", h.engine_crashes_24h), tournament_id: None });
    }
    if h.time_forfeits_24h > 0 {
        h.anomalies.push(Anomaly { level: "warn".into(), message: format!("{} time forfeits in the last 24 h", h.time_forfeits_24h), tournament_id: None });
    }
    if h.total_ram_mb > 0 && h.free_ram_mb * 10 < h.total_ram_mb {
        h.anomalies.push(Anomaly { level: "error".into(), message: format!("free RAM is low: {} MB of {} MB", h.free_ram_mb, h.total_ram_mb), tournament_id: None });
    }
    if h.runners_expected == 0 && h.fastchess_processes > 0 {
        h.anomalies.push(Anomaly { level: "warn".into(), message: format!("{} fastchess processes running but no tournament is running", h.fastchess_processes), tournament_id: None });
    }
    h
}

/// RAM check for the wizard: engines x (hash + overhead) per concurrent game.
pub fn ram_needed_mb(concurrent_games: u32, hash_mb: u32) -> u64 {
    concurrent_games as u64 * 2 * (hash_mb as u64 + 250)
}
