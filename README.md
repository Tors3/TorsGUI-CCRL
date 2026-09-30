<p align="center"><img src="docs/brand/logo.svg" width="112" alt="TorsGUI logo"></p>

# TorsGUI — tournament manager for CCRL testers

TorsGUI is a desktop application for chess-engine testers who play games for the
[CCRL](https://computerchess.org.uk/ccrl/) rating lists. It replaces the usual pile of
Python scripts, `.bat` files and scheduled tasks with one elegant, dense tool that:

- plays **gauntlets, multi-seed gauntlets, round robins and matches** with
  [fastchess](https://github.com/Disservin/fastchess) (one game per process, TorsGUI owns the scheduling);
- keeps tournaments running in a **detached runner** that survives the GUI being closed,
  crashing or updating, and **resumes exactly where it was** after a reboot;
- places every game on a **NUMA node** (Windows: Job Object with group affinity, so engines
  that pin their own threads cannot escape);
- **chains** tournaments: B starts only when A has *all* its games and ended cleanly;
- manages an **engine library** from official GitHub releases with the CCRL asset rules
  (AVX2, never AVX-512/VNNI/v4/32-bit — AVX-512 only as a flagged *personal* option; you can
  always pick another build yourself), UCI verification and a report;
- imports the **CCRL lists**, matches names, suggests opponents and estimates missing ratings;
- calibrates the machine with the **Stockfish 10 bench** and turns CCRL time controls into local ones;
- builds the **CCRL submission** (PGN + zip, byte-compatible with `export_ccrl.py`) and a
  short **BBCode forum post**;
- shows everything **live**: mini boards per lane, ticking clocks, evaluation bar, PV arrows,
  games/hour, ETA;
- replays archived games on an animated board (minimal by default; 9 board themes including
  your own colours, 69 bundled piece sets plus any set you import; autoplay, theater mode),
  from its tournaments or any PGN file or folder;
- plays **Chess960 / Fischer Random** (and double Chess960): engines that support it are
  detected, start-position books are generated, games replay with 960 castling;
- imports **tournament files**: describe a tournament in a few TOML lines (or ask Claude to),
  import it, review, queue or start ([docs/TOURNAMENT_FILE.md](docs/TOURNAMENT_FILE.md)).

It is open source (GPL-3.0-or-later) and nothing is specific to one machine.

## Screenshots

![Game viewer](docs/screenshots/04-pgn-viewer.png)

<details>
<summary><b>All screenshots</b> (23 screens: dashboard, standings, live, wizard, engines, CCRL lists, bench, export, archive, tournament file…)</summary>

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
| ![Board](docs/screenshots/20-board-appearance.png) Board appearance: minimal default, custom colours, 69 piece sets | ![Tournament file](docs/screenshots/21-tournament-file.png) Importing a tournament file written by Claude |

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
   (or point to your own binary). Point the paths to your engines, books and tablebases.
3. **Bench** → *Get official SF10* → run 1 and N parallel instances with the machine idle →
   the TC calculator gives the local time control (e.g. Blitz 2'+1" → `103+1` at f≈0.86).
4. **Engines** → *Add from GitHub* (paste the repository URL) for each engine; each one is
   downloaded, checked (sha256), verified (`uci` / `isready` / `go depth 12`) and named.
5. **CCRL Lists** → fetch or paste the Blitz / 40/15 list.
6. **Tournaments → New**: pick the seed, *Suggest opponents*, TC, threads, games per pairing,
   nodes and lanes; check the live summary (games, ETA, RAM, cores) → *Create and start*.
7. Follow it on the **Dashboard** and **Live**; close the window whenever you want.
8. **Export** → build the CCRL zip and copy the forum post.

The full workflow is in [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

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

- [User guide](docs/USER_GUIDE.md): new machine → bench → engines → CCRL list → gauntlet → NUMA → export and post
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Progress checklist](docs/PROGRESS.md) and [final report](docs/FINAL_REPORT.md)
- [Changelog](CHANGELOG.md)

## Acknowledgements

- [Rust Chess GUI](https://github.com/Bastiball21/Rust-Chess-GUI) by **Bastiball21**, the
  project that inspired TorsGUI (rebuilt from scratch around fastchess).
- [fastchess](https://github.com/Disservin/fastchess) by **Disservin** and contributors, which
  plays every game.
- The [CCRL](https://computerchess.org.uk/ccrl/) team and testers, whose rules and workflow
  TorsGUI follows.
- [Stockfish](https://github.com/official-stockfish/Stockfish) (the SF10 bench used to
  calibrate time controls).
- [chessground](https://github.com/lichess-org/chessground) and the
  [lichess](https://github.com/lichess-org/lila) project for the board, and
  [sharechess](https://github.com/sharechess/sharechess) for the piece-set collection; every
  piece set's author and licence is listed in
  [ui/public/pieces/README.md](ui/public/pieces/README.md).
- [Tauri](https://tauri.app), [cozy-chess](https://github.com/analog-hors/cozy-chess),
  [uPlot](https://github.com/leeoniya/uPlot) and the other open-source libraries TorsGUI uses.

## License

GPL-3.0-or-later (see [LICENSE](LICENSE)). fastchess, Stockfish and the engines keep their own licenses.
