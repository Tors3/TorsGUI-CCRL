import { describe, expect, it } from "vitest";
import { clock, duration, evalText, nps, pct, signed } from "./format";

describe("format", () => {
  it("durations", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(3700)).toBe("1h 01m");
    expect(duration(2 * 86400 + 3 * 3600)).toBe("2d 3h");
    expect(duration(null)).toBe("—");
  });
  it("clocks and numbers", () => {
    expect(clock(95_000)).toBe("1:35");
    expect(clock(4_200)).toBe("4.2");
    expect(pct(51.4367)).toBe("51.4%");
    expect(signed(-7)).toBe("−7");
    expect(signed(32)).toBe("+32");
    expect(nps(2_506_263)).toBe("2.5M");
  });
  it("evaluations", () => {
    expect(evalText(21)).toBe("+0.21");
    expect(evalText(-150)).toBe("−1.50");
    expect(evalText(null, -3)).toBe("−M3");
  });
});
