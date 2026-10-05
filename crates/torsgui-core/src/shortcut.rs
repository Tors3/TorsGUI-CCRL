//! Desktop shortcuts on Windows. A shortcut made for an older copy of TorsGUI (an earlier
//! portable folder, a removed version) keeps opening that copy: at start TorsGUI points the
//! "TorsGUI" shortcuts of the desktop to itself when their target is an older or missing
//! TorsGUI.exe. Shortcuts to anything else, or to a newer TorsGUI, are left alone.

use anyhow::{bail, Context, Result};
use std::path::Path;

/// PowerShell string literal (single quotes doubled).
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// The script that retargets the stale TorsGUI shortcuts of `desktop` (the user's desktop when
/// None) to `exe`; it prints one line per shortcut changed: `name|old target|old version`.
pub fn retarget_script(exe: &Path, version: &str, desktop: Option<&Path>) -> String {
    let desk = match desktop {
        Some(d) => ps_quote(&d.to_string_lossy()),
        None => "[Environment]::GetFolderPath('Desktop')".to_string(),
    };
    format!(
        r#"$ErrorActionPreference = 'Stop'
$exe = {exe}
$ver = [version]{ver}
$sh = New-Object -ComObject WScript.Shell
Get-ChildItem -LiteralPath ({desk}) -Filter '*.lnk' | Where-Object {{ $_.Name -like '*TorsGUI*' }} | ForEach-Object {{
  $l = $sh.CreateShortcut($_.FullName)
  $t = $l.TargetPath
  if ($t -and [IO.Path]::GetFileName($t) -ne 'TorsGUI.exe') {{ return }}
  if ($t -eq $exe) {{ return }}
  $old = $null
  if ($t -and (Test-Path -LiteralPath $t)) {{ try {{ $old = [version](Get-Item -LiteralPath $t).VersionInfo.ProductVersion }} catch {{ }} }}
  if ($old -eq $null -or $old -lt $ver) {{
    $l.TargetPath = $exe
    $l.WorkingDirectory = [IO.Path]::GetDirectoryName($exe)
    $l.IconLocation = "$exe,0"
    $l.Save()
    Write-Output ("{{0}}|{{1}}|{{2}}" -f $_.Name, $t, $old)
  }}
}}
"#,
        exe = ps_quote(&exe.to_string_lossy()),
        ver = ps_quote(version),
    )
}

/// The script that creates (or replaces) `TorsGUI.lnk` on the desktop for `exe`.
pub fn create_script(exe: &Path, desktop: Option<&Path>) -> String {
    let desk = match desktop {
        Some(d) => ps_quote(&d.to_string_lossy()),
        None => "[Environment]::GetFolderPath('Desktop')".to_string(),
    };
    format!(
        r#"$ErrorActionPreference = 'Stop'
$exe = {exe}
$p = Join-Path ({desk}) 'TorsGUI.lnk'
$l = (New-Object -ComObject WScript.Shell).CreateShortcut($p)
$l.TargetPath = $exe
$l.WorkingDirectory = [IO.Path]::GetDirectoryName($exe)
$l.IconLocation = "$exe,0"
$l.Description = 'TorsGUI'
$l.Save()
Write-Output $p
"#,
        exe = ps_quote(&exe.to_string_lossy()),
    )
}

