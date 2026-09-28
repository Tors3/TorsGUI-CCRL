# TorsGUI user guide

A CCRL tester's workflow, end to end: **new machine → bench → download engines → import the
CCRL list → create a gauntlet → run it on NUMA → export and post**.

TorsGUI keeps everything in a *workspace* folder (`%LOCALAPPDATA%\TorsGUI` on Windows,
`~/.local/share/TorsGUI` on Linux, or `TORSGUI_HOME`): the SQLite database `torsgui.db`, and
one folder per tournament with its PGNs (`pgn/node<N>_lane<L>.pgn`), logs and exports. The PGN
files are the source of truth for which games have been played.

## 1. New machine

1. Install TorsGUI (installer, MSI or portable zip; AppImage/deb on Linux).
2. Open **Settings**:
   - *Tester name* (used in the export file name, e.g. `Francesco Torsello`) and *Site* (your
     location, the PGN `Site` tag of the export, e.g. `Milan`).
   - *Paths*: engines folder (downloads go to `<folder>/<Repo>_<tag>`), books, the default book,
     tablebases, the Syzygy path passed to engines, and the export output folder.
   - *fastchess*: press **Download** to install the pinned release (`v1.8.2-alpha`) into the
     workspace, or set *Custom fastchess binary*. The green check shows the version found.
   - *Resume interrupted tournaments when TorsGUI starts* (on by default) and, on Windows,
     *Resume at logon / reboot*: registers the Task Scheduler task `TorsGUI\Resume`, which runs
     `torsgui-runner resume` at logon so tournaments restart after a reboot even if you never
     open the GUI. On Linux the same button prints the `@reboot` crontab line to use.
   - *Launch runners through the Windows Task Scheduler*: optional, like the old
     `start_all_task.bat` (a CRLF `.bat` in the tournament folder, run by a scheduled task).
3. The **CPU topology** panel shows the NUMA nodes, processor groups, physical cores and SMT
   siblings as detected (`GetLogicalProcessorInformationEx` on Windows, sysfs on Linux). The
   highlighted cells are the first hardware thread of each core: the "one logical CPU per
   physical core" set used for games.

## 2. Bench and time control

1. **Bench → Get official SF10** downloads the three official Stockfish 10 Windows builds
   (x64, popcnt, bmi2) from CCRL_ScirptsTests and checks their sha256. On Linux select a 64-bit
   Stockfish 10 built from the `sf_10` sources.
2. Choose the levels (parallel instances: 1, half a node, a node, all cores…) and the runs.
3. Close everything and **Start bench**. Guards:
   - a 32-bit binary is refused (PE/ELF header and the engine's `id name`);
   - the CPU must be idle (above 5 % load the bench refuses to start; *Run even if busy* marks
     the result invalid);
   - the power plan / minimum processor state and the frequency are recorded, with warnings;
   - the node count must be 3 939 338, otherwise the result is not valid for CCRL.
4. The result table gives, per build and level, the nps (mean, median, spread, sd), the
   equivalent bench time and the **factor** = local bench time / 2054 ms.
5. The **TC calculator** turns a CCRL nominal TC into the local one: click a result row to use
   its factor. The formulas are visible and editable (`B` base, `I` increment, `M` moves,
   `f` factor). Defaults: `base = round(B × f)`, `inc = if(I > 0, max(1, round(I × f)), 0)`
   (integral increment because some engines mishandle fractions). Reference values: Blitz
   2'+1" at f≈0.86 → **103+1**; 40/15 as 15'+10" at f≈1.878 → 1690+19. *Save formulas &
   factor as defaults* makes the wizard use them.
6. The history chart shows the factor against the number of parallel instances for every run;
   results imported from `ccrl_bench.py` JSON files that were made with a binary not reporting
   a 64-bit build are flagged invalid.

## 3. Engines

- **Add from GitHub**: paste a repository or release URL. TorsGUI lists the releases (the
  latest *stable* is preselected; when the API is rate-limited it falls back to the
  `releases/latest` redirect and the HTML asset listing) and classifies every asset with a
  reason: Windows **AVX2** (x86-64-v3 counts as AVX2) is chosen; AVX-512, VNNI, `avx512`,
  `x86-64-v4`, 32-bit, ARM and source archives are rejected; bmi2/pext, popcnt, universal or
  generic builds are taken only when nothing better exists, and **flagged**. Nothing is ever
  compiled. Networks shipped separately (`.nnue`) are downloaded next to the binary. The
  download is checked against GitHub's sha256 digest when published, extracted (zip / 7z /
  tar.gz), and verified: `uci` → `isready` → `go depth 12`. The `id name`, the options (saved
  like `uci_options.txt`), the bestmove, Threads max and Syzygy support are recorded.
- **Choosing the build yourself**: the dialog proposes a build and shows every asset with its
  reason; click another accepted row to install that one instead (the engine keeps the reason
  "chosen manually").
