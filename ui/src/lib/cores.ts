import type { LanePlan } from "../bindings/LanePlan";
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
 * What one logical CPU is doing in the plan:
 * - `game`: only the game `lane` (fixed CPUs per game);
 * - `shared`: every game of the node may run there;
 * - `free`: allowed but no game was given it;
 * - `off`: the second hardware thread of a core, left out (physical cores only);
 * - `os`: no limits, the system decides.
 */
export type CellState = "game" | "shared" | "free" | "off" | "os";
export type Cell = { id: number; state: CellState; lane?: number };
export type CoreCells = { core: number; cells: Cell[] };
export type NodeMap = { node: number; cores: CoreCells[]; fit: number };

/** The picture of the CPUs of each node: one entry per physical core, its hardware threads inside. */
export function cpuMap(topo: Topology, nodes: number[], smt: boolean, placement: Placement, plans: LanePlan[]): NodeMap[] {
  return nodes.map((node) => {
    const cpus = topo.cpus.filter((c) => c.node === node).sort((a, b) => a.group - b.group || a.core - b.core || a.smt - b.smt);
    const pool = cpus.filter((c) => smt || c.smt === 0);
    const mine = plans.filter((p) => p.node === node);
    // a lane whose set is the whole pool did not get CPUs of its own (not enough of them)
    const whole = (p: LanePlan) => (p.cpuset?.cpus.length ?? 0) >= pool.length && mine.length > 1;
    const owner = new Map<number, number>();
    let fit = 0;
    if (placement === "lane") {
      for (const p of mine) {
        if (!p.cpuset || whole(p)) continue;
        fit++;
        for (const id of p.cpuset.cpus) owner.set(id, p.lane);
      }
    }
    const cores = new Map<number, Cell[]>();
    for (const c of cpus) {
      let cell: Cell;
      if (placement === "none") cell = { id: c.id, state: "os" };
      else if (!smt && c.smt > 0) cell = { id: c.id, state: "off" };
      else if (placement === "node") cell = { id: c.id, state: "shared" };
      else if (owner.has(c.id)) cell = { id: c.id, state: "game", lane: owner.get(c.id) };
      else cell = { id: c.id, state: fit < mine.length ? "shared" : "free" };
      cores.set(c.core, [...(cores.get(c.core) ?? []), cell]);
    }
    return { node, cores: [...cores].map(([core, cells]) => ({ core, cells })), fit: placement === "lane" ? fit : mine.length };
  });
}

/** A distinct colour for game `n` (0-based), readable on dark and light themes. */
export const gameColor = (n: number) => `hsl(${(n * 137.5 + 200) % 360} 62% 52%)`;
