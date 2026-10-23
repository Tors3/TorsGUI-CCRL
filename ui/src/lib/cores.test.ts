import { describe, expect, it } from "vitest";
import type { Topology } from "../bindings/Topology";
import { cpuBudget, loadMap, suggestedLanes, type LoadItem } from "./cores";

/** `nodes` nodes of `cores` cores with `smt` threads each (mirrors `platform::synthetic_topology`). */
function topo(nodes: number, cores: number, smt: number): Topology {
  const cpus = [];
  let core = 0;
  for (let n = 0; n < nodes; n++)
    for (let c = 0; c < cores; c++, core++) for (let t = 0; t < smt; t++) cpus.push({ id: n * 64 + c * smt + t, group: n, number: c * smt + t, core, smt: t, node: n, socket: n });
  return {
    cpu_model: "Test",
    vendor: "AuthenticAMD",
    sockets: nodes,
    physical_cores: nodes * cores,
    logical_cpus: nodes * cores * smt,
    groups: nodes,
    nodes: Array.from({ length: nodes }, (_, id) => ({ id, group: id, physical_cores: cores, logical_cpus: cores * smt, memory_mb: null })),
    cpus,
    caches: [],
    smt: smt > 1,
    source: "test",
    has_avx2: true,
    has_avx512: false,
    has_bmi2: true,
  };
}
const item = (key: string, nodes: number[], lanes: number, laneCpus: number, smt: boolean, placement: LoadItem["placement"] = "node"): LoadItem => ({ key, name: key, nodes, lanes, laneCpus, active: laneCpus / 2, smt, placement });

describe("cores and games", () => {
  const ryzen = topo(1, 8, 2);
  it("counts physical cores or every thread", () => {
    expect(cpuBudget(ryzen, [0], false)).toBe(8);
    expect(cpuBudget(ryzen, [0], true)).toBe(16);
    expect(cpuBudget(topo(2, 20, 2), [0, 1], false)).toBe(40);
    expect(suggestedLanes(ryzen, 0, 2, false)).toBe(4);
    expect(suggestedLanes(ryzen, 0, 2, true)).toBe(8);
    expect(suggestedLanes(ryzen, 0, 32, true)).toBe(1);
  });
  it("counts the engine that thinks: one per game, one thread per core first", () => {
    const xeon = topo(2, 20, 2);
    // Igel: 8 games of 2 × 4 threads on both sockets, 4 per socket: 16 threads working per socket
    const [s0, s1] = loadMap(xeon, [item("igel", [0, 1], 4, 8, true)]);
    expect(s0.cores.filter((c) => c.cells[0].item === 0)).toHaveLength(16);
    expect(s0.smtUsed).toBe(false);
    expect(s0.cores[4].cells[0].game).toBe(2);
    expect(s1.cores[0].cells[0].game).toBe(5);
    // 10 games: 40 threads on 40 cores, still no second thread
    const [full] = loadMap(xeon, [item("igel", [0, 1], 5, 8, true)]);
    expect(full.cores.every((c) => c.cells[0].item === 0 && c.cells[1].item == null)).toBe(true);
    expect(full.smtUsed).toBe(false);
  });
  it("the second threads only when every core is busy", () => {
    const [m] = loadMap(topo(1, 20, 2), [item("a", [0], 6, 8, true)]);
    expect(m.cores.every((c) => c.cells[0].item === 0)).toBe(true);
    expect(m.cores.filter((c) => c.cells[1].item === 0)).toHaveLength(4);
    expect(m.smtUsed).toBe(true);
  });
  it("fixed CPUs per game take whole cores", () => {
    const [m] = loadMap(topo(1, 20, 2), [item("a", [0], 2, 8, true, "lane")]);
    expect(m.cores[0].cells.map((c) => c.game)).toEqual([1, 1]);
    expect(m.cores[2].cells.map((c) => c.game)).toEqual([2, 2]);
    expect(m.cores[4].cells[0].item).toBeUndefined();
  });
  it("without Hyper-Threading one thread per core, the other left free", () => {
    const [m] = loadMap(ryzen, [item("a", [0], 2, 8, false)]);
    expect(m.cores[0].cells.map((c) => c.game)).toEqual([1, undefined]);
    expect(m.cores[4].cells[0].game).toBe(2);
    expect(m.over).toEqual([]);
  });
  it("other tournaments come first; threads beyond the CPUs are counted", () => {
    const [m] = loadMap(ryzen, [item("other", [0], 6, 4, true), item("mine", [0], 3, 4, true)]);
    expect(m.cores.flatMap((c) => c.cells).filter((c) => c.item === 0)).toHaveLength(12);
    expect(m.cores.flatMap((c) => c.cells).filter((c) => c.item === 1)).toHaveLength(4);
    expect(m.over).toEqual([{ item: 1, cpus: 2 }]);
  });
  it("both opening blocks on one socket", () => {
    const [s0, s1] = loadMap(topo(2, 20, 2), [item("igel", [1, 1], 2, 8, true)]);
    expect(s0.cores.flatMap((c) => c.cells).some((c) => c.item != null)).toBe(false);
    expect(s1.cores.filter((c) => c.cells[0].item === 0)).toHaveLength(16);
    expect(s1.smtUsed).toBe(false);
  });
});
