import type { Shape } from "../types";
import type { logs as en } from "../en/logs";

/** Logs: events and log files. */
export const logs: Shape<typeof en> = {
  title: "Log",
  sub: "Eventi dei runner e dell'app, log dei runner e log di fastchess per ogni partita",
  tournament: "Torneo",
  allTournaments: "Tutti i tornei",
  levels: { all: "Tutti", error: "Errori", warn: "Avvisi", success: "Riusciti", info: "Info" },
  events: { one: "{count} evento", other: "{count} eventi" },
  time: "Ora",
  level: "Livello",
  kind: "Tipo",
  message: "Messaggio",
  none: "Nessun evento.",
  files: "File di log",
  select: "Scegli un file (vengono mostrati e aggiornati gli ultimi 96 KB).",
};
