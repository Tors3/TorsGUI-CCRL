# Changelog

## [0.5.0] - 2026-10-03

### Added
- **Import engines from Cute Chess**: *Engines → Import Cute Chess* reads its `engines.json`
  (found in the usual folders, given by path, or pasted): every UCI engine with its working
  folder, arguments and the UCI options changed in Cute Chess, verified 4 at a time; engines
  whose executable is missing are added to be completed later, xboard engines are skipped.
  Engines get an *Arguments* field.
- **Swiss** tournaments: rounds paired from the results (Dutch system, no rematches when
  possible, byes worth a drawn match), Swiss table with Buchholz, the runner pairs and plays
  each new round by itself.
- **Cup (knockout)** tournaments: seeded bracket with byes for the best seeds, mini-matches with
  2-game tiebreaks, bracket view up to the final and the winner.
- Tournament files accept `kind = "swiss"` and `kind = "knockout"`.

## [0.4.2] - 2026-10-03

### Added
- **UCI options editor** in *Engines → Edit*: every option the engine declares with its own
  control (number with its range, true/false, list, text/file), the engine default next to it,
  a reset per option; options the engine does not declare are added as name + value rows.
  New tournaments use the engine's options, as before.
- *New tournament*: the **options** button of each chosen engine changes its options for that
  tournament only (same editor).
- The tournament's *Configuration* tab can change the options of one engine while the
  tournament is paused or stopped (used from the next game).
- Option checks: names the engine does not declare (wrong upper/lower case), values outside the
  range or the list, network files not found (relative paths are read from the engine folder).

### Fixed
- *Engines → Edit*: saving dropped the options written by the user (only Ponder/OwnBook were kept),
  so a changed network file never reached the games.
- **Small, scaled or square windows** (laptops, Windows display scaling 125–150 %): the window
  can now be made as small as 960×600; wide tables scroll inside their panel instead of covering
  the next one (Bench result over the TC calculator); Bench, New tournament, CCRL lists, Settings,
  Dashboard and the tournament page rearrange their columns; page headers, tile rows and
  segmented buttons wrap instead of cutting titles, numbers and labels.
- Settings showed version 0.1.0: every part now carries the app version.

## [0.4.1] - 2026-10-02

### Added
- **CCRL ratings in Engines**: Blitz, 40/15 and FRC rating of every engine (CPU category,
  rank and games in the tooltip; `≈` when the version is not listed yet), synchronised with
  the stored CCRL lists, **Update CCRL ratings** button, sortable columns, search.
- **CCRL names in the export**: players are written as the tournament's CCRL list writes them
  (another list, or the listed engine name with the new version, when needed), shown and
  editable in *Export → Names in the PGN*; the forum post uses the same seed name.
- **New tournament**: search over name/author/build, Elo range filter, sort by name or rating,
  **Closest to seed**.

### Fixed
- Settings → Live broadcast: **Check** now saves a valid Lichess token at once. Before, a token
  checked but not saved with "Save settings" made the tournament's Lichess switch fail with an
  unclear red message; the message now says what to do.

## [0.4.0] - 2026-10-01

### Added
- **Live broadcast on Lichess**: one broadcast per tournament (created with the first game,
  description with tester, TC, hash, book and engines), rounds of 60 games, every game pushed
  with clocks and evaluations, finished games with their result. Token, check and visibility in
  Settings → Live broadcast.
- **Live broadcast on ccrl.live**: TorsGUI is a TLCS-compatible server (the protocol of Tom's
  Live Chess Server, as read by node-tlcv): one broadcast per lane on its own UDP port, with
  players, moves, depth/score/PV, clocks, results and the crosstable; tested against the real
  node-tlcv. Settings: first port, firewall rule, public IP and the message for Jay.
- Broadcast switches per tournament (wizard and tournament page, tab *Live broadcast*) with
  links, viewers per lane and errors. The broadcast runs in the runner: it goes on with the
  GUI closed.

