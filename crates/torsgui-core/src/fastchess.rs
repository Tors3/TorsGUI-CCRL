//! fastchess integration: the pinned release, the per-game command line
//! (one game per process: `-rounds 1 -games 1`, `-reverse` for the second
//! colour, `-openings ... order=sequential start=N`) and the managed download.
//! TorsGUI never uses `-config file=` resume (pitfall 2): it owns scheduling.

use crate::model::{Participant, TournamentConfig};
use crate::scheduler::Job;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

/// fastchess release TorsGUI downloads by default (the version used by the
/// reference CCRL setup). The user can point to another binary in Settings.
pub const PINNED_VERSION: &str = "v1.8.2-alpha";

/// sha256 of the pinned release assets. Filled when the release is vetted; an
/// asset missing here is accepted only if its sha256 matches the digest
/// published by GitHub for the asset, and the hash is recorded.
pub const PINNED_SHA256: &[(&str, &str)] = &[];

pub fn exe_name() -> &'static str {
    if cfg!(windows) {
        "fastchess.exe"
    } else {
        "fastchess"
    }
}

/// Managed location: `<workspace>/tools/fastchess/<version>/fastchess[.exe]`.
pub fn managed_path(tools_dir: &Path, version: &str) -> PathBuf {
    tools_dir.join("fastchess").join(version).join(exe_name())
}

pub fn resolve(cfg_override: &str, settings_path: &str, tools_dir: &Path, version: &str) -> PathBuf {
    if !cfg_override.is_empty() {
        return PathBuf::from(cfg_override);
    }
    if !settings_path.is_empty() {
        return PathBuf::from(settings_path);
    }
    managed_path(tools_dir, version)
}

pub fn version_of(bin: &Path) -> Result<String> {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("-version");
    crate::platform::no_window(&mut cmd);
    let out = cmd.output().with_context(|| format!("running {}", bin.display()))?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        bail!("{} printed no version", bin.display());
    }
    Ok(s)
}

fn supports(p: &Participant, opt: &str) -> bool {
    p.options.contains_key(opt) || (opt == "SyzygyPath" && p.has_syzygy)
}

/// `-engine cmd=... name=... dir=... option.K=V...` (run_node.py `engine_args`).
pub fn engine_args(p: &Participant, cfg: &TournamentConfig) -> Vec<String> {
    let mut a = vec!["-engine".into(), format!("cmd={}", p.cmd), format!("name={}", p.name), format!("dir={}", p.dir)];
    if !p.args.is_empty() {
        a.push(format!("args={}", p.args));
    }
    for (k, v) in &p.options {
        let v = v.replace("${THREADS}", &cfg.threads_of(p).to_string()).replace("${HASH}", &cfg.hash_of(p).to_string());
        a.push(format!("option.{k}={v}"));
    }
    if !cfg.syzygy_path.is_empty() && supports(p, "SyzygyPath") && !p.options.contains_key("SyzygyPath") {
        a.push(format!("option.SyzygyPath={}", cfg.syzygy_path));
    }
    a
}

/// Full argument list for one game.
pub fn game_args(cfg: &TournamentConfig, pairing: &(Participant, Participant), job: &Job, pgn_out: &Path, log_file: &Path, state_json: &Path) -> Vec<String> {
    let (ea, eb) = pairing;
    let mut a: Vec<String> = Vec::new();
    a.extend(engine_args(ea, cfg));
    a.extend(engine_args(eb, cfg));
    a.extend([
        "-each".into(),
        format!("tc={}", cfg.tc),
        "proto=uci".into(),
        "-openings".into(),
        format!("file={}", cfg.book),
        format!("format={}", cfg.book_format),
        "order=sequential".into(),
        format!("start={}", job.opening),
        "-rounds".into(),
        "1".into(),
        "-games".into(),
        "1".into(),
    ]);
    if job.reversed {
        // with -games 1 the first engine is White: -reverse swaps it
        a.push("-reverse".into());
    }
    if cfg.variant == crate::model::Variant::Chess960 {
        // fastchess then sends `setoption name UCI_Chess960 value true` to both engines
        a.extend(["-variant".into(), "fischerandom".into()]);
    }
    a.extend([
        "-concurrency".into(),
        "1".into(),
        "-recover".into(),
        "-autosaveinterval".into(),
        "0".into(),
        "-event".into(),
        job.event(&cfg.event),
        "-site".into(),
        cfg.site.clone(),
        "-pgnout".into(),
        format!("file={}", pgn_out.display()),
        "notation=san".into(),
        "append=true".into(),
        "nodes=true".into(),
        "nps=true".into(),
        "seldepth=true".into(),
        "timeleft=true".into(),
        "-log".into(),
        format!("file={}", log_file.display()),
        format!("level={}", cfg.log_level),
        "engine=true".into(),
        "append=true".into(),
        "-config".into(),
        format!("outname={}", state_json.display()),
        "-startup-ms".into(),
        cfg.startup_ms.to_string(),
    ]);
    a.extend(cfg.adjudication.args(&cfg.syzygy_path));
    a.extend(cfg.extra_args.iter().cloned());
    a
}

