//! Release asset selection following the CCRL rules:
//!
//! * choose the Windows **AVX2** build (x86-64-v3 counts as the AVX2 level);
//! * **never** AVX-512, VNNI, `avx512`, `x86-64-v4` for CCRL (even when the CPU has them);
//!   they can be enabled as a *personal* option ([`AssetPolicy`]): then they are accepted,
//!   always flagged "not valid for CCRL", and optionally preferred when the CPU supports them;
//! * if only a `bmi2`/`pext`, popcnt or generic x86-64 build exists, take it but flag it;
//! * never 32-bit, ARM, macOS, Android;
//! * never compile: when nothing fits, report it and skip.
//!
//! Every decision carries a human-readable reason.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TargetOs {
    Windows,
    Linux,
}

impl TargetOs {
    pub fn current() -> TargetOs {
        if cfg!(windows) {
            TargetOs::Windows
        } else {
            TargetOs::Linux
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct AssetVerdict {
    pub name: String,
    pub accepted: bool,
    /// Lower is better (0 = pure AVX2).
    pub tier: u32,
    pub build: String,
    pub flagged: bool,
    pub reason: String,
    pub is_archive: bool,
    pub is_network: bool,
    /// Allowed by the CCRL rules (false for AVX-512 builds accepted as a personal option).
    pub ccrl_ok: bool,
}

/// Which builds are acceptable beyond the CCRL rules.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct AssetPolicy {
    /// Accept AVX-512 / VNNI / x86-64-v4 builds (personal testing, never for CCRL).
    pub allow_avx512: bool,
    /// Rank them first when this CPU supports them.
    pub prefer_avx512: bool,
    pub cpu_avx512: bool,
    pub cpu_vnni: bool,
}

impl AssetPolicy {
    /// The CCRL policy: AVX-512 never accepted.
    pub fn ccrl() -> AssetPolicy {
        AssetPolicy::default()
    }
    /// The personal policy with the capabilities of this CPU.
    pub fn personal(prefer: bool) -> AssetPolicy {
        let (cpu_avx512, cpu_vnni) = cpu_avx512();
        AssetPolicy { allow_avx512: true, prefer_avx512: prefer, cpu_avx512, cpu_vnni }
    }
}

/// (AVX-512F+BW, AVX-512 VNNI) support of the running CPU.
pub fn cpu_avx512() -> (bool, bool) {
    #[cfg(target_arch = "x86_64")]
    {
        let f = std::arch::is_x86_feature_detected!("avx512f") && std::arch::is_x86_feature_detected!("avx512bw");
        (f, f && std::arch::is_x86_feature_detected!("avx512vnni"))
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        (false, false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Selection {
    pub chosen: Option<String>,
    pub build: String,
    pub flagged: bool,
    pub ccrl_ok: bool,
    pub reason: String,
    /// Extra files to download with the binary (networks shipped separately).
    pub extra: Vec<String>,
    pub verdicts: Vec<AssetVerdict>,
}

fn has(re: &str, s: &str) -> bool {
    Regex::new(re).unwrap().is_match(s)
}

static ARCHIVE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\.(zip|7z|tar\.gz|tgz|tar\.xz|tar|tar\.bz2)$").unwrap());
static NETWORK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\.(nnue|bin|nn|net|onnx)$").unwrap());

pub fn is_archive(name: &str) -> bool {
    ARCHIVE.is_match(name)
}
pub fn is_network(name: &str) -> bool {
    NETWORK.is_match(name)
}

/// Classifies one asset name with the CCRL policy.
pub fn classify(name: &str, os: TargetOs) -> AssetVerdict {
    classify_with(name, os, AssetPolicy::ccrl())
}

/// Classifies one asset name.
pub fn classify_with(name: &str, os: TargetOs, policy: AssetPolicy) -> AssetVerdict {
    let n = name.to_lowercase();
    let mut v = AssetVerdict {
        name: name.to_string(),
        accepted: false,
        tier: 99,
        build: String::new(),
        flagged: false,
        reason: String::new(),
        is_archive: is_archive(&n),
        is_network: is_network(&n),
        ccrl_ok: true,
    };
    let reject = |mut v: AssetVerdict, why: &str| {
        v.reason = why.to_string();
        v
    };
    if v.is_network {
        return reject(v, "network file (downloaded separately if needed)");
    }
    if has(r"(?i)(\.sha256|\.sha512|\.md5|\.sig|\.asc|sha256sums|checksums?|\.txt$|\.md$|\.pdf$|\.json$)", &n) {
        return reject(v, "checksum / documentation file");
    }
    if has(r"(?i)(source|src)[-_.]|^source|\.src\.", &n) || n == "source code" {
        return reject(v, "source archive (TorsGUI never compiles engines)");
    }
    let avx512 = has(r"(?i)(avx-?512|avx512|vnni|x86[-_]?64[-_]v4|(^|[-_.])v4([-_.]|$)|zen4|zen5|icelake|sapphire|cascadelake|skylake-?x)", &n)
        || has(r"(?i)[-_]512([-_.]|$)", &n);
    if avx512 && !policy.allow_avx512 {
        return reject(v, "AVX-512/VNNI/x86-64-v4 build: never used for CCRL");
    }
    if has(r"(?i)(aarch64|arm64|armv\d|[-_]arm[-_.]|neon|apple|macos|darwin|osx|android|riscv|ppc|wasm)", &n) {
        return reject(v, "not an x86-64 desktop build");
    }
    if has(r"(?i)(x86[-_]?32|i[3-6]86|win32|32[-_]?bit|[-_]x32|[-_]32\.exe$|[-_]32([-_.]|$))", &n)
        || (has(r"(?i)(^|[-_.])x86([-_.]|$)", &n) && !has(r"(?i)x86[-_]?64", &n))
    {
        return reject(v, "32-bit build: never used");
    }
    let windows = has(r"(?i)(win|windows|\.exe$|msvc|mingw)", &n);
    let linux = has(r"(?i)(linux|ubuntu|musl|gnu|\.appimage$)", &n);
    match os {
        TargetOs::Windows => {
            if linux && !windows {
                return reject(v, "Linux build");
            }
            if !windows && !v.is_archive {
                // a bare file without .exe and without a platform marker is a unix binary
                return reject(v, "no Windows marker (not .exe)");
            }
        }
        TargetOs::Linux => {
            if windows && !linux {
                return reject(v, "Windows build");
            }
        }
    }
    if avx512 {
        let vnni = has(r"(?i)vnni", &n);
        v.accepted = true;
        v.flagged = true;
        v.ccrl_ok = false;
        v.tier = if vnni { 8 } else if has(r"(?i)avx-?512|[-_]512([-_.]|$)", &n) { 9 } else { 10 };
        v.build = if vnni { "avx512-vnni".into() } else if v.tier == 9 { "avx512".into() } else { "x86-64-v4".into() };
        let cpu_ok = if vnni { policy.cpu_vnni } else { policy.cpu_avx512 };
        v.reason = if cpu_ok {
            "AVX-512 build: personal use only, not valid for CCRL".into()
        } else if vnni {
            "AVX-512 VNNI build: personal use only, not valid for CCRL; this CPU has no AVX-512 VNNI (the engine would crash here)".into()
        } else {
            "AVX-512 build: personal use only, not valid for CCRL; this CPU has no AVX-512 (the engine would crash here)".into()
        };
        if v.is_archive {
            v.reason.push_str(" (archive: contents are checked after extraction)");
        }
        return v;
    }
    // ISA tiers
    let avx2 = has(r"(?i)(avx2|haswell)", &n);
    let v3 = has(r"(?i)(x86[-_]?64[-_]v3|(^|[-_.])v3([-_.]|$))", &n);
    let nopext = has(r"(?i)(no[-_]?pext|nopext|no[-_]?bmi2)", &n);
    let bmi2 = has(r"(?i)(bmi2|pext)", &n) && !nopext;
    let vendor = has(r"(?i)[-_](intel|amd|zen\d?)([-_.]|$)", &n);
    let popcnt = has(r"(?i)(popcnt|sse4|modern|sse3|ssse3|sse41|sse42)", &n);
    let universal = has(r"(?i)universal", &n);
    v.accepted = true;
    if avx2 && !bmi2 && !vendor && !nopext {
        v.tier = 0;
        v.build = if popcnt { "avx2-popcnt".into() } else { "avx2".into() };
        v.reason = "AVX2 build".into();
    } else if v3 {
        v.tier = 1;
        v.build = "x86-64-v3".into();
        v.reason = "x86-64-v3 (AVX2 level)".into();
    } else if avx2 && (nopext || vendor) {
        v.tier = 2;
        v.build = "avx2 (variant)".into();
        v.reason = "AVX2 variant (vendor/no-pext)".into();
    } else if avx2 && bmi2 {
        v.tier = 3;
        v.build = "avx2-bmi2".into();
        v.flagged = true;
        v.reason = "AVX2 with BMI2/PEXT (no pure AVX2 build published)".into();
    } else if bmi2 {
        v.tier = 4;
        v.build = "bmi2".into();
        v.flagged = true;
        v.reason = "only a BMI2 build exists: flagged".into();
    } else if popcnt {
        v.tier = 5;
        v.build = "popcnt".into();
        v.flagged = true;
        v.reason = "only a popcnt/SSE build exists: flagged".into();
    } else if universal {
        v.tier = 6;
        v.build = "universal".into();
        v.flagged = true;
        v.reason = "universal binary: runtime dispatch may use AVX-512 on this CPU (flagged)".into();
    } else {
        v.tier = 7;
        v.build = "generic x86-64".into();
        v.flagged = true;
        v.reason = "generic x86-64 build (no ISA in the name): flagged".into();
    }
    if v.is_archive {
        v.reason.push_str(" (archive: contents are checked after extraction)");
    }
    v
}

/// Picks the best asset with the CCRL policy.
pub fn select(names: &[String], os: TargetOs) -> Selection {
    select_with(names, os, AssetPolicy::ccrl())
}

/// Picks the best asset. Archives rank just after bare executables of the same tier.
/// AVX-512 builds (personal policy only) come last unless preferred and supported by the CPU.
pub fn select_with(names: &[String], os: TargetOs, policy: AssetPolicy) -> Selection {
    let verdicts: Vec<AssetVerdict> = names.iter().map(|n| classify_with(n, os, policy)).collect();
    let mut acc: Vec<&AssetVerdict> = verdicts.iter().filter(|v| v.accepted).collect();
    let preferred = |v: &AssetVerdict| -> bool {
        !v.ccrl_ok && policy.prefer_avx512 && if v.build == "avx512-vnni" { policy.cpu_vnni } else { policy.cpu_avx512 }
    };
    acc.sort_by_key(|v| {
        (
            !preferred(v),
            v.tier,
            v.is_archive as u8,
            has(r"(?i)(debug|dbg|symbols|pdb)", &v.name) as u8,
            v.name.len(),
        )
    });
    let extra: Vec<String> = verdicts.iter().filter(|v| v.is_network).map(|v| v.name.clone()).collect();
    match acc.first() {
        Some(best) => {
            let mut reason = format!("{}: {}", best.name, best.reason);
            let alts: Vec<&str> = acc.iter().skip(1).take(3).map(|v| v.name.as_str()).collect();
            if !alts.is_empty() {
                reason.push_str(&format!("; preferred over {}", alts.join(", ")));
            }
            Selection {
                chosen: Some(best.name.clone()),
                build: best.build.clone(),
                flagged: best.flagged,
                ccrl_ok: best.ccrl_ok,
                reason,
                extra,
                verdicts,
            }
        }
        None => Selection {
            chosen: None,
            build: String::new(),
            flagged: true,
            ccrl_ok: true,
            reason: "no suitable prebuilt binary: skipped (TorsGUI does not compile engines)".into(),
            extra,
            verdicts,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(assets: &[&str]) -> Selection {
        select(&assets.iter().map(|s| s.to_string()).collect::<Vec<_>>(), TargetOs::Windows)
    }

    /// Real asset names (engines/REPORT.md, CCRL_ScirptsTests) together with the
    /// traps published next to them; the chosen asset must equal the report's.
    #[test]
    fn report_choices() {
        let cases: &[(&[&str], &str, bool)] = &[
            (&["caissa-2.0-x64-avx2.exe", "caissa-2.0-x64-avx512.exe", "caissa-2.0-x64-bmi2.exe", "caissa-2.0-x64-legacy.exe", "caissa-2.0-linux-avx2", "Source code (zip)"], "caissa-2.0-x64-avx2.exe", false),
            (&["stockfish-windows-x86-64-universal.exe", "stockfish-ubuntu-x86-64-universal", "stockfish-android-armv8", "stockfish-macos-m1-apple-silicon"], "stockfish-windows-x86-64-universal.exe", true),
            (&["reckless-windows-avx2.exe", "reckless-windows-avx512.exe", "reckless-linux-avx2"], "reckless-windows-avx2.exe", false),
            (&["PlentyChess-7.0.0-windows-avx2.exe", "PlentyChess-7.0.0-windows-avx512vnni.exe", "PlentyChess-7.0.0-windows-avx512.exe", "PlentyChess-7.0.0-windows-bmi2.exe"], "PlentyChess-7.0.0-windows-avx2.exe", false),
            (&["pawnocchio-2.0.1-windows-x86_64_v3.exe", "pawnocchio-2.0.1-windows-x86_64_v4.exe", "pawnocchio-2.0.1-windows-x86_64_v2.exe", "pawnocchio-2.0.1-linux-x86_64_v3"], "pawnocchio-2.0.1-windows-x86_64_v3.exe", false),
            (&["Obsidian160-avx2.exe", "Obsidian160-avx2-pext.exe", "Obsidian160-avx512.exe", "Obsidian160-vnni512.exe"], "Obsidian160-avx2.exe", false),
            (&["cinder-v0.6.1-windows-avx2.exe", "cinder-v0.6.1-windows-avx512.exe", "cinder-v0.6.1-linux-avx2"], "cinder-v0.6.1-windows-avx2.exe", false),
            (&["Alexandria-9.0-avx2.exe", "Alexandria-9.0-bmi2.exe", "Alexandria-9.0-avx512.exe", "Alexandria-9.0-vnni512.exe"], "Alexandria-9.0-avx2.exe", false),
            (&["stormphrax-8.0.0-avx2-bmi2.exe", "stormphrax-8.0.0-avx512.exe", "stormphrax-8.0.0-zen2.exe"], "stormphrax-8.0.0-avx2-bmi2.exe", true),
            (&["hobbes-windows-avx2.exe", "hobbes-linux-avx2", "hobbes-macos"], "hobbes-windows-avx2.exe", false),
            (&["viridithas-20-win-x86-64-v3.exe", "viridithas-20-win-x86-64-v4.exe", "viridithas-20-linux-x86-64-v3"], "viridithas-20-win-x86-64-v3.exe", false),
            (&["coda-0.9.3-windows-x86-64-v3.exe", "coda-0.9.3-windows-x86-64-v3.exe.sha256", "coda-0.9.3-windows-x86-64-v4.exe", "coda-0.9.3-linux-x86-64-v3"], "coda-0.9.3-windows-x86-64-v3.exe", false),
            (&["astra-7.0-avx2.exe", "astra-7.0-avx512.exe", "astra-7.0-linux-avx2"], "astra-7.0-avx2.exe", false),
            (&["berserk-14-avx2.exe", "berserk-14-avx512.exe", "berserk-14-x64-popcnt.exe", "berserk-9b84c340af7e.nn"], "berserk-14-avx2.exe", false),
            (&["tarnished-6.0-eternal_x86-64-avx2.exe", "tarnished-6.0-eternal_x86-64-avx512.exe"], "tarnished-6.0-eternal_x86-64-avx2.exe", false),
            (&["Halogen-16.0.0-windows-x86_64-avx2.exe", "Halogen-16.0.0-windows-x86_64-avx512.exe", "Halogen-16.0.0-windows-x86_64-avx512vnni.exe", "Halogen-16.0.0-linux-x86_64-avx2"], "Halogen-16.0.0-windows-x86_64-avx2.exe", false),
            (&["Quanticade-Windows-clang-x86-64-bmi2.exe", "Quanticade-Windows-clang-x86-64-avx512.exe", "Quanticade-Linux-clang-x86-64-bmi2"], "Quanticade-Windows-clang-x86-64-bmi2.exe", true),
            (&["Clover.9.0-avx2.exe", "Clover.9.0-avx512.exe", "Clover.9.0-old.exe"], "Clover.9.0-avx2.exe", false),
            (&["Triumviratus_7.0_avx2.exe", "Triumviratus_7.0_avx2-intel.exe", "Triumviratus_7.0_avx2-nopext.exe", "Triumviratus_7.0_avx512.exe", "SHA256SUMS.txt"], "Triumviratus_7.0_avx2.exe", false),
            (&["pzchessbot-win-avx2-pext.exe", "pzchessbot-win-avx512.exe", "pzchessbot-win-no-pext.exe", "pzchessbot-neon", "pznet53.nnue"], "pzchessbot-win-avx2-pext.exe", true),
            (&["integral_avx2.exe", "integral_avx512.exe", "integral_bmi2.exe", "integral_avx2_linux"], "integral_avx2.exe", false),
            (&["horsie-1_1-v3.exe", "horsie-1_1-v4.exe", "horsie-1_1-v3-linux"], "horsie-1_1-v3.exe", false),
            (&["Lizard-11_2-win.exe", "Lizard-11_2-win-512.exe", "Lizard-11_2-linux"], "Lizard-11_2-win.exe", true),
            (&["Raphael-4.2.0-Windows-avx2.exe", "Raphael-4.2.0-Windows-avx512.exe", "Raphael-4.2.0-Linux-avx2"], "Raphael-4.2.0-Windows-avx2.exe", false),
            (&["RubiChess-20240817.zip", "RubiChess-20240817-linux.tar.gz", "Source code (zip)"], "RubiChess-20240817.zip", true),
            (&["Starzix-6.1-avx2.exe", "Starzix-6.1-avx512.exe", "Starzix-6.1-linux-avx2"], "Starzix-6.1-avx2.exe", false),
            (&["devre-7.0-avx2.exe", "devre-7.0-avx512.exe", "devre-7.0-popcnt.exe"], "devre-7.0-avx2.exe", false),
            (&["Titan-x64-windows-avx2.exe", "Titan-x64-windows-avx512.exe", "Titan-x64-linux-avx2"], "Titan-x64-windows-avx2.exe", false),
            (&["velvet-v8.1.1-x86_64-avx2.exe", "velvet-v8.1.1-x86_64-avx512.exe", "velvet-v8.1.1-x86_64-sse4.exe", "velvet-v8.1.1-x86_64-avx2-linux"], "velvet-v8.1.1-x86_64-avx2.exe", false),
            (&["minke-v7.0.0-avx2.exe", "minke-v7.0.0-avx512.exe"], "minke-v7.0.0-avx2.exe", false),
            (&["seer_v2.8_x64_avx2_popcnt.exe", "seer_v2.8_x64_avx512_popcnt.exe", "seer_v2.8_x64_popcnt.exe"], "seer_v2.8_x64_avx2_popcnt.exe", false),
            (&["Koivisto_9.0-windows-avx2-pgo.exe", "Koivisto_9.0-windows-avx512-pgo.exe", "Koivisto_9.0-linux-avx2-pgo"], "Koivisto_9.0-windows-avx2-pgo.exe", false),
            (&["Renegade_1.3.1_windows_x86-64-bmi2.exe", "Renegade_1.3.1_linux_x86-64-bmi2"], "Renegade_1.3.1_windows_x86-64-bmi2.exe", true),
            (&["blackmarlin-windows-x86-64-v3.exe", "blackmarlin-windows-x86-64-v4.exe", "blackmarlin-linux-x86-64-v3"], "blackmarlin-windows-x86-64-v3.exe", false),
            (&["sirius-9.0-windows-x86-64-v3.exe", "sirius-9.0-windows-x86-64-v4.exe"], "sirius-9.0-windows-x86-64-v3.exe", false),
            (&["motor_090_avx2.exe", "motor_090_avx512.exe", "motor_090_linux_avx2"], "motor_090_avx2.exe", false),
        ];
        for (assets, want, flagged) in cases {
            let s = pick(assets);
            assert_eq!(s.chosen.as_deref(), Some(*want), "assets {assets:?}: {}", s.reason);
            assert_eq!(s.flagged, *flagged, "flag for {want}: {}", s.reason);
        }
    }

    #[test]
    fn traps() {
        for bad in [
            "engine-avx512.exe",
            "engine-avx-512.exe",
            "engine-x86-64-v4.exe",
            "engine_v4.exe",
            "engine-vnni.exe",
            "engine-avx512vnni.exe",
            "engine-win32.exe",
            "engine-x86.exe",
            "engine-32bit.exe",
            "engine-i686.exe",
            "engine-arm64.exe",
            "engine.exe.sha256",
            "Source code (zip)",
        ] {
            assert!(!classify(bad, TargetOs::Windows).accepted, "{bad} must be rejected");
        }
        let s = pick(&["engine-avx512.exe", "engine-win32.exe"]);
        assert!(s.chosen.is_none());
        assert!(s.flagged);
        assert!(classify("engine-x86-64.exe", TargetOs::Windows).flagged);
        let s = pick(&["e-bmi2.exe", "e-x86-64.exe", "e-avx512.exe"]);
        assert_eq!(s.chosen.as_deref(), Some("e-bmi2.exe"));
        assert!(s.flagged);
        let s = pick(&["net.nnue", "e-avx2.exe"]);
        assert_eq!(s.extra, vec!["net.nnue".to_string()]);
        // linux target (development)
        let s = select(&["e-linux-avx2".to_string(), "e-windows-avx2.exe".to_string()], TargetOs::Linux);
        assert_eq!(s.chosen.as_deref(), Some("e-linux-avx2"));
    }

    #[test]
    fn personal_avx512() {
        let names: Vec<String> = ["e-avx2.exe", "e-avx512.exe", "e-avx512vnni.exe", "e-x86-64-v4.exe", "e-win32.exe"].iter().map(|s| s.to_string()).collect();
        let cpu = |f, vnni| AssetPolicy { allow_avx512: true, prefer_avx512: false, cpu_avx512: f, cpu_vnni: vnni };
        // allowed but not preferred: the CCRL choice stays, AVX-512 builds become selectable
        let s = select_with(&names, TargetOs::Windows, cpu(true, true));
        assert_eq!(s.chosen.as_deref(), Some("e-avx2.exe"));
        assert!(s.ccrl_ok && !s.flagged);
        let v = s.verdicts.iter().find(|v| v.name == "e-avx512.exe").unwrap();
        assert!(v.accepted && v.flagged && !v.ccrl_ok && v.reason.contains("not valid for CCRL"), "{v:?}");
        assert!(!s.verdicts.iter().find(|v| v.name == "e-win32.exe").unwrap().accepted);
        // preferred: VNNI when the CPU has it, plain AVX-512 otherwise, AVX2 without AVX-512
        let pref = |f, vnni| AssetPolicy { prefer_avx512: true, ..cpu(f, vnni) };
        let s = select_with(&names, TargetOs::Windows, pref(true, true));
        assert_eq!(s.chosen.as_deref(), Some("e-avx512vnni.exe"));
        assert!(!s.ccrl_ok && s.flagged);
        assert_eq!(select_with(&names, TargetOs::Windows, pref(true, false)).chosen.as_deref(), Some("e-avx512.exe"));
        assert_eq!(select_with(&names, TargetOs::Windows, pref(false, false)).chosen.as_deref(), Some("e-avx2.exe"));
        let v = classify_with("e-avx512.exe", TargetOs::Windows, pref(false, false));
        assert!(v.reason.contains("would crash"));
        // only AVX-512 published: taken (flagged) with the personal policy, skipped for CCRL
        let only: Vec<String> = vec!["e-avx512.exe".into()];
        assert_eq!(select_with(&only, TargetOs::Windows, cpu(true, false)).chosen.as_deref(), Some("e-avx512.exe"));
        assert!(select(&only, TargetOs::Windows).chosen.is_none());
        assert_eq!(classify_with("Obsidian160-vnni512.exe", TargetOs::Windows, cpu(true, true)).build, "avx512-vnni");
        assert_eq!(classify_with("coda-0.9.3-windows-x86-64-v4.exe", TargetOs::Windows, cpu(true, true)).build, "x86-64-v4");
    }
}
