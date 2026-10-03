//! Engines from Cute Chess: its `engines.json` (the list kept by the Cute Chess GUI, also
//! read by cutechess-cli `-engine conf=...`). Most CCRL testers come from Cute Chess, so
//! their engines, folders, arguments and UCI options are imported as they are.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// One engine of `engines.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CuteEngine {
    pub name: String,
    /// `command` as written in the file.
    pub command: String,
    pub working_dir: String,
    pub protocol: String,
    /// Executable resolved from the command and the working folder.
    pub exe: String,
    pub args: String,
    /// UCI options set in Cute Chess (Threads and Hash excluded: they come from the tournament).
    pub options: BTreeMap<String, String>,
    pub exists: bool,
    /// Why it cannot be imported as it is ("" = fine).
    pub note: String,
}

/// Where the Cute Chess GUI keeps `engines.json` (Qt application data folders).
pub fn default_locations() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for base in [dirs::data_local_dir(), dirs::data_dir(), dirs::config_dir()].into_iter().flatten() {
        for sub in ["cutechess/cutechess", "cutechess", "Cute Chess/cutechess", "Cute Chess"] {
            v.push(base.join(sub).join("engines.json"));
        }
    }
    if let Some(h) = dirs::home_dir() {
        v.push(h.join(".local/share/cutechess/engines.json"));
        v.push(h.join(".config/cutechess/engines.json"));
    }
    v.dedup();
    v
}

/// The first `engines.json` found in the usual places.
pub fn find() -> Option<PathBuf> {
    default_locations().into_iter().find(|p| p.is_file())
}

fn value_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Executable and arguments of a Cute Chess `command`: a quoted path, a path containing
/// spaces that exists, or the first word. Relative paths are read from `wd`.
pub fn split_command(command: &str, wd: &str) -> (PathBuf, String) {
    let c = command.trim();
    let resolve = |p: &str| {
        let p = PathBuf::from(p);
        if p.is_absolute() || wd.is_empty() { p } else { Path::new(wd).join(p) }
    };
    if let Some(rest) = c.strip_prefix('"') {
        if let Some(i) = rest.find('"') {
            return (resolve(&rest[..i]), rest[i + 1..].trim().to_string());
        }
    }
    // the longest prefix (cut at a space) that is an existing file
    let cuts: Vec<usize> = c.char_indices().filter(|(_, ch)| *ch == ' ').map(|(i, _)| i).chain([c.len()]).collect();
    for &i in cuts.iter().rev() {
        let p = resolve(&c[..i]);
        if p.is_file() {
            return (p, c[i..].trim().to_string());
        }
    }
    match c.split_once(' ') {
        Some((a, b)) => (resolve(a), b.trim().to_string()),
        None => (resolve(c), String::new()),
    }
}

/// Engines of an `engines.json` text.
pub fn parse(text: &str) -> Result<Vec<CuteEngine>> {
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).context("not a JSON file")?;
    let list = match &v {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("engines") {
            Some(Value::Array(a)) => a.clone(),
            _ => vec![v.clone()],
        },
        _ => bail!("engines.json must hold a list of engines"),
    };
    let mut out = Vec::new();
    for e in list {
        let s = |k: &str| e.get(k).and_then(value_str).unwrap_or_default();
        let name = s("name");
        let command = s("command");
        if name.is_empty() && command.is_empty() {
            continue;
        }
        let working_dir = s("workingDirectory");
        let protocol = if s("protocol").is_empty() { "uci".to_string() } else { s("protocol").to_lowercase() };
        let (exe, mut args) = split_command(&command, &working_dir);
        if let Some(Value::Array(a)) = e.get("arguments") {
            let extra: Vec<String> = a.iter().filter_map(value_str).collect();
            if !extra.is_empty() {
                args = [args, extra.join(" ")].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" ");
            }
        }
        let mut options = BTreeMap::new();
        if let Some(Value::Array(opts)) = e.get("options") {
            for o in opts {
                let n = o.get("name").and_then(value_str).unwrap_or_default();
                let Some(val) = o.get("value").and_then(value_str) else { continue };
                if n.is_empty() || n == "Threads" || n == "Hash" || o.get("type").and_then(Value::as_str) == Some("button") {
                    continue;
                }
                // only what was changed in Cute Chess; the engine's own defaults stay its own
                if o.get("default").and_then(value_str).is_some_and(|d| d == val) {
                    continue;
                }
                options.insert(n, val);
            }
        }
        let exists = exe.is_file();
        let note = if protocol != "uci" {
            format!("{protocol} engine: fastchess plays UCI engines only")
        } else if !exists {
            format!("executable not found on this computer: {}", exe.display())
        } else {
            String::new()
        };
        out.push(CuteEngine {
            name: if name.is_empty() { exe.file_stem().unwrap_or_default().to_string_lossy().to_string() } else { name },
            command,
            working_dir,
            protocol,
            exe: exe.to_string_lossy().to_string(),
            args,
            options,
            exists,
            note,
        });
    }
    Ok(out)
}

