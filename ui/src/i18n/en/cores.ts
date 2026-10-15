/** New tournament → Cores & games: which CPUs the engines use and how many games run at once. */
export const cores = {
  step: "Cores & games",
  title: "Cores and games at the same time",
  machine: "{cpu} · {cores} cores, {threads} threads",
  machineNodes: "{cpu} · {cores} cores, {threads} threads · {nodes} NUMA nodes",

  pool: {
    label: "Which CPUs the engines may use",
    physical: "Physical cores only",
    physicalAbout: "One engine thread per core, the second hardware thread of each core stays free. This is how the CCRL machines play: use it for games you send to CCRL.",
    smt: "All threads (Hyper-Threading / SMT)",
    smtAbout: "Both hardware threads of each core: about twice the games at once. Two engines on the same core slow each other down, so each searches fewer nodes per second: fine for your own tests, not for CCRL.",
    noSmt: "This CPU has one thread per core (or Hyper-Threading / SMT is off in the BIOS): the two choices are the same.",
  },

  nodes: {
    label: "NUMA nodes",
    about: "This machine has {count} NUMA nodes: groups of cores, each with its own memory. Every node plays its own share of the openings; an engine stays on one node so that its memory is close.",
    node: "node {id}",
    nodeCpus: "{n} CPUs",
  },

  games: {
    label: "Games at the same time",
    labelPerNode: "Games at the same time, per node",
    need: "Each game needs {threads} threads: its two engines ({a} + {b}).",
    needSame: "Each game needs {threads} threads: two engines of {each} {eachUnit}.",
    useSuggested: "Use {n}",
    suggestedTip: "{budget} {unit} ÷ {threads} threads per game",
  },

  gpu: {
    label: "Graphics cards for the GPU engines",
    about: "{list} search on a graphics card. Two games on one card slow each other down, so each card plays one game at a time: game 1 on the first card ticked, game 2 on the next… The engine's CPU threads still come from the tournament (Lc0 needs few).",
    noCards: "No graphics card found on this machine: the GPU engines will use whatever the system gives them.",
    card: "card {n}",
    shared: "{games} games at the same time, graphics cards: {cards}. GPU engines share a card and search slower; one game per card gives repeatable results.",
    sharedNodes: "At least one game per NUMA node: use as many NUMA nodes as cards ({cards}) for one game per card.",
  },

  placement: {
    label: "How the games are placed on the CPUs",
    node: "Shared",
    nodeAbout: "All games share the chosen CPUs and the system moves each engine among them where there is room. Engines never use the CPUs left out.",
    nodeNuma: "Locked to its NUMA node",
    nodeNumaAbout: "Each game is locked to the CPUs of its NUMA node (its socket): inside the node the system moves the engines where there is room, but a game never crosses to the other socket, so its memory stays close. Engines never use the CPUs left out.",
    lane: "Fixed CPUs per game",
    laneAbout: "Each game gets its own CPUs and no other game touches them: the most repeatable timings. Needs enough CPUs for every game.",
    laneNumaAbout: "Each game gets its own CPUs inside its NUMA node and no other game touches them: the most repeatable timings, and a game never leaves its socket. Needs enough CPUs for every game.",
    none: "No limits",
    noneAbout: "TorsGUI does not restrict anything: the system may also use the hardware threads you left out. Only for checking a problem.",
    noneNumaAbout: "TorsGUI does not restrict anything: the system may move a game to the other socket, away from its memory, and use the hardware threads you left out. Only for checking a problem.",
  },

  unit: {
    cores: { one: "core", other: "cores" },
    threads: { one: "thread", other: "threads" },
  },

  sum: {
    title: "In short",
    line: "{games} games at the same time × {threads} {threadsUnit} of the engine to move = {busy} of {budget} {unit} busy",
    ponder: "Ponder is off: in each game only the engine to move thinks, the other waits.",
    ok: "Every engine has its own {unit}.",
    over: "{over} {unit} too many: engines would wait for each other and play weaker. Fewer games at the same time, or fewer threads.",
    smtShare: "Some engines share a physical core with another engine: they search slower than alone.",
  },

  map: {
    title: "The CPUs",
    legendGame: "game {n}",
    legendMore: "… {count} games in all",
    legendShared: "used by all games",
    legendFree: "free",
    legendOff: "left out (second thread of a core)",
    legendOs: "the system decides",
    core: "core {n}",
    tooShort: "Not enough CPUs for {games} games with {threads} each: the games beyond {fit} share all the CPUs of the node.",
    noneNote: "No limits: the engines may run on any CPU, including the second threads.",
    noneNuma: "No limits on a machine with {count} NUMA nodes: games may move between sockets, away from their memory, and search slower. Choose \"Locked to its NUMA node\" or \"Fixed CPUs per game\" for real tests.",
  },

  summary: {
    games: "Games at the same time",
    cpus: "CPUs",
    busy: "{busy} busy / {budget} {unit}",
  },
};