- **AVX-512 as a personal option**: *Settings → Engine builds* (or the checkbox in the
  dialog) accepts AVX-512 / VNNI / x86-64-v4 builds for your own tests, and can prefer them
  when the CPU supports AVX-512 (VNNI builds only when the CPU has VNNI). They are never
  chosen for CCRL by default: such engines carry the purple flag *AVX-512 build: personal
  use, not valid for CCRL*, and the wizard warns when a tournament uses one.
- **Add local file** does the same verification for a binary already on disk.
- **Import REPORT.md** rebuilds the library (metadata only) from a CCRL_ScirptsTests-style
  `engines/` folder: release, asset, build, sha256, `id name`, options, used or not, notes.
- **Edit**: canonical display name `<Engine> <version>` (the export adds ` 64-bit` and ` NCPU`
  when threads > 1), the options sent in tournaments (`Ponder=false` and `OwnBook=false` are
  added automatically when the engine exposes them), notes, used flag.
- **Report** produces the Markdown equivalent of `engines/REPORT.md`.
- To rename a player *inside a tournament* (PGN White/Black tags and configuration, never
  `EngineWhiteName`), use the tournament's **Configuration → Rename an engine** (the
  tournament must be paused or stopped).

## 4. CCRL lists

- **Fetch from the site** reads the Blitz and 40/15 lists (all and best versions) from
  computerchess.org.uk when reachable. The layout can change: **Manual import** always works
  — paste the table copied from the page, the HTML, or a CSV (`rank,name,rating` or
  `name,rating`). CPU categories are read from the names (`… 64-bit 8CPU`; no suffix = 1CPU).
- The table marks which list engines are in your library.
- **Name matching**: fuzzy matching ("Integral v8" ↔ "Integral 8", build tags and `64-bit`
  ignored); confirm a candidate to store the alias.
- **Opponents**: top N of the list, the latest version of each engine that appears in it,
  filtered by what is installed and by thread support (single-thread engines are excluded for
  multi-thread tournaments).
- **Threshold**: the score the seed needs, against its actual opponents, for its performance
  to pass rank k of its CPU category.
- Ratings used for statistics: the rating in the tournament's CPU category, or the 1CPU rating
  plus a gap — the engine's own historical gap (other versions present in both categories),
  otherwise the list median, otherwise the default in Settings (32). Estimated values are
  marked **est.** everywhere.

## 5. Create a gauntlet

**Tournaments → New tournament**:

1. *Type*: gauntlet, multi-seed gauntlet (seeds play each other round robin and every
   anchor; anchors do not play each other), round robin or match; the CCRL list; the event
   (automatic CCRL naming, e.g. `CCRL Blitz gauntlet Triumviratus 7.0 8CPU`).
2. *Engines*: the seed(s) and the opponents, or **Suggest opponents** from the list. Ratings
   in the target CPU category are shown (estimated ones marked).
3. *Conditions*: threads, hash (512 MB × threads by default), games per pairing (even, a
   multiple of passes × 2), passes, time control (or compute it from the nominal TC and the
   factor), book, book start, Syzygy path, site, adjudication (defaults `-draw movenumber=35
   movecount=8 score=10`, `-resign movecount=4 score=600 twosided=true`) and extra fastchess
   arguments.
4. *NUMA placement*: nodes, lanes per node (suggested: physical cores per node / (2 × threads))
   and the placement mode: *Node* (every lane uses the node's one-thread-per-core set, like the
   old scripts), *Disjoint cores per lane*, or *None*.

The **summary** updates live: total games, pairings, openings per pass and node (e.g. 15
openings on 2 nodes → 8 and 7), openings used, concurrent games, busy threads vs physical
cores, RAM needed vs installed, estimated game duration and ETA, errors and warnings, and the
exact fastchess command of the first game. **Create and start**, **Create & queue** or **Save
draft**.

How openings are assigned: every opening is played twice with colours reversed in the same
pairing. Openings are split into disjoint blocks per node partition, pass and pairing with the
formula of `run_node.py`:

```
block = (node × PASSES + pass − 1) × n_pairings + pairing
start = BOOK_START + block × RPP_BLOCK        (RPP_BLOCK = max openings per pass per node)
opening(round) = start + round − 1
```

## 6. Run it

- The tournament runs in a separate **`torsgui-runner`** process started detached (new process
  group, breakaway from the GUI's job on Windows; new session on Linux). Close the window,
  update TorsGUI, disconnect RDP: games continue. When you reopen TorsGUI it attaches to the
  runner through the database and the runner lock.
- Each game is one fastchess process (`-rounds 1 -games 1`, `-reverse` for the second colour,
  `-openings … order=sequential start=N`). TorsGUI decides the next slot from what the PGNs
  already contain; fastchess's `-config file=` resume is never used.
- **Placement** (Windows): each game process is created suspended, put into its own Job
  Object limited to the node's processor group and CPU mask (`JobObjectGroupInformationEx`,
  kill-on-close), then resumed; engines inherit the job, so an engine that pins its threads
  on every node (Caissa 2.0) cannot escape. *Lanes & placement* shows the planned CPUs and the
  placement read back from the job for every running game.
