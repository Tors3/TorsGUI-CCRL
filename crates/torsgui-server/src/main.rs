//! torsgui-server: serves the TorsGUI web UI and the command API over HTTP
//! (`POST /api/<command>`). Used for development, the Playwright tests and
//! screenshots, and as the base of a future remote web view. It listens on
//! 127.0.0.1 unless `--listen` says otherwise.
//!
//! ```text
//! torsgui-server [--workspace DIR] [--listen 127.0.0.1:7878] [--static ui/dist]
//! ```

use std::path::{Path, PathBuf};
use std::sync::Arc;
use torsgui_core::api::App;
use torsgui_core::store::Workspace;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "wav" => "audio/wav",
        "ico" => "image/x-icon",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = arg(&args, "--workspace").map(PathBuf::from).unwrap_or_else(Workspace::default_root);
    let listen = arg(&args, "--listen").unwrap_or_else(|| "127.0.0.1:7878".into());
    let static_dir = arg(&args, "--static").map(PathBuf::from);
    let app = Arc::new(App::new(root.clone()).expect("cannot open the workspace"));
    let server = Arc::new(tiny_http::Server::http(&listen).expect("cannot listen"));
    eprintln!("TorsGUI server on http://{listen} (workspace {})", root.display());
    let mut hs = Vec::new();
    for _ in 0..8 {
        let (server, app, static_dir) = (server.clone(), app.clone(), static_dir.clone());
        hs.push(std::thread::spawn(move || loop {
            let Ok(mut req) = server.recv() else { break };
            let url = req.url().split('?').next().unwrap_or("/").to_string();
            let cors = tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
            if let Some(cmd) = url.strip_prefix("/api/") {
                let mut body = String::new();
                let _ = req.as_reader().read_to_string(&mut body);
                let a: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                let (code, out) = match app.call(cmd, a) {
                    Ok(v) => (200, v.to_string()),
                    Err(e) => (400, serde_json::json!({"error": format!("{e:#}")}).to_string()),
                };
                let resp = tiny_http::Response::from_string(out)
                    .with_status_code(code)
                    .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap())
                    .with_header(cors);
                let _ = req.respond(resp);
                continue;
            }
            let Some(dir) = &static_dir else {
                let _ = req.respond(tiny_http::Response::from_string("TorsGUI API server").with_status_code(200));
                continue;
            };
            let rel = url.trim_start_matches('/');
            let mut p = dir.join(if rel.is_empty() { "index.html" } else { rel });
            if rel.contains("..") || !p.is_file() {
                p = dir.join("index.html");
            }
            match std::fs::read(&p) {
                Ok(b) => {
                    let _ = req.respond(tiny_http::Response::from_data(b).with_header(tiny_http::Header::from_bytes("Content-Type", mime(&p)).unwrap()));
                }
                Err(_) => {
                    let _ = req.respond(tiny_http::Response::from_string("not found").with_status_code(404));
                }
            }
        }));
    }
    for h in hs {
        let _ = h.join();
    }
}
