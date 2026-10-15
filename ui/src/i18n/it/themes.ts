import type { Shape } from "../types";
import type { themes as en } from "../en/themes";

export const themes: Shape<typeof en> = {
  system: { label: "Sistema", about: "Scuro o chiaro, come il sistema operativo" },
  paper: { label: "Carta", about: "Il predefinito: sobrio e caldo, carta avorio con un accento blu inchiostro" },
  dark: { label: "Scuro", about: "Grigio-blu scuro con un accento blu" },
  light: { label: "Chiaro", about: "Luminoso, per la luce del giorno" },
  graphite: { label: "Grafite", about: "Sobrio: grigi neutri, un accento color acciaio" },
  nord: { label: "Nord", about: "Blu artici freddi (palette Nord)" },
  midnight: { label: "Mezzanotte", about: "Nero puro, per schermi OLED e stanze buie" },
  forest: { label: "Bosco", about: "Verde scuro, riposante per le sessioni lunghe" },
  coffee: { label: "Caffè", about: "Marroni espresso, testo color crema e un accento caramello" },
  szots: {
    label: "Szőts",
    about: "Fatto per Gabor Szőts, che ha provato TorsGUI versione dopo versione e ha segnalato tutto quello che serviva o mancava. Grazie, Gabor! Crema calda e ambra come il suo amato aspetto di Arena; si abbina alla scacchiera in legno Szőts",
  },
  basti: {
    label: "Bastiii",
    about: "Fatto per Bastiii (Bastiball21), che prova TorsGUI, ci organizza tornei e ha mandato le idee per molti miglioramenti. Grazie, Bastiii! Panno verde scuro da tavolo da gioco con un filo d'ottone; si abbina alla scacchiera Bastiii felt",
  },
  contrast: { label: "Alto contrasto", about: "Bianco e nero con bordi marcati" },
};
