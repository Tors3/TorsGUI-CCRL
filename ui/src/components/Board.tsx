import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import { useEffect, useRef } from "react";

/** View-only chessground board. `lastMove` is a UCI move ("e2e4"). */
export function Board(props: { fen: string; lastMove?: string | null; orientation?: "white" | "black"; arrows?: string[]; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const lm = props.lastMove && props.lastMove.length >= 4 ? ([props.lastMove.slice(0, 2), props.lastMove.slice(2, 4)] as Key[]) : undefined;
  const shapes = (props.arrows ?? [])
    .filter((m) => m && m.length >= 4)
    .map((m, i) => ({ orig: m.slice(0, 2) as Key, dest: m.slice(2, 4) as Key, brush: i === 0 ? "blue" : "paleBlue" }));
  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen: props.fen,
      viewOnly: true,
      coordinates: false,
      orientation: props.orientation ?? "white",
      lastMove: lm,
      animation: { enabled: true, duration: 150 },
      drawable: { enabled: false, visible: true, autoShapes: shapes },
    });
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    api.current?.set({ fen: props.fen, lastMove: lm, orientation: props.orientation ?? "white", drawable: { autoShapes: shapes } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fen, props.lastMove, props.orientation, JSON.stringify(props.arrows)]);
  return (
    <div className={`board-box ${props.className ?? ""}`}>
      <div ref={el} className="w-full h-full" data-testid="board" />
    </div>
  );
}
