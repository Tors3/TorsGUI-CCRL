//! Updates from inside the app: the latest TorsGUI release on GitHub is downloaded (size and
//! SHA-256 checked) and installed the way this copy was installed — Windows installer (NSIS),
//! MSI, portable folder, AppImage or Debian package.
//!
//! Tournaments keep running: on Windows a running executable cannot be overwritten but can be
//! renamed, so the files in use (runner, bundled engines…) are renamed to `*.old-update` before
//! the new ones are written; the next start removes them.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const OLD_SUFFIX: &str = ".old-update";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    /// "sha256:…" as published by GitHub, when known.
    pub digest: Option<String>,
}

/// How this copy of TorsGUI was installed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum InstallKind {
    /// Windows installer (setup.exe), per user.
    Nsis,
    Msi,
    /// The portable Windows folder.
    Portable,
    AppImage,
    Deb,
    /// A development build or an unknown layout: only the download page.
    Unknown,
}

impl InstallKind {
    pub fn label(&self) -> &'static str {
        match self {
            InstallKind::Nsis => "Windows installer",
            InstallKind::Msi => "Windows MSI",
            InstallKind::Portable => "portable folder",
            InstallKind::AppImage => "AppImage",
            InstallKind::Deb => "Debian package",
            InstallKind::Unknown => "development build",
        }
    }
}

/// Decides from the files next to the executable (and `$APPIMAGE`).
pub fn kind_of(exe: &Path, appimage: Option<&str>, windows: bool) -> InstallKind {
    let dir = exe.parent().unwrap_or(Path::new("."));
    let stem = exe.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    if stem != "torsgui" {
        return InstallKind::Unknown; // torsgui-server, tests…
    }
    if windows {
        if dir.join("uninstall.exe").exists() {
            return InstallKind::Nsis;
        }
        if dir.to_string_lossy().to_lowercase().contains("program files") {
            return InstallKind::Msi;
        }
        if dir.join("torsgui-runner.exe").exists() {
            return InstallKind::Portable;
        }
        return InstallKind::Unknown;
    }
    if appimage.is_some_and(|a| !a.is_empty()) {
        return InstallKind::AppImage;
    }
    if exe.starts_with("/usr") {
        return InstallKind::Deb;
    }
    InstallKind::Unknown
}

pub fn install_kind() -> InstallKind {
    let exe = std::env::current_exe().unwrap_or_default();
    kind_of(&exe, std::env::var("APPIMAGE").ok().as_deref(), cfg!(windows))
}

/// The release file for an install kind.
pub fn pick_asset(kind: &InstallKind, assets: &[UpdateAsset]) -> Option<UpdateAsset> {
    let ends = |suffix: &str| assets.iter().find(|a| a.name.to_lowercase().ends_with(suffix)).cloned();
    match kind {
        InstallKind::Nsis => ends("-setup.exe"),
        InstallKind::Msi => ends(".msi"),
        InstallKind::Portable => assets.iter().find(|a| a.name.to_lowercase().contains("portable") && a.name.ends_with(".zip")).cloned(),
        InstallKind::AppImage => ends(".appimage"),
        InstallKind::Deb => ends(".deb"),
        InstallKind::Unknown => None,
    }
}

/// Tag and files of the latest release.
pub fn latest_release(token: Option<&str>) -> Result<(String, Vec<UpdateAsset>)> {
    let (owner, repo) = crate::github::APP_REPO;
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    let (st, body) = crate::github::get_text(&url, token)?;
    if st == 200 {
        let v: serde_json::Value = serde_json::from_str(&body)?;
        let tag = v["tag_name"].as_str().unwrap_or_default().to_string();
        let assets = v["assets"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| UpdateAsset {
                name: a["name"].as_str().unwrap_or_default().into(),
                url: a["browser_download_url"].as_str().unwrap_or_default().into(),
                size: a["size"].as_u64().unwrap_or(0),
                digest: a["digest"].as_str().map(String::from),
            })
            .collect();
        return Ok((tag, assets));
    }
    // API rate-limited: the tag from the redirect, the usual file names
    let tag = crate::github::latest_tag_via_redirect(owner, repo)?;
    let v = tag.trim_start_matches('v');
    let names = [format!("TorsGUI_{v}_x64-setup.exe"), format!("TorsGUI_{v}_x64_en-US.msi"), "TorsGUI-portable-windows-x64.zip".to_string(), format!("TorsGUI_{v}_amd64.AppImage"), format!("TorsGUI_{v}_amd64.deb")];
    let assets = names.iter().map(|n| UpdateAsset { name: n.clone(), url: format!("https://github.com/{owner}/{repo}/releases/download/{tag}/{n}"), size: 0, digest: None }).collect();
    Ok((tag, assets))
}

