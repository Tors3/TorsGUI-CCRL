# Roadmap

Ideas and known weak spots for the next releases.

Done in 0.7.4: recorded sounds with a set and a volume to choose, and the resizable board with
full screen.

## To implement (0.7.6)

- **Test suites: a running number** (1–183) next to the original id of each position: the id
  keeps the numbering of the source collection, so IQ4 (ids 1–201 with 18 gaps) looks like 201
  positions.
- **Sounds on by default** (Wood set): today they are off until "Sounds" is ticked.
- **Rank numbers (1–8) badly placed**: they sit cramped against the left edge and do not line
  up well with their squares (seen on the Szőts wood board, flipped, in Test suites). The files
  were fixed in 0.7.3, the ranks were not. Idea: draw the coordinates on the board's wooden frame
  (outside the squares, as on a real board), or in the board image itself, instead of chessground's
  text over the squares; with the flipped board they must follow the orientation.

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

## To verify on an installed build

- **Full screen in the desktop app**: the board button should make the Windows / Linux window
  itself full screen, and Esc should bring it back.
- **Board resize grip**: dragging it should never make the board taller than the window.
- **A cup decided by seed in 0.7.4 or earlier** (Mark Tang's final, 4–4 after 3 tiebreaks):
  after the update the match shows as open and *Resume* plays only the missing tiebreaks.

## Sound, next steps

- More sets (e.g. a heavier tournament board, plastic pieces) and a few takes of castling and
  check recorded rather than layered.
