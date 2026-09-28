//! TorsGUI core: everything that is not UI. The Tauri app, the HTTP server
//! and the detached runner are thin shells around this crate.

pub mod export;
pub mod forum;
pub mod model;
pub mod names;
pub mod pgn;
pub mod scheduler;
pub mod stats;
pub mod tc;
