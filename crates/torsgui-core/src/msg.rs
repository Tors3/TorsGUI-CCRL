//! Messages for the interface: a stable code with its parameters, so the UI shows them in the
//! user's language, and the English text (logs, the command line, errors, older UIs).
//!
//! `msg!("check.games.ok", "{done}/{expected} games", done = 58, expected = 60)` writes the
//! English text in place. The test `export_catalog` collects every `msg!` of the crate into
//! `ui/src/bindings/messages.ts`: the English texts of the UI's `backend` area, which every
//! translation must cover (TypeScript checks it).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Msg {
    /// "area.key" in the UI's `backend` texts; empty for a message without translation.
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub args: BTreeMap<String, String>,
    /// The English text, parameters filled in.
    pub text: String,
}

impl Msg {
    /// A message with a code; `template` is its English text with `{name}` parameters.
    pub fn new(code: &str, template: &str, args: Vec<(&str, String)>) -> Msg {
        let args: BTreeMap<String, String> = args.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        let mut text = template.to_string();
        for (k, v) in &args {
            text = text.replace(&format!("{{{k}}}"), v);
        }
        debug_assert!(!PLACEHOLDER.is_match(&text), "{code}: parameter missing in \"{template}\"");
        Msg { code: code.into(), args, text }
    }
    /// A message that has no translation (text from elsewhere: an engine, the OS, a library).
    pub fn plain(text: impl Into<String>) -> Msg {
        Msg { text: text.into(), ..Default::default() }
    }
}

static PLACEHOLDER: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}").unwrap());

impl fmt::Display for Msg {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text)
    }
}

impl From<String> for Msg {
    fn from(s: String) -> Msg {
        Msg::plain(s)
    }
}

impl From<&str> for Msg {
    fn from(s: &str) -> Msg {
        Msg::plain(s)
    }
}

impl PartialEq<str> for Msg {
    fn eq(&self, other: &str) -> bool {
        self.text == other
    }
}

impl Msg {
    pub fn contains(&self, s: &str) -> bool {
        self.text.contains(s)
    }
    pub fn as_str(&self) -> &str {
        &self.text
    }
}

/// `msg!("code", "English {x}", x = value)`: a [`Msg`] with its code and parameters.
#[macro_export]
macro_rules! msg {
    ($code:literal, $text:literal $(, $k:ident = $v:expr)* $(,)?) => {
        $crate::msg::Msg::new($code, $text, vec![$((stringify!($k), ($v).to_string())),*])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameters_are_filled_in() {
        let m = msg!("check.games.ok", "{done}/{expected} games", done = 58, expected = 60);
        assert_eq!(m.text, "58/60 games");
        assert_eq!(m.args["done"], "58");
        assert_eq!(m.to_string(), "58/60 games");
    }

    /// Every `msg!` of the crate: (code, English template).
    fn catalog() -> BTreeMap<String, String> {
        let re = regex::Regex::new(r#"msg!\(\s*"([A-Za-z0-9_.]+)"\s*,\s*"((?:[^"\\]|\\.)*)""#).unwrap();
        let mut out: BTreeMap<String, String> = BTreeMap::new();
        let mut files = vec![std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(p) = files.pop() {
            if p.is_dir() {
                files.extend(std::fs::read_dir(&p).unwrap().flatten().map(|e| e.path()));
            } else if p.extension().is_some_and(|e| e == "rs") && !p.ends_with("msg.rs") {
                let src = std::fs::read_to_string(&p).unwrap();
                for c in re.captures_iter(&src) {
                    let text = c[2].replace("\\\"", "\"").replace("\\\\", "\\");
                    if let Some(old) = out.insert(c[1].to_string(), text.clone()) {
                        assert_eq!(old, text, "{} has two different English texts", &c[1]);
                    }
                }
            }
        }
        out
    }

    #[test]
    fn export_catalog() {
        let cat = catalog();
        assert!(cat.len() > 20, "the msg! calls were not found");
        // codes are "area.key[.key]": a code may not also be the prefix of another
        for k in cat.keys() {
            assert!(!cat.keys().any(|o| o.starts_with(&format!("{k}."))), "{k} is a text and a group");
        }
        // nested object, as the UI's texts
        fn put(node: &mut serde_json::Map<String, serde_json::Value>, path: &[&str], text: &str) {
            if path.len() == 1 {
                node.insert(path[0].into(), text.into());
            } else {
                let child = node.entry(path[0]).or_insert_with(|| serde_json::json!({}));
                put(child.as_object_mut().unwrap(), &path[1..], text);
            }
        }
        let mut root = serde_json::Map::new();
        for (k, v) in &cat {
            put(&mut root, &k.split('.').collect::<Vec<_>>(), v);
        }
        let body = serde_json::to_string_pretty(&serde_json::Value::Object(root)).unwrap();
        let ts = format!("// Generated by torsgui-core (src/msg.rs, test export_catalog) from the msg! calls: do not edit.\n// The English texts of the messages the backend sends (warnings, checks); the UI translates them by code.\nexport const backend = {body};\n");
        if let Ok(dir) = std::env::var("TS_RS_EXPORT_DIR") {
            let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
            let dir = if std::path::Path::new(&dir).is_absolute() { std::path::PathBuf::from(dir) } else { root.join(dir) };
            std::fs::write(dir.join("messages.ts"), ts).unwrap();
        }
    }
}
