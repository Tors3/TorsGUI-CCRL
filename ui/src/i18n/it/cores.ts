import type { Shape } from "../types";
import type { cores as en } from "../en/cores";

export const cores: Shape<typeof en> = {
  step: "Core e partite",
  title: "Core e partite contemporanee",
  machine: "{cpu} · {cores} core, {threads} thread",
  machineNodes: "{cpu} · {cores} core, {threads} thread · {nodes} nodi NUMA",

  pool: {
    label: "Quali CPU possono usare i motori",
    physical: "Solo core fisici",
    physicalAbout: "Un thread di motore per core, il secondo thread hardware di ogni core resta libero. È così che giocano le macchine CCRL: usalo per le partite da mandare al CCRL.",
    smt: "Tutti i thread (Hyper-Threading / SMT)",
    smtAbout: "Entrambi i thread hardware di ogni core: circa il doppio delle partite insieme. Due motori sullo stesso core si rallentano a vicenda, quindi ognuno calcola meno nodi al secondo: va bene per i tuoi test, non per il CCRL.",
    noSmt: "Questa CPU ha un thread per core (oppure Hyper-Threading / SMT è disattivato nel BIOS): le due scelte sono uguali.",
  },

  nodes: {
    label: "Nodi NUMA",
    about: "Questa macchina ha {count} nodi NUMA: gruppi di core, ognuno con la sua memoria. Ogni nodo gioca la sua parte delle aperture; un motore resta su un nodo, così la sua memoria è vicina.",
    node: "nodo {id}",
    nodeCpus: "{n} CPU",
  },

  games: {
    label: "Partite contemporanee",
    labelPerNode: "Partite contemporanee, per nodo",
    need: "Ogni partita usa {threads} thread: i suoi due motori ({a} + {b}).",
    needSame: "Ogni partita usa {threads} thread: due motori da {each} {eachUnit}.",
    useSuggested: "Usa {n}",
    suggestedTip: "{budget} {unit} ÷ {threads} thread per partita",
  },

  gpu: {
    label: "Schede video per i motori GPU",
    about: "{list} calcolano su una scheda video. Due partite sulla stessa scheda si rallentano a vicenda, quindi ogni scheda gioca una partita alla volta: la partita 1 sulla prima scheda spuntata, la partita 2 sulla successiva… I thread CPU del motore vengono comunque dal torneo (a Lc0 ne servono pochi).",
    noCards: "Nessuna scheda video trovata su questa macchina: i motori GPU useranno quello che dà il sistema.",
    card: "scheda {n}",
    shared: "{games} partite contemporanee, schede video: {cards}. I motori GPU dividono una scheda e calcolano più lentamente; una partita per scheda dà risultati ripetibili.",
    sharedNodes: "Almeno una partita per nodo NUMA: usa tanti nodi NUMA quante schede ({cards}) per avere una partita per scheda.",
  },

  placement: {
    label: "Come si distribuiscono le partite sulle CPU",
    node: "Condivise",
    nodeAbout: "Tutte le partite condividono le CPU scelte e il sistema sposta ogni motore tra queste dove c'è posto. I motori non usano mai le CPU escluse.",
    nodeNuma: "Bloccate al nodo NUMA",
    nodeNumaAbout: "Ogni partita è bloccata sulle CPU del suo nodo NUMA (il suo socket): dentro il nodo il sistema sposta i motori dove c'è posto, ma una partita non passa mai all'altro socket, così la sua memoria resta vicina. I motori non usano mai le CPU escluse.",
    lane: "CPU fisse per partita",
    laneAbout: "Ogni partita ha le sue CPU e nessun'altra partita le tocca: i tempi più ripetibili. Servono abbastanza CPU per tutte le partite.",
    laneNumaAbout: "Ogni partita ha le sue CPU dentro il suo nodo NUMA e nessun'altra partita le tocca: i tempi più ripetibili, e una partita non lascia mai il suo socket. Servono abbastanza CPU per tutte le partite.",
    none: "Nessun limite",
    noneAbout: "TorsGUI non limita niente: il sistema può usare anche i thread hardware che hai escluso. Solo per controllare un problema.",
    noneNumaAbout: "TorsGUI non limita niente: il sistema può spostare una partita sull'altro socket, lontano dalla sua memoria, e usare i thread hardware che hai escluso. Solo per controllare un problema.",
  },

  unit: {
    cores: { one: "core", other: "core" },
    threads: { one: "thread", other: "thread" },
  },

  sum: {
    title: "In breve",
    line: "{games} partite contemporanee × {threads} {threadsUnit} del motore che muove = {busy} {unit} occupati su {budget}",
    ponder: "Il ponder è spento: in ogni partita pensa solo il motore che deve muovere, l'altro aspetta.",
    ok: "Ogni motore ha i suoi {unit}.",
    over: "{over} {unit} di troppo: i motori si aspetterebbero a vicenda e giocherebbero peggio. Meno partite contemporanee, o meno thread.",
    smtShare: "Alcuni motori dividono un core fisico con un altro motore: calcolano più lentamente che da soli.",
  },

  map: {
    title: "Le CPU",
    legendGame: "partita {n}",
    legendMore: "… {count} partite in tutto",
    legendShared: "usate da tutte le partite",
    legendFree: "libere",
    legendOff: "escluse (secondo thread di un core)",
    legendOs: "decide il sistema",
    core: "core {n}",
    tooShort: "Non ci sono CPU per {games} partite da {threads} ciascuna: le partite oltre la {fit}ª condividono tutte le CPU del nodo.",
    noneNote: "Nessun limite: i motori possono girare su qualunque CPU, anche sui secondi thread.",
    noneNuma: "Nessun limite su una macchina con {count} nodi NUMA: le partite possono spostarsi da un socket all'altro, lontano dalla loro memoria, e calcolare più lentamente. Per i test veri scegli \"Bloccate al nodo NUMA\" o \"CPU fisse per partita\".",
  },

  summary: {
    games: "Partite contemporanee",
    cpus: "CPU",
    busy: "{busy} occupati / {budget} {unit}",
  },

  load: {
    title: "Carico delle CPU",
    socket: "socket {id}",
    inUse: "{used} di {total} CPU al lavoro",
    free: "libera",
    game: "{name} · partita {n}",
    thread: "core {core}, thread {k}",
    others: "altri tornei",
    over: "{cpus} thread in più delle CPU di questo nodo: i motori si dividono le CPU e rallentano",
    ponder: "{name}: il ponder è acceso per {engines}. Così pensano tutti e due i motori della partita insieme (la mappa li conta), i motori si rallentano a vicenda e le partite CCRL si giocano con il ponder spento: spegnilo nelle opzioni dei motori del torneo.",
    smtUsed: "Alcuni core fanno girare due thread di motori (Hyper-Threading): quei motori cercano più lentamente che da soli.",
    shareNote: "Il ponder è spento: in ogni partita pensa solo il motore che deve muovere, l'altro aspetta. Per questo la mappa conta i thread che lavorano nello stesso momento, quelli del motore più pesante di ogni partita, prima uno per core come li distribuisce il sistema; il secondo thread di un core si usa solo quando tutti i core sono occupati. Il sistema sposta i thread tra le CPU del nodo: l'immagine mostra quanti lavorano, non esattamente dove.",
    liveItem: "{name}: {games} partite, {threads} thread che pensano in ognuna",
    none: "Nessun torneo in corso.",
    thisTournament: "questo torneo",
    show: "Carico CPU",
  },
};
