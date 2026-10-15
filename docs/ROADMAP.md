# Roadmap

Ideas and known weak spots for the next releases.

Done in 0.7.4: recorded sounds with a set and a volume to choose, and the resizable board with
full screen.

## To implement (0.7.6)

- **Test suites: a running number** (1–183) next to the original id of each position: the id
  keeps the numbering of the source collection, so IQ4 (ids 1–201 with 18 gaps) looks like 201
  positions.
- **Sounds on by default** (Wood set): today they are off until "Sounds" is ticked.

- **Pieces facing their own side (option)**: today every piece is drawn upright, so White's and
  Black's pawns all "point" up the screen, also on a flipped board (as in Lichess, Arena and Cute
  Chess). An option in the board settings to turn the pieces of the side at the top by 180°, so
  that the pawns of the two sides face each other, as seen from above on a real board.

- **Number of games in progress next to "Live"** in the sidebar (a small badge, e.g. "Live 4"),
  updated as games start and end; nothing when no game is being played.

- **"Unqueue" button** next to a queued tournament (the opposite of *Queue*): the backend command
  `queue_remove` exists, the button does not. It should give the tournament back its previous
  state (paused or stopped when it already has games), not always "draft" as `queue_remove` does
  today, so that it still shows *Resume*.

- **Random openings: wrong texts** (Gabor). With "one random opening per game" the games are
  right (every opening is used once), but the texts still speak of openings played with both
  colours:
  - the *Colour pairs* panel of the tournament (`ui/src/pages/TournamentDetail.tsx`) says
    "Every opening played with both colours" in green, and while games are in progress
    "N opening(s) played with only one colour so far". With random openings a "pair" is the
    same two engines with colours reversed, each game with its own opening: say "N pair(s)
    waiting for the colour-reversed game" (it falls as the second games end, which is why Gabor
    saw 4, then 1);
  - the CCRL checklist (`crates/torsgui-core/src/checklist.rs`): "Opening book … each opening
    with both colours" and "Every opening with both colours" need the same wording;
  - show the opening mode in the tournament's conditions ("one random opening per game" or
    "each opening with both colours"), so that it can be checked after the start.

- **Clearer cores / concurrency panel** (wizard step *NUMA & lanes* and the *Summary* beside it,
  `ui/src/pages/Wizard.tsx`). Today it shows nodes, "Lanes per node", a placement switch
  ("Node (1 thread / core)", "Disjoint cores per lane", "None") and in the summary "Concurrent
  games" and "Cores: N busy / M physical", without saying how they relate. To do:
  - one line that spells it out: "L lanes × N nodes = G games at the same time; each engine
    T threads → B busy cores of M physical";
  - name things by what they do ("games at the same time" rather than lanes / concurrency) and
    explain each placement option in a sentence;
  - a small picture of the cores: which cores each game / engine uses, free cores, and red when
    more threads than physical cores (the engines would share cores and play weaker);
  - the suggested number of lanes as a button ("use 4"), not only as a hint.

## To verify on an installed build

- **Full screen in the desktop app**: the board button should make the Windows / Linux window
  itself full screen, and Esc should bring it back.
- **Board resize grip**: dragging it should never make the board taller than the window.
- **A cup decided by seed in 0.7.4 or earlier** (Mark Tang's final, 4–4 after 3 tiebreaks):
  after the update the match shows as open and *Resume* plays only the missing tiebreaks.

## Sound, next steps

- More sets (e.g. a heavier tournament board, plastic pieces) and a few takes of castling and
  check recorded rather than layered.
