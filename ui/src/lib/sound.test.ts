import { describe, expect, it } from "vitest";
import { sanEvents } from "./sound";

describe("sanEvents", () => {
  it("tells moves, captures, castling, check and promotion apart", () => {
    expect(sanEvents("e4")).toEqual(["move"]);
    expect(sanEvents("Nxd4")).toEqual(["capture"]);
    expect(sanEvents("O-O")).toEqual(["castle"]);
    expect(sanEvents("O-O-O+")).toEqual(["castle", "check"]);
    expect(sanEvents("Qh5#")).toEqual(["move", "check"]);
    expect(sanEvents("exd8=Q+")).toEqual(["capture", "promote", "check"]);
    expect(sanEvents(undefined)).toEqual([]);
  });
});
