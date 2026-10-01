# Progress checklist

Legend: [x] done and tested · [~] done, verified only partially (see FINAL_REPORT) · [ ] not done

## §2 Core architecture
- [x] Runner in a separate detached process; the GUI attaches through SQLite + lock (integration: kill/resume)
- [x] All state on disk (SQLite + PGNs); resume after crash/reboot (`resume`, auto-resume, logon task)
- [x] Pause / resume / stop; games in progress discarded and replayed, never counted twice (integration)
- [x] Queue and chaining; stop/pause never starts B; clean end with missing games → bounded retries (integration)
- [x] One game per fastchess process, TorsGUI schedules from the PGNs; never `-config file=`
- [~] Task Scheduler launch (Windows): implemented, compiled and unit-tested (CRLF .bat), not run on a real machine

## §3.1 Tournaments
- [x] Gauntlet, multi-seed gauntlet, round robin, match (scheduler tests)
- [x] Wizard with live summary: games, ETA, RAM/core checks, event, site, command preview (Playwright)
- [x] Every opening twice with colours reversed; incomplete colour pairs flagged
- [x] Disjoint opening blocks with the `run_node.py` formula (unit test on the Caissa README formula)
- [x] Defaults: 512 MB/thread, 1 thread/physical core lanes, draw/resign adjudication, Syzygy, PGN book sequential, `-recover`
- [x] CCRL event naming; site setting
- [x] Live progress: games, W/D/L, per-opponent table, terminations, avg duration, games/h rolling, ETA of tournament and queue, decisive games
- [x] Health panel: runners, fastchess/engine processes, free RAM, crashes/forfeits, anomalies

## §3.2 NUMA / CPU placement
- [x] Topology detection and view (nodes, groups, cores/SMT, caches)
- [x] Lane planning `cores / (2 × threads)`, override
- [~] Windows: suspended creation + Job Object with `JobObjectGroupInformationEx` + kill-on-close; engines inherit (Windows CI: the 7 integration tests and the bench pass through jobs; not yet on a 2-node machine)
- [x] Placement verified at runtime and shown (Lanes tab)

## §3.3 Engines
- [x] Library with all fields; used flag
- [~] Add from GitHub: releases (latest stable, redirect + HTML fallbacks), assets, download, extraction, sha256, verify (unit-tested parsers and selector; live GitHub not reachable from the build machine)
- [x] CCRL asset rules with reasons (36 real report assets + traps)
- [x] Separate networks downloaded
- [x] UCI verification uci → isready → go depth 12 (mock and real engines)
- [x] Naming and export names; rename tool in tournaments
- [x] Report equivalent to REPORT.md; rebuild from REPORT.md + uci_options

## §3.4 CCRL lists
- [~] Fetch from computerchess.org.uk (site not reachable from the build machine: parser tested on fixtures) + [x] manual import (paste/HTML/CSV)
- [x] Fuzzy name matching with confirmation and stored aliases
- [x] Opponent suggestion (latest version in the list, installed, thread support)
- [x] Estimated ratings (own gap → median → default), marked
- [x] Threshold helper

## §3.5 Bench
- [x] SF10 bench levels, repeats, median/spread/factor (real bench in CI on Linux and Windows)
- [x] Guards: 32-bit refused, CPU idle check, power plan and frequency
- [x] TC calculator with visible, editable formula (103+1 and 1690+19 reproduced)
- [x] History per machine with chart; import of ccrl_bench.py JSON

## §3.6 Export and communication
- [x] CCRL export identical to export_ccrl.py (byte test) and to the reference PGNs (content test); zip
- [x] Forum posts (finished/announcement/progress), copy button; §8 table reproduced
- [x] PGN viewer: board, moves, eval graph, engine info from comments

## §3.7 Live view
- [x] Grid of mini boards per lane; large board with PV, moves, eval of both engines, time usage
- [x] Incremental tail of fastchess engine logs

## §3.8 Settings and maintenance
- [x] Tester, site, paths, fastchess version, adjudication, theme
- [x] Housekeeping: unused engines, superseded versions, disk usage, log rotation
- [x] Git sync helper

