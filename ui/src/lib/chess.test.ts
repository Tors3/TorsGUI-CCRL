import { isCapture, isCheck, material } from "./chess";

describe("material", () => {
  it("start position is balanced", () => {
    const m = material("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(m.diff).toBe(0);
    expect(m.capturedBy.w).toEqual([]);
    expect(m.capturedBy.b).toEqual([]);
  });
  it("counts captures and the balance", () => {
    // white has won a knight, black a pawn
    const m = material("r1bqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR b KQkq - 0 5");
    expect(m.capturedBy.w).toEqual(["N"]);
    expect(m.capturedBy.b).toEqual(["P"]);
    expect(m.diff).toBe(2);
  });
  it("promotion gives a negative missing count, not extra captures", () => {
    const m = material("4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1");
    expect(m.capturedBy.b).toContain("P");
    expect(m.diff).toBe(18);
  });
  it("san helpers", () => {
    expect(isCheck("Qh5+")).toBe(true);
    expect(isCheck("Qxf7#")).toBe(true);
    expect(isCheck("e4")).toBe(false);
    expect(isCapture("exd5")).toBe(true);
  });
});
