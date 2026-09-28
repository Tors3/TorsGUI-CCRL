# TorsGUI v0.1.0 — final report

## What was built

A desktop application (Tauri 2 + Rust + React/TypeScript) for CCRL testers, in the
repository `Tors3/TorsGUI-CCRL-`:

- **torsgui-core** (Rust): scheduler, runner, NUMA placement (Windows and Linux behind the
  `Os` trait), fastchess integration, PGN (python-compatible splitting, incremental index,
  dedupe, fastchess comments), statistics (standings, colour pairs, anchored logistic MLE),
  CCRL export and forum posts, engine library (GitHub releases, asset selector, UCI
  verification, report), CCRL lists (parsing, matching, suggestions, estimates, thresholds),
  bench (SF10 levels with guards, TC calculator), live log tail, health, maintenance, legacy
  import, SQLite store and the typed command API.
- **torsgui-runner**: the detached process that plays tournaments and chains the queue.
- **torsgui-server**: the same API over HTTP (browser UI, Playwright, future remote view).
- **mock-uci**: a test engine that can crash, hang, start slowly or play illegal moves.
- **src-tauri**: desktop shell with tray icon and the runner as a sidecar; bundles NSIS, MSI,
  portable zip, AppImage and deb.
- **ui**: ten screens (Dashboard, Tournaments with wizard and detail, Live, Games, Engines,
  CCRL Lists, Bench, Export, Settings, Logs), game viewer with animated board, tournament
  file import, command palette, shortcuts, toasts, dark
  and light themes.

Every feature of §3 is reachable from the UI; the mapping is in [PROGRESS.md](PROGRESS.md).

## How it was tested

| Suite | What | Where it runs |
|---|---|---|
| Rust unit tests (50, plus 81 generated type-export checks) | tournament files (tolerant engine names, wizard defaults, errors, JSON, export → import round trip, template), personal AVX-512 policy, scheduler and opening formula (checked against the Caissa README formula), queue order and work stealing, dedupe, PGN splitting identical to the scripts' regex, colour pairs, asset selector on the 36 assets of `REPORT.md` plus AVX-512/VNNI/v4/bmi2/32-bit traps, name matching, TC calculator (103+1, 1690+19), CCRL parsing/estimates/suggestions/thresholds, bench parsing and 32-bit refusal, live log tail, PGN viewer, lock, CRLF `.bat`, placement planning (0x5555555555 mask of the Xeon) | Linux + Windows CI |
| §9 verification (8) | real CCRL_ScirptsTests data: Caissa 2.0 4CPU (189/380, +1 =376 −3), Triumviratus 7.0 8CPU (+32 =831 −7, 51.4 %, 15 W/15 B per opponent, §8 table and result line), Stockfish 19 partial (298/380, incomplete), exports identical in content (and same file/zip names) to the reference PGNs, byte-identical output to `export_ccrl.py` on a fixture with CRLF, a duplicate and an unfinished game, library rebuilt from REPORT.md + uci_options, PGN viewer replays all 870 games | Linux + Windows CI |
| Bench (1) | real Stockfish 10 bench, signature 3 939 338 nodes | Linux CI (SF10 built from the reference sources) and Windows CI (official SF10 x64 binary, pinned through a one-CPU Job Object) |
| Integration (7) | real runner + real fastchess 1.8.2 + mock engines at 1+0.01 / 3+0.05, workspace path with spaces, brackets and parentheses: full run; runner SIGKILLed mid-game (games die with it) then `resume` → complete, no duplicates, all colour pairs; pause discards games in progress then resume; chain of two; manual stop and pause never start the next; engine missing → bounded retries → incomplete, queue does not advance; crashing / illegal-move / hanging / slow-starting engines → games recorded, seed wins, events raised | Linux CI; Windows CI (see below) |
| UI component tests (16) | formatting, W/D/L widgets, state chip, progress bar, tournament action rules, captured material from FEN | CI |
| Playwright smoke (10) | real backend on a demo workspace: dashboard, imported Triumviratus numbers, PGN viewer with eval bar, game archive with an external PGN folder and autoplay, board appearance remembered, tournament file import (tolerant names, errors with suggestions, draft), wizard totals, export + forum post (§8 lines), command palette and `g` navigation, TC calculator, every screen without errors | Linux CI |
| Screenshots | every screen at 1920×1080, light theme, 1280×800, live view with a real fastchess tournament | local (`npm run screenshots`) |
| Tauri bundle | `.deb` built locally and the release app started under Xvfb; NSIS/MSI/portable zip/AppImage/deb in the CI bundle job | CI |

