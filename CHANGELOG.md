# Changelog

## [0.6.7] - 2026-10-08

### Added
- **One random opening per game** (wizard → Conditions → Openings, `random_openings = true`
  in a tournament file): every game gets its own opening, picked at random from the book
  (fastchess `order=random` with a seed kept in the tournament, so a resumed game keeps its
  opening). The default stays each opening twice with colours reversed.
- **Files** on the tournament's *Games* tab: where the PGNs (one file per lane), the game
  logs (one fastchess log per game, engine output included) and the tournament folder are,
  with buttons that open them.

### Fixed
- **BMI2 builds count as AVX2 builds** for CCRL (BMI2 came with AVX2, and these builds use
  both): no disclaimer for them any more.
- An engine whose SyzygyPath (or Gaviota / Nalimov path) option is empty, as after a Cute Chess
  import, now gets the tournament's path instead of the empty one.
- Settings → Paths: the unused "Tablebases folder" field is gone; the Syzygy field says it is
  passed to every engine automatically.

## [0.6.6] - 2026-10-08

### Fixed
- **"lane N: placement differs from the plan (job: group 0 mask 0x0 …)"**: on Windows a
  game's job could end up without its CPU set (mask 0x0), so the game was not held to its
  cores. TorsGUI now sets the CPU set again when the check finds it missing and warns only if
  that fails too (the reason is in the warning and in the log).
- These warnings no longer pile up: one per lane, about its latest game, and on the
  *Lanes & placement* tab they are folded into a single line (click it for the details).

## [0.6.5] - 2026-10-08

### Changed
- **CCRL build disclaimer is a warning, not a verdict**: some engines exist only as generic,
  bmi2 or popcnt builds. When the selected engines are not all AVX2 or AVX-512 builds, the
  wizard and the tournament page now say *DISCLAIMER: not all the selected engines are AVX2 or
  AVX-512 builds: … Go on only if you cannot get an AVX2 or AVX-512 build of them*, and the
  CCRL checklist warns instead of failing. 32-bit builds still fail; an AVX-512 build on a CPU
  without AVX-512 still blocks the tournament.

## [0.6.4] - 2026-10-05

### Fixed
- **Desktop shortcuts opening an older TorsGUI**: a shortcut made for an earlier copy (an
  earlier portable folder, for instance) kept opening it, and that copy offered the update
  again. At start, on Windows, TorsGUI now points the "TorsGUI" shortcuts of the desktop to
  itself when they open an older or missing TorsGUI.exe; shortcuts to other programs or to a
  newer TorsGUI are left alone. The change is written in the log.

### Added
- *Settings → General → Create desktop shortcut* (Windows): a "TorsGUI" shortcut that opens
  this copy.

## [0.6.3] - 2026-10-05

### Changed
- **AVX-512 builds are CCRL builds**: CCRL tests AVX2 or AVX-512 binaries. Downloads take the
  AVX-512 build (VNNI first, then AVX-512 / x86-64-v4) when this CPU runs it, else the AVX2
  one; an AVX-512 build is never taken on a CPU without AVX-512 (it would crash). *Settings →
  Engine builds → AVX2 only* (also in the *Add from GitHub* dialog) keeps the AVX2 build. The
  old "personal, not CCRL" flag is gone.
- **CCRL disclaimer**: a CCRL tournament is valid only when every engine is an AVX2 or AVX-512
  build. When one is not (bmi2, popcnt, universal, generic), the wizard and the tournament page
  say *NOT VALID FOR CCRL* and name the engines, and the CCRL checklist fails; a local file whose
  name does not tell the build is pointed out to check. An AVX-512 build on a CPU without
  AVX-512 blocks the tournament.
- **Portable version keeps its data next to `TorsGUI.exe`** (`data` folder, marked by
  `portable.txt`): the first time it copies there the workspace used so far, leaving the
  original in place.
- The portable zip carries the version in its name (`TorsGUI_0.6.3_portable-windows-x64.zip`),
  so a new download no longer collides with the previous one.
- Settings shows which copy of TorsGUI is running and from where.
- New colour theme **Coffee**: espresso browns, crema text and a caramel accent.

### Fixed
- **Update now on the portable version** (0.6.0–0.6.2) unpacked the new files inside
  TorsGUI's folder and then set aside every executable around it, the new ones included: the
  update failed and could leave the folder without `TorsGUI.exe`, and engines kept inside or
  below TorsGUI's folder were renamed. Now the package is unpacked elsewhere and only the files
  it replaces are set aside; at the next start, files set aside but never replaced are put back
  (this also repairs what the old versions left).

## [0.6.2] - 2026-10-05

### Added
- **Gaviota and Nalimov tablebases**: their paths in *Settings → Paths*, next to Syzygy, are
  passed to every engine that has a Gaviota / Nalimov path option (`GaviotaTbPath`,
  `NalimovPath`…), in the wizard and in tournament files.
- **Browse…** buttons on the path fields of the desktop app (engines, books, tablebases,
  folders, Cute Chess `engines.json`, tournament files): the system's file or folder picker.

## [0.6.1] - 2026-10-04

### Added
- **CPU category of the tournament** (1, 2, 4, 8CPU… for every engine) and, apart, **custom
  threads per engine** (an 8CPU seed against 1CPU opponents, as the CCRL Blitz list is built):
  a preset in the wizard and a *Threads* column in the engine table; each engine gets its own threads and hash, its rating from the right CPU category, the
  event and the exported names say *8CPU vs 1CPU*, the lanes are sized on the heaviest pairing.
  Tournament files: `[threads_of]` and `[hash_of]`.