### Compatibility
- Tournaments created or paused with 0.3.x resume with 0.4.0 (tested: a gauntlet paused with
  0.3.2 at 5/16 games finished with 0.4.0 at 16/16, no duplicates). Settings are kept; the new
  ones get defaults.

## [0.3.2] - 2026-10-01

### Fixed
- **CCRL lists**: the 40/15 and FRC lists were not read. The CCRL tables have a two-row
  header (Rating = Elo / + / −) and tied ranks (`14-15`); columns are now aligned with the
  header's `colspan` and tied rows are kept. Pages are requested like a browser, from the
  current addresses (`computerchess.org.uk/<list>/`), with fallbacks to `/ccrl/`, `www.` and
  the site's text export; a failure lists every address tried.

### Added
- **Bundled CCRL lists**: Blitz, 40/15 and FRC (best versions, September 2026) are available
  from the first start, offline, for ratings, opponents and CCRL names; *Fetch all* and
  *Bundled lists* on the CCRL page; *Open a saved page* in Manual import.
- **Edit a tournament before it starts**: the Edit button on a draft opens the wizard with
  its settings; save, save and queue, or save and start.
- **Known engines**: 73 public GitHub repositories in *Add from GitHub*, covering every
  open-source engine of the CCRL Blitz top 60 (36 tested by TorsGUI), with the Blitz
  rating and whether the engine is in the library; one click lists the releases.

## [0.3.1] - 2026-10-01

### Added
- **Bundled CCRL opening books**: the installers carry the 18 books used by CCRL testers
  (AVT-Book 2026c/2026d, AVT-Fringe 2026, AVT 8 moves 50-65, AVT ICCF 8 moves more
  unbalanced, GBSelect 2026, GM2700+, LowDraw1000, TopGM 8 moves): 9 PGN books for
  fastchess and 9 CGB books for other GUIs. *Install the CCRL opening books* (Getting started,
  Settings → Opening books) extracts them into the books folder and makes AVT-Book 2026d the
  default book when none is set.
- **Settings → Opening books**: every bundled book with author, positions, description and
  terms, whether it is installed, and *Use as default*.
- **Wizard**: an *Installed books…* menu next to the book field lists the PGN/EPD books of
  the books folder with their number of positions.

## [0.3.0] - 2026-09-30

### Added
- **Getting started**: a guided setup (tester, fastchess, folders and book, bench, engines,
  CCRL list, first tournament) with the live status of each step, why it matters and a button
  to do it; a banner on the dashboard until the setup is complete.
- **Demo tournament**: one click plays a short gauntlet (standard or Chess960) with three
  bundled *TorsGUI demo engines* through the real runner and fastchess, with a short tour of
  Live, the tournament, Games and Export. The demo engine ships with the app as a sidecar.
- **Bundled engines**: the installers carry Stockfish 10 (official Windows builds; built from
  the `sf_10` sources on Linux) and Triumviratus 7.0 AVX2, both GPL-3 and sha256-checked.
  *Add the bundled engines* (Getting started, Engines) installs and verifies them; the bench
  uses the bundled Stockfish 10 without downloading anything.
- **In-app help**: the user guide and the tournament-file guide inside TorsGUI (offline),
  with contents, search, and a **?** button on every screen that opens its section.
- **CCRL submission checklist** on the Export page: games, colour pairs, duplicates,
  terminations, hash rule, ponder, book, tablebases, CCRL builds, verified engines, names,
  time control against the latest bench, variant/list, tester and site; each check explained
  in the guide.

## [0.2.0] - 2026-09-30

### Added
- **Chess960 (Fischer Random)**: tournament variant (`-variant fischerandom`, engines get
  `UCI_Chess960 true`); engines that declare `UCI_Chess960` are detected and marked "960",
  the wizard refuses engines that do not support it; CCRL FRC list (40/2) in the wizard,
  tournament files (`variant = "chess960"`) and CCRL list sources.
