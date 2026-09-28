# Changelog

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
- Import of the CCRL_ScirptsTests tournaments; §9 verification tests; mock UCI engine;
  integration tests with the real fastchess; Playwright smoke tests and screenshots; CI on
  Linux and Windows with bundles (NSIS, MSI, portable zip, AppImage, deb).