- Tournament tab **Where it lands**: the seed's rating from this test (MLE anchored on the CCRL
  ratings, or the performance), with its 95 % band, drawn among its neighbours of the CCRL list
  in its CPU category; the rank it would take, and its current entry when it is already listed.
  Imported tournaments are rated against the list too.

### Changed
- *Passes* are called *Passes (stages)* in the wizard, with an explanation: each stage plays
  every opponent the same number of games with fresh openings, so a tournament stopped after a
  stage stays balanced.

## [0.6.0] - 2026-10-04

### Added
- **Play against an engine** (*Analysis → Play vs engine*): any engine of the library, your
  colour, a clock (1+0 … 15+10) or a fixed engine time per move, the engine's strength (UCI_Elo
  or Skill Level when it has them), a start position; moves by drag or click, promotion choice,
  take-backs, resignation, every end of game (mate, stalemate, repetition, fifty moves,
  insufficient material, time); save the PGN or analyse the game.
- **Desktop notifications** for the important events (tournament finished, queue, engine
  problems, bench, test suites, game analysis), also while TorsGUI is in the tray; Settings
  switch.
- **Update from inside the app**: when a newer TorsGUI release is on GitHub a bar offers
  **Update now**: the file for this kind of install (Windows installer, MSI, portable folder,
  AppImage, Debian package) is downloaded, its size and SHA-256 checked, and installed; TorsGUI
  starts again. Running tournaments keep running (files in use are set aside and replaced).
  *Settings → General*: check at start (switch) or *Check for updates now*.
- Tournament **Elo graph**: the Elo (or performance) of a player game after game with its 95 %
  band.
- Tournament **Openings**: results per opening of the book, White's score, draws, pairs won
  twice by the same colour or swept by the same engine.
- Game analysis **as PGN** (copy or save) with `[%eval]`, ?! ? ?? and the engine's lines.
- More **test suites** bundled: WAC (300, revised), ECM GCP, IQ4, BT-2630, LCT II, a pawn
  endgame test and the Eigenmann Endgame Test, from the Arasan engine's collection (MIT).
- **From the CCRL list to the download**: click an engine in *CCRL Lists* and *Engines → Add
  from GitHub* opens with its repository and the release of the version listed already chosen
  (102 engines mapped, from the top of the lists down, plus the official sites of engines not on
  GitHub). For the others TorsGUI reads the engine's page on the CCRL site for its GitHub or
  homepage link, and remembers it; an address pasted by hand is remembered too.
- Links open in the system browser in the desktop app.

### Fixed
- **CCRL lists all the same after a download**: for every list TorsGUI tries several addresses
  of the site and took the first page with rating rows, so a site answering the same page (the
  Blitz list, a home page) at the other addresses turned every list into that one. Now a page is
  taken only when its title is the list asked for (Blitz, 40/15, FRC; best or all versions) and
  its rows are not those of another list; otherwise the next address is tried, and the list keeps
  what it had when none fits. *CCRL Lists* shows where each list comes from (address and title of
  the page) and warns when two saved lists have the very same rows (press *Fetch all* again).

### Changed
- Pages with many panels are split into **sub-tabs** in their main area (the tab is kept in the
  address, so links and reloads open it): *New tournament* is a step-by-step form (Type &
  engines · Seeding · Conditions · NUMA & lanes, with Back / Next) and keeps the summary and
  the Create buttons on the right; *Dashboard* (Now · Queue & timeline · Recent & events);
  *Bench* (Run & latest result · History · TC calculator, where a click on a measured factor
  uses it); *CCRL Lists* (Lists · Suggest opponents · Name matching · Thresholds).
- **Paper** is the default colour theme (a theme chosen in the picker is kept).
- *Engines*: the six buttons at the top become one **Add engine** menu (GitHub, local file,
  Cute Chess, bundled engines, REPORT.md) next to *Report*.

## [0.5.1] - 2026-10-03

### Added
- **Game analysis** (*Analysis → Game analysis*, or **Analyse** in the game viewer): a game of
  the archive, a pasted PGN, bare moves or a FEN, with an engine of the library. *Live engine*
  analyses the position shown with 1–5 lines (arrows on the board); *Analyse the game* searches
  every position for a fixed time and marks inaccuracies (?!), mistakes (?) and blunders (??)
  with the best move and line, an evaluation graph, accuracy and ACPL per side.
- **Test suites** (*Analysis → Test suites*): puzzles and mate finding for engines. EPD files or
  pasted positions with `bm` / `am` / `dm`, several engines at once, time per position, engine
  processes in parallel; results with the solve time per position, solved count, board with the
  solution and the engines' moves; runs are kept. Built-in samples: mates in 1 to 7 and the first
  20 *Win at Chess* positions (solutions checked with Stockfish 10).
- **Manual seeding** for Swiss and cup tournaments: the *Seeding* panel of *New tournament*
  reorders the seeds (by rating by default) and shows the first-round bracket, so strong engines
  do not meet early.
- **Colour themes**: System, Dark, Light, Graphite, Paper, Nord, Midnight, Forest, High contrast;
  chosen at the bottom of the sidebar or in *Settings → Appearance* with previews (`t` cycles).

### Changed
- The sidebar is grouped into **Testing**, **Engines**, **Analysis** and **App** sections that
  fold, and can be narrowed to icons only; the header shows the section of the page.
- **Settings** are split into tabs: General, Appearance, Paths & fastchess, Opening books, Live
  broadcast, CPU topology, Maintenance.

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