- **Pause** kills the games in progress (they are discarded and replayed later, never counted
  twice) and stops the runner; **Resume** continues. **Stop** does the same and is meant for
  "not now". Neither ever starts the next queued tournament.
- The **queue** starts the next tournament only when the current one has **all** its expected
  games and finished cleanly. If it ended cleanly with games missing (a crashed engine never
  recorded a game…), it is retried up to 2 times, then marked *incomplete* and the queue stops.
- A game that exceeds the longest possible duration at its time control is killed by a
  watchdog and replayed.
- The **Dashboard** shows running and queued tournaments, games/hour over a rolling hour, the
  ETA of the current tournament and of the whole queue (timeline), the health panel (runners
  alive, fastchess and engine processes, free RAM, crashes and time forfeits, anomalies such
  as a tournament marked running without a live runner) and the events. Toasts announce
  finished tournaments, engine crashes, forfeits and queue advances; the tray icon shows the
  progress.
- **Live**: one mini board per lane with players, clocks, last move, eval, depth and nps;
  click for the large board with PV arrow, move list, both engines' evaluations and time per
  move. Data come from the fastchess engine logs, tailed incrementally (only new bytes).
- The tournament page: games done, W/D/L and score of the seed, performance and MLE rating
  (logistic, anchored on the list ratings, 95 % CI; **Update ratings** reads them from the
  imported list), games/hour, average game, ETA; per-opponent table with White/Black counts
  (an incomplete colour pair is highlighted); terminations; colour-pair check; decisive games;
  every game in the PGN viewer (board, moves, eval graph, engine info from the fastchess
  comments `{+0.21/20 2.291s, tl=…, n=…, sd=…, nps=…}`).

## 7. Export and post

**Export** (or the Export button of a tournament):

- Tester name, site, date, seed, threads, hash, book and EGTB pieces are prefilled.
- File: `[<Tester> <YYYY-MM-DD>] <Event> (hash <N>MB) (book <book>) (egtb <N>-man).pgn`, zip
  with `_` in place of spaces, brackets and parentheses. `Event` = `<seed export name> - <Mon D>`
  (date of the first game), `Site` = your location, players `<Engine> <version> 64-bit` (+ ` NCPU`),
  Round renumbered 1..N. Every finished game once (duplicates dropped, keeping the first by
  GameEndTime), sorted by end time; TimeControl and every other tag stay exactly as played.
- The output is byte-identical to `tools/export_ccrl.py` on the same PGNs.
- **Forum post**: BBCode templates (finished, announcement, progress) with placeholders; the
  default "finished" post has a heading, one line of conditions, the result in bold, the
  per-opponent `[code]` table ordered by list rating and a closing line naming the next queued
  tournament. **Copy** and paste it on the forum.

## 8. Tournament files (and Claude)

A tournament can also be described in a small TOML file — written by you or by Claude — and
imported with **Tournaments → Import file**: TorsGUI shows the engines it matched, the
games, TC and ETA and every warning, then you save it as a draft, queue it or start it.
**Template for Claude** copies a template with the rules and your engine names to give to
Claude with the request. See [TOURNAMENT_FILE.md](TOURNAMENT_FILE.md).

## 9. Games, viewer and board

**Games** is the archive: every tournament's games, plus PGN files or folders you add (for
example the results of CCRL_ScirptsTests; they are only read). Click a game to replay it:
board with the last move, check highlight and the next move as an arrow, evaluation bar,
captured material, clocks, eval and time graphs (click to jump), move list with evaluations.
`Space` plays/pauses (0.5×–4×), `t` theater mode (large board), `f` flip. The large live
board has the same bar, ticking clocks and the PV of the engine to move as arrows.
**Board appearance** (palette button, or Settings): walnut, maple, marble, tournament green,
ocean, slate or classic boards; Merida, Cburnett, Chessnut, Fantasy, Spatial or MPChess
pieces; animation speed, coordinates, arrows and an optional move sound.

## 10. Importing the old scripts' tournaments

**Tournaments → Import old tournaments** scans a CCRL_ScirptsTests-style folder (`tournaments/<name>/config`,
`scripts/gauntlet.bat`, PGNs in `pgn/` or `results/gauntlets/<name>/all_games.pgn`). Finished
tournaments are imported read-only (for verification: same standings, same export);
configured but never started ones become drafts.

## 11. Maintenance

**Settings → Housekeeping**: disk usage per tournament, unused engines, superseded versions,
log rotation of per-game engine logs. **Git sync** copies configurations and results (and
exports) to a repository folder and can commit them (like `sync_repo.py`). **Logs** shows the
event log and every runner, console and per-game log (last 96 KB, refreshed).

## Keyboard

`Ctrl K` or `/` command palette · `g` then `d t l a e c b x s o` to navigate (`a` = Games) ·
`n` new tournament · `t` theme · in the game viewer `←` `→` `Home` `End`, `Space` play/pause,
`f` flip, `t` theater mode.
