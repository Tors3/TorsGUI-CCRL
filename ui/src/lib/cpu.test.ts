import { describe, expect, it } from "vitest";
import { coresPerLane, cpuLabel } from "./cpu";

describe("mixed CPU tournaments", () => {
  const seed8 = { role: "seed" as const, threads: 8 };
  const opp = { role: "opponent" as const, threads: null };
  it("labels and lane cores", () => {
    expect(cpuLabel([seed8, opp, opp], 1)).toBe("8CPU vs 1CPU");
    expect(cpuLabel([{ role: "seed", threads: null }, opp], 4)).toBe("4CPU");
    expect(cpuLabel([{ role: "seed", threads: 4 }, { role: "opponent", threads: 2 }, opp], 1)).toBe("4CPU vs 1CPU/2CPU");
    expect(coresPerLane("gauntlet", [seed8, opp, opp], 1)).toBe(9);
    expect(coresPerLane("gauntlet", [{ role: "seed", threads: null }, opp], 4)).toBe(8);
    expect(coresPerLane("round_robin", [{ role: "seed", threads: 4 }, { role: "opponent", threads: 2 }, opp], 1)).toBe(6);
    expect(coresPerLane("gauntlet", [], 2)).toBe(4);
  });
});
