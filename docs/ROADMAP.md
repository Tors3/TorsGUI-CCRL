# Roadmap

Ideas and known weak spots for the next releases.

## Sound (needs a lot of work)

The move sound is a short noise burst through a band-pass filter, synthesised with WebAudio
(`playMove` in `ui/src/lib/boardPrefs.ts`): it sounds artificial and thin.

- Real recorded sounds (a wooden piece placed on a board), bundled with a free licence.
- Distinct sounds for move, capture, check, castling, promotion, game end and low time.
- A sound set to choose in Settings → Appearance (e.g. wood, soft, none) and a volume control.
- No overlapping or clipping when moves come fast (live games, replay at high speed).

## Resizable board

The board has a fixed size (the game viewer only has the theater mode, `t`; Play vs engine,
Live and analysis have nothing).

- A resize grip in the bottom-right corner of the board (the diagonal arrow of a Windows
  window): dragging it makes the board larger or smaller, up to the whole screen.
- The same on every page with a board (game viewer, Play vs engine, Live, analysis), the size
  remembered per page.
- A full-screen button next to it.
- Play vs engine: on a wide screen the move list stretches across the whole page (the black
  moves end up on the far right); it should stay a compact column next to the board.
