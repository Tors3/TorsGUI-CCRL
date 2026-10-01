//! TorsGUI desktop shell (Tauri 2). All logic lives in `torsgui-core`; the
//! window talks to it through one typed command, `api(cmd, args)`.
//! Tournaments run in detached `torsgui-runner` processes: closing, crashing
//! or updating this app never stops them.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, State};
use torsgui_core::api::App;
use torsgui_core::store::{TState, Workspace};

#[tauri::command]
async fn api(state: State<'_, Arc<App>>, cmd: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || app.call(&cmd, args).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

fn tray_status(app: &App) -> String {
    let Ok(store) = app.ws.open() else { return "TorsGUI".into() };
    let ts = store.tournaments().unwrap_or_default();
    let running: Vec<_> = ts.iter().filter(|t| t.state == TState::Running).collect();
    let queued = ts.iter().filter(|t| t.state == TState::Queued).count();
    if running.is_empty() {
        return format!("TorsGUI — idle, {queued} queued");
    }
    let parts: Vec<String> = running.iter().map(|t| format!("{}: {}/{}", t.name, t.done_games, t.expected_games)).collect();
    format!("TorsGUI — {} ({queued} queued)", parts.join(", "))
}

fn main() {
    let root = Workspace::default_root();
    let app = Arc::new(App::new(root).expect("cannot open the TorsGUI workspace"));
    // resume tournaments interrupted by a crash or a reboot
    if let Ok(s) = app.ws.open().and_then(|s| s.settings()) {
        if s.auto_resume {
            let _ = torsgui_core::runner::resume_interrupted(&app.ws, s.use_task_scheduler);
        }
    }
    let status_app = app.clone();
    tauri::Builder::default()
        .manage(app)
        .setup(move |handle| {
            // the engines bundled as resources (Stockfish 10, Triumviratus 7.0)
            if let Ok(dir) = handle.path().resource_dir() {
                let engines = dir.join("engines");
                if engines.join("bundled.json").exists() {
                    // SAFETY: set once at start-up, before any API call reads it
                    unsafe { std::env::set_var("TORSGUI_BUNDLED", &engines) };
                }
                let books = dir.join("books");
                if books.join("books.json").exists() {
                    // SAFETY: as above
                    unsafe { std::env::set_var("TORSGUI_BUNDLED_BOOKS", &books) };
                }
            }
            let show = MenuItem::with_id(handle, "show", "Show TorsGUI", true, None::<&str>)?;
            let quit = MenuItem::with_id(handle, "quit", "Quit (tournaments keep running)", true, None::<&str>)?;
            let menu = Menu::with_items(handle, &[&show, &quit])?;
            let tray = TrayIconBuilder::with_id("main")
                .icon(handle.default_window_icon().cloned().expect("icon"))
                .tooltip("TorsGUI")
                .menu(&menu)
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(handle)?;
            let st = status_app.clone();
            std::thread::spawn(move || loop {
                let _ = tray.set_tooltip(Some(tray_status(&st)));
                std::thread::sleep(std::time::Duration::from_secs(10));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api])
        .run(tauri::generate_context!())
        .expect("error while running TorsGUI");
}
