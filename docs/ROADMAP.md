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

## To verify on an installed build

- **Full screen in the desktop app**: the board button should make the Windows / Linux window
  itself full screen, and Esc should bring it back.
- **Board resize grip**: dragging it should never make the board taller than the window.
- **A cup decided by seed in 0.7.4 or earlier** (Mark Tang's final, 4–4 after 3 tiebreaks):
  after the update the match shows as open and *Resume* plays only the missing tiebreaks.

## Sound, next steps

- More sets (e.g. a heavier tournament board, plastic pieces) and a few takes of castling and
  check recorded rather than layered.
