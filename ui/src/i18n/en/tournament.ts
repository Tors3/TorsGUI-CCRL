/** A tournament: its conditions, colour pairs and openings. */
export const tournament = {
  unqueue: "Unqueue",
  unqueueTip: "Take it out of the queue: it goes back to how it was before (a draft, or paused / stopped with its games, ready to resume).",
  unqueued: "{name} taken out of the queue",
  kind: {
    gauntlet: "gauntlet",
    multi_gauntlet: "multi gauntlet",
    round_robin: "round robin",
    match: "match",
    swiss: "swiss",
    knockout: "knockout",
  },
  openingMode: {
    paired: "each opening with both colours",
    random: "one random opening per game",
  },
  wizardSub: {
    paired: "Every opening is played twice with colours reversed; openings are split into disjoint blocks per node, pass and pairing.",
    random: "Every game gets its own opening, picked at random from the book; the two engines of a pair still play both colours.",
  },
  pairs: {
    title: "Colour pairs",
    allPaired: "Every opening played with both colours.",
    openPaired: { one: "{count} opening played with only one colour so far", other: "{count} openings played with only one colour so far" },
    allRandom: "Every pair complete: the two engines played both colours (one random opening per game).",
    openRandom: { one: "{count} pair waiting for the colour-reversed game", other: "{count} pairs waiting for the colour-reversed game" },
    randomAbout: "With random openings a pair is the same two engines with colours reversed, each game with its own opening: the count falls as the second games end.",
  },
  openings: {
    aboutPaired: "Every opening is played twice by the same two engines with colours reversed (a pair). “White both”: White won both games, so the opening decides the result more than the engines. “Sweep”: the same engine won both games.",
    aboutRandom: "One random opening per game: an opening is not played again with colours reversed, so “White both” and “Sweep” only count the few openings the draw picked twice. The table shows how each opening went.",
  },
};
