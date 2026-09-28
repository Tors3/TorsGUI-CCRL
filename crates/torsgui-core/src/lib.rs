//! TorsGUI core: everything that is not UI. The Tauri app, the HTTP server
//! and the detached runner are thin shells around this crate.

pub mod analysis;
pub mod assets;
pub mod ccrl;
pub mod engines;
pub mod export;
pub mod fastchess;
pub mod forum;
pub mod github;
pub mod legacy;
pub mod model;
pub mod names;
pub mod pgn;
pub mod platform;
pub mod scheduler;
pub mod stats;
pub mod store;
pub mod tc;
pub mod util;