## Known limitations

- **CCRL site**: `computerchess.org.uk` was not reachable from the build machine. The HTML
  parser and the default URLs are tested only on fixtures; if the real page differs, use the
  manual import (paste or CSV), which is fully tested. The CCRL list in the screenshots is an
  illustrative sample.
- **GitHub from the build machine**: the release API and downloads of engine repositories were
  not reachable here. The listing/redirect/HTML fallbacks are unit-tested on fixtures and the
  selector on real asset names, but the complete *Add from GitHub* flow was not run end to
  end against github.com. The asset lists used in the selector test are reconstructed from the
  notes of `engines/REPORT.md` (the chosen assets are real).
- **fastchess pin**: `PINNED_SHA256` is empty; the download is checked against the sha256
  digest GitHub publishes for the asset. Fill the table once the release assets are vetted.
- **Linux NUMA**: affinity only; memory is not bound to the node.
- **Windows Task Scheduler launch** and the **logon resume task** are implemented and the
  `.bat` generation is tested, but `schtasks` was not exercised on a real desktop session.
- **Tray icon**: built and bundled; only its tooltip/menu, not a rich status window.
- **Pause vs stop** differ only by the state label; both keep the tournament resumable.
- **Elo**: one estimator (logistic MLE); Ordo/BayesElo are v2.

## What must be verified on the 2-node Xeon server (Windows)

GitHub's Windows runners have a single NUMA node and processor group, so these points need
the real machine:

1. **Topology**: Settings → CPU topology shows 2 nodes, 2 processor groups, 20 cores / 40
   threads each, and the highlighted first threads correspond to the `0x5555555555` mask.
2. **Placement**: start a tournament with 2 nodes × 2 lanes; in *Lanes & placement* every
   game shows `job: group N mask 0x5555555555` in green; Task Manager / Process Explorer
   shows fastchess and both engines only on the node's CPUs.
3. **Caissa 2.0 self-pinning**: a game with Caissa 2.0 at 4 or 8 threads must stay inside its
   node (the Job Object group affinity cannot be escaped).
4. **Detachment**: close TorsGUI, kill it from Task Manager, log off/disconnect RDP: games
   continue; reopen → the dashboard shows the runner alive. Update/reinstall TorsGUI while a
   tournament runs.
5. **Reboot**: with *Resume at logon* registered, reboot → the runner restarts and the
   tournament continues from the PGNs without duplicates.
6. **Task Scheduler mode**: enable it in Settings, start a tournament → a `TorsGUI\<id>` task
   appears and the runner starts.
7. **Bench**: *Get official SF10* → run 1,10,20,40 instances with the machine idle; compare
   the factors with the 2026-09-27 results (bmi2: 0.8418 at 1 instance).
8. **Add from GitHub** for a few engines of the report (e.g. Obsidian 16.0, Stormphrax 8.0.0,
   Stockfish 19): the chosen asset and the flag must match `engines/REPORT.md`.
9. **CCRL fetch**: *Fetch from the site*; if nothing is recognised, paste the table.

## Suggested v2

- Remote web view (the HTTP server already serves the UI and the API; add authentication and
  read-only mode) and notifications to the phone/Discord.
- More Elo tools: Ordo-like multi-player MLE with error propagation, BayesElo, pentanomial
  statistics and SPRT for engine developers.
- Linux NUMA memory binding (`set_mempolicy`/libnuma) and cgroup-based confinement.
- Automatic fastchess release vetting (pinned sha256 per asset) and in-app update.
- Opening book management (download/verify books, EPD support in the viewer).
- Multiple machines: one GUI driving runners on several testing machines.
- Richer tray window and OS notifications.
