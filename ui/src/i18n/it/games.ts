import type { Shape } from "../types";
import type { games as en } from "../en/games";

/** Games: the archive of the tournaments and of other PGN files. */
export const games: Shape<typeof en> = {
  title: "Partite",
  sub: "{sources} fonti · {games} partite · rivedile con scacchiera, valutazione e orologi",
  add: "Aggiungi file PGN o cartella",
  added: "Aggiunto all'archivio",
  count: "{games} partite",
  files: " · {count} file",
  removeLabel: "Togli dall'archivio",
  empty: "Ancora nessuna partita. Qui compaiono le partite dei tuoi tornei; puoi anche aggiungere vecchi file PGN o cartelle (per esempio i tornei di CCRL_ScirptsTests).",
  sources: "Fonti",
  search: "Cerca",
  searchLabel: "Cerca tra le fonti",
  tournaments: "Tornei",
  pgnFiles: "File PGN",
  addTitle: "Aggiungi un file PGN o una cartella all'archivio",
  addBtn: "Aggiungi",
  addAbout: "Le partite fuori dall'area di lavoro vengono solo lette, mai modificate. Una cartella aggiunge ogni file .pgn che contiene direttamente.",
};
