import type { Placement } from "../bindings/Placement";
import type { Topology } from "../bindings/Topology";

/** The CPUs the games may use on `nodes`: physical cores, or every hardware thread with SMT (mirrors `Topology::cpu_budget`). */
export function cpuBudget(topo: Topology, nodes: number[], smt: boolean): number {
  return nodes.reduce((sum, id) => {
    const n = topo.nodes.find((x) => x.id === id);
    return sum + (n ? (smt ? n.logical_cpus : n.physical_cores) : 0);
  }, 0);
}

/** Games per node that fit without sharing: CPUs of the node ÷ CPUs of a game (at least 1). */
export function suggestedLanes(topo: Topology, node: number, laneCpus: number, smt: boolean): number {
  return Math.max(1, Math.floor(cpuBudget(topo, [node], smt) / Math.max(1, laneCpus)));
}


/**
 * A tournament on the map: its games, the nodes of its opening blocks, the CPUs a game is given
 * (`laneCpus`, both engines) and the threads that work at once (`active`: ponder is off, so only
 * the engine to move thinks; the heavier engine of the game).
 */
export type LoadItem = { key: string; name: string; nodes: number[]; lanes: number; laneCpus: number; active: number; smt: boolean; placement: Placement; ponder?: string[] };
/** One logical CPU: the tournament (index in the items) and game (1-based, per tournament) it is given. */
export type LoadCell = { id: number; smt: number; item?: number; game?: number };
export type LoadNode = { node: number; cores: { core: number; cells: LoadCell[] }[]; over: { item: number; cpus: number }[]; smtUsed: boolean };

/**
 * The threads working at once, node by node: one engine per game thinks (ponder is off), so each
 * game counts the threads of its heavier engine. The tournaments in order, each game given the
 * next free CPUs. Fixed CPUs per game ("lane") take whole cores, as the runner
 * gives them; otherwise the system spreads the threads one per core first and uses the second
 * thread of a core only when every core is busy, and moves them inside the node, so this is
 * each game's share, not where its threads are at a given moment. Without SMT only the first
 * thread of each core is used. CPUs a node lacks are counted in `over`.
 */
export function loadMap(topo: Topology, items: LoadItem[]): LoadNode[] {
  const used = new Set<number>();
  const owner = new Map<number, { item: number; game: number }>();
  const over = new Map<number, Map<number, number>>();
  items.forEach((it, i) => {
    let game = 0;
    for (const node of it.nodes) {
      const wholeCores = it.placement === "lane";
      const cpus = topo.cpus.filter((c) => c.node === node).sort((a, b) => (wholeCores ? 0 : a.smt - b.smt) || a.group - b.group || a.core - b.core || a.smt - b.smt);
      for (let l = 0; l < it.lanes; l++) {
        game++;
        let need = it.active;
        for (const c of cpus) {
          if (need === 0) break;
          if (used.has(c.id) || (!it.smt && c.smt > 0)) continue;
          used.add(c.id);
          owner.set(c.id, { item: i, game });
          need--;
        }
        if (need > 0) {
          const m = over.get(node) ?? new Map<number, number>();
          m.set(i, (m.get(i) ?? 0) + need);
          over.set(node, m);
        }
      }
    }
  });
  return topo.nodes.map((n) => {
    const cores = new Map<number, LoadCell[]>();
    for (const c of topo.cpus.filter((x) => x.node === n.id).sort((a, b) => a.group - b.group || a.core - b.core || a.smt - b.smt)) {
      const o = owner.get(c.id);
      cores.set(c.core, [...(cores.get(c.core) ?? []), { id: c.id, smt: c.smt, item: o?.item, game: o?.game }]);
    }
    const all = [...cores.values()].flat();
    return { node: n.id, cores: [...cores].map(([core, cells]) => ({ core, cells })), over: [...(over.get(n.id) ?? new Map())].map(([item, cpus]) => ({ item, cpus })), smtUsed: all.some((c) => c.smt > 0 && c.item != null) };
  });
}

/** The hue of tournament `n` on the load map: well apart from the next ones. */
const tournamentHue = (n: number) => (n * 137.5 + 160) % 360;
/** Game `game` (1-based) of tournament `n`: a shade of the tournament's colour, lighter and darker in turn. */
export const gameShade = (n: number, game: number) => `hsl(${tournamentHue(n)} 55% ${[48, 62, 38, 70, 55, 42][(game - 1) % 6]}%)`;