/// Runs a PowerShell script (Windows only) and returns its output lines.
pub fn run_powershell(script: &str) -> Result<Vec<String>> {
    if !cfg!(windows) {
        bail!("desktop shortcuts are managed on Windows only");
    }
    let mut c = std::process::Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    crate::platform::no_window(&mut c);
    let out = c.output().context("starting PowerShell")?;
    if !out.status.success() {
        bail!("PowerShell: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

/// Points the stale TorsGUI shortcuts of the desktop to the running TorsGUI. Returns a
/// description per shortcut changed.
pub fn fix_desktop_shortcuts(desktop: Option<&Path>) -> Result<Vec<String>> {
    let exe = std::env::current_exe()?;
    let lines = run_powershell(&retarget_script(&exe, env!("CARGO_PKG_VERSION"), desktop))?;
    Ok(lines
        .iter()
        .map(|l| {
            let p: Vec<&str> = l.splitn(3, '|').collect();
            let (name, old, ver) = (p.first().copied().unwrap_or(""), p.get(1).copied().unwrap_or(""), p.get(2).copied().unwrap_or(""));
            let was = if old.is_empty() { "nothing".to_string() } else if ver.is_empty() { format!("{old} (missing)") } else { format!("TorsGUI {ver} in {old}") };
            format!("desktop shortcut \"{name}\" now opens this TorsGUI {} (it opened {was})", env!("CARGO_PKG_VERSION"))
        })
        .collect())
}

/// Creates `TorsGUI.lnk` on the desktop for the running TorsGUI; returns its path.
pub fn create_desktop_shortcut() -> Result<String> {
    let exe = std::env::current_exe()?;
    run_powershell(&create_script(&exe, None))?.into_iter().last().context("no shortcut written")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_quote_paths() {
        let s = retarget_script(Path::new(r"E:\sakk\Tors' GUI\TorsGUI.exe"), "0.6.4", None);
        assert!(s.contains(r"$exe = 'E:\sakk\Tors'' GUI\TorsGUI.exe'"), "{s}");
        assert!(s.contains("$ver = [version]'0.6.4'"));
        assert!(s.contains("[Environment]::GetFolderPath('Desktop')"));
        let c = create_script(Path::new(r"C:\x\TorsGUI.exe"), Some(Path::new(r"C:\d")));
        assert!(c.contains("Join-Path ('C:\\d') 'TorsGUI.lnk'"), "{c}");
        if !cfg!(windows) {
            assert!(run_powershell("Write-Output 1").is_err());
        }
    }

    /// On Windows (CI): a shortcut to a missing TorsGUI.exe is retargeted, one to another
    /// program and one already right are left alone.
    #[cfg(windows)]
    #[test]
    fn stale_shortcuts_are_retargeted() {
        let d = tempfile::tempdir().unwrap();
        let desk = d.path();
        let me = std::env::current_exe().unwrap();
        let mk = |name: &str, target: &str| {
            let s = format!(
                "$l = (New-Object -ComObject WScript.Shell).CreateShortcut({}); $l.TargetPath = {}; $l.Save()",
                ps_quote(&desk.join(name).to_string_lossy()),
                ps_quote(target)
            );
            run_powershell(&s).unwrap();
        };
        mk("TorsGUI.lnk", r"C:\gone\old\TorsGUI.exe");
        mk("TorsGUI notepad.lnk", r"C:\Windows\System32\notepad.exe");
        let changed = run_powershell(&retarget_script(&me, "0.6.4", Some(desk))).unwrap();
        assert_eq!(changed.len(), 1, "{changed:?}");
        assert!(changed[0].starts_with("TorsGUI.lnk|C:\\gone\\old\\TorsGUI.exe"), "{changed:?}");
        let read = |name: &str| run_powershell(&format!("(New-Object -ComObject WScript.Shell).CreateShortcut({}).TargetPath", ps_quote(&desk.join(name).to_string_lossy()))).unwrap().join("");
        assert_eq!(read("TorsGUI.lnk").to_lowercase(), me.to_string_lossy().to_lowercase());
        assert!(read("TorsGUI notepad.lnk").to_lowercase().ends_with("notepad.exe"));
        // a second start changes nothing
        assert!(run_powershell(&retarget_script(&me, "0.6.4", Some(desk))).unwrap().is_empty());
        // the Settings button
        let made = run_powershell(&create_script(&me, Some(desk))).unwrap();
        assert!(made.last().unwrap().ends_with("TorsGUI.lnk"));
    }
}