/// Downloads `asset` to `dest`, checking its size and SHA-256 when GitHub gives them.
pub fn download(asset: &UpdateAsset, dest: &Path, mut progress: impl FnMut(u64, u64)) -> Result<()> {
    let mut resp = crate::github::agent(true).get(&asset.url).call().with_context(|| format!("GET {}", asset.url))?;
    if resp.status().as_u16() != 200 {
        bail!("{}: HTTP {}", asset.url, resp.status());
    }
    let total = if asset.size > 0 { asset.size } else { resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0) };
    let mut reader = resp.body_mut().with_config().limit(2 * 1024 * 1024 * 1024).reader();
    let tmp = dest.with_extension("part");
    let mut f = std::fs::File::create(&tmp).with_context(|| format!("{}", tmp.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        f.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        done += n as u64;
        progress(done, total);
    }
    f.flush()?;
    drop(f);
    if asset.size > 0 && done != asset.size {
        bail!("{}: {} bytes received, {} expected", asset.name, done, asset.size);
    }
    if let Some(d) = asset.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        let got = hex::encode(hasher.finalize());
        if !got.eq_ignore_ascii_case(d) {
            bail!("{}: SHA-256 {got} does not match the release ({d})", asset.name);
        }
    }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// Renames every executable (and DLL) under `dir` to `*.old-update`, so that files in use by
/// running tournaments can be replaced.
pub fn move_aside(dir: &Path) -> Vec<PathBuf> {
    let mut moved = Vec::new();
    for e in walkdir::WalkDir::new(dir).max_depth(3).into_iter().flatten() {
        let p = e.path();
        let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !e.file_type().is_file() || name.ends_with(OLD_SUFFIX) {
            continue;
        }
        if name.ends_with(".exe") || name.ends_with(".dll") {
            let to = PathBuf::from(format!("{}{OLD_SUFFIX}", p.display()));
            let _ = std::fs::remove_file(&to);
            if std::fs::rename(p, &to).is_ok() {
                moved.push(to);
            }
        }
    }
    moved
}

/// Removes the files left by a previous update (those still in use stay until the next time).
pub fn cleanup_old(dir: &Path) -> usize {
    walkdir::WalkDir::new(dir)
        .max_depth(3)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file() && e.file_name().to_string_lossy().ends_with(OLD_SUFFIX))
        .filter(|e| std::fs::remove_file(e.path()).is_ok())
        .count()
}

/// Copies the portable files from `src` over `dst` (files in use were moved aside first).
pub fn copy_over(src: &Path, dst: &Path) -> Result<u32> {
    let mut n = 0;
    for e in walkdir::WalkDir::new(src).into_iter().flatten() {
        let rel = e.path().strip_prefix(src)?;
        let to = dst.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&to)?;
        } else {
            if to.exists() {
                let _ = std::fs::remove_file(&to);
            }
            std::fs::copy(e.path(), &to).with_context(|| format!("{}", to.display()))?;
            n += 1;
        }
    }
    Ok(n)
}

/// Installs the downloaded file and starts what comes next (installer, new copy). Returns a
/// message; the caller then closes TorsGUI (`restart_needed`).
pub fn apply(kind: &InstallKind, file: &Path) -> Result<String> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().context("install folder")?.to_path_buf();
    match kind {
        InstallKind::Nsis => {
            move_aside(&dir);
            // passive install, then TorsGUI starts again
            Command::new(file).args(["/UPDATE", "/P", "/R"]).spawn().with_context(|| format!("starting {}", file.display()))?;
            Ok("The installer is running; TorsGUI starts again when it is done.".into())
        }
        InstallKind::Msi => {
            move_aside(&dir);
            let script = format!("msiexec /i \"{}\" /passive && start \"\" \"{}\"", file.display(), exe.display());
            let mut c = Command::new("cmd");
            c.args(["/C", &script]);
            crate::platform::no_window(&mut c);
            c.spawn().context("starting msiexec")?;
            Ok("The MSI installer is running; TorsGUI starts again when it is done.".into())
        }
        InstallKind::Portable => {
            let staging = dir.join(".update");
            let _ = std::fs::remove_dir_all(&staging);
            std::fs::create_dir_all(&staging)?;
            let f = std::fs::File::open(file)?;
            zip::ZipArchive::new(f)?.extract(&staging).context("unpacking the portable zip")?;
            move_aside(&dir);
            let n = copy_over(&staging, &dir)?;
            let _ = std::fs::remove_dir_all(&staging);
            Command::new(dir.join("TorsGUI.exe")).current_dir(&dir).spawn().context("starting the new TorsGUI")?;
            Ok(format!("{n} files updated; the new TorsGUI is starting."))
        }
        InstallKind::AppImage => {
            let target = PathBuf::from(std::env::var("APPIMAGE").context("APPIMAGE not set")?);
            let staged = target.with_extension("AppImage.new");
            std::fs::copy(file, &staged)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
            }
            std::fs::rename(&staged, &target).with_context(|| format!("replacing {}", target.display()))?;
            Command::new(&target).spawn().context("starting the new AppImage")?;
            Ok("AppImage replaced; the new TorsGUI is starting.".into())
        }
        InstallKind::Deb => {
            Command::new("xdg-open").arg(file).spawn().context("opening the package")?;
            Ok(format!("The package manager opens {}: install it, then start TorsGUI again.", file.display()))
        }
        InstallKind::Unknown => bail!("this copy of TorsGUI was not installed from a release: download the new version from its page"),
    }
}

