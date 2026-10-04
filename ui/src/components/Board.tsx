import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { piecesClass, themeStyle, useBoardPrefs } from "../lib/boardPrefs";

export type Arrow = { uci: string; brush?: "green" | "blue" | "yellow" | "red" | "paleBlue" | "paleGreen" | "paleGrey" };

/**
 * Chessground board with the user's theme, piece set and animation speed: view-only, or
 * with `movable` the side to play and its legal targets (`onMove` gets each move).
 * `lastMove` is a UCI move ("e2e4"); `check` highlights the king of the side to move.
 */
export function Board(props: {
  fen: string;
  lastMove?: string | null;
  orientation?: "white" | "black";
  arrows?: (string | Arrow)[];
  check?: boolean;
  mini?: boolean;
  className?: string;
  /** A board the viewer plays on (fixed for the life of the board). */
  interactive?: boolean;
  /** Moves the viewer may play now: the side and, per square, its targets. */
  movable?: { color: "white" | "black"; dests: Map<Key, Key[]> } | null;
  onMove?: (orig: Key, dest: Key) => void;
}) {
  const prefs = useBoardPrefs();
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const lm = props.lastMove && props.lastMove.length >= 4 ? ([props.lastMove.slice(0, 2), props.lastMove.slice(2, 4)] as Key[]) : undefined;
  const turn = props.fen.split(" ")[1] === "b" ? "black" : "white";
  const shapes: DrawShape[] = useMemo(
    () =>
      prefs.arrows
        ? (props.arrows ?? [])
            .map((a, i) => (typeof a === "string" ? { uci: a, brush: i === 0 ? "green" : "paleGreen" } : a))
            .filter((a) => a.uci && a.uci.length >= 4)
            .map((a) => ({ orig: a.uci.slice(0, 2) as Key, dest: a.uci.slice(2, 4) as Key, brush: a.brush ?? "green" }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(props.arrows), prefs.arrows],
  );
  const animation = { enabled: prefs.animation > 0, duration: props.mini ? Math.min(prefs.animation, 180) : prefs.animation };
  const coordinates = !props.mini && prefs.coordinates;
  const onMove = useRef(props.onMove);
  onMove.current = props.onMove;
  const movableCfg = props.movable
    ? { free: false, color: props.movable.color, dests: props.movable.dests, showDests: true, events: { after: (o: Key, d: Key) => onMove.current?.(o, d) } }
    : { free: false, color: undefined, dests: new Map() };
  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen: props.fen,
      viewOnly: !props.interactive,
      movable: movableCfg,
      premovable: { enabled: false },
      coordinates,
      orientation: props.orientation ?? "white",
      turnColor: turn,
      check: !!props.check,
      lastMove: lm,
      animation,
      drawable: { enabled: false, visible: true, autoShapes: shapes },
    });
    return () => api.current?.destroy();
    // chessground renders coordinates and binds the mouse only at creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates, props.interactive]);
  useEffect(() => {
    api.current?.set({ fen: props.fen, turnColor: turn, check: !!props.check, lastMove: lm, orientation: props.orientation ?? "white", animation, drawable: { autoShapes: shapes }, movable: movableCfg });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fen, props.lastMove, props.orientation, props.check, shapes, prefs.animation, props.movable]);
  return (
    <div className={`board-box board-theme-${prefs.theme} ${piecesClass(prefs.pieces)} ${props.mini ? "board-mini" : ""} ${props.className ?? ""}`} style={themeStyle(prefs) as CSSProperties}>
      <div ref={el} className="w-full h-full" data-testid="board" />
    </div>
  );
}

/** Vertical evaluation bar (White's view), animated. */
export function EvalBar({ cp, mate, orientation = "white", className }: { cp?: number | null; mate?: number | null; orientation?: "white" | "black"; className?: string }) {
  // logistic mapping as used by most GUIs: ±4 pawns ≈ 88 %
  const hasMate = mate != null && mate !== 0;
  const white = hasMate ? (mate! > 0 ? 1 : 0) : cp == null ? 0.5 : 1 / (1 + Math.exp(-cp / 200));
  const label = hasMate ? `M${Math.abs(mate!)}` : cp == null ? "" : (Math.abs(cp) / 100).toFixed(1);
  const whiteAhead = hasMate ? mate! > 0 : (cp ?? 0) >= 0;
  const flip = orientation === "black";
  return (
    <div className={`eval-bar ${className ?? ""}`} data-testid="eval-bar" title={label ? `${whiteAhead ? "+" : "−"}${label}` : "no evaluation"}>
      <div className="eval-bar-white" style={{ height: `${white * 100}%`, [flip ? "top" : "bottom"]: 0 }} />
      <div className="eval-bar-mid" />
      {label && (
        <span className="eval-bar-label" style={{ [whiteAhead !== flip ? "bottom" : "top"]: 3, color: whiteAhead ? "#222" : "#eee" }}>
          {label}
        </span>
      )}
    </div>
  );
}
