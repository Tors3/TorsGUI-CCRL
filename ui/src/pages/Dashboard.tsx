import { ArrowDown, ArrowUp, CheckCircle2, Cpu, HardDrive, Play, Plus, Server, Trophy, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Health } from "../bindings/Health";
import type { TimelineItem } from "../bindings/TimelineItem";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { TournamentActions } from "../components/TournamentActions";
import { Empty, ErrorBox, Kpi, PageHeader, Panel, ProgressBar, StateChip } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { ago, duration, num, pct, shortTime } from "../lib/format";
import type { DashboardData } from "../lib/types";

function RunningCard({ t, refresh }: { t: TournamentSummary; refresh: () => void }) {
  const r = t.record;
  const p = t.progress;
  return (
    <div className="panel p-3 flex flex-col gap-2" data-testid="running-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/tournaments/${encodeURIComponent(r.id)}`} className="font-semibold hover:underline truncate block">
            {r.name}
          </Link>
          <div className="muted text-[12px] truncate">
            {r.config.event} · TC {r.config.tc} · {r.config.threads}T · {r.config.hash_mb} MB · {p.lanes} lanes
          </div>
        </div>
        <StateChip state={r.state} alive={t.runner_alive} />
      </div>
      <ProgressBar value={p.done} max={p.expected} tone="win" />
      <div className="grid grid-cols-5 gap-2 text-[12px] tnum">
        <div>
          <div className="kpi-label">Games</div>
          <div className="font-semibold">
            {p.done}
            <span className="muted">/{p.expected}</span>
          </div>
        </div>
        <div>
          <div className="kpi-label">Seed</div>
          <div className="font-semibold truncate">{t.score_line ?? "—"}</div>
        </div>
        <div>
          <div className="kpi-label">Games/h</div>
          <div className="font-semibold">{num(p.rate_per_hour, 1)}</div>
        </div>
        <div>
          <div className="kpi-label">Avg game</div>
          <div className="font-semibold">{duration(p.avg_game_s)}</div>
        </div>
        <div>
          <div className="kpi-label">ETA</div>
          <div className="font-semibold">{duration(p.eta_s)}</div>
          <div className="muted text-[11px]">{p.eta_at ?? ""}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <TournamentActions t={t} onDone={refresh} compact />
      </div>
    </div>
  );
}

function HealthPanel({ h }: { h: Health }) {
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode, bad = false) => (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="flex items-center gap-2 text-2">
        {icon}
        {label}
      </span>
      <span className="tnum font-medium" style={{ color: bad ? "var(--loss)" : undefined }}>
        {value}
      </span>
    </div>
  );
  const ramPct = h.total_ram_mb ? (100 * h.free_ram_mb) / h.total_ram_mb : 0;
  return (
    <Panel title="Health" actions={h.anomalies.length === 0 ? <span className="chip chip-win">all good</span> : <span className="chip chip-loss">{h.anomalies.length} alerts</span>}>
      {row(<Server size={14} />, "Runners alive", `${h.runners_alive} / ${h.runners_expected}`, h.runners_alive < h.runners_expected)}
      {row(<Cpu size={14} />, "fastchess processes", h.fastchess_processes)}
      {row(<Trophy size={14} />, "Engine processes", h.engine_processes)}
      {row(<HardDrive size={14} />, "Free RAM", `${(h.free_ram_mb / 1024).toFixed(1)} / ${(h.total_ram_mb / 1024).toFixed(0)} GB (${pct(ramPct, 0)})`, ramPct < 10)}
      {row(<Cpu size={14} />, "CPU load", pct(h.cpu_load_pct, 0))}
      {row(<X size={14} />, "Crashes / disconnects (24 h)", h.engine_crashes_24h, h.engine_crashes_24h > 0)}
      {row(<X size={14} />, "Time forfeits (24 h)", h.time_forfeits_24h, h.time_forfeits_24h > 0)}
      <div className="flex flex-col gap-1.5 mt-2">
        {h.anomalies.map((a, i) => (
          <div key={i} className={`rounded-md px-2 py-1.5 text-[12px]`} style={{ background: a.level === "error" ? "var(--loss-bg)" : "var(--warn-bg)", color: a.level === "error" ? "var(--loss)" : "var(--warn)" }} data-testid="anomaly">
            {a.message}
          </div>
        ))}
        {h.anomalies.length === 0 && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--win)" }}>
            <CheckCircle2 size={14} /> No anomaly detected
          </div>
        )}
      </div>
    </Panel>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <Empty>Nothing running or queued.</Empty>;
  const parse = (s: string) => Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  const now = Date.now();
  const starts = items.map((i) => Math.min(parse(i.start) || now, now));
  const ends = items.map((i) => parse(i.end) || now);
  const t0 = Math.min(...starts);
  const t1 = Math.max(...ends, now + 3600e3);
  const x = (t: number) => `${(100 * (t - t0)) / (t1 - t0)}%`;
  const ticks = 6;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-4 text-[10.5px] muted">
        {Array.from({ length: ticks + 1 }, (_, k) => {
          const t = t0 + ((t1 - t0) * k) / ticks;
          return (
            <span key={k} className="absolute tnum whitespace-nowrap" style={{ left: x(t), transform: `translateX(${k === 0 ? "0" : k === ticks ? "-100%" : "-50%"})` }}>
              {new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          );
        })}
      </div>
      {items.map((it, i) => (
        <div key={it.id} className="relative h-6 rounded" style={{ background: "var(--bg-2)" }}>
          <div
            className="absolute top-0 h-6 rounded flex items-center px-2 text-[11.5px] font-medium truncate"
            style={{ left: x(starts[i]), width: `max(4px, calc(${x(ends[i])} - ${x(starts[i])}))`, background: it.state === "running" ? "var(--win-bg)" : "var(--accent-bg)", border: `1px solid ${it.state === "running" ? "var(--win)" : "var(--accent)"}`, color: "var(--text)" }}
            title={`${it.name}: ${shortTime(it.start)} → ${shortTime(it.end)} (estimated)`}
          >
            {it.name}
          </div>
        </div>
      ))}
      <div className="absolute" />
    </div>
  );
}

