import type { Shape } from "../types";
import type { live as en } from "../en/live";

/** Live: the games being played, a mini board per lane and the big view. */
export const live: Shape<typeof en> = {
  title: "Live",
  sub: "{busy} partite in corso su {lanes} lane · log dei motori letti man mano",
  empty: "Nessun torneo in corso. Le partite in corso compaiono qui con una mini scacchiera per lane.",
  nodeLane: "nodo {node} · lane {lane}",
  move: "mossa {n} · {last}",
  start: "inizio",
  idle: "ferma",
  nodes: "{n} nodi",
  arrows: "freccia verde: la mossa migliore del motore che muove · blu: la risposta che si aspetta",
  evalTitle: "Valutazione (dal lato del Bianco) — entrambi i motori",
  white: "Bianco",
  black: "Nero",
  timeTitle: "Tempo per mossa (s)",
};
