//! Maintenance: renaming an engine consistently in a tournament (PGN White/
//! Black tags + configuration, like rename_engine.py), disk usage, log
//! rotation, unused / superseded engines and the optional git sync.

use crate::names::{compare_versions, family, version_of};
use crate::store::{Store, Workspace};
use anyhow::{bail, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct RenameReport {
    pub pgn_tags: u32,
    pub files: Vec<String>,
    pub config_changed: bool,
    pub dry_run: bool,
}

/// Renames the player `old` to `new` in the PGN White/Black tags (never
/// EngineWhiteName/EngineBlackName) and in the tournament configuration.
/// Refuses while the runner is alive. Backups `.bak` are written once.
pub fn rename_player(ws: &Workspace, store: &Store, id: &str, old: &str, new: &str, dry_run: bool) -> Result<RenameReport> {
    if crate::runner::is_running(&ws.tournament_dir(id)) {
        bail!("the tournament is running: pause or stop it first");
    }
    let Some(mut rec) = store.tournament(id)? else { bail!("tournament {id} not found") };
    if rec.config.participants.iter().any(|p| p.name == new) {
        bail!("'{new}' is already a participant");
    }
    let mut rep = RenameReport { dry_run, ..Default::default() };
    let pat = Regex::new(&format!(r#"(?m)^\[(White|Black) "{}"\]\r?$"#, regex::escape(old))).unwrap();
    for p in crate::pgn::list_pgns(&ws.pgn_dir(id)) {
        let text = String::from_utf8_lossy(&std::fs::read(&p)?).to_string();
        let n = pat.find_iter(&text).count() as u32;
        if n == 0 {
            continue;
        }
        rep.pgn_tags += n;
        rep.files.push(p.to_string_lossy().to_string());
        if !dry_run {
            let bak = p.with_extension("pgn.bak");
            if !bak.exists() {
                std::fs::copy(&p, &bak)?;
            }
            let out = pat.replace_all(&text, |c: &regex::Captures| {
                let eol = if c[0].ends_with('\r') { "\r" } else { "" };
                format!("[{} \"{}\"]{}", &c[1], new, eol)
            });
            std::fs::write(&p, out.as_bytes())?;
        }
    }
    if let Some(pp) = rec.config.participants.iter_mut().find(|p| p.name == old) {
        pp.name = new.to_string();
        rep.config_changed = true;
    }
    if !dry_run && rep.config_changed {
        let exp = crate::scheduler::expected_games(&rec.config) as u32;
        store.update_config(id, &rec.config, exp)?;
        store.push_event("info", "engine_renamed", Some(id), &format!("'{old}' renamed to '{new}' ({} PGN tags)", rep.pgn_tags))?;
    }
    Ok(rep)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct DiskUsage {
    pub path: String,
    #[ts(type = "number")]
    pub bytes: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Housekeeping {
    pub disk: Vec<DiskUsage>,
    pub unused_engines: Vec<String>,
    pub superseded_engines: Vec<(String, String)>,
    pub log_files: u32,
    #[ts(type = "number")]
    pub log_bytes: u64,
}

pub fn housekeeping(ws: &Workspace, store: &Store) -> Result<Housekeeping> {
    let mut h = Housekeeping::default();
    let tours = store.tournaments()?;
    for t in &tours {
        let d = ws.tournament_dir(&t.id);
        h.disk.push(DiskUsage { path: format!("tournaments/{}", t.id), bytes: crate::util::dir_size(&d) });
        for e in walkdir::WalkDir::new(d.join("logs")).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
            h.log_files += 1;
            h.log_bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    h.disk.push(DiskUsage { path: "tools".into(), bytes: crate::util::dir_size(&ws.tools_dir()) });
    h.disk.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    let engines = store.engines()?;
    let used_names: Vec<String> = tours.iter().flat_map(|t| t.config.participants.iter().map(|p| p.name.clone())).collect();
    let used_ids: Vec<i64> = tours.iter().flat_map(|t| t.config.participants.iter().filter_map(|p| p.engine_id)).collect();
    for e in &engines {
        if !used_names.contains(&e.display_name) && !e.id.map(|i| used_ids.contains(&i)).unwrap_or(false) {
            h.unused_engines.push(e.display_name.clone());
        }
        if let Some(newer) = engines.iter().find(|o| family(&o.display_name) == family(&e.display_name) && compare_versions(&version_of(&o.display_name), &version_of(&e.display_name)) == std::cmp::Ordering::Greater) {
            h.superseded_engines.push((e.display_name.clone(), newer.display_name.clone()));
        }
    }
    Ok(h)
}

/// Deletes per-game engine logs older than `days` of finished tournaments.
pub fn rotate_logs(ws: &Workspace, store: &Store, days: u32) -> Result<(u32, u64)> {
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(days as u64 * 86400);
    let (mut n, mut bytes) = (0, 0);
    for t in store.tournaments()? {
        if crate::runner::is_running(&ws.tournament_dir(&t.id)) {
            continue;
        }
        for e in walkdir::WalkDir::new(ws.logs_dir(&t.id).join("games")).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
            if let Ok(m) = e.metadata() {
                if m.modified().map(|t| t < cutoff).unwrap_or(false) {
                    bytes += m.len();
                    if std::fs::remove_file(e.path()).is_ok() {
                        n += 1;
                    }
                }
            }
        }
    }
    Ok((n, bytes))
}

/// Copies results and configurations to a user-chosen repository folder
/// (like sync_repo.py): `tournaments/<id>/config.json`, `results/<id>/*.pgn`.
pub fn git_sync(ws: &Workspace, store: &Store, dest: &Path, commit_message: Option<&str>) -> Result<Vec<String>> {
    if !dest.is_dir() {
        bail!("{} is not a folder", dest.display());
    }
    let mut copied = Vec::new();
    for t in store.tournaments()? {
        let td = dest.join("tournaments").join(&t.id);
        std::fs::create_dir_all(&td)?;
        std::fs::write(td.join("config.json"), serde_json::to_string_pretty(&t.config)?)?;
        copied.push(format!("tournaments/{}/config.json", t.id));
        let rd = dest.join("results").join(&t.id);
        for p in crate::pgn::list_pgns(&ws.pgn_dir(&t.id)) {
            std::fs::create_dir_all(&rd)?;
            let to = rd.join(p.file_name().unwrap());
            std::fs::copy(&p, &to)?;
            copied.push(format!("results/{}/{}", t.id, p.file_name().unwrap().to_string_lossy()));
        }
        let exports = ws.tournament_dir(&t.id).join("export");
        if exports.is_dir() {
            for e in std::fs::read_dir(&exports)?.filter_map(|e| e.ok()) {
                std::fs::create_dir_all(&rd)?;
                std::fs::copy(e.path(), rd.join(e.file_name()))?;
                copied.push(format!("results/{}/{}", t.id, e.file_name().to_string_lossy()));
            }
        }
    }
    if let Some(msg) = commit_message {
        let run = |args: &[&str]| -> Result<()> {
            let mut c = std::process::Command::new("git");
            c.args(args).current_dir(dest);
            crate::platform::no_window(&mut c);
            let o = c.output()?;
            if !o.status.success() {
                bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr));
            }
            Ok(())
        };
        run(&["add", "-A"])?;
        let _ = run(&["commit", "-m", msg]);
    }
    Ok(copied)
}
