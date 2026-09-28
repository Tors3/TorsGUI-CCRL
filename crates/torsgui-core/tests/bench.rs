//! Runs the real Stockfish 10 bench when a 64-bit SF10 binary is available
//! (`SF10=/path/to/stockfish`); skipped otherwise.

use std::sync::{Arc, Mutex};
use torsgui_core::bench;

#[test]
fn real_bench_one_instance() {
    let sf = std::env::var("SF10").ok().or_else(|| {
        let p = "/home/user/tools/sf10src/stockfish";
        std::path::Path::new(p).exists().then(|| p.to_string())
    });
    let Some(sf) = sf else {
        eprintln!("SF10 not set: skipping");
        return;
    };
    let cfg = bench::BenchConfig { binaries: vec![("bmi2".into(), sf)], levels: vec![1, 2], runs: 1, warmup: 0, force: true, ..Default::default() };
    let r = bench::run(&cfg, Arc::new(Mutex::new(Default::default()))).unwrap();
    assert!(r.signature_ok, "nodes {:?}", r.signature);
    assert_eq!(r.levels.len(), 2);
    assert!(r.levels[0].factor > 0.2 && r.levels[0].factor < 5.0);
    assert!(r.engine.starts_with("Stockfish 10 64"));
}
