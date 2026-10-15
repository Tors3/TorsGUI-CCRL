import type { Shape } from "../types";
import type { uci as en } from "../en/uci";

/** The UCI options editor (option names and values stay as the engine declares them). */
export const uci: Shape<typeof en> = {
  declared: "{count} opzioni dichiarate dal motore · {set} impostate · vuoto = il valore predefinito del motore. Thread e Hash vengono dal torneo.",
  find: "Cerca un'opzione",
  option: "Opzione",
  valueSent: "Valore inviato",
  engineDefault: "Predefinito del motore",
  autoSends: "vuoto: TorsGUI invia ",
  tournamentSyzygy: "il percorso Syzygy del torneo",
  settingsPaths: "Impostazioni → Percorsi",
  reset: "ripristina {name}",
  resetTip: "torna al valore predefinito del motore",
  unknown: "Le opzioni del motore non sono ancora note (verificalo per leggerle): scrivile qui sotto.",
  other: "Altre opzioni (non dichiarate dal motore)",
  options: "Opzioni",
  add: "Aggiungi opzione",
  namePlaceholder: "Nome (es. EvalFile)",
  valuePlaceholder: "Valore (es. nets/my-net.nnue)",
  extraName: "nome dell'opzione extra {n}",
  extraValue: "valore dell'opzione extra {n}",
  removeExtra: "togli l'opzione extra {n}",
  relative: "I percorsi relativi dei file si leggono dalla cartella del motore: ",
  default: "(predefinito: {value})",
};
