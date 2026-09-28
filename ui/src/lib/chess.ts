/** Small FEN helpers for the UI (the engine logic lives in Rust). */

export type Role = "P" | "N" | "B" | "R" | "Q" | "K";
const VALUE: Record<Role, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const START: Record<Role, number> = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
const ORDER: Role[] = ["Q", "R", "B", "N", "P"];

export type Material = {
  /** Pieces of the opponent captured by each side, most valuable first. */
  capturedBy: { w: Role[]; b: Role[] };
  /** Material balance from White's view (pawn units). */
  diff: number;
};

export function material(fen: string): Material {
  const board = fen.split(" ")[0] ?? "";
  const count = { w: { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 }, b: { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 } } as Record<"w" | "b", Record<Role, number>>;
  for (const ch of board) {
    const up = ch.toUpperCase() as Role;
    if (!(up in VALUE)) continue;
    count[ch === up ? "w" : "b"][up]++;
  }
  const captured = (side: "w" | "b"): Role[] => {
    const out: Role[] = [];
    for (const r of ORDER) for (let i = count[side][r]; i < START[r]; i++) out.push(r);
    return out;
  };
  let diff = 0;
  for (const r of ORDER) diff += (count.w[r] - count.b[r]) * VALUE[r];
  return { capturedBy: { w: captured("b"), b: captured("w") }, diff };
}

/** SAN with a check or mate sign. */
export const isCheck = (san?: string | null) => !!san && /[+#]$/.test(san);
export const isCapture = (san?: string | null) => !!san && san.includes("x");