export function Dashboard() {
  const { data, error, refresh } = usePoll<DashboardData>("dashboard", {}, 3000);
  const nav = useNavigate();
  const ts = data?.tournaments ?? [];
  const running = ts.filter((t) => t.record.state === "running");
  const queued = ts.filter((t) => t.record.state === "queued").sort((a, b) => (a.record.queue_pos ?? 0) - (b.record.queue_pos ?? 0));
  const recent = ts.filter((t) => ["completed", "incomplete", "paused", "stopped"].includes(t.record.state)).slice(0, 6);
  const rate = running.reduce((s, t) => s + (t.progress.rate_per_hour ?? 0), 0);
  const move = async (id: string, delta: number) => {
    await call("queue_move", { id, delta });
    refresh();
  };
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        title="Dashboard"
        sub={data ? `${running.length} running · ${queued.length} queued · ${ts.length} tournaments` : "Loading…"}
        actions={
          <>
            <button className="btn" onClick={() => call("queue_start").then(() => { toast.success("Queue started"); refresh(); }).catch((e) => toast.error(e.message))} disabled={!queued.length || running.length > 0}>
              <Play size={13} /> Start queue
            </button>
            <button className="btn btn-primary" onClick={() => nav("/tournaments/new")}>
              <Plus size={14} /> New tournament
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      <div className="grid grid-cols-6 gap-3">
        <Kpi label="Running" value={running.length} sub={`${running.reduce((s, t) => s + t.progress.lanes, 0)} lanes`} tone={running.length ? "win" : undefined} />
        <Kpi label="Queued" value={queued.length} sub={queued[0] ? `next: ${queued[0].record.name}` : "queue empty"} />
        <Kpi label="Games / hour" value={num(rate, 1)} sub="rolling window, all runners" />
        <Kpi label="Current ETA" value={duration(running[0]?.progress.eta_s)} sub={running[0]?.progress.eta_at ?? "—"} />
        <Kpi label="Queue ETA" value={data?.queue_eta ? data.queue_eta.slice(5) : "—"} sub="end of the last queued tournament" tone="accent" />
        <Kpi label="Alerts" value={data?.health.anomalies.length ?? 0} tone={(data?.health.anomalies.length ?? 0) > 0 ? "loss" : "win"} sub={data ? `${data.health.runners_alive}/${data.health.runners_expected} runners alive` : ""} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 flex flex-col gap-3 min-w-0">
          <Panel title="Running" noPad bodyClass="p-3 flex flex-col gap-3">
            {running.length ? running.map((t) => <RunningCard key={t.record.id} t={t} refresh={refresh} />) : <Empty>No tournament running. Create one or start the queue.</Empty>}
          </Panel>
          <Panel title="ETA timeline (running + queue)">
            <Timeline items={data?.timeline ?? []} />
          </Panel>
          <div className="grid grid-cols-2 gap-3">
            <Panel title="Queue" noPad>
              {queued.length === 0 ? (
                <Empty>The queue is empty.</Empty>
              ) : (
                <table className="tbl">
                  <tbody>
                    {queued.map((t, i) => (
                      <tr key={t.record.id}>
                        <td className="muted w-6 tnum">{i + 1}</td>
                        <td className="truncate max-w-[220px]">
                          <Link to={`/tournaments/${encodeURIComponent(t.record.id)}`} className="hover:underline">
                            {t.record.name}
                          </Link>
                        </td>
                        <td className="r tnum muted">{t.record.expected_games} g</td>
                        <td className="r tnum muted">{duration(t.progress.eta_s)}</td>
                        <td className="r">
                          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move up" onClick={() => move(t.record.id, -1)} disabled={i === 0}>
                            <ArrowUp size={13} />
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move down" onClick={() => move(t.record.id, 1)} disabled={i === queued.length - 1}>
                            <ArrowDown size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel title="Recent tournaments" noPad>
              <table className="tbl">
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.record.id} className="clickable" onClick={() => nav(`/tournaments/${encodeURIComponent(t.record.id)}`)}>
                      <td className="truncate max-w-[200px]">{t.record.name}</td>
                      <td>
                        <StateChip state={t.record.state} />
                      </td>
                      <td className="r tnum">
                        {t.record.done_games}/{t.record.expected_games}
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr>
                      <td className="muted">No finished tournament yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          {data && <HealthPanel h={data.health} />}
          <Panel title="Events" actions={<Link to="/logs" className="text-[12px] muted hover:underline">all</Link>} noPad>
            <div className="flex flex-col">
              {(data?.events ?? []).map((e) => (
                <div key={e.seq} className="px-3 py-1.5 text-[12px] flex gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <span className="dot mt-1.5 shrink-0" style={{ color: e.level === "error" ? "var(--loss)" : e.level === "warn" ? "var(--warn)" : e.level === "success" ? "var(--win)" : "var(--muted)" }} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate" title={e.message}>
                      {e.message}
                    </span>
                    <span className="muted text-[11px]">{ago(e.ts)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
