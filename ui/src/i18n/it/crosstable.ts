import type { Shape } from "../types";
import type { crosstable as en } from "../en/crosstable";

/** Crosstables: every player against every other (tournament page, Games). */
export const crosstable: Shape<typeof en> = {
  title: "Tabella incrociata",
  open: "Tabella incrociata",
  openTip: "Ogni giocatore contro ogni altro, da queste partite: copiala per il forum o salvala come file di testo o pagina web",
  copy: "Copia",
  copyForum: "Copia per il forum",
  copyForumTip: "La tabella come testo dentro [code] … [/code], pronta da incollare in un post del forum",
  saveTxt: "Salva .txt",
  saveHtml: "Salva come pagina web",
  copied: "Tabella incrociata copiata",
  copiedForum: "Tabella incrociata copiata, in [code] per il forum",
  saved: "Salvata: {path}",
  empty: "Ancora nessuna partita finita.",
  engine: "Motore",
  rating: "Rating",
  score: "Punti",
  wdl: "V/P/S",
  wdlTip: "Vittorie / patte / sconfitte",
  sbTip: "Sonneborn-Berger: i punti fatti contro ogni avversario per i punti di quell'avversario. Decide le parità di punti.",
  perf: "Perf",
  perfTip: "Performance: rating medio degli avversari incontrati + la differenza Elo del punteggio (solo quando tutti gli avversari incontrati hanno un rating)",
  cellTip: "{a} contro {b}: {points}/{games} ({results})",
  legend: "{games} partite · ordinati per punti, poi Sonneborn-Berger · {cells} · colonne numerate come la classifica",
  cellsResults: "1 vittoria, = patta, 0 sconfitta, nell'ordine in cui sono state giocate",
  cellsScore: "punti / partite contro ogni avversario",
};
