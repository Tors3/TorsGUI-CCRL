import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ViewerGame } from "../bindings/ViewerGame";
import { call } from "../lib/api";
import { evalText, nps, num } from "../lib/format";
import { Board } from "./Board";
import { LineChart } from "./Chart";
import { ErrorBox, Modal, Result, Spinner } from "./ui";

export type GameRef = { source: string; index: number; title?: string };

export function GameViewer({ game, onClose }: { game: GameRef | null; onClose: () => void }) {
  const [data, setData] = useState<ViewerGame>();
  const [error, setError] = useState<string>();
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    setData(undefined);
    setError(undefined);
    if (!game) return;
    call<ViewerGame>("game_get", { source: game.source, index: game.index })
      .then((g) => {
        setData(g);
        setPly(g.plies.length);
      })
      .catch((e) => setError(e.message));
  }, [game]);
  const n = data?.plies.length ?? 0;
  useEffect(() => {
    if (!game) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPly((p) => Math.min(n, p + 1));
      else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(n);
      else if (e.key === "f") setFlip((f) => !f);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [game, n]);
  const h = useMemo(() => Object.fromEntries(data?.headers ?? []), [data]);
  const cur = ply > 0 ? data?.plies[ply - 1] : undefined;
  const fen = cur?.fen ?? data?.start_fen ?? "start";
  const xs = (data?.plies ?? []).map((_, i) => i + 1);
  const whiteEval = (data?.plies ?? []).map((p, i) => (i % 2 === 0 && p.eval_cp != null ? Math.max(-600, Math.min(600, p.eval_cp)) : null));
  const blackEval = (data?.plies ?? []).map((p, i) => (i % 2 === 1 && p.eval_cp != null ? Math.max(-600, Math.min(600, p.eval_cp)) : null));
  const whiteTime = (data?.plies ?? []).map((p, i) => (i % 2 === 0 ? p.info.time_s ?? null : null));
  const blackTime = (data?.plies ?? []).map((p, i) => (i % 2 === 1 ? p.info.time_s ?? null : null));
  return (
    <Modal
      open={!!game}
      onOpenChange={(o) => !o && onClose()}
      width={1180}
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
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(320px, 440px) 1fr" }}>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[12.5px] font-medium">
              <span>{flip ? h.White : h.Black}</span>
              <span className="mono muted">{(flip ? h.EngineWhiteName : h.EngineBlackName) ?? ""}</span>
            </div>
            <Board fen={fen} lastMove={cur?.uci} orientation={flip ? "black" : "white"} />
            <div className="flex justify-between text-[12.5px] font-medium">
              <span>{flip ? h.Black : h.White}</span>
              <span className="mono muted">{(flip ? h.EngineBlackName : h.EngineWhiteName) ?? ""}</span>
            </div>
            <div className="flex justify-center gap-1">
              <button className="btn btn-icon" aria-label="Start" onClick={() => setPly(0)}>
                <ChevronFirst size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Previous" onClick={() => setPly((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Next" onClick={() => setPly((p) => Math.min(n, p + 1))}>
                <ChevronRight size={15} />
              </button>
              <button className="btn btn-icon" aria-label="End" onClick={() => setPly(n)}>
                <ChevronLast size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Flip board" onClick={() => setFlip((f) => !f)}>
                <FlipVertical2 size={15} />
              </button>
            </div>
            <div className="panel p-2 grid grid-cols-3 gap-2 text-[12px] tnum">
              <div>
                <div className="kpi-label">Eval</div>
                {cur?.info.book ? "book" : evalText(cur?.eval_cp)}
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
          </div>
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
                  { label: "White engine", color: "var(--text)", values: whiteEval.map((v) => (v == null ? null : v / 100)) },
                  { label: "Black engine", color: "#e3b341", values: blackEval.map((v) => (v == null ? null : v / 100)) },
                ]}
                height={150}
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
                  { label: "White", color: "var(--text)", values: whiteTime },
                  { label: "Black", color: "#e3b341", values: blackTime },
                ]}
                height={90}
                marker={ply || undefined}
              />
            </div>
            <div className="panel p-2 max-h-[220px] overflow-auto mono leading-6" data-testid="move-list">
              {data.plies.map((p, i) => (
                <span key={i}>
                  {i % 2 === 0 && <span className="muted mr-1">{i / 2 + 1}.</span>}
                  <button
                    className="px-1 rounded mr-1"
                    style={{ background: i + 1 === ply ? "var(--accent-bg)" : undefined, color: p.info.book ? "var(--muted)" : undefined }}
                    onClick={() => setPly(i + 1)}
                    title={p.info.book ? "book" : `${evalText(p.eval_cp)} d${p.info.depth ?? "?"} ${p.info.time_s ?? "?"}s`}
                  >
                    {p.san}
                  </button>
                </span>
              ))}
              <span className="font-semibold">{data.result}</span>
            </div>
            {data.error && <ErrorBox error={data.error} />}
          </div>
        </div>
      )}
    </Modal>
  );
}