/// `"Stockfish 17"` → ("Stockfish", "17"); a name without a version stays whole.
pub fn split_name(name: &str) -> (String, String) {
    let n = name.trim();
    match n.rsplit_once(' ') {
        Some((e, v)) if v.chars().any(|c| c.is_ascii_digit()) => (e.trim().to_string(), v.trim().to_string()),
        _ => (n.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_cute_chess_engine_list() {
        let dir = std::env::temp_dir().join(format!("torsgui-cute-{}", std::process::id()));
        let sf = dir.join("Stockfish 17");
        std::fs::create_dir_all(&sf).unwrap();
        let exe = sf.join("stockfish avx2.exe");
        std::fs::write(&exe, b"x").unwrap();
        std::fs::write(dir.join("lc0"), b"x").unwrap();
        let wd = sf.to_string_lossy().to_string();
        let text = serde_json::json!([
            {
                "name": "Stockfish 17", "command": "stockfish avx2.exe", "workingDirectory": wd, "protocol": "uci",
                "options": [
                    {"name": "Hash", "type": "spin", "value": 256, "default": 16},
                    {"name": "Threads", "type": "spin", "value": 4, "default": 1},
                    {"name": "EvalFile", "type": "string", "value": "nn-custom.nnue", "default": "nn-default.nnue"},
                    {"name": "Ponder", "type": "check", "value": false, "default": false},
                    {"name": "UCI_ShowWDL", "type": "check", "value": true, "default": false},
                    {"name": "Clear Hash", "type": "button"}
                ]
            },
            {"name": "Lc0 0.31", "command": format!("\"{}\" --backend=eigen", dir.join("lc0").display()), "workingDirectory": "", "protocol": "uci", "arguments": ["--threads=2"]},
            {"name": "Old Xboard", "command": "crafty", "workingDirectory": wd, "protocol": "xboard"},
            {"name": "Gone 1.0", "command": "C:/nowhere/gone.exe", "workingDirectory": "C:/nowhere"}
        ])
        .to_string();
        let v = parse(&text).unwrap();
        assert_eq!(v.len(), 4);
        // a path with spaces relative to the working folder; only the changed options
        assert!(v[0].exists && v[0].exe.ends_with("stockfish avx2.exe") && v[0].args.is_empty(), "{:?}", v[0]);
        assert_eq!(v[0].options, BTreeMap::from([("EvalFile".to_string(), "nn-custom.nnue".to_string()), ("UCI_ShowWDL".to_string(), "true".to_string())]));
        // quoted command with arguments, plus the "arguments" list
        assert!(v[1].exists && v[1].args == "--backend=eigen --threads=2", "{:?}", v[1]);
        assert!(v[2].note.contains("xboard engine"));
        assert!(!v[3].exists && v[3].note.contains("not found") && v[3].protocol == "uci");
        assert_eq!(split_name("Stockfish 17"), ("Stockfish".to_string(), "17".to_string()));
        assert_eq!(split_name("Komodo Dragon"), ("Komodo Dragon".to_string(), String::new()));
        assert!(parse("{nope").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
