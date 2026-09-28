# Decisions

Choices made while building v0.1.0, with the reason. The build brief asked to decide
ambiguous points in the way that best matches the CCRL workflow of CCRL_ScirptsTests.

## Stack

- **Tauri 2 + Rust + React/TypeScript** (as recommended). Rust gives direct access to the
  Windows APIs needed for NUMA placement (Job Objects, processor groups) with no runtime to
  install; Tauri gives a small native app with a web UI; the same Rust core is reused by the
  runner and by an HTTP server. UI libraries: Vite, Tailwind 4, Radix primitives (dialog,
  tabs, tooltip), TanStack Table, chessground (GPL-3, compatible), uPlot (small and fast for
  eval/time/bench charts, instead of ECharts), cmdk (command palette), sonner (toasts),
  lucide icons. All permissively licensed or GPL-compatible.
- **One core crate with modules** rather than a dozen crates: faster builds and simpler
  refactoring; the module names follow the brief (`platform` holds the topology).
- **ts-rs** generates the TypeScript types of every API payload; 64-bit integers are mapped to
  `number` (values stay far below 2^53).
- **One `api(cmd, args)` Tauri command** dispatching to `App::call`, instead of one Tauri
  command per operation: the same dispatcher serves the HTTP server, so the browser tests
  exercise exactly the code the desktop app uses.
- **HTTP server (`torsgui-server`)**: needed for Playwright (the Tauri WebView cannot be
  driven easily on Linux CI) and a natural base for the v2 remote web view. It binds to
  127.0.0.1 by default.

## Runner and scheduling

- **One runner process per running tournament**, launched detached. Chaining happens *inside*
  the runner: when a tournament completes cleanly with all games, the same process continues
  with the next queued one. No extra "queue daemon" is needed, and a stopped/paused/incomplete
  tournament simply ends the process, so the queue can never advance by accident.
- **GUI ↔ runner through SQLite only** (`desired` column polled every second, status JSON and
  heartbeat every 2 s, events table). No sockets to keep alive, works across GUI restarts.
- **Liveness = an OS file lock** (`runner.lock`) held by the runner; the OS releases it when the
  process dies, so a crash is detected reliably without PID reuse problems.
- **Pause vs stop**: both kill the games in progress and end the runner; both never advance
  the queue; a paused tournament is expected to resume, a stopped one is "not now". The
  difference is the state label (and the toast); resuming either continues where it was.
- **Slots** keep the Event scheme of the old scripts (`… node<P> pass<p> r<r>`). "node" is the
  *opening partition* (0..number of selected nodes), not necessarily the physical node the
  game ran on: this keeps the opening formula of `run_node.py` and the old tools working.
- **Global queue with work stealing**: each lane first takes slots of its own partition, then
  steals from the others, so all lanes stay busy until the end (pitfall 9). Queue order is
  `run_node.py`'s: lagging pairings first, round after round.
- **Retries**: a slot not recorded after fastchess exits is re-queued (max 3 attempts per
  runner session); a tournament that ends cleanly with games missing is retried twice
  (configurable), then marked *incomplete* and the queue stops.
- **Watchdog**: a game running longer than `1.5 × (both clocks fully used over 400 plies) +
  120 s` is killed and replayed. fastchess itself waits up to 60 s (`-ucinewgame-ms`,
  `-ping-ms`) for an unresponsive engine; these can be lowered with *Extra fastchess args*.
- **`-config outname=`** is still passed (per game, in `logs/games/`) so fastchess never
  writes a shared `config.json` in the working directory; the file is deleted after a
  recorded game. `-config file=` is never used.
- **Placement modes**: *Node* (default, all lanes of a node share its one-thread-per-core set,
  exactly the old `0x5555555555` masks), *Lane* (disjoint cores per lane: 2 × threads each),
  *None*. On Linux the affinity is set, but memory is not bound to the node (v2).
- **Game processes are created suspended** on Windows and resumed with `NtResumeProcess`
  after being assigned to the job, so not even fastchess's first instructions run outside
  the node. Rust's `Command` does not expose the main thread handle; `NtResumeProcess` is an
  ntdll export widely used for this.

## Data and statistics

- **PGNs are the source of truth**; SQLite caches counts. Every lane writes its own PGN file,
  like the old scripts, so there is never a shared file between processes.
