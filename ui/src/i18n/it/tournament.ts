import type { Shape } from "../types";
import type { tournament as en } from "../en/tournament";

export const tournament: Shape<typeof en> = {
  unqueue: "Togli dalla coda",
  unqueueTip: "Toglilo dalla coda: torna com'era prima (bozza, oppure in pausa / fermato con le sue partite, pronto per riprendere).",
  unqueued: "{name} tolto dalla coda",
  kind: {
    gauntlet: "gauntlet",
    multi_gauntlet: "gauntlet a più seed",
    round_robin: "girone all'italiana",
    match: "match",
    swiss: "svizzero",
    knockout: "eliminazione diretta",
  },
  openingMode: {
    paired: "ogni apertura con entrambi i colori",
    random: "un'apertura casuale per partita",
  },
  wizardSub: {
    paired: "Ogni apertura si gioca due volte a colori invertiti; le aperture sono divise in blocchi separati per nodo, passata e accoppiamento.",
    random: "Ogni partita ha la sua apertura, scelta a caso dal libro; i due motori di una coppia giocano comunque con entrambi i colori.",
  },
  pairs: {
    title: "Coppie di colori",
    allPaired: "Ogni apertura giocata con entrambi i colori.",
    openPaired: { one: "{count} apertura giocata finora con un solo colore", other: "{count} aperture giocate finora con un solo colore" },
    allRandom: "Tutte le coppie complete: i due motori hanno giocato con entrambi i colori (un'apertura casuale per partita).",
    openRandom: { one: "{count} coppia in attesa della partita a colori invertiti", other: "{count} coppie in attesa della partita a colori invertiti" },
    randomAbout: "Con le aperture casuali una coppia sono gli stessi due motori a colori invertiti, ogni partita con la sua apertura: il numero scende man mano che finiscono le seconde partite.",
  },
  openings: {
    aboutPaired: "Ogni apertura è giocata due volte dagli stessi due motori a colori invertiti (una coppia). “White both”: il Bianco ha vinto entrambe le partite, quindi l'apertura decide il risultato più dei motori. “Sweep”: lo stesso motore ha vinto entrambe le partite.",
    aboutRandom: "Un'apertura casuale per partita: un'apertura non viene rigiocata a colori invertiti, quindi “White both” e “Sweep” contano solo le poche aperture che il sorteggio ha scelto due volte. La tabella mostra com'è andata ogni apertura.",
  },
};
