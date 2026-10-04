//! Desktop notifications: which events of the log deserve one, and their text. The desktop
//! shell polls the event log and shows them (also while the window is hidden in the tray).

use crate::store::EventRecord;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Title and body of the notification for an event, if it deserves one.
pub fn for_event(e: &EventRecord) -> Option<(String, String)> {
    let title = match e.kind.as_str() {
        "tournament_finished" => "Tournament finished",
        "tournament_incomplete" => "Tournament ended with games missing",
        "queue_advanced" => "Next tournament started",
        "engine_problem" => "Engine problem",
        "runner_failed" => "Runner stopped",
        "bench_finished" => "Bench finished",
        "suite_finished" => "Test suite finished",
        "analysis_finished" => "Game analysis finished",
        _ => return None,
    };
    Some((format!("TorsGUI · {title}"), e.message.clone()))
}

/// At most one notification per kind and tournament in a minute (an engine crashing in
/// every game must not flood the desktop).
#[derive(Default)]
pub struct Throttle {
    last: HashMap<(String, Option<String>), Instant>,
}

impl Throttle {
    pub fn allow(&mut self, e: &EventRecord) -> bool {
        let k = (e.kind.clone(), e.tournament_id.clone());
        let now = Instant::now();
        match self.last.get(&k) {
            Some(t) if now.duration_since(*t) < Duration::from_secs(60) => false,
            _ => {
                self.last.insert(k, now);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, t: Option<&str>) -> EventRecord {
        EventRecord { seq: 1, ts: String::new(), level: "info".into(), kind: kind.into(), tournament_id: t.map(String::from), message: "m".into() }
    }

    #[test]
    fn notified_events_and_throttle() {
        assert!(for_event(&ev("tournament_finished", None)).unwrap().0.contains("finished"));
        assert!(for_event(&ev("game_started", None)).is_none());
        let mut th = Throttle::default();
        assert!(th.allow(&ev("engine_problem", Some("a"))));
        assert!(!th.allow(&ev("engine_problem", Some("a"))));
        assert!(th.allow(&ev("engine_problem", Some("b"))));
        assert!(th.allow(&ev("tournament_finished", Some("a"))));
    }
}
