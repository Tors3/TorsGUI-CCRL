# Architecture

```
┌─────────────────────────────── desktop app (Tauri 2) ──────────────────────────────┐
│ React + TypeScript UI (ui/)  ── invoke("api", {cmd, args}) ──►  src-tauri: api()     │
│   TanStack Table · chessground · uPlot · cmdk · Radix · Tailwind                    │
└───────────────────────────────────────────────┬─────────────────────────────────────┘
                                                │ torsgui_core::api::App::call(cmd, json)
        torsgui-server (HTTP, same API) ────────┤
                                                ▼
┌────────────────────────────── torsgui-core (Rust library) ──────────────────────────┐
│ store (SQLite, WAL)   model   scheduler   pgn   stats   export   forum   tc   names │
│ engines   assets   github   ccrl   bench   live   health   maintenance   legacy     │
│ platform::{Os trait → linux | windows}  (topology, confined spawn, detached spawn)  │
│ runner (lanes, control, chaining)                                                   │
└───────────────────────────────────────────────┬─────────────────────────────────────┘
                                                │ spawned detached
                                  torsgui-runner (one per running tournament)
                                                │ one process per game, confined to a node
                                     fastchess ── engine A, engine B
```

## Crates

| Crate | Role |
|---|---|
| `crates/torsgui-core` | All logic. Modules: `topology`/placement in `platform`, `runner`, `scheduler`, `fastchess`, `pgn`, `engines`, `assets` (asset selector), `github`, `ccrl`, `bench`, `stats`, `export`, `forum`, `tc`, `names`, `store`, `live`, `health`, `maintenance`, `legacy`, `analysis`, `api`. |
| `crates/torsgui-runner` | The detached runner executable (`run`, `resume`, `status`). |
| `crates/torsgui-server` | HTTP server exposing the same API and the web UI (development, Playwright, future remote view). |
| `crates/mock-uci` | Test engine: legal moves with configurable strength, crash, hang, slow start, illegal move. |
| `src-tauri` | Desktop shell: one `api` command, tray icon, runner sidecar, auto-resume at start. |
| `ui` | React UI; `ui/src/bindings` are generated from the Rust types with ts-rs (`node ui/scripts/bindings.mjs`). |

## State and processes

- **SQLite** (`torsgui.db`, WAL, busy timeout) holds settings, the engine library, aliases,
  CCRL lists, bench history, events, and tournaments (configuration, state, desired state,
  queue position, retries, heartbeat and the runner's live status JSON).
- **PGN files** in `tournaments/<id>/pgn/` are the source of truth for finished games. Each
  lane appends to its own file (`node<P>_lane<L>.pgn`); the Event tag carries the slot
  (`… node<P> pass<p> r<r>`), exactly like the old scripts, so dedupe, export and the legacy
  tools keep working.
- **Runner**: `torsgui-runner run --workspace W --id ID`. It takes an exclusive OS file lock on
  `tournaments/<id>/runner.lock` (released by the OS even on a crash: the GUI detects live
  runners by trying the lock), marks the tournament running, and loops:
  1. scan the PGNs (incrementally) → finished slots;
  2. build the queue of missing slots (lagging pairings first) — `scheduler`;
  3. start one thread per lane; each lane takes the next slot (own partition first, then
     work stealing so no lane idles at the end), spawns fastchess confined to its CPU set,
     polls the `desired` column (pause/stop), checks the placement after 2 s, applies a
     watchdog, and after the game rescans its PGN to see whether the slot was recorded
     (otherwise the slot is re-queued, bounded attempts);
  4. every 2 s a heartbeat writes the status (lanes, jobs, placement, progress samples,
     warnings) and turns abnormal terminations into events.
  At the end: pause/stop → paused/stopped, no chaining; clean end with all games →
  completed, then the next queued tournament runs in the same process; clean end with games
  missing → retry (bounded) → incomplete (the queue stops).
- **Placement**: `platform::Os` has two implementations. Windows: `CreateProcess` suspended
  (`CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`), a Job Object per game with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and `JobObjectGroupInformationEx` (group + mask),
  assignment, `NtResumeProcess`; killing = `TerminateJobObject`; verification =
  `QueryInformationJobObject`. Linux: `setsid` + `sched_setaffinity` in `pre_exec`,
  `PR_SET_PDEATHSIG` so a killed runner never leaves games behind, `killpg` to kill the tree,
  `sched_getaffinity` to verify. Detached runners: `DETACHED_PROCESS |
  CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB` (fallback without breakaway) on
  Windows, `setsid` on Linux; optional Task Scheduler launch through a CRLF `.bat`.
- **GUI ↔ runner**: only through the database (desired state, status, events) and the lock.
  The GUI never owns a tournament process.

## API

`App::call(cmd, args)` dispatches ~70 commands (tournaments, queue, games, live, export,
forum, engines, GitHub, CCRL, bench, TC, logs, maintenance). Results are the ts-rs types.
Events are polled (`events_since`) for toasts. Live data are read from the runner status plus
an incremental tail of the current game's fastchess log (`live::LiveTracker`).

## Statistics

`stats::standings` computes, from the seed's point of view and after dedupe: per-opponent
W/D/L, score, %, Elo diff ± 95 % (same formula as `merge_results.py`), White/Black counts,
terminations, colour-pair check, durations, decisive games, performance (average opponent
rating + Elo of the score). The Elo module is the `EloEstimator` trait; `LogisticMle` solves
the 1-vs-1 logistic likelihood for the non-anchored players with the list ratings as anchors
and reports 95 % intervals from the Fisher information. Ordo-like or BayesElo estimators can
be added as other implementations.

## Tests

- Unit tests next to the code (scheduler and opening offsets, queue ordering and work
  stealing, dedupe, PGN splitting, colour pairs, asset selector with real asset names and
  traps, name matcher, TC calculator, CCRL parsing and estimates, bench parsing and guards,
  live log tail, PGN viewer, Windows/Linux placement planning).
- `crates/torsgui-core/tests/verification.rs`: §9 acceptance on the real CCRL_ScirptsTests data
  and byte-compatibility with `export_ccrl.py`.
- `crates/torsgui-core/tests/bench.rs`: real Stockfish 10 bench.
- `crates/torsgui-runner/tests/integration.rs`: real runner + real fastchess + mock engines:
  full run, runner killed mid-game then resumed, pause, chain of two, manual stop never starts
  the next, bounded retries, crashing/illegal/hanging/slow engines.
- `ui/src/**/*.test.tsx`: component tests (Vitest + Testing Library).
- `ui/e2e/smoke.spec.ts`: Playwright smoke test of the main flows on the real backend;
  `ui/e2e/screenshots.spec.ts` produces `docs/screenshots`.
