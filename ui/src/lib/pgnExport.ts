import type { GameAnalysis } from "../bindings/GameAnalysis";
import type { Score } from "../bindings/Score";
import type { ViewerGame } from "../bindings/ViewerGame";

const NAG: Record<string, string> = { inaccuracy: "$6", mistake: "$2", blunder: "$4" };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** `[%eval]` value: pawns from White's view, or `#n` for a mate. */
export function evalTag(s?: Score | null): string | null {
  if (!s) return null;
  if (s.mate != null) return `#${s.mate}`;
  if (s.cp == null) return null;
  return (s.cp / 100).toFixed(2);
}

const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * The game as PGN with the review: evaluations as `[%eval]`, NAGs for inaccuracies (?!),
 * mistakes (?) and blunders (??), and the engine's line as a variation where a move lost
 * winning chances.
 */
export function analysisPgn(game: ViewerGame, a?: GameAnalysis | null, extra: Record<string, string> = {}): string {
  const startFen = game.start_fen || START;
  const h = new Map(game.headers);
  for (const k of ["Event", "Site", "Date", "Round", "White", "Black"]) if (!h.has(k)) h.set(k, k === "Date" ? "????.??.??" : "?");
  h.set("Result", game.result || "*");
  if (startFen !== START) {
    h.set("FEN", startFen);
    h.set("SetUp", "1");
  }
  if (a) h.set("Annotator", `TorsGUI, ${a.engine}, ${a.movetime_ms} ms per position`);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  const order = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
  const keys = [...order.filter((k) => h.has(k)), ...[...h.keys()].filter((k) => !order.includes(k))];
  const head = keys.map((k) => `[${k} "${escape(h.get(k) ?? "")}"]`).join("\n");

  const f = startFen.split(" ");
  const whiteFirst = f[1] !== "b";
  const firstNo = Number(f[5] ?? 1) || 1;
  const moveNo = (i: number) => firstNo + Math.floor((i + (whiteFirst ? 0 : 1)) / 2);
  const isWhite = (i: number) => (i % 2 === 0) === whiteFirst;
  const tokens: string[] = [];
  game.plies.forEach((p, i) => {
    if (isWhite(i)) tokens.push(`${moveNo(i)}.`);
    else if (i === 0 || tokens[tokens.length - 1]?.startsWith("{") || tokens[tokens.length - 1]?.endsWith(")")) tokens.push(`${moveNo(i)}...`);
    tokens.push(p.san.replace(/[!?]+$/, ""));
    const j = a?.moves[i];
    if (j?.tag && NAG[j.tag]) tokens.push(NAG[j.tag]);
    const ev = evalTag(a?.positions[i + 1]?.score);
    if (ev) tokens.push(`{[%eval ${ev}]}`);
    const before = a?.positions[i];
    if (j?.tag && before?.pv_san.length) {
      const line: string[] = [];
      before.pv_san.slice(0, 8).forEach((m, k) => {
        const ply = i + k;
        if (isWhite(ply)) line.push(`${moveNo(ply)}.`);
        else if (k === 0) line.push(`${moveNo(ply)}...`);
        line.push(m);
      });
      tokens.push(`(${line.join(" ")} {${evalTag(before.score) ?? ""}})`.replace(" {}", ""));
    }
  });
  tokens.push(game.result || "*");
  // lines of at most 80 characters
  const lines: string[] = [];
  let cur = "";
  for (const t of tokens) {
    if (cur && cur.length + 1 + t.length > 80) {
      lines.push(cur);
      cur = t;
    } else cur = cur ? `${cur} ${t}` : t;
  }
  if (cur) lines.push(cur);
  return `${head}\n\n${lines.join("\n")}\n`;
}
