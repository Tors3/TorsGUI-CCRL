//! Small helpers shared by several modules.

/// "0-3,8,10-11" from a list of ids.
pub fn compact_list(v: &[u32]) -> String {
    let mut v = v.to_vec();
    v.sort();
    v.dedup();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < v.len() {
        let mut j = i;
        while j + 1 < v.len() && v[j + 1] == v[j] + 1 {
            j += 1;
        }
        out.push(if i == j { v[i].to_string() } else { format!("{}-{}", v[i], v[j]) });
        i = j + 1;
    }
    out.join(",")
}

/// "3d 4h", "2h 05m", "12m", "45s".
pub fn human_duration(secs: f64) -> String {
    if !secs.is_finite() || secs < 0.0 {
        return "?".into();
    }
    let s = secs.round() as u64;
    let (d, h, m) = (s / 86400, s % 86400 / 3600, s % 3600 / 60);
    if d > 0 {
        format!("{d}d {h}h")
    } else if h > 0 {
        format!("{h}h {m:02}m")
    } else if m > 0 {
        format!("{m}m")
    } else {
        format!("{s}s")
    }
}

pub fn dir_size(p: &std::path::Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().filter_map(|e| e.ok()).filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum()
}

#[cfg(test)]
mod tests {
    #[test]
    fn compact() {
        assert_eq!(super::compact_list(&[0, 2, 4, 5, 6, 8]), "0,2,4-6,8");
        assert_eq!(super::human_duration(3700.0), "1h 01m");
    }
}
