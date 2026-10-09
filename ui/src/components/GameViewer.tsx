import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2, Maximize2, Microscope, Minimize2, Pause, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerGame } from "../bindings/ViewerGame";
import type { ViewerPly } from "../bindings/ViewerPly";
import { call } from "../lib/api";
import { pieceUrl, playGameSound, playMoveSound, useBoardPrefs } from "../lib/boardPrefs";
import { isCheck, material, type Role } from "../lib/chess";
import { evalText, nps, num } from "../lib/format";
import { Board, EvalBar } from "./Board";
import { BoardColumn } from "./BoardColumn";
import { BoardSettingsButton } from "./BoardSettings";
import { LineChart } from "./Chart";
import { ErrorBox, Modal, Result, Spinner } from "./ui";

export type GameRef = { source: string; index: number; title?: string };

const SPEEDS = [0.5, 1, 2, 4];

/** Mover of a ply: the side that is *not* to move in the resulting FEN. */
const moverIsWhite = (p: ViewerPly) => p.fen.split(" ")[1] === "b";

/** White-view evaluation (cp, mate) of the position after `ply`, carried over book moves. */
function evalAt(plies: ViewerPly[], ply: number): { cp: number | null; mate: number | null } {
  for (let i = Math.min(ply, plies.length) - 1; i >= 0; i--) {
    const p = plies[i];
    if (p.info.mate != null && p.info.mate !== 0) return { cp: null, mate: moverIsWhite(p) ? p.info.mate : -p.info.mate };
    if (p.eval_cp != null) return { cp: p.eval_cp, mate: null };
  }
  return { cp: null, mate: null };
}

/** Clock left (s) of a side after `ply`: the last move of that side. */
function clockAt(plies: ViewerPly[], ply: number, white: boolean): number | null {
  for (let i = Math.min(ply, plies.length) - 1; i >= 0; i--) if (moverIsWhite(plies[i]) === white) return plies[i].info.time_left_s ?? null;
  return null;
}

export function Material({ fen, side }: { fen: string; side: "w" | "b" }) {
  const prefs = useBoardPrefs();
  const m = useMemo(() => material(fen), [fen]);
  const caps = m.capturedBy[side];
  const lead = side === "w" ? m.diff : -m.diff;
  const other = side === "w" ? "b" : "w";
  return (
    <span className="material" data-testid="material">
      {caps.map((r: Role, i) => (
        <img key={i} src={pieceUrl(prefs.pieces, other, r)} alt={r} className={i > 0 && caps[i - 1] !== r ? "gap" : ""} />
      ))}
      {lead > 0 && <span className="ml-2 text-[11.5px] muted tnum">+{lead}</span>}
    </span>
  );
}

function PlayerBar({ name, engine, fen, side, clock, active }: { name?: string; engine?: string; fen: string; side: "w" | "b"; clock: number | null; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12.5px] min-h-[24px]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: side === "w" ? "#f2f2f2" : "#262626", boxShadow: "0 0 0 1px var(--border-strong)" }} />
        <span className="font-medium truncate">{name ?? "…"}</span>
        {engine && <span className="mono muted text-[11px] truncate hidden xl:inline">{engine}</span>}
        <Material fen={fen} side={side} />
      </div>
      <span className={`clock ${active ? "running" : ""}`}>{clock != null ? `${clock.toFixed(1)}s` : "—"}</span>
    </div>
  );
}

