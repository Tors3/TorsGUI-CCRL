//! Time-control calculator: CCRL nominal TC x machine factor -> local TC.
//!
//! The factor comes from the Stockfish 10 bench (see `bench`):
//! `factor = local_bench_time / 2054 ms` where the local bench time is the
//! reference node count divided by the measured nps per instance.
//!
//! Default formulas (visible and editable in the UI, evaluated with `evalexpr`):
//! `base = round(B * f)` and `inc = if(I > 0, max(1, round(I * f)), 0)` —
//! the increment is kept integral because some engines mishandle fractional
//! increments (reference: Blitz 2'+1" at f≈0.86 -> 103+1, 40/15 as 15'+10" at
//! f≈1.878 -> 1690+19).

use anyhow::{anyhow, Result};
use evalexpr::{ContextWithMutableVariables, HashMapContext, Value};
use serde::{Deserialize, Serialize};

pub const REF_TIME_MS: f64 = 2054.0;
pub const REF_NODES: u64 = 3_939_338;

pub const DEFAULT_BASE_FORMULA: &str = "round(B * f)";
pub const DEFAULT_INC_FORMULA: &str = "if(I > 0, max(1, round(I * f)), 0)";

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct NominalTc {
    pub id: String,
    pub label: String,
    /// Moves per period (0 = sudden death + increment).
    pub moves: u32,
    pub base_s: f64,
    pub inc_s: f64,
}

