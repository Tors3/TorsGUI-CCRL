import type { Shape } from "../types";
import type { help as en } from "../en/help";

/** Help: the in-app guide (the guide itself is in English). */
export const help: Shape<typeof en> = {
  title: "Aiuto",
  sub: "La guida dentro TorsGUI (funziona anche offline) · ogni schermata ha un pulsante ? che apre la sua sezione",
  start: "Per iniziare",
  guide: "Guida",
  file: "File torneo",
  contents: "Indice",
  search: "Cerca nella guida",
  noMatch: "Nessuna sezione parla di “{q}”.",
  englishOnly: "La guida per ora è in inglese: la traduzione arriverà più avanti.",
  forScreen: "Aiuto per questa schermata",
  books: {
    installed: "{count} libri di aperture installati",
    defaultSet: " · predefinito: {file}",
    install: "Installa i libri di aperture CCRL",
    none: "Questa installazione non include libri.",
    defaultBook: "Libro predefinito: {file}",
    reinstall: "Reinstalla i libri",
    installAll: "Installa tutti i libri",
    into: "in ",
    about: " · i libri PGN li usa fastchess, i libri CGB sono per le altre GUI",
    book: "Libro",
    fileCol: "File",
    positions: "Posizioni",
    description: "Descrizione",
    isDefault: "predefinito",
    useDefault: "Usa come predefinito",
  },
};
