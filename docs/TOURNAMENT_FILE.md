# Tournament files

A tournament file describes one tournament in a few lines of [TOML](https://toml.io). You can
write it yourself or ask an assistant such as Claude ("create a Blitz gauntlet of
Triumviratus 7.0 8CPU against 15 engines around its rating"), then import it in TorsGUI,
review what TorsGUI understood, and save it as a draft, add it to the queue or start it.

## Workflow

1. **Tournaments → Import file → Template for Claude** copies an annotated template. It holds
   the rules, your machine (NUMA nodes and cores), your default book and **the names of the
   engines in your library**. Give it to Claude together with your request.
2. Paste Claude's answer in the same dialog, or save it as `something.toml` in the
   workspace's `inbox` folder (listed at the top of the dialog), or load it from any path.
3. The right side shows the result: the engines matched in the library (exact, approximate,
   latest version, not found → with suggestions), total games, TC, threads/hash, nodes ×
   lanes, ETA, and every warning or error of the wizard (RAM, cores, hash rule, book…).
4. **Save as draft**, **Add to queue** or **Start now** (the file can suggest one with
   `after_import`). The tournament is created exactly as the wizard would create it; the
   file is kept next to it as `tournament.toml`.

Any tournament can be turned back into a file: **tournament page → As file** (to reuse it
with other engines, or to show Claude an example).

## Example

```toml
format = 1
kind = "gauntlet"
list = "Blitz"
seed = "Triumviratus 7.0"
opponents = [
  "Stockfish 17", "Obsidian 16.0", "Berserk 14", "Caissa 2.0", "Clover 9.0",
]
threads = 8
games_per_opponent = 30
passes = 1
after_import = "queue"
notes = "8CPU gauntlet for the Blitz list"

[options."Clover 9.0"]
Contempt = "0"
```

## Fields

| Field | Default | Meaning |
|---|---|---|
| `format` | 1 | file format version |
| `kind` | `gauntlet` | `gauntlet`, `multi_gauntlet`, `round_robin`, `match`, `swiss`, `knockout` (two or more `seed`s make a multi-seed gauntlet) |
| `list` | `Blitz` | CCRL list: `Blitz`, `40/15` or `FRC` (ratings, event name, default TC) |
| `variant` | by list | `standard` or `chess960` (default `chess960` for the FRC list); every engine must declare `UCI_Chess960`; without `book` all 960 start positions are generated |
| `seed` | — | the engine under test, or a list of engines |
| `opponents` | — | the opponents of a gauntlet |
| `engines` | — | the players of a round robin, a match, a Swiss or a knockout (instead of `seed`/`opponents`; Swiss and knockout seed them in this order) |
| `threads` | 1 | threads per engine |
| `hash_mb` | 512 × threads | hash per engine (Settings → hash per thread) |
| `tc` | computed | fastchess TC (`"103+1"`, `"40/900+10"`); by default the list's CCRL TC scaled by the machine factor of the settings, or by `factor` |
| `factor` | settings | machine factor used when `tc` is not given |
| `games_per_opponent` | 30 | games per pairing (games per match in a Swiss or knockout), even (each opening with both colours) |
| `passes` | 1 | split the openings into passes: stopping after a pass stays balanced; in a Swiss, the number of rounds |
| `nodes` | all | NUMA nodes (opening partitions); a short match uses fewer when there are fewer openings |
| `lanes_per_node` | cores / (2 × threads) | concurrent games per node |
| `placement` | `node` | `node`, `lane` or `none` |
| `book` | settings | opening book, absolute or relative to the books folder |
| `book_start` | 1 | first opening of the book |
| `syzygy` | settings | Syzygy path passed to engines |
| `event` | CCRL style | e.g. `CCRL Blitz gauntlet Triumviratus 7.0 8CPU` |
| `name` | event without `CCRL ` | name in TorsGUI |
| `site` | settings | PGN Site tag |
| `extra_args` | — | extra fastchess arguments |
| `[adjudication]` | settings | `draw`, `draw_movenumber`, `draw_movecount`, `draw_score`, `resign`, `resign_movecount`, `resign_score`, `resign_twosided` |
| `[options."<engine>"]` | — | UCI options for one engine (added to its library options) |
| `after_import` | `queue` | the button the import proposes: `draft`, `queue`, `start` |
| `notes` | — | shown in the import dialog |

Unknown fields are errors (a typo such as `opponent =` is reported, not ignored). A JSON
object with the same fields is accepted too.

## Engine names

Names are those of the engine library (**Engines**). Matching ignores case, spacing and
punctuation; a name without version (`"Stockfish"`) takes the latest version installed; a
small typo with one clear candidate is accepted and shown as *approximate*. Anything else is
an error with suggestions — nothing is downloaded or guessed silently. Add missing engines
first (**Engines → Add from GitHub**).