/// Whether TorsGUI must close after `apply` (the installer or the new copy takes over).
pub fn restart_needed(kind: &InstallKind) -> bool {
    !matches!(kind, InstallKind::Deb | InstallKind::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_kinds_and_assets() {
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("torsgui.exe");
        std::fs::write(&exe, b"x").unwrap();
        assert_eq!(kind_of(&exe, None, true), InstallKind::Unknown);
        std::fs::write(d.path().join("torsgui-runner.exe"), b"x").unwrap();
        assert_eq!(kind_of(&exe, None, true), InstallKind::Portable);
        std::fs::write(d.path().join("uninstall.exe"), b"x").unwrap();
        assert_eq!(kind_of(&exe, None, true), InstallKind::Nsis);
        assert_eq!(kind_of(Path::new("C:/Program Files/TorsGUI/torsgui.exe"), None, true), InstallKind::Msi);
        assert_eq!(kind_of(Path::new("/tmp/.mount_x/usr/bin/torsgui"), Some("/home/u/TorsGUI.AppImage"), false), InstallKind::AppImage);
        assert_eq!(kind_of(Path::new("/usr/bin/torsgui"), None, false), InstallKind::Deb);
        assert_eq!(kind_of(Path::new("/home/u/target/debug/torsgui-server"), None, false), InstallKind::Unknown);
        let a = |n: &str| UpdateAsset { name: n.into(), ..Default::default() };
        let assets = vec![a("TorsGUI_0.6.0_x64-setup.exe"), a("TorsGUI_0.6.0_x64_en-US.msi"), a("TorsGUI-portable-windows-x64.zip"), a("TorsGUI_0.6.0_amd64.AppImage"), a("TorsGUI_0.6.0_amd64.deb")];
        assert_eq!(pick_asset(&InstallKind::Nsis, &assets).unwrap().name, "TorsGUI_0.6.0_x64-setup.exe");
        assert_eq!(pick_asset(&InstallKind::Msi, &assets).unwrap().name, "TorsGUI_0.6.0_x64_en-US.msi");
        assert_eq!(pick_asset(&InstallKind::Portable, &assets).unwrap().name, "TorsGUI-portable-windows-x64.zip");
        assert_eq!(pick_asset(&InstallKind::AppImage, &assets).unwrap().name, "TorsGUI_0.6.0_amd64.AppImage");
        assert!(pick_asset(&InstallKind::Unknown, &assets).is_none());
    }

    #[test]
    fn files_in_use_are_moved_aside_and_replaced() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("app");
        std::fs::create_dir_all(root.join("engines")).unwrap();
        std::fs::write(root.join("torsgui-runner.exe"), b"old runner").unwrap();
        std::fs::write(root.join("engines/sf.exe"), b"old sf").unwrap();
        std::fs::write(root.join("settings.txt"), b"keep").unwrap();
        let moved = move_aside(&root);
        assert_eq!(moved.len(), 2);
        assert!(root.join(format!("torsgui-runner.exe{OLD_SUFFIX}")).exists());
        let new = d.path().join("new");
        std::fs::create_dir_all(new.join("engines")).unwrap();
        std::fs::write(new.join("torsgui-runner.exe"), b"new runner").unwrap();
        std::fs::write(new.join("engines/sf.exe"), b"new sf").unwrap();
        assert_eq!(copy_over(&new, &root).unwrap(), 2);
        assert_eq!(std::fs::read(root.join("torsgui-runner.exe")).unwrap(), b"new runner");
        assert_eq!(std::fs::read(root.join("settings.txt")).unwrap(), b"keep");
        assert_eq!(cleanup_old(&root), 2);
        assert!(!root.join(format!("engines/sf.exe{OLD_SUFFIX}")).exists());
    }

    #[test]
    fn downloads_are_checked() {
        use std::io::{BufRead, BufReader};
        let body = b"torsgui release file".to_vec();
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let b2 = body.clone();
        std::thread::spawn(move || {
            for s in l.incoming().take(2) {
                let mut s = s.unwrap();
                let mut r = BufReader::new(s.try_clone().unwrap());
                let mut line = String::new();
                while r.read_line(&mut line).unwrap() > 2 {
                    line.clear();
                }
                let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", b2.len());
                let _ = s.write_all(&b2);
            }
        });
        let d = tempfile::tempdir().unwrap();
        let good = format!("sha256:{}", hex::encode(Sha256::digest(&body)));
        let a = UpdateAsset { name: "f".into(), url: format!("http://127.0.0.1:{port}/f"), size: body.len() as u64, digest: Some(good) };
        let mut last = 0;
        download(&a, &d.path().join("f.bin"), |done, _| last = done).unwrap();
        assert_eq!(std::fs::read(d.path().join("f.bin")).unwrap(), body);
        assert_eq!(last, body.len() as u64);
        let bad = UpdateAsset { digest: Some("sha256:00".into()), ..a };
        let e = download(&bad, &d.path().join("g.bin"), |_, _| {}).unwrap_err().to_string();
        assert!(e.contains("does not match"), "{e}");
        assert!(!d.path().join("g.bin").exists());
    }
}
