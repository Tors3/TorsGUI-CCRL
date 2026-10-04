# TorsGUI user guide

A CCRL tester's workflow, end to end: **new machine → bench → download engines → import the
CCRL list → create a gauntlet → run it on NUMA → export and post**.

TorsGUI keeps everything in a *workspace* folder (`%LOCALAPPDATA%\TorsGUI` on Windows,
`~/.local/share/TorsGUI` on Linux, or `TORSGUI_HOME`): the SQLite database `torsgui.db`, and
one folder per tournament with its PGNs (`pgn/node<N>_lane<L>.pgn`), logs and exports. The PGN
files are the source of truth for which games have been played.

## Getting started

**Getting started** (in the sidebar, or the button on the dashboard of a new installation) is
a guided procedure: each step says what to do and why, shows whether it is already done on
this machine, and has a button to do it. The steps are the sections of this guide:

1. **Tester**: your name and site (used in the export).
2. **fastchess**: download the pinned version (it plays the games).
3. **Folders**: engines, books and the default opening book (*Install the CCRL opening
   books*: the books come with TorsGUI, see [Opening books](#opening-books)).
4. **Bench**: the SF10 bench gives the machine factor and the local time control
   (Stockfish 10 comes with TorsGUI: *Use the bundled Stockfish 10*).
5. **Engines**: *Add the bundled engines* (Stockfish 10 and Triumviratus 7.0 AVX2 come with
   TorsGUI), then add others from GitHub (or local files); each is verified.
6. **CCRL list**: import the list for ratings, names and suggested opponents.
7. **First tournament**: the wizard, then Live, Export and the post.

**Try the demo** plays a small example tournament with the *TorsGUI demo engines* (two tiny
built-in engines that play legal but weak chess in a few milliseconds per move; they are
never meant for rating lists). It needs only fastchess: in a couple of minutes you see the
runner at work, the live boards, the standings, the game viewer and the CCRL export with its
checklist. The demo can be standard chess or Chess960, and it can be removed afterwards
(tournament → delete).

## Opening books

TorsGUI ships the opening books used by CCRL testers, kindly provided by **Graham Banks**
(CCRL); thanks to him and to the authors of the books. *Install the CCRL opening books*
(Getting started, or **Settings → Opening books**) extracts them into the books folder and,
if no default book is set, makes **AVT-Book 2026d** (`AVT2026d.pgn`) the default.

| Book | Positions | Notes |
|---|---|---|
| AVT-Book 2026d | 16677 | ICCF games >2200, 12 moves, shuffled (default) |
| AVT-Book 2026c | 20319 | ICCF games >2200, 12 moves, slightly unbalanced |
| AVT-Fringe 2026 | 6292 | ICCF games >2400, 12 moves, pretty unbalanced |
| AVT 8 moves 50-65 | 3745 | ICCF games >2200, 8 moves, exit score 50–65 cp |
| AVT ICCF 8 moves more unbalanced | 3745 | ICCF games >2200, 8 moves, more unbalanced |
| GBSelect 2026 | 1879 | selected openings with ECO codes and names |
| GM2700+ | 13438 | 8 moves from games between 2700+ grandmasters |
| LowDraw1000 | 1000 | openings with a low draw rate |
| TopGM 8 moves | 4999 | top GM games, 8 moves |

The archive holds 9 **PGN** books, which fastchess plays, and 9 **CGB** books (the format of
other GUIs), installed only for testers who also use those GUIs: fastchess cannot read CGB, so
TorsGUI never offers them for tournaments. The CGB books are 2600+ 8 moves, AVT-Fringe 2026, AVT 8 moves 50-65,
AVT ICCF 8 moves more unbalanced, FOEBOS v20.1, Hert500, IECG Masters, SuperGM 2020 and
WorldClass 2013.
The panel shows author, description and terms of each book and a *Use as default* button. In
the wizard, *Installed books…* next to the book field picks any PGN/EPD book of the books
folder; a tournament file can name a book by file name (`book = "GM2700+.pgn"`).

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
   - *Opening books*: the CCRL books bundled with TorsGUI (see below).
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

- **CCRL ratings and search**: the library shows every engine's rating in the CCRL **Blitz**,
  **40/15** and **FRC** lists (the same version, 1CPU first, otherwise its CPU category is
  shown; `≈` = this version is not in the list yet, the latest listed version is shown). The
  ratings follow the lists in *CCRL lists*: **Update CCRL ratings** downloads them again (the
  bundled lists stay in use when the site is not reachable). Click a column header to sort, and
  search by name, author, build or `id name`.
- **Add from GitHub**: pick one of the **known engines** (73 public repositories: the engines
  of the CCRL top lists whose releases are on GitHub, covering every open-source engine of the
  Blitz top 60; 36 of them already tested by TorsGUI,
  with their best Blitz rating and whether they are in your library), or paste a repository or
  release URL. TorsGUI lists the releases (the
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
- **Bundled engines**: the installers carry Stockfish 10 and Triumviratus 7.0 (AVX2, the
  CCRL asset of its release); the button copies them to the engines folder (sha256 checked)
  and verifies them. Both are GPL-3: their sources are linked in the engine entry.
- **Add local file** does the same verification for a binary already on disk.
- **Import Cute Chess** reads the `engines.json` of Cute Chess (**Find it** looks in the usual
  Cute Chess folders, or give the file or its folder, or paste its content): every UCI engine is
  added with its working folder, its arguments and the UCI options changed in Cute Chess (not
  Threads/Hash, which come from the tournament), then verified. Engines whose executable is not on
  this computer are added without verification (set the executable in *Edit*); xboard engines are
  skipped (fastchess plays UCI engines). An engine already in the library (same name) is skipped.
- **Import REPORT.md** rebuilds the library (metadata only) from a CCRL_ScirptsTests-style
  `engines/` folder: release, asset, build, sha256, `id name`, options, used or not, notes.
- **Edit**: canonical display name `<Engine> <version>` (the export adds ` 64-bit` and ` NCPU`
  when threads > 1), notes, used flag, and the **UCI options** sent in new tournaments: every
  option the engine declares with its control and default (empty = the engine's default); an
  option it does not declare is added with **Add option** (name + value, e.g. `EvalFile` and
  `nets/my.nnue`). Relative file paths are read from the engine folder; wrong names, values out of
  range and missing network files are reported. `Ponder=false` and `OwnBook=false` are added when
  the engine exposes them. Threads and Hash always come from the tournament.
- **Options of one tournament**: in *New tournament* the **options** button of a chosen engine
  changes them for that tournament only.
- **Options of a tournament already created**: the tournament's *Configuration* tab, **Engine
  options in this tournament**, changes them while it is paused or stopped (used from the next
  game; for CCRL every game must use the same settings).
- **Report** produces the Markdown equivalent of `engines/REPORT.md`.
- To rename a player *inside a tournament* (PGN White/Black tags and configuration, never
  `EngineWhiteName`), use the tournament's **Configuration → Rename an engine** (the
  tournament must be paused or stopped).

## 4. CCRL lists

- **Bundled lists**: TorsGUI ships the Blitz, 40/15 and FRC lists (best versions, the top
  of each list as published at the end of September 2026), so ratings, opponents and the CCRL
  names used to rename engines in the PGNs work offline from the first start. They are
  replaced by any list you fetch or import; *Bundled lists* restores them.
- **Fetch all** (or one list) reads the Blitz, 40/15 and FRC lists (best and all versions)
  from computerchess.org.uk. Every list tries several addresses (`/4040/`, `/ccrl/4040/`,
  `www.`) and then the site's plain-text export; the two-row header of the CCRL tables and
  tied ranks (`14-15`) are understood. When the site refuses the download the bundled or
  previous list stays in use and the message lists every address tried.
- **Manual import** always works: *Open a saved page* (in the browser: *Save page as…*, HTML
  only), paste the table copied from the page, the HTML, or a CSV
  (`rank,name,rating[,plus,minus,score,games]` or `name,rating`). CPU categories are read from
  the names (`… 64-bit 8CPU`; no suffix = 1CPU).
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
   anchor; anchors do not play each other), round robin, match, **Swiss** or **Cup (knockout)**;
   the CCRL list; the event
   (automatic CCRL naming, e.g. `CCRL Blitz gauntlet Triumviratus 7.0 8CPU`).
2. *Engines*: the seed(s) and the opponents, or **Suggest opponents** from the list. Ratings
   in the target CPU category are shown (estimated ones marked). **Search** engines, keep only
   an **Elo range** (*from*–*to*; the engines already chosen stay visible), sort by name or
   rating (column headers), or **Closest to seed** to list the opponents by distance from the
   seed's rating.
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

**Editing a tournament**: a draft (or a queued or stopped tournament that has not played a
game yet) has an **Edit** button on its page. It opens the same wizard with every setting
loaded (engines, list, TC, games, nodes, lanes, book, event…); **Save changes** keeps its
state, **Save & queue** and **Save and start** also queue or start it. Engine options and
arguments of the tournament are kept.

How openings are assigned: every opening is played twice with colours reversed in the same
pairing. Openings are split into disjoint blocks per node partition, pass and pairing with the
formula of `run_node.py`:

```
block = (node × PASSES + pass − 1) × n_pairings + pairing
start = BOOK_START + block × RPP_BLOCK        (RPP_BLOCK = max openings per pass per node)
opening(round) = start + round − 1
```

### Swiss and Cup (knockout)

Their pairings depend on the results, so TorsGUI pairs one round at a time: when every game of
a round is finished, the next round is paired and played (the runner goes on by itself). The
engines are seeded by their CCRL rating (highest first); the **Seeding** panel of *New
tournament* changes the order by hand (arrows; *By rating* goes back), for example to keep two
strong engines apart in the first rounds of a cup, and shows the first-round bracket. Each match is a mini-match of *Games /
match* games: every opening twice with colours reversed.

- **Swiss**: *Rounds* rounds. Round 1 pairs the top half against the bottom half; then engines
  with the same score meet (Dutch system), never twice when possible (up to engines − 1 rounds).
  With an odd number of engines the lowest engine without a bye rests, and a bye is worth a
  drawn match. The **Rounds** tab shows every round and the table (points, then Buchholz).
- **Cup (knockout)**: a seeded bracket (1 against the last seed, 2 against the second-to-last…);
  with a number of engines that is not a power of two the best seeds get a bye in round 1. A
  tied match plays 2-game tiebreaks (up to 3), then the higher seed goes through. The **Bracket**
  tab shows every round up to the final and the winner.
- Lanes: a round has at most (engines ÷ 2) × games per match games, so more lanes than that stay
  idle until the next round is paired.

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
- **Names as CCRL writes them**: every player is renamed to the spelling of the tournament's
  CCRL list (the lists do not always agree: Blitz has `Integral 8`, 40/15 `Integral v8`), else
  of another list, else, for a version not listed yet, the engine's name as listed followed by
  its version (`pawnocchio 2.1`). The table *Names in the PGN* shows where each name comes from
  and the final name; any of them can be corrected by hand before **Build export**.
- With the names unchanged, the output is byte-identical to `tools/export_ccrl.py` on the same PGNs.
- **Forum post**: BBCode templates (finished, announcement, progress) with placeholders; the
  default "finished" post has a heading, one line of conditions, the result in bold, the
  per-opponent `[code]` table ordered by list rating and a closing line naming the next queued
  tournament. **Copy** and paste it on the forum.

### CCRL submission checklist

Before sending results, the **Export** page checks the tournament and marks each point
✔ ok, ⓘ information, ⚠ to check or ✖ to fix. *Ready to submit* means nothing is to fix.

| Check | Why it matters | How to fix |
|---|---|---|
| All games played | a partial gauntlet gives an unbalanced result | let it finish, or stop after a complete pass (passes keep every pass balanced) |
| Every opening with both colours | each opening must be played twice, colours reversed, or the result favours one side | resume the tournament: the missing games are replayed |
| No duplicate games | a game played twice (e.g. after a crash) must count once | nothing: the export keeps the first of each slot |
| No crashes, time losses or illegal moves | CCRL wants to know about them; they may point to a broken build or an overloaded machine | look at the games (Decisive, Terminations), mention them in the post, re-test the engine if needed |
| Hash 512 MB per thread | CCRL condition (512 MB × threads, e.g. 2048 MB at 4CPU) | set the hash in the wizard (the default follows the rule) |
| Ponder off | CCRL plays without pondering | remove `Ponder=true` from the engine's options |
| Opening book | every game must start from a book position, the same book for all | set the book in the wizard |
| Tablebases | the EGTB used is part of the file name (`egtb 5-man`) | set the Syzygy path (information only) |
| CCRL builds (AVX2, 64-bit) | CCRL uses the AVX2 build, never AVX-512, VNNI, x86-64-v4 or 32-bit | reinstall the engine with the proposed build (Engines → Add from GitHub) |
| Engines verified | an engine that fails `uci / isready / go` spoils games | Engines → Verify |
| CCRL names | the list matches engines by name: `<Engine> <version>`; exported as `… 64-bit NCPU` | tournament → Configuration → Rename an engine; import the current CCRL list |
| Time control from a bench | the TC must be the CCRL TC scaled by this machine's speed | Bench → run the SF10 bench (again if older than 90 days), then the TC calculator |
| Variant and list | Chess960 games belong to the FRC list only, standard games to the others | pick the right list/variant in the wizard |
| Tester name and site | used in the file name and the PGN `Site` tag | Settings → Tester |

## 7b. Live broadcast (Lichess, ccrl.live)

TorsGUI can show the games being played to everyone, while they are played. The broadcast
runs inside the runner, so it goes on with the window closed, and it stops when the
tournament is paused or finished. Choose it per tournament: the wizard (*Broadcast live*) or
the tournament page, tab **Live broadcast**.

**Lichess** (no router setup needed)

1. Create a token at <https://lichess.org/account/oauth/token/create> with only *Read studies
   and broadcasts* and *Create, update, delete studies and broadcasts*.
2. **Settings → Live broadcast**: paste it, press *Check* (it shows the account), choose the
   visibility (public, unlisted, private).
3. Switch on *Lichess* for the tournament. With the first game TorsGUI creates the broadcast
   (name = the event, description with tester, TC, threads, hash, book and engines) and rounds
   of 60 games; every game is pushed with clocks (`%clk`) and evaluations (`%eval`), finished
   games with their final result. The link is on the tournament page.

**ccrl.live** (the site where Graham Banks' games are broadcast, by Jay Honnold)

TorsGUI is a TLCS-compatible server: every lane is one broadcast on its own UDP port (lane 1
on the first port of Settings → Live broadcast, default 16001, lane 2 on the next one…). It
sends the players, every move with the engine's depth, score, time and PV, the clocks, the
result, and the crosstable of the tournament after every game.

1. Router: forward the UDP ports (one per lane) to this computer.
2. Firewall: *Allow in the firewall* adds the Windows rule (administrator rights asked).
3. A fixed address: the public IP (*Show*) or a free dynamic DNS name if it changes.
4. Ask Jay to add your address and ports to ccrl.live: *Copy the message* prepares it.
5. Switch on *ccrl.live* for the tournament: the tab shows each lane's port, its game and the
   connected viewers.

## 8. Chess960 (Fischer Random)

In the wizard choose the **FRC (960)** list (or just the **Chess960** variant): fastchess plays
with `-variant fischerandom` and sends `UCI_Chess960 true` to both engines.

- **Engines**: TorsGUI reads the `UCI_Chess960` option when it verifies an engine and marks
  it **960** (Engines, wizard). An engine that does not declare it is refused for a Chess960
  tournament; one whose options are unknown (not verified yet) gives a warning.
- **Start positions**: the openings are start positions in an EPD book. Choosing Chess960
  generates *all 960 positions, shuffled with seed 1* (the standard position excluded);
  **generate Chess960 positions…** makes other books: all 960 with another seed, a random set
  of N positions, or **double Chess960** (different setups for White and Black). The same
  seed always gives the same book. Each position is played twice with colours reversed, as
  in standard tournaments; you can also use your own EPD (X-FEN or Shredder-FEN castling).
- **Viewer and live**: 960 castling (king takes rook in UCI, O-O/O-O-O in the PGN) is
  replayed everywhere; the PGNs carry `Variant` and the start `FEN`.
- **CCRL**: the FRC list uses 40 moves in 2 minutes (repeating), scaled by the machine
  factor like the other lists; check the current CCRL FRC conditions before submitting.

## 9. Tournament files (and Claude)

A tournament can also be described in a small TOML file — written by you or by Claude — and
imported with **Tournaments → Import file**: TorsGUI shows the engines it matched, the
games, TC and ETA and every warning, then you save it as a draft, queue it or start it.
**Template for Claude** copies a template with the rules and your engine names to give to
Claude with the request. See [TOURNAMENT_FILE.md](TOURNAMENT_FILE.md).

## 10. Games, viewer and board

**Games** is the archive: every tournament's games, plus PGN files or folders you add (for
example the results of CCRL_ScirptsTests; they are only read). Click a game to replay it:
board with the last move, check highlight and the next move as an arrow, evaluation bar,
captured material, clocks, eval and time graphs (click to jump), move list with evaluations.
`Space` plays/pauses (0.5×–4×), `t` theater mode (large board), `f` flip. The large live
board has the same bar, ticking clocks and the PV of the engine to move as arrows.
**Board appearance** (palette button, or Settings): *Minimal* (flat, the default), slate,
ocean, tournament green, classic brown, walnut, maple, marble, or *Custom* with your own
light/dark square colours; 69 piece sets (sharechess and lichess sets whose licence allows
bundling, with their colour variants; searchable); animation speed, coordinates, arrows and
an optional move sound. **Import** adds any other set from a folder (lichess names
`wP.svg`…`bK.svg` or sharechess names `pw.svg`…`kb.svg`, SVG or PNG), e.g. the
non-commercial sets of sharechess: they stay on your computer, for personal use.

## 11. Importing the old scripts' tournaments

**Tournaments → Import old tournaments** scans a CCRL_ScirptsTests-style folder (`tournaments/<name>/config`,
`scripts/gauntlet.bat`, PGNs in `pgn/` or `results/gauntlets/<name>/all_games.pgn`). Finished
tournaments are imported read-only (for verification: same standings, same export);
configured but never started ones become drafts.

## 12. Maintenance

**Settings → Maintenance**: disk usage per tournament, unused engines, superseded versions,
log rotation of per-game engine logs. **Git sync** copies configurations and results (and
exports) to a repository folder and can commit them (like `sync_repo.py`). **Logs** shows the
event log and every runner, console and per-game log (last 96 KB, refreshed).

## 13. Game analysis

**Analysis → Game analysis** (or **Analyse** in the game viewer, which opens the game there at
the same move). Paste a PGN, bare moves (`1. e4 e5 2. Nf3…`) or a FEN, or start from the initial
position. Pick an engine of the library, its threads and hash.

- **Live engine**: the engine analyses the position shown, with 1–5 lines (MultiPV); the best
  moves are drawn as arrows and follow you as you move through the game (`←` `→` `Home` `End`,
  `f` flip).
- **Analyse the game**: every position is searched for the time chosen (0.1–10 s). The graph
  shows the evaluation (White's view; click to jump), each move gets its evaluation and the
  moves that lose winning chances are marked **?!** inaccuracy, **?** mistake, **??** blunder
  (the same winning-chance thresholds as Lichess), with the engine's best move and line. For
  each side: accuracy, average centipawn loss (ACPL) and the counts.

## 14. Test suites

**Analysis → Test suites** runs engines on EPD positions with a known answer: puzzles and mate
finding. A position is solved when the engine's final move is a solution (`bm`), is not the
move to avoid (`am`), or when it announces a mate at most as long as asked (`dm`, mate in N:
another mate that short counts too).

- Positions: two built-in samples (*Mate finding*, mates in 1 to 7; *Win at Chess*, the first
  20 positions of Fred Reinfeld's classic test, solutions checked with Stockfish 10), any EPD
  file (WAC, ECM, STS, Arasan, mate collections…) or pasted lines. Lines that cannot be read
  are listed and skipped.
- Engines: one or more, a time per position, threads, hash and how many engine processes run
  at once.
- Results: one column per engine, ✓ with the time the solution was found (and kept to the end)
  or ✗ with the move played; solved count and percentage, the total solve time breaks ties.
  Click a position to see it with the solution (green), the move to avoid (red) and the
  engines' moves as arrows. Every run is kept (pick it in the list, or delete it).

## 15. Look and navigation

The sidebar groups the screens: **Testing** (tournaments, live games, archive, export),
**Engines** (library, CCRL lists, bench), **Analysis** (game analysis, test suites) and **App**
(settings, logs, help). Click a section title to fold it; *Icons only* narrows the sidebar
for small screens. **Colour themes**: the list at the bottom of the sidebar or *Settings →
Appearance* (with previews): System (follows the operating system), Dark, Light, the sober
**Graphite** and **Paper**, Nord, Midnight (pure black), Forest and High contrast. Settings
are split into sections (General, Appearance, Paths & fastchess, Opening books, Live broadcast,
CPU topology, Maintenance). The busier pages have **sub-tabs** at the top of their main area:
*New tournament* goes step by step (Type & engines → Seeding for Swiss/cup → Conditions → NUMA
& lanes; the summary and the Create buttons stay on the right), *Dashboard* (Now, Queue &
timeline, Recent & events), *Bench* (Run & latest result, History, TC calculator) and *CCRL
Lists* (Lists, Suggest opponents, Name matching, Thresholds). *Engines → Add engine* gathers
every way to add engines.

## Keyboard

`Ctrl K` or `/` command palette · `g` then `d t l a e c b x s o r h y p` to navigate (`a` = Games,
`r` = Getting started, `h` = Help, `y` = Game analysis, `p` = Test suites) ·
`n` new tournament · `t` next colour theme · in the game viewer `←` `→` `Home` `End`, `Space` play/pause,
`f` flip, `t` theater mode.
