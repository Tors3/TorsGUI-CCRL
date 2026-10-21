import { Activity, ChevronDown, ChevronRight, Cpu } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineLive } from "../bindings/EngineLive";
import type { LiveLane } from "../bindings/LiveLane";
import { Board, EvalBar } from "../components/Board";
import { BoardColumn } from "../components/BoardColumn";
import { BoardSettingsButton } from "../components/BoardSettings";
import { LineChart } from "../components/Chart";
import { Material } from "../components/GameViewer";
import { Empty, ErrorBox, Modal, PageHeader, Panel } from "../components/ui";
import { LoadMap, useRunningItems } from "../components/LoadMap";
import type { Topology } from "../bindings/Topology";
import { usePoll } from "../lib/api";
import { playMoveSound, useBoardPrefs } from "../lib/boardPrefs";
import { isCheck } from "../lib/chess";
import { clock, duration, evalText, nps } from "../lib/format";
import { useT } from "../i18n";

/**
 * Clock that keeps running between polls: the runner reports the clock at the last `go`;
 * the side to move is counted down locally from the moment the value was first seen.
 */
function useTicking(ms: number | null, running: boolean): number | null {
  const base = useRef<{ ms: number | null; at: number }>({ ms, at: Date.now() });
  const [, tick] = useState(0);
  if (base.current.ms !== ms) base.current = { ms, at: Date.now() };
  useEffect(() => {
    if (!running || ms == null) return;
    const t = setInterval(() => tick((x) => x + 1), 100);
    return () => clearInterval(t);
  }, [running, ms]);
  if (ms == null || !running) return ms;
  return Math.max(0, base.current.ms! - (Date.now() - base.current.at));
}

function PlayerRow({ name, ms, active, e, fen, side }: { name: string; ms: number | null; active: boolean; e?: EngineLive; fen?: string; side?: "w" | "b" }) {
  const t = useTicking(ms, active);
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="truncate font-medium flex items-center gap-1.5 min-w-0">
        {active && <span className="dot dot-pulse" style={{ color: "var(--win)" }} />}
        <span className="truncate">{name}</span>
        {fen && side && <Material fen={fen} side={side} />}
      </span>
      <span className="tnum muted shrink-0">{e ? `${evalText(e.score_cp, e.mate)} d${e.depth ?? "?"} ${nps(e.nps)}` : ""}</span>
      <span className={`clock shrink-0 ${active ? "running" : ""} ${t != null && t < 10000 ? "low" : ""}`}>{clock(t)}</span>
    </div>
  );
}

/** White-view score of an engine (engines report from their own side). */
function whiteView(e: EngineLive | undefined, white: boolean): { cp: number | null; mate: number | null } {
  if (!e) return { cp: null, mate: null };
  const s = white ? 1 : -1;
  return { cp: e.score_cp != null ? e.score_cp * s : null, mate: e.mate != null ? e.mate * s : null };
}

function LaneCard({ l, onOpen }: { l: LiveLane; onOpen: () => void }) {
  const g = l.game;
  const job = l.lane.job;
  const white = g?.engines.find((e) => e.name === g.white);
  const black = g?.engines.find((e) => e.name === g.black);
  const t = useT();
  return (
    <button className="panel p-2.5 flex flex-col gap-1.5 text-left hover:border-[var(--accent)]" onClick={onOpen} disabled={!g} data-testid="lane-card">
      <div className="flex justify-between text-[11px] muted">
        <span className="truncate">{l.tournament}</span>
        <span className="shrink-0">
          {t("live.nodeLane", { node: l.lane.node, lane: l.lane.lane })}
        </span>
      </div>
      {g && job ? (
        <>
          <PlayerRow name={g.black} ms={g.btime} active={g.side_to_move === "black"} e={black} />
          <Board fen={g.fen} lastMove={g.last_move} check={isCheck(g.moves_san.slice(-1)[0])} mini />
          <PlayerRow name={g.white} ms={g.wtime} active={g.side_to_move === "white"} e={white} />
          <div className="flex justify-between text-[11px] muted tnum">
            <span>
              {t("live.move", { n: Math.floor(g.moves_uci.length / 2) + 1, last: g.moves_san.slice(-1)[0] ?? t("live.start") })}
            </span>
            <span>
              p{job.pass} r{job.round} · #{job.opening} · {duration(l.elapsed_s)}
            </span>
          </div>
        </>
      ) : (
        <div className="aspect-square flex items-center justify-center muted">{t("live.idle")}</div>
      )}
    </button>
  );
}

