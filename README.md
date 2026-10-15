<p align="center"><img src="docs/brand/logo.svg" width="112" alt="TorsGUI logo"></p>

<h1 align="center">TorsGUI</h1>
<p align="center"><b>The tournament manager for CCRL testers</b><br>
Gauntlets, round robins, Swiss and cups on fastchess · NUMA-aware · survives reboots · CCRL export in one click</p>

<p align="center">
  <a href="https://github.com/Tors3/TorsGUI-CCRL/releases/latest"><b>Download</b></a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="docs/it/USER_GUIDE.md">Guida in italiano</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

TorsGUI is a desktop application (Windows and Linux) for chess-engine testers who play games
for the [CCRL](https://computerchess.org.uk/ccrl/) rating lists. It replaces the usual pile of
Python scripts, `.bat` files and scheduled tasks with one tool: you choose the engines, it plays
the games with [fastchess](https://github.com/Disservin/fastchess), keeps them running whatever
happens to the window, and builds the files CCRL wants.

**In short**

- **Every kind of tournament**: gauntlet, multi-seed gauntlet, round robin, match, Swiss and
  knockout cup, with a live summary of games, ETA, RAM and cores before you start.
- **Runs on its own**: a detached runner survives the GUI being closed, crashing or updated,
  resumes after a reboot and chains the queue (B starts only when A has all its games).
- **Uses the machine well**: physical cores or all threads (SMT), each game locked to its NUMA
  node, GPU engines (Lc0) one per graphics card.
- **CCRL from start to end**: engines from official GitHub releases with the CCRL build rules,
  the CCRL lists, the Stockfish 10 bench and time controls, a submission checklist, the export
  zip, the forum post and crosstables.
- **Live**: boards per game with clocks, evaluations and PV arrows, and broadcasts on Lichess and
  [ccrl.live](https://ccrl.live).
- **English and Italian**, colour themes, 19 boards and 80 piece sets.

Open source (GPL-3.0-or-later); nothing is specific to one machine.

<details>
<summary><b>All the features</b></summary>

### Tournaments

- **Gauntlets, multi-seed gauntlets, round robins, matches, Swiss tournaments and knockout cups**
  (rounds paired from the results, seeds by rating or by hand); one fastchess process per game,
  TorsGUI owns the scheduling and the PGNs are the source of truth.
- A **detached runner** that survives the GUI being closed, crashing or updating, and **resumes
  exactly where it was** after a reboot (also at logon, through the Task Scheduler).
- A **queue** that chains tournaments: B starts only when A has *all* its games and ended
  cleanly; *Unqueue* gives a tournament back the state it had.
- **Random openings** or each opening twice with colours reversed; passes that stay balanced;
  engines withdrawn mid-tournament; abandoned games left out of the export.
- **"As is" tournaments**: the tournament sets no Threads, Hash or Syzygy path, every engine
  plays with its own options.
- **Tournament files**: describe a tournament in a few TOML lines (or ask Claude to), import it,
  review, queue or start ([docs/TOURNAMENT_FILE.md](docs/TOURNAMENT_FILE.md)).
- **Chess960 / Fischer Random** (and double Chess960): engines that support it are detected,
  start-position books are generated, games replay with 960 castling.

### Cores, NUMA and GPU

- A **Cores & games** panel that says what it does: physical cores only (as on the CCRL machines)
  or all threads (Hyper-Threading / SMT), the NUMA nodes (only on machines that have several),
  games at the same time with the suggested number, and a map of the CPUs each game gets.
- Every game **locked to its NUMA node** (Windows: Job Object with group affinity, so engines that
  pin their own threads cannot escape), or to its own cores on any machine.
- **GPU engines** (Lc0 and the like): graphics cards detected, one game per card, each game on its
  lane's card.

### Engines

- An **engine library** from official GitHub releases with the CCRL asset rules (AVX2 or
  AVX-512: the AVX-512 build when the CPU runs it, never 32-bit; you can always pick another
  build), 73 known engines one click away, UCI verification and a report.
- **Active and inactive** engines (the wizard offers the active ones), a **GPU** tab, the UCI
  options of each engine with their defaults, per-tournament options.
- Imports your engines from **Cute Chess** (`engines.json`: folders, arguments, UCI options).
- Stockfish 10 and Triumviratus 8.0 come with the installers.

### CCRL

- The **CCRL lists** (Blitz, 40/15, FRC; bundled and updated from the site): ratings in the
  library, name matching, suggested opponents, estimated ratings for missing CPU categories.
- The **Stockfish 10 bench** calibrates the machine and turns CCRL time controls into local ones.
- A **CCRL checklist** before each submission, the **CCRL export** (PGN + zip, byte-compatible
  with `export_ccrl.py`, names as CCRL writes them) and a short **BBCode forum post**.
- **Crosstables** of any tournament or PGN file: copy them for the forum or save them as text or
  as a web page.
- **Live broadcasts** on **Lichess** (one broadcast per tournament, clocks and evaluations) and on
  **[ccrl.live](https://ccrl.live)** (TorsGUI is a TLCS-compatible server, one broadcast per lane,
  with the crosstable), straight from the runner.

### Games and analysis

- **Live** mini boards per lane, ticking clocks, evaluation bar, PV arrows, games/hour, ETA; the
  number of games in progress next to *Live* in the sidebar.
- A **game archive** (every tournament plus any PGN file or folder) and an animated viewer:
  autoplay, theater mode, evaluation and time graphs.
- **Game analysis** with an engine of the library: live lines (MultiPV), evaluation graph,
  inaccuracies / mistakes / blunders, accuracy and ACPL per side.
- **Test suites** (`bm`, `am`, `dm`) on several engines: WAC, ECM GCP, IQ4, BT-2630, LCT II,
  endgame tests and Arasan 2026 from the Arasan collection, mates, hard tactics and endgames from
  the lichess puzzles, or any EPD file.
- **Play against any engine** of the library (clock, strength, take-backs).
- Per tournament: an **Elo graph** with its error band, **statistics per opening** and where the
  engine **lands in the CCRL list**.

### Interface

- **English and Italian** (Settings → Appearance), the guide included; more languages can be
  added one page at a time.
- **Colour themes** (Paper, light, dark, Graphite, Nord, pure black, Forest, Coffee, Szőts,
  Bastiii, high contrast, or following the system) and an option for **stronger text**.
- **19 boards** (wood, felt, marble, flat colours or your own) with the **coordinates on the
  frame**, and **80 piece sets** plus any set you import.
- **Getting started** (setup steps with live status and a 3-minute demo tournament), the **user
  guide inside the app** with a **?** on every screen, desktop notifications and one-click updates.

</details>

## Screenshots

![Game viewer](docs/screenshots/04-pgn-viewer.png)

<details>
<summary><b>All screenshots</b> (25 screens: dashboard, standings, live, wizard, engines, CCRL lists, bench, export, archive, tournament file…)</summary>

| | |
|---|---|
| ![Dashboard](docs/screenshots/01-dashboard.png) Dashboard: running tournament, queue, ETA timeline, health | ![Tournaments](docs/screenshots/02-tournaments.png) Tournaments |
| ![Standings](docs/screenshots/03-tournament-standings.png) Standings of the imported Triumviratus 7.0 8CPU gauntlet (+32 =831 −7, 51.4 %) | ![PGN viewer](docs/screenshots/04-pgn-viewer.png) PGN viewer with engine info from the fastchess comments |
| ![Lanes](docs/screenshots/05-tournament-lanes.png) Lanes and placement check | ![Wizard](docs/screenshots/06-wizard.png) New tournament wizard with live summary |
| ![Live](docs/screenshots/07-live.png) Live grid (mock engines, real fastchess) | ![Live board](docs/screenshots/08-live-board.png) Large live board with PV, evals and time usage |
| ![Engines](docs/screenshots/09-engines.png) Engine library rebuilt from `engines/REPORT.md` | ![CCRL](docs/screenshots/10-ccrl-lists.png) CCRL lists (sample list with illustrative ratings) |
| ![Bench](docs/screenshots/11-bench.png) Bench history (the 32-bit runs of 2026-09-22 are flagged invalid) and TC calculator | ![Export](docs/screenshots/12-export.png) CCRL export and forum post |
| ![Settings](docs/screenshots/13-settings.png) Settings, topology, housekeeping | ![Logs](docs/screenshots/14-logs.png) Logs |
| ![Palette](docs/screenshots/15-command-palette.png) Command palette (Ctrl K) | ![Light](docs/screenshots/16-dashboard-light.png) Light theme |
| ![Theater](docs/screenshots/18-pgn-viewer-theater.png) Game viewer, theater mode | ![Games](docs/screenshots/19-games-archive.png) Game archive: tournaments and external PGN files |
| ![Chess960](docs/screenshots/22-chess960-game.png) A Chess960 game (mock engines, real fastchess) | ![Wizard 960](docs/screenshots/23-wizard-chess960.png) Wizard: FRC list, Chess960 variant, generated start positions |
| ![Getting started](docs/screenshots/24-getting-started.png) Getting started: setup steps and the demo tournament | ![Help](docs/screenshots/25-help.png) The guide inside the app (CCRL checklist section) |
| ![Board](docs/screenshots/20-board-appearance.png) Board appearance: minimal default, custom colours, 80 piece sets | ![Tournament file](docs/screenshots/21-tournament-file.png) Importing a tournament file written by Claude |

The screenshots are produced by `npm run screenshots` (Playwright) on a demo workspace: the
three tournaments of [CCRL_ScirptsTests](https://github.com/Tors3/CCRL_ScirptsTests) imported
as they are, the engine library rebuilt from its report, its bench history, and a live
tournament between mock engines played by the real fastchess. The CCRL list shown is an
illustrative sample (the site was not reachable from the build machine), not real ratings.

</details>

## Quick start

1. Download the installer (`TorsGUI_x.y.z_x64-setup.exe`), the MSI or the portable zip from the
   [releases](https://github.com/Tors3/TorsGUI-CCRL/releases). Linux: AppImage or `.deb`.
2. **Settings** → your name and site; press **Download** to install the pinned fastchess
   (or point to your own binary). Point the paths to your engines, books and tablebases;
   *Install the CCRL opening books* adds the bundled books (AVT 2026, GM2700+, LowDraw…).
3. **Bench** → Stockfish 10 comes with TorsGUI (*Get official SF10* uses the bundled builds)
   → run 1 and N parallel instances with the machine idle →
   the TC calculator gives the local time control (e.g. Blitz 2'+1" → `103+1` at f≈0.86).
4. **Engines** → *Bundled engines* adds Stockfish 10 and Triumviratus 8.0; *Add from GitHub*
   (pick one of the 73 known engines or paste the repository URL) for the others; each one is
   downloaded, checked (sha256), verified (`uci` / `isready` / `go depth 12`) and named.
5. **CCRL Lists** → the Blitz, 40/15 and FRC lists come with TorsGUI; *Fetch all* updates them
   (or open a page saved from the browser).
6. **Tournaments → New**: pick the seed, *Suggest opponents*, TC, threads, games per pairing,
   cores and games at the same time; check the live summary (games, ETA, RAM, cores) → *Create and start*.
7. Follow it on the **Dashboard** and **Live**; close the window whenever you want.
8. **Export** → build the CCRL zip and copy the forum post.

The full workflow is in the [user guide](docs/USER_GUIDE.md) ([in italiano](docs/it/USER_GUIDE.md)), also inside the app (**Help**).

## Building from source

Requirements: Rust (stable), Node 22, and on Linux the WebKitGTK toolchain
(`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`).

```sh
cd ui && npm ci && cd ..
node ui/scripts/prepare-sidecar.mjs      # builds torsgui-runner as the Tauri sidecar
npx --prefix ui tauri build              # installer / AppImage / deb in target/release/bundle
```

Development:

```sh
cargo run -p torsgui-server -- --listen 127.0.0.1:7878   # API for the browser UI
npm --prefix ui run dev                                  # http://localhost:5173
npx --prefix ui tauri dev                                # the desktop app
```

Tests:

```sh
cargo test                        # unit, §9 verification, bench, integration (fastchess + mock engines)
npm --prefix ui test              # component tests
npm --prefix ui run e2e           # Playwright smoke tests (real backend)
```

The verification tests read [CCRL_ScirptsTests](https://github.com/Tors3/CCRL_ScirptsTests)
from `CCRL_REF` (or a sibling folder); the integration tests need fastchess (`FASTCHESS`) and
the bench test a 64-bit Stockfish 10 (`SF10`). Missing inputs skip those tests with a message.

## Documentation

- [User guide](docs/USER_GUIDE.md) ([italiano](docs/it/USER_GUIDE.md)): new machine → bench → engines → CCRL list → gauntlet → NUMA → export and post
- [Tournament files](docs/TOURNAMENT_FILE.md) ([italiano](docs/it/TOURNAMENT_FILE.md))
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Progress checklist](docs/PROGRESS.md) and [final report](docs/FINAL_REPORT.md)
- [Changelog](CHANGELOG.md)

## Acknowledgements

- The testers who use TorsGUI every day and keep making it better (and starred it on GitHub):
  **Gabor**, who tests every release and reports everything useful or missing, from tablebase
  paths and BMI2 builds to random openings, abandoned games, withdrawing engines, crosstables and
  readable text (the Szőts theme, board and pieces are dedicated to him);
  **Bastiii** (Bastiball21, see below), who tests it, runs tournaments with it and sent the ideas
  behind the cores panel, active engines and the "as is" mode (the Bastiii theme and felt board
  are dedicated to him); and
  **Mark Tang**, who uses it, also to test the pre-releases of Triumviratus 8.
- [Rust Chess GUI](https://github.com/Bastiball21/Rust-Chess-GUI) by **Bastiball21** (Bastiii), the
  project that inspired TorsGUI (rebuilt from scratch around fastchess).
- [fastchess](https://github.com/Disservin/fastchess) by **Disservin** and contributors, which
  plays every game.
- **Graham Banks**, who provided the CCRL opening books bundled with TorsGUI (AVT, GM2700+,
  LowDraw, TopGM and the others), and the authors of those books (Andres Valverde and the
  others named in Settings → Opening books).
- The whole **CCRL community**: the team and the testers, whose rules, workflow, rating lists
  and advice TorsGUI follows, and who make computer-chess rating lists possible.
- **Jay Honnold** for [ccrl.live](https://ccrl.live) and its viewer
  [node-tlcv](https://github.com/jhonnold/node-tlcv), which hosts Graham's live broadcasts and
  whose code and protocol notes made the ccrl.live broadcast possible; and **Tom's Live Chess
  Server (TLCS)**, whose protocol TorsGUI speaks.
- [Lichess](https://lichess.org) and its open [broadcast API](https://lichess.org/api#tag/Broadcasts)
  for the Lichess broadcasts.
- [Stockfish](https://github.com/official-stockfish/Stockfish) (the SF10 bench used to
  calibrate time controls, and the engine that checked the solutions of the built-in test suites).
- **Fred Reinfeld**, author of *Win at Chess* (1958), whose positions became the classic WAC
  engine test, and the computer-chess community that keeps the EPD test suites alive.
- **Jon Dart** and the [Arasan](https://github.com/jdart1/arasan-chess) chess engine, whose test
  collection (MIT licence, [suites/LICENSE-arasan.txt](crates/torsgui-core/suites/LICENSE-arasan.txt))
  provides the complete WAC, ECM GCP, IQ4, BT-2630 (Bednorz & Tönissen), LCT II (Frédéric
  Louguet), the pawn endgame test, the Eigenmann Endgame Test (Walter Eigenmann) and the
  Arasan 2026 suite bundled with TorsGUI.
- The [lichess puzzle database](https://database.lichess.org/#puzzles) (CC0), from which the
  *Lichess mates*, *hard tactics* and *endgames* suites are selected
  ([suites/LICENSE-lichess.txt](crates/torsgui-core/suites/LICENSE-lichess.txt)).
- [Lichess](https://lichess.org) again for the winning-chance curve and the inaccuracy / mistake /
  blunder thresholds used by the game analysis, and the [Nord](https://www.nordtheme.com) palette
  by Arctic Ice Studio & Sven Greb for the Nord colour theme.
- [chessground](https://github.com/lichess-org/chessground) and the
  [lichess](https://github.com/lichess-org/lila) project for the board, and
  [sharechess](https://github.com/sharechess/sharechess) and lichess for the piece sets; every
  piece set's author and licence is listed in
  [ui/public/pieces/README.md](ui/public/pieces/README.md).
- **Kenney** ([kenney.nl](https://kenney.nl)) for the Impact Sounds and Interface Sounds packs
  (CC0) behind the move, capture and game sounds.
- The fonts bundled for the Retro font and the board initials, all under the SIL Open Font
  License: [DotGothic16](https://fonts.google.com/specimen/DotGothic16) (Fontworks),
  [IBM Plex Mono](https://github.com/IBM/plex) (IBM) and
  [Pinyon Script](https://fonts.google.com/specimen/Pinyon+Script) (Nicole Fally), via
  [Fontsource](https://fontsource.org).
- [Tauri](https://tauri.app), [cozy-chess](https://github.com/analog-hors/cozy-chess),
  [uPlot](https://github.com/leeoniya/uPlot) and the other open-source libraries TorsGUI uses.

## License

GPL-3.0-or-later (see [LICENSE](LICENSE)). fastchess, Stockfish and the engines keep their own licenses.
