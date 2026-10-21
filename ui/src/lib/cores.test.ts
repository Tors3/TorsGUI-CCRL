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
const item = (key: string, nodes: number[], lanes: number, laneCpus: number, smt: boolean, placement: LoadItem["placement"] = "node"): LoadItem => ({ key, name: key, nodes, lanes, laneCpus, smt, placement });

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
  it("the system spreads the threads one per core before the second threads", () => {
    const xeon = topo(2, 20, 2);
    const [m] = loadMap(xeon, [item("mock", [0], 2, 8, true)]);
    // 16 CPUs: the first thread of 16 cores, the second threads still free
    expect(m.cores.filter((c) => c.cells[0].item === 0)).toHaveLength(16);
    expect(m.cores.every((c) => c.cells[1].item == null)).toBe(true);
    expect(m.cores[8].cells[0].game).toBe(2);
    // the whole node: every thread
    const [full] = loadMap(xeon, [item("igel", [0, 1], 5, 8, true)]);
    expect(full.cores.flatMap((c) => c.cells).every((c) => c.item === 0)).toBe(true);
  });
  it("fixed CPUs per game take whole cores", () => {
    const xeon = topo(2, 20, 2);
    const [s0, s1] = loadMap(xeon, [item("igel", [0, 1], 5, 8, true, "lane")]);
    expect(s0.cores[0].cells.map((c) => c.game)).toEqual([1, 1]);
    expect(s0.cores[3].cells.map((c) => c.game)).toEqual([1, 1]);
    expect(s0.cores[4].cells[0].game).toBe(2);
    // the second block of openings on socket 1: games 6 to 10
    expect(s1.cores[0].cells[0].game).toBe(6);
    expect(s0.cores.flatMap((c) => c.cells).every((c) => c.item === 0)).toBe(true);
    expect(s0.over).toEqual([]);
  });
  it("without Hyper-Threading one thread per core, the other left free", () => {
    const [m] = loadMap(ryzen, [item("a", [0], 2, 4, false)]);
    expect(m.cores[0].cells.map((c) => c.game)).toEqual([1, undefined]);
    expect(m.cores[4].cells[0].game).toBe(2);
    expect(m.over).toEqual([]);
  });
  it("other tournaments come first; what does not fit is counted", () => {
    const [m] = loadMap(ryzen, [item("other", [0], 6, 2, true), item("mine", [0], 3, 2, true)]);
    expect(m.cores.flatMap((c) => c.cells).filter((c) => c.item === 0)).toHaveLength(12);
    expect(m.cores.flatMap((c) => c.cells).filter((c) => c.item === 1)).toHaveLength(4);
    expect(m.over).toEqual([{ item: 1, cpus: 2 }]);
  });
  it("both opening blocks on one socket", () => {
    const [s0, s1] = loadMap(topo(2, 20, 2), [item("igel", [1, 1], 2, 8, true)]);
    expect(s0.cores.flatMap((c) => c.cells).some((c) => c.item != null)).toBe(false);
    expect(s1.cores.flatMap((c) => c.cells).filter((c) => c.item === 0)).toHaveLength(32);
  });
});
