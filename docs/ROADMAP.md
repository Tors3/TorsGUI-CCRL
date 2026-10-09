# Roadmap

Ideas and known weak spots for the next releases.

## Sound (needs a lot of work)

The move sound is a short noise burst through a band-pass filter, synthesised with WebAudio
(`playMove` in `ui/src/lib/boardPrefs.ts`): it sounds artificial and thin.

- Real recorded sounds (a wooden piece placed on a board), bundled with a free licence.
- Distinct sounds for move, capture, check, castling, promotion, game end and low time.
- A sound set to choose in Settings → Appearance (e.g. wood, soft, none) and a volume control.
- No overlapping or clipping when moves come fast (live games, replay at high speed).
