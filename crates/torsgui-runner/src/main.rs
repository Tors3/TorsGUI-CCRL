//! torsgui-runner: the detached process that plays a tournament (and then the
//! following queued ones). It survives the GUI: see `torsgui_core::runner`.
//!
//! ```text
//! torsgui-runner run    --workspace <dir> --id <tournament> [--fastchess <path>]
//! torsgui-runner resume --workspace <dir>      resume tournaments interrupted by a reboot/crash
//! torsgui-runner status --workspace <dir>
//! ```

use std::path::PathBuf;
use torsgui_core::runner;
use torsgui_core::store::Workspace;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let ws = Workspace::new(arg(&args, "--workspace").map(PathBuf::from).unwrap_or_else(Workspace::default_root));
    let code = match args.first().map(|s| s.as_str()) {
        Some("run") => {
            let Some(id) = arg(&args, "--id") else {
                eprintln!("missing --id");
                std::process::exit(2);
            };
            match runner::run_chain(&ws, id, arg(&args, "--fastchess").map(PathBuf::from)) {
                Ok(o) => {
                    eprintln!("runner finished: {o:?}");
                    0
                }
                Err(e) => {
                    eprintln!("runner error: {e:#}");
                    1
                }
            }
        }
        Some("resume") => {
            let ts = ws.open().and_then(|s| s.settings()).map(|s| s.use_task_scheduler).unwrap_or(false);
            match runner::resume_interrupted(&ws, ts) {
                Ok(ids) => {
                    println!("resumed: {ids:?}");
                    0
                }
                Err(e) => {
                    eprintln!("{e:#}");
                    1
                }
            }
        }
        Some("status") => match ws.open().and_then(|s| s.tournaments()) {
            Ok(ts) => {
                for t in ts {
                    let alive = runner::is_running(&ws.tournament_dir(&t.id));
                    println!("{:<48} {:<10} {:>5}/{:<5} runner {}", t.id, t.state.as_str(), t.done_games, t.expected_games, if alive { "alive" } else { "-" });
                }
                0
            }
            Err(e) => {
                eprintln!("{e:#}");
                1
            }
        },
        Some("version") | Some("--version") => {
            println!("torsgui-runner {}", env!("CARGO_PKG_VERSION"));
            0
        }
        _ => {
            eprintln!("usage: torsgui-runner run --workspace <dir> --id <id> | resume --workspace <dir> | status --workspace <dir>");
            2
        }
    };
    std::process::exit(code);
}