/// Asset of the fastchess release for this OS.
pub fn pick_asset(names: &[String]) -> Option<String> {
    let os = if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
    let mut c: Vec<&String> = names
        .iter()
        .filter(|n| {
            let l = n.to_lowercase();
            l.contains(os) && (l.contains("x86-64") || l.contains("x86_64") || l.contains("amd64")) && !l.contains("arm") && !l.contains("avx512")
        })
        .collect();
    c.sort_by_key(|n| n.len());
    c.first().map(|s| s.to_string())
}

/// Downloads and installs the pinned fastchess into the tools dir.
pub fn install(tools_dir: &Path, version: &str, token: Option<&str>) -> Result<(PathBuf, String)> {
    let rel = crate::github::release_by_tag("Disservin", "fastchess", version, token)?;
    let names: Vec<String> = rel.assets.iter().map(|a| a.name.clone()).collect();
    let asset_name = pick_asset(&names).with_context(|| format!("no fastchess asset for this OS in {names:?}"))?;
    let asset = rel.assets.iter().find(|a| a.name == asset_name).unwrap();
    let dest = managed_path(tools_dir, version);
    let dir = dest.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(&asset.name);
    crate::github::download(&asset.url, &file, token)?;
    let sha = crate::engines::sha256_file(&file)?;
    if let Some((_, want)) = PINNED_SHA256.iter().find(|(n, _)| *n == asset.name) {
        if *want != sha {
            bail!("sha256 mismatch for {}: expected {want}, got {sha}", asset.name);
        }
    } else if let Some(d) = &asset.digest {
        if d.trim_start_matches("sha256:") != sha {
            bail!("sha256 mismatch for {}: GitHub digest {d}, got {sha}", asset.name);
        }
    }
    crate::github::extract(&file, &dir)?;
    let found = walkdir::WalkDir::new(&dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy() == exe_name())
        .map(|e| e.path().to_path_buf())
        .context("fastchess binary not found in the archive")?;
    if found != dest {
        std::fs::copy(&found, &dest)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok((dest, sha))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Role, TournamentKind};
    use crate::scheduler::tests::cfg;
    #[test]
    fn args_like_run_node() {
        let mut c = cfg(TournamentKind::Gauntlet, &["Triumviratus 7.0"], &["Stockfish 19"], 30, 1, 2);
        c.threads = 8;
        c.hash_mb = 4096;
        c.tc = "103+1".into();
        c.event = "CCRL Blitz gauntlet Triumviratus 7.0 8CPU".into();
        c.site = "Milan".into();
        c.syzygy_path = r"C:\tb\syzygy\3-4-5".into();
        for p in c.participants.iter_mut() {
            p.options.insert("Threads".into(), "${THREADS}".into());
            p.options.insert("Hash".into(), "${HASH}".into());
            p.has_syzygy = p.role == Role::Seed;
        }
        let pairs = crate::scheduler::pairings(&c);
        let jobs = crate::scheduler::all_jobs(&c);
        let j = jobs.iter().find(|j| j.reversed).unwrap();
        let a = game_args(&c, &pairs[0], j, Path::new("pgn/node0_lane0.pgn"), Path::new("l.log"), Path::new("s.json"));
        let s = a.join(" ");
        assert!(s.starts_with("-engine cmd=/engines/Triumviratus 7.0 name=Triumviratus 7.0 dir=/engines option.Hash=4096 option.Threads=8 option.SyzygyPath=C:\\tb\\syzygy\\3-4-5 -engine cmd=/engines/Stockfish 19"));
        assert!(s.contains("-openings file=book.pgn format=pgn order=sequential start=1 -rounds 1 -games 1 -reverse -concurrency 1 -recover"));
        assert!(s.contains("-event CCRL Blitz gauntlet Triumviratus 7.0 8CPU node0 pass1 r1 -site Milan"));
        // an 8CPU seed against 1CPU opponents: each engine gets its own threads and hash
        let mut m = c.clone();
        m.threads = 1;
        m.hash_mb = 512;
        m.participants[0].threads = Some(8);
        m.participants[0].hash_mb = Some(4096);
        let s = game_args(&m, &(m.participants[0].clone(), m.participants[1].clone()), j, Path::new("p.pgn"), Path::new("l.log"), Path::new("s.json")).join(" ");
        assert!(s.contains("name=Triumviratus 7.0 dir=/engines option.Hash=4096 option.Threads=8"), "{s}");
        assert!(s.contains("name=Stockfish 19 dir=/engines option.Hash=512 option.Threads=1"), "{s}");
        assert_eq!(m.cores_per_lane(), 9);
        assert_eq!(m.cpu_label(), "8CPU vs 1CPU");
        assert!(s.ends_with("-draw movenumber=35 movecount=8 score=10 -resign movecount=4 score=600 twosided=true"));
        assert!(!s.contains("config file="), "never resume from fastchess state");
        assert_eq!(pick_asset(&["fastchess-windows-x86-64.zip".into(), "fastchess-linux-x86-64.tar".into(), "fastchess-macos-arm64.tar".into()]).is_some(), true);
    }
}