## §4 UI/UX
- [x] All screens; dense dark theme + light theme; tabular numbers; W/D/L colours
- [x] Keyboard shortcuts, command palette, toasts, tray icon
- [x] 1920×1080 and 1280×800 screenshots; focus states

## §5 Pitfalls (tests)
1. [x] gauntlet truncation / `-games 1` + `-reverse` → one game per process, reversed colours (fastchess args test, integration)
2. [x] never `-config file=` (args test), TorsGUI owns concurrency and TC
3. [x] duplicates: slot dedupe, first by GameEndTime (unit, export byte test with a duplicate, integration kill test)
4. [x] detached runner (integration: runner killed, games die with it, resume)
5. [~] Job Object group affinity (Windows code path exercised in CI, not on a 2-node machine)
6. [x] bench: 32-bit refused (PE header test), busy CPU refused, historical 32-bit runs flagged
7. [x] CRLF .bat; paths with spaces and brackets (integration workspace `[Francesco Torsello 2026-09-28] ws (test)`)
8. [x] GitHub rate limit fallbacks (redirect + HTML listing parser test)
9. [x] idle tail: global queue with work stealing (unit)
10. [x] export changes only Event, Site, names and Round (byte test)

## §6 Engineering
- [x] Modules as listed; typed commands (ts-rs) and events
- [x] Unit, verification, integration, bench, component and Playwright tests
- [x] CI Linux + Windows, bundles; release job on tags
- [x] Screenshots in docs/screenshots and README
- [x] README, USER_GUIDE, ARCHITECTURE, DECISIONS, CHANGELOG, PROGRESS, FINAL_REPORT

## §9 Verification with real data
- [x] Caissa 2.0 4CPU: 189/380, 49.7 %, +1 =376 −3
- [x] Triumviratus 7.0 8CPU: +32 =831 −7, 51.4 %, 15 W / 15 B per opponent, §8 table
- [x] Stockfish 19 8CPU partial: imported, incomplete (298/380)
- [x] Exports of Triumviratus and Caissa identical in content to the reference PGNs (and same file and zip names)
- [x] Library rebuilt from REPORT.md + uci_options; the selector picks the report's asset for each engine

## Additions requested after the brief
- [x] AVX-512 builds as a personal option: settings + per-download toggle, preference by CPU support (AVX-512F/BW, VNNI), "not CCRL" flag, wizard warning (unit test `personal_avx512`)
- [x] Manual choice of the build to install (the installed asset's own verdict is recorded)
- [x] Game archive with external PGN files/folders (path guard extended to archive paths; Playwright)
- [x] Elegant board: themes, piece sets, animation, eval bar, material, check, arrows, autoplay, theater mode, move sound, ticking live clocks (Vitest + Playwright)
- [x] Tournament files (TOML/JSON): parse, tolerant engine matching, wizard defaults, review dialog, draft/queue/start, inbox, export, template for Claude (unit tests incl. round trip; Playwright)
- [x] Minimal board by default, custom square colours, 69 bundled piece sets with licences, personal import of other sets (unit test `import_sharechess_and_lichess_names`)
- [x] Chess960: variant, UCI_Chess960 detection, 960/random/DFRC books, every castling notation, FRC list, wizard + tournament files (unit tests `chess960::*`, `tournament_file` FRC case; integration `chess960_tournament_plays_start_positions` with the real fastchess; Playwright)
- [x] In-app help (guides rendered offline, contents, search, ? per screen) and CCRL submission checklist on Export (unit tests `checklist::*`; Playwright)
- [x] Getting started (setup status, per-step actions) and demo tournament with the bundled demo engine (unit tests `demo::*`; Playwright creates and starts the demo)
- [x] Bundled engines: Stockfish 10 and Triumviratus 7.0 AVX2 in the installers (CI, sha256 checked), one-click install, offline bench (unit tests `bundled::*`)
- [x] Bundled CCRL opening books (9 PGN for fastchess + 9 CGB): install, default book, Settings panel, wizard menu (unit tests `bundled::book_tests::*`; Playwright)
- [x] Error boundary: one failing screen no longer blanks the app
