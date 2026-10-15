import { describe, expect, it } from "vitest";
import type { LanePlan } from "../bindings/LanePlan";
import type { Topology } from "../bindings/Topology";
import { cpuBudget, cpuMap, suggestedLanes } from "./cores";

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
const set = (node: number, cpus: number[]) => ({ node, group: node, mask: 0, cpus });

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
  it("leaves the second threads out with physical cores only", () => {
    const [m] = cpuMap(ryzen, [0], false, "node", [{ partition: 0, node: 0, lane: 0, cpuset: set(0, [0, 2, 4]) }]);
    expect(m.cores).toHaveLength(8);
    expect(m.cores[0].cells.map((c) => c.state)).toEqual(["shared", "off"]);
  });
  it("gives each game its own whole cores", () => {
    const plans: LanePlan[] = [0, 1].map((lane) => ({ partition: 0, node: 0, lane, cpuset: set(0, [lane * 2, lane * 2 + 1]) }));
    const [m] = cpuMap(ryzen, [0], true, "lane", plans);
    expect(m.fit).toBe(2);
    expect(m.cores[0].cells).toEqual([{ id: 0, state: "game", lane: 0 }, { id: 1, state: "game", lane: 0 }]);
    expect(m.cores[1].cells[0]).toEqual({ id: 2, state: "game", lane: 1 });
    expect(m.cores[2].cells[0].state).toBe("free");
  });
  it("says when the CPUs are not enough for fixed sets", () => {
    const all = Array.from({ length: 8 }, (_, i) => i * 2);
    const plans: LanePlan[] = [
      { partition: 0, node: 0, lane: 0, cpuset: set(0, [0, 2, 4, 6, 8, 10]) },
      { partition: 0, node: 0, lane: 1, cpuset: set(0, all) },
    ];
    const [m] = cpuMap(ryzen, [0], false, "lane", plans);
    expect(m.fit).toBe(1);
    expect(m.cores[7].cells[0].state).toBe("shared");
  });
  it("no limits: the system decides", () => {
    const [m] = cpuMap(ryzen, [0], false, "none", [{ partition: 0, node: 0, lane: 0, cpuset: null }]);
    expect(m.cores.flatMap((c) => c.cells).every((c) => c.state === "os")).toBe(true);
  });
});
