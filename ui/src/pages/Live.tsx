import { Activity } from "lucide-react";
import { useMemo, useState } from "react";
import type { EngineLive } from "../bindings/EngineLive";
import type { LiveLane } from "../bindings/LiveLane";
import { Board } from "../components/Board";
import { LineChart } from "../components/Chart";
import { Empty, ErrorBox, Modal, PageHeader, Panel } from "../components/ui";
import { usePoll } from "../lib/api";
import { clock, duration, evalText, nps } from "../lib/format";

function PlayerRow({ name, ms, active, e }: { name: string; ms: number | null; active: boolean; e?: EngineLive }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="truncate font-medium flex items-center gap-1.5">
        {active && <span className="dot dot-pulse" style={{ color: "var(--win)" }} />}
        {name}
      </span>
      <span className="tnum muted shrink-0">
        {e ? `${evalText(e.score_cp, e.mate)} d${e.depth ?? "?"} ${nps(e.nps)}` : ""}
      </span>
      <span className="mono shrink-0 px-1.5 rounded" style={{ background: active ? "var(--accent-bg)" : "var(--bg-2)", color: active ? "var(--text)" : "var(--muted)" }}>
        {clock(ms)}
      </span>
    </div>
  );
}

function LaneCard({ l, onOpen }: { l: LiveLane; onOpen: () => void }) {
  const g = l.game;
  const job = l.lane.job;
  const white = g?.engines.find((e) => e.name === g.white);
  const black = g?.engines.find((e) => e.name === g.black);
  return (
    <button className="panel p-2.5 flex flex-col gap-1.5 text-left hover:border-[var(--accent)]" onClick={onOpen} disabled={!g} data-testid="lane-card">
      <div className="flex justify-between text-[11px] muted">
        <span className="truncate">{l.tournament}</span>
        <span className="shrink-0">
          node {l.lane.node} · lane {l.lane.lane}
        </span>
      </div>
      {g && job ? (
        <>
          <PlayerRow name={g.black} ms={g.btime} active={g.side_to_move === "black"} e={black} />
          <Board fen={g.fen} lastMove={g.last_move} />
          <PlayerRow name={g.white} ms={g.wtime} active={g.side_to_move === "white"} e={white} />
          <div className="flex justify-between text-[11px] muted tnum">
            <span>
              move {Math.floor(g.moves_uci.length / 2) + 1} · {g.moves_san.slice(-1)[0] ?? "start"}
            </span>
            <span>
              p{job.pass} r{job.round} · #{job.opening} · {duration(l.elapsed_s)}
            </span>
          </div>
        </>
      ) : (
        <div className="aspect-square flex items-center justify-center muted">idle</div>
      )}
    </button>
  );
}

function EnginePanel({ e, color }: { e?: EngineLive; color: string }) {
  if (!e) return null;
  return (
    <div className="panel p-2.5 text-[12px]">
      <div className="flex justify-between font-medium">
        <span className="flex items-center gap-1.5">
          <span className="dot" style={{ color }} /> {e.name}
        </span>
        <span className="tnum">{evalText(e.score_cp, e.mate)}</span>
      </div>
      <div className="grid grid-cols-4 gap-1 tnum muted mt-1">
        <span>d {e.depth ?? "—"}/{e.seldepth ?? "—"}</span>
        <span>{nps(e.nodes)} nodes</span>
        <span>{nps(e.nps)} nps</span>
        <span>{e.time_ms != null ? `${(e.time_ms / 1000).toFixed(1)}s` : "—"}</span>
      </div>
      <div className="mono mt-1 truncate" title={e.pv_san.join(" ")}>
        PV: {e.pv_san.join(" ") || "—"}
      </div>
    </div>
  );
}

function BigView({ l, onClose }: { l: LiveLane | null; onClose: () => void }) {
  const g = l?.game;
  const white = g?.engines.find((e) => e.name === g.white);
  const black = g?.engines.find((e) => e.name === g.black);
  const series = useMemo(() => {
    const ev = g?.evals ?? [];
    const x = ev.map((p) => p.ply);
    return {
      x,
      w: ev.map((p) => (p.engine === g?.white ? Math.max(-6, Math.min(6, p.cp / 100)) : null)),
      b: ev.map((p) => (p.engine === g?.black ? Math.max(-6, Math.min(6, p.cp / 100)) : null)),
      tw: ev.map((p) => (p.engine === g?.white ? p.time_ms / 1000 : null)),
      tb: ev.map((p) => (p.engine === g?.black ? p.time_ms / 1000 : null)),
    };
  }, [g]);
  const tomove = g?.side_to_move === "white" ? white : black;
  return (
    <Modal open={!!l} onOpenChange={(o) => !o && onClose()} width={1180} title={g ? `${g.white} – ${g.black}` : ""}>
      {g && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(320px, 460px) 1fr" }}>
          <div className="flex flex-col gap-2">
            <PlayerRow name={g.black} ms={g.btime} active={g.side_to_move === "black"} e={black} />
            <Board fen={g.fen} lastMove={g.last_move} arrows={tomove?.pv.slice(0, 1)} />
            <PlayerRow name={g.white} ms={g.wtime} active={g.side_to_move === "white"} e={white} />
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            <EnginePanel e={white} color="var(--text)" />
            <EnginePanel e={black} color="#e3b341" />
            <div>
              <div className="kpi-label mb-1">Evaluation (White's view) — both engines</div>
              <LineChart x={series.x} series={[{ label: "White", color: "var(--text)", values: series.w }, { label: "Black", color: "#e3b341", values: series.b }]} height={140} zeroLine />
            </div>
            <div>
              <div className="kpi-label mb-1">Time per move (s)</div>
              <LineChart x={series.x} series={[{ label: "White", color: "var(--text)", values: series.tw }, { label: "Black", color: "#e3b341", values: series.tb }]} height={90} />
            </div>
            <div className="panel p-2 mono leading-6 max-h-[160px] overflow-auto">
              {g.moves_san.map((m, i) => (
                <span key={i}>
                  {i % 2 === 0 && <span className="muted mr-1">{i / 2 + 1}.</span>}
                  <span className="mr-1.5">{m}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Live() {
  const { data, error } = usePoll<LiveLane[]>("live_lanes", {}, 1000);
  const [open, setOpen] = useState<string | null>(null);
  const lanes = data ?? [];
  const busy = lanes.filter((l) => l.lane.busy).length;
  const cur = lanes.find((l) => `${l.tournament_id}/${l.lane.partition}/${l.lane.lane}` === open) ?? null;
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader title="Live" sub={`${busy} games in progress on ${lanes.length} lanes · engine logs tailed incrementally`} />
      <ErrorBox error={error} />
      {lanes.length === 0 ? (
        <Panel>
          <Empty icon={<Activity size={22} />}>No tournament is running. Games in progress appear here with a mini board per lane.</Empty>
        </Panel>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {lanes.map((l) => (
            <LaneCard key={`${l.tournament_id}/${l.lane.partition}/${l.lane.lane}`} l={l} onOpen={() => setOpen(`${l.tournament_id}/${l.lane.partition}/${l.lane.lane}`)} />
          ))}
        </div>
      )}
      <BigView l={cur} onClose={() => setOpen(null)} />
    </div>
  );
}
