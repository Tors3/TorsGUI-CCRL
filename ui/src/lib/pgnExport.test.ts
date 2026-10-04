import { describe, expect, it } from "vitest";
import { analysisPgn, evalTag } from "./pgnExport";
import type { ViewerGame } from "../bindings/ViewerGame";
import type { GameAnalysis } from "../bindings/GameAnalysis";

const info = { book: false, eval: null, mate: null, depth: null, seldepth: null, time_s: null, time_left_s: null, nodes: null, nps: null, note: null };
const ply = (san: string) => ({ san, uci: "", fen: "", info, eval_cp: null });
const pos = (cp: number | null, mate: number | null, best = "", pv: string[] = []) => ({ score: { cp, mate }, best_uci: "", best_san: best, pv_san: pv, depth: 10 });

describe("analysis PGN", () => {
  it("writes evaluations, NAGs and the better line", () => {
    const g: ViewerGame = { headers: [["White", "A"], ["Black", "B"]], start_fen: "", plies: ["e4", "e5", "Qh5", "Nc6"].map(ply), result: "*", error: null };
    const a: GameAnalysis = {
      engine: "SF",
      movetime_ms: 100,
      positions: [pos(20, null), pos(30, null), pos(25, null, "Nf3", ["Nf3", "Nc6"]), pos(-150, null), pos(-140, null)],
      moves: [{ tag: "", loss_cp: 0, wc_loss: 0 }, { tag: "", loss_cp: 0, wc_loss: 0 }, { tag: "mistake", loss_cp: 175, wc_loss: 0.25 }, { tag: "", loss_cp: 0, wc_loss: 0 }],
      white: { acpl: 0, inaccuracies: 0, mistakes: 1, blunders: 0, accuracy: 80 },
      black: { acpl: 0, inaccuracies: 0, mistakes: 0, blunders: 0, accuracy: 99 },
    };
    const pgn = analysisPgn(g, a);
    expect(pgn).toContain('[White "A"]');
    expect(pgn).toContain('[Annotator "TorsGUI, SF, 100 ms per position"]');
    expect(pgn.replace(/\s+/g, " ")).toContain("1. e4 {[%eval 0.30]} 1... e5 {[%eval 0.25]} 2. Qh5 $2 {[%eval -1.50]} (2. Nf3 Nc6 {0.25}) 2... Nc6 {[%eval -1.40]} *");
    expect(pgn.split("\n").every((l) => l.length <= 80)).toBe(true);
    expect(pgn.trim().endsWith("*")).toBe(true);
    expect(evalTag({ cp: null, mate: -3 })).toBe("#-3");
  });
  it("starts from a FEN with Black to move", () => {
    const g: ViewerGame = { headers: [], start_fen: "6k1/8/8/8/8/8/8/R5K1 b - - 0 30", plies: ["Kh7", "Ra7+"].map(ply), result: "*", error: null };
    const pgn = analysisPgn(g, null);
    expect(pgn).toContain('[FEN "6k1/8/8/8/8/8/8/R5K1 b - - 0 30"]');
    expect(pgn).toContain("30... Kh7 31. Ra7+ *");
  });
});