- **Dedupe key**: slot `(partition, pass, round, White, Black)` from the Event (or Event+Round
  when the Event has no slot); the first by GameEndTime is kept (pitfall 3).
- **Export**: follows `export_ccrl.py` byte for byte, except that if two duplicates had the
  exact same GameEndTime the script would keep both; TorsGUI keeps only the first.
- **Standings order**: by list rating when known, otherwise the configuration order (which is
  the list order in the imported configurations): this reproduces the table of the brief's
  forum post. The Score and Config orders are one click away.
- **Estimated ratings**: 1CPU rating + own historical gap (same family, other versions in
  both categories) → list median gap → the default gap in Settings (32). Always marked
  "est.".
- **Elo**: 1-vs-1 logistic MLE anchored on the list ratings, joint for all non-anchored
  players (multi-seed gauntlets), 95 % CI from the Fisher information. Draws count as half
  points. Pluggable through the `EloEstimator` trait.
- **Legacy import**: finished tournaments are imported read-only (they reference engine paths
  of the machine that played them); configurations without PGNs become drafts. Legacy
  tournaments always used 2 node drivers, so they are imported with 2 partitions.

## Engines, GitHub, CCRL, bench

- **Asset selector tiers**: pure AVX2 > x86-64-v3 > AVX2 variants (intel/no-pext) >
  AVX2+BMI2/PEXT (flagged) > BMI2 (flagged) > popcnt/SSE (flagged) > universal (flagged:
  runtime dispatch may use AVX-512) > generic x86-64 (flagged). Rejected: AVX-512, VNNI,
  x86-64-v4, `-512`, 32-bit, ARM/macOS/Android, checksums, sources. Archives are selected when
  their name gives no ISA, and the selector is applied again to their contents.
- **Asset test data**: the chosen names come from `engines/REPORT.md`; the other assets of
  each release (the traps) were reconstructed from the report's notes because the GitHub API
  was not reachable from the build machine. The live flow uses the real release listings.
- **fastchess pin**: `v1.8.2-alpha` (the version of the reference setup). The sha256 table of
  the pinned assets is empty in v0.1.0: the download is accepted when it matches the sha256
  digest GitHub publishes for the asset, and the hash is shown. Fill `PINNED_SHA256` when the
  release is vetted.
- **CCRL lists**: default URLs (`/ccrl/404/rating_list_all.html` etc.) are best effort; the site
  was not reachable from the build machine, so the HTML parser is tested on fixtures and
  manual import (paste/CSV) is first-class. CPU categories are read from the entry names.
- **Bench on Linux**: the official SF10 builds in CCRL_ScirptsTests are Windows binaries; on
  Linux the user selects a 64-bit SF10 built from the `sf_10` sources (CI builds it from
  `third_party/stockfish-10-win/src`). Each instance is pinned to its CPU by the same confined
  spawn used for games (a one-CPU job on Windows).
- **TC formula**: `round(B·f)` and `if(I > 0, max(1, round(I·f)), 0)`, evaluated with
  `evalexpr`, editable in the UI and saved in Settings. It reproduces both reference TCs
  (Blitz → 103+1 at 0.86; 15'+10" → 1690+19 at 1.8773).
- **Import of ccrl_bench.py history**: runs whose engine does not report a 64-bit build
  ("Stockfish 10" instead of "Stockfish 10 64 …") are flagged invalid: this is how the 32-bit
  bench of 2026-09-22 shows up.

## UI

- Dark, dense, tabular numbers, W/D/L colours (green/grey/red), an optional light theme,
  keyboard navigation (`g` + letter), command palette, toasts for runner events, tray tooltip
  with the progress. Tables compact to 25 px rows so a 29-opponent standings table fits at
  1920×1080; the layout works at 1280×800 (see the screenshot).
- The live view polls every second and tails only the new bytes of the current game log.
- The screenshots use a demo workspace; the CCRL list in them is an illustrative sample file
  (`ui/e2e/sample-ccrl-blitz.txt`), clearly marked as such.

## Repository

- The work lives in its own repository, `Tors3/TorsGUI-CCRL-`; CCRL_ScirptsTests is only read
  (reference data for the verification tests, checked out by CI).
- **Releases**: pushing a `v*` tag publishes a GitHub release with the bundles; the same can
  be started from *Actions → CI → Run workflow* with a `release` tag name (the tag is created
  on the selected commit), for environments that cannot push tags.
- **`main`** is the only branch: work is committed there and releases are cut from it.
