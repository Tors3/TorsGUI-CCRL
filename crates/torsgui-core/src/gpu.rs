//! Graphics cards, for GPU engines (Lc0 and the like).
//!
//! NVIDIA cards come from `nvidia-smi`, numbered as CUDA numbers them when
//! `CUDA_DEVICE_ORDER=PCI_BUS_ID` (the runner sets it), so "card 1" is the same card for
//! TorsGUI, nvidia-smi and the engine. Other cards are listed from the system (names only):
//! an engine on DirectML or OpenCL numbers them its own way.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Gpu {
    /// The card's number (CUDA order for NVIDIA cards, system order for the others).
    pub index: u32,
    pub name: String,
    /// Memory in MB (0 when unknown).
    pub memory_mb: u64,
    /// "nvidia-smi" or "system".
    pub source: String,
}

static CACHE: Mutex<Option<Vec<Gpu>>> = Mutex::new(None);

/// The card GPU engines would use: NVIDIA (CUDA builds), AMD Radeon or Intel Arc (DirectML
/// builds), or none (a server's onboard VGA, integrated graphics: the CPU build).
pub fn vendor(cards: &[Gpu]) -> crate::assets::GpuVendor {
    use crate::assets::GpuVendor;
    let name = |g: &Gpu| g.name.to_lowercase();
    if cards.iter().any(|g| g.source == "nvidia-smi" || name(g).contains("nvidia")) {
        GpuVendor::Nvidia
    } else if cards.iter().any(|g| {
        let n = name(g);
        n.contains("radeon") || n.contains("intel(r) arc") || n.contains("intel arc")
    }) {
        GpuVendor::Other
    } else {
        GpuVendor::None
    }
}

/// The graphics cards of this computer (looked up once; `refresh` looks again).
pub fn gpus(refresh: bool) -> Vec<Gpu> {
    let mut c = CACHE.lock().unwrap();
    if refresh || c.is_none() {
        *c = Some(detect());
    }
    c.clone().unwrap_or_default()
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    crate::platform::no_window(&mut cmd);
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

fn detect() -> Vec<Gpu> {
    if let Some(s) = run("nvidia-smi", &["--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"]) {
        let v = parse_nvidia_smi(&s);
        if !v.is_empty() {
            return v;
        }
    }
    #[cfg(windows)]
    if let Some(s) = run("powershell", &["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.Name)|$($_.AdapterRAM)\" }"]) {
        return parse_system(&s);
    }
    #[cfg(target_os = "linux")]
    if let Some(s) = run("lspci", &[]) {
        let names: Vec<String> = s.lines().filter(|l| l.contains("VGA compatible controller") || l.contains("3D controller")).filter_map(|l| l.splitn(3, ':').nth(2)).map(|n| format!("{}|0", n.trim())).collect();
        return parse_system(&names.join("\n"));
    }
    Vec::new()
}

/// `0, NVIDIA GeForce RTX 4090, 24564` per line.
pub fn parse_nvidia_smi(s: &str) -> Vec<Gpu> {
    s.lines()
        .filter_map(|l| {
            let mut f = l.split(',').map(str::trim);
            let index = f.next()?.parse().ok()?;
            let name = f.next()?.to_string();
            let memory_mb = f.next().and_then(|m| m.parse().ok()).unwrap_or(0);
            Some(Gpu { index, name, memory_mb, source: "nvidia-smi".into() })
        })
        .collect()
}

/// `name|bytes` per line (Win32_VideoController; AdapterRAM stops at 4 GB, so it is a hint).
pub fn parse_system(s: &str) -> Vec<Gpu> {
    s.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .enumerate()
        .map(|(i, l)| {
            let (name, ram) = l.split_once('|').unwrap_or((l, ""));
            Gpu { index: i as u32, name: name.trim().into(), memory_mb: ram.trim().parse::<u64>().unwrap_or(0) / 1024 / 1024, source: "system".into() }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_gives_the_build() {
        use crate::assets::GpuVendor;
        let card = |name: &str, source: &str| Gpu { name: name.into(), source: source.into(), ..Default::default() };
        assert_eq!(vendor(&[card("NVIDIA GeForce GTX 1060 6GB", "nvidia-smi")]), GpuVendor::Nvidia);
        assert_eq!(vendor(&[card("AMD Radeon RX 7900 XTX", "system")]), GpuVendor::Other);
        // a server's onboard VGA or integrated graphics: no card for engines
        assert_eq!(vendor(&[card("Matrox G200eR2", "system"), card("Intel(R) UHD Graphics 770", "system")]), GpuVendor::None);
        assert_eq!(vendor(&[]), GpuVendor::None);
    }

    #[test]
    fn reads_nvidia_smi_and_the_system_list() {
        let v = parse_nvidia_smi("0, NVIDIA GeForce RTX 4090, 24564\n1, NVIDIA GeForce RTX 3080, 10240\n");
        assert_eq!(v.len(), 2);
        assert_eq!((v[1].index, v[1].name.as_str(), v[1].memory_mb), (1, "NVIDIA GeForce RTX 3080", 10240));
        let s = parse_system("AMD Radeon RX 7900 XTX|4293918720\r\nMicrosoft Basic Display Adapter|\r\n");
        assert_eq!((s[0].index, s[0].name.as_str(), s[0].memory_mb), (0, "AMD Radeon RX 7900 XTX", 4095));
        assert_eq!((s[1].index, s[1].memory_mb), (1, 0));
    }
}
