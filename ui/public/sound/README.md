# Sounds

| Files | Source | Author | Licence |
| --- | --- | --- | --- |
| `wood/` (from impactWood_light, impactWood_medium, impactWood_heavy) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney (www.kenney.nl) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `soft/` (from drop_002–004) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (www.kenney.nl) | CC0 1.0 |

The original OGG files were trimmed to their onset, filtered (high-pass, a little presence for
the wood), faded out, normalised and saved as 16-bit mono WAV by `make_sounds.cjs`. The game sounds of a
set (check, promote, end, lowtime) are made from that set's own sounds, layered at other pitches,
so that each set sounds of one material. To render them again:
`node make_sounds.cjs <folder with the unzipped packs: impact/, iface/> <output folder>`.

The "Classic" set has no files: it is synthesised in `src/lib/sound.ts`.
