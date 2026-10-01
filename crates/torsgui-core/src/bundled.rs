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
