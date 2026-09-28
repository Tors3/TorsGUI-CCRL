//! Piece sets imported by the user (for personal use: sets whose licence does not allow
//! bundling them with TorsGUI). They live in `<workspace>/pieces/<name>/` with lichess file
//! names (`wP.svg` … `bK.svg`, or `.png`) and are served to the UI as data URIs.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const PIECES: [&str; 12] = ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"];

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct UserPieceSet {
    pub name: String,
    /// "wP" → data URI
    pub pieces: BTreeMap<String, String>,
}

/// Finds the file of one piece in a folder: lichess names (`wP.svg`), sharechess names
/// (`pw.svg`: role then colour) or long names (`white_pawn.svg`, `white-pawn.png`).
fn find(dir: &Path, piece: &str) -> Option<PathBuf> {
    let (c, r) = (piece[..1].to_string(), piece[1..].to_lowercase());
    let long_c = if c == "w" { "white" } else { "black" };
    let long_r = match r.as_str() {
        "p" => "pawn",
        "n" => "knight",
        "b" => "bishop",
        "r" => "rook",
        "q" => "queen",
        _ => "king",
    };
    let stems = [format!("{c}{r}"), format!("{r}{c}"), format!("{long_c}_{long_r}"), format!("{long_c}-{long_r}"), format!("{long_c}{long_r}")];
    let entries: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).collect();
    for s in &stems {
        for ext in ["svg", "png"] {
            if let Some(p) = entries.iter().find(|p| {
                let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                n == format!("{s}.{ext}")
            }) {
                return Some(p.clone());
            }
        }
    }
    None
}

fn slug(name: &str) -> String {
    let s: String = name.trim().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c.to_ascii_lowercase() } else { '-' }).collect();
    s.trim_matches('-').to_string()
}

/// Copies a piece set from `src` into `root/<name>/` with lichess names.
pub fn import(root: &Path, src: &Path, name: Option<&str>) -> Result<String> {
    let name = slug(name.filter(|n| !n.trim().is_empty()).unwrap_or(&src.file_name().context("folder name")?.to_string_lossy()));
    if name.is_empty() {
        bail!("give the piece set a name");
    }
    let mut found = Vec::new();
    for p in PIECES {
        let f = find(src, p).with_context(|| format!("{}: no file for {p} (expected wP.svg, pw.svg or white_pawn.svg, svg or png)", src.display()))?;
        found.push((p, f));
    }
    let dst = root.join(&name);
    std::fs::create_dir_all(&dst)?;
    for (p, f) in found {
        let ext = f.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "svg".into());
        for old in ["svg", "png"] {
            let _ = std::fs::remove_file(dst.join(format!("{p}.{old}")));
        }
        std::fs::copy(&f, dst.join(format!("{p}.{ext}")))?;
    }
    Ok(name)
}

pub fn list(root: &Path) -> Vec<UserPieceSet> {
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(root) else { return v };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for d in dirs {
        let mut pieces = BTreeMap::new();
        for p in PIECES {
            let Some(f) = find(&d, p) else { continue };
            let Ok(bytes) = std::fs::read(&f) else { continue };
            let mime = if f.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) { "image/png" } else { "image/svg+xml" };
            pieces.insert(p.to_string(), format!("data:{mime};base64,{}", crate::util::base64(&bytes)));
        }
        if pieces.len() == 12 {
            v.push(UserPieceSet { name: d.file_name().unwrap().to_string_lossy().to_string(), pieces });
        }
    }
    v
}

pub fn delete(root: &Path, name: &str) -> Result<()> {
    let s = slug(name);
    if s.is_empty() || s != name {
        bail!("invalid piece set name");
    }
    std::fs::remove_dir_all(root.join(s))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_sharechess_and_lichess_names() {
        let t = tempfile::tempdir().unwrap();
        let sc = t.path().join("maestro_blue");
        std::fs::create_dir_all(&sc).unwrap();
        for r in ["p", "n", "b", "r", "q", "k"] {
            for c in ["w", "b"] {
                std::fs::write(sc.join(format!("{r}{c}.svg")), format!("<svg id='{c}{r}'/>")).unwrap();
            }
        }
        let root = t.path().join("pieces");
        assert_eq!(import(&root, &sc, None).unwrap(), "maestro_blue");
        let l = list(&root);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].pieces.len(), 12);
        // wN comes from "nw.svg"
        let uri = &l[0].pieces["wN"];
        assert!(uri.starts_with("data:image/svg+xml;base64,"));
        assert_eq!(uri.trim_start_matches("data:image/svg+xml;base64,"), crate::util::base64(b"<svg id='wn'/>"));
        // incomplete folder: explained
        let bad = t.path().join("bad");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("wP.svg"), "x").unwrap();
        assert!(import(&root, &bad, Some("Bad Set")).unwrap_err().to_string().contains("wN"));
        delete(&root, "maestro_blue").unwrap();
        assert!(list(&root).is_empty());
        assert!(delete(&root, "../x").is_err());
    }
}