- Chess960 start-position books generated by TorsGUI: all 960 positions (shuffled with a
  seed), a random set, or double Chess960 (DFRC); deterministic per seed; the standard
  position is excluded by default. Each position is played with both colours.
- Every castling notation in FENs (KQkq, X-FEN, Shredder-FEN) and king-takes-rook castling
  in the game viewer, the live view and the mock engine.
- New logo (rook with a T on classic squares) for the app, installers, favicon and README.
- Acknowledgements in the README.

## [0.1.0] - 2026-09-28

First release.

### Added
- Detached `torsgui-runner` (one per running tournament) that survives the GUI, resumes after
  crashes and reboots (auto-resume at start, optional logon task), pause / resume / stop,
  bounded retries, watchdog, and queue chaining that only advances after a complete, clean
  tournament.
- Scheduler porting `run_node.py`: one game per fastchess process, disjoint opening blocks per
  node partition / pass / pairing, every opening with both colours, lagging pairings first,
  work stealing between lanes.
- NUMA placement: topology detection (Windows `GetLogicalProcessorInformationEx`, Linux
  sysfs), lane planning, Job Objects with group affinity and kill-on-close on Windows,
  affinity + process groups on Linux, runtime placement check.
- Tournament types: gauntlet, multi-seed gauntlet, round robin, match; wizard with live
  summary (games, openings, ETA, RAM and core checks, first command).
- Engine library: add from GitHub (release listing with rate-limit fallbacks, CCRL asset
  rules with reasons, download, sha256, zip/7z/tar.gz extraction, separate networks), local
  engines, UCI verification, CCRL naming, report generation, rebuild from `REPORT.md`,
  rename inside a tournament.
- CCRL lists: fetch (best effort) and manual import, fuzzy name matching with aliases,
  opponent suggestion, estimated ratings, threshold helper.
- Bench: Stockfish 10 levels with pinning, 32-bit / busy-CPU / power-plan guards, history
  and chart, import of `ccrl_bench.py` results, editable TC calculator.
- Statistics: per-opponent W/D/L, colour split, colour-pair check, terminations, durations,
  decisive games, performance, pluggable Elo module with an anchored logistic MLE.
- CCRL export byte-compatible with `export_ccrl.py` (PGN + zip); BBCode forum posts
  (finished, announcement, progress) with editable templates.
- Live view (mini boards, clocks, eval, depth, nps; large board with PV, eval and time
  graphs) from incrementally tailed fastchess engine logs; PGN viewer with engine info.
- Dashboard with health panel and ETA timeline, command palette, keyboard shortcuts, toasts,
  tray icon, light theme; settings, housekeeping, log rotation, git sync, logs viewer.
- Tournament files: a TOML description (engines by library name, tolerant matching, wizard
  defaults), import dialog with review → draft / queue / start, inbox folder, export of any
  tournament as a file, and a template for assistants such as Claude.
- Game archive (tournaments + external PGN files/folders) and a new game viewer: evaluation
  bar, captured material, clocks, next-move arrow, check highlight, autoplay, theater mode,
  move list with evaluations; live board with ticking clocks and PV arrows; minimal flat
  board by default, 9 board themes including custom colours, 69 redistributable piece sets
  (sharechess/lichess, with credits) and import of any other set for personal use,
  animation speed, coordinates, optional move sound.
- AVX-512 / VNNI / x86-64-v4 builds as a personal option (flagged "not valid for CCRL",
  optionally preferred when the CPU supports them); manual choice of the build to install.
- Import of the CCRL_ScirptsTests tournaments; §9 verification tests; mock UCI engine;
  integration tests with the real fastchess; Playwright smoke tests and screenshots; CI on
  Linux and Windows with bundles (NSIS, MSI, portable zip, AppImage, deb).
