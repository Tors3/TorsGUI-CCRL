//! The user's own database: games (engine or human) and positions, in folders with subfolders.
//!
//! Games are imported from PGN files, folders or pasted text and kept in the workspace database
//! with their PGN, so the original files may move or disappear; the tags used to search and
//! sort (players, Elo, result, date, event, ECO, opening) are copied into columns. Positions are
//! FENs (or EPD lines) with a title and a note.

use crate::store::{now, Store};
use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS db_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS db_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection INTEGER NOT NULL,
  white TEXT NOT NULL DEFAULT '',
  black TEXT NOT NULL DEFAULT '',
  white_elo INTEGER,
  black_elo INTEGER,
  result TEXT NOT NULL DEFAULT '*',
  date TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  eco TEXT NOT NULL DEFAULT '',
  opening TEXT NOT NULL DEFAULT '',
  plies INTEGER NOT NULL DEFAULT 0,
  pgn TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS db_games_collection ON db_games(collection);
CREATE TABLE IF NOT EXISTS db_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection INTEGER NOT NULL,
  fen TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS db_positions_collection ON db_positions(collection);
"#;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct DbCollection {
    pub id: i64,
    pub name: String,
    pub parent: Option<i64>,
    /// Games and positions in this folder (not counting its subfolders).
    pub games: u32,
    pub positions: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct DbGame {
    pub id: i64,
    pub collection: i64,
    pub white: String,
    pub black: String,
    pub white_elo: Option<i64>,
    pub black_elo: Option<i64>,
    pub result: String,
    pub date: String,
    pub event: String,
    pub site: String,
    pub eco: String,
    pub opening: String,
    pub plies: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct DbPosition {
    pub id: i64,
    pub collection: i64,
    pub fen: String,
    pub title: String,
    pub note: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct DbImport {
    pub added: u32,
    /// Blocks that are not games (no moves and no tags), skipped.
    pub skipped: u32,
    pub files: u32,
}

/// The PGN files of `path`: the file itself, or every `.pgn` of a folder and its subfolders.
pub fn pgn_files(path: &Path) -> Vec<std::path::PathBuf> {
    if path.is_file() {
        return vec![path.to_path_buf()];
    }
    let mut out = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pgn")) {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

fn elo(v: Option<&str>) -> Option<i64> {
    v.and_then(|s| s.trim().parse::<i64>().ok()).filter(|e| *e > 0)
}

impl Store {
    pub fn db_collections(&self) -> Result<Vec<DbCollection>> {
        let mut st = self.conn.prepare(
            "SELECT c.id, c.name, c.parent, \
             (SELECT COUNT(*) FROM db_games g WHERE g.collection=c.id), \
             (SELECT COUNT(*) FROM db_positions p WHERE p.collection=c.id) \
             FROM db_collections c ORDER BY c.name COLLATE NOCASE",
        )?;
        let rows = st.query_map([], |r| Ok(DbCollection { id: r.get(0)?, name: r.get(1)?, parent: r.get(2)?, games: r.get::<_, i64>(3)? as u32, positions: r.get::<_, i64>(4)? as u32 }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn db_collection_create(&self, name: &str, parent: Option<i64>) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() {
            bail!("a folder needs a name");
        }
        if let Some(p) = parent {
            self.db_collection_exists(p)?;
        }
        self.conn.execute("INSERT INTO db_collections(name, parent, created_at) VALUES(?1, ?2, ?3)", params![name, parent, now()])?;
        Ok(self.conn.last_insert_rowid())
    }

    fn db_collection_exists(&self, id: i64) -> Result<()> {
        self.conn.query_row("SELECT id FROM db_collections WHERE id=?1", [id], |r| r.get::<_, i64>(0)).optional()?.context("folder not found")?;
        Ok(())
    }

    pub fn db_collection_rename(&self, id: i64, name: &str) -> Result<()> {
        if name.trim().is_empty() {
            bail!("a folder needs a name");
        }
        self.conn.execute("UPDATE db_collections SET name=?2 WHERE id=?1", params![id, name.trim()])?;
        Ok(())
    }

    /// Moves a folder under another (None: to the top); never under itself or its subfolders.
    pub fn db_collection_move(&self, id: i64, parent: Option<i64>) -> Result<()> {
        if let Some(p) = parent {
            if self.db_subtree(id)?.contains(&p) {
                bail!("a folder cannot go inside itself");
            }
        }
        self.conn.execute("UPDATE db_collections SET parent=?2 WHERE id=?1", params![id, parent])?;
        Ok(())
    }

    /// The folder and every folder below it.
    pub fn db_subtree(&self, id: i64) -> Result<Vec<i64>> {
        let all = self.db_collections()?;
        let mut out = vec![id];
        let mut i = 0;
        while i < out.len() {
            let cur = out[i];
            out.extend(all.iter().filter(|c| c.parent == Some(cur)).map(|c| c.id));
            i += 1;
        }
        Ok(out)
    }

    /// Deletes a folder with its subfolders, games and positions.
    pub fn db_collection_delete(&self, id: i64) -> Result<()> {
        for c in self.db_subtree(id)? {
            self.conn.execute("DELETE FROM db_games WHERE collection=?1", [c])?;
            self.conn.execute("DELETE FROM db_positions WHERE collection=?1", [c])?;
            self.conn.execute("DELETE FROM db_collections WHERE id=?1", [c])?;
        }
        Ok(())
    }

    /// Imports the games of a PGN text into a folder.
    pub fn db_import_text(&mut self, collection: i64, text: &str) -> Result<DbImport> {
        self.db_collection_exists(collection)?;
        let mut r = DbImport::default();
        let tx = self.conn.transaction()?;
        {
            let mut ins = tx.prepare(
                "INSERT INTO db_games(collection, white, black, white_elo, black_elo, result, date, event, site, eco, opening, plies, pgn, added_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            )?;
            let at = now();
            let text = crate::pgn::normalize_newlines(text);
            for block in crate::pgn::game_blocks(&text) {
                let g = crate::pgn::Game::from_block(block, Path::new(""), 0);
                if g.headers.get("White").is_none() && g.movetext.trim().is_empty() {
                    r.skipped += 1;
                    continue;
                }
                let h = &g.headers;
                let plies = g.plies().unwrap_or_else(|| crate::pgn::parse_movetext(&g.movetext).len() as u32);
                ins.execute(params![
                    collection,
                    g.white(),
                    g.black(),
                    elo(h.get("WhiteElo")),
                    elo(h.get("BlackElo")),
                    g.result(),
                    h.get_or("Date", ""),
                    h.get_or("Event", ""),
                    h.get_or("Site", ""),
                    h.get_or("ECO", ""),
                    h.get_or("Opening", ""),
                    plies,
                    block.trim(),
                    at,
                ])?;
                r.added += 1;
            }
        }
        tx.commit()?;
        Ok(r)
    }

    /// Imports a PGN file, or every PGN file of a folder.
    pub fn db_import_path(&mut self, collection: i64, path: &Path) -> Result<DbImport> {
        let files = pgn_files(path);
        if files.is_empty() {
            bail!("no PGN file in {}", path.display());
        }
        let mut total = DbImport::default();
        for f in &files {
            let text = crate::pgn::read_text(f).with_context(|| format!("reading {}", f.display()))?;
            let r = self.db_import_text(collection, &text)?;
            total.added += r.added;
            total.skipped += r.skipped;
            total.files += 1;
        }
        Ok(total)
    }

    /// The games of a folder (and its subfolders), filtered by a text (players, event, site,
    /// opening, ECO, date, result), at most `limit`.
    pub fn db_games(&self, collection: i64, sub: bool, q: &str, limit: u32) -> Result<Vec<DbGame>> {
        let ids = if sub { self.db_subtree(collection)? } else { vec![collection] };
        let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let like = format!("%{}%", q.trim().replace('%', "").replace('_', ""));
        let mut st = self.conn.prepare(&format!(
            "SELECT id, collection, white, black, white_elo, black_elo, result, date, event, site, eco, opening, plies FROM db_games \
             WHERE collection IN ({list}) AND (?1 = '%%' OR white LIKE ?1 OR black LIKE ?1 OR event LIKE ?1 OR site LIKE ?1 OR opening LIKE ?1 OR eco LIKE ?1 OR date LIKE ?1 OR result LIKE ?1) \
             ORDER BY date DESC, id DESC LIMIT ?2"
        ))?;
        let rows = st.query_map(params![like, limit], |r| {
            Ok(DbGame {
                id: r.get(0)?,
                collection: r.get(1)?,
                white: r.get(2)?,
                black: r.get(3)?,
                white_elo: r.get(4)?,
                black_elo: r.get(5)?,
                result: r.get(6)?,
                date: r.get(7)?,
                event: r.get(8)?,
                site: r.get(9)?,
                eco: r.get(10)?,
                opening: r.get(11)?,
                plies: r.get::<_, i64>(12)? as u32,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Counts the games a search finds (the table shows at most `limit` of them).
    pub fn db_games_count(&self, collection: i64, sub: bool) -> Result<u32> {
        let ids = if sub { self.db_subtree(collection)? } else { vec![collection] };
        let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        Ok(self.conn.query_row(&format!("SELECT COUNT(*) FROM db_games WHERE collection IN ({list})"), [], |r| r.get::<_, i64>(0))? as u32)
    }

    pub fn db_game_pgn(&self, id: i64) -> Result<String> {
        Ok(self.conn.query_row("SELECT pgn FROM db_games WHERE id=?1", [id], |r| r.get(0)).optional()?.context("game not found")?)
    }

    pub fn db_games_move(&self, ids: &[i64], collection: i64) -> Result<usize> {
        self.db_collection_exists(collection)?;
        let mut n = 0;
        for id in ids {
            n += self.conn.execute("UPDATE db_games SET collection=?2 WHERE id=?1", params![id, collection])?;
        }
        Ok(n)
    }

    pub fn db_games_delete(&self, ids: &[i64]) -> Result<usize> {
        let mut n = 0;
        for id in ids {
            n += self.conn.execute("DELETE FROM db_games WHERE id=?1", [id])?;
        }
        Ok(n)
    }

    /// The PGN of a folder (and its subfolders): every game, in the order shown.
    pub fn db_export_pgn(&self, collection: i64, sub: bool) -> Result<String> {
        let ids = if sub { self.db_subtree(collection)? } else { vec![collection] };
        let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let mut st = self.conn.prepare(&format!("SELECT pgn FROM db_games WHERE collection IN ({list}) ORDER BY date DESC, id DESC"))?;
        let rows: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        Ok(rows.join("\n\n") + "\n")
    }

    /// Adds positions from text: one per line, a FEN or an EPD line (`id` and `c0` give the
    /// title and the note). Returns (added, lines that are not positions).
    pub fn db_positions_add(&self, collection: i64, text: &str) -> Result<(u32, Vec<String>)> {
        self.db_collection_exists(collection)?;
        let (mut added, mut bad) = (0, Vec::new());
        for (n, line) in text.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 4 {
                bad.push(format!("line {}: not a FEN", n + 1));
                continue;
            }
            // a FEN has 6 fields; an EPD line has 4 and then operations
            let full = fields.len() >= 6 && fields[4].parse::<u32>().is_ok() && fields[5].parse::<u32>().is_ok();
            let fen = if full { fields[..6].join(" ") } else { format!("{} 0 1", fields[..4].join(" ")) };
            if crate::chess960::parse_fen(&fen).is_err() {
                bad.push(format!("line {}: not a legal position", n + 1));
                continue;
            }
            let rest = fields[if full { 6 } else { 4 }..].join(" ");
            let op = |name: &str| -> String {
                let re = regex::Regex::new(&format!(r#"(?:^|;)\s*{name}\s+"([^"]*)""#)).unwrap();
                re.captures(&rest).map(|c| c[1].to_string()).unwrap_or_default()
            };
            self.conn.execute(
                "INSERT INTO db_positions(collection, fen, title, note, added_at) VALUES(?1,?2,?3,?4,?5)",
                params![collection, fen, op("id"), op("c0"), now()],
            )?;
            added += 1;
        }
        Ok((added, bad))
    }

    pub fn db_positions(&self, collection: i64, sub: bool) -> Result<Vec<DbPosition>> {
        let ids = if sub { self.db_subtree(collection)? } else { vec![collection] };
        let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let mut st = self.conn.prepare(&format!("SELECT id, collection, fen, title, note FROM db_positions WHERE collection IN ({list}) ORDER BY id"))?;
        let rows = st.query_map([], |r| Ok(DbPosition { id: r.get(0)?, collection: r.get(1)?, fen: r.get(2)?, title: r.get(3)?, note: r.get(4)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn db_position_update(&self, id: i64, title: &str, note: &str) -> Result<()> {
        self.conn.execute("UPDATE db_positions SET title=?2, note=?3 WHERE id=?1", params![id, title.trim(), note.trim()])?;
        Ok(())
    }

    pub fn db_positions_delete(&self, ids: &[i64]) -> Result<usize> {
        let mut n = 0;
        for id in ids {
            n += self.conn.execute("DELETE FROM db_positions WHERE id=?1", [id])?;
        }
        Ok(n)
    }

    pub fn db_positions_move(&self, ids: &[i64], collection: i64) -> Result<usize> {
        self.db_collection_exists(collection)?;
        let mut n = 0;
        for id in ids {
            n += self.conn.execute("UPDATE db_positions SET collection=?2 WHERE id=?1", params![id, collection])?;
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PGN: &str = r#"[Event "Club championship"]
[Site "Milan"]
[Date "2025.03.01"]
[White "Rossi, Mario"]
[Black "Bianchi, Luca"]
[WhiteElo "1850"]
[Result "1-0"]
[ECO "C50"]
[Opening "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 1-0

[Event "Casual"]
[White "Bianchi, Luca"]
[Black "Rossi, Mario"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 1/2-1/2
"#;

    #[test]
    fn games_and_positions_in_folders() {
        let mut st = Store::in_memory().unwrap();
        let club = st.db_collection_create("Club", None).unwrap();
        let y25 = st.db_collection_create("2025", Some(club)).unwrap();
        let r = st.db_import_text(y25, PGN).unwrap();
        assert_eq!((r.added, r.skipped), (2, 0));
        // the games of the folder are found from its parent with "subfolders"
        assert_eq!(st.db_games(club, false, "", 100).unwrap().len(), 0);
        let g = st.db_games(club, true, "", 100).unwrap();
        assert_eq!(g.len(), 2);
        let first = g.iter().find(|x| x.result == "1-0").unwrap();
        assert_eq!((first.white.as_str(), first.white_elo, first.eco.as_str(), first.plies), ("Rossi, Mario", Some(1850), "C50", 9));
        assert_eq!(st.db_games(club, true, "italian", 100).unwrap().len(), 1);
        assert!(st.db_game_pgn(first.id).unwrap().starts_with("[Event \"Club championship\"]"));
        assert!(st.db_export_pgn(club, true).unwrap().contains("1. d4 d5"));
        // positions: a FEN, an EPD line with id and c0, and a line that is not a position
        let (n, bad) = st
            .db_positions_add(y25, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1\n6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - bm Rd8#; id \"back rank\"; c0 \"mate in 1\";\nnot a position\n")
            .unwrap();
        assert_eq!((n, bad.len()), (2, 1));
        let p = st.db_positions(club, true).unwrap();
        assert_eq!((p[1].title.as_str(), p[1].note.as_str()), ("back rank", "mate in 1"));
        assert!(p[1].fen.ends_with(" 0 1"));
        // folders cannot go inside themselves; deleting one deletes what is inside
        assert!(st.db_collection_move(club, Some(y25)).is_err());
        st.db_collection_delete(club).unwrap();
        assert!(st.db_collections().unwrap().is_empty());
        assert!(st.db_positions(y25, false).unwrap().is_empty());
    }
}
