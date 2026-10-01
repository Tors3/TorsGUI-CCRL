# Engines bundled with TorsGUI

The installers carry these engines so that a new installation can bench the machine and play
a first tournament without downloading anything (Getting started → *Add the bundled
engines*, or Engines → *Bundled engines*). They are copied to the engines folder and verified
like any other engine. The binaries are added by the CI when the bundles are built; this
folder in the repository only holds the list (`bundled.json`).

| Engine | Files | Licence | Source |
|---|---|---|---|
| Stockfish 10 | official Windows builds `stockfish_10_x64[_popcnt,_bmi2].exe` (from CCRL_ScirptsTests, sha256 checked); on Linux built from the `sf_10` sources | GPL-3.0 | https://github.com/official-stockfish/Stockfish/tree/sf_10 |
| Triumviratus 7.0 | `Triumviratus_7.0_avx2.exe`, the AVX2 asset of the v7.0 release (network embedded, sha256 checked) | GPL-3.0 | https://github.com/Tors3/Triumviratus/tree/v7.0 |

Both are free software under the GNU GPL v3: the complete corresponding source code of each
binary is available at the tagged source above.