function EnginePanel({ e, color }: { e?: EngineLive; color: string }) {
  const t = useT();
  if (!e) return null;
  return (
    <div className="panel p-2.5 text-[12px]">
      <div className="flex justify-between font-medium">
        <span className="flex items-center gap-1.5">
          <span className="dot" style={{ color }} /> {e.name}
        </span>
        <span className="tnum eval-value">{evalText(e.score_cp, e.mate)}</span>
      </div>
      <div className="grid grid-cols-4 gap-1 tnum muted mt-1">
        <span>d {e.depth ?? "—"}/{e.seldepth ?? "—"}</span>
        <span>{t("live.nodes", { n: nps(e.nodes) })}</span>
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
  const prefs = useBoardPrefs();
  const t = useT();
  const g = l?.game;
  const lastLen = useRef<number | null>(null);
  useEffect(() => {
    const len = g?.moves_san.length ?? null;
    if (prefs.sound && len != null && lastLen.current != null && len === lastLen.current + 1) playMoveSound(g?.moves_san[len - 1]);
    lastLen.current = len;
  }, [g?.moves_san.length, prefs.sound, g?.moves_san]);
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
  const wtm = g?.side_to_move === "white";
  const tomove = wtm ? white : black;
  // the engine to move thinks now: its score is the freshest; otherwise the other one's
  const ev = tomove?.score_cp != null || tomove?.mate != null ? whiteView(tomove, wtm) : whiteView(wtm ? black : white, !wtm);
  return (
    <Modal open={!!l} onOpenChange={(o) => !o && onClose()} width={1200} title={g ? `${g.white} – ${g.black}` : ""}>
      {g && (
        <div className="grid gap-5 live-board-grid">
          <BoardColumn id="live" className="flex flex-col gap-2">
            <PlayerRow name={g.black} ms={g.btime} active={g.side_to_move === "black"} e={black} fen={g.fen} side="b" />
            <div className="flex gap-2 items-stretch">
              <EvalBar cp={ev.cp} mate={ev.mate} />
              <Board
                fen={g.fen}
                lastMove={g.last_move}
                check={isCheck(g.moves_san.slice(-1)[0])}
                arrows={[
                  ...(tomove?.pv[0] ? [{ uci: tomove.pv[0], brush: "green" as const }] : []),
                  ...(tomove?.pv[1] ? [{ uci: tomove.pv[1], brush: "paleBlue" as const }] : []),
                ]}
                className="flex-1"
              />
            </div>
            <PlayerRow name={g.white} ms={g.wtime} active={g.side_to_move === "white"} e={white} fen={g.fen} side="w" />
            <div className="flex justify-between items-center text-[11.5px] muted">
              <span>{t("live.arrows")}</span>
              <BoardSettingsButton />
            </div>
          </BoardColumn>
          <div className="flex flex-col gap-3 min-w-0">
            <EnginePanel e={white} color="var(--text)" />
            <EnginePanel e={black} color="#e3b341" />
            <div>
              <div className="kpi-label mb-1">{t("live.evalTitle")}</div>
              <LineChart x={series.x} series={[{ label: t("live.white"), color: "var(--text)", values: series.w }, { label: t("live.black"), color: "#e3b341", values: series.b }]} height={140} zeroLine />
            </div>
            <div>
              <div className="kpi-label mb-1">{t("live.timeTitle")}</div>
              <LineChart x={series.x} series={[{ label: t("live.white"), color: "var(--text)", values: series.tw }, { label: t("live.black"), color: "#e3b341", values: series.tb }]} height={90} />
            </div>
            <div className="panel p-2 mono leading-6 max-h-[160px] overflow-auto">
              {g.moves_san.map((m, i) => (
                <span key={i}>
                  {i % 2 === 0 && <span className="muted mr-1">{i / 2 + 1}.</span>}
                  <span className="mr-1.5 px-0.5 rounded" style={i === g.moves_san.length - 1 ? { background: "var(--accent)", color: "var(--on-accent, #fff)" } : undefined}>
                    {m}
                  </span>{" "}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The CPUs given to the running tournaments, each in its colour (folded by default, kept on this computer). */
function CpuLoad() {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("torsgui-live-load") === "1";
    } catch {
      return false;
    }
  });
  const { data: topo } = usePoll<Topology>(open ? "topology" : null, {}, 0);
  const items = useRunningItems();
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem("torsgui-live-load", open ? "0" : "1");
    } catch {
      /* private mode */
    }
  };
  return (
    <Panel
      title={
        <button className="flex items-center gap-1.5" onClick={toggle} aria-expanded={open} data-testid="live-load-toggle">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <Cpu size={13} /> {t("cores.load.title")}
        </button>
      }
    >
      {open && (!topo ? null : items.length === 0 ? <div className="muted text-[12.5px]">{t("cores.load.none")}</div> : <LoadMap topo={topo} items={items} />)}
    </Panel>
  );
}

export function Live() {
  const { data, error } = usePoll<LiveLane[]>("live_lanes", {}, 1000);
  const [open, setOpen] = useState<string | null>(null);
  const t = useT();
  const lanes = data ?? [];
  const busy = lanes.filter((l) => l.lane.busy).length;
  const cur = lanes.find((l) => `${l.tournament_id}/${l.lane.partition}/${l.lane.lane}` === open) ?? null;
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="run-it" title={t("live.title")} sub={t("live.sub", { busy, lanes: lanes.length })} />
      <ErrorBox error={error} />
      <CpuLoad />
      {lanes.length === 0 ? (
        <Panel>
          <Empty icon={<Activity size={22} />}>{t("live.empty")}</Empty>
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