pub fn presets() -> Vec<NominalTc> {
    vec![
        NominalTc { id: "blitz".into(), label: "CCRL Blitz 2'+1\"".into(), moves: 0, base_s: 120.0, inc_s: 1.0 },
        NominalTc { id: "40/15".into(), label: "CCRL 40/15 (15'+10\")".into(), moves: 0, base_s: 900.0, inc_s: 10.0 },
        NominalTc { id: "40/15-rep".into(), label: "CCRL 40/15 repeating (40 moves in 15')".into(), moves: 40, base_s: 900.0, inc_s: 0.0 },
        NominalTc { id: "40/2".into(), label: "CCRL 40/2 FRC (40 moves in 2' repeating)".into(), moves: 40, base_s: 120.0, inc_s: 0.0 },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct TcResult {
    pub base_s: f64,
    pub inc_s: f64,
    pub moves: u32,
    /// fastchess `tc=` string, e.g. "103+1" or "40/1352".
    pub fastchess: String,
    pub human: String,
    pub base_formula: String,
    pub inc_formula: String,
}

fn eval(formula: &str, b: f64, i: f64, m: f64, f: f64) -> Result<f64> {
    let mut ctx: HashMapContext = HashMapContext::new();
    ctx.set_value("B".into(), Value::Float(b)).map_err(|e| anyhow!("{e}"))?;
    ctx.set_value("I".into(), Value::Float(i)).map_err(|e| anyhow!("{e}"))?;
    ctx.set_value("M".into(), Value::Float(m)).map_err(|e| anyhow!("{e}"))?;
    ctx.set_value("f".into(), Value::Float(f)).map_err(|e| anyhow!("{e}"))?;
    let v: Value = evalexpr::eval_with_context(formula, &ctx).map_err(|e| anyhow!("formula '{formula}': {e}"))?;
    match v {
        Value::Float(x) => Ok(x),
        Value::Int(x) => Ok(x as f64),
        other => Err(anyhow!("formula '{formula}' returned {other:?}")),
    }
}

pub fn fmt_num(x: f64) -> String {
    if (x - x.round()).abs() < 1e-9 {
        format!("{}", x.round() as i64)
    } else {
        let s = format!("{x:.3}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

pub fn fmt_min(seconds: f64) -> String {
    let s = seconds.round() as i64;
    format!("{}:{:02}", s / 60, s % 60)
}

pub fn compute(nominal: &NominalTc, factor: f64, base_formula: Option<&str>, inc_formula: Option<&str>) -> Result<TcResult> {
    let bf = base_formula.filter(|f| !f.trim().is_empty()).unwrap_or(DEFAULT_BASE_FORMULA);
    let inf = inc_formula.filter(|f| !f.trim().is_empty()).unwrap_or(DEFAULT_INC_FORMULA);
    let b = eval(bf, nominal.base_s, nominal.inc_s, nominal.moves as f64, factor)?;
    let i = eval(inf, nominal.base_s, nominal.inc_s, nominal.moves as f64, factor)?;
    let mut fc = String::new();
    if nominal.moves > 0 {
        fc.push_str(&format!("{}/", nominal.moves));
    }
    fc.push_str(&fmt_num(b));
    if i > 0.0 {
        fc.push_str(&format!("+{}", fmt_num(i)));
    }
    let human = if nominal.moves > 0 {
        format!("{} moves in {}", nominal.moves, fmt_min(b))
    } else {
        format!("{} + {}s", fmt_min(b), fmt_num(i))
    };
    Ok(TcResult { base_s: b, inc_s: i, moves: nominal.moves, fastchess: fc, human, base_formula: bf.into(), inc_formula: inf.into() })
}

/// Parses a fastchess TC ("103+1", "40/900+10", "1690+19") into (moves, base, inc).
pub fn parse_fastchess(tc: &str) -> Option<(u32, f64, f64)> {
    let (moves, rest) = match tc.split_once('/') {
        Some((m, r)) => (m.parse().ok()?, r),
        None => (0, tc),
    };
    let (b, i) = match rest.split_once('+') {
        Some((b, i)) => (b.parse().ok()?, i.parse().ok()?),
        None => (rest.parse().ok()?, 0.0),
    };
    Some((moves, b, i))
}

/// Rough game duration for ETA before any game has finished:
/// both clocks, `plies/2` moves each, using `usage` of the available time.
pub fn estimate_game_seconds(tc: &str, avg_moves: f64) -> f64 {
    match parse_fastchess(tc) {
        Some((0, b, i)) => 2.0 * (b + avg_moves * i) * 0.75,
        Some((m, b, _)) => 2.0 * b * (avg_moves / m as f64).max(1.0) * 0.8,
        None => 600.0,
    }
}

/// Factor from a bench: local equivalent bench time / reference time.
pub fn factor_from_nps(nps_per_instance: f64, ref_ms: f64) -> f64 {
    (REF_NODES as f64 / nps_per_instance * 1000.0) / ref_ms
}

/// Linear interpolation of the factor at `instances` from bench levels
/// (instances, factor), clamped at the ends.
pub fn interpolate_factor(levels: &[(u32, f64)], instances: u32) -> Option<f64> {
    let mut v = levels.to_vec();
    v.sort_by_key(|x| x.0);
    let first = *v.first()?;
    if instances <= first.0 {
        return Some(first.1);
    }
    for w in v.windows(2) {
        let (a, b) = (w[0], w[1]);
        if instances <= b.0 {
            let t = (instances - a.0) as f64 / (b.0 - a.0) as f64;
            return Some(a.1 + t * (b.1 - a.1));
        }
    }
    Some(v.last()?.1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_tcs() {
        let p = presets();
        let blitz = compute(&p[0], 0.86, None, None).unwrap();
        assert_eq!(blitz.fastchess, "103+1");
        let l15 = compute(&p[1], 1.8773, None, None).unwrap();
        assert_eq!(l15.fastchess, "1690+19");
        // increment never rounds to zero
        let fast = compute(&p[0], 0.3, None, None).unwrap();
        assert_eq!(fast.fastchess, "36+1");
        let rep = compute(&p[2], 1.5, None, None).unwrap();
        assert_eq!(rep.fastchess, "40/1350");
        // custom formula: fractional increment
        let c = compute(&p[0], 0.86, None, Some("I * f")).unwrap();
        assert_eq!(c.fastchess, "103+0.86");
        assert!(compute(&p[0], 0.86, Some("bogus("), None).is_err());
    }
    #[test]
    fn factors() {
        // 20260927 bmi2 bench, 1 instance: nps 2278407 -> factor 0.8418
        let f = factor_from_nps(2278407.0, REF_TIME_MS);
        assert!((f - 0.8418).abs() < 0.0005);
        let lv = [(1, 0.8418), (10, 1.0309), (20, 1.2742), (40, 1.3708)];
        assert_eq!(interpolate_factor(&lv, 1), Some(0.8418));
        assert!((interpolate_factor(&lv, 30).unwrap() - 1.3225).abs() < 1e-4);
        assert_eq!(parse_fastchess("40/900+10"), Some((40, 900.0, 10.0)));
        assert_eq!(parse_fastchess("103+1"), Some((0, 103.0, 1.0)));
    }
}
