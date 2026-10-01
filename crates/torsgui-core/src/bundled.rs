//! Engines shipped with the installers (Stockfish 10 for the bench and as an engine,
//! Triumviratus 7.0 AVX2): `engines/bundled.json` in the app's resources lists them; the
//! files present on this platform can be installed into the engines folder and the library.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BundledEngine {
    pub file: String,
    pub engine: String,
    pub version: String,
    pub build: String,
    /// "engine", "bench" or "both".
    pub role: String,
    pub os: String,
    pub sha256: String,
    pub license: String,
    pub release_url: String,
    pub source_url: String,
    pub note: String,
    /// Set when listed: the file is in this installation.
    #[serde(default)]
    pub present: bool,
    /// Set when listed: already in the library (same sha256 or same name and build).
    #[serde(default)]
    pub installed: bool,
}

/// Where the bundled engines are: `TORSGUI_BUNDLED`, or next to the executable (Windows
/// installers and the portable zip), or `../lib/<product>/engines` (Linux packages).
pub fn dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("TORSGUI_BUNDLED") {
        if Path::new(&p).join("bundled.json").exists() {
            return Some(p.into());
        }
    }
    let exe = std::env::current_exe().ok()?;
    let d = exe.parent()?;
    [d.join("engines"), d.join("resources").join("engines"), d.join("../lib/TorsGUI/engines"), d.join("../lib/torsgui/engines"), d.join("../../src-tauri/resources/engines")]
        .into_iter()
        .find(|p| p.join("bundled.json").exists())
}

pub fn this_os() -> &'static str {
    if cfg!(windows) { "windows" } else { "linux" }
}

/// The manifest entries of this platform, with `present` set from the files found.
pub fn list(dir: &Path) -> Result<Vec<BundledEngine>> {
    let text = std::fs::read_to_string(dir.join("bundled.json")).context("bundled.json")?;
    let mut v: Vec<BundledEngine> = serde_json::from_str(&text)?;
    v.retain(|e| e.os == this_os());
    for e in v.iter_mut() {
        e.present = dir.join(&e.file).is_file();
    }
    Ok(v)
}

/// Copies a bundled file to `dest_dir`, checking its sha256 when the manifest has one.
pub fn copy(dir: &Path, e: &BundledEngine, dest_dir: &Path) -> Result<PathBuf> {
    let src = dir.join(&e.file);
    if !src.is_file() {
        bail!("{} is not part of this installation", e.file);
    }
    std::fs::create_dir_all(dest_dir)?;
    let dst = dest_dir.join(&e.file);
    std::fs::copy(&src, &dst)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dst, std::fs::Permissions::from_mode(0o755))?;
    }
    if !e.sha256.is_empty() {
        let got = crate::engines::sha256_file(&dst)?;
        if got != e.sha256 {
            let _ = std::fs::remove_file(&dst);
            bail!("sha256 mismatch for {}: expected {}, got {got}", e.file, e.sha256);
        }
    }
    Ok(dst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_of_the_repository_is_valid() {
        let d = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources/engines");
        let text = std::fs::read_to_string(d.join("bundled.json")).unwrap();
        let all: Vec<BundledEngine> = serde_json::from_str(&text).unwrap();
        assert!(all.iter().any(|e| e.engine == "Triumviratus" && e.version == "7.0" && e.build == "avx2" && e.sha256.len() == 64));
        // the Stockfish 10 hashes are those of the bench
        for (build, file, sha) in crate::bench::SF10_WINDOWS {
            let e = all.iter().find(|e| e.file == *file).unwrap_or_else(|| panic!("{file}"));
            assert_eq!((e.build.as_str(), e.sha256.as_str()), (*build, *sha));
        }
        for e in &all {
            assert!(matches!(e.role.as_str(), "engine" | "bench" | "both"), "{}", e.file);
            assert!(matches!(e.os.as_str(), "windows" | "linux"));
            assert_eq!(e.license, "GPL-3.0");
        }
    }

    #[test]
    fn copy_checks_the_hash() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("bundled.json"), "[]").unwrap();
        std::fs::write(t.path().join("e.bin"), b"engine").unwrap();
        let mut e = BundledEngine { file: "e.bin".into(), engine: "E".into(), version: "1".into(), build: "x64".into(), role: "engine".into(), os: this_os().into(), sha256: String::new(), license: "GPL-3.0".into(), release_url: String::new(), source_url: String::new(), note: String::new(), present: true, installed: false };
        let out = t.path().join("out");
        assert!(copy(t.path(), &e, &out).is_ok());
        e.sha256 = "0".repeat(64);
        assert!(copy(t.path(), &e, &out).unwrap_err().to_string().contains("sha256 mismatch"));
        e.file = "missing".into();
        assert!(copy(t.path(), &e, &out).is_err());
    }
}