export function GameViewer({ game, onClose }: { game: GameRef | null; onClose: () => void }) {
  const prefs = useBoardPrefs();
  const navigate = useNavigate();
  const [data, setData] = useState<ViewerGame>();
  const [error, setError] = useState<string>();
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [theater, setTheater] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevPly = useRef(0);
  useEffect(() => {
    setData(undefined);
    setError(undefined);
    setPlaying(false);
    setPly(0);
    prevPly.current = 0;
    if (!game) return;
    call<ViewerGame>("game_get", { source: game.source, index: game.index })
      .then((g) => {
        setData(g);
        setPly(g.plies.length);
        prevPly.current = g.plies.length;
      })
      .catch((e) => setError(e.message));
  }, [game]);
  const plies = useMemo(() => data?.plies ?? [], [data]);
  const n = plies.length;
  // keyboard
  useEffect(() => {
    if (!game) return;
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPly((p) => Math.min(n, p + 1));
      else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(n);
      else if (e.key === "f") setFlip((f) => !f);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "t") setTheater((t) => !t);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [game, n]);
  // autoplay
  useEffect(() => {
    if (!playing) return;
    if (ply >= n) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setPly((p) => Math.min(n, p + 1)), 1000 / speed);
    return () => clearTimeout(t);
  }, [playing, ply, n, speed]);
  // sound and move list scroll
  useEffect(() => {
    if (prefs.sound && ply === prevPly.current + 1 && ply > 0) {
      playMoveSound(plies[ply - 1]?.san);
      // the last move of a finished game
      if (ply === n && data && data.result !== "*") setTimeout(() => playGameSound("end"), 160);
    }
    prevPly.current = ply;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply]);
  const h = useMemo(() => Object.fromEntries(data?.headers ?? []), [data]);
  const cur = ply > 0 && ply <= n ? plies[ply - 1] : undefined;
  const fen = cur?.fen ?? data?.start_fen ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const ev = useMemo(() => evalAt(plies, ply), [plies, ply]);
  const next = ply < n ? plies[ply] : undefined;
  const whiteToMove = fen.split(" ")[1] !== "b";
  const orientation = flip ? "black" : "white";
  const xs = plies.map((_, i) => i + 1);
  const series = useMemo(() => {
    const clamp = (v: number | null) => (v == null ? null : Math.max(-6, Math.min(6, v / 100)));
    return {
      we: plies.map((p) => (moverIsWhite(p) ? clamp(p.eval_cp) : null)),
      be: plies.map((p) => (!moverIsWhite(p) ? clamp(p.eval_cp) : null)),
      wt: plies.map((p) => (moverIsWhite(p) ? p.info.time_s ?? null : null)),
      bt: plies.map((p) => (!moverIsWhite(p) ? p.info.time_s ?? null : null)),
    };
  }, [plies]);
  const rows = useMemo(() => {
    const out: { no: number; w?: number; b?: number }[] = [];
    plies.forEach((p, i) => {
      const white = moverIsWhite(p);
      if (white || out.length === 0) out.push({ no: out.length + 1 });
      out[out.length - 1][white ? "w" : "b"] = i;
    });
    return out;
  }, [plies]);
  const topSide: "w" | "b" = flip ? "w" : "b";
  const bottomSide: "w" | "b" = flip ? "b" : "w";
  const player = (side: "w" | "b") => ({
    name: side === "w" ? h.White : h.Black,
    engine: side === "w" ? h.EngineWhiteName : h.EngineBlackName,
    clock: clockAt(plies, ply, side === "w"),
    active: ply < n && (side === "w") === whiteToMove,
  });
  const boardCol = theater ? "minmax(420px, min(76vh, 820px))" : "minmax(320px, 470px)";
  const moveButton = (i: number | undefined) => {
    if (i == null) return <span />;
    const p = plies[i];
    return (
      <button data-ply={i + 1} className={i + 1 === ply ? "active" : ""} onClick={() => setPly(i + 1)} title={p.info.book ? "book" : `${evalText(p.eval_cp)} d${p.info.depth ?? "?"} ${p.info.time_s ?? "?"}s`}>
        <span className={p.info.book ? "book" : ""}>{p.san}</span>
        <span className="ev">{p.info.book ? "" : p.info.mate ? `M${p.info.mate}` : p.info.eval != null ? p.info.eval.toFixed(2) : ""}</span>
      </button>
    );
  };
  return (
    <Modal
      open={!!game}
      onOpenChange={(o) => !o && onClose()}
      width={theater ? 1900 : 1200}
      title={
        <span className="flex items-center gap-2">
          {h.White ?? "…"} <span className="muted">vs</span> {h.Black ?? "…"} {data && <Result r={data.result} />}
        </span>
      }
    >
      <ErrorBox error={error} />
      {!data && !error && (
        <div className="flex justify-center py-10">
          <Spinner size={20} />
        </div>
      )}
      {data && (
        <div className="grid gap-5" style={{ gridTemplateColumns: `var(--board-col, ${boardCol}) minmax(0, 1fr)` }}>
          <BoardColumn id={theater ? "viewer-theater" : "viewer"} className="flex flex-col gap-2">
            <PlayerBar {...player(topSide)} fen={fen} side={topSide} />
            <div className="flex gap-2 items-stretch">
              <EvalBar cp={ev.cp} mate={ev.mate} orientation={orientation} />
              <Board fen={fen} lastMove={cur?.uci} check={isCheck(cur?.san)} orientation={orientation} arrows={next && !playing ? [{ uci: next.uci, brush: "paleBlue" }] : []} className="flex-1" />
            </div>
            <PlayerBar {...player(bottomSide)} fen={fen} side={bottomSide} />
            <div className="flex justify-center items-center gap-1 mt-1">
              <button className="btn btn-icon" aria-label="Start" onClick={() => setPly(0)}>
                <ChevronFirst size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Previous" onClick={() => setPly((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={15} />
              </button>
              <button
                className="btn btn-primary btn-icon"
                aria-label={playing ? "Pause" : "Play"}
                title="Play / pause (space)"
                onClick={() => {
                  if (ply >= n) setPly(0);
                  setPlaying((p) => !p || ply >= n);
                }}
                data-testid="autoplay"
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button className="btn btn-icon" aria-label="Next" onClick={() => setPly((p) => Math.min(n, p + 1))}>
                <ChevronRight size={15} />
              </button>
              <button className="btn btn-icon" aria-label="End" onClick={() => setPly(n)}>
                <ChevronLast size={15} />
              </button>
              <select className="select !w-auto !h-[30px] text-[12px]" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Autoplay speed">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <span className="w-2" />
              <button className="btn btn-icon" aria-label="Flip board" title="Flip (f)" onClick={() => setFlip((f) => !f)}>
                <FlipVertical2 size={15} />
              </button>
              <button className="btn btn-icon" aria-label={theater ? "Normal size" : "Theater mode"} title="Theater mode (t)" onClick={() => setTheater((t) => !t)}>
                {theater ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <BoardSettingsButton />
              <button
                className="btn btn-sm ml-1"
                title="Analyse this game with an engine"
                onClick={() => {
                  if (!game) return;
                  onClose();
                  navigate(`/analysis?source=${encodeURIComponent(game.source)}&index=${game.index}&ply=${ply}`);
                }}
                data-testid="viewer-analyse"
              >
                <Microscope size={13} /> Analyse
              </button>
            </div>
            <div className="panel p-2 grid grid-cols-3 gap-2 text-[12px] tnum">
              <div>
                <div className="kpi-label">Eval</div>
                <span className="eval-value">{cur?.info.book ? "book" : evalText(cur?.eval_cp)}</span>
              </div>
              <div>
                <div className="kpi-label">Depth</div>
                {cur?.info.depth ?? "—"}/{cur?.info.seldepth ?? "—"}
              </div>
              <div>
                <div className="kpi-label">Time</div>
                {cur?.info.time_s != null ? `${cur.info.time_s.toFixed(2)}s` : "—"}
              </div>
              <div>
                <div className="kpi-label">Left</div>
                {cur?.info.time_left_s != null ? `${cur.info.time_left_s.toFixed(1)}s` : "—"}
              </div>
              <div>
                <div className="kpi-label">Nodes</div>
                {num(cur?.info.nodes)}
              </div>
              <div>
                <div className="kpi-label">NPS</div>
                {nps(cur?.info.nps)}
              </div>
            </div>
            {cur?.info.note && <div className="muted text-[12px]">{cur.info.note}</div>}
          </BoardColumn>
          <div className="flex flex-col gap-3 min-w-0">
            <div className="grid grid-cols-4 gap-2 text-[12px]">
              {["Event", "Date", "TimeControl", "Termination", "Opening", "ECO", "GameDuration", "PlyCount"].map((k) => (
                <div key={k} className="min-w-0">
                  <div className="kpi-label">{k}</div>
                  <div className="truncate" title={h[k]}>
                    {h[k] ?? "—"}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="kpi-label mb-1">Evaluation (White's view, pawns) — click to jump</div>
              <LineChart
                x={xs}
                series={[
                  { label: "White engine", color: "var(--text)", values: series.we },
                  { label: "Black engine", color: "#e3b341", values: series.be },
                ]}
                height={theater ? 190 : 150}
                zeroLine
                marker={ply || undefined}
                onClick={(i) => setPly(i + 1)}
              />
            </div>
            <div>
              <div className="kpi-label mb-1">Time per move (s)</div>
              <LineChart
                x={xs}
                series={[
                  { label: "White", color: "var(--text)", values: series.wt },
                  { label: "Black", color: "#e3b341", values: series.bt },
                ]}
                height={90}
                marker={ply || undefined}
              />
            </div>
            <div ref={listRef} className="panel overflow-auto mono text-[12.5px]" style={{ maxHeight: theater ? "40vh" : 250 }} data-testid="move-list">
              <div className="movelist">
                {rows.map((r) => (
                  <div key={r.no} className="contents">
                    <span className="no">{r.no}.</span>
                    {moveButton(r.w)}
                    {moveButton(r.b)}
                  </div>
                ))}
              </div>
              <div className="px-2 py-1.5 font-semibold text-center" style={{ borderTop: "1px solid var(--border)" }}>
                {data.result} {h.Termination ? <span className="muted font-normal">· {h.Termination}</span> : null}
              </div>
            </div>
            {data.error && <ErrorBox error={data.error} />}
          </div>
        </div>
      )}
    </Modal>
  );
}