// ------------------------------------------------------------------ opening books

/// An opening book shipped with TorsGUI (`books/books.json`, files in the zip next to it).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct BundledBook {
    pub file: String,
    pub name: String,
    /// "pgn" or "cgb".
    pub format: String,
    pub positions: Option<u32>,
    /// fastchess reads PGN and EPD books; CGB books are for other GUIs.
    pub fastchess: bool,
    pub author: String,
    pub description: String,
    pub terms: String,
    /// Set when listed: already in the books folder.
    #[serde(default)]
    pub installed: bool,
}

pub const BOOKS_ZIP: &str = "opening_books_CCRL.zip";
/// The default book proposed when none is set: the newest AVT book.
pub const DEFAULT_BOOK: &str = "AVT2026d.pgn";

/// Where the bundled books are (same places as the engines, `books` instead of `engines`).
pub fn books_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("TORSGUI_BUNDLED_BOOKS") {
        if Path::new(&p).join("books.json").exists() {
            return Some(p.into());
        }
    }
    if let Some(e) = dir() {
        let b = e.join("../books");
        if b.join("books.json").exists() {
            return Some(b);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let d = exe.parent()?;
    [d.join("books"), d.join("resources").join("books"), d.join("../lib/TorsGUI/books"), d.join("../lib/torsgui/books"), d.join("../../src-tauri/resources/books")]
        .into_iter()
        .find(|p| p.join("books.json").exists())
}

pub fn books(dir: &Path, installed_in: &Path) -> Result<Vec<BundledBook>> {
    let mut v: Vec<BundledBook> = serde_json::from_str(&std::fs::read_to_string(dir.join("books.json")).context("books.json")?)?;
    for b in v.iter_mut() {
        b.installed = installed_in.join(&b.file).is_file();
    }
    Ok(v)
}

/// Extracts the books (all, or the given files) into `dest`; existing files are replaced.
pub fn install_books(dir: &Path, dest: &Path, only: Option<&[String]>) -> Result<Vec<String>> {
    std::fs::create_dir_all(dest)?;
    let mut z = zip::ZipArchive::new(std::fs::File::open(dir.join(BOOKS_ZIP)).context(BOOKS_ZIP)?)?;
    let mut out = Vec::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        if f.is_dir() {
            continue;
        }
        // flat names only: never write outside `dest`
        let Some(name) = f.enclosed_name().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())) else { continue };
        if only.map(|o| !o.iter().any(|x| x == &name)).unwrap_or(false) {
            continue;
        }
        let mut w = std::fs::File::create(dest.join(&name))?;
        std::io::copy(&mut f, &mut w)?;
        out.push(name);
    }
    Ok(out)
}

#[cfg(test)]
mod book_tests {
    use super::*;

    fn repo_books() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources/books")
    }

    #[test]
    fn manifest_matches_the_archive() {
        let d = repo_books();
        let list = books(&d, Path::new("/nonexistent")).unwrap();
        let z = zip::ZipArchive::new(std::fs::File::open(d.join(BOOKS_ZIP)).unwrap()).unwrap();
        let mut in_zip: Vec<String> = z.file_names().map(|s| s.to_string()).collect();
        in_zip.sort();
        let mut listed: Vec<String> = list.iter().map(|b| b.file.clone()).collect();
        listed.sort();
        assert_eq!(listed, in_zip);
        assert!(list.iter().any(|b| b.file == DEFAULT_BOOK && b.fastchess));
        for b in &list {
            assert_eq!(b.fastchess, b.format == "pgn", "{}", b.file);
        }
    }

    #[test]
    fn install_extracts_and_counts_positions() {
        let t = tempfile::tempdir().unwrap();
        let only = vec!["LowDraw1000.pgn".to_string(), "GBSelect2026.pgn".to_string()];
        let got = install_books(&repo_books(), t.path(), Some(&only)).unwrap();
        assert_eq!(got.len(), 2);
        let list = books(&repo_books(), t.path()).unwrap();
        for b in list.iter().filter(|b| b.installed) {
            let n = crate::pgn::read_games(&t.path().join(&b.file)).unwrap().len() as u32;
            assert_eq!(Some(n), b.positions, "{}", b.file);
        }
        assert_eq!(list.iter().filter(|b| b.installed).count(), 2);
    }
}
